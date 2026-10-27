import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { errorMessage, getPopular, getTrending, searchSongs } from '../api';
import { Note } from '../components/Ui';
import { SongCard, SongRow } from '../components/Songs';
import { useOpenSong } from '../lib/useOpenSong';
import { colors, radius } from '../theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const openSong = useOpenSong();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null: not searching
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [shelves, setShelves] = useState([]);
  const [loadingShelves, setLoadingShelves] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const aborter = useRef(null);

  const loadShelves = useCallback(async () => {
    let all = await getTrending();
    if (all.length === 0) {
      const popular = await getPopular(); // the trending shelves already lead with the popular ones
      all = popular.length > 0 ? [{ id: 'popular', title: 'Most played', about: '', songs: popular }] : [];
    }
    setShelves(all.filter((s) => s.songs && s.songs.length > 0));
    setLoadingShelves(false);
  }, []);

  useEffect(() => {
    loadShelves();
  }, [loadShelves]);

  // Search as the person types, a moment after the last key; a newer search replaces the one still on its way.
  useEffect(() => {
    const text = query.trim();
    if (aborter.current) aborter.current.abort();
    if (text.length < 2) {
      setResults(null);
      setSearching(false);
      setError('');
      return undefined;
    }
    setSearching(true);
    const controller = new AbortController();
    aborter.current = controller;
    const timer = setTimeout(async () => {
      try {
        const songs = await searchSongs(text, controller.signal);
        if (controller.signal.aborted) return;
        setResults(songs);
        setError('');
      } catch (err) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadShelves();
    setRefreshing(false);
  }, [loadShelves]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.brand}>Chord Suno</Text>
      <View style={styles.searchBox}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search a song or an artist"
          placeholderTextColor={colors.faint}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search songs"
        />
        {searching ? <ActivityIndicator color={colors.violetSoft} style={styles.spinner} /> : null}
        {query.length > 0 && !searching ? (
          <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear the search" hitSlop={12} style={styles.clear}>
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  if (results !== null) {
    return (
      <View style={styles.screen}>
        {header}
        <Note>{error}</Note>
        <FlashList
          data={results}
          keyExtractor={(song) => song.videoId}
          renderItem={({ item }) => <SongRow song={item} onPress={openSong} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            searching ? null : !error ? <Text style={styles.empty}>No songs found for “{query.trim()}”. Try the song’s name with the artist.</Text> : null
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      {loadingShelves ? (
        <ActivityIndicator color={colors.violetSoft} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={shelves}
          keyExtractor={(shelf) => shelf.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.violetSoft} />}
          initialNumToRender={3}
          windowSize={5}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={<Text style={styles.empty}>Search for any song to see its chords.</Text>}
          renderItem={({ item: shelf }) => (
            <View style={styles.shelf}>
              <Text style={styles.shelfTitle}>{shelf.title}</Text>
              {shelf.about ? <Text style={styles.shelfAbout}>{shelf.about}</Text> : null}
              <FlatList
                horizontal
                data={shelf.songs}
                keyExtractor={(song) => song.videoId}
                renderItem={({ item }) => <SongCard song={item} onPress={openSong} />}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.shelfList}
                ItemSeparatorComponent={Gap}
                initialNumToRender={4}
                windowSize={3}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

const Gap = () => <View style={{ width: 12 }} />;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  brand: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  searchBox: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: radius.pill, backgroundColor: colors.cardStrong, paddingHorizontal: 18 },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  spinner: { marginLeft: 8 },
  clear: { marginLeft: 8, padding: 4 },
  clearText: { color: colors.mute, fontSize: 16 },
  empty: { color: colors.mute, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 48, paddingHorizontal: 32 },
  shelf: { marginTop: 18 },
  shelfTitle: { color: colors.text, fontSize: 19, fontWeight: '800', paddingHorizontal: 16 },
  shelfAbout: { color: colors.mute, fontSize: 13, paddingHorizontal: 16, marginTop: 2 },
  shelfList: { paddingHorizontal: 16, paddingTop: 12 },
});
