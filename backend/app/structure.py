"""Song structure from the audio analysis: bars, then sections (intro / verse / chorus ...).

No extra model is needed. Everything comes from what the chord analysis already computed:

1. Bars. Beats are grouped in fours, starting at the beat where chord changes most often land.
2. Boundaries. A "novelty" curve over a bar-by-bar similarity matrix (harmony + timbre) peaks
   where the music changes character; the strongest peaks become section starts.
3. Grouping. Sections that sound alike (similar harmony and timbre at the same position) are
   clustered, so repeats of the same verse or chorus share a label.
4. Naming. Repeated, louder groups are choruses, repeated quieter ones verses, one-offs at the start
   and end are intro and outro, and one-offs in the middle are bridges.

The names are heuristics from repetition and loudness, not a trained classifier: boundaries are
usually close, names are sometimes wrong (an instrumental break can come out as a bridge).
"""

from __future__ import annotations

from collections import Counter
from typing import Optional

import numpy as np
from scipy.signal import find_peaks
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score

FRAMES_PER_SECOND = 22050 / 2048
BEATS_PER_BAR = 4
PHRASE = 4  # bars per phrase: sections start and end on this grid
AUDIBLE_RMS = 0.003  # about -50 dBFS: below this nothing can be heard; above it (however soft) it is music


def audible_start(rms: np.ndarray) -> float:
    """When sound begins. Quiet playing counts: only an opening that is practically silent is skipped."""
    above = np.flatnonzero(rms > AUDIBLE_RMS)
    return float(above[0]) / FRAMES_PER_SECOND if len(above) else 0.0


def regularize_beats(beats: np.ndarray, start: float) -> np.ndarray:
    """Make the beat grid cover the whole song.

    The beat tracker locks on where the rhythm is clear and can miss a soft intro or a quiet passage, which
    would leave those bars out of the chord grid. Beats are extended back to `start` and any gap longer than
    1.5 beats is filled at the song's own tempo.
    """
    if len(beats) < 4:
        return beats
    period = float(np.median(np.diff(beats)))
    filled = [float(beats[0])]
    for t in beats[1:]:
        last = filled[-1]
        gap = float(t) - last
        steps = int(round(gap / period))
        if steps > 1 and gap > 1.5 * period:
            filled.extend([last + gap * k / steps for k in range(1, steps)])
        filled.append(float(t))
    first = filled[0]
    count = int(np.floor((first - start) / period + 0.5))
    prefix = [first - period * i for i in range(count, 0, -1)]
    return np.array([t for t in prefix if t >= 0.0] + filled)


def downbeat_phase(beats: np.ndarray, chords: list[dict]) -> int:
    """Which of the four beat positions chords change on most often: that beat starts the bar."""
    if len(beats) < 8:
        return 0
    beat_len = float(np.median(np.diff(beats)))
    counts = np.zeros(BEATS_PER_BAR)
    for chord in chords[1:]:
        if chord["chord"] == "N":
            continue
        i = int(np.argmin(np.abs(beats - chord["start"])))
        if abs(beats[i] - chord["start"]) < 0.3 * beat_len:
            counts[i % BEATS_PER_BAR] += 1
    return int(counts.argmax())


def build_bars(beats: np.ndarray, duration: float, phase: int) -> list[dict]:
    """Bars of four beats. Each bar: {"start", "beats": 4 beat times + the next bar's start}.

    A pickup before the first full bar and a short last bar are padded with None beats.
    """
    bars: list[dict] = []
    if len(beats) == 0:
        return bars
    if phase > 0:
        bars.append(
            {
                "start": float(beats[0]),
                "beats": [None] * (BEATS_PER_BAR - phase) + [float(t) for t in beats[:phase]] + [float(beats[phase])],
            }
        )
    i = phase
    while i < len(beats):
        group = [float(t) for t in beats[i : i + BEATS_PER_BAR]]
        end = float(beats[i + BEATS_PER_BAR]) if i + BEATS_PER_BAR < len(beats) else float(duration)
        group += [None] * (BEATS_PER_BAR - len(group))
        bars.append({"start": group[0], "beats": group + [end]})
        i += BEATS_PER_BAR
    return bars


def _bar_range(bar: dict) -> tuple[float, float]:
    return bar["start"], bar["beats"][-1]


def _novelty(similarity: np.ndarray, half: int = 4) -> np.ndarray:
    """Foote's checkerboard-kernel novelty: high where the music before a bar differs from after it."""
    n = len(similarity)
    taper = np.exp(-0.5 * (np.arange(-half + 0.5, half + 0.5) / (half / 2)) ** 2)
    sign = np.array([-1.0] * half + [1.0] * half)
    kernel = np.outer(taper * sign, taper * sign)
    padded = np.pad(similarity, half, mode="edge")
    out = np.zeros(n)
    for i in range(n):
        out[i] = (padded[i : i + 2 * half, i : i + 2 * half] * kernel).sum()
    return out


def analyze_structure(
    chords: list[dict],
    beats: np.ndarray,
    duration: float,
    chroma: np.ndarray,
    mfcc: np.ndarray,
    rms: np.ndarray,
    audible_start_s: float = 0.0,
) -> dict:
    """Returns {"bars": [...], "sections": [{"label","start","end","startBar","endBar"}], "downbeatPhase": int}."""
    phase = downbeat_phase(beats, chords)
    bars = build_bars(beats, duration, phase)
    full = [i for i, b in enumerate(bars) if None not in b["beats"][:BEATS_PER_BAR]]
    if len(full) < 8:  # too short to find structure in
        return {"bars": bars, "downbeatPhase": phase, "sections": _single_section(bars, duration)}

    n_frames = chroma.shape[1]

    def frames(t0: float, t1: float) -> slice:
        lo = min(int(t0 * FRAMES_PER_SECOND), n_frames - 1)
        return slice(lo, max(lo + 1, min(int(t1 * FRAMES_PER_SECOND), n_frames)))

    # Per-bar descriptors: the four beats' chroma in order (the progression), timbre, loudness.
    chroma_seq, timbre, energy = [], [], []
    for i in full:
        b = bars[i]["beats"]
        beats_chroma = []
        for k in range(BEATS_PER_BAR):
            v = chroma[:, frames(b[k], b[k + 1])].mean(axis=1)
            beats_chroma.append(v / (np.linalg.norm(v) + 1e-9))
        chroma_seq.append(np.concatenate(beats_chroma))
        timbre.append(mfcc[:, frames(b[0], b[BEATS_PER_BAR])].mean(axis=1))
        energy.append(float(rms[frames(b[0], b[BEATS_PER_BAR])].mean()))
    chroma_seq = np.array(chroma_seq)
    timbre = np.array(timbre)
    energy = np.array(energy)
    timbre = (timbre - timbre.mean(axis=0)) / (timbre.std(axis=0) + 1e-9)

    features = np.hstack([chroma_seq / np.sqrt(BEATS_PER_BAR), 0.35 * timbre / np.sqrt(timbre.shape[1])])
    features = features - features.mean(axis=0)
    unit = features / (np.linalg.norm(features, axis=1, keepdims=True) + 1e-9)
    similarity = unit @ unit.T
    n = len(full)

    # Songs are built from 4-bar phrases, so sections start on one common 4-bar grid. Find the grid
    # offset where the music changes most, then take the strongest changes on that grid.
    novelty = _novelty(similarity)
    offset = int(np.argmax([novelty[r::PHRASE].sum() for r in range(PHRASE)]))
    grid = np.arange(offset, n - 3, PHRASE)
    grid = grid[grid >= PHRASE] if offset == 0 else grid
    wanted = int(np.clip(round(n / 10), 2, 14)) - 1
    strongest = sorted(int(g) for g in grid[np.argsort(-novelty[grid])[:wanted]])
    starts = [0] + strongest
    ends = starts[1:] + [n]
    segments = [(a, b) for a, b in zip(starts, ends) if b - a >= 2]
    if len(segments) >= 2 and segments[0][1] - segments[0][0] < PHRASE:  # a stub before the grid: fold it in
        segments = [(0, segments[1][1])] + segments[2:]

    # Group sections that sound alike: mean similarity of the aligned bars of each pair. The number of
    # groups is whichever (2-4) separates the sections best.
    m = len(segments)
    distance = np.zeros((m, m))
    for i, (a0, a1) in enumerate(segments):
        for j, (b0, b1) in enumerate(segments):
            length = min(a1 - a0, b1 - b0)
            distance[i, j] = 1.0 - float(np.mean([similarity[a0 + k, b0 + k] for k in range(length)]))
    distance = (distance + distance.T) / 2  # symmetric, since a section compared with itself is exactly alike
    np.fill_diagonal(distance, 0.0)
    clusters = np.zeros(m, dtype=int)
    separation = 0.0  # silhouette of the chosen grouping: how clearly the groups differ
    if m >= 3:
        best = -2.0
        for k in range(2, min(4, m - 1) + 1):
            candidate = AgglomerativeClustering(n_clusters=k, metric="precomputed", linkage="average").fit_predict(distance)
            score = silhouette_score(distance, candidate, metric="precomputed")
            if score > best:
                best, clusters = score, candidate
        separation = best
    elif m == 2:
        clusters = np.array([0, 0 if distance[0, 1] < 0.4 else 1])

    # Neighbouring sections from the same group are one longer section, not separate ones.
    merged, merged_clusters = [segments[0]], [int(clusters[0])]
    for segment, cluster in zip(segments[1:], clusters[1:]):
        if int(cluster) == merged_clusters[-1]:
            merged[-1] = (merged[-1][0], segment[1])
        else:
            merged.append(segment)
            merged_clusters.append(int(cluster))
    segments, clusters = merged, np.array(merged_clusters)

    energy_db = np.array([20 * np.log10(energy[a:b].mean() + 1e-9) for a, b in segments])
    labels = _name_sections(segments, clusters, energy_db, separation)

    sections = []
    # Silence is only an opening in which nothing can be heard. A soft intro is music and is part of the grid.
    if audible_start_s > 0.5:
        sections.append(_section("Silence", 0.0, audible_start_s, None, None))
    for index, ((a, b), label) in enumerate(zip(segments, labels)):
        # the first section also owns a pickup bar before the first full bar
        start_bar, end_bar = (0 if index == 0 else full[a]), full[b - 1]
        end_time = bars[end_bar]["beats"][-1]
        # extend the last section over a short trailing partial bar so nothing is left uncovered
        if b == n:
            end_time = duration
        sections.append(_section(label, bars[start_bar]["start"], end_time, start_bar, end_bar))
    for prev, cur in zip(sections, sections[1:]):  # no gaps or overlaps between neighbours
        prev["end"] = cur["start"]
    return {"bars": bars, "downbeatPhase": phase, "sections": sections}


def _section(label: str, start: float, end: float, start_bar: Optional[int], end_bar: Optional[int]) -> dict:
    return {"label": label, "start": float(start), "end": float(end), "startBar": start_bar, "endBar": end_bar}


def _single_section(bars: list[dict], duration: float) -> list[dict]:
    if not bars:
        return []
    return [_section("Verse 1", bars[0]["start"], duration, 0, len(bars) - 1)]


def _name_sections(segments: list[tuple[int, int]], clusters: np.ndarray, energy_db: np.ndarray, separation: float) -> list[str]:
    """Names from repetition and loudness.

    Verse / Chorus are only claimed when the loudest repeated group and the biggest other repeated group
    clearly differ (well separated, and at least 1.5 dB apart in loudness). Otherwise parts are labelled
    A, B, C by how alike they sound, so repeats are still visible without guessing. Intro / Outro need a one-off section at that end that is clearly
    quieter (2 dB) than the typical section.
    """
    m = len(segments)
    ids = list(dict.fromkeys(int(c) for c in clusters))  # group ids in order of first appearance
    letter = {c: chr(65 + i) for i, c in enumerate(ids)}
    counts = Counter(int(c) for c in clusters)
    group_db = {c: float(np.mean([e for e, k in zip(energy_db, clusters) if k == c])) for c in ids}
    repeated = [c for c in ids if counts[c] >= 2]

    names: list[Optional[str]] = [None] * m
    if len(repeated) >= 2:
        chorus = max(repeated, key=lambda c: group_db[c])
        verse = max(
            (c for c in repeated if c != chorus),
            key=lambda c: sum(b - a for (a, b), k in zip(segments, clusters) if k == c),
        )
        if separation >= 0.25 and group_db[chorus] - group_db[verse] >= 1.5:
            role = {chorus: "Chorus", verse: "Verse"}
            names = [role.get(int(c)) for c in clusters]

    typical = float(np.median(energy_db))
    if m > 2:
        if counts[int(clusters[0])] == 1 and energy_db[0] <= typical - 2:
            names[0] = "Intro"
        if counts[int(clusters[-1])] == 1 and energy_db[-1] <= typical - 2:
            names[-1] = "Outro"

    totals = Counter(n for n in names if n)
    seen: Counter = Counter()
    out = []
    for i, name in enumerate(names):
        if name is None:
            out.append(f"Part {letter[int(clusters[i])]}")
            continue
        seen[name] += 1
        out.append(f"{name} {seen[name]}" if name in ("Verse", "Chorus") or totals[name] > 1 else name)
    return out


# Krumhansl-Kessler key profiles
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_TRIADS = {"": (0, 4, 7), "m": (0, 3, 7), "dim": (0, 3, 6)}


def estimate_key(chords: list[dict]) -> str:
    """The key the transcribed chords sit in, e.g. "G" or "F#m": notes of every chord, weighted by how long
    it lasts, matched against major and minor key profiles."""
    weights = np.zeros(12)
    for chord in chords:
        name = chord["chord"]
        if name == "N":
            continue
        root_len = 2 if len(name) > 1 and name[1] == "#" else 1
        root, quality = _NOTE_NAMES.index(name[:root_len]), name[root_len:].split("/")[0]
        for interval in _TRIADS.get(quality, _TRIADS[""]):
            weights[(root + interval) % 12] += chord["end"] - chord["start"]
    if weights.sum() == 0:
        return ""
    best, key = -2.0, ""
    for tonic in range(12):
        for suffix, profile in (("", _MAJOR_PROFILE), ("m", _MINOR_PROFILE)):
            corr = float(np.corrcoef(weights, np.roll(profile, tonic))[0, 1])
            if corr > best:
                best, key = corr, _NOTE_NAMES[tonic] + suffix
    return key
