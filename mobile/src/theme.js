export const colors = {
  bg: '#12041f',
  bgSoft: '#1a0533',
  card: '#ffffff0f',
  cardStrong: '#ffffff1a',
  line: '#ffffff1f',
  violet: '#7c3aed',
  violetSoft: '#b9a1ff',
  violetDeep: '#5b21b6',
  text: '#ffffff',
  mute: '#b7acd0',
  faint: '#8b7fa8',
  error: '#fecaca',
  errorBg: '#3b0a1a',
  danger: '#dc2626',
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

export const radius = { card: 16, pill: 999 };
