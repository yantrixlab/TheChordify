import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chordKeyLabel, chordNotes } from 'chordsuno-shared/chordShapes';
import { ChordListener } from 'chordsuno-shared/tools/listener';
import { pitchClassesOf } from 'chordsuno-shared/tools/chroma';
import { NOTE_NAMES } from 'chordsuno-shared/tools/pitch';
import { MicError, NoiseGate, SILENT_MIC_TEXT, SilenceWatch, levelPercent, openMic } from '../audio/engine';
import { useAuth } from '../auth/AuthContext';
import ChordDiagram from '../components/ChordDiagram';
import { Icon } from '../components/Icons';
import { Segmented } from '../components/Sheet';
import { Slider } from '../components/Slider';
import { AppBar, Button, Centered, Note } from '../components/Ui';
import { shapesFor } from '../lib/diagrams';
import { getJson, setJson } from '../lib/storage';
import { colors, radius } from '../theme';

const KEY = 'chord-detector-prefs';
const TYPES = { basic: ['', 'm'], sevenths: ['', 'm', '7', 'm7', 'maj7'], all: undefined };
const TYPE_OPTIONS = [
  { id: 'basic', label: 'Major & minor' },
  { id: 'sevenths', label: '+ 7ths' },
  { id: 'all', label: 'All chords' },
];

/** Live chord detection: play a chord and its name appears, with the notes it is made of and a diagram. The listening is the
 *  website's own code (lib/tools/listener.ts and chroma.ts), reading the phone's microphone. */
export default function ChordDetectorScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { can } = useAuth();
  const [prefs, setPrefsState] = useState({ sens: 55, types: 'basic', shape: true, ...(getJson(KEY, {}) || {}) });
  const [hold, setHold] = useState(false);
  const [ui, setUi] = useState({ listening: false, chord: null, score: 0, chroma: null, level: 0, silent: false, error: '', status: 'Press Start, then play a chord' });
  const [history, setHistory] = useState([]);
  const [shapeIndex, setShapeIndex] = useState(0);
  const e = useRef({ mic: null, listener: null, gate: new NoiseGate(55), silence: new SilenceWatch(), startedAt: 0, lastUi: 0, hold: false, chord: null }).current;
  e.hold = hold;

  const setPrefs = useCallback((patch) => {
    setPrefsState((before) => {
      const next = { ...before, ...patch };
      setJson(KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    e.gate.sensitivity = prefs.sens;
    if (e.listener) e.listener.options.suffixes = TYPES[prefs.types];
  }, [prefs.sens, prefs.types, e]);

  const onHeard = useCallback(
    (h) => {
      const silent = e.silence.feed(h.level);
      const now = Date.now();
      if (now - e.lastUi < 90) return;
      e.lastUi = now;
      const show = !e.hold;
      if (show && h.chord && h.chord !== e.chord) {
        e.chord = h.chord;
        setShapeIndex(0);
        setHistory((list) => (list.length && list[list.length - 1].chord === h.chord ? list : [...list, { chord: h.chord, at: (performance.now() - e.startedAt) / 1000 }].slice(-40)));
      }
      setUi((before) => ({
        ...before,
        level: levelPercent(h.level),
        silent,
        chroma: h.chroma ? Array.from(h.chroma) : null,
        ...(show ? { chord: h.chord, score: h.score, status: h.chroma ? 'Hearing you' : 'Listening… play a chord' } : {}),
      }));
    },
    [e],
  );

  const stop = useCallback(() => {
    if (e.listener) e.listener.stop();
    e.listener = null;
    if (e.mic) e.mic.stop();
    e.mic = null;
    e.chord = null;
    setUi((before) => ({ ...before, listening: false, level: 0, chroma: null, silent: false, status: 'Press Start, then play a chord' }));
  }, [e]);

  const start = useCallback(async () => {
    if (e.mic) return;
    try {
      e.mic = await openMic(16384);
    } catch (err) {
      setUi((before) => ({ ...before, error: err instanceof MicError ? err.message : 'The microphone could not be started.' }));
      return;
    }
    e.startedAt = performance.now();
    e.listener = new ChordListener(e.mic, { gate: e.gate, suffixes: TYPES[prefs.types] }, onHeard);
    e.listener.start();
    setUi((before) => ({ ...before, listening: true, error: '', status: 'Listening… play a chord' }));
  }, [e, onHeard, prefs.types]);

  useEffect(() => () => stop(), [stop]);

  const shapes = ui.chord && prefs.shape ? shapesFor('guitar', ui.chord) : [];
  const index = Math.min(shapeIndex, Math.max(0, shapes.length - 1));
  const tones = ui.chord ? pitchClassesOf(ui.chord) : [];
  const notes = ui.chord ? chordNotes(ui.chord) : [];

  if (!can('chord_detector')) {
    return (
      <View style={styles.screen}>
        <AppBar title="Chord detector" backIcon="close" onBack={() => navigation.goBack()} />
        <Centered>
          <Icon name="premium" size={48} color={colors.gold} filled />
          <Text style={styles.gateTitle}>Live chord detection is part of Premium</Text>
          <Button title="See the plans" onPress={() => navigation.navigate('Tabs', { screen: 'Premium' })} style={styles.gateButton} />
        </Centered>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AppBar title="Chord detector" backIcon="close" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card}>
          <Text style={styles.name}>{ui.chord || '–'}</Text>
          <Text style={styles.kind}>{ui.chord ? chordKeyLabel(ui.chord) : ui.listening ? 'Listening… play a chord' : 'Waiting for a chord'}</Text>
          <View style={styles.notes}>
            {notes.map((n) => (
              <Text key={n} style={styles.note}>
                {n.replace('#', '♯')}
              </Text>
            ))}
          </View>
          {ui.chord ? (
            <View style={styles.conf}>
              <View style={[styles.confFill, { width: `${Math.round(ui.score * 100)}%` }]} />
            </View>
          ) : null}
          {ui.chord ? <Text style={styles.confText}>{Math.round(ui.score * 100)}% match</Text> : null}
        </View>

        {shapes.length > 0 ? (
          <View style={styles.shape}>
            <Pressable onPress={() => setShapeIndex(index - 1)} disabled={index === 0} style={[styles.arrow, index === 0 && styles.off]} accessibilityRole="button" accessibilityLabel="Previous way to play">
              <Icon name="back" size={24} color={colors.violetDeep} />
            </Pressable>
            <View style={styles.shapeBody}>
              <ChordDiagram shape={shapes[index]} label={ui.chord} scale={1.1} />
              <Text style={styles.shapeCount}>
                {index + 1} of {shapes.length}
              </Text>
            </View>
            <Pressable onPress={() => setShapeIndex(index + 1)} disabled={index >= shapes.length - 1} style={[styles.arrow, index >= shapes.length - 1 && styles.off]} accessibilityRole="button" accessibilityLabel="Next way to play">
              <Icon name="forward" size={24} color={colors.violetDeep} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.bars}>
          {NOTE_NAMES.map((n, i) => {
            const v = ui.chroma ? ui.chroma[i] : 0;
            const inChord = !!ui.chroma && tones.includes(i) && v > 0.25;
            return (
              <View key={n} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: Math.max(3, v * 70) }, inChord && styles.barIn]} />
                </View>
                <Text style={[styles.barLabel, inChord && styles.barLabelIn]}>{n.replace('#', '♯')}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${ui.level}%` }, ui.chroma && { backgroundColor: colors.violet }]} />
        </View>
        <Text style={styles.status}>{ui.status}</Text>
        {ui.silent ? <Note>{SILENT_MIC_TEXT}</Note> : null}
        {ui.error ? <Note>{ui.error}</Note> : null}

        <Button title={ui.listening ? 'Stop' : 'Start'} icon={ui.listening ? 'pause' : 'chord-detector'} onPress={ui.listening ? stop : start} style={styles.go} />
        <Text style={styles.privacy}>The microphone is used only while this is on, and the sound never leaves your phone.</Text>

        <Text style={styles.label}>Chords it can name</Text>
        <Segmented options={TYPE_OPTIONS} value={prefs.types} onChange={(id) => setPrefs({ types: id })} />
        <Text style={styles.label}>Microphone sensitivity</Text>
        <Slider value={prefs.sens} min={10} max={95} step={5} onChange={(v) => setPrefs({ sens: v })} label="Microphone sensitivity" />
        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Show a guitar diagram</Text>
          <Switch value={prefs.shape} onValueChange={(shape) => setPrefs({ shape })} trackColor={{ true: colors.violet, false: colors.line }} thumbColor="#fff" />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Hold the chord on screen</Text>
          <Switch value={hold} onValueChange={setHold} trackColor={{ true: colors.violet, false: colors.line }} thumbColor="#fff" />
        </View>

        <View style={styles.historyHead}>
          <Text style={styles.label}>{history.length ? `Chords you played (${history.length})` : 'Chords you played'}</Text>
          {history.length > 0 ? (
            <View style={styles.historyActions}>
              <Text onPress={() => Share.share({ message: history.map((h) => h.chord).join(' - ') }).catch(() => {})} style={styles.link}>
                Share
              </Text>
              <Text onPress={() => setHistory([])} style={styles.link}>
                Clear
              </Text>
            </View>
          ) : null}
        </View>
        {history.length === 0 ? (
          <Text style={styles.empty}>Chords you play will line up here.</Text>
        ) : (
          <View style={styles.chips}>
            {history.map((h, i) => (
              <Text key={`${h.chord}-${i}`} style={styles.chip}>
                {h.chord}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  card: { alignItems: 'center', padding: 20, borderRadius: radius.card, backgroundColor: colors.surface },
  name: { color: colors.ink, fontSize: 72, fontWeight: '800', letterSpacing: -2, lineHeight: 80 },
  kind: { color: colors.mute, fontSize: 15.5, marginTop: 2 },
  notes: { flexDirection: 'row', gap: 8, marginTop: 12, minHeight: 32 },
  note: { overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.violetSoft, color: colors.violetDeep, fontSize: 16, fontWeight: '800' },
  conf: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: colors.soft, overflow: 'hidden', marginTop: 14 },
  confFill: { height: 6, backgroundColor: colors.violet },
  confText: { color: colors.mute, fontSize: 12.5, marginTop: 4 },
  shape: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  shapeBody: { alignItems: 'center' },
  shapeCount: { color: colors.mute, fontSize: 13, fontWeight: '700', marginTop: 8 },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.violetSoft, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.35 },
  bars: { flexDirection: 'row', gap: 4, marginTop: 16, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center' },
  barTrack: { height: 72, justifyContent: 'flex-end', alignSelf: 'stretch' },
  barFill: { borderRadius: 4, backgroundColor: '#c9bfe0' },
  barIn: { backgroundColor: colors.violet },
  barLabel: { color: colors.faint, fontSize: 11, fontWeight: '700', marginTop: 4 },
  barLabelIn: { color: colors.violetDeep },
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.soft, overflow: 'hidden', marginTop: 16 },
  meterFill: { height: 8, backgroundColor: colors.faint },
  status: { color: colors.mute, fontSize: 13.5, textAlign: 'center', marginTop: 8 },
  go: { marginTop: 14 },
  privacy: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  switchText: { color: colors.ink, fontSize: 15.5 },
  historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyActions: { flexDirection: 'row', gap: 18, marginTop: 10 },
  link: { color: colors.violetDeep, fontSize: 14.5, fontWeight: '700' },
  empty: { color: colors.mute, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.violetSoft, color: colors.violetDeep, fontSize: 15, fontWeight: '800' },
  gateTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  gateButton: { marginTop: 18 },
});
