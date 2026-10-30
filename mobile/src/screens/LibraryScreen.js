import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { errorMessage, getLibrary, getProfile } from '../api';
import { useAuth } from '../auth/AuthContext';
import { LevelRing } from '../components/LevelRing';
import { AppBar, Button, Centered, Note } from '../components/Ui';
import { SongRow } from '../components/Songs';
import { useOpenSong } from '../lib/useOpenSong';
import { radius, makeStyles, useColors } from '../theme';

const TABS = [
  { id: 'history', label: 'Recent' },
  { id: 'favorites', label: 'Favourites' },
  { id: 'badges', label: 'Badges' },
  { id: 'rewards', label: 'Rewards' },
];
const num = (n) => Number(n || 0).toLocaleString();
const date = (seconds) => new Date(seconds * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' });

function ProfileCard({ user, profile }) {
  const styles = useStyles();
  const percent = profile && profile.levelSpan > 0 ? Math.round((100 * profile.intoLevel) / profile.levelSpan) : 0;
  const stars = profile && profile.stars > 0 ? ` ${'★'.repeat(Math.min(profile.stars, 8))}${profile.stars > 8 ? `+${profile.stars - 8}` : ''}` : '';
  return (
    <View style={styles.profile}>
      <View style={styles.profileTop}>
        <LevelRing user={user} profile={profile} size={96} />
        <View style={styles.profileText}>
          <Text style={styles.name} numberOfLines={1}>
            {user.name || user.email}
          </Text>
          {profile ? (
            <Text style={styles.level}>
              <Text style={styles.levelNum}>LEVEL {profile.level}</Text>
              {`  ${profile.title}${stars}`}
            </Text>
          ) : null}
        </View>
      </View>
      {profile ? (
        <>
          <View style={styles.xpTop}>
            <Text style={styles.xpMain}>{num(profile.xp)} XP</Text>
            <Text style={styles.xpNext}>
              {num(profile.nextLevelXp - profile.xp)} XP to level {profile.level + 1}
            </Text>
          </View>
          <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View style={[styles.barFill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.nextReward}>{profile.nextReward ? `Next reward: ${profile.nextReward.name} at level ${profile.nextReward.nextAt}` : 'You have every reward there is. More levels, more stars.'}</Text>
          <View style={styles.stats}>
            {[
              [profile.streak, 'Day streak'],
              [profile.songs, 'Songs'],
              [profile.plays, 'Plays'],
              [profile.favorites, 'Favourites'],
            ].map(([value, label]) => (
              <View key={label} style={styles.stat}>
                <Text style={styles.statValue}>{num(value)}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Badge({ badge }) {
  const styles = useStyles();
  const pct = badge.threshold > 0 ? Math.round((100 * badge.progress) / badge.threshold) : 0;
  return (
    <View style={[styles.badge, badge.earned && styles.badgeEarned]}>
      <View style={[styles.badgeIcon, badge.earned && styles.badgeIconEarned, !badge.earned && styles.dim]}>
        <Text style={styles.badgeEmoji}>{badge.icon}</Text>
      </View>
      <View style={styles.badgeText}>
        <Text style={styles.badgeName}>{badge.name}</Text>
        <Text style={styles.badgeDesc}>{badge.description}</Text>
        {badge.earned ? (
          <Text style={styles.badgeEarnedText}>
            Earned {date(badge.earnedAt || 0)}
            {badge.bonusXp ? ` · +${badge.bonusXp} XP` : ''}
          </Text>
        ) : (
          <>
            <View style={styles.meter}>
              <View style={[styles.meterFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.badgeProgress}>
              {num(badge.progress)} / {num(badge.threshold)}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

function Reward({ reward }) {
  const styles = useStyles();
  const extra = reward.repeatEvery > 0 ? ` Comes again every ${reward.repeatEvery} levels.` : reward.kind === 'perk' && reward.value ? ` ${reward.value}.` : '';
  return (
    <View style={[styles.reward, !reward.unlocked && styles.dim]}>
      <View style={[styles.swatch, reward.kind === 'ring' && { backgroundColor: reward.value }]}>
        <Text style={styles.swatchText}>{reward.kind === 'star' ? '★' : reward.kind === 'perk' ? '🎁' : ''}</Text>
      </View>
      <View style={styles.badgeText}>
        <Text style={styles.badgeName}>{reward.count > 1 ? `${reward.name} ×${reward.count}` : reward.name}</Text>
        <Text style={styles.badgeDesc}>{`${reward.description}${extra}`}</Text>
      </View>
      <Text style={[styles.lvl, reward.unlocked && styles.lvlOn]}>{reward.unlocked ? (reward.repeatEvery > 0 ? `Next: level ${reward.nextAt}` : 'Unlocked') : `Level ${reward.level}`}</Text>
    </View>
  );
}

export default function LibraryScreen({ navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const openSong = useOpenSong();
  const [tab, setTab] = useState('history');
  const [items, setItems] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  // Loaded afresh each time the screen comes into view, so what was just played (and the XP it earned) is there.
  useFocusEffect(
    useCallback(() => {
      if (!user) return undefined;
      let alive = true;
      getProfile().then(
        (data) => alive && setProfile(data.profile),
        () => {},
      );
      if (tab === 'history' || tab === 'favorites') {
        getLibrary(tab).then(
          (data) => {
            if (alive) {
              setItems(data.items || []);
              setError('');
            }
          },
          (err) => alive && setError(errorMessage(err)),
        );
      }
      return () => {
        alive = false;
      };
    }, [user, tab]),
  );

  const data = useMemo(() => {
    if (tab === 'badges') return profile ? profile.badges.map((b) => ({ type: 'badge', key: b.code, b })) : null;
    if (tab === 'rewards') return profile ? profile.rewards.map((r) => ({ type: 'reward', key: r.id || r.name, r })) : null;
    return items ? items.map((song) => ({ type: 'song', key: song.sessionId, song })) : null;
  }, [tab, items, profile]);

  const earned = profile ? profile.badges.filter((b) => b.earned).length : 0;
  const header = (
    <View>
      {user ? <ProfileCard user={user} profile={profile} /> : null}
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => {
              if (t.id === 'history' || t.id === 'favorites') setItems(null);
              setTab(t.id);
            }}
            style={[styles.tab, tab === t.id && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.id }}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>{t.id === 'badges' && profile ? `Badges ${earned}/${profile.badges.length}` : t.label}</Text>
          </Pressable>
        ))}
      </View>
      <Note>{error}</Note>
    </View>
  );

  return (
    <View style={styles.screen}>
      <AppBar title="My Library" actions={[{ icon: 'settings', label: 'Settings', onPress: () => navigation.navigate('Settings') }]} />
      {!user ? (
        <Centered>
          <Text style={styles.big}>Keep your songs</Text>
          <Text style={styles.sub}>Sign in to see the songs you played and the ones you favourited, earn XP and badges, on any device.</Text>
          <Button title="Sign in" onPress={() => navigation.navigate('Settings')} style={styles.signIn} />
        </Centered>
      ) : (
        <FlashList
          data={data || []}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.type}
          ListHeaderComponent={header}
          renderItem={({ item }) => (item.type === 'song' ? <SongRow song={item.song} onPress={openSong} /> : item.type === 'badge' ? <Badge badge={item.b} /> : <Reward reward={item.r} />)}
          ListEmptyComponent={
            data === null && !error ? (
              <ActivityIndicator color={colors.accent} style={styles.loading} />
            ) : (
              <Text style={styles.empty}>{tab === 'favorites' ? 'Tap the heart in a song to keep it here.' : tab === 'history' ? 'Songs you play will show up here.' : ''}</Text>
            )
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  profile: { margin: 16, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  profileText: { flex: 1 },
  name: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  level: { color: colors.mute, fontSize: 14.5, marginTop: 4 },
  levelNum: { color: colors.accentDeep, fontWeight: '800', letterSpacing: 0.6 },
  xpTop: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  xpMain: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  xpNext: { color: colors.mute, fontSize: 13.5 },
  bar: { height: 10, borderRadius: 5, backgroundColor: colors.soft, overflow: 'hidden', marginTop: 8 },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.accent },
  nextReward: { color: colors.mute, fontSize: 13, marginTop: 8 },
  stats: { flexDirection: 'row', marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.mute, fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  tab: { paddingHorizontal: 16, height: 38, borderRadius: radius.pill, backgroundColor: colors.soft, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.accent },
  tabText: { color: colors.accentDeep, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: colors.onAccent },
  big: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.mute, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  signIn: { marginTop: 20 },
  loading: { marginTop: 40 },
  empty: { color: colors.mute, fontSize: 15, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 },
  badge: { flexDirection: 'row', gap: 14, marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  badgeEarned: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  badgeIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  badgeIconEarned: { backgroundColor: colors.accentSoft },
  badgeEmoji: { fontSize: 28 },
  badgeText: { flex: 1 },
  badgeName: { color: colors.ink, fontSize: 15.5, fontWeight: '800' },
  badgeDesc: { color: colors.mute, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  badgeEarnedText: { color: colors.accentDeep, fontSize: 12.5, fontWeight: '700', marginTop: 8 },
  meter: { height: 6, borderRadius: 3, backgroundColor: colors.soft, overflow: 'hidden', marginTop: 10 },
  meterFill: { height: 6, backgroundColor: colors.accent },
  badgeProgress: { color: colors.mute, fontSize: 12, fontWeight: '700', marginTop: 5 },
  dim: { opacity: 0.55 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  swatch: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  swatchText: { fontSize: 22, color: colors.gold },
  lvl: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.accentDeep, fontSize: 12, fontWeight: '800' },
  lvlOn: { backgroundColor: colors.okSoft, color: colors.okText },
}));
