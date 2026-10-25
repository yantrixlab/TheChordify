"""The strumming patterns of a song, read from where the strings are struck inside each bar.

A strum adds energy to the notes of the chord being played. A drum hit, a cymbal or a breath adds energy to every note alike. So for
every moment of the recording the energy on the chord's own notes minus its fair share of the energy everywhere else is the playing
(and sound that is the same on every note drops out). Each sudden rise of it is a strike.

Every beat of a bar is cut into four slots, a sixteenth note each ("1 e & a"). In every bar each slot either has a strike on it or not.
Between the slots are stretches where no strum can fall, and the strikes found there (other instruments, the voice) say how often a
strike lands on a slot by chance. A slot is part of the pattern when strikes land on it in many bars, and clearly more often than that.
If none of the sixteenths between the beat and the "&" is struck, the pattern is shown in eighths; if some are, in sixteenths.

Songs often play one way in the verses and another in the chorus. So the bars of each kind of section (verse, chorus...) are measured
on their own, and when they come out different the song gets a pattern for each, with where it is played.

Down and up strokes cannot be heard in a recording. The usual picture of the guitar is used: the strumming hand keeps moving down and
up in eighths (or sixteenths when sixteenths are played), so a stroke on the beat is a down-strum and one on the "&" an up-strum.

The result says how sure it is ("kind"): heard (the slots are clearly struck), guess (they are struck a little, so the slots that are
are shown as a best guess) or typical (nothing stands out, as in a piano ballad, an arpeggiated intro or a loose recording, so a typical
pattern for the song's time signature is offered, marked as a suggestion).
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import librosa
import numpy as np

log = logging.getLogger("chordify.strum")

HOP = 512
SUB = 4  # slots to a beat
MIN_BARS = 14  # bars needed to tell a pattern at all
MIN_GROUP_BARS = 10  # bars of one kind of section needed to give it a pattern of its own
LOW_HZ, HIGH_HZ = 110.0, 3200.0  # the range a strummed guitar lives in; below it are the kick and the bass
STRIKE_DELTA = 0.1  # how far a rise of the chord's notes must stand out from its surroundings to be a strike
PURITY = 0.65  # and how much of the rise must be on the chord's notes (a drum hit rises on every note alike: about half)
WINDOW = 0.3  # a strike belongs to a slot when it falls within this share of a slot either side of its centre

# For each kind of slot: the share of bars that must have a strike on it, and how many standard errors that must be above the chance share.
# Beats are the surest places; the "&" is next; the "e" and "a" in between are the easiest to invent, so they must show more.
#                       (beat)      ("&")       (e, a)
HEARD = {"beat": (0.50, 3.0), "and": (0.55, 3.5), "fine": (0.60, 4.5)}
GUESS = {"beat": (0.40, 2.0), "and": (0.45, 2.5), "fine": (0.50, 3.5)}

# What to offer when the recording does not show a clear strum, by beats to the bar (two slots to a beat).
_DEFAULTS = {
    2: ["D", "-", "D", "U"],
    3: ["D", "-", "D", "U", "D", "U"],
    4: ["D", "-", "D", "U", "-", "U", "D", "U"],
    5: ["D", "-", "D", "U", "D", "-", "D", "U", "-", "U"],
    6: ["D", "-", "D", "U", "D", "U", "D", "-", "D", "U", "D", "U"],
    7: ["D", "-", "D", "U", "D", "-", "D", "U", "-", "U", "D", "U", "D", "-"],
}

_PITCH = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def _chord_tones(chord: str) -> set[int]:
    """The pitch classes of a chord's triad (root, third, fifth)."""
    m = re.match(r"^([A-G][#b]?)([^/]*)", chord or "")
    if not m or m.group(1) not in _PITCH:
        return set()
    root, quality = _PITCH[m.group(1)], m.group(2)
    third = 2 if quality.startswith("sus2") else 5 if quality.startswith("sus4") else 3 if quality.startswith(("m", "dim")) and not quality.startswith("maj") else 4
    fifth = 6 if "dim" in quality or "b5" in quality else 8 if "aug" in quality else 7
    return {root, (root + third) % 12, (root + fifth) % 12}


def _playing(y: np.ndarray, sr: int, chords: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """(energy, purity), one value per HOP samples.

    energy: the energy on the chord's own notes beyond its fair share of the rest (zero where no chord sounds).
    purity: how much of the latest rise of sound was on the chord's own notes: near 1 for a strum, about a half for a drum hit."""
    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    lo, hi = int(LOW_HZ * 2048 / sr), int(HIGH_HZ * 2048 / sr)
    band = np.zeros_like(spec)
    band[lo:hi] = spec[lo:hi]
    chroma = librosa.feature.chroma_stft(S=band**2, sr=sr, n_fft=2048, hop_length=HOP, norm=None, tuning=0.0)
    # Low notes have fewer spectrum bins than high ones, so some notes would collect more of a smear than others: level them
    flat = np.zeros((band.shape[0], 1))
    flat[lo:hi] = 1.0
    reference = librosa.feature.chroma_stft(S=flat, sr=sr, n_fft=2048, hop_length=HOP, norm=None, tuning=0.0)[:, 0]
    chroma = chroma / np.maximum(reference, 1e-9)[:, None]
    frames = chroma.shape[1]
    mask = np.zeros((12, frames), dtype=bool)
    for seg in chords:
        tones = _chord_tones(seg.get("chord", ""))
        if not tones:
            continue
        i0 = max(int(seg["start"] * sr / HOP), 0)
        i1 = min(int(seg["end"] * sr / HOP) + 1, frames)
        for t in tones:
            mask[t, i0:i1] = True
    amp = np.sqrt(chroma)  # back to an amplitude-like scale
    tone_sum = (amp * mask).sum(axis=0)
    other_sum = (amp * ~mask).sum(axis=0)
    n_tone = np.maximum(mask.sum(axis=0), 1)
    share = n_tone / np.maximum(12 - n_tone, 1)
    excess = tone_sum - share * other_sum  # zero on average for sound that is the same on every note
    rise_tone = np.maximum(np.diff(tone_sum, prepend=tone_sum[:1]), 0.0)
    rise_other = share * np.maximum(np.diff(other_sum, prepend=other_sum[:1]), 0.0)
    purity = rise_tone / (rise_tone + rise_other + 1e-9)
    purity = np.maximum.reduce([purity, np.roll(purity, 1), np.roll(purity, -1)])  # the peak may sit a frame either side
    return excess * mask.any(axis=0), purity


def _strikes(energy: np.ndarray, purity: np.ndarray) -> np.ndarray:
    """True at every frame where the chord's notes suddenly get louder (a strum, or a new chord)."""
    flux = np.maximum(np.diff(energy, prepend=energy[:1]), 0.0)
    flux = flux / (np.percentile(flux, 99) + 1e-9)
    picked = librosa.util.peak_pick(flux, pre_max=2, post_max=2, pre_avg=8, post_avg=8, delta=STRIKE_DELTA, wait=2)
    picked = picked[purity[picked] >= PURITY]  # a rise that lifted every note alike was not a strum
    out = np.zeros(len(flux), dtype=bool)
    out[picked] = True
    return out


def label(pattern: list[str]) -> str:
    return " ".join(pattern).replace("-", "–")


def _decide(on_rows: np.ndarray, off_rows: np.ndarray) -> dict:
    """The pattern that bars of strikes show. `on_rows` has a column per slot (SUB to a beat), `off_rows` the gaps between them."""
    n = len(on_rows)
    share = on_rows.mean(axis=0)
    chance = float(np.clip(off_rows.mean(), 0.02, 0.9))  # how often a strike lands where no strum can
    sure = (share - chance) / np.sqrt(chance * (1 - chance) / n)  # standard errors above chance
    kind_of = np.array(["beat" if k % SUB == 0 else "and" if k % SUB == SUB // 2 else "fine" for k in range(len(share))])
    fine = kind_of == "fine"

    def on_from(table: dict) -> np.ndarray:
        need_share = np.array([table[k][0] for k in kind_of])
        need_sure = np.array([table[k][1] for k in kind_of])
        on = (share >= need_share) & (sure >= need_sure)
        if not on[0]:
            on[0] = bool(share[0] >= table["beat"][0] * 0.8 and sure[0] >= 2.0)  # the first beat of a bar is almost always struck
        return on

    def shape(on: np.ndarray) -> tuple[list[str], int]:
        if bool(on[fine].any()):  # sixteenths are played: the hand moves down-up in sixteenths
            return [("D" if k % 2 == 0 else "U") if on[k] else "-" for k in range(len(on))], 4
        eighths = on[:: SUB // 2]  # the beat and the "&"
        return [("D" if k % 2 == 0 else "U") if eighths[k] else "-" for k in range(len(eighths))], 2

    evidence = {"share": [round(float(x), 2) for x in share], "sure": [round(float(x), 1) for x in sure], "chance": round(chance, 2)}
    on = on_from(HEARD)
    hits = int(on.sum())
    confidence = round(float(np.clip((np.median(sure[on]) - 2.0) / 7.0 + 0.2, 0.0, 1.0)), 2) if hits else 0.0
    if hits >= 2 and confidence >= 0.35:
        pattern, sub = shape(on)
        return {"pattern": pattern, "sub": sub, "kind": "heard", "confidence": confidence, "evidence": evidence}
    soft = on_from(GUESS)
    if int(soft.sum()) >= 2:
        pattern, sub = shape(soft)
        low = round(float(np.clip(np.median(sure[soft]) / 10.0, 0.05, 0.34)), 2)
        return {"pattern": pattern, "sub": sub, "kind": "guess", "confidence": low, "evidence": evidence}
    return {"pattern": [], "sub": 2, "kind": "typical", "confidence": confidence, "evidence": evidence}


def estimate_strum(
    y: np.ndarray, sr: int, bars: list[dict], per_bar: int, bpm: float, chords: Optional[list[dict]] = None, sections: Optional[list[dict]] = None
) -> Optional[dict]:
    """The song's strumming patterns, or None when they could not be worked out at all.

    {"v", "perBar", "bpm", "patterns": [{"pattern", "sub", "kind", "confidence", "where", "label", "easy", "bars"}, ...]}
    plus the first pattern's fields at the top ("pattern", "sub", "kind", "confidence", "detected", "label", "easy"), which older
    pages read."""
    try:
        per_bar = min(max(int(per_bar), 2), 7)
        full = [
            (i, b) for i, b in enumerate(bars)
            if len(b.get("beats") or []) >= per_bar + 1 and all(t is not None for t in b["beats"][: per_bar + 1])
        ]
        if len(full) < MIN_BARS or not chords:
            return _typical(per_bar, bpm)
        strikes = _strikes(*_playing(y, sr, chords))
        fps = sr / HOP

        def struck(a: float, b: float) -> bool:
            lo, hi = max(int(round(a * fps)), 0), int(round(b * fps)) + 1
            return bool(strikes[lo : max(hi, lo + 1)].any())

        index, on_rows, off_rows = [], [], []
        for i, bar in full:
            beats = [float(t) for t in bar["beats"][: per_bar + 1]]
            on_row, off_row = [], []
            for k in range(per_bar):
                period = beats[k + 1] - beats[k]
                if period <= 0.08:
                    break
                d = period / SUB
                for j in range(SUB):
                    c = beats[k] + j * d
                    on_row.append(struck(c - WINDOW * d, c + WINDOW * d))
                    off_row.append(struck(c + WINDOW * d, c + (1 - WINDOW) * d))
            if len(on_row) == per_bar * SUB:
                index.append(i)
                on_rows.append(on_row)
                off_rows.append(off_row)
        if len(on_rows) < MIN_BARS:
            return _typical(per_bar, bpm)
        on_grid, off_grid = np.array(on_rows), np.array(off_rows)

        overall = _decide(on_grid, off_grid)

        # the bars of each kind of section (verse, chorus...) on their own
        kind_of_bar: dict[int, str] = {}
        for sec in sections or []:
            if sec.get("startBar") is None or not sec.get("label") or sec["label"] == "Silence":
                continue
            kind = re.sub(r"\s*\d+$", "", sec["label"])
            for b in range(int(sec["startBar"]), int(sec.get("endBar") if sec.get("endBar") is not None else sec["startBar"]) + 1):
                kind_of_bar[b] = kind
        by_kind: dict[str, list[int]] = {}
        for row_i, bar_i in enumerate(index):
            if bar_i in kind_of_bar:
                by_kind.setdefault(kind_of_bar[bar_i], []).append(row_i)
        distinct: dict[tuple, dict] = {}
        for kind, picks in by_kind.items():
            if len(picks) < MIN_GROUP_BARS:
                continue
            d = _decide(on_grid[picks], off_grid[picks])
            if d["kind"] != "heard":
                continue
            key = (tuple(d["pattern"]), d["sub"])
            slot = distinct.setdefault(key, {**d, "where": [], "bars": 0})
            slot["where"].append(kind)
            slot["bars"] += len(picks)

        chosen: list[dict]
        if overall["kind"] != "heard" and len(distinct) >= 1 or len(distinct) >= 2:
            chosen = sorted(distinct.values(), key=lambda p: -p["bars"])[:3]
        elif overall["kind"] == "typical":
            return {**_typical(per_bar, bpm), "evidence": overall["evidence"]}
        else:
            chosen = [{**overall, "where": [], "bars": len(on_rows)}]
        patterns = [_describe(p, per_bar) for p in chosen]
        first = patterns[0]
        return {
            "v": 4,  # the detector that made it: patterns of earlier ones (which read every song alike, or missed the third beat) are not shown
            "perBar": per_bar,
            "bpm": round(float(bpm), 1),
            "patterns": patterns,
            "evidence": overall["evidence"],
            **{k: first[k] for k in ("pattern", "sub", "kind", "confidence", "label", "easy")},
            "detected": first["kind"] == "heard",
        }
    except Exception as exc:  # the strum is a bonus: it must never cost a song its chords
        log.warning("Strumming pattern failed: %s", exc)
        return None


def _easy(per_bar: int, sub: int) -> list[str]:
    return [("D" if k % sub == 0 else "-") for k in range(per_bar * sub)]


def _describe(p: dict, per_bar: int) -> dict:
    return {
        "pattern": p["pattern"],
        "sub": p["sub"],
        "kind": p["kind"],
        "confidence": p["confidence"],
        "where": p.get("where", []),
        "bars": p.get("bars", 0),
        "label": label(p["pattern"]),
        "easy": _easy(per_bar, p["sub"]),
    }


def _typical(per_bar: int, bpm: float) -> dict:
    pattern = list(_DEFAULTS.get(per_bar) or _DEFAULTS[4])
    one = _describe({"pattern": pattern, "sub": 2, "kind": "typical", "confidence": 0.0}, per_bar)
    return {
        "v": 4,  # the detector that made it: patterns of earlier ones (which read every song alike, or missed the third beat) are not shown
        "perBar": per_bar,
        "bpm": round(float(bpm), 1),
        "patterns": [one],
        **{k: one[k] for k in ("pattern", "sub", "kind", "confidence", "label", "easy")},
        "detected": False,
    }
