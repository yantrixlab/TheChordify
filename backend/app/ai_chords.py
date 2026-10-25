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
from scipy.interpolate import interp1d
from scipy.ndimage import uniform_filter1d

from .chord_detection import NOTE_NAMES, estimate_beats
from .meter import beat_signals, estimate_meter, fast_triple_grid
from .strum import estimate_strum
from .pulse import estimate_pulse_grid
from .sections_ai import SectionsJob
from .structure import (
    analyze_structure,
    audible_start,
    downbeat_phase,
    estimate_key,
    fit_beat_grid,
    place_chords_on_grid,
)

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


def _cqt_features(y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Log-CQT computed per 10 s instance exactly as the model was trained: (frames x 144, frame times)."""
    instance = int(SAMPLE_RATE * INSTANCE_SECONDS)
    parts = []
    times = []
    start = 0
    while True:
        last = len(y) <= start + instance
        part = _cqt(y[start:] if last else y[start : start + instance])
        parts.append(part)
        # A 10 s piece yields 108 frames spaced 2048/22050 s apart, i.e. a little over 10 s, so frame
        # numbers drift against the clock (~0.19 s per minute). Keep each frame's true time instead.
        times.append(start / SAMPLE_RATE + np.arange(part.shape[1]) * HOP_LENGTH / SAMPLE_RATE)
        if last:
            break
        start += instance
    feature = np.concatenate(parts, axis=1)
    return np.log(np.abs(feature) + 1e-6).T, np.concatenate(times)


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
    rms: np.ndarray = None  # type: ignore[assignment]  # (frames,) loudness
    mfcc: np.ndarray = None  # type: ignore[assignment]  # (13, frames) timbre
    beats: np.ndarray = None  # type: ignore[assignment]  # real beat times in seconds (no artificial 0.0)
    audible_start: float = 0.0  # when sound begins (quiet playing counts); the opening before it is silence
    texture: np.ndarray = None  # type: ignore[assignment]  # (8, frames) how loud, bright and dense the sound is
    beats_per_bar: int = 4  # the song's bar length: 4 unless the audio clearly counts in 3 or 6 (see meter.py)


@dataclass
class DecodeOptions:
    smooth: int = 5  # frames of moving-average smoothing over the model output (~0.1 s each)
    snap: float = 0.1  # pull a chord change onto the nearest beat if it is this close (seconds)
    # How much the notes actually sounding in a chord can overrule the model's choice of chord
    # type (0 = trust the model). The model tends to flatten maj7/m7/6 into plain major/minor;
    # 8 recovered about a third more maj7s and an eighth more 7ths on real guitar recordings
    # without touching plain major/minor. Set CHORD_COLOR_WEIGHT=0 to turn it off.
    color_weight: float = float(os.environ.get("CHORD_COLOR_WEIGHT", "8"))
    # "full": every chord type the model knows (7ths, sus, slash chords...). "simple": only the song's
    # core major/minor chords, which is what most players want on screen.
    detail: str = "full"
    core_share: float = 0.03  # simple mode: a chord must fill at least this share of the song to be kept
    max_core: int = 10  # simple mode: at most this many different chords per song
    # How strongly a chord that keeps coming back on the same beat of nearby bars is favoured there (0 = off). Strumming
    # patterns and chord loops repeat bar after bar, but in a dense passage the model hears only a trace of a chord that
    # it hears clearly elsewhere in the same loop; see _repeat_weights.
    repeat: float = float(os.environ.get("CHORD_REPEAT", "2.0"))
    # A chord shorter than this (seconds) is a glitch between two longer ones and is absorbed by the longer neighbour.
    min_len: float = float(os.environ.get("CHORD_MIN_LEN", "0.3"))


# Simple mode folds the model's 14 chord types into three triad families per root.
_FAMILY_QUALITY = ("maj", "min", "dim")
_FAMILY_BTC_INDEX = np.array([1, 0, 2])  # BTC class offsets of maj, min, dim within a root's 14 types
_FOLD = np.zeros((NUM_CHORDS, 37))  # model class -> (family * 12 + root), 36 = no chord
for _cls in range(_UNKNOWN_IDX):
    _quality = _BTC_QUALITIES[_cls % 14]
    _family = 1 if _quality in ("min", "min6", "min7", "minmaj7") else 2 if _quality in ("dim", "dim7", "hdim7") else 0
    _FOLD[_cls, _family * 12 + _cls // 14] = 1  # maj, 6, maj7, 7, aug, sus2, sus4 all count as the major triad
_FOLD[_UNKNOWN_IDX:, 36] = 1


def _core_chord_classes(probs: np.ndarray, opts: "DecodeOptions") -> tuple[np.ndarray, np.ndarray]:
    """Label every frame using only the song's core chords.

    The model picks the best of 170 chords for each moment, so a noisy bar can surface a chord the
    song never really uses. Instead: fold the probabilities down to major/minor/diminished triads
    (adding up all the 7th/sus/6th variants), find which few chords carry the song, then re-pick each
    frame among just those. Returns (model class per frame, confidence per frame).
    """
    folded = probs @ _FOLD  # (frames, 37)
    share = np.bincount(folded.argmax(axis=1), minlength=37)[:36] / len(folded)
    ranked = np.argsort(-share)
    core = [int(c) for c in ranked[: opts.max_core] if share[c] >= opts.core_share]
    if len(core) < 3:
        core = [int(c) for c in ranked[:3]]
    allowed = np.zeros(37, dtype=bool)
    allowed[core] = True
    allowed[36] = True  # silence stays possible
    restricted = np.where(allowed, folded, -1.0)
    pick = restricted.argmax(axis=1)
    classes = np.where(pick == 36, _NO_CHORD_IDX, (pick % 12) * 14 + _FAMILY_BTC_INDEX[np.minimum(pick // 12, 2)])
    return classes, folded[np.arange(len(pick)), pick]


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


def _texture_features(y: np.ndarray, n_frames: int) -> np.ndarray:
    """How loud, bright and dense the sound is, per frame (same 2048-sample frame grid as the chroma).

    Rows: loudness (dB), spectral centroid (kHz), flatness, harmonic share (vs drums/percussion) and the share of
    energy in four bands (<250 Hz, 250 Hz-1 kHz, 1-4 kHz, >4 kHz). Verses, choruses and intros differ mostly in this
    texture, even when they play the same chords, which is why structure.py leans on it.
    """
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP_LENGTH))
    freqs = librosa.fft_frequencies(sr=SAMPLE_RATE, n_fft=2048)
    harmonic, percussive = librosa.decompose.hpss(S)
    power = S**2
    total = power.sum(axis=0) + 1e-12

    def share(low: float, high: float) -> np.ndarray:
        band = (freqs >= low) & (freqs < high)
        return power[band].sum(axis=0) / total

    harmonic_power = (harmonic**2).sum(axis=0)
    rows = [
        10 * np.log10(total),
        librosa.feature.spectral_centroid(S=S, sr=SAMPLE_RATE)[0] / 1000.0,
        librosa.feature.spectral_flatness(S=S)[0],
        harmonic_power / (harmonic_power + (percussive**2).sum(axis=0) + 1e-12),
        share(20, 250),
        share(250, 1000),
        share(1000, 4000),
        share(4000, 10000),
    ]
    texture = np.stack(rows)
    if texture.shape[1] < n_frames:
        texture = np.pad(texture, ((0, 0), (0, n_frames - texture.shape[1])), mode="edge")
    return texture[:, :n_frames]


def extract_features(y: np.ndarray, progress: Optional[ProgressFn] = None, tta: tuple[int, ...] = TTA_SHIFTS) -> Features:
    """Run beat tracking, the chord model and the chroma analyses on mono 22.05 kHz audio."""
    progress = progress or (lambda _p, _s: None)
    duration = float(librosa.get_duration(y=y, sr=SAMPLE_RATE))

    progress(20, "Listening for rhythm")
    # Loudness tells when sound begins; a soft intro must still get its own bars.
    rms = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
    sound_starts = audible_start(rms)
    bpm, beat_frames = estimate_beats(y, SAMPLE_RATE, HOP_LENGTH)
    pulse = estimate_pulse_grid(y, SAMPLE_RATE, duration, sound_starts)
    if pulse is not None:
        # Steady music: the grid found from the onsets themselves (the tracker can be several % off tempo).
        beat_times, bpm = pulse
    elif len(beat_frames) >= 2:
        beat_times = fit_beat_grid(
            librosa.frames_to_time(beat_frames, sr=SAMPLE_RATE, hop_length=HOP_LENGTH), sound_starts, duration
        )
    else:
        bpm = 120.0
        beat_times = np.arange(0.0, duration, 60.0 / bpm)
    boundaries = np.unique(np.concatenate([[0.0], beat_times[beat_times < duration], [duration]]))

    progress(35, "Analysing harmony")
    feature, frame_times = _cqt_features(y)

    progress(60, "Recognising chords")
    probs = np.mean([_shifted_probs(feature, s) for s in tta], axis=0)

    progress(85, "Finding the bass line")
    bass_chroma = librosa.feature.chroma_cqt(
        y=y, sr=SAMPLE_RATE, hop_length=HOP_LENGTH, fmin=librosa.note_to_hz("C1"), n_octaves=3, norm=None
    )
    chroma = librosa.feature.chroma_cqt(y=y, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)

    # Put the model output on the same uniform clock (frame i = i * 2048 / 22050 s) as the chroma arrays
    # and the beat grid, so every later time <-> frame conversion is a single multiplication.
    uniform_times = np.arange(chroma.shape[1]) / FRAMES_PER_SECOND
    probs = interp1d(frame_times, probs, axis=0, bounds_error=False, fill_value=(probs[0], probs[-1]))(uniform_times)
    # Loudness and timbre tell choruses from verses when they share the same chords (see structure.py).
    mfcc = librosa.feature.mfcc(y=y, sr=SAMPLE_RATE, n_mfcc=13, hop_length=HOP_LENGTH)
    n = chroma.shape[1]
    beat_times = np.asarray(beat_times, dtype=float)
    # How the beats group into bars: counted from how hard each beat hits and how often the harmony changes on it.
    meter = 4
    if len(beat_times) >= 2:
        try:
            env = librosa.onset.onset_strength(y=y, sr=SAMPLE_RATE, hop_length=512)
            accent, change = beat_signals(beat_times, env, SAMPLE_RATE / 512, chroma, FRAMES_PER_SECOND)
            meter, evidence = estimate_meter(beat_times, accent, change, bpm)
            # A quick waltz is often tracked at half its speed: when it is clearly counted in threes at the quicker
            # pulse, that pulse is the grid (about twice the tempo, three beats a bar).
            quick = fast_triple_grid(
                env, SAMPLE_RATE / 512, 512, chroma, FRAMES_PER_SECOND, sound_starts, duration, evidence.get("scores", {})
            )
            if quick is not None:
                beat_times, bpm = np.asarray(quick[0], dtype=float), quick[1]
                boundaries = np.unique(np.concatenate([[0.0], beat_times[beat_times < duration], [duration]]))
                meter = 3
        except Exception:  # a failure here must never cost the song its chords: fall back on four
            meter = 4
    return Features(
        duration, bpm, boundaries, probs, bass_chroma, chroma, rms[:n], mfcc[:, :n],
        beat_times, sound_starts, _texture_features(y, n), meter,
    )


_FOLD_INDEX = np.array([int(np.argmax(_FOLD[c])) for c in range(NUM_CHORDS)])  # model class -> triad class (36 = none)
_REPEAT_BARS = 4  # nearby = this many bars either side
_REPEAT_MIN_MEAN = float(os.environ.get("CHORD_REPEAT_MIN_MEAN", "0.12"))  # a chord must average at least this at a beat position to be boosted there
_REPEAT_MIN_BARS = int(os.environ.get("CHORD_REPEAT_MIN_BARS", "5"))  # ...and show up (>= 0.05) in at least this many bars
_REPEAT_MIN_SAME = int(os.environ.get("CHORD_REPEAT_MIN_SAME", "7"))  # ...out of at least this many bars that have that beat
_REPEAT_MAX_BOOST = 6.0
_REPEAT_BLEND = float(os.environ.get("CHORD_REPEAT_BLEND", "0"))


def _repeat_weights(f: Features, probs: np.ndarray, strength: float) -> np.ndarray:
    """Per-frame multipliers (frames, 170) that favour chords which recur on the same beat of nearby bars.

    In a loop like "C . . F | C . . F | C . . F" the F on beat 4 may be loud in one bar and faint in the next
    when the playing gets denser. For every beat the triad probabilities are compared across the same beat of the
    bars around it with the average over all beats of those bars: a chord that is clearly more likely at this beat
    position than elsewhere (and recurs in several bars) is boosted here, and the chords it is rarer than are
    softened. Beats are grouped by the song's bar length, so only beat counts matter, not which beat starts a bar.
    """
    beats = f.beats
    weights = np.ones((len(probs), NUM_CHORDS))
    bpb = f.beats_per_bar
    if strength <= 0 or beats is None or len(beats) < bpb * (_REPEAT_MIN_BARS + 1):
        return weights
    folded = probs @ _FOLD  # (frames, 37)
    nb = len(beats)
    edges = np.append(beats, f.duration)
    frame_lo = np.clip((edges[:-1] * FRAMES_PER_SECOND).astype(int), 0, len(probs) - 1)
    frame_hi = np.clip((edges[1:] * FRAMES_PER_SECOND).astype(int), frame_lo + 1, len(probs))
    beat_p = np.array([folded[lo:hi].mean(axis=0) for lo, hi in zip(frame_lo, frame_hi)])  # (beats, 37)

    boost = np.ones((nb, 37))
    reach = bpb * _REPEAT_BARS
    for b in range(nb):
        near = np.arange(max(0, b - reach), min(nb, b + reach + 1))
        same = near[(near - b) % bpb == 0]
        if len(same) < _REPEAT_MIN_SAME:
            continue
        at_position = beat_p[same].mean(axis=0)
        everywhere = beat_p[near].mean(axis=0)
        recurring = (beat_p[same] >= 0.05).sum(axis=0) >= _REPEAT_MIN_BARS
        ratio = (at_position + 0.02) / (everywhere + 0.02)
        up = recurring & (at_position >= _REPEAT_MIN_MEAN) & (ratio > 1.0)
        down = (ratio < 1.0) & (everywhere >= _REPEAT_MIN_MEAN)
        if not up.any():
            continue  # nothing recurs here: leave the beat as the model heard it
        boost[b] = np.where(up, np.minimum(ratio**strength, _REPEAT_MAX_BOOST), np.where(down, np.maximum(ratio ** (0.5 * strength), 0.5), 1.0))
        boost[b, 36] = 1.0  # silence is left alone

    t = np.arange(len(probs)) / FRAMES_PER_SECOND
    if _REPEAT_BLEND > 0:
        # Blend the multipliers from one beat's middle to the next so a boost does not start or stop abruptly at a beat line.
        centers = (beats + edges[1:]) / 2
        log_boost = np.log(boost)
        blended = np.stack([np.interp(t, centers, log_boost[:, k]) for k in range(37)], axis=1)
        per_beat = np.exp(blended)
    else:
        beat_of_frame = np.clip(np.searchsorted(beats, t, side="right") - 1, 0, nb - 1)
        per_beat = boost[beat_of_frame]
    per_beat[t < beats[0]] = 1.0  # nothing is known before the first beat
    return per_beat[:, _FOLD_INDEX]  # (frames, 170)


def _absorb_slivers(segs: list[list], min_len: float) -> list[list]:
    """Chords shorter than `min_len` seconds join the longer of their neighbours; equal neighbours then merge."""
    if min_len <= 0 or len(segs) < 2:
        return segs
    segs = [list(s) for s in segs]
    while len(segs) > 1:
        i = next((k for k, (a, b, _c) in enumerate(segs) if b - a < min_len), None)
        if i is None:
            break
        left = segs[i - 1] if i > 0 else None
        right = segs[i + 1] if i + 1 < len(segs) else None
        if right is None or (left is not None and left[1] - left[0] >= right[1] - right[0]):
            left[1] = segs[i][1]
        else:
            right[0] = segs[i][0]
        del segs[i]
        if 0 < i < len(segs) and segs[i - 1][2] == segs[i][2]:  # the neighbours on both sides are now the same chord
            segs[i - 1][1] = segs[i][1]
            del segs[i]
    return segs


def decode(f: Features, opts: Optional[DecodeOptions] = None) -> list[dict]:
    """Chord segments (start, end, chord, confidence) from analysed features."""
    opts = opts or DecodeOptions()
    probs = uniform_filter1d(f.probs, size=opts.smooth, axis=0, mode="nearest") if opts.smooth > 1 else f.probs
    if opts.repeat > 0:
        probs = probs * _repeat_weights(f, probs, opts.repeat)
    if opts.detail == "simple":
        classes, conf = _core_chord_classes(probs, opts)
    else:
        classes = probs.argmax(axis=1)
        classes[classes == _UNKNOWN_IDX] = _NO_CHORD_IDX
        conf = probs[np.arange(len(classes)), classes]

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
    segs = _absorb_slivers(segs, opts.min_len)

    out: list[dict] = []
    for start, end, cls in segs:
        lo = int(start * FRAMES_PER_SECOND)
        hi = max(lo + 1, int(end * FRAMES_PER_SECOND))
        parts = _class_to_parts(cls)
        if parts is None:
            label = "N"
        else:
            root, quality = parts
            if opts.detail == "simple":
                label = _label(root, quality)
            else:
                if opts.color_weight > 0:
                    quality = _refine_quality(f, root, lo, hi, opts.color_weight)
                label = _label(root, quality, _bass_for_segment(f.bass_chroma, slice(lo, hi), root, quality))
        confidence = float(conf[lo:hi].mean())
        out.append({"start": float(start), "end": float(end), "chord": label, "confidence": round(confidence, 2)})
    return out


def detect_chords_ai(audio_path: str, on_progress: Optional[ProgressFn] = None) -> dict:
    progress = on_progress or (lambda _p, _s: None)

    progress(3, "Loading the chord model")
    _load_model()

    # The structure model is by far the slowest and hungriest part. It starts only after the chords are done (see
    # sectionsUpgrade below), so the two never use memory at the same time.
    sections_job = SectionsJob(audio_path)

    progress(8, "Loading audio")
    y, _ = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    features = extract_features(y, progress=progress)

    progress(92, "Building the chord timeline")
    simple = decode(features, DecodeOptions(detail="simple"))
    detailed = decode(features, DecodeOptions(detail="full"))

    progress(94, "Finding the song's sections")
    # Which beat cell of the chord grid each chord is written in (times themselves stay as detected).
    bpb = features.beats_per_bar
    phase = downbeat_phase(features.beats, simple, bpb)
    simple = place_chords_on_grid(simple, features.beats, phase, features.duration, bpb)
    detailed = place_chords_on_grid(detailed, features.beats, phase, features.duration, bpb)
    structure_inputs = (
        features.beats, features.duration, features.chroma, features.mfcc, features.rms,
        features.audible_start, phase, features.texture,
    )
    structure = analyze_structure(simple, *structure_inputs, None, bpb)

    def upgrade_sections() -> Optional[list[dict]]:
        """Waits for the structure model; its sections on our bars, or None when it gave none."""
        learned = sections_job.result()
        if not learned:
            return None
        return analyze_structure(simple, *structure_inputs, learned, bpb)["sections"]

    beat_list = [float(t) for t in features.boundaries[:-1]]
    if beat_list and beat_list[0] > 0.01:
        beat_list = [0.0] + beat_list
    beat_list.append(features.duration)

    return {
        "duration": features.duration,
        "chords": simple,  # the song's core chords (what the player shows by default)
        "chordsDetailed": detailed,  # every chord type the model recognises
        "key": estimate_key(simple),
        "tempo": round(features.bpm, 1),
        "beatTimes": beat_list,
        # bars of `beatsPerBar` beats (3, 4 or 6) starting where chords tend to change; a pickup / short last bar has null beats
        "beatsPerBar": bpb,
        "bars": structure["bars"],
        "sections": structure["sections"],
        # the main strumming pattern read from where the playing hits inside the bars (None if it could not be worked out)
        "strum": estimate_strum(y, SAMPLE_RATE, structure["bars"], bpb, features.bpm, simple),
        # Better sections from the structure model, for the caller to wait for (and strip before saving), or None.
        "sectionsUpgrade": upgrade_sections if sections_job.enabled else None,
    }
