import type { DOEResult, LocationAudit, PropertyParcel, UnderwritingMetrics } from '../engine/types';

export interface KDenseSkillItem {
  id: string;
  command: string;
  title: string;
  category: string;
  description: string;
}

export const KDENSE_SCIENTIFIC_SKILLS: KDenseSkillItem[] = [
  {
    id: 'experimental-design',
    command: '/skill:experimental-design',
    title: 'Experimental Design (DOE & Power Analysis)',
    category: 'Quantitative',
    description:
      'Designs orthogonal 2^k factorial stress matrices, interaction effect analyses, and statistical power checks for portfolio underwriting.',
  },
  {
    id: 'masternex-scientific',
    command: '/skill:masternex-scientific',
    title: 'MASTERNEX Scientific Verification',
    category: 'Sovereign Trust',
    description:
      'Runs honest-by-construction verification, bootstrap 95% CIs, ACP-SQL ledger sealing, and Nature/OpenAlex/arXiv literature synthesis.',
  },
  {
    id: 'statistical-analysis',
    command: '/skill:statistical-analysis',
    title: 'Statistical & Econometric Modeling',
    category: 'Quantitative',
    description:
      'Performs rent-growth regression, cap-rate dispersion diagnostics, and Monte Carlo tail-risk validation.',
  },
  {
    id: 'geospatial-analysis',
    command: '/skill:geospatial-analysis',
    title: 'Geospatial & Trade-Area Intelligence',
    category: 'Spatial',
    description:
      'Analyzes H3 hex-cell accessibility, Overpass transit/school density, and storm hazard swaths around target parcels.',
  },
  {
    id: 'scientific-writing',
    command: '/skill:scientific-writing',
    title: 'Institutional IC & LP Dossier Authoring',
    category: 'Reporting',
    description:
      'Transforms quantitative tables and provenance logs into publication-grade IC memos and reproducible LaTeX/Markdown reports.',
  },
];

export async function probeKDenseHealth(baseUrl = 'http://127.0.0.1:8000'): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export function buildKDenseSkillPrompt(params: {
  skill: KDenseSkillItem;
  parcel: PropertyParcel;
  metrics: UnderwritingMetrics;
  doe: DOEResult;
  audit?: LocationAudit;
}): string {
  const { skill, parcel: p, metrics: m, doe, audit } = params;
  const payload = {
    address: p.address,
    coordinates: { lat: p.lat, lng: p.lng },
    assumptions: {
      price: p.price,
      monthlyRent: p.rent,
      downPct: p.downPct,
      ratePct: p.rate,
      opexPct: p.opexPct,
      vacancyPct: p.vacancyPct,
      rehab: p.rehab,
      roofAgeYears: p.roofAgeYears,
    },
    metrics: {
      capRatePct: Number(m.capRate.toFixed(2)),
      cocPct: Number(m.coc.toFixed(2)),
      dscr: Number(m.dscr.toFixed(2)),
      irr10YrPct: m.irr10Yr,
      equityMultiple10Yr: m.equityMultiple10Yr,
      breakEvenOccPct: Number(m.breakEvenOccPct.toFixed(1)),
      verdict: m.verdict,
    },
    doe2x3: {
      passCount: `${doe.passCount}/8`,
      meanDscr: doe.meanDscr,
      minDscr: doe.minDscr,
      topEffects: doe.effects.slice(0, 4),
    },
    spatialAudit: audit ? { score: audit.score, tier: audit.tier, counts: audit.counts } : 'not-scanned',
  };

  return `${skill.command} Analyze this AUCTUM.Insights parcel and produce a reproducible verification report with confidence intervals and actionable IC recommendations:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}
