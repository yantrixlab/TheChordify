import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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

export default function PlayerScreen({ route, navigation }) {
  const { sessionId, song } = route.params;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, can } = useAuth();
  const [result, setResult] = useState(route.params.result || null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [active, setActive] = useState(-1);
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
  const [sheet, setSheet] = useState(null); // 'view' | 'transpose' | 'capo' | 'tempo' | 'volume' | 'more' | 'details' | 'bars'
  const openSong = useOpenSong();
  const player = useRef(null);
  const video = useRef(null); // the audio of an uploaded song
  const mediaTime = useRef(0);
  const counted = useRef(false);
  const loopSection = useRef(null);
  const timeRef = useRef(0);
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
    (t) => {
      if (videoId) {
        if (player.current) player.current.seekTo(t, true);
      } else if (video.current) {
        video.current.seek(t);
        mediaTime.current = t;
      }
    },
    [videoId],
  );

  // Where the video is: asked about six times a second while it plays; only a change of beat re-draws anything.
  useEffect(() => {
    if (!playing || !chart) return undefined;
    let stop = false;
    const id = setInterval(async () => {
      if (stop || (videoId && !player.current)) return;
      try {
        const t = videoId ? await player.current.getCurrentTime() : mediaTime.current;
        timeRef.current = t;
        const section = loopSection.current;
        if (section && t >= section.end - 0.04) {
          seekMedia(section.start); // loop the section
          return;
        }
        const i = cellAt(chart.cells, t);
        setActive((before) => (before === i ? before : i));
        if (viewRef.current === 'strum') setStrumTime(t);
      } catch {
        // the player is not ready yet
      }
    }, 150);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [playing, chart, videoId, seekMedia]);

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
        seekMedia(Math.max(0, t - 0.05));
        setPlaying(true);
      }
    },
    [seekMedia],
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
    setActive(-1);
    timeRef.current = 0;
    setPlaying(true);
  }, [seekMedia]);

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

  const chooseView = (id) => {
    setView(id);
    setJson('view', id);
  };
  const chooseInstrument = (item) => {
    if (item.soon) return;
    if (item.feature && !can(item.feature)) {
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
    setActive(-1);
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
  const videoHeight = Math.round((width * 9) / 16);
  const key = result && result.key ? transposeChord(result.key, transpose) : '';
  const transposeLocked = !can('transpose_capo');

  const toolbar = [
    { id: 'view', label: INSTRUMENTS.find((i) => i.id === shownInstrument).label, chevron: true, onPress: () => setSheet('view') },
    { id: 'transpose', label: 'Transpose', dot: transpose !== 0, locked: transposeLocked, onPress: () => (transposeLocked ? needsPlan() : setSheet('transpose')) },
    { id: 'capo', label: 'Capo', dot: capo !== 0, locked: transposeLocked, onPress: () => (transposeLocked ? needsPlan() : setSheet('capo')) },
  ];
  if (hasDetail) toolbar.push({ id: 'detail', label: detailed ? 'Simplify' : 'Detail', active: detailed, locked: !can('chord_detail'), onPress: () => (can('chord_detail') ? setDetailed((d) => !d) : needsPlan()) });

  const arrows = can('chord_voicings');

  return (
    <View style={styles.screen}>
      <AppBar
        title={title}
        subtitle={artist}
        backIcon="close"
        onBack={() => navigation.goBack()}
        actions={[
          { icon: 'heart', label: favorite ? 'Remove from favourites' : 'Add to favourites', onPress: toggleFavorite, filled: favorite },
          { icon: 'more', label: 'More', onPress: () => setSheet('more') },
        ]}
      />
      {videoId ? (
        <View style={{ height: videoHeight, backgroundColor: '#000' }}>
          <YoutubePlayer
            ref={player}
            height={videoHeight}
            width={width}
            videoId={videoId}
            play={playing && !counting}
            volume={volume}
            playbackRate={tempoPct / 100}
            onChangeState={onState}
            onError={() => setPlayerError('This video cannot be played inside apps.')}
            initialPlayerParams={{ controls: true, rel: false, preventFullScreen: true }}
            webViewProps={{ androidLayerType: 'hardware' }}
          />
        </View>
      ) : null}

      {chart ? <Toolbar items={toolbar} /> : null}

      {audioUrl ? (
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
      ) : null}
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
          <DiagramsView chart={chart} active={active} instrument={shownInstrument} transpose={transpose} capo={capo} arrows={arrows} />
        ) : view === 'strum' && strumList.length > 0 ? (
          <StrumView result={result} chart={chart} time={strumTime} bottomInset={0} />
        ) : view === 'summary' ? (
          <SummaryView chart={chart} instrument={shownInstrument} transpose={transpose} capo={capo} arrows={arrows} bottomInset={0} />
        ) : (
          <GridView chart={chart} active={active} transpose={transpose} onSeek={seek} bottomInset={0} />
        )}
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
        />
      ) : null}

      <Sheet visible={sheet === 'view'} title="Pick your view" onClose={() => setSheet(null)}>
        <Segmented options={VIEWS.filter((v) => v.id !== 'strum' || strumList.length > 0)} value={view} onChange={chooseView} />
        <View style={styles.tiles}>
          {INSTRUMENTS.map((item) => {
            const locked = item.feature && !can(item.feature);
            const on = shownInstrument === item.id;
            return (
              <Text key={item.id} onPress={() => chooseInstrument(item)} style={[styles.tile, on && styles.tileOn, (item.soon || locked) && styles.tileOff]} accessibilityRole="button">
                {item.label}
                {item.soon ? '\nsoon' : locked ? '\n🔒' : ''}
              </Text>
            );
          })}
        </View>
        <Button title="Done" onPress={() => setSheet(null)} />
      </Sheet>

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
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16 },
  body: { flex: 1 },
  by: { color: colors.mute, fontSize: 14 },
  audio: { height: 100, backgroundColor: '#1a0533', alignItems: 'center', justifyContent: 'center', gap: 6 },
  audioText: { color: '#c4b5fd', fontSize: 14, fontWeight: '700' },
  hiddenVideo: { width: 0, height: 0 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 16 },
  tile: { width: '47%', paddingVertical: 20, textAlign: 'center', borderRadius: radius.card, backgroundColor: colors.soft, color: colors.ink, fontSize: 17, fontWeight: '700', overflow: 'hidden', lineHeight: 24 },
  tileOn: { backgroundColor: colors.violet, color: '#fff' },
  tileOff: { opacity: 0.55 },
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
