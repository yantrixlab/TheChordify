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
from dataclasses import dataclass
from typing import Callable, Optional

import librosa
import numpy as np
from scipy.ndimage import uniform_filter1d

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


def _shifted_probs(feature: np.ndarray, semitones: int) -> np.ndarray:
    """Model probabilities for the song as if transposed by `semitones`, mapped back to the real key.

    A semitone is two CQT bins at 24 bins per octave, so transposing is a shift of the input.
    """
    if semitones == 0:
        return _predict_probs(feature)
    moved = np.roll(feature, 2 * semitones, axis=1)
    if semitones > 0:
        moved[:, : 2 * semitones] = feature[:, :1]
    else:
        moved[:, 2 * semitones :] = feature[:, -1:]
    p = _predict_probs(moved)
    chords = p[:, :_UNKNOWN_IDX].reshape(-1, 12, 14)  # [frame, root, quality]
    unshifted = np.roll(chords, -semitones, axis=1).reshape(-1, _UNKNOWN_IDX)  # predicted root r+s is really r
    return np.concatenate([unshifted, p[:, _UNKNOWN_IDX:]], axis=1)


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


@dataclass
class Features:
    """Everything the (slow) audio analysis produces; decode() turns it into chords cheaply."""

    duration: float
    bpm: float
    boundaries: np.ndarray  # beat boundaries in seconds, 0 and the track duration included
    probs: np.ndarray  # (frames, 170) model class probabilities
    bass_chroma: np.ndarray  # (12, frames) low-register chroma
    chroma: np.ndarray  # (12, frames) full-range chroma


@dataclass
class DecodeOptions:
    smooth: int = 5  # frames of moving-average smoothing over the model output (~0.1 s each)
    snap: float = 0.1  # pull a chord change onto the nearest beat if it is this close (seconds)
    # How much the notes actually sounding in a chord can overrule the model's choice of chord
    # type (0 = trust the model). The model tends to flatten maj7/m7/6 into plain major/minor;
    # 8 recovered about a third more maj7s and an eighth more 7ths on real guitar recordings
    # without touching plain major/minor. Set CHORD_COLOR_WEIGHT=0 to turn it off.
    color_weight: float = float(os.environ.get("CHORD_COLOR_WEIGHT", "8"))


def _unit_template(quality: str) -> np.ndarray:
    t = np.zeros(12)
    t[list(_QUALITY_INTERVALS[quality])] = 1
    return t / np.linalg.norm(t)


_QUALITY_TEMPLATES = np.stack([_unit_template(q) for q in _BTC_QUALITIES])


def _refine_quality(f: "Features", root: int, lo: int, hi: int, weight: float) -> str:
    """Pick the chord type for a segment from the model's per-type probabilities plus how well the
    segment's average chroma (rotated to the root) matches each chord shape."""
    model = f.probs[lo:hi, root * 14 : root * 14 + 14].mean(axis=0)
    chroma = np.roll(f.chroma[:, lo:hi].mean(axis=1), -root)
    chroma = chroma / (np.linalg.norm(chroma) + 1e-9)
    score = np.log(model + 1e-3) + weight * (_QUALITY_TEMPLATES @ chroma)
    return _BTC_QUALITIES[int(score.argmax())]


# Measured on the benchmark (eval/run_eval.py): decoding at the model's own frame rate and
# snapping to beats beat forcing every change onto the beat grid (+1.8 root on real guitar),
# and averaging over +-1 semitone shifted copies added a further ~0.3-0.9 points.
TTA_SHIFTS = (-1, 0, 1)


def extract_features(y: np.ndarray, progress: Optional[ProgressFn] = None, tta: tuple[int, ...] = TTA_SHIFTS) -> Features:
    """Run beat tracking, the chord model and the chroma analyses on mono 22.05 kHz audio."""
    progress = progress or (lambda _p, _s: None)
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
    probs = np.mean([_shifted_probs(feature, s) for s in tta], axis=0)

    progress(85, "Finding the bass line")
    bass_chroma = librosa.feature.chroma_cqt(
        y=y, sr=SAMPLE_RATE, hop_length=HOP_LENGTH, fmin=librosa.note_to_hz("C1"), n_octaves=3, norm=None
    )
    chroma = librosa.feature.chroma_cqt(y=y, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    return Features(duration, bpm, boundaries, probs, bass_chroma, chroma)


def decode(f: Features, opts: Optional[DecodeOptions] = None) -> list[dict]:
    """Chord segments (start, end, chord, confidence) from analysed features."""
    opts = opts or DecodeOptions()
    probs = uniform_filter1d(f.probs, size=opts.smooth, axis=0, mode="nearest") if opts.smooth > 1 else f.probs
    classes = probs.argmax(axis=1)
    classes[classes == _UNKNOWN_IDX] = _NO_CHORD_IDX

    # Runs of identical frames -> [start, end, class], in seconds.
    runs: list[list] = []
    for i, cls in enumerate(classes):
        cls = int(cls)
        if runs and runs[-1][2] == cls:
            runs[-1][1] = i + 1
        else:
            runs.append([i, i + 1, cls])
    segs = [[start / FRAMES_PER_SECOND, end / FRAMES_PER_SECOND, cls] for start, end, cls in runs]
    segs[0][0] = 0.0
    segs[-1][1] = f.duration

    # Real chord changes land on the beat, so pull nearby ones onto the beat grid.
    for i in range(1, len(segs)):
        nearest = float(f.boundaries[int(np.argmin(np.abs(f.boundaries - segs[i][0])))])
        if abs(nearest - segs[i][0]) <= opts.snap:
            segs[i - 1][1] = segs[i][0] = nearest
    segs = [s for s in segs if s[1] - s[0] > 1e-3]

    out: list[dict] = []
    for start, end, cls in segs:
        lo = int(start * FRAMES_PER_SECOND)
        hi = max(lo + 1, int(end * FRAMES_PER_SECOND))
        parts = _class_to_parts(cls)
        if parts is None:
            label = "N"
        else:
            root, quality = parts
            if opts.color_weight > 0:
                quality = _refine_quality(f, root, lo, hi, opts.color_weight)
            label = _label(root, quality, _bass_for_segment(f.bass_chroma, slice(lo, hi), root, quality))
        confidence = float(probs[lo:hi, cls].mean())
        out.append({"start": float(start), "end": float(end), "chord": label, "confidence": round(confidence, 2)})
    return out


def detect_chords_ai(audio_path: str, on_progress: Optional[ProgressFn] = None) -> dict:
    progress = on_progress or (lambda _p, _s: None)

    progress(3, "Loading the chord model")
    _load_model()

    progress(8, "Loading audio")
    y, _ = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    features = extract_features(y, progress=progress)

    progress(92, "Building the chord timeline")
    segments = decode(features)

    beat_list = [float(t) for t in features.boundaries[:-1]]
    if beat_list and beat_list[0] > 0.01:
        beat_list = [0.0] + beat_list
    beat_list.append(features.duration)

    return {
        "duration": features.duration,
        "chords": segments,
        "tempo": round(features.bpm, 1),
        "beatTimes": beat_list,
        "bars": build_bars(beat_list),
    }
