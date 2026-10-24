// Shared plumbing for the Toolkit: one audio context for the whole page, and the microphone.
// Nothing here leaves the browser: sound from the microphone is analysed on the device and never recorded or sent.

let shared: AudioContext | null = null;

/** The page's one audio context (browsers only allow a few). */
export function audioContext(): AudioContext {
  if (!shared) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    shared = new AC({ latencyHint: "interactive" });
  }
  return shared;
}

/** Starts the audio context; browsers only allow it after a tap or a click, so call this from one. */
export async function resumeAudio(): Promise<AudioContext> {
  const ctx = audioContext();
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

export type MicProblem = "denied" | "none" | "busy" | "insecure" | "unsupported";

export class MicError extends Error {
  constructor(public problem: MicProblem, message: string) {
    super(message);
  }
}

const MIC_TEXT: Record<MicProblem, string> = {
  denied: "The microphone is blocked. Allow it for this site in your browser's address bar, then try again.",
  none: "No microphone was found. Plug one in, or check that your device has one, then try again.",
  busy: "The microphone is being used by another app. Close that app and try again.",
  insecure: "The microphone only works on a secure (https) page.",
  unsupported: "This browser cannot use the microphone. Try the latest Chrome, Edge, Safari or Firefox.",
};

export interface Mic {
  analyser: AnalyserNode;
  /** The name the browser gives the microphone in use ("Microphone Array (Realtek)"), to show so a wrong choice is easy to spot. */
  label: string;
  deviceId: string;
  stop(): void;
}

const MIC_KEY = "cs-mic";
export const rememberedMic = (): string | undefined => {
  try {
    return localStorage.getItem(MIC_KEY) || undefined;
  } catch {
    return undefined;
  }
};
export const rememberMic = (id: string) => {
  try {
    localStorage.setItem(MIC_KEY, id);
  } catch {
    /* storage is off */
  }
};

/** Opens the microphone for analysis. The raw signal is wanted (no echo cancelling, noise removal or auto volume), because those
 * smear the pitch. The sound is not played back, so there is no feedback. Throws a MicError with a message fit to show. */
export async function openMic(fftSize: number, deviceId = rememberedMic()): Promise<Mic> {
  if (!window.isSecureContext) throw new MicError("insecure", MIC_TEXT.insecure);
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("unsupported", MIC_TEXT.unsupported);
  const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let stream: MediaStream;
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...raw, deviceId: { exact: deviceId } } : raw, video: false });
    } catch (err) {
      // a microphone remembered from before may be unplugged: fall back to the default one
      if (!deviceId || !(err instanceof DOMException) || err.name !== "OverconstrainedError") throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio: raw, video: false });
    }
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const problem: MicProblem =
      name === "NotFoundError" || name === "OverconstrainedError" ? "none" : name === "NotReadableError" || name === "AbortError" ? "busy" : "denied";
    throw new MicError(problem, MIC_TEXT[problem]);
  }
  const ctx = await resumeAudio();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  const track = stream.getAudioTracks()[0];
  return {
    analyser,
    label: track?.label ?? "",
    deviceId: track?.getSettings().deviceId ?? "",
    stop() {
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/** The microphones on this device (names only appear once the visitor has allowed the microphone). */
export async function listMics(): Promise<{ id: string; label: string }[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === "audioinput" && d.deviceId !== "communications")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

/** Fills a <select> with the microphones, shows the one in use, and calls `onPick` when another is chosen. Hidden when there is only one. */
export async function fillMicPicker(select: HTMLSelectElement, current: string, onPick: (id: string) => void) {
  const mics = await listMics();
  select.replaceChildren(...mics.map((m) => Object.assign(document.createElement("option"), { value: m.id, textContent: m.label, selected: m.id === current })));
  select.hidden = mics.length < 2;
  select.onchange = () => {
    rememberMic(select.value);
    onPick(select.value);
  };
}

/** Root mean square of a block of samples: how loud it is, from 0 to about 1. */
export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** A level on a meter, 0 to 100, on a decibel scale (-60 dB to -6 dB), the way ears and mixing desks hear it. */
export function levelPercent(level: number): number {
  const db = 20 * Math.log10(Math.max(level, 1e-5));
  return Math.max(0, Math.min(100, ((db + 60) / 54) * 100));
}

/**
 * Decides whether something is being played or it is only the room. Microphones differ hugely in loudness (a laptop's can be a
 * tenth as loud as a headset's), so a fixed level would be deaf on some. This one learns how loud the room is by itself and opens
 * when the sound rises clearly above that. `sensitivity` is the 0 to 100 slider: higher opens for fainter sounds.
 */
export class NoiseGate {
  private floor = 0;
  private last = 0;
  private since = 0;

  constructor(public sensitivity = 55) {}

  /** How many times louder than the room a sound has to be to count. */
  get ratio() {
    return 1.5 + ((100 - this.sensitivity) / 100) * 5;
  }

  update(level: number, now = performance.now()): boolean {
    if (!this.since) this.since = now;
    const dt = this.last ? Math.min(1000, now - this.last) : 0;
    this.last = now;
    // the room's level drops to a quiet moment at once and creeps up slowly, so a long chord does not become the "room"
    this.floor = this.floor === 0 ? level : Math.min(level, this.floor * (1 + (0.06 * dt) / 1000));
    if (now - this.since < 350) return false; // learning the room first
    return level > Math.max(0.0006, this.floor * this.ratio);
  }
}

/** True once the microphone has given nothing but silence for a few seconds: a muted, wrong or disconnected microphone. */
export class SilenceWatch {
  private since = 0;

  feed(level: number, now = performance.now()): boolean {
    if (level > 0.0004) {
      this.since = 0;
      return false;
    }
    if (!this.since) this.since = now;
    return now - this.since > 3000;
  }
}

export const SILENT_MIC_TEXT =
  "Nothing is coming from this microphone. Check that the right microphone is chosen, that it is not muted, and that its volume is up in your device's sound settings.";
