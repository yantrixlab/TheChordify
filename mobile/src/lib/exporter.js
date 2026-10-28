// A song's chords as a chord sheet (PDF) or a MIDI file. The files are made by the website's own code (lib/exportSong.ts), from what
// the player shows: the key (Transpose), the capo and the way the song's bars were counted. The phone then offers the file to
// whatever the person wants to send it to.
import Share from 'react-native-share';
import { buildMidi, buildPdf } from 'chordsuno-shared/exportSong';
import { chordKeyLabel, transposeChord } from 'chordsuno-shared/chordShapes';

function fileName(song, kind, extension) {
  const base = `${song.title}${song.artist ? ` ${song.artist}` : ''}`
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 70);
  return `${base || 'song'}-${kind}.${extension}`;
}

/** The song as the player shows it now, ready to write out. `strumList` is the song's strumming patterns (may be empty). */
export function songForExport({ result, chart, transpose, capo, strumList, strumIndex = 0 }) {
  const display = (raw) => (raw === 'N' ? 'N' : transposeChord(raw, transpose));
  const { bars, plain, perBar } = chart;
  const rows = (from, to) =>
    plain.slice(from, to + 1).map((bar, i) => bar.map((chord, k) => (bars[from + i].beats[k] === null || bars[from + i].beats[k] === undefined ? null : chord === 'N' ? '—' : chord ? display(chord) : '')));
  const real = chart.sections.filter((sec) => sec.startBar !== null && sec.startBar !== undefined);
  const blocks =
    real.length === 0
      ? [{ label: '', bars: rows(0, bars.length - 1) }]
      : real.map((sec, i) => ({
          label: sec.label,
          // bars before the first section (a pickup) and after the last belong to those sections
          bars: rows(i === 0 ? 0 : sec.startBar, i === real.length - 1 ? bars.length - 1 : sec.endBar),
        }));
  const beatTimes = [];
  for (const bar of bars) for (let k = 0; k < perBar; k++) if (bar.beats[k] !== null && bar.beats[k] !== undefined) beatTimes.push(bar.beats[k]);
  const pickup = bars.length ? Math.max(0, bars[0].beats.slice(0, perBar).findIndex((t) => t !== null && t !== undefined)) : 0;

  // the strumming pattern played in each bar: the one for that kind of section, else the one chosen
  let strumBars = bars.map(() => null);
  if (strumList && strumList.length > 0) {
    const chosen = strumList[Math.min(strumIndex, strumList.length - 1)];
    const kindOfBar = [];
    real.forEach((sec) => {
      const kind = sec.label.replace(/\s*\d+$/, '');
      for (let b = sec.startBar; b <= (sec.endBar === undefined ? sec.startBar : sec.endBar); b++) kindOfBar[b] = kind;
    });
    strumBars = bars.map((_, b) => {
      const own = strumList.find((p) => p.where && p.where.length > 0 && kindOfBar[b] !== undefined && p.where.includes(kindOfBar[b])) || chosen;
      return { pattern: own.pattern, sub: own.sub === 4 ? 4 : 2 };
    });
  }

  return {
    title: result.title || 'Your song',
    artist: result.artist || '',
    key: result.key ? chordKeyLabel(transposeChord(result.key, transpose)) : '',
    tempo: chart.tempo,
    perBar,
    capo,
    transposed: ((((transpose + 6) % 12) + 12) % 12) - 6,
    blocks,
    beatTimes,
    pickup,
    chords: chart.chords.map((seg) => ({ start: seg.start, end: seg.end, chord: display(seg.chord) })),
    barBeats: bars.map((bar) => bar.beats),
    strumBars,
    duration: result.duration || 0,
  };
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return global.btoa(binary);
}

async function offer(bytes, name, mime) {
  try {
    // The library adds the extension itself, and only shares files from the app's internal cache (its file provider covers that).
    await Share.open({ url: `data:${mime};base64,${toBase64(bytes)}`, filename: name.replace(/\.[^.]+$/, ''), type: mime, failOnCancel: false, useInternalStorage: true });
  } catch (err) {
    if (!(err && /cancel|dismiss/i.test(String(err.message || err)))) throw err;
  }
}

export const sharePdf = (song) => offer(buildPdf(song), fileName(song, 'chords', 'pdf'), 'application/pdf');
export const shareMidi = (song, strummed = false) => offer(buildMidi(song, strummed), fileName(song, strummed ? 'chords-strummed' : 'chords', 'mid'), 'audio/midi');
