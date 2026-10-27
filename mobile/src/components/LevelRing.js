import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '../theme';

/** A profile picture inside a ring that fills as the person gets to their next level, with the level on a small gold badge. */
export function LevelRing({ user, profile, size = 96 }) {
  const stroke = Math.max(4, Math.round(size * 0.085));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = profile && profile.levelSpan > 0 ? Math.min(1, Math.max(0, profile.intoLevel / profile.levelSpan)) : 0;
  const inner = size - stroke * 2 - 6;
  const initials = (user.name || user.email || '?')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#a78bfa" />
            <Stop offset="0.55" stopColor="#ec4899" />
            <Stop offset="1" stopColor="#f59e0b" />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={(profile && profile.ring) || '#e6e0f0'} strokeWidth={stroke} fill="none" opacity={0.6} />
        {fraction > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="url(#ring)"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference * fraction} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        ) : null}
      </Svg>
      <View style={[styles.photo, { left: (size - inner) / 2, top: (size - inner) / 2, width: inner, height: inner, borderRadius: inner / 2 }]}>
        {user.picture ? <Image source={{ uri: user.picture }} style={StyleSheet.absoluteFill} /> : <Text style={[styles.initials, { fontSize: inner * 0.36 }]}>{initials}</Text>}
      </View>
      {profile ? (
        <View style={styles.chip}>
          <Text style={styles.chipText}>{profile.level}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.violetSoft, alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.violetDeep, fontWeight: '800' },
  chip: { position: 'absolute', right: -2, bottom: -2, minWidth: 26, height: 26, paddingHorizontal: 6, borderRadius: 13, backgroundColor: '#fbbf24', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipText: { color: '#5b3a00', fontSize: 13, fontWeight: '800' },
});
