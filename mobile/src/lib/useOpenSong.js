import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { errorMessage, startExtract } from '../api';

/** Opens a song from a list: a YouTube song asks the server for its chords (which are ready at once if somebody has had them
 *  made) and goes on to the waiting screen; a song somebody uploaded goes straight to the player. */
export function useOpenSong() {
  const navigation = useNavigation();
  const busy = useRef(false);
  return useCallback(
    async (song) => {
      if (busy.current) return;
      if (song.sessionId && !song.videoId) {
        navigation.navigate('Player', { sessionId: song.sessionId, song });
        return;
      }
      busy.current = true;
      try {
        const { sessionId } = await startExtract(song);
        navigation.navigate('Processing', { sessionId, song });
      } catch (err) {
        Alert.alert('Could not start that song', errorMessage(err));
      } finally {
        busy.current = false;
      }
    },
    [navigation],
  );
}
