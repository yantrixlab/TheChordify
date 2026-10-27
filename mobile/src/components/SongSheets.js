import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { errorMessage, getRating, getSimilar, saveRating } from '../api';
import { Button, Note } from './Ui';
import { Sheet } from './Sheet';
import { SongRow } from './Songs';
import { colors } from '../theme';

/** What people think of the chords of this song, and the person's own stars and few words. */
export function RateSheet({ visible, sessionId, onClose }) {
  const [summary, setSummary] = useState(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSaved(false);
    setError('');
    getRating(sessionId).then((r) => {
      setSummary(r);
      if (r && r.mine) {
        setStars(r.mine.stars);
        setComment(r.mine.comment || '');
      }
    });
  }, [visible, sessionId]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      setSummary(await saveRating(sessionId, stars, comment.trim()));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not save your rating. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="Rate these chords" onClose={onClose}>
      <Text style={styles.summary}>{summary && summary.count > 0 ? `${summary.average.toFixed(1)} ★  ·  ${summary.count} rating${summary.count === 1 ? '' : 's'}` : 'Nobody has rated this song yet.'}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setStars(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`} accessibilityState={{ selected: stars >= n }}>
            <Text style={[styles.star, stars >= n && styles.starOn]}>★</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={comment} onChangeText={setComment} placeholder="Add a few words about the chords (optional)" placeholderTextColor={colors.faint} multiline maxLength={500} style={styles.input} />
      <Note>{error}</Note>
      {saved ? <Note tone="info">Thank you! Your rating is saved.</Note> : null}
      <Button title={summary && summary.mine ? 'Update my rating' : 'Save rating'} onPress={save} busy={busy} disabled={stars === 0} />
    </Sheet>
  );
}

/** Songs like this one, each with the reason it is there. */
export function SimilarSheet({ visible, sessionId, onPick, onClose }) {
  const [songs, setSongs] = useState(null);
  useEffect(() => {
    if (!visible) return;
    setSongs(null);
    getSimilar(sessionId).then(setSongs);
  }, [visible, sessionId]);
  return (
    <Sheet visible={visible} title="Songs like this" onClose={onClose} scroll>
      {songs === null ? <ActivityIndicator color={colors.violet} style={styles.loading} /> : null}
      {songs && songs.length === 0 ? <Text style={styles.summary}>No similar songs yet.</Text> : null}
      {(songs || []).map((song) => (
        <View key={song.videoId}>
          <SongRow song={song} onPress={onPick} />
          {song.why ? <Text style={styles.why}>{song.why}</Text> : null}
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { color: colors.mute, fontSize: 15, textAlign: 'center', marginBottom: 6 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 12 },
  star: { fontSize: 44, color: colors.line },
  starOn: { color: colors.gold },
  input: { minHeight: 84, maxHeight: 140, borderRadius: 14, backgroundColor: colors.soft, color: colors.ink, padding: 14, fontSize: 15, textAlignVertical: 'top', marginBottom: 8 },
  loading: { marginVertical: 30 },
  why: { marginLeft: 144, marginTop: -6, marginBottom: 8, color: colors.violetDeep, fontSize: 12, fontWeight: '700' },
});
