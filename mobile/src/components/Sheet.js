import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icons';
import { radius, makeStyles, useColors } from '../theme';

/** A panel that slides up from the bottom over the screen: a title, a close button and whatever is put in it. */
export function Sheet({ visible, title, onClose, children, scroll = false }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const Body = scroll ? ScrollView : View;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={24} color={colors.mute} />
          </Pressable>
        </View>
        <Body style={scroll ? styles.scroll : undefined}>{children}</Body>
      </View>
    </Modal>
  );
}

/** A value with minus and plus buttons: "Capo  ‹ 2 ›". */
export function Stepper({ value, label, onMinus, onPlus, minusDisabled, plusDisabled }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onMinus} disabled={minusDisabled} style={[styles.stepButton, minusDisabled && styles.stepOff]} accessibilityRole="button" accessibilityLabel={`${label} down`}>
        <Icon name="back" size={26} color={colors.accentDeep} />
      </Pressable>
      <Text style={styles.stepValue} accessibilityLabel={`${label} ${value}`}>
        {value}
      </Text>
      <Pressable onPress={onPlus} disabled={plusDisabled} style={[styles.stepButton, plusDisabled && styles.stepOff]} accessibilityRole="button" accessibilityLabel={`${label} up`}>
        <Icon name="forward" size={26} color={colors.accentDeep} />
      </Pressable>
    </View>
  );
}

/** A row of choices where one is picked: [Diagrams | Summary | Grid]. */
export function Segmented({ options, value, onChange }) {
  const styles = useStyles();
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.segment, value === o.id && styles.segmentOn]} accessibilityRole="button" accessibilityState={{ selected: value === o.id }}>
          <Text style={[styles.segmentText, value === o.id && styles.segmentTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A line of a menu: an icon, a name, and what it does. */
export function MenuRow({ icon, title, hint, onPress, locked, danger }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.menuRow} accessibilityRole="button" android_ripple={{ color: colors.ripple }}>
      <Icon name={icon} size={22} color={danger ? colors.danger : colors.accentDeep} />
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, danger && { color: colors.danger }]}>{title}</Text>
        {hint ? <Text style={styles.menuHint}>{hint}</Text> : null}
      </View>
      {locked ? <Icon name="premium" size={18} color={colors.gold} filled /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, maxHeight: '85%' },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  scroll: { flexGrow: 0 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, paddingVertical: 10 },
  stepButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepOff: { opacity: 0.35 },
  stepValue: { minWidth: 110, textAlign: 'center', color: colors.ink, fontSize: 34, fontWeight: '800' },
  segmented: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.accentDeep, fontSize: 14.5, fontWeight: '700' },
  segmentTextOn: { color: colors.onAccent },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56, paddingVertical: 8 },
  menuText: { flex: 1 },
  menuTitle: { color: colors.ink, fontSize: 16.5, fontWeight: '600' },
  menuHint: { color: colors.mute, fontSize: 13, marginTop: 1 },
}));
