import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage, getPricing } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { AppBar, Button, Note } from '../components/Ui';
import { radius, shadow, makeStyles, useColors } from '../theme';

/**
 * What each plan includes, for comparison. There are no prices, no offers and no way to buy here: the app does not sell plans yet, and
 * Google Play does not allow an app to send people to another way of paying. Somebody who already has a plan signs in to use it.
 */
export default function PremiumScreen({ navigation }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { plan: mine, user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPricing().then(setData, (err) => setError(errorMessage(err)));
  }, []);

  const features = data ? data.features.filter((f) => f.status === 'live') : [];
  const mineCode = mine && mine.plan ? mine.plan.code : 'free';

  return (
    <View style={styles.screen}>
      <AppBar title="Premium" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Note>{error}</Note>
        {!user ? (
          <View style={[styles.card, shadow]}>
            <Text style={styles.name}>Already have a plan?</Text>
            <Text style={styles.desc}>Sign in with the same Google account and it is ready to use here.</Text>
            <Button title="Sign in" onPress={() => navigation.navigate('Settings')} />
          </View>
        ) : null}
        {!data && !error ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
        {data
          ? data.plans.map((plan) => {
              const included = features.filter((f) => plan.entitlements[f.key] && plan.entitlements[f.key].enabled);
              const current = plan.code === mineCode;
              return (
                <View key={plan.id} style={[styles.card, shadow, plan.featured && styles.featured]}>
                  <View style={styles.head}>
                    <Text style={styles.name}>{plan.name}</Text>
                    {current ? <Text style={styles.current}>Your plan</Text> : null}
                  </View>
                  <Text style={styles.desc}>{plan.description}</Text>
                  {included.map((f) => {
                    const rule = plan.entitlements[f.key];
                    const detail = f.kind === 'limit' ? (rule.value === null ? 'unlimited' : `up to ${rule.value}`) : '';
                    return (
                      <View key={f.key} style={styles.feature}>
                        <Icon name="check" size={18} color={colors.accent} strokeWidth={2.6} />
                        <Text style={styles.featureText}>
                          {f.label}
                          {detail ? ` (${detail})` : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })
          : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14 },
  loading: { marginTop: 40 },
  card: { padding: 18, borderRadius: radius.card, backgroundColor: colors.surface, gap: 8 },
  featured: { borderWidth: 2, borderColor: colors.accent },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  current: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accent, color: colors.onAccent, fontSize: 12.5, fontWeight: '700' },
  desc: { color: colors.mute, fontSize: 14.5, lineHeight: 20 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { flex: 1, color: colors.ink, fontSize: 14.5, lineHeight: 20 },
}));
