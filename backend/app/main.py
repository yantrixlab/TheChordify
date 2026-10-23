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
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .engine import analyze
from . import accounts as accounts_module
from .accounts import AccountStore, SignInError
from .engagement import BADGE_RULES, DEFAULT_CONFIG, REWARD_KINDS, Engagement
from .jobs import JobQueue
from .search import RateLimiter, SearchUnavailable, clean_query, search_songs
from .store import SongStore
from . import trending as trending_shelves
from . import youtube
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
engagement = Engagement(catalog.db)
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
    allow_credentials=True,  # the sign-in cookie, for the sites listed above (in production the site and API share one origin)
    allow_methods=["*"],
    allow_headers=["*"],
)

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


def _load_cached_result(key: str) -> Optional[dict]:
    try:
        result = catalog.load_result(key)
    except Exception as exc:  # the database is unreachable: treat as a miss rather than failing the visitor's request
        log.warning("Could not read the saved result %s: %s", key, exc)
        return None
    # Results from an older detector (e.g. before the timing-drift fix) are re-analysed.
    return result if result and result.get("analysisVersion") == ANALYSIS_VERSION else None


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
        results = [{**song, **known.get(song["videoId"], {})} for song in songs]
        # Ready-made songs lead (the most jammed first); the rest keep their relevance order (the sort is stable).
        results.sort(key=lambda song: (0, -song["jams"]) if "jams" in song else (1, 0))
        return {"query": query, "results": results}
    except SearchUnavailable as exc:
        log.warning("Song search failed: %s", exc)
        raise HTTPException(status_code=502, detail="Song search is unavailable right now. Please try again in a moment.")


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


def _session_user(request: Request) -> Optional[dict]:
    """The signed-in person behind this request's cookie, if any."""
    try:
        return accounts.user_for_session(request.cookies.get(_SESSION_COOKIE, ""))
    except Exception as exc:
        log.warning("Could not look up the session: %s", exc)
        return None


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"], "email": user["email"], "name": user["name"], "picture": user["picture"], "plan": user["plan"],
        "isAdmin": user["email"] in _ADMIN_EMAILS,
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


def _admin_via(request: Request) -> Optional[str]:
    """"google" for a signed-in admin, "token" for the admin token, else None."""
    user = _session_user(request)
    if user and user["email"] in _ADMIN_EMAILS:
        return "google"
    given = request.headers.get("x-admin-token", "")
    if _ADMIN_TOKEN and hmac.compare_digest(given.encode("utf-8"), _ADMIN_TOKEN.encode("utf-8")):
        return "token"
    return None


def _require_admin(request: Request) -> None:
    if not _ADMIN_TOKEN and not _ADMIN_EMAILS:
        raise HTTPException(status_code=404, detail="Not found")  # the admin is switched off
    via = _admin_via(request)
    if via is None:
        # Only the ones that fail count towards the limit, so guessing the token gets nowhere but an admin at work is never held up.
        caller = request.client.host if request.client else "unknown"
        if not _admin_limiter.allow(caller):
            raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute.")
        if request.headers.get("x-admin-token"):
            raise HTTPException(status_code=401, detail="Wrong admin token")
        raise HTTPException(status_code=401, detail="Sign in with an admin Google account")
    if via == "google" and request.method not in ("GET", "HEAD", "OPTIONS") and not _origin_ok(request):
        raise HTTPException(status_code=403, detail="This request came from another site")


def _is_admin(request: Request) -> bool:
    """True for an admin (the owner trying things is not held to the visitor limits)."""
    return _admin_via(request) is not None


# ---- sign-in (Google only) ----------------------------------------------------------------------------------------------


class GoogleBody(BaseModel):
    credential: str


@app.get("/api/auth/config")
def auth_config() -> dict:
    """What the sign-in button needs: the public Google client id (empty until it is set, which turns sign-in off)."""
    return {"googleClientId": _GOOGLE_CLIENT_ID, "enabled": bool(_GOOGLE_CLIENT_ID)}


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
    response.set_cookie(
        _SESSION_COOKIE, accounts.start_session(user["id"]), max_age=accounts_module.SESSION_DAYS * 86400,
        httponly=True, samesite="lax", secure=request.url.scheme == "https", path="/",
    )
    return {"user": _public_user(user)}


@app.get("/api/auth/me")
def whoami(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    user = _session_user(request)
    if not user:
        return {"user": None}
    snap = engagement.snapshot(user["id"])
    return {"user": {**_public_user(user), **{k: snap[k] for k in ("level", "title", "ring", "stars", "xp", "intoLevel", "levelSpan", "nextLevelXp", "streak")}}}


@app.post("/api/auth/logout")
def sign_out(request: Request, response: Response) -> dict:
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="This request came from another site")
    accounts.end_session(request.cookies.get(_SESSION_COOKIE, ""))
    response.delete_cookie(_SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/plans")
def public_plans(response: Response) -> dict:
    """The subscription plans that are switched on, in the order the admin set."""
    response.headers["Cache-Control"] = "public, max-age=60"
    return {"plans": accounts.list_plans(only_active=True)}


# ---- admin: who is here, people, plans ------------------------------------------------------------------------------------


class PlanBody(BaseModel):
    code: str
    name: str
    description: str = ""
    priceMinor: int = 0
    currency: str = "INR"
    period: str = "monthly"
    intervalCount: int = 1
    features: list[str] = []
    missing: list[str] = []
    badge: str = ""
    cta: str = ""
    featured: bool = False
    active: bool = True
    sortOrder: int = 0
    razorpayPlanId: str = ""

    def fields(self) -> dict:
        return {
            "code": self.code, "name": self.name, "description": self.description, "price_minor": self.priceMinor,
            "currency": self.currency, "period": self.period, "interval_count": self.intervalCount, "features": self.features,
            "missing": self.missing, "badge": self.badge, "cta": self.cta, "featured": self.featured, "active": self.active,
            "sort_order": self.sortOrder, "razorpay_plan_id": self.razorpayPlanId,
        }


class DisabledBody(BaseModel):
    disabled: bool


@app.get("/api/admin/me")
def admin_me(request: Request) -> dict:
    _require_admin(request)
    via = _admin_via(request)
    user = _session_user(request)
    return {"admin": True, "via": via, "user": _public_user(user) if user else None}


@app.get("/api/admin/overview")
def admin_overview(request: Request) -> dict:
    _require_admin(request)
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
        "plans": {"active": len(accounts.list_plans(only_active=True)), "total": len(accounts.list_plans())},
        "signIn": {"configured": bool(_GOOGLE_CLIENT_ID), "admins": len(_ADMIN_EMAILS)},
    }


@app.get("/api/admin/users")
def admin_users(request: Request, search: str = "", page: int = 1, pageSize: int = 25) -> dict:
    _require_admin(request)
    size = min(max(pageSize, 1), 100)
    page = max(page, 1)
    users, total = accounts.list_users(search=search[:100], limit=size, offset=(page - 1) * size)
    xps = engagement.xp_of([u["id"] for u in users])
    levels = engagement.levels_of(xps)
    return {
        "users": [{**u, "isAdmin": u["email"] in _ADMIN_EMAILS, "xp": xps.get(u["id"], 0), "level": levels.get(u["id"], 1)} for u in users],
        "total": total, "page": page, "pageSize": size,
    }


@app.post("/api/admin/users/{user_id}/disabled")
def admin_block_user(user_id: str, body: DisabledBody, request: Request) -> dict:
    _require_admin(request)
    if not accounts.set_disabled(user_id, body.disabled):
        raise HTTPException(status_code=404, detail="No such user")
    return {"ok": True}


@app.get("/api/admin/plans")
def admin_plans(request: Request) -> dict:
    _require_admin(request)
    return {"plans": accounts.list_plans()}


@app.post("/api/admin/plans")
def admin_create_plan(body: PlanBody, request: Request) -> dict:
    _require_admin(request)
    try:
        return {"plan": accounts.save_plan(body.fields())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.put("/api/admin/plans/{plan_id}")
def admin_update_plan(plan_id: str, body: PlanBody, request: Request) -> dict:
    _require_admin(request)
    try:
        return {"plan": accounts.save_plan(body.fields(), plan_id)}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/admin/plans/{plan_id}")
def admin_delete_plan(plan_id: str, request: Request) -> dict:
    _require_admin(request)
    if not accounts.delete_plan(plan_id):
        raise HTTPException(status_code=404, detail="No such plan")
    return {"ok": True}


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
    result = _load_cached_result(session_id)
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
    _require_admin(request)
    return {
        "config": engagement.config(), "defaults": DEFAULT_CONFIG, "badgeCounts": engagement.badge_counts(),
        "badgeRules": BADGE_RULES, "rewardKinds": REWARD_KINDS,
    }


@app.put("/api/admin/rewards")
def admin_save_rewards(body: RewardsBody, request: Request) -> dict:
    _require_admin(request)
    try:
        return {"config": engagement.save_config(body.config)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/admin/rewards/reset")
def admin_reset_rewards(request: Request) -> dict:
    _require_admin(request)
    return {"config": engagement.reset_config()}


class AccountBody(BaseModel):
    cookies: str
    label: str = ""


@app.get("/api/admin/youtube")
def admin_youtube_status(request: Request, test: bool = False) -> dict:
    """What the server has for YouTube (the accounts and their health); with ?test=1 also tries each one for real."""
    _require_admin(request)
    return {
        **youtube.diagnose(test=test),
        "queue": job_queue.stats(),
        "newSongsPerHour": NEW_SONGS_PER_HOUR,
        "storage": {**catalog.summary(), "dataDir": CACHE_DIR, "databaseUrlSet": bool(os.environ.get("DATABASE_URL"))},
    }


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
    return {"shelves": out}


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
