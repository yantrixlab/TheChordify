import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, BackHandler, Easing, Linking, Share, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Video from 'react-native-video';
import YoutubePlayer from 'react-native-youtube-iframe';
import { chordKeyLabel } from 'chordsuno-shared/chordShapes';
import { addFavorite, errorMessage, getFavoriteKeys, getResult, recordPlayed, removeFavorite } from '../api';
import { useAuth } from '../auth/AuthContext';
import { DiagramsView, SummaryView } from '../components/DiagramsView';
import { GridView } from '../components/GridView';
import { StrumView, strumPatterns } from '../components/StrumView';
import { ControlPanel, Toolbar } from '../components/PlayerBars';
import { Icon } from '../components/Icons';
import { MenuRow, Segmented, Sheet, Stepper } from '../components/Sheet';
import ViewPanel from '../components/ViewPanel';
import { RateSheet, SimilarSheet } from '../components/SongSheets';
import { AppBar, Button, Centered, Note } from '../components/Ui';
import { API_BASE, SITE } from '../config';
import { shareMidi, sharePdf, songForExport } from '../lib/exporter';
import { useOpenSong } from '../lib/useOpenSong';
import { transposeChord } from '../lib/diagrams';
import { buzz } from '../lib/buzz';
import { buildChart, cellAt, clock, trimPickup } from '../lib/grid';
import { METER_MAX, METER_MIN, isOwn, loadMeter, ownMeter, saveMeter } from '../lib/meter';
import { getJson, setJson } from '../lib/storage';
import { colors, radius } from '../theme';

const VIEWS = [
  { id: 'diagrams', label: 'Diagrams' },
  { id: 'summary', label: 'Summary' },
  { id: 'grid', label: 'Grid' },
  { id: 'strum', label: 'Strum' },
];
const INSTRUMENTS = [
  { id: 'guitar', label: 'Guitar', feature: null },
  { id: 'ukulele', label: 'Ukulele', feature: 'instruments_more' },
  { id: 'piano', label: 'Piano', soon: true },
  { id: 'mandolin', label: 'Mandolin', soon: true },
];
const LOOPS = ['off', 'song', 'section'];

const CLOCK_ASK = 250; // ms between two questions to the video about where it is
const CLOCK_TICK = 16; // ms between two looks at which beat is playing
const LEAD_DEFAULT = 80; // ms: the beat is shown this much early, for the time it takes to reach the screen
const TOP_MS = 260; // the top section's slide away and back
const LEAD_MIN = -200;
const LEAD_MAX = 400;
const SLOW_ANSWER = 90; // ms: an answer from the video that took longer than this is not trusted

// The playing beat lives outside the screen's state: a change of beat re-draws only the views that show it (the diagrams, the grid),
// not the whole screen with its video, panel and sheets. That keeps a slow phone on time.
function createActive() {
  let value = -1;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
const useActive = (store) => useSyncExternalStore(store.subscribe, store.get);

const LiveDiagrams = memo(function LiveDiagrams({ store, ...rest }) {
  return <DiagramsView active={useActive(store)} {...rest} />;
});
const LiveGrid = memo(function LiveGrid({ store, ...rest }) {
  return <GridView active={useActive(store)} {...rest} />;
});

export default function PlayerScreen({ route, navigation }) {
  const { sessionId, song } = route.params;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { user, can } = useAuth();
  const [result, setResult] = useState(route.params.result || null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [activeStore] = useState(createActive); // the playing cell of the chart (-1 before the first)
  const [favorite, setFavorite] = useState(false);
  const [view, setView] = useState(getJson('view', 'diagrams'));
  const [instrument, setInstrument] = useState(getJson('instrument', 'guitar'));
  const [transpose, setTranspose] = useState(0);
  const [capo, setCapo] = useState(0);
  const [detailed, setDetailed] = useState(false);
  const [tempoPct, setTempoPct] = useState(100);
  const [volume, setVolume] = useState(100);
  const [loopMode, setLoopMode] = useState('off');
  const [countIn, setCountIn] = useState(false);
  const [counting, setCounting] = useState(0); // 3, 2, 1 while the count-in runs, else 0
  const [meter, setMeter] = useState(null); // beats per bar, pulse and bar start, as this player set them for this song (null: the song's own)
  const [strumTime, setStrumTime] = useState(0); // the playing time, kept only while the Strum view is shown
  const [beatLead, setBeatLead] = useState(() => getJson('beatLead', LEAD_DEFAULT)); // ms; the same for every song on this phone
  const [viewOpen, setViewOpen] = useState(false); // the panel that picks the view and the instrument
  const [sheet, setSheet] = useState(null); // 'view' | 'transpose' | 'capo' | 'tempo' | 'volume' | 'more' | 'details' | 'bars'
  // The title bar and toolbar slide away while the song plays and come back when it is paused: 1 shown, 0 hidden.
  const topAnim = useRef(new Animated.Value(1)).current;
  const [topHeight, setTopHeight] = useState(0);
  const openSong = useOpenSong();
  const player = useRef(null);
  const video = useRef(null); // the audio of an uploaded song
  const mediaTime = useRef(0);
  const counted = useRef(false);
  const loopSection = useRef(null);
  const timeRef = useRef(0);
  // Where the song is, by the phone's own clock: { media: seconds into the song, at: when that was true (performance.now), ok: has it been measured }
  const clockRef = useRef({ media: 0, at: 0, ok: false });
  const askGuard = useRef({ until: 0, target: 0 }); // after a jump, answers from the video that are still the old place are ignored
  const rateRef = useRef(1);
  rateRef.current = tempoPct / 100;
  const leadRef = useRef(beatLead);
  leadRef.current = beatLead;
  const countTimer = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (result) return;
    getResult(sessionId).then(setResult, (err) => setError(errorMessage(err, 'Could not load this song.')));
  }, [sessionId, result]);

  useEffect(() => {
    if (!user) return;
    getFavoriteKeys().then((keys) => setFavorite(keys.includes(sessionId)), () => {});
  }, [user, sessionId]);

  useEffect(() => () => clearTimeout(countTimer.current), []);

  const hideTop = playing && !counting && !!result;
  useEffect(() => {
    if (hideTop) setViewOpen(false);
  }, [hideTop]);
  useEffect(() => {
    if (!viewOpen) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setViewOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [viewOpen]);
  useEffect(() => {
    Animated.timing(topAnim, { toValue: hideTop ? 0 : 1, duration: TOP_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [hideTop, topAnim]);

  const hasDetail = !!(result && result.chordsDetailed && result.chordsDetailed !== result.chords && result.chordsDetailed.length > 0);
  // The bar length saved for this song, found once its beats are known.
  useEffect(() => {
    if (!result) return;
    setMeter(loadMeter(sessionId, ownMeter(trimPickup(result.bars || []), result)));
  }, [result, sessionId]);

  const chart = useMemo(() => (result ? buildChart(result, detailed && hasDetail, meter) : null), [result, detailed, hasDetail, meter]);
  const strumList = useMemo(() => strumPatterns(result), [result]);
  const videoId = result?.videoId || song?.videoId || (sessionId.startsWith('yt_') ? sessionId.slice(3) : '');
  const audioUrl = !videoId && result && result.audioUrl ? `${API_BASE}${result.audioUrl}` : ''; // a song somebody uploaded plays from its file
  const ukuleleOk = can('instruments_more');
  const shownInstrument = instrument === 'ukulele' && !ukuleleOk ? 'guitar' : instrument;
  const sections = useMemo(() => (chart ? chart.sections : []).filter((s) => s.end > s.start && s.startBar !== null && s.startBar !== undefined), [chart]);

  // Move the song (the YouTube video, or the file of an uploaded song) to a time.
  const seekMedia = useCallback(
    (t, shown = t) => {
      if (videoId) {
        if (player.current) player.current.seekTo(t, true);
      } else if (video.current) {
        video.current.seek(t);
        mediaTime.current = t;
      }
      // The clock moves at once (to `shown`, the beat the person asked for); the video's answers that still say the old place are ignored for a moment.
      const now = performance.now();
      clockRef.current = { media: shown, at: now, ok: true };
      askGuard.current = { until: now + 700, target: t };
      timeRef.current = shown;
    },
    [videoId],
  );

  // Which beat is playing. The video is asked where it is a few times a second (for the YouTube player that is a round trip through the
  // web view, and it can come late); between answers the phone's own clock, running at the playback speed, says where the song is,
  // so a beat lands when it should, not when the last answer happened to arrive.
  useEffect(() => {
    if (!playing || !chart) return undefined;
    const clock = clockRef.current;
    if (performance.now() - clock.at > 700) clock.ok = false; // resumed from a pause: wait for the first answer
    // Until the video's time is seen to move (it is still starting, or buffering) the beat is not run, so it never gets ahead of the sound.
    // After a jump the clock is already placed, and runs at once.
    let moving = clock.ok;
    let lastT = null;
    let asking = false;
    let lastGood = 0; // when the clock was last set from an answer
    let ticks = 0;
    const songNow = () => {
      const c = clockRef.current;
      return c.media + ((performance.now() - c.at) / 1000) * rateRef.current;
    };
    const ask = async () => {
      if (asking || (videoId && !player.current)) return;
      asking = true;
      try {
        const before = performance.now();
        const t = videoId ? await player.current.getCurrentTime() : mediaTime.current;
        const now = performance.now();
        const guard = askGuard.current;
        if (now < guard.until && Math.abs(t - guard.target) > 1) return; // the video has not jumped yet
        const c = clockRef.current;
        const mid = (before + now) / 2; // the answer is about the middle of the round trip
        if (!moving) {
          if (lastT !== null && Math.abs(t - lastT) > 0.04) moving = true;
          lastT = t;
        }
        // A slow round trip (one in ten, on a busy phone) brings back a time that is already old: skip it, unless it has been a while.
        if (c.ok && now - before > SLOW_ANSWER && now - lastGood < 1500) return;
        const expected = c.media + ((mid - c.at) / 1000) * rateRef.current;
        const off = t - expected;
        // Small differences are the noise of the question and are only half-believed; a big one (a seek, a stall) is taken whole.
        clockRef.current = { media: !c.ok || Math.abs(off) > 0.12 ? t : expected + off * 0.4, at: mid, ok: true };
        lastGood = now;
      } catch {
        // the player is not ready yet
      } finally {
        asking = false;
      }
    };
    const look = () => {
      if (!moving || !clockRef.current.ok) return;
      const t = songNow() + (leadRef.current / 1000) * rateRef.current; // the beat as the screen will show it, a moment from now
      timeRef.current = t;
      const section = loopSection.current;
      if (section && t >= section.end - 0.04) {
        seekMedia(section.start); // loop the section
        return;
      }
      let i = cellAt(chart.cells, t);
      const now = activeStore.get();
      // An answer that corrects the clock by a few milliseconds must not make a beat that has just changed flick back.
      if (i < now && now >= 0 && chart.cells[now] && t > chart.cells[now].t - 0.12) i = now;
      activeStore.set(i);
      if (viewRef.current === 'strum' && ++ticks % 3 === 0) setStrumTime(t);
    };
    ask();
    const askId = setInterval(ask, CLOCK_ASK);
    const lookId = setInterval(look, CLOCK_TICK);
    return () => {
      clearInterval(askId);
      clearInterval(lookId);
    };
  }, [playing, chart, videoId, seekMedia, activeStore]);

  const onState = useCallback(
    (state) => {
      if (state === 'playing') {
        setPlaying(true);
        if (user && !counted.current) {
          counted.current = true;
          recordPlayed(sessionId);
        }
      } else if (state === 'paused') setPlaying(false);
      else if (state === 'ended') {
        if (loopMode === 'song') {
          seekMedia(0);
          setPlaying(true);
        } else setPlaying(false);
      }
    },
    [user, sessionId, loopMode, seekMedia],
  );

  // A song played from its file has no YouTube player to say "playing", so its first play is counted here (library and XP).
  useEffect(() => {
    if (audioUrl && playing && !counting && user && !counted.current) {
      counted.current = true;
      recordPlayed(sessionId);
    }
  }, [audioUrl, playing, counting, user, sessionId]);

  const seek = useCallback(
    (t) => {
      if (t !== null) {
        seekMedia(Math.max(0, t - 0.05), t);
        if (chart) activeStore.set(cellAt(chart.cells, t)); // the tapped beat lights up now, not when the video has caught up
        setPlaying(true);
      }
    },
    [seekMedia, chart, activeStore],
  );

  // Play, with the count-in first when it is on: three beats at the song's own speed, a tick on each.
  const togglePlay = useCallback(() => {
    if (counting) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!countIn || !result) {
      setPlaying(true);
      return;
    }
    const beat = 60000 / ((chart ? chart.tempo : result.tempo || 100) * (tempoPct / 100));
    let n = 3;
    const step = () => {
      setCounting(n);
      buzz(n === 3 ? 40 : 20);
      countTimer.current = setTimeout(() => {
        n -= 1;
        if (n > 0) step();
        else {
          setCounting(0);
          setPlaying(true);
        }
      }, beat);
    };
    step();
  }, [counting, playing, countIn, result, chart, tempoPct]);

  const restart = useCallback(() => {
    clearTimeout(countTimer.current);
    setCounting(0);
    seekMedia(0);
    activeStore.set(-1);
    timeRef.current = 0;
    setPlaying(true);
  }, [seekMedia, activeStore]);

  // Loop: off, then the whole song, then the section that was playing when it was switched on.
  const cycleLoop = useCallback(() => {
    const options = sections.length > 0 ? LOOPS : LOOPS.slice(0, 2);
    const next = options[(options.indexOf(loopMode) + 1) % options.length];
    setLoopMode(next);
    loopSection.current = null;
    if (next === 'section') {
      const t = timeRef.current;
      loopSection.current = sections.find((s) => t >= s.start && t < s.end) || sections[0];
    }
  }, [loopMode, sections]);

  const toggleFavorite = useCallback(async () => {
    if (!user) {
      navigation.navigate('Settings');
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

  // A feature the plan leaves out shows a lock and leads to the plans.
  const needsPlan = useCallback(() => {
    setSheet(null);
    navigation.navigate('Tabs', { screen: 'Premium' });
  }, [navigation]);

  const changeLead = (ms) => {
    const next = Math.min(LEAD_MAX, Math.max(LEAD_MIN, ms));
    setBeatLead(next);
    setJson('beatLead', next);
  };

  const chooseView = (id) => {
    setView(id);
    setJson('view', id);
  };
  const chooseInstrument = (item) => {
    if (item.soon) return;
    if (item.feature && !can(item.feature)) {
      setViewOpen(false);
      needsPlan();
      return;
    }
    setInstrument(item.id);
    setJson('instrument', item.id);
  };

  // Regroup the beats into bars again; the choice is kept for this song.
  const changeMeter = (next) => {
    if (!chart) return;
    const own = chart.own;
    const before = meter || own;
    const merged = { ...before, ...next };
    if (merged.perBar !== before.perBar || merged.pulse !== before.pulse) merged.shift = next.shift === undefined ? null : next.shift; // the old pickup no longer fits
    setMeter(merged);
    saveMeter(sessionId, merged, own);
    activeStore.set(-1);
  };

  // The chord sheet or a MIDI file, made from what is on screen (key, capo and bar length included).
  const doExport = async (kind) => {
    setSheet(null);
    const feature = kind === 'pdf' ? 'pdf_export' : 'midi_export';
    if (!can(feature)) {
      needsPlan();
      return;
    }
    try {
      const exported = songForExport({ result, chart, transpose, capo, strumList });
      if (kind === 'pdf') await sharePdf(exported);
      else await shareMidi(exported, kind === 'midi-strum');
    } catch (err) {
      setError(errorMessage(err, 'Could not make that file.'));
    }
  };

  const share = () => {
    setSheet(null);
    Share.share({ message: `${title}${artist ? ` by ${artist}` : ''}: chords on Chord Suno\n${SITE}/play?session=${encodeURIComponent(sessionId)}` }).catch(() => {});
  };

  const title = result?.title || song?.title || 'Song';
  const artist = result?.artist || song?.artist || '';
  // The player lives in the bottom panel, on the right of the controls: half the width, and never under the 200 x 200 YouTube asks for.
  // Held across, the chords take the left and a column at the right holds the video over the controls.
  const landscape = width > height;
  // The player's size held upright (half the short side, never under 200 x 210); held across, the column at the right is as wide as that
  // player is tall.
  const uprightWidth = Math.max(200, Math.round(Math.min(width, height) / 2));
  const uprightHeight = Math.max(210, Math.round(uprightWidth * 0.56));
  const sideWidth = landscape ? uprightHeight : 0;
  const mediaWidth = landscape ? sideWidth : uprightWidth;
  const mediaHeight = landscape ? Math.max(200, Math.round(sideWidth * 0.5625)) : uprightHeight;
  const contentWidth = landscape ? width - sideWidth - insets.left - insets.right : width; // what the chord views have to draw in
  // Built only when one of these changes, so a change of beat never touches the video.
  const media = useMemo(() => (videoId ? (
    <YoutubePlayer
      ref={player}
      height={mediaHeight}
      width={mediaWidth}
      videoId={videoId}
      play={playing && !counting}
      volume={volume}
      playbackRate={tempoPct / 100}
      onChangeState={onState}
      onError={() => setPlayerError('This video cannot be played inside apps.')}
      initialPlayerParams={{ controls: true, rel: false, preventFullScreen: true }}
      useLocalHTML
      baseUrlOverride={SITE}
      webViewProps={{ androidLayerType: 'hardware' }}
    />
  ) : audioUrl ? (
    <View style={styles.audio}>
      <Icon name="upload" size={30} color="#c4b5fd" />
      <Text style={styles.audioText}>Playing your file</Text>
      <Video
        ref={video}
        source={{ uri: audioUrl }}
        paused={!(playing && !counting)}
        rate={tempoPct / 100}
        volume={volume / 100}
        progressUpdateInterval={100}
        onProgress={(e) => {
          mediaTime.current = e.currentTime;
        }}
        onEnd={() => onState('ended')}
        onError={() => setPlayerError('This file cannot be played here.')}
        playInBackground={false}
        style={styles.hiddenVideo}
      />
    </View>
  ) : null), [videoId, audioUrl, playing, counting, volume, tempoPct, mediaWidth, mediaHeight, onState]);
  const key = result && result.key ? transposeChord(result.key, transpose) : '';
  const transposeLocked = !can('transpose_capo');

  const toolbar = [
    { id: 'view', label: INSTRUMENTS.find((i) => i.id === shownInstrument).label, chevron: true, open: viewOpen, active: viewOpen, onPress: () => setViewOpen((o) => !o) },
    { id: 'transpose', label: 'Transpose', dot: transpose !== 0, locked: transposeLocked, onPress: () => (transposeLocked ? needsPlan() : setSheet('transpose')) },
    { id: 'capo', label: 'Capo', dot: capo !== 0, locked: transposeLocked, onPress: () => (transposeLocked ? needsPlan() : setSheet('capo')) },
  ];
  if (hasDetail) toolbar.push({ id: 'detail', label: detailed ? 'Simplify' : 'Detail', active: detailed, locked: !can('chord_detail'), onPress: () => (can('chord_detail') ? setDetailed((d) => !d) : needsPlan()) });

  const arrows = can('chord_voicings');

  return (
    <View style={[styles.screen, landscape && { flexDirection: 'row', paddingLeft: insets.left }]}>
      <StatusBar hidden={landscape} animated />
      <View style={styles.main}>
      <View style={{ height: insets.top, backgroundColor: colors.bar }} />
      <Animated.View
        style={[
          styles.top,
          topHeight ? { height: topAnim.interpolate({ inputRange: [0, 1], outputRange: [0, topHeight] }), opacity: topAnim } : null,
        ]}
      >
        <View onLayout={(e) => setTopHeight(Math.round(e.nativeEvent.layout.height))} style={topHeight ? styles.topInner : null}>
          <AppBar
            title={title}
            subtitle={artist}
            backIcon="close"
            inset={false}
            onBack={() => navigation.goBack()}
            actions={[
              { icon: 'heart', label: favorite ? 'Remove from favourites' : 'Add to favourites', onPress: toggleFavorite, filled: favorite },
              { icon: 'more', label: 'More', onPress: () => setSheet('more') },
            ]}
          />
          {chart ? <Toolbar items={toolbar} /> : null}
        </View>
      </Animated.View>

      {playerError && videoId ? (
        <View style={styles.pad}>
          <Note>{playerError}</Note>
          <Button title="Open in YouTube" kind="quiet" onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`)} />
        </View>
      ) : null}
      {error ? (
        <View style={styles.pad}>
          <Note>{error}</Note>
        </View>
      ) : null}

      <View style={styles.body}>
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
        ) : view === 'diagrams' ? (
          <LiveDiagrams store={activeStore} width={contentWidth} chart={chart} instrument={shownInstrument} transpose={transpose} capo={capo} arrows={arrows} onSeek={seek} />
        ) : view === 'strum' && strumList.length > 0 ? (
          <StrumView result={result} chart={chart} time={strumTime} bottomInset={0} width={contentWidth} />
        ) : view === 'summary' ? (
          <SummaryView chart={chart} instrument={shownInstrument} transpose={transpose} capo={capo} arrows={arrows} bottomInset={0} width={contentWidth} />
        ) : (
          <LiveGrid store={activeStore} width={contentWidth} chart={chart} transpose={transpose} onSeek={seek} bottomInset={0} />
        )}
        {chart ? (
          <ViewPanel
            open={viewOpen}
            wide={contentWidth >= 440}
            onClose={() => setViewOpen(false)}
            views={VIEWS.filter((v) => v.id !== 'strum' || strumList.length > 0)}
            view={view}
            onView={chooseView}
            instruments={INSTRUMENTS.map((item) => ({ ...item, locked: !!item.feature && !can(item.feature) }))}
            instrument={shownInstrument}
            onInstrument={chooseInstrument}
          />
        ) : null}
      </View>

      </View>

      {chart ? (
        <ControlPanel
          playing={playing}
          counting={counting}
          onPlay={togglePlay}
          onRestart={restart}
          tempoPct={tempoPct}
          onTempo={() => setSheet('tempo')}
          loopMode={loopMode}
          onLoop={cycleLoop}
          countIn={countIn}
          onCountIn={() => setCountIn((c) => !c)}
          volume={volume}
          onVolume={() => setSheet('volume')}
          bottomInset={insets.bottom}
          media={media}
          mediaWidth={mediaWidth}
          mediaHeight={mediaHeight}
          side={landscape}
          sideWidth={sideWidth}
          topInset={insets.top}
          rightInset={insets.right}
        />
      ) : null}

      <Sheet visible={sheet === 'transpose'} title="Transpose" onClose={() => setSheet(null)}>
        <Text style={styles.sheetHint}>Change the key of the song. The shapes follow; use Capo to keep playing the easy ones.</Text>
        <Stepper label="Transpose" value={key || (transpose > 0 ? `+${transpose}` : String(transpose))} onMinus={() => setTranspose((t) => t - 1)} onPlus={() => setTranspose((t) => t + 1)} />
        <Text style={styles.sheetSub}>{transpose === 0 ? 'Original key' : `${transpose > 0 ? '+' : ''}${transpose} semitone${Math.abs(transpose) === 1 ? '' : 's'}`}</Text>
        <Button title="Reset" kind="quiet" onPress={() => setTranspose(0)} disabled={transpose === 0} style={styles.sheetButton} />
      </Sheet>

      <Sheet visible={sheet === 'capo'} title="Capo" onClose={() => setSheet(null)}>
        <Text style={styles.sheetHint}>Put a capo on this fret and the diagrams show the shapes to play, so the song still sounds the same.</Text>
        <Stepper label="Capo" value={capo === 0 ? 'None' : `Fret ${capo}`} onMinus={() => setCapo((c) => Math.max(0, c - 1))} onPlus={() => setCapo((c) => Math.min(7, c + 1))} minusDisabled={capo === 0} plusDisabled={capo === 7} />
        <Button title="Reset" kind="quiet" onPress={() => setCapo(0)} disabled={capo === 0} style={styles.sheetButton} />
      </Sheet>

      <Sheet visible={sheet === 'tempo'} title="Tempo" onClose={() => setSheet(null)}>
        <Text style={styles.sheetHint}>Slow the song down to practise, or speed it up.</Text>
        <Stepper label="Tempo" value={`${tempoPct}%`} onMinus={() => setTempoPct((t) => Math.max(50, t - 10))} onPlus={() => setTempoPct((t) => Math.min(150, t + 10))} minusDisabled={tempoPct <= 50} plusDisabled={tempoPct >= 150} />
        <Text style={styles.sheetSub}>{result && result.tempo ? `${Math.round(result.tempo * (tempoPct / 100))} BPM` : ''}</Text>
        <Button title="Reset" kind="quiet" onPress={() => setTempoPct(100)} disabled={tempoPct === 100} style={styles.sheetButton} />
      </Sheet>

      <Sheet visible={sheet === 'sync'} title="Beat timing" onClose={() => setSheet(null)}>
        <Text style={styles.sheetHint}>If the lit beat comes after you hear it, make this higher; if it comes before, lower it. It is kept for every song on this phone.</Text>
        <Stepper
          label="Beat timing"
          value={`${beatLead > 0 ? '+' : ''}${beatLead} ms`}
          onMinus={() => changeLead(beatLead - 20)}
          onPlus={() => changeLead(beatLead + 20)}
          minusDisabled={beatLead <= LEAD_MIN}
          plusDisabled={beatLead >= LEAD_MAX}
        />
        <Button title="Reset" kind="quiet" onPress={() => changeLead(LEAD_DEFAULT)} disabled={beatLead === LEAD_DEFAULT} style={styles.sheetButton} />
      </Sheet>

      <Sheet visible={sheet === 'volume'} title="Volume" onClose={() => setSheet(null)}>
        <Stepper label="Volume" value={`${volume}`} onMinus={() => setVolume((v) => Math.max(0, v - 10))} onPlus={() => setVolume((v) => Math.min(100, v + 10))} minusDisabled={volume <= 0} plusDisabled={volume >= 100} />
        <Text style={styles.sheetSub}>The phone's own volume keys work too.</Text>
      </Sheet>

      <Sheet visible={sheet === 'more'} title={title} onClose={() => setSheet(null)}>
        <MenuRow icon="share" title="Share this song" hint="Send a link" onPress={share} />
        <MenuRow icon="library" title="Song details" hint="Key, tempo and the chords used" onPress={() => setSheet('details')} />
 {chart ? (
          <>
            <MenuRow icon="upload" title="Chord sheet (PDF)" hint="Print it or send it" locked={!can('pdf_export')} onPress={() => doExport('pdf')} />
            <MenuRow icon="upload" title="Chords as MIDI" hint="Open it in a music app" locked={!can('midi_export')} onPress={() => doExport('midi')} />
            {strumList.length > 0 ? <MenuRow icon="upload" title="MIDI with the strumming" hint="The chords played with the song's pattern" locked={!can('midi_export')} onPress={() => doExport('midi-strum')} /> : null}
          </>
        ) : null}
        <MenuRow icon="star" title="Rate these chords" hint="Stars and a few words" onPress={() => setSheet('rate')} />
        <MenuRow icon="discover" title="Songs like this" hint="More to play next" onPress={() => setSheet('similar')} />
        <MenuRow icon="timer" title="Bar length" hint="Beats per bar, pulse and where bars start" onPress={() => setSheet('bars')} />
        <MenuRow icon="timer" title="Beat timing" hint="If the lit beat comes late or early" onPress={() => setSheet('sync')} />
      </Sheet>

      <RateSheet visible={sheet === 'rate'} sessionId={sessionId} onClose={() => setSheet(null)} />
      <SimilarSheet
        visible={sheet === 'similar'}
        sessionId={sessionId}
        onClose={() => setSheet(null)}
        onPick={(picked) => {
          setSheet(null);
          openSong(picked);
        }}
      />

      <Sheet visible={sheet === 'bars'} title="Bar length" onClose={() => setSheet(null)}>
        {chart ? <BarSheet chart={chart} meter={meter || chart.own} onChange={changeMeter} onReset={() => changeMeter({ ...chart.own })} own={isOwn(meter || chart.own, chart.own)} /> : null}
      </Sheet>

      <Sheet visible={sheet === 'details'} title="Song details" onClose={() => setSheet(null)} scroll>
        {result ? <Details result={result} transpose={transpose} chart={chart} sections={sections} /> : null}
      </Sheet>
    </View>
  );
}

/** Beats per bar, a beat in between each beat (pulse x2) and the beat a bar starts on: for a song the analysis counted wrong. */
function BarSheet({ chart, meter, onChange, onReset, own }) {
  return (
    <View>
      <Text style={styles.sheetHint}>If the bars in the chart look wrong, regroup the beats. The choice is kept for this song.</Text>
      <Text style={styles.barLabel}>Beats per bar</Text>
      <Stepper label="Beats per bar" value={String(meter.perBar)} onMinus={() => onChange({ perBar: meter.perBar - 1 })} onPlus={() => onChange({ perBar: meter.perBar + 1 })} minusDisabled={meter.perBar <= METER_MIN} plusDisabled={meter.perBar >= METER_MAX} />
      <Text style={styles.barLabel}>Pulse</Text>
      <Segmented
        options={[
          { id: '1', label: '×1' },
          { id: '2', label: '×2' },
        ]}
        value={String(meter.pulse)}
        onChange={(id) => onChange({ pulse: Number(id) })}
      />
      <Text style={styles.barLabel}>Bar starts on</Text>
      <Stepper
        label="Bar start"
        value={meter.shift === null ? 'auto' : meter.shift === 0 ? '0' : `+${meter.shift}`}
        onMinus={() => onChange({ shift: meter.shift === null ? chart.perBar - 1 : meter.shift === 0 ? null : meter.shift - 1 })}
        onPlus={() => onChange({ shift: meter.shift === null ? 0 : meter.shift + 1 >= meter.perBar ? null : meter.shift + 1 })}
      />
      <Button title="Back to the song's own" kind="quiet" onPress={onReset} disabled={own} style={styles.sheetButton} />
    </View>
  );
}

function Details({ result, transpose, chart, sections }) {
  const totals = new Map();
  (result.chords || []).forEach((seg) => {
    if (seg.chord !== 'N') totals.set(seg.chord, (totals.get(seg.chord) || 0) + seg.end - seg.start);
  });
  const used = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const rows = [
    ['Key', result.key ? chordKeyLabel(transposeChord(result.key, transpose)) : '—'],
    ['Tempo', result.tempo ? `${Math.round(result.tempo)} BPM` : '—'],
    ['Time signature', `${chart ? chart.perBar : 4} beats to a bar`],
    ['Length', clock(result.duration)],
    ['Sections', sections.length > 0 ? String(sections.length) : '—'],
  ];
  return (
    <View>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.detailRow}>
          <Text style={styles.detailKey}>{k}</Text>
          <Text style={styles.detailValue}>{v}</Text>
        </View>
      ))}
      <Text style={styles.detailHead}>Chords used</Text>
      <View style={styles.chips}>
        {used.map(([raw]) => (
          <Text key={raw} style={styles.chip}>
            {transposeChord(raw, transpose)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { overflow: 'hidden' },
  topInner: { position: 'absolute', left: 0, right: 0, top: 0 },
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16 },
  main: { flex: 1 },
  body: { flex: 1, overflow: 'hidden' },
  by: { color: colors.mute, fontSize: 14 },
  audio: { flex: 1, backgroundColor: '#1a0533', alignItems: 'center', justifyContent: 'center', gap: 6 },
  audioText: { color: '#c4b5fd', fontSize: 14, fontWeight: '700' },
  hiddenVideo: { width: 0, height: 0 },
  sheetHint: { color: colors.mute, fontSize: 14.5, lineHeight: 21, marginBottom: 6 },
  sheetSub: { color: colors.mute, fontSize: 14, textAlign: 'center', marginBottom: 8 },
  sheetButton: { marginTop: 8 },
  barLabel: { color: colors.ink, fontSize: 15, fontWeight: '800', marginTop: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  detailKey: { color: colors.mute, fontSize: 15 },
  detailValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  detailHead: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: 18, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.violetSoft, color: colors.violetDeep, fontSize: 15, fontWeight: '800' },
});
