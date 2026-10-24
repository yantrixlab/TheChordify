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
 * A pitch detector alone is fooled in two ways: a string ringing in sympathy with another (the open A shakes when the high E is
 * played), and a low string on a small microphone, whose lowest overtones are faint so that the detector hears a higher note.
 * So this asks the spectrum, and tests every string as an explanation of it. A string being played makes a whole series of
 * sounds, at 1, 2, 3, 4... times its pitch. The string whose series accounts for the most of what is heard, with its own low
 * overtones present, and its fundamental counting for extra if it is there, is the one being played.
 *
 * Its pitch is then the average of how far each of its overtones is from where it should be. Returns the midi pitch (with a
 * fraction) measured against that string, or null when no string explains the sound well. `only` limits it to one string, for
 * when the player has chosen one.
 */
export function matchString(buf: Float32Array, sampleRate: number, strings: number[], a4: number, yin: number | null, only: number | null = null): number | null {
  const n = 16384;
  const mag = spectrum(buf, n);
  const binHz = sampleRate / n;
  const lo = Math.max(2, Math.floor(50 / binHz));
  const hi = Math.min(mag.length - 2, Math.floor(2400 / binHz));

  let top = 0;
  for (let j = lo; j <= hi; j++) if (mag[j] > top) top = mag[j];
  if (top === 0) return null;

  // the strong peaks of the sound, each placed exactly between bins
  const peaks: { hz: number; mag: number }[] = [];
  for (let j = lo; j <= hi; j++) {
    if (mag[j] < 0.12 * top || mag[j] < mag[j - 1] || mag[j] <= mag[j + 1]) continue;
    const a = Math.log(mag[j - 1] + 1e-12);
    const b = Math.log(mag[j] + 1e-12);
    const c = Math.log(mag[j + 1] + 1e-12);
    const d = a - 2 * b + c;
    peaks.push({ hz: (j + (d === 0 ? 0 : (0.5 * (a - c)) / d)) * binHz, mag: mag[j] });
  }
  if (!peaks.length) return null;
  const total = peaks.reduce((sum, p) => sum + p.mag, 0);

  const REACH = 60; // cents: how far from its place an overtone may be, for a string that is out of tune
  let best: { midi: number; score: number; error: number } | null = null;
  for (const midi of only !== null ? [only] : strings) {
    const f = freqFromMidi(midi, a4);
    let covered = 0;
    let fundamental = 0;
    const present = new Set<number>();
    let errSum = 0;
    let errWeight = 0;
    let lowSum = 0;
    let lowWeight = 0;
    for (const p of peaks) {
      const h = Math.round(p.hz / f);
      if (h < 1 || h > 6) continue;
      const c = 1200 * Math.log2(p.hz / (h * f));
      if (Math.abs(c) > REACH) continue;
      covered += p.mag;
      present.add(h);
      if (h === 1) fundamental = Math.max(fundamental, p.mag);
      errSum += c * p.mag;
      errWeight += p.mag;
      if (h <= 4) {
        lowSum += c * p.mag;
        lowWeight += p.mag;
      }
    }
    if (!errWeight) continue;
    const presence = [1, 2, 3, 4].filter((h) => present.has(h)).length / 4;
    const score = (covered / total) * (0.5 + 0.5 * presence) + 0.3 * Math.min(1, fundamental / top);
    const error = lowWeight ? lowSum / lowWeight : errSum / errWeight;
    if (!best || score > best.score) best = { midi, score, error };
  }
  if (best && best.score >= 0.4) return best.midi + best.error / 100;

  // the string is a good way off its note: fall back on the detector's reading, in whichever octave makes it fit
  if (yin) {
    let near: { midi: number; cents: number } | null = null;
    for (const midi of only !== null ? [only] : strings) {
      for (const k of [1]) {
        const c = 1200 * Math.log2((yin * k) / freqFromMidi(midi, a4));
        if (Math.abs(c) < 350 && (!near || Math.abs(c) < Math.abs(near.cents))) near = { midi, cents: c };
      }
    }
    if (near) return near.midi + near.cents / 100;
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
