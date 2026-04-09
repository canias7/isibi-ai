import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeContext';
import {
  getPlans,
  getCurrentPlan,
  createCheckout,
  openBillingPortal,
  PlanInfo,
  UsageSnapshot,
} from '../lib/api';

function formatPrice(cents: number | null): string {
  if (cents === null) return 'Contact us';
  if (cents === 0) return 'Free';
  return `$${Math.round(cents / 100)}/mo`;
}

function formatLimit(n: number): string {
  return n < 0 ? 'Unlimited' : n.toLocaleString();
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function SubscriptionScreen({ onBack }: { onBack: () => void }) {
  const { colors: tc } = useTheme();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [current, setCurrent] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [p, c] = await Promise.all([getPlans(), getCurrentPlan()]);
      setPlans(p.plans);
      setCurrent(c);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubscribe = async (planId: string) => {
    if (planId === 'free') return;
    if (planId === 'enterprise') {
      Linking.openURL('mailto:hello@gofurther.ai?subject=Enterprise%20plan%20inquiry');
      return;
    }
    try {
      setBusyPlan(planId);
      const res = await createCheckout(planId);
      await Linking.openURL(res.checkout_url);
    } catch (e: any) {
      Alert.alert('Checkout failed', e.message || 'Please try again');
    } finally {
      setBusyPlan(null);
    }
  };

  const handleManage = async () => {
    try {
      const res = await openBillingPortal();
      await Linking.openURL(res.portal_url);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not open billing portal');
    }
  };

  const currentPlanId = current?.plan || 'free';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]}>
      <View style={[styles.header, { borderBottomColor: tc.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={tc.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tc.text }]}>Subscription</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={tc.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {current && (
            <View style={[styles.usageCard, { backgroundColor: tc.card, borderColor: tc.border }]}>
              <Text style={[styles.usageLabel, { color: tc.textMid }]}>Current plan</Text>
              <Text style={[styles.usagePlan, { color: tc.text }]}>{current.plan_name}</Text>

              <View style={styles.usageRow}>
                <View style={styles.usageCol}>
                  <Text style={[styles.usageNum, { color: tc.text }]}>
                    {current.used_5h}
                    <Text style={[styles.usageDenom, { color: tc.textMid }]}>
                      {' / '}
                      {current.per_5h < 0 ? '∞' : current.per_5h}
                    </Text>
                  </Text>
                  <Text style={[styles.usageSub, { color: tc.textMid }]}>
                    used in 5h · resets {formatCountdown(current.resets_in_seconds_5h)}
                  </Text>
                </View>
              </View>

              <View style={styles.usageRow}>
                <View style={styles.usageCol}>
                  <Text style={[styles.usageNum, { color: tc.text }]}>
                    {current.used_week}
                    <Text style={[styles.usageDenom, { color: tc.textMid }]}>
                      {' / '}
                      {current.per_week < 0 ? '∞' : current.per_week}
                    </Text>
                  </Text>
                  <Text style={[styles.usageSub, { color: tc.textMid }]}>
                    used this week · resets {formatCountdown(current.resets_in_seconds_week)}
                  </Text>
                </View>
              </View>

              {currentPlanId !== 'free' && (
                <TouchableOpacity
                  onPress={handleManage}
                  style={[styles.manageBtn, { borderColor: tc.border }]}
                >
                  <Text style={[styles.manageText, { color: tc.text }]}>Manage subscription</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: tc.text }]}>Choose a plan</Text>

          {plans.map((p) => {
            const isCurrent = p.id === currentPlanId;
            const isFree = p.id === 'free';
            const isEnterprise = p.is_custom;
            return (
              <View
                key={p.id}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: tc.card,
                    borderColor: isCurrent ? tc.primary : tc.border,
                    borderWidth: isCurrent ? 2 : 1,
                  },
                ]}
              >
                <View style={styles.planHeader}>
                  <Text style={[styles.planName, { color: tc.text }]}>{p.name}</Text>
                  <Text style={[styles.planPrice, { color: tc.primary }]}>
                    {formatPrice(p.price_cents)}
                  </Text>
                </View>

                <View style={styles.featureRow}>
                  <Ionicons name="flash" size={14} color={tc.textMid} />
                  <Text style={[styles.featureText, { color: tc.textMid }]}>
                    {formatLimit(p.per_5h)} messages per 5 hours
                  </Text>
                </View>
                <View style={styles.featureRow}>
                  <Ionicons name="calendar" size={14} color={tc.textMid} />
                  <Text style={[styles.featureText, { color: tc.textMid }]}>
                    {formatLimit(p.per_week)} messages per week
                  </Text>
                </View>
                <View style={styles.featureRow}>
                  <Ionicons name="time" size={14} color={tc.textMid} />
                  <Text style={[styles.featureText, { color: tc.textMid }]}>
                    {p.max_tasks < 0
                      ? 'Unlimited scheduled tasks'
                      : p.max_tasks === 0
                      ? 'No scheduled tasks'
                      : `${p.max_tasks} active scheduled tasks`}
                  </Text>
                </View>

                <TouchableOpacity
                  disabled={isCurrent || busyPlan === p.id}
                  onPress={() => handleSubscribe(p.id)}
                  style={[
                    styles.ctaBtn,
                    {
                      backgroundColor: isCurrent
                        ? tc.card2 || tc.border
                        : isFree
                        ? tc.card2 || tc.border
                        : tc.primary,
                      opacity: busyPlan === p.id ? 0.6 : 1,
                    },
                  ]}
                >
                  {busyPlan === p.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text
                      style={[
                        styles.ctaText,
                        {
                          color: isCurrent || isFree ? tc.text : '#fff',
                        },
                      ]}
                    >
                      {isCurrent
                        ? 'Current plan'
                        : isFree
                        ? 'Free forever'
                        : isEnterprise
                        ? 'Contact sales'
                        : `Subscribe to ${p.name}`}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}

          <Text style={[styles.footnote, { color: tc.textDim }]}>
            Rolling windows reset automatically. Cancel any time from the billing portal.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },
  usageCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 24,
  },
  usageLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  usagePlan: { fontSize: 28, fontWeight: '700', marginTop: 4, marginBottom: 16 },
  usageRow: { marginBottom: 12 },
  usageCol: {},
  usageNum: { fontSize: 22, fontWeight: '600' },
  usageDenom: { fontSize: 16, fontWeight: '400' },
  usageSub: { fontSize: 12, marginTop: 2 },
  manageBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  manageText: { fontSize: 14, fontWeight: '500' },
  sectionTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  planCard: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 14,
  },
  planName: { fontSize: 22, fontWeight: '700' },
  planPrice: { fontSize: 18, fontWeight: '600' },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  featureText: { fontSize: 13 },
  ctaBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: { fontSize: 15, fontWeight: '600' },
  footnote: { fontSize: 11, textAlign: 'center', marginTop: 16 },
});
