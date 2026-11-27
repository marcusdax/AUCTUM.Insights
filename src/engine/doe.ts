import type {
  DOEEffect,
  DOEResult,
  DOERun,
  MonteCarloResult,
  PropertyParcel,
  UnderwritingStrategy,
} from './types';
import { calcUnderwriting } from './underwriting';

/**
 * 2^3 Full Factorial Experimental Design (DOE) across:
 *  - Factor A: Interest Rate  (-1: base - 0.75%, +1: base + 1.25%)
 *  - Factor B: Operating Load (-1: max(18, base - 4)%, +1: min(65, base + 6)%)
 *  - Factor C: Rehab Budget   (-1: max(0, base * 0.5), +1: base + 25000)
 *
 * Computes all 8 orthogonal corners, Main Effects (A, B, C), and
 * 2-Way Interaction Effects (AB, AC, BC).
 */
export function computeDOEFactorial(
  p: PropertyParcel,
  strat: UnderwritingStrategy = 'hold'
): DOEResult {
  const rateLow = Math.max(2.5, Number((p.rate - 0.75).toFixed(3)));
  const rateHigh = Math.min(12.5, Number((p.rate + 1.25).toFixed(3)));
  const opexLow = Math.max(18, Math.round(p.opexPct - 4));
  const opexHigh = Math.min(65, Math.round(p.opexPct + 6));
  const rehabLow = Math.max(0, Math.round(p.rehab * 0.5));
  const rehabHigh = Math.round(p.rehab + 25000);

  const runs: DOERun[] = [];
  let idx = 1;
  for (const rF of [-1, 1] as const) {
    for (const oF of [-1, 1] as const) {
      for (const hF of [-1, 1] as const) {
        const rate = rF === -1 ? rateLow : rateHigh;
        const opexPct = oF === -1 ? opexLow : opexHigh;
        const rehab = hF === -1 ? rehabLow : rehabHigh;
        const m = calcUnderwriting({ ...p, rate, opexPct, rehab }, strat);
        const cum10YrCf = m.cfSeries[m.cfSeries.length - 1] ?? 0;
        runs.push({
          run: idx,
          label: `R${idx} (${rF > 0 ? '+' : '-'}R/${oF > 0 ? '+' : '-'}O/${hF > 0 ? '+' : '-'}C)`,
          rateFactor: rF,
          opexFactor: oF,
          rehabFactor: hF,
          rate,
          opexPct,
          rehab,
          capRate: Number(m.capRate.toFixed(2)),
          dscr: Number(m.dscr.toFixed(3)),
          cum10YrCf,
          pass: m.dscr >= 1.2,
        });
        idx++;
      }
    }
  }

  const contrast = (selector: (r: DOERun) => -1 | 1, metric: 'dscr' | 'cum10YrCf'): number => {
    const hi = runs.filter((r) => selector(r) === 1).map((r) => r[metric]);
    const lo = runs.filter((r) => selector(r) === -1).map((r) => r[metric]);
    const meanHi = hi.reduce((a, b) => a + b, 0) / hi.length;
    const meanLo = lo.reduce((a, b) => a + b, 0) / lo.length;
    return Number((meanHi - meanLo).toFixed(metric === 'dscr' ? 3 : 0));
  };

  const effects: DOEEffect[] = [
    {
      term: 'A',
      label: 'Interest Rate (Main)',
      dscrEffect: contrast((r) => r.rateFactor, 'dscr'),
      cfEffect: contrast((r) => r.rateFactor, 'cum10YrCf'),
      kind: 'main',
    },
    {
      term: 'B',
      label: 'Operating Load (Main)',
      dscrEffect: contrast((r) => r.opexFactor, 'dscr'),
      cfEffect: contrast((r) => r.opexFactor, 'cum10YrCf'),
      kind: 'main',
    },
    {
      term: 'C',
      label: 'Rehab CapEx (Main)',
      dscrEffect: contrast((r) => r.rehabFactor, 'dscr'),
      cfEffect: contrast((r) => r.rehabFactor, 'cum10YrCf'),
      kind: 'main',
    },
    {
      term: 'AB',
      label: 'Rate × OpEx (2-Way)',
      dscrEffect: contrast((r) => (r.rateFactor * r.opexFactor) as -1 | 1, 'dscr'),
      cfEffect: contrast((r) => (r.rateFactor * r.opexFactor) as -1 | 1, 'cum10YrCf'),
      kind: 'interaction',
    },
    {
      term: 'AC',
      label: 'Rate × Rehab (2-Way)',
      dscrEffect: contrast((r) => (r.rateFactor * r.rehabFactor) as -1 | 1, 'dscr'),
      cfEffect: contrast((r) => (r.rateFactor * r.rehabFactor) as -1 | 1, 'cum10YrCf'),
      kind: 'interaction',
    },
    {
      term: 'BC',
      label: 'OpEx × Rehab (2-Way)',
      dscrEffect: contrast((r) => (r.opexFactor * r.rehabFactor) as -1 | 1, 'dscr'),
      cfEffect: contrast((r) => (r.opexFactor * r.rehabFactor) as -1 | 1, 'cum10YrCf'),
      kind: 'interaction',
    },
  ];

  const dscrs = runs.map((r) => r.dscr);
  const meanDscr = Number((dscrs.reduce((a, b) => a + b, 0) / dscrs.length).toFixed(3));
  const variance = dscrs.reduce((acc, v) => acc + Math.pow(v - meanDscr, 2), 0) / dscrs.length;

  return {
    runs,
    effects,
    passCount: runs.filter((r) => r.pass).length,
    meanDscr,
    minDscr: Math.min(...dscrs),
    maxDscr: Math.max(...dscrs),
    stdDscr: Number(Math.sqrt(variance).toFixed(3)),
  };
}

/** Deterministic Mulberry32 PRNG for reproducible Monte Carlo trials */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller standard normal draw */
function randNormal(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function bootstrapMeanCi95(values: number[], rng: () => number, resamples = 200): [number, number] {
  const n = values.length;
  if (n === 0) return [0, 0];
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += values[Math.floor(rng() * n)];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [
    Number(percentile(means, 0.025).toFixed(3)),
    Number(percentile(means, 0.975).toFixed(3)),
  ];
}

/**
 * Seeded Monte Carlo stress simulation (n=1000 default) with 95% bootstrap CIs.
 * Explicitly labeled synthetic per MASTERNEX honest-by-construction verification contract.
 */
export function runMonteCarloStress(
  p: PropertyParcel,
  strat: UnderwritingStrategy = 'hold',
  trials = 1000,
  seed = 42
): MonteCarloResult {
  const rng = mulberry32(seed);
  const dscrs: number[] = [];
  const irrs: number[] = [];

  for (let i = 0; i < trials; i++) {
    const macroShock = randNormal(rng);
    const rateShock = macroShock * 0.65 + randNormal(rng) * 0.45;
    const vacShock = Math.max(0, macroShock * 2.0 + randNormal(rng) * 2.5);
    const rentGrowthShock = -macroShock * 0.8 + randNormal(rng) * 1.1;
    const opexShock = randNormal(rng) * 3.0;

    const simParcel: PropertyParcel = {
      ...p,
      rate: Math.min(12.5, Math.max(2.5, p.rate + rateShock)),
      vacancyPct: Math.min(35, Math.max(1, p.vacancyPct + vacShock)),
      rentGrowthPct: Math.min(9, Math.max(-2, p.rentGrowthPct + rentGrowthShock)),
      opexPct: Math.min(65, Math.max(15, p.opexPct + opexShock)),
    };
    const m = calcUnderwriting(simParcel, strat);
    dscrs.push(m.dscr);
    irrs.push(m.irr10Yr);
  }

  const dscrSorted = [...dscrs].sort((a, b) => a - b);
  const irrSorted = [...irrs].sort((a, b) => a - b);
  const probDscrAbove120 = Number(
    ((dscrs.filter((d) => d >= 1.2).length / Math.max(1, trials)) * 100).toFixed(1)
  );

  // Build 10-bin DSCR histogram
  const minVal = dscrSorted[0] ?? 0.5;
  const maxVal = dscrSorted[dscrSorted.length - 1] ?? 2.0;
  const span = Math.max(0.1, maxVal - minVal);
  const numBins = 10;
  const step = span / numBins;
  const histogramBins = Array.from({ length: numBins }, (_, idx) => {
    const bMin = minVal + idx * step;
    const bMax = idx === numBins - 1 ? maxVal + 1e-6 : minVal + (idx + 1) * step;
    const count = dscrs.filter((v) => v >= bMin && v < bMax).length;
    return {
      label: `${bMin.toFixed(2)}x`,
      count,
      min: Number(bMin.toFixed(3)),
      max: Number(bMax.toFixed(3)),
    };
  });

  return {
    dataLabel: `synthetic Monte Carlo (n=${trials}, seed=${seed})`,
    trials,
    seed,
    dscrP10: Number(percentile(dscrSorted, 0.1).toFixed(2)),
    dscrP50: Number(percentile(dscrSorted, 0.5).toFixed(2)),
    dscrP90: Number(percentile(dscrSorted, 0.9).toFixed(2)),
    dscrCi95: bootstrapMeanCi95(dscrs, rng),
    irrP10: Number(percentile(irrSorted, 0.1).toFixed(2)),
    irrP50: Number(percentile(irrSorted, 0.5).toFixed(2)),
    irrP90: Number(percentile(irrSorted, 0.9).toFixed(2)),
    irrCi95: bootstrapMeanCi95(irrs, rng),
    probDscrAbove120,
    histogramBins,
  };
}
