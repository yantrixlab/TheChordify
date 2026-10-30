import { useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { AppBar, Button, Note } from '../components/Ui';
import { LINKS, VERSION_NAME } from '../config';
import { radius, makeStyles, useColors, useTheme } from '../theme';

const MODES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** Settings and account: who is signed in (or the sign-in), the legal links and deleting the account. */
export default function SettingsScreen({ navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { mode, setMode } = useTheme();
  const { ready, user, config, signInWithGoogle, signInAsReviewer, signOut, deleteAccount } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reviewer, setReviewer] = useState({ email: '', password: '' });

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
                <Text style={styles.plan}>{user.planName || 'Free'} plan</Text>
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

        <View style={[styles.card, styles.gap]}>
          <Text style={styles.appearance}>Appearance</Text>
          <View style={styles.modes}>
            {MODES.map((m) => (
              <Pressable key={m.id} onPress={() => setMode(m.id)} style={[styles.mode, mode === m.id && styles.modeOn]} accessibilityRole="button" accessibilityState={{ selected: mode === m.id }}>
                <Text style={[styles.modeText, mode === m.id && styles.modeTextOn]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.modeHint}>{mode === 'system' ? "Follows your phone's light or dark setting." : mode === 'dark' ? 'Easy on the eyes on stage and at night.' : 'Bright, like sheet music on paper.'}</Text>
        </View>

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
  modeHint: { color: colors.mute, fontSize: 13, marginTop: 10 },
  list: { marginTop: 18, borderRadius: radius.card, backgroundColor: colors.surface, overflow: 'hidden' },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  linkText: { color: colors.ink, fontSize: 15.5, fontWeight: '500' },
  deleteText: { color: colors.danger },
  version: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 20 },
}));
