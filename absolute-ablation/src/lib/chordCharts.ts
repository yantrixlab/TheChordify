// The diagrams on the chord chart pages, made when the site is built from the same shapes the player uses (chordShapes.ts), so a chart
// and the player never disagree. Nothing here is shipped to the browser.
import { chordDrawing, chordNotes, type GuitarShape } from "./chordShapes";
import { chordName, chordLabel, type InstrumentKey, type Kind, type Root } from "./chordCatalog";
import { diagramSvg } from "./tools/diagram";
import { pianoSvg } from "./pianoDiagram";

export interface Voicing {
  svg: string;
  label: string; // "Usual shape", "From fret 5", "Root position"...
  easy: boolean; // open shapes and the first positions: no barre, nothing above the fourth fret
  frets?: string; // the fret on each string, low to high: "x 3 2 0 1 0"
}

export interface ChartChord {
  name: string; // "C#m7" (what the shape code calls it)
  label: string; // "C♯m7"
  notes: string; // "C♯ E G♯ B"
  formula: string;
  voicings: Voicing[];
}

const sharpen = (s: string) => s.replace(/#/g, "♯");

/** A shape is easy when no finger lies across several strings and nothing is above the fourth fret. */
function isEasy(shape: GuitarShape): boolean {
  const fretted = shape.frets.map((f, i) => ({ fret: Number(f), finger: shape.fingers[i] })).filter((p) => Number.isFinite(p.fret) && p.fret > 0);
  if (fretted.some((p) => p.fret > 4)) return false;
  const byFinger = new Map<string, number>();
  for (const p of fretted) if (p.finger) byFinger.set(p.finger, (byFinger.get(p.finger) ?? 0) + 1);
  return ![...byFinger.values()].some((n) => n > 1);
}

function fretLabel(shape: GuitarShape, index: number): string {
  const pressed = shape.frets.map(Number).filter((f) => Number.isFinite(f) && f > 0);
  const lowest = pressed.length ? Math.min(...pressed) : 0;
  if (index === 0) return "Usual shape";
  return lowest <= 2 ? `Near the nut` : `From fret ${lowest}`;
}

/** The ways to play one chord on an instrument, as drawings: the usual shape first, then up to `max - 1` others. */
export function voicingsFor(instrument: InstrumentKey, chord: string, max: number): Voicing[] {
  const drawing = chordDrawing(instrument, chord);
  if (drawing.kind === "keys") {
    return drawing.voicings.slice(0, max).map((v) => ({ svg: pianoSvg(v, { scale: 1, title: `${chord.replace("#", "♯")} on piano, ${v.name.toLowerCase()}` }), label: v.name, easy: v.notes.length <= 3 }));
  }
  return drawing.shapes.slice(0, max).map((shape, i) => ({
    svg: diagramSvg(shape, { title: `${chord.replace("#", "♯")} on ${instrument}${i === 0 ? "" : ", way " + (i + 1)}` }),
    label: fretLabel(shape, i),
    easy: isEasy(shape),
    frets: shape.frets.join(" "),
  }));
}

export function chartChord(instrument: InstrumentKey, root: Root, kind: Kind, max: number): ChartChord {
  const name = chordName(root, kind);
  return {
    name,
    label: chordLabel(root, kind),
    notes: chordNotes(name).map(sharpen).join(" "),
    formula: kind.formula,
    voicings: voicingsFor(instrument, name, max),
  };
}
