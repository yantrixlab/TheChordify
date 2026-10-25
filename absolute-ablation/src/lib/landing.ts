// The landing pages: one for each thing people search for when they want the chords of a song. Each has one search it answers (the
// title and description), a short guide and an FAQ. Everything said here is something the site does today.

export interface Step {
  title: string;
  text: string;
}
export interface Feature {
  title: string;
  text: string;
  icon: string; // the inside of a 24px stroke <svg>
}
export interface Faq {
  q: string;
  a: string;
}
export interface Guide {
  heading: string;
  paragraphs: string[];
  list?: string[];
}
export interface ChordTable {
  heading: string;
  intro: string;
  columns: string[]; // the strings of the instrument, low to high as they are tuned
  rows: { chord: string; frets: string[]; notes: string }[];
  note: string;
}
export interface Landing {
  slug: string;
  title: string; // the <title>: the search it answers, then the site
  description: string;
  nav: string; // its name in the lists of pages
  eyebrow: string;
  h1: string;
  lead: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
  chips: string[];
  demo: { song: string; chords: string[]; meta: string };
  stepsHeading: string;
  steps: Step[];
  featuresHeading: string;
  features: Feature[];
  chordTable?: ChordTable;
  guides: Guide[];
  faq: Faq[];
  cta: { heading: string; text: string; label: string; href: string };
}

const I = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  beat: '<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
  loop: '<path d="M17 3.5 20 6.5l-3 3M4 12.5v-1.5a4.5 4.5 0 0 1 4.5-4.5H20M7 20.5 4 17.5l3-3M20 11.5V13a4.5 4.5 0 0 1-4.5 4.5H4"/>',
  shift: '<path d="M7 4v13m0 0-3-3m3 3 3-3M17 20V7m0 0-3 3m3-3 3 3"/>',
  diagram: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M5 9h14M5 14.5h14M10 3.5v17M14.5 3.5v17"/>',
  strum: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  sections: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  tuner: '<path d="M3.8 17a8.2 8.2 0 0 1 16.4 0"/><path d="M12 17l3.2-6"/><circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  note: '<path d="M9 18V6l11-2.5V15"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="15" r="3"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/>',
  book: '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
};

export const LANDING: Landing[] = [
  // ------------------------------------------------------------------------------------------------------------------------------
  {
    slug: "youtube-to-chords",
    title: "YouTube to Chords: Get the Chords of Any Song — Chord Suno",
    description: "Paste a YouTube link and get every chord of the song, synced to the beat, with its key and tempo. Free to start, no card needed.",
    nav: "YouTube to chords",
    eyebrow: "YouTube to chords",
    h1: "Turn any YouTube song into chords",
    lead: "Paste a YouTube link and Chord Suno listens to the song, works out every chord and puts it on the beat, so you can play along instead of pausing and rewinding.",
    primary: { label: "Get the chords of a song", href: "/#find" },
    secondary: { label: "See how it works", href: "#how" },
    chips: ["Free to start", "No card needed", "Synced to the beat", "Key and tempo included"],
    demo: { song: "Any song from YouTube", chords: ["Am", "F", "C", "G"], meta: "Key of C · 92 BPM" },
    stepsHeading: "From a link to chords in three steps",
    steps: [
      { title: "Find the song", text: "Search for it on Chord Suno or paste its YouTube link. A song that somebody has already chordified opens straight away." },
      { title: "We listen", text: "Our chord model analyses the audio, finds the beats and the bars, and writes each chord where it starts. A new song usually takes a minute or two." },
      { title: "Play along", text: "Follow the chords as they scroll with the music. Slow the song down, loop a hard part, change the key or add a capo." },
    ],
    featuresHeading: "What you get with every song",
    features: [
      { title: "Chords on the beat", text: "Every chord is placed on the beat it starts on, in bars, so a chord chart lines up with the music.", icon: I.beat },
      { title: "Key and tempo", text: "The key and the tempo of the song, worked out from the audio and shown with the chords.", icon: I.key },
      { title: "Sections", text: "Intro, verse, chorus and the rest are marked, so you can jump to the part you are learning.", icon: I.sections },
      { title: "Slow down and loop", text: "Play at half speed, loop a bar or a section, and count in before you start.", icon: I.loop },
      { title: "Transpose and capo", text: "Move the whole song to a key that suits your voice, or fit the chords to a capo.", icon: I.shift },
      { title: "Chord diagrams and strumming", text: "Guitar chord diagrams with other ways to play each chord, and the strumming pattern of the song.", icon: I.diagram },
    ],
    guides: [
      {
        heading: "How a YouTube song becomes chords",
        paragraphs: [
          "Chord Suno downloads the audio of the video you choose and listens to it the way a musician does. It first finds the pulse of the song, then splits the music into beats and bars, then looks at which notes are sounding in each beat. A trained chord model turns that into chord names, and the changes are placed on the beat grid so that every chord starts where you would count it.",
          "The result is a chord chart you can read like a lead sheet and play along with. The chords are written for the song as it was recorded, in its own key, and you can move it to another key at any time.",
        ],
      },
      {
        heading: "Getting the best result",
        paragraphs: ["Songs with clear harmony from a guitar, piano or other chord instrument work best. A few things help:"],
        list: [
          "Choose the studio recording or the official audio. Live takes with a loose tempo are harder to follow.",
          "Songs with a lot of noise, heavy distortion or very little harmony (some rap and electronic tracks) have less to work out.",
          "Use your ear as the last word. A recording often differs from a printed chart, and the chart is a good starting point, not a rule.",
        ],
      },
      {
        heading: "Free to start",
        paragraphs: [
          "You can chordify songs on the free plan, with a daily allowance of new songs. Songs that others have already chordified open instantly and do not count against it. Paid plans add more songs a day and more tools; see the plans for the details.",
        ],
      },
    ],
    faq: [
      { q: "Is YouTube to chords free?", a: "Yes, to start. The free plan includes a daily allowance of new songs, and songs that someone has already chordified open instantly. Paid plans add more songs and more tools." },
      { q: "How accurate are the chords?", a: "The chords are worked out automatically, and the main chords of a song with clear harmony are usually right. Unusual voicings, key changes and heavy production can be off, so treat the chart as a very good starting point and trust your ear." },
      { q: "Does it work with any YouTube video?", a: "It works with music videos, official audio and most uploads of a song. A few videos cannot be downloaded (private, age-restricted or blocked in some regions); in that case try another upload of the same song." },
      { q: "Can I use my own audio file?", a: "Uploading your own song is part of some plans. Sign in and see the plans to check whether it is included in yours." },
      { q: "Which instruments is it for?", a: "The chord names and timing work for any instrument. The chord diagrams in the player are for guitar and ukulele today; piano and mandolin diagrams are on the way." },
      { q: "Do I need an account?", a: "You can try a song without one. Sign in with Google to keep a library of the songs you play and your favourites." },
    ],
    cta: { heading: "Try it with your next song", text: "Paste a YouTube link and see its chords in about a minute.", label: "Get the chords of a song", href: "/#find" },
  },

  // ------------------------------------------------------------------------------------------------------------------------------
  {
    slug: "guitar-chord-finder",
    title: "Guitar Chord Finder: Chords for Any Song, Free — Chord Suno",
    description: "Find the guitar chords of any song from a YouTube link: chord diagrams, key, tempo and strumming pattern, synced to the music. Free to start.",
    nav: "Guitar chord finder",
    eyebrow: "Guitar chord finder",
    h1: "Find the guitar chords of any song",
    lead: "Chord Suno works out the chords of a song for you, shows each one as a guitar chord diagram, and plays along with the music so you know when to change.",
    primary: { label: "Find chords for a song", href: "/#find" },
    secondary: { label: "See what you get", href: "#features" },
    chips: ["Guitar chord diagrams", "Strumming pattern", "Capo and transpose", "Free to start"],
    demo: { song: "Your song, on guitar", chords: ["G", "D", "Em", "C"], meta: "Key of G · 98 BPM" },
    stepsHeading: "How to find the chords of a song on guitar",
    steps: [
      { title: "Choose a song", text: "Search for the song by name or paste a YouTube link." },
      { title: "Read the chords", text: "See the chords of the whole song in order: as chord diagrams that follow the music, or as a grid of bars you can read at a glance." },
      { title: "Play it", text: "Press play. The chord you are on is lit, the next one is shown ahead of time, and the strumming pattern is shown below." },
    ],
    featuresHeading: "Everything for learning a song on guitar",
    features: [
      { title: "Chord diagrams", text: "A guitar diagram for every chord, with other ways to play it when there are some. Choose the shape that suits you and it is used all through the song.", icon: I.diagram },
      { title: "Strumming pattern", text: "The song's strumming pattern from the recording, with the beat that is playing lit as you go, and an easy version to start with.", icon: I.strum },
      { title: "Capo and transpose", text: "Move the song to a key that is easier to play or to sing, and see the chords for a capo position.", icon: I.shift },
      { title: "Chords grid", text: "The whole song as a grid of bars, one cell to a beat, in sections. Good for reading ahead and for printing in your head.", icon: I.grid },
      { title: "Slow down and loop", text: "Slow the song to half speed and loop the hard change until it is clean.", icon: I.loop },
      { title: "Tuner, metronome, drills", text: "A free guitar tuner, a metronome, chord-change drills and a chord library sit in the same place.", icon: I.tuner },
    ],
    guides: [
      {
        heading: "What a guitar chord finder does",
        paragraphs: [
          "A guitar chord finder tells you which chords a song uses and when they change. Chord Suno does this from the recording itself, not from a typed chart: it listens to the song, finds the chords and lines them up with the beat, so the chart follows the actual track.",
          "Each chord is shown as a chord diagram. When a chord can be played in more than one place on the neck, arrows under the diagram let you pick the shape you like, and that choice is kept for the chord everywhere in the song.",
        ],
      },
      {
        heading: "Chords to learn first",
        paragraphs: ["Most songs in the first years of playing are made from a small set of open chords:"],
        list: [
          "G, C and D: the three chords of countless folk and pop songs.",
          "Em and Am: the two minor chords that go with them.",
          "A, E and Dm: the next ones to add.",
          "F and Bm need a barre, so they come after the open chords feel easy.",
        ],
      },
      {
        heading: "Make a song easier",
        paragraphs: [
          "If a song uses chords that are hard for you, change its key. Transposing a song a few steps, or putting a capo on, often turns a barre-chord song into open chords without changing how it sounds to sing along. Start with the easy version of the strumming pattern (one down-strum on every beat) and add the other strokes when the changes are smooth.",
        ],
      },
    ],
    faq: [
      { q: "How do I find the chords of a song on guitar?", a: "Search for the song on Chord Suno or paste its YouTube link. The chords are worked out from the audio and shown in order with chord diagrams, synced to the music." },
      { q: "Does it show the strumming pattern?", a: "Yes. The song's strumming pattern is read from the recording and shown under the chords, with an easy version for beginners. When the playing is not steady enough to be sure, you are told it is a best guess or a typical pattern." },
      { q: "Can I change the key or use a capo?", a: "Yes. The player has transpose and capo controls that redraw every chord. They are part of some plans, so check the plans if the controls are locked." },
      { q: "Why are the chords different from the tab I know?", a: "A recording and a printed tab can differ: tabs are often simplified or in another key. Chord Suno follows the recording. You can also move the song to the key of your tab." },
      { q: "Can I practise the chord changes?", a: "Yes. The Toolkit has chord-change drills with a beat, a one-minute changes challenge, a chord library with every way to play each chord, a tuner and a metronome." },
      { q: "Is it free?", a: "It is free to start. The free plan includes a daily allowance of new songs, and songs that someone has already chordified open instantly." },
    ],
    cta: { heading: "Find the chords of your next song", text: "Search a song or paste a YouTube link and start playing along.", label: "Find chords for a song", href: "/#find" },
  },

  // ------------------------------------------------------------------------------------------------------------------------------
  {
    slug: "chord-detector",
    title: "Chord Detector: Find the Chord You Play, Live — Chord Suno",
    description: "A free chord detector for songs and for your instrument: paste a YouTube link, or play into your microphone and see the chord name live.",
    nav: "Chord detector",
    eyebrow: "Chord detector",
    h1: "A chord detector for songs and for your instrument",
    lead: "Detect the chords of a recorded song from a link, or play a chord on your own instrument and see its name appear as you play.",
    primary: { label: "Try the live chord detector", href: "/toolkit/chord-detector/" },
    secondary: { label: "Detect a song's chords", href: "/#find" },
    chips: ["Live from your microphone", "Chords of any song", "Sound stays on your device", "Free to try"],
    demo: { song: "Listening… you play", chords: ["D", "A", "Bm", "G"], meta: "Detected live · D major" },
    stepsHeading: "Two ways to detect chords",
    steps: [
      { title: "From your instrument", text: "Open the live chord detector, allow the microphone and play. The chord name, its notes and a guitar chord diagram appear while you play." },
      { title: "From a recorded song", text: "Paste a YouTube link. Chord Suno analyses the whole song and gives you every chord with its timing." },
      { title: "Check your work", text: "Play along with a song and watch the live detector to see whether the chords you play match." },
    ],
    featuresHeading: "What the chord detector does",
    features: [
      { title: "Names the chord you play", text: "It names 11 kinds of chord by ear (major, minor, sevenths, suspended and more), not just the plain major and minor.", icon: I.mic },
      { title: "Shows the notes it hears", text: "See which notes are sounding as you play, so you can tell a missed string from a wrong chord.", icon: I.note },
      { title: "Keeps a history", text: "The chords you played are kept in order, and you can copy them out as a progression.", icon: I.book },
      { title: "Detects whole songs", text: "For a recorded song, the chords of the whole track are found and placed on the beat.", icon: I.beat },
      { title: "Private by design", text: "The live detector analyses sound on your device. It is never recorded, uploaded or stored.", icon: I.shield },
      { title: "Works with any instrument", text: "Guitar, ukulele, piano or voice: it listens to the notes, not to the instrument.", icon: I.tuner },
    ],
    guides: [
      {
        heading: "How the live chord detector works",
        paragraphs: [
          "The detector listens through your microphone and looks at which notes are sounding at each moment, including their overtones. It compares those notes with the shapes of chords and names the one that fits best. To stop the name flickering while a chord rings, it waits until a chord has been heard steadily before it shows it.",
          "Everything happens in your browser. The sound is analysed as it comes in and is not saved or sent anywhere.",
        ],
      },
      {
        heading: "Tips for a clean reading",
        paragraphs: [],
        list: [
          "Play in a fairly quiet room and hold the instrument near the microphone.",
          "Tune first. A guitar that is out of tune reads as the wrong chord. The Toolkit has a free tuner.",
          "Let the chord ring for a moment. A single note, or a chord that stops at once, gives the detector little to go on.",
          "If your computer has several microphones, choose the right one from the list in the detector.",
        ],
      },
      {
        heading: "Detecting the chords of a song",
        paragraphs: [
          "For a recorded song you do not need a microphone. Paste a YouTube link and Chord Suno works out the chords of the whole recording, with the key, the tempo and the sections. You can then play along with the chart and use the live detector to check your own chords.",
        ],
      },
    ],
    faq: [
      { q: "What is a chord detector?", a: "A chord detector listens to music and tells you which chords are being played. Chord Suno has two: one for recorded songs, and a live one that listens to your microphone." },
      { q: "Is the live chord detector free?", a: "It is free to try. Whether it is part of your plan is shown on the Toolkit page, and the plans page lists what each plan includes." },
      { q: "Does it record my playing?", a: "No. The sound is analysed in your browser as you play. It is never recorded, uploaded or stored." },
      { q: "Which chords can it name?", a: "It names 11 kinds of chord, including major, minor, sevenths and suspended chords, in every key." },
      { q: "Why does it show the wrong chord sometimes?", a: "Out-of-tune strings, background noise, a single note or a chord that is cut short all make a chord harder to name. Tune up, play in a quiet place and let the chord ring." },
      { q: "Can it find the chords of a song from a file or a link?", a: "Yes. Paste a YouTube link and the chords of the whole song are worked out and placed on the beat." },
    ],
    cta: { heading: "See your chords as you play", text: "Open the live chord detector and play a chord.", label: "Try the live chord detector", href: "/toolkit/chord-detector/" },
  },

  // ------------------------------------------------------------------------------------------------------------------------------
  {
    slug: "ukulele-chords",
    title: "Ukulele Chords for Any Song: Chord Finder — Chord Suno",
    description: "Get the chords of any song for ukulele: paste a YouTube link and follow the chord names on the beat. Plus the easy ukulele chords and a free tuner.",
    nav: "Ukulele chords",
    eyebrow: "Ukulele chords",
    h1: "Ukulele chords for any song",
    lead: "Chord Suno works out the chords of a song and shows them on the beat. The chord names are the same on a ukulele, the player draws every chord as a ukulele diagram, and the shapes for the eight most used chords are right on this page.",
    primary: { label: "Find chords for a song", href: "/#find" },
    secondary: { label: "See the easy chords", href: "#chords" },
    chips: ["Ukulele chord diagrams", "Free ukulele tuner", "Transpose to easy keys", "Free to start"],
    demo: { song: "Your song, on ukulele", chords: ["C", "Am", "F", "G"], meta: "Key of C · 100 BPM" },
    stepsHeading: "How to play a song on ukulele with Chord Suno",
    steps: [
      { title: "Get the chords", text: "Search for the song or paste a YouTube link. You get every chord in order, with its key and tempo." },
      { title: "Make it ukulele-friendly", text: "Transpose the song to a key whose chords are easy on ukulele, such as C, F or G, so most chords are open shapes." },
      { title: "Play along", text: "Follow the chords as they scroll with the music, slow it down and loop the tricky change. Tune up first with the free tuner." },
    ],
    featuresHeading: "What helps a ukulele player",
    features: [
      { title: "Chord names on the beat", text: "A chord is the same chord on every instrument. Read the name and play it with the shape you know.", icon: I.beat },
      { title: "Transpose", text: "Move a song to a key where the chords are open and easy. The whole chart changes at once.", icon: I.shift },
      { title: "Free ukulele tuner", text: "A tuner with a string-by-string display for ukulele (GCEA), with other instruments and tunings too.", icon: I.tuner },
      { title: "Metronome and drills", text: "A free metronome with tap tempo, and chord-change drills with a beat, for clean changes.", icon: I.clock },
      { title: "Slow down and loop", text: "Half speed and a loop on the part you cannot get yet.", icon: I.loop },
      { title: "Sections and bars", text: "Verse, chorus and bridge are marked, in bars you can count.", icon: I.sections },
    ],
    chordTable: {
      heading: "The eight chords most ukulele songs use",
      intro: "In standard tuning (G C E A, the same four strings on every soprano, concert and tenor ukulele), these shapes cover a huge number of songs. Each number is the fret to press on that string; 0 is an open string.",
      columns: ["G", "C", "E", "A"],
      rows: [
        { chord: "C", frets: ["0", "0", "0", "3"], notes: "C E G" },
        { chord: "G", frets: ["0", "2", "3", "2"], notes: "G B D" },
        { chord: "Am", frets: ["2", "0", "0", "0"], notes: "A C E" },
        { chord: "F", frets: ["2", "0", "1", "0"], notes: "F A C" },
        { chord: "D", frets: ["2", "2", "2", "0"], notes: "D F♯ A" },
        { chord: "Em", frets: ["0", "4", "3", "2"], notes: "E G B" },
        { chord: "A", frets: ["2", "1", "0", "0"], notes: "A C♯ E" },
        { chord: "Dm", frets: ["2", "2", "1", "0"], notes: "D F A" },
      ],
      note: "In the player, choose Ukulele above the song details and every chord is drawn as a ukulele diagram, with other ways to play it. Ukulele diagrams are part of the Premium plan; the shapes above are free for everyone.",
    },
    guides: [
      {
        heading: "Playing any song on ukulele",
        paragraphs: [
          "A chord has the same name and the same notes on every instrument, so a song's chords from Chord Suno work on a ukulele as they do on a guitar. What changes is the shape you press. Learn the eight shapes above and you can already play along with a very large part of the songs you hear.",
          "Because the ukulele is a small instrument with four strings, songs in the keys of C, F and G are the friendliest: their chords are mostly open shapes. If a song is in a harder key, transpose it before you start.",
        ],
      },
      {
        heading: "Start with these four",
        paragraphs: ["If you are new, learn C, Am, F and G first. They make the progression behind a long list of songs, and the changes between them are short."],
        list: ["C and Am share fingers, so that change is a one-finger move.", "F to G is the change to practise most: use the chord-change drills in the Toolkit.", "Keep the strumming simple: one down-strum on each beat is a good start."],
      },
    ],
    faq: [
      { q: "Does Chord Suno show ukulele chord diagrams?", a: "Yes. Open a song in the player and choose Ukulele: every chord is drawn as a four-string diagram in standard G C E A tuning, with other ways to play it. Ukulele diagrams are part of the Premium plan. The eight most used ukulele shapes are free on this page." },
      { q: "Can I find the chords of a song for ukulele?", a: "Yes. Search for the song or paste a YouTube link and you get every chord on the beat. The names are the same on a ukulele." },
      { q: "What is the tuning for the ukulele chords here?", a: "Standard ukulele tuning: G C E A (the G string is the high one, tuned above the C). Baritone ukuleles are tuned differently (D G B E) and use guitar shapes." },
      { q: "Can I make a song easier to play on ukulele?", a: "Yes. Use transpose to move the song to a key with open chords, such as C, F or G. The chord chart redraws to match." },
      { q: "Is there a ukulele tuner?", a: "Yes. The free tuner has a ukulele setting with a display for each string. It uses your microphone, and the sound stays on your device." },
      { q: "Is it free?", a: "It is free to start, with a daily allowance of new songs. See the plans for what the paid ones add." },
    ],
    cta: { heading: "Play your favourite song on ukulele", text: "Get its chords in about a minute, then transpose it to an easy key.", label: "Find chords for a song", href: "/#find" },
  },

  // ------------------------------------------------------------------------------------------------------------------------------
  {
    slug: "mandolin-chords",
    title: "Mandolin Chords for Any Song: Chord Finder — Chord Suno",
    description: "Get the chords of any song for mandolin: paste a YouTube link and follow the chords on the beat. Plus common mandolin chords and a free tuner.",
    nav: "Mandolin chords",
    eyebrow: "Mandolin chords",
    h1: "Mandolin chords for any song",
    lead: "Chord Suno finds the chords of a song and lines them up with the music. The chord names are the same on a mandolin, and the common shapes are on this page.",
    primary: { label: "Find chords for a song", href: "/#find" },
    secondary: { label: "See the common chords", href: "#chords" },
    chips: ["Chords of any song", "Free mandolin tuner", "Transpose to your key", "Free to start"],
    demo: { song: "Your song, on mandolin", chords: ["G", "C", "D", "Em"], meta: "Key of G · 110 BPM" },
    stepsHeading: "How to play a song on mandolin with Chord Suno",
    steps: [
      { title: "Get the chords", text: "Search for the song or paste a YouTube link and see every chord in order, with the key and tempo." },
      { title: "Pick a friendly key", text: "Transpose the song to a key that sits well on a mandolin, such as G, D or A, where the chord shapes are close together." },
      { title: "Play along", text: "Follow the chords as they scroll with the music. Slow it down and loop the part you are learning. Tune up first with the free tuner." },
    ],
    featuresHeading: "What helps a mandolin player",
    features: [
      { title: "Chord names on the beat", text: "A chord is the same chord on every instrument. Read the name and play the shape you know.", icon: I.beat },
      { title: "Transpose", text: "Move a song to the key that suits your playing or your fiddle-tune friends. The whole chart changes at once.", icon: I.shift },
      { title: "Free mandolin tuner", text: "A tuner with a string-by-string display for mandolin (G D A E), with other instruments and tunings too.", icon: I.tuner },
      { title: "Metronome", text: "A free metronome with tap tempo, subdivisions and a speed trainer for building up chop and tremolo speed.", icon: I.clock },
      { title: "Slow down and loop", text: "Half speed and a loop on the part you cannot get yet.", icon: I.loop },
      { title: "Sections and bars", text: "Verse, chorus and bridge are marked, in bars you can count.", icon: I.sections },
    ],
    chordTable: {
      heading: "Common mandolin chords",
      intro: "In standard tuning (G D A E, low to high; each string is a pair on a real mandolin, and the same shape is played on both strings of a pair). Each number is the fret to press on that string; 0 is an open string.",
      columns: ["G", "D", "A", "E"],
      rows: [
        { chord: "G", frets: ["0", "0", "2", "3"], notes: "G B D" },
        { chord: "C", frets: ["0", "2", "3", "0"], notes: "C E G" },
        { chord: "D", frets: ["2", "0", "0", "2"], notes: "D F♯ A" },
        { chord: "A", frets: ["2", "2", "4", "5"], notes: "A C♯ E" },
        { chord: "E", frets: ["1", "2", "2", "0"], notes: "E G♯ B" },
        { chord: "Em", frets: ["0", "2", "2", "0"], notes: "E G B" },
        { chord: "Am", frets: ["2", "2", "3", "5"], notes: "A C E" },
      ],
      note: "The chord diagrams in the player are drawn for guitar today. Mandolin shapes in the player are on our list; until then the chord names and timing work for any instrument, and the shapes above cover the chords of many songs.",
    },
    guides: [
      {
        heading: "Playing any song on mandolin",
        paragraphs: [
          "A chord has the same name and the same notes on every instrument, so the chords Chord Suno finds for a song are the chords you play on a mandolin. The mandolin is tuned in fifths, like a violin, so chord shapes are compact and the same shape moves up the neck to give other chords.",
          "Songs in G, D and A are the most comfortable, because their chords use open strings. If a song is in another key, transpose it before you start, or move the shape up the neck.",
        ],
      },
      {
        heading: "Rhythm on the mandolin",
        paragraphs: ["Mandolin players often \"chop\": a short, sharp chord on the off-beats, which gives bluegrass its drive. Use the metronome from the Toolkit and the slow-down control to build up the chop before you try it at full speed."],
      },
    ],
    faq: [
      { q: "Does Chord Suno show mandolin chord diagrams?", a: "Not yet. The chord diagrams in the player are guitar diagrams. The chord names and their timing are right for a mandolin, and the common shapes are on this page. Mandolin diagrams in the player are planned." },
      { q: "Can I find the chords of a song for mandolin?", a: "Yes. Search for the song or paste a YouTube link and you get every chord on the beat. The names are the same on a mandolin." },
      { q: "What is the standard mandolin tuning?", a: "G D A E, from the lowest pair of strings to the highest, the same as a violin. The chord shapes on this page are for that tuning." },
      { q: "Can I change the key of a song for mandolin?", a: "Yes. Use transpose to move the song to a key such as G, D or A, where the chords are close and use open strings." },
      { q: "Is there a mandolin tuner?", a: "Yes. The free tuner has a mandolin setting with a display for each string. It uses your microphone, and the sound stays on your device." },
      { q: "Is it free?", a: "It is free to start, with a daily allowance of new songs. See the plans for what the paid ones add." },
    ],
    cta: { heading: "Play your next song on mandolin", text: "Get its chords in about a minute, then move it to a key you like.", label: "Find chords for a song", href: "/#find" },
  },
];

export const landingBySlug = (slug: string) => LANDING.find((p) => p.slug === slug);
