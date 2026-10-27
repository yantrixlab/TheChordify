import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buzz } from '../lib/buzz';
import { INSTRUMENTS, detectPitch, freqFromMidi, matchString, midiFromName, noteFromFreq, pickFundamental } from 'chordsuno-shared/tools/pitch';
import { StringTracker } from 'chordsuno-shared/tools/tracker';
import { MicError, NoiseGate, SILENT_MIC_TEXT, SilenceWatch, audioContext, levelPercent, openMic, resumeAudio, rms } from '../audio/engine';
import { getJson, setJson } from '../lib/storage';

const KEY = 'tuner-prefs';
const CAPTURE = 12; // readings in tune in a row (about 0.7 s) before a string counts as tuned
const TICK_MS = 60;

export { INSTRUMENTS };

const DEFAULTS = { instrument: 'guitar', tuning: 0, a4: 440, tol: 5, sens: 55 };

/**
 * The tuner, as the website's tuner page works (toolkit/tuner.astro): listens to the microphone, finds the pitch, decides which
 * string is being tuned and how many cents off it is, and counts a string as tuned once it has held. The pitch and string logic
 * is the website's own code (lib/tools); this is the page's part, without the page.
 */
export function useTuner() {
  const [prefs, setPrefsState] = useState({ ...DEFAULTS, ...(getJson(KEY, {}) || {}) });
  const [target, setTarget] = useState(null); // a string chosen by hand (a midi number); null is automatic
  const [ui, setUi] = useState({ listening: false, status: 'Press Start, then play a string', lock: -1, cents: 0, ok: false, goal: null, level: 0, open: false, silent: false, error: '', done: [] });
  const setPrefs = useCallback((patch) => {
    setPrefsState((before) => {
      const next = { ...before, ...patch };
      setJson(KEY, next);
      return next;
    });
  }, []);

  const instrument = useMemo(() => INSTRUMENTS.find((i) => i.id === prefs.instrument) || INSTRUMENTS[0], [prefs.instrument]);
  const strings = useMemo(() => (instrument.tunings[prefs.tuning] || instrument.tunings[0]).notes.map(midiFromName), [instrument, prefs.tuning]);

  const live = useRef({});
  live.current = { prefs, target, instrument, strings };
  const engine = useRef(null);
  if (!engine.current) {
    engine.current = {
      tracker: new StringTracker({ strings: [], target: null, tol: 5 }),
      gate: new NoiseGate(55),
      silence: new SilenceWatch(),
      mic: null,
      timer: 0,
      buf: new Float32Array(0),
      lastHeard: 0,
      held: [],
      off: [],
      done: [],
      lastUi: 0,
    };
  }

  const publish = useCallback((patch, force = false) => {
    const e = engine.current;
    const now = Date.now();
    if (!force && now - e.lastUi < 80) return;
    e.lastUi = now;
    const { tracker } = e;
    setUi((before) => ({
      ...before,
      lock: tracker.lock,
      cents: tracker.cents,
      ok: tracker.ok,
      goal: tracker.lock >= 0 ? tracker.goal() : null,
      done: e.done.slice(),
      ...patch,
    }));
  }, []);

  // A new instrument, tuning or mode starts the tracker over.
  useEffect(() => {
    const e = engine.current;
    e.tracker.opts = { strings, target, tol: prefs.tol };
    e.tracker.release();
    e.held = strings.map(() => 0);
    e.off = strings.map(() => 0);
    e.done = strings.map(() => false);
    if (e.mic) e.mic.analyser.fftSize = instrument.fmin < 50 ? 8192 : 4096;
    publish({}, true);
  }, [strings, target, prefs.tol, instrument, publish]);

  useEffect(() => {
    engine.current.gate.sensitivity = prefs.sens;
  }, [prefs.sens]);

  const resetDone = useCallback(() => {
    const e = engine.current;
    e.held = strings.map(() => 0);
    e.off = strings.map(() => 0);
    e.done = strings.map(() => false);
    publish({}, true);
  }, [strings, publish]);

  const tick = useCallback(() => {
    const e = engine.current;
    const { instrument: inst, strings: list, prefs: p, target: goalString } = live.current;
    if (!e.mic) return;
    const sr = audioContext().sampleRate;
    if (e.buf.length !== e.mic.analyser.fftSize) e.buf = new Float32Array(e.mic.analyser.fftSize);
    e.mic.analyser.getFloatTimeDomainData(e.buf);
    const level = rms(e.buf);
    const now = performance.now();
    const open = e.gate.update(level, now);
    const silent = e.silence.feed(level, now);
    let pitch = open ? detectPitch(e.buf, sr, inst.fmin, inst.fmax) : null;
    if (pitch && pitch.clarity < 0.75) pitch = null;
    const { tracker } = e;
    if (pitch) {
      e.lastHeard = now;
      // which string is sounding comes from the spectrum, so a string ringing in sympathy cannot take over
      let m = list.length ? matchString(e.buf, sr, list, p.a4, pitch.freq, goalString) : null;
      if (m === null) m = 69 + 12 * Math.log2(pickFundamental(e.buf, sr, pitch.freq, inst.fmin, inst.fmax) / p.a4);
      const lock = tracker.lock;
      const wasOk = tracker.ok;
      tracker.push(m, pitch.clarity);
      if (tracker.ok && !wasOk) buzz(20);
      // a string is captured once it holds in tune, and let go again if it is played badly out of tune afterwards
      const gi = tracker.lock;
      let changed = lock !== gi || wasOk !== tracker.ok;
      if (gi >= 0 && list.length) {
        e.held[gi] = tracker.ok ? e.held[gi] + 1 : 0;
        e.off[gi] = Math.abs(tracker.cents) > Math.max(15, p.tol * 3) ? e.off[gi] + 1 : 0;
        if (!e.done[gi] && e.held[gi] >= CAPTURE) {
          e.done[gi] = true;
          changed = true;
          buzz(40);
        } else if (e.done[gi] && e.off[gi] >= 20) {
          e.done[gi] = false;
          changed = true;
        }
      }
      publish({ status: 'Listening', level: levelPercent(level), open, silent }, changed);
    } else if (tracker.lock >= 0 && now - e.lastHeard > 700) {
      tracker.release();
      publish({ status: 'Listening… play a string', level: levelPercent(level), open, silent }, true);
    } else {
      publish({ level: levelPercent(level), open, silent });
    }
  }, [publish]);

  const stop = useCallback(() => {
    const e = engine.current;
    clearInterval(e.timer);
    if (e.mic) e.mic.stop();
    e.mic = null;
    e.tracker.release();
    publish({ listening: false, status: 'Press Start, then play a string', level: 0, open: false, silent: false }, true);
  }, [publish]);

  const start = useCallback(async () => {
    const e = engine.current;
    if (e.mic) return;
    try {
      const { instrument: inst } = live.current;
      e.mic = await openMic(inst.fmin < 50 ? 8192 : 4096);
    } catch (err) {
      publish({ error: err instanceof MicError ? err.message : 'The microphone could not be started.' }, true);
      return;
    }
    e.tracker.opts = { strings: live.current.strings, target: live.current.target, tol: live.current.prefs.tol };
    e.tracker.release();
    e.lastHeard = 0;
    publish({ listening: true, error: '', status: 'Listening… play a string' }, true);
    e.timer = setInterval(tick, TICK_MS);
  }, [publish, tick]);

  useEffect(() => () => stop(), [stop]);

  // The reference tone of a string: its note and two overtones, fading out.
  const tone = useRef(null);
  const playTone = useCallback(async (midi) => {
    const ctx = await resumeAudio();
    if (tone.current) tone.current.stop();
    const freq = freqFromMidi(midi, live.current.prefs.a4);
    const out = ctx.createGain();
    const now = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.28, now + 0.05);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    out.connect(ctx.destination);
    const oscs = [1, 2, 3].map((h) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * h;
      g.gain.value = [1, 0.35, 0.12][h - 1];
      o.connect(g);
      g.connect(out);
      o.start(now);
      o.stop(now + 2.7);
      return o;
    });
    tone.current = {
      stop() {
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
        oscs.forEach((o) => {
          try {
            o.stop(ctx.currentTime + 0.2);
          } catch {
            // already stopped
          }
        });
      },
    };
  }, []);

  const note = useMemo(() => {
    if (ui.goal === null) return null;
    return noteFromFreq(freqFromMidi(ui.goal, prefs.a4), prefs.a4);
  }, [ui.goal, prefs.a4]);

  return { prefs, setPrefs, instrument, strings, target, setTarget, ui, note, start, stop, resetDone, playTone, silentText: SILENT_MIC_TEXT };
}
