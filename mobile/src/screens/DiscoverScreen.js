import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { TOOLS } from 'chordsuno-shared/tools/catalog';
import { getLibrary, getTrending } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { SongCard } from '../components/Songs';
import { Art, AppBar, SectionHeader } from '../components/Ui';
import { useOpenSong } from '../lib/useOpenSong';
import { coverOf, radius, shadow, makeStyles, toolCovers, useColors } from '../theme';

function Gap() {
  const styles = useStyles();
  return <View style={styles.gap} />;
}

// The tools and, last, importing a song from the phone.
const FRESH_MS = 5 * 60 * 1000; // shelves older than this are fetched again when Discover is looked at
const TILES = [...TOOLS, { id: 'upload', name: 'Import music', cover: toolCovers.upload }].map((t) => ({ ...t, cover: coverOf(t.id, t.cover) }));

/** The artists behind the songs this person played, most played first: [{ name, thumbnail }]. */
function topArtists(items) {
  const found = new Map();
  for (const item of items) {
    for (const raw of String(item.artist || '').split(/,|&| x /i)) {
      const name = raw.trim();
      if (!name) continue;
      const entry = found.get(name) || { name, thumbnail: item.thumbnail, videoId: item.videoId, plays: 0 };
      entry.plays += item.plays || 1;
      found.set(name, entry);
    }
  }
  return [...found.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
}

export default function DiscoverScreen({ navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const { user } = useAuth();
  const openSong = useOpenSong();
  const [shelves, setShelves] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadedAt = useRef(0);
  const load = useCallback(async () => {
    const trending = await getTrending();
    loadedAt.current = Date.now();
    setShelves(trending.filter((s) => s.songs && s.songs.length > 0));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The charts and the jam counts keep moving: look again when Discover comes back into view (from another tab, or the phone's
  // home screen) and the shelves have been on screen for a few minutes.
  useFocusEffect(
    useCallback(() => {
      if (loadedAt.current && Date.now() - loadedAt.current > FRESH_MS) load().catch(() => {});
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active' && loadedAt.current && Date.now() - loadedAt.current > FRESH_MS) load().catch(() => {});
      });
      return () => sub.remove();
    }, [load]),
  );

  // The person's own history is read again each time Discover comes back into view.
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setHistory([]);
        return undefined;
      }
      let alive = true;
      getLibrary('history', 0, 100).then(
        (data) => alive && setHistory(data.items || []),
        () => {},
      );
      return () => {
        alive = false;
      };
    }, [user]),
  );

  const artists = useMemo(() => topArtists(history), [history]);
  const first = user && user.name ? user.name.split(' ')[0] : '';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={styles.screen}>
      <AppBar
        title="Discover"
        actions={[
          { icon: 'tuner', label: 'Tuner', onPress: () => navigation.navigate('tuner') },
          { icon: 'settings', label: 'Settings', onPress: () => navigation.navigate('Settings') },
        ]}
      />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroLine}>{first ? `Hi ${first},` : 'Hear every chord.'}</Text>
          <Text style={[styles.heroLine, styles.heroBold]}>{first ? 'what will you play today?' : 'Play every song.'}</Text>
          <Pressable onPress={() => navigation.navigate('Search', { focus: Date.now() })} style={[styles.searchPill, shadow]} accessibilityRole="search" accessibilityLabel="Search songs">
            <Icon name="search" color={colors.faint} size={22} />
            <Text style={styles.searchText}>What do you want to play?</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Toolkit" onMore={() => navigation.navigate('Toolkit')} />
          <FlatList
            horizontal
            data={TILES}
            keyExtractor={(tool) => tool.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rowPad}
            ItemSeparatorComponent={Gap}
            renderItem={({ item }) => (
              <Pressable onPress={() => navigation.navigate(item.id)} style={styles.tool} accessibilityRole="button" accessibilityLabel={item.name}>
                <View style={[styles.toolTile, { backgroundColor: item.cover[1] }]}>
                  <View style={[styles.toolSky, { backgroundColor: item.cover[0] }]} />
                  <Icon name={item.id} size={46} color="#fff" strokeWidth={1.8} />
                </View>
                <Text style={styles.toolName} numberOfLines={2}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        </View>

        {artists.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Your top artists" />
            <FlatList
              horizontal
              data={artists}
              keyExtractor={(a) => a.name}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowPad}
              ItemSeparatorComponent={Gap}
              renderItem={({ item }) => (
                <Pressable onPress={() => navigation.navigate('Search', { query: item.name })} style={styles.artist} accessibilityRole="button" accessibilityLabel={item.name}>
                  <Art song={item} size={112} round />
                  <Text style={styles.artistName} numberOfLines={2}>
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        ) : null}

        {shelves === null ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
        {(shelves || []).map((shelf) => (
          <View key={shelf.id} style={styles.section}>
            <SectionHeader title={shelf.title} />
            {shelf.about ? <Text style={styles.about}>{shelf.about}</Text> : null}
            <FlatList
              horizontal
              data={shelf.songs}
              keyExtractor={(song) => song.videoId}
              renderItem={({ item }) => <SongCard song={item} onPress={openSong} />}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowPad}
              ItemSeparatorComponent={Gap}
              initialNumToRender={3}
              windowSize={3}
            />
          </View>
        ))}
        {shelves !== null && shelves.length === 0 ? <Text style={styles.empty}>Search for any song to see its chords.</Text> : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 28 },
  hero: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 24, alignItems: 'center' },
  heroLine: { color: colors.ink, fontSize: 22, textAlign: 'center' },
  heroBold: { fontWeight: '800', marginTop: 2 },
  searchPill: { marginTop: 22, alignSelf: 'stretch', height: 54, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  searchText: { color: colors.faint, fontSize: 17 },
  section: { backgroundColor: colors.surface, paddingTop: 20, paddingBottom: 20, marginBottom: 12 },
  rowPad: { paddingHorizontal: 16 },
  gap: { width: 14 },
  tool: { width: 112 },
  toolTile: { width: 112, height: 112, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  toolSky: { position: 'absolute', left: 0, right: 0, top: 0, height: 62 },
  toolName: { color: colors.ink, fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  artist: { width: 112, alignItems: 'center' },
  artistName: { color: colors.ink, fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  about: { color: colors.mute, fontSize: 13.5, paddingHorizontal: 16, marginTop: -6, marginBottom: 12 },
  loading: { marginTop: 40 },
  empty: { color: colors.mute, fontSize: 15, textAlign: 'center', marginTop: 40, paddingHorizontal: 32 },
}));
