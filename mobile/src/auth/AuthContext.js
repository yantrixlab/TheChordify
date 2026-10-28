import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as api from '../api';
import { getJson, loadToken, saveToken, setJson } from '../lib/storage';

const AuthContext = createContext(null);

// What Google's sign-in says when it fails, in words for the person (the codes are Android's ApiException status codes).
const GOOGLE_PROBLEMS = {
  10: 'Google sign-in is not set up for this version of the app yet. Please update the app, or try again later.', // DEVELOPER_ERROR: this build's signing key is not registered with Google
  7: 'No connection. Check your internet and try again.',
  8: 'Google had a problem. Please try again.',
  12500: 'Google could not sign you in. Please try again.',
  12502: 'A sign-in is already open. Finish it, or close it and try again.',
  PLAY_SERVICES_NOT_AVAILABLE: 'Google Play services is missing or out of date on this phone, so Google sign-in cannot open.',
};

/** Turns a failure of Google's own sign-in window into an Error with a plain message; a cancel is passed on as it is. */
function googleFailure(err) {
  const code = err && err.code !== undefined ? String(err.code) : '';
  if (__DEV__) console.warn(`[google sign-in] ${code} ${err && err.message}`);
  if (code === 'SIGN_IN_CANCELLED' || code === '12501' || code === 'ASYNC_OP_IN_PROGRESS') return err;
  const failure = new Error(GOOGLE_PROBLEMS[code] || 'Google sign-in did not work. Please try again.');
  failure.code = code;
  return failure;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(getJson('user'));
  const [config, setConfig] = useState(null);
  const [plan, setPlan] = useState(null); // { plan: { code, name, isFree }, entitlements: { key: { enabled, value } }, subscription }
  const googleReady = useRef(false);

  // What the person's plan includes. A different person (signing in or out) has a different plan.
  const refreshPlan = useCallback(() => api.getMyPlan().then(setPlan, () => {}), []);
  const userId = user ? user.id : null;
  useEffect(() => {
    if (ready) refreshPlan();
  }, [ready, userId, refreshPlan]);
  // The admin can change what a plan includes at any time: ask again whenever the app comes back to the front, so the change shows
  // without the app being closed first.
  useEffect(() => {
    if (!ready) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPlan();
    });
    return () => sub.remove();
  }, [ready, refreshPlan]);

  // The same rules as the website: a feature the plan has no rule for is allowed, and until the answer arrives nothing is locked.
  const can = useCallback((key) => {
    const rule = plan && plan.entitlements ? plan.entitlements[key] : undefined;
    return rule === undefined ? true : !!rule.enabled;
  }, [plan]);
  const limitOf = useCallback((key) => {
    const rule = plan && plan.entitlements ? plan.entitlements[key] : undefined;
    if (rule === undefined) return null;
    return rule.enabled ? rule.value : 0;
  }, [plan]);

  const remember = useCallback(async (nextUser, token) => {
    setUser(nextUser);
    setJson('user', nextUser);
    if (token !== undefined) {
      api.setToken(token);
      await saveToken(token);
    }
  }, []);

  const forget = useCallback(async () => {
    api.setToken('');
    await saveToken('');
    setUser(null);
    setJson('user', null);
  }, []);

  // Start: take the saved sign-in out of the Keystore and ask the server who it is. Offline, the person last seen stays.
  useEffect(() => {
    let alive = true;
    (async () => {
      api.setSignedOutHandler(() => alive && forget());
      const token = await loadToken();
      api.setToken(token);
      if (token) {
        try {
          const { user: me } = await api.getMe();
          if (alive) {
            if (me) await remember(me);
            else await forget();
          }
        } catch {
          // no connection: keep what we had
        }
      } else if (alive) {
        setUser(null);
        setJson('user', null);
      }
      if (alive) setReady(true);
      api.getAuthConfig().then((c) => alive && setConfig(c)).catch(() => {});
    })();
    return () => {
      alive = false;
    };
  }, [forget, remember]);

  const signInWithGoogle = useCallback(async () => {
    const cfg = config || (await api.getAuthConfig());
    setConfig(cfg);
    if (!cfg.enabled) throw new Error('Sign-in is not set up yet.');
    if (!googleReady.current) {
      // The ID token must be made for the website's client id: the server checks it against that one.
      GoogleSignin.configure({ webClientId: cfg.googleClientId });
      googleReady.current = true;
    }
    let idToken;
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      idToken = result && result.data ? result.data.idToken : result && result.idToken;
    } catch (err) {
      throw googleFailure(err);
    }
    if (!idToken) return null; // the person closed the window
    const answer = await api.signInWithGoogle(idToken);
    // A server that does not know the apps yet answers with a cookie only: nothing to keep, so do not pretend to be signed in.
    if (!answer.token) throw new Error('The server is not ready for the app yet. Please try again in a little while.');
    await remember(answer.user, answer.token);
    return answer.user;
  }, [config, remember]);

  const signInAsReviewer = useCallback(
    async (email, password) => {
      const answer = await api.signInAsReviewer(email, password);
      if (!answer.token) throw new Error('The server is not ready for the app yet. Please try again in a little while.');
      await remember(answer.user, answer.token);
      return answer.user;
    },
    [remember],
  );

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } catch {
      // signed out here either way
    }
    try {
      if (googleReady.current) await GoogleSignin.signOut();
    } catch {
      // nothing to sign out of
    }
    await forget();
  }, [forget]);

  const deleteAccount = useCallback(async () => {
    await api.deleteMyAccount();
    try {
      if (googleReady.current) await GoogleSignin.revokeAccess();
    } catch {
      // the account is gone on our side either way
    }
    await forget();
  }, [forget]);

  const value = useMemo(
    () => ({ ready, user, config, plan, can, limitOf, refreshPlan, signInWithGoogle, signInAsReviewer, signOut, deleteAccount }),
    [ready, user, config, plan, can, limitOf, refreshPlan, signInWithGoogle, signInAsReviewer, signOut, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
