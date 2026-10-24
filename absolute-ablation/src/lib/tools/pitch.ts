// Finding the pitch of one note (for the tuner), and the notes and tunings of the instruments.

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
