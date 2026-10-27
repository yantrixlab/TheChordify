import { createMMKV } from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';

// Small things the app remembers (the last signed-in person, recent searches): MMKV, which is synchronous and fast.
const store = createMMKV({ id: 'chordsuno' });

export function getJson(key, fallback = null) {
  try {
    const text = store.getString(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function setJson(key, value) {
  try {
    if (value === null || value === undefined) store.remove(key);
    else store.set(key, JSON.stringify(value));
  } catch {
    // remembering is best effort
  }
}

// The sign-in token is a secret: it goes in the Android Keystore (through Keychain), not with the rest.
const SERVICE = 'com.yantrixlab.chordsuno.session';

export async function loadToken() {
  try {
    const found = await Keychain.getGenericPassword({ service: SERVICE });
    return found ? found.password : '';
  } catch {
    return '';
  }
}

export async function saveToken(token) {
  try {
    if (token) await Keychain.setGenericPassword('session', token, { service: SERVICE });
    else await Keychain.resetGenericPassword({ service: SERVICE });
  } catch {
    // the person just signs in again next time
  }
}
