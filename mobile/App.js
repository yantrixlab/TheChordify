import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1a0533" />
      <View style={styles.container}>
        <Text style={styles.title}>Chord Suno</Text>
        <Text style={styles.sub}>Chords for any song</Text>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a0533' },
  title: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  sub: { marginTop: 8, fontSize: 15, color: '#b9a1ff' },
});

export default App;
