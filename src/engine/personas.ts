import type { PersonaProfile, UserPersonaId } from './types';

export const PERSONA_PROFILES: Record<UserPersonaId, PersonaProfile> = {
  pe_ic: {
    id: 'pe_ic',
    label: 'Institutional PE / IC Analyst',
    shortLabel: 'PE / IC',
    tagline: 'Levered IRR · 2³ DOE Stress · Shapley Attribution',
    heroHeadline: 'Institutional underwriting, cryptographically verifiable.',
    heroSubhead:
      'Full 10-year levered IRR, 2³ factorial DOE interaction effects, 1,000-trial Monte Carlo 95% CIs, and MASTERNEX.os ACP-SQL ledger attestation.',
    defaultStrategy: 'hold',
    defaultReport: 'ic_audit',
    kpiKeys: ['capRate', 'dscr', 'irr10Yr', 'equityMultiple10Yr'],
    systemPromptFraming:
      'Write as a senior Real Estate Private Equity Investment Committee (IC) Principal. Lead with verdict, DSCR covenant headroom, 10-Yr Levered IRR, Equity Multiple, and downside 2^3 DOE sensitivity.',
  },
  broker: {
    id: 'broker',
    label: 'Broker / Acquisition Agent',
    shortLabel: 'Broker',
    tagline: 'Target-Price Solver · Seller Credits · Spatial Comps',
    heroHeadline: 'Close with math-backed offers and spatial proof.',
    heroSubhead:
      'Solve exact max offer prices for target DSCR, structure 2-1 rate buydown concessions, compare portfolio CMAs, and inspect Overpass POIs + Google Street View.',
    defaultStrategy: 'brrrr',
    defaultReport: 'negotiation',
    kpiKeys: ['capRate', 'coc', 'mCf', 'onePctRatio'],
    systemPromptFraming:
      'Write as a sharp Commercial & Residential Acquisition Broker. Focus on anchor offer pricing, seller concession / 2-1 buydown tactics, inspection contingencies, and neighborhood comps.',
  },
  fiduciary: {
    id: 'fiduciary',
    label: 'Fiduciary / Wealth Advisor',
    shortLabel: 'Fiduciary',
    tagline: 'Education-Only Guard · PII Scrub · SR 11-7 Receipts',
    heroHeadline: 'Fiduciary-grade clarity with built-in SR 11-7 compliance.',
    heroSubhead:
      'Education-only advisory framing, automatic PII redaction checks, transparent Shapley risk attribution, and conservative cash-flow cushion modeling.',
    defaultStrategy: 'hold',
    defaultReport: 'fiduciary_brief',
    guardrailBanner:
      'Fiduciary OS Active · Education-Only Mode · Automatic PII Redaction & SR 11-7 Model Governance Enabled',
    kpiKeys: ['dscr', 'breakEvenOccPct', 'capRate', 'mCf'],
    systemPromptFraming:
      'Write as an education-only Fiduciary Wealth Advisor adhering to SR 11-7 model governance. Avoid personalized buy/sell directives; emphasize downside protection, break-even occupancy, liquidity reserves, and risk-adjusted income.',
  },
  risk_atlas: {
    id: 'risk_atlas',
    label: 'Storm & Risk Underwriter (Atlas)',
    shortLabel: 'Storm Risk',
    tagline: 'AUCTUM.atlas Swath · Roof CapEx · Insurance Shock',
    heroHeadline: 'Price physical climate and roof risk before you bind.',
    heroSubhead:
      'Combines AUCTUM.atlas hail/wind catastrophe scoring, roof lifecycle wear, insurance shock stress testing, and GIE H3 spatial hex cells.',
    defaultStrategy: 'hold',
    defaultReport: 'storm_risk',
    guardrailBanner:
      'AUCTUM.atlas Risk Lens Active · Stress-testing Roof Lifecycle CapEx & Insurance Premium Escalation',
    kpiKeys: ['dscr', 'breakEvenOccPct', 'capRate', 'irr10Yr'],
    systemPromptFraming:
      'Write as a Catastrophe & Property Risk Underwriter using AUCTUM.atlas telemetry. Focus on roof age, hail/wind swath exposure, insurance premium shock sensitivity, and mandatory CapEx reserves.',
  },
  retail: {
    id: 'retail',
    label: 'Retail / House-Hacker / STR',
    shortLabel: 'Retail / STR',
    tagline: 'Plain-English Cash Flow · Cash-to-Close · Break-Even',
    heroHeadline: 'Know your real monthly cash flow before making an offer.',
    heroSubhead:
      'Clear monthly PITI + operating budget breakdown, 1% Rule check, break-even occupancy cushion, and side-by-side Buy & Hold vs. BRRRR vs. Short-Term Rental comparison.',
    defaultStrategy: 'str',
    defaultReport: 'ic_audit',
    kpiKeys: ['mCf', 'coc', 'breakEvenOccPct', 'onePctRatio'],
    systemPromptFraming:
      'Write in plain, jargon-free English for an independent real estate investor. Explain exact cash needed to close, realistic monthly net profit after vacancy and maintenance, and clear red flags.',
  },
};

export const PERSONA_LIST: PersonaProfile[] = Object.values(PERSONA_PROFILES);
