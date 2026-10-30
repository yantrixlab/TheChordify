import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { errorMessage, searchSongs } from '../api';
import { Icon } from '../components/Icons';
import { Art, AppBar, Note } from '../components/Ui';
import { SongRow } from '../components/Songs';
import { clearRecents, forget, getRecents, rememberQuery } from '../lib/recent';
import { useOpenSong } from '../lib/useOpenSong';
import { radius, makeStyles, useColors } from '../theme';

export default function SearchScreen({ route, navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const openSong = useOpenSong();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null: not searching
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [recents, setRecents] = useState(getRecents());
  const input = useRef(null);
  const aborter = useRef(null);

  // Coming from Discover: its search box focuses this one; one of "your top artists" fills it in.
  const { query: asked, focus } = route.params || {};
  useEffect(() => {
    if (asked) setQuery(asked);
  }, [asked]);
  useEffect(() => {
    if (focus) setTimeout(() => input.current && input.current.focus(), 120);
  }, [focus]);
  useEffect(() => navigation.addListener('focus', () => setRecents(getRecents())), [navigation]);

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

  const submit = useCallback(() => {
    rememberQuery(query);
    setRecents(getRecents());
    Keyboard.dismiss();
  }, [query]);

  const pick = useCallback(
    (song) => {
      rememberQuery(query);
      openSong(song);
    },
    [query, openSong],
  );

  const remove = (entry) => {
    forget(entry);
    setRecents(getRecents());
  };

  return (
    <View style={styles.screen}>
      <AppBar title="Search" />
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Icon name="search" color={colors.faint} size={22} />
          <TextInput
            ref={input}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submit}
            placeholder="What do you want to play?"
            placeholderTextColor={colors.faint}
            style={styles.input}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search songs"
          />
          {searching ? <ActivityIndicator color={colors.accent} /> : null}
          {query.length > 0 && !searching ? (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear the search" hitSlop={12}>
              <Icon name="close" color={colors.mute} size={20} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {results !== null ? (
        <>
          <Note>{error}</Note>
          <FlashList
            data={results}
            keyExtractor={(song) => song.videoId}
            renderItem={({ item }) => <SongRow song={item} onPress={pick} />}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={searching || error ? null : <Text style={styles.empty}>No songs found for “{query.trim()}”. Try the song’s name with the artist.</Text>}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          />
        </>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {recents.length > 0 ? (
            <>
              <View style={styles.recentHead}>
                <Text style={styles.recentTitle}>Recent</Text>
                <Pressable
                  onPress={() => {
                    clearRecents();
                    setRecents([]);
                  }}
                  hitSlop={10}
                >
                  <Text style={styles.clear}>Clear</Text>
                </Pressable>
              </View>
              {recents.map((entry) =>
                entry.type === 'song' ? (
                  <SongRow key={`s${entry.videoId}`} song={entry} onPress={openSong} trailing={<RemoveButton onPress={() => remove(entry)} />} />
                ) : (
                  <Pressable key={`q${entry.q}`} onPress={() => setQuery(entry.q)} style={styles.queryRow} android_ripple={{ color: colors.ripple }}>
                    <View style={styles.queryIcon}>
                      <Icon name="search" size={20} color={colors.mute} />
                    </View>
                    <Text style={styles.queryText} numberOfLines={1}>
                      {entry.q}
                    </Text>
                    <RemoveButton onPress={() => remove(entry)} />
                  </Pressable>
                ),
              )}
            </>
          ) : (
            <View style={styles.hint}>
              <Art song={{}} size={96} round style={styles.hintArt} />
              <Text style={styles.hintTitle}>Find the chords of any song</Text>
              <Text style={styles.hintText}>Type a song or an artist. Songs other people have played open at once.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function RemoveButton({ onPress }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.remove} accessibilityRole="button" accessibilityLabel="Remove from recent">
      <Icon name="close" size={18} color={colors.faint} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  searchRow: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.bar },
  searchBox: { height: 50, borderRadius: radius.pill, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  input: { flex: 1, color: colors.ink, fontSize: 16.5, paddingVertical: 0 },
  empty: { color: colors.mute, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 48, paddingHorizontal: 32 },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  recentTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  clear: { color: colors.accentDeep, fontSize: 15, fontWeight: '600' },
  queryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 52 },
  queryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  queryText: { flex: 1, color: colors.ink, fontSize: 16 },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  hint: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 36 },
  hintArt: { backgroundColor: colors.accentSoft },
  hintTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: 18 },
  hintText: { color: colors.mute, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 6 },
}));
