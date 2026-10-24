// Naming the chord in a block of sound (for live chord detection and for checking a chord you are practising).
//
// The sound is turned into a spectrum, the strong peaks in it are each credited to one of the twelve notes (a "chroma"), and that
// pattern of twelve is compared with the notes of every chord we know. The best match wins.

const TWO_PI = Math.PI * 2;

// ---- a small FFT -----------------------------------------------------------------------------------------------------

const tables = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function table(n: number) {
  let t = tables.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((TWO_PI * i) / n);
      sin[i] = -Math.sin((TWO_PI * i) / n);
    }
    const rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    t = { cos, sin, rev };
    tables.set(n, t);
  }
  return t;
}

/** Magnitudes of the first half of the spectrum of `input` (zero-padded to `n`, a power of two). */
export function spectrum(input: Float32Array, n: number): Float32Array {
  const { cos, sin, rev } = table(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const len = Math.min(input.length, n);
  for (let i = 0; i < len; i++) re[rev[i]] = input[i] * (0.5 - 0.5 * Math.cos((TWO_PI * i) / (len - 1))); // Hann window
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const wr = cos[k * step];
        const wi = sin[k * step];
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const mag = new Float32Array(n >> 1);
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// ---- chroma ----------------------------------------------------------------------------------------------------------

export interface Chroma {
  /** Strength of each of the twelve notes (C, C#, D ... B), 0 to 1, strongest = 1. */
  bins: Float32Array;
  /** Energy of the strong peaks that were found: close to 0 means there is nothing to name. */
  energy: number;
}

const LOW = 70; // Hz: below the lowest guitar string
const HIGH = 2400;

export function chromaOf(samples: Float32Array, sampleRate: number): Chroma {
  const n = 32768; // the sound is zero-padded to this, so the peaks can be placed more finely
  const mag = spectrum(samples, n);
  const binHz = sampleRate / n;
  const lo = Math.max(2, Math.floor(LOW / binHz));
  const hi = Math.min(mag.length - 2, Math.ceil(HIGH / binHz));

  let top = 0;
  for (let i = lo; i <= hi; i++) if (mag[i] > top) top = mag[i];
  const bins = new Float32Array(12);
  if (top < 1e-3) return { bins, energy: 0 };

  // the strong peaks, each with its place between bins found from its neighbours
  const peaks: { freq: number; midi: number; mag: number; weight: number }[] = [];
  const floor = top * 0.05;
  for (let i = lo; i <= hi; i++) {
    const m = mag[i];
    if (m < floor || m < mag[i - 1] || m <= mag[i + 1]) continue;
    const a = Math.log(mag[i - 1] + 1e-12);
    const b = Math.log(m + 1e-12);
    const c = Math.log(mag[i + 1] + 1e-12);
    const denom = a - 2 * b + c;
    const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    const freq = (i + shift) * binHz;
    peaks.push({ freq, midi: 69 + 12 * Math.log2(freq / 440), mag: m, weight: 0 });
  }
  if (!peaks.length) return { bins, energy: 0 };

  // A plucked string rings with overtones at 2, 3, 4... times its pitch, and those land on notes that are not in the chord (the
  // third overtone of an E is a B, which would read as a major 7th over a C chord). So from the lowest peak upwards, take away the
  // overtones each peak is expected to bring with it; what is left is what was really played.
  const left = peaks.map((p) => p.mag);
  for (let i = 0; i < peaks.length; i++) {
    if (left[i] <= 0) continue;
    for (let n = 2; n <= 10; n++) {
      const at = peaks[i].freq * n;
      for (let j = i + 1; j < peaks.length; j++) {
        if (peaks[j].freq > at * 1.02) break;
        if (Math.abs(1200 * Math.log2(peaks[j].freq / at)) < 35) {
          left[j] = Math.max(0, left[j] - left[i] * (1.05 / n));
          break;
        }
      }
    }
  }
  peaks.forEach((p, i) => {
    // high notes are mostly overtones of lower ones, so they count for less
    p.weight = Math.pow(left[i] / top, 0.85) / (1 + Math.max(0, p.freq - 500) / 1200);
  });

  // an instrument a little flat or sharp is still in tune with itself: find the common offset and take it out
  let offset = 0;
  let total = 0;
  for (const p of peaks) {
    offset += (p.midi - Math.round(p.midi)) * p.weight;
    total += p.weight;
  }
  offset = Math.max(-0.4, Math.min(0.4, offset / total));

  for (const p of peaks) bins[((Math.round(p.midi - offset) % 12) + 12) % 12] += p.weight;
  const max = Math.max(...bins);
  if (max > 0) for (let i = 0; i < 12; i++) bins[i] /= max;
  return { bins, energy: top };
}

// ---- chords ----------------------------------------------------------------------------------------------------------

export const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

interface Shape {
  suffix: string;
  intervals: number[];
  prior: number; // plainer chords are more likely: a nudge against reading extra notes into a simple chord
}

const SHAPES: Shape[] = [
  { suffix: "", intervals: [0, 4, 7], prior: 1 },
  { suffix: "m", intervals: [0, 3, 7], prior: 1 },
  { suffix: "7", intervals: [0, 4, 7, 10], prior: 0.93 },
  { suffix: "m7", intervals: [0, 3, 7, 10], prior: 0.93 },
  { suffix: "maj7", intervals: [0, 4, 7, 11], prior: 0.9 },
  { suffix: "sus4", intervals: [0, 5, 7], prior: 0.9 },
  { suffix: "sus2", intervals: [0, 2, 7], prior: 0.9 },
  { suffix: "dim", intervals: [0, 3, 6], prior: 0.88 },
  { suffix: "aug", intervals: [0, 4, 8], prior: 0.88 },
  { suffix: "6", intervals: [0, 4, 7, 9], prior: 0.86 },
  { suffix: "m7b5", intervals: [0, 3, 6, 10], prior: 0.86 },
];

const TEMPLATES = ROOTS.flatMap((root, r) =>
  SHAPES.map((shape) => {
    const t = new Float32Array(12);
    shape.intervals.forEach((interval, i) => (t[(r + interval) % 12] = i === 0 ? 1.1 : 1));
    const norm = Math.hypot(...t);
    return { name: `${root}${shape.suffix}`, suffix: shape.suffix, root: r, t, norm, prior: shape.prior };
  }),
);

export interface ChordGuess {
  name: string; // "Am7"
  root: number;
  score: number; // 0 to 1
}

/** The most likely chords for a chroma, best first. */
export function matchChords(bins: Float32Array, count = 3, suffixes?: string[]): ChordGuess[] {
  const norm = Math.hypot(...bins);
  if (norm === 0) return [];
  const scored = TEMPLATES.filter((tpl) => !suffixes || suffixes.includes(tpl.suffix)).map((tpl) => {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += bins[i] * tpl.t[i];
    return { name: tpl.name, root: tpl.root, score: (dot / (norm * tpl.norm)) * tpl.prior };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count);
}

/** The pitch classes (0 to 11) of a chord name like "F#m7", or an empty list if it is not one we know. */
export function pitchClassesOf(name: string): number[] {
  const m = /^([A-G]#?)(.*)$/.exec(name);
  if (!m) return [];
  const shape = SHAPES.find((s) => s.suffix === m[2]);
  const root = ROOTS.indexOf(m[1]);
  return shape && root >= 0 ? shape.intervals.map((i) => (root + i) % 12) : [];
}

/** How well one named chord fits a chroma, 0 to 1 (without the nudge towards plain chords). */
export function scoreChord(bins: Float32Array, name: string): number {
  const tpl = TEMPLATES.find((t) => t.name === name);
  const norm = Math.hypot(...bins);
  if (!tpl || norm === 0) return 0;
  let dot = 0;
  for (let i = 0; i < 12; i++) dot += bins[i] * tpl.t[i];
  return dot / (norm * tpl.norm);
}

/** The same, with the nudge towards plain chords: what `matchChords` ranks by. */
export function scoreWithPrior(bins: Float32Array, name: string): number {
  const tpl = TEMPLATES.find((t) => t.name === name);
  return tpl ? scoreChord(bins, name) * tpl.prior : 0;
}

/**
 * Turns a stream of readings, one every fraction of a second, into the chord to show. The notes are averaged over a moment, and a
 * new chord has to win most of the recent readings before it replaces the one on show, so a strum's attack, a fading ring or a
 * passing overtone does not make the name flicker.
 */
export class ChordTracker {
  private smooth: Float32Array | null = null;
  private votes: string[] = [];
  private quiet = 0;
  current: string | null = null;

  constructor(public suffixes?: string[]) {}

  /** `bins` from `chromaOf`, or null when nothing is being played. */
  push(bins: Float32Array | null): { chord: string | null; score: number; guesses: ChordGuess[] } {
    if (!bins) {
      // a short gap between strums keeps the chord; a long one lets go of it
      if (++this.quiet > 8) this.reset();
      return { chord: this.current, score: 0, guesses: [] };
    }
    this.quiet = 0;
    if (!this.smooth) this.smooth = Float32Array.from(bins);
    else for (let i = 0; i < 12; i++) this.smooth[i] = this.smooth[i] * 0.55 + bins[i] * 0.45;
    const top = Math.max(...this.smooth) || 1;
    const view = this.smooth.map((v) => v / top);
    const guesses = matchChords(view, 3, this.suffixes);
    this.votes.push(guesses[0] && guesses[0].score >= 0.68 ? guesses[0].name : "?");
    if (this.votes.length > 6) this.votes.shift();

    const counts = new Map<string, number>();
    for (const v of this.votes) if (v !== "?") counts.set(v, (counts.get(v) ?? 0) + 1);
    let leader: string | null = null;
    for (const [name, n] of counts) if (!leader || n > (counts.get(leader) ?? 0)) leader = name;
    if (leader && (!this.current ? (counts.get(leader) ?? 0) >= 3 : leader !== this.current && (counts.get(leader) ?? 0) >= 4)) this.current = leader;
    return { chord: this.current, score: this.current ? scoreChord(view, this.current) : 0, guesses };
  }

  reset() {
    this.smooth = null;
    this.votes = [];
    this.current = null;
    this.quiet = 0;
  }
}
