import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROPERTIES,
  calcUnderwriting,
  computeIRR,
  monthlyMortgagePayment,
  parsePortfolioCSV,
  portfolioToCSV,
  solveTargetPrice,
} from '../src/engine/underwriting';

describe('Underwriting Engine', () => {
  it('computes accurate 30-year fixed monthly mortgage payment', () => {
    const pmt = monthlyMortgagePayment(300000, 0.06, 30);
    expect(pmt).toBeCloseTo(1798.65, 1);
    expect(monthlyMortgagePayment(0, 0.06, 30)).toBe(0);
  });

  it('computes consistent IRR for standard real estate cash flows', () => {
    const irr = computeIRR([-100000, 10000, 10000, 10000, 10000, 110000]);
    expect(irr).toBeCloseTo(10.0, 1);
  });

  it('calculates institutional metrics for default Burleson parcel', () => {
    const m = calcUnderwriting(DEFAULT_PROPERTIES[0], 'hold');
    expect(m.noi).toBeGreaterThan(20000);
    expect(m.capRate).toBeGreaterThan(6.0);
    expect(m.dscr).toBeGreaterThan(1.1);
    expect(m.irr10Yr).toBeGreaterThan(8.0);
    expect(m.equityMultiple10Yr).toBeGreaterThan(1.5);
    expect(m.breakEvenOccPct).toBeGreaterThan(40);
    expect(m.breakEvenOccPct).toBeLessThan(95);
    expect(m.years).toHaveLength(10);
  });

  it('adjusts cash flow and ARV properly across Hold, BRRRR, and STR strategies', () => {
    const hold = calcUnderwriting(DEFAULT_PROPERTIES[0], 'hold');
    const brrrr = calcUnderwriting(DEFAULT_PROPERTIES[0], 'brrrr');
    const str = calcUnderwriting(DEFAULT_PROPERTIES[0], 'str');

    expect(brrrr.grossMo).toBeGreaterThan(hold.grossMo);
    expect(brrrr.brrrrArv).toBeGreaterThan(hold.price);
    expect(str.grossMo).toBeGreaterThan(brrrr.grossMo);
    expect(str.opexPct).toBeGreaterThan(hold.opexPct);
  });

  it('solves target max purchase price for 1.25x DSCR accurately', () => {
    const p = DEFAULT_PROPERTIES[1];
    const solved = solveTargetPrice(p, 'hold', 'dscr', 1.25);
    expect(solved.achievable).toBe(true);
    const check = calcUnderwriting({ ...p, price: solved.maxPrice }, 'hold');
    expect(check.dscr).toBeGreaterThanOrEqual(1.24);
  });

  it('round-trips portfolio CSV export and import cleanly', () => {
    const csv = portfolioToCSV(DEFAULT_PROPERTIES, 'hold');
    const parsed = parsePortfolioCSV(csv);
    expect(parsed).toHaveLength(DEFAULT_PROPERTIES.length);
    expect(parsed[0].address).toBe(DEFAULT_PROPERTIES[0].address);
    expect(parsed[0].price).toBe(DEFAULT_PROPERTIES[0].price);
    expect(parsed[1].rent).toBe(DEFAULT_PROPERTIES[1].rent);
  });
});
