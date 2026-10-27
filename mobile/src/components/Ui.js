import { memo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

export function Button({ title, onPress, kind = 'primary', busy = false, disabled = false, style }) {
  const isPrimary = kind === 'primary';
  const isDanger = kind === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      android_ripple={{ color: '#ffffff33' }}
      style={[
        styles.button,
        isPrimary && styles.buttonPrimary,
        isDanger && styles.buttonDanger,
        kind === 'quiet' && styles.buttonQuiet,
        (disabled || busy) && styles.buttonOff,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.buttonText, kind === 'quiet' && { color: colors.violetSoft }]}>{title}</Text>}
    </Pressable>
  );
}

export function Note({ children, tone = 'error' }) {
  if (!children) return null;
  return (
    <View style={[styles.note, tone === 'info' && styles.noteInfo]}>
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

export function Centered({ children }) {
  return <View style={styles.centered}>{children}</View>;
}

export const Art = memo(function Art({ song, size, style }) {
  const uri = song.thumbnail || (song.videoId ? `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg` : '');
  const wide = !song.thumbnail || /ytimg\.com/.test(song.thumbnail);
  const dims = wide ? { width: size, height: Math.round((size * 9) / 16) } : { width: size, height: size };
  return (
    <View style={[styles.art, dims, style]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  button: { height: 48, paddingHorizontal: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  buttonPrimary: { backgroundColor: colors.violet },
  buttonDanger: { backgroundColor: colors.danger },
  buttonQuiet: { backgroundColor: colors.card },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  note: { marginVertical: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.errorBg },
  noteInfo: { backgroundColor: colors.card },
  noteText: { color: colors.error, fontSize: 14, lineHeight: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  art: { overflow: 'hidden', borderRadius: 10, backgroundColor: colors.violetDeep },
});
