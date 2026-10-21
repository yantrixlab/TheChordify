"""Neural chord recognition (BTC, large vocabulary) with slash-chord detection.

Runs the open-source BTC transformer (Park et al., ISMIR 2019, MIT licence — see
app/btc/LICENSE) on CPU. Its 170-class vocabulary covers 12 roots x 14 qualities
(major, minor, dim, aug, 6, m6, 7, maj7, m7, mMaj7, dim7, m7b5, sus2, sus4) plus
"no chord" and "unknown".

The model only labels the chord *quality and root*, so inversions are recovered
separately: a low-register chromagram tells us which note the bass is playing, and
when it is a chord tone other than the root the label becomes a slash chord (C/E).

Output labels use sharps and a compact suffix style: C, Cm, C7, Cmaj7, Cm7, Csus4,
Csus2, Cdim, Caug, C6, Cm6, Cdim7, Cm7b5, CmMaj7, and C/E for inversions.
"""

from __future__ import annotations

import os
import threading
from typing import Callable, Optional

import librosa
import numpy as np

from .chord_detection import NOTE_NAMES, estimate_beats, build_bars

ProgressFn = Callable[[int, str], None]

MODEL_PATH = os.environ.get(
    "BTC_MODEL_PATH",
    os.path.join(os.path.dirname(__file__), "..", "models", "btc_model_large_voca.pt"),
)

SAMPLE_RATE = 22050
INSTANCE_SECONDS = 10.0
HOP_LENGTH = 2048
N_BINS = 144
BINS_PER_OCTAVE = 24
TIMESTEP = 108  # frames per 10 s instance (INSTANCE_SECONDS * SAMPLE_RATE / HOP_LENGTH, rounded up)
NUM_CHORDS = 170
FRAMES_PER_SECOND = SAMPLE_RATE / HOP_LENGTH

_MODEL_CONFIG = {
    "feature_size": N_BINS,
    "timestep": TIMESTEP,
    "num_chords": NUM_CHORDS,
    "input_dropout": 0.2,
    "layer_dropout": 0.2,
    "attention_dropout": 0.2,
    "relu_dropout": 0.2,
    "num_layers": 8,
    "num_heads": 4,
    "hidden_size": 128,
    "total_key_depth": 128,
    "total_value_depth": 128,
    "filter_size": 128,
    "probs_out": False,
}

# BTC class index = root * 14 + quality_index; 168 = unknown ("X"), 169 = no chord ("N").
_BTC_QUALITIES = [
    "min", "maj", "dim", "aug", "min6", "maj6", "min7",
    "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2", "sus4",
]
_QUALITY_SUFFIX = {
    "min": "m", "maj": "", "dim": "dim", "aug": "aug", "min6": "m6", "maj6": "6",
    "min7": "m7", "minmaj7": "mMaj7", "maj7": "maj7", "7": "7", "dim7": "dim7",
    "hdim7": "m7b5", "sus2": "sus2", "sus4": "sus4",
}
_QUALITY_INTERVALS = {
    "min": (0, 3, 7), "maj": (0, 4, 7), "dim": (0, 3, 6), "aug": (0, 4, 8),
    "min6": (0, 3, 7, 9), "maj6": (0, 4, 7, 9), "min7": (0, 3, 7, 10),
    "minmaj7": (0, 3, 7, 11), "maj7": (0, 4, 7, 11), "7": (0, 4, 7, 10),
    "dim7": (0, 3, 6, 9), "hdim7": (0, 3, 6, 10), "sus2": (0, 2, 7), "sus4": (0, 5, 7),
}
_NO_CHORD_IDX = 169
_UNKNOWN_IDX = 168

# Slash-chord decision thresholds (see _bass_for_segment).
_BASS_MIN_SHARE = 0.5  # the bass note must hold at least this share of the low-register energy
_BASS_ROOT_RATIO = 0.7  # ...and the chord root must be clearly weaker than it

_model = None
_model_lock = threading.Lock()


class ModelUnavailableError(RuntimeError):
    pass


def _load_model():
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            import torch
            from .btc.model import BTC_model
        except ImportError as exc:  # torch not installed on this host
            raise ModelUnavailableError(f"PyTorch is not installed: {exc}") from exc
        if not os.path.isfile(MODEL_PATH):
            raise ModelUnavailableError(
                f"BTC weights not found at {os.path.abspath(MODEL_PATH)}. "
                "Run `python scripts/fetch_models.py`."
            )

        torch.set_num_threads(int(os.environ.get("TORCH_THREADS", max(1, (os.cpu_count() or 2) // 2))))
        net = BTC_model(config=_MODEL_CONFIG)
        # Trusted file shipped with the repo; the checkpoint also holds numpy mean/std arrays.
        checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
        net.load_state_dict(checkpoint["model"])
        net.eval()
        _model = (net, np.asarray(checkpoint["mean"], dtype=np.float32), np.asarray(checkpoint["std"], dtype=np.float32))
        return _model


def _cqt_features(y: np.ndarray) -> np.ndarray:
    """Log-CQT, computed per 10 s instance exactly as the model was trained. Shape (frames, 144)."""
    instance = int(SAMPLE_RATE * INSTANCE_SECONDS)
    parts = []
    start = 0
    while len(y) > start + instance:
        parts.append(_cqt(y[start : start + instance]))
        start += instance
    parts.append(_cqt(y[start:]))
    feature = np.concatenate(parts, axis=1)
    return np.log(np.abs(feature) + 1e-6).T


def _cqt(chunk: np.ndarray) -> np.ndarray:
    return librosa.cqt(
        chunk, sr=SAMPLE_RATE, n_bins=N_BINS, bins_per_octave=BINS_PER_OCTAVE, hop_length=HOP_LENGTH
    )


def _predict_probs(feature: np.ndarray) -> np.ndarray:
    """Per-frame class probabilities, shape (frames, 170)."""
    import torch

    net, mean, std = _load_model()
    n_frames = feature.shape[0]
    feature = (feature - mean) / std
    pad = (-n_frames) % TIMESTEP
    feature = np.pad(feature, ((0, pad), (0, 0)), mode="constant", constant_values=0)
    batch = torch.from_numpy(feature.astype(np.float32)).reshape(-1, TIMESTEP, N_BINS)

    out = []
    with torch.no_grad():
        for i in range(0, batch.shape[0], 8):
            hidden, _ = net.self_attn_layers(batch[i : i + 8])
            logits = net.output_layer.output_projection(hidden)
            out.append(torch.softmax(logits, dim=-1).reshape(-1, NUM_CHORDS).numpy())
    return np.concatenate(out, axis=0)[:n_frames]


def _class_to_parts(idx: int) -> Optional[tuple[int, str]]:
    """(root pitch class, BTC quality) for a chord class, None for N / X."""
    if idx >= _UNKNOWN_IDX:
        return None
    return idx // 14, _BTC_QUALITIES[idx % 14]


def _label(root: int, quality: str, bass: Optional[int] = None) -> str:
    name = f"{NOTE_NAMES[root]}{_QUALITY_SUFFIX[quality]}"
    return f"{name}/{NOTE_NAMES[bass]}" if bass is not None and bass != root else name


def _aggregate_beats(probs: np.ndarray, boundaries: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Average frame probabilities inside each beat interval -> (beats, 170) soft votes."""
    n = probs.shape[0]
    idx = np.clip(np.round(boundaries * FRAMES_PER_SECOND).astype(int), 0, n)
    rows = []
    for a, b in zip(idx[:-1], idx[1:]):
        b = max(b, a + 1)
        window = probs[min(a, n - 1) : min(b, n)]
        rows.append(window.mean(axis=0))
    votes = np.stack(rows)
    return votes.argmax(axis=1), votes.max(axis=1)


def _despeckle(classes: list[int], conf: np.ndarray, floor: float = 0.6) -> list[int]:
    """Drop a one-beat chord between two identical neighbours when the model was unsure of it."""
    out = list(classes)
    for i in range(1, len(classes) - 1):
        if classes[i - 1] == classes[i + 1] != classes[i] and conf[i] < floor:
            out[i] = classes[i - 1]
    return out


def _bass_for_segment(bass_chroma: np.ndarray, frames: slice, root: int, quality: str) -> Optional[int]:
    """Bass pitch class if this segment is a genuine inversion, else None."""
    window = bass_chroma[:, frames]
    if window.shape[1] == 0:
        return None
    energy = window.mean(axis=1)
    total = energy.sum()
    if total <= 0:
        return None
    bass = int(energy.argmax())
    if bass == root:
        return None
    chord_tones = {(root + i) % 12 for i in _QUALITY_INTERVALS[quality]}
    if bass not in chord_tones:
        return None
    if energy[bass] / total < _BASS_MIN_SHARE or energy[root] > _BASS_ROOT_RATIO * energy[bass]:
        return None
    return bass


def detect_chords_ai(audio_path: str, on_progress: Optional[ProgressFn] = None) -> dict:
    progress = on_progress or (lambda _p, _s: None)

    progress(3, "Loading the chord model")
    _load_model()

    progress(8, "Loading audio")
    y, _ = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    duration = float(librosa.get_duration(y=y, sr=SAMPLE_RATE))

    progress(20, "Listening for rhythm")
    bpm, beat_frames = estimate_beats(y, SAMPLE_RATE, HOP_LENGTH)
    if len(beat_frames) >= 2:
        beat_times = librosa.frames_to_time(beat_frames, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    else:
        bpm = 120.0
        beat_times = np.arange(0.0, duration, 60.0 / bpm)
    boundaries = np.unique(np.concatenate([[0.0], beat_times[beat_times < duration], [duration]]))

    progress(35, "Analysing harmony")
    feature = _cqt_features(y)

    progress(60, "Recognising chords")
    probs = _predict_probs(feature)

    progress(85, "Finding the bass line")
    bass_chroma = librosa.feature.chroma_cqt(
        y=y, sr=SAMPLE_RATE, hop_length=HOP_LENGTH, fmin=librosa.note_to_hz("C1"), n_octaves=3, norm=None
    )

    progress(92, "Building the chord timeline")
    classes, conf = _aggregate_beats(probs, boundaries)
    classes = _despeckle([int(c) for c in classes], conf)

    # Merge consecutive beats of the same class into segments.
    runs: list[list] = []  # [start_beat, end_beat, class, summed confidence]
    for i, cls in enumerate(classes):
        if cls == _UNKNOWN_IDX:
            cls = _NO_CHORD_IDX
        if runs and runs[-1][2] == cls:
            runs[-1][1] = i + 1
            runs[-1][3] += float(conf[i])
        else:
            runs.append([i, i + 1, cls, float(conf[i])])

    segments: list[dict] = []
    for start_beat, end_beat, cls, conf_sum in runs:
        start, end = float(boundaries[start_beat]), float(boundaries[end_beat])
        parts = _class_to_parts(cls)
        if parts is None:
            label = "N"
        else:
            root, quality = parts
            lo = int(start * FRAMES_PER_SECOND)
            hi = max(lo + 1, int(end * FRAMES_PER_SECOND))
            label = _label(root, quality, _bass_for_segment(bass_chroma, slice(lo, hi), root, quality))
        segments.append(
            {"start": start, "end": end, "chord": label, "confidence": round(conf_sum / (end_beat - start_beat), 2)}
        )

    beat_list = [float(t) for t in boundaries[:-1]]
    if beat_list and beat_list[0] > 0.01:
        beat_list = [0.0] + beat_list
    beat_list.append(duration)

    return {
        "duration": duration,
        "chords": segments,
        "tempo": round(bpm, 1),
        "beatTimes": beat_list,
        "bars": build_bars(beat_list),
    }
