// Listens to the microphone and keeps naming the chord being played, steadily enough to read.
import { audioContext, rms, type Mic } from "./audio";
import { chromaOf, matchChords, type ChordGuess } from "./chroma";

export interface Heard {
  /** How loud it is, 0 to about 1. */
  level: number;
  /** The twelve notes the sound was made of, or null when it was too quiet. */
  chroma: Float32Array | null;
  /** The best few matches for this moment alone. */
  guesses: ChordGuess[];
  /** The chord to show: it has held for a moment. Null when nothing is being played. */
  chord: string | null;
  /** How well `chord` fits what is sounding, 0 to 1. */
  score: number;
}

export interface ListenerOptions {
  /** Loudness below which it counts as silence (see gateLevel). */
  gate: number;
  /** Only name these kinds of chord ("", "m", "7"...). All of them when left out. */
  suffixes?: string[];
}

const SIZE = 16384; // about a third of a second of sound

export class ChordListener {
  private buf = new Float32Array(SIZE);
  private timer = 0;
  private current: string | null = null;
  private pending: string | null = null;
  private pendingFor = 0;
  private lastSound = 0;

  constructor(
    private mic: Mic,
    public options: ListenerOptions,
    private onHeard: (heard: Heard) => void,
  ) {
    mic.analyser.fftSize = SIZE;
  }

  start(everyMs = 120) {
    this.timer = window.setInterval(() => this.step(), everyMs);
  }

  stop() {
    window.clearInterval(this.timer);
  }

  private step() {
    this.mic.analyser.getFloatTimeDomainData(this.buf);
    const level = rms(this.buf);
    const now = performance.now();
    if (level < this.options.gate) {
      // a brief gap between strums keeps the last chord; a longer one clears it
      if (now - this.lastSound > 900) this.current = this.pending = null;
      this.onHeard({ level, chroma: null, guesses: [], chord: this.current, score: 0 });
      return;
    }
    this.lastSound = now;
    const { bins, energy } = chromaOf(this.buf, audioContext().sampleRate);
    const guesses = energy > 0 ? matchChords(bins, 3, this.options.suffixes) : [];
    const best = guesses[0];
    let score = 0;
    if (best && best.score >= 0.7) {
      // a new chord has to be heard twice running before it replaces the one on show, so a passing wobble does not flicker
      if (best.name === this.current) {
        this.pending = null;
        score = best.score;
      } else if (best.name === this.pending) {
        if (++this.pendingFor >= 2) {
          this.current = best.name;
          this.pending = null;
          score = best.score;
        }
      } else {
        this.pending = best.name;
        this.pendingFor = 1;
      }
    }
    if (this.current) score = guesses.find((g) => g.name === this.current)?.score ?? score;
    this.onHeard({ level, chroma: bins, guesses, chord: this.current, score });
  }
}
