// A chord diagram as SVG (strings, frets, barres, finger numbers) for the guitar (six strings), the ukulele and the mandolin (four), for the
// Toolkit pages, the chord charts, the song pages and the player. The look: a clean light grid under a thick nut, grey fret markers, coloured
// finger dots (one colour per finger, white numbers), a barre as one rounded bar with the finger number on every string it covers, the lowest
// played string picked out in its finger's colour, and the fret the diagram starts at written as "3fr". The Android app draws the same thing
// (mobile/src/components/ChordDiagram.js) with the same colours, so keep the two in step.
import { getGuitarShape, getGuitarShapes, type GuitarShape } from "../chordShapes";

export { getGuitarShape, getGuitarShapes };

/** The colour of each finger's dot: index orange, middle blue, ring green, little red. */
export const FINGER_COLORS: Record<string, string> = { "1": "#f5a31b", "2": "#3b82f6", "3": "#22c55e", "4": "#ef4444" };

interface Options {
  /** Colour of a finger dot that has no finger number (the others use FINGER_COLORS). */
  dot?: string;
  /** Colour of the nut, the open-string rings and the fret number. */
  ink?: string;
  /** Colour of the strings and frets (and of the fret markers). */
  line?: string;
  /** Colour of the finger numbers on the dots. */
  label?: string;
  /** What the drawing is, for people who cannot see it ("C major on guitar"). */
  title?: string;
  /** Crop the empty space above the muted marks and below the last fret (the player's small cards). */
  compact?: boolean;
}

const ROWS = 5;
const FRET_MARK = new Set([3, 5, 7, 9, 15, 17, 19, 21]); // one marker on these frets, two on the 12th and 24th
const FRET_MARK_TWO = new Set([12, 24]);
const R = 6.6; // radius of a finger dot

export function diagramSvg(shape: GuitarShape, options: Options = {}): string {
  const ink = options.ink ?? "var(--dg-ink, #0d001f)";
  const line = options.line ?? "var(--dg-line, #d6d2e2)";
  const mark = options.line ?? "var(--dg-mark, #c9c4d9)";
  const label = options.label ?? "#ffffff";
  const fallback = options.dot ?? "#7c3aed";
  const base = shape.baseFret ?? 1;
  const n = shape.frets.length; // 6 on the guitar, 4 on the ukulele and the mandolin
  const last = n - 1;
  const x = (i: number) => 22 + (i * 76) / last; // string 0 (lowest) .. last, across the same width whatever the count
  const y = (r: number) => 34 + r * 19;
  const rowMid = (row: number) => (y(row - 1) + y(row)) / 2;
  const colour = (finger: string) => FINGER_COLORS[finger] ?? fallback;
  const parts: string[] = [];

  // the grid: fret lines, then strings
  for (let r = 0; r <= ROWS; r++) {
    if (r === 0 && base === 1) continue; // the nut covers the first line
    parts.push(`<line x1="${x(0)}" x2="${x(last)}" y1="${y(r)}" y2="${y(r)}" stroke="${line}" stroke-width="1"/>`);
  }
  for (let i = 0; i < n; i++) parts.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${y(0)}" y2="${y(ROWS)}" stroke="${line}" stroke-width="1.2"/>`);

  // grey markers on the frets a guitar has them (3, 5, 7, 9, 12...), as the inlay dots on a real neck
  const middle = (x(0) + x(last)) / 2;
  const spread = (x(last) - x(0)) / 4;
  for (let row = 1; row <= ROWS; row++) {
    const fret = base + row - 1;
    if (FRET_MARK.has(fret)) parts.push(`<circle cx="${middle}" cy="${rowMid(row)}" r="3" fill="${mark}"/>`);
    else if (FRET_MARK_TWO.has(fret)) parts.push(`<circle cx="${middle - spread}" cy="${rowMid(row)}" r="3" fill="${mark}"/><circle cx="${middle + spread}" cy="${rowMid(row)}" r="3" fill="${mark}"/>`);
  }

  // the nut, or the fret the diagram starts at
  if (base === 1) parts.push(`<rect x="${x(0) - 1.6}" y="30.5" width="${x(last) - x(0) + 3.2}" height="5" rx="1.6" fill="${ink}"/>`);
  else parts.push(`<text x="1.5" y="${rowMid(1) + 3.2}" font-size="9.5" font-weight="700" fill="${ink}" opacity="0.66" font-family="inherit">${base}fr</text>`);

  // muted and open strings above the nut
  shape.frets.forEach((fret, i) => {
    if (fret === "x") parts.push(`<path d="M${x(i) - 3.1} 20.9l6.2 6.2m0 -6.2l-6.2 6.2" stroke="var(--dg-x, #77737f)" stroke-width="1.5" stroke-linecap="round"/>`);
    else if (fret === "0") parts.push(`<circle cx="${x(i)}" cy="24" r="3.4" fill="none" stroke="${ink}" stroke-width="1.4"/>`);
  });

  // the pressed strings; the same finger on the same fret across strings is one barre
  const pressed = shape.frets
    .map((fret, i) => ({ string: i, row: parseInt(fret, 10) - base + 1, finger: shape.fingers[i] || "" }))
    .filter((p) => Number.isFinite(p.row) && p.row >= 1 && p.row <= ROWS);

  // the lowest string that sounds, when a finger holds it, is drawn in that finger's colour all the way down: it is the bass note
  const bass = shape.frets.findIndex((fret) => fret !== "x");
  const bassPress = pressed.find((p) => p.string === bass);
  if (bassPress && bassPress.finger) parts.push(`<line x1="${x(bass)}" x2="${x(bass)}" y1="${y(0)}" y2="${y(ROWS)}" stroke="${colour(bassPress.finger)}" stroke-width="2.6" stroke-linecap="round"/>`);

  const barred = new Set<number>();
  const groups = new Map<string, typeof pressed>();
  for (const p of pressed) if (p.finger) groups.set(`${p.row}:${p.finger}`, [...(groups.get(`${p.row}:${p.finger}`) ?? []), p]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const from = Math.min(...group.map((p) => p.string));
    const to = Math.max(...group.map((p) => p.string));
    const cy = rowMid(group[0].row);
    parts.push(`<rect x="${x(from) - R}" y="${cy - R}" width="${x(to) - x(from) + 2 * R}" height="${2 * R}" rx="${R}" fill="${colour(group[0].finger)}"/>`);
    for (const p of group) parts.push(`<text x="${x(p.string)}" y="${cy + 3.4}" font-size="9.5" font-weight="700" fill="${label}" text-anchor="middle" font-family="inherit">${group[0].finger}</text>`);
    group.forEach((p) => barred.add(p.string));
  }
  for (const p of pressed) {
    if (barred.has(p.string)) continue;
    const cy = rowMid(p.row);
    parts.push(`<circle cx="${x(p.string)}" cy="${cy}" r="${R}" fill="${colour(p.finger)}"/>`);
    if (p.finger) parts.push(`<text x="${x(p.string)}" y="${cy + 3.4}" font-size="9.5" font-weight="700" fill="${label}" text-anchor="middle" font-family="inherit">${p.finger}</text>`);
  }
  return `<svg viewBox="${options.compact ? "0 18 120 114" : "0 0 120 138"}" role="img" aria-label="${(options.title ?? "Chord diagram").replace(/"/g, "")}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
