// What a person chooses in Settings: easy chords only, performance mode and the theme (the instrument has its own module,
// instrument.js). Each is kept on the phone, so it applies before the server is asked, and for somebody signed in also on their account,
// so the website and the app on every device agree (the same three as lib/settings.ts on the website).
import { useSyncExternalStore } from 'react';
import { saveMySettings } from '../api';
import { getThemeMode, setThemeMode } from '../theme';
import { getJson, setJson } from './storage';

export const DEFAULTS = { easyChords: false, lite: false, theme: 'system' };
const THEMES = ['system', 'light', 'dark'];
const KEY = 'settings-v1';
const PENDING = 'settings-pending'; // changes the account has not heard yet (the phone was offline)

const saved = getJson(KEY, {}) || {};
let current = {
  easyChords: saved.easyChords === true,
  lite: saved.lite === true,
  theme: getThemeMode(),
};
const listeners = new Set();
const announce = () => listeners.forEach((fn) => fn());
const persist = () => setJson(KEY, { easyChords: current.easyChords, lite: current.lite });

export const getSettings = () => current;

/** Re-draws whoever shows a setting when it changes, here or from the account. */
export function useSettings() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

const pendingOf = () => getJson(PENDING, {}) || {};

/** Sends changes to the account; what could not be sent is remembered and sent next time. */
async function push(patch, signedIn) {
  if (!signedIn || !Object.keys(patch).length) return true;
  try {
    await saveMySettings(patch);
    const left = pendingOf();
    for (const key of Object.keys(patch)) delete left[key];
    setJson(PENDING, Object.keys(left).length ? left : null);
    return true;
  } catch {
    setJson(PENDING, { ...pendingOf(), ...patch });
    return false; // offline: it stays on this phone, and goes up when the account is next seen
  }
}

/** Changes settings: applied and kept on the phone at once, and sent to the account. Resolves false if the account could not be reached. */
export function setSettings(patch, signedIn) {
  const next = { ...current, ...patch };
  const changed = Object.keys(DEFAULTS).filter((k) => next[k] !== current[k]);
  if (!changed.length) return Promise.resolve(true);
  current = next;
  persist();
  if (changed.includes('theme')) setThemeMode(next.theme);
  announce();
  return push(Object.fromEntries(changed.map((k) => [k, next[k]])), signedIn);
}

/** Somebody has signed in (or the app asked who they are): they bring the choices made on another device. A choice made on this phone
 *  and not yet sent, or made before signing in on something the account never set, is kept and becomes the account's. */
export function adoptAccountSettings(user) {
  if (!user || !user.settings) return;
  const account = user.settings;
  const set = new Set(user.settingsSaved || []);
  const waiting = pendingOf();
  const merged = { ...current };
  const toSend = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (key in waiting) toSend[key] = current[key];
    else if (set.has(key)) merged[key] = key === 'theme' ? (THEMES.includes(account.theme) ? account.theme : current.theme) : account[key] === true;
    else if (current[key] !== DEFAULTS[key]) toSend[key] = current[key];
  }
  if (Object.keys(DEFAULTS).some((k) => merged[k] !== current[k])) {
    current = merged;
    persist();
    setThemeMode(merged.theme);
    announce();
  }
  if (Object.keys(toSend).length) push(toSend, true);
}
