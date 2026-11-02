// The editing logic of the song editor (admin): which chord sits in which beat cell, and the changes an editor makes to a chord list.
// No page code in here, so it can be tested on its own. The server checks everything again when a song is saved (backend/app/songedit.py).
//
// A song's chords are segments with times. A segment shows in the beat cell nearest its gridStart (else its start); moving a chord to
// another cell means giving it that cell's time, and every change keeps the segments in order, each one running into the next.

export interface Seg {
  start: number;
  end: number;
  chord: string;
  confidence: number;
  gridStart: number | null;
  edited?: boolean;
}

export interface Bar {
  start: number;
  beats: (number | null)[]; // `perBar` beat times, then where the next bar starts; null where a bar has no beat (a pickup, a short last bar)
}

export interface Cell {
  bar: number;
  beat: number;
  time: number | null; // when the beat is (null: no beat here)
  seg: number | null; // the index of the chord written in this cell
}

const MIN_GAP = 0.03; // seconds: a chord and the one it splits are never closer than this

const firstNumber = (values: (number | null)[]): number | null => values.find((v) => v !== null && v !== undefined) ?? null;

/** Which chord is written in each beat cell, as [bar][beat]. The same placement the website and the app use to draw the chart. */
export function place(segs: Seg[], bars: Bar[], perBar: number, duration: number): Cell[][] {
  const firstSound = segs.findIndex((s) => s.chord !== "N");
  const placed = segs
    .map((s, i) => ({ i, s }))
    .filter(({ s, i }) => s.gridStart !== null && !(s.chord === "N" && i < firstSound)) // nothing sounds before the song starts
    .map(({ i, s }) => ({ i, start: s.gridStart ?? s.start }));
  let next = 0;
  let seenBeat = false;
  return bars.map((bar, b) =>
    Array.from({ length: perBar }, (_, k): Cell => {
      const t0 = bar.beats[k];
      if (t0 === null || t0 === undefined) return { bar: b, beat: k, time: null, seg: null };
      const t1 = firstNumber(bar.beats.slice(k + 1)) ?? duration;
      const half = Math.max(t1 - t0, 0.05) / 2;
      if (seenBeat) while (next < placed.length && placed[next].start < t0 - half) next++;
      seenBeat = true;
      const seg = next < placed.length && placed[next].start < t0 + half ? placed[next++].i : null;
      return { bar: b, beat: k, time: t0, seg };
    }),
  );
}

/** The chord shown in each cell, flattened in order: [{bar, beat, time, chord | null}]. */
export function flat(segs: Seg[], cells: Cell[][]): { bar: number; beat: number; time: number | null; chord: string | null }[] {
  return cells.flat().map((c) => ({ bar: c.bar, beat: c.beat, time: c.time, chord: c.seg === null ? null : segs[c.seg].chord }));
}

const clone = (segs: Seg[]): Seg[] => segs.map((s) => ({ ...s }));

/** Gives a chord to the cell at `time`: the chord that is ringing there is split, the new one running to where it ended. */
function insertAt(list: Seg[], cellTime: number, chord: string, confidence: number): Seg[] {
  let j = list.findIndex((s) => s.start <= cellTime && cellTime < s.end);
  if (j < 0) j = Math.max(0, list.findIndex((s) => s.start > cellTime) - 1);
  if (j < 0) j = list.length - 1;
  const host = list[j];
  const start = Math.max(cellTime, host.start + MIN_GAP); // never on top of the start of the chord it splits
  const end = Math.max(host.end, start + MIN_GAP);
  list.splice(j + 1, 0, { start, end, chord, confidence, gridStart: cellTime, edited: true });
  host.end = start;
  return list;
}

/** Takes a chord out: the one before it rings on to where it ended. The first chord of a song becomes a rest instead, so the start stays covered. */
function removeSeg(list: Seg[], index: number): Seg[] {
  if (index <= 0) {
    list[0] = { ...list[0], chord: "N", edited: true };
    return list;
  }
  list[index - 1].end = list[index].end;
  list.splice(index, 1);
  return list;
}

/** Writes `chord` in the cell: renames the chord there, or adds one. Returns a new list (the one given is left alone). */
export function setChord(segs: Seg[], cells: Cell[][], bar: number, beat: number, chord: string): Seg[] {
  const cell = cells[bar]?.[beat];
  if (!cell || cell.time === null) return segs;
  const list = clone(segs);
  if (cell.seg !== null) {
    if (list[cell.seg].chord === chord) return segs;
    list[cell.seg].chord = chord;
    list[cell.seg].edited = true;
    return list;
  }
  return insertAt(list, cell.time, chord, 1);
}

/** Clears the cell's chord (the one before it carries on). */
export function clearChord(segs: Seg[], cells: Cell[][], bar: number, beat: number): Seg[] {
  const cell = cells[bar]?.[beat];
  if (!cell || cell.seg === null) return segs;
  return removeSeg(clone(segs), cell.seg);
}

/** Moves the chord of one cell to another: an empty target gets the chord and the source is cleared; a target that has a chord swaps with it. */
export function moveChord(segs: Seg[], cells: Cell[][], from: [number, number], to: [number, number]): Seg[] {
  const a = cells[from[0]]?.[from[1]];
  const b = cells[to[0]]?.[to[1]];
  if (!a || !b || a.seg === null || b.time === null || (a.bar === b.bar && a.beat === b.beat)) return segs;
  const list = clone(segs);
  if (b.seg !== null) {
    const keep = list[a.seg].chord;
    list[a.seg] = { ...list[a.seg], chord: list[b.seg].chord, edited: true };
    list[b.seg] = { ...list[b.seg], chord: keep, edited: true };
    return list;
  }
  const moving = list[a.seg];
  const chord = moving.chord;
  const confidence = moving.confidence;
  removeSeg(list, a.seg);
  return insertAt(list, b.time, chord, confidence);
}

/** Copies the chord of one cell into another (an existing chord there is replaced). */
export function copyChord(segs: Seg[], cells: Cell[][], from: [number, number], to: [number, number]): Seg[] {
  const a = cells[from[0]]?.[from[1]];
  if (!a || a.seg === null) return segs;
  return setChord(segs, cells, to[0], to[1], segs[a.seg].chord);
}

// ---------------------------------------------------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------------------------------------------------

const FLATS: Record<string, string> = { Bb: "A#", Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Cb: "B", Fb: "E" };
const NOTE = /^([A-G])(#|b)?/;
const SUFFIX = /^[A-Za-z0-9+#()°ø-]{0,10}$/;

/** A chord name as the detector writes it (sharps; "N" for a rest), or null when it is not a chord name. */
export function normalizeChord(raw: string): string | null {
  const text = raw.trim();
  if (/^(n|rest)$/i.test(text) || text === "𝄽") return "N";
  if (!text || text.length > 16) return null;
  const [body, bass, ...extra] = text.split("/");
  if (extra.length) return null;
  const m = NOTE.exec(body);
  if (!m) return null;
  const rest = body.slice(m[0].length);
  if (!SUFFIX.test(rest)) return null;
  let name = (FLATS[m[0]] ?? m[0]) + rest;
  if (bass !== undefined) {
    const b = NOTE.exec(bass);
    if (!b || bass.length !== b[0].length) return null;
    name += "/" + (FLATS[b[0]] ?? b[0]);
  }
  return name;
}

/** The plain chord for a detailed one ("F#m7/C#" -> "F#m", "Cmaj7" -> "C"), as the simple list writes chords. */
export function simplify(chord: string): string {
  if (chord === "N") return "N";
  const m = /^([A-G]#?)(m(?!aj))?/.exec(chord.split("/")[0]);
  return m ? m[1] + (m[2] ? "m" : "") : chord;
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The chords of a key, for quick picking: "C" -> C Dm Em F G Am Bdim, "Am" -> Am Bdim C Dm Em F G. */
export function keyChords(key: string): string[] {
  const m = /^([A-G]#?)(m)?$/.exec((key || "").trim());
  if (!m) return [];
  const tonic = SHARPS.indexOf(m[1]);
  const minor = !!m[2];
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const kinds = minor ? ["m", "dim", "", "m", "m", "", ""] : ["", "m", "m", "", "", "m", "dim"];
  return steps.map((s, i) => SHARPS[(tonic + s) % 12] + kinds[i]);
}

/** The chords a song uses, the most used first: [["C", 14], ["G", 9], ...] (rests left out). */
export function used(segs: Seg[]): [string, number][] {
  const count = new Map<string, number>();
  for (const s of segs) if (s.chord !== "N") count.set(s.chord, (count.get(s.chord) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]);
}

/** How many cells show a different chord from the original: what "unsaved changes" counts. */
export function differences(original: Seg[], current: Seg[], bars: Bar[], perBar: number, duration: number): number {
  const a = flat(original, place(original, bars, perBar, duration));
  const b = flat(current, place(current, bars, perBar, duration));
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i].chord !== b[i].chord) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// strumming
// ---------------------------------------------------------------------------------------------------------------------

export type Stroke = "D" | "U" | "-";

/** The next stroke when a slot is clicked: down, up, nothing, down... */
export const nextStroke = (s: Stroke): Stroke => (s === "D" ? "U" : s === "U" ? "-" : "D");

/** The same pattern at the other resolution: eighths (2 a beat) to sixteenths (4 a beat) spreads the strokes out, the other way keeps the ones on the eighths. */
export function resample(pattern: Stroke[], from: 2 | 4, to: 2 | 4): Stroke[] {
  if (from === to) return pattern;
  if (to === 4) return pattern.flatMap((s) => [s, "-" as Stroke]);
  return pattern.filter((_, i) => i % 2 === 0);
}

/** A beat's slot names for the screen: eighths "1 & 2 &", sixteenths "1 e & a". */
export const slotNames = (sub: 2 | 4): string[] => (sub === 2 ? ["", "&"] : ["", "e", "&", "a"]);

export function defaultPattern(perBar: number, sub: 2 | 4): Stroke[] {
  const base: Stroke[] = ["D", "-", "D", "U", "-", "U", "D", "U"];
  const out: Stroke[] = [];
  for (let i = 0; i < perBar * 2; i++) out.push(base[i % base.length]);
  return resample(out, 2, sub);
}
