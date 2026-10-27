import { StyleSheet, Text, View } from 'react-native';
import { TOOLS } from 'chordsuno-shared/tools/catalog';
import { AppBar, Button, Centered } from '../components/Ui';
import { Icon } from '../components/Icons';
import { colors } from '../theme';

// Stands in for a tool until it is built into the app.
export default function ComingSoonScreen({ route, navigation }) {
  const tool = TOOLS.find((t) => t.id === route.name);
  const name = tool ? tool.name : route.name === 'upload' ? 'Import music' : route.name;
  return (
    <View style={styles.screen}>
      <AppBar title={name} onBack={() => navigation.goBack()} />
      <Centered>
        <Icon name={tool ? tool.id : 'upload'} size={56} color={colors.violet} />
        <Text style={styles.title}>{name} is coming to the app</Text>
        <Text style={styles.text}>It already works on chordsuno.com.</Text>
        <Button title="Back" kind="quiet" onPress={() => navigation.goBack()} style={styles.button} />
      </Centered>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  text: { color: colors.mute, fontSize: 15, marginTop: 6, textAlign: 'center' },
  button: { marginTop: 22 },
});
