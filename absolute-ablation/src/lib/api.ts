// Dev talks to the local backend. A production build uses same-origin paths (/api, /media),
// which the reverse proxy in deploy/Caddyfile forwards to the backend. PUBLIC_API_BASE overrides both.
// In dev it is the same host name as the page (localhost or 127.0.0.1), so the sign-in cookie counts as same-site.
export const API_BASE: string =
  import.meta.env.PUBLIC_API_BASE ??
  (import.meta.env.DEV ? `http://${typeof window !== "undefined" ? window.location.hostname : "127.0.0.1"}:8000` : "");

export interface ChordSegment {
  start: number;
  end: number;
  chord: string; // e.g. "C", "Am7", "Gsus4", "D/F#"; "N" = no chord
  confidence?: number; // 0-1, only from the neural engine
  // Beat time of the grid cell this chord is written in (null = no cell of its own). `start` stays the real time.
  gridStart?: number | null;
}

export interface Bar {
  start: number;
  // 4 beat starts + the start of the next bar; null where the beat does not exist (a pickup bar, a short last bar)
  beats: (number | null)[];
}

export interface Section {
  label: string; // "Silence", "Intro", "Verse 1", "Chorus 2", or "Part A" when the parts can't be named reliably
  start: number;
  end: number;
  startBar: number | null; // index into `bars`; null for the silence before the music
  endBar: number | null;
}

export interface ExtractResult {
  sessionId: string;
  source: "youtube" | "upload";
  sourceUrl?: string;
  title?: string;
  artist?: string;
  duration: number;
  chords: ChordSegment[]; // the song's core chords (major/minor)
  chordsDetailed?: ChordSegment[]; // every chord type the model recognises (7ths, sus, slash chords...)
  sections?: Section[];
  sectionsPending?: boolean; // the structure model is still working: better sections will replace these
  sectionsSource?: "model"; // set once those sections have arrived
  videoId?: string; // YouTube songs: the video, so a jam session can be counted
  tempo: number;
  beatTimes: number[];
  bars: Bar[];
  audioUrl: string;
  engine?: "btc" | "classic";
}

export interface JobStatus {
  sessionId: string;
  status: "queued" | "downloading" | "analyzing" | "done" | "error";
  progress: number;
  stage?: string;
  error?: string;
  result?: ExtractResult;
}

export class ApiError extends Error {
  /** HTTP status when the server answered (502/503/504 mean it is down or restarting); 0 when it could not be reached. */
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
    this.name = "ApiError";
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export async function fetchApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err; // a search that was replaced, not a failure
    throw new ApiError(
      "Could not reach the chord extraction server. Please check your connection and try again.",
    );
  }
}

/** A song from the search: only songs come back, never other kinds of videos. */
export interface SongHit {
  videoId: string;
  kind?: "song" | "video"; // an official audio track, or another upload of the song (music video, lyrics, cover...)
  views?: string; // videos: "3.3M views"
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  thumbnail: string;
  // Only songs somebody has already chordified have these: their main chords and how many jam sessions they have had.
  chords?: string[];
  jams?: number;
}

/** Songs matching what was typed (an empty list when nothing matches). Pass a signal to cancel a search that was replaced. */
export async function searchSongs(query: string, signal?: AbortSignal): Promise<SongHit[]> {
  const res = await fetchApi(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail || `Search failed (${res.status})`, res.status);
  }
  const data = await res.json();
  return data.results ?? [];
}

/** The most-jammed songs on the site (empty while nobody has played anything yet). */
export async function getPopularSongs(): Promise<SongHit[]> {
  const res = await fetchApi(`${API_BASE}/api/popular`);
  if (!res.ok) return [];
  return (await res.json()).results ?? [];
}

/** Tells the catalog someone started playing a song (one jam session; repeats from the same visitor are ignored). */
export async function registerJam(videoId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/songs/${encodeURIComponent(videoId)}/jam`, { method: "POST", keepalive: true });
  } catch {
    // counting is best-effort
  }
}

/** Kicks off background extraction and returns immediately with a session id to poll. */
export async function startExtractFromYoutube(
  url: string,
  meta: Partial<Pick<SongHit, "title" | "artist" | "album" | "thumbnail" | "duration">> = {},
): Promise<{ sessionId: string }> {
  const res = await fetchApi(`${API_BASE}/api/extract/youtube`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      title: meta.title ?? "",
      artist: meta.artist ?? "",
      album: meta.album ?? "",
      thumbnail: meta.thumbnail ?? "",
      duration: meta.duration ?? 0,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail || `Extraction failed (${res.status})`);
  }
  return res.json();
}

/** Kicks off background extraction and returns immediately with a session id to poll. */
export async function startExtractFromUpload(file: File): Promise<{ sessionId: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetchApi(`${API_BASE}/api/extract/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail || `Extraction failed (${res.status})`);
  }
  return res.json();
}

export async function getJobStatus(sessionId: string): Promise<JobStatus> {
  const res = await fetchApi(`${API_BASE}/api/job/${sessionId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail || `Could not check progress (${res.status})`, res.status);
  }
  return res.json();
}

export async function getResult(sessionId: string): Promise<ExtractResult> {
  const res = await fetchApi(`${API_BASE}/api/result/${sessionId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail || `Could not load this song (${res.status})`);
  }
  return res.json();
}

/** One shelf of songs on the home page ("Trending in Hindi"...). Songs already chordified carry their chords and jam count. */
export interface TrendingShelf {
  id: string;
  title: string;
  about: string;
  songs: SongHit[];
}

/** What is trending, shelf by shelf (an empty list if the server cannot say right now). */
export async function getTrending(): Promise<TrendingShelf[]> {
  const res = await fetchApi(`${API_BASE}/api/trending`);
  if (!res.ok) return [];
  return (await res.json()).shelves ?? [];
}
