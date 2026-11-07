// Which influencer sent this phone, so their sign-ups are counted. The app has no cookie, so there are two ways to know:
//  - Google Play's install referrer: an influencer's app link (chordsuno.com/r/<name>/app) sends a phone to Play with "ref=<name>"
//    attached, and the app reads it once, on its first start (InstallReferrerModule.kt);
//  - a name the person types in Settings before signing in.
// The name goes to the server with the first sign-in, where it is credited once and never moves. Only a name is kept, nothing else.
import { NativeModules, Platform } from 'react-native';
import { recordAppReferral } from '../api';
import { getJson, setJson } from './storage';

const KEY = 'referral-v1'; // { slug, source: 'install' | 'code', counted }
const CHECKED = 'referral-install-checked';
const SLUG = /^[a-z0-9][a-z0-9-]{1,29}$/;

/** A typed name or a link made into the influencer's name: "@Priya", "chordsuno.com/r/priya" and "priya" are all "priya". */
export function cleanCode(text) {
  let t = String(text || '').trim().toLowerCase();
  const link = t.match(/\/r\/([a-z0-9-]+)/);
  if (link) t = link[1];
  t = t.replace(/^@/, '');
  return SLUG.test(t) ? t : '';
}

export const getReferral = () => {
  const saved = getJson(KEY, null);
  return saved && SLUG.test(saved.slug || '') ? saved : null;
};

/** The name to send with a sign-in ('' when there is none). */
export const referralToSend = () => (getReferral() ? getReferral().slug : '');

function visitorId() {
  // the same random id the ratings use (api/index.js); made here too in case nothing has asked for it yet
  const saved = getJson('visitor', '');
  if (typeof saved === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  let id = '';
  for (let i = 0; i < 24; i++) id += Math.floor(Math.random() * 36).toString(36);
  setJson('visitor', id);
  return id;
}

/** Keeps a name and tells the server, once, so the install (or code) is counted. Returns false if the name cannot be a link name. */
export function rememberReferral(slug, source) {
  const clean = cleanCode(slug);
  if (!clean) return false;
  const held = getReferral();
  if (held && held.slug === clean) return true;
  setJson(KEY, { slug: clean, source, counted: false });
  countReferral();
  return true;
}

function countReferral() {
  const held = getReferral();
  if (!held || held.counted) return;
  recordAppReferral(held.slug, visitorId(), held.source).then(
    () => setJson(KEY, { ...held, counted: true }),
    () => {}, // offline: counted on a later start
  );
}

/** Called when the app starts: reads Google Play's install referrer the first time only, and counts what has not been counted yet. */
export async function checkInstallReferral() {
  try {
    if (!getJson(CHECKED, false) && Platform.OS === 'android' && NativeModules.InstallReferrer) {
      const referrer = await NativeModules.InstallReferrer.getReferrer();
      setJson(CHECKED, true);
      const match = typeof referrer === 'string' ? referrer.match(/(?:^|&)ref=([^&]+)/) : null;
      if (match && !getReferral()) rememberReferral(decodeURIComponent(match[1]), 'install');
    }
  } catch {
    // no Play services, or a build that did not come from Play: nothing to read
  }
  countReferral();
}

/** The first sign-in has used the name (credited, or not an influencer): it is not sent again. */
export function forgetReferral() {
  setJson(KEY, null);
}
