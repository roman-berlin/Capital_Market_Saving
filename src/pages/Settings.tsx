import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, RotateCcw, User, Mail } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';
import { saveTargetAllocation } from '@/lib/depositAdvisor';

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [settings, setSettings] = useState<Partial<Tables<'settings'> & { snp_target_percent?: number; ta125_target_percent?: number }>>({
    snp_target_percent: 50,
    ta125_target_percent: 25,
    cash_target_percent: 25,
    tranche_1_trigger: 10,
    tranche_2_trigger: 20,
    tranche_3_trigger: 30,
    rebuild_threshold: 10,
    cash_min_pct: 20,
    cash_max_pct: 35,
  });
  
  // Calculate sum of target allocations
  const allocationSum = (settings.snp_target_percent || 0) + (settings.ta125_target_percent || 0) + (settings.cash_target_percent || 0);
  const allocationError = allocationSum !== 100;

  useEffect(() => {
    if (user) {
      fetchSettings();
      // Load profile name from user metadata
      setProfileName(user.user_metadata?.name || '');
    }
  }, [user]);

  const fetchSettings = async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', user!.id)
      .maybeSingle();

    if (error) {
      toast({ variant: 'destructive', title: t('common.error'), description: error.message });
    } else if (data) {
      setSettings(data);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    // Validate allocation sum
    if (allocationError) {
      toast({ variant: 'destructive', title: t('common.error'), description: t('settings.allocationMustEqual100') });
      return;
    }
    
    setSaving(true);
    const { error } = await supabase
      .from('settings')
      .upsert({
        ...settings,
        // Also update stocks_target_percent for backwards compatibility
        stocks_target_percent: (settings.snp_target_percent || 0) + (settings.ta125_target_percent || 0),
        user_id: user!.id,
      }, { onConflict: 'user_id' });

    // Mirror target allocation to localStorage for the deposit advisor
    saveTargetAllocation({
      snp: settings.snp_target_percent || 0,
      ta125: settings.ta125_target_percent || 0,
      cash: settings.cash_target_percent || 0,
    });

    if (error) {
      toast({ variant: 'destructive', title: t('common.error'), description: error.message });
    } else {
      toast({ title: t('settings.saved') });
    }
    setSaving(false);
  };

  const handleUpdateName = async () => {
    if (!profileName.trim()) {
      toast({ variant: 'destructive', title: t('common.error'), description: t('settings.nameEmpty') });
      return;
    }
    if (profileName.length > 100) {
      toast({ variant: 'destructive', title: t('common.error'), description: t('settings.nameTooLong') });
      return;
    }

    setSavingName(true);
    const { error } = await supabase.auth.updateUser({
      data: { name: profileName.trim() }
    });

    if (error) {
      toast({ variant: 'destructive', title: t('common.error'), description: error.message });
    } else {
      toast({ title: t('settings.nameUpdated') });
    }
    setSavingName(false);
  };

  const handleResetAmmo = async () => {
    const { error } = await supabase
      .from('ammo_state')
      .upsert({
        user_id: user!.id,
        tranche_1_used: false,
        tranche_2_used: false,
        tranche_3_used: false,
      }, { onConflict: 'user_id' });

    if (error) {
      toast({ variant: 'destructive', title: t('common.error'), description: error.message });
    } else {
      toast({ title: t('settings.ammoReset') });
    }
    setConfirmReset(false);
  };

  const handleSendTestEmail = async () => {
    setSendingTestEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-ammo-alert', {
        body: {
          recommendation_type: 'test_email',
          recommendation_text: 'This is a test email to verify your email notification setup is working correctly. If you received this, your domain verification with Resend is complete!',
          drawdown_percent: 5.5,
          transfer_amount: 1000,
          market_status: 'normal',
        },
      });

      if (error) {
        toast({ variant: 'destructive', title: t('common.error'), description: error.message });
      } else {
        toast({ title: t('settings.testEmailSent'), description: `${t('settings.checkInbox')} ${user?.email}` });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('common.error'), description: err.message || 'Failed to send test email' });
    } finally {
      setSendingTestEmail(false);
    }
  };

  const updateField = (field: string, value: number | string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
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

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
          <p className="text-muted-foreground">{t('settings.subtitle')}</p>
        </div>

        {/* Profile Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {t('settings.profile')}
            </CardTitle>
            <CardDescription>{t('settings.profileDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings.email')}</Label>
              <Input
                type="email"
                value={user?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">{t('settings.emailCannotChange')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profileName">{t('settings.fullName')}</Label>
              <Input
                id="profileName"
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder={t('settings.enterFullName')}
                maxLength={100}
              />
            </div>
            <Button onClick={handleUpdateName} disabled={savingName} variant="outline">
              {savingName ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t('settings.updateName')}
            </Button>
          </CardContent>
        </Card>

        {/* Email Notifications Test */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {t('settings.emailNotifications')}
            </CardTitle>
            <CardDescription>{t('settings.testEmailSetup')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('settings.testEmailSetup')}
            </p>
            <Button onClick={handleSendTestEmail} disabled={sendingTestEmail} variant="outline">
              {sendingTestEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              {t('settings.sendTestEmail')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.targetAllocation')}</CardTitle>
            <CardDescription>{t('settings.allocationDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t('settings.snpPercent')}</Label>
                <Input
                  type="number"
                  value={settings.snp_target_percent}
                  onChange={(e) => updateField('snp_target_percent', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settings.ta125Percent')}</Label>
                <Input
                  type="number"
                  value={settings.ta125_target_percent}
                  onChange={(e) => updateField('ta125_target_percent', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settings.cashPercent')}</Label>
                <Input
                  type="number"
                  value={settings.cash_target_percent}
                  onChange={(e) => updateField('cash_target_percent', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className={`text-sm font-medium ${allocationError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {t('settings.total')}: {allocationSum}%{allocationError && ` — ${t('settings.mustEqual100')}`}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.ammoTriggers')}</CardTitle>
            <CardDescription>{t('settings.ammoTriggersDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t('settings.tranche1')}</Label>
                <Input
                  type="number"
                  value={settings.tranche_1_trigger}
                  onChange={(e) => updateField('tranche_1_trigger', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settings.tranche2')}</Label>
                <Input
                  type="number"
                  value={settings.tranche_2_trigger}
                  onChange={(e) => updateField('tranche_2_trigger', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settings.tranche3')}</Label>
                <Input
                  type="number"
                  value={settings.tranche_3_trigger}
                  onChange={(e) => updateField('tranche_3_trigger', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('settings.rebuildThreshold')}</Label>
              <Input
                type="number"
                value={settings.rebuild_threshold}
                onChange={(e) => updateField('rebuild_threshold', parseFloat(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">{t('settings.rebuildThresholdDescription')}</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {t('settings.saveSettings')}
          </Button>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <RotateCcw className="mr-2 h-4 w-4" />
                {t('settings.resetAmmo')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('settings.resetAmmoTitle')}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>{t('settings.resetAmmoDescription')}</p>
                    <div className="bg-muted p-3 rounded-md space-y-2 text-sm">
                      <p className="font-medium">{t('settings.doesNotMoveMoney')}</p>
                      <p>{t('settings.onlyResetsStatus')}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.resetAmmoUseCase')}
                    </p>
                    <div className="flex items-center space-x-2 pt-2">
                      <Checkbox 
                        id="confirm" 
                        checked={confirmReset}
                        onCheckedChange={(checked) => setConfirmReset(checked === true)}
                      />
                      <label
                        htmlFor="confirm"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {t('settings.confirmReset')}
                      </label>
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmReset(false)}>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetAmmo} disabled={!confirmReset}>
                  {t('settings.resetAmmo')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </Layout>
  );
}
