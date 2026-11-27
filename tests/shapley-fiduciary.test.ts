import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTIES, calcUnderwriting } from '../src/engine/underwriting';
import { computeDOEFactorial } from '../src/engine/doe';
import { computeLocalShapley } from '../src/engine/shapley';
import { evaluateLocalStormHazard, runLocalFiduciaryGuard } from '../src/engine/fiduciary';

describe('Shapley Attribution, Fiduciary Guard & Storm Hazard', () => {
  it('exact 3-player Shapley NADE/GIE/BNE attribution sums to exactly 10,000 bps', () => {
    const p = DEFAULT_PROPERTIES[0];
    const m = calcUnderwriting(p, 'hold');
    const doe = computeDOEFactorial(p, 'hold');
    const attr = computeLocalShapley(m, doe, 74, p.lat, p.lng);

    expect(attr.nadeBps + attr.gieBps + attr.bneBps).toBe(10000);
    expect(attr.nadeBps).toBeGreaterThan(0);
    expect(attr.gieBps).toBeGreaterThan(0);
    expect(attr.bneBps).toBeGreaterThan(0);
    expect(attr.hexCell).toContain('h3-r10:');
    expect(attr.source).toBe('local-exact-shapley');
  });

  it('detects and redacts PII under Fiduciary OS guardrails', () => {
    const raw = 'Client SSN 123-45-6789 email alice@example.com phone 512-555-0199 acct: 99887766';
    const res = runLocalFiduciaryGuard(raw);

    expect(res.compliant).toBe(false);
    expect(res.piiDetections).toEqual(expect.arrayContaining(['SSN', 'Email', 'Phone', 'Account/Routing']));
    expect(res.redactedText).not.toContain('123-45-6789');
    expect(res.redactedText).not.toContain('alice@example.com');
    expect(res.redactedText).toContain('[REDACTED-SSN]');
  });

  it('scores Gulf Coast older roof higher than newer inland roof', () => {
    const houston = evaluateLocalStormHazard(DEFAULT_PROPERTIES[1]);
    const austin = evaluateLocalStormHazard(DEFAULT_PROPERTIES[2]);
    expect(houston.hazardScore).toBeGreaterThan(austin.hazardScore);
    expect(houston.recommendedCapexReserve).toBeGreaterThan(0);
  });
});
