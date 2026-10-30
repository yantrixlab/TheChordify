// Chord Suno's colours: "ivory and ink, with brass". Warm paper and charcoal neutrals and one burnt-amber accent, in a light and a dark
// palette. The player chooses light, dark or "follow the phone" (Settings); screens read the palette with useColors() and build their
// styles with makeStyles((colors) => ({ ... })), so a change of theme redraws them.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { getJson, setJson } from './lib/storage';

const parts = {
  silence: '#E5E0D6',
  intro: '#F6DC9B',
  verse: '#BFD7EA',
  chorus: '#C5E3C1',
  bridge: '#F4C9A0',
  outro: '#E1D0EA',
  instrumental: '#EDC2CE',
  break: '#E5E0D6',
};
const partCycle = ['#C6D0EC', '#EDC2CE', '#B5E0CC', '#F6DC9B', '#BCDDEB', '#F1C4BE'];

export const lightColors = {
  scheme: 'light',
  bg: '#F6F2EA', // the page: warm paper
  surface: '#FFFFFF', // cards and sheets
  ink: '#1C1814', // text
  text: '#1C1814',
  mute: '#6A6158', // second-line text
  faint: '#9A9086', // hints, inactive icons
  line: '#E6DED1', // dividers and borders
  soft: '#EFE8DB', // a quiet fill (a button at rest, an empty cell)
  accent: '#B45309', // burnt amber
  accentDeep: '#8F3F08', // the accent as text on a light surface
  accentSoft: '#F9E8CF', // a light wash of the accent
  onAccent: '#FFFFFF', // text on the accent
  hero: '#8F3F08', // a deep brand card (the Metronome's) and its text
  onHero: '#FFFFFF',
  bar: '#1C1814', // the top bar
  onBar: '#F7F2E9',
  barSub: '#F7F2E9B3',
  playing: '#1C1814', // the playing cell and marker
  onPlaying: '#FFFFFF',
  panel: '#211C17', // the player's control panel
  panelDeep: '#120F0B', // buttons on it
  panelText: '#FFFFFF',
  panelMute: '#BDB3A6',
  panelAccent: '#F2B04B',
  backdrop: '#140F0A99', // behind a sheet
  ripple: '#B4530922',
  error: '#B91C1C',
  errorBg: '#FEE2E2',
  danger: '#DC2626',
  gold: '#D98A0B',
  ok: '#15803D',
  okBg: '#DCFCE7',
  okText: '#166534',
  okSoft: '#D1FAE5',
  badSoft: '#FEE2E2',
  // chord diagrams, beat cells
  diagramInk: '#1C1814',
  diagramLine: '#CFC5B6',
  diagramCard: '#F6F1E8',
  diagramMute: '#6A6158',
  dot: '#1C1814',
  onDot: '#FFFFFF',
  cell: '#F7F2E8',
  cellLine: '#E2D8C7',
  cellHas: '#FFFFFF',
  cellHasLine: '#CDBFA8',
  firstCell: '#F1EADC',
  onPart: '#1C1814',
  parts,
  partCycle,
};

export const darkColors = {
  scheme: 'dark',
  bg: '#100E0C',
  surface: '#1A1714',
  ink: '#F2EDE4',
  text: '#F2EDE4',
  mute: '#A59C90',
  faint: '#766E64',
  line: '#2D2823',
  soft: '#26211B',
  accent: '#F2A93B',
  accentDeep: '#F5BE6A',
  accentSoft: '#33281A',
  onAccent: '#1A1208',
  hero: '#3A2A12',
  onHero: '#F7E7C9',
  bar: '#0B0A08',
  onBar: '#F2EDE4',
  barSub: '#F2EDE4B3',
  playing: '#F2A93B',
  onPlaying: '#1A1208',
  panel: '#171410',
  panelDeep: '#0A0907',
  panelText: '#F2EDE4',
  panelMute: '#A59C90',
  panelAccent: '#F2B04B',
  backdrop: '#000000B3',
  ripple: '#F2A93B26',
  error: '#FCA5A5',
  errorBg: '#3B1A1A',
  danger: '#F87171',
  gold: '#F2A93B',
  ok: '#4ADE80',
  okBg: '#12301C',
  okText: '#86EFAC',
  okSoft: '#12301C',
  badSoft: '#3B1A1A',
  diagramInk: '#F2EDE4',
  diagramLine: '#4A433B',
  diagramCard: '#221E1A',
  diagramMute: '#A59C90',
  dot: '#F2EDE4',
  onDot: '#1A1208',
  cell: '#221E1A',
  cellLine: '#363029',
  cellHas: '#2C2722',
  cellHasLine: '#5A5043',
  firstCell: '#2A241D',
  onPart: '#1C1814',
  parts,
  partCycle,
};

// The tool tiles (Toolkit, Discover): a light sky over a deeper hill of one hue. These replace the website's violet, green, blue and orange
// with softer, earthier ones that sit with the ivory and brass.
export const toolCovers = {
  tuner: ['#EBC27E', '#C98A2B'],
  metronome: ['#9DD3BF', '#3E9F83'],
  practice: ['#A3BCD8', '#527FAE'],
  'chord-detector': ['#EBB59A', '#C46D3F'],
  upload: ['#E8AEA9', '#C86862'],
};
export const coverOf = (id, fallback) => toolCovers[id] || fallback;

export const radius = { card: 16, pill: 999, tile: 18 };

export const shadow = { shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 };

/** The colour of a song part (the same names as on the website). */
export function sectionColor(label, colors) {
  const kind = String(label).split(' ')[0].toLowerCase();
  if (colors.parts[kind]) return colors.parts[kind];
  const letter = String(label).startsWith('Part ') ? String(label).charCodeAt(5) - 65 : 0;
  const n = colors.partCycle.length;
  return colors.partCycle[((letter % n) + n) % n];
}

const KEY = 'themeMode';
const ThemeContext = createContext({ colors: lightColors, scheme: 'light', mode: 'system', setMode: () => {} });

/** Gives every screen the palette: the one the player chose (light or dark), or the phone's own setting. */
export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState(() => {
    const saved = getJson(KEY, 'system');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const setMode = useCallback((next) => {
    setModeState(next);
    setJson(KEY, next);
  }, []);
  const value = useMemo(() => ({ colors: scheme === 'dark' ? darkColors : lightColors, scheme, mode, setMode }), [scheme, mode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;

/** Styles that depend on the palette: makeStyles((colors) => ({ ... })) gives a hook, called as `const styles = useStyles()`. */
export function makeStyles(factory) {
  const cache = {};
  return function useStyles() {
    const { colors, scheme } = useContext(ThemeContext);
    return cache[scheme] || (cache[scheme] = StyleSheet.create(factory(colors)));
  };
}
