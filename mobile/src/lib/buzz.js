import { Vibration } from 'react-native';

// Android refuses to buzz unless the app declares the VIBRATE permission (AndroidManifest.xml has it), and the refusal is thrown
// inside the phone's own code where JavaScript cannot catch it, so this stays in step with the manifest.
const ENABLED = true;

/** A short buzz of the phone (a string in tune, a count-in beat). */
export function buzz(ms = 20) {
  if (ENABLED) Vibration.vibrate(ms);
}
