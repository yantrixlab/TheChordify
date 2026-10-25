"""The strumming pattern of a song, read from where the playing hits inside each bar.

A strum is a burst of new sound from the strings. The hits are found in the harmonic part of the recording (the drums are
taken out, and so is the low end where the kick and bass sit) and looked up at eighth-note slots of every bar: each beat and
the half beat after it ("1 & 2 & ..."). A slot that is hit in most bars is part of the pattern. Down and up strokes cannot be
heard in a recording, so the usual rule of the guitar is used: a hit on the beat is a down-strum, a hit on the "&" is an up-strum.

The result is an estimate of the main pattern of the song, and says how sure it is. When the playing is not a steady strum (a piano
ballad, an arpeggiated intro) the confidence is low and the page offers a simple pattern for the song's time signature instead.
"""

from __future__ import annotations

import logging
from typing import Optional

import librosa
import numpy as np

log = logging.getLogger("chordify.strum")

HOP = 512
MIN_BARS = 12
LOW_HZ, HIGH_HZ = 110.0, 3200.0  # the range a strummed guitar lives in; below it are the kick and the bass
HIT = 0.3  # a slot counts as hit in a bar when a strum there reaches this share of the bar's strongest slot
MOSTLY = 0.55  # ...and it is part of the pattern when that happens in at least this share of the bars

# What to offer when the recording does not show a clear strum, by beats to the bar.
_DEFAULTS = {
    2: ["D", "-", "D", "U"],
    3: ["D", "-", "D", "U", "D", "U"],
    4: ["D", "-", "D", "U", "-", "U", "D", "U"],
    5: ["D", "-", "D", "U", "D", "-", "D", "U", "-", "U"],
    6: ["D", "-", "D", "U", "D", "U", "D", "-", "D", "U", "D", "U"],
    7: ["D", "-", "D", "U", "D", "-", "D", "U", "-", "U", "D", "U", "D", "-"],
}


def _harmonic_onsets(y: np.ndarray, sr: int) -> np.ndarray:
    """Onset strength of the strummed (harmonic) sound between LOW_HZ and HIGH_HZ, one value per HOP samples."""
    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    lo, hi = int(LOW_HZ * 2048 / sr), int(HIGH_HZ * 2048 / sr)
    band = spec[lo:hi]
    harmonic, _ = librosa.decompose.hpss(band, kernel_size=(17, 17), margin=1.5)  # frequency x time: keeps the sustained part
    db = librosa.amplitude_to_db(harmonic, ref=float(np.max(harmonic)) + 1e-9)
    env = librosa.onset.onset_strength(S=db, sr=sr, hop_length=HOP)
    env = env / (np.percentile(env, 99) + 1e-9)
    # only real strikes count: a point that stands out from its surroundings, not the wobble of a sustained note
    picked = librosa.util.peak_pick(env, pre_max=2, post_max=2, pre_avg=10, post_avg=10, delta=0.12, wait=3)
    strikes = np.zeros_like(env)
    strikes[picked] = env[picked]
    return strikes


def label(pattern: list[str]) -> str:
    return " ".join(pattern).replace("-", "–")


def estimate_strum(y: np.ndarray, sr: int, bars: list[dict], per_bar: int, bpm: float) -> Optional[dict]:
    """{"pattern": ["D","-","D","U",...] (two slots to a beat), "perBar", "confidence", "detected", "label", "easy"} or None."""
    try:
        per_bar = min(max(int(per_bar), 2), 7)
        full = [b for b in bars if len(b.get("beats") or []) >= per_bar + 1 and all(t is not None for t in b["beats"][: per_bar + 1])]
        if len(full) < MIN_BARS:
            return _fallback(per_bar, bpm)
        env = _harmonic_onsets(y, sr)
        fps = sr / HOP
        rows = []
        for bar in full:
            beats = [float(t) for t in bar["beats"][: per_bar + 1]]
            row = []
            for k in range(per_bar):
                period = beats[k + 1] - beats[k]
                if period <= 0.05:
                    break
                for half in (0.0, 0.5):
                    centre = beats[k] + half * period
                    lo = max(int((centre - 0.2 * period) * fps), 0)
                    hi = min(int((centre + 0.2 * period) * fps) + 1, len(env))
                    row.append(float(env[lo:hi].max()) if hi > lo else 0.0)
            if len(row) == per_bar * 2 and max(row) > 0:
                rows.append(np.array(row))
        if len(rows) < MIN_BARS:
            return _fallback(per_bar, bpm)
        grid = np.array(rows)
        floor = np.percentile(grid.max(axis=1), 25)  # leave out the quiet bars (breaks, intros)
        grid = grid[grid.max(axis=1) >= floor]
        norm = grid / grid.max(axis=1, keepdims=True)
        share = (norm >= HIT).mean(axis=0)  # how often each slot is hit
        on = share >= MOSTLY
        if not on[0]:
            on[0] = share[0] >= 0.4  # the first beat of a bar is almost always struck
        pattern = [("D" if k % 2 == 0 else "U") if on[k] else "-" for k in range(per_bar * 2)]
        hits = int(on.sum())
        # sure when the slots that are hit are hit nearly every bar and the others almost never
        spread = float(share[on].mean() - (share[~on].mean() if (~on).any() else 0.0)) if hits else 0.0
        confidence = round(float(np.clip(spread * 1.25, 0.0, 1.0)), 2)
        evidence = [round(float(x), 2) for x in share]
        if hits < 2 or confidence < 0.35:
            return {**_fallback(per_bar, bpm, tried=confidence), "evidence": evidence}
        return {**_result(pattern, per_bar, confidence, True, bpm), "evidence": evidence}
    except Exception as exc:  # the strum is a bonus: it must never cost a song its chords
        log.warning("Strumming pattern failed: %s", exc)
        return None


def _easy(per_bar: int) -> list[str]:
    return [("D" if k % 2 == 0 else "-") for k in range(per_bar * 2)]


def _result(pattern: list[str], per_bar: int, confidence: float, detected: bool, bpm: float) -> dict:
    return {
        "pattern": pattern,
        "perBar": per_bar,
        "confidence": confidence,
        "detected": detected,
        "label": label(pattern),
        "easy": _easy(per_bar),
        "bpm": round(float(bpm), 1),
    }


def _fallback(per_bar: int, bpm: float, tried: float = 0.0) -> dict:
    pattern = _DEFAULTS.get(per_bar) or _DEFAULTS[4]
    return _result(list(pattern), per_bar, round(float(tried), 2), False, bpm)
