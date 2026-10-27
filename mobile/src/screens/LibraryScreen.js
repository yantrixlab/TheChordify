import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { errorMessage, getLibrary } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Button, Centered, Note } from '../components/Ui';
import { SongRow } from '../components/Songs';
import { useOpenSong } from '../lib/useOpenSong';
import { colors, radius } from '../theme';

const TABS = [
  { id: 'history', label: 'Recent' },
  { id: 'favorites', label: 'Favourites' },
];

export default function LibraryScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const openSong = useOpenSong();
  const [tab, setTab] = useState('history');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  // Loaded afresh each time the screen comes into view, so what was just played is there.
  useFocusEffect(
    useCallback(() => {
      if (!user) return undefined;
      let alive = true;
      getLibrary(tab).then(
        (data) => {
          if (alive) {
            setItems(data.items || []);
            setError('');
          }
        },
        (err) => alive && setError(errorMessage(err)),
      );
      return () => {
        alive = false;
      };
    }, [user, tab]),
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.heading}>Library</Text>
      {!user ? (
        <Centered>
          <Text style={styles.big}>Keep your songs</Text>
          <Text style={styles.sub}>Sign in to see the songs you played and the ones you favourited, on any device.</Text>
          <Button title="Sign in" onPress={() => navigation.navigate('Account')} style={{ marginTop: 20 }} />
        </Centered>
      ) : (
        <>
          <View style={styles.tabs}>
            {TABS.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  setItems(null);
                  setTab(t.id);
                }}
                style={[styles.tab, tab === t.id && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.id }}
              >
                <Text style={[styles.tabText, tab === t.id && { color: '#fff' }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <Note>{error}</Note>
          {items === null && !error ? (
            <ActivityIndicator color={colors.violetSoft} style={{ marginTop: 40 }} />
          ) : (
            <FlashList
              data={items || []}
              keyExtractor={(item) => item.sessionId}
              renderItem={({ item }) => <SongRow song={item} onPress={openSong} />}
              ListEmptyComponent={
                <Text style={styles.empty}>{tab === 'favorites' ? 'Tap the heart in a song to keep it here.' : 'Songs you play will show up here.'}</Text>
              }
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, paddingHorizontal: 16 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  tab: { paddingHorizontal: 18, height: 38, borderRadius: radius.pill, backgroundColor: colors.card, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.violet },
  tabText: { color: colors.mute, fontSize: 14.5, fontWeight: '700' },
  big: { color: colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.mute, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  empty: { color: colors.mute, fontSize: 15, textAlign: 'center', marginTop: 48, paddingHorizontal: 32 },
});
