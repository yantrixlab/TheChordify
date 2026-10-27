// Bar length: what the analysis found, or what the player sets for this song. The analysis groups the beats into bars of 3, 4, 5,
// 6 or 7, but a loose live recording can fool it, so the player can regroup the beats: beats per bar, a beat in between each beat
// (pulse x2), and the beat a bar starts on. The choice is kept per song. This is the website's logic (play.astro) as it is there.
import { getJson, setJson } from './storage';

export const METER_MIN = 2;
export const METER_MAX = 9;

const firstNumber = (values) => {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return null;
};

/** The song's own meter: its beats per bar, pulse x1, bars starting where the analysis put them. */
export function ownMeter(baseBars, result) {
  const perBar = result.beatsPerBar || (baseBars[0] && baseBars[0].beats.length ? baseBars[0].beats.length - 1 : 4);
  return { perBar, pulse: 1, shift: null };
}

export const isOwn = (meter, own) => meter.perBar === own.perBar && meter.pulse === 1 && meter.shift === null;

/** Every beat the analysis found, in order (pickup beats included). */
function songBeats(baseBars, basePerBar, pulse, duration) {
  const flat = [];
  for (const bar of baseBars) {
    for (let k = 0; k < basePerBar; k++) {
      const t = bar.beats[k];
      if (t !== null && t !== undefined) flat.push(t);
    }
  }
  if (pulse === 1) return flat;
  const doubled = [];
  flat.forEach((t, i) => {
    doubled.push(t);
    const gap = i + 1 < flat.length ? flat[i + 1] - t : i > 0 ? t - flat[i - 1] : 0.5;
    if (t + gap < duration) doubled.push(t + gap / 2);
  });
  return doubled;
}

function nearestBeat(beats, t) {
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1; // eslint-disable-line no-bitwise
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(beats[lo - 1] - t) < Math.abs(beats[lo] - t) ? lo - 1 : lo;
}

/** The beat of the bar where chords change most often: that is where bars start. */
function chordShift(beats, perBar, simpleChords) {
  if (beats.length === 0) return 0;
  const votes = new Array(perBar).fill(0);
  simpleChords.forEach((seg, i) => {
    if (seg.chord === 'N' || i === 0) return;
    votes[nearestBeat(beats, seg.start) % perBar]++;
  });
  return votes.indexOf(Math.max(...votes));
}

/** Bars of `perBar` beats; the `shift` beats before the first bar line make a pickup bar. Missing beats are null. */
function groupBeats(beats, perBar, shift, duration) {
  const out = [];
  const add = (cells, end) => out.push({ start: firstNumber(cells), beats: [...cells, end] });
  let i = 0;
  if (shift > 0 && beats.length > shift) {
    add([...new Array(perBar - shift).fill(null), ...beats.slice(0, shift)], beats[shift]);
    i = shift;
  }
  while (i < beats.length) {
    const cells = beats.slice(i, i + perBar);
    while (cells.length < perBar) cells.push(null);
    add(cells, beats[i + perBar] === undefined ? duration : beats[i + perBar]);
    i += perBar;
  }
  return out;
}

/** The sections again, on the new bars: each starts at the bar nearest its start time. */
function regroupSections(raw, to) {
  const out = raw.map((sec) => ({ ...sec }));
  let prev = -1;
  out.forEach((sec) => {
    if (sec.startBar === null || sec.startBar === undefined) return;
    let best = 0;
    to.forEach((bar, b) => {
      if (Math.abs(bar.start - sec.start) < Math.abs(to[best].start - sec.start)) best = b;
    });
    sec.startBar = Math.min(Math.max(best, prev + 1), to.length - 1);
    prev = sec.startBar;
  });
  const real = out.filter((sec) => sec.startBar !== null && sec.startBar !== undefined);
  real.forEach((sec, i) => {
    sec.endBar = i + 1 < real.length ? Math.max(real[i + 1].startBar - 1, sec.startBar) : to.length - 1;
  });
  return out;
}

/** Bars, sections, the shift in use and the tempo, from the song's own bars and a meter setting. */
export function applyMeter({ baseBars, baseSections, own, meter, duration, simpleChords, baseTempo }) {
  if (isOwn(meter, own)) return { bars: baseBars, sections: baseSections, shift: 0, perBar: own.perBar, tempo: baseTempo };
  const beats = songBeats(baseBars, own.perBar, meter.pulse, duration);
  const shift = Math.min(meter.shift === null ? chordShift(beats, meter.perBar, simpleChords) : meter.shift, meter.perBar - 1);
  const bars = groupBeats(beats, meter.perBar, shift, duration);
  return { bars, sections: regroupSections(baseSections, bars), shift, perBar: meter.perBar, tempo: baseTempo * meter.pulse };
}

const KEY = 'meter:';

export function loadMeter(sessionId, own) {
  const saved = getJson(KEY + sessionId, null);
  if (
    saved &&
    Number.isInteger(saved.perBar) && saved.perBar >= METER_MIN && saved.perBar <= METER_MAX &&
    (saved.pulse === 1 || saved.pulse === 2) &&
    (saved.shift === null || (Number.isInteger(saved.shift) && saved.shift >= 0 && saved.shift < saved.perBar))
  ) {
    return { perBar: saved.perBar, pulse: saved.pulse, shift: saved.shift };
  }
  return own;
}

export function saveMeter(sessionId, meter, own) {
  setJson(KEY + sessionId, isOwn(meter, own) ? null : meter);
}
