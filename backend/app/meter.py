"""Beats per bar, found from the audio instead of assumed to be four.

The beat grid says where the beats are, not how they group into bars. Most songs count in fours, but plenty count in
threes (waltzes, many folk and film songs) or sixes. Each candidate bar length is tested against two signals that the
audio gives on every beat:

  * accent: how hard the beat hits (onset strength). The first beat of a bar is usually the strongest;
  * harmonic change: how different the harmony is from the beat before. Chords change on the first beat of a bar far
    more often than on the others.

For a candidate length m, beats are sorted by their position in a bar (beat number modulo m). When m is right, one
position stands clear of the others, bar after bar. When m is wrong the positions drift against the real bars and the
profile goes flat. How far the best position stands out, above what chance alone gives, is the score for m.

Four is the default and is only given up for a clearly better score, so a song with no clear pulse keeps four.
"""

from __future__ import annotations

import numpy as np

CANDIDATES = (3, 4, 6)
DEFAULT = 4
# The average of the largest of m standard normal values: what the best position scores by chance alone.
_CHANCE_MAX = {2: 0.56, 3: 0.85, 4: 1.03, 5: 1.16, 6: 1.27, 7: 1.35}
MIN_BEATS = 48  # fewer beats than this (a short clip) is too little to tell


def _standardize(x: np.ndarray) -> np.ndarray:
    return (x - x.mean()) / (x.std() + 1e-9)


def beat_signals(
    beats: np.ndarray, env: np.ndarray, env_fps: float, chroma: np.ndarray, chroma_fps: float
) -> tuple[np.ndarray, np.ndarray]:
    """(accent, change) for every beat: onset strength at the beat, and how far the harmony moved since the last beat."""
    period = float(np.median(np.diff(beats)))
    half = 0.25 * period
    accent = np.zeros(len(beats))
    for i, t in enumerate(beats):
        lo = max(0, int((t - half) * env_fps))
        hi = min(len(env), int((t + half) * env_fps) + 1)
        accent[i] = env[lo:hi].max() if hi > lo else 0.0

    edges = np.append(beats, beats[-1] + period)
    per_beat = []
    for i in range(len(beats)):
        lo = min(int(edges[i] * chroma_fps), chroma.shape[1] - 1)
        hi = max(lo + 1, min(int(edges[i + 1] * chroma_fps), chroma.shape[1]))
        v = chroma[:, lo:hi].mean(axis=1)
        per_beat.append(v / (np.linalg.norm(v) + 1e-9))
    per_beat = np.array(per_beat)
    change = np.zeros(len(beats))
    change[1:] = 1.0 - np.sum(per_beat[1:] * per_beat[:-1], axis=1)
    return accent, change


def _stand_out(signal: np.ndarray, m: int) -> float:
    """How far the strongest position in a bar of m beats rises above chance, in standard errors."""
    n = (len(signal) // m) * m
    if n < 4 * m:
        return 0.0
    profile = _standardize(signal[:n]).reshape(-1, m).mean(axis=0)
    return float(profile.max() * np.sqrt(n / m) - _CHANCE_MAX[m])


def meter_scores(accent: np.ndarray, change: np.ndarray, candidates=CANDIDATES) -> dict[int, float]:
    """A score per candidate bar length (higher is a better fit)."""
    return {m: _stand_out(accent, m) + _stand_out(change, m) for m in candidates}


def estimate_meter(beats: np.ndarray, accent: np.ndarray, change: np.ndarray, bpm: float) -> tuple[int, dict]:
    """(beats per bar, the evidence). 4 unless the audio clearly points to another length."""
    info: dict = {"scores": {}}
    if len(beats) < MIN_BEATS:
        return DEFAULT, info
    scores = meter_scores(accent, change)
    info["scores"] = {m: round(s, 2) for m, s in scores.items()}
    s3, s4, s6 = scores[3], scores[4], scores[6]

    # Three has to beat four clearly: it must score well in its own right, and well above four.
    best = DEFAULT
    if s3 > 2.5 and s3 > 1.5 * max(s4, 0.0) + 1.5:
        best = 3
    # Six beats a bar is two groups of three, felt at a quick tempo: it has to beat three and four on top.
    if bpm >= 110 and s6 > 3.0 and s6 > max(s3, s4) + 1.0:
        best = 6
    info["beatsPerBar"] = best
    return best, info
