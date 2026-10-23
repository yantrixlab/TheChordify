// What this browser looked for lately: the songs that were opened and the searches that were typed, newest first, up to
// MAX of them. They live in this browser only (localStorage), so they work without signing in and are never sent anywhere.
const KEY = "cs-recent-v1";
export const MAX_RECENT = 15;

export interface RecentSong {
  type: "song";
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  at: number;
}

export interface RecentQuery {
  type: "query";
  q: string;
  at: number;
}

export type Recent = RecentSong | RecentQuery;

function read(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((r) => r && (r.type === "song" ? r.videoId && r.title : r.type === "query" && r.q)) : [];
  } catch {
    return [];
  }
}

function write(list: Recent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // storage is blocked or full: the list just is not kept
  }
}

const sameAs = (a: Recent, b: Recent) => (a.type === "song" && b.type === "song" ? a.videoId === b.videoId : a.type === "query" && b.type === "query" && a.q.toLowerCase() === b.q.toLowerCase());

function add(entry: Recent) {
  write([entry, ...read().filter((r) => !sameAs(r, entry))]);
}

export const getRecents = (): Recent[] => read();

/** A song that was opened. */
export function rememberSong(song: { videoId: string; title: string; artist?: string; thumbnail?: string; duration?: number }) {
  if (!song.videoId || !song.title) return;
  add({ type: "song", videoId: song.videoId, title: song.title, artist: song.artist ?? "", thumbnail: song.thumbnail ?? "", duration: song.duration ?? 0, at: Date.now() });
}

/** A search that was typed (a very short one is not worth keeping). */
export function rememberQuery(q: string) {
  const clean = q.trim().replace(/\s+/g, " ");
  if (clean.length >= 2) add({ type: "query", q: clean.slice(0, 100), at: Date.now() });
}

export function forget(entry: Recent) {
  write(read().filter((r) => !sameAs(r, entry)));
}

export function clearRecents() {
  write([]);
}
