"""Song structure from the audio analysis: bars, then sections (intro / verse / chorus ...).

No extra model is needed. Everything comes from what the chord analysis already computed:

1. Bars. Beats are grouped into bars of the song's own length (usually four, sometimes three or six; see meter.py),
   starting at the beat where chord changes most often land.
0. Sections can come from a trained model (sections_ai.py); everything below is the model-free fallback.
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
from scipy.ndimage import uniform_filter1d
from scipy.signal import find_peaks
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score

FRAMES_PER_SECOND = 22050 / 2048
BEATS_PER_BAR = 4  # the usual bar; every function below takes the song's own `bpb` and defaults to this
PHRASE = 4  # bars per phrase: sections start and end on this grid
MAX_MERGED_BARS = 16  # neighbouring look-alike sections are merged only up to this many bars
MAX_SECTION_BARS = 20  # a section longer than this is split at its strongest internal change...
MIN_SPLIT_BARS = 8  # ...but never closer than this to either end
MAX_SHIFT_BARS = 4  # a section start moves on past at most this many bars that have no chord change
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


def downbeat_phase(beats: np.ndarray, chords: list[dict], bpb: int = BEATS_PER_BAR) -> int:
    """Which of the bar's beat positions chords change on most often: that beat starts the bar."""
    if len(beats) < 8:
        return 0
    beat_len = float(np.median(np.diff(beats)))
    counts = np.zeros(bpb)
    for chord in chords[1:]:
        if chord["chord"] == "N":
            continue
        i = int(np.argmin(np.abs(beats - chord["start"])))
        if abs(beats[i] - chord["start"]) < 0.3 * beat_len:
            counts[i % bpb] += 1
    return int(counts.argmax())


def build_bars(beats: np.ndarray, duration: float, phase: int, bpb: int = BEATS_PER_BAR) -> list[dict]:
    """Bars of `bpb` beats. Each bar: {"start", "beats": bpb beat times + the next bar's start}.

    A short last bar is padded with None beats. A pickup (the music starts part-way through a bar) is completed
    backwards at the song's own beat length, so the first cell of the first bar is the first beat of the song:
    playback lights it from the very start instead of skipping to the third cell.
    """
    bars: list[dict] = []
    if len(beats) == 0:
        return bars
    if phase > 0:
        period = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
        missing = bpb - phase
        lead = [max(0.0, float(beats[0]) - period * (missing - j)) for j in range(missing)]
        bars.append({"start": lead[0], "beats": lead + [float(t) for t in beats[:phase]] + [float(beats[phase])]})
    i = phase
    while i < len(beats):
        group = [float(t) for t in beats[i : i + bpb]]
        end = float(beats[i + bpb]) if i + bpb < len(beats) else float(duration)
        group += [None] * (bpb - len(group))
        bars.append({"start": group[0], "beats": group + [end]})
        i += bpb
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


_LEARNED_NAMES = {
    "intro": "Intro", "verse": "Verse", "chorus": "Chorus", "bridge": "Bridge",
    "inst": "Instrumental", "solo": "Instrumental", "break": "Break", "outro": "Outro",
}


def _learned_segments(
    learned: list[tuple[float, float, str]], bars: list[dict], full: list[int], novelty: np.ndarray, n: int
) -> tuple[list[tuple[int, int]], list[str]]:
    """Put a structure model's sections on our bar grid.

    The model's boundary times are only good to about a bar, so each one moves to whichever of the nearest bars
    shows the biggest change in the audio itself (preferring whole 4-bar phrases from the previous boundary).
    Neighbouring sections with the same name are one section, as long as they stay under MAX_SECTION_BARS.
    """
    bar_starts = np.array([bars[i]["start"] for i in full])
    bar_len = float(np.median(np.diff(bar_starts)))
    peak = float(novelty.max()) + 1e-9
    cuts, names = [0], [learned[0][2]]
    for start, _end, label in learned[1:]:
        near = int(np.argmin(np.abs(bar_starts - start)))
        candidates = [i for i in range(near - 1, near + 2) if cuts[-1] < i < n]
        if not candidates:
            continue

        def score(i: int) -> float:
            aligned = 0.15 if (i - cuts[-1]) % PHRASE == 0 else 0.0
            return float(novelty[i]) / peak - 0.35 * abs(bar_starts[i] - start) / bar_len + aligned

        cuts.append(max(candidates, key=score))
        names.append(label)
    segments = [[a, b] for a, b in zip(cuts, cuts[1:] + [n])]

    merged: list[list] = []
    for (a, b), name in zip(segments, names):
        if merged and merged[-1][2] == name and b - merged[-1][0] <= MAX_SECTION_BARS:
            merged[-1][1] = b
        elif merged and b - a < 2:  # a stub: fold it into the section before it
            merged[-1][1] = b
        else:
            merged.append([a, b, name])
    if len(merged) >= 2 and merged[0][1] - merged[0][0] < 2:
        merged[1][0] = merged[0][0]
        merged.pop(0)

    totals = Counter(name for _a, _b, name in merged)
    seen: Counter = Counter()
    labels = []
    for _a, _b, name in merged:
        title = _LEARNED_NAMES.get(name, name.capitalize())
        seen[name] += 1
        labels.append(f"{title} {seen[name]}" if title in ("Verse", "Chorus") or totals[name] > 1 else title)
    return [(a, b) for a, b, _ in merged], labels


def _classic_segments(similarity: np.ndarray, novelty: np.ndarray, energy: np.ndarray, n: int) -> tuple[list[tuple[int, int]], list[str]]:
    """Sections from the audio alone: the strongest changes on the 4-bar grid, grouped by how alike they sound."""
    # Songs are built from 4-bar phrases, so sections start on one common 4-bar grid. Find the grid
    # offset where the music changes most, then take the strongest changes on that grid.
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

    # A section much longer than a verse or chorus hides the song's structure: split it where the music
    # changes most, on the same phrase grid.
    split: list[tuple[int, int]] = []
    pending = list(segments)
    while pending:
        a0, a1 = pending.pop(0)
        inside = [p for p in range(a0 + MIN_SPLIT_BARS, a1 - MIN_SPLIT_BARS + 1) if (p - offset) % PHRASE == 0]
        if a1 - a0 > MAX_SECTION_BARS and inside:
            cut = max(inside, key=lambda p: novelty[p])
            pending = [(a0, cut), (cut, a1)] + pending
        else:
            split.append((a0, a1))
    segments = split

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

    # Neighbouring sections from the same group read as one longer section, as long as it stays a phrase or two.
    # A bigger block would hide the song's structure, so those stay separate.
    merged, merged_clusters = [segments[0]], [int(clusters[0])]
    for segment, cluster in zip(segments[1:], clusters[1:]):
        if int(cluster) == merged_clusters[-1] and segment[1] - merged[-1][0] <= MAX_MERGED_BARS:
            merged[-1] = (merged[-1][0], segment[1])
        else:
            merged.append(segment)
            merged_clusters.append(int(cluster))
    segments, clusters = merged, np.array(merged_clusters)

    energy_db = np.array([20 * np.log10(energy[a:b].mean() + 1e-9) for a, b in segments])
    labels = _name_sections(segments, clusters, energy_db, separation)
    return segments, labels


def _early_chord_bars(chords: list[dict], bars: list[dict], bpb: int = BEATS_PER_BAR) -> set[int]:
    """Indices into `bars` of the bars where a chord starts on any beat but the last. A chord only on the
    last beat is a pickup into the next bar, which does not make its own bar the start of anything."""
    out: set[int] = set()
    for chord in chords:
        t = chord.get("gridStart")
        if t is None:
            continue
        for i, bar in enumerate(bars):
            if any(bt is not None and abs(bt - t) < 1e-3 for bt in bar["beats"][: bpb - 1]):
                out.add(i)
                break
    return out


def _start_where_chords_do(
    segments: list[tuple[int, int]], bars: list[dict], full: list[int], early: set[int], limit: int
) -> list[tuple[int, int]]:
    """A section starts where its progression does. Leading bars in which the chord only rings on (or just picks up
    on the last beat) still belong to the section before, so they stay in it - as in a hand-made chord chart."""
    out = [list(seg) for seg in segments]
    for k in range(1, len(out)):
        a, b = out[k]
        moved = a
        while moved < b - PHRASE and moved - a < limit and full[moved] not in early:
            moved += 1
        out[k][0] = moved
        out[k - 1][1] = moved
    return [(a, b) for a, b in out]


def analyze_structure(
    chords: list[dict],
    beats: np.ndarray,
    duration: float,
    chroma: np.ndarray,
    mfcc: np.ndarray,
    rms: np.ndarray,
    audible_start_s: float = 0.0,
    phase: Optional[int] = None,
    texture: Optional[np.ndarray] = None,
    learned: Optional[list[tuple[float, float, str]]] = None,
    bpb: int = BEATS_PER_BAR,
) -> dict:
    """Returns {"bars": [...], "sections": [{"label","start","end","startBar","endBar"}], "downbeatPhase": int}.

    `learned` are (start, end, label) sections from a trained structure model (sections_ai.py). Its boundaries are
    snapped to our own bars and it supplies the names; without it, sections come from the audio alone.
    """
    if phase is None:
        phase = downbeat_phase(beats, chords, bpb)
    bars = build_bars(beats, duration, phase, bpb)
    full = [i for i, b in enumerate(bars) if None not in b["beats"][:bpb]]
    if len(full) < 8:  # too short to find structure in
        return {"bars": bars, "downbeatPhase": phase, "beatsPerBar": bpb, "sections": _single_section(bars, duration)}

    n_frames = chroma.shape[1]

    def frames(t0: float, t1: float) -> slice:
        lo = min(int(t0 * FRAMES_PER_SECOND), n_frames - 1)
        return slice(lo, max(lo + 1, min(int(t1 * FRAMES_PER_SECOND), n_frames)))

    # Per-bar descriptors: the progression (the four beats' chroma in order) and the texture of the sound
    # (how loud, bright and percussive it is, plus timbre). Sections often play the same chords and differ
    # only in texture, so texture carries as much weight as harmony.
    chroma_seq, texture_bars, energy = [], [], []
    for i in full:
        b = bars[i]["beats"]
        beats_chroma = []
        for k in range(bpb):
            v = chroma[:, frames(b[k], b[k + 1])].mean(axis=1)
            beats_chroma.append(v / (np.linalg.norm(v) + 1e-9))
        chroma_seq.append(np.concatenate(beats_chroma))
        span = frames(b[0], b[bpb])
        parts = [mfcc[:, span].mean(axis=1)]
        if texture is not None:
            parts.append(texture[:, span].mean(axis=1))
        texture_bars.append(np.concatenate(parts))
        energy.append(float(rms[span].mean()))
    chroma_seq = np.array(chroma_seq)
    energy = np.array(energy)
    texture_bars = uniform_filter1d(np.array(texture_bars), size=3, axis=0, mode="nearest")  # steady over +-1 bar
    texture_bars = (texture_bars - texture_bars.mean(axis=0)) / (texture_bars.std(axis=0) + 1e-9)

    harmony = chroma_seq / np.sqrt(bpb)
    harmony = (harmony - harmony.mean(axis=0)) / np.sqrt(max(harmony.shape[1], 1)) * 3.0
    features = np.hstack([harmony, texture_bars / np.sqrt(texture_bars.shape[1])])
    features = features - features.mean(axis=0)
    unit = features / (np.linalg.norm(features, axis=1, keepdims=True) + 1e-9)
    similarity = unit @ unit.T
    n = len(full)

    novelty = _novelty(similarity)
    segments = labels = None
    if learned:
        segments, labels = _learned_segments(learned, bars, full, novelty, n)
    if not segments:
        segments, labels = _classic_segments(similarity, novelty, energy, n)
        shift_limit = MAX_SHIFT_BARS
    else:
        shift_limit = 1  # a model's boundary is already close; at most a lone pickup bar moves
    segments = _start_where_chords_do(segments, bars, full, _early_chord_bars(chords, bars, bpb), shift_limit)

    sections = []
    # Silence is only an opening in which nothing can be heard. A soft intro is music and is part of the grid.
    first_bar_start = float(bars[0]["start"])
    if audible_start_s > 0.5 and first_bar_start > 0.5:
        sections.append(_section("Silence", 0.0, min(audible_start_s, first_bar_start), None, None))
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
    if sections and sections[0]["startBar"] is not None:
        sections[0]["start"] = 0.0  # no silence section: the song, and its first section, start at 0:00
    return {"bars": bars, "downbeatPhase": phase, "beatsPerBar": bpb, "sections": sections}


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
    A, B, C by how alike they sound, so repeats are still visible without guessing. Intro / Outro need a section at that end that is clearly quieter than the
    typical section (2 dB if it is a one-off, 5 dB otherwise).
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
        # A one-off opening/ending that is a little quieter, or any opening/ending that is far quieter (a song
        # that builds up from nothing plays the same chords as its verse, so it can look like a repeat).
        for index, name in ((0, "Intro"), (m - 1, "Outro")):
            gap = typical - energy_db[index]
            if (counts[int(clusters[index])] == 1 and gap >= 2) or gap >= 5:
                names[index] = name

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


def fit_beat_grid(beats: np.ndarray, start: float, duration: float) -> np.ndarray:
    """One steady beat grid for the whole song, built from the tracker's beat *times*.

    The tracker's beats are rounded to 93 ms and it can drop or double a beat now and then; if bars are
    counted from its list, one such slip puts every later chord on the wrong beat. When the tracker's beats
    sit on a straight line (a constant tempo) they are replaced by that line, extended over the whole song.
    Music that really changes tempo keeps the tracker's own beats (with gaps filled).
    """
    if len(beats) < 16:
        return regularize_beats(beats, start)
    period = float(np.median(np.diff(beats)))
    # Beat number of each tracker beat from its *neighbour* spacing, so a slightly-off period cannot
    # accumulate into the wrong beat number late in the song.
    steps = np.maximum(np.round(np.diff(beats) / period), 0)
    index = np.concatenate([[0.0], np.cumsum(steps)])
    keep = np.ones(len(beats), dtype=bool)
    slope, offset = period, float(beats[0])
    for _ in range(5):
        slope, offset = np.polyfit(index[keep], beats[keep], 1)
        close = np.abs(beats - (offset + slope * index)) < 0.2 * slope
        if close.sum() < 8 or (close == keep).all():
            break
        keep = close
    steady = float(np.mean(np.abs(beats - (offset + slope * index)) < 0.2 * slope))
    if steady < 0.85:
        return regularize_beats(beats, start)
    first = int(np.ceil((max(start, 0.0) - offset) / slope - 0.5))
    last = int(np.floor((duration - offset) / slope))
    grid = offset + slope * np.arange(first, last + 1)
    return grid[grid >= 0.0]


def place_chords_on_grid(chords: list[dict], beats: np.ndarray, phase: int, duration: float, bpb: int = BEATS_PER_BAR) -> list[dict]:
    """Decide which beat cell of the chord grid each chord is written in.

    Chord times are left exactly as detected (playback and accuracy depend on them). Each chord gets a
    `gridStart`: the beat time of the cell it is written in. Every chord that was detected gets a cell, however
    short: a quick chord on the last beat of a bar (a pickup, an anticipation) is real music.

    A chord that clearly sits on a beat goes to that beat. One that falls between two beats (a syncopated "and")
    would flip between neighbouring beats from bar to bar, so ties go to the beat position where this song
    usually changes chord. Two chords that land on the same beat are written on consecutive beats when they
    really are that close; a chord is only skipped when it repeats the chord before it or would have to be
    pushed more than a beat away from where it was heard.

    In a song that changes chord on the first beat of its bars nearly every time, the odd chord written one beat
    before or after a bar line is a chord heard a beat early or late (the detector works in coarse steps), not a
    different rhythm: it is moved onto the bar line, when that cell is free.
    """
    out = [dict(c, gridStart=c["start"]) for c in chords]
    if len(beats) < 8 or len(chords) < 3:
        return out
    period = float(np.median(np.diff(beats)))

    def nearest(t: float) -> int:
        return int(np.argmin(np.abs(beats - t)))

    positions = [(nearest(c["start"]) - phase) % bpb for c in chords[1:]]
    share = np.bincount(positions, minlength=bpb) / max(len(positions), 1)
    penalty = 1.0 - share / max(share.max(), 1e-9)  # 0 where the song often changes chord, 1 where it never does

    out_index = 0
    last_beat = -1
    placed: list[list[int]] = []  # [chord index, beat index] of every chord that got a cell, in order
    for k in range(1, len(chords)):
        chord = chords[k]
        near = nearest(chord["start"])
        if abs(float(beats[near]) - chord["start"]) / period <= 0.3:
            j = near
        else:  # between two beats: choose by distance plus how likely this bar position is for a change
            j, best_cost = near, 1e9
            for candidate in range(max(near - 1, 0), min(near + 2, len(beats))):
                distance = abs(float(beats[candidate]) - chord["start"]) / period
                cost = distance + 0.5 * penalty[(candidate - phase) % bpb]
                if distance <= 1.25 and cost < best_cost:
                    j, best_cost = candidate, cost
        if chords[out_index]["chord"] == chord["chord"]:
            out[k]["gridStart"] = None  # the chord before it carries on
            continue
        if j <= last_beat:
            j = last_beat + 1  # two chords on one beat: the later one takes the next beat
            if j - near > 1 or j >= len(beats):
                out[k]["gridStart"] = None
                continue
        out[k]["gridStart"] = float(beats[j])
        out_index, last_beat = k, j
        placed.append([k, j])

    # Chords one beat off the bar line, in a song that nearly always changes on the bar line.
    if bpb >= 3 and len(placed) >= 12:
        spots = np.bincount([(j - phase) % bpb for _, j in placed], minlength=bpb) / len(placed)
        if spots[0] >= 0.7:
            for n, (k, j) in enumerate(placed):
                pos = (j - phase) % bpb
                if pos not in (1, bpb - 1) or spots[pos] > 0.12:
                    continue  # on the bar line already, or a position this song really uses
                target = j - 1 if pos == 1 else j + 1  # a late chord goes back, an early one forward
                before = placed[n - 1][1] if n > 0 else -1
                after = placed[n + 1][1] if n + 1 < len(placed) else len(beats)
                if before < target < after and target < len(beats) and abs(float(beats[target]) - chords[k]["start"]) <= 1.5 * period:
                    out[k]["gridStart"] = float(beats[target])
                    placed[n][1] = target
    return out
