import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOOLS } from 'chordsuno-shared/tools/catalog';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { AppBar } from '../components/Ui';
import { colors, radius, shadow } from '../theme';

/** The Toolkit: the practice tools. A tool the person's plan leaves out shows a crown and leads to the plans. */
export default function ToolkitScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { can } = useAuth();
  const open = (tool) => navigation.navigate(can(tool.feature) ? tool.id : 'Premium');
  return (
    <View style={styles.screen}>
      <AppBar title="Toolkit" actions={[{ icon: 'settings', label: 'Settings', onPress: () => navigation.navigate('Settings') }]} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {TOOLS.map((tool) => (
          <Pressable key={tool.id} onPress={() => open(tool)} style={[styles.card, shadow]} accessibilityRole="button" accessibilityLabel={tool.name} android_ripple={{ color: '#7c3aed22' }}>
            <View style={[styles.tile, { backgroundColor: tool.cover[1] }]}>
              <View style={[styles.sky, { backgroundColor: tool.cover[0] }]} />
              <Icon name={tool.id} size={42} color="#fff" strokeWidth={1.8} />
            </View>
            <View style={styles.body}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{tool.name}</Text>
                {!can(tool.feature) ? <Icon name="premium" size={18} color={colors.gold} filled /> : null}
              </View>
              <Text style={styles.blurb} numberOfLines={3}>
                {tool.blurb}
              </Text>
            </View>
          </Pressable>
        ))}
        <Pressable onPress={() => navigation.navigate(can('upload_song') ? 'upload' : 'Premium')} style={[styles.card, shadow]} accessibilityRole="button" accessibilityLabel="Import music" android_ripple={{ color: '#7c3aed22' }}>
          <View style={[styles.tile, { backgroundColor: '#ef6f6f' }]}>
            <View style={[styles.sky, { backgroundColor: '#f29a9a' }]} />
            <Icon name="upload" size={42} color="#fff" strokeWidth={1.8} />
          </View>
          <View style={styles.body}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>Import music</Text>
              {!can('upload_song') ? <Icon name="premium" size={18} color={colors.gold} filled /> : null}
            </View>
            <Text style={styles.blurb} numberOfLines={3}>
              Get the chords of a song from an audio file on your phone: MP3, WAV, FLAC and more.
            </Text>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: radius.card, backgroundColor: colors.surface },
  tile: { width: 92, height: 92, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  sky: { position: 'absolute', left: 0, right: 0, top: 0, height: 50 },
  body: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  blurb: { color: colors.mute, fontSize: 14, lineHeight: 20 },
});
