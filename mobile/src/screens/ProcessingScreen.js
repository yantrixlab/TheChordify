import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage, getJob } from '../api';
import { AppBar, Art, Button, Note } from '../components/Ui';
import { colors } from '../theme';

const STAGES = { queued: 'Waiting for a turn…', downloading: 'Fetching the song…', analyzing: 'Listening for the chords…' };

/** The waiting screen of a song that is being made: it asks the server how far along it is, and replaces itself with the player. */
export default function ProcessingScreen({ route, navigation }) {
  const { sessionId, song } = route.params;
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState('queued');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  const show = useCallback(
    (fraction) => {
      Animated.timing(progress, { toValue: Math.max(0.04, Math.min(1, fraction)), duration: 400, useNativeDriver: true }).start();
    },
    [progress],
  );

  useEffect(() => {
    let alive = true;
    let timer;
    let failures = 0;
    setError('');
    const poll = async () => {
      try {
        const job = await getJob(sessionId);
        if (!alive) return;
        failures = 0;
        if (job.status === 'done') {
          show(1);
          navigation.replace('Player', { sessionId, song, result: job.result });
          return;
        }
        if (job.status === 'error') {
          setError(job.error || 'We could not make the chords for this song.');
          return;
        }
        setStage(job.status);
        setDetail(job.stage || '');
        show(typeof job.progress === 'number' ? job.progress / (job.progress > 1 ? 100 : 1) : 0.1);
      } catch (err) {
        if (!alive) return;
        if (err.status === 404 || ++failures >= 5) {
          setError(errorMessage(err));
          return;
        }
      }
      timer = setTimeout(poll, 1500);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sessionId, song, navigation, show, attempt]);

  return (
    <View style={styles.screen}>
      <AppBar title="Chord Suno" backIcon="close" onBack={() => navigation.goBack()} />
      <View style={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      {song ? <Art song={song} size={260} style={styles.art} /> : null}
      <Text style={styles.title} numberOfLines={2}>
        {song && song.title ? song.title : 'Your song'}
      </Text>
      {song && song.artist ? <Text style={styles.by}>{song.artist}</Text> : null}
      {error ? (
        <View style={styles.fail}>
          <Note>{error}</Note>
          <Button title="Try again" onPress={() => setAttempt((n) => n + 1)} />
          <Button title="Back" kind="quiet" onPress={() => navigation.goBack()} style={{ marginTop: 10 }} />
        </View>
      ) : (
        <View style={styles.wait}>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, { transform: [{ scaleX: progress }] }]} />
          </View>
          <Text style={styles.stage}>{detail || STAGES[stage] || 'Working…'}</Text>
          <Text style={styles.hint}>A new song takes about a minute. Songs others have played open at once.</Text>
        </View>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: 'center', paddingTop: 28, paddingHorizontal: 24 },
  art: { marginBottom: 22, borderRadius: 16 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  by: { color: colors.mute, fontSize: 15, marginTop: 4 },
  wait: { width: '100%', marginTop: 32, alignItems: 'center' },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: colors.soft, overflow: 'hidden' },
  fill: { height: 6, width: '100%', backgroundColor: colors.violet, transformOrigin: 'left' },
  stage: { color: colors.violetDeep, fontSize: 15, fontWeight: '600', marginTop: 16 },
  hint: { color: colors.faint, fontSize: 13, textAlign: 'center', marginTop: 8 },
  fail: { width: '100%', marginTop: 28 },
});
