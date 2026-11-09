"""Songs that use a chord, for the chord pages.

The chord pages (/guitar-chords/c/minor/ ...) are built into the website ahead of time, but the songs are in the database, so a page
cannot list them when it is built. Each chord page carries an empty slot (`<div class="cs-songs-slot" data-chord="C#:m">`), and the
server fills it with the published songs that use that chord when it sends the page. The words are in the HTML the search engines
read, and the songs link to the chord pages and the chord pages link back to the songs.

The addresses and names below mirror absolute-ablation/src/lib/chordCatalog.ts (the same twelve notes and kinds of chord);
scripts/check_chord_songs.py checks that they still agree.
"""

from __future__ import annotations

import json
import re
import time
from typing import Optional

INSTRUMENTS = ("guitar", "piano", "ukulele", "mandolin")

# note name as the site writes it (sharps) -> the address part, short name and the other name of a black key
ROOTS: dict[str, tuple[str, str]] = {
    "C": ("c", "C"), "C#": ("c-sharp", "C♯"), "D": ("d", "D"), "D#": ("d-sharp", "D♯"), "E": ("e", "E"), "F": ("f", "F"),
    "F#": ("f-sharp", "F♯"), "G": ("g", "G"), "G#": ("g-sharp", "G♯"), "A": ("a", "A"), "A#": ("a-sharp", "A♯"), "B": ("b", "B"),
}
SLUG_TO_ROOT = {slug: name for name, (slug, _) in ROOTS.items()}

# chord suffix -> the address part of its page
KINDS: dict[str, str] = {
    "": "major", "m": "minor", "5": "power", "6": "sixth", "m6": "minor-sixth", "7": "seventh", "maj7": "major-seventh", "m7": "minor-seventh",
    "mMaj7": "minor-major-seventh", "m7b5": "half-diminished", "dim7": "diminished-seventh", "7sus4": "seventh-sus4", "7b5": "seventh-flat5",
    "7#5": "seventh-sharp5", "sus2": "sus2", "sus4": "sus4", "dim": "diminished", "aug": "augmented", "9": "ninth", "m9": "minor-ninth",
    "maj9": "major-ninth", "add9": "add9", "madd9": "minor-add9", "7b9": "seventh-flat9", "7#9": "seventh-sharp9", "11": "eleventh",
    "m11": "minor-eleventh", "13": "thirteenth",
}
ID_TO_SUFFIX = {kind_id: suffix for suffix, kind_id in KINDS.items()}

_CHORD = re.compile(r"^([A-G]#?)([^/]*)$")  # a slash chord (C/E) is not the plain chord, so it is left out


def parse_chord(label: str) -> Optional[tuple[str, str]]:
    """'C#m7' -> ('C#', 'm7'); None for a slash chord, 'N', or a kind the chord pages do not have."""
    m = _CHORD.match((label or "").strip())
    if not m or m.group(2) not in KINDS:
        return None
    return m.group(1), m.group(2)


def chord_page(label: str, instrument: str = "guitar") -> Optional[str]:
    """The address of the page for a chord as a song writes it ('C#m7'), or None."""
    parsed = parse_chord(label)
    if not parsed or instrument not in INSTRUMENTS:
        return None
    root, suffix = parsed
    return f"/{instrument}-chords/{ROOTS[root][0]}/{KINDS[suffix]}/"


def _esc(text: object) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _short(root: str, suffix: str) -> str:
    return ROOTS[root][1] + suffix.replace("b", "♭").replace("#", "♯")


_SLOT = re.compile(r'<div class="cs-songs-slot" data-chord="([^"]*)"></div>')
_TTL = 300  # seconds a song list is kept: a song published a minute ago shows up within five


class ChordSongs:
    def __init__(self, song_pages) -> None:
        self._pages = song_pages
        self._built = 0.0
        self._by_chord: dict[tuple[str, str], list[dict]] = {}

    def _index(self) -> dict[tuple[str, str], list[dict]]:
        now = time.time()
        if now - self._built < _TTL and self._built:
            return self._by_chord
        by_chord: dict[tuple[str, str], list[dict]] = {}
        # the most played first, so the songs people know come ahead of the newest
        for row in sorted(self._pages.published(500), key=lambda r: (-(r.get("jams") or 0), -r["published_at"])):
            try:
                chords = json.loads(row.get("chords") or "[]")
            except ValueError:
                continue
            seen: set[tuple[str, str]] = set()
            for label in chords:
                parsed = parse_chord(label)
                if parsed and parsed not in seen:
                    seen.add(parsed)
                    by_chord.setdefault(parsed, []).append(row)
        self._by_chord, self._built = by_chord, now
        return by_chord

    def songs(self, root: str, suffix: str) -> list[dict]:
        return self._index().get((root, suffix), [])

    def section(self, root: str, suffix: str, limit: int = 8) -> str:
        """The block for the page of one chord, or '' when no published song uses it."""
        rows = self.songs(root, suffix)
        if not rows:
            return ""
        name = _short(root, suffix)
        cards = []
        for r in rows[:limit]:
            others = []
            try:
                for label in json.loads(r.get("chords") or "[]"):
                    if label != f"{root}{suffix}" and label not in others and label != "N":
                        others.append(label)
            except ValueError:
                pass
            facts = " · ".join(x for x in (f"Key of {r['song_key']}" if r.get("song_key") else "", f"{int(round(r['tempo']))} BPM" if r.get("tempo") else "") if x)
            cards.append(
                f'<a class="cs-song" href="/songs/{_esc(r["slug"])}/">'
                f'<img src="https://i.ytimg.com/vi/{_esc(r["video_id"])}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy" />'
                f'<span class="cs-song-body"><strong>{_esc(r["title"])}</strong>'
                + (f"<small>{_esc(r['artist'])}</small>" if r.get("artist") else "")
                + (f'<span class="cs-song-facts">{_esc(facts)}</span>' if facts else "")
                + (f'<span class="cs-song-chords">{"".join(f"<i>{_esc(c)}</i>" for c in others[:5])}</span>' if others else "")
                + "</span></a>"
            )
        total = len(rows)
        lead = (
            f"{name} is played in {total} song{'s' if total != 1 else ''} on Chord Suno. "
            "Open one to see the chord on the beat, with the rest of the song's chords."
        )
        return (
            '<section class="ch-in ch-sec cs-songs" id="songs">'
            '<span class="ch-kicker">In real songs</span>'
            f"<h2>Songs that use {_esc(name)}</h2><p>{_esc(lead)}</p>"
            f'<div class="cs-song-grid">{"".join(cards)}</div>'
            + (f'<p class="cs-song-more"><a href="/songs/">Browse all {len(self._pages.published(500))} songs</a></p>' if total > limit else "")
            + "</section>"
        )

    def fill(self, html: str) -> str:
        """The chord page with its slot filled in (or taken out, when there are no songs for it)."""

        def one(m: re.Match) -> str:
            root, _, suffix = m.group(1).partition(":")
            return self.section(root, suffix) if root in ROOTS and suffix in KINDS else ""

        return _SLOT.sub(one, html, count=1)
