"""Editing a chordified song by hand, from the admin: what an editor may send, how it is checked, and the versions that are kept.

A saved result (the song's chords, bars, strumming) is what the website and the app draw. An editor changes three parts of it:

  chords           the simple chords (what everybody sees)           [{start, end, chord, confidence, gridStart}]
  chordsDetailed   every chord kind the detector heard (the Detail toggle)
  strum            the strumming patterns                            {v, perBar, bpm, patterns: [{pattern, sub, ...}]}

A chord's cell on the chart comes from its time (gridStart, else start, matched to the nearest beat), so moving a chord to another cell is
a change of that time; the pages do that and send the whole list, and this module only checks the list is sound (valid names, in order,
inside the song, one chord running into the next) before it is saved. Names are kept in the detector's convention (sharps: A#, not Bb).

Every save keeps the earlier state as a version (the first save also keeps the original analysis), up to MAX_VERSIONS, so a mistake can be
undone; versions live beside the result under the key "ver:<session id>", which is not a valid session id and so cannot be asked for.
A song with edits is marked result["edited"] and is never re-analysed by itself when the detector improves.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from typing import Any, Optional

MAX_SEGMENTS = 6000
MAX_VERSIONS = 12
MIN_SEGMENT = 0.02  # seconds: a chord shorter than this is not a chord
VERSIONS_KEY = "ver:"

_FLATS = {"Bb": "A#", "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Cb": "B", "Fb": "E"}
_NOTE = re.compile(r"^([A-G])(#|b)?")
_SUFFIX = re.compile(r"^[A-Za-z0-9+#()°ø\-]{0,10}$")


class EditError(ValueError):
    """What an editor sent cannot be saved (the message is safe to show)."""


def _note(text: str) -> tuple[str, str]:
    """(the note in sharps, what follows it) for text that starts with a note name."""
    m = _NOTE.match(text)
    if not m:
        raise EditError(f"“{text}” does not start with a note from A to G.")
    name = m.group(0)
    return _FLATS.get(name, name), text[len(name):]


def normalise_chord(raw: Any) -> str:
    """A chord name as the detector writes it: "N" for a rest, otherwise a note, a kind and maybe a bass ("Bbm7/F" -> "A#m7/F")."""
    text = str(raw or "").strip()
    if text.upper() in ("N", "REST", "𝄽"):
        return "N"
    if not text or len(text) > 16:
        raise EditError("A chord needs a name such as C, Am7 or F#m/C#.")
    body, _, bass = text.partition("/")
    root, rest = _note(body)
    if not _SUFFIX.match(rest):
        raise EditError(f"“{text}” is not a chord name.")
    name = root + rest
    if bass:
        b, tail = _note(bass)
        if tail:
            raise EditError(f"“{text}” is not a chord name (the bass after the slash is one note).")
        name += "/" + b
    return name


def _number(value: Any, what: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise EditError(f"{what} must be a number.") from None
    if number != number or number in (float("inf"), float("-inf")):
        raise EditError(f"{what} must be a number.")
    return number


def clean_chords(segments: Any, duration: float, what: str = "chords") -> list[dict]:
    """The list of chords an editor sent, checked and tidied: valid names, in time order, each running into the next, the first from the
    start of the song and the last to its end. Raises EditError with a sentence when something is wrong."""
    if not isinstance(segments, list) or not segments:
        raise EditError(f"The {what} list is empty.")
    if len(segments) > MAX_SEGMENTS:
        raise EditError(f"The {what} list is too long.")
    limit = max(duration, 1.0) + 1.0
    out: list[dict] = []
    for i, seg in enumerate(segments):
        if not isinstance(seg, dict):
            raise EditError(f"Chord {i + 1} of the {what} is not valid.")
        start = _number(seg.get("start"), "A chord's start time")
        if not -0.001 <= start <= limit:
            raise EditError(f"A chord starts at {start:.1f}s, outside the song.")
        grid = seg.get("gridStart")
        grid = None if grid is None else _number(grid, "A chord's beat time")
        if grid is not None and not -0.001 <= grid <= limit:
            raise EditError(f"A chord sits on a beat at {grid:.1f}s, outside the song.")
        try:
            confidence = max(0.0, min(2.0, float(seg.get("confidence", 1.0))))
        except (TypeError, ValueError):
            confidence = 1.0
        item = {"start": max(0.0, start), "end": 0.0, "chord": normalise_chord(seg.get("chord")), "confidence": round(confidence, 2), "gridStart": grid}
        if seg.get("edited"):
            item["edited"] = True
        out.append(item)
    out.sort(key=lambda s: s["start"])
    # the song starts with something (a rest, if nothing sounds yet), and each chord runs until the next begins
    if out[0]["start"] > 0.001:
        out.insert(0, {"start": 0.0, "end": 0.0, "chord": "N", "confidence": 1.0, "gridStart": 0.0})
    for a, b in zip(out, out[1:]):
        if b["start"] - a["start"] < MIN_SEGMENT:
            b["start"] = a["start"] + MIN_SEGMENT
        a["end"] = b["start"]
    out[-1]["end"] = max(out[-1]["start"] + MIN_SEGMENT, duration)
    return out


def clean_strum(strum: Any, per_bar_fallback: int = 4, previous: Optional[dict] = None) -> Optional[dict]:
    """The strumming an editor sent, in the form the detector writes. A pattern is a row of D (down), U (up) and - (nothing), `sub` slots to
    a beat (2: eighths, 4: sixteenths), so a bar of 4 beats has 8 or 16. An edited pattern is marked kind "edited". None when there are no
    patterns left (the song then shows no strumming)."""
    from .strum import _easy, label

    if strum is None:
        return None
    if not isinstance(strum, dict):
        raise EditError("The strumming is not valid.")
    per_bar = int(strum.get("perBar") or per_bar_fallback or 4)
    if not 2 <= per_bar <= 12:
        raise EditError("The beats to a bar must be between 2 and 12.")
    raw = strum.get("patterns")
    if not isinstance(raw, list):
        raise EditError("The strumming needs a list of patterns.")
    if len(raw) > 8:
        raise EditError("A song can have at most 8 strumming patterns.")
    patterns = []
    for n, p in enumerate(raw, 1):
        if not isinstance(p, dict):
            raise EditError(f"Strumming pattern {n} is not valid.")
        sub = int(p.get("sub") or 2)
        if sub not in (2, 4):
            raise EditError(f"Strumming pattern {n}: use eighths (2 to a beat) or sixteenths (4 to a beat).")
        slots = p.get("pattern")
        if not isinstance(slots, list) or len(slots) != per_bar * sub or any(s not in ("D", "U", "-") for s in slots):
            raise EditError(f"Strumming pattern {n} needs {per_bar * sub} slots, each D, U or a rest.")
        if not any(s in ("D", "U") for s in slots):
            raise EditError(f"Strumming pattern {n} has no strokes in it.")
        where = [str(w).strip()[:24] for w in (p.get("where") or []) if str(w).strip()][:8]
        patterns.append({
            "pattern": list(slots),
            "sub": sub,
            "kind": "edited",
            "confidence": 1.0,
            "where": where,
            "bars": max(0, int(p.get("bars") or 0)),
            "label": label(list(slots)),
            "easy": _easy(per_bar, sub),
        })
    if not patterns:
        return None
    first = patterns[0]
    base = previous or {}
    return {
        "v": 4,  # the detector's pattern format; newer than 3, so the pages show it
        "perBar": per_bar,
        "bpm": float(strum.get("bpm") or base.get("bpm") or 0),
        "patterns": patterns,
        **{k: first[k] for k in ("pattern", "sub", "kind", "confidence", "label", "easy")},
        "detected": False,
    }


def token(result: dict) -> str:
    """A short fingerprint of what an editor can change, so a save made on top of somebody else's change can be told apart."""
    body = json.dumps({"c": result.get("chords"), "d": result.get("chordsDetailed"), "s": result.get("strum")}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(body.encode("utf-8")).hexdigest()[:16]


def _changed(before: list, after: list) -> int:
    """How many chords differ between two lists (by where each starts and what it is)."""
    key = lambda s: (round(float(s.get("gridStart") if s.get("gridStart") is not None else s["start"]), 2), s["chord"])  # noqa: E731
    a, b = {key(s) for s in before or []}, {key(s) for s in after or []}
    return max(len(a - b), len(b - a))


def describe_change(before: dict, after: dict) -> str:
    parts = []
    n = _changed(before.get("chords"), after.get("chords"))
    if n:
        parts.append(f"{n} chord{'s' if n != 1 else ''}")
    d = _changed(before.get("chordsDetailed"), after.get("chordsDetailed"))
    if d and not n:
        parts.append(f"{d} detailed chord{'s' if d != 1 else ''}")
    if json.dumps(before.get("strum"), sort_keys=True) != json.dumps(after.get("strum"), sort_keys=True):
        parts.append("the strumming")
    return "Edited " + " and ".join(parts) if parts else "Saved"


def apply_edit(result: dict, *, chords: Optional[list] = None, detailed: Optional[list] = None, strum_set: bool = False,
               strum: Optional[dict] = None, by: str = "") -> dict:
    """The result with the editor's changes on it (the stored one is not touched)."""
    from .structure import estimate_key

    new = dict(result)
    if chords is not None:
        new["chords"] = chords
        key = estimate_key(chords)
        if key:
            new["key"] = key
    if detailed is not None:
        new["chordsDetailed"] = detailed
    if strum_set:
        new["strum"] = strum
    before = result.get("edited") or {}
    new["edited"] = {"at": time.time(), "by": by, "count": int(before.get("count") or 0) + 1}
    return new


# ---------------------------------------------------------------------------------------------------------------------------------
# versions
# ---------------------------------------------------------------------------------------------------------------------------------


def _state(result: dict) -> dict:
    return {k: result.get(k) for k in ("chords", "chordsDetailed", "strum", "key")}


def load_versions(catalog: Any, session_id: str) -> list[dict]:
    data = catalog.load_result(VERSIONS_KEY + session_id)
    return data.get("versions", []) if isinstance(data, dict) else []


def add_version(catalog: Any, session_id: str, result: dict, summary: str, by: str = "") -> None:
    """Keeps this state of the song as a version. The original (the first one kept) stays; the oldest of the rest go when there are too many."""
    versions = load_versions(catalog, session_id)
    versions.append({"id": uuid.uuid4().hex[:10], "at": time.time(), "by": by, "summary": summary, "token": token(result), "data": _state(result)})
    if len(versions) > MAX_VERSIONS:
        versions = versions[:1] + versions[-(MAX_VERSIONS - 1):]
    catalog.save_result(VERSIONS_KEY + session_id, {"versions": versions})


def version_list(versions: list[dict]) -> list[dict]:
    """The versions as the screen lists them (newest first), without the heavy data."""
    return [{k: v[k] for k in ("id", "at", "by", "summary", "token")} for v in reversed(versions)]


def find_version(versions: list[dict], version_id: str) -> Optional[dict]:
    return next((v for v in versions if v["id"] == version_id), None)


def restore(result: dict, version: dict, by: str) -> dict:
    """The result with an earlier version's chords and strumming put back."""
    new = dict(result)
    for k in ("chords", "chordsDetailed", "strum", "key"):
        if version["data"].get(k) is not None or k == "strum":
            new[k] = version["data"].get(k)
    before = result.get("edited") or {}
    new["edited"] = {"at": time.time(), "by": by, "count": int(before.get("count") or 0) + 1}
    return new
