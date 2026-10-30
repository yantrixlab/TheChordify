import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Metronome, TapTempo, clampBpm, defaultAccents, tempoName } from 'chordsuno-shared/tools/metronome';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { Sheet, Stepper } from '../components/Sheet';
import { Slider } from '../components/Slider';
import { AppBar, Button, Centered } from '../components/Ui';
import { getJson, setJson } from '../lib/storage';
import { radius, makeStyles, useColors } from '../theme';

const SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '3/8', '6/8', '7/8', '9/8', '12/8'];
const SOUNDS = [
  ['click', 'Click'],
  ['wood', 'Wood block'],
  ['beep', 'Beep'],
  ['hat', 'Hi-hat'],
];
const SUBS = [1, 2, 3, 4];
const QUICK = [60, 80, 100, 120, 140, 160];
const KEY = 'metronome';
const PRESETS = 'metronome-presets';

const fresh = () => ({
  bpm: 100,
  beats: 4,
  accents: defaultAccents(4, 4),
  sub: 1,
  sound: 'click',
  volume: 0.8,
  sig: '4/4',
  trainer: { on: false, every: 4, step: 2, target: 140 },
  gap: { on: false, play: 3, mute: 1 },
});

function load() {
  const saved = getJson(KEY, null);
  if (saved && typeof saved.bpm === 'number' && Array.isArray(saved.accents)) {
    return { ...fresh(), ...saved, trainer: { ...fresh().trainer, ...saved.trainer }, gap: { ...fresh().gap, ...saved.gap } };
  }
  return fresh();
}


/** The metronome. The click engine is the website's (lib/tools/metronome.ts): it keeps time by the audio clock, not by timers. */
export default function MetronomeScreen({ navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { can } = useAuth();
  const [state, setStateRaw] = useState(load);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState({ beat: -1, bar: 0, audible: true });
  const [sheet, setSheet] = useState(null); // 'settings' | 'presets'
  const [presets, setPresets] = useState(() => getJson(PRESETS, []) || []);
  const [presetName, setPresetName] = useState('');
  const engine = useRef(null);
  const tapper = useRef(new TapTempo());
  const raf = useRef(0);
  const hold = useRef({ wait: 0, repeat: 0 });
  if (!engine.current) engine.current = new Metronome(state);
  engine.current.settings = state;

  const setState = useCallback((patch) => {
    setStateRaw((before) => {
      const next = typeof patch === 'function' ? patch(before) : { ...before, ...patch };
      setJson(KEY, next);
      return next;
    });
  }, []);
  const setBpm = useCallback((bpm) => setState({ bpm: clampBpm(bpm) }), [setState]);

  // The trainer changes the tempo as it plays.
  useEffect(() => {
    engine.current.onBpm = (bpm) => setStateRaw((s) => ({ ...s, bpm }));
  }, []);

  // The lights follow what is sounding: asked for on each frame while it runs.
  const frame = useCallback(() => {
    for (const tick of engine.current.due()) {
      if (tick.sub === 0) setNow({ beat: tick.beat, bar: tick.bar, audible: tick.audible });
    }
    raf.current = requestAnimationFrame(frame);
  }, []);

  const stop = useCallback(() => {
    engine.current.stop();
    cancelAnimationFrame(raf.current);
    setRunning(false);
    setNow({ beat: -1, bar: 0, audible: true });
  }, []);

  const startPlay = useCallback(async () => {
    await engine.current.start();
    setRunning(true);
    raf.current = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(
    () => () => {
      engine.current.stop();
      cancelAnimationFrame(raf.current);
      clearTimeout(hold.current.wait);
      clearInterval(hold.current.repeat);
    },
    [],
  );

  // Holding + or − keeps going.
  const holdStart = (delta) => {
    setStateRaw((s) => {
      const next = { ...s, bpm: clampBpm(s.bpm + delta) };
      setJson(KEY, next);
      return next;
    });
    hold.current.wait = setTimeout(() => {
      hold.current.repeat = setInterval(() => setStateRaw((s) => ({ ...s, bpm: clampBpm(s.bpm + delta) })), 70);
    }, 420);
  };
  const holdEnd = () => {
    clearTimeout(hold.current.wait);
    clearInterval(hold.current.repeat);
    setStateRaw((s) => {
      setJson(KEY, s);
      return s;
    });
  };

  const tap = () => {
    const bpm = tapper.current.tap();
    if (bpm) setBpm(bpm);
  };

  const chooseSignature = (sig) => {
    const [beats, unit] = sig.split('/').map(Number);
    setState({ sig, beats, accents: defaultAccents(beats, unit) });
  };
  const cycleAccent = (i) => setState((s) => ({ ...s, accents: s.accents.map((a, j) => (j === i ? (a + 2) % 3 : a)) })); // accent → normal → silent → accent

  const savePreset = () => {
    const name = presetName.trim() || `Setting ${presets.length + 1}`;
    const next = [...presets, { name, s: JSON.parse(JSON.stringify(state)) }].slice(-10);
    setPresets(next);
    setJson(PRESETS, next);
    setPresetName('');
  };
  const removePreset = (index) =>
    Alert.alert('Delete this setting?', presets[index].name, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const next = presets.filter((_, j) => j !== index);
          setPresets(next);
          setJson(PRESETS, next);
        },
      },
    ]);

  const beatDots = useMemo(() => state.accents, [state.accents]);

  if (!can('metronome')) {
    return (
      <View style={styles.screen}>
        <AppBar title="Metronome" backIcon="close" onBack={() => navigation.goBack()} />
        <Centered>
          <Icon name="premium" size={48} color={colors.gold} filled />
          <Text style={styles.gateTitle}>The metronome is part of Premium</Text>
          <Button title="See the plans" onPress={() => navigation.navigate('Tabs', { screen: 'Premium' })} style={styles.gateButton} />
        </Centered>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AppBar title="Metronome" backIcon="close" onBack={() => navigation.goBack()} actions={[{ icon: 'settings', label: 'Settings', onPress: () => setSheet('settings') }]} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={styles.hero}>
          <Text style={styles.sig}>{state.sig}</Text>
          <View style={styles.bpmRow}>
            <Pressable onPressIn={() => holdStart(-1)} onPressOut={holdEnd} style={styles.round} accessibilityRole="button" accessibilityLabel="Slower by 1 BPM">
              <Text style={styles.roundText}>−</Text>
            </Pressable>
            <View style={styles.bpmBox}>
              <TextInput
                value={String(state.bpm)}
                onChangeText={(t) => setBpm(Number(t.replace(/\D/g, '')) || state.bpm)}
                keyboardType="number-pad"
                maxLength={3}
                style={styles.bpm}
                accessibilityLabel="Beats per minute"
                selectTextOnFocus
              />
              <Text style={styles.bpmUnit}>BPM · {tempoName(state.bpm)}</Text>
            </View>
            <Pressable onPressIn={() => holdStart(1)} onPressOut={holdEnd} style={styles.round} accessibilityRole="button" accessibilityLabel="Faster by 1 BPM">
              <Text style={styles.roundText}>+</Text>
            </Pressable>
          </View>
          <View style={styles.pad}>
            <Slider value={state.bpm} min={20} max={300} onChange={setBpm} label="Tempo" trackColor={`${colors.onHero}33`} fillColor={colors.onHero} />
          </View>
          <View style={styles.quick}>
            {QUICK.map((q) => (
              <Text key={q} onPress={() => setBpm(q)} style={[styles.quickChip, state.bpm === q && styles.quickOn]} accessibilityRole="button">
                {q}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.beats}>
          {beatDots.map((level, i) => (
            <Pressable key={i} onPress={() => cycleAccent(i)} accessibilityRole="button" accessibilityLabel={`Beat ${i + 1}: ${['silent', 'normal', 'accent'][level]}. Press to change.`} style={styles.beatWrap}>
              <View style={[styles.beat, { backgroundColor: [colors.line, `${colors.accent}88`, colors.accent][level], height: 18 + level * 12 }, running && now.beat === i && (now.audible ? styles.beatNow : styles.beatSilent)]} />
            </Pressable>
          ))}
        </View>
        <Text style={styles.beatHint}>{running ? `Bar ${now.bar + 1}${now.audible ? '' : ' · silent bar'}` : 'Tap a beat to make it stronger, normal or silent.'}</Text>

        <View style={styles.pad}>
          <Button title={running ? 'Stop' : 'Start'} icon={running ? 'pause' : 'play'} onPress={running ? stop : startPlay} style={styles.go} />
          <Pressable onPressIn={tap} style={styles.tap} accessibilityRole="button" accessibilityLabel="Tap tempo">
            <Text style={styles.tapText}>Tap tempo</Text>
            <Text style={styles.tapHint}>Tap along to the beat you want</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Sheet visible={sheet === 'settings'} title="Metronome settings" onClose={() => setSheet(null)} scroll>
        <Text style={styles.label}>Time signature</Text>
        <View style={styles.chips}>
          {SIGNATURES.map((sig) => (
            <Text key={sig} onPress={() => chooseSignature(sig)} style={[styles.chip, state.sig === sig && styles.chipOn]} accessibilityRole="button">
              {sig}
            </Text>
          ))}
        </View>
        <Text style={styles.label}>Clicks per beat</Text>
        <View style={styles.chips}>
          {SUBS.map((n) => (
            <Text key={n} onPress={() => setState({ sub: n })} style={[styles.chip, state.sub === n && styles.chipOn]} accessibilityRole="button">
              {n === 1 ? 'Beats only' : n === 2 ? '8ths' : n === 3 ? 'Triplets' : '16ths'}
            </Text>
          ))}
        </View>
        <Text style={styles.label}>Sound</Text>
        <View style={styles.chips}>
          {SOUNDS.map(([id, name]) => (
            <Text key={id} onPress={() => setState({ sound: id })} style={[styles.chip, state.sound === id && styles.chipOn]} accessibilityRole="button">
              {name}
            </Text>
          ))}
        </View>
        <Text style={styles.label}>Volume · {Math.round(state.volume * 100)}%</Text>
        <Slider value={Math.round(state.volume * 100)} min={0} max={100} step={5} onChange={(v) => setState({ volume: v / 100 })} label="Volume" />

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchTitle}>Speed trainer</Text>
            <Text style={styles.switchHint}>Gets a little faster every few bars, up to a target.</Text>
          </View>
          <Switch value={state.trainer.on} onValueChange={(on) => setState((s) => ({ ...s, trainer: { ...s.trainer, on } }))} trackColor={{ true: colors.accent, false: colors.line }} thumbColor="#fff" />
        </View>
        {state.trainer.on ? (
          <View style={styles.sub}>
            <Row label="Add (BPM)" value={state.trainer.step} min={1} max={30} onChange={(v) => setState((s) => ({ ...s, trainer: { ...s.trainer, step: v } }))} />
            <Row label="Every (bars)" value={state.trainer.every} min={1} max={32} onChange={(v) => setState((s) => ({ ...s, trainer: { ...s.trainer, every: v } }))} />
            <Row label="Up to (BPM)" value={state.trainer.target} min={30} max={300} step={5} onChange={(v) => setState((s) => ({ ...s, trainer: { ...s.trainer, target: v } }))} />
          </View>
        ) : null}

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchTitle}>Silent bars</Text>
            <Text style={styles.switchHint}>Plays some bars, then goes quiet, to test your own timing.</Text>
          </View>
          <Switch value={state.gap.on} onValueChange={(on) => setState((s) => ({ ...s, gap: { ...s.gap, on } }))} trackColor={{ true: colors.accent, false: colors.line }} thumbColor="#fff" />
        </View>
        {state.gap.on ? (
          <View style={styles.sub}>
            <Row label="Bars with sound" value={state.gap.play} min={1} max={16} onChange={(v) => setState((s) => ({ ...s, gap: { ...s.gap, play: v } }))} />
            <Row label="Silent bars" value={state.gap.mute} min={1} max={16} onChange={(v) => setState((s) => ({ ...s, gap: { ...s.gap, mute: v } }))} />
          </View>
        ) : null}

        <Text style={styles.label}>Saved settings</Text>
        {presets.length === 0 ? <Text style={styles.switchHint}>Nothing saved yet. Set up the tempo and options you like, then name and save them.</Text> : null}
        {presets.map((p, i) => (
          <Pressable
            key={`${p.name}-${i}`}
            onPress={() => {
              setStateRaw({ ...fresh(), ...p.s });
              setJson(KEY, { ...fresh(), ...p.s });
              setSheet(null);
            }}
            onLongPress={() => removePreset(i)}
            style={styles.preset}
            accessibilityRole="button"
            accessibilityHint="Long press to delete"
          >
            <Text style={styles.presetName}>{p.name}</Text>
            <Text style={styles.presetInfo}>
              {p.s.bpm} · {p.s.sig}
            </Text>
          </Pressable>
        ))}
        <View style={styles.saveRow}>
          <TextInput value={presetName} onChangeText={setPresetName} placeholder="Name these settings" placeholderTextColor={colors.faint} style={styles.saveInput} maxLength={30} />
          <Button title="Save" kind="quiet" onPress={savePreset} />
        </View>
      </Sheet>
    </View>
  );
}

function Row({ label, value, min, max, step = 1, onChange }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Stepper label={label} value={String(value)} onMinus={() => onChange(Math.max(min, value - step))} onPlus={() => onChange(Math.min(max, value + step))} minusDisabled={value <= min} plusDisabled={value >= max} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.hero, paddingTop: 20, paddingBottom: 22, alignItems: 'center' },
  sig: { color: `${colors.onHero}CC`, fontSize: 20, fontWeight: '700', letterSpacing: 2 },
  bpmRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 },
  round: { width: 60, height: 60, borderRadius: 30, backgroundColor: `${colors.onHero}26`, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: colors.onHero, fontSize: 34, lineHeight: 38, fontWeight: '300' },
  bpmBox: { alignItems: 'center', minWidth: 150 },
  bpm: { color: colors.onHero, fontSize: 78, fontWeight: '800', letterSpacing: -3, textAlign: 'center', padding: 0, minWidth: 150 },
  bpmUnit: { color: `${colors.onHero}B3`, fontSize: 14, fontWeight: '600', marginTop: -4 },
  pad: { paddingHorizontal: 20, alignSelf: 'stretch' },
  quick: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickChip: { overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: `${colors.onHero}26`, color: colors.onHero, fontSize: 14, fontWeight: '700' },
  quickOn: { backgroundColor: colors.onHero, color: colors.hero },
  beats: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 10, paddingHorizontal: 20, marginTop: 22, height: 64 },
  beatWrap: { flex: 1, maxWidth: 52, height: 64, justifyContent: 'flex-end' },
  beat: { width: '100%', borderRadius: 10 },
  beatNow: { backgroundColor: colors.gold },
  beatSilent: { backgroundColor: colors.faint },
  beatHint: { color: colors.mute, fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  go: { marginTop: 22 },
  tap: { marginTop: 14, height: 84, borderRadius: radius.card, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  tapText: { color: colors.accentDeep, fontSize: 20, fontWeight: '800' },
  tapHint: { color: colors.mute, fontSize: 12.5, marginTop: 2 },
  gateTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  gateButton: { marginTop: 18 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.accentDeep, fontSize: 14, fontWeight: '700' },
  chipOn: { backgroundColor: colors.accent, color: colors.onAccent },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  switchText: { flex: 1 },
  switchTitle: { color: colors.ink, fontSize: 15.5, fontWeight: '800' },
  switchHint: { color: colors.mute, fontSize: 13, lineHeight: 18, marginTop: 2 },
  sub: { paddingLeft: 8 },
  row: { marginTop: 4 },
  rowLabel: { color: colors.mute, fontSize: 13.5, fontWeight: '700', marginTop: 8 },
  preset: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.soft, marginBottom: 8 },
  presetName: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  presetInfo: { color: colors.mute, fontSize: 13 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 12 },
  saveInput: { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.soft, color: colors.ink, paddingHorizontal: 14, fontSize: 15 },
}));
