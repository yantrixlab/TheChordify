import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
const HOLD = 3000; // ms after a hand-scroll before playback pulls the strip, or the diagrams, back to the playing place
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

/**
 * The row of chord diagrams, the playing chord enlarged at the anchor. Only the diagrams in view are drawn, laid in a track that is
 * shifted so the playing one sits at the anchor: the highlight, the diagrams and the shift all change in the same draw, so the
 * highlighted card is never seen anywhere but the first position. It is drawn again only when the chord (or what the diagrams look
 * like) changes, not on every beat. While somebody looks around (`browse`), the track is anchored where they started and moved by
 * `shift` (their finger), and the diagrams drawn are the ones around where they have got to (`center`).
 */
const ChordRow = memo(function ChordRow({ sequence, current, browse, center, shift, instrument, transpose, capo, arrows, picks, width }) {
  const padLeft = Math.max(0, width * ANCHOR - ITEM / 2);
  const anchor = browse ? browse.frozen : current;
  const focus = browse ? center : current;
  const start = Math.max(0, focus - (browse ? 2 : 1)); // the one before shows at the edge
  const visible = focus + Math.ceil(width / ITEM) + 2;
  // The diagrams still to come are drawn a few at a time, off screen and between beats, so that a change of chord has nothing new to
  // draw (drawing one at the beat costs a slow phone about a frame).
  const [ready, setReady] = useState(0);
  const end = browse ? Math.min(sequence.length, visible + 2) : Math.min(sequence.length, Math.min(Math.max(ready, visible), visible + 8));
  useEffect(() => {
    if (browse || visible + 6 <= ready) return undefined;
    const id = setTimeout(() => setReady(visible + 6), 80);
    return () => clearTimeout(id);
  }, [browse, visible, ready]);
  const slots = [];
  for (let i = start; i < end; i++) {
    slots.push(
      <Slot key={i} raw={sequence[i].chord} transpose={transpose} capo={capo} instrument={instrument} picks={picks} arrows={arrows} on={i === current} scale={i === current ? 1.3 : 1.05} />,
    );
  }
  return (
    <View style={styles.row}>
      <View style={[styles.track, { transform: [{ translateX: padLeft + (start - anchor) * ITEM }] }]}>
        <Animated.View style={[styles.track, browse ? { transform: [{ translateX: shift }] } : null]}>{slots}</Animated.View>
      </View>
    </View>
  );
});

/**
 * The area above the strip: the chord row, centred up and down. It can be swiped to look at the chords to come (or the ones gone by);
 * the diagrams follow the finger and keep going a little when it lets go. A few seconds after the last touch the row glides back to the
 * playing chord, and from then on follows the song again.
 */
function ChordArea({ sequence, current, instrument, transpose, capo, arrows, picks, width }) {
  const last = sequence.length - 1;
  const drag = useRef(new Animated.Value(0)).current; // how far the row has been moved from where it was when the person started (px)
  const dragAt = useRef(0);
  const timer = useRef(null);
  const [browse, setBrowse] = useState(null); // null: following the song; { frozen } while somebody looks around (frozen: the chord that played then)
  const [center, setCenter] = useState(0); // the chord in the middle of what is being looked at
  const live = useRef({});
  live.current = { current, last, browse };

  useEffect(() => {
    const id = drag.addListener(({ value }) => {
      dragAt.current = value;
      const b = live.current.browse;
      if (b) setCenter(Math.min(live.current.last, Math.max(0, Math.round((b.frozen * ITEM - value) / ITEM))));
    });
    return () => drag.removeListener(id);
  }, [drag]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    // another song, or the chords were regrouped: back to following
    clearTimeout(timer.current);
    drag.stopAnimation();
    drag.setValue(0);
    setBrowse(null);
  }, [sequence, drag]);

  const goBack = useCallback(() => {
    const { current: now, browse: b } = live.current;
    if (!b) return;
    Animated.timing(drag, { toValue: (b.frozen - now) * ITEM, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (!finished) return;
      setBrowse(null);
      drag.setValue(0);
    });
  }, [drag]);
  const later = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(goBack, HOLD);
  }, [goBack]);

  const pan = useMemo(() => {
    let from = 0;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => live.current.last > 0 && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        clearTimeout(timer.current);
        drag.stopAnimation();
        if (!live.current.browse) {
          const b = { frozen: live.current.current };
          live.current.browse = b;
          drag.setValue(0);
          setCenter(b.frozen);
          setBrowse(b);
        }
        from = dragAt.current;
      },
      onPanResponderMove: (_, g) => {
        const { browse: b, last: end } = live.current;
        if (!b) return;
        drag.setValue(Math.min(b.frozen * ITEM, Math.max((b.frozen - end) * ITEM, from + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        Animated.decay(drag, { velocity: g.vx, deceleration: 0.996, useNativeDriver: false }).start();
        later();
      },
      onPanResponderTerminate: later,
    });
  }, [drag, later]);

  // Never farther than the first or the last chord, however far a fling carries.
  const shift = useMemo(() => {
    if (!browse || last <= 0) return drag;
    const lo = (browse.frozen - last) * ITEM;
    const hi = browse.frozen * ITEM;
    return drag.interpolate({ inputRange: [lo, hi], outputRange: [lo, hi], extrapolate: 'clamp' });
  }, [drag, browse, last]);

  return (
    <View style={styles.area} {...pan.panHandlers}>
      <ChordRow
        sequence={sequence}
        current={current}
        browse={browse}
        center={center}
        shift={shift}
        instrument={instrument}
        transpose={transpose}
        capo={capo}
        arrows={arrows}
        picks={picks}
        width={width}
      />
    </View>
  );
}

/** "Diagrams": a row of chord diagrams with the playing chord enlarged, over a strip of every beat of the song with the playing one
 *  marked. Both step straight to the playing place, with no animation, so they stay on the beat even on a slow phone; both can be swiped
 *  to look ahead, and both come back to the playing place by themselves. */
export function DiagramsView({ chart, active, instrument, transpose, capo, arrows, onSeek }) {
  const { width } = useWindowDimensions();
  const picks = usePicks();
  const { sequence, at } = useMemo(() => chordSequence(chart), [chart]);
  const current = active >= 0 ? at[active] : 0;
  return (
    <View style={styles.view}>
      <ChordArea sequence={sequence} current={current} instrument={instrument} transpose={transpose} capo={capo} arrows={arrows} picks={picks} width={width} />
      <BeatStrip chart={chart} active={active} transpose={transpose} onSeek={onSeek} />
    </View>
  );
}

const keyOf = (item) => String(item.i);

/** The cells in their list. Its props change only with the chart, the key or the lit cell, so a beat does not draw it again. */
const StripList = memo(function StripList({ listRef, items, markerX, width, size, lit, transpose, onPick, onDragStart, onDragEnd, onLayout }) {
  const renderItem = useCallback(
    ({ item }) => <StripCell t={item.t} label={item.raw ? labelOf(item.raw, transpose) : ''} bar={item.bar} on={item.i === lit} size={size} onSeek={onPick} />,
    [transpose, lit, size, onPick],
  );
  const getItemLayout = useCallback((_, index) => ({ length: items[index].length, offset: markerX + items[index].offset, index }), [items, markerX]);
  const content = useMemo(() => ({ paddingLeft: markerX, paddingRight: Math.max(0, width - markerX - size) }), [markerX, width, size]);
  return (
    <FlatList
      ref={listRef}
      horizontal
      data={items}
      keyExtractor={keyOf}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      extraData={`${lit}|${transpose}`}
      initialNumToRender={Math.ceil(width / size) + 2}
      windowSize={5}
      maxToRenderPerBatch={10}
      showsHorizontalScrollIndicator
      onLayout={onLayout}
      onScrollBeginDrag={onDragStart}
      onScrollEndDrag={onDragEnd}
      contentContainerStyle={content}
    />
  );
});

/** The dark square on the playing beat: it never moves, the strip steps beneath it. */
const Marker = memo(function Marker({ label, markerX, size }) {
  return (
    <View pointerEvents="none" style={[styles.marker, { left: markerX, top: PAD, width: size, height: size }]}>
      <Text style={[styles.beatChord, styles.beatTextOn, { fontSize: fontFor(label, size) }, label === 'rest' && styles.markerRest]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {label === 'rest' ? '𝄽' : label}
      </Text>
    </View>
  );
});

/**
 * The strip of beats under the diagrams: one square cell per beat of the whole song, a bar after a dark line. While the song plays the
 * playing beat stays at a fixed spot (under the dark marker) and the strip steps beneath it, in step with the diagram row; swipe it
 * to look ahead or back (the marker steps aside and the playing cell lights up where it is) and a tap on a cell jumps there.
 * Playback brings the strip back to the playing beat a moment after the hand lets go.
 * A beat changes only the marker and the strip's position: the list of cells is left alone.
 */
function BeatStrip({ chart, active, transpose, onSeek }) {
  const { width } = useWindowDimensions();
  const size = width >= 360 ? 44 : 38;
  const markerX = Math.round(width * ANCHOR - size / 2); // the playing cell's left edge, in line with the playing diagram
  const list = useRef(null);
  const busyUntil = useRef(0);
  const placed = useRef(-1);
  const placedFor = useRef(null);
  const placeAt = useRef(0);
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

  const marker = laid.items[current];
  placeAt.current = marker ? marker.at : 0;

  // Bring the playing beat to the marker, one beat at a time and with no glide (a glide costs a slow phone frames and lands late). Done
  // in the layout phase, so it goes out with the marker's new chord instead of a frame after it.
  useLayoutEffect(() => {
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
  const onDragStart = useCallback(() => {
    hold();
    setFree(true);
  }, [hold]);
  const pick = useCallback(
    (t) => {
      busyUntil.current = 0;
      onSeek(t);
    },
    [onSeek],
  );
  const onLayout = useCallback(() => {
    if (list.current) list.current.scrollToOffset({ offset: placeAt.current, animated: false }); // the first placing can come before the list has a size
  }, []);

  // Which cell is lit by itself: only while the strip is scrolled by hand (the marker lights the playing one otherwise).
  const lit = free ? active : -1;
  const markerLabel = marker && marker.raw ? labelOf(marker.raw, transpose) : '';
  return (
    <View style={{ height: size + PAD * 2, marginBottom: 8 }}>
      <StripList
        listRef={list}
        items={laid.items}
        markerX={markerX}
        width={width}
        size={size}
        lit={lit}
        transpose={transpose}
        onPick={pick}
        onDragStart={onDragStart}
        onDragEnd={hold}
        onLayout={onLayout}
      />
      {!free && marker ? <Marker label={markerLabel} markerX={markerX} size={size} /> : null}
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
  area: { flex: 1, justifyContent: 'center' },
  row: { flexGrow: 0, overflow: 'hidden', paddingVertical: 30 },
  track: { flexDirection: 'row', alignSelf: 'flex-start' },
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
