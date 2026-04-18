import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  AssetValues,
  computeDepositAllocation,
  loadHoldings,
  loadTargetAllocation,
  saveHoldings,
} from '@/lib/depositAdvisor';
import { Save, Calculator } from 'lucide-react';

interface Props {
  /** Target allocation pulled from Settings (also mirrored to localStorage). */
  targetPercents: AssetValues;
}

const fmt = (n: number) => `₪${Math.round(n).toLocaleString()}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export function PortfolioUpdateFlow({ targetPercents }: Props) {
  const { toast } = useToast();
  const [holdings, setHoldings] = useState<AssetValues>(() =>
    loadHoldings(),
  );
  const [deposit, setDeposit] = useState<number>(0);

  // Always keep latest target from localStorage in sync if the prop changes
  const target = useMemo<AssetValues>(() => {
    return loadTargetAllocation(targetPercents);
  }, [targetPercents]);

  const total = holdings.snp + holdings.ta125 + holdings.cash;
  const currentPct = {
    snp: total > 0 ? (holdings.snp / total) * 100 : 0,
    ta125: total > 0 ? (holdings.ta125 / total) * 100 : 0,
    cash: total > 0 ? (holdings.cash / total) * 100 : 0,
  };

  const advisor = useMemo(
    () => computeDepositAllocation(holdings, target, deposit || 0),
    [holdings, target, deposit],
  );

  const update = (key: keyof AssetValues, v: string) =>
    setHoldings((h) => ({ ...h, [key]: parseFloat(v) || 0 }));

  const handleSaveHoldings = () => {
    saveHoldings(holdings);
    toast({ title: 'Holdings saved' });
  };

  useEffect(() => {
    // auto-persist on change (debounced via effect)
    const id = setTimeout(() => saveHoldings(holdings), 400);
    return () => clearTimeout(id);
  }, [holdings]);

  const Row = ({
    label,
    color,
    cur,
    tgt,
    proj,
    alloc,
  }: {
    label: string;
    color: string;
    cur: number;
    tgt: number;
    proj: number;
    alloc: number;
  }) => (
    <div className="grid grid-cols-12 items-center gap-2 py-2 border-b last:border-0">
      <div className="col-span-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="font-medium text-sm">{label}</span>
      </div>
      <div className="col-span-3 text-sm tabular-nums">{fmt(alloc)}</div>
      <div className="col-span-2 text-xs text-muted-foreground tabular-nums">{fmtPct(cur)}</div>
      <div className="col-span-2 text-xs text-muted-foreground tabular-nums">→ {fmtPct(tgt)}</div>
      <div className="col-span-2 text-xs font-medium tabular-nums">⇒ {fmtPct(proj)}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Step 1: current holdings */}
      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Current Holdings</CardTitle>
          <CardDescription>
            Enter the current value of each asset (₪) as shown in your bank app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>SNP (₪)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={holdings.snp || ''}
                onChange={(e) => update('snp', e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>TA125 (₪)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={holdings.ta125 || ''}
                onChange={(e) => update('ta125', e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>Cash (₪)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={holdings.cash || ''}
                onChange={(e) => update('cash', e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="rounded-md bg-muted p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total portfolio value</span>
              <span className="font-semibold tabular-nums">{fmt(total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div>SNP {fmtPct(currentPct.snp)}</div>
              <div>TA125 {fmtPct(currentPct.ta125)}</div>
              <div>Cash {fmtPct(currentPct.cash)}</div>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={handleSaveHoldings}>
            <Save className="mr-2 h-4 w-4" /> Save holdings
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: deposit advisor */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" /> Step 2 — Deposit Allocation Advisor
          </CardTitle>
          <CardDescription>
            Enter an amount to deposit. We'll split it across the 3 assets to move you
            closer to your target allocation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Amount to deposit (₪)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={deposit || ''}
              onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)}
              placeholder="0"
            />
          </div>

          <div className="rounded-md border p-3">
            <div className="grid grid-cols-12 gap-2 pb-2 border-b text-xs uppercase tracking-wide text-muted-foreground">
              <div className="col-span-3">Asset</div>
              <div className="col-span-3">Allocate</div>
              <div className="col-span-2">Now</div>
              <div className="col-span-2">Target</div>
              <div className="col-span-2">After</div>
            </div>
            <Row
              label="SNP"
              color="bg-blue-500"
              cur={advisor.currentPercents.snp}
              tgt={target.snp}
              proj={advisor.projectedPercents.snp}
              alloc={advisor.allocations.snp}
            />
            <Row
              label="TA125"
              color="bg-violet-500"
              cur={advisor.currentPercents.ta125}
              tgt={target.ta125}
              proj={advisor.projectedPercents.ta125}
              alloc={advisor.allocations.ta125}
            />
            <Row
              label="Cash"
              color="bg-emerald-500"
              cur={advisor.currentPercents.cash}
              tgt={target.cash}
              proj={advisor.projectedPercents.cash}
              alloc={advisor.allocations.cash}
            />
          </div>

          {deposit > 0 && (
            <p className="text-xs text-muted-foreground">
              Allocations prioritize the most underweight assets first to minimize the
              gap to your target after the deposit.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
