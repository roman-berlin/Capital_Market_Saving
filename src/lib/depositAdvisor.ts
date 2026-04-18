// Deposit allocation advisor: distributes a deposit across 3 assets to move
// the portfolio closer to its target allocation.

export interface AssetValues {
  snp: number;
  ta125: number;
  cash: number;
}

export interface AllocationResult {
  allocations: AssetValues; // amount of deposit allocated to each asset
  projected: AssetValues;   // resulting absolute values after deposit
  projectedPercents: AssetValues; // resulting %
  currentPercents: AssetValues;
}

/**
 * Greedy water-filling: prioritize the most underweight assets first.
 * Computes target absolute values for the new total, then funds the
 * largest shortfalls until the deposit is exhausted.
 */
export function computeDepositAllocation(
  current: AssetValues,
  targetPercents: AssetValues,
  deposit: number,
): AllocationResult {
  const currentTotal = current.snp + current.ta125 + current.cash;
  const newTotal = currentTotal + deposit;

  const targetValues: AssetValues = {
    snp: (newTotal * targetPercents.snp) / 100,
    ta125: (newTotal * targetPercents.ta125) / 100,
    cash: (newTotal * targetPercents.cash) / 100,
  };

  // Shortfall per asset (negative => already overweight, ignore)
  const shortfalls: AssetValues = {
    snp: Math.max(0, targetValues.snp - current.snp),
    ta125: Math.max(0, targetValues.ta125 - current.ta125),
    cash: Math.max(0, targetValues.cash - current.cash),
  };

  const totalShortfall = shortfalls.snp + shortfalls.ta125 + shortfalls.cash;

  let allocations: AssetValues = { snp: 0, ta125: 0, cash: 0 };

  if (deposit <= 0) {
    // no-op
  } else if (totalShortfall <= 0) {
    // Already at/over target everywhere — split by target weights
    allocations = {
      snp: (deposit * targetPercents.snp) / 100,
      ta125: (deposit * targetPercents.ta125) / 100,
      cash: (deposit * targetPercents.cash) / 100,
    };
  } else if (deposit <= totalShortfall) {
    // Pro-rata fill of shortfalls
    allocations = {
      snp: (deposit * shortfalls.snp) / totalShortfall,
      ta125: (deposit * shortfalls.ta125) / totalShortfall,
      cash: (deposit * shortfalls.cash) / totalShortfall,
    };
  } else {
    // Fill all shortfalls fully, distribute remainder by target weights
    const remainder = deposit - totalShortfall;
    allocations = {
      snp: shortfalls.snp + (remainder * targetPercents.snp) / 100,
      ta125: shortfalls.ta125 + (remainder * targetPercents.ta125) / 100,
      cash: shortfalls.cash + (remainder * targetPercents.cash) / 100,
    };
  }

  const projected: AssetValues = {
    snp: current.snp + allocations.snp,
    ta125: current.ta125 + allocations.ta125,
    cash: current.cash + allocations.cash,
  };

  const safe = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
  const currentPercents: AssetValues = {
    snp: safe(current.snp, currentTotal),
    ta125: safe(current.ta125, currentTotal),
    cash: safe(current.cash, currentTotal),
  };
  const projectedPercents: AssetValues = {
    snp: safe(projected.snp, newTotal),
    ta125: safe(projected.ta125, newTotal),
    cash: safe(projected.cash, newTotal),
  };

  return { allocations, projected, projectedPercents, currentPercents };
}

const TARGET_KEY = 'portfolio.targetAllocation';
const HOLDINGS_KEY = 'portfolio.currentHoldings';

export function loadTargetAllocation(fallback: AssetValues): AssetValues {
  try {
    const raw = localStorage.getItem(TARGET_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

export function saveTargetAllocation(target: AssetValues) {
  try { localStorage.setItem(TARGET_KEY, JSON.stringify(target)); } catch {}
}

export function loadHoldings(): AssetValues {
  try {
    const raw = localStorage.getItem(HOLDINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { snp: 0, ta125: 0, cash: 0 };
}

export function saveHoldings(h: AssetValues) {
  try { localStorage.setItem(HOLDINGS_KEY, JSON.stringify(h)); } catch {}
}
