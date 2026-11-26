import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTIES } from '../src/engine/underwriting';
import { computeDOEFactorial, runMonteCarloStress } from '../src/engine/doe';

describe('Experimental Design (2^3 Factorial DOE & Monte Carlo)', () => {
  it('generates 8 orthogonal factorial runs with main and 2-way interaction effects', () => {
    const doe = computeDOEFactorial(DEFAULT_PROPERTIES[0], 'hold');
    expect(doe.runs).toHaveLength(8);
    expect(doe.effects).toHaveLength(6);

    const rateMain = doe.effects.find((e) => e.term === 'A');
    const opexMain = doe.effects.find((e) => e.term === 'B');
    const rateOpexInter = doe.effects.find((e) => e.term === 'AB');

    // Higher interest rate and higher OpEx must negatively impact DSCR
    expect(rateMain?.dscrEffect).toBeLessThan(0);
    expect(opexMain?.dscrEffect).toBeLessThan(0);
    expect(rateOpexInter?.kind).toBe('interaction');
    expect(doe.minDscr).toBeLessThanOrEqual(doe.meanDscr);
    expect(doe.meanDscr).toBeLessThanOrEqual(doe.maxDscr);
  });

  it('runs deterministic 1000-trial Monte Carlo with ordered percentiles and 95% CIs', () => {
    const mc1 = runMonteCarloStress(DEFAULT_PROPERTIES[0], 'hold', 1000, 42);
    const mc2 = runMonteCarloStress(DEFAULT_PROPERTIES[0], 'hold', 1000, 42);

    expect(mc1.dataLabel).toContain('synthetic Monte Carlo');
    expect(mc1.dscrP50).toBe(mc2.dscrP50);
    expect(mc1.dscrP10).toBeLessThanOrEqual(mc1.dscrP50);
    expect(mc1.dscrP50).toBeLessThanOrEqual(mc1.dscrP90);
    expect(mc1.dscrCi95[0]).toBeLessThanOrEqual(mc1.dscrCi95[1]);
    expect(mc1.irrP10).toBeLessThanOrEqual(mc1.irrP50);
    expect(mc1.irrP50).toBeLessThanOrEqual(mc1.irrP90);
    const totalBinCount = mc1.histogramBins.reduce((a, b) => a + b.count, 0);
    expect(totalBinCount).toBe(1000);
  });
});
