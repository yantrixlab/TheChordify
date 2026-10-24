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
  stop(): void;
}

/** Opens the microphone for analysis. The raw signal is wanted (no echo cancelling, noise removal or auto volume), because those
 * smear the pitch. The sound is not played back, so there is no feedback. Throws a MicError with a message fit to show. */
export async function openMic(fftSize: number): Promise<Mic> {
  if (!window.isSecureContext) throw new MicError("insecure", MIC_TEXT.insecure);
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("unsupported", MIC_TEXT.unsupported);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
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
  return {
    analyser,
    stop() {
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

/** Root mean square of a block of samples: how loud it is, from 0 to about 1. */
export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** The loudness below which the microphone is treated as silent, from a 0 to 100 sensitivity slider (100 hears the faintest sound). */
export const gateLevel = (sensitivity: number) => 0.03 * Math.pow(0.07, sensitivity / 100);
