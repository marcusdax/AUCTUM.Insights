import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTIES } from '../src/engine/underwriting';
import {
  DEFAULT_WATERFALL_TERMS,
  computeSyndicationWaterfall,
  waterfallToCSV,
} from '../src/engine/waterfall';

describe('LP/GP Syndication Equity Waterfall Engine', () => {
  it('computes 10-year LP and GP distributions with exact equity conservation', () => {
    const wf = computeSyndicationWaterfall(DEFAULT_PROPERTIES[0], 'hold', DEFAULT_WATERFALL_TERMS);
    expect(wf.schedule).toHaveLength(10);
    expect(wf.lpEquityIn + wf.gpEquityIn).toBe(wf.totalEquityRequired);
    expect(wf.lpTotalDistributions).toBeGreaterThan(wf.lpEquityIn);
    expect(wf.lpEquityMultiple).toBeGreaterThan(1.4);
    expect(wf.gpEquityMultiple).toBeGreaterThanOrEqual(wf.lpEquityMultiple);
    expect(wf.lpIrr).toBeGreaterThan(6.0);
  });

  it('increases GP promote when promote split increases on profitable deal', () => {
    const lowPromote = computeSyndicationWaterfall(DEFAULT_PROPERTIES[0], 'hold', {
      ...DEFAULT_WATERFALL_TERMS,
      promoteSplitGpPct: 20,
    });
    const highPromote = computeSyndicationWaterfall(DEFAULT_PROPERTIES[0], 'hold', {
      ...DEFAULT_WATERFALL_TERMS,
      promoteSplitGpPct: 40,
    });
    expect(highPromote.gpPromoteEarned).toBeGreaterThan(lowPromote.gpPromoteEarned);
    expect(highPromote.gpEquityMultiple).toBeGreaterThan(lowPromote.gpEquityMultiple);
  });

  it('exports valid 10-year CSV waterfall schedule', () => {
    const wf = computeSyndicationWaterfall(DEFAULT_PROPERTIES[0], 'hold');
    const csv = waterfallToCSV(wf);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(11);
    expect(lines[0]).toContain('lp_distribution,gp_distribution');
  });
});
