import type {
  LocationAudit,
  PropertyParcel,
  ShapleyAttribution,
  UnderwritingStrategy,
} from '../engine/types';
import { calcUnderwriting } from '../engine/underwriting';
import { computeDOEFactorial, runMonteCarloStress } from '../engine/doe';
import { computeLocalShapley } from '../engine/shapley';
import { evaluateLocalStormHazard } from '../engine/fiduciary';
import { escHtml, fmtDollars, formatMarkdownToDuskHTML } from '../engine/markdown';
import {
  computeEconometricModel,
  computeHuffSpatialGravity,
  computePowerAnalysis,
  generateScientificManuscript,
  papersToBibTeX,
  runVerificationContract,
} from '../engine/scientificApps';
import {
  type AcademicPaper,
  type MasternexConfig,
  runMasternexStormHazard,
  runMasternexUnderwrite,
  searchAcademicLiterature,
} from '../connectors/masternex';
import {
  HF_DATASET_PRESETS,
  type HFBenchmarkRow,
  fetchCustomHFDataset,
  hfRowsToCSV,
} from '../connectors/huggingface';
import { KDENSE_SCIENTIFIC_SKILLS, buildKDenseSkillPrompt } from '../connectors/kdense';

export type LabAppId =
  | 'experimental-design'
  | 'masternex-scientific'
  | 'statistical-analysis'
  | 'geospatial-analysis'
  | 'scientific-writing'
  | 'hf-datasets'
  | 'literature-search';

interface LabAppDef {
  id: LabAppId;
  badge: string;
  title: string;
  subtitle: string;
}

export const LAB_APPS: LabAppDef[] = [
  {
    id: 'experimental-design',
    badge: '/skill:experimental-design',
    title: 'Experimental Design Lab',
    subtitle: 'Statistical Power · Sample Size · 2³ DOE',
  },
  {
    id: 'masternex-scientific',
    badge: '/skill:masternex-scientific',
    title: 'MASTERNEX Verification App',
    subtitle: 'Honest-by-Construction · ACP-SQL Seal · Auditor Pack',
  },
  {
    id: 'statistical-analysis',
    badge: '/skill:statistical-analysis',
    title: 'Econometrics & Tail-Risk Lab',
    subtitle: 'Portfolio OLS Regression · 95%/99% VaR & CVaR',
  },
  {
    id: 'geospatial-analysis',
    badge: '/skill:geospatial-analysis',
    title: 'Geospatial & Huff Gravity App',
    subtitle: 'Distance-Decay Accessibility · H3 Cell · Storm Swath',
  },
  {
    id: 'scientific-writing',
    badge: '/skill:scientific-writing',
    title: 'Scientific Writing & LaTeX Studio',
    subtitle: 'Publication .tex & .md IC/LP Dossiers · Auto-Citations',
  },
  {
    id: 'hf-datasets',
    badge: 'Hugging Face Hub',
    title: 'HF Datasets Benchmark Workbench',
    subtitle: 'Custom Dataset Streaming · Pagination · Filter · CSV',
  },
  {
    id: 'literature-search',
    badge: 'Nature · OpenAlex · arXiv',
    title: 'Peer-Reviewed Literature Workbench',
    subtitle: 'Live Search · Cite-in-Paper Cart · BibTeX (.bib)',
  },
];

export interface LabCallbacks {
  getParcel: () => PropertyParcel;
  getProperties: () => PropertyParcel[];
  getStrategy: () => UnderwritingStrategy;
  getLocationAudit: (id: string) => LocationAudit | undefined;
  getAttribution: () => ShapleyAttribution | null;
  setAttribution: (attr: ShapleyAttribution) => void;
  getMasternexConfig: () => MasternexConfig;
  triggerOverpassScan: () => Promise<void>;
  showToast: (msg: string) => void;
}

export class LabAppsController {
  public activeApp: LabAppId = 'experimental-design';

  // Per-app interactive state
  private alpha = 0.05;
  private targetPower = 0.8;
  private effectSizeD = 0.5;
  private volScale = 1.0;
  private huffBeta = 1.5;
  private writingMode: 'preview' | 'markdown' | 'latex' = 'preview';

  // HF Workbench state
  private hfDataset = HF_DATASET_PRESETS[1].dataset; // FinGPT default matching user interest
  private hfConfig = HF_DATASET_PRESETS[1].config;
  private hfSplit = HF_DATASET_PRESETS[1].split;
  private hfOffset = 0;
  private hfFilter = '';
  private hfMode = 'ready';
  private hfRows: HFBenchmarkRow[] = [];

  // Literature Workbench state
  private litQuery = 'real estate cap rate DSCR climate risk';
  private litMode = 'ready';
  private litResults: AcademicPaper[] = [];
  private citations: AcademicPaper[] = [];

  constructor(private cb: LabCallbacks) {}

  public openApp(id: LabAppId): void {
    this.activeApp = id;
    this.render();
  }

  private downloadText(filename: string, content: string, mime = 'text/plain'): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
  }

  public render(): void {
    const navEl = document.getElementById('lab-app-nav');
    const stageEl = document.getElementById('lab-app-stage');
    if (!navEl || !stageEl) return;

    navEl.innerHTML = LAB_APPS.map(
      (app) => `
      <button type="button" data-lab-app="${app.id}" class="account-row ${
        app.id === this.activeApp ? 'active' : ''
      }" style="width:100%;text-align:left;border:${
        app.id === this.activeApp ? '1px solid var(--color-accent)' : '1px solid transparent'
      };background:${app.id === this.activeApp ? 'oklch(77% 0.10 274 / 0.10)' : 'transparent'}">
        <div>
          <div class="text-xs text-accent mono">${escHtml(app.badge)}</div>
          <div class="text-sm" style="font-weight:600;color:var(--color-ink)">${escHtml(app.title)}</div>
          <div class="text-xs text-muted">${escHtml(app.subtitle)}</div>
        </div>
      </button>`
    ).join('');

    navEl.querySelectorAll<HTMLButtonElement>('[data-lab-app]').forEach((b) =>
      b.addEventListener('click', () => {
        this.activeApp = b.dataset.labApp as LabAppId;
        this.render();
      })
    );

    const p = this.cb.getParcel();
    const strat = this.cb.getStrategy();
    const m = calcUnderwriting(p, strat);
    const doe = computeDOEFactorial(p, strat);
    const mc = runMonteCarloStress(p, strat, 1000, 42);
    const audit = this.cb.getLocationAudit(p.id);
    const attr =
      this.cb.getAttribution() ??
      computeLocalShapley(m, doe, audit?.score ?? 68, p.lat, p.lng);
    const hazard = evaluateLocalStormHazard(p);

    if (this.activeApp === 'experimental-design') {
      this.renderExperimentalDesign(stageEl, p, m, doe);
    } else if (this.activeApp === 'masternex-scientific') {
      this.renderMasternexVerification(stageEl, p, m, doe, mc, attr);
    } else if (this.activeApp === 'statistical-analysis') {
      this.renderStatisticalApp(stageEl, p, strat);
    } else if (this.activeApp === 'geospatial-analysis') {
      this.renderGeospatialApp(stageEl, p, audit, hazard);
    } else if (this.activeApp === 'scientific-writing') {
      this.renderScientificWriting(stageEl, p, m, doe, mc, attr, hazard);
    } else if (this.activeApp === 'hf-datasets') {
      this.renderHFWorkbench(stageEl);
    } else if (this.activeApp === 'literature-search') {
      this.renderLiteratureWorkbench(stageEl);
    }
  }

  private renderExperimentalDesign(
    el: HTMLElement,
    p: PropertyParcel,
    m: ReturnType<typeof calcUnderwriting>,
    doe: ReturnType<typeof computeDOEFactorial>
  ): void {
    const pwr = computePowerAnalysis(this.alpha, this.targetPower, this.effectSizeD);
    el.innerHTML = `
      <div class="stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.65rem">
          <div>
            <span class="badge badge-peri">/skill:experimental-design</span>
            <h3 style="margin-top:4px">Experimental Design &amp; Statistical Power Lab</h3>
            <p class="text-xs text-muted">Active Parcel: ${escHtml(p.address)} · 2³ Orthogonal DOE + A/B Sample Size Calculator</p>
          </div>
          <div class="flex-row">
            <button id="lab-exp-copy" type="button" class="btn-ghost btn-sm">Copy /skill Prompt</button>
            <button id="lab-exp-export" type="button" class="btn-peri btn-sm">Export DOE Spec JSON</button>
          </div>
        </div>

        <div class="grid-3 text-xs">
          <label class="inner-well pad-well">
            <div class="flex-between text-muted"><span>Significance (α)</span><strong class="num text-accent">${this.alpha}</strong></div>
            <select id="lab-exp-alpha" class="field-select" style="margin-top:6px">
              <option value="0.05" ${this.alpha === 0.05 ? 'selected' : ''}>0.05 (95% Confidence)</option>
              <option value="0.01" ${this.alpha === 0.01 ? 'selected' : ''}>0.01 (99% Confidence)</option>
              <option value="0.1" ${this.alpha === 0.1 ? 'selected' : ''}>0.10 (Exploratory)</option>
            </select>
          </label>
          <label class="inner-well pad-well">
            <div class="flex-between text-muted"><span>Target Power (1 − β)</span><strong class="num text-ok">${Math.round(this.targetPower * 100)}%</strong></div>
            <input id="lab-exp-power" type="range" min="0.7" max="0.95" step="0.05" value="${this.targetPower}" style="margin-top:10px" />
          </label>
          <label class="inner-well pad-well">
            <div class="flex-between text-muted"><span>Effect Size (Cohen's d)</span><strong class="num">${this.effectSizeD.toFixed(2)}</strong></div>
            <input id="lab-exp-d" type="range" min="0.2" max="1.2" step="0.05" value="${this.effectSizeD}" style="margin-top:10px" />
          </label>
        </div>

        <div class="grid-4">
          <div class="inner-well pad-well"><div class="text-xs text-muted">Required n / Arm</div><div class="num text-xl text-accent">${pwr.nPerArm}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">Total Sample N</div><div class="num text-xl">${pwr.totalSampleSize}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">2³ DOE Pass Rate</div><div class="num text-xl text-ok">${doe.passCount} / 8</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">DOE Mean ± SD DSCR</div><div class="num text-xl">${doe.meanDscr}x <span class="c">±${doe.stdDscr}</span></div></div>
        </div>

        <div class="inner-well pad-well stack-xs">
          <div class="text-xs text-muted">Power Curve by Sample Size (n per arm)</div>
          <div class="grid-4">
            ${pwr.powerCurve
              .map(
                (pt) => `<div class="text-xs">
                  <div class="flex-between"><span>n=${pt.n}</span><strong class="num">${Math.round(pt.power * 100)}%</strong></div>
                  <div style="height:6px;background:oklch(100% 0 0 / 0.08);border-radius:99px;margin-top:3px;overflow:hidden">
                    <div style="width:${Math.round(pt.power * 100)}%;height:100%;background:${
                      pt.power >= this.targetPower ? 'var(--color-ok)' : 'var(--color-accent)'
                    }"></div>
                  </div>
                </div>`
              )
              .join('')}
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Term</th><th>Factor / Interaction</th><th>Kind</th><th>DSCR Effect</th><th>10-Yr CF Effect</th></tr></thead>
            <tbody>
              ${doe.effects
                .map(
                  (ef) => `<tr>
                    <td class="mono">${ef.term}</td>
                    <td>${escHtml(ef.label)}</td>
                    <td><span class="badge ${ef.kind === 'main' ? 'badge-peri' : 'badge-negotiate'}">${ef.kind}</span></td>
                    <td class="num ${ef.dscrEffect < 0 ? 'text-dusk' : 'text-ok'}">${ef.dscrEffect > 0 ? '+' : ''}${ef.dscrEffect}x</td>
                    <td class="num">${fmtDollars(ef.cfEffect)}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('lab-exp-alpha')?.addEventListener('change', (e) => {
      this.alpha = Number((e.target as HTMLSelectElement).value);
      this.render();
    });
    document.getElementById('lab-exp-power')?.addEventListener('input', (e) => {
      this.targetPower = Number((e.target as HTMLInputElement).value);
      this.render();
    });
    document.getElementById('lab-exp-d')?.addEventListener('input', (e) => {
      this.effectSizeD = Number((e.target as HTMLInputElement).value);
      this.render();
    });
    document.getElementById('lab-exp-export')?.addEventListener('click', () => {
      this.downloadText(
        'AUCTUM_DOE_Power_Spec.json',
        JSON.stringify({ parcel: p.address, powerAnalysis: pwr, doe }, null, 2),
        'application/json'
      );
      this.cb.showToast('Exported DOE & Power Spec JSON');
    });
    document.getElementById('lab-exp-copy')?.addEventListener('click', async () => {
      const prompt = buildKDenseSkillPrompt({
        skill: KDENSE_SCIENTIFIC_SKILLS[0],
        parcel: p,
        metrics: m,
        doe,
      });
      try {
        await navigator.clipboard.writeText(prompt);
        this.cb.showToast('Copied /skill:experimental-design prompt');
      } catch {
        this.cb.showToast('Prepared prompt');
      }
    });
  }

  private renderMasternexVerification(
    el: HTMLElement,
    p: PropertyParcel,
    m: ReturnType<typeof calcUnderwriting>,
    doe: ReturnType<typeof computeDOEFactorial>,
    mc: ReturnType<typeof runMonteCarloStress>,
    attr: ShapleyAttribution
  ): void {
    const checks = runVerificationContract({ mc, doe, attr });
    const passedCount = checks.filter((c) => c.passed).length;

    el.innerHTML = `
      <div class="stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.65rem">
          <div>
            <span class="badge badge-peri">/skill:masternex-scientific</span>
            <h3 style="margin-top:4px">MASTERNEX Honest-by-Construction Verification App</h3>
            <p class="text-xs text-muted">Automated verification contract, Shapley 10,000 bps invariant &amp; ACP-SQL / ML-DSA-87 attestation</p>
          </div>
          <div class="flex-row">
            <button id="lab-mn-seal" type="button" class="btn-peri btn-sm">Run Live MASTERNEX Seal</button>
            <button id="lab-mn-export" type="button" class="btn-ghost btn-sm">Download Auditor Pack</button>
          </div>
        </div>

        <div class="grid-4">
          <div class="inner-well pad-well"><div class="text-xs text-muted">Contract Score</div><div class="num text-xl text-ok">${passedCount} / ${checks.length}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">NADE / GIE / BNE</div><div class="num text-sm" style="margin-top:4px">${attr.nadeBps} / ${attr.gieBps} / ${attr.bneBps} bps</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">H3 Hex Cell</div><div class="mono text-xs text-accent" style="margin-top:6px">${escHtml(attr.hexCell)}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">Ledger Status</div><div style="margin-top:4px"><span class="badge ${attr.ledgerVerified ? 'badge-acquire' : 'badge-negotiate'}">${attr.ledgerVerified ? 'SEALED & VERIFIED' : 'LOCAL PREVIEW'}</span></div></div>
        </div>

        <div class="stack-xs">
          ${checks
            .map(
              (c) => `<div class="inner-well pad-well flex-between text-xs">
                <div>
                  <strong style="color:var(--color-ink)">${escHtml(c.name)}</strong>
                  <div class="text-muted">${escHtml(c.detail)}</div>
                </div>
                <span class="badge ${c.passed ? 'badge-acquire' : 'badge-negotiate'}">${c.passed ? 'PASS' : 'PENDING'}</span>
              </div>`
            )
            .join('')}
        </div>
      </div>`;

    document.getElementById('lab-mn-seal')?.addEventListener('click', async () => {
      const { attribution } = await runMasternexUnderwrite({
        cfg: this.cb.getMasternexConfig(),
        parcel: p,
        metrics: m,
        doe,
        locationScore: this.cb.getLocationAudit(p.id)?.score ?? 68,
        reportType: 'Verification Audit',
      });
      this.cb.setAttribution(attribution);
      this.cb.showToast(
        attribution.source === 'masternex-live'
          ? `Sealed in MASTERNEX ACP-SQL (${attribution.packetId})`
          : 'MASTERNEX offline — computed local Shapley preview'
      );
      this.render();
    });

    document.getElementById('lab-mn-export')?.addEventListener('click', () => {
      const pack = {
        schema: 'auctum.verification.auditor_pack.v1',
        generatedAt: new Date().toISOString(),
        parcel: p,
        metrics: { capRate: m.capRate, dscr: m.dscr, irr10Yr: m.irr10Yr, verdict: m.verdict },
        checks,
        attribution: attr,
        monteCarlo: { dataLabel: mc.dataLabel, dscrCi95: mc.dscrCi95, irrCi95: mc.irrCi95 },
      };
      this.downloadText('AUCTUM_Auditor_Pack.json', JSON.stringify(pack, null, 2), 'application/json');
      this.cb.showToast('Downloaded Auditor Pack JSON');
    });
  }

  private renderStatisticalApp(el: HTMLElement, p: PropertyParcel, strat: UnderwritingStrategy): void {
    const econ = computeEconometricModel(this.cb.getProperties(), p, strat, this.volScale);

    el.innerHTML = `
      <div class="stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.65rem">
          <div>
            <span class="badge badge-peri">/skill:statistical-analysis</span>
            <h3 style="margin-top:4px">Econometric Regression &amp; Tail-Risk VaR/CVaR Lab</h3>
            <p class="text-xs text-muted">Portfolio OLS regression (Rent ~ Price) + 500-trial annual cash-flow Expected Shortfall</p>
          </div>
          <label class="flex-row text-xs inner-well" style="padding:6px 12px">
            <span class="text-muted">Shock Volatility (σ):</span>
            <input id="lab-stat-vol" type="range" min="0.5" max="2.0" step="0.1" value="${this.volScale}" style="width:110px" />
            <strong class="num text-accent">${this.volScale.toFixed(1)}x</strong>
          </label>
        </div>

        <div class="inner-well pad-well text-xs">
          <div class="text-muted">Estimated OLS Rent Function across ${econ.n} Portfolio Parcels</div>
          <div class="mono text-sm text-accent" style="margin-top:4px">
            Monthly Rent = ${econ.slope.toFixed(3)} × Price($k) + $${econ.intercept.toLocaleString()} &nbsp;·&nbsp; R² = ${econ.rSquared.toFixed(3)} &nbsp;·&nbsp; RMSE = $${econ.rmse}
          </div>
        </div>

        <div class="grid-4">
          <div class="inner-well pad-well"><div class="text-xs text-muted">Portfolio Mean Cap</div><div class="num text-xl">${econ.meanCapRate}% <span class="c">±${econ.capRateStd}%</span></div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">95% VaR (Annual CF)</div><div class="num text-xl text-apri">${fmtDollars(econ.var95AnnualCf)}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">95% CVaR (Shortfall)</div><div class="num text-xl text-dusk">${fmtDollars(econ.cvar95AnnualCf)}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">99% Extreme Tail</div><div class="num text-xl text-dusk">${fmtDollars(econ.var99AnnualCf)}</div></div>
        </div>
      </div>`;

    document.getElementById('lab-stat-vol')?.addEventListener('input', (e) => {
      this.volScale = Number((e.target as HTMLInputElement).value);
      this.render();
    });
  }

  private renderGeospatialApp(
    el: HTMLElement,
    p: PropertyParcel,
    audit: LocationAudit | undefined,
    hazard: ReturnType<typeof evaluateLocalStormHazard>
  ): void {
    const huff = computeHuffSpatialGravity(p, audit, this.huffBeta);

    el.innerHTML = `
      <div class="stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.65rem">
          <div>
            <span class="badge badge-peri">/skill:geospatial-analysis</span>
            <h3 style="margin-top:4px">Geospatial Trade-Area &amp; Huff Gravity App</h3>
            <p class="text-xs text-muted">Distance-decay accessibility ∑ wᵢ / (1 + dᵢ^β) · H3 Cell ${escHtml(huff.hexCell)} · AUCTUM.atlas Storm Swath</p>
          </div>
          <div class="flex-row">
            <button id="lab-geo-overpass" type="button" class="btn-peri btn-sm">Scan Live Overpass POIs</button>
            <button id="lab-geo-atlas" type="button" class="btn-ghost btn-sm">Probe AUCTUM.atlas</button>
          </div>
        </div>

        <label class="inner-well pad-well flex-between text-xs">
          <span class="text-muted">Distance-Decay Exponent (β): higher β penalizes farther POIs more steeply</span>
          <div class="flex-row">
            <input id="lab-geo-beta" type="range" min="0.5" max="3.0" step="0.1" value="${this.huffBeta}" style="width:140px" />
            <strong class="num text-accent">β = ${this.huffBeta.toFixed(1)}</strong>
          </div>
        </label>

        <div class="grid-4">
          <div class="inner-well pad-well"><div class="text-xs text-muted">Huff Gravity Score</div><div class="num text-xl text-ok">${huff.gravityScore} / 100</div><div class="text-xs text-muted">${huff.tier}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">Schools Weight</div><div class="num text-xl">${huff.schoolWeight}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">Transit Weight</div><div class="num text-xl">${huff.transitWeight}</div></div>
          <div class="inner-well pad-well"><div class="text-xs text-muted">Retail Weight</div><div class="num text-xl">${huff.retailWeight}</div></div>
        </div>

        <div class="inner-well pad-well text-xs">
          <div class="flex-between">
            <strong>AUCTUM.atlas Catastrophe &amp; Roof Envelope</strong>
            <span class="badge ${hazard.hazardScore >= 68 ? 'badge-pass' : 'badge-negotiate'}">${hazard.hazardScore}/100 · ${hazard.tier}</span>
          </div>
          <p class="text-ink-2" style="margin-top:6px">${escHtml(hazard.narrative)}</p>
        </div>
      </div>`;

    document.getElementById('lab-geo-beta')?.addEventListener('input', (e) => {
      this.huffBeta = Number((e.target as HTMLInputElement).value);
      this.render();
    });
    document.getElementById('lab-geo-overpass')?.addEventListener('click', async () => {
      await this.cb.triggerOverpassScan();
      this.render();
    });
    document.getElementById('lab-geo-atlas')?.addEventListener('click', async () => {
      const res = await runMasternexStormHazard(this.cb.getMasternexConfig(), p);
      this.cb.showToast(`AUCTUM.atlas (${res.source}): ${res.hazardScore}/100 · ${res.tier}`);
    });
  }

  private renderScientificWriting(
    el: HTMLElement,
    p: PropertyParcel,
    m: ReturnType<typeof calcUnderwriting>,
    doe: ReturnType<typeof computeDOEFactorial>,
    mc: ReturnType<typeof runMonteCarloStress>,
    attr: ShapleyAttribution,
    hazard: ReturnType<typeof evaluateLocalStormHazard>
  ): void {
    const md = generateScientificManuscript({
      format: 'markdown',
      parcel: p,
      metrics: m,
      doe,
      mc,
      attr,
      hazard,
      citations: this.citations,
    });
    const tex = generateScientificManuscript({
      format: 'latex',
      parcel: p,
      metrics: m,
      doe,
      mc,
      attr,
      hazard,
      citations: this.citations,
    });

    el.innerHTML = `
      <div class="stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.65rem">
          <div>
            <span class="badge badge-peri">/skill:scientific-writing</span>
            <h3 style="margin-top:4px">Institutional IC &amp; LaTeX Manuscript Studio</h3>
            <p class="text-xs text-muted">${this.citations.length} pinned citation(s) from Literature Workbench auto-injected</p>
          </div>
          <div class="flex-row">
            <button data-wmode="preview" class="lab-wmode-btn ${this.writingMode === 'preview' ? 'btn-peri' : 'btn-ghost'} btn-sm">Preview</button>
            <button data-wmode="markdown" class="lab-wmode-btn ${this.writingMode === 'markdown' ? 'btn-peri' : 'btn-ghost'} btn-sm">Markdown</button>
            <button data-wmode="latex" class="lab-wmode-btn ${this.writingMode === 'latex' ? 'btn-peri' : 'btn-ghost'} btn-sm">LaTeX (.tex)</button>
            <button id="lab-dl-md" type="button" class="btn-ghost btn-sm">Download .md</button>
            <button id="lab-dl-tex" type="button" class="btn-apri">Download .tex</button>
          </div>
        </div>

        <div class="inner-well pad-card scroll-thin" style="max-height:460px">
          ${
            this.writingMode === 'preview'
              ? formatMarkdownToDuskHTML(md)
              : `<pre class="mono text-xs text-ink-2" style="margin:0;white-space:pre-wrap">${escHtml(
                  this.writingMode === 'latex' ? tex : md
                )}</pre>`
          }
        </div>
      </div>`;

    el.querySelectorAll<HTMLButtonElement>('.lab-wmode-btn').forEach((b) =>
      b.addEventListener('click', () => {
        this.writingMode = b.dataset.wmode as 'preview' | 'markdown' | 'latex';
        this.render();
      })
    );
    document.getElementById('lab-dl-md')?.addEventListener('click', () => {
      this.downloadText('AUCTUM_IC_Manuscript.md', md, 'text/markdown');
      this.cb.showToast('Downloaded Markdown manuscript');
    });
    document.getElementById('lab-dl-tex')?.addEventListener('click', () => {
      this.downloadText('AUCTUM_IC_Manuscript.tex', tex, 'application/x-tex');
      this.cb.showToast('Downloaded publication LaTeX (.tex)');
    });
  }

  private renderHFWorkbench(el: HTMLElement): void {
    const filtered = this.hfFilter.trim()
      ? this.hfRows.filter((r) =>
          `${r.market} ${r.metric} ${r.value} ${r.context}`
            .toLowerCase()
            .includes(this.hfFilter.trim().toLowerCase())
        )
      : this.hfRows;

    el.innerHTML = `
      <div class="stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.65rem">
          <div>
            <span class="badge badge-peri">datasets-server.huggingface.co/rows</span>
            <h3 style="margin-top:4px">Hugging Face Datasets Benchmark Workbench</h3>
            <p class="text-xs text-muted">Stream ANY public Hugging Face dataset with pagination, live filtering &amp; CSV export</p>
          </div>
          <div class="flex-row">
            <button id="lab-hf-csv" type="button" class="btn-ghost btn-sm" ${this.hfRows.length ? '' : 'disabled'}>Export CSV</button>
            <button id="lab-hf-stream" type="button" class="btn-peri btn-sm">Stream Rows</button>
          </div>
        </div>

        <div class="flex-row text-xs">
          ${HF_DATASET_PRESETS.map(
            (pr) => `<button type="button" data-hf-preset="${pr.id}" class="btn-ghost btn-sm">${escHtml(pr.label)}</button>`
          ).join('')}
        </div>

        <div class="grid-3 text-xs">
          <input id="lab-hf-dataset" type="text" class="field-input" value="${escHtml(this.hfDataset)}" placeholder="owner/dataset" />
          <input id="lab-hf-config" type="text" class="field-input" value="${escHtml(this.hfConfig)}" placeholder="config (default)" />
          <input id="lab-hf-split" type="text" class="field-input" value="${escHtml(this.hfSplit)}" placeholder="split (train)" />
        </div>

        <div class="flex-between text-xs">
          <input id="lab-hf-filter" type="text" class="field-input" style="max-width:300px" value="${escHtml(this.hfFilter)}" placeholder="Filter streamed rows by keyword..." />
          <div class="flex-row">
            <span class="badge badge-acquire">${escHtml(this.hfMode)} · offset ${this.hfOffset}</span>
            <button id="lab-hf-prev" type="button" class="btn-ghost btn-sm" ${this.hfOffset === 0 ? 'disabled' : ''}>← Prev</button>
            <button id="lab-hf-next" type="button" class="btn-ghost btn-sm">Next →</button>
          </div>
        </div>

        <div class="stack-xs scroll-thin" style="max-height:360px">
          ${
            filtered.length
              ? filtered
                  .map(
                    (r) => `<div class="inner-well pad-well text-xs">
                      <div class="flex-between"><strong>${escHtml(r.market)}</strong><span class="badge badge-peri">${escHtml(r.value)}</span></div>
                      <div style="margin-top:4px;color:var(--color-ink)">${escHtml(r.metric)}</div>
                      <div class="text-muted" style="margin-top:2px">${escHtml(r.context)}</div>
                    </div>`
                  )
                  .join('')
              : '<div class="inner-well pad-well text-xs text-muted">Click <strong>Stream Rows</strong> (or pick a preset above) to fetch live Hugging Face rows.</div>'
          }
        </div>
      </div>`;

    const doFetch = async () => {
      this.hfDataset = (document.getElementById('lab-hf-dataset') as HTMLInputElement)?.value.trim() || this.hfDataset;
      this.hfConfig = (document.getElementById('lab-hf-config') as HTMLInputElement)?.value.trim() || 'default';
      this.hfSplit = (document.getElementById('lab-hf-split') as HTMLInputElement)?.value.trim() || 'train';
      this.hfMode = 'streaming…';
      this.render();
      const res = await fetchCustomHFDataset({
        dataset: this.hfDataset,
        config: this.hfConfig,
        split: this.hfSplit,
        length: 8,
        offset: this.hfOffset,
      });
      this.hfMode = res.mode;
      this.hfRows = res.rows;
      this.render();
    };

    el.querySelectorAll<HTMLButtonElement>('[data-hf-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        const pr = HF_DATASET_PRESETS.find((x) => x.id === b.dataset.hfPreset);
        if (!pr) return;
        this.hfDataset = pr.dataset;
        this.hfConfig = pr.config;
        this.hfSplit = pr.split;
        this.hfOffset = 0;
        void doFetch();
      })
    );
    document.getElementById('lab-hf-stream')?.addEventListener('click', () => {
      this.hfOffset = 0;
      void doFetch();
    });
    document.getElementById('lab-hf-prev')?.addEventListener('click', () => {
      this.hfOffset = Math.max(0, this.hfOffset - 8);
      void doFetch();
    });
    document.getElementById('lab-hf-next')?.addEventListener('click', () => {
      this.hfOffset += 8;
      void doFetch();
    });
    document.getElementById('lab-hf-filter')?.addEventListener('input', (e) => {
      this.hfFilter = (e.target as HTMLInputElement).value;
      this.render();
    });
    document.getElementById('lab-hf-csv')?.addEventListener('click', () => {
      this.downloadText('AUCTUM_HF_Benchmarks.csv', hfRowsToCSV(filtered), 'text/csv');
      this.cb.showToast(`Exported ${filtered.length} HF rows to CSV`);
    });
  }

  private renderLiteratureWorkbench(el: HTMLElement): void {
    el.innerHTML = `
      <div class="stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.65rem">
          <div>
            <span class="badge badge-peri">Nature · OpenAlex · arXiv · PubMed</span>
            <h3 style="margin-top:4px">Peer-Reviewed Literature &amp; Citation Workbench</h3>
            <p class="text-xs text-muted">Pin works into your Bibliography Cart (${this.citations.length} cited) to auto-populate the LaTeX/MD Writing Studio</p>
          </div>
          <button id="lab-lit-bib" type="button" class="btn-apri" ${this.citations.length ? '' : 'disabled'}>Export BibTeX (.bib)</button>
        </div>

        <form id="lab-lit-form" class="flex-row">
          <input id="lab-lit-query" type="text" class="field-input" style="flex:1" value="${escHtml(this.litQuery)}" placeholder="Search urban economics, cap rates, climate risk, DOE..." />
          <button type="submit" class="btn-peri btn-sm">Search Literature</button>
        </form>

        <div class="stack-xs scroll-thin" style="max-height:380px">
          ${
            this.litResults.length
              ? `<div class="text-xs text-muted">Mode: <span class="badge badge-acquire">${escHtml(this.litMode)}</span></div>` +
                this.litResults
                  .map((paper, idx) => {
                    const cited = this.citations.some((c) => c.title === paper.title);
                    return `<div class="inner-well pad-well flex-between text-xs">
                      <div style="flex:1">
                        <div class="text-accent">${escHtml(paper.source)} · ${escHtml(paper.year)}</div>
                        <a href="${escHtml(paper.url)}" target="_blank" rel="noopener" style="font-weight:600;color:var(--color-ink)">${escHtml(
                          paper.title
                        )} ↗</a>
                        <div class="text-muted">${escHtml(paper.snippet)}</div>
                      </div>
                      <button type="button" data-cite-idx="${idx}" class="${cited ? 'btn-ghost' : 'btn-peri'} btn-sm">${
                        cited ? 'Cited ✓' : '+ Cite in Paper'
                      }</button>
                    </div>`;
                  })
                  .join('')
              : '<div class="inner-well pad-well text-xs text-muted">Run a query above to pull live peer-reviewed literature from MASTERNEX Academic Connector / OpenAlex.</div>'
          }
        </div>
      </div>`;

    document.getElementById('lab-lit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.litQuery = (document.getElementById('lab-lit-query') as HTMLInputElement)?.value.trim() || this.litQuery;
      this.litMode = 'searching…';
      this.render();
      const res = await searchAcademicLiterature(this.cb.getMasternexConfig(), this.litQuery);
      this.litMode = res.mode;
      this.litResults = res.papers;
      this.render();
    });

    el.querySelectorAll<HTMLButtonElement>('[data-cite-idx]').forEach((b) =>
      b.addEventListener('click', () => {
        const paper = this.litResults[Number(b.dataset.citeIdx)];
        if (!paper) return;
        const exists = this.citations.findIndex((c) => c.title === paper.title);
        if (exists >= 0) {
          this.citations.splice(exists, 1);
          this.cb.showToast('Removed from Bibliography Cart');
        } else {
          this.citations.push(paper);
          this.cb.showToast('Added citation to LaTeX/MD Writing Studio');
        }
        this.render();
      })
    );

    document.getElementById('lab-lit-bib')?.addEventListener('click', () => {
      this.downloadText('AUCTUM_References.bib', papersToBibTeX(this.citations), 'application/x-bibtex');
      this.cb.showToast(`Exported ${this.citations.length} citations to BibTeX`);
    });
  }
}
