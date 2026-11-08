// The recorded guitar notes the tuner plays when a string's button is pressed: one recording of each open string of a guitar in standard
// tuning, for an acoustic and for an electric. A tuning that is not standard (Drop D, a half step down, Open G...) is played from the
// nearest recording, sped up or slowed down by the small amount that brings it to the pitch wanted. Nothing here touches the audio
// engine, so the website and the phone's app use the same choice of recording and the same speed.

export type GuitarKind = "acoustic" | "electric";

/** The recorded strings, lowest first: the note, its midi number, and how far (in cents) each recording really is from its note. */
export const SAMPLE_STRINGS = [
  { name: "E2", midi: 40 },
  { name: "A2", midi: 45 },
  { name: "D3", midi: 50 },
  { name: "G3", midi: 55 },
  { name: "B3", midi: 59 },
  { name: "E4", midi: 64 },
] as const;

// measured with the tuner's own pitch code on the recordings, so that the pitch played is the pitch asked for
const OFF_CENTS: Record<GuitarKind, number[]> = {
  acoustic: [-0.3, 1.3, -0.7, -2.6, 1.1, -1.5],
  electric: [1.1, 2.0, 4.7, 3.4, 1.4, 0.8],
};

/** How far from a recording a note may be and still be played from it (further, and it sounds like a different instrument). */
const MAX_SEMITONES = 4;

export interface SamplePick {
  /** "E2": the recording to use (file `${kind}-${name}.mp3`). */
  name: string;
  /** The speed to play it at (1 is as recorded). */
  rate: number;
  /** How long to let it ring, in seconds. */
  seconds: number;
}

/** The recording for a string tuned to `midi` (with the reference pitch `a4`), or null when none is close enough. */
export function sampleFor(midi: number, kind: GuitarKind, a4 = 440): SamplePick | null {
  let best = 0;
  for (let i = 1; i < SAMPLE_STRINGS.length; i++) if (Math.abs(SAMPLE_STRINGS[i].midi - midi) < Math.abs(SAMPLE_STRINGS[best].midi - midi)) best = i;
  const s = SAMPLE_STRINGS[best];
  if (Math.abs(s.midi - midi) > MAX_SEMITONES) return null;
  // the recording sounds at its note plus its offset, in the 440 Hz scale; the note wanted is in the `a4` scale
  const rate = Math.pow(2, (midi - s.midi) / 12 - OFF_CENTS[kind][best] / 1200) * (a4 / 440);
  return { name: s.name, rate, seconds: Math.min(5, 4.2 / rate) };
}
