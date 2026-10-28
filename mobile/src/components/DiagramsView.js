import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { chordNotes } from 'chordsuno-shared/chordShapes';
import ChordDiagram from './ChordDiagram';
import { Icon } from './Icons';
import { choiceFor, chordSequence, chordsUsed, stepPick, transposeChord, usePicks } from '../lib/diagrams';
import { colors } from '../theme';

const ITEM = 176; // room for one diagram in the sliding row
const ANCHOR = 0.3; // where the playing chord sits across the row
const GAP = 4; // between two beat cells
const BAR_GAP = 9; // the extra room (and the dark line) where a bar starts
const PAD = 7; // above and below the cells
const HOLD = 3000; // ms after a hand-scroll before playback pulls the strip back to the playing beat
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

const fontFor = (label, size) => {
  const n = label.length;
  return ((n <= 2 ? 18 : n === 3 ? 15 : n === 4 ? 13 : 11) * size) / 44;
};

/** One beat: a square cell with its own outline (the chord written there, if any); a bar starts after a wider gap marked by a dark line. */
const StripCell = memo(function StripCell({ t, label, bar, on, size, onSeek }) {
  const rest = label === 'rest';
  return (
    <View style={{ width: size + GAP + (bar ? BAR_GAP : 0), height: size + PAD * 2 }}>
      {bar ? <View style={styles.barLine} /> : null}
      <Pressable
        onPress={() => onSeek(t)}
        style={[styles.beat, { width: size, height: size, marginTop: PAD, marginLeft: bar ? BAR_GAP : 0 }, label ? styles.beatHas : null, on && styles.beatOn]}
        accessibilityRole="button"
        accessibilityLabel={label ? `Go to ${rest ? 'the rest' : label}` : 'Go to this beat'}
      >
        <Text
          style={[styles.beatChord, { fontSize: fontFor(label, size) }, on && styles.beatTextOn, rest && styles.beatRest]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {rest ? '𝄽' : label}
        </Text>
      </Pressable>
    </View>
  );
});

/** The row of chord diagrams, the playing chord enlarged at the anchor. It is drawn again only when the chord (or what the diagrams
 *  look like) changes, not on every beat. */
const ChordRow = memo(function ChordRow({ sequence, current, instrument, transpose, capo, arrows, picks, width }) {
  const row = useRef(null);
  const padLeft = Math.max(0, width * ANCHOR - ITEM / 2);

  // Put the row where the playing chord is at the anchor. Straight there, with no slide: a slide costs a slow phone frames and makes the
  // change land after the beat it belongs to.
  useEffect(() => {
    if (row.current) row.current.scrollToOffset({ offset: current * ITEM, animated: false });
  }, [current]);

  return (
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
  );
});

/** "Diagrams": a row of chord diagrams with the playing chord enlarged, over a strip of every beat of the song with the playing one
 *  marked. Both step straight to the playing place, with no animation, so they stay on the beat even on a slow phone. */
export function DiagramsView({ chart, active, instrument, transpose, capo, arrows, onSeek }) {
  const { width } = useWindowDimensions();
  const picks = usePicks();
  const { sequence, at } = useMemo(() => chordSequence(chart), [chart]);
  const current = active >= 0 ? at[active] : 0;
  return (
    <View style={styles.view}>
      <ChordRow sequence={sequence} current={current} instrument={instrument} transpose={transpose} capo={capo} arrows={arrows} picks={picks} width={width} />
      <BeatStrip chart={chart} active={active} transpose={transpose} onSeek={onSeek} />
    </View>
  );
}

/**
 * The strip of beats under the diagrams: one square cell per beat of the whole song, a bar after a dark line. While the song plays the
 * playing beat stays at a fixed spot (under the dark marker) and the strip steps beneath it, in step with the diagram row; swipe it
 * to look ahead or back (the marker steps aside and the playing cell lights up where it is) and a tap on a cell jumps there.
 * Playback brings the strip back to the playing beat a moment after the hand lets go.
 */
function BeatStrip({ chart, active, transpose, onSeek }) {
  const { width } = useWindowDimensions();
  const size = width >= 360 ? 44 : 38;
  const markerX = Math.round(width * ANCHOR - size / 2); // the playing cell's left edge, in line with the playing diagram
  const list = useRef(null);
  const busyUntil = useRef(0);
  const placed = useRef(-1);
  const placedFor = useRef(null);
  const [free, setFree] = useState(false);
  const current = active >= 0 ? active : 0;

  // Where every cell starts along the strip, and the cell itself: laid out up front so the list can jump to any beat.
  const laid = useMemo(() => {
    let offset = 0;
    const items = chart.cells.map((cell, i) => {
      const bar = cell.k === 0;
      const length = size + GAP + (bar ? BAR_GAP : 0);
      const item = { i, t: cell.t, raw: chart.rows[cell.row].chords[cell.k], bar, offset, length, at: offset + (bar ? BAR_GAP : 0) };
      offset += length;
      return item;
    });
    return { items, total: offset };
  }, [chart, size]);

  // Bring the playing beat to the marker, one beat at a time and with no glide (a glide costs a slow phone frames and lands late).
  useEffect(() => {
    const item = laid.items[current];
    if (!list.current || !item) return;
    const far = placedFor.current !== laid || Math.abs(current - placed.current) > 2; // a new chart, or a jump
    placedFor.current = laid;
    placed.current = current;
    if (!far && Date.now() < busyUntil.current) return; // being scrolled by hand
    setFree(false);
    list.current.scrollToOffset({ offset: item.at, animated: false });
  }, [current, laid]);

  const hold = useCallback(() => {
    busyUntil.current = Date.now() + HOLD;
  }, []);
  const pick = useCallback(
    (t) => {
      busyUntil.current = 0;
      onSeek(t);
    },
    [onSeek],
  );
  // Which cell is lit by itself: only while the strip is scrolled by hand (the marker lights the playing one otherwise). Keeping this
  // fixed while playing means a beat does not re-draw the cells.
  const lit = free ? active : -1;
  const renderItem = useCallback(
    ({ item }) => {
      const raw = item.raw;
      return <StripCell t={item.t} label={raw ? labelOf(raw, transpose) : ''} bar={item.bar} on={item.i === lit} size={size} onSeek={pick} />;
    },
    [transpose, lit, size, pick],
  );

  const marker = laid.items[current];
  const markerLabel = marker && marker.raw ? labelOf(marker.raw, transpose) : '';
  return (
    <View style={{ height: size + PAD * 2, marginBottom: 8 }}>
      <FlatList
        ref={list}
        horizontal
        data={laid.items}
        keyExtractor={(item) => String(item.i)}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: laid.items[index].length, offset: markerX + laid.items[index].offset, index })}
        extraData={`${lit}|${transpose}`}
        initialNumToRender={Math.ceil(width / size) + 2}
        windowSize={11}
        maxToRenderPerBatch={12}
        showsHorizontalScrollIndicator
        onLayout={() => {
          const item = laid.items[current];
          if (list.current && item) list.current.scrollToOffset({ offset: item.at, animated: false }); // the first placing can come before the list has a size
        }}
        onScrollBeginDrag={() => {
          hold();
          setFree(true);
        }}
        onScrollEndDrag={hold}
        contentContainerStyle={{ paddingLeft: markerX, paddingRight: Math.max(0, width - markerX - size) }}
      />
      {!free && marker ? (
        <View pointerEvents="none" style={[styles.marker, { left: markerX, top: PAD, width: size, height: size }]}>
          <Text style={[styles.beatChord, styles.beatTextOn, { fontSize: fontFor(markerLabel, size) }, markerLabel === 'rest' && styles.markerRest]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {markerLabel === 'rest' ? '𝄽' : markerLabel}
          </Text>
        </View>
      ) : null}
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
  barLine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: 2, backgroundColor: colors.ink },
  beat: { alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1.5, borderColor: '#d9cdf0', backgroundColor: '#f6f2ff', paddingHorizontal: 1 },
  beatHas: { backgroundColor: '#fff', borderColor: '#bda9ea' },
  beatOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  beatChord: { color: colors.ink, fontWeight: '700', maxWidth: '100%', includeFontPadding: false },
  beatTextOn: { color: '#fff' },
  beatRest: { color: colors.mute, fontWeight: '400' },
  marker: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.ink, paddingHorizontal: 1, elevation: 6 },
  markerRest: { fontWeight: '400' },
  summaryCell: { flex: 1 / SUMMARY_COLUMNS, alignItems: 'center', marginBottom: 12 },
});
