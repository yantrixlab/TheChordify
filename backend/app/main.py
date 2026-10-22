from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import tempfile
import threading
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .engine import analyze
from .jobs import JobQueue
from .search import RateLimiter, SearchUnavailable, clean_query, search_songs
from .store import SongStore
from . import youtube
from .youtube import InvalidUrlError, VideoNotDownloadable, YouTubeBlocked, download_audio, extract_video_id, is_video_id, session_id_for_url, video_info

# Saved results, uploads and the song catalog. Point DATA_DIR at a persistent volume in production, or every redeploy
# starts with an empty catalog and re-analyses every song.
CACHE_DIR = os.environ.get("DATA_DIR") or os.path.join(tempfile.gettempdir(), "thechordify-cache")
UPLOAD_DIR = os.path.join(CACHE_DIR, "uploads")
RESULT_DIR = os.path.join(CACHE_DIR, "results")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)
# Slow work (download + analysis) waits in line here, first come first served, with a visible place in line.
job_queue = JobQueue(
    workers=int(os.environ.get("JOB_WORKERS") or os.environ.get("CHORD_WORKERS", "1")),
    max_waiting=int(os.environ.get("MAX_WAITING_SONGS", "25")),
)
# New songs one visitor may start per hour (songs already in the catalog are free). 0 turns the limit off.
NEW_SONGS_PER_HOUR = int(os.environ.get("NEW_SONGS_PER_HOUR", "8"))
catalog = SongStore(os.path.join(CACHE_DIR, "songs.db"))
youtube.configure(CACHE_DIR)  # where cookies pasted on the admin page are kept

# Bump whenever the detector's output changes, so songs cached by an older version are analysed again.
# 2: frame times no longer drift against the audio clock.
# 3: simple (core chords) vs detailed chords, bars aligned to the downbeat, song sections.
# 4: song key.
# 5: a soft intro stays in the bar grid (Silence is only true silence); beat grid covers quiet passages.
# 6: tempo and beat grid from the audio's own pulse (the tracker could be several % off); chords carry gridStart.
# 7: every detected chord gets a beat cell; sections use texture (loudness, brightness, percussion), so soft builds read as Intro.
# 8: sections from a trained structure model (all-in-one), snapped to our bars; Instrumental / Outro / Bridge appear.
# 9: those sections arrive in the background after the chords (sectionsPending), instead of holding the analysis up.
# 10: a pickup bar gets real beat cells (the first cell is the first beat; no leading Silence section), and a section
#     starts where its chords do.
# 11: chords that recur on the same beat of nearby bars are favoured there (restores faint repeats); slivers under 0.3 s are absorbed.
ANALYSIS_VERSION = 11

ALLOWED_UPLOAD_EXTENSIONS ={".mp3", ".wav", ".flac", ".m4a"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB

app = FastAPI(title="Chord Suno chord extraction API")

# Local dev origins are always allowed; list production sites in CORS_ORIGINS (comma-separated),
# e.g. CORS_ORIGINS=https://chordsuno.com,https://www.chordsuno.com
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")

# In-memory job tracker: session_id -> {"status", "progress", "stage", "error", "result"}
# Fine for a single-process dev/small deployment. Swap for Redis if you scale to
# multiple worker processes, since this dict won't be shared across them.
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()

log = logging.getLogger("thechordify.api")
# Songs whose chords are ready but whose sections are still being refined by the structure model (in this process).
_PENDING: set[str] = set()


def _set_job(session_id: str, **fields) -> None:
    with _JOBS_LOCK:
        job = _JOBS.setdefault(session_id, {})
        job.update(fields)


def _get_job(session_id: str) -> Optional[dict]:
    with _JOBS_LOCK:
        job = _JOBS.get(session_id)
        return dict(job) if job else None


class YoutubeRequest(BaseModel):
    url: str
    # What the search results already told us about the song; saves asking YouTube again for the player header.
    title: str = ""
    artist: str = ""
    album: str = ""
    thumbnail: str = ""
    duration: float = 0.0


_SAFE_KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _check_key(session_id: str) -> None:
    """Session ids become file names, so only plain ones are accepted."""
    if not _SAFE_KEY.match(session_id):
        raise HTTPException(status_code=404, detail="Unknown session")


def _chord_summary(chords: list[dict], limit: int = 5) -> list[str]:
    """The song's main chords, the ones that sound longest first (what a search result shows, e.g. C G F)."""
    time_by_chord: dict[str, float] = {}
    for seg in chords:
        if seg["chord"] != "N":
            time_by_chord[seg["chord"]] = time_by_chord.get(seg["chord"], 0.0) + seg["end"] - seg["start"]
    return [c for c, _t in sorted(time_by_chord.items(), key=lambda kv: -kv[1])][:limit]


def _record_song(video_id: str, session_id: str, result: dict, meta: dict) -> None:
    """Puts a chordified YouTube song in the catalog. A failure here must never fail the analysis."""
    try:
        catalog.save_song(
            video_id,
            session_id,
            title=result.get("title") or meta.get("title") or "",
            artist=result.get("artist") or meta.get("artist") or "",
            album=meta.get("album", ""),
            duration=float(meta.get("duration") or result.get("duration") or 0),
            thumbnail=meta.get("thumbnail", ""),  # empty keeps the cover the search gave us
            chords=_chord_summary(result.get("chords", [])),
            key=result.get("key", ""),
            tempo=float(result.get("tempo") or 0),
        )
    except Exception as exc:
        log.warning("Could not record %s in the catalog: %s", video_id, exc)


def _with_pending(session_id: str, result: dict) -> dict:
    return {**result, "sectionsPending": session_id in _PENDING}


def _remove(path: Optional[str]) -> None:
    if path:
        try:
            os.remove(path)
        except OSError:
            pass


def _refine_sections(session_id: str, result: dict, upgrade, cleanup: Optional[str] = None) -> None:
    """Waits for the structure model (off the request path) and swaps its sections into the saved result."""
    try:
        sections = upgrade()
        if sections:
            result = {**result, "sections": sections, "sectionsSource": "model"}
            _save_result(session_id, result)
            _set_job(session_id, result=result)
    except Exception as exc:
        log.warning("Refining the sections failed for %s: %s", session_id, exc)
    finally:
        _PENDING.discard(session_id)
        _remove(cleanup)


def _finish(session_id: str, result: dict, upgrade, cleanup: Optional[str] = None) -> None:
    """Saves the finished analysis and, if better sections are on their way, refines them in the background.
    `cleanup` is a downloaded file to delete once nothing needs it (the section model reads it, then it can go)."""
    if upgrade:
        _PENDING.add(session_id)  # before the job reads "done", so the very first response already says so
    _save_result(session_id, result)
    _set_job(session_id, status="done", progress=100, stage="Done", result=result)
    if upgrade:
        threading.Thread(target=_refine_sections, args=(session_id, result, upgrade, cleanup), daemon=True).start()
    else:
        _remove(cleanup)


def _result_path(key: str) -> str:
    return os.path.join(RESULT_DIR, f"{key}.json")


def _load_cached_result(key: str) -> Optional[dict]:
    path = _result_path(key)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                result = json.load(f)
        except (OSError, ValueError):
            return None  # unreadable/partial cache entry: treat as a miss and re-analyse
        # Results from an older detector (e.g. before the timing-drift fix) are re-analysed.
        return result if result.get("analysisVersion") == ANALYSIS_VERSION else None
    return None


def _save_result(key: str, result: dict) -> None:
    # Write-then-rename so a crash mid-write can't leave a truncated cache file behind.
    path = _result_path(key)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({**result, "analysisVersion": ANALYSIS_VERSION}, f)
    os.replace(tmp, path)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


def _run_youtube_job(session_id: str, url: str, meta: dict) -> None:
    audio_path: Optional[str] = None
    try:
        _set_job(session_id, status="downloading", progress=2, stage="Fetching audio from the link")
        audio_path = download_audio(url, UPLOAD_DIR)

        _set_job(session_id, status="analyzing", progress=5, stage="Loading audio")

        def on_progress(pct: int, stage: str) -> None:
            _set_job(session_id, status="analyzing", progress=pct, stage=stage)

        analysis = analyze(audio_path, on_progress=on_progress)
        upgrade = analysis.pop("sectionsUpgrade", None)

        result = {
            "sessionId": session_id,
            "source": "youtube",
            "sourceUrl": url,
            "videoId": extract_video_id(url) or "",
            **({"title": meta["title"], "artist": meta.get("artist", "")} if meta.get("title") else video_info(url)),
            "duration": analysis["duration"],
            "chords": analysis["chords"],
            "tempo": analysis["tempo"],
            "beatTimes": analysis["beatTimes"],
            "bars": analysis["bars"],
            "engine": analysis["engine"],
            "chordsDetailed": analysis.get("chordsDetailed", analysis["chords"]),
            "sections": analysis.get("sections", []),
            "key": analysis.get("key", ""),
            "audioUrl": "",  # YouTube songs play in YouTube's own player; the downloaded audio is not kept
        }
        video_id = extract_video_id(url)
        if video_id:
            _record_song(video_id, session_id, result, meta)
        _finish(session_id, result, upgrade, cleanup=audio_path)
    except InvalidUrlError as exc:
        _set_job(session_id, status="error", progress=0, error=str(exc))
    except Exception as exc:
        _remove(audio_path)
        error_text = str(exc).lower()
        if isinstance(exc, YouTubeBlocked):
            log.warning("YouTube is blocking downloads (%s); add or refresh cookies on /admin", session_id)
            message = "We couldn't fetch that song from YouTube right now. Please try another song, or upload the audio file instead."
        elif isinstance(exc, VideoNotDownloadable):
            log.warning("Video %s cannot be downloaded: %s", session_id, exc)
            message = "We couldn't fetch this particular video from YouTube. Please try another version of the song."
        elif "private video" in error_text:
            message = "That video is private, so we can't read it. Try another version of the song."
        elif "unavailable" in error_text or "has been removed" in error_text or "terminated" in error_text:
            message = "That video isn't available on YouTube any more. Try another version of the song."
        else:
            log.warning("Could not process %s: %s", session_id, exc)
            message = "Something went wrong while fetching that song. Please try again, or try another version."
        _set_job(session_id, status="error", progress=0, error=message)


def _run_analysis_job(
    session_id: str, audio_path: str, source: str, source_url: Optional[str] = None, title: str = ""
) -> None:
    try:
        _set_job(session_id, status="analyzing", progress=5, stage="Loading audio")

        def on_progress(pct: int, stage: str) -> None:
            _set_job(session_id, status="analyzing", progress=pct, stage=stage)

        analysis = analyze(audio_path, on_progress=on_progress)
        upgrade = analysis.pop("sectionsUpgrade", None)

        result = {
            "sessionId": session_id,
            "source": source,
            "title": title,
            "artist": "",
            "duration": analysis["duration"],
            "chords": analysis["chords"],
            "tempo": analysis["tempo"],
            "beatTimes": analysis["beatTimes"],
            "bars": analysis["bars"],
            "engine": analysis["engine"],
            "chordsDetailed": analysis.get("chordsDetailed", analysis["chords"]),
            "sections": analysis.get("sections", []),
            "key": analysis.get("key", ""),
            "audioUrl": f"/media/{os.path.basename(audio_path)}",
        }
        if source_url:
            result["sourceUrl"] = source_url
        _finish(session_id, result, upgrade)
    except Exception as exc:
        _set_job(session_id, status="error", progress=0, error=f"Chord analysis failed: {exc}")


_search_limiter = RateLimiter(limit=30, window=60.0)


@app.get("/api/search")
def search(request: Request, q: str = "") -> dict:
    """Songs (YouTube Music's song results only) matching what was typed; an empty list when nothing matches."""
    query = clean_query(q)
    if len(query) < 2:
        return {"query": query, "results": []}
    caller = request.client.host if request.client else "unknown"
    if not _search_limiter.allow(caller):
        raise HTTPException(status_code=429, detail="Too many searches. Please wait a moment and try again.")
    try:
        songs = search_songs(query)
        known = catalog.lookup([song["videoId"] for song in songs])
        # Songs somebody has already chordified come with their main chords and jam count, and open straight away.
        return {"query": query, "results": [{**song, **known.get(song["videoId"], {})} for song in songs]}
    except SearchUnavailable as exc:
        log.warning("Song search failed: %s", exc)
        raise HTTPException(status_code=502, detail="Song search is unavailable right now. Please try again in a moment.")


# ---- admin: keep YouTube downloads working (cookies expire; this avoids a redeploy each time) --------------------------
# Switched on by setting ADMIN_TOKEN (a long random string) in the environment; without it these routes answer 404.
_ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
_admin_limiter = RateLimiter(limit=20, window=60.0)


def _require_admin(request: Request) -> None:
    if not _ADMIN_TOKEN:
        raise HTTPException(status_code=404, detail="Not found")
    caller = request.client.host if request.client else "unknown"
    if not _admin_limiter.allow(caller):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute.")
    given = request.headers.get("x-admin-token", "")
    if not hmac.compare_digest(given.encode("utf-8"), _ADMIN_TOKEN.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Wrong admin token")


def _is_admin(request: Request) -> bool:
    """True if the request carries the admin token (the owner trying things is not held to the visitor limits)."""
    given = request.headers.get("x-admin-token", "")
    return bool(_ADMIN_TOKEN) and hmac.compare_digest(given.encode("utf-8"), _ADMIN_TOKEN.encode("utf-8"))


class AccountBody(BaseModel):
    cookies: str
    label: str = ""


@app.get("/api/admin/youtube")
def admin_youtube_status(request: Request, test: bool = False) -> dict:
    """What the server has for YouTube (the accounts and their health); with ?test=1 also tries each one for real."""
    _require_admin(request)
    return {**youtube.diagnose(test=test), "queue": job_queue.stats(), "newSongsPerHour": NEW_SONGS_PER_HOUR}


@app.post("/api/admin/youtube/accounts")
def admin_add_account(body: AccountBody, request: Request) -> dict:
    _require_admin(request)
    try:
        return youtube.add_account(body.cookies, body.label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/admin/youtube/accounts/{account_id}")
def admin_remove_account(account_id: str, request: Request) -> dict:
    _require_admin(request)
    if not youtube.remove_account(account_id):
        raise HTTPException(status_code=404, detail="No such account (accounts set in the environment cannot be removed here)")
    return {"removed": account_id}


@app.post("/api/admin/youtube/accounts/{account_id}/reset")
def admin_reset_account(account_id: str, request: Request) -> dict:
    _require_admin(request)
    youtube.reset_account(account_id)
    return {"reset": account_id}


@app.get("/api/popular")
def popular() -> dict:
    """The most-jammed songs on the site, for the search page before anything is typed."""
    return {"results": catalog.popular(12)}


_jam_limiter = RateLimiter(limit=1, window=30 * 60.0)  # one jam session per visitor and song every half hour


@app.post("/api/songs/{video_id}/jam")
def add_jam(video_id: str, request: Request) -> dict:
    """Counts a jam session: someone pressed play on this song. Repeats from the same visitor are not counted."""
    if not is_video_id(video_id):
        raise HTTPException(status_code=404, detail="Unknown song")
    caller = f"{request.client.host if request.client else 'unknown'}:{video_id}"
    if not _jam_limiter.allow(caller):
        return {"counted": False}
    jams = catalog.add_jam(video_id)
    if jams is None:
        raise HTTPException(status_code=404, detail="Unknown song")
    return {"counted": True, "jams": jams}


_new_song_limiter = RateLimiter(limit=max(NEW_SONGS_PER_HOUR, 1), window=3600.0)


def _enqueue(request: Request, session_id: str, task) -> dict:
    """Starts a new analysis in line. One visitor may only start so many new songs an hour, and the line has a length
    limit; joining a job that is already waiting or running costs nothing."""
    existing = _get_job(session_id)
    if existing and existing.get("status") in ("queued", "downloading", "analyzing"):
        return {"sessionId": session_id, "status": existing["status"]}

    caller = request.client.host if request.client else "unknown"
    limited = NEW_SONGS_PER_HOUR > 0 and not _is_admin(request)
    if limited and not _new_song_limiter.allow(caller):
        minutes = max(1, int(_new_song_limiter.retry_after(caller) // 60) + 1)
        raise HTTPException(
            status_code=429,
            detail=(
                f"You have started the most new songs allowed per hour ({NEW_SONGS_PER_HOUR}). Songs that others have already "
                f"chordified open instantly, and you can start another in about {minutes} minute{'s' if minutes != 1 else ''}."
            ),
        )
    _set_job(session_id, status="queued", progress=0, stage="Queued")
    outcome = job_queue.submit(session_id, task)
    if outcome == "full":
        if limited:
            _new_song_limiter.refund(caller)
        _JOBS.pop(session_id, None)
        raise HTTPException(status_code=503, detail="We're very busy right now. Please try again in a few minutes.")
    return {"sessionId": session_id, "status": "queued"}


@app.post("/api/extract/youtube")
def extract_from_youtube(payload: YoutubeRequest, request: Request) -> dict:
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    session_id = session_id_for_url(url)
    meta = {
        "title": payload.title[:200],
        "artist": payload.artist[:200],
        "album": payload.album[:200],
        "thumbnail": payload.thumbnail[:300] if payload.thumbnail.startswith("https://") else "",
        "duration": max(0.0, min(payload.duration, 6 * 3600)),
    }

    cached = _load_cached_result(session_id)
    if cached:
        _set_job(session_id, status="done", progress=100, stage="Done", result=cached)
        video_id = extract_video_id(url)
        if video_id:
            _record_song(video_id, session_id, cached, meta)  # songs analysed before the catalog existed join it now
        return {"sessionId": session_id, "status": "done"}

    return _enqueue(request, session_id, lambda: _run_youtube_job(session_id, url, meta))


@app.post("/api/extract/upload")
async def extract_from_upload(request: Request, file: UploadFile = File(...)) -> dict:
    _, ext = os.path.splitext(file.filename or "")
    ext = ext.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}",
        )

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")

    session_id = hashlib.sha256(contents).hexdigest()[:24]
    stored_path = os.path.join(UPLOAD_DIR, f"{session_id}{ext}")
    with open(stored_path, "wb") as f:
        f.write(contents)

    cached = _load_cached_result(session_id)
    if cached:
        _set_job(session_id, status="done", progress=100, stage="Done", result=cached)
        return {"sessionId": session_id, "status": "done"}

    title = os.path.splitext(file.filename or "")[0]
    return _enqueue(request, session_id, lambda: _run_analysis_job(session_id, stored_path, "upload", None, title))


@app.get("/api/job/{session_id}")
def get_job_status(session_id: str) -> dict:
    _check_key(session_id)
    job = _get_job(session_id)
    if not job:
        cached = _load_cached_result(session_id)
        if cached:
            return {"sessionId": session_id, "status": "done", "progress": 100, "result": _with_pending(session_id, cached)}
        raise HTTPException(status_code=404, detail="Unknown session")
    if job.get("result"):
        job["result"] = _with_pending(session_id, job["result"])
    if job.get("status") == "queued":
        ahead = job_queue.ahead_of(session_id)
        if ahead is not None:
            seconds = job_queue.wait_estimate(ahead)
            wait = "under a minute" if seconds < 60 else f"about {round(seconds / 60)} min"
            job["ahead"] = ahead
            job["etaSeconds"] = seconds
            job["stage"] = (
                "Starting your song…"
                if ahead == 0
                else f"Waiting for your turn: {ahead} song{'s' if ahead != 1 else ''} ahead of you ({wait})"
            )
    return {"sessionId": session_id, **job}


@app.get("/api/result/{session_id}")
def get_result(session_id: str) -> dict:
    _check_key(session_id)
    cached = _load_cached_result(session_id)
    if not cached:
        raise HTTPException(status_code=404, detail="Unknown session")
    return _with_pending(session_id, cached)


# Serve the built Astro site from the same origin (the Docker image copies it to STATIC_DIR).
# Mounted last so /api and /media routes win; absent in local dev, where Astro runs its own server.
_STATIC_DIR = os.environ.get("STATIC_DIR", os.path.join(os.path.dirname(__file__), "..", "static"))
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="site")
