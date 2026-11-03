// A piano chord diagram: a keyboard with the keys of the chord pressed and named. The root is violet, the other keys amber.
// `pianoLayout` is the drawing as plain numbers (the website draws it as SVG text, the Android app with its own SVG parts), so the two
// always show the same keys; `pianoSvg` is the website's SVG.
import { isBlackKey, midiName, type PianoVoicing } from "./chordShapes";

interface Options {
  /** Size multiplier (1 is about 160 px wide for two octaves). */
  scale?: number;
  /** Colours, so a page on a dark background can restyle it. */
  white?: string;
  black?: string;
  line?: string;
  root?: string;
  press?: string;
  ink?: string;
}

export const KEY_W = 11;
export const KEY_H = 58;
export const BLACK_W = 7;
export const BLACK_H = 35;

/** The first and last key drawn: whole octaves from a C, at least two, so every chord fits and keyboards line up from card to card. */
export function pianoRange(notes: number[]): { start: number; octaves: number } {
  const low = Math.min(...notes);
  const high = Math.max(...notes);
  const start = Math.floor(low / 12) * 12;
  return { start, octaves: Math.max(2, Math.ceil((high - start + 1) / 12)) };
}

export interface PianoKey {
  x: number;
  y: number;
  w: number;
  h: number;
  black: boolean;
  on: boolean; // pressed
  root: boolean; // pressed and the chord's root
  label: string; // the note's name, for a pressed key
}

/** Every key of the drawing, white ones first (the black ones sit on top of them), with where it is and whether it is pressed. */
export function pianoLayout(voicing: PianoVoicing): { width: number; height: number; keys: PianoKey[] } {
  const { start, octaves } = pianoRange(voicing.notes);
  const end = start + octaves * 12; // the C that closes the last octave
  const pressed = new Set(voicing.notes);
  const whites: PianoKey[] = [];
  const blacks: PianoKey[] = [];
  let index = 0;
  for (let midi = start; midi <= end; midi++) {
    const on = pressed.has(midi);
    const root = on && midi % 12 === voicing.root;
    if (isBlackKey(midi)) {
      // between the white key before it and the one after, a little off-centre like a real keyboard
      const nudge = midi % 12 === 1 || midi % 12 === 6 ? -0.8 : midi % 12 === 3 || midi % 12 === 10 ? 0.8 : 0;
      blacks.push({ x: index * KEY_W - BLACK_W / 2 + nudge, y: 0, w: BLACK_W, h: BLACK_H, black: true, on, root, label: on ? midiName(midi) : "" });
    } else {
      whites.push({ x: index * KEY_W + 0.4, y: 0, w: KEY_W - 0.8, h: KEY_H, black: false, on, root, label: on ? midiName(midi) : "" });
      index++;
    }
  }
  return { width: (octaves * 7 + 1) * KEY_W, height: KEY_H, keys: [...whites, ...blacks] };
}

export function pianoSvg(voicing: PianoVoicing, options: Options = {}): string {
  const scale = options.scale ?? 1;
  const white = options.white ?? "#ffffff";
  const black = options.black ?? "#1a0533";
  const line = options.line ?? "#bda9e0";
  const rootColor = options.root ?? "#7c3aed";
  const press = options.press ?? "#f59e0b";
  const ink = options.ink ?? "#ffffff";
  const { width, height, keys } = pianoLayout(voicing);
  const parts = keys.map((k) => {
    const fill = k.on ? (k.root ? rootColor : press) : k.black ? black : white;
    if (k.black) {
      const rect = `<rect x="${k.x}" y="0" width="${k.w}" height="${k.h}" rx="1.2" fill="${fill}" stroke="${k.on ? fill : black}" stroke-width="0.6"/>`;
      return k.on ? `${rect}<text x="${k.x + k.w / 2}" y="${k.h - 4}" font-size="5.2" font-weight="800" fill="${ink}" text-anchor="middle" font-family="inherit">${k.label}</text>` : rect;
    }
    const rect = `<rect x="${k.x}" y="0" width="${k.w}" height="${k.h}" rx="1.4" fill="${fill}" stroke="${line}" stroke-width="0.7"/>`;
    return k.on ? `${rect}<text x="${k.x + k.w / 2}" y="${k.h - 5}" font-size="6.4" font-weight="800" fill="${ink}" text-anchor="middle" font-family="inherit">${k.label}</text>` : rect;
  });
  const names = voicing.notes.map(midiName).join(", ");
  return `<svg viewBox="0 0 ${width} ${height}" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" role="img" aria-label="Piano keys: ${names}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
