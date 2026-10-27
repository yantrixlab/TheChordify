// The chord chart: bars of beat cells with a chord written in each cell where it changes. This is the website player's logic
// (play.astro: trimPickup, placeChordsOnBeats, placeChordsWithRests) so a song reads the same on both.
import { applyMeter, ownMeter } from './meter';

export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function firstNumber(values) {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return null;
}

/** A song that starts part-way through a bar has beats that come before the music; they pile up at 0:00 and are left empty. */
export function trimPickup(all) {
  if (all.length === 0) return all;
  const first = all[0].beats.slice();
  let trimmed = 0;
  while (
    trimmed < first.length - 1 &&
    first[trimmed] !== null &&
    first[trimmed] <= 1e-9 &&
    Math.max(0, ...first.slice(trimmed + 1).map((t) => t || 0)) > 1e-9
  ) {
    first[trimmed] = null;
    trimmed++;
  }
  if (trimmed === 0) return all;
  const start = firstNumber(first) ?? all[0].start;
  return [{ ...all[0], start, beats: first }, ...all.slice(1)];
}

/** The chord written in each beat cell as [bar][beat]: a name, "N" for a rest, or null while the last chord keeps ringing. */
function placeChordsOnBeats(chords, bars, perBar, duration, pulse) {
  const firstSound = chords.findIndex((seg) => seg.chord !== 'N');
  const placed = chords
    .filter((seg, i) => seg.gridStart !== null && !(seg.chord === 'N' && i < firstSound))
    .map((seg) => ({ chord: seg.chord, start: pulse === 1 ? (seg.gridStart ?? seg.start) : seg.start }));
  let next = 0;
  let seenBeat = false;
  return bars.map((bar) =>
    Array.from({ length: perBar }, (_, k) => {
      const t0 = bar.beats[k];
      if (t0 === null || t0 === undefined) return null;
      const t1 = firstNumber(bar.beats.slice(k + 1)) ?? duration;
      const half = Math.max(t1 - t0, 0.05) / 2;
      if (seenBeat) while (next < placed.length && placed[next].start < t0 - half) next++;
      seenBeat = true;
      return next < placed.length && placed[next].start < t0 + half ? placed[next++].chord : null;
    }),
  );
}

/** The same with the rest sign on every beat of a pause (a long silence shows for two bars at most). */
function placeChordsWithRests(chords, bars, perBar, duration, pulse) {
  const written = placeChordsOnBeats(chords, bars, perBar, duration, pulse);
  let resting = false;
  let run = 0;
  const limit = perBar * 2;
  return written.map((beats, b) =>
    beats.map((chord, k) => {
      const t = bars[b] && bars[b].beats[k];
      if (t === null || t === undefined) return chord;
      if (chord === 'N') {
        resting = true;
        run = 1;
        return chord;
      }
      if (chord) {
        resting = false;
        return chord;
      }
      if (resting && run < limit) {
        run++;
        return 'N';
      }
      return chord;
    }),
  );
}

/**
 * Everything the player needs from a result, worked out once:
 *   rows     one per bar: { key, bar, beats: [time|null], chords: [name|null], label }  (label: the song part that starts here)
 *   cells    every cell that has a beat, in time order: { t, row, k }: what the playing position is looked up in
 *   perBar   beats to a bar
 */
export function buildChart(result, detailed = false, meter = null) {
  const baseBars = trimPickup(result.bars || []);
  const own = ownMeter(baseBars, result);
  const duration = result.duration || 0;
  // the beats as the song counts them, or regrouped with the bar length the player set
  const { bars, sections, perBar, tempo, shift } = applyMeter({
    baseBars,
    baseSections: result.sections || [],
    own,
    meter: meter || own,
    duration,
    simpleChords: result.chords || [],
    baseTempo: result.tempo || 120,
  });
  // the simple chords (major and minor), or every kind the detector heard (7ths, sus, slash chords)
  const chords = (detailed && result.chordsDetailed) || result.chords || [];
  const pulse = (meter || own).pulse;
  const written = placeChordsWithRests(chords, bars, perBar, duration, pulse);
  const plain = placeChordsOnBeats(chords, bars, perBar, duration, pulse); // without the rest sign on every beat of a pause: what the exports write
  const labelAt = new Map();
  for (const section of sections) {
    if (section.startBar !== null && section.startBar !== undefined && !labelAt.has(section.startBar)) labelAt.set(section.startBar, section.label);
  }
  const rows = bars.map((bar, i) => ({
    key: String(i),
    bar: i,
    beats: Array.from({ length: perBar }, (_, k) => (bar.beats[k] === undefined ? null : bar.beats[k])),
    chords: written[i],
    label: labelAt.get(i) || '',
  }));
  const cells = [];
  rows.forEach((row, r) =>
    row.beats.forEach((t, k) => {
      if (t !== null) cells.push({ t, row: r, k });
    }),
  );
  return { rows, cells, perBar, own, tempo, shift, sections, bars, plain, chords };
}

/** The index in `cells` playing at `time`: the last cell whose beat has started. -1 before the first. */
export function cellAt(cells, time) {
  let lo = 0;
  let hi = cells.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cells[mid].t <= time + 0.03) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The chord sounding in the cell at `index`, and the next one to come: [now, next] (names; "N" is a rest). */
export function chordsFrom(chart, index) {
  const { rows, cells } = chart;
  let now = '';
  let next = '';
  for (let i = index; i >= 0; i--) {
    const c = cells[i];
    const name = rows[c.row].chords[c.k];
    if (name) {
      now = name;
      break;
    }
  }
  for (let i = Math.max(index + 1, 0); i < cells.length; i++) {
    const c = cells[i];
    const name = rows[c.row].chords[c.k];
    if (name && name !== now) {
      next = name;
      break;
    }
  }
  return [now, next];
}
