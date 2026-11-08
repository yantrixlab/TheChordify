// Where everything sits on the tuner's board: the guitar's headstock picture, the round buttons for the strings, the string lines to light up and the
// marker on the nut. The board is a fixed drawing 700 units wide; the page scales it to the screen, so every position here is in those units.
//
// The pictures are the acoustic and electric headstocks in /public/tuner. The posts, tuners and nut below were measured on them (in the pictures' own
// pixels) and then moved onto the board.

import { noteLabel, midiFromName, type Instrument, type Tuning } from "./pitch";

export const BOARD_W = 700;
export const AXIS_X = 350; // the line down the middle of the board, over the middle of the nut
export const GAUGE_Y = 78; // where the pitch bubble sits (it slides left and right along this height)
export const HEAD_TOP = 205; // where a headstock picture starts

export type HeadKind = "acoustic" | "electric" | "generic" | "none";

export interface Point {
  x: number;
  y: number;
}

/** One string of the instrument, lowest first. */
export interface StringSpot {
  button: Point; // the round button with the note's letter
  post: Point; // where the string leaves the tuner
  nut: Point; // where it crosses the nut
  peg: Point; // the tuner's knob, to light up
}

export interface Layout {
  kind: HeadKind;
  height: number; // the board's height in units
  nutY: number;
  /** Where the line down the middle of the board stops: it runs from the top of the board down to the headstock, and a little under it. */
  lineEnd: number;
  picture?: { avif?: string; webp: string; x: number; y: number; w: number; h: number; label: string };
  /** For a drawn headstock: SVG to put on the board (an instrument with no picture). */
  drawn?: string;
  strings: StringSpot[];
}

// ---- the two guitar pictures -------------------------------------------------------------------------------------------

const move = (dx: number, dy: number, p: Point): Point => ({ x: p.x + dx, y: p.y + dy });

// the acoustic picture (acoustic-guitar.webp) is 822 x 1495 pixels, drawn 411 x 747.5 units; its nut centre is at x = 205.5, so it is put at
// x = 144.5 to bring that onto the board's axis. The positions below were measured on it, in the picture's own units (pixels / 2).
const ACOUSTIC = { dx: AXIS_X - 205.5, dy: HEAD_TOP, w: 411, h: 747.5, cropAt: 668 };
// each string's line was fitted to the string in the picture: where it leaves its pin and where it crosses the nut
const ACOUSTIC_STRINGS: { post: Point; nut: Point; peg: Point; side: "left" | "right" }[] = [
  { post: { x: 122.3, y: 364 }, nut: { x: 146.3, y: 572.5 }, peg: { x: 31, y: 365 }, side: "left" }, // E2
  { post: { x: 124.8, y: 254 }, nut: { x: 168, y: 572.5 }, peg: { x: 35, y: 258.5 }, side: "left" }, // A2
  { post: { x: 123, y: 142.5 }, nut: { x: 191.2, y: 572.5 }, peg: { x: 30, y: 154 }, side: "left" }, // D3
  { post: { x: 287.9, y: 140.5 }, nut: { x: 222.3, y: 572.5 }, peg: { x: 381, y: 154 }, side: "right" }, // G3
  { post: { x: 286, y: 253.5 }, nut: { x: 246.1, y: 572.5 }, peg: { x: 376, y: 257.5 }, side: "right" }, // B3
  { post: { x: 290.3, y: 363.5 }, nut: { x: 267.4, y: 572.5 }, peg: { x: 382.5, y: 365 }, side: "right" }, // E4
];

// the electric picture (electric-guitar.webp) is 668 x 1497 pixels, drawn 334 x 748.5 units, with all six tuners on one side. It is put so that the
// middle of its nut (x = 163.4) is on the board's axis. Positions were measured on it (pixels / 2); each string's line was fitted to the string.
const ELECTRIC = { dx: AXIS_X - 163.4, dy: HEAD_TOP, w: 334, h: 748.5, cropAt: 660 };
const ELECTRIC_STRINGS: { post: Point; nut: Point; peg: Point }[] = [
  { post: { x: 104, y: 447.5 }, nut: { x: 111.5, y: 575 }, peg: { x: 32.5, y: 421 } }, // E2
  { post: { x: 125, y: 376 }, nut: { x: 131.7, y: 575 }, peg: { x: 54, y: 352.5 } }, // A2
  { post: { x: 146.8, y: 306 }, nut: { x: 152, y: 575 }, peg: { x: 75, y: 283.5 } }, // D3
  { post: { x: 168.5, y: 236 }, nut: { x: 172, y: 575 }, peg: { x: 97.5, y: 214 } }, // G3
  { post: { x: 190.8, y: 167.5 }, nut: { x: 194.8, y: 575 }, peg: { x: 120, y: 145 } }, // B3
  { post: { x: 212.8, y: 95 }, nut: { x: 215.3, y: 575 }, peg: { x: 142.5, y: 77.5 } }, // E4
];

function guitarLayout(kind: "acoustic" | "electric"): Layout {
  if (kind === "acoustic") {
    const { dx, dy, w, h, cropAt } = ACOUSTIC;
    return {
      kind,
      height: dy + cropAt,
      nutY: 572.5 + dy,
      lineEnd: dy + 1.5 + 1.5, // the picture's top edge at the axis is 1.5 units down
      picture: { webp: "/tuner/acoustic-guitar.webp", x: dx, y: dy, w, h, label: "An acoustic guitar's headstock with six tuning pegs" },
      strings: ACOUSTIC_STRINGS.map((s) => ({
        post: move(dx, dy, s.post),
        nut: move(dx, dy, s.nut),
        peg: move(dx, dy, s.peg),
        button: { x: s.side === "left" ? dx - 46 : dx + w + 46, y: s.peg.y + dy },
      })),
    };
  }
  const { dx, dy, w, h, cropAt } = ELECTRIC;
  return {
    kind,
    height: dy + cropAt,
    nutY: 575 + dy,
    lineEnd: dy + 72.5 + 1.5, // the electric headstock's edge at the axis (the top tuner) is 72.5 units down: the line runs down to it
    picture: { webp: "/tuner/electric-guitar.webp", x: dx, y: dy, w, h, label: "An electric guitar's headstock with six tuning pegs in a row" },
    strings: ELECTRIC_STRINGS.map((s) => ({
      post: move(dx, dy, s.post),
      nut: move(dx, dy, s.nut),
      peg: move(dx, dy, s.peg),
      button: { x: 140, y: s.peg.y + dy },
    })),
  };
}

// ---- a drawn headstock, for the other instruments -----------------------------------------------------------------------

/**
 * A plain wooden headstock with `count` strings, tuners on both sides (the lower strings on the left, as on an acoustic guitar), for an
 * instrument we have no picture of. The same board, buttons and highlights work on it.
 */
function drawnLayout(count: number): Layout {
  const left = Math.ceil(count / 2);
  const right = count - left;
  const rows = Math.max(left, right);
  const top = HEAD_TOP + 20;
  const gap = rows >= 3 ? 112 : 124;
  const first = top + 96;
  const bottom = first + (rows - 1) * gap + 70;
  const nutY = bottom + 118;
  const height = nutY + 78;
  const postL = AXIS_X - 80;
  const postR = AXIS_X + 80;
  const rowY = (i: number) => first + i * gap;

  // low strings on the left, bottom row first (the lowest string is the lowest left tuner); the rest on the right, top row first
  const spots: StringSpot[] = [];
  const nutSpan = Math.min(120, 22 * (count - 1) + 20);
  const nutX = (i: number) => AXIS_X - nutSpan / 2 + (count === 1 ? nutSpan / 2 : (nutSpan * i) / (count - 1));
  for (let i = 0; i < count; i++) {
    const onLeft = i < left;
    const row = onLeft ? left - 1 - i : i - left;
    const y = rowY(row + (rows - (onLeft ? left : right)) / 2);
    const post = { x: onLeft ? postL : postR, y };
    const peg = { x: onLeft ? postL - 62 : postR + 62, y };
    spots.push({ post, peg, nut: { x: nutX(i), y: nutY }, button: { x: onLeft ? 108 : BOARD_W - 108, y } });
  }

  const stringLines = spots.map((s) => `<path d="M${s.post.x} ${s.post.y} L${s.nut.x} ${s.nut.y}" stroke="url(#dh-string)" stroke-width="2.2" fill="none" stroke-linecap="round"/>`).join("");
  const posts = spots.map((s) => `<circle cx="${s.post.x}" cy="${s.post.y}" r="15" fill="url(#dh-post)" stroke="#0006" stroke-width="1"/><circle cx="${s.post.x}" cy="${s.post.y}" r="4.5" fill="#3a2a22"/>`).join("");
  const knobs = spots
    .map((s) => {
      const onLeft = s.peg.x < AXIS_X;
      const x = onLeft ? s.peg.x - 30 : s.peg.x - 6;
      return `<path d="M${onLeft ? s.peg.x + 8 : s.peg.x - 8} ${s.peg.y} H${onLeft ? s.post.x - 15 : s.post.x + 15}" stroke="#bfc3cc" stroke-width="7" stroke-linecap="round"/><rect x="${x}" y="${s.peg.y - 27}" width="36" height="54" rx="14" fill="url(#dh-knob)" stroke="#0007" stroke-width="1.2"/><rect x="${x + 6}" y="${s.peg.y - 20}" width="9" height="40" rx="4.5" fill="#fff" opacity=".42"/>`;
    })
    .join("");
  const w = 112;
  const shape = `M${AXIS_X - 52} ${nutY} L${AXIS_X - 56} ${bottom + 26} C${AXIS_X - 100} ${bottom - 18} ${AXIS_X - w - 6} ${bottom - 70} ${AXIS_X - w - 6} ${bottom - 140} L${AXIS_X - w - 6} ${top + 70} Q${AXIS_X - w - 6} ${top} ${AXIS_X - 60} ${top - 4} L${AXIS_X + 60} ${top - 4} Q${AXIS_X + w + 6} ${top} ${AXIS_X + w + 6} ${top + 70} L${AXIS_X + w + 6} ${bottom - 140} C${AXIS_X + w + 6} ${bottom - 70} ${AXIS_X + 100} ${bottom - 18} ${AXIS_X + 56} ${bottom + 26} L${AXIS_X + 52} ${nutY} Z`;
  const neck = `<path d="M${AXIS_X - 52} ${nutY} H${AXIS_X + 52} V${height} H${AXIS_X - 52} Z" fill="url(#dh-board)"/><path d="M${AXIS_X - 54} ${nutY - 5} H${AXIS_X + 54} V${nutY + 5} H${AXIS_X - 54} Z" fill="#efe6d2"/>`;
  const fadeEnd = height;
  const drawn = `<svg viewBox="0 0 ${BOARD_W} ${height}" class="tt-drawn" aria-hidden="true">
    <defs>
      <linearGradient id="dh-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b86a3c"/><stop offset=".55" stop-color="#8d4a27"/><stop offset="1" stop-color="#6b3419"/></linearGradient>
      <linearGradient id="dh-board" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2418"/><stop offset="1" stop-color="#2a1810" stop-opacity=".25"/></linearGradient>
      <radialGradient id="dh-post" cx=".38" cy=".32"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#c3c7cf"/><stop offset="1" stop-color="#7d828c"/></radialGradient>
      <linearGradient id="dh-knob" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5d6068"/><stop offset=".35" stop-color="#f4f5f7"/><stop offset=".7" stop-color="#b6bac2"/><stop offset="1" stop-color="#50535b"/></linearGradient>
      <linearGradient id="dh-string" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9ebef"/><stop offset="1" stop-color="#9ea3ad"/></linearGradient>
    </defs>
    <path d="${shape}" fill="url(#dh-wood)" stroke="#f1e7d0" stroke-width="3"/>
    <path d="${shape}" fill="none" stroke="#0004" stroke-width="1" transform="translate(0 1)"/>
    ${neck}${stringLines}${posts}${knobs}
    <rect x="0" y="${fadeEnd - 1}" width="${BOARD_W}" height="1" fill="none"/>
  </svg>`;
  return { kind: "generic", height, nutY, lineEnd: top + 2, drawn, strings: spots };
}

/** The board for an instrument: a guitar gets its picture (acoustic or electric), the others a drawn headstock, and "any note" has none. */
export function layoutFor(inst: Instrument, tuning: Tuning, head: "acoustic" | "electric"): Layout {
  const n = tuning.notes.length;
  if (n === 0) return { kind: "none", height: 360, nutY: 340, lineEnd: HEAD_TOP, strings: [] };
  if (inst.id === "guitar" && n === 6) return guitarLayout(head);
  return drawnLayout(n);
}

// ---- the list of tunings ---------------------------------------------------------------------------------------------

export interface TuningRow {
  index: number;
  name: string; // "Drop D"
  notes: string[]; // from the highest string to the lowest, the way the list reads: E4 B3 G3 D3 A2 E2
  group: "Standard" | "Alternate";
}

/** The tunings of an instrument for the list: the name without its note list in brackets, and the notes high to low. */
export function tuningRows(inst: Instrument): TuningRow[] {
  return inst.tunings.map((t, index) => ({
    index,
    name: t.name.replace(/\s*\(.*\)\s*$/, ""),
    notes: [...t.notes].reverse(),
    group: index === 0 ? "Standard" : "Alternate",
  }));
}

/** "Guitar 6-String", "Bass 4-String", "Ukulele": the name for the top of the list. */
export function instrumentTitle(inst: Instrument, tuning: Tuning): string {
  const n = tuning.notes.length;
  return n === 0 ? inst.name : ["guitar", "bass"].includes(inst.id) ? `${inst.name} ${n}-String` : inst.name;
}

/** A string's note as the button shows it: the letter (with a sharp sign) and the octave apart. */
export function buttonNote(midi: number): { name: string; octave: string } {
  const label = noteLabel(midi);
  return { name: label.replace(/-?\d+$/, "").replace("#", "♯"), octave: label.match(/-?\d+$/)?.[0] ?? "" };
}

export { midiFromName };
