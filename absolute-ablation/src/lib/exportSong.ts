// Downloads of a song's chords: a printable chord sheet (PDF) and the chords as a MIDI file. Both are made right here in the
// browser from what the player is showing, so they follow the key (Transpose) and the way the song's bars were counted.
import { chordNotes } from "./chordShapes";

export interface ExportBlock {
  label: string; // a section name, "" for a song with no sections
  bars: (string | null)[][]; // [bar][beat]: a chord name, "—" for a rest, "" while the last chord rings, null where the beat does not exist
}

export interface ExportSong {
  title: string;
  artist: string;
  key: string;
  tempo: number;
  perBar: number; // beats in a bar
  capo: number;
  transposed: number; // semitones
  blocks: ExportBlock[];
  beatTimes: number[]; // every beat of the song in seconds, in order (the pickup beats left out)
  pickup: number; // empty beats before the first beat of the first bar
  chords: { start: number; end: number; chord: string }[]; // as shown: "N" for no chord
}

function fileName(song: ExportSong, extension: string): string {
  const base = `${song.title}${song.artist ? ` ${song.artist}` : ""}`
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 70);
  return `${base || "song"}-chords.${extension}`;
}

function save(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- MIDI -----------------------------------------------------------------------------------------------------

const TPQ = 480; // ticks to a quarter note: one beat of the song

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  for (n >>= 7; n > 0; n >>= 7) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 127);

/** The song's average tempo from its beats (what a DAW needs for the bars to land on the bars), else the analysed tempo. */
function songTempo(song: ExportSong): number {
  const beats = song.beatTimes;
  const span = beats.length > 3 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0;
  const bpm = span > 0 ? 60 / span : song.tempo;
  return Math.min(300, Math.max(30, Math.round(bpm * 100) / 100 || 120));
}

/** Seconds to ticks, bending through the song's own beats so a chord keeps its beat even when the tempo wanders. */
function tickAt(song: ExportSong, seconds: number, bpm: number): number {
  const beats = song.beatTimes;
  const origin = song.pickup * TPQ;
  if (beats.length < 2) return Math.max(0, Math.round((seconds * bpm * TPQ) / 60));
  let beat: number;
  if (seconds <= beats[0]) beat = (seconds - beats[0]) / Math.max(beats[1] - beats[0], 0.05);
  else if (seconds >= beats[beats.length - 1]) {
    const last = beats.length - 1;
    beat = last + (seconds - beats[last]) / Math.max(beats[last] - beats[last - 1], 0.05);
  } else {
    let lo = 0;
    let hi = beats.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= seconds) lo = mid;
      else hi = mid;
    }
    beat = lo + (seconds - beats[lo]) / Math.max(beats[hi] - beats[lo], 0.001);
  }
  return Math.max(0, Math.round(origin + beat * TPQ));
}

/** The notes of a chord as MIDI numbers: the bass low, the other notes stacked close above middle C. */
function voicing(chord: string): number[] {
  const names = chordNotes(chord);
  if (names.length === 0) return [];
  const pcs = names.map((n) => ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(n));
  const out = [36 + pcs[0]]; // the bass note (the root, or the note after the slash), around C2
  const upper = /\/[A-G][#b]?$/.test(chord) ? pcs.slice(1) : pcs; // over a slash the bass is only the bass
  let previous = 59;
  for (const pc of upper) {
    let pitch = previous + 1;
    while (pitch % 12 !== pc) pitch++;
    out.push(pitch);
    previous = pitch;
  }
  // a chord stacked too high sits an octave lower
  if (Math.max(...out) > 83) return out.map((p, i) => (i === 0 ? p : p - 12));
  return out;
}

export function buildMidi(song: ExportSong): Uint8Array {
  const bpm = songTempo(song);
  const micros = Math.round(60_000_000 / bpm);
  const name = ascii(song.title || "Chord Suno");

  const conductor = [
    0, 0xff, 0x03, ...vlq(name.length), ...name,
    0, 0xff, 0x58, 0x04, Math.min(Math.max(song.perBar, 1), 32), 2, 24, 8, // time signature, per bar over 4
    0, 0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255,
    0, 0xff, 0x2f, 0x00,
  ];

  // The chords, a chord that continues joined into one note
  const joined: { start: number; end: number; chord: string }[] = [];
  for (const seg of song.chords) {
    if (seg.chord === "N") continue;
    const last = joined[joined.length - 1];
    if (last && last.chord === seg.chord && seg.start - last.end < 0.05) last.end = seg.end;
    else joined.push({ ...seg });
  }

  const events: { tick: number; order: number; bytes: number[] }[] = [];
  joined.forEach((seg) => {
    const on = tickAt(song, seg.start, bpm);
    const off = Math.max(on + 1, tickAt(song, seg.end, bpm) - 8);
    voicing(seg.chord).forEach((pitch, i) => {
      events.push({ tick: on, order: 1, bytes: [0x90, pitch, i === 0 ? 92 : 78] });
      events.push({ tick: off, order: 0, bytes: [0x80, pitch, 0] });
    });
  });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const trackName = ascii(`${song.title || "Chords"} chords`);
  const notes: number[] = [0, 0xff, 0x03, ...vlq(trackName.length), ...trackName, 0, 0xc0, 0]; // an acoustic piano
  let at = 0;
  for (const event of events) {
    notes.push(...vlq(event.tick - at), ...event.bytes);
    at = event.tick;
  }
  notes.push(0, 0xff, 0x2f, 0x00);

  const chunk = (tag: string, data: number[]) => [...ascii(tag), ...u32(data.length), ...data];
  return Uint8Array.from([
    ...ascii("MThd"), ...u32(6), 0, 1, 0, 2, (TPQ >> 8) & 255, TPQ & 255,
    ...chunk("MTrk", conductor),
    ...chunk("MTrk", notes),
  ]);
}

export function downloadMidi(song: ExportSong) {
  save(buildMidi(song), fileName(song, "mid"), "audio/midi");
}

// ---- PDF ------------------------------------------------------------------------------------------------------
// A small writer of its own: the two standard fonts every PDF reader has, lines and text, nothing to download.

const W = 595.28; // A4 in points
const H = 841.89;
const MARGIN = 42;

// Helvetica and Helvetica-Bold character widths (per 1000) for the characters from space to ~
const WIDTH_REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WIDTH_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

type Font = "F1" | "F2";

function textWidth(text: string, size: number, font: Font): number {
  const table = font === "F2" ? WIDTH_BOLD : WIDTH_REGULAR;
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    total += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (total * size) / 1000;
}

// What the standard fonts can show (WinAnsi); anything else becomes a "?"
const WIN_ANSI: Record<string, number> = { "—": 0x97, "–": 0x96, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "…": 0x85, "•": 0x95 };

function pdfString(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.charCodeAt(0);
    const byte = WIN_ANSI[ch] ?? (code < 256 ? code : 63);
    if (byte === 40 || byte === 41 || byte === 92) out += `\\${ch}`;
    else if (byte < 32) out += " ";
    else if (byte < 127) out += String.fromCharCode(byte);
    else out += `\\${byte.toString(8).padStart(3, "0")}`;
  }
  return out;
}

function toBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out;
}

const n2 = (n: number) => (Math.round(n * 100) / 100).toString();

class Page {
  ops: string[] = [];
  text(x: number, top: number, size: number, font: Font, text: string, gray = 0) {
    this.ops.push(`BT ${n2(gray)} g /${font} ${n2(size)} Tf ${n2(x)} ${n2(H - top)} Td (${pdfString(text)}) Tj ET`);
  }
  /** Text centred on x. */
  centred(cx: number, top: number, size: number, font: Font, text: string, gray = 0) {
    this.text(cx - textWidth(text, size, font) / 2, top, size, font, text, gray);
  }
  rect(x: number, top: number, w: number, h: number, fill: number) {
    this.ops.push(`${n2(fill)} g ${n2(x)} ${n2(H - top - h)} ${n2(w)} ${n2(h)} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width: number, gray: number) {
    this.ops.push(`${n2(gray)} G ${n2(width)} w ${n2(x1)} ${n2(H - y1)} m ${n2(x2)} ${n2(H - y2)} l S`);
  }
  box(x: number, top: number, w: number, h: number, width: number, gray: number) {
    this.ops.push(`${n2(gray)} G ${n2(width)} w ${n2(x)} ${n2(H - top - h)} ${n2(w)} ${n2(h)} re S`);
  }
}

export function buildPdf(song: ExportSong): Uint8Array {
  const pages: Page[] = [];
  let page = new Page();
  let y = MARGIN;
  const bottom = H - MARGIN - 18;
  pages.push(page);

  const newPage = () => {
    page = new Page();
    pages.push(page);
    page.text(MARGIN, MARGIN - 6, 8.5, "F1", `${song.title}${song.artist ? ` — ${song.artist}` : ""}`, 0.5);
    y = MARGIN + 16;
  };

  // The head of the sheet
  const fitted = (text: string, size: number, font: Font, room: number) => {
    let s = size;
    while (s > 12 && textWidth(text, s, font) > room) s -= 1;
    return s;
  };
  const titleSize = fitted(song.title || "Your song", 24, "F2", W - MARGIN * 2);
  y += titleSize * 0.85;
  page.text(MARGIN, y, titleSize, "F2", song.title || "Your song");
  if (song.artist) {
    y += 20;
    page.text(MARGIN, y, 12.5, "F1", song.artist, 0.35);
  }
  const facts = [
    song.key ? `Key ${song.key}` : "",
    `${Math.round(song.tempo)} BPM`,
    `${song.perBar} beats a bar`,
    song.capo ? `Capo ${song.capo}` : "",
    song.transposed ? `Transposed ${song.transposed > 0 ? "+" : ""}${song.transposed}` : "",
  ].filter(Boolean);
  y += 18;
  page.text(MARGIN, y, 10, "F1", facts.join("   ·   "), 0.4);

  const used: string[] = [];
  for (const block of song.blocks) for (const bar of block.bars) for (const cell of bar) if (cell && cell !== "—" && !used.includes(cell)) used.push(cell);
  if (used.length) {
    // the chords used, wrapped over as many lines as they need
    y += 16;
    page.text(MARGIN, y, 9, "F2", "Chords used", 0.45);
    let x = MARGIN + 62;
    for (const chord of used) {
      const w = textWidth(chord, 10, "F2") + 14;
      if (x + w > W - MARGIN) {
        x = MARGIN + 62;
        y += 15;
      }
      page.rect(x, y - 9.5, w - 4, 13.5, 0.94);
      page.centred(x + (w - 4) / 2, y, 10, "F2", chord);
      x += w;
    }
  }
  y += 14;
  page.line(MARGIN, y, W - MARGIN, y, 0.6, 0.75);
  y += 20;

  // The chords, a row of bars at a time (as in the player's grid: a cell for every beat)
  const perRow = song.perBar >= 6 ? 2 : 4;
  const barW = (W - MARGIN * 2) / perRow;
  const cellW = barW / song.perBar;
  const rowH = 27;

  for (const block of song.blocks) {
    const rows = Math.ceil(block.bars.length / perRow);
    if (rows === 0) continue;
    const labelH = block.label ? 22 : 0;
    if (y + labelH + rowH > bottom) newPage();
    if (block.label) {
      const w = textWidth(block.label.toUpperCase(), 8.5, "F2") + 16;
      page.rect(MARGIN, y - 11.5, w, 16, 0.9);
      page.text(MARGIN + 8, y, 8.5, "F2", block.label.toUpperCase(), 0.2);
      y += 12;
    }
    for (let r = 0; r < rows; r++) {
      if (y + rowH > bottom) newPage();
      const barsHere = block.bars.slice(r * perRow, r * perRow + perRow);
      barsHere.forEach((bar, b) => {
        const x0 = MARGIN + b * barW;
        bar.forEach((cell, k) => {
          const x = x0 + k * cellW;
          if (cell === null) page.rect(x, y, cellW, rowH, 0.965);
          else if (cell) {
            const text = cell;
            let size = 11.5;
            while (size > 5.5 && textWidth(text, size, "F2") > cellW - 3) size -= 0.5;
            page.centred(x + cellW / 2, y + rowH / 2 + size * 0.34, size, "F2", text);
          }
          if (k > 0) page.line(x, y, x, y + rowH, 0.25, 0.86);
        });
        page.box(x0, y, barW, rowH, 1, 0.45);
      });
      y += rowH + 5;
    }
    y += 9;
  }

  // The footer of every page
  pages.forEach((p, i) => {
    p.line(MARGIN, H - MARGIN - 4, W - MARGIN, H - MARGIN - 4, 0.4, 0.8);
    p.text(MARGIN, H - MARGIN + 8, 8, "F1", "Chord Suno · chordsuno.com", 0.5);
    const label = `${i + 1} / ${pages.length}`;
    p.text(W - MARGIN - textWidth(label, 8, "F1"), H - MARGIN + 8, 8, "F1", label, 0.5);
  });

  // The file: 1 catalogue, 2 page list, 3 and 4 the fonts, then a page and its content for each page
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((p, i) => {
    const content = p.ops.join("\n");
    objects[5 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objects[6 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = file.length;
    file += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = file.length;
  file += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) file += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return toBytes(file);
}

export function downloadPdf(song: ExportSong) {
  save(buildPdf(song), fileName(song, "pdf"), "application/pdf");
}
