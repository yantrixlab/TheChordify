from __future__ import annotations

import hashlib
import hmac
import json
import logging
import glob
import os
import re
import tempfile
import threading
import time
import uuid
from typing import Optional
from urllib.parse import quote, urlparse

from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .engine import analyze
from . import accounts as accounts_module
from .accounts import AccountStore, SignInError
from . import roles as roles_module
from .roles import RoleError, RoleStore
from .billing import Razorpay, RazorpayError, entity_summary
from . import plans as plans_module
from . import partners as partners_module
from .partners import PartnerError, PartnerStore
from .plans import FREE_CODE, PERIODS, PlanStore
from .engagement import BADGE_RULES, DEFAULT_CONFIG, REWARD_KINDS, Engagement
from .jobs import JobQueue
from .search import RateLimiter, SearchUnavailable, clean_query, find_video, radio, search_songs, suggest
from .sections_ai import status as section_model_status
from .similar import shelf as similar_shelf
from .songpages import SongPages
from . import songedit
from .store import SongStore
from . import trending as trending_shelves
from . import youtube
from .wwwredirect import WwwRedirect
from .youtube import InvalidUrlError, VideoNotDownloadable, YouTubeBlocked, download_audio, extract_video_id, is_video_id, session_id_for_url, video_info

log = logging.getLogger("thechordify.api")

# Uploads, cookies and (without DATABASE_URL) the song catalog and saved results live under DATA_DIR. In production set
# DATABASE_URL to a Postgres database for the catalog and results, and mount a persistent volume on DATA_DIR, or every
# redeploy starts empty and re-analyses every song.
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
catalog = SongStore(CACHE_DIR)
youtube.configure(CACHE_DIR)  # where cookies pasted on the admin page are kept
youtube.keep_failures(lambda: catalog.load_result("meta:failures"), lambda data: catalog.save_result("meta:failures", data))
_TRENDING_KEY = "meta:trending"  # not a valid song id, so it can never be asked for as a result
trending_shelves.start(lambda: catalog.load_result(_TRENDING_KEY), lambda data: catalog.save_result(_TRENDING_KEY, data))
accounts = AccountStore(catalog.db)
role_store = RoleStore(catalog.db)
engagement = Engagement(catalog.db)
plans = PlanStore(catalog.db)
partners = PartnerStore(catalog.db)  # influencers: their links, who came through them, what was paid
razorpay = Razorpay.from_env()  # payments: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
try:  # results and songs that older versions kept in files join the database, once
    log.info("Imported from files: %s", catalog.import_files(CACHE_DIR))
except Exception as exc:
    log.warning("Could not import the old files: %s", exc)

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
# 12: bars are as long as the song counts them instead of always four; the result says `beatsPerBar`.
# 13: five and seven beats a bar are found too.
# 14: a quick waltz tracked at half its speed is counted at its own (about twice the tempo, three beats a bar).
# 15: a chord written a beat before or after a bar line moves onto it in songs that change chord on the bar line.
# 16: the result carries the song's strumming pattern.
# 17: the strumming pattern is told from the chord's own notes, so drums and vocals no longer make every song look the same.
# 18: a song can have several strumming patterns (one per kind of section), in eighths or sixteenths.
# 19: strikes are found as sudden rises of the chord's own notes and tested against chance, so strokes that follow close on another are not lost.
# 20: the beat grid follows a tempo that drifts and is tracked on a fine envelope (a song of 140 BPM was gridded at 129.2), so bars, sections and chords stay aligned all the way through.
# 21: a repeated chord change is written on the same beat of the bar every time (loops line up row after row), when the audio agrees.
# 22: chords written a beat late (or a short chord missed) are put where their notes come in, so a loop reads the way it is played.
# 23: the bass line decides where a chord begins and what it is (an F that the B-flat chord holds, G minor over a B-flat bass), and a chord is only added where the bass plays it.
# 24: a song counted in threes at a quick pulse (a waltz at 173 BPM) is counted so again, now that the pulse finder found a pulse of its own at two thirds of that speed: the quick grid, followed through the song, wins when its bars of three fit clearly better.
ANALYSIS_VERSION = 24

_sections = section_model_status()
logging.getLogger("thechordify.sections").info(
    "Structure model: %s (%s)", "on" if _sections["willRun"] else "OFF - songs get the quick sections only", _sections["reason"]
)

ALLOWED_UPLOAD_EXTENSIONS ={".mp3", ".wav", ".flac", ".m4a"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB

app = FastAPI(title="Chord Suno chord extraction API")

# Local dev origins are always allowed; list production sites in CORS_ORIGINS (comma-separated),
# e.g. CORS_ORIGINS=https://chordsuno.com,https://www.chordsuno.com
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,  # the sign-in cookie, for the sites listed above (in production the site and API share one origin)
    allow_methods=["*"],
    allow_headers=["*"],
)

# www.chordsuno.com is the same site: send it to chordsuno.com (added last, so it runs before everything else)
app.add_middleware(WwwRedirect)

app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")

# In-memory job tracker: session_id -> {"status", "progress", "stage", "error", "result"}
# Fine for a single-process dev/small deployment. Swap for Redis if you scale to
# multiple worker processes, since this dict won't be shared across them.
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()

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
        latest = _load_saved_result(session_id) or result
        if sections and not latest.get("sectionsEdited"):  # sections an editor has set by hand are not replaced by the model's
            result = {**latest, "sections": sections, "sectionsSource": "model"}  # on top of what is saved now, so a hand edit is kept
            if result.get("edited"):
                catalog.save_result(session_id, result)  # an edited song keeps the stamp of the detector that made it
            else:
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


def _load_cached_result(key: str) -> Optional[dict]:
    try:
        result = catalog.load_result(key)
    except Exception as exc:  # the database is unreachable: treat as a miss rather than failing the visitor's request
        log.warning("Could not read the saved result %s: %s", key, exc)
        return None
    # Results from an older detector (e.g. before the timing-drift fix) are re-analysed.
    return result if result and (result.get("analysisVersion") == ANALYSIS_VERSION or result.get("edited")) else None  # an edited song stays as edited


def _load_saved_result(key: str) -> Optional[dict]:
    """Whatever analysis is saved for a song, even one from an older detector. Opening a song that is already saved should
    never fail just because the detector has improved since: it is shown as it is, and a newer analysis replaces it when
    the song is next chordified from search (or when an admin re-analyses it)."""
    try:
        return catalog.load_result(key)
    except Exception as exc:
        log.warning("Could not read the saved result %s: %s", key, exc)
        return None


def _save_result(key: str, result: dict) -> None:
    try:
        catalog.save_result(key, {**result, "analysisVersion": ANALYSIS_VERSION})
    except Exception as exc:
        # The analysis is still served from memory for now; it just will not be remembered.
        log.error("Could not save the result %s: %s", key, exc)


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
            "beatsPerBar": analysis.get("beatsPerBar", 4),
            "strum": analysis.get("strum"),
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
            "beatsPerBar": analysis.get("beatsPerBar", 4),
            "strum": analysis.get("strum"),
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
_suggest_limiter = RateLimiter(limit=90, window=60.0)  # it runs as people type, so it gets more room than a full search


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
        results = [{**song, **known.get(song["videoId"], {})} for song in songs]
        # Ready-made songs lead (the most jammed first); the rest keep their relevance order (the sort is stable).
        results.sort(key=lambda song: (0, -song["jams"]) if "jams" in song else (1, 0))
        return {"query": query, "results": results}
    except SearchUnavailable as exc:
        log.warning("Song search failed: %s", exc)
        raise HTTPException(status_code=502, detail="Song search is unavailable right now. Please try again in a moment.")


@app.get("/api/suggest")
def suggest_songs(request: Request, q: str = "") -> dict:
    """The toolbar search's suggestions: songs to open straight away (the ones already chordified come first, with their chords
    and jam count) and likely searches."""
    query = clean_query(q)
    if len(query) < 2:
        return {"query": query, "songs": [], "queries": []}
    caller = request.client.host if request.client else "unknown"
    if not _suggest_limiter.allow(caller):
        raise HTTPException(status_code=429, detail="Too many searches. Please wait a moment.")
    try:
        found = suggest(query)
    except SearchUnavailable as exc:
        log.warning("Suggestions failed: %s", exc)
        raise HTTPException(status_code=502, detail="Suggestions are unavailable right now.")
    known = catalog.lookup([song["videoId"] for song in found["songs"]])
    songs = [{**song, **known.get(song["videoId"], {})} for song in found["songs"]]
    songs.sort(key=lambda song: (0, -song["jams"]) if "jams" in song else (1, 0))  # chordified first, the rest as they came
    return {"query": query, "songs": songs, "queries": found["queries"]}


# ---- admin: keep YouTube downloads working (cookies expire; this avoids a redeploy each time) --------------------------
# Switched on by setting ADMIN_TOKEN (a long random string) in the environment; without it these routes answer 404.
_ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
_admin_limiter = RateLimiter(limit=20, window=60.0)


# Admins are people who sign in with a Google account listed in ADMIN_EMAILS (comma-separated). The ADMIN_TOKEN, if set, still
# works as a way in that does not depend on Google (the admin pages have a box for it).
_ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}
_GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
_SESSION_COOKIE = "cs_session"
_login_limiter = RateLimiter(limit=20, window=60.0)


def _session_token(request: Request) -> str:
    """The sign-in a request carries: the browser's cookie, or the mobile app's "Authorization: Bearer <token>"."""
    token = request.cookies.get(_SESSION_COOKIE, "")
    if not token:
        header = request.headers.get("authorization", "")
        if header[:7].lower() == "bearer ":
            token = header[7:].strip()
    return token


def _session_user(request: Request) -> Optional[dict]:
    """The signed-in person behind this request's cookie or bearer token, if any."""
    try:
        return accounts.user_for_session(_session_token(request))
    except Exception as exc:
        log.warning("Could not look up the session: %s", exc)
        return None


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"], "email": user["email"], "name": user["name"], "picture": user["picture"], "plan": user["plan"],
        "role": "admin" if user["email"] in _ADMIN_EMAILS else user.get("role") or "user",
        "isAdmin": _staff_actor_for(user) is not None,  # may open the admin (an administrator, or a role with some permissions)
    }


def _origin_ok(request: Request) -> bool:
    """A request that changes something and comes from a page on another site is not ours (cookies would ride along)."""
    origin = request.headers.get("origin")
    if not origin:
        return True  # not sent by a browser page
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    if urlparse(origin).netloc == host:
        return True
    allowed = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    return origin in allowed or re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin) is not None


class _Actor:
    """Somebody acting in the admin: how they got in, who they are, their role and what that role may do."""

    __slots__ = ("via", "user", "role", "perms", "is_super")

    def __init__(self, via: str, user: Optional[dict], role: str, perms: frozenset, is_super: bool) -> None:
        self.via, self.user, self.role, self.perms, self.is_super = via, user, role, perms, is_super


_ALL_PERMISSIONS = frozenset(roles_module.PERMISSIONS)


def _staff_actor_for(user: dict) -> Optional[_Actor]:
    """The admin access of a signed-in person, or None for somebody who has none. Accounts in ADMIN_EMAILS and the Admin role have
    everything; any other role has what it was given."""
    if user["email"] in _ADMIN_EMAILS or user.get("role") == "admin":
        return _Actor("session", user, "admin", _ALL_PERMISSIONS, True)
    try:
        perms = frozenset(role_store.permissions(user.get("role") or "user"))
    except Exception as exc:
        log.warning("Could not read the permissions of role %s: %s", user.get("role"), exc)
        return None
    return _Actor("session", user, user.get("role") or "user", perms, False) if perms else None


def _actor(request: Request) -> Optional[_Actor]:
    user = _session_user(request)
    if user:
        actor = _staff_actor_for(user)
        if actor:
            return actor
    given = request.headers.get("x-admin-token", "")
    if _ADMIN_TOKEN and hmac.compare_digest(given.encode("utf-8"), _ADMIN_TOKEN.encode("utf-8")):
        return _Actor("token", None, "admin", _ALL_PERMISSIONS, True)
    return None


def _admin_enabled() -> bool:
    if _ADMIN_TOKEN or _ADMIN_EMAILS:
        return True
    try:
        return accounts.has_staff()
    except Exception:
        return False


def _require_perm(request: Request, *needed: str) -> _Actor:
    """Lets a request through when the person is staff and their role has any one of the `needed` permissions (none named: any staff
    member). Administrators pass everything. Answers 404 when there is no admin at all, 401 when nobody is signed in and 403 when the
    role is not allowed."""
    if not _admin_enabled():
        raise HTTPException(status_code=404, detail="Not found")  # the admin is switched off
    actor = _actor(request)
    if actor is None:
        # Only the ones that fail count towards the limit, so guessing the token gets nowhere but an admin at work is never held up.
        caller = request.client.host if request.client else "unknown"
        if not _admin_limiter.allow(caller):
            raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute.")
        if request.headers.get("x-admin-token"):
            raise HTTPException(status_code=401, detail="Wrong admin token")
        raise HTTPException(status_code=401, detail="Sign in to the admin")
    if actor.via == "session" and request.method not in ("GET", "HEAD", "OPTIONS") and not _origin_ok(request):
        raise HTTPException(status_code=403, detail="This request came from another site")
    if needed and not actor.is_super and not any(roles_module.allows(actor.perms, n) for n in needed):
        raise HTTPException(status_code=403, detail="Your role is not allowed to do that.")
    return actor


def _require_admin(request: Request) -> _Actor:
    """Administrators only (the Admin role, ADMIN_EMAILS or the admin token)."""
    actor = _require_perm(request)
    if not actor.is_super:
        raise HTTPException(status_code=403, detail="Only an administrator can do that.")
    return actor


def _is_admin(request: Request) -> bool:
    """True for an administrator (the owner trying things is not held to the visitor limits)."""
    actor = _actor(request)
    return actor is not None and actor.is_super


# ---- sign-in (Google only) ----------------------------------------------------------------------------------------------


class GoogleBody(BaseModel):
    credential: str
    mobile: bool = False  # the apps keep the token themselves instead of a cookie
    ref: str = ""  # an app: the influencer's name it was installed through (from Google Play's install referrer, or typed by the person)


@app.get("/api/auth/config")
def auth_config() -> dict:
    """What the sign-in button needs: the public Google client id (empty until it is set, which turns sign-in off)."""
    return {
        "googleClientId": _GOOGLE_CLIENT_ID, "enabled": bool(_GOOGLE_CLIENT_ID),
        # the reviewer's email and password boxes show in the sign-in window only while REVIEWER_LOGIN is true
        "reviewerLogin": _reviewer_enabled(),
    }


@app.post("/api/auth/google")
def sign_in_with_google(body: GoogleBody, request: Request, response: Response) -> dict:
    """Signs a person in (or up: the first sign-in creates their account) from the ID token Google's button gave the browser."""
    if not _GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Sign-in is not set up yet.")
    caller = request.client.host if request.client else "unknown"
    if not _login_limiter.allow(caller):
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Please wait a minute.")
    try:
        who = accounts_module.verify_google(body.credential, _GOOGLE_CLIENT_ID)
    except SignInError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    user = accounts.sign_in(who["sub"], who["email"], who["name"], who["picture"])
    if user["disabled"]:
        raise HTTPException(status_code=403, detail="This account has been blocked.")
    return _signed_in(user, request, response, body.mobile, body.ref)


def _start_session(user: dict, request: Request, response: Response, days: int = accounts_module.SESSION_DAYS) -> str:
    token = accounts.start_session(user["id"], days)
    response.set_cookie(
        _SESSION_COOKIE, token, max_age=days * 86400,
        httponly=True, samesite="lax", secure=request.url.scheme == "https", path="/",
    )
    return token


def _full_user(user: dict) -> dict:
    """The person as the menus draw them: who they are, the plan they have right now, and where they stand (level, XP, streak).
    Signing in and asking "who am I" give the same answer, so the page looks the same straight after signing in as after a refresh."""
    snap = engagement.snapshot(user["id"])
    plan, _sub = plans.effective(user["id"])
    return {**_public_user(user), "plan": plan["code"], "planName": plan["name"], "instrument": user.get("instrument") or "", "settings": _settings_of(user), "settingsSaved": sorted((user.get("prefs") or {}).keys() & set(SETTINGS_DEFAULT)), "memberSince": user.get("createdAt"), **{k: snap[k] for k in ("level", "title", "ring", "stars", "xp", "intoLevel", "levelSpan", "nextLevelXp", "streak")}}


def _signed_in(user: dict, request: Request, response: Response, mobile: bool, ref: str = "") -> dict:
    """The answer to a sign-in. The website gets a cookie; an app gets the token in the answer, to send back as a bearer token."""
    if mobile:
        if user.get("logins", 0) <= 1:  # their first sign-in: the app says which influencer it came through, if any (an app has no cookie)
            _credit_from_slug(user, ref)
        return {"user": _full_user(user), "token": accounts.start_session(user["id"]), "expiresInDays": accounts_module.SESSION_DAYS}
    _start_session(user, request, response)
    if user.get("logins", 0) <= 1:  # their first sign-in: they came through an influencer's link, if the cookie says so
        _credit_from_cookie(user, request)
    return {"user": _full_user(user)}


# A login for the people who review the site for a payment service, who cannot use Google sign-in. It is on only while
# REVIEWER_LOGIN is true and REVIEWER_EMAIL and REVIEWER_PASSWORD are set (switch it to false when the review is over). It signs in
# one ordinary Free account that is never an admin, and is rate-limited.
_REVIEWER_EMAIL = os.environ.get("REVIEWER_EMAIL", "").strip().lower()
_REVIEWER_PASSWORD = os.environ.get("REVIEWER_PASSWORD", "")
_REVIEWER_SWITCH = os.environ.get("REVIEWER_LOGIN", "").strip().lower() in ("1", "true", "yes", "on")


def _reviewer_enabled() -> bool:
    return _REVIEWER_SWITCH and bool(_REVIEWER_EMAIL and _REVIEWER_PASSWORD) and _REVIEWER_EMAIL not in _ADMIN_EMAILS  # never one that hands out an admin

_reviewer_limiter = RateLimiter(limit=8, window=60.0)


class ReviewerBody(BaseModel):
    email: str
    password: str
    mobile: bool = False
    ref: str = ""


@app.post("/api/auth/reviewer")
def sign_in_as_reviewer(body: ReviewerBody, request: Request, response: Response) -> dict:
    if not _reviewer_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    caller = request.client.host if request.client else "unknown"
    if not _reviewer_limiter.allow(caller):
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait a minute.")
    same_email = hmac.compare_digest(body.email.strip().lower().encode(), _REVIEWER_EMAIL.encode())
    same_password = hmac.compare_digest(body.password.encode(), _REVIEWER_PASSWORD.encode())
    if not (same_email and same_password):  # both are always checked, so the answer does not say which was wrong
        raise HTTPException(status_code=401, detail="That email or password is not right.")
    user = accounts.sign_in("reviewer:" + _REVIEWER_EMAIL, _REVIEWER_EMAIL, "Razorpay reviewer", "")
    if user["disabled"]:
        raise HTTPException(status_code=403, detail="This account has been blocked.")
    return _signed_in(user, request, response, body.mobile, body.ref)


@app.get("/api/auth/me")
def whoami(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    user = _session_user(request)
    if not user:
        return {"user": None}
    return {"user": _full_user(user)}


@app.post("/api/auth/logout")
def sign_out(request: Request, response: Response) -> dict:
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="This request came from another site")
    accounts.end_session(_session_token(request))
    response.delete_cookie(_SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/app/config")
def app_config(response: Response) -> dict:
    """What the mobile apps ask on start: the oldest version still allowed (a lower one is asked to update) and the newest there is."""
    response.headers["Cache-Control"] = "no-store"
    def number(name: str) -> int:
        try:
            return int(os.environ.get(name, "0") or 0)
        except ValueError:
            return 0
    return {
        "android": {"minVersionCode": number("ANDROID_MIN_VERSION_CODE"), "latestVersionCode": number("ANDROID_LATEST_VERSION_CODE")},
        "ios": {"minBuild": number("IOS_MIN_BUILD"), "latestBuild": number("IOS_LATEST_BUILD")},
        "storeUrl": os.environ.get("ANDROID_STORE_URL", "https://play.google.com/store/apps/details?id=com.yantrixlab.chordsuno"),
    }


def _today() -> int:
    """The day number limits are counted in (the same day boundary as the daily streaks)."""
    return int((time.time() + engagement.config()["timezoneOffsetMinutes"] * 60) // 86400)


def _public_price(price: dict) -> dict:
    return {
        "id": price["id"], "period": price["period"], "intervalCount": price["intervalCount"], "amountMinor": price["amountMinor"],
        "compareAtMinor": price["compareAtMinor"], "currency": price["currency"], "ready": bool(price["razorpayPlanId"]),  # ready: it can be paid for
    }


def _subscription_view(sub: Optional[dict]) -> Optional[dict]:
    if not sub:
        return None
    price = plans.get_price(sub["priceId"])
    return {
        "status": sub["status"], "cancelAtPeriodEnd": sub["cancelAtPeriodEnd"], "currentEnd": sub["currentEnd"] or None,
        "priceId": sub["priceId"], "period": price["period"] if price else "", "intervalCount": price["intervalCount"] if price else 1,
        "amountMinor": price["amountMinor"] if price else 0, "currency": price["currency"] if price else "INR",
        "gift": bool(sub.get("manual")),  # given by the team, not paid for: nothing renews and nothing is charged
    }


@app.get("/api/pricing")
def pricing(response: Response) -> dict:
    """The pricing page: every plan on sale with its prices and what it includes. Read live, so the admin's changes show at once."""
    response.headers["Cache-Control"] = "no-cache"
    data = plans.pricing()
    return {
        "plans": [{**plan, "prices": [_public_price(p) for p in plan["prices"]]} for plan in data["plans"]],
        "features": data["features"],
        "checkout": {"enabled": razorpay.configured, "mode": razorpay.mode},
    }


@app.get("/api/me/plan")
def my_plan(request: Request, response: Response) -> dict:
    """The plan this visitor is on and what it includes. Signed-out visitors are on Free, like everybody who has not paid."""
    response.headers["Cache-Control"] = "no-store"
    user = _session_user(request)
    plan, sub = plans.effective(user["id"] if user else None)
    return {
        "signedIn": bool(user),
        "plan": {"id": plan["id"], "code": plan["code"], "name": plan["name"], "isFree": plan["isFree"]},
        "entitlements": plan["entitlements"],
        "subscription": _subscription_view(sub),
    }


class SubscribeBody(BaseModel):
    priceId: str


class VerifyBody(BaseModel):
    paymentId: str
    subscriptionId: str
    signature: str


@app.post("/api/billing/subscribe")
def billing_subscribe(body: SubscribeBody, request: Request) -> dict:
    """Starts paying for a plan: makes a Razorpay subscription for this person, and gives the browser what it needs to open checkout."""
    user = _require_user(request, changes=True)
    if not razorpay.configured:
        raise HTTPException(status_code=503, detail="Payments are not switched on yet.")
    price = plans.get_price(body.priceId)
    plan = plans.get_plan(price["planId"]) if price else None
    if not price or not plan or not plan["active"] or not price["active"] or plan["isFree"]:
        raise HTTPException(status_code=404, detail="That plan is not on sale.")
    if not price["razorpayPlanId"]:
        raise HTTPException(status_code=503, detail="This plan is not ready to be paid for yet.")
    current, _sub = plans.effective(user["id"])
    if not current["isFree"]:
        raise HTTPException(status_code=409, detail=f"You are already on {current['name']}. Cancel it first if you want to change plans.")
    _credit_from_cookie(user, request)  # somebody who signed in before the link was opened is credited when they first pay
    try:
        made = razorpay.create_subscription(plan_id=price["razorpayPlanId"], period=price["period"], notes={"user_id": user["id"], "price_id": price["id"], "plan": plan["code"]})
    except RazorpayError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    plans.create_subscription(user["id"], plan["id"], price["id"], made["id"], made.get("status", "created"))
    return {
        "subscriptionId": made["id"], "keyId": razorpay.key_id, "name": "Chord Suno", "description": f"{plan['name']} plan",
        "prefill": {"name": user["name"], "email": user["email"]},
    }


@app.post("/api/billing/verify")
def billing_verify(body: VerifyBody, request: Request) -> dict:
    """After checkout: the browser sends what Razorpay gave it; the signature proves the payment is real."""
    user = _require_user(request, changes=True)
    if not razorpay.verify_payment(body.paymentId, body.subscriptionId, body.signature):
        raise HTTPException(status_code=400, detail="We could not confirm that payment.")
    mine = plans.subscription_by_razorpay(body.subscriptionId)
    if not mine or mine["userId"] != user["id"]:
        raise HTTPException(status_code=404, detail="We do not know that subscription.")
    try:
        entity = entity_summary(razorpay.fetch_subscription(body.subscriptionId))
    except RazorpayError:  # Razorpay answered the signature check, so the payment is real: treat it as started, the webhook will correct us
        entity = {"id": body.subscriptionId, "status": "active", "current_start": 0, "current_end": 0, "paid_count": 1, "notes": {}}
    plans.apply_razorpay({**entity, "status": entity["status"] if entity["status"] in ("active", "authenticated", "pending") else "active"})
    try:  # the first payment goes in the books now; the webhook says the same later, and a payment is only ever counted once
        paid = razorpay.fetch_payment(body.paymentId)
        if paid.get("status") == "captured":
            partners.record_payment(paid["id"], body.subscriptionId, int(paid.get("amount") or 0), str(paid.get("currency") or "INR"), float(paid.get("created_at") or time.time()))
    except Exception as exc:
        log.warning("Could not record a payment after checkout: %s", exc)
    plan, sub = plans.effective(user["id"])
    return {"plan": {"code": plan["code"], "name": plan["name"]}, "subscription": _subscription_view(sub)}


@app.delete("/api/me")
def delete_my_account(request: Request, response: Response) -> dict:
    """Deletes the signed-in person's account and what hangs on it: their sign-ins, library, favourites, XP and badges, ratings and
    comments, daily counts, and the audio they uploaded (when nobody else has it). A subscription is cancelled on the spot. The records
    of payments stay without a name or email on them, as accounting rules require."""
    user = _require_user(request, changes=True)
    if user["email"] in _ADMIN_EMAILS:
        raise HTTPException(status_code=400, detail="An administrator's account is removed by taking it off the admin list first.")
    if (user.get("role") or "user") != "user":
        raise HTTPException(status_code=400, detail="A staff account is removed by an administrator, who first changes it to a general user.")
    for sub in plans.live_paid(user["id"]):  # a plan the team gave costs nothing and has nothing to cancel
        try:
            razorpay.cancel_subscription(sub["razorpaySubscriptionId"], at_cycle_end=False)
            plans.mark_cancelling(sub["razorpaySubscriptionId"])
        except RazorpayError as exc:
            log.warning("Could not cancel the subscription of a deleted account: %s", exc)
            raise HTTPException(status_code=502, detail="We could not cancel your subscription just now, so the account was not deleted. Please try again, or write to us.")
    uploads = engagement.delete_user(user["id"])
    catalog.delete_ratings_of(f"u:{user['id']}")
    plans.delete_usage(user["id"])
    for session_id in uploads:
        if _SAFE_KEY.match(session_id):
            for path in glob.glob(os.path.join(UPLOAD_DIR, f"{session_id}.*")):
                _remove(path)
            catalog.delete_result(session_id)
    accounts.delete_user(user["id"])
    response.delete_cookie(_SESSION_COOKIE, path="/")
    log.info("Account %s deleted at the person's request", user["id"])
    return {"deleted": True}


@app.post("/api/billing/cancel")
def billing_cancel(request: Request) -> dict:
    """Stops renewals. A person keeps the plan until the end of the period they have paid for."""
    user = _require_user(request, changes=True)
    paid = plans.live_paid(user["id"])  # what the person pays for, even while the team has given them a plan on top
    sub = paid[0] if paid else None
    if not sub:
        raise HTTPException(status_code=404, detail="You do not have a subscription to cancel.")
    if sub["cancelAtPeriodEnd"]:
        return {"subscription": _subscription_view(sub)}
    try:
        razorpay.cancel_subscription(sub["razorpaySubscriptionId"], at_cycle_end=True)
    except RazorpayError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    plans.mark_cancelling(sub["razorpaySubscriptionId"])
    return {"subscription": _subscription_view(plans.effective(user["id"])[1])}


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request) -> dict:
    """Razorpay's own messages (a renewal, a failed payment, a cancellation). Only calls signed with the webhook secret are believed."""
    raw = await request.body()
    if not razorpay.verify_webhook(raw, request.headers.get("x-razorpay-signature", "")):
        raise HTTPException(status_code=401, detail="Bad signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Not JSON")
    name = str(event.get("event", ""))
    entity = (((event.get("payload") or {}).get("subscription") or {}).get("entity")) if name.startswith("subscription.") else None
    if isinstance(entity, dict) and entity.get("id"):
        plans.apply_razorpay({**entity, "status": entity.get("status", "")})
        log.info("Razorpay %s for subscription %s", name, entity.get("id"))
    try:
        payload = event.get("payload") or {}
        if name == "subscription.charged":  # a payment was taken (the first one or a renewal): into the books
            paid = ((payload.get("payment") or {}).get("entity")) or {}
            if paid.get("id") and entity and entity.get("id"):
                partners.record_payment(paid["id"], entity["id"], int(paid.get("amount") or 0), str(paid.get("currency") or "INR"), float(paid.get("created_at") or time.time()))
        elif name.startswith("refund."):  # money was given back
            refund = ((payload.get("refund") or {}).get("entity")) or {}
            if refund.get("id") and refund.get("payment_id") and (name == "refund.processed" or refund.get("status") == "processed"):
                partners.record_refund(refund["id"], refund["payment_id"], int(refund.get("amount") or 0), float(refund.get("created_at") or time.time()))
    except Exception as exc:
        log.warning("Could not record %s: %s", name, exc)
    return {"ok": True}


# ---- influencers: their links, who came through them, what was paid ---------------------------------------------------------
_PARTNER_COOKIE = "cs_ref"  # the slug of the partner whose link was opened first (60 days)
_VISITOR_COOKIE = "cs_vid"  # a random id for this browser, to count unique visitors
_SITE_URL = os.environ.get("SITE_URL", "https://chordsuno.com").rstrip("/")
_click_limiter = RateLimiter(limit=120, window=60.0)
_BOT_RE = re.compile(r"bot|crawl|spider|preview|slurp|headless|monitor|externalhit|externalagent|curl|wget|python-requests|go-http", re.I)


def _remember_partner(request: Request, response: Response, partner: dict, landing: str, source: str) -> None:
    """Counts a click on a partner's link (not from a robot, which only reads the page for a preview) and remembers the partner in a cookie.
    The first link a person opened keeps the cookie: another one counts as a click but does not take the credit."""
    secure = request.url.scheme == "https"
    visitor = request.cookies.get(_VISITOR_COOKIE, "") or uuid.uuid4().hex[:20]
    response.set_cookie(_VISITOR_COOKIE, visitor, max_age=365 * 86400, httponly=True, samesite="lax", secure=secure, path="/")
    caller = request.client.host if request.client else "unknown"
    if request.method != "HEAD" and not _BOT_RE.search(request.headers.get("user-agent", "")) and _click_limiter.allow(caller):
        partners.record_click(partner["id"], visitor, landing, source)
    held = partners.by_slug(request.cookies.get(_PARTNER_COOKIE, "")) if request.cookies.get(_PARTNER_COOKIE) else None
    if not held or not held["active"]:
        response.set_cookie(_PARTNER_COOKIE, partner["slug"], max_age=partners_module.COOKIE_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")


def _credit_from_cookie(user: dict, request: Request) -> None:
    """Credits a person to the partner whose link they opened, if they have no partner yet. Never breaks a sign-in or a payment."""
    try:
        slug = request.cookies.get(_PARTNER_COOKIE, "")
        partner = partners.by_slug(slug) if slug else None
        if partner and partner["active"]:
            partners.credit_user(user["id"], partner["id"])
    except Exception as exc:
        log.warning("Could not credit a partner: %s", exc)


def _credit_from_slug(user: dict, slug: str) -> None:
    """Credits a person to the partner an app named (the code it was installed through), if they have no partner yet. Never breaks a sign-in."""
    try:
        slug = (slug or "").strip().lower()
        partner = partners.by_slug(slug) if partners_module.SLUG_RE.match(slug) else None
        if partner and partner["active"]:
            partners.credit_user(user["id"], partner["id"])
    except Exception as exc:
        log.warning("Could not credit a partner: %s", exc)


_PLAY_STORE_URL = os.environ.get("PLAY_STORE_URL", "https://play.google.com/store/apps/details?id=com.yantrixlab.chordsuno").strip()


@app.get("/r/{slug}/app")
def partner_app_link(slug: str, request: Request) -> RedirectResponse:
    """An influencer's link for the app, chordsuno.com/r/<slug>/app: on an Android phone it opens the app's page on Google Play with the
    influencer's name attached (the app reads it after install and sends it with the first sign-in); anywhere else it is the site's own link."""
    partner = partners.by_slug(slug) if partners_module.SLUG_RE.match(slug.strip().lower()) else None
    if not partner or not partner["active"]:
        return RedirectResponse("/", status_code=302)
    if "android" not in request.headers.get("user-agent", "").lower():
        return partner_link(slug, request)  # a computer or an iPhone: the website, counted like the ordinary link
    response = RedirectResponse(f"{_PLAY_STORE_URL}&referrer={quote('ref=' + partner['slug'], safe='')}", status_code=302)
    response.headers["Cache-Control"] = "no-store"
    try:
        _remember_partner(request, response, partner, "play", "app-link")
    except Exception as exc:
        log.warning("Could not count a partner click: %s", exc)
    return response


class AppRefBody(BaseModel):
    slug: str
    visitor: str = ""
    source: str = "install"  # "install" (Google Play's referrer) or "code" (typed by the person)


@app.post("/api/ref/app")
def partner_app_open(body: AppRefBody, request: Request) -> dict:
    """An app that was installed through an influencer's link tells us once, on its first start, so the installs are counted (the app has no
    cookie, so nothing else would count them). The same answer for any name."""
    slug = body.slug.strip().lower()
    partner = partners.by_slug(slug) if partners_module.SLUG_RE.match(slug) else None
    caller = request.client.host if request.client else "unknown"
    visitor = re.sub(r"[^A-Za-z0-9_-]", "", body.visitor)[:40]
    if partner and partner["active"] and visitor and not _BOT_RE.search(request.headers.get("user-agent", "")) and _click_limiter.allow(caller):
        try:
            partners.record_click(partner["id"], visitor, "app", "app-" + (body.source if body.source in ("install", "code") else "install"))
        except Exception as exc:
            log.warning("Could not count an app install: %s", exc)
    return {"ok": True}


@app.get("/r/{slug}")
def partner_link(slug: str, request: Request) -> RedirectResponse:
    """An influencer's link, chordsuno.com/r/<slug>: counts the click, remembers who sent the visitor, and opens the site."""
    partner = partners.by_slug(slug) if partners_module.SLUG_RE.match(slug.strip().lower()) else None
    if not partner or not partner["active"]:
        return RedirectResponse("/", status_code=302)
    landing = partner["landingPath"]
    response = RedirectResponse(landing, status_code=302)  # a clean address: who sent the visitor is in the cookie, not in the URL
    response.headers["Cache-Control"] = "no-store"
    try:
        _remember_partner(request, response, partner, landing, "link")
    except Exception as exc:
        log.warning("Could not count a partner click: %s", exc)
    return response


class RefBody(BaseModel):
    slug: str
    landing: str = ""


@app.post("/api/ref/click")
def partner_ref_click(body: RefBody, request: Request, response: Response) -> dict:
    """The same as opening the link, for a page that was opened with ?ref=<slug> (a link to a particular page, or a link in a video's text)."""
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="This request came from another site")
    slug = body.slug.strip().lower()
    partner = partners.by_slug(slug) if partners_module.SLUG_RE.match(slug) else None
    if partner and partner["active"]:
        try:
            _remember_partner(request, response, partner, body.landing[:200], "param")
        except Exception as exc:
            log.warning("Could not count a partner click: %s", exc)
    return {"ok": True}  # the same answer for any name: this is not a way to find out who the partners are


class PartnerBody(BaseModel):
    slug: str
    name: str
    handle: str = ""
    email: str = ""
    notes: str = ""
    landingPath: str = "/"
    commissionPct: float = 0
    commissionMonths: int = 0
    feeMinor: int = 0
    active: bool = True

    def fields(self) -> dict:
        return {
            "slug": self.slug, "name": self.name, "handle": self.handle, "email": self.email, "notes": self.notes, "landing_path": self.landingPath,
            "commission_pct": self.commissionPct, "commission_months": self.commissionMonths, "fee_minor": self.feeMinor, "active": self.active,
        }


class PayoutBody(BaseModel):
    amountMinor: int
    note: str = ""
    paidAt: float = 0


def _tz_minutes() -> int:
    try:
        return int(engagement.config()["timezoneOffsetMinutes"])
    except Exception:
        return 330


@app.get("/api/admin/partners")
def admin_partners(request: Request) -> dict:
    _require_perm(request, "partners.view")
    return {**partners.overview(), "siteUrl": _SITE_URL, "cookieDays": partners_module.COOKIE_DAYS}


@app.post("/api/admin/partners")
def admin_add_partner(body: PartnerBody, request: Request) -> dict:
    _require_perm(request, "partners.manage")
    try:
        return {"partner": partners.save(body.fields())}
    except PartnerError as exc:
        raise _fail(exc)


@app.put("/api/admin/partners/{partner_id}")
def admin_update_partner(partner_id: str, body: PartnerBody, request: Request) -> dict:
    _require_perm(request, "partners.manage")
    try:
        return {"partner": partners.save(body.fields(), partner_id)}
    except PartnerError as exc:
        raise _fail(exc)


@app.delete("/api/admin/partners/{partner_id}")
def admin_delete_partner(partner_id: str, request: Request) -> dict:
    _require_perm(request, "partners.manage")
    try:
        partners.delete(partner_id)
    except PartnerError as exc:
        raise _fail(exc)
    return {"ok": True}


@app.get("/api/admin/partners/{partner_id}")
def admin_partner_detail(partner_id: str, request: Request, days: int = 30) -> dict:
    _require_perm(request, "partners.view")
    detail = partners.detail(partner_id, days=max(7, min(days, 120)), tz_minutes=_tz_minutes())
    if not detail:
        raise HTTPException(status_code=404, detail="That influencer does not exist.")
    return {**detail, "siteUrl": _SITE_URL}


@app.post("/api/admin/partners/{partner_id}/payouts")
def admin_add_payout(partner_id: str, body: PayoutBody, request: Request) -> dict:
    _require_perm(request, "partners.manage")
    try:
        return {"payout": partners.add_payout(partner_id, body.amountMinor, body.note, body.paidAt)}
    except PartnerError as exc:
        raise _fail(exc)


@app.delete("/api/admin/partners/{partner_id}/payouts/{payout_id}")
def admin_delete_payout(partner_id: str, payout_id: str, request: Request) -> dict:
    _require_perm(request, "partners.manage")
    if not partners.delete_payout(partner_id, payout_id):
        raise HTTPException(status_code=404, detail="That payout does not exist.")
    return {"ok": True}



# ---- admin: who is here, people, plans ------------------------------------------------------------------------------------


class PlanBody(BaseModel):
    code: str
    name: str
    description: str = ""
    badge: str = ""
    cta: str = ""
    featured: bool = False
    active: bool = True
    sortOrder: int = 0

    def fields(self) -> dict:
        return {
            "code": self.code, "name": self.name, "description": self.description, "badge": self.badge, "cta": self.cta,
            "featured": self.featured, "active": self.active, "sort_order": self.sortOrder,
        }


class PriceBody(BaseModel):
    period: str = "monthly"
    intervalCount: int = 1
    amountMinor: int
    compareAtMinor: int = 0
    currency: str = "INR"
    razorpayPlanId: str = ""
    active: bool = True

    def fields(self) -> dict:
        return {
            "period": self.period, "interval_count": self.intervalCount, "amount_minor": self.amountMinor,
            "compare_at_minor": self.compareAtMinor, "currency": self.currency,
            "razorpay_plan_id": self.razorpayPlanId, "active": self.active,
        }


class FeatureBody(BaseModel):
    key: str = ""
    label: str
    description: str = ""
    kind: str = "flag"
    unit: str = ""
    group: str = "General"
    status: str = "live"
    sortOrder: int = 0

    def fields(self) -> dict:
        return {
            "key": self.key, "label": self.label, "description": self.description, "kind": self.kind, "unit": self.unit,
            "group": self.group, "status": self.status, "sort_order": self.sortOrder,
        }


class CellBody(BaseModel):
    enabled: bool
    value: Optional[int] = None


class DisabledBody(BaseModel):
    disabled: bool


@app.get("/api/admin/me")
def admin_me(request: Request) -> dict:
    """Who is in the admin and what they may do (the pages show only what their role allows; the server checks every request again)."""
    actor = _require_perm(request)
    role = role_store.get(actor.role)
    return {
        "admin": True,
        "via": actor.via,
        "user": _public_user(actor.user) if actor.user else None,
        "role": actor.role,
        "roleName": role["name"] if role else actor.role,
        "isSuper": actor.is_super,
        "permissions": [p for p in roles_module.PERMISSIONS if actor.is_super or roles_module.allows(actor.perms, p)],
        "hasPassword": bool(actor.user and actor.user.get("hasPassword")),
    }


@app.get("/api/admin/overview")
def admin_overview(request: Request) -> dict:
    _require_perm(request, "overview.view")
    accounts_now = youtube.list_accounts()
    return {
        "users": accounts.count_users(),
        "catalog": catalog.summary(),
        "queue": job_queue.stats(),
        "youtube": {
            "accounts": len(accounts_now),
            "ready": sum(1 for a in accounts_now if a["status"] == "ready"),
            "recentFailures": len(youtube.recent_failures),
        },
        "plans": {"active": len(plans.list_plans(only_active=True)), "total": len(plans.list_plans())},
        "revenue": plans.revenue(),
        "payments": razorpay.status(),
        "signIn": {
            "configured": bool(_GOOGLE_CLIENT_ID), "admins": len(_ADMIN_EMAILS),
            "reviewer": _reviewer_enabled(),
        },
        # Why songs get (or do not get) the trained structure model's sections (intro, instrumental, outro).
        "sectionModel": section_model_status(),
        # How fresh the trending shelves are, and why a refresh failed, if it did.
        "trending": trending_shelves.status(),
    }


@app.get("/api/admin/users")
def admin_users(request: Request, search: str = "", page: int = 1, pageSize: int = 25, role: str = "") -> dict:
    actor = _require_perm(request, "users.view")
    size = min(max(pageSize, 1), 100)
    page = max(page, 1)
    users, total = accounts.list_users(search=search[:100], limit=size, offset=(page - 1) * size, role=role[:32])
    xps = engagement.xp_of([u["id"] for u in users])
    levels = engagement.levels_of(xps)
    names = {r["key"]: r["name"] for r in role_store.list()}
    current = plans.effective_many([u["id"] for u in users])
    out = []
    for u in users:
        env_admin = u["email"] in _ADMIN_EMAILS
        shown = "admin" if env_admin else u["role"]
        plan, sub = current[u["id"]]
        out.append({
            **u, "role": shown, "roleName": names.get(shown, shown), "isEnvAdmin": env_admin, "isAdmin": shown == "admin",
            "xp": xps.get(u["id"], 0), "level": levels.get(u["id"], 1),
            "canManage": _may_manage(actor, u),
            # the plan they have right now (not the code saved on the account, which lags when a plan runs out)
            "plan": plan["code"], "planName": plan["name"], "planIsFree": plan["isFree"],
            "planSource": "free" if not sub else "gift" if sub["manual"] else "paid",
            "planEnd": (sub["currentEnd"] or None) if sub else None,
            "planRenewalOff": bool(sub and sub["cancelAtPeriodEnd"] and not sub["manual"]),
        })
    return {"users": out, "total": total, "page": page, "pageSize": size, "canGivePlans": actor.is_super or roles_module.allows(actor.perms, "users.plans")}


# ---- giving, renewing and ending a person's plan -------------------------------------------------------------------------
#
# A plan the team gives is a subscription row that nobody pays for and nothing renews (plans.py "manual_"): the website, the app and the
# limits read it like any other, it wins over what the person pays for while it runs, and the paid plan is there again when it ends.
# Plans are not privileges, so any person may be given one (an administrator too); the permission is what matters.


class UserPlanBody(BaseModel):
    action: str  # give | extend | end | stop_renewal
    planId: str = ""
    unit: str = ""  # days | months | years | lifetime | until
    amount: int = 0
    until: float = 0  # unit "until": the moment the plan ends, in seconds


_UNIT_LIMITS = {"days": 3650, "months": 120, "years": 10}


def _plan_end(body: UserPlanBody, start: float) -> float:
    """When a plan given for this length ends (0: no end date)."""
    if body.unit == "lifetime":
        return 0.0
    if body.unit == "until":
        if not body.until or body.until < time.time() + 60:
            raise HTTPException(status_code=400, detail="Pick an end date in the future.")
        if body.until > time.time() + 50 * 365 * 86400:
            raise HTTPException(status_code=400, detail="Pick an end date within 50 years, or choose no end date.")
        return float(body.until)
    limit = _UNIT_LIMITS.get(body.unit)
    if not limit:
        raise HTTPException(status_code=400, detail="Choose how long: days, months, years, until a date, or no end date.")
    if not 1 <= body.amount <= limit:
        raise HTTPException(status_code=400, detail=f"Choose between 1 and {limit} {body.unit}.")
    return plans_module.add_period(start, body.unit, body.amount)


def _plan_state(target: dict) -> dict:
    """What the plan dialog shows: the plan a person has, where it comes from, what they pay for, and their history."""
    uid = target["id"]
    plan, sub = plans.effective(uid)
    gift = plans.live_manual(uid)
    paid = plans.live_paid(uid)
    names = {p["id"]: p["name"] for p in plans.list_plans()}

    def short(s: Optional[dict]) -> Optional[dict]:
        return {"planId": s["planId"], "planName": names.get(s["planId"], ""), "end": s["currentEnd"] or None, "renewalOff": s["cancelAtPeriodEnd"], "status": s["status"]} if s else None

    return {
        "user": {"id": uid, "email": target["email"], "name": target["name"]},
        "current": {"planId": plan["id"], "planName": plan["name"], "isFree": plan["isFree"], "source": "free" if not sub else "gift" if sub["manual"] else "paid", "end": (sub["currentEnd"] or None) if sub else None},
        "gift": short(gift),
        "paid": short(paid[0] if paid else None),
        "plans": [{"id": p["id"], "name": p["name"], "active": p["active"]} for p in plans.list_plans() if not p["isFree"]],
        "history": plans.history(uid),
    }


@app.get("/api/admin/users/{user_id}/plan")
def admin_user_plan(user_id: str, request: Request) -> dict:
    _require_perm(request, "users.plans")
    target = accounts.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="No such user")
    return _plan_state(target)


@app.post("/api/admin/users/{user_id}/plan")
def admin_user_plan_change(user_id: str, body: UserPlanBody, request: Request) -> dict:
    actor = _require_perm(request, "users.plans")
    target = accounts.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="No such user")
    now = time.time()
    if body.action == "give":
        plan = plans.get_plan(body.planId)
        if not plan or plan["isFree"]:
            raise HTTPException(status_code=400, detail="Choose one of the paid plans.")
        end = _plan_end(body, now)
        plans.give_plan(user_id, plan["id"], end)
        _audit(actor, f"gave {target['email']} the {plan['name']} plan {'with no end date' if not end else 'until ' + time.strftime('%Y-%m-%d', time.gmtime(end))}")
    elif body.action == "extend":
        live = plans.live_manual(user_id)
        if not live:
            raise HTTPException(status_code=400, detail="They have no plan from the team running now. Give them a plan instead.")
        if not live["currentEnd"] and body.unit != "lifetime":
            raise HTTPException(status_code=400, detail="That plan has no end date, so there is nothing to extend.")
        end = _plan_end(body, live["currentEnd"] or now)
        if end and end <= (live["currentEnd"] or 0):
            raise HTTPException(status_code=400, detail="That date is not later than the plan's current end. To shorten a plan, end it and give it again.")
        plans.extend_manual(live, end)
        _audit(actor, f"extended {target['email']}'s plan {'to no end date' if not end else 'to ' + time.strftime('%Y-%m-%d', time.gmtime(end))}")
    elif body.action == "end":
        if not plans.end_manual(user_id):
            raise HTTPException(status_code=400, detail="They have no plan from the team running now.")
        _audit(actor, f"ended the plan the team gave {target['email']}")
    elif body.action == "stop_renewal":
        paid = [s for s in plans.live_paid(user_id) if not s["cancelAtPeriodEnd"]]
        if not paid:
            raise HTTPException(status_code=400, detail="They do not have a paid plan that is renewing.")
        try:
            razorpay.cancel_subscription(paid[0]["razorpaySubscriptionId"], at_cycle_end=True)
        except RazorpayError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        plans.mark_cancelling(paid[0]["razorpaySubscriptionId"])
        _audit(actor, f"stopped the renewal of {target['email']}'s paid plan")
    else:
        raise HTTPException(status_code=400, detail="Unknown action.")
    return _plan_state(target)


@app.post("/api/admin/users/{user_id}/disabled")
def admin_block_user(user_id: str, body: DisabledBody, request: Request) -> dict:
    actor = _require_perm(request, "users.block")
    target = accounts.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="No such user")
    if body.disabled:
        if actor.user and actor.user["id"] == user_id:
            raise HTTPException(status_code=400, detail="You cannot block yourself.")
        _guard_target(actor, target)
        if target["role"] == "admin":
            _ensure_admin_left(user_id)
    accounts.set_disabled(user_id, body.disabled)
    _audit(actor, f"{'blocked' if body.disabled else 'unblocked'} {target['email']}")
    return {"ok": True}


# ---- roles, staff accounts and passwords ---------------------------------------------------------------------------------
#
# The rules that keep this safe, whatever a role's permissions are:
#   - nobody can give a role (or a person) more than they have themselves, and nobody but an administrator can touch an administrator;
#   - nobody changes their own role or blocks themselves;
#   - the site always keeps an administrator (ADMIN_EMAILS and the admin token count);
#   - only staff (a role with permissions) can sign in to the admin with a password; general users sign in with Google only.

_staff_ip_limiter = RateLimiter(limit=10, window=60.0)
_staff_fails: dict[str, list[float]] = {}
_STAFF_MAX_FAILS = 5
_STAFF_LOCK_SECONDS = 15 * 60


def _audit(actor: _Actor, what: str) -> None:
    """One line in the server log for every change to people, roles and passwords: who, how and what."""
    who = actor.user["email"] if actor.user else "the admin token"
    log.info("admin audit: %s (%s) %s", who, actor.role, what)


def _role_perms(key: str) -> set[str]:
    role = role_store.get(key)
    return set(role["permissions"]) if role else set()


def _may_manage(actor: _Actor, target: dict) -> bool:
    """Whether this actor may change (the role, password or block state of) this person."""
    if target["email"] in _ADMIN_EMAILS:
        return False  # set in the server's environment
    if actor.user and actor.user["id"] == target["id"]:
        return False
    if actor.is_super:
        return True
    return target["role"] != "admin" and roles_module.covers(actor.perms, _role_perms(target["role"]))


def _guard_target(actor: _Actor, target: dict) -> None:
    if target["email"] in _ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="That account is an administrator set in the server's settings (ADMIN_EMAILS); it cannot be changed here.")
    if not _may_manage(actor, target) and not (actor.user and actor.user["id"] == target["id"]):
        raise HTTPException(status_code=403, detail="That person can do more than you can, so you cannot change them.")


def _ensure_admin_left(excluding_user_id: str) -> None:
    left = len(_ADMIN_EMAILS) + (1 if _ADMIN_TOKEN else 0) + accounts.count_role("admin", excluding_user_id)
    if left < 1:
        raise HTTPException(status_code=400, detail="That would leave the site without an administrator.")


def _grantable_role(actor: _Actor, key: str) -> dict:
    """The role to give somebody, or an error when it does not exist or has more power than the actor."""
    role = role_store.get(key)
    if not role:
        raise HTTPException(status_code=400, detail="There is no such role.")
    if key == "admin" and not actor.is_super:
        raise HTTPException(status_code=403, detail="Only an administrator can make somebody an administrator.")
    if not actor.is_super and not roles_module.covers(actor.perms, role["permissions"]):
        raise HTTPException(status_code=403, detail="That role can do more than your own role can, so you cannot give it.")
    return role


def _role_problem(exc: RoleError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


class StaffLoginBody(BaseModel):
    email: str
    password: str


class NewAccountBody(BaseModel):
    email: str
    name: str = ""
    password: str
    role: str


class RoleChangeBody(BaseModel):
    role: str


class PasswordBody(BaseModel):
    password: str


class OwnPasswordBody(BaseModel):
    current: str
    new: str


class RoleBody(BaseModel):
    name: str
    description: str = ""
    permissions: list[str] = []


class RoleEditBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[list[str]] = None


@app.post("/api/admin/auth/login")
def admin_password_login(body: StaffLoginBody, request: Request, response: Response) -> dict:
    """The admin's own sign-in, with an email and a password. Only staff accounts get in; the answer never says whether the email exists,
    five wrong passwords lock that email for 15 minutes, and every attempt counts against the caller's address."""
    if not _admin_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="This request came from another site")
    caller = request.client.host if request.client else "unknown"
    if not _staff_ip_limiter.allow(caller):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute.")
    email = body.email.strip().lower()[:200]
    now = time.time()
    fails = [t for t in _staff_fails.get(email, []) if now - t < _STAFF_LOCK_SECONDS]
    if len(fails) >= _STAFF_MAX_FAILS:
        raise HTTPException(status_code=429, detail="Too many wrong attempts for this account. Try again in 15 minutes.")
    row = accounts.password_row(email) if email else None
    right = roles_module.verify_password(body.password[:400], row["password_hash"] if row else "")  # takes the same time either way
    user = accounts.get_user(row["id"]) if row and right else None
    actor = _staff_actor_for(user) if user and not user["disabled"] else None
    if actor is None:
        _staff_fails[email] = fails + [now]
        if len(_staff_fails) > 5000:
            _staff_fails.clear()
        raise HTTPException(status_code=401, detail="That email or password is not right.")
    _staff_fails.pop(email, None)
    accounts.touch_login(user["id"])
    _start_session(user, request, response, accounts_module.STAFF_SESSION_DAYS)
    log.info("admin audit: %s signed in to the admin with a password", email)
    return {"ok": True}


@app.get("/api/admin/permissions")
def admin_permissions(request: Request) -> dict:
    _require_perm(request)
    return {"groups": roles_module.catalog(), "all": roles_module.PERMISSIONS}


@app.get("/api/admin/roles")
def admin_roles(request: Request) -> dict:
    actor = _require_perm(request, "roles.manage", "users.roles", "users.create", "users.view")
    counts = accounts.role_counts()
    out = []
    for role in role_store.list():
        out.append({
            **role,
            "users": counts.get(role["key"], 0),
            # may this actor give the role to somebody, and may they edit it
            "grantable": True if actor.is_super else (role["key"] != "admin" and roles_module.covers(actor.perms, role["permissions"])),
            "editable": (not role["locked"]) and (actor.is_super or roles_module.covers(actor.perms, role["permissions"])),
        })
    return {"roles": out, "envAdmins": len(_ADMIN_EMAILS), "canManage": actor.is_super or roles_module.allows(actor.perms, "roles.manage")}


@app.post("/api/admin/roles")
def admin_create_role(body: RoleBody, request: Request) -> dict:
    actor = _require_perm(request, "roles.manage")
    wanted = roles_module.clean(body.permissions)
    if not actor.is_super and not roles_module.covers(actor.perms, wanted):
        raise HTTPException(status_code=403, detail="A role cannot have permissions that you do not have yourself.")
    try:
        role = role_store.create(body.name, body.description, wanted)
    except RoleError as exc:
        raise _role_problem(exc) from exc
    _audit(actor, f"created the role {role['key']} with {len(role['permissions'])} permissions")
    return {"role": role}


@app.put("/api/admin/roles/{key}")
def admin_update_role(key: str, body: RoleEditBody, request: Request) -> dict:
    actor = _require_perm(request, "roles.manage")
    current = role_store.get(key)
    if not current:
        raise HTTPException(status_code=404, detail="No such role.")
    if not actor.is_super:
        if not roles_module.covers(actor.perms, current["permissions"]):
            raise HTTPException(status_code=403, detail="That role can do more than your own role can, so you cannot change it.")
        if body.permissions is not None and not roles_module.covers(actor.perms, roles_module.clean(body.permissions)):
            raise HTTPException(status_code=403, detail="A role cannot have permissions that you do not have yourself.")
    try:
        role = role_store.update(key, body.name, body.description, body.permissions)
    except RoleError as exc:
        raise _role_problem(exc) from exc
    _audit(actor, f"changed the role {key}: now {len(role['permissions'])} permissions")
    return {"role": role}


@app.delete("/api/admin/roles/{key}")
def admin_delete_role(key: str, request: Request) -> dict:
    actor = _require_perm(request, "roles.manage")
    current = role_store.get(key)
    if not current:
        raise HTTPException(status_code=404, detail="No such role.")
    if not actor.is_super and not roles_module.covers(actor.perms, current["permissions"]):
        raise HTTPException(status_code=403, detail="That role can do more than your own role can, so you cannot delete it.")
    try:
        role_store.delete(key)
    except RoleError as exc:
        raise _role_problem(exc) from exc
    moved = accounts.move_role(key, "user")  # whoever had it becomes a general user, with no admin access
    _audit(actor, f"deleted the role {key}; {moved} people became general users")
    return {"deleted": key, "movedToUser": moved}


@app.post("/api/admin/users")
def admin_create_account(body: NewAccountBody, request: Request) -> dict:
    """A staff account with an email and a password (it can sign in to the admin with them; if its owner later signs in with Google using
    the same email, the two are linked and the role stays)."""
    actor = _require_perm(request, "users.create")
    email = body.email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) or len(email) > 200:
        raise HTTPException(status_code=400, detail="That is not an email address.")
    problem = roles_module.check_password_rules(body.password, email)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if body.role == "user":
        raise HTTPException(status_code=400, detail="Choose a staff role. General users sign in with Google, so they need no password.")
    role = _grantable_role(actor, body.role)
    if not role["permissions"] and role["key"] != "admin":
        raise HTTPException(status_code=400, detail="That role has no permissions yet, so the account could not do anything. Give the role some first.")
    if accounts.email_taken(email):
        raise HTTPException(status_code=409, detail="Somebody with that email already has an account. Change their role instead, then set a password.")
    user = accounts.create_staff(email, body.name or email.split("@")[0], roles_module.hash_password(body.password), role["key"])
    _audit(actor, f"created the {role['key']} account {email}")
    return {"user": {**user, "roleName": role["name"]}}


@app.put("/api/admin/users/{user_id}/role")
def admin_set_role(user_id: str, body: RoleChangeBody, request: Request) -> dict:
    actor = _require_perm(request, "users.roles")
    target = accounts.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="No such user")
    if actor.user and actor.user["id"] == user_id:
        raise HTTPException(status_code=400, detail="You cannot change your own role.")
    _guard_target(actor, target)
    role = _grantable_role(actor, body.role)
    if target["role"] == "admin" and role["key"] != "admin":
        _ensure_admin_left(user_id)
    accounts.set_role(user_id, role["key"])
    if role["key"] == "user":
        accounts.set_password(user_id, "")  # a general user has no password and no way in with one
    _audit(actor, f"changed {target['email']} from {target['role']} to {role['key']}")
    return {"ok": True, "role": role["key"], "roleName": role["name"]}


@app.post("/api/admin/users/{user_id}/password")
def admin_set_password(user_id: str, body: PasswordBody, request: Request) -> dict:
    """Sets (or resets) a staff member's password; whoever had the old one is signed out."""
    actor = _require_perm(request, "users.create")
    target = accounts.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="No such user")
    if (target["role"] or "user") == "user":
        raise HTTPException(status_code=400, detail="Only staff have passwords. Give the person a staff role first.")
    _guard_target(actor, target)
    problem = roles_module.check_password_rules(body.password, target["email"])
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    accounts.set_password(user_id, roles_module.hash_password(body.password))
    _audit(actor, f"set a new password for {target['email']}")
    return {"ok": True}


@app.post("/api/admin/me/password")
def admin_change_own_password(body: OwnPasswordBody, request: Request, response: Response) -> dict:
    """Somebody changes their own password (they stay signed in here; every other sign-in of theirs ends)."""
    actor = _require_perm(request)
    if not actor.user:
        raise HTTPException(status_code=400, detail="The admin token has no password to change.")
    row = accounts.password_row(actor.user["email"])
    if not row or row["id"] != actor.user["id"]:
        raise HTTPException(status_code=400, detail="This account signs in with Google and has no password to change. An administrator can set one for you.")
    if not roles_module.verify_password(body.current[:400], row["password_hash"]):
        raise HTTPException(status_code=403, detail="The current password is not right.")
    problem = roles_module.check_password_rules(body.new, actor.user["email"])
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    accounts.set_password(actor.user["id"], roles_module.hash_password(body.new))
    _start_session(actor.user, request, response, accounts_module.STAFF_SESSION_DAYS)  # this browser stays in
    _audit(actor, "changed their own password")
    return {"ok": True}


def _fail(exc: Exception) -> HTTPException:
    return HTTPException(status_code=404 if isinstance(exc, LookupError) else 400, detail=str(exc.args[0] if exc.args else exc))


@app.get("/api/admin/billing")
def admin_billing(request: Request) -> dict:
    """Everything the plans pages need: Razorpay's state, the feature catalogue, and every plan with its prices and rules."""
    _require_perm(request, "plans.view", "features.view")
    return {
        "razorpay": {**razorpay.status(), "webhookUrl": str(request.base_url).rstrip("/") + "/api/billing/webhook"},
        "features": plans.list_features(),
        "plans": plans.list_plans(),
        "periods": list(PERIODS),
        "freeCode": FREE_CODE,
    }


@app.post("/api/admin/plans")
def admin_create_plan(body: PlanBody, request: Request) -> dict:
    _require_perm(request, "plans.manage")
    try:
        return {"plan": plans.save_plan(body.fields())}
    except (ValueError, LookupError) as exc:
        raise _fail(exc)


@app.put("/api/admin/plans/{plan_id}")
def admin_update_plan(plan_id: str, body: PlanBody, request: Request) -> dict:
    _require_perm(request, "plans.manage")
    try:
        return {"plan": plans.save_plan(body.fields(), plan_id)}
    except (ValueError, LookupError) as exc:
        raise _fail(exc)


@app.delete("/api/admin/plans/{plan_id}")
def admin_delete_plan(plan_id: str, request: Request) -> dict:
    _require_perm(request, "plans.manage")
    try:
        plans.delete_plan(plan_id)
    except (ValueError, LookupError) as exc:
        raise _fail(exc)
    return {"ok": True}


@app.post("/api/admin/plans/{plan_id}/prices")
def admin_add_price(plan_id: str, body: PriceBody, request: Request) -> dict:
    _require_perm(request, "plans.manage")
    try:
        return {"price": plans.save_price(plan_id, body.fields())}
    except (ValueError, LookupError) as exc:
        raise _fail(exc)


@app.put("/api/admin/plans/{plan_id}/prices/{price_id}")
def admin_update_price(plan_id: str, price_id: str, body: PriceBody, request: Request) -> dict:
    _require_perm(request, "plans.manage")
    try:
        return {"price": plans.save_price(plan_id, body.fields(), price_id)}
    except (ValueError, LookupError) as exc:
        raise _fail(exc)


@app.delete("/api/admin/prices/{price_id}")
def admin_delete_price(price_id: str, request: Request) -> dict:
    _require_perm(request, "plans.manage")
    try:
        plans.delete_price(price_id)
    except (ValueError, LookupError) as exc:
        raise _fail(exc)
    return {"ok": True}


@app.post("/api/admin/prices/{price_id}/razorpay")
def admin_create_razorpay_plan(price_id: str, request: Request) -> dict:
    """Creates this price as a Razorpay plan, so it can be subscribed to, and remembers the id Razorpay gives it."""
    _require_perm(request, "plans.manage")
    price = plans.get_price(price_id)
    plan = plans.get_plan(price["planId"]) if price else None
    if not price or not plan:
        raise HTTPException(status_code=404, detail="That price does not exist.")
    if price["razorpayPlanId"]:
        raise HTTPException(status_code=409, detail="This price is already on Razorpay. Edit the price to make a new one.")
    try:
        made = razorpay.create_plan(
            period=price["period"], interval=price["intervalCount"], name=plan["name"], amount_minor=price["amountMinor"],
            currency=price["currency"], description=plan["description"],
        )
    except RazorpayError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    plans.set_price_razorpay(price_id, made["id"])
    return {"price": plans.get_price(price_id)}


@app.post("/api/admin/features")
def admin_add_feature(body: FeatureBody, request: Request) -> dict:
    _require_perm(request, "features.manage")
    try:
        return {"feature": plans.save_feature(body.fields())}
    except (ValueError, LookupError) as exc:
        raise _fail(exc)


@app.put("/api/admin/features/{key}")
def admin_update_feature(key: str, body: FeatureBody, request: Request) -> dict:
    _require_perm(request, "features.manage")
    try:
        return {"feature": plans.save_feature({**body.fields(), "key": key}, key)}
    except (ValueError, LookupError) as exc:
        raise _fail(exc)


@app.delete("/api/admin/features/{key}")
def admin_delete_feature(key: str, request: Request) -> dict:
    _require_perm(request, "features.manage")
    try:
        plans.delete_feature(key)
    except (ValueError, LookupError) as exc:
        raise _fail(exc)
    return {"ok": True}


@app.put("/api/admin/plans/{plan_id}/features/{key}")
def admin_set_plan_feature(plan_id: str, key: str, body: CellBody, request: Request) -> dict:
    """One cell of the grid: whether a plan includes a feature, and its limit."""
    _require_perm(request, "features.manage")
    try:
        return {"rule": plans.set_plan_feature(plan_id, key, body.enabled, body.value)}
    except (ValueError, LookupError) as exc:
        raise _fail(exc)


@app.get("/api/admin/subscriptions")
def admin_subscriptions(request: Request, page: int = 1, pageSize: int = 25) -> dict:
    _require_perm(request, "subscriptions.view")
    size = min(max(pageSize, 1), 100)
    page = max(page, 1)
    items, total = plans.list_subscriptions(limit=size, offset=(page - 1) * size)
    return {"subscriptions": items, "total": total, "page": page, "pageSize": size, "revenue": plans.revenue()}


# ---- the signed-in person's library, favourites and progress --------------------------------------------------------------

_SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_THUMBNAIL = re.compile(r"^https://(i\.ytimg\.com|yt3\.googleusercontent\.com|lh3\.googleusercontent\.com)/[^\s]{1,260}$")
_play_limiter = RateLimiter(limit=60, window=60.0)


class FavoriteBody(BaseModel):
    title: str = ""
    artist: str = ""
    thumbnail: str = ""
    duration: float = 0


class PlayedBody(BaseModel):
    sessionId: str


def _require_user(request: Request, changes: bool = False) -> dict:
    user = _session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    if changes and not _origin_ok(request):
        raise HTTPException(status_code=403, detail="This request came from another site")
    return user


def _library_meta(session_id: str, supplied: Optional[dict] = None) -> tuple[Optional[dict], bool]:
    """What the library should remember about a song, and whether we have really analysed it (so it is worth XP).
    What we hold ourselves is trusted; what the browser supplies is only used for a YouTube song we have not analysed, and is clipped."""
    video_id = session_id[3:] if session_id.startswith("yt_") and is_video_id(session_id[3:]) else ""
    result = _load_cached_result(session_id) or _load_saved_result(session_id)
    if result:
        song = catalog.get_song(video_id) if video_id else None
        thumbnail = (song or {}).get("thumbnail") or (f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg" if video_id else "")
        return {
            "videoId": video_id, "title": (result.get("title") or (song or {}).get("title") or "Untitled song")[:140],
            "artist": (result.get("artist") or (song or {}).get("artist") or "")[:140], "thumbnail": thumbnail,
            "duration": float(result.get("duration") or 0), "chords": _chord_summary(result.get("chords", [])),
        }, True
    if video_id and supplied and supplied.get("title"):
        thumbnail = supplied.get("thumbnail", "")
        return {
            "videoId": video_id, "title": str(supplied["title"])[:140], "artist": str(supplied.get("artist", ""))[:140],
            "thumbnail": thumbnail if _THUMBNAIL.match(thumbnail) else f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
            "duration": max(0.0, min(float(supplied.get("duration") or 0), 36000.0)), "chords": [],
        }, False
    return None, False


@app.get("/api/me/profile")
def my_profile(request: Request, response: Response) -> dict:
    user = _require_user(request)
    response.headers["Cache-Control"] = "no-store"
    return {"user": _public_user(user), "profile": engagement.profile(user["id"])}


INSTRUMENTS = ("guitar", "piano", "ukulele", "mandolin")  # the instruments chords can be shown for


class InstrumentBody(BaseModel):
    instrument: str


@app.put("/api/me/instrument")
def set_my_instrument(body: InstrumentBody, request: Request) -> dict:
    """Remembers which instrument the signed-in person wants chords shown for, so the website and the app on every device agree."""
    user = _require_user(request, changes=True)
    if body.instrument not in INSTRUMENTS:
        raise HTTPException(status_code=400, detail="Choose guitar, piano, ukulele or mandolin.")
    accounts.set_instrument(user["id"], body.instrument)
    return {"instrument": body.instrument}


# ---- settings: what a person chooses, kept on their account so the website and the app on every device agree ------------------------
SETTINGS_DEFAULT = {"easyChords": False, "lite": False, "theme": "system"}
THEMES = ("system", "light", "dark")


def _settings_of(user: dict) -> dict:
    """The person's settings with every one filled in (what they never set is the default); anything unknown or odd is ignored."""
    saved = user.get("prefs") or {}
    out = dict(SETTINGS_DEFAULT)
    for key in ("easyChords", "lite"):
        if isinstance(saved.get(key), bool):
            out[key] = saved[key]
    if saved.get("theme") in THEMES:
        out["theme"] = saved["theme"]
    return out


class SettingsBody(BaseModel):
    easyChords: Optional[bool] = None
    lite: Optional[bool] = None
    theme: Optional[str] = None
    instrument: Optional[str] = None


@app.get("/api/me/settings")
def my_settings(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    user = _require_user(request)
    return {"settings": _settings_of(user), "instrument": user.get("instrument") or ""}


@app.put("/api/me/settings")
def set_my_settings(body: SettingsBody, request: Request) -> dict:
    """Changes the settings that are sent (the others stay as they were) and answers with all of them."""
    user = _require_user(request, changes=True)
    now = _settings_of(user)
    if body.theme is not None and body.theme not in THEMES:
        raise HTTPException(status_code=400, detail="Choose system, light or dark.")
    if body.instrument is not None and body.instrument not in INSTRUMENTS:
        raise HTTPException(status_code=400, detail="Choose guitar, piano, ukulele or mandolin.")
    for key in ("easyChords", "lite", "theme"):
        value = getattr(body, key)
        if value is not None:
            now[key] = value
    accounts.set_prefs(user["id"], now)
    if body.instrument is not None:
        accounts.set_instrument(user["id"], body.instrument)
    return {"settings": now, "instrument": body.instrument if body.instrument is not None else user.get("instrument") or ""}


@app.get("/api/me/security")
def my_security(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    user = _require_user(request)
    return {"sessions": accounts.session_count(user["id"])}


@app.post("/api/me/sessions/end-others")
def end_my_other_sessions(request: Request) -> dict:
    """Signs the person out of every other browser and phone, keeping this one."""
    user = _require_user(request, changes=True)
    return {"ended": accounts.end_other_sessions(user["id"], _session_token(request))}


@app.delete("/api/me/history")
def clear_my_history(request: Request) -> dict:
    user = _require_user(request, changes=True)
    return {"removed": engagement.clear_history(user["id"])}


@app.get("/api/me/export")
def export_my_data(request: Request) -> Response:
    """Everything we hold about the signed-in person, as a JSON file to download."""
    user = _require_user(request)
    plan, sub = plans.effective(user["id"])
    data = {
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "account": {"email": user["email"], "name": user["name"], "picture": user["picture"], "createdAt": user["createdAt"], "lastLoginAt": user["lastLoginAt"]},
        "plan": {"code": plan["code"], "name": plan["name"], "subscription": _subscription_view(sub)},
        "settings": {**_settings_of(user), "instrument": user.get("instrument") or ""},
        **engagement.export_user(user["id"]),
    }
    return Response(content=json.dumps(data, indent=2, ensure_ascii=False), media_type="application/json", headers={"Content-Disposition": "attachment; filename=chord-suno-my-data.json", "Cache-Control": "no-store"})


@app.get("/api/me/library")
def my_library(request: Request, response: Response, tab: str = "history", limit: int = 48, offset: int = 0) -> dict:
    user = _require_user(request)
    response.headers["Cache-Control"] = "no-store"
    items, total = engagement.list_items(user["id"], "favorites" if tab == "favorites" else "history", min(max(limit, 1), 100), max(offset, 0))
    return {"items": items, "total": total}


@app.get("/api/me/favorites")
def my_favorites(request: Request, response: Response) -> dict:
    user = _require_user(request)
    response.headers["Cache-Control"] = "no-store"
    return {"keys": engagement.favorite_keys(user["id"])}


@app.put("/api/me/favorites/{session_id}")
def add_favorite(session_id: str, request: Request, body: Optional[FavoriteBody] = None) -> dict:
    user = _require_user(request, changes=True)
    if not _SESSION_ID.match(session_id):
        raise HTTPException(status_code=400, detail="That is not a song")
    meta, real = _library_meta(session_id, body.model_dump() if body else None)
    if meta is None:
        raise HTTPException(status_code=404, detail="We do not know that song")
    plan, _sub = plans.effective(user["id"])
    cap = PlanStore.limit(plan, "favorites_max")
    if cap is not None:
        kept = engagement.favorite_keys(user["id"])
        if session_id not in kept and len(kept) >= cap:
            raise HTTPException(
                status_code=402,
                detail=f"The {plan['name']} plan keeps up to {cap} favourite{'s' if cap != 1 else ''}. Remove one, or see the plans for more room.",
            )
    return engagement.set_favorite(user["id"], session_id, meta, True, pays_xp=real)


@app.delete("/api/me/favorites/{session_id}")
def remove_favorite(session_id: str, request: Request) -> dict:
    user = _require_user(request, changes=True)
    if not _SESSION_ID.match(session_id):
        raise HTTPException(status_code=400, detail="That is not a song")
    return engagement.set_favorite(user["id"], session_id, {}, False, pays_xp=False)


@app.post("/api/me/played")
def i_played(body: PlayedBody, request: Request) -> dict:
    """The player calls this once per visit to a song, when playback starts: it fills the history and pays out XP."""
    user = _require_user(request, changes=True)
    if not _play_limiter.allow(user["id"]):
        raise HTTPException(status_code=429, detail="Slow down a little")
    if not _SESSION_ID.match(body.sessionId):
        raise HTTPException(status_code=400, detail="That is not a song")
    meta, real = _library_meta(body.sessionId)
    if not real or meta is None:
        raise HTTPException(status_code=404, detail="We do not know that song")  # only songs we have analysed count
    return engagement.record_play(user["id"], body.sessionId, meta)


# ---- admin: the rules for XP, levels, badges and rewards -------------------------------------------------------------------


class RewardsBody(BaseModel):
    config: dict


@app.get("/api/admin/rewards")
def admin_rewards(request: Request) -> dict:
    _require_perm(request, "rewards.view")
    return {
        "config": engagement.config(), "defaults": DEFAULT_CONFIG, "badgeCounts": engagement.badge_counts(),
        "badgeRules": BADGE_RULES, "rewardKinds": REWARD_KINDS,
    }


@app.put("/api/admin/rewards")
def admin_save_rewards(body: RewardsBody, request: Request) -> dict:
    _require_perm(request, "rewards.manage")
    try:
        return {"config": engagement.save_config(body.config)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/admin/rewards/reset")
def admin_reset_rewards(request: Request) -> dict:
    _require_perm(request, "rewards.manage")
    return {"config": engagement.reset_config()}


class AccountBody(BaseModel):
    cookies: str
    label: str = ""


@app.get("/api/admin/youtube")
def admin_youtube_status(request: Request, test: bool = False) -> dict:
    """What the server has for YouTube (the accounts and their health); with ?test=1 also tries each one for real."""
    _require_perm(request, "youtube.manage")
    return {
        **youtube.diagnose(test=test),
        "queue": job_queue.stats(),
        "newSongsPerHour": NEW_SONGS_PER_HOUR,
        "storage": {**catalog.summary(), "dataDir": CACHE_DIR, "databaseUrlSet": bool(os.environ.get("DATABASE_URL"))},
    }


@app.post("/api/admin/youtube/accounts")
def admin_add_account(body: AccountBody, request: Request) -> dict:
    _require_perm(request, "youtube.manage")
    try:
        return youtube.add_account(body.cookies, body.label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/admin/youtube/accounts/{account_id}")
def admin_remove_account(account_id: str, request: Request) -> dict:
    _require_perm(request, "youtube.manage")
    if not youtube.remove_account(account_id):
        raise HTTPException(status_code=404, detail="No such account (accounts set in the environment cannot be removed here)")
    return {"removed": account_id}


@app.post("/api/admin/youtube/accounts/{account_id}/reset")
def admin_reset_account(account_id: str, request: Request) -> dict:
    _require_perm(request, "youtube.manage")
    youtube.reset_account(account_id)
    return {"reset": account_id}


@app.get("/api/trending")
def trending(response: Response) -> dict:
    """The shelves under the home page's search box: what is trending, with the chords and jam count of every song that has
    already been chordified. A shelf of what people jam to on this site comes first once there is enough of it."""
    shelves = trending_shelves.shelves(lambda data: catalog.save_result(_TRENDING_KEY, data))
    known = catalog.lookup([song["videoId"] for shelf in shelves for song in shelf["songs"]])
    out = [{**shelf, "songs": [{**song, **known.get(song["videoId"], {})} for song in shelf["songs"]]} for shelf in shelves]
    favourites = catalog.popular(16)
    if len(favourites) >= 3:
        out.insert(0, {"id": "popular", "title": "Popular on Chord Suno", "about": "What people are jamming to", "songs": favourites})
    response.headers["Cache-Control"] = "public, max-age=120"
    return {"shelves": out, "updatedAt": trending_shelves.updated_at()}


_similar_limiter = RateLimiter(limit=20, window=60.0)
_similar_cache: dict[str, tuple[float, list]] = {}
_SIMILAR_SECONDS = 30 * 60.0


@app.get("/api/similar/{session_id}")
def similar_songs(session_id: str, request: Request, response: Response) -> dict:
    """Songs like the one in the player, for the shelf under it: YouTube Music's "songs like this" (the same movie or album first,
    then the same language, mood and style), chordified or not, each with the reason it is there and, when the song has been
    chordified here, its main chords."""
    _check_key(session_id)
    now = time.monotonic()
    hit = _similar_cache.get(session_id)
    if hit and now - hit[0] < _SIMILAR_SECONDS:
        response.headers["Cache-Control"] = "public, max-age=300"
        return {"songs": hit[1]}
    result = _load_cached_result(session_id) or _load_saved_result(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="Unknown session")
    video_id = result.get("videoId") or (session_id[3:] if session_id.startswith("yt_") else "")
    current = {
        "videoId": video_id,
        "title": result.get("title", ""),
        "artist": result.get("artist", ""),
        "album": "",
    }
    related: list[dict] = []
    if _similar_limiter.allow(request.client.host if request.client else "unknown"):
        try:
            if not video_id:  # an uploaded song: look for the same song on YouTube Music
                video_id = find_video(current["title"], current["artist"])
            if video_id:
                seed, related = radio(video_id)
                current["album"] = seed.get("album", "")
                current["videoId"] = current["videoId"] or video_id
            if len(related) < 5 and current["artist"]:  # no radio for it: other songs by the artist
                related += [s for s in search_songs(current["artist"].split(",")[0].strip()) if s.get("kind", "song") == "song"]
        except SearchUnavailable as exc:
            log.warning("Similar songs unavailable: %s", exc)
    known = catalog.lookup([song["videoId"] for song in related])
    songs = similar_shelf(current, related, known, catalog.library())
    if songs:  # an empty answer is not kept: the next visit asks again
        if len(_similar_cache) > 500:
            _similar_cache.clear()
        _similar_cache[session_id] = (now, songs)
    response.headers["Cache-Control"] = "public, max-age=300" if songs else "no-store"
    return {"songs": songs}


# ---- ratings: how good people say the chords of a song are ------------------------------------------------------------------

_rating_limiter = RateLimiter(limit=30, window=10 * 60.0)
_VISITOR = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class RatingBody(BaseModel):
    stars: int
    comment: str = ""
    visitor: str = ""


def _voter(request: Request, visitor: str) -> str:
    """Who is rating: the signed-in person, else the browser's own random id (so one browser rates a song once, and can change it)."""
    user = _session_user(request)
    if user:
        return f"u:{user['id']}"
    return f"v:{visitor}" if _VISITOR.match(visitor or "") else ""


@app.get("/api/songs/{session_id}/rating")
def get_rating(session_id: str, request: Request, response: Response, v: str = "") -> dict:
    """What people think of the chords of a song: how many ratings and the average, and this person's own."""
    _check_key(session_id)
    response.headers["Cache-Control"] = "no-store"
    return catalog.rating_summary(session_id, _voter(request, v))


@app.post("/api/songs/{session_id}/rating")
def rate_song(session_id: str, body: RatingBody, request: Request) -> dict:
    _check_key(session_id)
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="Not allowed from this page")
    if not 1 <= body.stars <= 5:
        raise HTTPException(status_code=400, detail="Choose between 1 and 5 stars.")
    voter = _voter(request, body.visitor)
    if not voter:
        raise HTTPException(status_code=400, detail="Could not tell who is rating. Reload the page and try again.")
    if not _rating_limiter.allow(request.client.host if request.client else "unknown"):
        raise HTTPException(status_code=429, detail="That is a lot of ratings. Please wait a few minutes.")
    result = _load_cached_result(session_id) or _load_saved_result(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="Unknown song")
    comment = re.sub(r"\s+", " ", body.comment or "").strip()[:500]
    catalog.rate(session_id, voter, body.stars, comment, str(result.get("title") or "")[:200], str(result.get("artist") or "")[:200])
    return catalog.rating_summary(session_id, voter)


@app.get("/api/admin/ratings")
def admin_ratings(request: Request, page: int = 1, pageSize: int = 25, stars: int = 0, comments: bool = False) -> dict:
    _require_perm(request, "ratings.view")
    size = min(max(pageSize, 1), 100)
    page = max(page, 1)
    items, total = catalog.list_ratings(limit=size, offset=(page - 1) * size, stars=stars if 1 <= stars <= 5 else 0, only_comments=comments)
    return {"ratings": items, "total": total, "page": page, "pageSize": size, "overview": catalog.rating_overview()}


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


def _enqueue(request: Request, session_id: str, task, staff: bool = False) -> dict:
    """Starts a new analysis in line. One visitor may only start so many new songs an hour, and the line has a length
    limit; joining a job that is already waiting or running costs nothing."""
    existing = _get_job(session_id)
    if existing and existing.get("status") in ("queued", "downloading", "analyzing"):
        return {"sessionId": session_id, "status": existing["status"]}

    caller = request.client.host if request.client else "unknown"
    limited = NEW_SONGS_PER_HOUR > 0 and not _is_admin(request) and not staff
    if limited and not _new_song_limiter.allow(caller):
        minutes = max(1, int(_new_song_limiter.retry_after(caller) // 60) + 1)
        raise HTTPException(
            status_code=429,
            detail=(
                f"You have started the most new songs allowed per hour ({NEW_SONGS_PER_HOUR}). Songs that others have already "
                f"chordified open instantly, and you can start another in about {minutes} minute{'s' if minutes != 1 else ''}."
            ),
        )
    # The plan's daily allowance of new songs. A signed-in person is counted on their account, a visitor by address, and a
    # visitor is on the Free plan like anybody who has not paid.
    user = _session_user(request)
    plan, _sub = plans.effective(user["id"] if user else None)
    daily = PlanStore.limit(plan, "songs_per_day")
    owner = user["id"] if user else f"ip:{caller}"
    today = _today()
    if daily is not None and not staff and not _is_admin(request) and plans.usage(owner, today, "songs") >= daily:
        if limited:
            _new_song_limiter.refund(caller)
        raise HTTPException(
            status_code=402,
            detail=(
                f"New songs are not included in the {plan['name']} plan. See the plans to start."
                if daily == 0
                else f"The {plan['name']} plan includes {daily} new song{'s' if daily != 1 else ''} a day, and today's are used. "
                "Songs that others have already chordified still open instantly. See the plans for more."
            ),
        )
    _set_job(session_id, status="queued", progress=0, stage="Queued")
    outcome = job_queue.submit(session_id, task)
    if outcome == "full":
        if limited:
            _new_song_limiter.refund(caller)
        _JOBS.pop(session_id, None)
        raise HTTPException(status_code=503, detail="We're very busy right now. Please try again in a few minutes.")
    if not staff:
        plans.add_usage(owner, today, "songs")
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
    # Uploading is a plan feature: a visitor who is signed out is on the Free plan, like anybody who has not paid.
    user = _session_user(request)
    plan, _sub = plans.effective(user["id"] if user else None)
    if not PlanStore.allowed(plan, "upload_song") and not _is_admin(request):
        raise HTTPException(
            status_code=402,
            detail=f"Uploading your own songs is not included in the {plan['name']} plan. See the plans to add it.",
        )
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
        cached = _load_saved_result(session_id)  # an older analysis still opens
        if not cached:
            raise HTTPException(status_code=404, detail="Unknown session")
        return {**cached, "outdated": True}
    return _with_pending(session_id, cached)


# ---- public song pages (the admin chooses which songs get one) -----------------------------------------------------------

_STATIC_DIR = os.environ.get("STATIC_DIR", os.path.join(os.path.dirname(__file__), "..", "static"))
song_pages = SongPages(catalog, os.path.join(_STATIC_DIR, "song-template", "index.html"), ANALYSIS_VERSION)


class SongPageBody(BaseModel):
    title: str = ""
    artist: str = ""
    slug: str = ""
    intro: str = ""


@app.get("/api/admin/song-pages")
def admin_song_pages(
    request: Request, search: str = "", page: int = 1, pageSize: int = 25, status: str = "all", since: float = 0, until: float = 0
) -> dict:
    _require_perm(request, "song_pages.manage", "songs.edit", "songs.reanalyse")
    if status not in ("all", "published", "unpublished"):
        status = "all"
    return song_pages.admin_list(search.strip()[:80], max(page, 1), min(max(pageSize, 1), 100), status, max(since, 0), max(until, 0))


@app.put("/api/admin/song-pages/{video_id}")
def admin_publish_song_page(video_id: str, body: SongPageBody, request: Request) -> dict:
    _require_perm(request, "song_pages.manage")
    if not is_video_id(video_id):
        raise HTTPException(status_code=404, detail="Unknown song")
    done = song_pages.publish(video_id, title=body.title, artist=body.artist, slug=body.slug, intro=body.intro)
    if done is None:
        raise HTTPException(status_code=404, detail="That song is not in the catalog")
    return {"ok": True, **done, "url": f"/songs/{done['slug']}/"}


@app.delete("/api/admin/song-pages/{video_id}")
def admin_unpublish_song_page(video_id: str, request: Request) -> dict:
    _require_perm(request, "song_pages.manage")
    if not is_video_id(video_id):
        raise HTTPException(status_code=404, detail="Unknown song")
    return {"ok": song_pages.unpublish(video_id)}


# ---- editing a chordified song from the admin ----------------------------------------------------------------------------
#
# The editor page loads a song's chords, beats and strumming, the editor changes them, and the whole lists are sent back with the
# fingerprint they were loaded with; a save on top of somebody else's change is refused. Every save keeps the earlier state as a version
# (songedit.py), an edited song is never re-analysed by itself, and a re-analysis keeps the version it replaces.


class SongEditBody(BaseModel):
    token: str
    chords: Optional[list[dict]] = None
    chordsDetailed: Optional[list[dict]] = None
    strumChanged: bool = False
    strum: Optional[dict] = None
    sectionsChanged: bool = False
    sections: Optional[list[dict]] = None


class RestoreBody(BaseModel):
    versionId: str
    token: str


def _editable_song(video_id: str) -> tuple[str, dict, dict]:
    """(session id, catalog entry, saved result) of a chordified YouTube song, or the right error."""
    if not is_video_id(video_id):
        raise HTTPException(status_code=404, detail="Unknown song")
    rows, _ = catalog.db.run("SELECT session_id FROM songs WHERE video_id = ?", (video_id,))
    song = catalog.get_song(video_id)
    if not rows or not song:
        raise HTTPException(status_code=404, detail="That song is not in the catalog")
    session_id = rows[0]["session_id"]
    result = catalog.load_result(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="That song has no saved analysis to edit")
    return session_id, song, result


def _who(actor: _Actor) -> str:
    return actor.user["email"] if actor.user else "the admin token"


def _after_song_edit(video_id: str, session_id: str, result: dict) -> None:
    """What hangs on a song's chords: the catalog (main chords and key on the search cards), and the copy the job queue still holds."""
    _record_song(video_id, session_id, result, {})
    if _get_job(session_id):
        _set_job(session_id, result=result)


@app.get("/api/admin/songs/{video_id}/edit")
def admin_song_edit(video_id: str, request: Request) -> dict:
    actor = _require_perm(request, "songs.edit")
    session_id, song, result = _editable_song(video_id)
    job = _get_job(session_id) or {}
    return {
        "videoId": video_id,
        "sessionId": session_id,
        "title": result.get("title") or song["title"],
        "artist": result.get("artist") or song["artist"],
        "duration": result.get("duration") or song["duration"],
        "tempo": result.get("tempo"),
        "key": result.get("key", ""),
        "beatsPerBar": result.get("beatsPerBar", 4),
        "bars": result.get("bars", []),
        "sections": result.get("sections", []),
        "chords": result.get("chords", []),
        "chordsDetailed": result.get("chordsDetailed") or result.get("chords", []),
        "strum": result.get("strum"),
        "edited": result.get("edited"),
        "sectionsEdited": bool(result.get("sectionsEdited")),
        "token": songedit.token(result),
        "detector": {"analysisVersion": result.get("analysisVersion"), "current": ANALYSIS_VERSION, "engine": result.get("engine")},
        "versions": songedit.version_list(songedit.load_versions(catalog, session_id)),
        "job": {"status": job.get("status"), "progress": job.get("progress"), "stage": job.get("stage"), "error": job.get("error")} if job.get("status") in ("queued", "downloading", "analyzing", "error") else None,
        "canReanalyse": actor.is_super or roles_module.allows(actor.perms, "songs.reanalyse"),
    }


@app.put("/api/admin/songs/{video_id}/edit")
def admin_song_save(video_id: str, body: SongEditBody, request: Request) -> dict:
    actor = _require_perm(request, "songs.edit")
    session_id, song, result = _editable_song(video_id)
    if body.token != songedit.token(result):
        raise HTTPException(status_code=409, detail="This song was changed by somebody else (or re-analysed) since you opened it. Reload the page to see the latest version; your changes here are not saved.")
    if body.chords is None and body.chordsDetailed is None and not body.strumChanged and not body.sectionsChanged:
        raise HTTPException(status_code=400, detail="There is nothing to save.")
    duration = float(result.get("duration") or song["duration"] or 0)
    try:
        chords = songedit.clean_chords(body.chords, duration, "chords") if body.chords is not None else None
        detailed = songedit.clean_chords(body.chordsDetailed, duration, "detailed chords") if body.chordsDetailed is not None else None
        strum = songedit.clean_strum(body.strum, int(result.get("beatsPerBar") or 4), result.get("strum")) if body.strumChanged else None
        sections = songedit.clean_sections(body.sections, result.get("bars") or [], result.get("sections"), duration) if body.sectionsChanged else None
    except songedit.EditError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    who = _who(actor)
    new = songedit.apply_edit(result, chords=chords, detailed=detailed, strum_set=body.strumChanged, strum=strum, sections=sections, by=who)
    if songedit.token(new) == songedit.token(result):
        return {"changed": False, "token": songedit.token(result), "versions": songedit.version_list(songedit.load_versions(catalog, session_id)), "edited": result.get("edited")}
    summary = songedit.describe_change(result, new)
    if not songedit.load_versions(catalog, session_id):
        songedit.add_version(catalog, session_id, result, "Original analysis", "")  # the first edit keeps what the detector made
    catalog.save_result(session_id, new)  # as it is (an older detector's stamp stays; "edited" keeps it from being re-analysed)
    songedit.add_version(catalog, session_id, new, summary, who)
    _after_song_edit(video_id, session_id, new)
    _audit(actor, f"edited the song {video_id}: {summary}")
    return {
        "changed": True, "token": songedit.token(new), "edited": new["edited"], "key": new.get("key", ""),
        "versions": songedit.version_list(songedit.load_versions(catalog, session_id)),
    }


@app.post("/api/admin/songs/{video_id}/restore")
def admin_song_restore(video_id: str, body: RestoreBody, request: Request) -> dict:
    """Puts an earlier version's chords and strumming back (the state it replaces is kept as a version too)."""
    actor = _require_perm(request, "songs.edit")
    session_id, _song, result = _editable_song(video_id)
    if body.token != songedit.token(result):
        raise HTTPException(status_code=409, detail="This song changed since you opened it. Reload the page first.")
    versions = songedit.load_versions(catalog, session_id)
    version = songedit.find_version(versions, body.versionId)
    if not version:
        raise HTTPException(status_code=404, detail="No such version")
    who = _who(actor)
    new = songedit.restore(result, version, who)
    if songedit.token(new) == songedit.token(result):
        raise HTTPException(status_code=400, detail="That is already the version in use.")
    if songedit.token(result) not in {v["token"] for v in versions}:
        songedit.add_version(catalog, session_id, result, "Before going back to an earlier version", who)
    catalog.save_result(session_id, new)
    songedit.add_version(catalog, session_id, new, f"Went back to “{version['summary']}”", who)
    _after_song_edit(video_id, session_id, new)
    _audit(actor, f"restored the song {video_id} to the version “{version['summary']}”")
    return {"token": songedit.token(new), "edited": new["edited"], "versions": songedit.version_list(songedit.load_versions(catalog, session_id))}


@app.post("/api/admin/songs/{video_id}/reanalyse")
def admin_song_reanalyse(video_id: str, request: Request) -> dict:
    """Runs the chord detector on the song again (it downloads the audio from YouTube, like any new song). The finished analysis replaces the
    song's chords and strumming, including any hand edits; the version it replaces is kept first, so it can be restored."""
    actor = _require_perm(request, "songs.reanalyse")
    session_id, song, result = _editable_song(video_id)
    existing = _get_job(session_id)
    if existing and existing.get("status") in ("queued", "downloading", "analyzing"):
        return {"sessionId": session_id, "status": existing["status"]}
    who = _who(actor)
    versions = songedit.load_versions(catalog, session_id)
    if songedit.token(result) not in {v["token"] for v in versions}:
        songedit.add_version(catalog, session_id, result, "Before re-analysis", who)
    url = f"https://www.youtube.com/watch?v={video_id}"
    meta = {
        "title": (result.get("title") or song["title"] or "")[:200],
        "artist": (result.get("artist") or song["artist"] or "")[:200],
        "album": "",
        "thumbnail": song["thumbnail"] if str(song.get("thumbnail", "")).startswith("https://") else "",
        "duration": float(result.get("duration") or song["duration"] or 0),
    }

    def task() -> None:
        _run_youtube_job(session_id, url, meta)
        job = _get_job(session_id) or {}
        if job.get("status") == "done" and job.get("result"):
            try:
                songedit.add_version(catalog, session_id, job["result"], "Re-analysed with the latest detector", who)
            except Exception as exc:
                log.warning("Could not keep the re-analysis of %s as a version: %s", video_id, exc)

    out = _enqueue(request, session_id, task, staff=True)
    _audit(actor, f"started a re-analysis of the song {video_id}")
    return out


_PAGE_HEADERS = {"Cache-Control": "public, max-age=300"}


@app.get("/songs/", response_class=HTMLResponse)
def songs_index() -> HTMLResponse:
    page = song_pages.render_index()
    if page is None:
        raise HTTPException(status_code=404, detail="Not found")
    return HTMLResponse(page, headers=_PAGE_HEADERS)


@app.get("/songs/{slug}/", response_class=HTMLResponse)
def song_page(slug: str) -> HTMLResponse:
    page = song_pages.render_song(slug) if re.fullmatch(r"[a-z0-9-]{1,100}", slug) else None
    if page is None:
        missing = song_pages.not_found()
        if missing is None:
            raise HTTPException(status_code=404, detail="Not found")
        return HTMLResponse(missing, status_code=404)
    return HTMLResponse(page, headers=_PAGE_HEADERS)


@app.get("/songs/{slug}")
def song_page_slash(slug: str) -> RedirectResponse:
    return RedirectResponse(f"/songs/{slug}/", status_code=301)


@app.get("/sitemap-songs.xml")
def sitemap_songs() -> Response:
    return Response(song_pages.sitemap(), media_type="application/xml", headers=_PAGE_HEADERS)


# Serve the built Astro site from the same origin (the Docker image copies it to STATIC_DIR).
# Mounted last so /api and /media routes win; absent in local dev, where Astro runs its own server.
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="site")
