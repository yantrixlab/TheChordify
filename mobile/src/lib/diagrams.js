import { useSyncExternalStore } from 'react';
import { getGuitarShapes, getUkuleleShapes, transposeChord } from 'chordsuno-shared/chordShapes';
import { getJson, setJson } from './storage';

export { transposeChord };

const shapeCache = new Map();

/** Every way of fingering a chord on the guitar or the ukulele (the usual one first). The same code as the website. */
export function shapesFor(instrument, chord) {
  if (!chord || chord === 'N') return [];
  const key = `${instrument}:${chord}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let list = [];
  try {
    list = (instrument === 'ukulele' ? getUkuleleShapes(chord) : getGuitarShapes(chord)) || [];
  } catch {
    list = [];
  }
  shapeCache.set(key, list);
  return list;
}

// The way a player picks to play a chord (0 = the usual one) is used for that chord everywhere, and kept for next time.
// The ukulele's choices are kept apart from the guitar's.
const PICKS = 'voicings-v1';
let picks = getJson(PICKS, {}) || {};
const listeners = new Set();
const pickKey = (instrument, chord) => (instrument === 'ukulele' ? `u:${chord}` : chord);

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

/** The fingering to show for a chord and which of its choices that is: { shape, index, count } (null when there is none). */
export function choiceFor(instrument, chord, current = picks) {
  const shapes = shapesFor(instrument, chord);
  if (shapes.length === 0) return null;
  const index = Math.min(Math.max(Number(current[pickKey(instrument, chord)]) || 0, 0), shapes.length - 1);
  return { shape: shapes[index], index, count: shapes.length };
}

/** Moves a chord to its next (or previous) way of playing, everywhere it appears. */
export function stepPick(instrument, chord, delta) {
  const count = shapesFor(instrument, chord).length;
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
