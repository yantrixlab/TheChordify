import { Vibration } from 'react-native';

// Android refuses to buzz unless the app declares the VIBRATE permission (it is in AndroidManifest.xml now), and the refusal is
// thrown inside the phone's own code where JavaScript cannot catch it. Switch this on once the app has been rebuilt with it.
const ENABLED = false;

/** A short buzz of the phone (a string in tune, a count-in beat). */
export function buzz(ms = 20) {
  if (ENABLED) Vibration.vibrate(ms);
}
