// The instrument a person wants chords shown for (guitar, piano, ukulele or mandolin), in one place for every page.
// It is kept on the device, and for somebody signed in also on their account, so the website and the app agree on every device.
// Every page that draws chords reads it from here and listens for "instrument-change", so a change made anywhere shows everywhere.
import { API_BASE } from "./api";
import { cachedUser, updateUser } from "./auth";
import type { InstrumentId } from "./chordShapes";

export type { InstrumentId };

export interface InstrumentInfo {
  id: InstrumentId;
  label: string;
  icon: string;
  /** The plan feature a non-guitar instrument needs ("More instruments"); the guitar is for everybody. */
  feature: string | null;
}

export const INSTRUMENTS: InstrumentInfo[] = [
  { id: "guitar", label: "Guitar", icon: "🎸", feature: null },
  { id: "piano", label: "Piano", icon: "🎹", feature: "instruments_more" },
  { id: "ukulele", label: "Ukulele", icon: "🪗", feature: "instruments_more" },
  { id: "mandolin", label: "Mandolin", icon: "🎵", feature: "instruments_more" },
];

const KEY = "chordsuno-instrument";
const valid = (value: unknown): value is InstrumentId => INSTRUMENTS.some((i) => i.id === value);

function readStored(): InstrumentId {
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) return saved;
  } catch {
    // no storage: the guitar until the page is closed
  }
  return "guitar";
}

let current: InstrumentId = readStored();

/** The instrument chosen (not yet checked against the plan: see `instrumentFor`). */
export const getInstrument = (): InstrumentId => current;

/** The instrument to draw, given what the plan includes: the choice if the plan allows it, else the guitar. */
export function instrumentFor(allowed: (feature: string) => boolean): InstrumentId {
  const info = INSTRUMENTS.find((i) => i.id === current);
  return !info || (info.feature && !allowed(info.feature)) ? "guitar" : current;
}

function announce() {
  window.dispatchEvent(new CustomEvent<{ instrument: InstrumentId }>("instrument-change", { detail: { instrument: current } }));
}

function store(id: InstrumentId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // the choice just is not remembered on this device
  }
}

async function pushToAccount(id: InstrumentId) {
  if (!cachedUser()) return;
  try {
    await fetch(`${API_BASE}/api/me/instrument`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrument: id }),
    });
  } catch {
    // offline: it is kept on this device and sent the next time something is chosen
  }
}

/** Chooses an instrument: kept on the device and (signed in) on the account, and every page is told. */
export function setInstrument(id: InstrumentId) {
  if (!valid(id) || id === current) return;
  current = id;
  store(id);
  if (cachedUser()) updateUser({ instrument: id }); // the remembered person stays in step, so a refresh does not bring the old one back
  announce();
  void pushToAccount(id);
}

// A person who signs in brings the instrument they chose on another device; somebody who chose one before signing in keeps it
// (it becomes theirs). Other tabs of the same browser follow too.
let accountFor: string | null | undefined;
window.addEventListener("auth-change", (event) => {
  const user = (event as CustomEvent<{ id: string; instrument?: string } | null>).detail;
  const id = user?.id ?? null;
  if (id === accountFor) return;
  accountFor = id;
  if (!user) return;
  if (valid(user.instrument)) {
    if (user.instrument !== current) {
      current = user.instrument;
      store(current);
      announce();
    }
  } else if (current !== "guitar") {
    void pushToAccount(current);
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === KEY && valid(event.newValue) && event.newValue !== current) {
    current = event.newValue;
    announce();
  }
});
