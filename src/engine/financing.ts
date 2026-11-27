import type { PropertyParcel, UnderwritingStrategy, UserPersonaId } from './types';
import { calcUnderwriting, monthlyMortgagePayment } from './underwriting';

export interface BuydownResult {
  yr1Rate: number;
  yr2Rate: number;
  yr3PlusRate: number;
  yr1Payment: number;
  yr2Payment: number;
  yr3PlusPayment: number;
  yr1MonthlySavings: number;
  yr2MonthlySavings: number;
  requiredSellerCredit: number;
  yr1DscrLift: number;
}

export interface TaxShieldResult {
  depreciableBasis: number;
  annualDepreciation: number;
  taxableIncomeYr1: number;
  estimatedTaxSavingsYr1: number;
  afterTaxCashFlowYr1: number;
  afterTaxCocPct: number;
}

export interface SensitivityGridResult {
  priceSteps: number[];
  rateSteps: number[];
  /** [priceIdx, rateIdx, dscr] */
  cells: [number, number, number][];
}

export interface ShareableDealPayload {
  v: 71;
  persona: UserPersonaId;
  strategy: UnderwritingStrategy;
  parcel: PropertyParcel;
}

/**
 * Computes a standard 2-1 mortgage rate buydown (Year 1: rate - 2%, Year 2: rate - 1%,
 * Year 3+: note rate) and the exact upfront seller credit required to fund the escrow.
 */
export function compute21Buydown(
  p: PropertyParcel,
  strat: UnderwritingStrategy = 'hold'
): BuydownResult {
  const m = calcUnderwriting(p, strat);
  const baseRate = Math.max(2.0, p.rate);
  const yr1Rate = Math.max(1.5, Number((baseRate - 2.0).toFixed(3)));
  const yr2Rate = Math.max(2.0, Number((baseRate - 1.0).toFixed(3)));
  const yr3PlusRate = Number(baseRate.toFixed(3));

  const yr1Payment = monthlyMortgagePayment(m.loan, yr1Rate / 100, 30);
  const yr2Payment = monthlyMortgagePayment(m.loan, yr2Rate / 100, 30);
  const yr3PlusPayment = m.mDebt;

  const yr1MonthlySavings = Math.max(0, yr3PlusPayment - yr1Payment);
  const yr2MonthlySavings = Math.max(0, yr3PlusPayment - yr2Payment);
  const requiredSellerCredit = Math.round(yr1MonthlySavings * 12 + yr2MonthlySavings * 12);
  const yr1Dscr = yr1Payment > 0 ? m.noi / (yr1Payment * 12) : m.dscr;

  return {
    yr1Rate,
    yr2Rate,
    yr3PlusRate,
    yr1Payment: Math.round(yr1Payment),
    yr2Payment: Math.round(yr2Payment),
    yr3PlusPayment: Math.round(yr3PlusPayment),
    yr1MonthlySavings: Math.round(yr1MonthlySavings),
    yr2MonthlySavings: Math.round(yr2MonthlySavings),
    requiredSellerCredit,
    yr1DscrLift: Number((yr1Dscr - m.dscr).toFixed(2)),
  };
}

/**
 * Estimates Year-1 residential straight-line depreciation (27.5 yrs on 80% building basis + rehab)
 * and after-tax cash-on-cash return at the specified marginal tax rate (default 32%).
 */
export function computeTaxShield(
  p: PropertyParcel,
  strat: UnderwritingStrategy = 'hold',
  marginalTaxRate = 0.32
): TaxShieldResult {
  const m = calcUnderwriting(p, strat);
  const depreciableBasis = Math.round(m.price * 0.8 + m.rehab);
  const annualDepreciation = Math.round(depreciableBasis / 27.5);
  // Approximate Year-1 mortgage interest ~ loan * rate * 0.985
  const estYr1Interest = m.loan * m.rate * 0.985;
  const taxableIncomeYr1 = Math.round(m.noi - estYr1Interest - annualDepreciation);
  // Negative taxable income creates a passive loss shield (or zero tax owed on positive cash flow)
  const taxImpact = Math.round(-taxableIncomeYr1 * marginalTaxRate);
  const afterTaxCashFlowYr1 = Math.round(m.aCf + taxImpact);
  const afterTaxCocPct = Number(((afterTaxCashFlowYr1 / Math.max(1, m.cashIn)) * 100).toFixed(2));

  return {
    depreciableBasis,
    annualDepreciation,
    taxableIncomeYr1,
    estimatedTaxSavingsYr1: taxImpact,
    afterTaxCashFlowYr1,
    afterTaxCocPct,
  };
}

/**
 * Builds a 5x5 Rate x Purchase Price DSCR sensitivity matrix centered on the active parcel.
 */
export function buildSensitivityGrid(
  p: PropertyParcel,
  strat: UnderwritingStrategy = 'hold'
): SensitivityGridResult {
  const priceMults = [0.88, 0.94, 1.0, 1.06, 1.12];
  const rateDeltas = [-1.0, -0.5, 0, 0.5, 1.0];

  const priceSteps = priceMults.map((mult) => Math.round((p.price * mult) / 1000) * 1000);
  const rateSteps = rateDeltas.map((d) => Number(Math.max(2.5, p.rate + d).toFixed(2)));
  const cells: [number, number, number][] = [];

  priceSteps.forEach((price, pi) => {
    rateSteps.forEach((rate, ri) => {
      const m = calcUnderwriting({ ...p, price, rate }, strat);
      cells.push([pi, ri, Number(m.dscr.toFixed(2))]);
    });
  });

  return { priceSteps, rateSteps, cells };
}

export function encodeShareableDeal(payload: ShareableDealPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShareableDeal(token: string): ShareableDealPayload | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const bin = atob(padded + '='.repeat(padLen));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && parsed.v === 71 && parsed.parcel && typeof parsed.parcel.address === 'string') {
      return parsed as ShareableDealPayload;
    }
    return null;
  } catch {
    return null;
  }
}
