import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearMyHistory, endOtherSessions, errorMessage, exportMyData, getMySecurity } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { AppBar, Button, Note } from '../components/Ui';
import { LINKS, VERSION_NAME } from '../config';
import { shareMyData } from '../lib/exporter';
import { chooseInstrument, INSTRUMENTS, instrumentFor, useInstrument } from '../lib/instrument';
import { setSettings, useSettings } from '../lib/settings';
import { radius, makeStyles, useColors } from '../theme';

const MODES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** The date the account was made ("memberSince" is seconds since 1970). */
const sinceText = (seconds) => (seconds ? new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '');

/** Settings and account: who is signed in (or the sign-in), what the person chooses (kept on the account too, so the website and every
 *  phone agree), their data, the legal links and deleting the account. */
export default function SettingsScreen({ navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const instrument = useInstrument();
  const { ready, user, config, plan, can, signInWithGoogle, signInAsReviewer, signOut, deleteAccount } = useAuth();
  const planName = (plan && plan.plan && plan.plan.name) || user?.planName || 'Free'; // the live plan, as the My plan screen shows it; the saved user may not have it
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [reviewer, setReviewer] = useState({ email: '', password: '' });
  const [sessions, setSessions] = useState(null); // how many phones and browsers are signed in
  const signedIn = !!user;
  const userId = user ? user.id : null;
  const mode = settings.theme;
  const shownInstrument = instrumentFor(instrument, can);

  const loadSessions = useCallback(() => {
    if (!userId) return;
    getMySecurity().then((s) => setSessions(s.sessions), () => {});
  }, [userId]);
  useEffect(() => {
    setSessions(null);
    loadSessions();
  }, [loadSessions]);

  /** Changes a setting; a phone that cannot reach the account keeps it and says so. */
  const change = async (patch) => {
    setInfo('');
    const saved = await setSettings(patch, signedIn);
    if (!saved) setInfo('Saved on this phone. It will go to your account when you are back online.');
  };

  const confirm = (title, message, action, label, name) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: 'destructive', onPress: () => action && run(name, action) },
    ]);

  const run = async (name, task) => {
    setBusy(name);
    setError('');
    try {
      await task();
    } catch (err) {
      // The person closing the Google window is not a failure.
      if (!(err && (err.code === 'SIGN_IN_CANCELLED' || err.code === '12501' || err.code === 'ASYNC_OP_IN_PROGRESS'))) setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'Your account, library, progress and ratings are deleted for good, and a paid plan is cancelled at once, without a refund. This cannot be undone.',
      [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => run('delete', deleteAccount) },
      ],
    );

  return (
    <View style={styles.screen}>
      <AppBar title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Note>{error}</Note>
        <Note tone="info">{info}</Note>

        {!ready ? null : user ? (
          <View style={styles.card}>
            <View style={styles.who}>
              {user.picture ? <Image source={{ uri: user.picture }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarEmpty]}><Icon name="user" size={30} color={colors.accent} /></View>}
              <View style={styles.whoText}>
                <Text style={styles.name} numberOfLines={1}>
                  {user.name}
                </Text>
                <Text style={styles.email} numberOfLines={1}>
                  {user.email}
                </Text>
                <Text style={styles.plan}>{planName} plan</Text>
              </View>
            </View>
            <Button title="Sign out" kind="quiet" busy={busy === 'out'} onPress={() => run('out', signOut)} style={styles.gap} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.big}>Sign in to Chord Suno</Text>
            <Text style={styles.sub}>Keep your songs and favourites, and earn XP and badges as you play.</Text>
            <Button title="Continue with Google" busy={busy === 'google'} disabled={!!config && !config.enabled} onPress={() => run('google', signInWithGoogle)} style={styles.gap} />
            {config && config.reviewerLogin ? (
              <View style={styles.reviewer}>
                <Text style={styles.sub}>Reviewer sign-in</Text>
                <TextInput value={reviewer.email} onChangeText={(email) => setReviewer((r) => ({ ...r, email }))} placeholder="Email" placeholderTextColor={colors.faint} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
                <TextInput value={reviewer.password} onChangeText={(password) => setReviewer((r) => ({ ...r, password }))} placeholder="Password" placeholderTextColor={colors.faint} secureTextEntry autoCapitalize="none" style={styles.input} />
                <Button title="Sign in" kind="quiet" busy={busy === 'reviewer'} onPress={() => run('reviewer', () => signInAsReviewer(reviewer.email, reviewer.password))} />
              </View>
            ) : null}
          </View>
        )}

        {signedIn ? (
          <View style={[styles.card, styles.gap]}>
            <Text style={styles.appearance}>Account and plan</Text>
            <View style={styles.fact}>
              <Text style={styles.factLabel}>Plan</Text>
              <Text style={styles.factValue}>{planName}</Text>
            </View>
            {user.memberSince ? (
              <View style={styles.fact}>
                <Text style={styles.factLabel}>Member since</Text>
                <Text style={styles.factValue}>{sinceText(user.memberSince)}</Text>
              </View>
            ) : null}
            <View style={styles.fact}>
              <Text style={styles.factLabel}>Signed in on</Text>
              <Text style={styles.factValue}>{sessions === null ? '…' : `${sessions} ${sessions === 1 ? 'device' : 'devices'}`}</Text>
            </View>
            <Button title="My plan" kind="quiet" onPress={() => navigation.navigate('Tabs', { screen: 'Premium' })} style={styles.gapSmall} />
            {sessions !== null && sessions > 1 ? (
              <Button
                title="Sign out of my other devices"
                kind="quiet"
                busy={busy === 'others'}
                onPress={() =>
                  confirm(
                    'Sign out of your other devices?',
                    'Every other phone and browser signed in to your account is signed out. This phone stays signed in.',
                    async () => {
                      const { ended } = await endOtherSessions();
                      setInfo(ended === 1 ? 'Signed out of 1 other device.' : `Signed out of ${ended} other devices.`);
                      loadSessions();
                    },
                    'Sign them out',
                    'others',
                  )
                }
                style={styles.gapSmall}
              />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.card, styles.gap]}>
          <Text style={styles.appearance}>Chords and player</Text>
          <Text style={styles.rowTitle}>Instrument</Text>
          <View style={styles.modes}>
            {INSTRUMENTS.map((item) => {
              const locked = !!item.feature && !can(item.feature);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => (locked ? setInfo('Piano, ukulele and mandolin chords come with a paid plan.') : chooseInstrument(item.id, signedIn))}
                  style={[styles.mode, shownInstrument === item.id && styles.modeOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: shownInstrument === item.id, disabled: locked }}
                >
                  <Text style={[styles.modeText, shownInstrument === item.id && styles.modeTextOn, locked && styles.modeLocked]} numberOfLines={1}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>Easy chords only</Text>
              <Text style={styles.modeHint}>Show the shapes that need no barre and sit near the nut. A chord with none keeps its usual shape.</Text>
            </View>
            <Switch value={settings.easyChords} onValueChange={(on) => change({ easyChords: on })} trackColor={{ false: colors.line, true: colors.accent }} thumbColor="#FFFFFF" accessibilityLabel="Easy chords only" />
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>Performance mode</Text>
              <Text style={styles.modeHint}>Turns off animations in the player. It helps on older phones.</Text>
            </View>
            <Switch value={settings.lite} onValueChange={(on) => change({ lite: on })} trackColor={{ false: colors.line, true: colors.accent }} thumbColor="#FFFFFF" accessibilityLabel="Performance mode" />
          </View>
          {signedIn ? null : <Text style={styles.modeHint}>These stay on this phone. Sign in to keep them on your account, on the website and on your other phones.</Text>}
        </View>

        <View style={[styles.card, styles.gap]}>
          <Text style={styles.appearance}>Appearance</Text>
          <View style={styles.modes}>
            {MODES.map((m) => (
              <Pressable key={m.id} onPress={() => change({ theme: m.id })} style={[styles.mode, mode === m.id && styles.modeOn]} accessibilityRole="button" accessibilityState={{ selected: mode === m.id }}>
                <Text style={[styles.modeText, mode === m.id && styles.modeTextOn]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.modeHint}>{mode === 'system' ? "Follows your phone's light or dark setting." : mode === 'dark' ? 'Easy on the eyes on stage and at night.' : 'Bright, like sheet music on paper.'}</Text>
        </View>

        {signedIn ? (
          <View style={[styles.card, styles.gap]}>
            <Text style={styles.appearance}>Privacy and data</Text>
            <Text style={styles.modeHint}>Your data is yours: take a copy, or clear what the app remembers about what you played.</Text>
            <Button
              title="Download my data"
              kind="quiet"
              busy={busy === 'export'}
              onPress={() => run('export', async () => shareMyData(await exportMyData()))}
              style={styles.gapSmall}
            />
            <Button
              title="Clear my play history"
              kind="quiet"
              busy={busy === 'history'}
              onPress={() =>
                confirm(
                  'Clear your play history?',
                  'The list of songs you opened is emptied, on this phone and on the website. Your favourites stay.',
                  async () => {
                    const { removed } = await clearMyHistory();
                    setInfo(removed === 1 ? 'Cleared 1 song from your history.' : `Cleared ${removed} songs from your history.`);
                  },
                  'Clear it',
                  'history',
                )
              }
              style={styles.gapSmall}
            />
          </View>
        ) : null}

        <View style={styles.list}>
          <Link title="Privacy Policy" url={LINKS.privacy} />
          <Link title="Terms of Use" url={LINKS.terms} />
          <Link title="Contact support" url={LINKS.support} />
          <Link title="YouTube Terms of Service" url={LINKS.youtubeTerms} />
          <Link title="Google Privacy Policy" url={LINKS.googlePrivacy} />
          {user ? (
            <Pressable onPress={confirmDelete} style={styles.link} accessibilityRole="button">
              <Text style={[styles.linkText, styles.deleteText]}>{busy === 'delete' ? 'Deleting…' : 'Delete my account'}</Text>
            </Pressable>
          ) : (
            <Link title="Delete your account and data" url={LINKS.deleteAccount} />
          )}
        </View>
        <Text style={styles.version}>Chord Suno {VERSION_NAME}</Text>
      </ScrollView>
    </View>
  );
}

function Link({ title, url }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable onPress={() => Linking.openURL(url).catch(() => {})} style={styles.link} accessibilityRole="link" android_ripple={{ color: colors.ripple }}>
      <Text style={styles.linkText}>{title}</Text>
      <Icon name="forward" size={20} color={colors.faint} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  card: { padding: 18, borderRadius: radius.card, backgroundColor: colors.surface },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  whoText: { flex: 1 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accentSoft },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  email: { color: colors.mute, fontSize: 14, marginTop: 1 },
  plan: { color: colors.accentDeep, fontSize: 13, fontWeight: '700', marginTop: 4 },
  big: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  sub: { color: colors.mute, fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  gap: { marginTop: 16 },
  reviewer: { marginTop: 22, gap: 10 },
  input: { height: 46, borderRadius: 12, backgroundColor: colors.soft, color: colors.ink, paddingHorizontal: 14, fontSize: 15 },
  appearance: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  modes: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: 14, padding: 4, marginTop: 12 },
  mode: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeOn: { backgroundColor: colors.accent },
  modeText: { color: colors.accentDeep, fontSize: 14.5, fontWeight: '700' },
  modeTextOn: { color: colors.onAccent },
  modeHint: { color: colors.mute, fontSize: 13, lineHeight: 18, marginTop: 6 },
  modeLocked: { opacity: 0.45 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginTop: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  switchText: { flex: 1 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  factLabel: { color: colors.mute, fontSize: 14.5 },
  factValue: { color: colors.ink, fontSize: 14.5, fontWeight: '700' },
  gapSmall: { marginTop: 12 },
  list: { marginTop: 18, borderRadius: radius.card, backgroundColor: colors.surface, overflow: 'hidden' },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  linkText: { color: colors.ink, fontSize: 15.5, fontWeight: '500' },
  deleteText: { color: colors.danger },
  version: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 20 },
}));
