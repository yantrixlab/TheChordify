import { getGuitarShapes, getUkuleleShapes } from 'chordsuno-shared/chordShapes';

const cache = new Map();

/** The usual fingering of a chord on the guitar or the ukulele (null for a rest or a name with no shape). The same code as the website. */
export function shapeFor(instrument, chord) {
  if (!chord || chord === 'N') return null;
  const key = `${instrument}:${chord}`;
  if (cache.has(key)) return cache.get(key);
  let shape = null;
  try {
    const list = instrument === 'ukulele' ? getUkuleleShapes(chord) : getGuitarShapes(chord);
    shape = list[0] || null;
  } catch {
    shape = null;
  }
  cache.set(key, shape);
  return shape;
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
