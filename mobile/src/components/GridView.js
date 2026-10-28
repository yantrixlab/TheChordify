import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { transposeChord } from '../lib/diagrams';
import { colors, sectionColor } from '../theme';

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

const Cell = memo(function Cell({ chord, transpose, on, first }) {
  const rest = chord === 'N';
  const name = chord && !rest ? transposeChord(chord, transpose) : chord;
  return (
    <View style={[styles.cell, first && styles.cellFirst, on && styles.cellOn]}>
      {chord ? (
        <Text style={[styles.cellChord, on && styles.cellChordOn, rest && styles.cellRest]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {rest ? '𝄽' : name}
        </Text>
      ) : (
        <Text style={[styles.cellDot, on && styles.cellChordOn]}>{on ? '•' : ''}</Text>
      )}
    </View>
  );
});

const BarRow = memo(function BarRow({ row, transpose, activeK, onSeek }) {
  return (
    <View style={styles.bar}>
      {row.chords.map((chord, k) => (
        <Pressable key={k} style={styles.cellWrap} disabled={row.beats[k] === null} onPress={() => onSeek(row.beats[k])}>
          <Cell chord={chord} transpose={transpose} on={activeK === k} first={k === 0} />
        </Pressable>
      ))}
    </View>
  );
});

/** "Grid": the whole chart, bar by bar, with the song's parts named. The playing beat is lit and kept in view; a tap jumps to a beat. */
export function GridView({ chart, active, transpose, onSeek, bottomInset }) {
  const list = useRef(null);
  const lastRow = useRef(-1);
  const laid = useMemo(() => layoutItems(chart), [chart]);
  const cell = active >= 0 ? chart.cells[active] : null;

  useEffect(() => {
    if (!cell || !list.current || cell.row === lastRow.current) return;
    lastRow.current = cell.row;
    list.current.scrollToIndex({ index: laid.barIndex[cell.row], viewPosition: 0.25, animated: false });
  }, [cell, laid]);

  const renderItem = useCallback(
    ({ item }) =>
      item.type === 'label' ? (
        <View style={[styles.label, { backgroundColor: sectionColor(item.label) }]}>
          <Text style={styles.labelText}>{item.label}</Text>
        </View>
      ) : (
        <BarRow row={item.row} transpose={transpose} activeK={cell && cell.row === item.row.bar ? cell.k : -1} onSeek={onSeek} />
      ),
    [cell, transpose, onSeek],
  );

  return (
    <FlatList
      ref={list}
      data={laid.items}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      extraData={`${cell ? cell.row * 100 + cell.k : -1}|${transpose}`}
      getItemLayout={(_, index) => ({ length: laid.items[index].h, offset: laid.items[index].offset, index })}
      initialNumToRender={14}
      maxToRenderPerBatch={10}
      windowSize={7}
      removeClippedSubviews
      onScrollToIndexFailed={() => {}}
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: bottomInset + 16 }}
    />
  );
}

const styles = StyleSheet.create({
  label: { height: LABEL_H - 8, marginTop: 8, borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12, alignSelf: 'flex-start' },
  labelText: { color: '#1a0533', fontSize: 13, fontWeight: '800' },
  bar: { height: BAR_H, flexDirection: 'row', paddingVertical: 4, gap: 4 },
  cellWrap: { flex: 1 },
  cell: { flex: 1, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  cellFirst: { backgroundColor: colors.violetSoft, borderColor: colors.violetSoft },
  cellOn: { backgroundColor: colors.violet, borderColor: colors.violet },
  cellChord: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  cellChordOn: { color: '#fff' },
  cellRest: { color: colors.faint },
  cellDot: { color: colors.faint, fontSize: 18 },
});
