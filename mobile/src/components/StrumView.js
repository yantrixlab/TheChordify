import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { cellAt } from '../lib/grid';
import { colors, radius } from '../theme';

const SUB_NAMES = { 2: ['', '&'], 4: ['', 'e', '&', 'a'] };

/** The song's strumming patterns as the website has them: v4 and later, one or several, each with an easy version. */
export function strumPatterns(result) {
  const strum = result && result.strum;
  if (!strum || (strum.v || 1) < 4 || !Array.isArray(strum.pattern) || strum.pattern.length < 4) return [];
  if (strum.patterns && strum.patterns.length) return strum.patterns;
  return [{ pattern: strum.pattern, sub: strum.sub || 2, kind: strum.kind || (strum.detected ? 'heard' : 'typical'), confidence: strum.confidence, where: [], bars: 0, label: strum.label, easy: strum.easy }];
}

const whereText = (p) => (p.where && p.where.length ? p.where.join(' and ') : '');

function Arrow({ down, color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d={down ? 'M12 4v15M6 13l6 6 6-6' : 'M12 20V5M6 11l6-6 6 6'} />
    </Svg>
  );
}

/** The slot (an eighth or sixteenth) that is sounding at `time`, so it can be lit. */
function slotAt(chart, time, sub, count) {
  const i = cellAt(chart.cells, time);
  if (i < 0) return -1;
  const cell = chart.cells[i];
  const next = chart.cells[i + 1];
  const span = Math.max((next ? next.t : cell.t + 0.5) - cell.t, 0.05);
  const within = Math.min(Math.floor(((time - cell.t) / span) * sub), sub - 1);
  return (cell.k * sub + Math.max(within, 0)) % count;
}

/** "Strum": the pattern as arrows (down, up, or a beat to skip), with the slot that is playing lit. */
export function StrumView({ result, chart, time, bottomInset }) {
  const { width } = useWindowDimensions();
  const list = useMemo(() => strumPatterns(result), [result]);
  const [index, setIndex] = useState(0);
  const [easy, setEasy] = useState(false);
  if (list.length === 0) return null;

  const cur = list[Math.min(index, list.length - 1)];
  const sub = cur.sub === 4 ? 4 : 2;
  const slots = easy ? cur.easy : cur.pattern;
  const cols = Math.min(slots.length, 8);
  const tile = (width - 32 - (cols - 1) * 8) / cols;
  const lit = slotAt(chart, time, sub, slots.length);
  const kind = cur.kind;
  const where = whereText(cur);
  const bpm = Math.round((result.strum && result.strum.bpm) || chart.tempo || 100);
  const feel = bpm < 80 ? 'slow, relaxed' : bpm < 110 ? 'easy' : bpm < 140 ? 'upbeat' : 'fast';
  const perBar = (result.strum && result.strum.perBar) || chart.perBar;
  const beats = Array.from({ length: perBar }, (_, i) => i + 1).join(', ');
  const several = list.length > 1;

  const tabs = several
    ? [...list.map((p, i) => ({ id: String(i), label: `Pattern ${i + 1}${p.where && p.where.length ? ` · ${whereText(p)}` : ''}`, on: !easy && i === index })), { id: 'easy', label: 'Easy', on: easy }]
    : [
        { id: '0', label: 'Full pattern', on: !easy },
        { id: 'easy', label: 'Easy version', on: easy },
      ];

  const text = easy
    ? `One down-strum on every beat (${beats}): the simplest way to play this song, at its ${feel} ${bpm} BPM.`
    : kind === 'heard'
      ? several
        ? `${where ? `Played in the ${where}` : 'One of the ways this song is played'}, at the song’s ${feel} ${bpm} BPM groove. The song does not strum the same way all through, so switch patterns to see the others.`
        : `The pattern the recording keeps coming back to, at the song’s ${feel} ${bpm} BPM groove.`
      : kind === 'guess'
        ? `The strumming here is not steady enough to be sure, so this is our best guess from the beats that stand out, at the song’s ${feel} ${bpm} BPM feel.`
        : `We could not hear one clear strum, so this is a typical ${perBar}-beat pattern for the song’s ${feel} ${bpm} BPM feel.`;

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 20 }]}>
      <View style={styles.tabs}>
        {tabs.map((t) => (
          <Text
            key={t.id}
            onPress={() => {
              if (t.id === 'easy') setEasy(true);
              else {
                setEasy(false);
                setIndex(Number(t.id));
              }
            }}
            style={[styles.tab, t.on && styles.tabOn]}
            accessibilityRole="button"
          >
            {t.label}
          </Text>
        ))}
      </View>
      <Text style={[styles.pill, kind === 'heard' && styles.pillHeard]}>{kind === 'heard' ? 'Heard in the song' : kind === 'guess' ? 'Best guess' : 'Suggested'}</Text>
      <View style={styles.tiles}>
        {slots.map((slot, i) => {
          const within = i % sub;
          const count = within === 0 ? String(i / sub + 1) : SUB_NAMES[sub][within];
          const on = i === lit;
          return (
            <View key={i} style={[styles.tile, { width: tile }, slot === '-' && styles.tileRest, on && styles.tileOn]}>
              {slot === 'D' || slot === 'U' ? <Arrow down={slot === 'D'} color={on ? '#fff' : colors.violetDeep} /> : <Text style={[styles.rest, on && { color: '#fff' }]}>·</Text>}
              <Text style={[styles.count, on && { color: '#fff' }]}>{count}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.text}>{text}</Text>
      <Text style={styles.how}>
        ↓ is a down-strum, ↑ an up-strum, and a dim tile is a beat you let ring or skip. Count along: the numbers are the beats{sub === 4 ? ', “e” and “a” the quick strokes either side of the “&”' : ' and “&” is the half beat between them'}.
      </Text>
      <Text style={styles.how}>
        <Text style={styles.bold}>Just starting out? </Text>
        Play steady down-strums on every beat ({beats}) until the chord changes feel comfortable, then add the other strokes. Strum lightly in the verses and open up for the chorus.
      </Text>
      <Text style={styles.note}>
        {kind === 'typical'
          ? 'A suggestion for this time signature, not a pattern heard in the song.'
          : `${kind === 'guess' ? 'A rough reading of the recording. ' : 'Worked out from the recording. '}Down and up strokes cannot be heard, so the usual picture is shown: the hand keeps moving down and up, so strokes on the beat are down-strums and strokes on the “&” up-strums.`}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.violetDeep, fontSize: 14, fontWeight: '700' },
  tabOn: { backgroundColor: colors.violet, color: '#fff' },
  pill: { alignSelf: 'flex-start', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.soft, color: colors.mute, fontSize: 12.5, fontWeight: '700' },
  pillHeard: { backgroundColor: '#dcfce7', color: '#166534' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { height: 74, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileRest: { opacity: 0.55 },
  tileOn: { backgroundColor: colors.violet, borderColor: colors.violet, opacity: 1 },
  rest: { color: colors.faint, fontSize: 26, lineHeight: 26 },
  count: { color: colors.mute, fontSize: 13, fontWeight: '700' },
  text: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  how: { color: colors.mute, fontSize: 14, lineHeight: 21 },
  bold: { color: colors.ink, fontWeight: '800' },
  note: { color: colors.faint, fontSize: 12.5, lineHeight: 18 },
});
