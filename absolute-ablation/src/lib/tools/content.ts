// The words under each tool: a short guide and the questions people ask. Shown on the page and sent to search engines as FAQ data,
// so every answer here must be true of the tool as it works today.
export interface ToolContent {
  /** heading + paragraphs, shown in order */
  guide: { heading: string; body: string[] }[];
  faqs: [string, string][];
}

const PLAN_NOTE =
  "Which plan includes this tool is shown on the Pricing page, and the Toolkit marks the tools your plan does not include with a lock.";

export const TOOL_CONTENT: Record<string, ToolContent> = {
  tuner: {
    guide: [
      {
        heading: "How to tune your instrument",
        body: [
          "Press Start and allow the microphone, then pluck one open string at a time. The board shows the note it hears and slides up when the string is sharp and down when it is flat. When the note settles in the middle, the string is in tune and is marked as done.",
          "Tune from the lowest string to the highest and tighten each string up to the note instead of loosening down to it: it holds its pitch better. Check the first string again at the end, because tightening the others can pull it slightly out.",
        ],
      },
      {
        heading: "Instruments and tunings",
        body: [
          "Pick guitar, bass, ukulele, violin, mandolin or banjo, or choose Any note to tune something else. Guitar has standard tuning (E A D G B E), half step down, full step down, Drop D, DADGAD, Open G, Open D and Open E. Bass has 4 and 5 string tunings and the ukulele has standard and baritone.",
          "The reference tone plays the target note so you can tune by ear as well. Concert pitch (A4) is 440 Hz by default and can be moved between 415 and 466 Hz for orchestras or baroque music.",
        ],
      },
      {
        heading: "Your sound stays on your device",
        body: [
          "The tuner listens through your microphone and works out the pitch on your device. The sound is never recorded or uploaded.",
        ],
      },
    ],
    faqs: [
      ["How do I tune a guitar with this tuner?", "Press Start, allow the microphone and pluck one open string at a time, from the lowest to the highest. Turn the tuning peg until the note sits in the middle of the board and the string is marked as tuned."],
      ["Which instruments and tunings does it support?", "Guitar, bass, ukulele, violin, mandolin and banjo, plus an Any note mode. Guitar tunings include standard, half step down, full step down, Drop D, DADGAD, Open G, Open D and Open E."],
      ["Does it record what I play?", "No. The pitch is worked out on your device and the sound is not recorded, uploaded or stored."],
      ["What is A4 and when would I change it?", "A4 is the reference pitch, 440 Hz by default. You can set it anywhere from 415 to 466 Hz, for example 442 Hz for some orchestras or 415 Hz for baroque music."],
      ["Does it work on a phone?", "Yes. It runs in your phone's browser and uses the phone's microphone. Hold the phone close to the instrument in a quiet room for the best reading."],
      ["Is the tuner free?", PLAN_NOTE],
    ],
  },

  metronome: {
    guide: [
      {
        heading: "Practising with the metronome",
        body: [
          "Set the tempo from 20 to 300 BPM by typing it, dragging the slider or tapping the beat with Tap tempo. Choose a time signature (2/4 to 12/8) and press a beat to make it louder, softer or silent, so you can accent the first beat or leave one out.",
          "Add subdivisions (eighths, triplets or sixteenths) to feel the spaces between beats, and pick one of four sounds: click, wood block, beep or hi-hat.",
        ],
      },
      {
        heading: "Speed trainer and silent bars",
        body: [
          "The speed trainer raises the tempo for you: choose how many BPM to add, how many bars to wait between steps and the top tempo. Start slow on a hard passage, play it cleanly and let the metronome nudge you faster.",
          "Silent bars keeps time without the click for a few bars, then brings it back. If you are still in time when the click returns, your own timing is steady.",
        ],
      },
      {
        heading: "Which tempo should I use?",
        body: [
          "As a rough guide, ballads sit near 66 BPM, a relaxed walking pace near 90, pop near 110, rock near 128 and fast songs from 160. For a new chord change or strumming pattern, start well below the song's tempo and raise it only when you can play it without stopping.",
        ],
      },
    ],
    faqs: [
      ["How do I find the tempo of a song?", "Tap along to the song with Tap tempo and the metronome sets the BPM from your taps. On Chord Suno, a chord chart also shows the tempo of the song it analysed."],
      ["What range of tempo does it cover?", "From 20 to 300 BPM, in any time signature from 2/4 to 12/8, including 5/4, 7/4, 6/8 and 9/8."],
      ["What is the speed trainer?", "It makes the tempo rise by itself: you choose how many BPM to add, after how many bars, and the top tempo. It is a steady way to bring a difficult passage up to speed."],
      ["What are silent bars for?", "The click drops out for a few bars and then returns, so you can check whether you kept the tempo on your own."],
      ["Does it remember my settings?", "Yes. Your tempo, time signature, sound and other settings are saved on your device and are there the next time you open the page."],
      ["Is the metronome free?", PLAN_NOTE],
    ],
  },

  practice: {
    guide: [
      {
        heading: "Six ways to practise chords",
        body: [
          "Explore shows any chord and the shapes you can play it with. Follow along shows the chord you are on and the next one, with a beat to keep you in time. Listen and check uses your microphone and tells you whether you are playing the chord that was asked for.",
          "1-minute changes counts how many times you can switch between two chords in a minute, and keeps your best score. Progressions drills common chord sequences such as I – IV – V and I – V – vi – IV in the key you choose. The chord quiz tests whether you can name a chord from its diagram.",
        ],
      },
      {
        heading: "Choose the chords you need",
        body: [
          "Start from a ready-made set (First four, Open chords, Campfire, Minor mood, Barre chords, 7th chords or Power chords) or build your own in My chords. A good first target is G, C, D and Em, because thousands of songs use them.",
        ],
      },
      {
        heading: "A practice routine that works",
        body: [
          "Ten focused minutes a day beat one long session a week. Pick the two chords you change between worst, set a slow beat, and play Follow along until the change is clean. Then try the 1-minute challenge and beat your last score. Keep the beat slow: speed comes after clean changes.",
        ],
      },
    ],
    faqs: [
      ["How can I change chords faster?", "Practise one pair of chords at a time at a slow beat until the change is clean, then use the 1-minute changes drill to track your count and raise it a little each day."],
      ["Which chords should a beginner learn first?", "G, C, D and Em. They are in the First four set, and together they play a very large number of popular songs."],
      ["How does Listen and check work?", "It listens through your microphone and compares what you play with the chord it asked for, so you know whether the chord rings out cleanly. The sound is analysed on your device and never recorded."],
      ["Does it work for ukulele or piano?", "The drills show guitar chord diagrams. Listen and check hears whatever you play near the microphone, so it also works for other chord instruments, but the diagrams are for guitar."],
      ["Does it save my progress?", "Your best 1-minute score and your chord choices are kept for you, so you can see the number you are trying to beat."],
      ["Is the practice tool free?", PLAN_NOTE],
    ],
  },

  "chord-detector": {
    guide: [
      {
        heading: "How to find out what chord you are playing",
        body: [
          "Press Start, allow the microphone and play a chord. The name appears as you play, with the notes it is made of and a chord diagram. Press Hold to keep a chord on the screen while you look at it, and use the history to copy the chords you played.",
          "It is a quick way to work out a chord you heard, check a shape you are unsure of, or write down your own song as you find it.",
        ],
      },
      {
        heading: "Which chords it can name",
        body: [
          "It recognises 11 kinds of chord, including major, minor, seventh, major seventh, minor seventh, suspended, diminished and augmented. Major and minor is the steadiest setting. The more kinds it listens for, the more often it can mistake a plain chord for a fancier one, so add 7ths and the others when you play those chords.",
        ],
      },
      {
        heading: "Tips for a clear reading",
        body: [
          "Let the chord ring for a second and strum every string, hold the instrument near the microphone and play in a quiet room. Make sure the instrument is in tune first with the Tuner, because an out-of-tune string can change the name it hears.",
          "To get the chords of a whole recorded song instead, search for it on the Chord Suno home page.",
        ],
      },
    ],
    faqs: [
      ["How can I find out what chord I am playing?", "Press Start, allow the microphone and strum the chord. Its name, notes and a diagram appear as you play."],
      ["Which kinds of chord does it detect?", "Eleven kinds, including major, minor, seventh, major seventh, minor seventh, suspended, diminished and augmented chords."],
      ["Can it name the chords of a song?", "This tool names what you play live. To get the chords of a whole song, search for it or upload its audio on the Chord Suno home page."],
      ["Why does it sometimes name the wrong chord?", "Background noise, an out-of-tune string or a chord that is not played on every string can change what it hears. Use the Tuner first, strum clearly, and keep the list of chord kinds short for the steadiest result."],
      ["Does it work with piano and ukulele?", "Yes. It listens to any chord instrument near your microphone. The diagram is for guitar, or for another instrument if your plan allows choosing one."],
      ["Does it record me?", "No. The sound is analysed on your device and is never recorded, uploaded or stored."],
      ["Is it free?", PLAN_NOTE],
    ],
  },
};
