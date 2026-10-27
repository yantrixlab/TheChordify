import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import YoutubePlayer from 'react-native-youtube-iframe';
import { addFavorite, errorMessage, getFavoriteKeys, getMyPlan, getResult, recordPlayed, removeFavorite } from '../api';
import { useAuth } from '../auth/AuthContext';
import DiagramsPanel from '../components/DiagramsPanel';
import { Button, Centered, Note } from '../components/Ui';
import { buildChart, cellAt, chordsFrom, clock } from '../lib/grid';
import { getJson, setJson } from '../lib/storage';
import { colors, radius, sectionColor } from '../theme';

const BAR_H = 66;
const LABEL_H = 38;

/** Rows of the chart: a label row where a song part starts, then the bar. Heights are fixed so the list can jump to any bar. */
function layoutItems(chart) {
  const items = [];
  const barIndex = [];
  let offset = 0;
  for (const row of chart.rows) {
    if (row.label) {
      items.push({ type: 'label', key: `l${row.bar}`, label: row.label, h: LABEL_H, offset });
      offset += LABEL_H;
    }
    barIndex[row.bar] = items.length;
    items.push({ type: 'bar', key: `b${row.bar}`, row, h: BAR_H, offset });
    offset += BAR_H;
  }
  return { items, barIndex };
}

const Cell = memo(function Cell({ chord, on, first }) {
  const rest = chord === 'N';
  return (
    <View style={[styles.cell, first && styles.cellFirst, on && styles.cellOn]}>
      {chord ? (
        <Text style={[styles.cellChord, on && styles.cellChordOn, rest && styles.cellRest]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {rest ? '𝄽' : chord}
        </Text>
      ) : (
        <Text style={[styles.cellDot, on && styles.cellChordOn]}>{on ? '•' : ''}</Text>
      )}
    </View>
  );
});

const BarRow = memo(function BarRow({ row, activeK, onSeek }) {
  return (
    <View style={styles.bar}>
      {row.chords.map((chord, k) => (
        <Pressable key={k} style={styles.cellWrap} disabled={row.beats[k] === null} onPress={() => onSeek(row.beats[k])}>
          <Cell chord={chord} on={activeK === k} first={k === 0} />
        </Pressable>
      ))}
    </View>
  );
});

export default function PlayerScreen({ route, navigation }) {
  const { sessionId, song } = route.params;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const [result, setResult] = useState(route.params.result || null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [active, setActive] = useState(-1);
  const [favorite, setFavorite] = useState(false);
  const [view, setView] = useState('diagrams'); // 'diagrams' | 'chart'
  const [instrument, setInstrument] = useState(getJson('instrument', 'guitar'));
  const [ukuleleOk, setUkuleleOk] = useState(false); // the plan includes the ukulele diagrams
  const [lockedNote, setLockedNote] = useState(false);
  const player = useRef(null);
  const list = useRef(null);
  const counted = useRef(false);
  const lastRow = useRef(-1);

  useEffect(() => {
    getMyPlan().then(
      (p) => setUkuleleOk(!!(p.entitlements && p.entitlements.instruments_more)),
      () => {},
    );
  }, [user]);

  useEffect(() => {
    lastRow.current = -1; // the chart list is made afresh when its tab is shown again
  }, [view]);

  const chooseInstrument = useCallback(
    (name) => {
      if (name === 'ukulele' && !ukuleleOk) {
        setLockedNote(true);
        return;
      }
      setLockedNote(false);
      setInstrument(name);
      setJson('instrument', name);
    },
    [ukuleleOk],
  );
  const shownInstrument = instrument === 'ukulele' && !ukuleleOk ? 'guitar' : instrument;

  useEffect(() => {
    if (result) return;
    getResult(sessionId).then(setResult, (err) => setError(errorMessage(err, 'Could not load this song.')));
  }, [sessionId, result]);

  useEffect(() => {
    if (!user) return;
    getFavoriteKeys().then((keys) => setFavorite(keys.includes(sessionId)), () => {});
  }, [user, sessionId]);

  const chart = useMemo(() => (result ? buildChart(result) : null), [result]);
  const laid = useMemo(() => (chart ? layoutItems(chart) : null), [chart]);

  // Where the video is: asked about six times a second while it plays; only a change of beat re-draws anything.
  useEffect(() => {
    if (!playing || !chart) return undefined;
    let stop = false;
    const id = setInterval(async () => {
      if (stop || !player.current) return;
      try {
        const t = await player.current.getCurrentTime();
        const i = cellAt(chart.cells, t);
        setActive((before) => (before === i ? before : i));
      } catch {
        // the player is not ready yet
      }
    }, 160);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [playing, chart]);

  // Keep the playing bar in view, a little below the top.
  const cell = chart && active >= 0 ? chart.cells[active] : null;
  useEffect(() => {
    if (!cell || !laid || !list.current || cell.row === lastRow.current) return;
    lastRow.current = cell.row;
    list.current.scrollToIndex({ index: laid.barIndex[cell.row], viewPosition: 0.25, animated: true });
  }, [cell, laid]);

  const onState = useCallback(
    (state) => {
      if (state === 'playing') {
        setPlaying(true);
        if (user && !counted.current) {
          counted.current = true;
          recordPlayed(sessionId);
        }
      } else if (state === 'paused' || state === 'ended') setPlaying(false);
    },
    [user, sessionId],
  );

  const seek = useCallback((t) => {
    if (player.current && t !== null) {
      player.current.seekTo(Math.max(0, t - 0.05), true);
      setPlaying(true);
    }
  }, []);

  const toggleFavorite = useCallback(async () => {
    if (!user) {
      navigation.navigate('Tabs', { screen: 'Account' });
      return;
    }
    const next = !favorite;
    setFavorite(next);
    try {
      if (next) await addFavorite(sessionId, { title: result?.title || song?.title, artist: result?.artist || song?.artist, thumbnail: song?.thumbnail, duration: result?.duration });
      else await removeFavorite(sessionId);
    } catch (err) {
      setFavorite(!next);
      setError(errorMessage(err));
    }
  }, [user, favorite, sessionId, result, song, navigation]);

  const videoId = result?.videoId || song?.videoId || (sessionId.startsWith('yt_') ? sessionId.slice(3) : '');
  const title = result?.title || song?.title || 'Song';
  const artist = result?.artist || song?.artist || '';
  const [now, next] = chart ? chordsFrom(chart, active) : ['', ''];
  const videoHeight = Math.round((width * 9) / 16);

  const renderItem = useCallback(
    ({ item }) =>
      item.type === 'label' ? (
        <View style={[styles.label, { backgroundColor: sectionColor(item.label) }]}>
          <Text style={styles.labelText}>{item.label}</Text>
        </View>
      ) : (
        <BarRow row={item.row} activeK={cell && cell.row === item.row.bar ? cell.k : -1} onSeek={seek} />
      ),
    [cell, seek],
  );

  return (
    <View style={styles.screen}>
      {videoId ? (
        <View style={{ height: videoHeight, backgroundColor: '#000' }}>
          <YoutubePlayer
            ref={player}
            height={videoHeight}
            width={width}
            videoId={videoId}
            play={playing}
            onChangeState={onState}
            onError={() => setPlayerError('This video cannot be played inside apps.')}
            initialPlayerParams={{ controls: true, rel: false, preventFullScreen: true }}
            webViewProps={{ androidLayerType: 'hardware' }}
          />
        </View>
      ) : null}

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.by} numberOfLines={1}>
            {[artist, result ? `${result.tempo ? Math.round(result.tempo) + ' BPM' : ''}` : '', result ? clock(result.duration) : ''].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
        <Pressable onPress={toggleFavorite} accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'} hitSlop={10} style={styles.heart}>
          <Text style={[styles.heartText, favorite && { color: '#f472b6' }]}>{favorite ? '♥' : '♡'}</Text>
        </Pressable>
      </View>

      {result && !videoId ? (
        <View style={styles.pad}>
          <Note tone="info">Songs you uploaded on the website play there; here you can read their chords.</Note>
        </View>
      ) : null}
      {playerError && videoId ? (
        <View style={styles.pad}>
          <Note>{playerError}</Note>
          <Button title="Open in YouTube" kind="quiet" onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`)} />
        </View>
      ) : null}
      {error ? <View style={styles.pad}><Note>{error}</Note></View> : null}

      {!chart ? (
        error ? (
          <Centered>
            <Button title="Back" kind="quiet" onPress={() => navigation.goBack()} />
          </Centered>
        ) : (
          <Centered>
            <Text style={styles.by}>Loading the chords…</Text>
          </Centered>
        )
      ) : (
        <>
          <View style={styles.tabs}>
            {[
              ['diagrams', 'Diagrams'],
              ['chart', 'Chart'],
            ].map(([id, name]) => (
              <Pressable key={id} onPress={() => setView(id)} style={[styles.tab, view === id && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: view === id }}>
                <Text style={[styles.tabText, view === id && styles.tabTextOn]}>{name}</Text>
              </Pressable>
            ))}
            <View style={styles.spacer} />
            {view === 'diagrams'
              ? ['guitar', 'ukulele'].map((name) => (
                  <Pressable key={name} onPress={() => chooseInstrument(name)} style={[styles.tab, shownInstrument === name && styles.tabOn]} accessibilityRole="button" accessibilityLabel={`${name} diagrams`}>
                    <Text style={[styles.tabText, shownInstrument === name && styles.tabTextOn]}>{name === 'guitar' ? 'Guitar' : `Ukulele${ukuleleOk ? '' : ' 🔒'}`}</Text>
                  </Pressable>
                ))
              : null}
          </View>
          {lockedNote && view === 'diagrams' ? (
            <View style={styles.pad}>
              <Note tone="info">Ukulele diagrams are part of the Premium plan.</Note>
            </View>
          ) : null}
          {view === 'diagrams' ? (
            <DiagramsPanel chart={chart} active={active} instrument={shownInstrument} bottomInset={insets.bottom} />
          ) : null}
          {view === 'chart' ? (
            <>
          <View style={styles.hero}>
            <View style={styles.heroNow}>
              <Text style={styles.heroLabel}>Now</Text>
              <Text style={styles.heroChord} numberOfLines={1} adjustsFontSizeToFit>
                {now === 'N' ? '—' : now || '·'}
              </Text>
            </View>
            <View style={styles.heroNext}>
              <Text style={styles.heroLabel}>Next</Text>
              <Text style={styles.heroNextChord} numberOfLines={1}>
                {next === 'N' ? '—' : next || ''}
              </Text>
            </View>
          </View>
          <FlatList
            ref={list}
            data={laid.items}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            extraData={cell}
            getItemLayout={(_, index) => ({ length: laid.items[index].h, offset: laid.items[index].offset, index })}
            initialNumToRender={14}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews
            onScrollToIndexFailed={() => {}}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24 }}
          />
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  by: { color: colors.mute, fontSize: 13, marginTop: 2 },
  heart: { padding: 6 },
  heartText: { color: colors.mute, fontSize: 26 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  tab: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.card, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.violet },
  tabText: { color: colors.mute, fontSize: 13.5, fontWeight: '700' },
  tabTextOn: { color: '#fff' },
  spacer: { flex: 1 },
  hero: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  heroNow: { flex: 2, height: 84, borderRadius: radius.card, backgroundColor: colors.violet, paddingHorizontal: 16, paddingTop: 8, justifyContent: 'center' },
  heroNext: { flex: 1, height: 84, borderRadius: radius.card, backgroundColor: colors.card, paddingHorizontal: 14, paddingTop: 8, justifyContent: 'center' },
  heroLabel: { color: '#ffffffaa', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroChord: { color: '#fff', fontSize: 44, fontWeight: '800', letterSpacing: -1 },
  heroNextChord: { color: '#e4dcf5', fontSize: 28, fontWeight: '700' },
  label: { height: LABEL_H - 8, marginTop: 8, borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12, alignSelf: 'flex-start' },
  labelText: { color: '#1a0533', fontSize: 13, fontWeight: '800' },
  bar: { height: BAR_H, flexDirection: 'row', paddingVertical: 4, gap: 4 },
  cellWrap: { flex: 1 },
  cell: { flex: 1, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  cellFirst: { backgroundColor: '#ffffff17' },
  cellOn: { backgroundColor: colors.violet },
  cellChord: { color: colors.text, fontSize: 21, fontWeight: '800' },
  cellChordOn: { color: '#fff' },
  cellRest: { color: colors.faint },
  cellDot: { color: colors.faint, fontSize: 18 },
});
