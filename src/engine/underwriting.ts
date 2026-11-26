import type {
  PropertyParcel,
  TargetPriceResult,
  UnderwritingMetrics,
  UnderwritingStrategy,
} from './types';

export const DEFAULT_PROPERTIES: PropertyParcel[] = [
  {
    id: 'p1',
    address: '412 NW Renfro St, Burleson, TX 76028',
    beds: 4,
    sqft: 2150,
    price: 340000,
    rent: 3150,
    downPct: 20,
    rate: 6.25,
    opexPct: 32,
    vacancyPct: 5,
    rentGrowthPct: 3.0,
    appreciationPct: 3.8,
    rehab: 15000,
    roofAgeYears: 11,
    lat: 32.5421,
    lng: -97.3208,
  },
  {
    id: 'p2',
    address: '1809 Southmore Blvd, Houston, TX 77004',
    beds: 3,
    sqft: 1840,
    price: 415000,
    rent: 3650,
    downPct: 20,
    rate: 6.25,
    opexPct: 34,
    vacancyPct: 6,
    rentGrowthPct: 3.2,
    appreciationPct: 4.0,
    rehab: 22000,
    roofAgeYears: 16,
    lat: 29.7261,
    lng: -95.3789,
  },
  {
    id: 'p3',
    address: '2408 E Cesar Chavez St, Austin, TX 78702',
    beds: 3,
    sqft: 1680,
    price: 560000,
    rent: 4350,
    downPct: 25,
    rate: 6.375,
    opexPct: 30,
    vacancyPct: 5,
    rentGrowthPct: 3.6,
    appreciationPct: 4.4,
    rehab: 18000,
    roofAgeYears: 7,
    lat: 30.2564,
    lng: -97.7176,
  },
];

export function monthlyMortgagePayment(principal: number, annualRateDecimal: number, years = 30): number {
  if (principal <= 0) return 0;
  const n = years * 12;
  const mr = annualRateDecimal / 12;
  if (mr <= 0) return principal / n;
  const factor = Math.pow(1 + mr, n);
  return (principal * (mr * factor)) / (factor - 1);
}

export function remainingLoanBalance(
  principal: number,
  annualRateDecimal: number,
  monthsElapsed: number,
  totalYears = 30
): number {
  if (principal <= 0) return 0;
  const n = totalYears * 12;
  if (monthsElapsed >= n) return 0;
  const mr = annualRateDecimal / 12;
  if (mr <= 0) return principal * (1 - monthsElapsed / n);
  const fTotal = Math.pow(1 + mr, n);
  const fElapsed = Math.pow(1 + mr, monthsElapsed);
  return Math.max(0, (principal * (fTotal - fElapsed)) / (fTotal - 1));
}

/**
 * Newton-Raphson + bisection fallback IRR solver on annual cash flows.
 * Returns IRR as a percentage (e.g., 14.25 for 14.25%).
 */
export function computeIRR(cashFlows: number[]): number {
  if (cashFlows.length < 2) return 0;
  const hasPos = cashFlows.some((c) => c > 0);
  const hasNeg = cashFlows.some((c) => c < 0);
  if (!hasPos || !hasNeg) return 0;

  const npv = (r: number) =>
    cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
  const dNpv = (r: number) =>
    cashFlows.reduce((acc, cf, t) => (t === 0 ? acc : acc - (t * cf) / Math.pow(1 + r, t + 1)), 0);

  let rate = 0.12;
  for (let i = 0; i < 60; i++) {
    const f = npv(rate);
    const df = dNpv(rate);
    if (Math.abs(f) < 1e-6) return Number((rate * 100).toFixed(2));
    if (Math.abs(df) < 1e-10) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -0.95 || next > 5) break;
    rate = next;
  }

  // Bisection fallback in [-0.85, 2.0]
  let lo = -0.85;
  let hi = 2.0;
  let fLo = npv(lo);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-4) return Number((mid * 100).toFixed(2));
    if ((fLo > 0 && fMid > 0) || (fLo < 0 && fMid < 0)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return Number((((lo + hi) / 2) * 100).toFixed(2));
}

export function calcUnderwriting(
  p: PropertyParcel,
  strat: UnderwritingStrategy = 'hold'
): UnderwritingMetrics {
  const price = Math.max(1000, Number(p.price) || 300000);
  const baseRent = Math.max(100, Number(p.rent) || 2500);
  const downPct = Math.min(1, Math.max(0, (Number(p.downPct) ?? 20) / 100));
  const ltv = 1 - downPct;
  const rate = Math.max(0, (Number(p.rate) ?? 6.25) / 100);
  const baseOpex = Math.min(0.85, Math.max(0.05, (Number(p.opexPct) || 32) / 100));
  const vacancyPct = Math.min(0.5, Math.max(0, (Number(p.vacancyPct) ?? 5) / 100));
  const rentGrowthPct = Math.min(0.15, Math.max(-0.05, (Number(p.rentGrowthPct) ?? 3.0) / 100));
  const appreciationPct = Math.min(0.15, Math.max(-0.05, (Number(p.appreciationPct) ?? 3.8) / 100));
  const rehab = Math.max(0, Number(p.rehab) || 0);

  let effRent = baseRent;
  let effOpex = baseOpex;
  let effVacancy = vacancyPct;
  let arvBoost = 1.0;

  if (strat === 'brrrr') {
    effRent = baseRent * 1.12;
    arvBoost = 1.15 + Math.min(0.18, (rehab * 1.35) / price);
  } else if (strat === 'str') {
    effRent = baseRent * 1.55;
    effOpex = Math.min(0.68, baseOpex + 0.14);
    effVacancy = Math.min(0.45, vacancyPct + 0.12);
  }

  const grossMo = effRent;
  const vacancyMo = grossMo * effVacancy;
  const egiMo = grossMo - vacancyMo;
  const opexMo = egiMo * effOpex;
  const noiMo = egiMo - opexMo;
  const noi = noiMo * 12;

  const loan = price * ltv;
  const mDebt = monthlyMortgagePayment(loan, rate, 30);
  const aDebt = mDebt * 12;

  const closingCosts = price * 0.03;
  const cashIn = Math.max(1, price * downPct + closingCosts + rehab);
  const aCf = noi - aDebt;
  const mCf = aCf / 12;

  const capRate = (noi / price) * 100;
  const coc = (aCf / cashIn) * 100;
  const dscr = aDebt > 0 ? noi / aDebt : 9.99;
  const debtYield = loan > 0 ? (noi / loan) * 100 : 100;
  const grm = price / Math.max(1, grossMo * 12);
  const onePctRatio = (baseRent / price) * 100;

  // Break-Even Occupancy = (OpEx_at_100%_occ + Debt Service) / Gross Scheduled Rent
  const breakEvenOccPct = Math.min(
    150,
    Math.max(0, ((opexMo + mDebt) / Math.max(1, grossMo)) * 100)
  );

  // BRRRR Refi Analysis (75% LTV refi on ARV)
  const brrrrArv = Math.round((price + rehab * 0.6) * arvBoost);
  const brrrrRefiProceeds = Math.round(brrrrArv * 0.75);
  const totalBasis = price + closingCosts + rehab;
  const brrrrCashLeftIn = Math.max(0, Math.round(totalBasis - brrrrRefiProceeds));

  const years: string[] = [];
  const equitySeries: number[] = [];
  const cfSeries: number[] = [];
  const debtSeries: number[] = [];
  const irrFlows: number[] = [-cashIn];

  let cumCf = 0;
  const sellingCostPct = 0.06;
  let yr10NetProceeds = 0;

  for (let yr = 1; yr <= 10; yr++) {
    years.push(`Yr ${yr}`);
    const val = (price + rehab * 0.5) * arvBoost * Math.pow(1 + appreciationPct, yr);
    const rem = remainingLoanBalance(loan, rate, yr * 12, 30);
    const eq = Math.max(0, val - rem);
    equitySeries.push(Math.round(eq));
    debtSeries.push(Math.round(rem));

    const yrNoi = noi * Math.pow(1 + rentGrowthPct, yr - 1);
    const yrCf = yrNoi - aDebt;
    cumCf += yrCf;
    cfSeries.push(Math.round(cumCf));

    if (yr === 10) {
      yr10NetProceeds = Math.max(0, val * (1 - sellingCostPct) - rem);
      irrFlows.push(yrCf + yr10NetProceeds);
    } else {
      irrFlows.push(yrCf);
    }
  }

  const irr10Yr = computeIRR(irrFlows);
  const equityMultiple10Yr = Number(((cumCf + yr10NetProceeds) / cashIn).toFixed(2));
  const verdict: 'ACQUIRE' | 'NEGOTIATE' | 'PASS' =
    dscr >= 1.25 && capRate >= 6.0 ? 'ACQUIRE' : dscr >= 1.05 ? 'NEGOTIATE' : 'PASS';

  return {
    price,
    baseRent,
    grossMo,
    vacancyMo,
    egiMo,
    opexMo,
    noiMo,
    noi,
    downPct,
    ltv,
    rate,
    opexPct: effOpex,
    vacancyPct: effVacancy,
    rentGrowthPct,
    appreciationPct,
    rehab,
    loan,
    mDebt,
    aDebt,
    cashIn,
    aCf,
    mCf,
    capRate,
    coc,
    dscr,
    debtYield,
    grm,
    onePctRatio,
    breakEvenOccPct,
    irr10Yr,
    equityMultiple10Yr,
    brrrrArv,
    brrrrRefiProceeds,
    brrrrCashLeftIn,
    verdict,
    years,
    equitySeries,
    cfSeries,
    debtSeries,
  };
}

/**
 * Target-Price Solver: finds the maximum acquisition price that clears a target
 * DSCR, Cap Rate (%), or Cash-on-Cash (%) via binary search.
 */
export function solveTargetPrice(
  p: PropertyParcel,
  strat: UnderwritingStrategy,
  targetMetric: 'dscr' | 'capRate' | 'coc',
  targetValue: number
): TargetPriceResult {
  const evalMetric = (testPrice: number): number => {
    const m = calcUnderwriting({ ...p, price: testPrice }, strat);
    return m[targetMetric];
  };

  let lo = 25000;
  let hi = Math.max(p.price * 2.5, 3000000);

  if (evalMetric(lo) < targetValue) {
    return {
      targetMetric,
      targetValue,
      maxPrice: lo,
      discountDollars: Math.max(0, p.price - lo),
      discountPct: Number((((p.price - lo) / p.price) * 100).toFixed(1)),
      achievable: false,
    };
  }

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (evalMetric(mid) >= targetValue) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const maxPrice = Math.round(lo / 500) * 500;
  const discountDollars = p.price - maxPrice;
  const discountPct = Number(((discountDollars / p.price) * 100).toFixed(1));

  return {
    targetMetric,
    targetValue,
    maxPrice,
    discountDollars,
    discountPct,
    achievable: true,
  };
}

export function portfolioToCSV(properties: PropertyParcel[], strat: UnderwritingStrategy): string {
  const headers = [
    'address',
    'beds',
    'sqft',
    'price',
    'rent',
    'downPct',
    'rate',
    'opexPct',
    'vacancyPct',
    'rentGrowthPct',
    'appreciationPct',
    'rehab',
    'roofAgeYears',
    'lat',
    'lng',
    'capRate',
    'coc',
    'dscr',
    'irr10Yr',
    'verdict',
  ];
  const rows = properties.map((p) => {
    const m = calcUnderwriting(p, strat);
    const vals = [
      `"${p.address.replace(/"/g, '""')}"`,
      p.beds,
      p.sqft,
      p.price,
      p.rent,
      p.downPct,
      p.rate,
      p.opexPct,
      p.vacancyPct,
      p.rentGrowthPct,
      p.appreciationPct,
      p.rehab,
      p.roofAgeYears,
      p.lat,
      p.lng,
      m.capRate.toFixed(2),
      m.coc.toFixed(2),
      m.dscr.toFixed(2),
      m.irr10Yr.toFixed(2),
      m.verdict,
    ];
    return vals.join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

export function parsePortfolioCSV(csvText: string): PropertyParcel[] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitRow(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string, fallback?: string) => {
    const i = headers.indexOf(name.toLowerCase());
    if (i >= 0) return i;
    return fallback ? headers.indexOf(fallback.toLowerCase()) : -1;
  };

  const num = (cells: string[], i: number, def: number) => {
    if (i < 0 || !cells[i]) return def;
    const cleaned = cells[i].replace(/[$,%]/g, '');
    const v = Number(cleaned);
    return Number.isFinite(v) ? v : def;
  };

  const results: PropertyParcel[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitRow(lines[r]);
    const addrIdx = idx('address', 'street');
    const address = addrIdx >= 0 ? cells[addrIdx] : '';
    if (!address) continue;
    results.push({
      id: `csv-${Date.now()}-${r}`,
      address,
      beds: num(cells, idx('beds'), 3),
      sqft: num(cells, idx('sqft'), 1850),
      price: num(cells, idx('price', 'asking_price'), 350000),
      rent: num(cells, idx('rent', 'monthly_rent'), 3100),
      downPct: num(cells, idx('downpct', 'down_pct'), 20),
      rate: num(cells, idx('rate', 'interest_rate'), 6.25),
      opexPct: num(cells, idx('opexpct', 'opex_pct'), 32),
      vacancyPct: num(cells, idx('vacancypct', 'vacancy_pct'), 5),
      rentGrowthPct: num(cells, idx('rentgrowthpct'), 3.0),
      appreciationPct: num(cells, idx('appreciationpct'), 3.8),
      rehab: num(cells, idx('rehab'), 15000),
      roofAgeYears: num(cells, idx('roofageyears'), 10),
      lat: num(cells, idx('lat', 'latitude'), 30.2672),
      lng: num(cells, idx('lng', 'longitude'), -97.7431),
    });
  }
  return results;
}
