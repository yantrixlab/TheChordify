// Sign-in with Google, and who is signed in. The browser gets a signed ID token from Google's button, the server checks
// it and answers with a cookie (HttpOnly, so nothing here ever sees the session itself). There are no passwords.
import { API_BASE } from "./api";
import { track } from "./analytics";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  plan: string; // the plan code ("free", "premium"...)
  planName?: string;
  instrument?: string; // the instrument they show chords for ("" until chosen)
  settings?: { easyChords: boolean; lite: boolean; theme: "system" | "light" | "dark" }; // what they chose in Settings, kept on the account
  settingsSaved?: string[]; // which of those they have set (the rest are the defaults, so a choice made before signing in is kept)
  memberSince?: number; // when the account was made (seconds since 1970)
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
  // Everything that listens to "auth-change" reloads its data (the plan, the favourites, the library...), so it is only said when
  // something changed: asking the server again and getting the same person back changes nothing.
  let before = "";
  try {
    before = localStorage.getItem(HINT_KEY) ?? "";
  } catch {
    // no storage: every answer counts as news
  }
  const after = user ? JSON.stringify(user) : "";
  try {
    if (user) localStorage.setItem(HINT_KEY, after);
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // no storage: the menu just waits for the server
  }
  if (before === after && before !== "") return;
  if (!before && !user) return; // signed out before, signed out now
  window.dispatchEvent(new CustomEvent<AuthUser | null>("auth-change", { detail: user }));
}

/** Folds new numbers (after earning XP) into the remembered person, so the ring around their picture moves at once. */
export function updateUser(patch: Partial<AuthUser>) {
  const user = cachedUser();
  if (user) remember({ ...user, ...patch });
}

let meInFlight: Promise<AuthUser | null> | null = null;

/** The signed-in person, or null. Also refreshes the cached hint. The menu and the page both ask: they share one request. */
export function getMe(fresh = false): Promise<AuthUser | null> {
  if (fresh) meInFlight = null; // just signed in: an answer asked for before that may be about nobody
  meInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
      if (!res.ok) return cachedUser(); // the server is having a moment: keep showing what we knew
      const user: AuthUser | null = (await res.json()).user ?? null;
      remember(user);
      return user;
    } catch {
      return cachedUser();
    }
  })().finally(() => {
    meInFlight = null;
  });
  return meInFlight;
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // signed out here either way
  }
  remember(null);
}

/** Deletes the signed-in person's account and data (the server cancels a paid plan first). Throws an Error with a sentence to show. */
export async function deleteAccount(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/me`, { method: "DELETE", credentials: "include" });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "We could not delete the account. Please try again, or write to us.");
  }
  try {
    for (const key of ["chordsuno-visitor", "chordsuno-lite", "cs-user"]) localStorage.removeItem(key);
  } catch {
    // nothing kept here to remove
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
  const full = await getMe(true); // the server's own answer for who this is now (level, XP, plan): the same a refresh would show
  track("login", { method: "google" });
  return full ?? body.user;
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
  const full = await getMe(true);
  track("login", { method: "reviewer" });
  return full ?? body.user;
}

/** Gives Google's library the client id and the one place a sign-in is handed to (once per page: the button and One Tap share it). */
function initialiseGoogle(clientId: string) {
  if (initialisedFor === clientId) return;
  (window as any).google.accounts.id.initialize({
    client_id: clientId,
    callback: (response: { credential: string }) => onCredential(response.credential),
    cancel_on_tap_outside: false, // the prompt is offered by itself, so a click on the page must not make it vanish
    use_fedcm_for_prompt: true, // Chrome's own account chooser at the top right, where it can; Google's card in the same corner elsewhere
    itp_support: true,
  });
  initialisedFor = clientId;
}

/** How Google's prompt ended, so the caller can leave a visitor alone who said no. */
export type OneTapEnd = "shown" | "dismissed" | "unavailable" | "signedIn";

/**
 * Offers Google's one-tap sign-in: the card (or Chrome's account chooser) at the top right of the page with the Google account the visitor
 * is already using, one click to continue. `onUser` runs once the server has accepted the sign-in; `done` says how the prompt ended.
 * Does nothing (and says "unavailable") when sign-in is not switched on or Google cannot be loaded.
 */
export async function promptOneTap(onUser: (user: AuthUser) => void, done: (end: OneTapEnd) => void): Promise<void> {
  const config = await getAuthConfig();
  if (!config.enabled || !config.googleClientId) return done("unavailable");
  try {
    await loadGoogle();
  } catch {
    return done("unavailable");
  }
  onCredential = async (credential) => {
    try {
      const user = await sendCredential(credential);
      done("signedIn");
      onUser(user);
    } catch {
      done("dismissed");
    }
  };
  initialiseGoogle(config.googleClientId);
  (window as any).google.accounts.id.prompt((moment: any) => {
    const call = (name: string): boolean => {
      try {
        return typeof moment?.[name] === "function" && !!moment[name]();
      } catch {
        return false;
      }
    };
    const reason = (name: string): string => {
      try {
        return typeof moment?.[name] === "function" ? String(moment[name]() || "") : "";
      } catch {
        return "";
      }
    };
    if (call("isDisplayed")) return done("shown");
    if (call("isNotDisplayed")) return done(reason("getNotDisplayedReason") === "suppressed_by_user" ? "dismissed" : "unavailable");
    // only a visitor's own "no" counts (the card closed, or a click outside it); a prompt that failed or was taken away by the page does not
    if (call("isSkippedMoment")) return done(["user_cancel", "tap_outside"].includes(reason("getSkippedReason")) ? "dismissed" : "unavailable");
    if (call("isDismissedMoment")) return done("unavailable");
  });
}

/** Takes the one-tap prompt away (the sign-in window is opening, or the visitor has just signed in). */
export function cancelOneTap() {
  try {
    (window as any).google?.accounts?.id?.cancel();
  } catch {
    // nothing was showing
  }
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
  initialiseGoogle(config.googleClientId);
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
