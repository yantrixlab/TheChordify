// Sign-in with Google, and who is signed in. The browser gets a signed ID token from Google's button, the server checks
// it and answers with a cookie (HttpOnly, so nothing here ever sees the session itself). There are no passwords.
import { API_BASE } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  plan: string; // the plan code ("free", "premium"...)
  planName?: string;
  isAdmin: boolean;
  level?: number; // from the library: where they stand, for the menu
  title?: string;
  ring?: string; // an avatar ring colour they have earned
  stars?: number;
  xp?: number; // total XP, and how far through the current level they are (for the ring around the picture)
  intoLevel?: number;
  levelSpan?: number;
  nextLevelXp?: number;
  streak?: number;
}

interface AuthConfig {
  googleClientId: string;
  enabled: boolean;
  reviewerLogin?: boolean;
}

const HINT_KEY = "cs-user"; // the last signed-in person, so the menu can draw them before the server has answered
const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

let configPromise: Promise<AuthConfig> | null = null;

/** Whether sign-in is switched on (the server has a Google client id) and which id the button should use. */
export function getAuthConfig(): Promise<AuthConfig> {
  configPromise ??= fetch(`${API_BASE}/api/auth/config`)
    .then((res) => (res.ok ? res.json() : { googleClientId: "", enabled: false }))
    .catch(() => ({ googleClientId: "", enabled: false }));
  return configPromise;
}

export function cachedUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(HINT_KEY) || "null");
  } catch {
    return null;
  }
}

function remember(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(HINT_KEY, JSON.stringify(user));
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // no storage: the menu just waits for the server
  }
  window.dispatchEvent(new CustomEvent<AuthUser | null>("auth-change", { detail: user }));
}

/** Folds new numbers (after earning XP) into the remembered person, so the ring around their picture moves at once. */
export function updateUser(patch: Partial<AuthUser>) {
  const user = cachedUser();
  if (user) remember({ ...user, ...patch });
}

/** The signed-in person, or null. Also refreshes the cached hint. */
export async function getMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
    if (!res.ok) return cachedUser(); // the server is having a moment: keep showing what we knew
    const user: AuthUser | null = (await res.json()).user ?? null;
    remember(user);
    return user;
  } catch {
    return cachedUser();
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // signed out here either way
  }
  remember(null);
}

// ---- Google's button -------------------------------------------------------------------------------------------------

let googleReady: Promise<void> | null = null;
let initialisedFor = "";
let onCredential: (credential: string) => void = () => {};

function loadGoogle(): Promise<void> {
  googleReady ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleReady = null; // allow another try
      reject(new Error("Could not load Google sign-in. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return googleReady;
}

async function sendCredential(credential: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || "Sign-in did not work. Please try again.");
  remember(body.user);
  return body.user;
}

/** The sign-in for payment reviewers (it only works while the server has it switched on). Throws with a message that is safe to show. */
export async function signInAsReviewer(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/reviewer`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404) throw new Error("This sign-in is not switched on.");
  if (!res.ok) throw new Error(body.detail || "Sign-in did not work. Please try again.");
  remember(body.user);
  return body.user;
}

/**
 * Draws Google's "Continue with Google" button in `target`. `onUser` runs once the server has accepted the sign-in.
 * Returns false when sign-in is not switched on, so the caller can say so instead of leaving a blank space.
 */
export async function renderGoogleButton(
  target: HTMLElement,
  onUser: (user: AuthUser) => void,
  onError: (message: string) => void,
): Promise<boolean> {
  const config = await getAuthConfig();
  if (!config.enabled) return false;
  try {
    await loadGoogle();
  } catch (err) {
    onError(err instanceof Error ? err.message : "Could not load Google sign-in.");
    return true;
  }
  const google = (window as any).google;
  onCredential = async (credential) => {
    try {
      onUser(await sendCredential(credential));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Sign-in did not work. Please try again.");
    }
  };
  if (initialisedFor !== config.googleClientId) {
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: (response: { credential: string }) => onCredential(response.credential),
      cancel_on_tap_outside: true,
    });
    initialisedFor = config.googleClientId;
  }
  target.replaceChildren();
  google.accounts.id.renderButton(target, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    logo_alignment: "left",
    width: Math.min(300, Math.max(220, target.clientWidth || 300)),
  });
  return true;
}
