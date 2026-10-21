"""Download audio from a YouTube/SoundCloud URL using yt-dlp.

Note: downloading audio from YouTube server-side sits in a legal gray area
under YouTube's Terms of Service. This is fine for personal/learning use;
revisit before running this as a public commercial product.
"""

from __future__ import annotations

import re
import os
import hashlib

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


def download_audio(url: str, out_dir: str) -> str:
    """Download the best audio stream for `url` into `out_dir` as a .wav file.

    Returns the path to the downloaded .wav file. Requires ffmpeg on PATH.
    """
    validate_url(url)
    os.makedirs(out_dir, exist_ok=True)
    key = cache_key_for_url(url)
    out_template = os.path.join(out_dir, f"{key}.%(ext)s")
    final_path = os.path.join(out_dir, f"{key}.wav")

    if os.path.exists(final_path):
        return final_path

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "192",
            }
        ],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    if not os.path.exists(final_path):
        raise RuntimeError("Audio download succeeded but expected output file was not found")

    return final_path
