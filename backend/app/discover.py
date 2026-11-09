"""The extra shelves on the home page: songs picked for the visitor, what is popular in their country, and the artists people listen to.

All of it comes from YouTube Music, like the trending shelves, and all of it is cached in memory so that a visitor never waits for it twice:

* taste: YouTube Music's "songs like this" (search.radio) for a few songs the visitor played or kept (their library when they are signed in,
  otherwise the songs this browser sent), mixed so that every one of those songs contributes, without the songs they already know;
* country: the country's own chart of the most-watched music videos of the day;
* artists: the country's chart of artists, with their pictures.

Only metadata is read here. Whether a song has been chordified (its chords and jam count) is added per request by main.py.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from .search import SearchUnavailable, _ytmusic, radio
from .similar import same_song
from .trending import PER_SHELF, _track

log = logging.getLogger("chordify.discover")

CHART_SECONDS = 3600  # a country's charts move daily at most
TASTE_SECONDS = 1800
TASTE_SHELF = 18  # songs on the "your taste" shelf
MAX_SEEDS = 4
ARTISTS_MAX = 40
GLOBAL = "ZZ"  # YouTube Music's code for the world's charts

_lock = threading.Lock()
_charts: dict[str, tuple[float, dict]] = {}
_country_songs: dict[str, tuple[float, list[dict]]] = {}
_taste: dict[tuple, tuple[float, list[dict], list[str]]] = {}
_supported: tuple[float, set[str]] = (0.0, set())


def _chart(code: str) -> dict:
    """A country's chart page (its video playlists and artists), kept for CHART_SECONDS."""
    now = time.monotonic()
    with _lock:
        hit = _charts.get(code)
        if hit and now - hit[0] < CHART_SECONDS:
            return hit[1]
    data = _ytmusic().get_charts(code)
    with _lock:
        if len(_charts) > 80:
            _charts.clear()
        _charts[code] = (now, data)
        if code == GLOBAL or not _supported[1]:
            _remember_supported(data)
    return data


def _remember_supported(data: dict) -> None:
    global _supported
    options = (data.get("countries") or {}).get("options") or []
    codes = {str(c).upper() for c in options if isinstance(c, str)}
    if codes:
        _supported = (time.monotonic(), codes)


def supported(code: str) -> bool:
    """Whether YouTube Music has charts for this country code."""
    code = (code or "").upper()
    if not (len(code) == 2 and code.isalpha()):
        return False
    if not _supported[1]:
        try:
            _chart("IN")
        except Exception:
            return False
    return code in _supported[1]


def country_songs(code: str) -> list[dict]:
    """The country's most-watched music videos of the day, as songs (empty if it has no charts or YouTube Music does not answer)."""
    code = (code or "").upper()
    if code == GLOBAL or not supported(code):
        return []
    now = time.monotonic()
    with _lock:
        hit = _country_songs.get(code)
        if hit and now - hit[0] < CHART_SECONDS:
            return hit[1]
    try:
        videos = _chart(code).get("videos") or []
        entry = next((v for v in videos if "daily top music videos" in (v.get("title") or "").lower()), None) or (videos[0] if videos else None)
        if not entry or not entry.get("playlistId"):
            return []
        items = _ytmusic().get_playlist(entry["playlistId"], limit=PER_SHELF + 15, related=False, suggestions_limit=0)["tracks"]
    except Exception as exc:
        log.warning("Could not read the %s chart: %s", code, exc)
        with _lock:
            old = _country_songs.get(code)
        return old[1] if old else []
    songs: list[dict] = []
    seen: set[str] = set()
    for item in items:
        song = _track(item)
        if song and song["videoId"] not in seen:
            seen.add(song["videoId"])
            songs.append(song)
    songs = songs[:PER_SHELF]
    with _lock:
        _country_songs[code] = (now, songs)
    return songs


def _picture(thumbnails: list[dict]) -> str:
    """The biggest picture of an artist, asked for at 240 px square (these links take their size from the end of the address)."""
    if not thumbnails:
        return ""
    import re

    url = max(thumbnails, key=lambda t: t.get("width", 0)).get("url", "")
    return re.sub(r"=w\d+-h\d+", "=w240-h240", url)


def artists(code: str) -> list[dict]:
    """The artists people in this country listen to most, with their pictures: the country's chart, or the world's when it has none."""
    code = (code or "").upper()
    order = [code] if code != GLOBAL and supported(code) else []
    order.append(GLOBAL)
    for c in order:
        try:
            chart = _chart(c)
        except Exception as exc:
            log.warning("Could not read the %s artists: %s", c, exc)
            continue
        out = []
        for a in chart.get("artists") or []:
            name = (a.get("title") or "").strip()
            image = _picture(a.get("thumbnails") or [])
            if name and image:
                out.append({"name": name, "image": image, "id": a.get("browseId") or "", "subscribers": a.get("subscribers") or ""})
        if out:
            return out[:ARTISTS_MAX]
    return []


def taste(seeds: list[str], skip: set[str]) -> tuple[list[dict], list[str]]:
    """Songs for somebody who played these (the most recent first): YouTube Music's "songs like this" for each, taken in turns so that
    every seed counts, without the seeds themselves or any song in `skip`. Returns the songs and the titles of the seeds they came from."""
    seeds = [s for s in dict.fromkeys(seeds)][:MAX_SEEDS]
    if not seeds:
        return [], []
    key = tuple(sorted(seeds))
    now = time.monotonic()
    with _lock:
        hit = _taste.get(key)
        if hit and now - hit[0] < TASTE_SECONDS:
            songs, based = hit[1], hit[2]
        else:
            songs = None
    if songs is None:
        def one(video_id: str):
            try:
                return radio(video_id, limit=24)
            except SearchUnavailable:
                return None
            except Exception as exc:  # a changed answer from YouTube Music must not break the home page
                log.warning("Songs like %s failed: %s", video_id, exc)
                return None

        with ThreadPoolExecutor(max_workers=MAX_SEEDS) as pool:
            answers = list(pool.map(one, seeds))
        lists = [(a[0], a[1]) for a in answers if a]
        taken: list[dict] = []
        out: list[dict] = []
        i = 0
        while len(out) < TASTE_SHELF * 2 and any(i < len(l[1]) for l in lists):
            for _seed, related in lists:
                if i < len(related):
                    song = related[i]
                    if song["videoId"] in seeds or any(song["videoId"] == t["videoId"] or same_song(song, t) for t in taken):
                        continue
                    taken.append(song)
                    out.append(song)
            i += 1
        songs = out
        based = [(a[0] or {}).get("title", "") for a in answers if a and (a[0] or {}).get("title")]
        with _lock:
            if len(_taste) > 300:
                _taste.clear()
            _taste[key] = (now, songs, based)
    shown = [s for s in songs if s["videoId"] not in skip][:TASTE_SHELF]
    return shown, based
