// Listens to the microphone and keeps naming the chord being played, steadily enough to read.
import { audioContext, rms, type Mic, type NoiseGate } from "./audio";
import { ChordTracker, chromaOf, matchChords, type ChordGuess } from "./chroma";

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
  /** Tells the sound of playing from the sound of the room. */
  gate: NoiseGate;
  /** Only name these kinds of chord ("", "m", "7"...). All of them when left out. */
  suffixes?: string[];
}

const SIZE = 16384; // about a third of a second of sound

export class ChordListener {
  private buf = new Float32Array(SIZE);
  private timer = 0;
  private tracker = new ChordTracker();

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
    this.tracker.suffixes = this.options.suffixes;
    if (!this.options.gate.update(level, performance.now())) {
      const { chord } = this.tracker.push(null);
      this.onHeard({ level, chroma: null, guesses: [], chord, score: 0 });
      return;
    }
    const { bins, energy } = chromaOf(this.buf, audioContext().sampleRate);
    if (energy === 0) {
      const { chord } = this.tracker.push(null);
      this.onHeard({ level, chroma: null, guesses: [], chord, score: 0 });
      return;
    }
    const { chord, score } = this.tracker.push(bins);
    this.onHeard({ level, chroma: bins, guesses: matchChords(bins, 3, this.options.suffixes), chord, score });
  }
}
