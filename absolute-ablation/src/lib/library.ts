// A signed-in person's library: what they played, what they favourited, and how far they have got (XP, level, badges).
// The server decides all of it; this file asks for it, keeps the favourites in step across the hearts on a page, and
// shows the pop-ups when something is earned.
import { API_BASE } from "./api";
import { cachedUser, updateUser } from "./auth";
import { openSignIn } from "./authUi";
import { celebrate } from "./toast";
import type { Earned } from "./toast";

export interface LibraryItem {
  sessionId: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  chords: string[];
  plays: number;
  favorite: boolean;
  lastPlayedAt: number | null;
  favoritedAt: number | null;
}

export interface Badge {
  code: string;
  name: string;
  icon: string;
  description: string;
  rule: string;
  threshold: number;
  bonusXp: number;
  earned: boolean;
  earnedAt: number | null;
  progress: number;
}

export interface Reward {
  id: string;
  level: number;
  name: string;
  description: string;
  kind: "ring" | "star" | "perk";
  value: string;
  repeatEvery: number;
  unlocked: boolean;
  count: number;
  nextAt: number;
}

export interface Profile {
  xp: number;
  level: number;
  title: string;
  ring: string;
  stars: number;
  levelStartXp: number;
  nextLevelXp: number;
  intoLevel: number;
  levelSpan: number;
  streak: number;
  bestStreak: number;
  plays: number;
  songs: number;
  favorites: number;
  badges: Badge[];
  rewards: Reward[];
  nextReward: Reward | null;
}

export class LibraryError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** The parts of an answer that describe where the person now stands. */
const progressOf = (r: any) => ({
  level: r.level, title: r.title, ring: r.ring, stars: r.stars, xp: r.xp, intoLevel: r.intoLevel, levelSpan: r.levelSpan, nextLevelXp: r.nextLevelXp, streak: r.streak,
});

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  } catch {
    throw new LibraryError("Could not reach the server.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new LibraryError(typeof body.detail === "string" ? body.detail : `Request failed (${res.status})`, res.status);
  return body as T;
}

export const getProfile = () => call<{ profile: Profile }>("/api/me/profile").then((r) => r.profile);
export const getLibrary = (tab: "history" | "favorites", offset = 0, limit = 48) =>
  call<{ items: LibraryItem[]; total: number }>(`/api/me/library?tab=${tab}&offset=${offset}&limit=${limit}`);

/** Tells the server a song started playing: it goes in the history and pays XP. Quietly does nothing when signed out. */
export async function recordPlay(sessionId: string): Promise<void> {
  if (!cachedUser()) return;
  try {
    const result = await call<Earned & { counted: boolean }>("/api/me/played", { method: "POST", body: JSON.stringify({ sessionId }) });
    updateUser(progressOf(result));
    celebrate(result);
  } catch {
    // the play is not worth interrupting anything for
  }
}

// ---- favourites ---------------------------------------------------------------------------------------------------------

export interface FavouriteSong {
  sessionId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
}

let favourites = new Set<string>();
let loaded: Promise<void> | null = null;

/** Loads which songs are favourites (once per page; again after signing in or out). */
export function loadFavourites(): Promise<void> {
  loaded ??= (cachedUser() ? call<{ keys: string[] }>("/api/me/favorites").then((r) => void (favourites = new Set(r.keys))) : Promise.resolve()).catch(() => {}).then(() => {
    window.dispatchEvent(new Event("favourites-ready"));
  });
  return loaded;
}

window.addEventListener("auth-change", () => {
  favourites = new Set();
  loaded = null;
  if (cachedUser()) loadFavourites();
  else window.dispatchEvent(new Event("favourites-ready"));
});

export const isFavourite = (sessionId: string) => favourites.has(sessionId);

async function toggle(song: FavouriteSong, on: boolean) {
  if (on) favourites.add(song.sessionId);
  else favourites.delete(song.sessionId);
  window.dispatchEvent(new CustomEvent("favourite-change", { detail: { sessionId: song.sessionId, on } }));
  try {
    const result = await call<Earned>(`/api/me/favorites/${encodeURIComponent(song.sessionId)}`, {
      method: on ? "PUT" : "DELETE",
      ...(on ? { body: JSON.stringify({ title: song.title, artist: song.artist, thumbnail: song.thumbnail, duration: song.duration }) } : {}),
    });
    updateUser(progressOf(result));
    celebrate({ ...result, counted: true });
  } catch (err) {
    // undo what the heart showed
    if (on) favourites.delete(song.sessionId);
    else favourites.add(song.sessionId);
    window.dispatchEvent(new CustomEvent("favourite-change", { detail: { sessionId: song.sessionId, on: !on } }));
    if (err instanceof LibraryError && err.status === 401) openSignIn();
  }
}

const HEART = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

/** A heart that adds or removes a song from the favourites. Signed-out people are asked to sign in. */
export function heartButton(song: FavouriteSong, className = "hb"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.innerHTML = HEART;
  const paint = () => {
    const on = isFavourite(song.sessionId);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? `Remove ${song.title} from favourites` : `Add ${song.title} to favourites`);
    button.title = on ? "Remove from favourites" : "Add to favourites";
  };
  paint();
  window.addEventListener("favourites-ready", paint);
  window.addEventListener("favourite-change", (event) => {
    if ((event as CustomEvent).detail.sessionId === song.sessionId) paint();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation(); // the heart sits on top of a card that opens the song
    if (!cachedUser()) {
      openSignIn();
      return;
    }
    void toggle(song, !isFavourite(song.sessionId));
  });
  void loadFavourites();
  return button;
}

/** The key a YouTube song is filed under (the same one the server uses for its analysis). */
export const sessionIdOfVideo = (videoId: string) => `yt_${videoId}`;
