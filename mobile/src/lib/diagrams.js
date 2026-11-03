import { useSyncExternalStore } from 'react';
import { chordDrawing, transposeChord } from 'chordsuno-shared/chordShapes';
import { getJson, setJson } from './storage';

export { transposeChord };

const shapeCache = new Map();

/**
 * Every way of playing a chord on an instrument, the usual one first: [{ kind: 'frets', shape }] for the guitar, ukulele and mandolin,
 * [{ kind: 'keys', voicing }] for the piano. The same code as the website.
 */
export function waysFor(instrument, chord) {
  if (!chord || chord === 'N') return [];
  const key = `${instrument}:${chord}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let list = [];
  try {
    const drawing = chordDrawing(instrument, chord);
    list = drawing.kind === 'keys' ? drawing.voicings.map((voicing) => ({ kind: 'keys', voicing })) : drawing.shapes.map((shape) => ({ kind: 'frets', shape }));
  } catch {
    list = [];
  }
  shapeCache.set(key, list);
  return list;
}

/** The fret fingerings of a chord (guitar, ukulele or mandolin); none for the piano. */
export function shapesFor(instrument, chord) {
  return waysFor(instrument, chord).filter((way) => way.kind === 'frets').map((way) => way.shape);
}

// The way a player picks to play a chord (0 = the usual one) is used for that chord everywhere, and kept for next time.
// Each instrument's choices are kept apart ("u:" ukulele, "m:" mandolin, "p:" piano; the guitar's are under the chord's own name).
const PICKS = 'voicings-v1';
let picks = getJson(PICKS, {}) || {};
const listeners = new Set();
const pickKey = (instrument, chord) => (instrument === 'guitar' ? chord : `${instrument[0]}:${chord}`);

/** Re-draws whoever uses it when a chord's chosen fingering changes. */
export function usePicks() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => picks,
  );
}

/** The way of playing to show for a chord and which of its choices that is: { way, index, count } (null when there is none). */
export function choiceFor(instrument, chord, current = picks) {
  const ways = waysFor(instrument, chord);
  if (ways.length === 0) return null;
  const index = Math.min(Math.max(Number(current[pickKey(instrument, chord)]) || 0, 0), ways.length - 1);
  return { way: ways[index], index, count: ways.length };
}

/** Moves a chord to its next (or previous) way of playing, everywhere it appears. */
export function stepPick(instrument, chord, delta) {
  const count = waysFor(instrument, chord).length;
  if (count < 2) return;
  const key = pickKey(instrument, chord);
  const next = ((Number(picks[key]) || 0) + delta + count) % count;
  picks = { ...picks };
  if (next === 0) delete picks[key];
  else picks[key] = next;
  setJson(PICKS, picks);
  listeners.forEach((fn) => fn());
}

/** The chords written in the chart, one per change and in order: [{ chord, cell }], and for every beat cell the entry sounding in it. */
export function chordSequence(chart) {
  const sequence = [];
  const at = new Array(chart.cells.length);
  chart.cells.forEach((cell, i) => {
    const name = chart.rows[cell.row].chords[cell.k];
    if (name) sequence.push({ chord: name, cell: i });
    at[i] = Math.max(0, sequence.length - 1);
  });
  return { sequence, at };
}

/** Every chord that is played, most used first: [{ chord, count }]. */
export function chordsUsed(sequence) {
  const counts = new Map();
  for (const { chord } of sequence) if (chord !== 'N') counts.set(chord, (counts.get(chord) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([chord, count]) => ({ chord, count }));
}
