// The words of the chart pages for each instrument: how to read its diagram, and the questions people ask. Everything said is something
// the site does today.
import type { InstrumentKey } from "./chordCatalog";

export interface Copy {
  chartTitle: string; // the <title> of the chart page
  chartDescription: string;
  h1: string;
  lead: string;
  howHeading: string;
  how: string;
  tuningNote: string;
  faq: { q: string; a: string }[];
}

export const COPY: Record<InstrumentKey, Copy> = {
  guitar: {
    chartTitle: "Guitar Chord Chart: Every Guitar Chord with Diagrams — Chord Suno",
    chartDescription: "A guitar chord chart with a diagram for every major, minor, 7th, sus, diminished and extended chord on all twelve notes, with other ways to play each one. Free.",
    h1: "Guitar chord chart: every guitar chord with a diagram",
    lead: "Every guitar chord on all twelve notes: major, minor, 6th, 7th, suspended, diminished, augmented and the extended 9th, 11th and 13th chords. Pick a note for all of its chords with other ways to play each, or search for one by name.",
    howHeading: "How to read a guitar chord diagram",
    how: "The six vertical lines are the strings, from the lowest, thickest E on the left to the highest E on the right. The horizontal lines are the frets, and the thick line at the top is the nut. A dot shows where to press and its number is the finger (1 is the index finger, 2 the middle, 3 the ring and 4 the little finger). A circle above a string means play it open and a cross means leave it out. When a shape sits higher up the neck, the number on the left is the fret it starts at, and a bar across several strings is a barre: one finger pressing all of them.",
    tuningNote: "Standard guitar tuning, low to high: E A D G B E.",
    faq: [
      { q: "What are the basic guitar chords for beginners?", a: "Em, Am, E, A, D, C and G, then Dm. These open chords use open strings and the first three frets, and they cover a very large number of songs. They are marked “easy” in the chart: switch on “Easy chords only” to see just those." },
      { q: "How many guitar chords are there?", a: "On the twelve notes, with the kinds of chord on this chart (major, minor, 6th, 7th, suspended, diminished, augmented and the extended chords), there are 336. Each can be played in several places on the neck; the page of each note shows up to three ways to play every chord." },
      { q: "What is the easiest way to learn guitar chords?", a: "Start with the open chords above, then learn the barre shapes, which move up the neck to give every other chord. The lessons in the Learn section walk through both, step by step." },
      { q: "Why does the chart show sharps and flats together?", a: "C♯ and D♭ are the same pitch. The chart names the chord with sharps (as the player does) and shows the other name beside it, because both are used in songs." },
      { q: "How can I find the guitar chords of a song?", a: "Search for the song on Chord Suno. Every chord of the song is shown on the beat, with a guitar diagram for each, other ways to play it, and the strumming pattern. Look any chord up here if you want to see all its shapes." },
    ],
  },
  piano: {
    chartTitle: "Piano Chord Chart: Every Piano Chord on the Keyboard — Chord Suno",
    chartDescription: "A piano chord chart with a keyboard diagram for every major, minor, 7th, sus, diminished and extended chord on all twelve notes, with their inversions. Free.",
    h1: "Piano chord chart: every piano chord on the keyboard",
    lead: "Every piano chord on all twelve notes, drawn on a keyboard with the keys to press named, and the inversions of each. Pick a note for all of its chords, or search for one by name.",
    howHeading: "How to read a piano chord diagram",
    how: "A chord on the piano is the keys you press together. On each keyboard the violet key is the root and the amber keys are the other notes, and every pressed key is named. The same chord can be played in root position, with the root at the bottom, or as an inversion, with another note at the bottom. They sound like the same chord, and choosing the inversion nearest your hand keeps the changes small.",
    tuningNote: "",
    faq: [
      { q: "What are the basic piano chords?", a: "C, G, Am, F, D, Em, A and Dm. Each is a triad: three notes, the root, the third and the fifth, played together. Learn C, Am, F and G first: they make the progression behind a long list of songs." },
      { q: "What is a chord inversion on piano?", a: "The same notes of a chord with a different one at the bottom. C is C E G in root position, E G C in first inversion and G C E in second inversion. Each page shows a chord in root position and its inversions." },
      { q: "How do I play a chord like C/E on piano?", a: "A chord written over a note, such as C/E, is the chord C with E in the bass. Play E with your left hand and the chord C with your right hand. In the player, a chord over a bass note shows exactly that." },
      { q: "Why does the chart show sharps and flats together?", a: "C♯ and D♭ are the same black key. The chart names the chord with sharps (as the player does) and shows the other name beside it, because both are used in songs." },
      { q: "How can I find the piano chords of a song?", a: "Search for the song on Chord Suno, then choose Piano in the player: every chord of the song is drawn on a keyboard, with its inversions." },
    ],
  },
  ukulele: {
    chartTitle: "Ukulele Chord Chart: Every Uke Chord with Diagrams — Chord Suno",
    chartDescription: "A ukulele chord chart with a diagram for every major, minor, 7th, sus, diminished and extended chord on all twelve notes, with other ways to play each. Free.",
    h1: "Ukulele chord chart: every uke chord with a diagram",
    lead: "Every ukulele chord on all twelve notes, in standard G C E A tuning: major, minor, 6th, 7th, suspended, diminished, augmented and the extended chords. Pick a note for all of its chords with other ways to play each, or search for one by name.",
    howHeading: "How to read a ukulele chord diagram",
    how: "The four vertical lines are the strings, left to right G, C, E, A. The horizontal lines are the frets, and the thick line at the top is the nut. A dot shows where to press and its number is the finger (1 is the index finger); a circle above a string means play it open. When a shape sits higher up the neck, a number on the left says which fret it starts at.",
    tuningNote: "Standard ukulele tuning: G C E A, with the G string tuned above the C. Soprano, concert and tenor ukuleles all use it.",
    faq: [
      { q: "What are the basic ukulele chords?", a: "C, Am, F and G cover a very large number of songs, followed by Dm, Em, D, A and the 7th chords C7, G7 and A7. They are marked “easy” in the chart." },
      { q: "How do I read a ukulele chord diagram?", a: "The four vertical lines are the strings, left to right G, C, E, A. A dot is where a finger presses, the number on it is the finger (1 is the index finger), and a circle above a string means it is played open." },
      { q: "What tuning are these ukulele chords in?", a: "Standard ukulele tuning: G C E A, with the G string tuned above the C. Soprano, concert and tenor ukuleles all use it. Baritone ukuleles are tuned D G B E and use the guitar shapes for the top four strings." },
      { q: "Are there other ways to play each chord?", a: "Yes. Every chord can be played in several places on the neck. The page of each note shows up to three ways to play every chord." },
      { q: "How can I find the ukulele chords of a song?", a: "Search for the song on Chord Suno. Every chord is shown on the beat with its key and tempo, and choosing Ukulele in the player draws every chord as a ukulele diagram." },
    ],
  },
  mandolin: {
    chartTitle: "Mandolin Chord Chart: Every Mandolin Chord with Diagrams — Chord Suno",
    chartDescription: "A mandolin chord chart with a diagram for every major, minor, 7th, sus, diminished and extended chord on all twelve notes, in G D A E tuning. Free.",
    h1: "Mandolin chord chart: every mandolin chord with a diagram",
    lead: "Every mandolin chord on all twelve notes, in standard G D A E tuning: major, minor, 6th, 7th, suspended, diminished, augmented and the extended chords. Pick a note for all of its chords with other ways to play each, or search for one by name.",
    howHeading: "How to read a mandolin chord diagram",
    how: "A mandolin has four pairs of strings, tuned G D A E from low to high, in fifths like a violin. A diagram shows one line for each pair, because both strings of a pair are pressed together. The horizontal lines are the frets and the thick line at the top is the nut. A dot shows where to press and its number is the finger; a circle above a string means play that pair open, and a cross means leave it out.",
    tuningNote: "Standard mandolin tuning, low to high: G D A E (each a pair of strings), the same as a violin.",
    faq: [
      { q: "What are the basic mandolin chords?", a: "G, C, D, A, E, Am, Em and Dm. Songs in G, D and A are the most comfortable on mandolin because their chords use open strings. They are marked “easy” in the chart." },
      { q: "What is the standard mandolin tuning?", a: "G D A E from the lowest pair of strings to the highest, the same as a violin. Every chord on this chart is for that tuning." },
      { q: "Why does a mandolin diagram have only four lines?", a: "Each line stands for a pair of strings, because the same shape is pressed on both strings of a pair. So a mandolin chord is drawn like a four-string instrument." },
      { q: "Why are some chords missing a note?", a: "On four strings, long chords such as 11ths and 13ths cannot hold every note, so players leave out the root and the fifth. Those shapes do the same." },
      { q: "How can I find the mandolin chords of a song?", a: "Search for the song on Chord Suno. Every chord is shown on the beat, and choosing Mandolin in the player draws each one as a mandolin diagram." },
    ],
  },
};
