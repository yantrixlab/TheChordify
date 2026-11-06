// What the two big menus in the header (Chords and Learn) hold, made from the same lists as the pages themselves (lessons, modes, notes,
// instruments), so a new lesson or page appears in the menu without anyone editing it. The desktop dropdowns and the phone accordion both
// draw from this.
import { INSTRUMENTS, ROOTS } from "./chordCatalog";
import { LESSONS } from "./lessons";
import { MODES } from "./modes";
import { INSTRUMENT_ICONS } from "./instrumentIcons";

export interface MenuLink {
  label: string;
  href: string;
  text?: string; // a line under the label
  icon?: string; // the inside of a 24px stroke svg
  meta?: string; // small text on the right ("6 min")
  num?: string; // a number before the label (lessons)
}
export interface MenuGroup {
  id: string;
  title: string;
  links: MenuLink[];
  pillsTitle?: string;
  pills?: MenuLink[]; // small links in a row: the notes, the modes
  more?: MenuLink; // a link to all of them
}
export interface MenuSection {
  id: "chords" | "learn";
  label: string;
  href: string; // the page the section is about
  prefixes: string[]; // a page whose address starts with one of these is "in" this section
  groups: MenuGroup[];
  feature: { kicker: string; title: string; text: string; cta: string; href: string; stats: { n: string; label: string }[] };
}

const lower = (s: string) => s.toLowerCase();

export const MENU: MenuSection[] = [
  {
    id: "chords",
    label: "Chords",
    href: "/chords/",
    prefixes: ["/chords/", "/guitar-chord", "/piano-chord", "/ukulele-chord", "/mandolin-chord", "/chord-detector/", "/youtube-to-chords/"],
    groups: [
      {
        id: "charts",
        title: "Chord charts",
        links: INSTRUMENTS.map((i) => ({ label: `${i.name} chord chart`, href: i.chartPath, text: `Every ${lower(i.name)} chord with a diagram`, icon: INSTRUMENT_ICONS[i.key] })),
        more: { label: "All chord charts", href: "/chords/" },
      },
      {
        id: "by-note",
        title: "Chords by note",
        links: [
          { label: "Guitar chords A to G♯", href: "/guitar-chords/", text: "A page for each of the twelve notes" },
          { label: "Piano chords", href: "/piano-chords/", text: "Keyboard diagrams and inversions" },
          { label: "Ukulele chords", href: "/ukulele-chords/", text: "Every chord for four strings" },
          { label: "Mandolin chords", href: "/mandolin-chords/", text: "G D A E tuning" },
        ],
        pillsTitle: "Jump to a guitar note",
        pills: ROOTS.map((r) => ({ label: r.short, href: `/guitar-chords/${r.slug}/` })),
      },
      {
        id: "find",
        title: "Find the chords",
        links: [
          { label: "Chords for any song", href: "/#find", text: "Search a song, see every chord on the beat" },
          { label: "Guitar chord finder", href: "/guitar-chord-finder/", text: "From any YouTube song, with diagrams" },
          { label: "What chord is this?", href: "/chord-detector/", text: "Play into the mic and it names the chord" },
          { label: "YouTube to chords", href: "/youtube-to-chords/", text: "The chords of any video" },
        ],
      },
    ],
    feature: { kicker: "Look any chord up", title: "336 chords, four instruments", text: "Every major, minor, 7th, sus, diminished and extended chord on all twelve notes, drawn for guitar, piano, ukulele and mandolin.", cta: "Open the chord charts", href: "/chords/", stats: [{ n: "336", label: "chords" }, { n: "4", label: "instruments" }] },
  },
  {
    id: "learn",
    label: "Learn",
    href: "/learn/",
    prefixes: ["/learn/", "/modes/"],
    groups: [
      {
        id: "lessons",
        title: "Lessons",
        links: LESSONS.map((l, i) => ({ label: l.title, href: `/learn/${l.slug}/`, num: String(i + 1).padStart(2, "0"), meta: `${l.minutes} min` })),
        more: { label: "All lessons", href: "/learn/" },
      },
      {
        id: "modes",
        title: "Musical modes",
        links: [
          { label: "Modes chart", href: "/modes/", text: "All 7 modes in all 12 keys: 84 scales" },
          { label: "Modes of C", href: "/modes/c/", text: "The easiest place to start" },
        ],
        pillsTitle: "The seven modes",
        pills: MODES.map((m) => ({ label: m.name, href: `/modes/${m.id}/` })),
        more: { label: "All musical modes", href: "/modes/" },
      },
      {
        id: "practice",
        title: "Practise",
        links: [
          { label: "Guitar tuner", href: "/toolkit/tuner/", text: "Free, in the browser" },
          { label: "Metronome", href: "/toolkit/metronome/", text: "With tap tempo" },
          { label: "Chord practice drills", href: "/toolkit/practice/", text: "Chord changes and a chord library" },
          { label: "Live chord detector", href: "/toolkit/chord-detector/", text: "Check the chords you play" },
        ],
        pillsTitle: "Modes by key",
        pills: ROOTS.map((r) => ({ label: r.short, href: `/modes/${r.slug}/` })),
        more: { label: "The whole toolkit", href: "/toolkit/" },
      },
    ],
    feature: { kicker: "New", title: "Musical modes, in every key", text: "Dorian, Lydian, Mixolydian and the rest: every note, formula and chord, with a keyboard that plays them.", cta: "Explore the modes", href: "/modes/", stats: [{ n: "7", label: "modes" }, { n: "84", label: "scales" }] },
  },
];
