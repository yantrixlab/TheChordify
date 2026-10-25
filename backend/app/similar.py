"""Songs like the one being played, for the shelf under the player.

The songs come from YouTube Music's own "songs like this" for the track (search.radio): the same movie or album first, then songs
with the same language, mood and style. They do not have to have been chordified: a song nobody has opened yet is still a good
suggestion, and opening it gets its chords. Songs that have been chordified come with their main chords. Every song says why it is
there. Nothing is picked from the catalog by chords or key alone: that mixed Hindi, English and Bengali songs on one shelf.
"""
from __future__ import annotations

import re

SHELF = 15  # songs on the shelf at most
WANTED = 8  # fewer than this and the shelf is topped up with other songs by the same artist
FIRST_MATCHES = 6  # songs of the same album or artist that go first


def normal(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def _names(artists: str) -> set[str]:
    return {normal(x) for x in re.split(r",|&| and | feat\.? | ft\.? | x ", artists or "") if normal(x)}


def same_artist(a: str, b: str) -> bool:
    """Artists match when they share a name ("Sharman Joshi, Suraj Jagan" and "Suraj Jagan")."""
    return bool(_names(a) & _names(b))


def _title(song: dict) -> str:
    return normal(re.sub(r"[\(\[].*?[\)\]]", "", song.get("title", "")))


def same_song(a: dict, b: dict) -> bool:
    """The same song under another upload or version: equal titles, or one holding the other."""
    ta, tb = _title(a), _title(b)
    return bool(ta) and bool(tb) and (ta == tb or (len(ta) > 5 and ta in tb) or (len(tb) > 5 and tb in ta))


def shelf(current: dict, related: list[dict], known: dict[str, dict], same_artist_catalog: list[dict] | None = None) -> list[dict]:
    """The shelf. `current` has title, artist, album and videoId; `related` is YouTube Music's list of songs like it, best first;
    `known` is what the catalog holds (chords, jam count) for the ones that have been chordified."""
    out: list[dict] = []
    taken: list[dict] = [current]

    def add(song: dict, reason: str) -> None:
        if len(out) >= SHELF or song.get("videoId") == current.get("videoId"):
            return
        if any(song.get("videoId") == other.get("videoId") or same_song(song, other) for other in taken):
            return
        taken.append(song)
        out.append({**song, **known.get(song["videoId"], {}), "why": reason})

    def why(song: dict) -> str:
        album = normal(song.get("album", ""))
        if album and album == normal(current.get("album", "")):
            return "Same album"
        if same_artist(current.get("artist", ""), song.get("artist", "")):
            return "Same artist"
        return "Similar vibe"

    # The same movie or album, or the same artist, first (in the order YouTube Music gave them), then the rest as they came.
    close = [song for song in related if why(song) != "Similar vibe"][:FIRST_MATCHES]
    for song in close:
        add(song, why(song))
    for song in related:
        add(song, why(song))

    if len(out) < WANTED:
        for song in same_artist_catalog or []:
            if same_artist(current.get("artist", ""), song.get("artist", "")):
                add(song, "Same artist")
    return out
