// What people think of the chords of a song: stars (and a few words), kept on the server. A signed-in person rates under their account;
// everyone else under a random id this browser makes for itself, so a song is rated once from here and the rating can be changed.
import { API_BASE, ApiError, fetchApi } from "./api";

export interface RatingSummary {
  count: number;
  average: number;
  mine: { stars: number; comment: string } | null;
}

const KEY = "chordsuno-visitor";
let memory = "";

/** This browser's own id for rating (random; not tied to anything about the person). */
function visitor(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  } catch {
    // no storage: the id lasts until the page is closed
  }
  if (!memory) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    memory = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
    try {
      localStorage.setItem(KEY, memory);
    } catch {
      // not remembered
    }
  }
  return memory;
}

export async function getRating(sessionId: string): Promise<RatingSummary | null> {
  const res = await fetchApi(`${API_BASE}/api/songs/${encodeURIComponent(sessionId)}/rating?v=${visitor()}`, { credentials: "include" }).catch(() => null);
  return res && res.ok ? ((await res.json()) as RatingSummary) : null;
}

/** Saves the rating (and what was said) and returns the song's new totals. Throws an ApiError with a sentence to show. */
export async function saveRating(sessionId: string, stars: number, comment = ""): Promise<RatingSummary> {
  const res = await fetchApi(`${API_BASE}/api/songs/${encodeURIComponent(sessionId)}/rating`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stars, comment, visitor: visitor() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof body.detail === "string" ? body.detail : "Could not save your rating. Please try again.", res.status);
  return body as RatingSummary;
}
