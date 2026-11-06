// What the page of one chord on one instrument says (/guitar-chords/a/minor/, /piano-chords/g/seventh/ ...): the notes with their degrees,
// the other names it goes by, every way to play it with the fingering written out, the chords that go with it, and the questions people ask.
// Made when the site is built from the same shapes and notes as the player and the charts, so they cannot disagree.
import { INSTRUMENTS, KINDS, ROOTS, chordLabel, chordName, chordPath, instrumentInfo, kindBySuffix, type InstrumentKey, type Kind, type Root } from "./chordCatalog";
import { STRING_NAMES, chordDrawing, chordNotes, midiName, type GuitarShape } from "./chordShapes";
import { diagramSvg } from "./tools/diagram";
import { pianoSvg } from "./pianoDiagram";
import { MODES, modeChords } from "./modes";

export const chordPagePath = (instrument: InstrumentKey, root: Root, kind: Kind) => `${instrumentInfo(instrument).notesPath}${root.slug}/${kind.id}/`;

/** Every chord page (336 chords on each of the four instruments), for the sitemap. */
export function chordPageUrls(): string[] {
  return INSTRUMENTS.flatMap((i) => ROOTS.flatMap((r) => KINDS.map((k) => chordPagePath(i.key, r, k))));
}

const sharpen = (s: string) => s.replace(/#/g, "♯");
const FLAT_ROOT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

const INTERVAL: Record<string, string> = {
  "1": "root", "2": "major second", "♭3": "minor third", "3": "major third", "4": "perfect fourth", "♭5": "diminished fifth", "5": "perfect fifth", "♯5": "augmented fifth",
  "6": "major sixth", "♭♭7": "diminished seventh", "♭7": "minor seventh", "7": "major seventh", "♭9": "flat ninth", "9": "ninth", "♯9": "sharp ninth", "11": "eleventh", "13": "thirteenth",
};

/** Other ways a chord is written, after the note: Cmaj, CM for C major; Cmin for C minor... */
const ALIASES: Record<string, string[]> = {
  "": ["maj", "M"], m: ["min", "−"], "7": ["dom7"], maj7: ["M7", "Δ7", "Δ"], m7: ["min7", "−7"], mMaj7: ["m(maj7)", "−Δ7"], m7b5: ["ø", "ø7", "min7♭5"], dim7: ["°7"], dim: ["°", "min♭5"],
  aug: ["+", "maj♯5"], sus4: ["sus"], "6": ["maj6"], m6: ["min6"], "9": ["dom9"], m9: ["min9"], maj9: ["M9", "Δ9"], add9: ["add2"], "5": ["power chord"],
};

export interface PageVoicing {
  label: string; // "Usual shape", "Near the nut", "Root position"...
  frets?: string; // "x 0 2 2 1 0"
  svg: string;
  steps: string[]; // how to put the fingers down, in words
  notes?: string; // piano: the keys, low to high
  easy: boolean;
}
export interface PageChord {
  label: string; // A♯m7
  altLabel: string; // B♭m7 for a black key, else ""
  words: string; // "A♯ minor 7th": the chord's name in words
  titleName: string; // the name in the title: short for the long ones
  notes: { note: string; degree: string; interval: string }[];
  notesText: string;
  formula: string;
  aliases: string[]; // Amin, A−
  type: string; // "a minor chord", "a suspended chord"...
  voicings: PageVoicing[];
  progressions: { title: string; chords: { roman: string; label: string; href: string }[] }[];
  keyChords: { title: string; chords: { roman: string; label: string; href: string }[] } | null;
  relation: string; // a sentence about how it relates to another chord, or ""
  otherKinds: { label: string; href: string; group: string }[]; // the same root, other kinds
  sameKind: { label: string; href: string }[]; // the same kind on the other eleven notes
  otherInstruments: { name: string; key: InstrumentKey; href: string }[];
}

const FINGER = ["", "index", "middle", "ring", "little"];

/** "the A, D and G strings" */
const listOf = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function stringLabels(instrument: Exclude<InstrumentKey, "piano">): string[] {
  const names = STRING_NAMES[instrument];
  if (instrument !== "guitar") return names.map((n) => n);
  return names.map((n, i) => (i === 0 ? "low E" : i === names.length - 1 ? "high E" : n));
}

/** The fingering of one shape in words: where each finger goes, which strings ring open and which are left out. */
function fretSteps(instrument: Exclude<InstrumentKey, "piano">, shape: GuitarShape): string[] {
  const names = stringLabels(instrument);
  const pressed: { i: number; fret: number; finger: string }[] = [];
  const open: number[] = [];
  const muted: number[] = [];
  shape.frets.forEach((f, i) => {
    if (f === "x") muted.push(i);
    else if (f === "0") open.push(i);
    else pressed.push({ i, fret: Number(f), finger: shape.fingers[i] ?? "" });
  });
  const groups = new Map<string, typeof pressed>();
  for (const p of pressed) groups.set(`${p.finger || "-" + p.i}:${p.fret}`, [...(groups.get(`${p.finger || "-" + p.i}:${p.fret}`) ?? []), p]);
  const steps: string[] = [];
  const ordered = [...groups.values()].sort((a, b) => Number(a[0].finger || 9) - Number(b[0].finger || 9) || a[0].fret - b[0].fret);
  for (const g of ordered) {
    const fret = g[0].fret;
    const finger = FINGER[Number(g[0].finger)] ?? "";
    const who = finger ? `your ${finger} finger` : "a finger";
    if (g.length > 1) {
      const lo = Math.min(...g.map((p) => p.i));
      const hi = Math.max(...g.map((p) => p.i));
      steps.push(`Lay ${who} across fret ${fret} (a barre), from the ${names[lo]} string to the ${names[hi]} string.`);
    } else {
      steps.push(`Press the ${names[g[0].i]} string at fret ${fret} with ${who}.`);
    }
  }
  if (open.length) steps.push(`Let the ${listOf(open.map((i) => names[i]))} ${open.length > 1 ? "strings" : "string"} ring open.`);
  if (muted.length) steps.push(`Do not play the ${listOf(muted.map((i) => names[i]))} ${muted.length > 1 ? "strings" : "string"}: leave ${muted.length > 1 ? "them" : "it"} out or mute ${muted.length > 1 ? "them" : "it"} lightly with the side of a finger.`);
  const sounding = shape.frets.map((f, i) => (f === "x" ? -1 : i)).filter((i) => i >= 0);
  if (sounding.length) steps.push(`Strum from the ${names[sounding[0]]} string down to the ${names[sounding[sounding.length - 1]]} string.`);
  return steps;
}

function pianoHint(count: number): string {
  if (count <= 3) return "In the right hand, fingers 1, 3 and 5 (thumb, middle and little finger) fit a three-note chord.";
  if (count === 4) return "In the right hand, fingers 1, 2, 3 and 5 fit a four-note chord.";
  return "A chord with five or more notes is easiest spread over both hands, with the root in the left.";
}

function typeOf(kind: Kind): string {
  const f = kind.formula.split(" ");
  if (kind.id === "power") return "a power chord (a root and a fifth, neither major nor minor)";
  if (f.includes("♭♭7") || (f.includes("♭3") && f.includes("♭5") && !f.includes("♭7"))) return "a diminished chord";
  if (f.includes("♭3") && f.includes("♭5")) return "a half-diminished chord";
  if (f.includes("♯5") && f.includes("3") && !f.includes("♭7")) return "an augmented chord";
  if (f.includes("2") && !f.includes("3") && !f.includes("♭3")) return "a suspended chord (neither major nor minor)";
  if (f.includes("4") && !f.includes("3") && !f.includes("♭3")) return "a suspended chord (neither major nor minor)";
  if (f.includes("♭3")) return "a minor chord";
  if (f.includes("3")) return f.includes("♭7") ? "a dominant 7th chord (a major chord with a flat 7th)" : "a major chord";
  return "a chord";
}

const rootAt = (pc: number) => ROOTS[((pc % 12) + 12) % 12];

export function chordPage(instrument: InstrumentKey, root: Root, kind: Kind): PageChord {
  const pc = ROOTS.findIndex((r) => r.slug === root.slug);
  const info = instrumentInfo(instrument);
  const label = chordLabel(root, kind);
  const flat = FLAT_ROOT[pc] !== root.short ? FLAT_ROOT[pc] : "";
  const altLabel = flat ? `${flat}${kind.suffix.replace("b", "♭").replace("#", "♯")}` : "";
  const longName = kind.name.length > 26 ? kind.nameShort : kind.name;
  const words = `${root.short} ${kind.name}`;
  const name = chordName(root, kind);
  const formula = kind.formula;
  const degrees = formula.split(" ");
  const tones = chordNotes(name).map(sharpen);
  const notes = tones.map((n, i) => ({ note: n, degree: degrees[i] ?? "", interval: INTERVAL[degrees[i] ?? ""] ?? "" }));

  // ways to play it
  const drawing = chordDrawing(instrument, name);
  const voicings: PageVoicing[] = [];
  if (drawing.kind === "keys") {
    drawing.voicings.slice(0, 4).forEach((v) => {
      voicings.push({
        label: v.name,
        svg: pianoSvg(v, { scale: 1, title: `${label} on piano, ${v.name.toLowerCase()}` }),
        notes: v.notes.map(midiName).map(sharpen).join(" "),
        steps: [`Press ${listOf(v.notes.map(midiName).map(sharpen))} together.`, pianoHint(v.notes.length)],
        easy: v.notes.length <= 3,
      });
    });
  } else {
    const inst = instrument as Exclude<InstrumentKey, "piano">;
    drawing.shapes.slice(0, 4).forEach((shape, i) => {
      const pressed = shape.frets.map(Number).filter((f) => Number.isFinite(f) && f > 0);
      const lowest = pressed.length ? Math.min(...pressed) : 0;
      voicings.push({
        label: i === 0 ? "Usual shape" : lowest <= 2 ? "Near the nut" : `From fret ${lowest}`,
        frets: shape.frets.join(" "),
        svg: diagramSvg(shape, { title: `${label} on ${info.name.toLowerCase()}${i === 0 ? "" : ", way " + (i + 1)}` }),
        steps: fretSteps(inst, shape),
        easy: !pressed.some((f) => f > 4),
      });
    });
  }

  // other names
  const aliases = (ALIASES[kind.suffix] ?? []).map((a) => `${root.short}${a}`);

  // chords that go with it
  const link = (r: Root, k: Kind) => ({ label: chordLabel(r, k), href: chordPath(instrument, r, k) });
  const k = (suffix: string) => kindBySuffix(suffix)!;
  const chord = (roman: string, semis: number, suffix: string) => ({ roman, ...link(rootAt(pc + semis), k(suffix)) });
  const progressions: PageChord["progressions"] = [];
  let keyChords: PageChord["keyChords"] = null;
  let relation = "";
  if (kind.suffix === "") {
    progressions.push(
      { title: "I–V–vi–IV, the most used progression in pop", chords: [chord("I", 0, ""), chord("V", 7, ""), chord("vi", 9, "m"), chord("IV", 5, "")] },
      { title: "I–IV–V, the three chords of folk, blues and rock", chords: [chord("I", 0, ""), chord("IV", 5, ""), chord("V", 7, "")] },
      { title: "ii–V–I, the jazz turnaround", chords: [chord("ii", 2, "m7"), chord("V", 7, "7"), chord("I", 0, "maj7")] },
    );
    const key = modeChords(pc, MODES[0]);
    keyChords = { title: `The chords of ${root.short} major`, chords: key.map((c) => ({ roman: c.roman, ...link(rootAt(c.note), c.triad.kind) })) };
    relation = `${label} is the I chord of the key of ${root.short} major. Its relative minor, which shares all its notes with that key, is ${chordLabel(rootAt(pc + 9), k("m"))}.`;
  } else if (kind.suffix === "m") {
    progressions.push(
      { title: "i–♭VI–♭III–♭VII, the sound of rock and pop in a minor key", chords: [chord("i", 0, "m"), chord("♭VI", 8, ""), chord("♭III", 3, ""), chord("♭VII", 10, "")] },
      { title: "i–iv–v, the three minor chords of a minor key", chords: [chord("i", 0, "m"), chord("iv", 5, "m"), chord("v", 7, "m")] },
      { title: "i–♭VII–♭VI–V, the Andalusian cadence", chords: [chord("i", 0, "m"), chord("♭VII", 10, ""), chord("♭VI", 8, ""), chord("V", 7, "")] },
    );
    const key = modeChords(pc, MODES[5]);
    keyChords = { title: `The chords of ${root.short} minor`, chords: key.map((c) => ({ roman: c.roman, ...link(rootAt(c.note), c.triad.kind) })) };
    relation = `${label} is the i chord of the key of ${root.short} minor. Its relative major, which shares all its notes with that key, is ${chordLabel(rootAt(pc + 3), k(""))}.`;
  } else if (kind.suffix === "7") {
    progressions.push({ title: `${label} usually resolves to ${chordLabel(rootAt(pc + 5), k(""))}`, chords: [chord("V7", 0, "7"), chord("I", 5, "")] });
    relation = `${label} is the V7 chord of the key of ${rootAt(pc + 5).short} major, so it pulls strongly towards ${chordLabel(rootAt(pc + 5), k(""))}.`;
  } else if (kind.suffix === "maj7") {
    relation = `${label} is the I chord of ${root.short} major with a major 7th added, and the IV chord of ${rootAt(pc + 7).short} major.`;
  } else if (kind.suffix === "m7") {
    relation = `${label} is the ii chord of ${rootAt(pc - 2).short} major and the i chord of ${root.short} minor with a 7th added.`;
  }

  return {
    label,
    altLabel,
    words,
    titleName: `${root.short} ${longName}`,
    notes,
    notesText: tones.join(" "),
    formula,
    aliases,
    type: typeOf(kind),
    voicings,
    progressions,
    keyChords,
    relation,
    otherKinds: KINDS.filter((x) => x.id !== kind.id).map((x) => ({ label: chordLabel(root, x), href: chordPagePath(instrument, root, x), group: x.group })),
    sameKind: ROOTS.filter((r) => r.slug !== root.slug).map((r) => ({ label: chordLabel(r, kind), href: chordPagePath(instrument, r, kind) })),
    otherInstruments: INSTRUMENTS.filter((i) => i.key !== instrument).map((i) => ({ name: i.name, key: i.key, href: chordPagePath(i.key, root, kind) })),
  };
}
