// A guitar chord diagram as SVG (strings, frets, barres, finger numbers), for the Toolkit pages.
import { getGuitarShape, getGuitarShapes, type GuitarShape } from "../chordShapes";

export { getGuitarShape, getGuitarShapes };

interface Options {
  /** Colour of the finger dots. */
  dot?: string;
  /** Colour of the lines and markers. */
  ink?: string;
  /** Colour of the strings and frets. */
  line?: string;
  /** Colour of the finger numbers on the dots. */
  label?: string;
}

const ROWS = 5;

export function diagramSvg(shape: GuitarShape, options: Options = {}): string {
  const dot = options.dot ?? "#7c3aed";
  const ink = options.ink ?? "#0d001f";
  const line = options.line ?? "#c4b0e0";
  const label = options.label ?? "#ffffff";
  const base = shape.baseFret ?? 1;
  const x = (i: number) => 22 + i * 15.2; // string 0 (lowest) .. 5
  const y = (r: number) => 34 + r * 19;
  const parts: string[] = [];

  // the nut, or the number of the first fret shown
  parts.push(base === 1 ? `<rect x="${x(0) - 1}" y="31" width="${x(5) - x(0) + 2}" height="4.5" rx="1" fill="${ink}"/>` : `<text x="6" y="${y(0) + 14}" font-size="10" font-weight="700" fill="${ink}" font-family="inherit">${base}</text>`);
  for (let r = 0; r <= ROWS; r++) parts.push(`<line x1="${x(0)}" x2="${x(5)}" y1="${y(r)}" y2="${y(r)}" stroke="${line}" stroke-width="${r === 0 && base === 1 ? 0 : 1}"/>`);
  for (let i = 0; i < 6; i++) parts.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${y(0)}" y2="${y(ROWS)}" stroke="${line}" stroke-width="${1 + (5 - i) * 0.05}"/>`);

  // open and muted strings above the nut
  shape.frets.forEach((fret, i) => {
    if (fret === "x") parts.push(`<path d="M${x(i) - 3.2} 20.8l6.4 6.4m0 -6.4l-6.4 6.4" stroke="#dc2626" stroke-width="1.6" stroke-linecap="round"/>`);
    else if (fret === "0") parts.push(`<circle cx="${x(i)}" cy="24" r="3.6" fill="none" stroke="${ink}" stroke-width="1.5"/>`);
  });

  // the pressed strings; the same finger on the same fret across strings is one barre
  const pressed = shape.frets
    .map((fret, i) => ({ string: i, row: parseInt(fret, 10) - base + 1, finger: shape.fingers[i] || "" }))
    .filter((p) => Number.isFinite(p.row) && p.row >= 1 && p.row <= ROWS);
  const barred = new Set<number>();
  const groups = new Map<string, typeof pressed>();
  for (const p of pressed) if (p.finger) groups.set(`${p.row}:${p.finger}`, [...(groups.get(`${p.row}:${p.finger}`) ?? []), p]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const from = Math.min(...group.map((p) => p.string));
    const to = Math.max(...group.map((p) => p.string));
    const cy = (y(group[0].row - 1) + y(group[0].row)) / 2;
    parts.push(`<rect x="${x(from) - 5}" y="${cy - 5.2}" width="${x(to) - x(from) + 10}" height="10.4" rx="5.2" fill="${dot}"/>`);
    parts.push(`<text x="${(x(from) + x(to)) / 2}" y="${cy + 3.6}" font-size="9.5" font-weight="700" fill="${label}" text-anchor="middle" font-family="inherit">${group[0].finger}</text>`);
    group.forEach((p) => barred.add(p.string));
  }
  for (const p of pressed) {
    if (barred.has(p.string)) continue;
    const cy = (y(p.row - 1) + y(p.row)) / 2;
    parts.push(`<circle cx="${x(p.string)}" cy="${cy}" r="6" fill="${dot}"/>`);
    if (p.finger) parts.push(`<text x="${x(p.string)}" y="${cy + 3.5}" font-size="9.5" font-weight="700" fill="${label}" text-anchor="middle" font-family="inherit">${p.finger}</text>`);
  }
  return `<svg viewBox="0 0 120 138" role="img" aria-label="Guitar chord diagram" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
