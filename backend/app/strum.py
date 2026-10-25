"""The strumming patterns of a song, read from where the strings are struck inside each bar.

A strum adds energy to the notes of the chord being played. A drum hit, a cymbal or a breath adds energy to every note alike. So for
every moment of the recording the energy on the chord's own notes minus its fair share of the energy everywhere else is the playing
(and sound that is the same on every note drops out). Every beat of a bar is cut into four slots, a sixteenth note each ("1 e & a"),
and at each slot the rise of that energy is measured: the average just after it minus the average just before it.

Averaged over the bars, a slot that is really struck rises every time, and a slot that is not averages out to nothing, however much else
is going on. A slot is part of the pattern only when its average rise is clearly above what chance would give. If no sixteenth between
the beats and the "&" is struck, the pattern is shown in eighths; if some are, in sixteenths.

Songs often play one way in the verses and another in the chorus. So the bars of each kind of section (verse, chorus...) are measured
on their own, and when they come out different the song gets a pattern for each, with where it is played.

Down and up strokes cannot be heard in a recording. The usual picture of the guitar is used: the strumming hand keeps moving down and
up in eighths (or sixteenths when sixteenths are played), so a stroke on the beat is a down-strum and one on the "&" an up-strum.

The result says how sure it is ("kind"): heard (the slots clearly rise), guess (they rise a little, so the slots that do are shown as a
best guess) or typical (nothing stands out, as in a piano ballad, an arpeggiated intro or a loose recording, so a typical pattern for the
song's time signature is offered, marked as a suggestion).
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
MIN_GROUP_BARS = 12  # bars of one kind of section needed to give it a pattern of its own
LOW_HZ, HIGH_HZ = 110.0, 3200.0  # the range a strummed guitar lives in; below it are the kick and the bass
BEFORE = (0.45, 0.05)  # the stretch before a slot (as shares of a slot) whose level is compared with...
AFTER = (0.0, 0.5)  # ...the stretch after it
DECAY = 0.0  # how much of the fall before a slot is taken off its rise (off: it was tried, and hid the first beat of each bar)
SURE = 3.5  # a slot counts when its average rise is this many standard errors above nothing
FINE_EXTRA = 1.0  # the sixteenths between the beat and the "&" must be this much surer, so noise does not invent them
GUESS = 2.0  # below SURE but above this, the slots that rise still say something: a best guess, labelled as one
SHARE = 0.22  # a slot must also reach this share of the strongest slot's rise

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


def _playing(y: np.ndarray, sr: int, chords: list[dict]) -> np.ndarray:
    """The energy on the chord's own notes beyond its fair share of the rest, one value per HOP samples (zero where no chord sounds)."""
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
    excess = tone_sum - (n_tone / np.maximum(12 - n_tone, 1)) * other_sum  # zero on average for sound that is the same on every note
    return excess * mask.any(axis=0)


def label(pattern: list[str]) -> str:
    return " ".join(pattern).replace("-", "–")


def _decide(grid: np.ndarray, per_bar: int) -> dict:
    """The pattern the rows (bars x slots, SUB slots to a beat) show: {"pattern", "sub", "kind", "confidence", "evidence"}."""
    scale = float(np.percentile(np.abs(grid), 90)) + 1e-9
    grid = np.clip(grid / scale, -4.0, 4.0)  # one very loud bar must not decide the pattern
    mean = grid.mean(axis=0)
    error = grid.std(axis=0, ddof=1) / np.sqrt(len(grid)) + 1e-9
    sure = mean / error  # how many standard errors above "nothing" each slot rises
    top = float(mean.max())
    fine = np.arange(len(mean)) % 2 == 1  # the e and the a of "1 e & a"

    def on_from(threshold: float, extra: float) -> np.ndarray:
        on = (sure >= threshold + np.where(fine, extra, 0.0)) & (mean >= SHARE * top) & (top > 0)
        if not on[0]:
            on[0] = bool(sure[0] >= threshold * 0.6 and mean[0] > 0)  # the first beat of a bar is almost always struck
        return on

    def shape(on: np.ndarray) -> tuple[list[str], int]:
        if bool(on[fine].any()):  # sixteenths are played: the hand moves down-up in sixteenths
            return [("D" if k % 2 == 0 else "U") if on[k] else "-" for k in range(len(on))], 4
        eighths = on[::2]  # the beat and the "&"
        return [("D" if k % 2 == 0 else "U") if eighths[k] else "-" for k in range(len(eighths))], 2

    evidence = [round(float(x), 1) for x in sure]
    on = on_from(SURE, FINE_EXTRA)
    hits = int(on.sum())
    confidence = round(float(np.clip((np.median(sure[on]) - SURE) / 8.0 + 0.35, 0.0, 1.0)), 2) if hits else 0.0
    if hits >= 2 and confidence >= 0.35:
        pattern, sub = shape(on)
        return {"pattern": pattern, "sub": sub, "kind": "heard", "confidence": confidence, "evidence": evidence}
    soft = on_from(GUESS, FINE_EXTRA)
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
        energy = _playing(y, sr, chords)
        fps = sr / HOP

        def level(a: float, b: float) -> float:
            lo, hi = max(int(a * fps), 0), int(b * fps) + 1
            hi = min(max(hi, lo + 1), len(energy))
            return float(energy[lo:hi].mean()) if hi > lo else 0.0

        index, rows = [], []
        for i, bar in full:
            beats = [float(t) for t in bar["beats"][: per_bar + 1]]
            row = []
            for k in range(per_bar):
                period = beats[k + 1] - beats[k]
                if period <= 0.08:
                    break
                d = period / SUB
                for j in range(SUB):
                    c = beats[k] + j * d
                    after = level(c + AFTER[0] * d, c + AFTER[1] * d)
                    before = level(c - BEFORE[0] * d, c - BEFORE[1] * d)
                    earlier = level(c - (BEFORE[0] + 0.5) * d, c - (BEFORE[0] - 0.0) * d)
                    # the rise, less the fall the earlier strum's ringing was already taking (a ring that just fades gives nothing)
                    row.append((after - before) - max(earlier - before, 0.0) * DECAY)
            if len(row) == per_bar * SUB:
                index.append(i)
                rows.append(row)
        if len(rows) < MIN_BARS:
            return _typical(per_bar, bpm)
        grid = np.array(rows)

        overall = _decide(grid, per_bar)

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
            d = _decide(grid[picks], per_bar)
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
            chosen = [{**overall, "where": [], "bars": len(rows)}]
        patterns = [_describe(p, per_bar) for p in chosen]
        first = patterns[0]
        return {
            "v": 3,
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
        "v": 3,
        "perBar": per_bar,
        "bpm": round(float(bpm), 1),
        "patterns": [one],
        **{k: one[k] for k in ("pattern", "sub", "kind", "confidence", "label", "easy")},
        "detected": False,
    }
