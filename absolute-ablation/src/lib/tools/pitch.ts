// Finding the pitch of one note (for the tuner), and the notes and tunings of the instruments.

import { spectrum } from "./chroma";

export interface Pitch {
  freq: number; // Hz
  clarity: number; // 0 to 1: how clean and steady the note is
}

/**
 * The YIN method: how well the signal lines up with a copy of itself shifted by a candidate period. The shift where it lines up
 * best is one period of the note. Needs at least 2 * (sampleRate / fmin) samples to see the lowest note.
 */
export function detectPitch(buf: Float32Array, sampleRate: number, fmin = 50, fmax = 1400): Pitch | null {
  const window = buf.length >> 1;
  const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
  const tauMax = Math.min(window - 1, Math.ceil(sampleRate / fmin));
  if (tauMax <= tauMin + 2) return null;

  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      const delta = buf[j] - buf[j + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  // cumulative mean normalised difference
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  // the first dip below the threshold is the period (taking the very lowest dip tends to land an octave too low)
  const threshold = 0.15;
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.35) return null;
    tau = best;
  }

  // refine between samples
  let refined = tau;
  if (tau > 1 && tau < tauMax) {
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }
  return { freq: sampleRate / refined, clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

/**
 * The pitch detector can land on a note that is not the one played: an octave off, or a third of the pitch, because a string rings
 * in sympathy with another (an open A shakes when the high E is played) or a note's overtones line up that way. This checks the
 * candidates (the reading, and its multiples and fractions) against the spectrum. The note played has its whole overtone series
 * present, 1, 2, 3, 4... times its pitch; a wrong candidate has only some of them. The lowest candidate with most of its
 * overtones present wins.
 */
export function pickFundamental(buf: Float32Array, sampleRate: number, freq: number, fmin: number, fmax: number): number {
  const n = 16384;
  const mag = spectrum(buf, n);
  const binHz = sampleRate / n;
  const at = (hz: number) => {
    const centre = Math.round(hz / binHz);
    const reach = Math.max(2, Math.round((hz * 0.03) / binHz));
    let best = 0;
    for (let j = Math.max(1, centre - reach); j <= Math.min(mag.length - 1, centre + reach); j++) if (mag[j] > best) best = mag[j];
    return best;
  };
  let top = 0;
  for (let j = Math.floor(50 / binHz); j < Math.min(mag.length, Math.floor(2400 / binHz)); j++) if (mag[j] > top) top = mag[j];
  if (top === 0) return freq;

  const complete = (cand: number) => {
    let hit = 0;
    let total = 0;
    for (let k = 1; k <= 6 && cand * k <= 2400; k++) {
      total++;
      if (at(cand * k) >= 0.18 * top) hit++;
    }
    return total ? hit / total : 0;
  };
  const candidates = [freq / 3, freq / 2, freq, freq * 2, freq * 3].filter((c) => c >= fmin * 0.9 && c <= fmax * 1.1);
  let chosen = freq;
  let bestScore = -1;
  for (const c of candidates) {
    const score = complete(c);
    if (score >= 0.6) return c; // the lowest candidate with most of its overtones present
    if (score > bestScore + 0.05) {
      bestScore = score;
      chosen = c;
    }
  }
  return chosen;
}

/**
 * Which of an instrument's strings is being played, and how far off it is.
 *
 * A pitch detector alone can be fooled when a string rings in sympathy with another (the open A shakes when the high E is played),
 * so this asks the spectrum instead: how much sound is there at each string's own pitch, or its 2nd or 3rd overtone (a low string
 * on a small microphone is mostly overtones)? The string with the most is the one being played. Its pitch is then taken from the
 * detector's reading when that agrees (it is the most exact), or from the spectrum peak itself.
 *
 * Returns the midi pitch (with a fraction) measured against that string, or null when no string stands out. `only` limits it to one
 * string, for when the player has chosen one.
 */
export function matchString(buf: Float32Array, sampleRate: number, strings: number[], a4: number, yin: number | null, only: number | null = null): number | null {
  const n = 16384;
  const mag = spectrum(buf, n);
  const binHz = sampleRate / n;
  const WINDOW = 150; // cents either side of a string, for finding its sound

  let top = 0;
  for (let j = Math.floor(50 / binHz); j < Math.min(mag.length - 1, Math.floor(2400 / binHz)); j++) if (mag[j] > top) top = mag[j];
  if (top === 0) return null;

  const near = (hz: number, cents: number) => {
    const lo = Math.max(2, Math.floor((hz * Math.pow(2, -cents / 1200)) / binHz));
    const hi = Math.min(mag.length - 2, Math.ceil((hz * Math.pow(2, cents / 1200)) / binHz));
    let at = lo;
    for (let j = lo; j <= hi; j++) if (mag[j] > mag[at]) at = j;
    if (at <= lo || at >= hi) return { mag: mag[at], freq: at * binHz }; // a peak at the edge belongs to a neighbour
    const a = Math.log(mag[at - 1] + 1e-12);
    const b = Math.log(mag[at] + 1e-12);
    const c = Math.log(mag[at + 1] + 1e-12);
    const d = a - 2 * b + c;
    return { mag: mag[at], freq: (at + (d === 0 ? 0 : (0.5 * (a - c)) / d)) * binHz };
  };

  let best: { midi: number; strength: number; hz: number } | null = null;
  for (const midi of only !== null ? [only] : strings) {
    const f = freqFromMidi(midi, a4);
    let strength = 0;
    let hz = f;
    for (const [h, weight] of [[1, 1], [2, 0.9], [3, 0.7]] as const) {
      if (f * h > 2400) break;
      const p = near(f * h, WINDOW);
      if (p.mag * weight > strength) {
        strength = p.mag * weight;
        hz = p.freq / h;
      }
    }
    if (!best || strength > best.strength) best = { midi, strength, hz };
  }
  if (!best || best.strength < 0.15 * top) return null;

  const f = freqFromMidi(best.midi, a4);
  const cents = (hz: number) => 1200 * Math.log2(hz / f);
  const measured = cents(best.hz);
  if (Math.abs(measured) < WINDOW - 10) return best.midi + measured / 100; // the spectrum peak: exact, and not thrown by a string ringing alongside
  if (yin) {
    // the string is a good way off its note: the detector's reading, in whichever octave (or octave and fifth) makes it fit
    let pick: number | null = null;
    for (const k of [1, 2, 0.5, 3, 1 / 3]) {
      const c = cents(yin * k);
      if (Math.abs(c) < 350 && (pick === null || Math.abs(c) < Math.abs(pick))) pick = c;
    }
    if (pick !== null) return best.midi + pick / 100;
  }
  return null;
}

// ---- notes ---------------------------------------------------------------------------------------------------------

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface NoteReading {
  midi: number; // the nearest note
  name: string; // "C#"
  octave: number;
  cents: number; // how far above (+) or below (-) that note, -50 to +50
}

export function noteFromFreq(freq: number, a4 = 440): NoteReading {
  const exact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(exact);
  return { midi, name: NOTE_NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: (exact - midi) * 100 };
}

export function freqFromMidi(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** "E2" or "F#3" to a midi note number. */
export function midiFromName(note: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`Bad note ${note}`);
  return NOTE_NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
}

export const noteLabel = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

// ---- instruments ---------------------------------------------------------------------------------------------------

export interface Tuning {
  name: string;
  notes: string[]; // the strings, lowest first
}

export interface Instrument {
  id: string;
  name: string;
  fmin: number; // lowest pitch to listen for, Hz
  fmax: number;
  tunings: Tuning[];
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "guitar",
    name: "Guitar",
    fmin: 60,
    fmax: 700,
    tunings: [
      { name: "Standard (E A D G B E)", notes: ["E2", "A2", "D3", "G3", "B3", "E4"] },
      { name: "Half step down (Eb)", notes: ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"] },
      { name: "Full step down (D)", notes: ["D2", "G2", "C3", "F3", "A3", "D4"] },
      { name: "Drop D", notes: ["D2", "A2", "D3", "G3", "B3", "E4"] },
      { name: "DADGAD", notes: ["D2", "A2", "D3", "G3", "A3", "D4"] },
      { name: "Open G", notes: ["D2", "G2", "D3", "G3", "B3", "D4"] },
      { name: "Open D", notes: ["D2", "A2", "D3", "F#3", "A3", "D4"] },
      { name: "Open E", notes: ["E2", "B2", "E3", "G#3", "B3", "E4"] },
    ],
  },
  { id: "bass", name: "Bass", fmin: 30, fmax: 400, tunings: [{ name: "Standard (E A D G)", notes: ["E1", "A1", "D2", "G2"] }, { name: "5-string (B E A D G)", notes: ["B0", "E1", "A1", "D2", "G2"] }, { name: "Drop D", notes: ["D1", "A1", "D2", "G2"] }] },
  { id: "ukulele", name: "Ukulele", fmin: 200, fmax: 700, tunings: [{ name: "Standard (G C E A)", notes: ["G4", "C4", "E4", "A4"] }, { name: "Baritone (D G B E)", notes: ["D3", "G3", "B3", "E4"] }] },
  { id: "violin", name: "Violin", fmin: 180, fmax: 1400, tunings: [{ name: "Standard (G D A E)", notes: ["G3", "D4", "A4", "E5"] }] },
  { id: "mandolin", name: "Mandolin", fmin: 180, fmax: 1000, tunings: [{ name: "Standard (G D A E)", notes: ["G3", "D4", "A4", "E5"] }] },
  { id: "banjo", name: "Banjo", fmin: 100, fmax: 800, tunings: [{ name: "Open G (g D G B D)", notes: ["D3", "G3", "B3", "D4", "G4"] }] },
  { id: "chromatic", name: "Any note", fmin: 30, fmax: 1400, tunings: [{ name: "All notes", notes: [] }] },
];
