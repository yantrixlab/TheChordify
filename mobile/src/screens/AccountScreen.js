import { useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Button, Note } from '../components/Ui';
import { LINKS, VERSION_NAME } from '../config';
import { colors, radius } from '../theme';

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
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
      if (!(err && (err.code === 'SIGN_IN_CANCELLED' || err.code === '12501'))) setError(errorMessage(err));
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
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }}>
      <Text style={styles.heading}>Account</Text>
      <Note>{error}</Note>

      {!ready ? null : user ? (
        <View style={styles.card}>
          <View style={styles.who}>
            {user.picture ? <Image source={{ uri: user.picture }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarEmpty]} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              <Text style={styles.email} numberOfLines={1}>
                {user.email}
              </Text>
              <Text style={styles.plan}>{user.planName || 'Free'} plan</Text>
            </View>
          </View>
          <Button title="Sign out" kind="quiet" busy={busy === 'out'} onPress={() => run('out', signOut)} style={{ marginTop: 16 }} />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.big}>Sign in to Chord Suno</Text>
          <Text style={styles.sub}>Keep your songs and favourites, and earn XP and badges as you play.</Text>
          <Button
            title="Continue with Google"
            busy={busy === 'google'}
            disabled={!!config && !config.enabled}
            onPress={() => run('google', signInWithGoogle)}
            style={{ marginTop: 16 }}
          />
          {config && config.reviewerLogin ? (
            <View style={styles.reviewer}>
              <Text style={styles.sub}>Reviewer sign-in</Text>
              <TextInput
                value={reviewer.email}
                onChangeText={(email) => setReviewer((r) => ({ ...r, email }))}
                placeholder="Email"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
              />
              <TextInput
                value={reviewer.password}
                onChangeText={(password) => setReviewer((r) => ({ ...r, password }))}
                placeholder="Password"
                placeholderTextColor={colors.faint}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
              />
              <Button title="Sign in" kind="quiet" busy={busy === 'reviewer'} onPress={() => run('reviewer', () => signInAsReviewer(reviewer.email, reviewer.password))} />
            </View>
          ) : null}
        </View>
      )}

      <View style={styles.list}>
        <Link title="Privacy Policy" url={LINKS.privacy} />
        <Link title="Terms of Use" url={LINKS.terms} />
        <Link title="Contact support" url={LINKS.support} />
        {user ? (
          <Pressable onPress={confirmDelete} style={styles.link} accessibilityRole="button">
            <Text style={[styles.linkText, { color: '#f87171' }]}>{busy === 'delete' ? 'Deleting…' : 'Delete my account'}</Text>
          </Pressable>
        ) : (
          <Link title="Delete your account and data" url={LINKS.deleteAccount} />
        )}
      </View>
      <Text style={styles.version}>Chord Suno {VERSION_NAME}</Text>
    </ScrollView>
  );
}

function Link({ title, url }) {
  return (
    <Pressable onPress={() => Linking.openURL(url).catch(() => {})} style={styles.link} accessibilityRole="link" android_ripple={{ color: '#ffffff22' }}>
      <Text style={styles.linkText}>{title}</Text>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginBottom: 14 },
  card: { padding: 18, borderRadius: radius.card, backgroundColor: colors.card },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.violetDeep },
  avatarEmpty: { opacity: 0.6 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800' },
  email: { color: colors.mute, fontSize: 14, marginTop: 1 },
  plan: { color: colors.violetSoft, fontSize: 13, fontWeight: '700', marginTop: 4 },
  big: { color: colors.text, fontSize: 20, fontWeight: '800' },
  sub: { color: colors.mute, fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  reviewer: { marginTop: 22, gap: 10 },
  input: { height: 46, borderRadius: 12, backgroundColor: colors.cardStrong, color: colors.text, paddingHorizontal: 14, fontSize: 15 },
  list: { marginTop: 22, borderRadius: radius.card, backgroundColor: colors.card, overflow: 'hidden' },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  linkText: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  chev: { color: colors.faint, fontSize: 22 },
  version: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 20 },
});
