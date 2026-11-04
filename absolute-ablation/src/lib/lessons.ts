// The lessons of the Learn section: short, plain guides to reading chord diagrams, learning the first chords and the ideas behind them.
// Each lesson is a list of blocks (paragraphs, lists, tables, chord diagrams drawn at build time and the strumming tiles), so a lesson
// page is made the same way as every other chart page. The tables for keys, capos and barre chords are worked out here from the notes.
import { ROOTS, type InstrumentKey } from "./chordCatalog";

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "list"; items: string[] }
  | { type: "chords"; instrument: InstrumentKey; chords: string[]; caption?: string }
  | { type: "table"; head: string[]; rows: string[][]; caption?: string }
  | { type: "strum"; rows: { name: string; slots: string[]; note: string }[] };

export interface Lesson {
  slug: string;
  title: string;
  summary: string; // one line, for the lists
  description: string; // the meta description
  instruments: InstrumentKey[]; // who it is for (empty: everybody)
  level: "Beginner" | "Next step";
  minutes: number;
  blocks: Block[];
  related: string[]; // slugs of lessons to read next
}

const flatName = (index: number) => ROOTS[((index % 12) + 12) % 12].short;

// ---- tables worked out from the notes ----------------------------------------------------------------------------------------

/** The seven chords of each major key (I ii iii IV V vi vii°) and of each natural minor key (i ii° III iv v VI VII). */
function keysTable(minor: boolean): { head: string[]; rows: string[][] } {
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const kinds = minor ? ["m", "dim", "", "m", "m", "", ""] : ["", "m", "m", "", "", "m", "dim"];
  const head = minor ? ["Key", "i", "ii°", "III", "iv", "v", "VI", "VII"] : ["Key", "I", "ii", "iii", "IV", "V", "vi", "vii°"];
  const rows = ROOTS.map((root, i) => [`${root.short}${minor ? " minor" : " major"}`, ...steps.map((s, n) => `${flatName(i + s)}${kinds[n]}`)]);
  return { head, rows };
}

/** With a capo on fret N, the shapes of one key sound like another: shape key + N half steps. */
function capoTable(): { head: string[]; rows: string[][] } {
  const shapes = ["C", "G", "D", "A", "E"];
  const rows = Array.from({ length: 8 }, (_, capo) => [capo === 0 ? "No capo" : `Capo ${capo}`, ...shapes.map((s) => flatName(ROOTS.findIndex((r) => r.name === s) + capo))]);
  return { head: ["Capo", ...shapes.map((s) => `Play ${s} shapes`)], rows };
}

/** Barre chords slide up the neck: the E shape names its chord by the fret on the low E string, the A shape by the fret on the A string. */
function barreTable(): { head: string[]; rows: string[][] } {
  const e = ROOTS.findIndex((r) => r.name === "E");
  const a = ROOTS.findIndex((r) => r.name === "A");
  const rows = Array.from({ length: 12 }, (_, i) => [`Fret ${i + 1}`, flatName(e + i + 1), flatName(a + i + 1)]);
  return { head: ["Barre at", "E shape (root on the low E string)", "A shape (root on the A string)"], rows };
}

export const LESSONS: Lesson[] = [
  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "read-chord-diagrams",
    title: "How to read a chord diagram",
    summary: "Strings, frets, dots, circles and crosses: what every part of a guitar, ukulele, mandolin or piano diagram means.",
    description: "How to read a chord diagram for guitar, ukulele, mandolin and piano: strings, frets, finger numbers, open and muted strings, barres and keyboard diagrams.",
    instruments: [],
    level: "Beginner",
    minutes: 4,
    related: ["beginner-guitar-chords", "major-minor-and-seventh-chords", "piano-chords-and-inversions"],
    blocks: [
      { type: "p", text: "A chord diagram is a small picture of the instrument that shows where to put your fingers. Once you can read one, you can play any chord from any chart. The idea is the same on every stringed instrument; the piano has its own kind of picture." },
      { type: "h", text: "Guitar" },
      { type: "p", text: "Imagine the neck stood upright. The six vertical lines are the strings, with the lowest, thickest E on the left and the highest E on the right. The horizontal lines are the frets, and the thick line at the top is the nut (where the neck begins)." },
      { type: "list", items: ["A dot is where a finger presses, on the string and between the two frets it sits in.", "The number on a dot is the finger: 1 is the index finger, 2 the middle, 3 the ring and 4 the little finger.", "A circle above a string means play it open, without pressing anything. A cross means do not play that string.", "A bar across several strings is a barre: one finger laid across them all.", "A number beside the diagram, when it is not 1, is the fret the shape starts at, for a chord played higher up the neck."] },
      { type: "chords", instrument: "guitar", chords: ["C"], caption: "C major on guitar: the 3rd fret of the A string with finger 3, the 2nd fret of the D string with finger 2, the 1st fret of the B string with finger 1. The low E string is not played, and the G and high E strings are open." },
      { type: "h", text: "Ukulele and mandolin" },
      { type: "p", text: "They read the same way, with four lines instead of six. A ukulele has four strings, G C E A. A mandolin has four pairs of strings, G D A E, drawn as four lines because both strings of a pair are pressed together." },
      { type: "chords", instrument: "ukulele", chords: ["C", "Am"], caption: "On ukulele, C is one finger: the 3rd fret of the A string. Am is one finger too: the 2nd fret of the G string." },
      { type: "h", text: "Piano" },
      { type: "p", text: "A piano chord is a keyboard with the keys to press together lit. On Chord Suno the root of the chord is violet, the other notes are amber, and every pressed key is named. The same chord can be played in different orders (inversions): the page about piano chords explains them." },
      { type: "chords", instrument: "piano", chords: ["C", "Am"] },
      { type: "h", text: "Reading chord names" },
      { type: "list", items: ["C is C major: the plain chord. Cm (or C minor) is minor, a sadder sound.", "C7 is a dominant 7th, Cmaj7 a major 7th and Cm7 a minor 7th: they add a seventh note.", "Csus2 and Csus4 swap the third for the second or fourth.", "C/E is C with E in the bass: play the chord C, with E as the lowest note."] },
      { type: "p", text: "When you open a song in the player, every chord is drawn like this, on the beat, and you can step through other ways to play it." },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "beginner-guitar-chords",
    title: "The first guitar chords to learn",
    summary: "Em, Am, E, A, D, C, G and Dm, in the order that makes them easiest, and four progressions that play hundreds of songs.",
    description: "The first guitar chords for beginners: Em, Am, E, A, D, C, G and Dm with diagrams, the best order to learn them, and four easy chord progressions.",
    instruments: ["guitar"],
    level: "Beginner",
    minutes: 6,
    related: ["read-chord-diagrams", "strumming-patterns-for-beginners", "barre-chords"],
    blocks: [
      { type: "p", text: "You do not need many chords to play real songs. A handful of open chords, shapes that use open strings and the first three frets, will play a very large part of the music you know. Here they are." },
      { type: "chords", instrument: "guitar", chords: ["Em", "Am", "E", "A", "D", "C", "G", "Dm"] },
      { type: "h", text: "A good order to learn them" },
      { type: "list", items: ["Em and Am first. They need only two or three fingers and sound good right away.", "Then E, which is Em with one more finger, and A.", "Then D and G, and C last: C asks for a stretch, so it is worth learning once the others feel easy.", "Dm when you are ready: it is the minor chord that goes with D."] },
      { type: "h", text: "Four progressions to practise" },
      { type: "list", items: ["G – C – D: the classic three-chord song (the I, IV and V of G major).", "Em – C – G – D: the same four chords as a loop in G major (vi, IV, I, V).", "Am – F – C – G: a loop in C major (vi, IV, I, V). F is a barre chord; play it as a small barre across the first two strings while you learn the full one.", "C – G – Am – F: the same four chords in another order, in C major (I, V, vi, IV)."] },
      { type: "h", text: "Tips that save weeks" },
      { type: "list", items: ["Tune up first. A guitar that is out of tune makes every chord sound wrong. The free tuner in the Toolkit listens through your microphone.", "Press just behind the fret, with the tip of your finger, and keep your thumb behind the neck.", "Change chords slowly and evenly before you try to change them fast. Use the metronome in the Toolkit, and speed up a little at a time.", "Pick the strings of a chord one by one to find any that buzz or do not ring.", "When you can play a chord, look it up on the chord chart: most chords have two or three other ways to play them."] },
      { type: "p", text: "To play along with a real song, search for it on Chord Suno. The player shows every chord on the beat, slows the song down and loops the hard change." },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "barre-chords",
    title: "Barre chords: the shapes that move up the neck",
    summary: "Learn two shapes, the E shape and the A shape, and you can play every major and minor chord anywhere on the neck.",
    description: "How to play barre chords on guitar: the E shape and the A shape, how to name any barre chord from its fret, and how to build the strength to play them.",
    instruments: ["guitar"],
    level: "Next step",
    minutes: 6,
    related: ["beginner-guitar-chords", "major-minor-and-seventh-chords", "capo-and-transposing"],
    blocks: [
      { type: "p", text: "A barre chord is a chord with no open strings, so the whole shape can slide up the neck. One finger, usually the index, lies across all the strings as a movable nut, and the other fingers make the shape. Learn two shapes and you can play every major and minor chord." },
      { type: "h", text: "The E shape" },
      { type: "p", text: "This is the open E chord moved up the neck: your other three fingers form the E shape and the index finger takes over the job of the open strings. The chord is named after the fret where the barre is, on the low E string: barre at the 1st fret and you have F." },
      { type: "chords", instrument: "guitar", chords: ["F", "F#", "G#"], caption: "The E shape at the 1st, 2nd and 4th frets: F, F♯ and G♯. (At the 3rd fret the E shape is G; the chart shows the open G first, because it is easier, and the barre G among its other ways to play.)" },
      { type: "h", text: "The A shape" },
      { type: "p", text: "This is the open A chord moved up the neck, with the root on the A string. A barre at the 2nd fret is B; at the 3rd fret it is C." },
      { type: "chords", instrument: "guitar", chords: ["A#", "B", "Bm"], caption: "The A shape: A♯ at the 1st fret, then B and Bm at the 2nd." },
      { type: "h", text: "Every chord on the neck" },
      { type: "p", text: "Move either shape up one fret and the chord goes up one half step. Learn the names of the notes on the low E string and the A string and you can find any chord." },
      { type: "table", head: barreTable().head, rows: barreTable().rows, caption: "The major chord a barre makes, by fret. For a minor chord, use the minor version of the same shape (Em shape or Am shape) at the same fret." },
      { type: "h", text: "Building the strength" },
      { type: "list", items: ["Press with the bony side of your index finger, not the soft pad, and keep it close to the fret.", "Bring your elbow in and let the weight of your arm help the thumb behind the neck.", "Start high up the neck, around the 5th fret, where the strings are easier to press, then work down toward the nut.", "Play each string in turn to find the ones that buzz, and adjust your finger until all ring out.", "Practise for a few minutes at a time. It gets easier within a few weeks."] },
      { type: "p", text: "In the chord chart every chord is shown in other places on the neck, so you can see the barre shapes for it." },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "major-minor-and-seventh-chords",
    title: "Major, minor and 7th chords",
    summary: "What a chord is made of, and the formulas behind major, minor, 7th, major 7th, minor 7th, sus and diminished chords.",
    description: "What makes a chord major, minor or a 7th chord: the notes and formulas of major, minor, dominant 7th, major 7th, minor 7th, sus2, sus4, diminished and augmented chords.",
    instruments: [],
    level: "Next step",
    minutes: 7,
    related: ["read-chord-diagrams", "chords-in-a-key", "piano-chords-and-inversions"],
    blocks: [
      { type: "p", text: "A chord is three or more notes played together. Every kind of chord is built from the notes of a major scale, counted from the root: the root is 1, the next note of the scale is 2, then 3, 4, 5, 6 and 7. A flat (♭) lowers a note by a half step and a sharp (♯) raises it." },
      { type: "h", text: "Major and minor: the third decides" },
      { type: "p", text: "The basic chord, a triad, is the root, a third and a fifth. If the third is the note of the major scale, the chord is major (1 3 5): bright and plain. Lower the third by a half step and it is minor (1 ♭3 5): sadder and softer. C major is C E G; C minor is C E♭ G." },
      { type: "h", text: "Adding a seventh" },
      { type: "p", text: "A seventh chord adds a fourth note, a seventh above the root. Which seventh, and which triad it goes on, gives each its sound." },
      {
        type: "table",
        head: ["Chord", "Formula", "Notes (on C)", "Sound"],
        rows: [
          ["C (major)", "1 3 5", "C E G", "Bright and plain"],
          ["Cm (minor)", "1 ♭3 5", "C E♭ G", "Sad, soft"],
          ["C7 (dominant 7th)", "1 3 5 ♭7", "C E G B♭", "Bluesy; pulls to F"],
          ["Cmaj7 (major 7th)", "1 3 5 7", "C E G B", "Smooth, dreamy"],
          ["Cm7 (minor 7th)", "1 ♭3 5 ♭7", "C E♭ G B♭", "Mellow"],
          ["Csus2 (suspended 2nd)", "1 2 5", "C D G", "Open, airy"],
          ["Csus4 (suspended 4th)", "1 4 5", "C F G", "Hangs, then settles"],
          ["Cdim (diminished)", "1 ♭3 ♭5", "C E♭ G♭", "Tense"],
          ["Caug (augmented)", "1 3 ♯5", "C E G♯", "Dreamy, restless"],
          ["C6 (6th)", "1 3 5 6", "C E G A", "Sweet, relaxed"],
        ],
        caption: "The common kinds of chord, shown on C. The same formulas work on every note.",
      },
      { type: "h", text: "Reading the names" },
      { type: "list", items: ["No letters after the note means major: C.", "A small m, or the word minor, means minor: Am.", "A plain 7 means a dominant 7th: G7. The word major (or maj) before it makes it a major 7th: Gmaj7.", "Sus means the third is replaced: sus2 for the second, sus4 for the fourth.", "Dim and aug are the diminished and augmented chords. A number after, such as 9 or 13, stacks more notes on top."] },
      { type: "p", text: "Every kind in the table has a diagram for every note on the chord charts for guitar, piano, ukulele and mandolin, with its notes and formula." },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "piano-chords-and-inversions",
    title: "Piano chords and inversions",
    summary: "Triads, root position and inversions, and how to move between chords with the smallest steps.",
    description: "Piano chords for beginners: how triads work, root position and inversions of C, Am, F and G, and how to change between chords smoothly.",
    instruments: ["piano"],
    level: "Beginner",
    minutes: 6,
    related: ["major-minor-and-seventh-chords", "chords-in-a-key", "read-chord-diagrams"],
    blocks: [
      { type: "p", text: "On the piano a chord is the keys you press together. The simplest chords are triads: three notes, the root, the third and the fifth. Press them with the first, third and fifth fingers of your right hand and you are playing a chord." },
      { type: "chords", instrument: "piano", chords: ["C", "G", "Am", "F"], caption: "C, G, Am and F in root position: the root is violet, the other notes amber." },
      { type: "h", text: "Root position and inversions" },
      { type: "p", text: "A triad can be played with any of its three notes at the bottom. With the root at the bottom it is in root position. Move the bottom note up to the top and you have first inversion; do it again for second inversion. They are the same chord, with the same name, and sound like it; only the order of the notes changes." },
      { type: "list", items: ["C in root position: C E G.", "C in first inversion: E G C.", "C in second inversion: G C E."] },
      { type: "chords", instrument: "piano", chords: ["C"], caption: "Use the arrows in the player to step through the inversions of any chord. On the chord charts every chord shows its root position and inversions." },
      { type: "h", text: "Why inversions matter" },
      { type: "p", text: "Without inversions your hand would jump to the root position of every chord. With them it stays in one place. Take C to F: instead of moving the whole hand, play F in second inversion, C F A. The C stays where it is, and the other two notes move up a step." },
      { type: "list", items: ["C (C E G) to Am (C E A): only one note moves. C and E stay.", "C (C E G) to F in second inversion (C F A): C stays; E and G each move up one step.", "G in first inversion (B D G) sits right next to C (C E G), so the change from G to C is a small move too."] },
      { type: "h", text: "Left hand" },
      { type: "p", text: "A common way to play a song is the chord in the right hand and the root of the chord in the left hand, an octave or two lower. A chord written over a note, such as C/E, tells you to put that note in the bass." },
      { type: "p", text: "Choose Piano in the player and every chord of a song is drawn on a keyboard, with its inversions one tap away. Your choice is remembered on your account." },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "chords-in-a-key",
    title: "Chords in a key",
    summary: "Why some chords belong together, the Roman numerals players use, and a table of the chords of all twelve keys.",
    description: "Chords in a key explained: the seven chords of every major and minor key, Roman numerals, and the common progressions such as I–V–vi–IV, with a table for all 12 keys.",
    instruments: [],
    level: "Next step",
    minutes: 8,
    related: ["major-minor-and-seventh-chords", "capo-and-transposing", "beginner-guitar-chords"],
    blocks: [
      { type: "p", text: "Most songs use a small family of chords that belong to a key. Build a triad on each of the seven notes of a major scale, using only the notes of that scale, and you get seven chords: three major, three minor and one diminished. These are the chords of the key." },
      { type: "h", text: "The pattern" },
      { type: "list", items: ["I, IV and V are major.", "ii, iii and vi are minor.", "vii° is diminished.", "In C major: C, Dm, Em, F, G, Am and Bdim."] },
      { type: "p", text: "Players name chords by these numbers (the Roman numerals) so a progression can be moved to any key. A song that goes I – V – vi – IV is C – G – Am – F in C major and G – D – Em – C in G major." },
      { type: "h", text: "Progressions you will meet everywhere" },
      { type: "list", items: ["I – IV – V: the three-chord song and the twelve-bar blues (with 7th chords).", "I – V – vi – IV: the pop progression behind a very long list of songs.", "vi – IV – I – V: the same four chords, starting on the minor chord.", "ii – V – I: the standard resolution in jazz.", "I – vi – IV – V: the 1950s progression."] },
      { type: "h", text: "The chords of every major key" },
      { type: "table", head: keysTable(false).head, rows: keysTable(false).rows, caption: "Black-key notes are shown with sharps, as the player does; C♯ and D♭ are the same pitch." },
      { type: "h", text: "Minor keys" },
      { type: "p", text: "A minor key uses the same chords as its relative major, starting from a different place. A minor has the same seven chords as C major, with Am as the home chord. In the natural minor scale the chords are i, ii°, III, iv, v, VI and VII." },
      { type: "table", head: keysTable(true).head, rows: keysTable(true).rows },
      { type: "p", text: "Chord Suno shows the key of every song it analyses, so you can see which of these chords to expect. The chord charts show every chord of a key as a diagram, on the page of its note." },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "capo-and-transposing",
    title: "Capo and transposing",
    summary: "How a capo changes the key, how to pick the easiest shapes for a song, and how transposing works.",
    description: "How a guitar capo works: the key a capo gives for each set of chord shapes, how to choose a capo fret to suit your voice, and how transposing a song changes its chords.",
    instruments: ["guitar", "ukulele", "mandolin"],
    level: "Next step",
    minutes: 6,
    related: ["chords-in-a-key", "barre-chords", "beginner-guitar-chords"],
    blocks: [
      { type: "p", text: "A capo is a clamp that holds down all the strings at one fret. It acts as a new nut: every open string now sounds higher, so the same chord shapes sound in a higher key. With a capo on the 2nd fret, the open C shape sounds as D." },
      { type: "h", text: "The rule" },
      { type: "p", text: "The key you hear is the key of the shape plus the capo fret, counted in half steps. Capo 3 and G shapes: G up three half steps is B♭. So a song in B♭ can be played with easy G shapes and a capo at the 3rd fret, and a song in a hard key can be played with the shapes you know." },
      { type: "table", head: capoTable().head, rows: capoTable().rows, caption: "The key you hear, for the shape you play and the fret the capo is on. Black-key notes are shown with sharps." },
      { type: "h", text: "Choosing a capo fret" },
      { type: "list", items: ["Pick the key of the song, or the key that suits your voice if the original is too high or low.", "Find a row and column of the table that gives that key, using shapes you can play (C, G, D, A or E).", "Put the capo on that fret and play the shapes. The lowest fret that gives you easy shapes is usually best, because the strings are easier to press and the sound is fuller."] },
      { type: "h", text: "Transposing" },
      { type: "p", text: "Transposing moves every chord of a song by the same number of half steps, so the song is higher or lower but its shape is unchanged. Everyone moves a song to suit their voice: the chords in C – G – Am – F become D – A – Bm – G two half steps up." },
      { type: "p", text: "In the Chord Suno player, Transpose changes the chord names and the diagrams for the key you choose. The Capo control tells you the shapes to play with the capo on a fret: the names stay in the key you hear, and the diagrams show the shapes under your fingers." },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  {
    slug: "strumming-patterns-for-beginners",
    title: "Strumming patterns for beginners",
    summary: "Counting a bar, down and up strokes, and four patterns to start with, from one strum a beat to the pop standard.",
    description: "Strumming patterns for beginners on guitar and ukulele: how to count a bar, down and up strokes, and four easy patterns to learn first.",
    instruments: ["guitar", "ukulele", "mandolin"],
    level: "Beginner",
    minutes: 5,
    related: ["beginner-guitar-chords", "capo-and-transposing", "read-chord-diagrams"],
    blocks: [
      { type: "p", text: "A strumming pattern is the rhythm your hand plays on the strings. Most songs are counted in fours: 1, 2, 3, 4, with an “and” between each beat, so a bar is “1 & 2 & 3 & 4 &”. Each of those eight slots is a chance to strum down, strum up, or let it ring." },
      { type: "h", text: "The one rule" },
      { type: "p", text: "Keep your hand moving, down on the numbers and up on the “ands”, and keep it moving even when you do not strike the strings. Miss a stroke and let your hand pass through the air; do not stop it. That is what keeps the rhythm steady." },
      {
        type: "strum",
        rows: [
          { name: "Steady down-strums", slots: ["D", "-", "D", "-", "D", "-", "D", "-"], note: "One strum on every beat. The easiest pattern, and the “easy version” in the Chord Suno player." },
          { name: "Down and up", slots: ["D", "U", "D", "U", "D", "U", "D", "U"], note: "A stroke on every slot. Keep the up-strokes light." },
          { name: "The pop strum", slots: ["D", "-", "D", "U", "-", "U", "D", "U"], note: "Down, down-up, up, down-up: the pattern behind a huge number of songs." },
          { name: "A common ballad pattern", slots: ["D", "-", "D", "-", "D", "U", "D", "-"], note: "Mostly down-strums with one up-stroke before the last beat." },
        ],
      },
      { type: "h", text: "How to practise" },
      { type: "list", items: ["Start on one chord, with the strings muted by your fretting hand, so you only listen to the rhythm.", "Say the count out loud: “1 & 2 & 3 & 4 &”.", "Use the metronome in the Toolkit at a slow tempo and speed up a little at a time.", "Add a chord change at the start of the bar, then in the middle.", "Keep the strum light: your wrist does the work, not your arm."] },
      { type: "p", text: "In the Chord Suno player, the Strum view shows the strumming pattern of the song you are playing, with the stroke that is sounding lit as the song plays, and an easy version to start with. Down-strokes and up-strokes cannot be heard in a recording, so the pattern shows the usual picture: down on the beat, up on the “and”." },
    ],
  },
];

export const lessonBySlug = (slug: string) => LESSONS.find((l) => l.slug === slug);
