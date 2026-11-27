import type { FiduciaryAuditResult, PropertyParcel, StormHazardResult } from './types';

const PII_PATTERNS: { name: string; regex: RegExp; replacement: string }[] = [
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED-SSN]' },
  {
    name: 'Email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[REDACTED-EMAIL]',
  },
  {
    name: 'Phone',
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: '[REDACTED-PHONE]',
  },
  {
    name: 'Account/Routing',
    regex: /\b(?:acct|account|routing)[\s:#-]*\d{6,16}\b/gi,
    replacement: '[REDACTED-ACCOUNT]',
  },
];

export const FIDUCIARY_DISCLAIMER =
  'EDUCATION-ONLY FIDUCIARY NOTICE (SR 11-7): This quantitative analysis is provided strictly for educational and analytical modeling purposes. It does not constitute personalized investment, legal, or tax advice. Verify all assumptions, title records, and financing terms with licensed professionals.';

export function runLocalFiduciaryGuard(text: string): FiduciaryAuditResult {
  let redactedText = text;
  const piiDetections: string[] = [];

  for (const pat of PII_PATTERNS) {
    if (pat.regex.test(redactedText)) {
      piiDetections.push(pat.name);
      redactedText = redactedText.replace(pat.regex, pat.replacement);
    }
    pat.regex.lastIndex = 0;
  }

  return {
    source: 'local-fiduciary-guard',
    compliant: piiDetections.length === 0,
    piiDetections,
    redactedText,
    disclaimer: FIDUCIARY_DISCLAIMER,
    sr117ModelId: 'auctum-insights-uw-v7.0-deterministic',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Local AUCTUM.atlas storm & property catastrophe exposure model
 * (used when MASTERNEX.os /v1/auctum/atlas/signal-to-dossier is offline).
 */
export function evaluateLocalStormHazard(p: PropertyParcel): StormHazardResult {
  const roofAge = Math.max(0, Number(p.roofAgeYears) || 10);
  // Heuristic regional hail/wind corridor weight (Gulf Coast & Texas Plains)
  const inGulfWind = p.lat >= 25.5 && p.lat <= 30.8 && p.lng >= -98.5 && p.lng <= -80.0;
  const inHailAlley = p.lat >= 30.0 && p.lat <= 41.0 && p.lng >= -104.0 && p.lng <= -94.0;
  const regionalBase = inGulfWind ? 0.58 : inHailAlley ? 0.48 : 0.25;
  const roofVulnerability = Math.min(1, roofAge / 25);
  const hazardScore = Math.round(Math.min(100, (regionalBase * 0.55 + roofVulnerability * 0.45) * 100));

  const tier: StormHazardResult['tier'] =
    hazardScore >= 68
      ? 'Elevated Catastrophe'
      : hazardScore >= 42
        ? 'Moderate Hail/Wind'
        : 'Low Exposure';

  const recommendedInsuranceShockPct = Number((12 + hazardScore * 0.35).toFixed(1));
  const recommendedCapexReserve = Math.round((p.sqft || 1800) * (roofAge >= 15 ? 7.5 : 3.2));

  const narrative = `${p.address} carries a ${hazardScore}/100 storm exposure score (${tier}) with a ${roofAge}-year-old roof (${Math.round(
    roofVulnerability * 100
  )}% lifecycle wear). Stress insurance premiums by +${recommendedInsuranceShockPct}% and reserve ~$${recommendedCapexReserve.toLocaleString()} for roof/envelope CapEx.`;

  return {
    source: 'local-hazard-model',
    hazardScore,
    tier,
    roofVulnerability: Number(roofVulnerability.toFixed(2)),
    recommendedInsuranceShockPct,
    recommendedCapexReserve,
    narrative,
  };
}
