// What the chord chart pages are made of: the twelve notes, the kinds of chord, the four instruments, and the addresses of every page.
// Pure data and small helpers (the chart search in the browser uses `resolveChord`), so nothing heavy is shipped with it; the diagrams
// themselves are made at build time (chordCharts.ts).
import { canonicalSuffix } from "./chordShapes";

export type InstrumentKey = "guitar" | "piano" | "ukulele" | "mandolin";

export interface Root {
  name: string; // as the site names it (sharps): "C#"
  short: string; // "C♯"
  label: string; // "C♯ / D♭" (the other name of a black key)
  slug: string; // "c-sharp"
  words: string; // for titles: "C Sharp (D Flat)"
}

export const ROOTS: Root[] = [
  { name: "C", short: "C", label: "C", slug: "c", words: "C" },
  { name: "C#", short: "C♯", label: "C♯ / D♭", slug: "c-sharp", words: "C Sharp (D Flat)" },
  { name: "D", short: "D", label: "D", slug: "d", words: "D" },
  { name: "D#", short: "D♯", label: "D♯ / E♭", slug: "d-sharp", words: "D Sharp (E Flat)" },
  { name: "E", short: "E", label: "E", slug: "e", words: "E" },
  { name: "F", short: "F", label: "F", slug: "f", words: "F" },
  { name: "F#", short: "F♯", label: "F♯ / G♭", slug: "f-sharp", words: "F Sharp (G Flat)" },
  { name: "G", short: "G", label: "G", slug: "g", words: "G" },
  { name: "G#", short: "G♯", label: "G♯ / A♭", slug: "g-sharp", words: "G Sharp (A Flat)" },
  { name: "A", short: "A", label: "A", slug: "a", words: "A" },
  { name: "A#", short: "A♯", label: "A♯ / B♭", slug: "a-sharp", words: "A Sharp (B Flat)" },
  { name: "B", short: "B", label: "B", slug: "b", words: "B" },
];

export const rootBySlug = (slug: string) => ROOTS.find((r) => r.slug === slug);
export const rootByName = (name: string) => ROOTS.find((r) => r.name === name);

export interface Kind {
  suffix: string; // what follows the note: "", "m", "7", "maj7"...
  id: string; // the anchor on a page
  group: string;
  name: string; // "minor 7th"
  nameShort: string; // for a heading after the note: "minor 7th" -> "C minor 7th"
  formula: string; // the scale degrees it is built from
  text: string; // how it sounds and where it is used
}

export const GROUPS: { id: string; title: string; text: string }[] = [
  { id: "basic", title: "Basic chords", text: "Major, minor and the two-note power chord: the chords nearly every song is built from." },
  { id: "sixths", title: "6th chords", text: "A major or minor chord with the sixth added: warm and a little old-fashioned." },
  { id: "sevenths", title: "7th chords", text: "Four-note chords that add a seventh. They colour a progression and pull toward the next chord." },
  { id: "suspended", title: "Suspended, diminished and augmented", text: "Chords that leave the third out or bend the fifth: unsettled, tense or dreamy." },
  { id: "extended", title: "9th, 11th and 13th chords", text: "Extended chords, which stack more notes above the seventh. Common in jazz, soul, funk and R&B." },
];

export const KINDS: Kind[] = [
  { suffix: "", id: "major", group: "basic", name: "major", nameShort: "major", formula: "1 3 5", text: "The bright, plain chord: the root, the third and the fifth. Most songs are built on major chords." },
  { suffix: "m", id: "minor", group: "basic", name: "minor", nameShort: "minor", formula: "1 ♭3 5", text: "A major chord with a lowered third: a sadder, softer sound. Written with a small “m”." },
  { suffix: "5", id: "power", group: "basic", name: "power chord", nameShort: "power chord (5)", formula: "1 5", text: "Just the root and the fifth, with no third, so it is neither major nor minor. The backbone of rock and punk guitar." },
  { suffix: "6", id: "sixth", group: "sixths", name: "6th", nameShort: "6th", formula: "1 3 5 6", text: "A major chord with the sixth added: sweet and relaxed, often used to end a song." },
  { suffix: "m6", id: "minor-sixth", group: "sixths", name: "minor 6th", nameShort: "minor 6th", formula: "1 ♭3 5 6", text: "A minor chord with the sixth added: a little mysterious, common in jazz and film music." },
  { suffix: "7", id: "seventh", group: "sevenths", name: "dominant 7th", nameShort: "7th", formula: "1 3 5 ♭7", text: "A major chord with a flat seventh added: bluesy, and it pulls strongly toward the chord a fifth below." },
  { suffix: "maj7", id: "major-seventh", group: "sevenths", name: "major 7th", nameShort: "major 7th", formula: "1 3 5 7", text: "A major chord with the seventh a half step below the root: smooth and dreamy." },
  { suffix: "m7", id: "minor-seventh", group: "sevenths", name: "minor 7th", nameShort: "minor 7th", formula: "1 ♭3 5 ♭7", text: "A minor chord with a flat seventh added: mellow, and very common in soul, pop and jazz." },
  { suffix: "mMaj7", id: "minor-major-seventh", group: "sevenths", name: "minor major 7th", nameShort: "minor major 7th", formula: "1 ♭3 5 7", text: "A minor chord with a major seventh: dark and tense, a classic sound in film and spy themes." },
  { suffix: "m7b5", id: "half-diminished", group: "sevenths", name: "half-diminished (minor 7th flat 5)", nameShort: "half-diminished", formula: "1 ♭3 ♭5 ♭7", text: "A minor 7th with a flat fifth. It is the chord on the seventh step of a major key and leads into minor chords." },
  { suffix: "dim7", id: "diminished-seventh", group: "sevenths", name: "diminished 7th", nameShort: "diminished 7th", formula: "1 ♭3 ♭5 ♭♭7", text: "Four notes a minor third apart: very tense and symmetrical, used to move between keys." },
  { suffix: "7sus4", id: "seventh-sus4", group: "sevenths", name: "7th suspended 4th", nameShort: "7sus4", formula: "1 4 5 ♭7", text: "A dominant 7th with the fourth in place of the third: open and unresolved." },
  { suffix: "7b5", id: "seventh-flat5", group: "sevenths", name: "7th flat 5", nameShort: "7♭5", formula: "1 3 ♭5 ♭7", text: "A dominant 7th with a flattened fifth: crunchy and jazzy." },
  { suffix: "7#5", id: "seventh-sharp5", group: "sevenths", name: "augmented 7th (7th sharp 5)", nameShort: "7♯5", formula: "1 3 ♯5 ♭7", text: "A dominant 7th with a raised fifth: restless, leaning hard toward the next chord." },
  { suffix: "sus2", id: "sus2", group: "suspended", name: "suspended 2nd", nameShort: "suspended 2nd", formula: "1 2 5", text: "The third is replaced by the second: open and airy, neither major nor minor." },
  { suffix: "sus4", id: "sus4", group: "suspended", name: "suspended 4th", nameShort: "suspended 4th", formula: "1 4 5", text: "The third is replaced by the fourth: it hangs and usually settles back to the major chord." },
  { suffix: "dim", id: "diminished", group: "suspended", name: "diminished", nameShort: "diminished", formula: "1 ♭3 ♭5", text: "Two stacked minor thirds: tense, used to pass from one chord to the next." },
  { suffix: "aug", id: "augmented", group: "suspended", name: "augmented", nameShort: "augmented", formula: "1 3 ♯5", text: "A major chord with a raised fifth: dreamy and restless." },
  { suffix: "9", id: "ninth", group: "extended", name: "dominant 9th", nameShort: "9th", formula: "1 3 5 ♭7 9", text: "A dominant 7th with the ninth added: rich and funky." },
  { suffix: "m9", id: "minor-ninth", group: "extended", name: "minor 9th", nameShort: "minor 9th", formula: "1 ♭3 5 ♭7 9", text: "A minor 7th with the ninth added: smooth and warm, a staple of neo-soul." },
  { suffix: "maj9", id: "major-ninth", group: "extended", name: "major 9th", nameShort: "major 9th", formula: "1 3 5 7 9", text: "A major 7th with the ninth added: lush and open." },
  { suffix: "add9", id: "add9", group: "extended", name: "add 9", nameShort: "add9", formula: "1 3 5 9", text: "A major chord with the ninth added and no seventh: bright and shimmering." },
  { suffix: "madd9", id: "minor-add9", group: "extended", name: "minor add 9", nameShort: "minor add9", formula: "1 ♭3 5 9", text: "A minor chord with the ninth added: wistful." },
  { suffix: "7b9", id: "seventh-flat9", group: "extended", name: "7th flat 9", nameShort: "7♭9", formula: "1 3 5 ♭7 ♭9", text: "A dominant 7th with a flat ninth: dark and dramatic, often used before a minor chord." },
  { suffix: "7#9", id: "seventh-sharp9", group: "extended", name: "7th sharp 9", nameShort: "7♯9", formula: "1 3 5 ♭7 ♯9", text: "A dominant 7th with a sharp ninth: the “Hendrix chord”, gritty and bluesy." },
  { suffix: "11", id: "eleventh", group: "extended", name: "dominant 11th", nameShort: "11th", formula: "1 3 5 ♭7 9 11", text: "A dominant 9th with the eleventh added. On most instruments some notes are left out." },
  { suffix: "m11", id: "minor-eleventh", group: "extended", name: "minor 11th", nameShort: "minor 11th", formula: "1 ♭3 5 ♭7 9 11", text: "A minor 9th with the eleventh added: deep and spacious." },
  { suffix: "13", id: "thirteenth", group: "extended", name: "dominant 13th", nameShort: "13th", formula: "1 3 5 ♭7 9 13", text: "A dominant 9th with the thirteenth added: the full, big-band dominant chord. Some notes are left out when played." },
];

/** The notes of a chord built on C, spelled as a musician writes them from its formula: "1 ♭3 5" is C E♭ G (not C D♯ G). */
export function spellOnC(formula: string): string {
  const scale: Record<string, string> = { "1": "C", "2": "D", "3": "E", "4": "F", "5": "G", "6": "A", "7": "B", "9": "D", "11": "F", "13": "A" };
  return formula
    .split(" ")
    .map((degree) => {
      const m = /^([♭♯]*)(\d+)$/.exec(degree);
      return m ? `${scale[m[2]] ?? "?"}${m[1]}` : degree;
    })
    .join(" ");
}

export const kindById = (id: string) => KINDS.find((k) => k.id === id);
export const kindBySuffix = (suffix: string) => KINDS.find((k) => k.suffix === suffix);
export const kindsOf = (group: string) => KINDS.filter((k) => k.group === group);

/** The kinds shown on a chart page (as a diagram for each of the twelve notes); the rest are on the page of each note. */
export const CHART_KINDS = ["major", "minor", "seventh", "major-seventh", "minor-seventh", "sus4", "diminished", "augmented"];

export interface InstrumentInfo {
  key: InstrumentKey;
  name: string; // "Guitar"
  chartPath: string; // "/guitar-chord-chart/"
  notesPath: string; // "/guitar-chords/" (a page for each note under it)
  strings: string | null; // how it is tuned, for the page text
  voicings: number; // ways to play each chord shown on a note's page
}

export const INSTRUMENTS: InstrumentInfo[] = [
  { key: "guitar", name: "Guitar", chartPath: "/guitar-chord-chart/", notesPath: "/guitar-chords/", strings: "E A D G B E", voicings: 3 },
  { key: "piano", name: "Piano", chartPath: "/piano-chord-chart/", notesPath: "/piano-chords/", strings: null, voicings: 3 },
  { key: "ukulele", name: "Ukulele", chartPath: "/ukulele-chord-chart/", notesPath: "/ukulele-chords/", strings: "G C E A", voicings: 3 },
  { key: "mandolin", name: "Mandolin", chartPath: "/mandolin-chord-chart/", notesPath: "/mandolin-chords/", strings: "G D A E", voicings: 3 },
];

export const instrumentInfo = (key: InstrumentKey) => INSTRUMENTS.find((i) => i.key === key)!;

/** The page with every chord of one note on an instrument: /guitar-chords/c-sharp/ */
export const notePath = (instrument: InstrumentKey, root: Root) => `${instrumentInfo(instrument).notesPath}${root.slug}/`;
/** The page of one chord on one instrument: /guitar-chords/c-sharp/minor-seventh/ (it has all the ways to play it, its notes and how to finger it) */
export const chordPath = (instrument: InstrumentKey, root: Root, kind: Kind) => `${notePath(instrument, root)}${kind.id}/`;
/** The same chord's place on the page of its note: /guitar-chords/c-sharp/#minor-seventh */
export const chordAnchorPath = (instrument: InstrumentKey, root: Root, kind: Kind) => `${notePath(instrument, root)}#${kind.id}`;

/** The chord as it is written: "C♯m7". */
export const chordLabel = (root: Root, kind: Kind) => `${root.short}${kind.suffix.replace("b", "♭").replace("#", "♯")}`;
/** The chord as the shape code names it: "C#m7". */
export const chordName = (root: Root, kind: Kind) => `${root.name}${kind.suffix}`;

const FLAT_TO_SHARP: Record<string, string> = { "C♭": "B", "D♭": "C#", "E♭": "D#", "F♭": "E", "G♭": "F#", "A♭": "G#", "B♭": "A#", "E#": "F", "B#": "C" };

/** What somebody typed into the chart search ("f#m7", "Bbmaj7", "A-7", "C/E") as a note and a kind of chord, or null. */
export function resolveChord(text: string): { root: Root; kind: Kind } | null {
  const typed = text.trim().replace(/\s+/g, "").replace(/♯/g, "#").replace(/♭/g, "b");
  const m = /^([A-Ga-g])([#b]?)([^/]*)(?:\/.*)?$/.exec(typed);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const written = letter + (accidental === "b" ? "♭" : accidental);
  const name = FLAT_TO_SHARP[written] ?? written.replace("♭", "b");
  const root = rootByName(name);
  if (!root) return null;
  const suffix = canonicalSuffix(m[3]);
  if (suffix === null) return null;
  const kind = kindBySuffix(suffix);
  return kind ? { root, kind } : null;
}

/** Every page the charts make, for the sitemap: the four charts, and a page for each note of each instrument. */
export function chartUrls(): string[] {
  return INSTRUMENTS.flatMap((i) => [i.chartPath, ...ROOTS.map((r) => notePath(i.key, r))]);
}
