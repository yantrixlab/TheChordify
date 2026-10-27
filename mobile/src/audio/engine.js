// The phone's version of absolute-ablation/src/lib/tools/audio.ts. The website's tools (the metronome, the chord listener, the strum
// sound) call `audioContext()`, `resumeAudio()` and `openMic()` from "./audio"; Metro gives them this file in its place (see
// metro.config.js), so they run unchanged on the phone's audio engine (react-native-audio-api, which follows the browser's Web Audio
// API) and its microphone. Nothing here leaves the phone: sound from the microphone is analysed as it comes, never stored or sent.
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api';
import { NoiseGate, SILENT_MIC_TEXT, SilenceWatch, levelPercent, rms } from 'chordsuno-shared/tools/audio';

export { NoiseGate, SILENT_MIC_TEXT, SilenceWatch, levelPercent, rms };

let shared = null;
let micRate = 0; // the rate the microphone really delivers, while it is open: the analysis must use this one

function realContext() {
  if (!shared) shared = new AudioContext();
  return shared;
}

// The website's code reads `sampleRate` to analyse the microphone's samples, so while the microphone is open that is its rate.
const view = new Proxy(
  {},
  {
    get(_, prop) {
      const ctx = realContext();
      if (prop === 'sampleRate' && micRate) return micRate;
      const value = ctx[prop];
      return typeof value === 'function' ? value.bind(ctx) : value;
    },
  },
);

/** The app's one audio context. */
export function audioContext() {
  return view;
}

/** Starts the audio context. */
export async function resumeAudio() {
  const ctx = realContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return view;
}

const MIC_TEXT = {
  denied: 'Chord Suno needs the microphone to listen to your instrument. Allow it in the phone’s settings (Apps, Chord Suno, Permissions), then try again.',
  busy: 'The microphone is being used by another app. Close that app and try again.',
  none: 'No microphone was found on this device.',
};

export class MicError extends Error {
  constructor(problem, message) {
    super(message);
    this.problem = problem;
  }
}

const RING = 32768; // the most recent samples kept: about 0.7 s

/** Opens the microphone for analysis and keeps the latest samples where `analyser.getFloatTimeDomainData` can read them, the way
 *  the browser's analyser node gives them. The sound is not played back, so there is no feedback. */
export async function openMic(fftSize) {
  const status = await AudioManager.requestRecordingPermissions();
  if (status !== 'Granted') throw new MicError('denied', MIC_TEXT.denied);

  const recorder = new AudioRecorder();
  const ring = new Float32Array(RING);
  let written = 0;
  let failed = false;
  recorder.onError(() => {
    failed = true;
  });
  const set = recorder.onAudioReady({ sampleRate: 44100, bufferLength: 1024, channelCount: 1 }, (event) => {
    const data = event.buffer.getChannelData(0);
    if (event.buffer.sampleRate) micRate = event.buffer.sampleRate;
    for (let i = 0; i < data.length; i++) ring[(written + i) % RING] = data[i];
    written += data.length;
  });
  if (set && set.status === 'error') throw new MicError('busy', MIC_TEXT.busy);
  const started = await recorder.start();
  if (started && started.status === 'error') throw new MicError('busy', MIC_TEXT.busy);
  await resumeAudio();

  const analyser = {
    fftSize,
    /** Copies the latest `buf.length` samples, oldest first. */
    getFloatTimeDomainData(buf) {
      const n = Math.min(buf.length, RING);
      const start = written - n;
      for (let i = 0; i < n; i++) {
        const at = start + i;
        buf[i] = at < 0 ? 0 : ring[at % RING];
      }
      for (let i = n; i < buf.length; i++) buf[i] = 0;
    },
  };
  return {
    analyser,
    label: '',
    deviceId: '',
    get failed() {
      return failed;
    },
    stop() {
      try {
        recorder.clearOnAudioReady();
        recorder.stop();
      } catch {
        // already stopped
      }
      micRate = 0;
    },
  };
}
