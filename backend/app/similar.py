"""Songs like the one being played, for the shelf under the player.

Songs people have already chordified come first, ranked by how alike they are: the same artist, the same key (or its
relative), a close tempo and the chords they share. When the catalog is too small to fill the shelf, the rest are other songs
by the same artist and, last, the most played songs on the site. Every song says why it is there.
"""
from __future__ import annotations

import math
import re
from typing import Iterable

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}

SHELF = 15  # songs on the shelf at most
WANTED = 10  # fewer than this and the shelf is topped up


def parse_key(key: str) -> tuple[int, bool] | None:
    """(pitch class of the tonic, is minor) from "G", "F#m", "G major", "B minor"; None when it cannot be read."""
    m = re.match(r"^\s*([A-G][#b]?)\s*(m|min|minor|major|maj)?\b", key or "", re.I)
    if not m:
        return None
    tonic = m.group(1)[0].upper() + m.group(1)[1:]
    tonic = FLATS.get(tonic, tonic)
    if tonic not in NOTES:
        return None
    minor = (m.group(2) or "").lower() in ("m", "min", "minor")
    return NOTES.index(tonic), minor


def key_closeness(a: str, b: str) -> float:
    """1 for the same key, 0.6 for a relative major/minor pair, 0 otherwise."""
    ka, kb = parse_key(a), parse_key(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    (ta, ma), (tb, mb) = ka, kb
    if ma != mb:
        minor_tonic, major_tonic = (ta, tb) if ma else (tb, ta)
        if (minor_tonic + 3) % 12 == major_tonic:
            return 0.6
    return 0.0


def normal(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def same_artist(a: str, b: str) -> bool:
    """Artists match when one name holds the other ("Eagles" and "Eagles, Don Henley"); credits are split on commas and "&"."""
    names_a = {normal(x) for x in re.split(r",|&| and | feat\.? | ft\.? ", a or "") if normal(x)}
    names_b = {normal(x) for x in re.split(r",|&| and | feat\.? | ft\.? ", b or "") if normal(x)}
    return bool(names_a & names_b)


def same_song(a: dict, b: dict) -> bool:
    ta, tb = normal(re.sub(r"[\(\[].*?[\)\]]", "", a.get("title", ""))), normal(re.sub(r"[\(\[].*?[\)\]]", "", b.get("title", "")))
    return bool(ta) and (ta == tb or (len(ta) > 5 and ta in tb) or (len(tb) > 5 and tb in ta))


def chord_overlap(a: Iterable[str], b: Iterable[str]) -> float:
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb) if sa and sb else 0.0


def score(current: dict, song: dict) -> tuple[float, str]:
    """How alike two songs are, and the main reason (what to tell the player)."""
    parts: list[tuple[float, str]] = []
    if same_artist(current.get("artist", ""), song.get("artist", "")):
        parts.append((5.0, "Same artist"))
    key = key_closeness(current.get("key", ""), song.get("key", ""))
    if key:
        parts.append((2.4 * key, "Same key" if key == 1.0 else "Related key"))
    overlap = chord_overlap(current.get("chords", []), song.get("chords", []))
    if overlap >= 0.34:
        parts.append((4.0 * overlap, "Similar chords"))
    tempo_a, tempo_b = float(current.get("tempo") or 0), float(song.get("tempo") or 0)
    if tempo_a > 0 and tempo_b > 0:
        gap = abs(tempo_a - tempo_b) / tempo_a
        if gap <= 0.12:
            parts.append((1.5 * (1 - gap / 0.12), "Similar tempo"))
    total = sum(p for p, _ in parts) + min(math.log1p(song.get("jams", 0)) * 0.15, 0.6)
    reason = max(parts, key=lambda p: p[0])[1] if parts else ""
    return total, reason


def similar(current: dict, catalog_songs: list[dict], more_by_artist, popular: list[dict]) -> list[dict]:
    """The shelf. `current` has title, artist, key, tempo, chords and videoId; `more_by_artist` is a function that returns other
    songs by the artist (it may be slow or fail, so it is only called when the catalog cannot fill the shelf)."""
    out: list[dict] = []
    taken: list[dict] = [current]

    def add(song: dict, reason: str) -> None:
        if len(out) >= SHELF or song.get("videoId") == current.get("videoId"):
            return
        if any(same_song(song, other) or song.get("videoId") == other.get("videoId") for other in taken):
            return
        taken.append(song)
        out.append({**song, "why": reason})

    ranked = sorted(((score(current, song), song) for song in catalog_songs), key=lambda item: -item[0][0])
    for (points, reason), song in ranked:
        if points < 1.5:
            break
        add(song, reason)

    if len(out) < WANTED and current.get("artist"):
        try:
            for song in more_by_artist():
                if same_artist(current.get("artist", ""), song.get("artist", "")):
                    add(song, "More by " + current["artist"].split(",")[0].strip())
        except Exception:  # the search may be down; the shelf is made from what there is
            pass

    for song in popular:
        if len(out) >= WANTED:
            break
        add(song, "Popular on Chord Suno")
    return out
