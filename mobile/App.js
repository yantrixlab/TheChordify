import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAppConfig } from './src/api';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { Button } from './src/components/Ui';
import { VERSION_CODE } from './src/config';
import Navigation from './src/navigation';
import { colors } from './src/theme';

// An old version the server no longer supports is asked to update before anything else (a way to retire a broken release).
function useUpdateNeeded() {
  const [state, setState] = useState(null);
  useEffect(() => {
    getAppConfig().then(
      (cfg) => setState(cfg && cfg.android && cfg.android.minVersionCode > VERSION_CODE ? cfg : null),
      () => {},
    );
  }, []);
  return state;
}

function Root() {
  const { ready } = useAuth();
  const update = useUpdateNeeded();
  if (update) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Please update Chord Suno</Text>
        <Text style={styles.sub}>This version is too old to keep working. Update from the Play Store to carry on.</Text>
        <Button title="Update" onPress={() => Linking.openURL(update.storeUrl)} style={{ marginTop: 22 }} />
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Chord Suno</Text>
        <ActivityIndicator color={colors.violetSoft} style={{ marginTop: 18 }} />
      </View>
    );
  }
  return <Navigation />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, paddingHorizontal: 32 },
  title: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  sub: { color: colors.mute, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
});
