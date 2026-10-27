import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';

const W = 90; // width of the string area
const GRID_H = 100; // height of the four fret rows
const ROWS = 4;
const LEFT = 22; // room for the fret numbers
const TOP = 20; // room for the open / muted marks
const INK = '#1a0533';
const LINE = '#c9bfe0';

/**
 * A fretboard diagram drawn the way the website draws it: strings, four fret rows, finger dots, a bar for a barre, × for a muted
 * string and ○ for an open one, and the fret number where a shape sits up the neck. `shape` is { frets, fingers, baseFret }.
 * It is memoised, so only the diagrams whose chord changed are ever drawn again.
 */
function ChordDiagram({ shape, label, scale = 1, active = false }) {
  const strings = shape ? shape.frets.length : 6;
  const colX = (i) => LEFT + (W * i) / (strings - 1);
  const rowY = (r) => TOP + (GRID_H * r) / ROWS;
  const width = LEFT + W + 14;
  const height = TOP + GRID_H + 6;
  const baseFret = (shape && shape.baseFret) || 1;

  const marks = [];
  const dots = [];
  if (shape) {
    shape.frets.forEach((fret, i) => {
      if (fret === 'x') {
        const x = colX(i);
        marks.push(<Line key={`x${i}a`} x1={x - 4} y1={6} x2={x + 4} y2={14} stroke="#dc2626" strokeWidth={1.8} strokeLinecap="round" />);
        marks.push(<Line key={`x${i}b`} x1={x + 4} y1={6} x2={x - 4} y2={14} stroke="#dc2626" strokeWidth={1.8} strokeLinecap="round" />);
      } else if (fret === '0') {
        marks.push(<Circle key={`o${i}`} cx={colX(i)} cy={10} r={4.5} stroke={INK} strokeWidth={1.5} fill="none" />);
      }
    });

    // Fingers on the same fret row with the same finger are one barre: a bar across them, not separate dots.
    const groups = new Map();
    shape.frets.forEach((fret, i) => {
      if (fret === 'x' || fret === '0') return;
      const row = parseInt(fret, 10) - baseFret + 1;
      if (row < 1 || row > ROWS) return;
      const finger = shape.fingers[i] || '';
      const key = `${row}-${finger}`;
      const group = groups.get(key) || [];
      group.push({ string: i, row, finger });
      groups.set(key, group);
    });
    groups.forEach((group, key) => {
      const cy = rowY(group[0].row) - GRID_H / ROWS / 2;
      if (group.length >= 2 && group[0].finger) {
        const a = colX(Math.min(...group.map((p) => p.string)));
        const b = colX(Math.max(...group.map((p) => p.string)));
        dots.push(<Rect key={`b${key}`} x={a - 9} y={cy - 9} width={b - a + 18} height={18} rx={9} fill={INK} />);
        [a, b].forEach((x, n) => dots.push(<SvgText key={`bf${key}${n}`} x={x} y={cy + 3.6} fontSize={10} fontWeight="700" fill="#fff" textAnchor="middle">{group[0].finger}</SvgText>));
      } else {
        group.forEach((p) => {
          dots.push(<Circle key={`d${key}${p.string}`} cx={colX(p.string)} cy={cy} r={9} fill={INK} />);
          if (p.finger) dots.push(<SvgText key={`df${key}${p.string}`} x={colX(p.string)} y={cy + 3.6} fontSize={10} fontWeight="700" fill="#fff" textAnchor="middle">{p.finger}</SvgText>);
        });
      }
    });
  }

  return (
    <View style={[styles.card, active && styles.cardActive, { transform: [{ scale }] }]}>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {label}
      </Text>
      {shape ? (
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {marks}
          <Rect x={LEFT} y={TOP} width={W} height={baseFret === 1 ? 3 : 1} fill={INK} />
          {Array.from({ length: strings }, (_, i) => (
            <Line key={`s${i}`} x1={colX(i)} y1={TOP} x2={colX(i)} y2={TOP + GRID_H} stroke={LINE} strokeWidth={1.2} />
          ))}
          {Array.from({ length: ROWS }, (_, r) => (
            <Line key={`f${r}`} x1={LEFT} y1={rowY(r + 1)} x2={LEFT + W} y2={rowY(r + 1)} stroke={LINE} strokeWidth={1} />
          ))}
          {baseFret > 1 ? (
            <SvgText x={LEFT - 5} y={rowY(1) - GRID_H / ROWS / 2 + 4.5} fontSize={13} fontWeight="800" fill={colors.violetDeep} textAnchor="end">
              {baseFret}
            </SvgText>
          ) : null}
          {dots}
        </Svg>
      ) : (
        <View style={[styles.none, { width, height }]}>
          <Text style={styles.noneText}>no shape</Text>
        </View>
      )}
    </View>
  );
}

export default memo(ChordDiagram, (a, b) => a.shape === b.shape && a.label === b.label && a.scale === b.scale && a.active === b.active);

export const DIAGRAM_WIDTH = LEFT + W + 14;

const styles = StyleSheet.create({
  card: { alignItems: 'center', paddingTop: 8, paddingBottom: 4, paddingHorizontal: 4, borderRadius: 14, backgroundColor: '#f6f2ff', borderWidth: 2, borderColor: 'transparent' },
  cardActive: { borderColor: colors.violet },
  label: { color: INK, fontSize: 17, fontWeight: '800' },
  labelActive: { color: colors.violetDeep },
  none: { alignItems: 'center', justifyContent: 'center' },
  noneText: { color: '#8b7fa8', fontSize: 12 },
});
