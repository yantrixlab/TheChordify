// Chord Suno's colours: the website's light look (white cards on a soft lavender page, deep violet bars), not a dark theme.
export const colors = {
  bg: '#f6f3fb', // the page
  surface: '#ffffff', // cards and sheets
  ink: '#1a0533', // text
  text: '#1a0533',
  mute: '#6b5f86', // second-line text
  faint: '#9a8fb3', // hints, inactive icons
  line: '#e6e0f0', // dividers and borders
  soft: '#efe9fb', // a quiet fill (a button at rest, an empty cell)
  violet: '#7c3aed',
  violetDeep: '#5b21b6',
  violetSoft: '#ede4ff',
  bar: '#5b21b6', // the top bar
  onBar: '#ffffff',
  error: '#b91c1c',
  errorBg: '#fee2e2',
  danger: '#dc2626',
  gold: '#f59e0b',
  // the colour of a song part, the same as on the website
  parts: {
    silence: '#e5e7eb',
    intro: '#fde68a',
    verse: '#bfdbfe',
    chorus: '#bbf7d0',
    bridge: '#fed7aa',
    outro: '#e9d5ff',
    instrumental: '#fbcfe8',
    break: '#e5e7eb',
  },
  partCycle: ['#c7d2fe', '#fbcfe8', '#a7f3d0', '#fde68a', '#bae6fd', '#fecaca'],
};

export function sectionColor(label) {
  const kind = String(label).split(' ')[0].toLowerCase();
  if (colors.parts[kind]) return colors.parts[kind];
  const letter = String(label).startsWith('Part ') ? String(label).charCodeAt(5) - 65 : 0;
  const n = colors.partCycle.length;
  return colors.partCycle[((letter % n) + n) % n];
}

export const radius = { card: 16, pill: 999, tile: 18 };

export const shadow = { shadowColor: '#1a0533', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 };
