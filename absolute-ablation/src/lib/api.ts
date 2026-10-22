// Dev talks to the local backend. A production build uses same-origin paths (/api, /media),
// which the reverse proxy in deploy/Caddyfile forwards to the backend. PUBLIC_API_BASE overrides both.
export const API_BASE: string =
  import.meta.env.PUBLIC_API_BASE ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

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

async function fetchApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(
      "Could not reach the chord extraction server. Please check your connection and try again.",
    );
  }
}

/** Kicks off background extraction and returns immediately with a session id to poll. */
export async function startExtractFromYoutube(url: string): Promise<{ sessionId: string }> {
  const res = await fetchApi(`${API_BASE}/api/extract/youtube`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
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
