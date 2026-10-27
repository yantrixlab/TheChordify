import { memo, useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import ChordDiagram from './ChordDiagram';
import { chordSequence, chordsUsed, shapeFor } from '../lib/diagrams';
import { colors } from '../theme';

const ITEM = 144; // room for one diagram in the sliding row
const ANCHOR = 0.3; // where the playing chord sits across the row
const BEATS = 8; // beats in the strip
const SUMMARY_COLUMNS = 3;

const Beat = memo(function Beat({ chord, number, bar, on, width }) {
  return (
    <View style={[styles.beat, { width }, bar && styles.beatBar, on && styles.beatOn]}>
      <Text style={[styles.beatNumber, on && styles.beatTextOn]}>{number}</Text>
      <Text style={[styles.beatChord, on && styles.beatTextOn, chord === 'N' && styles.beatRest]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {chord === 'N' ? '𝄽' : chord || ''}
      </Text>
    </View>
  );
});

const Slot = memo(function Slot({ chord, instrument, on }) {
  return (
    <View style={styles.slot}>
      <ChordDiagram shape={shapeFor(instrument, chord)} label={chord === 'N' ? 'rest' : chord} scale={on ? 1.08 : 0.88} active={on} />
    </View>
  );
});

/**
 * "Chord diagrams": a strip of the next beats with the playing one lit, over a row of chord diagrams that slides one chord at
 * a time with the playing chord enlarged, then every chord of the song with its diagram. Only transforms and a colour change
 * move per beat, so it is light on a slow phone.
 */
export default function DiagramsPanel({ chart, active, instrument, onSeek, bottomInset }) {
  const { width } = useWindowDimensions();
  const row = useRef(null);
  const { sequence, at } = useMemo(() => chordSequence(chart), [chart]);
  const used = useMemo(() => chordsUsed(sequence), [sequence]);
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
    beats.push(
      <Beat key={index} chord={chart.rows[cell.row].chords[cell.k]} number={cell.k + 1} bar={cell.k === 0} on={index === active} width={beatWidth} />,
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.strip}>{beats}</View>
      <FlatList
        ref={row}
        horizontal
        data={sequence}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) => <Slot chord={item.chord} instrument={instrument} on={index === current} />}
        getItemLayout={(_, index) => ({ length: ITEM, offset: padLeft + ITEM * index, index })}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={6}
        windowSize={5}
        maxToRenderPerBatch={4}
        scrollEnabled={false}
        contentContainerStyle={{ paddingLeft: padLeft, paddingRight: width, paddingVertical: 12 }}
        style={styles.row}
        extraData={`${current}${instrument}`}
      />
      <FlatList
        data={used}
        keyExtractor={(item) => item.chord}
        numColumns={SUMMARY_COLUMNS}
        ListHeaderComponent={<Text style={styles.summaryTitle}>Chords in this song</Text>}
        renderItem={({ item }) => (
          <View style={styles.summaryCell}>
            <ChordDiagram shape={shapeFor(instrument, item.chord)} label={item.chord} scale={0.85} />
          </View>
        )}
        initialNumToRender={6}
        windowSize={5}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: bottomInset + 24 }}
        extraData={instrument}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  strip: { flexDirection: 'row', paddingHorizontal: 12, height: 62, marginBottom: 4 },
  beat: { height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderLeftWidth: 1, borderLeftColor: 'transparent' },
  beatBar: { borderLeftColor: '#ffffff40', backgroundColor: '#ffffff0a' },
  beatOn: { backgroundColor: colors.violet, borderLeftColor: 'transparent' },
  beatNumber: { color: colors.faint, fontSize: 11, fontWeight: '700' },
  beatChord: { color: colors.text, fontSize: 18, fontWeight: '800', maxWidth: '100%' },
  beatTextOn: { color: '#fff' },
  beatRest: { color: colors.faint },
  row: { flexGrow: 0, height: 236 },
  slot: { width: ITEM, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { color: colors.text, fontSize: 17, fontWeight: '800', paddingHorizontal: 8, marginTop: 6, marginBottom: 10 },
  summaryCell: { flex: 1 / SUMMARY_COLUMNS, alignItems: 'center', marginBottom: 6 },
});
