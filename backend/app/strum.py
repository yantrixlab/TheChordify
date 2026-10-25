"""The strumming pattern of a song, read from where the strings are struck inside each bar.

A strum adds energy to the notes of the chord being played. A drum hit, a cymbal or a breath adds energy to every note alike. So for
every moment of the recording the energy on the chord's own notes minus its fair share of the energy everywhere else is the playing
(and sound that is the same on every note drops out). Each bar has slots at the eighth notes ("1 & 2 & ..."), and at each slot the
rise of that energy is measured: the average just after it minus the average just before it.

Averaged over the bars of the song, a slot that is really struck rises every time, and a slot that is not averages out to nothing,
however much else is going on. A slot is part of the pattern only when its average rise is clearly above what chance would give. Down and
up strokes cannot be heard in a recording, so the usual rule of the guitar is used: a hit on the beat is a down-strum, a hit on the
"&" is an up-strum.

The result is an estimate of the main pattern of the song, and says how sure it is ("kind"): heard (the slots clearly rise), guess (they
rise a little, so the slots that do are shown as a best guess) or typical (nothing stands out, as in a piano ballad, an arpeggiated
intro or a loose recording, so a typical pattern for the song's time signature is offered, marked as a suggestion).
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import librosa
import numpy as np

log = logging.getLogger("chordify.strum")

HOP = 512
MIN_BARS = 14
LOW_HZ, HIGH_HZ = 110.0, 3200.0  # the range a strummed guitar lives in; below it are the kick and the bass
BEFORE = (0.17, 0.03)  # the stretch before a slot (as shares of a beat) whose level is compared with...
AFTER = (0.02, 0.15)  # ...the stretch after it
SURE = 3.5  # a slot counts when its average rise is this many standard errors above nothing
GUESS = 2.0  # below SURE but above this, the slots that rise still say something: a best guess, labelled as one
SHARE = 0.22  # ...and reaches this share of the strongest slot's rise

# What to offer when the recording does not show a clear strum, by beats to the bar.
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


def estimate_strum(y: np.ndarray, sr: int, bars: list[dict], per_bar: int, bpm: float, chords: Optional[list[dict]] = None) -> Optional[dict]:
    """{"pattern": ["D","-","D","U",...] (two slots to a beat), "perBar", "confidence", "detected", "label", "easy"} or None."""
    try:
        per_bar = min(max(int(per_bar), 2), 7)
        full = [b for b in bars if len(b.get("beats") or []) >= per_bar + 1 and all(t is not None for t in b["beats"][: per_bar + 1])]
        if len(full) < MIN_BARS or not chords:
            return _fallback(per_bar, bpm)
        energy = _playing(y, sr, chords)
        fps = sr / HOP

        def level(a: float, b: float) -> float:
            lo, hi = int(a * fps), int(b * fps) + 1
            lo, hi = max(lo, 0), min(max(hi, lo + 1), len(energy))
            return float(energy[lo:hi].mean()) if hi > lo else 0.0

        rows = []
        for bar in full:
            beats = [float(t) for t in bar["beats"][: per_bar + 1]]
            row = []
            for k in range(per_bar):
                period = beats[k + 1] - beats[k]
                if period <= 0.08:
                    break
                for half in (0.0, 0.5):
                    c = beats[k] + half * period
                    row.append(level(c + AFTER[0] * period, c + AFTER[1] * period) - level(c - BEFORE[0] * period, c - BEFORE[1] * period))
            if len(row) == per_bar * 2:
                rows.append(row)
        if len(rows) < MIN_BARS:
            return _fallback(per_bar, bpm)
        grid = np.array(rows)
        scale = float(np.percentile(np.abs(grid), 90)) + 1e-9
        grid = np.clip(grid / scale, -4.0, 4.0)  # one very loud bar must not decide the pattern
        mean = grid.mean(axis=0)
        error = grid.std(axis=0, ddof=1) / np.sqrt(len(grid)) + 1e-9
        sure = mean / error  # how many standard errors above "nothing" each slot rises
        top = float(mean.max())
        on = (sure >= SURE) & (mean >= SHARE * top) & (top > 0)
        if not on[0]:
            on[0] = bool(sure[0] >= SURE * 0.6 and mean[0] > 0)  # the first beat of a bar is almost always struck
        hits = int(on.sum())
        evidence = [round(float(x), 1) for x in sure]
        pattern = [("D" if k % 2 == 0 else "U") if on[k] else "-" for k in range(per_bar * 2)]
        confidence = round(float(np.clip((np.median(sure[on]) - SURE) / 8.0 + 0.35, 0.0, 1.0)), 2) if hits else 0.0
        if hits >= 2 and confidence >= 0.35:
            return {**_result(pattern, per_bar, confidence, "heard", bpm), "evidence": evidence}
        soft = (sure >= GUESS) & (mean >= SHARE * top) & (top > 0)
        if int(soft.sum()) >= 2:
            guess = [("D" if k % 2 == 0 else "U") if soft[k] else "-" for k in range(per_bar * 2)]
            return {**_result(guess, per_bar, round(float(np.clip(np.median(sure[soft]) / 10.0, 0.05, 0.34)), 2), "guess", bpm), "evidence": evidence}
        return {**_fallback(per_bar, bpm, tried=confidence), "evidence": evidence}
    except Exception as exc:  # the strum is a bonus: it must never cost a song its chords
        log.warning("Strumming pattern failed: %s", exc)
        return None


def _easy(per_bar: int) -> list[str]:
    return [("D" if k % 2 == 0 else "-") for k in range(per_bar * 2)]


def _result(pattern: list[str], per_bar: int, confidence: float, kind: str, bpm: float) -> dict:
    return {
        "pattern": pattern,
        "perBar": per_bar,
        "confidence": confidence,
        "v": 2,  # which detector made it (the first one read every song as the same eighth-note strum, so its patterns are not shown)
        "kind": kind,  # heard / guess / typical
        "detected": kind == "heard",
        "label": label(pattern),
        "easy": _easy(per_bar),
        "bpm": round(float(bpm), 1),
    }


def _fallback(per_bar: int, bpm: float, tried: float = 0.0) -> dict:
    pattern = _DEFAULTS.get(per_bar) or _DEFAULTS[4]
    return _result(list(pattern), per_bar, round(float(tried), 2), "typical", bpm)
