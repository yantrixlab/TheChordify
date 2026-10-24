// A metronome that keeps time by the audio clock, not by timers, so it does not drift or stutter when the page is busy.
//
// A short timer looks a little way ahead and hands the next clicks to the audio system with exact start times. The page asks
// `due()` on each frame to find out which clicks are sounding now, so the lights follow what you hear.
import { audioContext, resumeAudio } from "./audio";

export type Sound = "click" | "wood" | "beep" | "hat";

export interface Trainer {
  on: boolean;
  every: number; // bars
  step: number; // BPM
  target: number; // BPM to stop at
}

export interface Gap {
  on: boolean;
  play: number; // bars with sound
  mute: number; // bars of silence
}

export interface Settings {
  bpm: number;
  beats: number; // beats in a bar
  /** Loudness of each beat in the bar: 2 accent, 1 normal, 0 silent. */
  accents: number[];
  sub: 1 | 2 | 3 | 4; // clicks per beat
  sound: Sound;
  volume: number; // 0 to 1
  trainer: Trainer;
  gap: Gap;
}

export interface Tick {
  time: number; // audio clock
  bar: number;
  beat: number; // 0-based inside the bar
  sub: number; // 0 on the beat itself
  level: number; // 0, 1 or 2 (beats), 1 for the clicks between
  audible: boolean; // false in a silent bar
}

export const MIN_BPM = 20;
export const MAX_BPM = 300;

export const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

/** A sensible accent pattern for a bar: the first beat strong, and the groups of a compound or odd metre. */
export function defaultAccents(beats: number, unit: number): number[] {
  const out = Array<number>(beats).fill(1);
  let strong = [0];
  if (unit === 8 && beats % 3 === 0 && beats > 3) strong = Array.from({ length: beats / 3 }, (_, i) => i * 3); // 6/8 is 3 + 3
  else if (beats === 7) strong = [0, 2, 4]; // 2 + 2 + 3
  else if (beats === 5) strong = [0, 3]; // 3 + 2
  for (const i of strong) out[i] = 2;
  return out;
}

export function tempoName(bpm: number): string {
  if (bpm < 40) return "Grave";
  if (bpm < 60) return "Largo";
  if (bpm < 66) return "Larghetto";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 156) return "Allegro";
  if (bpm < 176) return "Vivace";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

export class Metronome {
  settings: Settings;
  running = false;
  /** Called when the trainer changes the tempo. */
  onBpm?: (bpm: number) => void;

  private timer = 0;
  private nextTime = 0;
  private bar = 0;
  private beat = 0;
  private sub = 0;
  private queue: Tick[] = [];
  private noise?: AudioBuffer;
  private master?: GainNode;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  async start() {
    if (this.running) return;
    const ctx = await resumeAudio();
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.running = true;
    this.bar = this.beat = this.sub = 0;
    this.queue = [];
    this.nextTime = ctx.currentTime + 0.06;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.running = false;
    window.clearInterval(this.timer);
    this.queue = [];
    this.master?.disconnect();
    this.master = undefined;
  }

  /** The time of the next click, to line the pendulum up. */
  get beatSeconds() {
    return 60 / this.settings.bpm;
  }

  /** Clicks that are sounding now or just have. */
  due(): Tick[] {
    if (!this.queue.length) return [];
    const ctx = audioContext();
    const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    const out: Tick[] = [];
    while (this.queue.length && this.queue[0].time <= now) out.push(this.queue.shift()!);
    return out;
  }

  private schedule() {
    if (!this.running) return;
    const ctx = audioContext();
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.emit(this.nextTime);
      this.advance();
    }
  }

  private emit(time: number) {
    const s = this.settings;
    const barInCycle = s.gap.on ? this.bar % (s.gap.play + s.gap.mute) : 0;
    const audible = !s.gap.on || barInCycle < s.gap.play;
    const onBeat = this.sub === 0;
    const level = onBeat ? (s.accents[this.beat] ?? 1) : 1;
    this.queue.push({ time, bar: this.bar, beat: this.beat, sub: this.sub, level, audible });
    if (audible && level > 0) this.sound(time, level, onBeat);
  }

  private advance() {
    const s = this.settings;
    this.sub++;
    if (this.sub >= s.sub) {
      this.sub = 0;
      this.beat++;
      if (this.beat >= s.beats) {
        this.beat = 0;
        this.bar++;
        const t = s.trainer;
        if (t.on && this.bar % t.every === 0 && s.bpm < t.target) {
          s.bpm = clampBpm(Math.min(t.target, s.bpm + t.step));
          this.onBpm?.(s.bpm);
        }
      }
    }
    this.nextTime += 60 / s.bpm / s.sub;
  }

  // ---- the sounds, made from scratch so there is nothing to download ----------------------------------------------

  private sound(time: number, level: number, onBeat: boolean) {
    const ctx = audioContext();
    const out = this.master!;
    const gain = ctx.createGain();
    gain.connect(out);
    // beats with an accent are loudest, the clicks in between the quietest
    const loud = this.settings.volume * (onBeat ? (level === 2 ? 1 : 0.62) : 0.34);
    const up = onBeat && level === 2;
    if (loud < 0.001) {
      gain.disconnect();
      return;
    }

    if (this.settings.sound === "hat") {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = up ? 6500 : 8500;
      src.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(loud * 1.1, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + (up ? 0.09 : 0.045));
      src.start(time);
      src.stop(time + 0.12);
      return;
    }

    const osc = ctx.createOscillator();
    osc.connect(gain);
    const base = up ? 1 : onBeat ? 0.75 : 0.6;
    if (this.settings.sound === "wood") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1500 * base, time);
      osc.frequency.exponentialRampToValueAtTime(900 * base, time + 0.03);
      gain.gain.setValueAtTime(loud * 1.25, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    } else if (this.settings.sound === "beep") {
      osc.type = "sine";
      osc.frequency.value = up ? 1320 : onBeat ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(loud, time + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    } else {
      osc.type = "square";
      osc.frequency.value = up ? 2000 : onBeat ? 1400 : 1000;
      gain.gain.setValueAtTime(loud * 0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    }
    osc.start(time);
    osc.stop(time + 0.12);
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const ctx = audioContext();
      this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.15), ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}

/** Tap tempo: the average gap between your last few taps. Starts over after a pause. */
export class TapTempo {
  private taps: number[] = [];

  tap(now = performance.now()): number | null {
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2500) this.taps = [];
    this.taps.push(now);
    this.taps = this.taps.slice(-7);
    if (this.taps.length < 2) return null;
    const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]);
    return clampBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
  }

  reset() {
    this.taps = [];
  }
}
