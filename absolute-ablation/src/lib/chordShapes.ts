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
const FRET_ROWS = 4; // the diagram shows four fret rows, so a voicing may span at most four frets

interface Voicing {
  frets: number[]; // -1 muted, 0 open, n fretted
  fingers: string[];
  score: number;
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
  const { root, quality, bass } = parsed;
  const tones = new Set(quality.intervals.map((i) => (root + i) % 12));
  if (!tones.has(bass)) return undefined;

  // The fifth may be left out of four-note chords; every other tone defines the chord.
  const required = new Set(
    quality.intervals.filter((i) => !(i === 7 && quality.intervals.length > 3)).map((i) => (root + i) % 12),
  );

  let best: Voicing | undefined;
  const frets: number[] = [];

  const evaluate = () => {
    const sounding = frets.filter((f) => f >= 0).length;
    if (sounding < 4) return;
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
    if (!best || score < best.score) best = { frets: [...frets], fingers, score };
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

  if (!best) return undefined;
  const found: Voicing = best;
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
