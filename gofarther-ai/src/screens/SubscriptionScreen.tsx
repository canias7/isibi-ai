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

// Plan marketing copy — mirrors Claude's capacity/best-for style.
// Intentionally avoids exposing numeric quotas.
const PLAN_COPY: Record<string, { capacity: string; bestFor: string }> = {
  free: {
    capacity: 'Limited',
    bestFor: 'Occasional use',
  },
  pro: {
    capacity: 'Standard',
    bestFor: 'Regular use',
  },
  business: {
    capacity: '5x Pro capacity per session',
    bestFor: 'Frequent users who work with GoFarther AI on a variety of tasks',
  },
  max: {
    capacity: '20x Pro capacity per session',
    bestFor: 'Daily users who collaborate often with GoFarther AI for most tasks',
  },
  enterprise: {
    capacity: 'Custom capacity',
    bestFor: 'Organizations and teams with custom needs',
  },
};

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
          {current && (() => {
            const pct5h = current.used_pct_5h;
            const pctWeek = current.used_pct_week;
            const unlimited5h = current.unlimited_5h;
            const unlimitedWeek = current.unlimited_week;
            return (
              <View style={[styles.usageCard, { backgroundColor: tc.card, borderColor: tc.border }]}>
                <Text style={[styles.usageLabel, { color: tc.textMid }]}>Current plan</Text>
                <Text style={[styles.usagePlan, { color: tc.text }]}>{current.plan_name}</Text>

                <View style={styles.usageRow}>
                  <View style={styles.usageHeaderRow}>
                    <Text style={[styles.usageTitle, { color: tc.text }]}>Current usage</Text>
                    <Text style={[styles.usagePct, { color: tc.textMid }]}>
                      {unlimited5h ? 'Unlimited' : `${pct5h}%`}
                    </Text>
                  </View>
                  <View style={[styles.barBg, { backgroundColor: tc.border }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: unlimited5h ? '0%' : `${pct5h}%`,
                          backgroundColor: pct5h >= 90 ? tc.red || '#ef4444' : tc.primary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.usageSub, { color: tc.textMid }]}>
                    Resets in {formatCountdown(current.resets_in_seconds_5h)}
                  </Text>
                </View>

                <View style={styles.usageRow}>
                  <View style={styles.usageHeaderRow}>
                    <Text style={[styles.usageTitle, { color: tc.text }]}>Weekly usage</Text>
                    <Text style={[styles.usagePct, { color: tc.textMid }]}>
                      {unlimitedWeek ? 'Unlimited' : `${pctWeek}%`}
                    </Text>
                  </View>
                  <View style={[styles.barBg, { backgroundColor: tc.border }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: unlimitedWeek ? '0%' : `${pctWeek}%`,
                          backgroundColor: pctWeek >= 90 ? tc.red || '#ef4444' : tc.primary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.usageSub, { color: tc.textMid }]}>
                    Resets in {formatCountdown(current.resets_in_seconds_week)}
                  </Text>
                </View>

                <Text style={[styles.usageFine, { color: tc.textDim }]}>
                  Usage depends on the length and complexity of your conversations.
                </Text>

                {currentPlanId !== 'free' && (
                  <TouchableOpacity
                    onPress={handleManage}
                    style={[styles.manageBtn, { borderColor: tc.border }]}
                  >
                    <Text style={[styles.manageText, { color: tc.text }]}>Manage subscription</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}

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

                {(() => {
                  const copy = PLAN_COPY[p.id];
                  if (!copy) return null;
                  return (
                    <>
                      <View style={styles.planMetaRow}>
                        <Text style={[styles.planMetaLabel, { color: tc.textDim }]}>
                          Usage capacity
                        </Text>
                        <Text style={[styles.planMetaValue, { color: tc.text }]}>
                          {copy.capacity}
                        </Text>
                      </View>
                      <View style={styles.planMetaRow}>
                        <Text style={[styles.planMetaLabel, { color: tc.textDim }]}>
                          Best for
                        </Text>
                        <Text style={[styles.planMetaValue, { color: tc.text }]}>
                          {copy.bestFor}
                        </Text>
                      </View>
                    </>
                  );
                })()}

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
                        : '#1a1a1a',
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
  usageRow: { marginBottom: 14 },
  usageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  usageTitle: { fontSize: 14, fontWeight: '500' },
  usagePct: { fontSize: 13, fontWeight: '600' },
  barBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  usageSub: { fontSize: 12, marginTop: 6 },
  usageFine: { fontSize: 11, fontStyle: 'italic', marginTop: 4, marginBottom: 4 },
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
  planMetaRow: {
    marginBottom: 10,
  },
  planMetaLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
    fontWeight: '600',
  },
  planMetaValue: {
    fontSize: 14,
    lineHeight: 19,
  },
  ctaBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: { fontSize: 15, fontWeight: '600' },
  footnote: { fontSize: 11, textAlign: 'center', marginTop: 16 },
});
