import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

/** A slider you drag or tap: `value` between `min` and `max`, `onChange` with the new value (whole numbers by `step`). */
export function Slider({ value, min, max, step = 1, onChange, label, trackColor = colors.soft, fillColor = colors.violet }) {
  const [width, setWidth] = useState(0);
  const box = useRef({ width: 0, min, max, step, onChange });
  box.current = { width, min, max, step, onChange };

  const at = (x) => {
    const b = box.current;
    if (b.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, x / b.width));
    const raw = b.min + ratio * (b.max - b.min);
    b.onChange(Math.min(b.max, Math.max(b.min, Math.round(raw / b.step) * b.step)));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => at(e.nativeEvent.locationX),
      onPanResponderMove: (e) => at(e.nativeEvent.locationX),
    }),
  ).current;

  const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={styles.hit}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? step : -step))))}
    >
      <View style={[styles.track, { backgroundColor: trackColor }]} pointerEvents="none">
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: fillColor }]} />
      </View>
      <View style={[styles.thumb, { left: ratio * Math.max(0, width - 28) }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 44, justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  thumb: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', borderWidth: 3, borderColor: colors.violet },
});
