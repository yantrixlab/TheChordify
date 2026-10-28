import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icons';
import { colors } from '../theme';

/** The row under the video: the instrument and view, Transpose, Capo and the chord detail. A dot says something is switched on. */
export function Toolbar({ items }) {
  return (
    <View style={styles.toolbar}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={item.onPress}
          style={[styles.toolItem, item.active && styles.toolActive]}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: !!item.active }}
          android_ripple={{ color: '#7c3aed22' }}
        >
          <Text style={[styles.toolText, item.active && styles.toolTextActive]} numberOfLines={1}>
            {item.label}
          </Text>
          {item.chevron ? (
            <View style={item.open ? styles.flip : null}>
              <Icon name="down" size={16} color={item.active ? colors.violetDeep : colors.ink} />
            </View>
          ) : null}
          {item.locked ? <Icon name="lock" size={13} color={colors.gold} /> : null}
          {item.dot ? <View style={styles.dot} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

function PanelButton({ icon, value, label, on, onPress, big, cell, children }) {
  return (
    <Pressable onPress={onPress} style={cell ? styles.cell : styles.panelItem} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }}>
      {big ? (
        children
      ) : (
        <>
          <View style={styles.panelValueBox}>{icon ? <Icon name={icon} size={24} color={on ? '#c4b5fd' : '#fff'} /> : <Text style={[styles.panelValue, on && styles.panelOn]}>{value}</Text>}</View>
          <Text style={[styles.panelLabel, on && styles.panelOn]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The dark panel at the bottom: restart and play, then tempo, loop, count-in and volume (while the count-in runs the play button shows
 * 3, 2, 1). With `media` (the YouTube player, or the tile of an imported song) the six controls fill the left half, two to a row, and
 * the media sits on the right, `mediaWidth` x `mediaHeight` (YouTube asks for a player of at least 200 x 200).
 */
export function ControlPanel({ playing, counting, onPlay, onRestart, tempoPct, onTempo, loopMode, onLoop, countIn, onCountIn, volume, onVolume, bottomInset, media, mediaWidth, mediaHeight }) {
  const buttons = (cell) => (
    <>
      <PanelButton big cell={cell} onPress={onRestart} label="Restart">
        <View style={styles.round}>
          <Icon name="restart" size={22} color="#fff" />
        </View>
      </PanelButton>
      <PanelButton big cell={cell} onPress={onPlay} label={playing ? 'Pause' : 'Play'}>
        <View style={[styles.round, styles.roundPlay]}>
          {counting ? <Text style={styles.count}>{counting}</Text> : <Icon name={playing ? 'pause' : 'play'} size={26} color="#1a0533" />}
        </View>
      </PanelButton>
      <PanelButton cell={cell} value={`${tempoPct}%`} label="TEMPO" on={tempoPct !== 100} onPress={onTempo} />
      <PanelButton cell={cell} icon="loop" label={loopMode === 'off' ? 'LOOP' : loopMode === 'song' ? 'SONG' : 'SECTION'} on={loopMode !== 'off'} onPress={onLoop} />
      <PanelButton cell={cell} value="3,2,1" label={countIn ? 'COUNT-IN ON' : 'COUNT-IN'} on={countIn} onPress={onCountIn} />
      <PanelButton cell={cell} icon={volume === 0 ? 'mute' : 'volume'} label="VOLUME" on={volume !== 100} onPress={onVolume} />
    </>
  );
  if (!media) return <View style={[styles.panel, { paddingBottom: bottomInset + 10 }]}>{buttons(false)}</View>;
  return (
    <View style={[styles.panelWithMedia, { paddingBottom: bottomInset }]}>
      <View style={[styles.grid, { height: mediaHeight }]}>{buttons(true)}</View>
      <View style={{ width: mediaWidth, height: mediaHeight, backgroundColor: '#000' }}>{media}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: 4 },
  toolItem: { flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  toolActive: { backgroundColor: colors.soft, borderRadius: 12, height: 38, alignSelf: 'center' },
  toolText: { color: colors.ink, fontSize: 12.5, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  toolTextActive: { color: colors.violetDeep },
  flip: { transform: [{ rotate: '180deg' }] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.violet, marginLeft: 1, marginBottom: 10 },
  panel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#241a3d', paddingTop: 12, paddingHorizontal: 8 },
  panelWithMedia: { flexDirection: 'row', backgroundColor: '#241a3d' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'stretch' },
  cell: { width: '50%', height: '33.33%', alignItems: 'center', justifyContent: 'center' },
  panelItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 64 },
  panelValueBox: { height: 30, alignItems: 'center', justifyContent: 'center' },
  panelValue: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  panelLabel: { color: '#b7acd0', fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginTop: 2 },
  panelOn: { color: '#c4b5fd' },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#0f0820', alignItems: 'center', justifyContent: 'center' },
  roundPlay: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  count: { color: colors.violetDeep, fontSize: 26, fontWeight: '800' },
});
