"""Beat grid from the audio itself: the steady pulse that best lines up with the note onsets.

librosa's beat tracker leans on a tempo prior and can settle on a tempo several percent off the real one
(92 instead of 98 BPM on one test song). That is invisible in the beat list but wrecks everything built on it:
the grid drifts a whole beat against the music every few bars, so chords seem to slip onto the wrong beats.

Here every candidate tempo from 70 to 150 BPM is scored by how much onset energy a pulse train of that rate
(at its best phase) picks up, with no prior. For music at a constant tempo this finds the real pulse with
sub-frame accuracy. Music played by people drifts a little (Paradise creeps from 139.5 to 139.9 BPM, and a fixed
grid is half a beat out by the end), so when one fixed tempo does not hold through the song the grid follows the pulse
window by window (`_follow_pulse`). If there is no clear pulse at all (live, rubato) the caller falls back to the
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


FOLLOW_WINDOW = 24.0  # seconds of music each tempo estimate listens to
FOLLOW_STEP = 12.0  # seconds between estimates
FOLLOW_SPREAD = 0.02  # the tempo may wander this far (as a share) from the song's overall tempo


def _follow_pulse(env: np.ndarray, fps: float, period0: float, score0: float, start: float, duration: float) -> Optional[np.ndarray]:
    """Beat times that follow a slowly changing pulse: the best tempo and phase in each stretch of the song (near the song's
    overall tempo, and continuing the phase of the stretch before), stitched into one grid. Stretches with no pulse in them
    (a fade-out, an ambient ending) carry the last tempo and phase on. None when too little of the song has a pulse."""
    total = len(env) / fps
    window = min(FOLLOW_WINDOW, total)
    starts = list(np.arange(0.0, max(total - window, 0.0) + 1e-9, FOLLOW_STEP))
    if starts[-1] + window < total - 1.0:
        starts.append(total - window)
    periods = period0 * (1 + np.linspace(-FOLLOW_SPREAD, FOLLOW_SPREAD, 51))
    chosen: list[tuple[float, float, float] | None] = []  # (period, absolute phase, score) per window, None where there is no pulse
    previous: Optional[tuple[float, float]] = None
    for a in starts:
        part = env[int(a * fps) : int((a + window) * fps)]
        if len(part) < 8 * fps:
            chosen.append(None)
            continue
        table = []  # per candidate period: (period, phases, scores)
        for period in periods:
            phases = np.arange(0.0, period, 0.01)
            table.append((float(period), phases, _pulse_scores(part, fps, float(period), phases)))
        best_u = max(((float(sc.max()), pr, float(ph[int(sc.argmax())])) for pr, ph, sc in table), key=lambda item: item[0])
        pick = best_u
        if previous is not None:
            prev_period, prev_phase = previous
            predicted = prev_phase + prev_period * np.ceil((a - prev_phase) / prev_period)  # the next beat of the grid so far
            best_r = None
            for pr, ph, sc in table:
                gap = ((ph - (predicted - a) + pr / 2) % pr) - pr / 2  # distance from the predicted phase, around the beat
                near = np.abs(gap) <= 0.3 * pr
                if near.any():
                    j = int(np.where(near, sc, -1e9).argmax())
                    if best_r is None or sc[j] > best_r[0]:
                        best_r = (float(sc[j]), pr, float(ph[j]))
            if best_r is not None and best_r[0] >= 0.7 * best_u[0]:
                pick = best_r  # keep the phase unless the music clearly moved
        if pick[0] < 0.25 * score0:
            chosen.append(None)  # nothing to hear here: the grid carries on
            continue
        chosen.append((pick[1], a + pick[2], pick[0]))
        previous = (pick[1], a + pick[2])
    found = [c for c in chosen if c is not None]
    if len(found) < max(2, 0.5 * len(chosen)):
        return None

    # The tempo of each stretch, smoothed over its neighbours (one noisy estimate must not move the grid).
    smooth = []
    for i in range(len(chosen)):
        near = [chosen[k][0] for k in range(max(0, i - 1), min(len(chosen), i + 2)) if chosen[k] is not None]
        smooth.append(float(np.median(near)) if near else None)

    beats: list[float] = []
    last_period, last_phase = period0, found[0][1]
    for i, a in enumerate(starts):
        lo = 0.0 if i == 0 else a + (window - FOLLOW_STEP) / 2
        hi = total if i == len(starts) - 1 else a + (window + FOLLOW_STEP) / 2
        if chosen[i] is not None:
            last_period, last_phase = smooth[i] or chosen[i][0], chosen[i][1]
        k0 = int(np.ceil((lo - last_phase) / last_period - 1e-9))
        k1 = int(np.floor((hi - last_phase) / last_period - 1e-9))
        for t in last_phase + last_period * np.arange(k0, k1 + 1):
            if beats:
                gap = t - beats[-1]
                if gap < 0.6 * last_period:
                    continue  # two windows disagree a little on the phase: one beat, not two
                if gap > 1.4 * last_period:
                    steps = int(round(gap / last_period))
                    beats.extend(beats[-1] + gap * j / steps for j in range(1, steps))
            beats.append(float(t))
    grid = np.array(beats)
    # Where two stretches disagree a little about the phase the grid steps: spread the step over a few beats.
    if len(grid) >= 9:
        index = np.arange(len(grid))
        trend = np.polyfit(index, grid, 1)
        residual = grid - np.polyval(trend, index)
        padded = np.pad(residual, 2, mode="edge")
        grid = np.polyval(trend, index) + np.convolve(padded, np.ones(5) / 5, mode="valid")
    grid = grid[grid >= max(start, 0.0) - 0.5 * period0]
    return grid if len(grid) >= 16 else None


def follow_grid(env: np.ndarray, fps: float, period: float, start: float, duration: float) -> Optional[np.ndarray]:
    """The beats of a pulse about `period` seconds apart that follows the music through the song (see _follow_pulse), for a grid the
    caller has already chosen (the tracker's own, which is rounded to 23 ms and a fixed tempo). None when the music has no such pulse."""
    z = (env - env.mean()) / (env.std() + 1e-9)
    # (a pulse that drifts scores low over the whole song at any one tempo, so the stretches are judged on their own)
    return _follow_pulse(z, fps, period, 0.5, start, duration)


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
    steady = True
    for k in range(3):
        part = env[k * third : (k + 1) * third]
        if len(part) < 200:
            return None
        local = _pulse_scores(part, fps, period, np.arange(0.0, period, 0.004))
        if local.max() < 0.4 * refined[0]:
            steady = False  # no pulse at this tempo here, or the tempo has moved on
            break
        local_best = max(
            (
                _pulse_scores(part, fps, period * f, np.arange(0.0, period * f, 0.01)).max(),
                f,
            )
            for f in (0.985, 1.0, 1.015)
        )
        if local_best[1] != 1.0 and local_best[0] > 1.15 * local.max():
            steady = False  # the tempo is drifting
            break
    if not steady:
        grid = _follow_pulse(env, fps, period, refined[0], start, duration)
        if grid is None:
            return None
        return grid, 60.0 / float(np.median(np.diff(grid)))

    first = int(np.ceil((max(start, 0.0) - phase) / period - 0.5))
    last = int(np.floor((duration - phase) / period))
    grid = phase + period * np.arange(first, last + 1)
    return grid[grid >= 0.0], 60.0 / period
