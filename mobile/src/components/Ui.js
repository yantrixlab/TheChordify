import { memo } from 'react';
import { ActivityIndicator, Image, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icons';
import { colors, radius } from '../theme';

/** The violet bar at the top of a screen: a title, an optional back or close button on the left and icon buttons on the right. */
export function AppBar({ title, onBack, backIcon = 'back', actions = [], subtitle, inset = true }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: inset ? insets.top : 0 }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bar} />
      <View style={styles.barRow}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={styles.barButton} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name={backIcon} color={colors.onBar} size={26} />
          </Pressable>
        ) : null}
        <View style={styles.barTitleBox}>
          <Text style={styles.barTitle} numberOfLines={subtitle ? 1 : 2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.barSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions.map((a) => (
          <Pressable key={a.icon} onPress={a.onPress} hitSlop={10} style={styles.barButton} accessibilityRole="button" accessibilityLabel={a.label}>
            <Icon name={a.icon} color={a.color || colors.onBar} size={24} filled={a.filled} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', busy = false, disabled = false, style, icon }) {
  const primary = kind === 'primary';
  const danger = kind === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      android_ripple={{ color: '#ffffff33' }}
      style={[styles.button, primary && styles.buttonPrimary, danger && styles.buttonDanger, kind === 'quiet' && styles.buttonQuiet, kind === 'outline' && styles.buttonOutline, (disabled || busy) && styles.buttonOff, style]}
    >
      {busy ? (
        <ActivityIndicator color={primary || danger ? '#fff' : colors.violet} />
      ) : (
        <View style={styles.buttonRow}>
          {icon ? <Icon name={icon} size={18} color={primary || danger ? '#fff' : colors.violetDeep} /> : null}
          <Text style={[styles.buttonText, !(primary || danger) && { color: colors.violetDeep }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Note({ children, tone = 'error' }) {
  if (!children) return null;
  return (
    <View style={[styles.note, tone === 'info' && styles.noteInfo]}>
      <Text style={[styles.noteText, tone === 'info' && { color: colors.violetDeep }]}>{children}</Text>
    </View>
  );
}

export function Centered({ children }) {
  return <View style={styles.centered}>{children}</View>;
}

export function SectionHeader({ title, onMore, moreLabel = 'See all' }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={10} style={styles.sectionMore} accessibilityRole="button">
          <Text style={styles.sectionMoreText}>{moreLabel}</Text>
          <Icon name="forward" size={18} color={colors.mute} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const Art = memo(function Art({ song, size, style, round = false }) {
  const uri = song.thumbnail || (song.videoId ? `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg` : '');
  const wide = !song.thumbnail || /ytimg\.com/.test(song.thumbnail);
  const dims = round ? { width: size, height: size, borderRadius: size / 2 } : wide ? { width: size, height: Math.round((size * 9) / 16) } : { width: size, height: size };
  return <View style={[styles.art, dims, style]}>{uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} /> : null}</View>;
});

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.bar },
  barRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingLeft: 8, paddingRight: 6 },
  barButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  barTitleBox: { flex: 1, paddingHorizontal: 10 },
  barTitle: { color: colors.onBar, fontSize: 20, fontWeight: "600" },
  barSub: { color: '#ffffffb3', fontSize: 13, marginTop: 1 },
  button: { height: 48, paddingHorizontal: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonPrimary: { backgroundColor: colors.violet },
  buttonDanger: { backgroundColor: colors.danger },
  buttonQuiet: { backgroundColor: colors.violetSoft },
  buttonOutline: { borderWidth: 1.5, borderColor: colors.violetDeep },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  note: { marginVertical: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.errorBg },
  noteInfo: { backgroundColor: colors.violetSoft },
  noteText: { color: colors.error, fontSize: 14, lineHeight: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  sectionMore: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionMoreText: { color: colors.mute, fontSize: 15 },
  art: { overflow: 'hidden', borderRadius: 10, backgroundColor: colors.violetSoft },
});
