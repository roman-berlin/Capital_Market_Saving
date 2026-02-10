import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Wallet, PiggyBank, Target, DollarSign, Bell, CheckCircle, PlusCircle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getCurrencySymbol } from '@/lib/currency';
import { PerformanceChart } from '@/components/PerformanceChart';
import { DrawdownChart } from '@/components/DrawdownChart';

import type { Tables } from '@/integrations/supabase/types';

interface TimeSeriesPoint {
  date: string;
  close: number;
  return_pct: number;
  drawdown_pct: number;
}

interface TickerData {
  last_price: number;
  high_52w: number;
  current_drawdown: number;
  time_series: TimeSeriesPoint[];
  error?: string;
}

interface MarketDataResponse {
  tickers: Record<string, TickerData>;
  as_of_date: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<Tables<'portfolio_snapshots'>[]>([]);
  const [latestSnapshot, setLatestSnapshot] = useState<Tables<'portfolio_snapshots'> | null>(null);
  const [ammoState, setAmmoState] = useState<Tables<'ammo_state'> | null>(null);
  const [settings, setSettings] = useState<Tables<'settings'> | null>(null);
  const [latestContribution, setLatestContribution] = useState<Tables<'contributions'> | null>(null);
  const [latestNotification, setLatestNotification] = useState<Tables<'notifications'> | null>(null);
  const [marketState, setMarketState] = useState<Tables<'market_state'> | null>(null);
  
  // Market time series data
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [marketDataLoading, setMarketDataLoading] = useState(true);
  const [marketDataError, setMarketDataError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadData();
      loadMarketData();
    }
  }, [user]);

  const loadData = async () => {
    const [snapshotsRes, ammoRes, settingsRes, notifRes, marketRes] = await Promise.all([
      supabase.from('portfolio_snapshots').select('*').eq('user_id', user!.id).order('snapshot_month', { ascending: true }),
      supabase.from('ammo_state').select('*').eq('user_id', user!.id).maybeSingle(),
      supabase.from('settings').select('*').eq('user_id', user!.id).maybeSingle(),
      supabase.from('notifications').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('market_state').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (snapshotsRes.data) {
      setSnapshots(snapshotsRes.data);
      const latest = snapshotsRes.data[snapshotsRes.data.length - 1] || null;
      setLatestSnapshot(latest);

      // Fetch latest contribution
      if (latest) {
        const { data: contrib } = await supabase
          .from('contributions')
          .select('*')
          .eq('snapshot_id', latest.id)
          .maybeSingle();
        if (contrib) setLatestContribution(contrib);
      }
    }
    if (ammoRes.data) setAmmoState(ammoRes.data);
    if (settingsRes.data) setSettings(settingsRes.data);
    if (notifRes.data) setLatestNotification(notifRes.data);
    if (marketRes.data) setMarketState(marketRes.data);
    setLoading(false);
  };

  const loadMarketData = async () => {
    setMarketDataLoading(true);
    setMarketDataError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('get-market-data', {
        body: { tickers: ['SPY', 'EIS'] }
      });
      
      if (error) {
        console.error('Market data error:', error);
        setMarketDataError('Failed to load market data');
      } else if (data?.error) {
        console.error('Market data API error:', data.error);
        setMarketDataError(data.error);
      } else {
        setMarketData(data);
      }
    } catch (err) {
      console.error('Market data fetch error:', err);
      setMarketDataError('Failed to fetch market data');
    } finally {
      setMarketDataLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  const currency = settings?.currency || 'ILS';
  const currencySymbol = getCurrencySymbol(currency);

  // 3-bucket pie chart with high-contrast colors and translated names
  const pieData = latestSnapshot ? [
    { name: t('chart.snp'), value: Number(latestSnapshot.value_sp), color: '#3b82f6' },
    { name: t('chart.ta125'), value: Number(latestSnapshot.value_ta), color: '#8b5cf6' },
    { name: t('chart.cash'), value: Number(latestSnapshot.cash_value), color: '#22c55e' },
  ].filter(d => d.value > 0) : [];

  const ammoBadges = [
    { label: 'T1', trigger: settings?.tranche_1_trigger || 10, used: ammoState?.tranche_1_used },
    { label: 'T2', trigger: settings?.tranche_2_trigger || 20, used: ammoState?.tranche_2_used },
    { label: 'T3', trigger: settings?.tranche_3_trigger || 30, used: ammoState?.tranche_3_used },
  ];

  // Smart "Ammo ready to reset" indicator logic
  const allAmmoUsed = ammoState?.tranche_1_used && ammoState?.tranche_2_used && ammoState?.tranche_3_used;
  const currentDrawdown = marketState?.drawdown_percent ? Number(marketState.drawdown_percent) : null;
  const rebuildThreshold = settings?.rebuild_threshold || 10;
  const cashPercent = latestSnapshot?.cash_percent ? Number(latestSnapshot.cash_percent) : 0;
  const cashTarget = settings?.cash_target_percent || 30;
  
  const marketRecovered = currentDrawdown !== null && currentDrawdown < rebuildThreshold;
  const cashRebuilt = cashPercent >= cashTarget;
  const showAmmoResetReady = allAmmoUsed && marketRecovered && cashRebuilt;

  const contributionTypeLabels: Record<string, string> = {
    monthly: 'Monthly deposit',
    bonus: 'Bonus / one-time',
    adjustment: 'Manual adjustment',
  };

  // Extract time series data for charts
  const spyTimeSeries = marketData?.tickers?.SPY?.time_series || [];
  const eisTimeSeries = marketData?.tickers?.EIS?.time_series || [];

  // Check if this is a first-time user (no snapshots)
  const isFirstTimeUser = snapshots.length === 0;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground">{t('dashboard.welcome')}</p>
        </div>

        {/* First-time user onboarding banner */}
        {isFirstTimeUser && (
          <Card className="border-primary/50 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                {t('dashboard.welcomeTitle')}
              </CardTitle>
              <CardDescription>
                {t('dashboard.welcomeDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background border">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">1</div>
                  <div>
                    <p className="font-medium">{t('dashboard.step1Title')}</p>
                    <p className="text-sm text-muted-foreground">{t('dashboard.step1Description')}</p>
                    <a href="/settings" className="text-sm text-primary hover:underline mt-1 inline-block">{t('dashboard.goToSettings')}</a>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background border">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">2</div>
                  <div>
                    <p className="font-medium">{t('dashboard.step2Title')}</p>
                    <p className="text-sm text-muted-foreground">{t('dashboard.step2Description')}</p>
                    <a href="/update" className="text-sm text-primary hover:underline mt-1 inline-block">{t('dashboard.createFirstUpdate')}</a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}


        {/* Notification + Market Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Latest Notification - 2 columns on large screens */}
          <div className="lg:col-span-2">
            <Card className="h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {t('dashboard.latestNotification')}
                  {latestNotification && !latestNotification.is_read && (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </CardTitle>
                <Bell className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {latestNotification ? (
                  <>
                    <p className="font-medium text-sm">{latestNotification.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {latestNotification.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(latestNotification.created_at).toLocaleDateString()}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-2">{t('dashboard.notificationsAppear')}</p>
                )}
              </CardContent>
            </Card>
          </div>
          
          {/* Market Charts - 3 columns on large screens */}
          <div className="lg:col-span-3 space-y-6">
            <PerformanceChart 
              spyData={spyTimeSeries}
              ta35Data={eisTimeSeries}
              loading={marketDataLoading}
              error={marketDataError || undefined}
            />
            
            <DrawdownChart 
              spyData={spyTimeSeries}
              ta35Data={eisTimeSeries}
              triggers={{
                t1: settings?.tranche_1_trigger || 10,
                t2: settings?.tranche_2_trigger || 20,
                t3: settings?.tranche_3_trigger || 30,
              }}
              loading={marketDataLoading}
              error={marketDataError || undefined}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
