import type { PropertyParcel, UnderwritingStrategy } from './types';
import { calcUnderwriting } from './underwriting';
import type { HFBenchmarkRow } from '../connectors/huggingface';

export type AllocationObjective = 'cashflow' | 'irr' | 'risk_adjusted';

export interface AllocatedParcel {
  parcel: PropertyParcel;
  cashRequired: number;
  monthlyNet: number;
  irr10Yr: number;
  dscr: number;
  capRate: number;
  score: number;
}

export interface AllocationResult {
  budget: number;
  objective: AllocationObjective;
  selected: AllocatedParcel[];
  skipped: AllocatedParcel[];
  totalCashDeployed: number;
  remainingCash: number;
  totalMonthlyNet: number;
  blendedCapRate: number;
  blendedDscr: number;
  blendedIrr: number;
}

export interface HFSummaryStats {
  totalRows: number;
  sentimentCounts: Record<string, number>;
  hasSentiment: boolean;
  topKeywords: string[];
}

/**
 * Exact 0/1 subset-sum / knapsack optimizer (for <=16 parcels, greedy fallback above)
 * selecting the subset of portfolio parcels that maximizes the chosen objective
 * subject to total cash-to-close <= budget.
 */
export function optimizePortfolioAllocation(
  properties: PropertyParcel[],
  budget: number,
  strategy: UnderwritingStrategy = 'hold',
  objective: AllocationObjective = 'cashflow'
): AllocationResult {
  const safeBudget = Math.max(0, Number(budget) || 0);
  const candidates: AllocatedParcel[] = properties.map((parcel) => {
    const m = calcUnderwriting(parcel, strategy);
    const score =
      objective === 'cashflow'
        ? Math.max(0, m.mCf)
        : objective === 'irr'
          ? Math.max(0, m.irr10Yr) * (m.cashIn / 10000)
          : Math.max(0, m.irr10Yr * Math.min(2.0, m.dscr));
    return {
      parcel,
      cashRequired: Math.round(m.cashIn),
      monthlyNet: Math.round(m.mCf),
      irr10Yr: m.irr10Yr,
      dscr: Number(m.dscr.toFixed(2)),
      capRate: Number(m.capRate.toFixed(2)),
      score,
    };
  });

  let bestMask = 0;
  let bestScore = -1;

  if (candidates.length <= 16) {
    const totalMasks = 1 << candidates.length;
    for (let mask = 0; mask < totalMasks; mask++) {
      let cost = 0;
      let val = 0;
      for (let i = 0; i < candidates.length; i++) {
        if ((mask & (1 << i)) !== 0) {
          cost += candidates[i].cashRequired;
          if (cost > safeBudget) break;
          val += candidates[i].score;
        }
      }
      if (cost <= safeBudget && val > bestScore) {
        bestScore = val;
        bestMask = mask;
      }
    }
  }

  const selected: AllocatedParcel[] = [];
  const skipped: AllocatedParcel[] = [];

  if (candidates.length <= 16) {
    candidates.forEach((c, idx) => {
      if ((bestMask & (1 << idx)) !== 0) selected.push(c);
      else skipped.push(c);
    });
  } else {
    const sorted = [...candidates].sort(
      (a, b) => b.score / Math.max(1, b.cashRequired) - a.score / Math.max(1, a.cashRequired)
    );
    let spent = 0;
    for (const c of sorted) {
      if (spent + c.cashRequired <= safeBudget) {
        selected.push(c);
        spent += c.cashRequired;
      } else {
        skipped.push(c);
      }
    }
  }

  const totalCashDeployed = selected.reduce((a, b) => a + b.cashRequired, 0);
  const remainingCash = Math.max(0, safeBudget - totalCashDeployed);
  const totalMonthlyNet = selected.reduce((a, b) => a + b.monthlyNet, 0);
  const nSel = Math.max(1, selected.length);
  const blendedCapRate = selected.length
    ? Number((selected.reduce((a, b) => a + b.capRate, 0) / nSel).toFixed(2))
    : 0;
  const blendedDscr = selected.length
    ? Number((selected.reduce((a, b) => a + b.dscr, 0) / nSel).toFixed(2))
    : 0;
  const blendedIrr = selected.length
    ? Number((selected.reduce((a, b) => a + b.irr10Yr, 0) / nSel).toFixed(2))
    : 0;

  return {
    budget: safeBudget,
    objective,
    selected,
    skipped,
    totalCashDeployed,
    remainingCash,
    totalMonthlyNet,
    blendedCapRate,
    blendedDscr,
    blendedIrr,
  };
}

/**
 * Automatically summarizes streamed Hugging Face benchmark rows,
 * detecting sentiment labels (e.g., FinGPT positive/neutral/negative) and top terms.
 */
export function summarizeHFStream(rows: HFBenchmarkRow[]): HFSummaryStats {
  const sentimentCounts: Record<string, number> = {};
  const sentimentTokens = [
    'strongly positive',
    'moderately positive',
    'positive',
    'neutral',
    'moderately negative',
    'strongly negative',
    'negative',
  ];

  let hasSentiment = false;
  for (const r of rows) {
    const text = `${r.value} ${r.metric}`.toLowerCase();
    for (const tok of sentimentTokens) {
      if (text.includes(tok)) {
        sentimentCounts[tok] = (sentimentCounts[tok] || 0) + 1;
        hasSentiment = true;
        break;
      }
    }
  }

  const stop = new Set(['the', 'and', 'for', 'this', 'that', 'with', 'from', 'output', 'input', 'what', 'news']);
  const freq: Record<string, number> = {};
  for (const r of rows) {
    const words = `${r.metric} ${r.value}`.toLowerCase().match(/[a-z]{4,}/g) || [];
    for (const w of words) {
      if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);

  return {
    totalRows: rows.length,
    sentimentCounts,
    hasSentiment,
    topKeywords,
  };
}
