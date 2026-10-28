import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import InstrumentArt from './InstrumentArt';
import { Icon } from './Icons';
import { Button } from './Ui';
import { colors, radius } from '../theme';

const OPEN_MS = 210; // quick: it is a switch, not a scene
const CLOSE_MS = 160;

/** A drawing of what a view looks like, for the views that have no instrument to choose (the grid, the strumming). */
function GridPreview() {
  const rows = [
    ['Am', '', 'F', ''],
    ['', '', '', ''],
    ['C', '', 'G', ''],
    ['', '', '', ''],
  ];
  return (
    <View style={styles.mini}>
      {rows.map((row, r) => (
        <View key={r} style={styles.miniRow}>
          {row.map((chord, k) => (
            <View key={k} style={[styles.miniCell, k === 0 && styles.miniFirst, r === 1 && k === 1 && styles.miniOn]}>
              <Text style={styles.miniText}>{chord}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function StrumPreview() {
  const arrows = ['D', 'D', 'U', 'U', 'D', 'U', 'D', 'U'];
  return (
    <View style={styles.strumRow}>
      {arrows.map((a, i) => (
        <View key={i} style={[styles.strumTile, i === 2 && styles.miniOn]}>
          <Icon name={a === 'D' ? 'down' : 'up'} size={22} color={i === 2 ? '#fff' : colors.ink} />
        </View>
      ))}
    </View>
  );
}

function Tile({ item, on, onPress, wide }) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={[styles.tile, wide && styles.tileWide, on && styles.tileOn, item.soon && styles.tileSoon]}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: !!item.soon }}
      accessibilityLabel={`${item.label}${item.soon ? ', coming soon' : item.locked ? ', needs a plan' : ''}`}
    >
      <InstrumentArt kind={item.id} color={on ? '#ffffffcc' : colors.mute} dot={on ? '#fff' : colors.ink} />
      <Text style={[styles.tileLabel, on && styles.tileLabelOn]}>{item.label}</Text>
      {item.soon ? <Text style={styles.tileNote}>Soon</Text> : null}
      {item.locked && !item.soon ? (
        <View style={styles.tileLock}>
          <Icon name="lock" size={14} color={colors.gold} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * "Pick your view": a panel that slides down over the song, under the toolbar, instead of a sheet from the bottom. A choice of the view
 * (diagrams, summary, grid, strumming) over what it shows: the instruments to pick from, or a picture of the view.
 */
function ViewPanel({ open, wide = false, onClose, views, view, onView, instruments, instrument, onInstrument }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(0);

  // Always there, just slid up out of sight (the song screen clips it), so opening is only a slide: nothing to build first.
  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? OPEN_MS : CLOSE_MS,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, progress]);

  const withInstruments = view === 'diagrams' || view === 'summary';
  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}
      style={[styles.panel, { opacity: height ? 1 : 0, transform: [{ translateY: height ? progress.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] }) : 0 }] }]}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Pick your view</Text>
        <Text style={styles.sub}>Choose how you want your chords to be presented.</Text>

        <View style={styles.segWrap}>
          <View style={styles.seg}>
            {views.map((v) => {
              const on = v.id === view;
              return (
                <Pressable key={v.id} onPress={() => onView(v.id)} style={[styles.segItem, on && styles.segOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.segText, on && styles.segTextOn]}>{v.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.stage}>
          {withInstruments ? (
            <View style={[styles.tiles, wide && styles.tilesWide]}>
              {instruments.map((item) => (
                <Tile key={item.id} item={item} on={instrument === item.id} onPress={onInstrument} wide={wide} />
              ))}
            </View>
          ) : view === 'grid' ? (
            <GridPreview />
          ) : (
            <StrumPreview />
          )}
        </View>
        {wide ? (
          <View style={styles.ctaInline}>
            <Button title="Start jamming" onPress={onClose} />
          </View>
        ) : null}
      </ScrollView>
      {wide ? null : (
        <View style={styles.cta}>
          <Button title="Start jamming" onPress={onClose} />
        </View>
      )}
    </Animated.View>
  );
}

export default memo(ViewPanel);

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
  title: { color: colors.ink, fontSize: 21, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.mute, fontSize: 14, textAlign: 'center', marginTop: 4 },
  segWrap: { alignItems: 'center', marginTop: 16, zIndex: 2 },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 4,
    gap: 2,
    elevation: 4,
    shadowColor: '#1a0533',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  segItem: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10 },
  segOn: { backgroundColor: colors.violet },
  segText: { color: colors.violetDeep, fontSize: 14, fontWeight: '700' },
  segTextOn: { color: '#fff' },
  stage: { backgroundColor: colors.violetSoft, borderRadius: 18, padding: 14, marginTop: -18, paddingTop: 34 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  tile: {
    width: '47.5%',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 12,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    elevation: 3,
    shadowColor: '#1a0533',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  tileWide: { width: '23%' }, // all four in one row when there is room (a phone held across)
  tilesWide: { gap: 6 },
  tileOn: { backgroundColor: colors.violet },
  tileSoon: { opacity: 0.6 },
  tileLabel: { color: colors.ink, fontSize: 15, fontWeight: '700', marginTop: 8 },
  tileLabelOn: { color: '#fff' },
  tileNote: { color: colors.mute, fontSize: 11, fontWeight: '700', marginTop: 1 },
  tileLock: { position: 'absolute', top: 8, right: 8 },
  mini: { alignSelf: 'center', gap: 4, paddingVertical: 4 },
  miniRow: { flexDirection: 'row', gap: 4 },
  miniCell: { width: 54, height: 54, borderRadius: 9, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  miniFirst: { backgroundColor: '#f3edff' },
  miniOn: { backgroundColor: colors.ink },
  miniText: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  strumRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', paddingVertical: 8 },
  strumTile: { width: 58, height: 58, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cta: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 },
  ctaInline: { marginTop: 14 }, // when there is little height (a phone held across) the button scrolls with the rest
});
