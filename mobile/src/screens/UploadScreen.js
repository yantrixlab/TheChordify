import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { errorMessage, startExtractUpload } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { AppBar, Button, Centered, Note } from '../components/Ui';
import { colors } from '../theme';

const MAX_BYTES = 50 * 1024 * 1024; // the server's limit
const ALLOWED = /\.(mp3|wav|flac|m4a)$/i;

/** Import music: pick an audio file on the phone, send it to be analysed, and go on to the waiting screen. Only the file picked is seen. */
export default function UploadScreen({ navigation }) {
  const { can, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async () => {
    setError('');
    let file;
    try {
      [file] = await pick({ type: [types.audio], allowMultiSelection: false });
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      setError(errorMessage(err, 'Could not open the file picker.'));
      return;
    }
    if (!file) return;
    if (!ALLOWED.test(file.name || '')) {
      setError('Pick an MP3, WAV, FLAC or M4A file.');
      return;
    }
    if (file.size && file.size > MAX_BYTES) {
      setError('That file is over 50 MB. Pick a smaller one.');
      return;
    }
    setBusy(true);
    try {
      const { sessionId } = await startExtractUpload(file);
      navigation.replace('Processing', { sessionId, song: { title: (file.name || 'Your song').replace(/\.[^.]+$/, ''), artist: '' } });
    } catch (err) {
      setError(errorMessage(err, 'We could not upload that file. Please try again.'));
      setBusy(false);
    }
  };

  if (!can('upload_song')) {
    return (
      <View style={styles.screen}>
        <AppBar title="Import music" backIcon="close" onBack={() => navigation.goBack()} />
        <Centered>
          <Icon name="premium" size={48} color={colors.gold} filled />
          <Text style={styles.title}>Importing songs is not in your plan</Text>
          <Button title="See the plans" onPress={() => navigation.navigate('Tabs', { screen: 'Premium' })} style={styles.button} />
        </Centered>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AppBar title="Import music" backIcon="close" onBack={() => navigation.goBack()} />
      <Centered>
        <View style={styles.icon}>
          <Icon name="upload" size={44} color="#fff" strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>Get the chords of your own song</Text>
        <Text style={styles.text}>Pick an audio file from your phone: MP3, WAV, FLAC or M4A, up to 50 MB. It is sent to Chord Suno to work out its chords, and only the file you pick is seen.</Text>
        <Note>{error}</Note>
        {!user ? <Note tone="info">Sign in first, so the song is kept in your library.</Note> : null}
        <Button title="Choose a file" onPress={choose} busy={busy} style={styles.button} />
      </Centered>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  icon: { width: 96, height: 96, borderRadius: 24, backgroundColor: '#ef6f6f', alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 18, textAlign: 'center' },
  text: { color: colors.mute, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  button: { marginTop: 22, alignSelf: 'stretch' },
});
