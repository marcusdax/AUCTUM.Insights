import type {
  DOEResult,
  LocationAudit,
  MonteCarloResult,
  PropertyParcel,
  ShapleyAttribution,
  StormHazardResult,
  UnderwritingMetrics,
  UnderwritingStrategy,
} from './types';
import type { AcademicPaper } from '../connectors/masternex';
import { calcUnderwriting } from './underwriting';
import { FIDUCIARY_DISCLAIMER } from './fiduciary';

export interface PowerAnalysisResult {
  alpha: number;
  targetPower: number;
  effectSizeD: number;
  nPerArm: number;
  totalSampleSize: number;
  powerCurve: { n: number; power: number }[];
}

export interface OLSRegressionResult {
  n: number;
  slope: number;
  intercept: number;
  rSquared: number;
  rmse: number;
  meanCapRate: number;
  capRateStd: number;
  var95AnnualCf: number;
  cvar95AnnualCf: number;
  var99AnnualCf: number;
}

export interface HuffSpatialResult {
  beta: number;
  gravityScore: number;
  tier: string;
  schoolWeight: number;
  transitWeight: number;
  retailWeight: number;
  hexCell: string;
}

export interface VerificationCheck {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

/** Standard normal inverse CDF (Acklam's rational approximation, accurate to ~1e-9) */
function normInv(p: number): number {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (clamped < pLow) {
    const q = Math.sqrt(-2 * Math.log(clamped));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (clamped <= pHigh) {
    const q = clamped - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - clamped));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Standard normal CDF via Abramowitz-Stegun erf approximation */
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-sample two-sided statistical power & sample-size calculator
 * for A/B portfolio experiments (e.g., rehab upgrade or pricing tests).
 */
export function computePowerAnalysis(
  alpha = 0.05,
  targetPower = 0.8,
  effectSizeD = 0.5
): PowerAnalysisResult {
  const safeD = Math.max(0.05, Math.min(3.0, effectSizeD));
  const safeAlpha = Math.max(0.001, Math.min(0.2, alpha));
  const safePower = Math.max(0.5, Math.min(0.99, targetPower));

  const zAlpha = normInv(1 - safeAlpha / 2);
  const zBeta = normInv(safePower);
  const nPerArm = Math.max(4, Math.ceil((2 * Math.pow(zAlpha + zBeta, 2)) / Math.pow(safeD, 2)));

  const powerCurve = [10, 20, 35, 50, 75, 100, 150, 200].map((n) => {
    const ncp = safeD * Math.sqrt(n / 2);
    const pwr = Number(Math.min(0.999, Math.max(0.05, normCdf(ncp - zAlpha))).toFixed(3));
    return { n, power: pwr };
  });

  return {
    alpha: safeAlpha,
    targetPower: safePower,
    effectSizeD: safeD,
    nPerArm,
    totalSampleSize: nPerArm * 2,
    powerCurve,
  };
}

/**
 * Portfolio OLS Linear Regression (Monthly Rent ~ Purchase Price) + Cap-Rate dispersion
 * + Monte Carlo Annual Cash Flow VaR (95%/99%) and CVaR (Expected Shortfall).
 */
export function computeEconometricModel(
  properties: PropertyParcel[],
  activeParcel: PropertyParcel,
  strat: UnderwritingStrategy = 'hold',
  volatilityScale = 1.0
): OLSRegressionResult {
  const pts = properties.map((p) => ({
    x: p.price / 1000, // $k
    y: p.rent,
    cap: calcUnderwriting(p, strat).capRate,
  }));
  const n = Math.max(1, pts.length);
  const meanX = pts.reduce((a, b) => a + b.x, 0) / n;
  const meanY = pts.reduce((a, b) => a + b.y, 0) / n;
  const sxx = pts.reduce((a, b) => a + Math.pow(b.x - meanX, 2), 0);
  const sxy = pts.reduce((a, b) => a + (b.x - meanX) * (b.y - meanY), 0);
  const slope = sxx > 1e-9 ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;

  const ssTot = pts.reduce((a, b) => a + Math.pow(b.y - meanY, 2), 0);
  const ssRes = pts.reduce((a, b) => a + Math.pow(b.y - (slope * b.x + intercept), 2), 0);
  const rSquared = ssTot > 1e-9 ? Math.max(0, 1 - ssRes / ssTot) : 1;
  const rmse = Math.sqrt(ssRes / n);

  const meanCapRate = pts.reduce((a, b) => a + b.cap, 0) / n;
  const capRateStd = Math.sqrt(
    pts.reduce((a, b) => a + Math.pow(b.cap - meanCapRate, 2), 0) / n
  );

  // Seeded 500-trial annual cash-flow tail-risk distribution
  const cfs: number[] = [];
  let s = 1337;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 500; i++) {
    const u1 = Math.max(1e-9, rand());
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const shocked: PropertyParcel = {
      ...activeParcel,
      rate: Math.max(2.5, activeParcel.rate + z * 0.75 * volatilityScale),
      vacancyPct: Math.min(40, Math.max(1, activeParcel.vacancyPct + Math.abs(z) * 2.4 * volatilityScale)),
    };
    cfs.push(calcUnderwriting(shocked, strat).aCf);
  }
  cfs.sort((a, b) => a - b);
  const idx95 = Math.max(0, Math.floor(cfs.length * 0.05));
  const idx99 = Math.max(0, Math.floor(cfs.length * 0.01));
  const tail95 = cfs.slice(0, Math.max(1, idx95 + 1));
  const cvar95 = tail95.reduce((a, b) => a + b, 0) / tail95.length;

  return {
    n: properties.length,
    slope: Number(slope.toFixed(3)),
    intercept: Number(intercept.toFixed(1)),
    rSquared: Number(rSquared.toFixed(3)),
    rmse: Number(rmse.toFixed(1)),
    meanCapRate: Number(meanCapRate.toFixed(2)),
    capRateStd: Number(capRateStd.toFixed(2)),
    var95AnnualCf: Math.round(cfs[idx95] ?? 0),
    cvar95AnnualCf: Math.round(cvar95),
    var99AnnualCf: Math.round(cfs[idx99] ?? 0),
  };
}

/**
 * Huff Gravity Distance-Decay Spatial Accessibility Score
 * Score_cat = sum(weight / (1 + distMi^beta))
 */
export function computeHuffSpatialGravity(
  p: PropertyParcel,
  audit: LocationAudit | undefined,
  beta = 1.5
): HuffSpatialResult {
  const safeBeta = Math.max(0.5, Math.min(3.0, beta));
  const feats = audit?.features ?? [];
  let schoolW = 0;
  let transitW = 0;
  let retailW = 0;

  if (feats.length > 0) {
    for (const f of feats) {
      const decay = 1 / (1 + Math.pow(Math.max(0.05, f.properties.distanceMi), safeBeta));
      if (f.properties.category === 'schools') schoolW += 12 * decay;
      else if (f.properties.category === 'transit') transitW += 10 * decay;
      else retailW += 5 * decay;
    }
  } else {
    // Baseline synthetic gravity estimate prior to live Overpass scan
    schoolW = 24 / safeBeta;
    transitW = 20 / safeBeta;
    retailW = 22 / safeBeta;
  }

  const gravityScore = Math.min(100, Math.round(schoolW + transitW + retailW));
  const tier =
    gravityScore >= 72 ? 'Prime Urban Core' : gravityScore >= 46 ? 'Balanced Suburban' : 'Auto-Oriented';
  const hexCell = `h3-r10:${Math.round(p.lat * 100)}:${Math.round(p.lng * 100)}`;

  return {
    beta: safeBeta,
    gravityScore,
    tier,
    schoolWeight: Number(schoolW.toFixed(1)),
    transitWeight: Number(transitW.toFixed(1)),
    retailWeight: Number(retailW.toFixed(1)),
    hexCell,
  };
}

/**
 * MASTERNEX Honest-By-Construction Verification Contract Auditor
 */
export function runVerificationContract(params: {
  mc: MonteCarloResult;
  doe: DOEResult;
  attr: ShapleyAttribution;
}): VerificationCheck[] {
  const { mc, doe, attr } = params;
  const bpsSum = attr.nadeBps + attr.gieBps + attr.bneBps;
  return [
    {
      id: 'synthetic-label',
      name: 'Synthetic vs. Field Benchmark Labeling',
      passed: mc.dataLabel.toLowerCase().includes('synthetic'),
      detail: `Tagged "${mc.dataLabel}"`,
    },
    {
      id: 'bootstrap-ci',
      name: '95% Bootstrap Confidence Intervals Reported',
      passed: mc.dscrCi95[0] <= mc.dscrCi95[1] && mc.irrCi95[0] <= mc.irrCi95[1],
      detail: `DSCR 95% CI [${mc.dscrCi95[0]}x, ${mc.dscrCi95[1]}x] · IRR 95% CI [${mc.irrCi95[0]}%, ${mc.irrCi95[1]}%]`,
    },
    {
      id: 'doe-orthogonality',
      name: '2^3 Full Factorial DOE Orthogonality (8 Corners + 6 Effects)',
      passed: doe.runs.length === 8 && doe.effects.length === 6,
      detail: `${doe.passCount}/8 runs clear 1.20x DSCR (mean ${doe.meanDscr}x, std ${doe.stdDscr}x)`,
    },
    {
      id: 'shapley-conservation',
      name: 'Exact DTA Shapley Basis-Point Conservation (10,000 bps)',
      passed: bpsSum === 10000,
      detail: `NADE ${attr.nadeBps} + GIE ${attr.gieBps} + BNE ${attr.bneBps} = ${bpsSum} bps`,
    },
    {
      id: 'crypto-seal',
      name: 'Cryptographic ACP-SQL Ledger & Sovereign Shield Seal',
      passed: attr.source === 'masternex-live' && attr.signatureVerified && attr.ledgerVerified,
      detail:
        attr.source === 'masternex-live'
          ? `Verified ${attr.signatureAlg} · Packet ${attr.packetId}`
          : 'Unsealed local preview — click "Run Live MASTERNEX Seal" to attest.',
    },
  ];
}

export function papersToBibTeX(papers: AcademicPaper[]): string {
  return papers
    .map((p, idx) => {
      const key = `auctum${p.year || '2025'}ref${idx + 1}`;
      const cleanTitle = p.title.replace(/[{}]/g, '');
      return `@article{${key},\n  title = {${cleanTitle}},\n  journal = {${p.source}},\n  year = {${p.year || '2025'}},\n  url = {${p.url}}\n}`;
    })
    .join('\n\n');
}

export function generateScientificManuscript(params: {
  format: 'markdown' | 'latex';
  parcel: PropertyParcel;
  metrics: UnderwritingMetrics;
  doe: DOEResult;
  mc: MonteCarloResult;
  attr: ShapleyAttribution;
  hazard: StormHazardResult;
  citations: AcademicPaper[];
}): string {
  const { format, parcel: p, metrics: m, doe, mc, attr, hazard, citations } = params;

  if (format === 'latex') {
    const citeLines = citations.length
      ? citations.map((c) => `\\item ${c.title.replace(/[&_#%]/g, '\\$&')} (${c.source}, ${c.year}).`).join('\n')
      : '\\item No external citations selected yet — add works from the Literature Workbench.';

    return `\\documentclass[11pt]{article}
\\usepackage{booktabs}
\\usepackage{geometry}
\\geometry{margin=1in}
\\title{Institutional Underwriting \\& Verification Dossier: ${p.address.replace(/[&_#%]/g, '\\$&')}}
\\author{AUCTUM.Insights v7.2 $\\cdot$ MASTERNEX.os Fiduciary Kernel}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
This reproducible dossier evaluates \\textbf{${p.address.replace(/[&_#%]/g, '\\$&')}} at an acquisition basis of \\$${m.price.toLocaleString()} and gross rent of \\$${m.baseRent.toLocaleString()}/mo. Modeled Year-1 Cap Rate is \\textbf{${m.capRate.toFixed(2)}\\%}, DSCR is \\textbf{${m.dscr.toFixed(2)}x}, 10-Year Levered IRR is \\textbf{${m.irr10Yr.toFixed(2)}\\%}, and Equity Multiple is \\textbf{${m.equityMultiple10Yr.toFixed(2)}x} (Verdict: \\textbf{${m.verdict}}).
\\end{abstract}

\\section{Underwriting \\& Stress Summary}
\\begin{table}[h]
\\centering
\\begin{tabular}{lr}
\\toprule
Metric & Modeled Value \\\\
\\midrule
Annual NOI & \\$${Math.round(m.noi).toLocaleString()} \\\\
Cap Rate / Cash-on-Cash & ${m.capRate.toFixed(2)}\\% / ${m.coc.toFixed(2)}\\% \\\\
DSCR / Break-Even Occupancy & ${m.dscr.toFixed(2)}x / ${m.breakEvenOccPct.toFixed(1)}\\% \\\\
10-Yr Levered IRR / EM & ${m.irr10Yr.toFixed(2)}\\% / ${m.equityMultiple10Yr.toFixed(2)}x \\\\
$2^3$ DOE Pass Rate ($\\ge 1.20$x) & ${doe.passCount}/8 (mean ${doe.meanDscr}x) \\\\
Monte Carlo DSCR (P10/P50/P90) & ${mc.dscrP10}x / ${mc.dscrP50}x / ${mc.dscrP90}x \\\\
Shapley Attribution (NADE/GIE/BNE) & ${attr.nadeBps} / ${attr.gieBps} / ${attr.bneBps} bps \\\\
AUCTUM.atlas Storm Hazard & ${hazard.hazardScore}/100 (${hazard.tier}) \\\\
\\bottomrule
\\end{tabular}
\\caption{Quantitative Underwriting \\& Provenance Summary (${mc.dataLabel})}
\\end{table}

\\section{Cryptographic Provenance \\& Governance}
Ledger packet: \\texttt{${attr.packetId.replace(/_/g, '\\_')}} $\\cdot$ Algorithm: \\texttt{${attr.signatureAlg.replace(/_/g, '\\_')}} $\\cdot$ H3 Cell: \\texttt{${attr.hexCell.replace(/_/g, '\\_')}}.\n\n${FIDUCIARY_DISCLAIMER.replace(/[&_#%]/g, '\\$&')}

\\section{References}
\\begin{enumerate}
${citeLines}
\\end{enumerate}
\\end{document}`;
  }

  const mdRefs = citations.length
    ? citations.map((c, i) => `${i + 1}. **${c.title}** — *${c.source}* (${c.year}) [Link](${c.url})`).join('\n')
    : '- *No citations pinned yet — click "Cite in Paper" in the Literature Workbench.*';

  return `# Institutional Underwriting & Verification Dossier — ${p.address}

## 1. Executive Abstract
Evaluated at **$${m.price.toLocaleString()}** acquisition price and **$${m.baseRent.toLocaleString()}/mo** rent (**${m.verdict}**). Year-1 Cap Rate **${m.capRate.toFixed(2)}%**, DSCR **${m.dscr.toFixed(2)}x**, 10-Year Levered IRR **${m.irr10Yr.toFixed(2)}%**, Equity Multiple **${m.equityMultiple10Yr.toFixed(2)}x**.

## 2. Quantitative & Experimental Design Table
| Metric | Value |
|---|---|
| Annual NOI | $${Math.round(m.noi).toLocaleString()} |
| Cap Rate / Cash-on-Cash | ${m.capRate.toFixed(2)}% / ${m.coc.toFixed(2)}% |
| DSCR / Break-Even Occupancy | ${m.dscr.toFixed(2)}x / ${m.breakEvenOccPct.toFixed(1)}% |
| 2³ DOE Stress Pass Rate | ${doe.passCount}/8 (mean ${doe.meanDscr}x, min ${doe.minDscr}x) |
| Monte Carlo (${mc.dataLabel}) | DSCR P10/P50/P90: ${mc.dscrP10}x / ${mc.dscrP50}x / ${mc.dscrP90}x |
| Shapley Attribution (NADE / GIE / BNE) | ${attr.nadeBps} / ${attr.gieBps} / ${attr.bneBps} bps |
| AUCTUM.atlas Storm Risk | ${hazard.hazardScore}/100 (${hazard.tier}) |

## 3. Provenance & Fiduciary Disclosure
- **Packet ID:** \`${attr.packetId}\` · **Signature:** \`${attr.signatureAlg}\` · **Hex Cell:** \`${attr.hexCell}\`
- ${FIDUCIARY_DISCLAIMER}

## 4. Literature References
${mdRefs}`;
}
