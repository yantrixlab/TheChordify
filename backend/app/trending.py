"""The shelves under the home page's search box: what is trending on YouTube Music right now, by language and style.

Each shelf comes from one of YouTube Music's own chart playlists ("Trending 20 United States", "Top Weekly Videos Hindi"...)
or, for the evergreen shelf, from a search. They are found by name each time, because chart playlist ids change.
Everything is fetched in parallel, kept in memory for a few hours, and saved through `save` so that a freshly deployed server
has shelves to show at once. If YouTube Music cannot be reached the last good shelves keep being served.

Only metadata is read here. Whether a song is already chordified (its chords and jam count) is added per request by main.py,
since that changes all the time while the shelves do not.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

from .search import _song, _ytmusic

log = logging.getLogger("chordify.trending")

REFRESH_SECONDS = 3 * 3600
PER_SHELF = 20
MIN_PER_SHELF = 4  # a shelf with fewer songs than this looks broken, so it is left out

# (id, title, one line under the title, where the songs come from)
#   chart:  (country, group in that country's charts, words in the playlist's name)
#   search: a YouTube Music song search
_SHELVES: list[dict] = [
    {"id": "english", "title": "Trending in English", "about": "What the world is playing right now",
     "chart": ("US", "videos", "Daily Top Music Videos")},
    {"id": "hindi", "title": "Trending in Hindi", "about": "This week's most-watched Hindi songs",
     "chart": ("IN", "languages", "Hindi")},
    {"id": "india", "title": "Trending in India", "about": "Across every language, updated daily",
     "chart": ("IN", "videos", "Trending 20")},
    {"id": "pop", "title": "Pop hits", "about": "Easy to sing, easy to strum",
     "chart": ("US", "genres", "Pop")},
    {"id": "rock", "title": "Rock for guitarists", "about": "Riffs and chords to play along with",
     "chart": ("US", "genres", "Rock")},
    {"id": "punjabi", "title": "Punjabi hits", "about": "This week's most-watched Punjabi songs",
     "chart": ("IN", "languages", "Punjabi")},
    {"id": "evergreen", "title": "Evergreen Hindi classics", "about": "Songs everyone knows by heart",
     "search": "evergreen old hindi songs classics"},
]

_lock = threading.Lock()
_state: dict = {"at": 0.0, "shelves": []}
_refreshing = threading.Event()
_first_build = threading.Lock()  # many first visitors at once should cause one fetch, not many


def _track(item: dict) -> Optional[dict]:
    kind = "song" if item.get("videoType") == "MUSIC_VIDEO_TYPE_ATV" else "video"
    if item.get("isAvailable") is False:
        return None
    song = _song(item, kind)
    if song and kind == "video":
        song["thumbnail"] = f"https://i.ytimg.com/vi/{song['videoId']}/mqdefault.jpg"  # the 16:9 frame, without black bars
    return song


def _shelf_songs(spec: dict, charts: dict[str, dict]) -> list[dict]:
    if "search" in spec:
        items = _ytmusic().search(spec["search"], filter="songs", limit=PER_SHELF + 10, ignore_spelling=True)
    else:
        country, group, needle = spec["chart"]
        entry = next((e for e in charts.get(country, {}).get(group, []) if needle.lower() in e["title"].lower()), None)
        if not entry:
            return []
        items = _ytmusic().get_playlist(entry["playlistId"], limit=PER_SHELF + 15, related=False, suggestions_limit=0)["tracks"]
    songs: list[dict] = []
    seen: set[str] = set()
    for item in items:
        song = _track(item)
        if song and song["videoId"] not in seen:
            seen.add(song["videoId"])
            songs.append(song)
    return songs[:PER_SHELF]


def _build() -> list[dict]:
    countries = sorted({spec["chart"][0] for spec in _SHELVES if "chart" in spec})
    charts: dict[str, dict] = {}
    for country in countries:
        try:
            charts[country] = _ytmusic().get_charts(country)
        except Exception as exc:
            log.warning("Could not read the %s charts: %s", country, exc)

    def one(spec: dict) -> Optional[dict]:
        try:
            songs = _shelf_songs(spec, charts)
        except Exception as exc:
            log.warning("Could not build the %s shelf: %s", spec["id"], exc)
            return None
        if len(songs) < MIN_PER_SHELF:
            return None
        return {"id": spec["id"], "title": spec["title"], "about": spec["about"], "songs": songs}

    with ThreadPoolExecutor(max_workers=4) as pool:
        built = list(pool.map(one, _SHELVES))
    return [shelf for shelf in built if shelf]


def refresh(save: Optional[Callable[[dict], None]] = None) -> None:
    """Rebuilds the shelves (slow: a few seconds of network). Keeps the old ones if nothing could be built."""
    try:
        shelves = _build()
    except Exception as exc:
        log.warning("Trending refresh failed: %s", exc)
        return
    if not shelves:
        return
    with _lock:
        _state["shelves"], _state["at"] = shelves, time.time()
    if save:
        try:
            save({"at": _state["at"], "shelves": shelves})
        except Exception as exc:
            log.warning("Could not save the trending shelves: %s", exc)


def _refresh_in_background(save) -> None:
    if _refreshing.is_set():
        return
    _refreshing.set()

    def work() -> None:
        try:
            refresh(save)
        finally:
            _refreshing.clear()

    threading.Thread(target=work, daemon=True).start()


def start(load: Callable[[], Optional[dict]], save: Callable[[dict], None]) -> None:
    """Called once at startup: shows what was saved last time straight away, and fetches fresh shelves in the background."""
    try:
        saved = load()
    except Exception as exc:
        log.warning("Could not read the saved trending shelves: %s", exc)
        saved = None
    if saved and saved.get("shelves"):
        with _lock:
            _state["shelves"], _state["at"] = saved["shelves"], float(saved.get("at") or 0)
    if time.time() - _state["at"] > REFRESH_SECONDS:
        _refresh_in_background(save)


def shelves(save: Optional[Callable[[dict], None]] = None) -> list[dict]:
    """The current shelves; older than a few hours, they are refreshed in the background while these are served."""
    with _lock:
        current, age = list(_state["shelves"]), time.time() - _state["at"]
    if not current:
        with _first_build:  # the very first request of a server with nothing saved: wait for it once
            with _lock:
                have = bool(_state["shelves"])
            if not have:
                refresh(save)
        with _lock:
            return list(_state["shelves"])
    if age > REFRESH_SECONDS:
        _refresh_in_background(save)
    return current
