export type UnderwritingStrategy = 'hold' | 'brrrr' | 'str';

export type UserPersonaId = 'pe_ic' | 'broker' | 'fiduciary' | 'risk_atlas' | 'retail';

export type ReportType =
  | 'ic_audit'
  | 'negotiation'
  | 'cma'
  | 'lp_memo'
  | 'fiduciary_brief'
  | 'storm_risk'
  | 'custom';

export type AIProviderId =
  | 'pollinations'
  | 'quant'
  | 'masternex'
  | 'huggingface'
  | 'ollama'
  | 'claude'
  | 'gemini'
  | 'openrouter'
  | 'groq';

export interface PropertyParcel {
  id: string;
  address: string;
  beds: number;
  sqft: number;
  price: number;
  rent: number;
  downPct: number;
  rate: number;
  opexPct: number;
  vacancyPct: number;
  rentGrowthPct: number;
  appreciationPct: number;
  rehab: number;
  roofAgeYears: number;
  lat: number;
  lng: number;
}

export interface UnderwritingMetrics {
  price: number;
  baseRent: number;
  grossMo: number;
  vacancyMo: number;
  egiMo: number;
  opexMo: number;
  noiMo: number;
  noi: number;
  downPct: number;
  ltv: number;
  rate: number;
  opexPct: number;
  vacancyPct: number;
  rentGrowthPct: number;
  appreciationPct: number;
  rehab: number;
  loan: number;
  mDebt: number;
  aDebt: number;
  cashIn: number;
  aCf: number;
  mCf: number;
  capRate: number;
  coc: number;
  dscr: number;
  debtYield: number;
  grm: number;
  onePctRatio: number;
  breakEvenOccPct: number;
  irr10Yr: number;
  equityMultiple10Yr: number;
  brrrrArv: number;
  brrrrRefiProceeds: number;
  brrrrCashLeftIn: number;
  verdict: 'ACQUIRE' | 'NEGOTIATE' | 'PASS';
  years: string[];
  equitySeries: number[];
  cfSeries: number[];
  debtSeries: number[];
}

export interface TargetPriceResult {
  targetMetric: 'dscr' | 'capRate' | 'coc';
  targetValue: number;
  maxPrice: number;
  discountDollars: number;
  discountPct: number;
  achievable: boolean;
}

export interface DOERun {
  run: number;
  label: string;
  rateFactor: -1 | 1;
  opexFactor: -1 | 1;
  rehabFactor: -1 | 1;
  rate: number;
  opexPct: number;
  rehab: number;
  capRate: number;
  dscr: number;
  cum10YrCf: number;
  pass: boolean;
}

export interface DOEEffect {
  term: string;
  label: string;
  dscrEffect: number;
  cfEffect: number;
  kind: 'main' | 'interaction';
}

export interface DOEResult {
  runs: DOERun[];
  effects: DOEEffect[];
  passCount: number;
  meanDscr: number;
  minDscr: number;
  maxDscr: number;
  stdDscr: number;
}

export interface MonteCarloResult {
  dataLabel: string;
  trials: number;
  seed: number;
  dscrP10: number;
  dscrP50: number;
  dscrP90: number;
  dscrCi95: [number, number];
  irrP10: number;
  irrP50: number;
  irrP90: number;
  irrCi95: [number, number];
  probDscrAbove120: number;
  histogramBins: { label: string; count: number; min: number; max: number }[];
}

export interface ShapleyAttribution {
  source: 'masternex-live' | 'local-exact-shapley';
  nadeBps: number;
  gieBps: number;
  bneBps: number;
  compositeScore: number;
  hexCell: string;
  packetId: string;
  signatureAlg: string;
  signatureVerified: boolean;
  ledgerVerified: boolean;
  digest: string;
}

export interface FiduciaryAuditResult {
  source: 'masternex-fiduciary' | 'local-fiduciary-guard';
  compliant: boolean;
  piiDetections: string[];
  redactedText: string;
  disclaimer: string;
  sr117ModelId: string;
  timestamp: string;
}

export interface StormHazardResult {
  source: 'masternex-atlas' | 'local-hazard-model';
  hazardScore: number;
  tier: 'Low Exposure' | 'Moderate Hail/Wind' | 'Elevated Catastrophe';
  roofVulnerability: number;
  recommendedInsuranceShockPct: number;
  recommendedCapexReserve: number;
  narrative: string;
}

export interface AmenityFeature {
  type: 'Feature';
  properties: {
    id: number;
    name: string;
    category: 'schools' | 'transit' | 'retail';
    subtype: string;
    distanceMi: number;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface LocationAudit {
  score: number;
  tier: string;
  counts: { schools: number; transit: number; retail: number };
  features: AmenityFeature[];
}

export interface AgUiEvent {
  type: 'RUN_STARTED' | 'STEP_STARTED' | 'STATE_DELTA' | 'TEXT_MESSAGE_CONTENT' | 'RUN_FINISHED' | 'CUSTOM';
  ts: string;
  source?: string;
  [key: string]: unknown;
}

export interface PersonaProfile {
  id: UserPersonaId;
  label: string;
  shortLabel: string;
  tagline: string;
  heroHeadline: string;
  heroSubhead: string;
  defaultStrategy: UnderwritingStrategy;
  defaultReport: ReportType;
  guardrailBanner?: string;
  kpiKeys: ('capRate' | 'coc' | 'mCf' | 'dscr' | 'irr10Yr' | 'equityMultiple10Yr' | 'breakEvenOccPct' | 'onePctRatio')[];
  systemPromptFraming: string;
}
