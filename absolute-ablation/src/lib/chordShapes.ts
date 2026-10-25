// Chord naming, theory and guitar fingerings for every chord the detector can output.
//
// Names use sharps and a compact suffix: C, Cm, C7, Cmaj7, Cm7, CmMaj7, Csus2, Csus4,
// Cdim, Caug, C6, Cm6, Cdim7, Cm7b5, plus slash chords (inversions) like C/E.
// "N" means no chord / silence.
//
// Guitar diagrams: a hand-picked table covers the 24 major/minor triads; every other chord
// (and every slash chord) is voiced on the fly by a small search, so a new quality only
// needs a row in QUALITIES.

export interface GuitarShape {
  frets: string[]; // [E, A, D, G, B, e] — "x" = muted, "0" = open, otherwise the fret number
  fingers: string[]; // left-hand finger 1-4 per string, empty string = open/muted
  baseFret?: number; // fret the diagram starts at when the shape sits above the 4th fret
}

interface Quality {
  suffix: string;
  intervals: number[]; // semitones above the root
  name: string;
}

const QUALITIES: Quality[] = [
  { suffix: "", intervals: [0, 4, 7], name: "major" },
  { suffix: "m", intervals: [0, 3, 7], name: "minor" },
  { suffix: "7", intervals: [0, 4, 7, 10], name: "dominant 7th" },
  { suffix: "maj7", intervals: [0, 4, 7, 11], name: "major 7th" },
  { suffix: "m7", intervals: [0, 3, 7, 10], name: "minor 7th" },
  { suffix: "mMaj7", intervals: [0, 3, 7, 11], name: "minor major 7th" },
  { suffix: "sus2", intervals: [0, 2, 7], name: "suspended 2nd" },
  { suffix: "sus4", intervals: [0, 5, 7], name: "suspended 4th" },
  { suffix: "dim", intervals: [0, 3, 6], name: "diminished" },
  { suffix: "aug", intervals: [0, 4, 8], name: "augmented" },
  { suffix: "6", intervals: [0, 4, 7, 9], name: "major 6th" },
  { suffix: "m6", intervals: [0, 3, 7, 9], name: "minor 6th" },
  { suffix: "dim7", intervals: [0, 3, 6, 9], name: "diminished 7th" },
  { suffix: "m7b5", intervals: [0, 3, 6, 10], name: "half-diminished" },
  { suffix: "5", intervals: [0, 7], name: "power chord" },
];

const QUALITY_BY_SUFFIX = new Map(QUALITIES.map((q) => [q.suffix, q]));

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

interface ParsedChord {
  root: number; // pitch class 0-11
  quality: Quality;
  bass: number; // pitch class; equals root unless this is a slash chord
}

function parseChord(chord: string): ParsedChord | null {
  const m = /^([A-G]#?)([^/]*)(?:\/([A-G]#?))?$/.exec(chord);
  if (!m) return null;
  const root = NOTE_NAMES.indexOf(m[1]);
  const quality = QUALITY_BY_SUFFIX.get(m[2]);
  const bass = m[3] ? NOTE_NAMES.indexOf(m[3]) : root;
  if (root === -1 || !quality || bass === -1) return null;
  return { root, quality, bass };
}

function formatChord({ root, quality, bass }: ParsedChord): string {
  const name = `${NOTE_NAMES[root]}${quality.suffix}`;
  return bass === root ? name : `${name}/${NOTE_NAMES[bass]}`;
}

/** Note names in the chord, bass note first for slash chords. */
export function chordNotes(chord: string): string[] {
  const parsed = parseChord(chord);
  if (!parsed) return [];
  const tones = parsed.quality.intervals.map((i) => (parsed.root + i) % 12);
  if (parsed.bass !== parsed.root) {
    const rest = tones.filter((t) => t !== parsed.bass);
    return [parsed.bass, ...rest].map((t) => NOTE_NAMES[t]);
  }
  return tones.map((t) => NOTE_NAMES[t]);
}

export function chordKeyLabel(chord: string): string {
  const parsed = parseChord(chord);
  if (!parsed) return "—";
  const label = `${NOTE_NAMES[parsed.root]} ${parsed.quality.name}`;
  return parsed.bass === parsed.root ? label : `${label} over ${NOTE_NAMES[parsed.bass]}`;
}

/** Shifts a chord (and its bass note) by `semitones`. Used for Transpose and Capo controls. */
export function transposeChord(chord: string, semitones: number): string {
  const parsed = parseChord(chord);
  if (!parsed || semitones === 0) return chord;
  const shift = (pc: number) => (((pc + semitones) % 12) + 12) % 12;
  return formatChord({ ...parsed, root: shift(parsed.root), bass: shift(parsed.bass) });
}

// --- Guitar shapes -----------------------------------------------------------------

const CURATED_SHAPES: Record<string, GuitarShape> = {
  C: { frets: ["x", "3", "2", "0", "1", "0"], fingers: ["", "3", "2", "", "1", ""] },
  "C#": { frets: ["x", "4", "3", "1", "2", "1"], fingers: ["", "3", "4", "1", "2", "1"], baseFret: 1 },
  D: { frets: ["x", "x", "0", "2", "3", "2"], fingers: ["", "", "", "1", "3", "2"] },
  "D#": { frets: ["x", "x", "1", "3", "4", "3"], fingers: ["", "", "1", "2", "4", "3"] },
  E: { frets: ["0", "2", "2", "1", "0", "0"], fingers: ["", "2", "3", "1", "", ""] },
  F: { frets: ["1", "3", "3", "2", "1", "1"], fingers: ["1", "3", "4", "2", "1", "1"] },
  "F#": { frets: ["2", "4", "4", "3", "2", "2"], fingers: ["1", "3", "4", "2", "1", "1"] },
  G: { frets: ["3", "2", "0", "0", "0", "3"], fingers: ["2", "1", "", "", "", "3"] },
  "G#": { frets: ["4", "6", "6", "5", "4", "4"], fingers: ["1", "3", "4", "2", "1", "1"], baseFret: 4 },
  A: { frets: ["x", "0", "2", "2", "2", "0"], fingers: ["", "", "1", "2", "3", ""] },
  "A#": { frets: ["x", "1", "3", "3", "3", "1"], fingers: ["", "1", "2", "3", "4", "1"] },
  B: { frets: ["x", "2", "4", "4", "4", "2"], fingers: ["", "1", "2", "3", "4", "1"] },
  Cm: { frets: ["x", "3", "1", "0", "1", "x"], fingers: ["", "3", "1", "", "2", ""] },
  "C#m": { frets: ["x", "4", "2", "1", "2", "x"], fingers: ["", "4", "2", "1", "3", ""] },
  Dm: { frets: ["x", "x", "0", "2", "3", "1"], fingers: ["", "", "", "2", "3", "1"] },
  "D#m": { frets: ["x", "x", "1", "3", "4", "2"], fingers: ["", "", "1", "3", "4", "2"] },
  Em: { frets: ["0", "2", "2", "0", "0", "0"], fingers: ["", "2", "3", "", "", ""] },
  Fm: { frets: ["1", "3", "3", "1", "1", "1"], fingers: ["1", "3", "4", "1", "1", "1"] },
  "F#m": { frets: ["2", "4", "4", "2", "2", "2"], fingers: ["1", "3", "4", "1", "1", "1"] },
  Gm: { frets: ["3", "5", "5", "3", "3", "3"], fingers: ["1", "3", "4", "1", "1", "1"], baseFret: 3 },
  "G#m": { frets: ["4", "6", "6", "4", "4", "4"], fingers: ["1", "3", "4", "1", "1", "1"], baseFret: 4 },
  Am: { frets: ["x", "0", "2", "2", "1", "0"], fingers: ["", "", "2", "3", "1", ""] },
  "A#m": { frets: ["x", "1", "3", "3", "2", "1"], fingers: ["", "1", "3", "4", "2", "1"] },
  Bm: { frets: ["x", "2", "4", "4", "3", "2"], fingers: ["", "1", "3", "4", "2", "1"] },

  // Open-position shapes for the common 6ths, 7ths and suspensions.
  C7: { frets: ["x", "3", "2", "3", "1", "0"], fingers: ["", "3", "2", "4", "1", ""] },
  D7: { frets: ["x", "x", "0", "2", "1", "2"], fingers: ["", "", "", "2", "1", "3"] },
  E7: { frets: ["0", "2", "0", "1", "0", "0"], fingers: ["", "2", "", "1", "", ""] },
  G7: { frets: ["3", "2", "0", "0", "0", "1"], fingers: ["3", "2", "", "", "", "1"] },
  A7: { frets: ["x", "0", "2", "0", "2", "0"], fingers: ["", "", "1", "", "2", ""] },
  B7: { frets: ["x", "2", "1", "2", "0", "2"], fingers: ["", "2", "1", "3", "", "4"] },
  Cmaj7: { frets: ["x", "3", "2", "0", "0", "0"], fingers: ["", "3", "2", "", "", ""] },
  Dmaj7: { frets: ["x", "x", "0", "2", "2", "2"], fingers: ["", "", "", "1", "2", "3"] },
  Emaj7: { frets: ["0", "2", "1", "1", "0", "0"], fingers: ["", "3", "1", "1", "", ""] },
  Fmaj7: { frets: ["x", "x", "3", "2", "1", "0"], fingers: ["", "", "3", "2", "1", ""] },
  Gmaj7: { frets: ["3", "2", "0", "0", "0", "2"], fingers: ["2", "1", "", "", "", "3"] },
  Amaj7: { frets: ["x", "0", "2", "1", "2", "0"], fingers: ["", "", "2", "1", "3", ""] },
  Am7: { frets: ["x", "0", "2", "0", "1", "0"], fingers: ["", "", "2", "", "1", ""] },
  Bm7: { frets: ["x", "2", "0", "2", "0", "2"], fingers: ["", "1", "", "2", "", "3"] },
  Dm7: { frets: ["x", "x", "0", "2", "1", "1"], fingers: ["", "", "", "2", "1", "1"] },
  Em7: { frets: ["0", "2", "0", "0", "0", "0"], fingers: ["", "2", "", "", "", ""] },
  Asus2: { frets: ["x", "0", "2", "2", "0", "0"], fingers: ["", "", "1", "2", "", ""] },
  Dsus2: { frets: ["x", "x", "0", "2", "3", "0"], fingers: ["", "", "", "1", "2", ""] },
  Asus4: { frets: ["x", "0", "2", "2", "3", "0"], fingers: ["", "", "1", "2", "3", ""] },
  Dsus4: { frets: ["x", "x", "0", "2", "3", "3"], fingers: ["", "", "", "1", "2", "3"] },
  Esus4: { frets: ["0", "2", "2", "2", "0", "0"], fingers: ["", "2", "3", "4", "", ""] },
  Gsus4: { frets: ["3", "3", "0", "0", "1", "3"], fingers: ["2", "3", "", "", "1", "4"] },
  A6: { frets: ["x", "0", "2", "2", "2", "2"], fingers: ["", "", "1", "1", "1", "1"] },
  C6: { frets: ["x", "3", "2", "2", "1", "0"], fingers: ["", "4", "2", "3", "1", ""] },
  D6: { frets: ["x", "x", "0", "2", "0", "2"], fingers: ["", "", "", "1", "", "2"] },
  E6: { frets: ["0", "2", "2", "1", "2", "0"], fingers: ["", "2", "3", "1", "4", ""] },
  Am6: { frets: ["x", "0", "2", "2", "1", "2"], fingers: ["", "", "2", "3", "1", "4"] },
  Dm6: { frets: ["x", "x", "0", "2", "0", "1"], fingers: ["", "", "", "2", "", "1"] },
  Em6: { frets: ["0", "2", "2", "0", "2", "0"], fingers: ["", "2", "3", "", "4", ""] },
};

const OPEN_STRINGS = [4, 9, 2, 7, 11, 4]; // E A D G B e as pitch classes
const MAX_FRET = 15;
const MAX_ALTERNATIVE_FRET = 10; // the other ways of playing a chord start no higher than this
const FRET_ROWS = 4; // the diagram shows four fret rows, so a voicing may span at most four frets

interface Voicing {
  frets: number[]; // -1 muted, 0 open, n fretted
  fingers: string[];
  score: number; // lower is easier to play
  fullness: number; // like `score`, but a voicing that leaves strings silent is marked down: the alternatives should sound full
}

/** Fingers for a voicing (barre on the lowest fret when there are too many notes), or null if unplayable. */
function assignFingers(frets: number[]): string[] | null {
  const fretted = frets.map((f, s) => ({ f, s })).filter((p) => p.f > 0);
  const fingers = frets.map(() => "");
  if (fretted.length === 0) return fingers;

  const lowest = Math.min(...fretted.map((p) => p.f));
  const barreNotes = fretted.filter((p) => p.f === lowest);
  let rest = fretted;

  if (fretted.length > 4) {
    if (barreNotes.length < 2) return null;
    const from = Math.min(...barreNotes.map((p) => p.s));
    const to = Math.max(...barreNotes.map((p) => p.s));
    for (let s = from + 1; s < to; s++) if (frets[s] < lowest) return null; // an open/muted string under the barre
    barreNotes.forEach((p) => (fingers[p.s] = "1"));
    rest = fretted.filter((p) => p.f !== lowest);
    if (rest.length > 3) return null;
    rest.sort((a, b) => a.f - b.f || a.s - b.s).forEach((p, i) => (fingers[p.s] = String(i + 2)));
  } else {
    rest.sort((a, b) => a.f - b.f || a.s - b.s).forEach((p, i) => (fingers[p.s] = String(i + 1)));
  }
  return fingers;
}

/**
 * Searches every playable voicing of the chord and returns the most comfortable one.
 * Closed voicings (no open strings) slide up the neck like barre chords; `allowOpen` adds
 * open-position voicings, which only make sense below the fifth fret.
 */
function buildVoicing(parsed: ParsedChord, allowOpen: boolean): GuitarShape | undefined {
  const best = searchVoicings(parsed, allowOpen).best;
  return best ? toShape(best) : undefined;
}

/** Which stretch of the neck a voicing sits in: near the nut, the 3rd-5th frets, the 6th-8th, or higher up. */
function neckZone(lowestFret: number): number {
  return lowestFret <= 2 ? 0 : lowestFret <= 5 ? 1 : lowestFret <= 8 ? 2 : 3;
}

/** The most comfortable voicing overall, and the most comfortable one in each stretch of the neck. */
function searchVoicings(parsed: ParsedChord, allowOpen: boolean): { best?: Voicing; zones: Map<number, Voicing>; all: Voicing[] } {
  const { root, quality, bass } = parsed;
  const zones = new Map<number, Voicing>();
  const tones = new Set(quality.intervals.map((i) => (root + i) % 12));
  if (!tones.has(bass)) return { zones, all: [] };

  // The fifth may be left out of four-note chords; every other tone defines the chord.
  const required = new Set(
    quality.intervals.filter((i) => !(i === 7 && quality.intervals.length > 3)).map((i) => (root + i) % 12),
  );

  let best: Voicing | undefined;
  const everyOne: Voicing[] = [];
  const frets: number[] = [];

  const evaluate = () => {
    const sounding = frets.filter((f) => f >= 0).length;
    if (sounding < (quality.intervals.length < 3 ? 3 : 4)) return;
    const firstString = frets.findIndex((f) => f >= 0);
    if ((OPEN_STRINGS[firstString] + frets[firstString]) % 12 !== bass) return;

    const played = new Set<number>();
    frets.forEach((f, s) => f >= 0 && played.add((OPEN_STRINGS[s] + f) % 12));
    for (const pc of required) if (!played.has(pc)) return;

    const fretted = frets.filter((f) => f > 0);
    const lowest = fretted.length ? Math.min(...fretted) : 0;
    const highest = fretted.length ? Math.max(...fretted) : 0;
    const open = frets.filter((f) => f === 0).length;
    if (open > 0 && (!allowOpen || highest > 4)) return;

    const fingers = assignFingers(frets);
    if (!fingers) return;

    // Big jumps between neighbouring fretted strings are a stretch.
    const pressed = frets.filter((f) => f > 0);
    let stretch = 0;
    for (let i = 1; i < pressed.length; i++) stretch += Math.max(0, Math.abs(pressed[i] - pressed[i - 1]) - 2);

    const muted = frets.length - sounding;
    const barre = fingers.filter((f) => f === "1").length > 1;
    const fifthMissing = quality.intervals.includes(7) && !played.has((root + 7) % 12);

    const score =
      lowest * 0.8 +
      (highest - lowest) * 0.5 +
      stretch * 1.5 +
      fretted.length * 0.3 +
      muted * 0.9 -
      open * 1.2 +
      (barre ? 2 : 0) +
      (fifthMissing ? 0.8 : 0);
    const candidate: Voicing = { frets: [...frets], fingers, score, fullness: score + muted * 2.5 };
    if (!best || score < best.score) best = candidate;
    if (lowest <= 12) everyOne.push(candidate);
    if (lowest > MAX_ALTERNATIVE_FRET) return; // an alternative that high up the neck is not one anybody would reach for
    const zone = neckZone(lowest);
    const inZone = zones.get(zone);
    if (!inZone || candidate.fullness < inZone.fullness) zones.set(zone, candidate);
  };

  // Depth-first over strings, low to high. `phase` keeps the sounding strings contiguous
  // (muted only below or above the played block).
  const search = (string: number, phase: 0 | 1 | 2, lo: number, hi: number) => {
    if (string === OPEN_STRINGS.length) return evaluate();

    frets.push(-1);
    search(string + 1, phase === 0 ? 0 : 2, lo, hi);
    frets.pop();
    if (phase === 2) return;

    for (let fret = 0; fret <= MAX_FRET; fret++) {
      if (!tones.has((OPEN_STRINGS[string] + fret) % 12)) continue;
      let nextLo = lo;
      let nextHi = hi;
      if (fret > 0) {
        nextLo = Math.min(lo, fret);
        nextHi = Math.max(hi, fret);
        if (nextHi - nextLo >= FRET_ROWS) continue;
      }
      frets.push(fret);
      search(string + 1, 1, nextLo, nextHi);
      frets.pop();
    }
  };
  search(0, 0, Infinity, 0);

  return { best, zones, all: everyOne };
}

function toShape(found: Voicing): GuitarShape {
  const fretted = found.frets.filter((f) => f > 0);
  const highest = fretted.length ? Math.max(...fretted) : 0;
  const lowest = fretted.length ? Math.min(...fretted) : 0;
  const baseFret = highest > FRET_ROWS ? lowest : 1;
  return {
    frets: found.frets.map((f) => (f < 0 ? "x" : String(f))),
    fingers: found.fingers,
    ...(baseFret > 1 ? { baseFret } : {}),
  };
}

const voicingCache = new Map<string, GuitarShape | null>();
const choicesCache = new Map<string, GuitarShape[]>();

/** How many ways of playing a chord are offered at most (the usual one, and two others further along the neck). */
export const MAX_VOICINGS = 3;

/** The fret a shape sits at (its lowest pressed fret; 0 when every string is open or muted). */
const lowestFret = (shape: GuitarShape): number => {
  const pressed = shape.frets.map(Number).filter((f) => f > 0); // "x" is NaN and drops out
  return pressed.length ? Math.min(...pressed) : 0;
};

const sameShape = (a: GuitarShape, b: GuitarShape) => a.frets.join(",") === b.frets.join(",");

/**
 * The usual fingering first, then up to two other ways of playing the same chord on other parts of the neck
 * (an open shape, a barre shape, a higher one...), in order up the neck. Every one has the chord's own bass note
 * and all of its notes, so they can be swapped for one another anywhere in a song.
 */
export function getGuitarShapes(chord: string): GuitarShape[] {
  const cached = choicesCache.get(chord);
  if (cached) return cached;
  const usual = getGuitarShape(chord);
  if (!usual) return [];
  const choices = [usual];
  const parsed = parseChord(chord);
  if (parsed) {
    const others = [...searchVoicings(parsed, true).zones.values()]
      .map((voicing) => ({ voicing, shape: toShape(voicing) }))
      .filter(({ shape }) => !sameShape(shape, usual))
      .sort((a, b) => a.voicing.fullness - b.voicing.fullness)
      .slice(0, MAX_VOICINGS - 1)
      .map(({ shape }) => shape)
      .sort((a, b) => lowestFret(a) - lowestFret(b));
    choices.push(...others);
  }
  choicesCache.set(chord, choices);
  return choices;
}

/** Fingering for any chord the detector can name, or undefined for "N" and unknown names. */
export function getGuitarShape(chord: string): GuitarShape | undefined {
  const curated = CURATED_SHAPES[chord];
  if (curated) return curated;

  const cached = voicingCache.get(chord);
  if (cached !== undefined) return cached ?? undefined;

  const parsed = parseChord(chord);
  let shape: GuitarShape | undefined;
  if (parsed) {
    // Slash chords are mostly open-position shapes (C/E, D/F#); everything else prefers movable ones.
    const slash = parsed.bass !== parsed.root;
    shape = buildVoicing(parsed, slash) ?? buildVoicing(parsed, !slash);
  }
  voicingCache.set(chord, shape ?? null);
  return shape;
}

const allCache = new Map<string, GuitarShape[]>();

/**
 * Many ways of playing a chord, for a chord library: the usual fingering first, then comfortable ones all the way up the neck, each
 * starting at least two frets from the last so they look and feel different. Up to `max`, in order up the neck after the first.
 */
export function getAllGuitarShapes(chord: string, max = 8): GuitarShape[] {
  const key = `${chord}:${max}`;
  const cached = allCache.get(key);
  if (cached) return cached;
  const usual = getGuitarShape(chord);
  if (!usual) return [];
  const parsed = parseChord(chord);
  const chosen: { shape: GuitarShape; at: number }[] = [{ shape: usual, at: lowestFret(usual) }];
  if (parsed) {
    const options = [...searchVoicings(parsed, true).all, ...searchVoicings(parsed, false).all]
      .map((voicing) => ({ voicing, shape: toShape(voicing) }))
      .sort((a, b) => a.voicing.fullness - b.voicing.fullness);
    for (const { voicing, shape } of options) {
      if (chosen.length >= max) break;
      const at = lowestFret(shape);
      if (chosen.some((c) => sameShape(c.shape, shape) || Math.abs(c.at - at) < 2)) continue;
      void voicing;
      chosen.push({ shape, at });
    }
  }
  const [first, ...others] = chosen;
  const out = [first.shape, ...others.sort((a, b) => a.at - b.at).map((c) => c.shape)];
  allCache.set(key, out);
  return out;
}

// --- Ukulele shapes ----------------------------------------------------------------
// Standard tuning, G C E A (the G is the high one). Every shape is four fretted-or-open strings, so a diagram is the same
// GuitarShape with four entries, in the order [G, C, E, A].

const UKE_OPEN = [7, 0, 4, 9]; // G C E A as pitch classes
const UKE_PITCH = [67, 60, 64, 69]; // G4 C4 E4 A4: the lowest sounding string is the C, not the G
const UKE_MAX_FRET = 12;

/** The usual shapes everybody learns first: majors, minors and the dominant 7ths for all twelve notes. */
const UKE_USUAL: Record<string, number[]> = {
  C: [0, 0, 0, 3], "C#": [1, 1, 1, 4], D: [2, 2, 2, 0], "D#": [0, 3, 3, 1], E: [4, 4, 4, 2], F: [2, 0, 1, 0],
  "F#": [3, 1, 2, 1], G: [0, 2, 3, 2], "G#": [5, 3, 4, 3], A: [2, 1, 0, 0], "A#": [3, 2, 1, 1], B: [4, 3, 2, 2],
  Cm: [0, 3, 3, 3], "C#m": [1, 1, 0, 4], Dm: [2, 2, 1, 0], "D#m": [3, 3, 2, 1], Em: [0, 4, 3, 2], Fm: [1, 0, 1, 3],
  "F#m": [2, 1, 2, 0], Gm: [0, 2, 3, 1], "G#m": [1, 3, 4, 2], Am: [2, 0, 0, 0], "A#m": [3, 1, 1, 1], Bm: [4, 2, 2, 2],
  C7: [0, 0, 0, 1], "C#7": [1, 1, 1, 2], D7: [2, 2, 2, 3], "D#7": [3, 3, 3, 4], E7: [1, 2, 0, 2], F7: [2, 3, 1, 3],
  "F#7": [3, 4, 2, 4], G7: [0, 2, 1, 2], "G#7": [1, 3, 2, 3], A7: [0, 1, 0, 0], "A#7": [1, 2, 1, 1], B7: [2, 3, 2, 2],
  Cmaj7: [0, 0, 0, 2], Dmaj7: [2, 2, 2, 4], Emaj7: [1, 3, 0, 2], Fmaj7: [2, 4, 1, 3], Gmaj7: [0, 2, 2, 2], Amaj7: [1, 1, 0, 0], Bmaj7: [3, 3, 2, 2],
  Cm7: [3, 3, 3, 3], Dm7: [2, 2, 1, 3], Em7: [0, 2, 0, 2], Fm7: [1, 3, 1, 3], Gm7: [0, 2, 1, 1], Am7: [0, 0, 0, 0], Bm7: [2, 2, 2, 2],
};

/** Fingers for four strings: one finger lays across every string pressed on the lowest fret when there are two or more of them. */
function ukeFingers(frets: number[]): string[] | null {
  const fingers = frets.map(() => "");
  const pressed = frets.map((f, s) => ({ f, s })).filter((p) => p.f > 0);
  if (pressed.length === 0) return fingers;
  const lowest = Math.min(...pressed.map((p) => p.f));
  const low = pressed.filter((p) => p.f === lowest);
  let rest = pressed;
  if (low.length >= 2) {
    const from = Math.min(...low.map((p) => p.s));
    const to = Math.max(...low.map((p) => p.s));
    let underBar = false; // a string between them that is open or on another fret: no one finger lies across, each gets its own
    for (let s = from + 1; s < to; s++) if (frets[s] !== lowest) underBar = true;
    if (!underBar) {
      low.forEach((p) => (fingers[p.s] = "1"));
      rest = pressed.filter((p) => p.f !== lowest);
      rest.sort((a, b) => a.f - b.f || a.s - b.s).forEach((p, i) => (fingers[p.s] = String(i + 2)));
      if (rest.length > 3) return null;
    } else {
      rest.sort((a, b) => a.f - b.f || a.s - b.s).forEach((p, i) => (fingers[p.s] = String(i + 1)));
    }
  } else {
    rest.sort((a, b) => a.f - b.f || a.s - b.s).forEach((p, i) => (fingers[p.s] = String(i + 1)));
  }
  return fingers;
}

function ukeShapeOf(frets: number[]): GuitarShape | null {
  const fingers = ukeFingers(frets);
  if (!fingers) return null;
  const pressed = frets.filter((f) => f > 0);
  const highest = pressed.length ? Math.max(...pressed) : 0;
  const lowest = pressed.length ? Math.min(...pressed) : 0;
  const baseFret = highest > FRET_ROWS ? lowest : 1;
  return { frets: frets.map(String), fingers, ...(baseFret > 1 ? { baseFret } : {}) };
}

/** Every way of playing the chord on four strings within four frets, with how easy each is (lower is easier). */
function ukuleleVoicings(parsed: ParsedChord): { frets: number[]; score: number }[] {
  const { root, quality, bass } = parsed;
  const tones = new Set(quality.intervals.map((i) => (root + i) % 12));
  const required = new Set(quality.intervals.filter((i) => !(i === 7 && quality.intervals.length > 3)).map((i) => (root + i) % 12));
  const slash = bass !== root;
  const out: { frets: number[]; score: number }[] = [];
  const frets: number[] = [];

  const evaluate = () => {
    const played = new Set(frets.map((f, s) => (UKE_OPEN[s] + f) % 12));
    for (const pc of required) if (!played.has(pc)) return;
    // A slash chord has its bass note in the shape; it is better still when that note is the lowest one that sounds.
    let bassPenalty = 0;
    if (slash) {
      if (!played.has(bass)) return;
      let low = 0;
      frets.forEach((f, s) => {
        if (UKE_PITCH[s] + f < UKE_PITCH[low] + frets[low]) low = s;
      });
      if ((UKE_OPEN[low] + frets[low]) % 12 !== bass) bassPenalty = 2.5;
    }
    const fingers = ukeFingers(frets);
    if (!fingers) return;
    const pressed = frets.filter((f) => f > 0);
    const lowest = pressed.length ? Math.min(...pressed) : 0;
    const highest = pressed.length ? Math.max(...pressed) : 0;
    const open = frets.filter((f) => f === 0).length;
    let stretch = 0;
    for (let i = 1; i < frets.length; i++) if (frets[i] > 0 && frets[i - 1] > 0) stretch += Math.max(0, Math.abs(frets[i] - frets[i - 1]) - 2);
    const bar = fingers.filter((f) => f === "1").length > 1;
    const score = lowest * 0.8 + (highest - lowest) * 0.5 + stretch * 1.5 + pressed.length * 0.3 - open * 1.2 + (bar ? 1.5 : 0) + bassPenalty;
    out.push({ frets: [...frets], score });
  };

  const search = (string: number, lo: number, hi: number) => {
    if (string === UKE_OPEN.length) return evaluate();
    for (let fret = 0; fret <= UKE_MAX_FRET; fret++) {
      if (!tones.has((UKE_OPEN[string] + fret) % 12)) continue;
      let nextLo = lo;
      let nextHi = hi;
      if (fret > 0) {
        nextLo = Math.min(lo, fret);
        nextHi = Math.max(hi, fret);
        if (nextHi - nextLo >= FRET_ROWS) continue;
      }
      frets.push(fret);
      search(string + 1, nextLo, nextHi);
      frets.pop();
    }
  };
  search(0, Infinity, 0);
  return out;
}

const ukeCache = new Map<string, GuitarShape[]>();

/**
 * The ukulele fingerings of a chord: the usual one first (the shape everybody learns, where there is one, else the easiest the
 * search finds), then up to two other ways of playing it further up the neck, in order up the neck.
 */
export function getUkuleleShapes(chord: string): GuitarShape[] {
  const cached = ukeCache.get(chord);
  if (cached) return cached;
  const parsed = parseChord(chord);
  if (!parsed) return [];
  const found = ukuleleVoicings(parsed).sort((a, b) => a.score - b.score);
  if (found.length === 0) {
    ukeCache.set(chord, []);
    return [];
  }
  const slash = parsed.bass !== parsed.root;
  const known = slash ? undefined : UKE_USUAL[chord];
  const usualFrets = known ?? found[0].frets;
  const usual = ukeShapeOf(usualFrets);
  if (!usual) return [];
  const lowestOf = (frets: number[]) => Math.min(...frets.filter((f) => f > 0), 99);
  const picked: { shape: GuitarShape; at: number }[] = [];
  for (const option of found) {
    if (picked.length >= MAX_VOICINGS - 1) break;
    const at = lowestOf(option.frets);
    if (at > MAX_ALTERNATIVE_FRET || option.frets.join() === usualFrets.join()) continue;
    // alternatives must sit somewhere new on the neck (at least two frets from the usual one and from each other)
    if (Math.abs(at - lowestOf(usualFrets)) < 2 || picked.some((p) => Math.abs(p.at - at) < 2)) continue;
    const shape = ukeShapeOf(option.frets);
    if (shape) picked.push({ shape, at });
  }
  const choices = [usual, ...picked.sort((a, b) => a.at - b.at).map((p) => p.shape)];
  ukeCache.set(chord, choices);
  return choices;
}
