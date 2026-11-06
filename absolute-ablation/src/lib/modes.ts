// The seven musical modes in all twelve keys, worked out from the notes (never typed in), so every page about them agrees.
//
// A mode is the same seven notes as a major scale, started on a different note. Here each mode is its steps from the root in semitones,
// and every note, formula, parent scale and chord on the pages is made from those. Notes are named by pitch, the way a keyboard shows
// them: sharps by default, flats on request (C♯ and D♭ are one key), so a few notes a theory book would write as E♯ or B♯ appear as F and C.
import { ROOTS, KINDS, chordLabel, chordPath, type Root, type Kind } from "./chordCatalog";

export const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
/** The name of a major key as players write it (B♭ major, not A♯ major), for "same notes as ... major". */
export const KEY_NAME = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const keyName = (pc: number) => KEY_NAME[((pc % 12) + 12) % 12];
export type Accidental = "sharp" | "flat";
export const noteName = (pc: number, acc: Accidental = "sharp") => (acc === "flat" ? FLAT : SHARP)[((pc % 12) + 12) % 12];

export interface Mode {
  id: string; // dorian: the address and the anchor
  name: string; // Dorian
  order: number; // 1 for Ionian ... 7 for Locrian: which note of the major scale it starts on
  steps: number[]; // the semitones above the root of each of the seven notes
  formula: string; // the scale degrees, as players write them
  pattern: string; // whole and half steps
  parent: number; // the semitones below the root of the major scale that has the same notes
  family: "major" | "minor" | "diminished";
  brightness: number; // 1 (brightest) to 7 (darkest)
  mood: string; // how it sounds, in a few words
  summary: string; // what it is, in a sentence (the answer to "what is the X mode?")
  detail: string; // a few more sentences
  uses: string; // where it is heard
  vamp: string; // two chords that make it sound like itself
  examples: string[]; // songs and pieces it is often heard in
  tip: string; // how to start playing in it
}

export const MODES: Mode[] = [
  {
    id: "ionian", name: "Ionian", order: 1, steps: [0, 2, 4, 5, 7, 9, 11], formula: "1 2 3 4 5 6 7", pattern: "W W H W W W H", parent: 0, family: "major", brightness: 2,
    mood: "bright, settled and happy",
    summary: "The Ionian mode is the major scale: the first mode, built on the first note of the major scale, with no note raised or lowered.",
    detail: "Every other mode is described by how it differs from Ionian. Its third is major and its seventh is a half step below the root, which gives the home chord a firm, resolved sound. Ionian and the major scale are the same thing, so a song \"in a major key\" is a song in Ionian.",
    uses: "Most pop, rock, folk, country and children's songs, and nearly all classical music in a major key.",
    vamp: "I and V, or I, IV and V",
    examples: ["Most pop and folk songs in a major key"],
    tip: "Play the major scale and rest on the root. Over a major chord with a major 7th it sounds complete.",
  },
  {
    id: "dorian", name: "Dorian", order: 2, steps: [0, 2, 3, 5, 7, 9, 10], formula: "1 2 ♭3 4 5 6 ♭7", pattern: "W H W W W H W", parent: 2, family: "minor", brightness: 4,
    mood: "minor, but warm and hopeful",
    summary: "The Dorian mode is the second mode of the major scale: a minor scale with a raised (major) 6th, so it is the natural minor scale with one note brighter.",
    detail: "That one raised note, the 6th, lifts the minor sound out of sadness into something cooler and more open. Dorian is the most used minor mode in jazz, funk and soul, and the one to reach for when a minor chord should feel groovy rather than gloomy.",
    uses: "Jazz, funk, soul, blues-rock, Celtic and folk tunes, and film music.",
    vamp: "i and IV (for example Am7 to D7 in A Dorian)",
    examples: ["Scarborough Fair", "Oye Como Va (Santana)", "So What (Miles Davis)"],
    tip: "Play a minor 7th chord and slide up to the major chord a fourth above it. That minor-to-major move is the Dorian sound.",
  },
  {
    id: "phrygian", name: "Phrygian", order: 3, steps: [0, 1, 3, 5, 7, 8, 10], formula: "1 ♭2 ♭3 4 5 ♭6 ♭7", pattern: "H W W W H W W", parent: 4, family: "minor", brightness: 6,
    mood: "dark, tense and Spanish",
    summary: "The Phrygian mode is the third mode of the major scale: a minor scale with a flat 2nd, so there is only a half step between the first two notes.",
    detail: "That half step right above the root is what makes Phrygian sound dark and exotic. It is the sound of flamenco and a favourite of metal. The chord a half step above the home chord is the one that gives the mode away.",
    uses: "Flamenco and Spanish guitar, metal, film scores and some Middle Eastern and Indian-influenced music.",
    vamp: "i and ♭II (for example Em to F in E Phrygian)",
    examples: ["Flamenco guitar", "Heavy metal riffs"],
    tip: "Play the root and bounce to the note a half step above it. Then back down: that rub is the sound.",
  },
  {
    id: "lydian", name: "Lydian", order: 4, steps: [0, 2, 4, 6, 7, 9, 11], formula: "1 2 3 ♯4 5 6 7", pattern: "W W W H W W H", parent: 5, family: "major", brightness: 1,
    mood: "bright, floating and dreamy",
    summary: "The Lydian mode is the fourth mode of the major scale: a major scale with a raised 4th, which is the brightest of the seven modes.",
    detail: "The sharp fourth takes away the pull of a plain major scale and leaves a bright, weightless, wide-eyed sound. It suits music that should feel like wonder or flying, and it sits over a major 7th chord very naturally.",
    uses: "Film and TV music, dream pop, jazz and progressive rock.",
    vamp: "I and II (for example F to G in F Lydian)",
    examples: ["Dreams (Fleetwood Mac)", "The Simpsons theme"],
    tip: "Play a major chord and then the major chord a whole step above it. That I to II move is the Lydian sound.",
  },
  {
    id: "mixolydian", name: "Mixolydian", order: 5, steps: [0, 2, 4, 5, 7, 9, 10], formula: "1 2 3 4 5 6 ♭7", pattern: "W W H W W H W", parent: 7, family: "major", brightness: 3,
    mood: "bright with a bluesy edge",
    summary: "The Mixolydian mode is the fifth mode of the major scale: a major scale with a flat 7th, which is also the scale of the dominant 7th chord.",
    detail: "It keeps the happy major third but lowers the seventh, so it sounds relaxed, earthy and a little rebellious. A song that stays on a major chord with a flat 7th, such as G to F to C, is Mixolydian.",
    uses: "Rock, blues, folk, country, funk and Celtic tunes.",
    vamp: "I and ♭VII (for example G to F in G Mixolydian)",
    examples: ["Sweet Home Alabama", "Norwegian Wood (The Beatles)"],
    tip: "Play a major chord and then the major chord a whole step below it. That I to ♭VII move is the Mixolydian sound.",
  },
  {
    id: "aeolian", name: "Aeolian", order: 6, steps: [0, 2, 3, 5, 7, 8, 10], formula: "1 2 ♭3 4 5 ♭6 ♭7", pattern: "W H W W H W W", parent: 9, family: "minor", brightness: 5,
    mood: "sad, serious and emotional",
    summary: "The Aeolian mode is the sixth mode of the major scale and is the natural minor scale: a minor scale with a flat 3rd, flat 6th and flat 7th.",
    detail: "When people say \"the minor scale\" they usually mean Aeolian. It shares its notes with the relative major scale, which starts three semitones above the root, so every major key has an Aeolian mode that sounds like its sad twin.",
    uses: "Pop, rock, metal, classical and film music, and most songs in a minor key.",
    vamp: "i, ♭VI and ♭VII (for example Am, F and G in A Aeolian)",
    examples: ["Losing My Religion (R.E.M.)", "Most songs in a minor key"],
    tip: "Play the notes of the relative major scale and make the minor root your home note.",
  },
  {
    id: "locrian", name: "Locrian", order: 7, steps: [0, 1, 3, 5, 6, 8, 10], formula: "1 ♭2 ♭3 4 ♭5 ♭6 ♭7", pattern: "H W W H W W W", parent: 11, family: "diminished", brightness: 7,
    mood: "unstable, tense and dark",
    summary: "The Locrian mode is the seventh mode of the major scale: a minor scale with a flat 2nd and a flat 5th, the darkest of the seven modes.",
    detail: "Its home chord is diminished, a chord that wants to move somewhere else, so Locrian is rarely used as a key to settle in. It is more often the sound over one chord, the half-diminished or minor 7 flat 5 chord, in jazz and metal.",
    uses: "Jazz (over a m7♭5 chord), metal and tense passages in film music.",
    vamp: "i° and ♭II",
    examples: ["Used for tension rather than whole songs"],
    tip: "Play it over a minor 7 flat 5 chord, for example Bm7♭5 for B Locrian, and listen for the unsettled flat 5.",
  },
];

export const modeBySlug = (id: string) => MODES.find((m) => m.id === id);
export const modePath = (m: Mode) => `/modes/${m.id}/`;
export const rootModesPath = (r: Root) => `/modes/${r.slug}/`;
export const modeAnchor = (r: Root, m: Mode) => `${r.slug}-${m.id}`;
export const rootPc = (r: Root) => ROOTS.findIndex((x) => x.slug === r.slug);

const IONIAN = MODES[0].steps;

/** The eight notes of a mode (the root again at the end), as pitch classes. */
export const scalePcs = (root: number, m: Mode): number[] => [...m.steps, 12].map((s) => (root + s) % 12);
/** The notes of a mode, written out. */
export const scaleNames = (root: number, m: Mode, acc: Accidental = "sharp") => scalePcs(root, m).map((pc) => noteName(pc, acc));
/** Which of the seven notes differ from the major scale on the same root (true where a note has been raised or lowered). */
export const alteredNotes = (m: Mode): boolean[] => [...m.steps.map((s, i) => s !== IONIAN[i]), false];
/** The root of the major scale that has the same notes as this mode on this root. */
export const parentRoot = (root: number, m: Mode) => (root - m.parent + 12) % 12;
/** The same notes as a MIDI note list from the middle C octave, for a keyboard drawing. */
export const scaleMidi = (root: number, m: Mode): number[] => m.steps.map((s) => 60 + root + s).concat(60 + root + 12);

export interface ModeChord {
  degree: number; // 1 to 7
  roman: string; // I, ii, iii°...
  note: number; // the pitch class the chord is built on
  triad: { kind: Kind; label: string; flat: string; href: string };
  seventh: { kind: Kind; label: string; flat: string; href: string };
}

const kindOf = (suffix: string) => KINDS.find((k) => k.suffix === suffix)!;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** The triad and the seventh chord on each note of a mode, built by stacking thirds from the mode's own notes. */
export function modeChords(root: number, m: Mode): ModeChord[] {
  const pcs = m.steps.map((s) => (root + s) % 12);
  return pcs.map((pc, i) => {
    const at = (n: number) => (pcs[(i + n) % 7] - pc + 12) % 12;
    const third = at(2);
    const fifth = at(4);
    const seventh = at(6);
    const triadSuffix = third === 4 && fifth === 7 ? "" : third === 3 && fifth === 7 ? "m" : third === 3 && fifth === 6 ? "dim" : "aug";
    const seventhSuffix =
      triadSuffix === "" ? (seventh === 11 ? "maj7" : "7") : triadSuffix === "m" ? "m7" : triadSuffix === "dim" ? (seventh === 10 ? "m7b5" : "dim7") : "7#5";
    const roman = ROMAN[i];
    const symbol = triadSuffix === "" ? roman : triadSuffix === "m" ? roman.toLowerCase() : triadSuffix === "dim" ? roman.toLowerCase() + "°" : roman + "+";
    const r = ROOTS[pc];
    const flatRoot = FLAT[pc];
    const make = (suffix: string) => {
      const kind = kindOf(suffix);
      return { kind, label: chordLabel(r, kind), flat: flatRoot + kind.suffix.replace("#5", "♯5").replace("b5", "♭5"), href: chordPath("guitar", r, kind) };
    };
    return { degree: i + 1, roman: symbol, note: pc, triad: make(triadSuffix), seventh: make(seventhSuffix) };
  });
}

/** "C D E F G A B C" with the changed notes marked, for a sentence. */
export const notesText = (root: number, m: Mode, acc: Accidental = "sharp") => scaleNames(root, m, acc).join(" ");

export const rootWords = (r: Root) => r.short;
