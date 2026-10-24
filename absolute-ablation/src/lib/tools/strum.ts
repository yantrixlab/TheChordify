// Plays a chord shape as a strummed guitar, made from scratch (a plucked-string model), so a shape can be heard before it is learned.
import type { GuitarShape } from "../chordShapes";
import { audioContext, resumeAudio } from "./audio";

const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // E A D G B e
const SECONDS = 2.6;

const cache = new Map<string, AudioBuffer>();
let playing: AudioBufferSourceNode | null = null;

function pluck(freq: number, sampleRate: number, length: number): Float32Array {
  const n = Math.max(2, Math.round(sampleRate / freq));
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) line[i] = Math.random() * 2 - 1;
  const out = new Float32Array(length);
  let p = 0;
  for (let i = 0; i < length; i++) {
    const a = line[p];
    const b = line[(p + 1) % n];
    out[i] = a;
    line[p] = 0.9972 * 0.5 * (a + b); // each pass the string loses a little energy, most of it from the high overtones
    p = (p + 1) % n;
  }
  return out;
}

function render(shape: GuitarShape, sampleRate: number): AudioBuffer {
  const ctx = audioContext();
  const length = Math.round(sampleRate * SECONDS);
  const mix = new Float32Array(length);
  let order = 0;
  shape.frets.forEach((fret, i) => {
    if (fret === "x") return;
    const midi = OPEN_MIDI[i] + Number(fret);
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const string = pluck(freq, sampleRate, length);
    const start = Math.round(sampleRate * 0.028 * order++); // a strum: each string a moment after the last
    for (let j = 0; j + start < length; j++) mix[j + start] += string[j] * (1 - order * 0.04);
  });
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const gain = peak ? 0.55 / peak : 1;
  for (let i = 0; i < length; i++) mix[i] *= gain;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  buffer.copyToChannel(mix, 0);
  return buffer;
}

/** Strums the shape once. A new strum cuts off the one before. */
export async function strumShape(shape: GuitarShape): Promise<void> {
  const ctx = await resumeAudio();
  const key = shape.frets.join(",");
  let buffer = cache.get(key);
  if (!buffer) {
    buffer = render(shape, ctx.sampleRate);
    cache.set(key, buffer);
  }
  try {
    playing?.stop();
  } catch {
    /* already finished */
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  playing = source;
}
