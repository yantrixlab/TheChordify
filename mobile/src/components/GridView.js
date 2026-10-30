import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { transposeChord } from '../lib/diagrams';
import { sectionColor, makeStyles, useColors } from '../theme';

const GAP = 4; // between two cells
const PAD = 12; // least room at each side of the grid
const MAX_CELL = 84;
const MIN_PAIR_CELL = 48; // two bars to a row only while the cells stay at least this big
const BAR_SEP = 14; // between the two bars of a row
const ROW_PAD = 4; // above and below a bar
const LABEL_H = 38;

/** Rows of the chart: a label row where a song part starts, then the bar. Heights are fixed so the list can jump to any bar. */
function layoutItems(chart, barH, pair) {
  const items = [];
  const barIndex = [];
  let offset = 0;
  const rows = chart.rows;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.label) {
      items.push({ type: 'label', key: `l${row.bar}`, label: row.label, h: LABEL_H, offset });
      offset += LABEL_H;
    }
    // Two bars to a row, but a bar that starts a new part of the song starts its own row (under its label).
    const next = pair && rows[i + 1] && !rows[i + 1].label ? rows[i + 1] : null;
    barIndex[row.bar] = items.length;
    if (next) barIndex[next.bar] = items.length;
    items.push({ type: 'bar', key: `b${row.bar}`, rows: next ? [row, next] : [row], h: barH, offset });
    offset += barH;
    if (next) i++;
  }
  return { items, barIndex };
}

const Cell = memo(function Cell({ chord, transpose, on, first, size }) {
  const styles = useStyles();
  const rest = chord === 'N';
  const name = chord && !rest ? transposeChord(chord, transpose) : chord;
  return (
    <View style={[styles.cell, { width: size, height: size }, first && styles.cellFirst, on && styles.cellOn]}>
      {chord ? (
        <Text style={[styles.cellChord, { fontSize: Math.round(size * 0.3) }, on && styles.cellChordOn, rest && styles.cellRest]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {rest ? '𝄽' : name}
        </Text>
      ) : (
        <Text style={[styles.cellDot, on && styles.cellChordOn]}>{on ? '•' : ''}</Text>
      )}
    </View>
  );
});

const Bar = memo(function Bar({ row, transpose, activeK, onSeek, size, second }) {
  const styles = useStyles();
  return (
    <View style={[styles.barCells, second && { marginLeft: BAR_SEP }]}>
      {row.chords.map((chord, k) => (
        <Pressable key={k} disabled={row.beats[k] === null} onPress={() => onSeek(row.beats[k])}>
          <Cell chord={chord} transpose={transpose} on={activeK === k} first={k === 0} size={size} />
        </Pressable>
      ))}
    </View>
  );
});

/**
 * "Grid": the whole chart, bar by bar, with the song's parts named. Every beat is a square cell (as wide as the bar allows, centred);
 * the playing beat is lit black and kept in view; a tap jumps to a beat.
 */
export function GridView({ chart, active, transpose, onSeek, bottomInset, width: given }) {
  const colors = useColors();
  const styles = useStyles();
  const screen = useWindowDimensions();
  const width = given || screen.width; // the width of the space it has (less than the screen when the phone is held across)
  const list = useRef(null);
  const lastRow = useRef(-1);
  const perBar = Math.max(1, chart.perBar);
  // Two bars to a row when the cells would still be big enough (a phone held across); one otherwise.
  const pairSize = Math.floor((width - PAD * 2 - GAP * 2 * (perBar - 1) - BAR_SEP) / (2 * perBar));
  const pair = pairSize >= MIN_PAIR_CELL;
  const barsAcross = pair ? 2 : 1;
  const size = pair
    ? Math.min(MAX_CELL, pairSize)
    : Math.max(24, Math.min(MAX_CELL, Math.floor((width - PAD * 2 - GAP * (perBar - 1)) / perBar)));
  const rowWidth = size * perBar * barsAcross + GAP * (perBar - 1) * barsAcross + (barsAcross - 1) * BAR_SEP;
  const sidePad = Math.max(PAD, Math.floor((width - rowWidth) / 2));
  const laid = useMemo(() => layoutItems(chart, size + ROW_PAD * 2, pair), [chart, size, pair]);
  const cell = active >= 0 ? chart.cells[active] : null;

  useEffect(() => {
    if (!cell || !list.current || cell.row === lastRow.current) return;
    lastRow.current = cell.row;
    list.current.scrollToIndex({ index: laid.barIndex[cell.row], viewPosition: 0.25, animated: false });
  }, [cell, laid]);

  const renderItem = useCallback(
    ({ item }) =>
      item.type === 'label' ? (
        <View style={[styles.label, { backgroundColor: sectionColor(item.label, colors) }]}>
          <Text style={styles.labelText}>{item.label}</Text>
        </View>
      ) : (
        <View style={styles.bar}>
          {item.rows.map((row, n) => (
            <Bar key={row.bar} row={row} transpose={transpose} activeK={cell && cell.row === row.bar ? cell.k : -1} onSeek={onSeek} size={size} second={n === 1} />
          ))}
        </View>
      ),
    [cell, transpose, onSeek, size, colors, styles],
  );

  return (
    <FlatList
      ref={list}
      data={laid.items}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      extraData={`${cell ? cell.row * 100 + cell.k : -1}|${transpose}|${size}|${pair}`}
      getItemLayout={(_, index) => ({ length: laid.items[index].h, offset: laid.items[index].offset, index })}
      initialNumToRender={14}
      maxToRenderPerBatch={10}
      windowSize={7}
      removeClippedSubviews
      onScrollToIndexFailed={() => {}}
      contentContainerStyle={{ paddingHorizontal: sidePad, paddingTop: 6, paddingBottom: bottomInset + 16 }}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  label: { height: LABEL_H - 8, marginTop: 8, borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12, alignSelf: 'flex-start' },
  labelText: { color: colors.onPart, fontSize: 13, fontWeight: '800' },
  bar: { flexDirection: 'row', paddingVertical: ROW_PAD },
  barCells: { flexDirection: 'row', gap: GAP },
  cell: { borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  cellFirst: { backgroundColor: colors.firstCell, borderColor: colors.firstCell },
  cellOn: { backgroundColor: colors.playing, borderColor: colors.playing },
  cellChord: { color: colors.ink, fontWeight: '800' },
  cellChordOn: { color: colors.onPlaying },
  cellRest: { color: colors.faint },
  cellDot: { color: colors.faint, fontSize: 18 },
}));
