import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage, getPricing } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { AppBar, Note } from '../components/Ui';
import { colors, radius, shadow } from '../theme';

const money = (price) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amountMinor / 100);
  } catch {
    return `${price.currency} ${(price.amountMinor / 100).toFixed(2)}`;
  }
};
const PERIOD = { monthly: 'month', yearly: 'year', weekly: 'week', quarterly: '3 months', daily: 'day' };

/** The plans and what each includes, the same as the website's pricing page. Subscribing inside the app comes with the Play Store's own billing. */
export default function PremiumScreen() {
  const insets = useSafeAreaInsets();
  const { plan: mine } = useAuth();
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
        {!data && !error ? <ActivityIndicator color={colors.violet} style={styles.loading} /> : null}
        {data
          ? data.plans.map((plan) => {
              const price = plan.prices.find((p) => p.period === 'monthly') || plan.prices[0];
              const included = features.filter((f) => plan.entitlements[f.key] && plan.entitlements[f.key].enabled);
              const current = plan.code === mineCode;
              return (
                <View key={plan.id} style={[styles.card, shadow, plan.featured && styles.featured]}>
                  <View style={styles.head}>
                    <Text style={styles.name}>{plan.name}</Text>
                    {current ? <Text style={styles.current}>Your plan</Text> : plan.badge ? <Text style={styles.badge}>{plan.badge}</Text> : null}
                  </View>
                  <Text style={styles.desc}>{plan.description}</Text>
                  <Text style={styles.price}>{plan.isFree || !price ? 'Free' : `${money(price)} / ${PERIOD[price.period] || price.period}`}</Text>
                  {included.map((f) => {
                    const rule = plan.entitlements[f.key];
                    const detail = f.kind === 'limit' ? (rule.value === null ? 'unlimited' : `up to ${rule.value}`) : '';
                    return (
                      <View key={f.key} style={styles.feature}>
                        <Icon name="check" size={18} color={colors.violet} strokeWidth={2.6} />
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
        {data ? <Text style={styles.foot}>Plans you can use on chordsuno.com carry over when you sign in here. Subscribing from inside the app is coming with Google Play billing.</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14 },
  loading: { marginTop: 40 },
  card: { padding: 18, borderRadius: radius.card, backgroundColor: colors.surface, gap: 8 },
  featured: { borderWidth: 2, borderColor: colors.violet },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  current: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.violet, color: '#fff', fontSize: 12.5, fontWeight: '700' },
  badge: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.violetSoft, color: colors.violetDeep, fontSize: 12.5, fontWeight: '700' },
  desc: { color: colors.mute, fontSize: 14.5, lineHeight: 20 },
  price: { color: colors.violetDeep, fontSize: 18, fontWeight: '800', marginVertical: 4 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { flex: 1, color: colors.ink, fontSize: 14.5, lineHeight: 20 },
  foot: { color: colors.mute, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 12, marginTop: 6 },
});
