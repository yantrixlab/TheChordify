"""Download audio from a YouTube/SoundCloud URL using yt-dlp.

Note: downloading audio from YouTube server-side sits in a legal gray area
under YouTube's Terms of Service. This is fine for personal/learning use;
revisit before running this as a public commercial product.
"""

from __future__ import annotations

import glob
import hashlib
import os
import re
import tempfile
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


def cache_key_for_url(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


# YouTube often refuses downloads from a server's IP address ("Sign in to confirm you're not a bot"). What helps, in
# order of how well it works:
#   YTDLP_COOKIES       the text of a cookies.txt exported from a logged-in browser (or YTDLP_COOKIES_FILE, a path)
#   YTDLP_PROXY         a proxy URL (a residential / mobile proxy gets past IP blocks)
# and, with no setup, trying YouTube's other player clients one after another, which some blocks do not cover.
_CLIENTS: list[Optional[list[str]]] = [None, ["tv"], ["mweb"], ["android_vr"], ["web_safari"]]  # None = yt-dlp's default
_NO_POINT_RETRYING = ("private video", "has been removed", "account associated", "terminated", "members-only", "unsupported url", "not a valid url", "copyright")

_cookie_path: Optional[str] = None


def _cookies() -> Optional[str]:
    """A private copy of the configured cookies (yt-dlp rewrites its cookie file, so it must be writable)."""
    global _cookie_path
    if _cookie_path and os.path.isfile(_cookie_path):
        return _cookie_path
    text = os.environ.get("YTDLP_COOKIES", "").strip()
    source = os.environ.get("YTDLP_COOKIES_FILE", "").strip()
    if not text and source and os.path.isfile(source):
        with open(source, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    if not text:
        return None
    fd, path = tempfile.mkstemp(prefix="ytcookies-", suffix=".txt")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text if text.endswith(chr(10)) else text + chr(10))
    os.chmod(path, 0o600)
    _cookie_path = path
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
