// What this phone looked for lately: the songs that were opened and the searches that were typed, newest first. They are kept
// on the phone only, so they work without signing in and are never sent anywhere.
import { getJson, setJson } from './storage';

const KEY = 'recent-v1';
export const MAX_RECENT = 15;

const sameAs = (a, b) => (a.type === 'song' && b.type === 'song' ? a.videoId === b.videoId : a.type === 'query' && b.type === 'query' && a.q.toLowerCase() === b.q.toLowerCase());

export function getRecents() {
  const list = getJson(KEY, []);
  return Array.isArray(list) ? list.filter((r) => r && (r.type === 'song' ? r.videoId && r.title : r.type === 'query' && r.q)) : [];
}

function add(entry) {
  setJson(KEY, [entry, ...getRecents().filter((r) => !sameAs(r, entry))].slice(0, MAX_RECENT));
}

export function rememberSong(song) {
  if (!song || !song.videoId) return;
  add({ type: 'song', videoId: song.videoId, title: song.title, artist: song.artist || '', thumbnail: song.thumbnail || '', duration: song.duration || 0, at: Date.now() });
}

export function rememberQuery(q) {
  const text = String(q || '').trim();
  if (text.length >= 2) add({ type: 'query', q: text, at: Date.now() });
}

export function forget(entry) {
  setJson(KEY, getRecents().filter((r) => !sameAs(r, entry)));
}

export function clearRecents() {
  setJson(KEY, []);
}
