import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { freqFromMidi, noteLabel } from 'chordsuno-shared/tools/pitch';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { Segmented, Sheet, Stepper } from '../components/Sheet';
import { AppBar, Button, Centered, Note } from '../components/Ui';
import { INSTRUMENTS, useTuner } from '../tools/useTuner';
import { colors, radius } from '../theme';

const BOARD_H = 300;
const LED = 21;
const OK = '#16a34a';
const pretty = (name) => name.replace('#', '♯');
const SENS = [
  { id: '25', label: 'Low' },
  { id: '55', label: 'Medium' },
  { id: '80', label: 'High' },
];
const TOLS = [
  { id: '3', label: '±3 ¢' },
  { id: '5', label: '±5 ¢' },
  { id: '8', label: '±8 ¢' },
];

export default function TunerScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { can } = useAuth();
  const { prefs, setPrefs, instrument, strings, target, setTarget, ui, note, start, stop, resetDone, playTone, silentText } = useTuner();
  const [sheet, setSheet] = useState(false);
  const [lastStrings, setLastStrings] = useState(prefs.instrument === 'chromatic' ? 'guitar' : prefs.instrument);
  const chromatic = prefs.instrument === 'chromatic';
  const k = (BOARD_H * 0.36) / 50; // dp for one cent

  // A note for each string, sliding up or down with how far off it is; only the string being tuned moves.
  const lanes = useRef([]);
  const count = Math.max(strings.length, 1);
  if (lanes.current.length !== count) lanes.current = Array.from({ length: count }, () => new Animated.Value(0));
  useEffect(() => {
    lanes.current.forEach((value, i) => {
      const goal = i === ui.lock ? -Math.max(-50, Math.min(50, ui.cents)) * k : 0;
      Animated.timing(value, { toValue: goal, duration: 110, useNativeDriver: true }).start();
    });
  }, [ui.lock, ui.cents, k, count]);

  const doneCount = ui.done.filter(Boolean).length;
  const hint = ui.lock < 0 ? '' : ui.ok ? 'In tune ✓' : ui.cents < 0 ? 'A little low: tune up ↑' : 'A little high: tune down ↓';
  const ledAt = ui.lock >= 0 ? Math.round(Math.max(-50, Math.min(50, ui.cents)) / 5) + 10 : -1;
  const hz = ui.goal === null ? '' : `${freqFromMidi(ui.goal + ui.cents / 100, prefs.a4).toFixed(1)} Hz`;
  const centsText = ui.lock < 0 ? '' : `${ui.cents > 0.5 ? '+' : ui.cents < -0.5 ? '−' : ''}${Math.abs(Math.round(ui.cents))} ¢`;
  const tuningName = (instrument.tunings[prefs.tuning] || instrument.tunings[0]).name;

  const lanesView = useMemo(() => strings.length > 0, [strings]);

  if (!can('tuner')) {
    return (
      <View style={styles.screen}>
        <AppBar title="Tuner" backIcon="close" onBack={() => navigation.goBack()} />
        <Centered>
          <Icon name="premium" size={48} color={colors.gold} filled />
          <Text style={styles.gateTitle}>The tuner is part of Premium</Text>
          <Button title="See the plans" onPress={() => navigation.navigate('Tabs', { screen: 'Premium' })} style={styles.gateButton} />
        </Centered>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AppBar title="Tuner" backIcon="close" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={styles.pad}>
          <Segmented
            options={[
              { id: 'strings', label: 'Standard' },
              { id: 'chromatic', label: 'Chromatic' },
            ]}
            value={chromatic ? 'chromatic' : 'strings'}
            onChange={(id) => {
              setTarget(null);
              setPrefs({ instrument: id === 'chromatic' ? 'chromatic' : lastStrings, tuning: 0 });
            }}
          />
          <Pressable onPress={() => setSheet(true)} style={styles.tuningRow} accessibilityRole="button" accessibilityLabel="Tuning and settings">
            <Text style={styles.tuningText} numberOfLines={1}>
              {chromatic ? 'Any note' : `${instrument.name} · ${tuningName}`}
            </Text>
            <Text style={styles.a4}>{prefs.a4}Hz</Text>
            <Icon name="down" size={20} color={colors.violetDeep} />
          </Pressable>
        </View>

        <View style={[styles.board, { height: BOARD_H }]}>
          {strings.length === 0 ? (
            <View style={styles.lane}>
              <View style={styles.wire} />
              <Animated.View style={[styles.node, ui.ok && styles.nodeOk, { transform: [{ translateY: lanes.current[0] }] }]}>
                <Text style={styles.nodeText}>{ui.goal !== null && note ? pretty(note.name) : '–'}</Text>
              </Animated.View>
            </View>
          ) : (
            strings.map((midi, i) => {
              const label = noteLabel(midi);
              const isLock = ui.lock === i;
              return (
                <View key={`${midi}-${i}`} style={styles.lane}>
                  <View style={[styles.wire, { width: Math.max(2, Math.min(5, 5.4 - (midi - 40) * 0.1)) }, isLock && ui.ok && { backgroundColor: OK }]} />
                  <View style={[styles.zone, { height: Math.max(14, prefs.tol * 2 * k) }]} />
                  <Animated.View style={{ transform: [{ translateY: lanes.current[i] }] }}>
                    <Pressable
                      onPress={() => {
                        setTarget(midi);
                        playTone(midi);
                      }}
                      style={[styles.node, target === midi && styles.nodeTarget, isLock && !ui.ok && styles.nodeNear, ((isLock && ui.ok) || ui.done[i]) && styles.nodeOk]}
                      accessibilityRole="button"
                      accessibilityLabel={`String ${i + 1}, ${label}. Press to hear it and tune this string.`}
                    >
                      <Text style={styles.nodeText}>{pretty(label.replace(/\d/, ''))}</Text>
                      <Text style={styles.nodeOctave}>{label.match(/\d/)?.[0]}</Text>
                    </Pressable>
                  </Animated.View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.led}>
          {Array.from({ length: LED }, (_, i) => (
            <View key={i} style={[styles.ledSeg, i === 10 && styles.ledMid, i === ledAt && (ui.ok ? styles.ledOk : styles.ledOn)]} />
          ))}
        </View>

        <View style={styles.read}>
          <Text style={[styles.bigNote, ui.ok && { color: OK }]}>
            {ui.lock >= 0 && note ? pretty(note.name) : '–'}
            {ui.lock >= 0 && note ? <Text style={styles.sup}>{note.octave}</Text> : null}
          </Text>
          <Text style={styles.centsText}>{centsText || ' '}</Text>
          <Text style={styles.hz}>{hz || ' '}</Text>
          <Text style={[styles.hint, ui.ok && { color: OK }]}>{hint || (doneCount > 0 && doneCount === ui.done.length ? 'All strings in tune!' : ' ')}</Text>
        </View>

        <View style={styles.pad}>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${ui.level}%` }, ui.open && { backgroundColor: colors.violet }]} />
          </View>
          <Text style={styles.status}>{ui.status}</Text>
          {ui.silent ? <Note>{silentText}</Note> : null}
          {ui.error ? <Note>{ui.error}</Note> : null}
          {lanesView && ui.listening ? (
            <View style={styles.progress}>
              <Text style={styles.progressText}>
                {doneCount} of {strings.length} tuned
              </Text>
              <Pressable onPress={resetDone} hitSlop={10}>
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            </View>
          ) : null}
          {target !== null ? (
            <Pressable onPress={() => setTarget(null)} style={styles.auto}>
              <Text style={styles.autoText}>Tuning one string · tap to find the string automatically</Text>
            </Pressable>
          ) : null}
          <Button title={ui.listening ? 'Stop' : 'Start'} icon={ui.listening ? 'pause' : 'tuner'} onPress={ui.listening ? stop : start} style={styles.go} />
          <Text style={styles.privacy}>The microphone is used only while the tuner is on, and the sound never leaves your phone.</Text>
        </View>
      </ScrollView>

      <Sheet visible={sheet} title="Tuner settings" onClose={() => setSheet(false)} scroll>
        <Text style={styles.label}>Instrument</Text>
        <View style={styles.chips}>
          {INSTRUMENTS.filter((i) => i.id !== 'chromatic').map((i) => (
            <Text
              key={i.id}
              onPress={() => {
                setLastStrings(i.id);
                setTarget(null);
                setPrefs({ instrument: i.id, tuning: 0 });
              }}
              style={[styles.chip, prefs.instrument === i.id && styles.chipOn]}
              accessibilityRole="button"
            >
              {i.name}
            </Text>
          ))}
        </View>
        {!chromatic && instrument.tunings.length > 1 ? (
          <>
            <Text style={styles.label}>Tuning</Text>
            {instrument.tunings.map((t, i) => (
              <Pressable
                key={t.name}
                onPress={() => {
                  setTarget(null);
                  setPrefs({ tuning: i });
                }}
                style={styles.option}
                accessibilityRole="button"
              >
                <Text style={[styles.optionText, prefs.tuning === i && styles.optionOn]}>{t.name}</Text>
                {prefs.tuning === i ? <Icon name="check" size={20} color={colors.violet} /> : null}
              </Pressable>
            ))}
          </>
        ) : null}
        <Text style={styles.label}>Reference pitch (A4)</Text>
        <Stepper label="A4" value={`${prefs.a4} Hz`} onMinus={() => setPrefs({ a4: Math.max(415, prefs.a4 - 1) })} onPlus={() => setPrefs({ a4: Math.min(466, prefs.a4 + 1) })} minusDisabled={prefs.a4 <= 415} plusDisabled={prefs.a4 >= 466} />
        <Text style={styles.label}>How close counts as in tune</Text>
        <Segmented options={TOLS} value={String(prefs.tol)} onChange={(id) => setPrefs({ tol: Number(id) })} />
        <Text style={styles.label}>Microphone sensitivity</Text>
        <Segmented options={SENS} value={String(SENS.reduce((best, s) => (Math.abs(Number(s.id) - prefs.sens) < Math.abs(Number(best) - prefs.sens) ? s.id : best), '55'))} onChange={(id) => setPrefs({ sens: Number(id) })} />
        <Button title="Done" onPress={() => setSheet(false)} style={styles.done} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16 },
  tuningRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
  tuningText: { flex: 1, color: colors.violetDeep, fontSize: 17, fontWeight: '800' },
  a4: { color: colors.violetDeep, fontSize: 16 },
  board: { flexDirection: 'row', paddingHorizontal: 8, marginTop: 4 },
  lane: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wire: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: '#b9aee0', borderRadius: 2 },
  zone: { position: 'absolute', left: 6, right: 6, borderRadius: 8, backgroundColor: '#7c3aed1a' },
  node: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface, borderWidth: 4, borderColor: '#b9aee0', alignItems: 'center', justifyContent: 'center' },
  nodeTarget: { borderColor: colors.violetDeep },
  nodeNear: { borderColor: colors.violet },
  nodeOk: { borderColor: OK, backgroundColor: '#dcfce7' },
  nodeText: { color: colors.ink, fontSize: 18, fontWeight: '800', lineHeight: 20 },
  nodeOctave: { color: colors.mute, fontSize: 10, fontWeight: '700', marginTop: -2 },
  led: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 14, paddingHorizontal: 16 },
  ledSeg: { flex: 1, height: 18, borderRadius: 4, backgroundColor: colors.line },
  ledMid: { backgroundColor: '#c9bfe0' },
  ledOn: { backgroundColor: colors.violet },
  ledOk: { backgroundColor: OK },
  read: { alignItems: 'center', paddingVertical: 10 },
  bigNote: { color: colors.ink, fontSize: 64, fontWeight: '800', letterSpacing: -2, lineHeight: 72 },
  sup: { fontSize: 24, fontWeight: '700', color: colors.mute },
  centsText: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  hz: { color: colors.mute, fontSize: 14, marginTop: 2 },
  hint: { color: colors.mute, fontSize: 15, fontWeight: '600', marginTop: 6 },
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.soft, overflow: 'hidden' },
  meterFill: { height: 8, backgroundColor: colors.faint },
  status: { color: colors.mute, fontSize: 13.5, textAlign: 'center', marginTop: 8 },
  progress: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  progressText: { color: colors.ink, fontSize: 14.5, fontWeight: '700' },
  reset: { color: colors.violetDeep, fontSize: 14.5, fontWeight: '700' },
  auto: { marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: colors.violetSoft },
  autoText: { color: colors.violetDeep, fontSize: 13.5, fontWeight: '600', textAlign: 'center' },
  go: { marginTop: 16 },
  privacy: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 12, lineHeight: 17 },
  gateTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  gateButton: { marginTop: 18 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.violetDeep, fontSize: 14, fontWeight: '700' },
  chipOn: { backgroundColor: colors.violet, color: '#fff' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46 },
  optionText: { color: colors.ink, fontSize: 15.5 },
  optionOn: { color: colors.violetDeep, fontWeight: '800' },
  done: { marginTop: 18 },
});
