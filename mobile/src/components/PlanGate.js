import { StyleSheet, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { Icon } from './Icons';
import { Button } from './Ui';
import { useColors } from '../theme';

/**
 * What a tool or feature the person's plan leaves out shows, inside a centred box: what it is, and then
 *   - for somebody not signed in: a Sign in button, since they may already have a plan on their account;
 *   - for somebody signed in: the details of the plans.
 * It never says how or where a plan is bought. The app does not sell plans yet, and Google Play does not allow an app that sells
 * through Play Billing, or through nothing at all, to send people to another way of paying. Keep it so.
 */
export function PlanGate({ title, navigation }) {
  const colors = useColors();
  const { user } = useAuth();
  return (
    <>
      <Icon name="premium" size={48} color={colors.gold} filled />
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.hint, { color: colors.mute }]}>
        {user ? "This isn't part of your current plan." : 'Already have a Chord Suno plan? Sign in with the same Google account to use it.'}
      </Text>
      <Button
        title={user ? 'Plan details' : 'Sign in'}
        onPress={() => (user ? navigation.navigate('Tabs', { screen: 'Premium' }) : navigation.navigate('Settings'))}
        style={styles.button}
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  hint: { fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 8, paddingHorizontal: 12 },
  button: { marginTop: 18 },
});
