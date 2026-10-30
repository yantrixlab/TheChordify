import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chordKeyLabel, chordNotes, getAllGuitarShapes } from 'chordsuno-shared/chordShapes';
import { ChordListener } from 'chordsuno-shared/tools/listener';
import { scoreChord } from 'chordsuno-shared/tools/chroma';
import { Metronome, clampBpm, defaultAccents } from 'chordsuno-shared/tools/metronome';
import { strumShape } from 'chordsuno-shared/tools/strum';
import { MicError, NoiseGate, SILENT_MIC_TEXT, SilenceWatch, levelPercent, openMic } from '../audio/engine';
import { useAuth } from '../auth/AuthContext';
import ChordDiagram from '../components/ChordDiagram';
import { Icon } from '../components/Icons';
import { Segmented } from '../components/Sheet';
import { Slider } from '../components/Slider';
import { AppBar, Button, Centered, Note } from '../components/Ui';
import { getJson, setJson } from '../lib/storage';
import { radius, makeStyles, useColors } from '../theme';

const KEY = 'practice-prefs';
const BEST = 'practice-best';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = { 'C#': 'D♭', 'D#': 'E♭', 'F#': 'G♭', 'G#': 'A♭', 'A#': 'B♭' };
const ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ACC_OK = { C: ['', '#'], D: ['b', '', '#'], E: ['b', ''], F: ['', '#'], G: ['b', '', '#'], A: ['b', '', '#'], B: ['b', ''] };
const QUALITIES = [['', 'maj'], ['m', 'min'], ['5', '5'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['sus2', 'sus2'], ['sus4', 'sus4'], ['6', '6'], ['m6', 'm6'], ['dim', 'dim'], ['aug', 'aug'], ['m7b5', 'm7♭5'], ['dim7', 'dim7']];
const SETS = [
  ['First four', 'G C D Em'],
  ['Open chords', 'Em Am C G D A E Dm'],
  ['Campfire', 'G C D Em Am'],
  ['Minor mood', 'Am Dm Em Bm F#m Cm Gm'],
  ['Barre chords', 'F Bm F#m B Cm Gm C#m Fm'],
  ['7th chords', 'G7 C7 D7 A7 E7 Am7 Dm7 Em7 Cmaj7'],
  ['Power chords', 'E5 A5 D5 G5 C5'],
];
const PROGRESSIONS = [
  ['I – IV – V', 'I IV V IV'],
  ['I – V – vi – IV', 'I V vi IV'],
  ['vi – IV – I – V', 'vi IV I V'],
  ['I – vi – IV – V', 'I vi IV V'],
  ['ii – V – I', 'ii V I I'],
  ['12-bar blues', 'I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7'],
];
const MAJOR = { I: [0, ''], ii: [2, 'm'], iii: [4, 'm'], IV: [5, ''], V: [7, ''], vi: [9, 'm'], I7: [0, '7'], IV7: [5, '7'], V7: [7, '7'] };
const MODES = [
  { id: 'explore', label: 'Explore', blurb: 'Pick any note, flat or sharp, and a kind of chord. See every way to play it up the neck, hear each one, and choose the shape you want to practise.' },
  { id: 'follow', label: 'Follow along', blurb: 'A beat keeps time and the chord changes every few beats. The next chord is shown ahead so you can get your fingers ready.' },
  { id: 'listen', label: 'Listen & check', blurb: 'Play the chord shown. Chord Suno listens through your microphone and moves on when it hears you play it right.' },
  { id: 'minute', label: '1-minute changes', blurb: 'Change between all your chords as many times as you can in one minute. Chord Suno listens through your microphone and counts each chord you play.' },
  { id: 'progression', label: 'Progressions', blurb: 'Play along with a real progression in the key you choose. The chords come round in order, with a beat to keep you steady.' },
  { id: 'quiz', label: 'Chord quiz', blurb: 'A chord shape appears. Name it. A quick way to learn what each shape is called.' },
];
const DEFAULTS = {
  mode: 'explore',
  chords: ['G', 'C', 'D', 'Em'],
  shapes: {},
  order: 'random',
  bpm: 70,
  per: 4,
  click: true,
  limit: 0,
  sens: 55,
  source: 'mine',
  prog: { steps: 'I V vi IV' },
  pick: { root: 'C', acc: '', q: '' },
  trainer: { on: false, every: 8, step: 5, target: 120 },
  quizAny: false,
};

const shapesOf = (chord) => {
  try {
    return getAllGuitarShapes(chord, 8) || [];
  } catch {
    return [];
  }
};
const valid = (chord) => shapesOf(chord).length > 0;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const kindsFor = (...chords) => ['', 'm', ...chords.map((c) => c.replace(/^[A-G]#?/, ''))];

function shapeLabel(shape) {
  const pressed = shape.frets.map(Number).filter((f) => f > 0);
  const lowest = pressed.length ? Math.min(...pressed) : 0;
  const open = shape.frets.includes('0');
  if (lowest <= 2 && (open || lowest <= 1)) return open ? 'Open position' : 'Near the nut';
  return `From fret ${lowest}`;
}

/** Practice your chords. The beat, the listening and the chord shapes are the website's own code (lib/tools, chordShapes). */
export default function PracticeScreen({ navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { can } = useAuth();
  const [prefs, setPrefsState] = useState(() => {
    const old = getJson(KEY, {}) || {};
    const merged = { ...DEFAULTS, ...old, trainer: { ...DEFAULTS.trainer, ...old.trainer }, prog: { ...DEFAULTS.prog, ...old.prog }, pick: { ...DEFAULTS.pick, ...old.pick }, shapes: { ...old.shapes } };
    merged.chords = merged.chords.filter(valid);
    if (merged.chords.length < 2) merged.chords = DEFAULTS.chords;
    return merged;
  });
  const [running, setRunning] = useState(false);
  const [view, setView] = useState({ now: '', next: '', nowI: -1, flash: null, stats: [], error: '', level: 0, heard: '', silent: false, beat: -1, count: 0, clock: '1:00', phase: 'idle', bpm: prefs.bpm, auto: true });
  const [quiz, setQuiz] = useState({ chord: '', options: [], picked: '', right: 0, wrong: 0, streak: 0, bestStreak: 0 });
  const [addText, setAddText] = useState('');
  const [addError, setAddError] = useState('');

  const setPrefs = useCallback((patch) => {
    setPrefsState((before) => {
      const next = { ...before, ...(typeof patch === 'function' ? patch(before) : patch) };
      setJson(KEY, next);
      return next;
    });
  }, []);

  const rt = useRef({ metro: null, mic: null, listener: null, raf: 0, timers: [], seq: 0, lastIdx: 0, nowI: 0, nextI: 0, now: '', next: '', target: '', shownAt: 0, ok: 0, locked: false, played: 0, startedAt: 0, stats: { right: 0, streak: 0, bestStreak: 0, times: [], missed: 0 }, count: 0, expecting: '', phase: 'idle', started: false, gate: new NoiseGate(55), silence: new SilenceWatch(), lastUi: 0 }).current;
  const live = useRef(prefs);
  live.current = prefs;

  const pc = (NAMES.indexOf(prefs.pick.root) + (prefs.pick.acc === '#' ? 1 : prefs.pick.acc === 'b' ? 11 : 0)) % 12;
  const keyLabel = prefs.pick.root + (prefs.pick.acc === '#' ? '♯' : prefs.pick.acc === 'b' ? '♭' : '');
  const usingProg = prefs.mode === 'progression' || (prefs.source === 'prog' && ['follow', 'listen', 'minute'].includes(prefs.mode));
  const flatNames = usingProg && (prefs.pick.acc === 'b' || (prefs.pick.acc === '' && prefs.pick.root === 'F'));
  const pretty = useCallback(
    (chord) => {
      const m = /^([A-G]#)(.*)$/.exec(chord);
      return flatNames && m && FLAT[m[1]] ? FLAT[m[1]] + m[2] : chord.replace('#', '♯');
    },
    [flatNames],
  );
  const progChords = useMemo(() => prefs.prog.steps.split(' ').map((step) => NAMES[(pc + MAJOR[step][0]) % 12] + MAJOR[step][1]), [prefs.prog.steps, pc]);
  const source = usingProg ? progChords : prefs.chords;
  const pickedChord = NAMES[(NAMES.indexOf(prefs.pick.root) + (prefs.pick.acc === '#' ? 1 : prefs.pick.acc === 'b' ? 11 : 0)) % 12] + prefs.pick.q;
  const shapeIdx = (chord) => Math.min(Math.max(0, prefs.shapes[chord] || 0), Math.max(0, shapesOf(chord).length - 1));
  const shapeOf = (chord) => shapesOf(chord)[shapeIdx(chord)];

  const srcRef = useRef(source);
  srcRef.current = source;
  const progRef = useRef(usingProg);
  progRef.current = usingProg;

  // ---- the drills ----
  const pick = useCallback((after) => {
    const list = srcRef.current;
    const p = live.current;
    if (p.mode === 'progression' || p.order === 'list') {
      rt.lastIdx = rt.seq % list.length;
      return list[rt.seq++ % list.length];
    }
    let next = list[Math.floor(Math.random() * list.length)];
    for (let i = 0; i < 6 && next === after && list.length > 1; i++) next = list[Math.floor(Math.random() * list.length)];
    rt.lastIdx = list.indexOf(next);
    return next;
  }, [rt]);

  const clearTimers = useCallback(() => {
    rt.timers.forEach((t) => {
      clearInterval(t);
      clearTimeout(t);
    });
    rt.timers = [];
    cancelAnimationFrame(rt.raf);
  }, [rt]);

  const stopMic = useCallback(() => {
    if (rt.listener) rt.listener.stop();
    rt.listener = null;
    if (rt.mic) rt.mic.stop();
    rt.mic = null;
    setView((v) => ({ ...v, level: 0, heard: '', silent: false }));
  }, [rt]);

  const stopAll = useCallback(() => {
    clearTimers();
    if (rt.metro) rt.metro.stop();
    rt.metro = null;
    stopMic();
    rt.phase = 'idle';
    setRunning(false);
    setView((v) => ({ ...v, beat: -1, phase: 'idle', clock: '1:00' }));
  }, [clearTimers, stopMic, rt]);

  useEffect(() => () => stopAll(), [stopAll]);

  const flash = useCallback((kind, text) => {
    setView((v) => ({ ...v, flash: { kind, text } }));
    const t = setTimeout(() => setView((v) => ({ ...v, flash: null })), 800);
    rt.timers.push(t);
  }, [rt]);

  const startMic = useCallback(
    async (handler) => {
      setView((v) => ({ ...v, error: '' }));
      try {
        rt.mic = await openMic(16384);
      } catch (err) {
        setView((v) => ({ ...v, error: err instanceof MicError ? err.message : 'The microphone could not be started.' }));
        return false;
      }
      rt.gate.sensitivity = live.current.sens;
      rt.listener = new ChordListener(rt.mic, { gate: rt.gate }, handler);
      rt.listener.start(110);
      return true;
    },
    [rt],
  );

  const meterAndName = useCallback(
    (h) => {
      const now = Date.now();
      if (now - rt.lastUi < 90) return;
      rt.lastUi = now;
      setView((v) => ({ ...v, level: levelPercent(h.level), silent: rt.silence.feed(h.level), heard: h.chord ? h.chord : '' }));
    },
    [rt],
  );

  // follow along and progressions
  const startFollow = useCallback(() => {
    const p = live.current;
    rt.seq = 0;
    rt.played = 0;
    rt.now = '';
    rt.metro = new Metronome({ bpm: p.bpm, beats: p.per, accents: defaultAccents(p.per, 4), sub: 1, sound: 'wood', volume: p.click ? 0.7 : 0, trainer: { ...p.trainer }, gap: { on: false, play: 3, mute: 1 } });
    rt.metro.onBpm = (bpm) => setView((v) => ({ ...v, bpm }));
    rt.startedAt = performance.now();
    setView((v) => ({ ...v, bpm: p.bpm }));
    const frame = () => {
      if (!rt.metro || !rt.metro.running) return;
      for (const tick of rt.metro.due()) {
        if (tick.sub !== 0) continue;
        if (tick.beat === 0) {
          if (!rt.now) {
            rt.now = pick();
            rt.nowI = rt.lastIdx;
            rt.next = pick(rt.now);
            rt.nextI = rt.lastIdx;
          } else {
            rt.now = rt.next;
            rt.nowI = rt.nextI;
            rt.next = pick(rt.now);
            rt.nextI = rt.lastIdx;
          }
          rt.played++;
          setView((v) => ({ ...v, now: rt.now, next: rt.next, nowI: rt.nowI, beat: 0, stats: [['Chords', rt.played], ['Time', clock((performance.now() - rt.startedAt) / 1000)], ['Tempo', `${rt.metro.settings.bpm} BPM`]] }));
        } else setView((v) => ({ ...v, beat: tick.beat }));
      }
      rt.raf = requestAnimationFrame(frame);
    };
    rt.metro.start().then(() => {
      rt.raf = requestAnimationFrame(frame);
    });
  }, [pick, rt]);

  // listen and check
  const listenStats = useCallback(() => {
    const s = rt.stats;
    const avg = s.times.length ? `${(s.times.reduce((a, b) => a + b, 0) / s.times.length / 1000).toFixed(1)} s` : '–';
    const fastest = s.times.length ? `${(Math.min(...s.times) / 1000).toFixed(1)} s` : '–';
    setView((v) => ({ ...v, stats: [['Right', s.right], ['Streak', s.streak], ['Best streak', s.bestStreak], ['Average', avg], ['Fastest', fastest], ['Missed', s.missed]] }));
  }, [rt]);
  const nextTarget = useCallback(() => {
    rt.locked = false;
    rt.ok = 0;
    if (rt.target) {
      rt.target = rt.next;
      rt.nowI = rt.nextI;
    } else {
      rt.target = pick();
      rt.nowI = rt.lastIdx;
    }
    rt.next = pick(rt.target);
    rt.nextI = rt.lastIdx;
    rt.shownAt = performance.now();
    setView((v) => ({ ...v, now: rt.target, next: rt.next, nowI: rt.nowI }));
    if (rt.listener) rt.listener.options.suffixes = kindsFor(rt.target);
  }, [pick, rt]);
  const listenHeard = useCallback(
    (h) => {
      meterAndName(h);
      if (rt.locked || !h.chroma || performance.now() - rt.shownAt < 450) {
        if (!h.chroma) rt.ok = 0;
        return;
      }
      const score = scoreChord(h.chroma, rt.target);
      const top = h.guesses[0];
      const right = score >= 0.62 && ((top && top.name === rt.target) || score >= (top ? top.score : 0) - 0.04);
      rt.ok = right ? rt.ok + 1 : 0;
      if (rt.ok >= 2) {
        rt.locked = true;
        const ms = performance.now() - rt.shownAt;
        const s = rt.stats;
        s.right++;
        s.streak++;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        s.times.push(ms);
        flash('good', `${(ms / 1000).toFixed(1)} s`);
        listenStats();
        rt.timers.push(setTimeout(() => rt.mic && live.current.mode === 'listen' && nextTarget(), 850));
      }
    },
    [flash, listenStats, meterAndName, nextTarget, rt],
  );
  const startListen = useCallback(async () => {
    if (!(await startMic(listenHeard))) return false;
    rt.stats = { right: 0, streak: 0, bestStreak: 0, times: [], missed: 0 };
    rt.seq = 0;
    rt.target = '';
    nextTarget();
    listenStats();
    const limit = live.current.limit;
    if (limit) {
      rt.timers.push(
        setInterval(() => {
          if (rt.locked) return;
          if ((performance.now() - rt.shownAt) / 1000 >= limit) {
            rt.locked = true;
            rt.stats.missed++;
            rt.stats.streak = 0;
            flash('miss', 'Too slow');
            listenStats();
            rt.timers.push(setTimeout(() => rt.mic && live.current.mode === 'listen' && nextTarget(), 850));
          }
        }, 100),
      );
    }
    return true;
  }, [flash, listenHeard, listenStats, nextTarget, rt, startMic]);

  // one minute
  const flip = useCallback(() => {
    rt.expecting = rt.next;
    rt.nowI = rt.nextI;
    rt.next = pick(rt.expecting);
    rt.nextI = rt.lastIdx;
    rt.shownAt = performance.now();
    rt.ok = 0;
    setView((v) => ({ ...v, now: rt.expecting, next: rt.next, nowI: rt.nowI }));
    if (rt.listener) rt.listener.options.suffixes = kindsFor(...srcRef.current);
  }, [pick, rt]);
  const minuteHeard = useCallback(
    (h) => {
      meterAndName(h);
      if (rt.phase !== 'run' || !h.chroma || performance.now() - rt.shownAt < 450) {
        if (!h.chroma) rt.ok = 0;
        return;
      }
      const score = scoreChord(h.chroma, rt.expecting);
      const top = h.guesses[0];
      rt.ok = score >= 0.62 && ((top && top.name === rt.expecting) || score >= (top ? top.score : 0) - 0.04) ? rt.ok + 1 : 0;
      if (rt.ok < 2) return;
      if (rt.started) {
        rt.count++;
        setView((v) => ({ ...v, count: rt.count }));
        flash('good', '+1');
      } else {
        rt.started = true;
        flash('good', 'Go!');
      }
      flip();
    },
    [flash, flip, meterAndName, rt],
  );
  const finishMinute = useCallback(() => {
    clearTimers();
    rt.phase = 'idle';
    stopMic();
    const key = [...new Set(srcRef.current)].sort().join('|');
    const scores = getJson(BEST, {}) || {};
    const old = scores[key] || 0;
    const record = rt.count > old;
    if (record) setJson(BEST, { ...scores, [key]: rt.count });
    setRunning(false);
    setView((v) => ({ ...v, phase: 'idle', clock: '1:00', stats: [['Result', `${rt.count} changes`], ['Best', Math.max(rt.count, old)]] }));
    Alert.alert(record && rt.count > 0 ? 'New best!' : 'Time!', `${rt.count} clean changes across ${new Set(srcRef.current).size} chords.`);
  }, [clearTimers, rt, stopMic]);
  const startMinute = useCallback(async () => {
    rt.started = false;
    const listening = await startMic(minuteHeard);
    if (!listening) rt.started = true;
    rt.count = 0;
    rt.seq = 0;
    rt.expecting = pick();
    rt.nowI = rt.lastIdx;
    rt.next = pick(rt.expecting);
    rt.nextI = rt.lastIdx;
    rt.shownAt = performance.now();
    rt.ok = 0;
    if (rt.listener) rt.listener.options.suffixes = kindsFor(...srcRef.current);
    rt.phase = 'ready';
    let left = 3;
    setView((v) => ({ ...v, now: rt.expecting, next: rt.next, nowI: rt.nowI, count: 0, phase: 'ready', clock: String(left), auto: listening }));
    const wait = setInterval(() => {
      left--;
      if (left > 0) {
        setView((v) => ({ ...v, clock: String(left) }));
        return;
      }
      clearInterval(wait);
      rt.phase = 'run';
      const t0 = performance.now();
      setView((v) => ({ ...v, phase: 'run' }));
      rt.timers.push(
        setInterval(() => {
          const remaining = 60 - (performance.now() - t0) / 1000;
          setView((v) => ({ ...v, clock: clock(Math.max(0, Math.ceil(remaining))) }));
          if (remaining <= 0) finishMinute();
        }, 200),
      );
    }, 1000);
    rt.timers.push(wait);
    return true;
  }, [finishMinute, minuteHeard, pick, rt, startMic]);
  const tapChange = () => {
    if (rt.phase !== 'run') return;
    rt.started = true;
    rt.count++;
    setView((v) => ({ ...v, count: rt.count }));
    flip();
  };

  // quiz
  const anyChords = useMemo(() => NAMES.flatMap((n) => ['', 'm', '7'].map((s) => n + s)).filter(valid), []);
  const nextQuestion = useCallback(
    (carry) => {
      const p = live.current;
      const pool = p.quizAny || p.chords.length < 3 ? anyChords : p.chords;
      let chord = pool[Math.floor(Math.random() * pool.length)];
      for (let i = 0; i < 6 && chord === (carry || {}).chord; i++) chord = pool[Math.floor(Math.random() * pool.length)];
      const root = chord.match(/^[A-G]#?/)[0];
      const suffix = chord.slice(root.length);
      const alike = shuffle(anyChords.filter((c) => c !== chord && (c.startsWith(root) || c.endsWith(suffix)))).slice(0, 3);
      const options = shuffle([chord, ...alike, ...shuffle(anyChords.filter((c) => c !== chord && !alike.includes(c)))].slice(0, 4));
      if (!options.includes(chord)) options[0] = chord;
      setQuiz((q) => ({ ...q, ...(carry || {}), chord, options, picked: '' }));
    },
    [anyChords],
  );
  const answer = (choice) => {
    if (quiz.picked || !quiz.chord) return;
    const right = choice === quiz.chord;
    const streak = right ? quiz.streak + 1 : 0;
    setQuiz((q) => ({ ...q, picked: choice, right: q.right + (right ? 1 : 0), wrong: q.wrong + (right ? 0 : 1), streak, bestStreak: Math.max(q.bestStreak, streak) }));
    rt.timers.push(setTimeout(() => live.current.mode === 'quiz' && nextQuestion(null), right ? 700 : 1500));
  };

  const go = async () => {
    if (running) {
      stopAll();
      return;
    }
    setRunning(true);
    const p = live.current;
    setView((v) => ({ ...v, error: '', flash: null, stats: [] }));
    rt.seq = 0;
    if (p.mode === 'follow' || p.mode === 'progression') startFollow();
    else if (p.mode === 'listen') {
      if (!(await startListen())) setRunning(false);
    } else if (p.mode === 'minute') await startMinute();
    else if (p.mode === 'quiz') {
      setQuiz({ chord: '', options: [], picked: '', right: 0, wrong: 0, streak: 0, bestStreak: 0 });
      nextQuestion(null);
    }
  };

  const setMode = (mode) => {
    if (mode === prefs.mode) return;
    stopAll();
    setPrefs({ mode });
    setView((v) => ({ ...v, now: '', next: '', nowI: -1, stats: [], error: '' }));
  };

  // while idle the stage shows the first two chords
  const idleNow = running ? view.now : source[0];
  const idleNext = running ? view.next : source[1];

  const addChord = () => {
    const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(.*?)\s*$/.exec(addText);
    if (!m) return setAddError(`“${addText.trim()}” is not a chord we know. Try names like Am, F#m, G7, Cmaj7, Dsus4 or E5.`);
    let root = m[1].toUpperCase() + m[2].replace('♯', '#').replace('♭', 'b');
    const flats = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };
    root = flats[root] || root;
    const alias = { min: 'm', '-': 'm', maj: '', major: '', M: '', minor: 'm', M7: 'maj7', dom7: '7' };
    const name = root + (alias[m[3]] !== undefined ? alias[m[3]] : m[3]);
    if (!valid(name)) return setAddError(`“${addText.trim()}” is not a chord we know. Try names like Am, F#m, G7, Cmaj7, Dsus4 or E5.`);
    if (prefs.chords.includes(name)) return setAddError(`${pretty(name)} is already in the list.`);
    if (prefs.chords.length >= 16) return setAddError('That is plenty to practise: take one out before adding another.');
    setPrefs({ chords: [...prefs.chords, name] });
    setAddText('');
    setAddError('');
  };
  const toggleInList = () => {
    if (prefs.chords.includes(pickedChord)) {
      if (prefs.chords.length <= 2) return setAddError('Keep at least two chords to practise.');
      setPrefs({ chords: prefs.chords.filter((c) => c !== pickedChord) });
    } else {
      if (prefs.chords.length >= 16) return setAddError('That is plenty to practise: take one out before adding another.');
      setPrefs({ chords: [...prefs.chords, pickedChord] });
    }
    setAddError('');
  };

  if (!can('practice_chords')) {
    return (
      <View style={styles.screen}>
        <AppBar title="Practice your chords" backIcon="close" onBack={() => navigation.goBack()} />
        <Centered>
          <Icon name="premium" size={48} color={colors.gold} filled />
          <Text style={styles.gateTitle}>Chord practice is not in your plan</Text>
          <Button title="See the plans" onPress={() => navigation.navigate('Tabs', { screen: 'Premium' })} style={styles.gateButton} />
        </Centered>
      </View>
    );
  }

  const mode = MODES.find((m) => m.id === prefs.mode);
  const shapes = shapesOf(pickedChord);
  const best = (getJson(BEST, {}) || {})[[...new Set(source)].sort().join('|')];
  const drill = ['follow', 'listen', 'minute', 'progression'].includes(prefs.mode);

  return (
    <View style={styles.screen}>
      <AppBar title="Practice your chords" backIcon="close" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>
          {MODES.map((m) => (
            <Text key={m.id} onPress={() => setMode(m.id)} style={[styles.mode, prefs.mode === m.id && styles.modeOn]} accessibilityRole="tab">
              {m.label}
            </Text>
          ))}
        </ScrollView>
        <Text style={styles.blurb}>{mode.blurb}</Text>

        {prefs.mode === 'explore' ? (
          <View style={styles.pad}>
            <View style={styles.exHead}>
              <Text style={styles.exName}>{pretty(pickedChord)}</Text>
              <View style={styles.flex}>
                <Text style={styles.exLong}>{shapes.length ? chordKeyLabel(pickedChord) : 'No shape for this one'}</Text>
                <View style={styles.notes}>
                  {chordNotes(pickedChord).map((n) => (
                    <Text key={n} style={styles.note}>
                      {pretty(n)}
                    </Text>
                  ))}
                </View>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
              {shapes.map((shape, i) => (
                <Pressable
                  key={`${pickedChord}-${i}`}
                  onPress={() => {
                    setPrefs((p) => ({ shapes: { ...p.shapes, [pickedChord]: i } }));
                    strumShape(shape).catch(() => {});
                  }}
                  style={[styles.shapeCard, i === shapeIdx(pickedChord) && styles.shapeUse]}
                  accessibilityRole="button"
                  accessibilityLabel={`${pretty(pickedChord)}, ${shapeLabel(shape)}. Press to hear it and use it.`}
                >
                  <ChordDiagram shape={shape} label={pretty(pickedChord)} />
                  <Text style={styles.shapeLabel}>{i === shapeIdx(pickedChord) ? 'In use · ' : ''}{shapeLabel(shape)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.hint}>Tap a shape to hear it. The one marked “In use” is the one your drills will show.</Text>

            <Text style={styles.label}>Note</Text>
            <View style={styles.chips}>
              {ROOTS.map((r) => (
                <Text key={r} onPress={() => setPrefs((p) => ({ pick: { ...p.pick, root: r, acc: ACC_OK[r].includes(p.pick.acc) ? p.pick.acc : '' } }))} style={[styles.chip, prefs.pick.root === r && styles.chipOn]} accessibilityRole="button">
                  {r}
                </Text>
              ))}
            </View>
            <View style={styles.chips}>
              {ACC_OK[prefs.pick.root].map((a) => (
                <Text key={a || 'n'} onPress={() => setPrefs((p) => ({ pick: { ...p.pick, acc: a } }))} style={[styles.chip, prefs.pick.acc === a && styles.chipOn]} accessibilityRole="button">
                  {a === '#' ? '♯' : a === 'b' ? '♭' : '♮'}
                </Text>
              ))}
            </View>
            <Text style={styles.label}>Kind of chord</Text>
            <View style={styles.chips}>
              {QUALITIES.map(([q, name]) => (
                <Text key={name} onPress={() => setPrefs((p) => ({ pick: { ...p.pick, q } }))} style={[styles.chip, prefs.pick.q === q && styles.chipOn]} accessibilityRole="button">
                  {name}
                </Text>
              ))}
            </View>
            <Button title={prefs.chords.includes(pickedChord) ? '✓ In my chords' : '＋ Add to my chords'} kind={prefs.chords.includes(pickedChord) ? 'quiet' : 'primary'} onPress={toggleInList} disabled={!shapes.length} style={styles.gap} />
          </View>
        ) : null}

        {drill ? (
          <View style={styles.pad}>
            {usingProg ? (
              <>
                <View style={styles.strip}>
                  {progChords.map((c, i) => (
                    <Text key={`${c}-${i}`} style={[styles.stripChord, i === view.nowI && running && styles.stripOn, running && i < view.nowI && styles.stripDone]}>
                      {pretty(c)}
                    </Text>
                  ))}
                </View>
                <Text style={styles.hint}>
                  Key of {keyLabel} major: {progChords.map(pretty).join('   ')}
                </Text>
              </>
            ) : null}
            <View style={styles.cards}>
              <View style={[styles.nowCard, view.flash && (view.flash.kind === 'good' ? styles.good : styles.miss)]}>
                <Text style={styles.cardLabel}>Play now</Text>
                <Text style={styles.nowName}>{idleNow ? pretty(idleNow) : '–'}</Text>
                {idleNow ? <ChordDiagram shape={shapeOf(idleNow)} label="" notes={chordNotes(idleNow)} scale={0.9} /> : null}
                {view.flash ? <Text style={[styles.badge, view.flash.kind === 'miss' && styles.badgeMiss]}>{view.flash.text}</Text> : null}
              </View>
              <View style={styles.nextCard}>
                <Text style={styles.cardLabel}>Next</Text>
                <Text style={styles.nextName}>{idleNext ? pretty(idleNext) : '–'}</Text>
                {idleNext ? <ChordDiagram shape={shapeOf(idleNext)} label="" notes={chordNotes(idleNext)} scale={0.7} /> : null}
              </View>
            </View>

            {prefs.mode === 'follow' || prefs.mode === 'progression' ? (
              <>
                <View style={styles.beats}>
                  {Array.from({ length: prefs.per }, (_, i) => (
                    <View key={i} style={[styles.dot, i === 0 && styles.dotFirst, running && view.beat === i && styles.dotNow]} />
                  ))}
                </View>
                <View style={styles.bpmRow}>
                  <Pressable onPress={() => setPrefs({ bpm: Math.max(30, prefs.bpm - 5) })} style={styles.round} accessibilityRole="button" accessibilityLabel="Slower">
                    <Text style={styles.roundText}>−</Text>
                  </Pressable>
                  <Text style={styles.bpm}>
                    {running ? view.bpm : prefs.bpm}
                    <Text style={styles.bpmUnit}> BPM</Text>
                  </Text>
                  <Pressable onPress={() => setPrefs({ bpm: Math.min(200, prefs.bpm + 5) })} style={styles.round} accessibilityRole="button" accessibilityLabel="Faster">
                    <Text style={styles.roundText}>+</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {prefs.mode === 'minute' ? (
              <View style={styles.minute}>
                <Text style={styles.clock}>{view.phase === 'idle' ? '1:00' : view.clock}</Text>
                <Text style={styles.countNum}>{view.count}</Text>
                <Text style={styles.countLabel}>clean changes</Text>
                <Text style={styles.hint}>{view.auto ? 'Play the first chord to start. Each time Chord Suno hears you play the chord shown, it counts and shows the next one.' : 'Press the button each time you switch chords cleanly.'}</Text>
                <Button title="Count a change myself" kind="quiet" onPress={tapChange} disabled={view.phase !== 'run'} style={styles.gap} />
                <Text style={styles.hint}>{best ? `Your best with these chords: ${best} changes in a minute.` : 'No score yet for this set of chords. Give it a go.'}</Text>
              </View>
            ) : null}

            {view.stats.length > 0 ? (
              <View style={styles.stats}>
                {view.stats.map(([k, v]) => (
                  <View key={k} style={styles.stat}>
                    <Text style={styles.statV}>{v}</Text>
                    <Text style={styles.statK}>{k}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {prefs.mode === 'listen' && running ? (
              <Text
                onPress={() => {
                  rt.stats.streak = 0;
                  rt.stats.missed++;
                  listenStats();
                  nextTarget();
                }}
                style={styles.skip}
              >
                Skip this chord
              </Text>
            ) : null}
          </View>
        ) : null}

        {prefs.mode === 'quiz' ? (
          <View style={styles.pad}>
            <View style={styles.quizCard}>{quiz.chord ? <ChordDiagram shape={shapeOf(quiz.chord)} label="" scale={1.2} /> : <Text style={styles.hint}>Press Start</Text>}</View>
            <View style={styles.options}>
              {quiz.options.map((c) => (
                <Pressable key={c} onPress={() => answer(c)} style={[styles.option, quiz.picked && c === quiz.chord && styles.optRight, quiz.picked === c && c !== quiz.chord && styles.optWrong]} accessibilityRole="button">
                  <Text style={styles.optionText}>{pretty(c)}</Text>
                </Pressable>
              ))}
            </View>
            {quiz.right + quiz.wrong > 0 ? (
              <View style={styles.stats}>
                {[['Right', quiz.right], ['Streak', quiz.streak], ['Best streak', quiz.bestStreak], ['Accuracy', `${Math.round((quiz.right / (quiz.right + quiz.wrong)) * 100)}%`]].map(([k, v]) => (
                  <View key={k} style={styles.stat}>
                    <Text style={styles.statV}>{v}</Text>
                    <Text style={styles.statK}>{k}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {prefs.mode !== 'explore' ? (
          <View style={styles.pad}>
            <Button title={running ? 'Stop' : 'Start'} icon={running ? 'pause' : 'play'} onPress={go} style={styles.gap} />
            {view.error ? <Note>{view.error}</Note> : null}
            {view.silent ? <Note>{SILENT_MIC_TEXT}</Note> : null}
            {['listen', 'minute'].includes(prefs.mode) ? (
              <>
                <View style={styles.meter}>
                  <View style={[styles.meterFill, { width: `${view.level}%` }]} />
                </View>
                <Text style={styles.hint}>Hearing: {view.heard ? pretty(view.heard) : '–'}</Text>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.pad}>
          {prefs.mode !== 'progression' && prefs.mode !== 'explore' ? (
            <>
              <Text style={styles.label}>Practise</Text>
              <Segmented
                options={[
                  { id: 'mine', label: 'My chords' },
                  { id: 'prog', label: 'A progression' },
                ]}
                value={prefs.source}
                onChange={(id) => setPrefs({ source: id })}
              />
            </>
          ) : null}
          {usingProg ? (
            <>
              <Text style={styles.label}>Progression</Text>
              <View style={styles.chips}>
                {PROGRESSIONS.map(([name, steps]) => (
                  <Text key={name} onPress={() => setPrefs({ prog: { steps } })} style={[styles.chip, prefs.prog.steps === steps && styles.chipOn]} accessibilityRole="button">
                    {name}
                  </Text>
                ))}
              </View>
              <Text style={styles.label}>Key</Text>
              <View style={styles.chips}>
                {ROOTS.map((r) => (
                  <Text key={r} onPress={() => setPrefs((p) => ({ pick: { ...p.pick, root: r, acc: ACC_OK[r].includes(p.pick.acc) ? p.pick.acc : '' } }))} style={[styles.chip, prefs.pick.root === r && styles.chipOn]} accessibilityRole="button">
                    {r}
                  </Text>
                ))}
                {ACC_OK[prefs.pick.root].map((a) => (
                  <Text key={a || 'n'} onPress={() => setPrefs((p) => ({ pick: { ...p.pick, acc: a } }))} style={[styles.chip, prefs.pick.acc === a && styles.chipOn]} accessibilityRole="button">
                    {a === '#' ? '♯' : a === 'b' ? '♭' : '♮'}
                  </Text>
                ))}
              </View>
            </>
          ) : null}
          {(prefs.mode === 'follow' || prefs.mode === 'progression') && (
            <>
              <Text style={styles.label}>Beats per chord</Text>
              <View style={styles.chips}>
                {[2, 4, 8].map((n) => (
                  <Text key={n} onPress={() => setPrefs({ per: n })} style={[styles.chip, prefs.per === n && styles.chipOn]} accessibilityRole="button">
                    {n} beats
                  </Text>
                ))}
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchText}>Metronome click</Text>
                <Switch value={prefs.click} onValueChange={(click) => setPrefs({ click })} trackColor={{ true: colors.accent, false: colors.line }} thumbColor="#fff" />
              </View>
            </>
          )}
          {prefs.mode === 'listen' ? (
            <>
              <Text style={styles.label}>Time to play each chord</Text>
              <View style={styles.chips}>
                {[[0, 'No limit'], [5, '5 s'], [8, '8 s'], [12, '12 s']].map(([n, name]) => (
                  <Text key={n} onPress={() => setPrefs({ limit: n })} style={[styles.chip, prefs.limit === n && styles.chipOn]} accessibilityRole="button">
                    {name}
                  </Text>
                ))}
              </View>
            </>
          ) : null}
          {['listen', 'minute'].includes(prefs.mode) ? (
            <>
              <Text style={styles.label}>Microphone sensitivity</Text>
              <Slider value={prefs.sens} min={10} max={95} step={5} onChange={(sens) => setPrefs({ sens })} label="Microphone sensitivity" />
            </>
          ) : null}
          {['follow', 'listen', 'minute'].includes(prefs.mode) && !usingProg ? (
            <>
              <Text style={styles.label}>Order</Text>
              <Segmented
                options={[
                  { id: 'random', label: 'Shuffled' },
                  { id: 'list', label: 'In order' },
                ]}
                value={prefs.order}
                onChange={(order) => {
                  rt.seq = 0;
                  setPrefs({ order });
                }}
              />
            </>
          ) : null}
          {prefs.mode === 'follow' || prefs.mode === 'progression' ? (
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={styles.switchText}>Speed trainer</Text>
                <Text style={styles.hint}>Gets {prefs.trainer.step} BPM faster every {prefs.trainer.every} bars, up to {prefs.trainer.target}.</Text>
              </View>
              <Switch value={prefs.trainer.on} onValueChange={(on) => setPrefs((p) => ({ trainer: { ...p.trainer, on } }))} trackColor={{ true: colors.accent, false: colors.line }} thumbColor="#fff" />
            </View>
          ) : null}

          {prefs.mode !== 'progression' ? (
            <>
              <Text style={styles.label}>My chords ({prefs.chords.length})</Text>
              <View style={styles.chips}>
                {prefs.chords.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      const m = /^([A-G])(#?)(.*)$/.exec(c);
                      setPrefs({ pick: { root: m[1], acc: m[2], q: m[3] } });
                    }}
                    onLongPress={() => {
                      if (prefs.chords.length <= 2) return setAddError('Keep at least two chords to practise.');
                      setPrefs({ chords: prefs.chords.filter((x) => x !== c) });
                    }}
                    style={[styles.myChip, c === pickedChord && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityHint="Long press to remove"
                  >
                    <Text style={[styles.myChipText, c === pickedChord && { color: colors.onAccent }]}>{pretty(c)}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hint}>Tap a chord to see it in Explore. Long press to remove it.</Text>
              <View style={styles.saveRow}>
                <TextInput value={addText} onChangeText={setAddText} onSubmitEditing={addChord} placeholder="Add a chord: Am, F#m, G7…" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={styles.saveInput} />
                <Button title="Add" kind="quiet" onPress={addChord} />
              </View>
              {addError ? <Note>{addError}</Note> : null}
              <Text style={styles.label}>Quick sets</Text>
              <View style={styles.chips}>
                {SETS.map(([name, list]) => (
                  <Text
                    key={name}
                    onPress={() => {
                      rt.seq = 0;
                      setPrefs({ chords: list.split(' ').filter(valid), order: 'random' });
                    }}
                    style={styles.chip}
                    accessibilityRole="button"
                  >
                    {name}
                  </Text>
                ))}
              </View>
            </>
          ) : null}
          {prefs.mode === 'quiz' ? (
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Quiz me on every chord</Text>
              <Switch value={prefs.quizAny} onValueChange={(quizAny) => setPrefs({ quizAny })} trackColor={{ true: colors.accent, false: colors.line }} thumbColor="#fff" />
            </View>
          ) : null}
          {['listen', 'minute'].includes(prefs.mode) ? <Text style={styles.privacy}>The microphone is used only while a drill runs, and the sound never leaves your phone.</Text> : null}
          <Text style={styles.hidden}>{clampBpm(prefs.bpm)}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16 },
  flex: { flex: 1 },
  gap: { marginTop: 14 },
  modes: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  mode: { overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.accentDeep, fontSize: 14.5, fontWeight: '700' },
  modeOn: { backgroundColor: colors.accent, color: colors.onAccent },
  blurb: { color: colors.mute, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, marginBottom: 12 },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  exName: { color: colors.ink, fontSize: 52, fontWeight: '800', letterSpacing: -1 },
  exLong: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  note: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accentSoft, color: colors.accentDeep, fontSize: 14, fontWeight: '800' },
  gallery: { gap: 12, paddingVertical: 14 },
  shapeCard: { alignItems: 'center', padding: 6, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  shapeUse: { borderColor: colors.accent },
  shapeLabel: { color: colors.mute, fontSize: 12.5, fontWeight: '700', marginTop: 6 },
  hint: { color: colors.mute, fontSize: 13, lineHeight: 18, marginTop: 6 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.accentDeep, fontSize: 14, fontWeight: '700' },
  chipOn: { backgroundColor: colors.accent, color: colors.onAccent },
  myChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  myChipText: { color: colors.accentDeep, fontSize: 15, fontWeight: '800' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  stripChord: { overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.accentDeep, fontSize: 16, fontWeight: '800' },
  stripOn: { backgroundColor: colors.accent, color: colors.onAccent },
  stripDone: { opacity: 0.5 },
  cards: { flexDirection: 'row', gap: 12, marginTop: 10, alignItems: 'flex-start' },
  nowCard: { flex: 3, alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line },
  nextCard: { flex: 2, alignItems: 'center', padding: 12, borderRadius: 18, backgroundColor: colors.soft },
  good: { borderColor: colors.ok, backgroundColor: colors.okBg },
  miss: { borderColor: colors.danger, backgroundColor: colors.errorBg },
  cardLabel: { color: colors.mute, fontSize: 11.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  nowName: { color: colors.ink, fontSize: 48, fontWeight: '800', letterSpacing: -1 },
  nextName: { color: colors.ink, fontSize: 30, fontWeight: '800' },
  badge: { position: 'absolute', top: 10, right: 10, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: '#16a34a', color: '#fff', fontSize: 13, fontWeight: '800' },
  badgeMiss: { backgroundColor: colors.danger },
  beats: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.line },
  dotFirst: { backgroundColor: colors.diagramLine },
  dotNow: { backgroundColor: colors.accent, transform: [{ scale: 1.3 }] },
  bpmRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 14 },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: colors.accentDeep, fontSize: 28, lineHeight: 32 },
  bpm: { color: colors.ink, fontSize: 34, fontWeight: '800', minWidth: 130, textAlign: 'center' },
  bpmUnit: { color: colors.mute, fontSize: 14, fontWeight: '700' },
  minute: { alignItems: 'center', marginTop: 16 },
  clock: { color: colors.ink, fontSize: 56, fontWeight: '800' },
  countNum: { color: colors.accentDeep, fontSize: 44, fontWeight: '800', marginTop: 4 },
  countLabel: { color: colors.mute, fontSize: 14, fontWeight: '700' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  stat: { minWidth: 92, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center' },
  statV: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  statK: { color: colors.mute, fontSize: 12, marginTop: 2 },
  skip: { color: colors.accentDeep, fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 14 },
  quizCard: { alignItems: 'center', justifyContent: 'center', minHeight: 230, marginTop: 10, borderRadius: 18, backgroundColor: colors.surface },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  option: { width: '48%', height: 56, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  optionText: { color: colors.accentDeep, fontSize: 20, fontWeight: '800' },
  optRight: { backgroundColor: colors.okSoft },
  optWrong: { backgroundColor: colors.badSoft },
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.soft, overflow: 'hidden', marginTop: 14 },
  meterFill: { height: 8, backgroundColor: colors.accent },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  switchText: { color: colors.ink, fontSize: 15.5, fontWeight: '700' },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  saveInput: { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.soft, color: colors.ink, paddingHorizontal: 14, fontSize: 15 },
  privacy: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 17 },
  hidden: { height: 0, opacity: 0 },
  gateTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  gateButton: { marginTop: 18 },
}));
