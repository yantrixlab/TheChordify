import { memo, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { chordNotes } from 'chordsuno-shared/chordShapes';
import ChordDiagram from './ChordDiagram';
import { Icon } from './Icons';
import { choiceFor, chordSequence, chordsUsed, stepPick, transposeChord, usePicks } from '../lib/diagrams';
import { colors } from '../theme';

const ITEM = 176; // room for one diagram in the sliding row
const ANCHOR = 0.3; // where the playing chord sits across the row
const BEATS = 8; // beats in the strip
const SUMMARY_COLUMNS = 2;

const labelOf = (raw, transpose) => (raw === 'N' ? 'rest' : transposeChord(raw, transpose));

/** One diagram with the arrows that change which way of playing the chord is shown (when the plan has that). */
const Slot = memo(function Slot({ raw, transpose, capo, instrument, picks, arrows, on, scale }) {
  const fingered = raw === 'N' ? 'N' : transposeChord(raw, transpose - capo); // the shape to finger: Transpose, undone by Capo
  const choice = choiceFor(instrument, fingered, picks);
  const label = labelOf(raw, transpose);
  const notes = useMemo(() => (raw === 'N' ? [] : chordNotes(transposeChord(raw, transpose))), [raw, transpose]);
  return (
    <View style={styles.slot}>
      <View style={on ? styles.liftOn : styles.lift}>
        <ChordDiagram shape={choice ? choice.shape : null} label={label} notes={notes} scale={scale} active={on} />
      </View>
      {arrows && choice && choice.count > 1 ? (
        <View style={styles.arrows}>
          <Pressable onPress={() => stepPick(instrument, fingered, -1)} hitSlop={10} style={styles.arrow} accessibilityRole="button" accessibilityLabel={`Previous way to play ${label}`}>
            <Icon name="back" size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.arrowCount}>
            {choice.index + 1}/{choice.count}
          </Text>
          <Pressable onPress={() => stepPick(instrument, fingered, 1)} hitSlop={10} style={styles.arrow} accessibilityRole="button" accessibilityLabel={`Next way to play ${label}`}>
            <Icon name="forward" size={22} color={colors.ink} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.arrows} />
      )}
    </View>
  );
});

const Beat = memo(function Beat({ label, number, bar, on, width }) {
  return (
    <View style={[styles.beat, { width }, bar && styles.beatBar, on && styles.beatOn]}>
      <Text style={[styles.beatNumber, on && styles.beatTextOn]}>{number}</Text>
      <Text style={[styles.beatChord, on && styles.beatTextOn, label === 'rest' && styles.beatRest]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {label === 'rest' ? '𝄽' : label}
      </Text>
    </View>
  );
});

/** "Diagrams": a strip of the next beats with the playing one lit, over a row of chord diagrams that slides one chord at a time
 *  with the playing chord enlarged. Only transforms and a colour change move per beat, so it is light on a slow phone. */
export function DiagramsView({ chart, active, instrument, transpose, capo, arrows }) {
  const { width } = useWindowDimensions();
  const row = useRef(null);
  const picks = usePicks();
  const { sequence, at } = useMemo(() => chordSequence(chart), [chart]);
  const current = active >= 0 ? at[active] : 0;
  const padLeft = Math.max(0, width * ANCHOR - ITEM / 2);

  // Slide the row so the playing chord stays at the anchor.
  useEffect(() => {
    if (row.current) row.current.scrollToOffset({ offset: current * ITEM, animated: true });
  }, [current]);

  const first = (active < 0 ? 0 : active) - 1;
  const beatWidth = (width - 24) / BEATS;
  const beats = [];
  for (let j = 0; j < BEATS; j++) {
    const index = first + j;
    const cell = chart.cells[index];
    if (!cell) {
      beats.push(<View key={`e${j}`} style={{ width: beatWidth }} />);
      continue;
    }
    const raw = chart.rows[cell.row].chords[cell.k];
    beats.push(<Beat key={index} label={raw ? labelOf(raw, transpose) : ''} number={cell.k + 1} bar={cell.k === 0} on={index === active} width={beatWidth} />);
  }

  return (
    <View style={styles.view}>
      <FlatList
        ref={row}
        horizontal
        data={sequence}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) => (
          <Slot raw={item.chord} transpose={transpose} capo={capo} instrument={instrument} picks={picks} arrows={arrows} on={index === current} scale={index === current ? 1.3 : 1.05} />
        )}
        getItemLayout={(_, index) => ({ length: ITEM, offset: padLeft + ITEM * index, index })}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={5}
        windowSize={5}
        maxToRenderPerBatch={4}
        scrollEnabled={false}
        contentContainerStyle={{ paddingLeft: padLeft, paddingRight: width, paddingTop: 40, paddingBottom: 10 }}
        style={styles.row}
        extraData={`${current}|${instrument}|${transpose}|${capo}|${arrows}|${JSON.stringify(picks)}`}
      />
      <View style={styles.strip}>{beats}</View>
    </View>
  );
}

/** "Summary": every chord of the song with its diagram, most used first. */
export function SummaryView({ chart, instrument, transpose, capo, arrows, bottomInset }) {
  const picks = usePicks();
  const used = useMemo(() => chordsUsed(chordSequence(chart).sequence), [chart]);
  return (
    <FlatList
      data={used}
      keyExtractor={(item) => item.chord}
      numColumns={SUMMARY_COLUMNS}
      key={SUMMARY_COLUMNS}
      renderItem={({ item }) => (
        <View style={styles.summaryCell}>
          <Slot raw={item.chord} transpose={transpose} capo={capo} instrument={instrument} picks={picks} arrows={arrows} scale={1} />
        </View>
      )}
      initialNumToRender={6}
      windowSize={5}
      contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 16, paddingBottom: bottomInset + 16 }}
      extraData={`${instrument}|${transpose}|${capo}|${arrows}|${JSON.stringify(picks)}`}
    />
  );
}

const styles = StyleSheet.create({
  view: { flex: 1, justifyContent: 'space-between' },
  row: { flexGrow: 0 },
  slot: { width: ITEM, alignItems: 'center' },
  lift: { marginBottom: 12 },
  liftOn: { marginBottom: 44 }, // the playing card is drawn bigger than its box: room for the arrows below it
  arrows: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 40, gap: 14, marginTop: 6 },
  arrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  arrowCount: { color: colors.mute, fontSize: 13, fontWeight: '700', minWidth: 34, textAlign: 'center' },
  strip: { flexDirection: 'row', paddingHorizontal: 12, height: 66, marginBottom: 8 },
  beat: { height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  beatBar: { borderLeftColor: colors.faint, borderRadius: 0 },
  beatOn: { backgroundColor: colors.ink },
  beatNumber: { color: colors.faint, fontSize: 11, fontWeight: '700' },
  beatChord: { color: colors.ink, fontSize: 19, fontWeight: '800', maxWidth: '100%' },
  beatTextOn: { color: '#fff' },
  beatRest: { color: colors.faint },
  summaryCell: { flex: 1 / SUMMARY_COLUMNS, alignItems: 'center', marginBottom: 12 },
});
