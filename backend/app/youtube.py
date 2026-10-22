"""Download audio from a YouTube/SoundCloud URL using yt-dlp.

Note: downloading audio from YouTube server-side sits in a legal gray area
under YouTube's Terms of Service. This is fine for personal/learning use;
revisit before running this as a public commercial product.
"""

from __future__ import annotations

import glob
import hashlib
import os
import random
import re
import shutil
import tempfile
import threading
import time
from typing import Optional

import yt_dlp

ALLOWED_HOSTS = (
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "soundcloud.com",
    "www.soundcloud.com",
)


class InvalidUrlError(ValueError):
    pass


def validate_url(url: str) -> None:
    if not re.match(r"^https?://", url):
        raise InvalidUrlError("URL must start with http:// or https://")
    host_match = re.match(r"^https?://([^/]+)/?", url)
    host = (host_match.group(1) if host_match else "").lower().replace("www.", "www.")
    if not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise InvalidUrlError("Only YouTube and SoundCloud URLs are supported")


_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(url: str) -> Optional[str]:
    """The 11-character YouTube video id in a watch / youtu.be / shorts / embed link, or None."""
    match = re.search(r"(?:[?&]v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])", url)
    return match.group(1) if match else None


def is_video_id(value: str) -> bool:
    return bool(_VIDEO_ID.match(value))


def session_id_for_url(url: str) -> str:
    """One id per song: yt_<video id> for YouTube (so the same song is found again whichever link it came from),
    a hash of the link for anything else."""
    video_id = extract_video_id(url)
    return f"yt_{video_id}" if video_id else cache_key_for_url(url)


def cache_key_for_url(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


# YouTube often refuses downloads from a server's IP address ("Sign in to confirm you're not a bot"). What helps, in
# order of how well it works:
#   cookies   a cookies.txt exported from a logged-in browser: pasted on the /admin page (stored in DATA_DIR), or in
#             YTDLP_COOKIES (the text) / YTDLP_COOKIES_FILE (a path)
#   YTDLP_PROXY   a proxy URL (a residential / mobile proxy gets past IP blocks)
# and, with no setup, trying YouTube's other player clients one after another, which some blocks do not cover.
_CLIENTS: list[Optional[list[str]]] = [None, ["tv"], ["mweb"], ["android_vr"], ["web_safari"]]  # None = yt-dlp's default
_NO_POINT_RETRYING = ("private video", "has been removed", "account associated", "terminated", "members-only", "unsupported url", "not a valid url", "copyright")
ANSI = re.compile(r"\x1b\[[0-9;]*m")  # colour codes in yt-dlp messages
_TEST_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"  # a very widely available public video

_store_path: Optional[str] = None  # where pasted cookies live (set by configure())
_cookie_copy: Optional[tuple[str, str]] = None  # (digest of the cookies text, private temp copy yt-dlp may rewrite)
_download_slot = threading.Semaphore(1)  # one download at a time, spaced out: bursts are what get an account flagged


def configure(data_dir: str) -> None:
    global _store_path
    _store_path = os.path.join(data_dir, "youtube-cookies.txt")


def _cookie_source() -> tuple[str, str]:
    """(cookies text, where it came from), or ("", "")."""
    if _store_path and os.path.isfile(_store_path):
        with open(_store_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read(), "pasted on the admin page"
    text = os.environ.get("YTDLP_COOKIES", "").strip()
    if text:
        return text, "YTDLP_COOKIES"
    path = os.environ.get("YTDLP_COOKIES_FILE", "").strip()
    if path and os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read(), "YTDLP_COOKIES_FILE"
    return "", ""


def parse_cookies(text: str) -> list[dict]:
    """The cookies in a Netscape cookies.txt (the format browser extensions export); lines that are not cookies are skipped."""
    cookies = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 7:
            continue
        domain, _flag, _path, _secure, expires, name, _value = parts
        cookies.append({"domain": domain, "name": name, "expires": int(expires) if expires.isdigit() else 0})
    return cookies


_LOGIN_COOKIES = ("SAPISID", "__Secure-3PSID", "__Secure-1PSID", "LOGIN_INFO")


def cookie_info() -> dict:
    text, source = _cookie_source()
    cookies = [c for c in parse_cookies(text) if "youtube.com" in c["domain"] or "google.com" in c["domain"]]
    names = {c["name"] for c in cookies}
    expiries = [c["expires"] for c in cookies if c["expires"] > 0]
    return {
        "configured": bool(text),
        "source": source,
        "cookies": len(cookies),
        "loggedIn": any(n in names for n in _LOGIN_COOKIES),
        "expiresSoonest": min(expiries) if expiries else None,
    }


def save_cookies(text: str) -> dict:
    """Stores a pasted cookies.txt for yt-dlp to use. Raises ValueError if it is not a usable YouTube cookies file."""
    if not _store_path:
        raise ValueError("Cookie storage is not configured")
    text = text.replace("\r\n", "\n").strip()
    if len(text) > 300_000:
        raise ValueError("That file is too large to be a cookies.txt")
    youtube = [c for c in parse_cookies(text) if "youtube.com" in c["domain"]]
    if not youtube:
        raise ValueError("No YouTube cookies found. Paste the whole cookies.txt (Netscape format) exported while on youtube.com.")
    with open(_store_path, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    os.chmod(_store_path, 0o600)
    return cookie_info()


def clear_cookies() -> None:
    if _store_path and os.path.isfile(_store_path):
        os.remove(_store_path)


def _cookies() -> Optional[str]:
    """A private, writable copy of the current cookies (yt-dlp rewrites its cookie file); refreshed when they change."""
    global _cookie_copy
    text, _source = _cookie_source()
    if not text.strip():
        return None
    digest = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()
    if _cookie_copy and _cookie_copy[0] == digest and os.path.isfile(_cookie_copy[1]):
        return _cookie_copy[1]
    fd, path = tempfile.mkstemp(prefix="ytcookies-", suffix=".txt")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text if text.endswith(chr(10)) else text + chr(10))
    os.chmod(path, 0o600)
    _cookie_copy = (digest, path)
    return path


def _options(client: Optional[list[str]]) -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "retries": 3,
        "socket_timeout": 25,
        # YouTube's player scripts need a JavaScript runtime; use whichever of these is installed.
        "js_runtimes": {"deno": {}, "node": {}},
    }
    if os.environ.get("YTDLP_PROXY"):
        opts["proxy"] = os.environ["YTDLP_PROXY"]
    cookies = _cookies()
    if cookies:
        opts["cookiefile"] = cookies
    if client:
        opts["extractor_args"] = {"youtube": {"player_client": client}}
    return opts


def video_info(url: str) -> dict:
    """Title and artist/uploader for the player header. A missing title is never fatal."""
    try:
        validate_url(url)
        with yt_dlp.YoutubeDL({**_options(None), "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False) or {}
        return {
            "title": info.get("track") or info.get("title") or "",
            "artist": info.get("artist") or info.get("creator") or info.get("uploader") or "",
        }
    except Exception:
        return {"title": "", "artist": ""}


def download_audio(url: str, out_dir: str) -> str:
    """Download the best audio stream for `url` into `out_dir` as a .wav file.

    Returns the path to the downloaded .wav file. Requires ffmpeg on PATH. If YouTube refuses one way of asking,
    the next player client is tried.
    """
    validate_url(url)
    os.makedirs(out_dir, exist_ok=True)
    key = cache_key_for_url(url)
    out_template = os.path.join(out_dir, f"{key}.%(ext)s")
    final_path = os.path.join(out_dir, f"{key}.wav")

    if os.path.exists(final_path):
        return final_path

    with _download_slot:
        time.sleep(random.uniform(0.5, 2.0))  # a human-ish pause between downloads
        return _download_with_fallbacks(url, out_template, final_path, out_dir, key)


def _download_with_fallbacks(url: str, out_template: str, final_path: str, out_dir: str, key: str) -> str:
    last_error: Optional[Exception] = None
    for client in _CLIENTS:
        ydl_opts = {
            **_options(client),
            "format": "bestaudio/best",
            "outtmpl": out_template,
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav", "preferredquality": "192"}],
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
            if os.path.exists(final_path):
                return final_path
            last_error = RuntimeError("Audio download succeeded but expected output file was not found")
        except Exception as exc:
            last_error = exc
            if any(marker in str(exc).lower() for marker in _NO_POINT_RETRYING):
                raise  # another way of asking will not bring back a removed or private video
        for leftover in glob.glob(os.path.join(out_dir, f"{key}.*")):
            if not leftover.endswith(".wav"):
                try:
                    os.remove(leftover)
                except OSError:
                    pass
    raise last_error or RuntimeError("Could not download that song")


def diagnose(test: bool = False) -> dict:
    """What this server has to work with for YouTube, and (with test=True) whether YouTube lets it in right now."""
    import importlib.util

    info: dict = {
        "ytDlp": yt_dlp.version.__version__,
        "playerScriptSolver": importlib.util.find_spec("yt_dlp_ejs") is not None,
        "jsRuntime": {"node": bool(shutil.which("node")), "deno": bool(shutil.which("deno"))},
        "cookies": cookie_info(),
        "proxy": bool(os.environ.get("YTDLP_PROXY")),
    }
    if test:
        attempts = []
        for client in _CLIENTS:
            name = ",".join(client) if client else "default"
            try:
                with yt_dlp.YoutubeDL({**_options(client), "skip_download": True}) as ydl:
                    ydl.extract_info(_TEST_VIDEO, download=False)
                attempts.append({"client": name, "result": "ok"})
                break
            except Exception as exc:
                attempts.append({"client": name, "result": ANSI.sub("", str(exc))[:160]})
        info["test"] = {"ok": attempts[-1]["result"] == "ok", "attempts": attempts}
    return info
