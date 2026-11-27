import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTIES } from '../src/engine/underwriting';
import { optimizePortfolioAllocation, summarizeHFStream } from '../src/engine/optimizer';

describe('Portfolio Capital Optimizer & HF Stream Summarizer', () => {
  it('respects cash budget constraints and selects optimal subset', () => {
    // Low budget: can only afford at most 1 parcel (~$93k cash-in for Burleson)
    const tight = optimizePortfolioAllocation(DEFAULT_PROPERTIES, 120000, 'hold', 'cashflow');
    expect(tight.totalCashDeployed).toBeLessThanOrEqual(120000);
    expect(tight.selected.length).toBe(1);
    expect(tight.remainingCash).toBe(120000 - tight.totalCashDeployed);

    // High budget: can afford all 3 default parcels
    const ample = optimizePortfolioAllocation(DEFAULT_PROPERTIES, 500000, 'hold', 'irr');
    expect(ample.selected.length).toBe(3);
    expect(ample.skipped.length).toBe(0);
    expect(ample.blendedIrr).toBeGreaterThan(8);
  });

  it('returns empty selection when budget is below smallest parcel cash-in', () => {
    const zero = optimizePortfolioAllocation(DEFAULT_PROPERTIES, 10000, 'hold', 'risk_adjusted');
    expect(zero.selected).toHaveLength(0);
    expect(zero.totalCashDeployed).toBe(0);
    expect(zero.remainingCash).toBe(10000);
  });

  it('summarizes FinGPT sentiment rows and extracts top keywords', () => {
    const summary = summarizeHFStream([
      { market: 'ds #1', metric: 'input: Revenue beat forecast', value: 'output: positive', context: '' },
      { market: 'ds #2', metric: 'input: Safety violation warning', value: 'output: moderately negative', context: '' },
      { market: 'ds #3', metric: 'input: Research head appointed', value: 'output: neutral', context: '' },
    ]);
    expect(summary.totalRows).toBe(3);
    expect(summary.hasSentiment).toBe(true);
    expect(summary.sentimentCounts['positive']).toBe(1);
    expect(summary.sentimentCounts['moderately negative']).toBe(1);
    expect(summary.sentimentCounts['neutral']).toBe(1);
    expect(summary.topKeywords.length).toBeGreaterThan(0);
  });
});
