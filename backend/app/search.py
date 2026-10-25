"""Song search for the home page: music only, but every version of the song.

Searching YouTube itself returns every kind of video (vlogs, reactions, dance classes...). YouTube Music's search is
limited to music: its "Songs" are the official audio tracks (title, artists, album) and its "Videos" are the music
videos and the other uploads of the same song (lyric videos, karaoke, acoustic and instrument covers, live versions).
Both are searched and merged, so a song shows up the way it does on YouTube, from several channels, while tutorials,
dance clips, reactions and the like are dropped. It uses the open-source ytmusicapi package (no API key, no account).
Only metadata is fetched here; the audio is downloaded later, when someone picks a result (youtube.py).
"""

from __future__ import annotations

import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from ytmusicapi import YTMusic

MAX_QUERY_LENGTH = 100
MAX_SONG_SECONDS = 20 * 60  # a "song" longer than this is a mix or a live set, not something to chart
MAX_VIDEO_SECONDS = 12 * 60
MIN_VIDEO_SECONDS = 45
# Videos that are about a song rather than the song: nothing to chart.
_NOT_MUSIC = re.compile(
    r"\b(dance|choreograph\w*|tutorial|lesson|how to|easiest way|reaction|reacts?|review|trailer|scene|episode|interview|"
    r"behind the scenes|full movie|full album|podcast|vlog|status video|whatsapp status)\b",
    re.IGNORECASE,
)
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


def _song(item: dict, kind: str) -> Optional[dict]:
    video_id = item.get("videoId")
    title = (item.get("title") or "").strip()
    if not video_id or not title:
        return None
    seconds = int(item.get("duration_seconds") or 0)
    if kind == "song":
        if seconds and seconds > MAX_SONG_SECONDS:
            return None
    elif _NOT_MUSIC.search(title) or not (MIN_VIDEO_SECONDS <= seconds <= MAX_VIDEO_SECONDS):
        return None
    artists = [a.get("name", "") for a in item.get("artists") or [] if a.get("name")]
    album = item.get("album") or {}
    views = str(item.get("views") or "").strip()
    return {
        "videoId": video_id,
        "kind": kind,
        "title": title,
        "artist": ", ".join(artists),
        "album": album.get("name", "") if isinstance(album, dict) else "",
        "views": f"{views} views" if views and kind == "video" else "",
        "duration": seconds,
        "thumbnail": _thumbnail(item.get("thumbnails") or []),
    }


def _views_number(text: str) -> float:
    """'523M views' -> 523000000.0; '2.3K' -> 2300.0; anything else -> 0."""
    match = re.match(r"\s*([0-9]+(?:[.,][0-9]+)?)\s*([KMB]?)", text or "", flags=re.IGNORECASE)
    if not match:
        return 0.0
    number = float(match.group(1).replace(",", "."))
    return number * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[match.group(2).upper()]


def _popularity(song: dict, all_songs: list[dict]) -> float:
    """Sort key: the first official song leads, popular videos follow, then the other official tracks and small uploads."""
    if song["kind"] == "song":
        order = [x["videoId"] for x in all_songs if x["kind"] == "song"].index(song["videoId"])
        return 1e12 if order == 0 else 1e5 / order
    return _views_number(song["views"])


def _plain(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def _related(songs: list[dict], query: str) -> list[dict]:
    """Keep what has to do with the words typed, and put the closest matches first.

    A result stays if any word of three or more letters from the query appears in its title, channel / artist or album
    (as part of a word, so a typo or a partial word still matches), so a nonsense search shows nothing instead of random
    songs. Results whose title holds the whole phrase come first (the official song and its other uploads), in the
    order they came. When there are plenty of title matches, results that only match through their album are dropped.
    Queries that are not plain Latin letters (other scripts, or only short words) are left alone, since their matches
    may be spelled differently."""
    if not re.fullmatch(r"[A-Za-z0-9 '&.,!?()+-]+", query):
        return songs
    words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) >= 3]
    if not words:
        return songs
    everything = re.findall(r"[a-z0-9]+", query.lower())

    def hits(song: dict) -> tuple[int, int]:
        title = _plain(song["title"])
        byline = _plain(song["artist"])
        return sum(w in title for w in words), sum(w in byline for w in words) + sum(w in _plain(song["album"]) for w in words)

    scored = [(song, *hits(song)) for song in songs]
    related = [(song, t, o) for song, t, o in scored if t or o]
    direct = [(song, t, o) for song, t, o in related if t or any(w in _plain(song["artist"]) for w in words)]
    if len(direct) >= 5:
        related = direct

    def closest(song: dict) -> bool:
        """Every word of the query is in the title or the artist / channel (the song, and other uploads of it)."""
        text = " " + _plain(song["title"] + " " + song["artist"]) + " "
        return all(f" {w}" in text for w in everything)  # whole or leading part of a word, short words included

    # Closest matches first; inside each group the official song, then the most-watched versions.
    related.sort(key=lambda item: (0 if closest(item[0]) else 1, -_popularity(item[0], songs)))
    return [song for song, _t, _o in related]


def search_songs(query: str, limit: int = 24) -> list[dict]:
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
    def fetch(kind: str, filter_name: str) -> list[dict]:
        return _ytmusic().search(q, filter=filter_name, limit=20, ignore_spelling=False)

    failures = 0
    found: dict[str, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {kind: pool.submit(fetch, kind, name) for kind, name in (("song", "songs"), ("video", "videos"))}
        for kind, future in futures.items():
            try:
                found[kind] = future.result()
            except Exception:  # network trouble, a changed response, an upstream block...
                failures += 1
                found[kind] = []
    if failures == 2:
        raise SearchUnavailable("YouTube Music did not answer")

    # Official songs and the other versions of the song alternate, best of each first.
    ranked: list[dict] = []
    seen: set[str] = set()
    songs_found = [x for x in (_song(i, "song") for i in found["song"]) if x]
    videos_found = [x for x in (_song(i, "video") for i in found["video"]) if x]
    for index in range(max(len(songs_found), len(videos_found))):
        for group in (songs_found, videos_found):
            if index < len(group) and group[index]["videoId"] not in seen:
                seen.add(group[index]["videoId"])
                ranked.append(group[index])
    songs = ranked
    songs = _related(songs, q)
    with _cache_lock:
        if len(_cache) > 500:  # keep it small
            _cache.clear()
        _cache[key] = (now, songs)
    return songs[:limit]


_suggest_cache: dict[str, tuple[float, dict]] = {}


def suggest(query: str, songs_limit: int = 6, queries_limit: int = 4) -> dict:
    """What to offer while somebody is still typing: a few songs that can be opened straight away, and a few likely searches
    (YouTube Music's own autocomplete). Light on purpose, since it runs as people type: one request for each, in parallel."""
    q = clean_query(query)
    if len(q) < 2:
        return {"songs": [], "queries": []}
    key = q.lower()
    now = time.monotonic()
    with _cache_lock:
        hit = _suggest_cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]

    def songs() -> list[dict]:
        found = [_song(item, "song") for item in _ytmusic().search(q, filter="songs", limit=10, ignore_spelling=False)]
        return [x for x in found if x][:songs_limit]

    def texts() -> list[str]:
        seen = {key}
        out: list[str] = []
        for text in _ytmusic().get_search_suggestions(q):
            clean = clean_query(text)
            if clean and clean.lower() not in seen:
                seen.add(clean.lower())
                out.append(clean)
        return out[:queries_limit]

    failures = 0
    result: dict[str, list] = {"songs": [], "queries": []}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {"songs": pool.submit(songs), "queries": pool.submit(texts)}
        for name, future in futures.items():
            try:
                result[name] = future.result()
            except Exception:
                failures += 1
    if failures == 2:
        raise SearchUnavailable("YouTube Music did not answer")
    with _cache_lock:
        if len(_suggest_cache) > 500:
            _suggest_cache.clear()
        _suggest_cache[key] = (now, result)
    return result


def _length(text: str) -> int:
    """'4:08' -> 248 seconds; '1:02:03' -> 3723; anything else -> 0."""
    parts = [int(p) for p in re.findall(r"\d+", text or "")]
    seconds = 0
    for part in parts[-3:]:
        seconds = seconds * 60 + part
    return seconds if len(parts) >= 2 else 0


_radio_cache: dict[str, tuple[float, tuple[dict, list[dict]]]] = {}
RADIO_SECONDS = 6 * 3600


def radio(video_id: str, limit: int = 30) -> tuple[dict, list[dict]]:
    """YouTube Music's own "songs like this" for a track: the same movie or album first, then songs with the same language,
    mood and style, whether or not anybody has chordified them. Returns the song itself (its album and artists, for comparing)
    and the songs like it. Raises SearchUnavailable when YouTube Music does not answer."""
    now = time.monotonic()
    with _cache_lock:
        hit = _radio_cache.get(video_id)
        if hit and now - hit[0] < RADIO_SECONDS:
            return hit[1][0], hit[1][1][:limit]
    try:
        tracks = _ytmusic().get_watch_playlist(videoId=video_id, radio=True, limit=limit)["tracks"]
    except Exception as exc:
        raise SearchUnavailable("YouTube Music did not answer") from exc
    seed: dict = {}
    out: list[dict] = []
    for item in tracks:
        seconds = _length(item.get("length", ""))
        title = (item.get("title") or "").strip()
        if not item.get("videoId") or not title:
            continue
        album = item.get("album") or {}
        song = {
            "videoId": item["videoId"],
            "kind": "song",
            "title": title,
            "artist": ", ".join(a.get("name", "") for a in item.get("artists") or [] if a.get("name")),
            "album": album.get("name", "") if isinstance(album, dict) else "",
            "duration": seconds,
            "thumbnail": _thumbnail(item.get("thumbnail") or item.get("thumbnails") or []),
        }
        if item["videoId"] == video_id:
            seed = song
        elif seconds <= MAX_SONG_SECONDS:
            out.append(song)
    with _cache_lock:
        if len(_radio_cache) > 500:
            _radio_cache.clear()
        _radio_cache[video_id] = (now, (seed, out))
    return seed, out[:limit]


def find_video(title: str, artist: str = "") -> str:
    """The id of the official track that matches a title and artist, '' when there is none (for songs that were uploaded, not found
    on YouTube, so the same radio can be asked for them)."""
    query = clean_query(f"{title} {artist.split(',')[0]}")
    if len(query) < 2:
        return ""
    try:
        found = [_song(item, "song") for item in _ytmusic().search(query, filter="songs", limit=3, ignore_spelling=False)]
    except Exception as exc:
        raise SearchUnavailable("YouTube Music did not answer") from exc
    found = [x for x in found if x]
    return found[0]["videoId"] if found else ""


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

    def retry_after(self, caller: str) -> float:
        """Seconds until this caller may go again (0 if they may now)."""
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._calls.get(caller, []) if now - t < self._window]
            return 0.0 if len(recent) < self._limit else max(0.0, self._window - (now - recent[0]))

    def refund(self, caller: str) -> None:
        """Gives back the call just allowed (the work it was for never started)."""
        with self._lock:
            if self._calls.get(caller):
                self._calls[caller].pop()
