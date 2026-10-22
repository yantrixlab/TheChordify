"""Beat grid from the audio itself: the steady pulse that best lines up with the note onsets.

librosa's beat tracker leans on a tempo prior and can settle on a tempo several percent off the real one
(92 instead of 98 BPM on one test song). That is invisible in the beat list but wrecks everything built on it:
the grid drifts a whole beat against the music every few bars, so chords seem to slip onto the wrong beats.

Here every candidate tempo from 70 to 150 BPM is scored by how much onset energy a pulse train of that rate
(at its best phase) picks up, with no prior. For music at a constant tempo this finds the real pulse with
sub-frame accuracy. If the pulse is not steady through the song (live, rubato) the caller falls back to the
tracker's own beats.
"""

from __future__ import annotations

from typing import Optional

import librosa
import numpy as np

HOP = 512
MIN_BPM, MAX_BPM = 70.0, 150.0


def _pulse_scores(env: np.ndarray, fps: float, period: float, phases: np.ndarray) -> np.ndarray:
    """Mean onset strength on the pulse train of `period`, for each starting phase (seconds)."""
    count = int(((len(env) - 2) / fps - period) / period)
    pos = (phases[:, None] + np.arange(count)[None, :] * period) * fps
    idx = np.floor(pos).astype(int)
    frac = pos - idx
    return (env[idx] * (1 - frac) + env[idx + 1] * frac).mean(axis=1)


def estimate_pulse_grid(y: np.ndarray, sr: int, duration: float, start: float) -> Optional[tuple[np.ndarray, float]]:
    """(beat times covering the song, bpm) for steady music, or None when there is no clear steady pulse."""
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    if len(env) < 400:
        return None
    env = (env - env.mean()) / (env.std() + 1e-9)
    fps = sr / HOP

    periods = np.arange(60 / MAX_BPM, 60 / MIN_BPM, 0.0004)
    scored = []
    for period in periods:
        phases = np.arange(0.0, period, 0.02)
        scores = _pulse_scores(env, fps, period, phases)
        j = int(scores.argmax())
        scored.append((float(scores[j]), float(period), float(phases[j])))
    scored.sort(reverse=True)
    best_score, best_period, _ = scored[0]
    # a clear winner: clearly above every candidate that is not just a neighbouring tempo of the same peak
    rivals = [s for s, p, _ in scored if abs(p - best_period) / best_period > 0.03]
    if best_score < 0.35 or (rivals and best_score < 1.25 * rivals[0]):
        return None

    # refine period and phase on a finer grid
    fine_periods = best_period * (1 + np.arange(-0.005, 0.00501, 0.0002))
    refined = (-1.0, best_period, 0.0)
    for period in fine_periods:
        phases = np.arange(0.0, period, 0.004)
        scores = _pulse_scores(env, fps, period, phases)
        j = int(scores.argmax())
        if scores[j] > refined[0]:
            refined = (float(scores[j]), float(period), float(phases[j]))
    _, period, phase = refined

    # steadiness: the same pulse must be present in each third of the song, at the same rate
    third = len(env) // 3
    for k in range(3):
        part = env[k * third : (k + 1) * third]
        if len(part) < 200:
            return None
        local = _pulse_scores(part, fps, period, np.arange(0.0, period, 0.004))
        if local.max() < 0.4 * refined[0]:
            return None
        local_best = max(
            (
                _pulse_scores(part, fps, period * f, np.arange(0.0, period * f, 0.01)).max(),
                f,
            )
            for f in (0.985, 1.0, 1.015)
        )
        if local_best[1] != 1.0 and local_best[0] > 1.15 * local.max():
            return None  # the tempo is drifting: not a steady grid

    first = int(np.ceil((max(start, 0.0) - phase) / period - 0.5))
    last = int(np.floor((duration - phase) / period))
    grid = phase + period * np.arange(first, last + 1)
    return grid[grid >= 0.0], 60.0 / period
