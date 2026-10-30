import { memo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { makeStyles, useColors } from '../theme';

const W = 90; // width of the string area
const GRID_H = 100; // height of the four fret rows
const ROWS = 4;
const LEFT = 22; // room for the fret numbers
const TOP = 20; // room for the open / muted marks

const BOARD_W = LEFT + W + 14;
const BOARD_H = TOP + GRID_H + 6;
const colXFor = (strings, i) => LEFT + (W * i) / (strings - 1);
const rowY = (r) => TOP + (GRID_H * r) / ROWS;

/**
 * The drawing itself: strings, four fret rows, finger dots, a bar for a barre, × for a muted string and ○ for an open one, and the fret
 * number where a shape sits up the neck. `shape` is { frets, fingers, baseFret }. It depends on the shape alone, so lighting or
 * enlarging a card (which only changes the card around it) does not draw it again.
 */
const Board = memo(function Board({ shape }) {
  const colors = useColors();
  const strings = shape.frets.length;
  const colX = (i) => colXFor(strings, i);
  const baseFret = shape.baseFret || 1;
  const marks = [];
  const dots = [];
  shape.frets.forEach((fret, i) => {
    if (fret === 'x') {
      const x = colX(i);
      marks.push(<Line key={`x${i}a`} x1={x - 4} y1={6} x2={x + 4} y2={14} stroke={colors.danger} strokeWidth={1.8} strokeLinecap="round" />);
      marks.push(<Line key={`x${i}b`} x1={x + 4} y1={6} x2={x - 4} y2={14} stroke={colors.danger} strokeWidth={1.8} strokeLinecap="round" />);
    } else if (fret === '0') {
      marks.push(<Circle key={`o${i}`} cx={colX(i)} cy={10} r={4.5} stroke={colors.diagramInk} strokeWidth={1.5} fill="none" />);
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
      dots.push(<Rect key={`b${key}`} x={a - 9} y={cy - 9} width={b - a + 18} height={18} rx={9} fill={colors.dot} />);
      [a, b].forEach((x, n) => dots.push(<SvgText key={`bf${key}${n}`} x={x} y={cy + 3.6} fontSize={10} fontWeight="700" fill={colors.onDot} textAnchor="middle">{group[0].finger}</SvgText>));
    } else {
      group.forEach((p) => {
        dots.push(<Circle key={`d${key}${p.string}`} cx={colX(p.string)} cy={cy} r={9} fill={colors.dot} />);
        if (p.finger) dots.push(<SvgText key={`df${key}${p.string}`} x={colX(p.string)} y={cy + 3.6} fontSize={10} fontWeight="700" fill={colors.onDot} textAnchor="middle">{p.finger}</SvgText>);
      });
    }
  });

  return (
    <Svg width={BOARD_W} height={BOARD_H} viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}>
      {marks}
      <Rect x={LEFT} y={TOP} width={W} height={baseFret === 1 ? 3 : 1} fill={colors.diagramInk} />
      {Array.from({ length: strings }, (_, i) => (
        <Line key={`s${i}`} x1={colX(i)} y1={TOP} x2={colX(i)} y2={TOP + GRID_H} stroke={colors.diagramLine} strokeWidth={1.2} />
      ))}
      {Array.from({ length: ROWS }, (_, r) => (
        <Line key={`f${r}`} x1={LEFT} y1={rowY(r + 1)} x2={LEFT + W} y2={rowY(r + 1)} stroke={colors.diagramLine} strokeWidth={1} />
      ))}
      {baseFret > 1 ? (
        <SvgText x={LEFT - 5} y={rowY(1) - GRID_H / ROWS / 2 + 4.5} fontSize={13} fontWeight="800" fill={colors.accentDeep} textAnchor="end">
          {baseFret}
        </SvgText>
      ) : null}
      {dots}
    </Svg>
  );
});

/** A card: the chord's name over its drawing. The card (frame, size, colour of the name) changes when the chord is played; the drawing does not. */
function ChordDiagram({ shape, label, notes, scale = 1, active = false }) {
  const styles = useStyles();
  const width = BOARD_W;
  const height = BOARD_H;
  return (
    <View style={[styles.card, active && styles.cardActive, { transform: [{ scale }] }]}>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {label}
      </Text>
      {shape ? (
        <Board shape={shape} />
      ) : (
        <View style={[styles.none, { width, height }]}>
          <Text style={styles.noneText}>{notes && notes.length ? notes.join('  ') : '—'}</Text>
        </View>
      )}
    </View>
  );
}

export default memo(ChordDiagram, (a, b) => a.shape === b.shape && a.label === b.label && a.scale === b.scale && a.active === b.active && a.notes === b.notes);

export const DIAGRAM_WIDTH = LEFT + W + 14;

const useStyles = makeStyles((colors) => ({
  card: { alignItems: 'center', paddingTop: 8, paddingBottom: 4, paddingHorizontal: 4, borderRadius: 14, backgroundColor: colors.diagramCard, borderWidth: 2, borderColor: 'transparent' },
  cardActive: { borderColor: colors.accent },
  label: { color: colors.diagramInk, fontSize: 17, fontWeight: '800' },
  labelActive: { color: colors.accentDeep },
  none: { alignItems: 'center', justifyContent: 'center' },
  noneText: { color: colors.diagramMute, fontSize: 18, fontWeight: '700' },
}));
