import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTIES, calcUnderwriting } from '../src/engine/underwriting';
import { computeDOEFactorial, runMonteCarloStress } from '../src/engine/doe';
import { computeLocalShapley } from '../src/engine/shapley';
import { evaluateLocalStormHazard } from '../src/engine/fiduciary';
import {
  computeEconometricModel,
  computeHuffSpatialGravity,
  computePowerAnalysis,
  generateScientificManuscript,
  papersToBibTeX,
  runVerificationContract,
} from '../src/engine/scientificApps';
import { hfRowsToCSV } from '../src/connectors/huggingface';

describe('AUCTUM Scientific Apps Suite', () => {
  it('computes accurate two-sample statistical power & sample size (Cohen d=0.5, alpha=0.05, power=0.80 -> ~63/arm)', () => {
    const pwr = computePowerAnalysis(0.05, 0.8, 0.5);
    expect(pwr.nPerArm).toBeGreaterThanOrEqual(60);
    expect(pwr.nPerArm).toBeLessThanOrEqual(66);
    expect(pwr.totalSampleSize).toBe(pwr.nPerArm * 2);
    expect(pwr.powerCurve).toHaveLength(8);
    expect(pwr.powerCurve[7].power).toBeGreaterThan(pwr.powerCurve[0].power);
  });

  it('computes OLS regression and VaR/CVaR tail risk across portfolio', () => {
    const econ = computeEconometricModel(DEFAULT_PROPERTIES, DEFAULT_PROPERTIES[0], 'hold', 1.0);
    expect(econ.n).toBe(3);
    expect(econ.slope).toBeGreaterThan(0);
    expect(econ.rSquared).toBeGreaterThan(0.5);
    expect(econ.cvar95AnnualCf).toBeLessThanOrEqual(econ.var95AnnualCf);
  });

  it('computes Huff gravity spatial score with distance-decay monotonicity', () => {
    const lowDecay = computeHuffSpatialGravity(DEFAULT_PROPERTIES[0], undefined, 1.0);
    const highDecay = computeHuffSpatialGravity(DEFAULT_PROPERTIES[0], undefined, 2.5);
    expect(lowDecay.gravityScore).toBeGreaterThan(highDecay.gravityScore);
    expect(lowDecay.hexCell).toContain('h3-r10:');
  });

  it('audits the MASTERNEX honest-by-construction verification contract', () => {
    const p = DEFAULT_PROPERTIES[0];
    const m = calcUnderwriting(p, 'hold');
    const doe = computeDOEFactorial(p, 'hold');
    const mc = runMonteCarloStress(p, 'hold', 500, 42);
    const attr = computeLocalShapley(m, doe, 70, p.lat, p.lng);
    const checks = runVerificationContract({ mc, doe, attr });

    expect(checks).toHaveLength(5);
    expect(checks.find((c) => c.id === 'synthetic-label')?.passed).toBe(true);
    expect(checks.find((c) => c.id === 'shapley-conservation')?.passed).toBe(true);
    expect(checks.find((c) => c.id === 'bootstrap-ci')?.passed).toBe(true);
  });

  it('generates publication-ready LaTeX, Markdown, BibTeX, and HF CSV exports', () => {
    const p = DEFAULT_PROPERTIES[0];
    const m = calcUnderwriting(p, 'hold');
    const doe = computeDOEFactorial(p, 'hold');
    const mc = runMonteCarloStress(p, 'hold', 200, 42);
    const attr = computeLocalShapley(m, doe, 70, p.lat, p.lng);
    const hazard = evaluateLocalStormHazard(p);
    const citations = [
      { source: 'Nature', title: 'Climate Risk in Housing', year: '2025', url: 'https://nature.com', snippet: 'Test' },
    ];

    const tex = generateScientificManuscript({ format: 'latex', parcel: p, metrics: m, doe, mc, attr, hazard, citations });
    expect(tex).toContain('\\documentclass[11pt]{article}');
    expect(tex).toContain('\\toprule');
    expect(tex).toContain('Climate Risk in Housing');

    const bib = papersToBibTeX(citations);
    expect(bib).toContain('@article{auctum2025ref1');

    const csv = hfRowsToCSV([{ market: 'm1', metric: 'k', value: 'v', context: 'c' }]);
    expect(csv).toContain('market,metric,value,context');
  });
});
