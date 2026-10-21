"""Accuracy benchmark for the chord detector.

Two modes:

  python eval/run_eval.py --synthetic 10
      Renders random chord progressions (every quality, some slash chords) to audio with
      exactly known chords and scores the detector on them. This is a sanity check of the
      full pipeline, NOT a measure of real-world accuracy: synthetic tones are far cleaner
      than recorded music, so expect these numbers to be optimistic.

  python eval/run_eval.py --songs eval/songs
      Scores real recordings. Put each song in the folder as NAME.mp3/.wav plus NAME.lab,
      a reference chord file with one line per chord:  start_seconds end_seconds label
      (Harte labels such as C:maj, A:min7, G:7/5, N — the format used by the Isophonics
      and Billboard datasets). Use charts you have verified by ear.

Scores use mir_eval's standard chord metrics (time-weighted):
  root      root note correct
  majmin    correct for major/minor chords only
  triads    root + triad quality (major/minor/dim/aug)
  sevenths  root + quality including 7th chords
  tetrads   exact match of four-note chords
  mirex     at least three chord notes shared with the reference
"""

from __future__ import annotations

import argparse
import collections
import glob
import os
import sys
import tempfile

import mir_eval
import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.ai_chords import detect_chords_ai  # noqa: E402

SR = 22050
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
DEGREE = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"]

# our suffix -> (Harte quality, intervals)
QUALITIES = {
    "": ("maj", (0, 4, 7)), "m": ("min", (0, 3, 7)), "7": ("7", (0, 4, 7, 10)),
    "maj7": ("maj7", (0, 4, 7, 11)), "m7": ("min7", (0, 3, 7, 10)),
    "mMaj7": ("minmaj7", (0, 3, 7, 11)), "sus2": ("sus2", (0, 2, 7)),
    "sus4": ("sus4", (0, 5, 7)), "dim": ("dim", (0, 3, 6)), "aug": ("aug", (0, 4, 8)),
    "6": ("maj6", (0, 4, 7, 9)), "m6": ("min6", (0, 3, 7, 9)),
    "dim7": ("dim7", (0, 3, 6, 9)), "m7b5": ("hdim7", (0, 3, 6, 10)),
}


def parse_label(chord: str) -> tuple[int, str, int] | None:
    """Our label (C#m7/G#) -> (root pc, suffix, bass pc), None for N."""
    if chord == "N":
        return None
    body, _, bass = chord.partition("/")
    root_len = 2 if len(body) > 1 and body[1] == "#" else 1
    root = NOTE_NAMES.index(body[:root_len])
    return root, body[root_len:], NOTE_NAMES.index(bass) if bass else root


def to_harte(chord: str) -> str:
    parsed = parse_label(chord)
    if parsed is None:
        return "N"
    root, suffix, bass = parsed
    label = f"{NOTE_NAMES[root]}:{QUALITIES[suffix][0]}"
    return label if bass == root else f"{label}/{DEGREE[(bass - root) % 12]}"


# --- synthetic audio ---------------------------------------------------------------

def _pluck(freq: float, seconds: float, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    out = np.zeros_like(t)
    for k in range(1, 9):
        if freq * k > SR / 2:
            break
        out += (1 / k) * np.sin(2 * np.pi * freq * k * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t * (1.2 + 0.6 * k))
    return out * np.minimum(1.0, t / 0.004)


def render_progression(chords: list[str], bpm: float, rng: np.random.Generator) -> np.ndarray:
    """Guitar-ish strummed chords (four strums per chord) over a kick/hat pulse, with noise."""
    beat = 60.0 / bpm
    total = len(chords) * 4 * beat + 1.0
    audio = np.zeros(int(total * SR))

    def add(sig: np.ndarray, at: float) -> None:
        i = int(at * SR)
        n = min(len(sig), len(audio) - i)
        if n > 0:
            audio[i : i + n] += sig[:n]

    for ci, chord in enumerate(chords):
        root, suffix, bass = parse_label(chord)  # type: ignore[misc]
        pcs = [(root + i) % 12 for i in QUALITIES[suffix][1]]
        # upper voicing: each chord tone in a random octave between midi 52 and 76
        upper = []
        for pc in pcs:
            options = [m for m in range(52, 77) if m % 12 == pc]
            upper.append(int(rng.choice(options)))
        bass_midi = 36 + ((bass - 36) % 12)
        for b in range(4):
            start = (ci * 4 + b) * beat
            add(0.9 * _pluck(440.0 * 2 ** ((bass_midi - 69) / 12), beat * 1.3, rng), start)
            for j, midi in enumerate(sorted(upper)):
                add(0.45 * _pluck(440.0 * 2 ** ((midi - 69) / 12), beat * 1.3, rng), start + 0.012 * (j + 1))

    t = np.arange(int(0.09 * SR)) / SR
    kick = np.sin(2 * np.pi * (50 * t + 70 * (1 - np.exp(-t * 40)) / 40)) * np.exp(-t * 35)
    for b in range(int(total / beat)):
        add(0.7 * kick, b * beat)
        hat = rng.normal(size=int(0.03 * SR)) * np.exp(-np.arange(int(0.03 * SR)) / (0.006 * SR))
        add(0.08 * hat, b * beat + beat / 2)

    audio += rng.normal(scale=0.004, size=len(audio))
    return (0.9 * audio / np.max(np.abs(audio))).astype(np.float32)


def random_progression(n: int, rng: np.random.Generator) -> list[str]:
    suffixes = list(QUALITIES)
    chords: list[str] = []
    while len(chords) < n:
        root = int(rng.integers(12))
        suffix = suffixes[int(rng.integers(len(suffixes)))]
        bass = root
        if rng.random() < 0.15:  # slash chord: bass on another chord tone
            tones = [(root + i) % 12 for i in QUALITIES[suffix][1][1:]]
            bass = int(rng.choice(tones))
        label = NOTE_NAMES[root] + suffix + (f"/{NOTE_NAMES[bass]}" if bass != root else "")
        if not chords or label != chords[-1]:
            chords.append(label)
    return chords


# --- scoring -----------------------------------------------------------------------

METRICS = ["root", "majmin", "triads", "sevenths", "tetrads", "mirex"]


def score(ref: list[tuple[float, float, str]], est: list[tuple[float, float, str]]) -> dict[str, float]:
    ref_i = np.array([[s, e] for s, e, _ in ref])
    ref_l = [c for _, _, c in ref]
    est_i = np.array([[s, e] for s, e, _ in est])
    est_l = [to_harte(c) for _, _, c in est]
    est_i, est_l = mir_eval.util.adjust_intervals(
        est_i, est_l, ref_i.min(), ref_i.max(), mir_eval.chord.NO_CHORD, mir_eval.chord.NO_CHORD
    )
    intervals, ref_l, est_l = mir_eval.util.merge_labeled_intervals(ref_i, ref_l, est_i, est_l)
    durations = mir_eval.util.intervals_to_durations(intervals)
    return {
        m: float(mir_eval.chord.weighted_accuracy(getattr(mir_eval.chord, m)(ref_l, est_l), durations))
        for m in METRICS
    }


CONFUSIONS: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)


def quality_breakdown(ref, est, step: float = 0.05) -> dict[str, tuple[int, int, int]]:
    """Per reference quality: (frames, root correct, root+quality correct), ignoring bass.

    Also records into CONFUSIONS what wrong-quality frames were detected as (root correct only).
    """
    def at(segments, t):
        for s, e, c in segments:
            if s <= t < e:
                return c
        return "N"

    end = max(e for _, e, _ in ref)
    stats: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0, 0])
    for t in np.arange(0, end, step):
        r, d = parse_label(at(ref, t)), parse_label(at(est, t))
        if r is None:
            continue
        key = r[1] or "maj"
        stats[key][0] += 1
        if d is not None and d[0] == r[0]:
            stats[key][1] += 1
            if d[1] == r[1]:
                stats[key][2] += 1
            else:
                CONFUSIONS[key][d[1] or "maj"] += 1
    return {k: tuple(v) for k, v in stats.items()}  # type: ignore[misc]


def detect(path: str):
    result = detect_chords_ai(path)
    return [(c["start"], c["end"], c["chord"]) for c in result["chords"]]


def harte_to_ours(label: str) -> str:
    """Harte (A:min7/5) -> our label, only needed to drive the per-quality breakdown on real songs."""
    if label in ("N", "X"):
        return "N"
    body, _, bass = label.partition("/")
    root, _, quality = body.partition(":")
    inverse = {h: s for s, (h, _) in QUALITIES.items()}
    quality = {"": "maj", "maj": "maj"}.get(quality, quality)
    suffix = inverse.get(quality)
    if suffix is None:
        return "N"  # a quality outside our 14 (e.g. 9ths): not scorable per quality
    name = NOTE_NAMES[NOTE_NAMES.index(root)] if root in NOTE_NAMES else root
    return name + suffix


# --- runners -----------------------------------------------------------------------

def print_summary(title: str, rows: list[dict[str, float]], breakdown: dict[str, list[int]]) -> None:
    print(f"\n== {title} ({len(rows)} tracks) ==")
    for m in METRICS:
        vals = [r[m] for r in rows]
        print(f"  {m:9s} {100 * np.mean(vals):5.1f}%   (min {100 * min(vals):.0f}%, max {100 * max(vals):.0f}%)")
    if breakdown:
        print("\n  per chord type (share of reference time detected as ...):")
        print(f"  {'type':8s} {'seconds':>8s} {'root ok':>8s} {'exact':>8s}")
        for suffix, (frames, root_ok, exact) in sorted(breakdown.items(), key=lambda kv: -kv[1][0]):
            wrong = CONFUSIONS.get(suffix or "maj")
            mistaken = ", ".join(f"{k} {100 * v / frames:.0f}%" for k, v in wrong.most_common(2)) if wrong else ""
            print(f"  {suffix or 'maj':8s} {frames * 0.05:8.0f} {100 * root_ok / frames:7.0f}% {100 * exact / frames:7.0f}%   {('mistaken for ' + mistaken) if mistaken else ''}")


def run_synthetic(n_tracks: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    rows, totals = [], collections.defaultdict(lambda: [0, 0, 0])
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n_tracks):
            bpm = float(rng.choice([80, 95, 110, 120]))
            chords = random_progression(20, rng)
            beat = 60.0 / bpm
            ref = [(k * 4 * beat, (k + 1) * 4 * beat, to_harte(c)) for k, c in enumerate(chords)]
            path = os.path.join(tmp, f"synth{i}.wav")
            sf.write(path, render_progression(chords, bpm, rng), SR)
            est = detect(path)
            rows.append(score(ref, est))
            ours_ref = [(s, e, c) for (s, e, _), c in zip(ref, chords)]
            for suffix, v in quality_breakdown(ours_ref, est).items():
                totals[suffix] = [a + b for a, b in zip(totals[suffix], v)]
            print(f"  track {i + 1}/{n_tracks}: bpm {bpm:.0f}, " + ", ".join(f"{m} {100 * rows[-1][m]:.0f}" for m in METRICS), flush=True)
    print_summary("Synthetic progressions", rows, dict(totals))


def run_songs(folder: str, lab_ext: str = ".lab") -> None:
    rows, totals = [], collections.defaultdict(lambda: [0, 0, 0])
    audio_files = sorted(p for ext in ("mp3", "wav", "flac", "m4a") for p in glob.glob(os.path.join(folder, f"*.{ext}")))
    for path in audio_files:
        lab = os.path.splitext(path)[0] + lab_ext
        if not os.path.exists(lab):
            print(f"  skipping {os.path.basename(path)}: no .lab file")
            continue
        ref = []
        for line in open(lab, encoding="utf-8"):
            parts = line.split()
            if len(parts) >= 3:
                ref.append((float(parts[0]), float(parts[1]), parts[2]))
        est = detect(path)
        rows.append(score(ref, est))
        ours_ref = [(s, e, harte_to_ours(c)) for s, e, c in ref]
        for suffix, v in quality_breakdown(ours_ref, est).items():
            totals[suffix] = [a + b for a, b in zip(totals[suffix], v)]
        print(f"  {os.path.basename(path)}: " + ", ".join(f"{m} {100 * rows[-1][m]:.0f}" for m in METRICS), flush=True)
    if not rows:
        print("No scorable songs found (need NAME.mp3/.wav next to NAME.lab).")
        return
    print_summary("Real songs", rows, dict(totals))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--synthetic", type=int, metavar="N", help="score N random synthetic progressions")
    ap.add_argument("--songs", metavar="DIR", help="score real songs (audio + .lab) in DIR")
    ap.add_argument("--lab-ext", default=".lab", help="reference file suffix, e.g. .performed.lab")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    if args.synthetic:
        run_synthetic(args.synthetic, args.seed)
    if args.songs:
        run_songs(args.songs, args.lab_ext)
    if not (args.synthetic or args.songs):
        ap.print_help()
