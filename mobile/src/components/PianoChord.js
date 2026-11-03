import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { pianoLayout } from 'chordsuno-shared/pianoDiagram';
import { makeStyles, useColors } from '../theme';

const FIT = 150; // the widest a keyboard is drawn: a diagram's slot in the row is 176 wide, and a chord of three octaves shrinks to fit

/**
 * A piano chord: the name over a keyboard with the keys of the chord pressed (the root in the deeper colour, every pressed key named),
 * and what the way of playing is called. The keys come from the same layout as the website's, so both show the same thing.
 */
function PianoChord({ voicing, label, scale = 1, active = false }) {
  const colors = useColors();
  const styles = useStyles();
  const layout = useMemo(() => pianoLayout(voicing), [voicing]);
  const fit = Math.min(1, FIT / layout.width);
  return (
    <View style={[styles.card, active && styles.cardActive, { transform: [{ scale }] }]}>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {label}
      </Text>
      <Svg width={layout.width * fit} height={layout.height * fit} viewBox={`0 0 ${layout.width} ${layout.height}`}>
        {layout.keys.map((key, i) => {
          const fill = key.on ? (key.root ? colors.accentDeep : colors.accent) : key.black ? colors.diagramInk : '#FFFFFF';
          return (
            <Rect
              key={`k${i}`}
              x={key.x}
              y={key.y}
              width={key.w}
              height={key.h}
              rx={key.black ? 1.2 : 1.4}
              fill={fill}
              stroke={key.black ? colors.diagramInk : colors.diagramLine}
              strokeWidth={0.7}
            />
          );
        })}
        {layout.keys.map((key, i) =>
          key.on ? (
            <SvgText key={`t${i}`} x={key.x + key.w / 2} y={key.black ? key.h - 4 : key.h - 5} fontSize={key.black ? 5.2 : 6.4} fontWeight="800" fill="#FFFFFF" textAnchor="middle">
              {key.label}
            </SvgText>
          ) : null,
        )}
      </Svg>
      <Text style={styles.how} numberOfLines={1}>
        {voicing.name}
      </Text>
    </View>
  );
}

export default memo(PianoChord, (a, b) => a.voicing === b.voicing && a.label === b.label && a.scale === b.scale && a.active === b.active);

const useStyles = makeStyles((colors) => ({
  card: { alignItems: 'center', paddingTop: 8, paddingBottom: 4, paddingHorizontal: 4, borderRadius: 14, backgroundColor: colors.diagramCard, borderWidth: 2, borderColor: 'transparent' },
  cardActive: { borderColor: colors.accent },
  label: { color: colors.diagramInk, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  labelActive: { color: colors.accentDeep },
  how: { marginTop: 6, color: colors.diagramMute, fontSize: 11, fontWeight: '600' },
}));
