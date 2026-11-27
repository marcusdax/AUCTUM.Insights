import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTIES } from '../src/engine/underwriting';
import {
  buildSensitivityGrid,
  compute21Buydown,
  computeTaxShield,
  decodeShareableDeal,
  encodeShareableDeal,
} from '../src/engine/financing';

describe('Financing Studio, Tax Shield, Sensitivity Matrix & Shareable URLs', () => {
  it('computes 2-1 rate buydown payments and positive seller credit requirement', () => {
    const bd = compute21Buydown(DEFAULT_PROPERTIES[0], 'hold');
    expect(bd.yr1Rate).toBeCloseTo(4.25, 2);
    expect(bd.yr2Rate).toBeCloseTo(5.25, 2);
    expect(bd.yr1Payment).toBeLessThan(bd.yr2Payment);
    expect(bd.yr2Payment).toBeLessThan(bd.yr3PlusPayment);
    expect(bd.requiredSellerCredit).toBeGreaterThan(4000);
    expect(bd.yr1DscrLift).toBeGreaterThan(0.15);
  });

  it('computes 27.5-year residential depreciation tax shield', () => {
    const tax = computeTaxShield(DEFAULT_PROPERTIES[0], 'hold', 0.32);
    expect(tax.depreciableBasis).toBe(Math.round(340000 * 0.8 + 15000));
    expect(tax.annualDepreciation).toBeCloseTo(Math.round(tax.depreciableBasis / 27.5), 0);
    expect(Number.isFinite(tax.afterTaxCocPct)).toBe(true);
  });

  it('builds a 5x5 Rate x Price DSCR sensitivity matrix with monotonic trend', () => {
    const grid = buildSensitivityGrid(DEFAULT_PROPERTIES[0], 'hold');
    expect(grid.priceSteps).toHaveLength(5);
    expect(grid.rateSteps).toHaveLength(5);
    expect(grid.cells).toHaveLength(25);
    // Lowest price & lowest rate [0,0] must have higher DSCR than highest price & highest rate [4,4]
    const best = grid.cells.find(([pi, ri]) => pi === 0 && ri === 0)?.[2] ?? 0;
    const worst = grid.cells.find(([pi, ri]) => pi === 4 && ri === 4)?.[2] ?? 99;
    expect(best).toBeGreaterThan(worst);
  });

  it('round-trips shareable deal URL payloads cleanly', () => {
    const token = encodeShareableDeal({
      v: 71,
      persona: 'broker',
      strategy: 'brrrr',
      parcel: DEFAULT_PROPERTIES[0],
    });
    const decoded = decodeShareableDeal(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.persona).toBe('broker');
    expect(decoded?.strategy).toBe('brrrr');
    expect(decoded?.parcel.address).toBe(DEFAULT_PROPERTIES[0].address);
    expect(decodeShareableDeal('invalid-token!!!')).toBeNull();
  });
});
