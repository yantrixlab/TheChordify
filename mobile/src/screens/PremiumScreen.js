import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage, getPricing } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { AppBar, Button, Note } from '../components/Ui';
import { radius, shadow, makeStyles, useColors } from '../theme';

/**
 * "My plan": the plan on the signed-in person's account and what it includes. Nothing else: no other plans, no prices, no offers and no
 * way to buy. The app does not sell plans yet, and Google Play does not allow an app to send people to another way of paying, so this
 * screen must not compare plans, promote one, or lead to the website. Somebody who already has a plan signs in to use it.
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
  const rules = mine && mine.entitlements ? mine.entitlements : {};
  const mineCode = mine && mine.plan ? mine.plan.code : 'free';
  const description = data ? (data.plans.find((p) => p.code === mineCode) || {}).description : '';
  const included = features.filter((f) => rules[f.key] && rules[f.key].enabled);

  return (
    <View style={styles.screen}>
      <AppBar title="My plan" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Note>{error}</Note>
        {!user ? (
          <View style={[styles.card, shadow]}>
            <Text style={styles.name}>Already have a plan?</Text>
            <Text style={styles.desc}>Sign in with the same Google account and it is ready to use here.</Text>
            <Button title="Sign in" onPress={() => navigation.navigate('Settings')} />
          </View>
        ) : !data && !error ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : data ? (
          <View style={[styles.card, shadow]}>
            <View style={styles.head}>
              <Text style={styles.name}>{(mine && mine.plan && mine.plan.name) || 'Free'}</Text>
              <Text style={styles.current}>Your plan</Text>
            </View>
            {description ? <Text style={styles.desc}>{description}</Text> : null}
            {included.map((f) => {
              const rule = rules[f.key];
              const detail = f.kind === 'limit' ? (rule.value === null || rule.value === undefined ? 'unlimited' : `up to ${rule.value}`) : '';
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
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14 },
  loading: { marginTop: 40 },
  card: { padding: 18, borderRadius: radius.card, backgroundColor: colors.surface, gap: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  current: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accent, color: colors.onAccent, fontSize: 12.5, fontWeight: '700' },
  desc: { color: colors.mute, fontSize: 14.5, lineHeight: 20 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { flex: 1, color: colors.ink, fontSize: 14.5, lineHeight: 20 },
}));
