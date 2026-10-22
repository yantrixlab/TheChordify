"""Song search for the home page: YouTube Music's "Songs" results only.

Searching YouTube itself returns every kind of video (vlogs, reactions, lyric edits...). YouTube Music's song search
returns just the tracks, each with its title, artists, album and length, which is what a chord site needs. It uses
the open-source ytmusicapi package (no API key, no account). Only metadata is fetched here; the audio is downloaded
later, when someone picks a result (youtube.py).
"""

from __future__ import annotations

import re
import threading
import time
from typing import Optional

from ytmusicapi import YTMusic

MAX_QUERY_LENGTH = 100
MAX_SONG_SECONDS = 20 * 60  # a "song" longer than this is a mix or a live set, not something to chart
CACHE_SECONDS = 10 * 60

_client: Optional[YTMusic] = None
_client_lock = threading.Lock()
_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = threading.Lock()


class SearchUnavailable(RuntimeError):
    """The search service could not be reached or answered with something unusable."""


def _ytmusic() -> YTMusic:
    global _client
    with _client_lock:
        if _client is None:
            _client = YTMusic()
        return _client


def clean_query(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()[:MAX_QUERY_LENGTH]


def _thumbnail(thumbnails: list[dict]) -> str:
    """The biggest square thumbnail, upscaled to 226 px (these urls take their size from the end of the link)."""
    if not thumbnails:
        return ""
    url = max(thumbnails, key=lambda t: t.get("width", 0)).get("url", "")
    return re.sub(r"=w\d+-h\d+.*$", "=w226-h226-l90-rj", url)


def _song(item: dict) -> Optional[dict]:
    video_id = item.get("videoId")
    title = (item.get("title") or "").strip()
    if not video_id or not title:
        return None
    seconds = int(item.get("duration_seconds") or 0)
    if seconds and seconds > MAX_SONG_SECONDS:
        return None
    artists = [a.get("name", "") for a in item.get("artists") or [] if a.get("name")]
    album = item.get("album") or {}
    return {
        "videoId": video_id,
        "title": title,
        "artist": ", ".join(artists),
        "album": album.get("name", "") if isinstance(album, dict) else "",
        "duration": seconds,
        "thumbnail": _thumbnail(item.get("thumbnails") or []),
    }


def _related(songs: list[dict], query: str) -> list[dict]:
    """Drop results that have nothing to do with the words typed, so a nonsense search shows nothing instead of
    random songs. A result stays if any word of three or more letters from the query appears in its title, artist or
    album (as part of a word, so a small typo or a partial word still matches). Queries that are not plain Latin
    letters (other scripts, or only short words) are left alone, since their matches may be spelled differently."""
    if not re.fullmatch(r"[A-Za-z0-9 '&.,!?()+-]+", query):
        return songs
    words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) >= 3]
    if not words:
        return songs
    kept = [s for s in songs if any(w in f"{s['title']} {s['artist']} {s['album']}".lower() for w in words)]
    return kept


def search_songs(query: str, limit: int = 20) -> list[dict]:
    """Songs matching `query`, best first. An empty list means nothing matched (not an error)."""
    q = clean_query(query)
    if len(q) < 2:
        return []
    key = q.lower()
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1][:limit]
    try:
        items = _ytmusic().search(q, filter="songs", limit=max(limit, 20), ignore_spelling=False)
    except Exception as exc:  # network trouble, a changed response, an upstream block...
        raise SearchUnavailable(str(exc)) from exc

    seen: set[str] = set()
    songs: list[dict] = []
    for item in items:
        song = _song(item)
        if song and song["videoId"] not in seen:
            seen.add(song["videoId"])
            songs.append(song)
    songs = _related(songs, q)
    with _cache_lock:
        if len(_cache) > 500:  # keep it small
            _cache.clear()
        _cache[key] = (now, songs)
    return songs[:limit]


class RateLimiter:
    """At most `limit` searches per `window` seconds for each caller, so the endpoint cannot be used to hammer YouTube."""

    def __init__(self, limit: int = 30, window: float = 60.0) -> None:
        self._limit = limit
        self._window = window
        self._calls: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, caller: str) -> bool:
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._calls.get(caller, []) if now - t < self._window]
            if len(recent) >= self._limit:
                self._calls[caller] = recent
                return False
            recent.append(now)
            self._calls[caller] = recent
            if len(self._calls) > 5000:
                self._calls.clear()
            return True
