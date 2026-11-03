import { useSyncExternalStore } from 'react';
import { setMyInstrument } from '../api';
import { getJson, setJson } from './storage';

// The instrument the person wants chords shown for: guitar, piano, ukulele or mandolin. It is kept on the phone and, for somebody signed
// in, on their account, so the website and the app on every device agree (the same choice as lib/instrument.ts on the website).
export const INSTRUMENTS = [
  { id: 'guitar', label: 'Guitar', feature: null },
  { id: 'piano', label: 'Piano', feature: 'instruments_more' },
  { id: 'ukulele', label: 'Ukulele', feature: 'instruments_more' },
  { id: 'mandolin', label: 'Mandolin', feature: 'instruments_more' },
];

const KEY = 'instrument';
const valid = (id) => INSTRUMENTS.some((item) => item.id === id);

const saved = getJson(KEY, 'guitar');
let current = valid(saved) ? saved : 'guitar';
const listeners = new Set();
const announce = () => listeners.forEach((fn) => fn());

/** Re-draws whoever shows chords when the instrument changes, here or from the account. */
export function useInstrument() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** The instrument to draw, given what the plan includes: the choice if the plan allows it, else the guitar. */
export function instrumentFor(id, can) {
  const item = INSTRUMENTS.find((i) => i.id === id);
  return !item || (item.feature && !can(item.feature)) ? 'guitar' : id;
}

/** Chooses an instrument: kept on the phone and (signed in) on the account. */
export function chooseInstrument(id, signedIn) {
  if (!valid(id) || id === current) return;
  current = id;
  setJson(KEY, id);
  announce();
  if (signedIn) setMyInstrument(id).catch(() => {}); // offline: it stays on this phone
}

/** Somebody has signed in (or the app asked who they are): they bring the instrument they chose on another device. Somebody who chose
 *  one before signing in keeps it, and it becomes theirs. */
export function adoptAccountInstrument(user) {
  if (!user) return;
  if (valid(user.instrument)) {
    if (user.instrument !== current) {
      current = user.instrument;
      setJson(KEY, current);
      announce();
    }
  } else if (current !== 'guitar') {
    setMyInstrument(current).catch(() => {});
  }
}
