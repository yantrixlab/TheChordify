"""Chroma/template-matching chord estimation.

This is a classic DSP approach (in the spirit of Chordino / NNLS Chroma):
compute a chroma representation of the audio, beat-sync it so chords align
with the music's rhythm, then correlate each beat-frame's chroma vector
against 24 major/minor triad templates (plus a "no chord" silence template)
and pick the best match. Contiguous identical matches are merged into chord
segments with start/end timestamps.

Accuracy is roughly 70-85% on typical pop/rock songs with clear harmony.
It will struggle with heavily distorted, atonal, or very dense mixes.
"""

from __future__ import annotations

from typing import Callable, Optional

import numpy as np
import librosa

ProgressFn = Callable[[int, str], None]


def _noop_progress(_pct: int, _stage: str) -> None:
    return None

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _build_templates() -> tuple[list[str], np.ndarray]:
    """Return (labels, templates) for 12 major + 12 minor triads + 'N' (no chord)."""
    labels: list[str] = []
    templates: list[np.ndarray] = []

    for root in range(12):
        major = np.zeros(12)
        for interval in (0, 4, 7):  # root, major third, fifth
            major[(root + interval) % 12] = 1
        labels.append(NOTE_NAMES[root])
        templates.append(major)

        minor = np.zeros(12)
        for interval in (0, 3, 7):  # root, minor third, fifth
            minor[(root + interval) % 12] = 1
        labels.append(f"{NOTE_NAMES[root]}m")
        templates.append(minor)

    labels.append("N")
    templates.append(np.zeros(12))

    return labels, np.stack(templates)


_LABELS, _TEMPLATES = _build_templates()
_TEMPLATE_NORMS = np.linalg.norm(_TEMPLATES, axis=1)
_TEMPLATE_NORMS[_TEMPLATE_NORMS == 0] = 1.0  # avoid divide-by-zero for the "N" row


def _mode_filter(labels: list[str], window: int = 3) -> list[str]:
    """Replace each label with the most common label in its `window`-wide neighborhood.

    Kills single-frame outliers (one beat that briefly disagrees with the chord
    holding steady on both sides of it) without blurring genuine, sustained
    chord changes.
    """
    if window < 3 or len(labels) < window:
        return labels
    half = window // 2
    smoothed = list(labels)
    for i in range(len(labels)):
        lo, hi = max(0, i - half), min(len(labels), i + half + 1)
        neighborhood = labels[lo:hi]
        counts: dict[str, int] = {}
        for label in neighborhood:
            counts[label] = counts.get(label, 0) + 1
        smoothed[i] = max(counts.items(), key=lambda kv: (kv[1], kv[0] == labels[i]))[0]
    return smoothed


def _merge_short_segments(segments: list[dict], min_seconds: float) -> list[dict]:
    """Fold segments shorter than `min_seconds` into an adjacent segment."""
    if not segments:
        return segments
    result = [dict(segments[0])]
    for seg in segments[1:]:
        duration = seg["end"] - seg["start"]
        if duration < min_seconds and result:
            # Too short to be a real, playable chord change — extend the previous
            # segment over it rather than showing a chord nobody actually strummed.
            result[-1]["end"] = seg["end"]
        else:
            result.append(dict(seg))

    # Re-merge any now-adjacent segments that ended up with the same label.
    merged: list[dict] = []
    for seg in result:
        if merged and merged[-1]["chord"] == seg["chord"]:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg)
    return merged


def estimate_beats(y: np.ndarray, sr: int, hop_length: int = 2048) -> tuple[float, np.ndarray]:
    """Return (bpm, beat_frames); `beat_frames` is empty when tracking fails."""
    try:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    except Exception:
        return 120.0, np.array([], dtype=int)

    bpm = float(np.atleast_1d(tempo)[0]) if len(np.atleast_1d(tempo)) else 120.0

    # librosa's beat tracker commonly locks onto the eighth-note (or even
    # sixteenth-note) pulse instead of the true quarter-note beat ("octave
    # error"). Most pop/rock/folk chords hold for at least one beat, often
    # a full bar, so detecting chords at double/quadruple that rate just
    # produces noisy, rapid-fire false chord changes. Halve the beat grid
    # itself (not just the display) back down to a plausible tempo.
    while bpm > 140 and len(beat_frames) >= 8:
        bpm /= 2
        beat_frames = beat_frames[::2]
    return bpm, beat_frames


def estimate_beat_times(y: np.ndarray, sr: int) -> tuple[float, np.ndarray]:
    """(bpm, beat times in seconds) from the tracker run on a fine onset envelope (23 ms steps). The same tracker on the coarse
    chord frames (93 ms) can only pick a whole number of frames to a beat, so every song was pushed to a tempo such as 129.2 BPM
    (5 frames) and its beats were rounded to 93 ms; on the fine envelope the beats land on the music (Chalisa and Sita Ram:
    the beats sit on the onsets three to four times as strongly). Anything above 140 BPM is halved, as before."""
    hop = 512
    try:
        env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        tempo, frames = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=hop)
    except Exception:
        return 120.0, np.array([], dtype=float)
    bpm = float(np.atleast_1d(tempo)[0]) if len(np.atleast_1d(tempo)) else 120.0
    times = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
    while bpm > 140 and len(times) >= 8:
        bpm /= 2
        times = times[::2]
    return bpm, times


def build_bars(beat_times: list[float]) -> list[dict]:
    """Group beats into 4/4 bars so the UI can render a musical timeline.

    `beat_times` ends with the track duration; each bar lists its beat starts plus
    the start of the next bar.
    """
    bars: list[dict] = []
    for i in range(0, len(beat_times) - 1, 4):
        bar_beats = beat_times[i : i + 5]
        if len(bar_beats) < 2:
            continue
        bars.append({"start": bar_beats[0], "beats": bar_beats})
    return bars


def detect_chords(
    audio_path: str,
    silence_rms_threshold: float = 0.015,
    min_confidence: float = 0.45,
    on_progress: Optional[ProgressFn] = None,
) -> dict:
    """Analyze an audio file and return a chord timeline.

    `on_progress(pct, stage)` is called periodically (0-100) so callers can
    surface a "Chordifying NN%" progress indicator while this runs.

    Returns:
        {
          "duration": float seconds,
          "chords": [{"start": float, "end": float, "chord": str}, ...]
        }
    """
    progress = on_progress or _noop_progress

    progress(5, "Loading audio")
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    progress(30, "Listening for rhythm")
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=2048)
    rms = librosa.feature.rms(y=y, hop_length=2048)[0]

    # Beat-sync chroma so chord boundaries line up with the music's pulse.
    bpm, beat_frames = estimate_beats(y, sr, hop_length=2048)

    progress(55, "Mapping harmony to the beat")

    if len(beat_frames) >= 2:
        sync_chroma = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=2048)
        frame_times = np.concatenate([[0.0], beat_times, [duration]])
        sync_rms = librosa.util.sync(rms[np.newaxis, :], beat_frames, aggregate=np.median)[0]
    else:
        # Fallback: fixed ~0.5s windows if beat tracking fails (e.g. ambient audio,
        # spoken word, or no clear pulse). Assume a plain 120 BPM grid so the UI
        # still has a sensible bar/beat structure to render.
        bpm = 120.0
        hop_seconds = 2048 / sr
        window = max(1, int(round(0.5 / hop_seconds)))
        n_windows = max(1, chroma.shape[1] // window)
        sync_chroma = np.stack(
            [chroma[:, i * window : (i + 1) * window].mean(axis=1) for i in range(n_windows)],
            axis=1,
        )
        sync_rms = np.array(
            [rms[i * window : (i + 1) * window].mean() for i in range(n_windows)]
        )
        frame_times = np.linspace(0, duration, n_windows + 1)
        beat_times = np.arange(0, duration, 60.0 / bpm)

    progress(70, "Matching chords bit by bit")
    n_frames = sync_chroma.shape[1]
    labels_per_frame = []
    for i in range(n_frames):
        if n_frames > 20 and i % max(1, n_frames // 20) == 0:
            progress(70 + int(20 * i / n_frames), "Matching chords bit by bit")
        vec = sync_chroma[:, i]
        loudness = sync_rms[i] if i < len(sync_rms) else 0.0

        if loudness < silence_rms_threshold or not np.any(vec):
            labels_per_frame.append("N")
            continue

        vec_norm = np.linalg.norm(vec)
        if vec_norm == 0:
            labels_per_frame.append("N")
            continue

        scores = (_TEMPLATES @ vec) / (_TEMPLATE_NORMS * vec_norm)
        best = int(np.argmax(scores[:-1]))  # exclude the "N" template from the contest

        # Speech, applause, and other non-musical-but-not-silent audio (e.g. a
        # spoken intro before a song starts) has energy but no clean harmonic
        # structure, so it won't strongly resemble any major/minor triad. Rather
        # than forcing a best-guess chord nobody actually played, require a
        # minimum cosine-similarity match before trusting the guess.
        if scores[best] < min_confidence:
            labels_per_frame.append("N")
            continue

        labels_per_frame.append(_LABELS[best])

    # Real chord progressions hold each chord for at least a beat, usually several.
    # A single beat-frame disagreeing with both its neighbors is almost always
    # template-matching noise (a transient, a fill, a vocal note bleeding into the
    # chroma), not an actual chord change — smooth those out with a mode filter
    # before merging into segments.
    labels_per_frame = _mode_filter(labels_per_frame, window=3)

    progress(92, "Building the chord timeline")
    # Merge consecutive identical labels into segments.
    segments: list[dict] = []
    for i, label in enumerate(labels_per_frame):
        start = float(frame_times[i])
        end = float(frame_times[min(i + 1, len(frame_times) - 1)])
        if segments and segments[-1]["chord"] == label:
            segments[-1]["end"] = end
        else:
            segments.append({"start": start, "end": end, "chord": label})

    # Drop "N" (no-chord/silence) segments shorter than a quarter second of noise
    # at the boundaries, but keep meaningful silent gaps for sync purposes.
    segments = [s for s in segments if s["end"] - s["start"] > 0.05]

    # Any chord segment shorter than half a beat is still almost certainly noise
    # that survived the mode filter at a segment boundary — fold it into whichever
    # neighbor it's adjacent to rather than showing a chord nobody actually played.
    min_segment_seconds = (60.0 / bpm) * 0.5 if bpm > 0 else 0.25
    segments = _merge_short_segments(segments, min_segment_seconds)

    # Build a 4/4 bar/beat grid from the beats so the UI can render a musical
    # timeline (one bar = 4 beats) instead of an arbitrary ruler.
    beat_times_list = [float(t) for t in beat_times if t < duration]
    if beat_times_list and beat_times_list[0] > 0.01:
        beat_times_list = [0.0] + beat_times_list
    beat_times_list.append(duration)

    return {
        "duration": duration,
        "chords": segments,
        "tempo": round(bpm, 1),
        "beatTimes": beat_times_list,
        "bars": build_bars(beat_times_list),
    }
