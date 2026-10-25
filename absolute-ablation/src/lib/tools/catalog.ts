// The Toolkit's tools. `feature` is the key of the feature in the admin's Features & limits list that decides who gets the tool.
export interface ToolInfo {
  id: string;
  feature: string;
  name: string;
  href: string;
  blurb: string;
  points: string[];
  /** 24px stroke icon, the inside of an <svg> */
  icon: string;
  hue: [string, string];
  /** the card's cover on the Toolkit page: a light sky and a deeper hill of the same colour */
  cover: [string, string];
}

export const TOOLS: ToolInfo[] = [
  {
    id: "tuner",
    feature: "tuner",
    name: "Tuner",
    href: "/toolkit/tuner/",
    blurb: "Tune up with your microphone: guitar, bass, ukulele, violin and more, with alternate tunings and a reference tone.",
    points: ["Guitar, bass, ukulele, violin, mandolin, banjo", "Drop D, DADGAD, open tunings and more", "Reference tone and adjustable A4"],
    icon: '<path d="M3.8 17a8.2 8.2 0 0 1 16.4 0"/><path d="M12 17l3.2-6"/><circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none"/><path d="M12 5.2v1.8M5.6 8l1.3 1.3M18.4 8l-1.3 1.3"/>',
    hue: ["#10b981", "#0ea5e9"],
    cover: ["#ab93fb", "#7647fa"],
  },
  {
    id: "metronome",
    feature: "metronome",
    name: "Metronome",
    href: "/toolkit/metronome/",
    blurb: "Steady, accurate time from 20 to 300 BPM, with tap tempo, any time signature and a speed trainer.",
    points: ["Tap tempo, accents and subdivisions", "Speed trainer and silent-bar practice", "Four sounds, saved settings"],
    icon: '<path d="M8.2 21h7.6L13.6 4.5h-3.2z"/><path d="M12 16.5 16.2 7.5"/><circle cx="16.2" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><path d="M9 21v-1.8h6V21"/>',
    hue: ["#f59e0b", "#ef4444"],
    cover: ["#8be5c6", "#34cd9d"],
  },
  {
    id: "practice",
    feature: "practice_chords",
    name: "Practice your chords",
    href: "/toolkit/practice/",
    blurb: "Drills that get your fingers changing chords cleanly, with a beat to keep you honest.",
    points: ["Follow-along drill with now and next", "One-minute chord changes challenge", "Listen mode checks the chord you play"],
    icon: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M5 9h14M5 14.5h14M10 3.5v17M14.5 3.5v17"/><circle cx="12.2" cy="11.7" r="1.3" fill="currentColor" stroke="none"/><circle cx="7.6" cy="6.3" r="1.1" fill="currentColor" stroke="none"/>',
    hue: ["#7c3aed", "#c026d3"],
    cover: ["#8ac5ff", "#339dff"],
  },
  {
    id: "chord-detector",
    feature: "chord_detector",
    name: "Live chord detection",
    href: "/toolkit/chord-detector/",
    blurb: "Play any chord and watch its name appear, with the notes and a guitar diagram, as you play.",
    points: ["Names 11 kinds of chord by ear", "Shows the notes it hears, live", "Keeps a history you can copy"],
    icon: '<rect x="9" y="2.8" width="6" height="11.2" rx="3"/><path d="M5.2 11.5a6.8 6.8 0 0 0 13.6 0M12 18.3v3"/>',
    hue: ["#0ea5e9", "#7c3aed"],
    cover: ["#ffbe73", "#ff9411"],
  },
];

export const toolByFeature = (feature: string) => TOOLS.find((t) => t.feature === feature);
