import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { clock } from '../lib/grid';
import { Art } from './Ui';

/** A song as a row: the picture, the name, who plays it, and (when somebody has already had its chords made) its main chords. */
export const SongRow = memo(function SongRow({ song, onPress, trailing }) {
  const chords = (song.chords || []).slice(0, 4);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${song.title}${song.artist ? ` by ${song.artist}` : ''}`}
      onPress={() => onPress(song)}
      android_ripple={{ color: '#7c3aed22' }}
      style={styles.row}
    >
      <Art song={song} size={112} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {song.title}
        </Text>
        <Text style={styles.by} numberOfLines={1}>
          {[song.artist, song.duration > 0 ? clock(song.duration) : ''].filter(Boolean).join('  ·  ')}
        </Text>
        {chords.length > 0 ? (
          <View style={styles.chips}>
            {chords.map((c) => (
              <Text key={c} style={styles.chip}>
                {c}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
});

/** A song as a card for a shelf that scrolls sideways. */
export const SongCard = memo(function SongCard({ song, onPress, width = 168 }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${song.title}${song.artist ? ` by ${song.artist}` : ''}`}
      onPress={() => onPress(song)}
      android_ripple={{ color: '#7c3aed22' }}
      style={{ width }}
    >
      <Art song={song} size={width} style={styles.cardArt} />
      <Text style={styles.cardTitle} numberOfLines={2}>
        {song.title}
      </Text>
      <Text style={styles.by} numberOfLines={1}>
        {song.artist}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16 },
  body: { flex: 1, gap: 3 },
  title: { color: colors.ink, fontSize: 15.5, fontWeight: '700', lineHeight: 20 },
  by: { color: colors.mute, fontSize: 13.5 },
  chips: { flexDirection: 'row', gap: 5, marginTop: 4 },
  chip: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.violetSoft, color: colors.violetDeep, fontSize: 12, fontWeight: '700' },
  cardArt: { borderRadius: 12 },
  cardTitle: { color: colors.ink, fontSize: 14.5, fontWeight: '700', lineHeight: 19, marginTop: 8, minHeight: 38 },
});
