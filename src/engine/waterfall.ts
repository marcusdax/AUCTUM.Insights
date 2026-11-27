import type { PropertyParcel, UnderwritingStrategy } from './types';
import { calcUnderwriting, computeIRR, remainingLoanBalance } from './underwriting';

export interface WaterfallTerms {
  lpEquityPct: number; // e.g., 90 (%)
  prefRatePct: number; // e.g., 8.0 (% annual pref to LP)
  promoteSplitGpPct: number; // e.g., 30 (% of excess profits to GP)
  acqFeePct: number; // e.g., 1.0 (% of purchase price)
  amFeePct: number; // e.g., 1.5 (% of EGI)
}

export interface WaterfallYearRow {
  year: number;
  distributableCash: number;
  amFee: number;
  lpDistribution: number;
  gpDistribution: number;
  lpPrefAccrued: number;
}

export interface WaterfallResult {
  terms: WaterfallTerms;
  totalEquityRequired: number;
  lpEquityIn: number;
  gpEquityIn: number;
  acqFee: number;
  totalAmFees: number;
  lpTotalDistributions: number;
  gpTotalDistributions: number;
  gpPromoteEarned: number;
  lpIrr: number;
  gpIrr: number;
  lpEquityMultiple: number;
  gpEquityMultiple: number;
  schedule: WaterfallYearRow[];
}

export const DEFAULT_WATERFALL_TERMS: WaterfallTerms = {
  lpEquityPct: 90,
  prefRatePct: 8.0,
  promoteSplitGpPct: 30,
  acqFeePct: 1.0,
  amFeePct: 1.5,
};

/**
 * 10-year 2-tier institutional LP/GP syndication equity waterfall:
 *  - Tier 1: Return of LP preferred return (cumulative) + return of contributed capital on exit
 *  - Tier 2: Remaining upside split (1 - promoteSplitGpPct) to LP / promoteSplitGpPct to GP
 */
export function computeSyndicationWaterfall(
  p: PropertyParcel,
  strat: UnderwritingStrategy = 'hold',
  terms: WaterfallTerms = DEFAULT_WATERFALL_TERMS
): WaterfallResult {
  const m = calcUnderwriting(p, strat);
  const lpShare = Math.min(0.99, Math.max(0.5, terms.lpEquityPct / 100));
  const gpShare = 1 - lpShare;
  const prefRate = Math.max(0, terms.prefRatePct / 100);
  const gpPromotePct = Math.min(0.6, Math.max(0, terms.promoteSplitGpPct / 100));

  const acqFee = Math.round(m.price * Math.max(0, terms.acqFeePct / 100));
  const totalEquityRequired = Math.round(m.cashIn + acqFee);
  const lpEquityIn = Math.round(totalEquityRequired * lpShare);
  const gpEquityIn = Math.max(1, totalEquityRequired - lpEquityIn);

  const schedule: WaterfallYearRow[] = [];
  const lpFlows: number[] = [-lpEquityIn];
  const gpFlows: number[] = [-gpEquityIn + acqFee];

  let lpPrefBalance = 0;
  let totalAmFees = 0;
  let lpTotalDistributions = 0;
  let gpTotalDistributions = 0;
  let gpPromoteEarned = 0;

  const sellingCostPct = 0.06;

  for (let yr = 1; yr <= 10; yr++) {
    const yrEgi = m.egiMo * 12 * Math.pow(1 + m.rentGrowthPct, yr - 1);
    const amFee = Math.round(yrEgi * Math.max(0, terms.amFeePct / 100));
    totalAmFees += amFee;

    const yrNoi = m.noi * Math.pow(1 + m.rentGrowthPct, yr - 1);
    const opCf = yrNoi - m.aDebt - amFee;

    let exitNet = 0;
    if (yr === 10) {
      const val = (m.price + m.rehab * 0.5) * Math.pow(1 + m.appreciationPct, 10);
      const rem = remainingLoanBalance(m.loan, m.rate, 120, 30);
      exitNet = Math.max(0, val * (1 - sellingCostPct) - rem);
    }

    const distributable = opCf + exitNet;
    lpPrefBalance += lpEquityIn * prefRate;

    let lpDist = 0;
    let gpDist = 0;

    if (distributable <= 0) {
      // Negative operating cash flow split pro-rata as capital call
      lpDist = distributable * lpShare;
      gpDist = distributable * gpShare;
    } else {
      let remCash = distributable;

      // 1. Pay accrued LP preferred return first
      const prefPay = Math.min(remCash, lpPrefBalance);
      lpDist += prefPay;
      lpPrefBalance -= prefPay;
      remCash -= prefPay;

      // 2. On exit (Year 10), return original capital pro-rata before promote
      if (yr === 10 && remCash > 0) {
        const capReturn = Math.min(remCash, totalEquityRequired);
        lpDist += capReturn * lpShare;
        gpDist += capReturn * gpShare;
        remCash -= capReturn;
      }

      // 3. Tier 2 promote split on remaining excess cash
      if (remCash > 0) {
        const gpExcess = remCash * gpPromotePct;
        const lpExcess = remCash - gpExcess;
        lpDist += lpExcess;
        gpDist += gpExcess;
        gpPromoteEarned += Math.max(0, gpExcess - remCash * gpShare);
      }
    }

    const lpRounded = Math.round(lpDist);
    const gpRounded = Math.round(gpDist);

    lpTotalDistributions += lpRounded;
    gpTotalDistributions += gpRounded;
    lpFlows.push(lpRounded);
    gpFlows.push(gpRounded + amFee);

    schedule.push({
      year: yr,
      distributableCash: Math.round(distributable),
      amFee,
      lpDistribution: lpRounded,
      gpDistribution: gpRounded,
      lpPrefAccrued: Math.round(lpPrefBalance),
    });
  }

  const lpIrr = computeIRR(lpFlows);
  const gpIrr = computeIRR(gpFlows);
  const lpEquityMultiple = Number((lpTotalDistributions / Math.max(1, lpEquityIn)).toFixed(2));
  const gpEquityMultiple = Number(
    ((gpTotalDistributions + acqFee + totalAmFees) / Math.max(1, gpEquityIn)).toFixed(2)
  );

  return {
    terms,
    totalEquityRequired,
    lpEquityIn,
    gpEquityIn,
    acqFee,
    totalAmFees,
    lpTotalDistributions,
    gpTotalDistributions,
    gpPromoteEarned: Math.round(gpPromoteEarned),
    lpIrr,
    gpIrr,
    lpEquityMultiple,
    gpEquityMultiple,
    schedule,
  };
}

export function waterfallToCSV(res: WaterfallResult): string {
  const header = 'year,distributable_cash,am_fee,lp_distribution,gp_distribution,lp_pref_remaining';
  const rows = res.schedule.map(
    (r) =>
      `${r.year},${r.distributableCash},${r.amFee},${r.lpDistribution},${r.gpDistribution},${r.lpPrefAccrued}`
  );
  return [header, ...rows].join('\n');
}
