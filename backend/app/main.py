from __future__ import annotations

import os
import tempfile
import hashlib
import json
import threading
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .engine import analyze
from .youtube import download_audio, InvalidUrlError

CACHE_DIR = os.path.join(tempfile.gettempdir(), "thechordify-cache")
UPLOAD_DIR = os.path.join(CACHE_DIR, "uploads")
RESULT_DIR = os.path.join(CACHE_DIR, "results")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)

# Bump whenever the detector's output changes, so songs cached by an older version are analysed again.
# 2: frame times no longer drift against the audio clock.
ANALYSIS_VERSION = 2

ALLOWED_UPLOAD_EXTENSIONS ={".mp3", ".wav", ".flac", ".m4a"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB

app = FastAPI(title="TheChordify chord extraction API")

# Local dev origins are always allowed; list production sites in CORS_ORIGINS (comma-separated),
# e.g. CORS_ORIGINS=https://thechordify.com,https://www.thechordify.com
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


def _run_youtube_job(session_id: str, url: str) -> None:
    try:
        _set_job(session_id, status="downloading", progress=2, stage="Fetching audio from the link")
        audio_path = download_audio(url, UPLOAD_DIR)

        _set_job(session_id, status="analyzing", progress=5, stage="Loading audio")

        def on_progress(pct: int, stage: str) -> None:
            _set_job(session_id, status="analyzing", progress=pct, stage=stage)

        analysis = analyze(audio_path, on_progress=on_progress)

        result = {
            "sessionId": session_id,
            "source": "youtube",
            "sourceUrl": url,
            "duration": analysis["duration"],
            "chords": analysis["chords"],
            "tempo": analysis["tempo"],
            "beatTimes": analysis["beatTimes"],
            "bars": analysis["bars"],
            "engine": analysis["engine"],
            "audioUrl": f"/media/{os.path.basename(audio_path)}",
        }
        _save_result(session_id, result)
        _set_job(session_id, status="done", progress=100, stage="Done", result=result)
    except InvalidUrlError as exc:
        _set_job(session_id, status="error", progress=0, error=str(exc))
    except Exception as exc:
        error_text = str(exc)
        if "Sign in to confirm" in error_text or "not a bot" in error_text:
            error_text = (
                "YouTube blocked this download with a bot/authentication check. "
                "Try another link, upload the audio file instead, or configure yt-dlp cookies."
            )
        _set_job(
            session_id,
            status="error",
            progress=0,
            error=f"Could not process that song: {error_text}",
        )


def _run_analysis_job(session_id: str, audio_path: str, source: str, source_url: Optional[str] = None) -> None:
    try:
        _set_job(session_id, status="analyzing", progress=5, stage="Loading audio")

        def on_progress(pct: int, stage: str) -> None:
            _set_job(session_id, status="analyzing", progress=pct, stage=stage)

        analysis = analyze(audio_path, on_progress=on_progress)

        result = {
            "sessionId": session_id,
            "source": source,
            "duration": analysis["duration"],
            "chords": analysis["chords"],
            "tempo": analysis["tempo"],
            "beatTimes": analysis["beatTimes"],
            "bars": analysis["bars"],
            "engine": analysis["engine"],
            "audioUrl": f"/media/{os.path.basename(audio_path)}",
        }
        if source_url:
            result["sourceUrl"] = source_url
        _save_result(session_id, result)
        _set_job(session_id, status="done", progress=100, stage="Done", result=result)
    except Exception as exc:
        _set_job(session_id, status="error", progress=0, error=f"Chord analysis failed: {exc}")


@app.post("/api/extract/youtube")
def extract_from_youtube(payload: YoutubeRequest) -> dict:
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    session_id = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]

    cached = _load_cached_result(session_id)
    if cached:
        _set_job(session_id, status="done", progress=100, stage="Done", result=cached)
        return {"sessionId": session_id, "status": "done"}

    existing = _get_job(session_id)
    if existing and existing.get("status") in ("downloading", "analyzing"):
        return {"sessionId": session_id, "status": existing["status"]}

    _set_job(session_id, status="queued", progress=0, stage="Queued")
    thread = threading.Thread(target=_run_youtube_job, args=(session_id, url), daemon=True)
    thread.start()

    return {"sessionId": session_id, "status": "queued"}


@app.post("/api/extract/upload")
async def extract_from_upload(file: UploadFile = File(...)) -> dict:
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

    existing = _get_job(session_id)
    if existing and existing.get("status") in ("downloading", "analyzing"):
        return {"sessionId": session_id, "status": existing["status"]}

    _set_job(session_id, status="queued", progress=0, stage="Queued")
    thread = threading.Thread(
        target=_run_analysis_job, args=(session_id, stored_path, "upload"), daemon=True
    )
    thread.start()

    return {"sessionId": session_id, "status": "queued"}


@app.get("/api/job/{session_id}")
def get_job_status(session_id: str) -> dict:
    job = _get_job(session_id)
    if not job:
        cached = _load_cached_result(session_id)
        if cached:
            return {"sessionId": session_id, "status": "done", "progress": 100, "result": cached}
        raise HTTPException(status_code=404, detail="Unknown session")
    return {"sessionId": session_id, **job}


@app.get("/api/result/{session_id}")
def get_result(session_id: str) -> dict:
    cached = _load_cached_result(session_id)
    if not cached:
        raise HTTPException(status_code=404, detail="Unknown session")
    return cached


# Serve the built Astro site from the same origin (the Docker image copies it to STATIC_DIR).
# Mounted last so /api and /media routes win; absent in local dev, where Astro runs its own server.
_STATIC_DIR = os.environ.get("STATIC_DIR", os.path.join(os.path.dirname(__file__), "..", "static"))
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="site")
