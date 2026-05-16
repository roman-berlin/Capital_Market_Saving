import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, TrendingDown, TrendingUp, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { runStrategy, calculateDrawdown, type StrategyResult, type MarketStatus } from '@/lib/strategy';
import { getCurrencySymbol } from '@/lib/currency';
import { PortfolioUpdateFlow } from '@/components/PortfolioUpdateFlow';
import type { Tables } from '@/integrations/supabase/types';

export default function Update() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [marketDataLoading, setMarketDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const marketStatusConfig: Record<MarketStatus, { labelKey: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof TrendingUp }> = {
    normal: { labelKey: 'market.normal', variant: 'secondary', icon: TrendingUp },
    correction: { labelKey: 'market.correction', variant: 'outline', icon: TrendingDown },
    bear: { labelKey: 'market.bear', variant: 'destructive', icon: AlertTriangle },
    crash: { labelKey: 'market.crash', variant: 'destructive', icon: AlertTriangle },
  };

  // Total contribution input (user enters this)
  const [totalContribution, setTotalContribution] = useState(0);
  const [contributionCurrency, setContributionCurrency] = useState<'USD' | 'NIS'>('NIS');

  // Portfolio values from last snapshot (for strategy engine)
  const [valueSp, setValueSp] = useState(0);
  const [valueTa, setValueTa] = useState(0);
  const [valueCash, setValueCash] = useState(0);
  
  // Cost basis tracking (cumulative investment amounts)
  const [costBasisSp, setCostBasisSp] = useState(0);
  const [costBasisTa, setCostBasisTa] = useState(0);
  const [costBasisCash, setCostBasisCash] = useState(0);

  const [marketData, setMarketData] = useState<{ 
    SPY: { last_price: number; high_52w: number; current_drawdown: number } | null;
    EIS: { last_price: number; high_52w: number; current_drawdown: number } | null;
    as_of_date: string;
  } | null>(null);
  const [settings, setSettings] = useState<Tables<'settings'> | null>(null);
  const [ammoState, setAmmoState] = useState<Tables<'ammo_state'> | null>(null);
  const [recommendation, setRecommendation] = useState<StrategyResult | null>(null);
  
  // Track if user wants to edit current portfolio values
  const [editingValues, setEditingValues] = useState(false);

  useEffect(() => {
    if (user) {
      loadData();
      fetchMarketData();
    }
  }, [user]);

  const loadData = async () => {
    const [settingsRes, ammoRes, snapshotRes] = await Promise.all([
      supabase.from('settings').select('*').eq('user_id', user!.id).maybeSingle(),
      supabase.from('ammo_state').select('*').eq('user_id', user!.id).maybeSingle(),
      supabase.from('portfolio_snapshots').select('*').eq('user_id', user!.id).order('snapshot_month', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (settingsRes.data) {
      setSettings(settingsRes.data);
      setContributionCurrency(settingsRes.data.currency === 'ILS' ? 'NIS' : (settingsRes.data.currency as 'USD' | 'NIS') || 'NIS');
    }
    if (ammoRes.data) setAmmoState(ammoRes.data);
    if (snapshotRes.data) {
      setValueSp(Number(snapshotRes.data.value_sp) || 0);
      setValueTa(Number(snapshotRes.data.value_ta) || 0);
      setValueCash(Number(snapshotRes.data.cash_value) || 0);
      // Load cost basis from last snapshot
      setCostBasisSp(Number((snapshotRes.data as any).cost_basis_sp) || 0);
      setCostBasisTa(Number((snapshotRes.data as any).cost_basis_ta) || 0);
      setCostBasisCash(Number((snapshotRes.data as any).cost_basis_cash) || 0);
    }
    setLoading(false);
  };

  const fetchMarketData = async () => {
    setMarketDataLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-market-data');
      if (error) throw error;
      // Extract SPY and EIS data from the response structure
      setMarketData({
        SPY: data?.tickers?.SPY || null,
        EIS: data?.tickers?.EIS || null,
        as_of_date: data?.as_of_date || '',
      });
    } catch (err: any) {
      console.error('Failed to fetch market data:', err.message);
    } finally {
      setMarketDataLoading(false);
    }
  };

  // Get percentages from settings
  const snpPercent = (settings as any)?.snp_target_percent ?? 50;
  const ta125Percent = (settings as any)?.ta125_target_percent ?? 25;
  const cashPercent = settings?.cash_target_percent ?? 25;

  // Calculate per-asset contributions based on total and percentages (read-only)
  const contributionSpy = totalContribution * (snpPercent / 100);
  const contributionTa = totalContribution * (ta125Percent / 100);
  const contributionCash = totalContribution * (cashPercent / 100);

  const runStrategyEngine = () => {
    if (!settings || !marketData?.SPY) return null;

    // Calculate new portfolio values after contributions
    const newValueSp = valueSp + contributionSpy;
    const newValueTa = valueTa + contributionTa;
    const newValueCash = valueCash + contributionCash;
    const totalValue = newValueSp + newValueTa + newValueCash;

    const portfolio = {
      valueCash: newValueCash,
      valueSp: newValueSp,
      valueTa: newValueTa,
      totalValue,
      percentCash: totalValue > 0 ? (newValueCash / totalValue) * 100 : 0,
      percentSp: totalValue > 0 ? (newValueSp / totalValue) * 100 : 0,
      percentTa: totalValue > 0 ? (newValueTa / totalValue) * 100 : 0,
    };

    const drawdownPercent = calculateDrawdown(marketData.SPY.last_price, marketData.SPY.high_52w);
    const market = {
      lastPrice: marketData.SPY.last_price,
      high52w: marketData.SPY.high_52w,
      drawdownPercent,
    };

    const ammo = {
      tranche1Used: ammoState?.tranche_1_used ?? false,
      tranche2Used: ammoState?.tranche_2_used ?? false,
      tranche3Used: ammoState?.tranche_3_used ?? false,
    };

    return runStrategy(portfolio, market, ammo, settings);
  };

  const saveUpdate = async () => {
    if (!settings) return;
    setSaving(true);

    const today = new Date();
    const snapshotMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    
    // Calculate new portfolio values after contributions
    const newValueSp = valueSp + contributionSpy;
    const newValueTa = valueTa + contributionTa;
    const newValueCash = valueCash + contributionCash;
    const totalValue = newValueSp + newValueTa + newValueCash;
    const totalContribution = contributionSpy + contributionTa + contributionCash;
    
    // Update cost basis (cumulative contributions per asset)
    const newCostBasisSp = costBasisSp + contributionSpy;
    const newCostBasisTa = costBasisTa + contributionTa;
    const newCostBasisCash = costBasisCash + contributionCash;

    // Auto-run strategy if market data is available
    let strategyResult: StrategyResult | null = null;
    if (marketData?.SPY && settings) {
      strategyResult = runStrategyEngine();
      setRecommendation(strategyResult);
    }

    const drawdownPercent = marketData?.SPY ? calculateDrawdown(marketData.SPY.last_price, marketData.SPY.high_52w) : null;

    try {
      // Save portfolio snapshot (3-bucket model with cost basis)
      const { data: snapshot, error: snapshotError } = await supabase
        .from('portfolio_snapshots')
        .upsert({
          user_id: user!.id,
          snapshot_month: snapshotMonth,
          cash_value: newValueCash,
          stocks_value: newValueSp + newValueTa,
          value_sp: newValueSp,
          value_ta: newValueTa,
          percent_sp: totalValue > 0 ? (newValueSp / totalValue) * 100 : 0,
          percent_ta: totalValue > 0 ? (newValueTa / totalValue) * 100 : 0,
          cost_basis_sp: newCostBasisSp,
          cost_basis_ta: newCostBasisTa,
          cost_basis_cash: newCostBasisCash,
        }, { onConflict: 'user_id,snapshot_month' })
        .select()
        .single();

      if (snapshotError) throw snapshotError;

      // Save contribution if any amount was entered
      if (totalContribution > 0) {
        await supabase
          .from('contributions')
          .upsert({
            user_id: user!.id,
            snapshot_id: snapshot.id,
            amount: totalContribution,
            currency: contributionCurrency,
            contribution_type: 'monthly',
          }, { onConflict: 'snapshot_id' });
      }

      // Only save market state and recommendation if market data is available
      if (marketData?.SPY && strategyResult) {
        // Save market state
        await supabase.from('market_state').insert({
          user_id: user!.id,
          ticker: 'SPY',
          last_price: marketData.SPY.last_price,
          high_52w: marketData.SPY.high_52w,
          as_of_date: marketData.as_of_date,
          drawdown_percent: drawdownPercent,
        });

        // Save recommendation
        await supabase.from('recommendations_log').insert({
          user_id: user!.id,
          snapshot_id: snapshot.id,
          recommendation_type: strategyResult.recommendation_type,
          recommendation_text: strategyResult.recommendation_text,
          transfer_amount: strategyResult.transfer_amount,
          drawdown_percent: drawdownPercent,
          market_status: strategyResult.market_status,
        });

        // Update ammo state if ammo was fired
        if (strategyResult.recommendation_type.startsWith('FIRE_AMMO')) {
          const updates = {
            user_id: user!.id,
            tranche_1_used: strategyResult.recommendation_type === 'FIRE_AMMO_1' ? true : (ammoState?.tranche_1_used ?? false),
            tranche_2_used: strategyResult.recommendation_type === 'FIRE_AMMO_2' ? true : (ammoState?.tranche_2_used ?? false),
            tranche_3_used: strategyResult.recommendation_type === 'FIRE_AMMO_3' ? true : (ammoState?.tranche_3_used ?? false),
          };
          
          await supabase.from('ammo_state').upsert(updates, { onConflict: 'user_id' });
        }

        // Create in-app notification for the recommendation
        const notificationTitle = strategyResult.recommendation_type.startsWith('FIRE_AMMO')
          ? `Tranche deployment recommended`
          : strategyResult.recommendation_type === 'STOP_CASH_OVER_MAX'
          ? 'Cash allocation alert'
          : strategyResult.recommendation_type === 'REBUILD_AMMO'
          ? 'Ammo rebuild recommended'
          : 'Strategy update';

        await supabase.from('notifications').insert({
          user_id: user!.id,
          title: notificationTitle,
          message: strategyResult.recommendation_text,
          notification_type: 'recommendation',
          metadata: {
            recommendation_type: strategyResult.recommendation_type,
            drawdown_percent: drawdownPercent,
            transfer_amount: strategyResult.transfer_amount,
            market_status: strategyResult.market_status,
          },
        });

        toast({ title: t('update.updateSaved') });
      } else {
        toast({ 
          title: t('update.contributionsSaved'), 
          description: marketData?.SPY ? undefined : t('update.marketUnavailable')
        });
      }

      // Reset inputs
      setEditingValues(false);
      // Reset total contribution
      setTotalContribution(0);
      loadData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('common.error'), description: err.message });
    } finally {
      setSaving(false);
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

  if (!settings) {
    return (
      <Layout>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('update.settingsRequired')}</AlertTitle>
          <AlertDescription>{t('update.configureSettings')}</AlertDescription>
        </Alert>
      </Layout>
    );
  }

  const StatusConfig = recommendation ? marketStatusConfig[recommendation.market_status] : null;
  const currencySymbol = getCurrencySymbol(contributionCurrency);

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t('update.title')}</h1>
          <p className="text-muted-foreground">{t('update.subtitle')}</p>
        </div>

        {/* New: 2-step Update Portfolio flow with deposit advisor */}
        <PortfolioUpdateFlow
          targetPercents={{ snp: snpPercent, ta125: ta125Percent, cash: cashPercent }}
        />

        {recommendation && StatusConfig && (
          <Alert>
            <StatusConfig.icon className="h-4 w-4" />
            <AlertTitle className="flex items-center gap-2">
              {t('update.recommendation')}
              <Badge variant={StatusConfig.variant}>{t(StatusConfig.labelKey)}</Badge>
            </AlertTitle>
            <AlertDescription className="mt-2">
              <p className="font-medium">{recommendation.recommendation_type.replace(/_/g, ' ')}</p>
              <p className="mt-1">{recommendation.recommendation_text}</p>
            </AlertDescription>
          </Alert>
        )}

      </div>
    </Layout>
  );
}
