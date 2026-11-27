import type {
  DOEResult,
  MonteCarloResult,
  PersonaProfile,
  PropertyParcel,
  ReportType,
  StormHazardResult,
  UnderwritingMetrics,
  UnderwritingStrategy,
} from './types';
import { calcUnderwriting, solveTargetPrice } from './underwriting';
import { FIDUCIARY_DISCLAIMER } from './fiduciary';

export function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtDollars(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

/**
 * Bug-fixed Dusk Markdown-to-HTML renderer.
 * Uses valid theme tokens (--color-ink, --color-ink-2, --color-rule, --color-accent)
 * and escapes all raw HTML to prevent XSS.
 */
export function formatMarkdownToDuskHTML(md: string): string {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const inline = (s: string) =>
    escHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--color-ink);font-weight:600">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(
        /`([^`]+)`/g,
        '<code class="px-1.5 py-0.5 rounded text-xs" style="background:oklch(77% 0.10 274 / 0.14);color:var(--color-accent)">$1</code>'
      );

  let html = '';
  let inList = false;
  let inTable = false;

  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      html += '</tbody></table></div>';
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) {
      closeList();
      closeTable();
      continue;
    }

    if (/^\|.+\|$/.test(raw)) {
      closeList();
      const cells = raw
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!inTable) {
        inTable = true;
        html +=
          '<div class="overflow-x-auto my-3 rounded-lg" style="border:1px solid var(--color-rule)"><table class="w-full text-left border-collapse text-xs">';
        html +=
          '<thead><tr style="background:oklch(77% 0.10 274 / 0.09);border-bottom:1px solid var(--color-rule)">' +
          cells
            .map((c) => `<th class="py-2 px-3 font-semibold" style="color:var(--color-ink)">${inline(c)}</th>`)
            .join('') +
          '</tr></thead><tbody>';
      } else {
        html +=
          '<tr style="border-bottom:1px solid oklch(100% 0 0 / 0.06)">' +
          cells
            .map((c) => `<td class="py-2 px-3 num" style="color:var(--color-ink-2)">${inline(c)}</td>`)
            .join('') +
          '</tr>';
      }
      continue;
    }
    closeTable();

    if (/^---+$/.test(raw)) {
      closeList();
      html += '<hr class="my-3" style="border-color:var(--color-rule)"/>';
      continue;
    }

    const hMatch = raw.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      closeList();
      const lvl = hMatch[1].length;
      const cls =
        lvl <= 2
          ? 'text-sm font-semibold mt-4 mb-1.5 tracking-tight'
          : 'text-xs font-semibold uppercase tracking-wider mt-3 mb-1';
      const clr = lvl <= 2 ? 'var(--color-ink)' : 'var(--color-accent)';
      html += `<h${lvl + 1} class="${cls}" style="color:${clr}">${inline(hMatch[2])}</h${lvl + 1}>`;
      continue;
    }

    const liMatch = raw.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
    if (liMatch) {
      if (!inList) {
        html += '<ul class="space-y-1.5 my-2 pl-4 list-disc" style="color:var(--color-ink-2)">';
        inList = true;
      }
      html += `<li class="text-sm leading-relaxed">${inline(liMatch[1])}</li>`;
      continue;
    }

    closeList();
    html += `<p class="text-sm leading-relaxed my-1.5" style="color:var(--color-ink-2)">${inline(raw)}</p>`;
  }

  closeList();
  closeTable();
  return html;
}

export function buildQuantFallbackMarkdown(params: {
  type: ReportType;
  parcel: PropertyParcel;
  metrics: UnderwritingMetrics;
  doe: DOEResult;
  mc: MonteCarloResult;
  hazard: StormHazardResult;
  properties: PropertyParcel[];
  strategy: UnderwritingStrategy;
  persona: PersonaProfile;
}): string {
  const { type, parcel: p, metrics: m, doe, mc, hazard, properties, strategy, persona } = params;
  const downPctWhole = Math.round(m.downPct * 100);
  const opexPctWhole = Math.round(m.opexPct * 100);
  const vacPctWhole = Math.round(m.vacancyPct * 100);
  const yr10Eq = m.equitySeries[m.equitySeries.length - 1] ?? 0;
  const yr10Cf = m.cfSeries[m.cfSeries.length - 1] ?? 0;
  const solver = solveTargetPrice(p, strategy, 'dscr', 1.25);

  if (type === 'negotiation') {
    const targetPrice = solver.achievable ? Math.min(m.price, solver.maxPrice) : Math.round(m.price * 0.9);
    const creditAsk = Math.round(m.price * 0.025);
    return `### Seller Negotiation & Offer Strategy — ${p.address}
- **Persona Lens:** ${persona.label} · **Current Verdict:** **${m.verdict}** (DSCR ${m.dscr.toFixed(2)}x at ${fmtDollars(m.price)})
- **Target-Price Solver (1.25x DSCR):** **${fmtDollars(targetPrice)}** (${solver.discountPct > 0 ? `-${solver.discountPct}%` : 'Clears at ask'}) plus **${fmtDollars(creditAsk)}** seller credit toward a 2-1 rate buydown.
- **Roof & CapEx Leverage:** ${p.roofAgeYears}-year roof age justifies a **${fmtDollars(hazard.recommendedCapexReserve)}** inspection reserve request.

| Negotiation Lever | Current Ask | Target Terms | Underwriting Impact |
|---|---|---|---|
| Purchase Price | ${fmtDollars(m.price)} | ${fmtDollars(targetPrice)} | Improves Debt Coverage to ≥1.25x |
| Debt Rate | ${(m.rate * 100).toFixed(2)}% | ${Math.max(3, m.rate * 100 - 0.75).toFixed(2)}% | Cuts monthly debt service |
| Cash-to-Close | ${fmtDollars(m.cashIn)} | ${fmtDollars(m.cashIn * (targetPrice / m.price))} | Lower equity at risk |`;
  }

  if (type === 'cma') {
    const rows = properties
      .map((prop, idx) => {
        const pm = calcUnderwriting(prop, strategy);
        return `| #${idx + 1} ${prop.address} | ${fmtDollars(pm.price)} | ${fmtDollars(pm.baseRent)}/mo | ${pm.capRate.toFixed(2)}% | ${pm.coc.toFixed(2)}% | ${pm.dscr.toFixed(2)}x | ${pm.irr10Yr.toFixed(1)}% | **${pm.verdict}** |`;
      })
      .join('\n');
    return `### Portfolio Comparative Market Analysis (${properties.length} Assets · ${strategy.toUpperCase()})
| Asset | Price | Rent | Cap Rate | CoC | DSCR | 10-Yr IRR | Verdict |
|---|---|---|---|---|---|---|---|
${rows}

- **Active Focus:** ${p.address} posts **${m.capRate.toFixed(2)}% Cap**, **${m.dscr.toFixed(2)}x DSCR**, and **${m.irr10Yr.toFixed(1)}% 10-Yr Levered IRR**.`;
  }

  if (type === 'lp_memo') {
    return `### Institutional LP Deal Brief — ${p.address}
- **Required LP Equity:** ${fmtDollars(m.cashIn)} (${downPctWhole}% down + 3% closing + ${fmtDollars(m.rehab)} CapEx)
- **10-Year Projected Wealth:** ${fmtDollars(yr10Eq + yr10Cf)} (**${m.equityMultiple10Yr.toFixed(2)}x** Equity Multiple · **${m.irr10Yr.toFixed(2)}%** Levered IRR)
- **Downside Stress Resilience:** **${doe.passCount}/8** 2³ DOE corners clear 1.20x DSCR; Monte Carlo (${mc.dataLabel}) P10/P50/P90 DSCR is **${mc.dscrP10}x / ${mc.dscrP50}x / ${mc.dscrP90}x** (${mc.probDscrAbove120}% probability ≥1.20x).

| Institutional Metric | Modeled Value |
|---|---|
| Annual NOI | ${fmtDollars(m.noi)} |
| Year-1 Cash-on-Cash | ${m.coc.toFixed(2)}% |
| Break-Even Occupancy | ${m.breakEvenOccPct.toFixed(1)}% |
| Debt Yield | ${m.debtYield.toFixed(2)}% |
| 10-Yr Levered IRR | ${m.irr10Yr.toFixed(2)}% |`;
  }

  if (type === 'fiduciary_brief') {
    return `### Fiduciary Education-Only Brief (SR 11-7) — ${p.address}
- **Governance Notice:** ${FIDUCIARY_DISCLAIMER}
- **Risk-Adjusted Cash Cushion:** Monthly Net Cash Flow is **${fmtDollars(m.mCf)}** with a Break-Even Occupancy of **${m.breakEvenOccPct.toFixed(1)}%** (Vacancy modeled at ${vacPctWhole}%, Operating Load at ${opexPctWhole}%).
- **Sensitivity Guardrail:** Under 1,000 synthetic Monte Carlo trials, P10 downside DSCR is **${mc.dscrP10}x** (95% bootstrap CI on mean DSCR: \`[${mc.dscrCi95[0]}x, ${mc.dscrCi95[1]}x]\`).

| Fiduciary Pillar | Quantitative Reading |
|---|---|
| Debt Coverage (DSCR) | ${m.dscr.toFixed(2)}x |
| Break-Even Occupancy | ${m.breakEvenOccPct.toFixed(1)}% |
| 10-Yr Equity Multiple | ${m.equityMultiple10Yr.toFixed(2)}x |
| Physical Storm Risk | ${hazard.hazardScore}/100 (${hazard.tier}) |`;
  }

  if (type === 'storm_risk') {
    return `### AUCTUM.atlas Physical & Catastrophe Risk Memo — ${p.address}
- **Hazard Classification:** **${hazard.hazardScore}/100 — ${hazard.tier}**
- **Envelope & Roof Assessment:** ${hazard.narrative}
- **Insurance Stress Impact:** Applying a +${hazard.recommendedInsuranceShockPct}% insurance shock raises effective operating load and underscores the need for a **${fmtDollars(hazard.recommendedCapexReserve)}** dedicated CapEx reserve.

| Catastrophe Metric | Reading |
|---|---|
| Roof Age / Wear | ${p.roofAgeYears} yrs (${Math.round(hazard.roofVulnerability * 100)}%) |
| Hazard Score | ${hazard.hazardScore} / 100 |
| Recommended Insurance Stress | +${hazard.recommendedInsuranceShockPct}% |
| Recommended Roof/Envelope Reserve | ${fmtDollars(hazard.recommendedCapexReserve)} |`;
  }

  return `### IC Audit Executive Memo — ${p.address}
- **Recommendation:** **${m.verdict}** · Persona: **${persona.label}** · Strategy: **${strategy.toUpperCase()}**
- **Core Returns:** Cap Rate **${m.capRate.toFixed(2)}%** · DSCR **${m.dscr.toFixed(2)}x** · 10-Yr IRR **${m.irr10Yr.toFixed(2)}%** · Equity Multiple **${m.equityMultiple10Yr.toFixed(2)}x**
- **Experimental Design Stress:** **${doe.passCount}/8** 2³ DOE runs clear 1.20x DSCR; Monte Carlo P50 DSCR **${mc.dscrP50}x** (P10 **${mc.dscrP10}x**).

| Underwriting Metric | Modeled Value |
|---|---|
| Purchase Price (${downPctWhole}% Down) | ${fmtDollars(m.price)} |
| Monthly Gross Rent (${vacPctWhole}% Vac / ${opexPctWhole}% OpEx) | ${fmtDollars(m.grossMo)} |
| Net Operating Income (NOI) | ${fmtDollars(m.noiMo)}/mo (${fmtDollars(m.noi)}/yr) |
| Debt Service (${(m.rate * 100).toFixed(2)}%) | ${fmtDollars(m.mDebt)}/mo |
| Monthly Net Cash Flow | ${fmtDollars(m.mCf)}/mo |
| Cash-on-Cash / Break-Even Occ | ${m.coc.toFixed(2)}% / ${m.breakEvenOccPct.toFixed(1)}% |`;
}
