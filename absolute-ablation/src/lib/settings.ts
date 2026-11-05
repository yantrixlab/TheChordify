// What a person chooses in Settings: easy chords only, performance mode and the theme. (The instrument has its own module, instrument.ts.)
// Each is kept on the device, so a page can apply it before anything is asked of the server, and for somebody signed in also on their account,
// so the website and the app agree on every device. Pages listen for "settings-change".
import { API_BASE } from "./api";
import { cachedUser, updateUser } from "./auth";

export type Theme = "system" | "light" | "dark";
export interface Settings {
  easyChords: boolean;
  lite: boolean;
  theme: Theme;
}

export const DEFAULTS: Settings = { easyChords: false, lite: false, theme: "system" };
const KEYS: Record<keyof Settings, string> = { easyChords: "chordsuno-easy-chords", lite: "chordsuno-lite", theme: "chordsuno-theme" };
const THEMES: Theme[] = ["system", "light", "dark"];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // kept for this visit only
  }
}

let current: Settings = {
  easyChords: read(KEYS.easyChords) === "1",
  lite: read(KEYS.lite) === "1",
  theme: THEMES.includes(read(KEYS.theme) as Theme) ? (read(KEYS.theme) as Theme) : "system",
};

export const getSettings = (): Settings => ({ ...current });

const dark = matchMedia("(prefers-color-scheme: dark)");
/** Puts the theme on the page: "system" follows the device. */
export function applyTheme(theme: Theme = current.theme) {
  if (!document.documentElement.hasAttribute("data-themeable")) return; // a page without a dark theme stays light
  const resolved = theme === "system" ? (dark.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
dark.addEventListener("change", () => current.theme === "system" && applyTheme());

function announce() {
  window.dispatchEvent(new CustomEvent<Settings>("settings-change", { detail: getSettings() }));
}

function store(next: Settings) {
  write(KEYS.easyChords, next.easyChords ? "1" : "0");
  write(KEYS.lite, next.lite ? "1" : "0");
  write(KEYS.theme, next.theme);
}

async function push(patch: Partial<Settings>): Promise<boolean> {
  if (!cachedUser()) return true;
  try {
    const res = await fetch(`${API_BASE}/api/me/settings`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false; // offline: it is kept on this device
  }
}

/** Changes settings: applied and kept on the device at once, and sent to the account. Resolves false if the account could not be reached. */
export function setSettings(patch: Partial<Settings>): Promise<boolean> {
  const next = { ...current, ...patch };
  const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== current[k]);
  if (!changed.length) return Promise.resolve(true);
  current = next;
  store(next);
  if (changed.includes("theme")) applyTheme();
  const user = cachedUser();
  if (user) updateUser({ settings: next, settingsSaved: [...new Set([...(user.settingsSaved ?? []), ...changed])] });
  announce();
  return push(Object.fromEntries(changed.map((k) => [k, next[k]])) as Partial<Settings>);
}

// Signing in brings the choices made on another device. A choice made before signing in, on something the account never set, is kept (and
// becomes the account's).
let accountFor: string | null | undefined;
window.addEventListener("auth-change", (event) => {
  const user = (event as CustomEvent<{ id: string; settings?: Settings; settingsSaved?: string[] } | null>).detail;
  const id = user?.id ?? null;
  if (id === accountFor) return;
  accountFor = id;
  if (!user?.settings) return;
  const saved = new Set(user.settingsSaved ?? []);
  const merged = { ...current };
  const toSend: Partial<Settings> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (saved.has(key)) (merged as Record<string, unknown>)[key] = user.settings[key];
    else if (current[key] !== DEFAULTS[key]) (toSend as Record<string, unknown>)[key] = current[key];
  }
  const differs = (Object.keys(DEFAULTS) as (keyof Settings)[]).some((k) => merged[k] !== current[k]);
  if (differs) {
    current = merged;
    store(merged);
    applyTheme();
    announce();
  }
  if (Object.keys(toSend).length) void push(toSend);
});
// another tab of this browser changed one
window.addEventListener("storage", (event) => {
  if (!event.key || !Object.values(KEYS).includes(event.key)) return;
  current = {
    easyChords: read(KEYS.easyChords) === "1",
    lite: read(KEYS.lite) === "1",
    theme: THEMES.includes(read(KEYS.theme) as Theme) ? (read(KEYS.theme) as Theme) : "system",
  };
  applyTheme();
  announce();
});
