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

/** Coordinates are written with at most two decimals: every diagram is a page of numbers, so the digits add up. */
const n2 = (v: number) => String(Math.round(v * 100) / 100);

// The shapes that repeat in every diagram share one attribute: the grid is two paths (the frets, then the strings) inside one group, the
// fret markers and open-string rings are groups, every muted string is one path, and the finger numbers are one group of plain texts. That
// is about half the markup of drawing each line, circle and number with its own colour and width, and it draws the same picture.
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
  const numbers: string[] = []; // the finger numbers, drawn last so they sit on top of the dots

  // the grid: fret lines (not the first when the nut covers it), then strings
  let frets = "";
  for (let r = 0; r <= ROWS; r++) {
    if (r === 0 && base === 1) continue;
    frets += `M${n2(x(0))} ${y(r)}H${n2(x(last))}`;
  }
  let strings = "";
  for (let i = 0; i < n; i++) strings += `M${n2(x(i))} ${y(0)}V${y(ROWS)}`;
  parts.push(`<g fill="none" stroke="${line}"><path stroke-width="1" d="${frets}"/><path stroke-width="1.2" d="${strings}"/></g>`);

  // grey markers on the frets a guitar has them (3, 5, 7, 9, 12...), as the inlay dots on a real neck
  const middle = (x(0) + x(last)) / 2;
  const spread = (x(last) - x(0)) / 4;
  let dots = "";
  for (let row = 1; row <= ROWS; row++) {
    const fret = base + row - 1;
    if (FRET_MARK.has(fret)) dots += `<circle cx="${n2(middle)}" cy="${n2(rowMid(row))}" r="3"/>`;
    else if (FRET_MARK_TWO.has(fret)) dots += `<circle cx="${n2(middle - spread)}" cy="${n2(rowMid(row))}" r="3"/><circle cx="${n2(middle + spread)}" cy="${n2(rowMid(row))}" r="3"/>`;
  }
  if (dots) parts.push(`<g fill="${mark}">${dots}</g>`);

  // the nut, or the fret the diagram starts at
  if (base === 1) parts.push(`<rect x="${n2(x(0) - 1.6)}" y="30.5" width="${n2(x(last) - x(0) + 3.2)}" height="5" rx="1.6" fill="${ink}"/>`);
  else parts.push(`<text x="1.5" y="${n2(rowMid(1) + 3.2)}" font-size="9.5" font-weight="700" fill="${ink}" opacity="0.66" font-family="inherit">${base}fr</text>`);

  // muted strings (one path) and open strings (rings) above the nut
  let crosses = "";
  let rings = "";
  shape.frets.forEach((fret, i) => {
    if (fret === "x") crosses += `M${n2(x(i) - 3.1)} 20.9l6.2 6.2m0 -6.2l-6.2 6.2`;
    else if (fret === "0") rings += `<circle cx="${n2(x(i))}" cy="24" r="3.4"/>`;
  });
  if (crosses) parts.push(`<path d="${crosses}" fill="none" stroke="var(--dg-x, #77737f)" stroke-width="1.5" stroke-linecap="round"/>`);
  if (rings) parts.push(`<g fill="none" stroke="${ink}" stroke-width="1.4">${rings}</g>`);

  // the pressed strings; the same finger on the same fret across strings is one barre
  const pressed = shape.frets
    .map((fret, i) => ({ string: i, row: parseInt(fret, 10) - base + 1, finger: shape.fingers[i] || "" }))
    .filter((p) => Number.isFinite(p.row) && p.row >= 1 && p.row <= ROWS);

  // the lowest string that sounds, when a finger holds it, is drawn in that finger's colour all the way down: it is the bass note
  const bass = shape.frets.findIndex((fret) => fret !== "x");
  const bassPress = pressed.find((p) => p.string === bass);
  if (bassPress && bassPress.finger) parts.push(`<path d="M${n2(x(bass))} ${y(0)}V${y(ROWS)}" stroke="${colour(bassPress.finger)}" stroke-width="2.6" stroke-linecap="round"/>`);

  const barred = new Set<number>();
  const groups = new Map<string, typeof pressed>();
  for (const p of pressed) if (p.finger) groups.set(`${p.row}:${p.finger}`, [...(groups.get(`${p.row}:${p.finger}`) ?? []), p]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const from = Math.min(...group.map((p) => p.string));
    const to = Math.max(...group.map((p) => p.string));
    const cy = rowMid(group[0].row);
    parts.push(`<rect x="${n2(x(from) - R)}" y="${n2(cy - R)}" width="${n2(x(to) - x(from) + 2 * R)}" height="${2 * R}" rx="${R}" fill="${colour(group[0].finger)}"/>`);
    for (const p of group) numbers.push(`<text x="${n2(x(p.string))}" y="${n2(cy + 3.4)}">${group[0].finger}</text>`);
    group.forEach((p) => barred.add(p.string));
  }
  for (const p of pressed) {
    if (barred.has(p.string)) continue;
    const cy = rowMid(p.row);
    parts.push(`<circle cx="${n2(x(p.string))}" cy="${n2(cy)}" r="${R}" fill="${colour(p.finger)}"/>`);
    if (p.finger) numbers.push(`<text x="${n2(x(p.string))}" y="${n2(cy + 3.4)}">${p.finger}</text>`);
  }
  if (numbers.length) parts.push(`<g font-size="9.5" font-weight="700" fill="${label}" text-anchor="middle" font-family="inherit">${numbers.join("")}</g>`);
  return `<svg viewBox="${options.compact ? "0 18 120 114" : "0 0 120 138"}" role="img" aria-label="${(options.title ?? "Chord diagram").replace(/"/g, "")}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
