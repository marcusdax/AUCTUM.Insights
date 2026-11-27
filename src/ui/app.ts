import type {
  AIProviderId,
  AgUiEvent,
  LocationAudit,
  PropertyParcel,
  ReportType,
  ShapleyAttribution,
  UnderwritingStrategy,
  UserPersonaId,
} from '../engine/types';
import {
  DEFAULT_PROPERTIES,
  calcUnderwriting,
  parsePortfolioCSV,
  portfolioToCSV,
  solveTargetPrice,
} from '../engine/underwriting';
import { computeDOEFactorial, runMonteCarloStress } from '../engine/doe';
import {
  buildSensitivityGrid,
  compute21Buydown,
  computeTaxShield,
  decodeShareableDeal,
  encodeShareableDeal,
} from '../engine/financing';
import { computeLocalShapley } from '../engine/shapley';
import { evaluateLocalStormHazard } from '../engine/fiduciary';
import { PERSONA_LIST, PERSONA_PROFILES } from '../engine/personas';
import { buildQuantFallbackMarkdown, escHtml, fmtDollars, formatMarkdownToDuskHTML } from '../engine/markdown';
import {
  probeMasternexHealth,
  runMasternexFiduciaryAudit,
  runMasternexStormHazard,
  runMasternexUnderwrite,
  searchAcademicLiterature,
} from '../connectors/masternex';
import { HF_DATASET_PRESETS, fetchHFDatasetBenchmarks } from '../connectors/huggingface';
import {
  KDENSE_SCIENTIFIC_SKILLS,
  buildKDenseSkillPrompt,
  probeKDenseHealth,
} from '../connectors/kdense';
import { buildGoogleMapsLinks } from '../connectors/googleMaps';
import { PROVIDER_PRESETS, invokeAIProvider } from '../connectors/aiProviders';
import { ChartManager } from './charts';
import { SpatialMapController } from './map';
import { LAB_APPS, LabAppsController, type LabAppId } from './labApps';

const STORAGE_KEY = 'auctum_insights_v7_state';

interface AppState {
  persona: UserPersonaId;
  provider: AIProviderId;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  masternexUrl: string;
  masternexKey: string;
  kdenseUrl: string;
  googleMapsKey: string;
  fiduciaryGuardEnabled: boolean;
  properties: PropertyParcel[];
  activeIndex: number;
  activeStrategy: UnderwritingStrategy;
  activeTab: 'underwrite' | 'compare' | 'map' | 'reports' | 'decisions' | 'ecosystem' | 'lab';
  locationAudits: Record<string, LocationAudit>;
  lastAttribution: ShapleyAttribution | null;
  masternexOnline: boolean;
  kdenseOnline: boolean;
  aguiEvents: AgUiEvent[];
}

function loadInitialState(): AppState {
  const base: AppState = {
    persona: 'pe_ic',
    provider: 'pollinations',
    baseUrl: PROVIDER_PRESETS.pollinations.url,
    modelId: PROVIDER_PRESETS.pollinations.models[0],
    apiKey: '',
    masternexUrl: 'http://127.0.0.1:8080',
    masternexKey: '',
    kdenseUrl: 'http://127.0.0.1:8000',
    googleMapsKey: '',
    fiduciaryGuardEnabled: false,
    properties: JSON.parse(JSON.stringify(DEFAULT_PROPERTIES)),
    activeIndex: 0,
    activeStrategy: 'hold',
    activeTab: 'underwrite',
    locationAudits: {},
    lastAttribution: null,
    masternexOnline: false,
    kdenseOnline: false,
    aguiEvents: [],
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.properties) && saved.properties.length > 0) {
      base.properties = saved.properties;
    }
    if (saved.persona && PERSONA_PROFILES[saved.persona as UserPersonaId]) {
      base.persona = saved.persona;
    }
    if (saved.provider && PROVIDER_PRESETS[saved.provider as AIProviderId]) {
      base.provider = saved.provider;
    }
    if (typeof saved.baseUrl === 'string') base.baseUrl = saved.baseUrl;
    if (typeof saved.modelId === 'string') base.modelId = saved.modelId;
    if (typeof saved.masternexUrl === 'string') base.masternexUrl = saved.masternexUrl;
    if (typeof saved.kdenseUrl === 'string') base.kdenseUrl = saved.kdenseUrl;
    if (typeof saved.activeStrategy === 'string') base.activeStrategy = saved.activeStrategy;
    if (typeof saved.activeIndex === 'number') {
      base.activeIndex = Math.min(saved.activeIndex, base.properties.length - 1);
    }
    if (saved.locationAudits && typeof saved.locationAudits === 'object') {
      base.locationAudits = saved.locationAudits;
    }
  } catch {
    // Ignore malformed localStorage
  }
  return base;
}

function fmtMoneyHtml(v: number): string {
  const a = Math.abs(v);
  const w = Math.floor(a).toLocaleString('en-US');
  const c = (a % 1).toFixed(2).substring(1);
  return `${v < 0 ? '-' : ''}$${w}<span class="c">${c}</span>`;
}

function fmtPctHtml(v: number): string {
  const a = Math.abs(v);
  const w = Math.floor(a);
  const d = (a - w).toFixed(2).substring(1);
  return `${v < 0 ? '-' : ''}${w}<span class="c">${d}%</span>`;
}

export function initApp(): void {
  const state = loadInitialState();
  const charts = new ChartManager();

  const saveState = () => {
    try {
      const toPersist = {
        persona: state.persona,
        provider: state.provider,
        baseUrl: state.baseUrl,
        modelId: state.modelId,
        masternexUrl: state.masternexUrl,
        kdenseUrl: state.kdenseUrl,
        activeStrategy: state.activeStrategy,
        activeIndex: state.activeIndex,
        properties: state.properties,
        locationAudits: state.locationAudits,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch {
      // Storage full or restricted
    }
  };

  let toastTimer: number | undefined;
  const showToast = (msg: string) => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.add('hidden'), 3400);
  };

  const getActiveParcel = (): PropertyParcel =>
    state.properties[state.activeIndex] || state.properties[0];

  const getLocationScore = (p: PropertyParcel): number => state.locationAudits[p.id]?.score ?? 68;

  const emitAgUi = (type: AgUiEvent['type'], payload: Record<string, unknown> = {}) => {
    state.aguiEvents.unshift({ type, ts: new Date().toLocaleTimeString(), ...payload });
    state.aguiEvents = state.aguiEvents.slice(0, 30);
    renderAgUiLog();
  };

  const spatial = new SpatialMapController({
    getProperties: () => state.properties,
    getActiveIndex: () => state.activeIndex,
    getStrategy: () => state.activeStrategy,
    getLocationAudit: (id) => state.locationAudits[id],
    setLocationAudit: (id, audit) => {
      state.locationAudits[id] = audit;
      saveState();
    },
    onSelectProperty: (idx) => {
      state.activeIndex = idx;
      syncUWInputs();
      renderAll();
      spatial.syncMarkers();
      spatial.applyOverlays();
    },
    getGoogleMapsKey: () => state.googleMapsKey,
  });

  const labApps = new LabAppsController({
    getParcel: getActiveParcel,
    getProperties: () => state.properties,
    getStrategy: () => state.activeStrategy,
    getLocationAudit: (id) => state.locationAudits[id],
    getAttribution: () => state.lastAttribution,
    setAttribution: (attr) => {
      state.lastAttribution = attr;
    },
    getMasternexConfig: () => ({ baseUrl: state.masternexUrl, apiKey: state.masternexKey }),
    triggerOverpassScan: async () => {
      const audit = await spatial.scanOverpassPOIs(1600);
      showToast(audit ? `Overpass scan complete: ${audit.score}/100` : 'Overpass mirror busy');
    },
    showToast,
  });

  // =========================================================================
  // RENDERERS
  // =========================================================================
  function renderPersonaChrome(): void {
    const profile = PERSONA_PROFILES[state.persona];
    const h1 = document.getElementById('hero-headline');
    const sub = document.getElementById('hero-subhead');
    if (h1) h1.textContent = profile.heroHeadline;
    if (sub) sub.textContent = profile.heroSubhead;

    const bar = document.getElementById('persona-guardrail-bar');
    if (bar) {
      if (profile.guardrailBanner) {
        bar.textContent = profile.guardrailBanner;
        bar.classList.remove('hidden');
      } else {
        bar.classList.add('hidden');
      }
    }

    document.querySelectorAll<HTMLButtonElement>('.persona-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.persona === state.persona);
    });
  }

  function renderHeroAccounts(): void {
    const container = document.getElementById('hero-account-rows');
    if (!container) return;
    container.innerHTML = '';
    let totVal = 0;
    let capSum = 0;
    let totCf = 0;

    state.properties.forEach((p, idx) => {
      const m = calcUnderwriting(p, state.activeStrategy);
      totVal += m.price;
      capSum += m.capRate;
      totCf += m.mCf;
      const isAct = idx === state.activeIndex;
      const badgeCls =
        m.verdict === 'ACQUIRE'
          ? 'badge-acquire'
          : m.verdict === 'NEGOTIATE'
            ? 'badge-negotiate'
            : 'badge-pass';

      const row = document.createElement('div');
      row.className = `account-row ${isAct ? 'active' : ''}`;
      row.innerHTML = `
        <div class="flex-row" style="min-width:0;flex:1">
          <div class="brand-mark" style="width:30px;height:30px;font-size:0.7rem;background:${
            isAct ? 'var(--color-accent)' : 'oklch(100% 0 0 / 0.09)'
          };color:${isAct ? 'var(--color-accent-ink)' : 'var(--color-ink)'}">${idx + 1}</div>
          <div style="min-width:0">
            <div class="text-sm" style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:290px">${escHtml(
              p.address
            )}</div>
            <div class="text-xs text-muted">DSCR ${m.dscr.toFixed(2)}x · IRR ${m.irr10Yr.toFixed(1)}% · <span class="badge ${badgeCls}" style="padding:1px 6px;font-size:0.62rem">${m.verdict}</span></div>
          </div>
        </div>
        <div class="flex-row" style="gap:0.4rem">
          <div style="text-align:right">
            <div class="num text-sm">${fmtMoneyHtml(m.mCf)}</div>
            <div class="text-xs text-muted">${m.capRate.toFixed(2)}% cap</div>
          </div>
          <button type="button" class="row-icon-btn" data-dup="${idx}" title="Duplicate parcel">⧉</button>
          ${
            state.properties.length > 1
              ? `<button type="button" class="row-icon-btn" data-del="${idx}" title="Remove parcel">✕</button>`
              : ''
          }
        </div>
      `;
      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.dataset.dup !== undefined) {
          e.stopPropagation();
          const clone: PropertyParcel = {
            ...p,
            id: `p-${Date.now()}`,
            address: `${p.address} (Copy)`,
          };
          state.properties.push(clone);
          state.activeIndex = state.properties.length - 1;
          saveState();
          syncUWInputs();
          renderAll();
          showToast('Parcel duplicated');
          return;
        }
        if (target.dataset.del !== undefined) {
          e.stopPropagation();
          state.properties.splice(idx, 1);
          state.activeIndex = Math.max(0, Math.min(state.activeIndex, state.properties.length - 1));
          saveState();
          syncUWInputs();
          renderAll();
          showToast('Parcel removed');
          return;
        }
        state.activeIndex = idx;
        saveState();
        syncUWInputs();
        renderAll();
        spatial.syncMarkers();
        spatial.applyOverlays();
      });
      container.appendChild(row);
    });

    const elVal = document.getElementById('tally-total-val');
    const elCap = document.getElementById('tally-avg-cap');
    const elCf = document.getElementById('tally-total-cf');
    const elFocus = document.getElementById('active-deal-label');
    if (elVal) elVal.innerHTML = fmtMoneyHtml(totVal);
    if (elCap) elCap.innerHTML = fmtPctHtml(state.properties.length ? capSum / state.properties.length : 0);
    if (elCf) elCf.innerHTML = fmtMoneyHtml(totCf);
    if (elFocus) elFocus.textContent = `#${state.activeIndex + 1} · ${getActiveParcel().address}`;
  }

  function syncUWInputs(): void {
    const p = getActiveParcel();
    const setVal = (id: string, v: string | number) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = String(v);
    };
    setVal('inp-active-address', p.address);
    setVal('uw-strategy-select', state.activeStrategy);
    setVal('uw-price', p.price);
    setVal('uw-rent', p.rent);
    setVal('uw-down', p.downPct);
    setVal('uw-rate', p.rate);
    setVal('uw-opex', p.opexPct);
    setVal('uw-vacancy', p.vacancyPct);
    setVal('uw-growth', p.rentGrowthPct);
    setVal('uw-apprec', p.appreciationPct);
    setVal('uw-rehab', p.rehab);
    setVal('uw-roof', p.roofAgeYears);
  }

  function renderCompareTable(): void {
    const tbody = document.getElementById('compare-tbody');
    if (!tbody) return;
    const rows = state.properties.map((p, idx) => ({
      p,
      idx,
      m: calcUnderwriting(p, state.activeStrategy),
      hazard: evaluateLocalStormHazard(p),
    }));
    const bestIrr = Math.max(...rows.map((r) => r.m.irr10Yr));
    const bestDscr = Math.max(...rows.map((r) => r.m.dscr));

    tbody.innerHTML = rows
      .map(({ p, idx, m, hazard }) => {
        const badgeCls =
          m.verdict === 'ACQUIRE'
            ? 'badge-acquire'
            : m.verdict === 'NEGOTIATE'
              ? 'badge-negotiate'
              : 'badge-pass';
        return `<tr style="${idx === state.activeIndex ? 'background:oklch(77% 0.10 274 / 0.08)' : ''}">
          <td><strong>#${idx + 1}</strong> ${escHtml(p.address)}</td>
          <td class="num">${fmtDollars(m.price)}</td>
          <td class="num">${fmtDollars(m.baseRent)}/mo</td>
          <td class="num">${m.capRate.toFixed(2)}%</td>
          <td class="num">${m.coc.toFixed(2)}%</td>
          <td class="num ${m.dscr === bestDscr ? 'text-ok' : ''}">${m.dscr.toFixed(2)}x</td>
          <td class="num ${m.irr10Yr === bestIrr ? 'text-ok' : ''}">${m.irr10Yr.toFixed(1)}%</td>
          <td class="num">${m.equityMultiple10Yr.toFixed(2)}x</td>
          <td class="num">${m.breakEvenOccPct.toFixed(1)}%</td>
          <td class="num">${hazard.hazardScore}/100</td>
          <td><span class="badge ${badgeCls}">${m.verdict}</span></td>
        </tr>`;
      })
      .join('');
  }

  function renderSpatialExtras(): void {
    const p = getActiveParcel();
    const links = buildGoogleMapsLinks(p, state.googleMapsKey);
    const hazard = evaluateLocalStormHazard(p);

    const gBox = document.getElementById('google-maps-links');
    if (gBox) {
      gBox.innerHTML = `
        <a href="${links.maps3D}" target="_blank" rel="noopener" class="btn-ghost btn-sm">Google Maps 3D ↗</a>
        <a href="${links.streetView}" target="_blank" rel="noopener" class="btn-ghost btn-sm">Street View ↗</a>
        <a href="${links.directions}" target="_blank" rel="noopener" class="btn-ghost btn-sm">Directions ↗</a>
      `;
    }

    const svWrap = document.getElementById('google-streetview-preview');
    if (svWrap) {
      if (links.streetViewStaticImg) {
        svWrap.classList.remove('hidden');
        svWrap.innerHTML = `<img src="${links.streetViewStaticImg}" alt="Google Street View for ${escHtml(
          p.address
        )}" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;border:1px solid var(--color-rule)" />`;
      } else {
        svWrap.classList.add('hidden');
      }
    }

    const atlasBox = document.getElementById('atlas-hazard-card');
    if (atlasBox) {
      const hCls =
        hazard.hazardScore >= 68
          ? 'badge-pass'
          : hazard.hazardScore >= 42
            ? 'badge-negotiate'
            : 'badge-acquire';
      atlasBox.innerHTML = `
        <div class="flex-between">
          <div>
            <div class="text-xs text-muted">AUCTUM.atlas Physical &amp; Storm Risk</div>
            <div class="text-sm" style="font-weight:500;margin-top:2px">${escHtml(hazard.narrative)}</div>
          </div>
          <span class="badge ${hCls}">${hazard.hazardScore}/100 · ${hazard.tier}</span>
        </div>
      `;
    }
  }

  function renderDecisionsPanel(): void {
    const p = getActiveParcel();
    const m = calcUnderwriting(p, state.activeStrategy);
    const doe = computeDOEFactorial(p, state.activeStrategy);
    const mc = runMonteCarloStress(p, state.activeStrategy, 1000, 42);
    const locScore = getLocationScore(p);

    charts.renderDecisionsSuite(m, doe, mc, locScore, p.roofAgeYears);
    charts.renderSensitivityHeatmap(buildSensitivityGrid(p, state.activeStrategy));

    const composite = Math.round(
      (Math.min(100, m.capRate * 12) +
        Math.min(100, m.dscr * 65) +
        locScore +
        Math.round((doe.passCount / 8) * 100)) /
        4
    );
    const badge = document.getElementById('scorecard-badge');
    if (badge) {
      badge.textContent = `${composite} / 100 · ${m.verdict}`;
      badge.className = `badge ${
        m.verdict === 'ACQUIRE'
          ? 'badge-acquire'
          : m.verdict === 'NEGOTIATE'
            ? 'badge-negotiate'
            : 'badge-pass'
      }`;
    }

    const tbody = document.getElementById('doe-tbody');
    if (tbody) {
      tbody.innerHTML = doe.runs
        .map(
          (r) => `<tr>
            <td class="mono">${r.label}</td>
            <td class="num">${r.rate.toFixed(2)}%</td>
            <td class="num">${r.opexPct}%</td>
            <td class="num">${fmtDollars(r.rehab)}</td>
            <td class="num">${r.capRate.toFixed(2)}%</td>
            <td class="num">${r.dscr.toFixed(2)}x</td>
            <td><span class="badge ${r.pass ? 'badge-acquire' : 'badge-pass'}">${
              r.pass ? 'CLEAR' : 'STRESS'
            }</span></td>
          </tr>`
        )
        .join('');
    }

    const mcSummary = document.getElementById('mc-summary-strip');
    if (mcSummary) {
      mcSummary.innerHTML = `
        <span class="badge badge-peri">${escHtml(mc.dataLabel)}</span>
        <span class="text-xs text-ink-2">DSCR P10/P50/P90: <strong class="num">${mc.dscrP10}x / ${mc.dscrP50}x / ${mc.dscrP90}x</strong></span>
        <span class="text-xs text-ink-2">95% CI: <strong class="num">[${mc.dscrCi95[0]}x, ${mc.dscrCi95[1]}x]</strong></span>
        <span class="text-xs text-ink-2">IRR P50: <strong class="num">${mc.irrP50}%</strong></span>
        <span class="text-xs text-ok">P(DSCR ≥ 1.20x): <strong class="num">${mc.probDscrAbove120}%</strong></span>
      `;
    }
  }

  function renderAgUiLog(): void {
    const log = document.getElementById('agui-event-log');
    if (!log) return;
    if (!state.aguiEvents.length) {
      log.innerHTML = '<div class="text-muted">No AG-UI events yet. Run underwriting seal or test run.</div>';
      return;
    }
    log.innerHTML = state.aguiEvents
      .map(
        (e) =>
          `<div style="margin-bottom:4px"><span class="text-accent">${escHtml(e.type)}</span> <span class="text-muted">[${escHtml(
            e.ts
          )}]</span> ${escHtml(JSON.stringify(e))}</div>`
      )
      .join('');
  }

  function renderEcosystemPanel(): void {
    const p = getActiveParcel();
    const m = calcUnderwriting(p, state.activeStrategy);
    const doe = computeDOEFactorial(p, state.activeStrategy);
    const attr =
      state.lastAttribution ??
      computeLocalShapley(m, doe, getLocationScore(p), p.lat, p.lng);

    charts.renderShapleyChart(attr);

    const ledgerHead = document.getElementById('masternex-ledger-meta');
    if (ledgerHead) {
      ledgerHead.innerHTML = `
        <span class="badge ${attr.source === 'masternex-live' ? 'badge-acquire' : 'badge-negotiate'}">${
          attr.source === 'masternex-live' ? 'MASTERNEX SEALED' : 'LOCAL PREVIEW · UNSEALED'
        }</span>
        <span class="text-xs text-muted mono">Packet: ${escHtml(attr.packetId)} · Cell: ${escHtml(
          attr.hexCell
        )} · Alg: ${escHtml(attr.signatureAlg)}</span>
      `;
    }

    const kdenseBox = document.getElementById('kdense-skills-grid');
    if (kdenseBox) {
      kdenseBox.innerHTML = KDENSE_SCIENTIFIC_SKILLS.map(
        (sk) => `
        <div class="inner-well pad-well flex-between">
          <div>
            <div class="text-xs text-accent mono">${escHtml(sk.command)}</div>
            <div class="text-sm" style="font-weight:500">${escHtml(sk.title)}</div>
            <div class="text-xs text-muted">${escHtml(sk.description)}</div>
          </div>
          <div class="flex-row" style="flex-shrink:0">
            <button type="button" class="btn-peri btn-sm kdense-launch-btn" data-launch-app="${sk.id}">Launch App</button>
            <button type="button" class="btn-ghost btn-sm kdense-copy-btn" data-skill-id="${sk.id}">Copy Prompt</button>
          </div>
        </div>`
      ).join('');

      kdenseBox.querySelectorAll<HTMLButtonElement>('.kdense-launch-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const appId = btn.dataset.launchApp as LabAppId;
          switchTab('lab');
          labApps.openApp(appId);
        });
      });

      kdenseBox.querySelectorAll<HTMLButtonElement>('.kdense-copy-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sk = KDENSE_SCIENTIFIC_SKILLS.find((s) => s.id === btn.dataset.skillId);
          if (!sk) return;
          const prompt = buildKDenseSkillPrompt({
            skill: sk,
            parcel: p,
            metrics: m,
            doe,
            audit: state.locationAudits[p.id],
          });
          try {
            await navigator.clipboard.writeText(prompt);
            showToast(`Copied ${sk.command} prompt with parcel JSON`);
          } catch {
            showToast(`Prepared ${sk.command} prompt`);
          }
          emitAgUi('CUSTOM', { action: 'kdense_skill_handoff', skill: sk.id, parcel: p.address });
        });
      });
    }

    renderAgUiLog();
  }

  function renderAll(): void {
    renderPersonaChrome();
    renderHeroAccounts();

    const p = getActiveParcel();
    const m = calcUnderwriting(p, state.activeStrategy);
    const solverMetric =
      ((document.getElementById('solver-metric-select') as HTMLSelectElement | null)?.value as
        | 'dscr'
        | 'capRate'
        | 'coc') || 'dscr';
    const solverTarget =
      Number((document.getElementById('solver-target-val') as HTMLInputElement | null)?.value) || 1.25;
    const solver = solveTargetPrice(p, state.activeStrategy, solverMetric, solverTarget);
    const bd = compute21Buydown(p, state.activeStrategy);
    const tax = computeTaxShield(p, state.activeStrategy, 0.32);

    const setText = (id: string, txt: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    const setHtml = (id: string, html: string) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };

    setText('lbl-uw-price', fmtDollars(m.price));
    setText('lbl-uw-rent', fmtDollars(m.baseRent));
    setText('lbl-uw-down', `${Math.round(m.downPct * 100)}%`);
    setText('lbl-uw-rate', `${(m.rate * 100).toFixed(2)}%`);
    setText('lbl-uw-opex', `${p.opexPct}%`);
    setText('lbl-uw-vacancy', `${p.vacancyPct}%`);
    setText('lbl-uw-growth', `${p.rentGrowthPct.toFixed(1)}%`);
    setText('lbl-uw-apprec', `${p.appreciationPct.toFixed(1)}%`);
    setText('lbl-uw-rehab', fmtDollars(m.rehab));
    setText('lbl-uw-roof', `${p.roofAgeYears} yrs`);

    setHtml('m-cap', fmtPctHtml(m.capRate));
    setHtml('m-coc', fmtPctHtml(m.coc));
    setHtml('m-cf', fmtMoneyHtml(m.mCf));
    setHtml(
      'm-dscr',
      `${Math.floor(m.dscr)}<span class="c">.${(m.dscr % 1).toFixed(2).substring(2)}x</span>`
    );
    setHtml('m-irr', fmtPctHtml(m.irr10Yr));
    setHtml('m-em', `${m.equityMultiple10Yr.toFixed(2)}<span class="c">x</span>`);
    setHtml('m-beo', fmtPctHtml(m.breakEvenOccPct));
    setHtml('m-onepct', fmtPctHtml(m.onePctRatio));

    const unitSuffix = solverMetric === 'dscr' ? 'x' : '%';
    const metricLabel =
      solverMetric === 'dscr' ? 'DSCR' : solverMetric === 'capRate' ? 'Cap Rate' : 'CoC';
    const solverEl = document.getElementById('target-price-solver-readout');
    if (solverEl) {
      solverEl.innerHTML = solver.achievable
        ? `Max price for <strong>${solverTarget}${unitSuffix} ${metricLabel}</strong>: <strong class="num text-accent">${fmtDollars(
            solver.maxPrice
          )}</strong> (${
            solver.discountDollars > 0
              ? `-${fmtDollars(solver.discountDollars)} / -${solver.discountPct}% from ask`
              : 'Clears target at current ask'
          })`
        : `Target ${solverTarget}${unitSuffix} ${metricLabel} requires higher rent or lower debt rate.`;
    }

    const bdCard = document.getElementById('buydown-card');
    if (bdCard) {
      bdCard.innerHTML = `
        <div class="flex-between row-rule" style="padding-bottom:0.45rem">
          <h4>2-1 Rate Buydown &amp; Seller Credit</h4>
          <span class="badge badge-peri">Credit ${fmtDollars(bd.requiredSellerCredit)}</span>
        </div>
        <div class="grid-3" style="padding-top:0.35rem">
          <div><div class="text-muted">Yr 1 (${bd.yr1Rate.toFixed(2)}%)</div><strong class="num text-sm text-ok">${fmtDollars(bd.yr1Payment)}/mo</strong><div class="text-muted">Save ${fmtDollars(bd.yr1MonthlySavings)}/mo</div></div>
          <div><div class="text-muted">Yr 2 (${bd.yr2Rate.toFixed(2)}%)</div><strong class="num text-sm">${fmtDollars(bd.yr2Payment)}/mo</strong><div class="text-muted">Save ${fmtDollars(bd.yr2MonthlySavings)}/mo</div></div>
          <div><div class="text-muted">Yr 3+ (${bd.yr3PlusRate.toFixed(2)}%)</div><strong class="num text-sm">${fmtDollars(bd.yr3PlusPayment)}/mo</strong><div class="text-ok">+${bd.yr1DscrLift.toFixed(2)}x Yr1 DSCR</div></div>
        </div>
      `;
    }

    const taxCard = document.getElementById('tax-shield-card');
    if (taxCard) {
      taxCard.innerHTML = `
        <div class="flex-between row-rule" style="padding-bottom:0.45rem">
          <h4>27.5-Yr Depreciation Tax Shield (32% Bracket)</h4>
          <span class="badge badge-acquire">After-Tax CoC ${tax.afterTaxCocPct.toFixed(2)}%</span>
        </div>
        <div class="grid-3" style="padding-top:0.35rem">
          <div><div class="text-muted">Annual Depr.</div><strong class="num text-sm">${fmtDollars(tax.annualDepreciation)}/yr</strong><div class="text-muted">Basis ${fmtDollars(tax.depreciableBasis)}</div></div>
          <div><div class="text-muted">Yr-1 Taxable</div><strong class="num text-sm">${fmtDollars(tax.taxableIncomeYr1)}</strong><div class="text-muted">After interest + depr.</div></div>
          <div><div class="text-muted">After-Tax CF</div><strong class="num text-sm text-ok">${fmtDollars(tax.afterTaxCashFlowYr1)}/yr</strong><div class="text-muted">Est. tax impact ${fmtDollars(tax.estimatedTaxSavingsYr1)}</div></div>
        </div>
      `;
    }

    const brrrrEl = document.getElementById('brrrr-readout');
    if (brrrrEl) {
      brrrrEl.classList.toggle('hidden', state.activeStrategy !== 'brrrr');
      brrrrEl.innerHTML = `BRRRR 75% Refi · Est. ARV <strong>${fmtDollars(
        m.brrrrArv
      )}</strong> · Refi Proceeds <strong>${fmtDollars(
        m.brrrrRefiProceeds
      )}</strong> · Cash Left In <strong>${fmtDollars(m.brrrrCashLeftIn)}</strong>`;
    }

    const exp10 = document.getElementById('explain-10yr');
    if (exp10) {
      const yr10Eq = m.equitySeries[9] ?? 0;
      const yr10Cf = m.cfSeries[9] ?? 0;
      exp10.textContent = `Projected 10-year total wealth reaches ${fmtDollars(
        yr10Eq + yr10Cf
      )} (${m.equityMultiple10Yr.toFixed(2)}x equity multiple, ${m.irr10Yr.toFixed(
        2
      )}% levered IRR) on ${fmtDollars(m.cashIn)} initial cash-to-close.`;
    }

    const expWf = document.getElementById('explain-waterfall');
    if (expWf) {
      expWf.textContent = `Gross ${fmtDollars(m.grossMo)}/mo minus ${fmtDollars(
        m.vacancyMo
      )} vacancy and ${fmtDollars(m.opexMo)} OpEx yields ${fmtDollars(m.noiMo)}/mo NOI and ${fmtDollars(
        m.mCf
      )}/mo net cash flow.`;
    }

    const expN = document.getElementById('explain-nights');
    if (expN) {
      expN.textContent = `Break-even occupancy is ${m.breakEvenOccPct.toFixed(
        1
      )}% (${Math.round((m.breakEvenOccPct / 100) * 30)} nights/mo) leaving a ${Math.max(
        0,
        100 - m.vacancyPct * 100 - m.breakEvenOccPct
      ).toFixed(1)}% monthly cushion.`;
    }

    const navPill = document.getElementById('nav-provider-pill');
    if (navPill) navPill.textContent = PROVIDER_PRESETS[state.provider].label;

    if (state.activeTab === 'underwrite') charts.renderUnderwritingSuite(m);
    if (state.activeTab === 'compare') renderCompareTable();
    if (state.activeTab === 'map') renderSpatialExtras();
    if (state.activeTab === 'decisions') renderDecisionsPanel();
    if (state.activeTab === 'ecosystem') renderEcosystemPanel();
    if (state.activeTab === 'lab') labApps.render();
  }

  function switchTab(id: AppState['activeTab']): void {
    state.activeTab = id;
    (['underwrite', 'compare', 'map', 'reports', 'decisions', 'ecosystem', 'lab'] as const).forEach((t) => {
      document.getElementById(`panel-${t}`)?.classList.toggle('hidden', t !== id);
    });
    document.querySelectorAll<HTMLButtonElement>('.ws-tab').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('active', on);
      const dot = b.querySelector('.sig-dot');
      if (dot) dot.className = on ? 'sig-dot sig-peri' : 'sig-dot sig-off';
    });

    setTimeout(() => {
      renderAll();
      if (id === 'map') spatial.initOrRefresh();
      charts.resizeAll();
    }, 30);
  }

  // =========================================================================
  // AI DOSSIER STUDIO (Bug-fixed active tab + Fiduciary Guardrail + Multi-Provider)
  // =========================================================================
  async function runReport(type: ReportType, customQ = ''): Promise<void> {
    switchTab('reports');
    document.querySelectorAll<HTMLButtonElement>('.report-trigger').forEach((btn) => {
      const isMatch = btn.dataset.reportType === type && !customQ;
      btn.classList.toggle('btn-peri', isMatch);
      btn.classList.toggle('btn-ghost', !isMatch);
    });

    const p = getActiveParcel();
    const m = calcUnderwriting(p, state.activeStrategy);
    const doe = computeDOEFactorial(p, state.activeStrategy);
    const mc = runMonteCarloStress(p, state.activeStrategy, 1000, 42);
    const hazard = evaluateLocalStormHazard(p);
    const persona = PERSONA_PROFILES[state.persona];

    const box = document.getElementById('report-dossier-container');
    const loader = document.getElementById('report-loading');
    const engBadge = document.getElementById('report-engine-badge');
    if (engBadge) engBadge.textContent = PROVIDER_PRESETS[state.provider].label;
    if (!box) return;

    const labels: Record<ReportType, string> = {
      ic_audit: 'IC Audit',
      negotiation: 'Negotiation Strategy',
      cma: 'Portfolio CMA',
      lp_memo: 'LP Deal Brief',
      fiduciary_brief: 'Fiduciary SR 11-7 Brief',
      storm_risk: 'AUCTUM.atlas Storm Risk',
      custom: 'Custom Analysis',
    };
    const reportTitle = customQ ? 'Custom Analysis' : labels[type];

    emitAgUi('RUN_STARTED', { reportType: type, persona: state.persona, parcel: p.address });

    const renderDossierCard = async (md: string, tagText: string, tagCls: string) => {
      let finalMd = md;
      let fidBadge = '';
      if (state.fiduciaryGuardEnabled || state.persona === 'fiduciary' || type === 'fiduciary_brief') {
        const audit = await runMasternexFiduciaryAudit(
          { baseUrl: state.masternexUrl, apiKey: state.masternexKey },
          md
        );
        finalMd = audit.redactedText;
        fidBadge = `<div class="inner-well pad-well text-xs" style="border-color:color-mix(in oklab, var(--color-ok) 35%, transparent)">
          <strong class="text-ok">Fiduciary OS (${escHtml(audit.source)})</strong> · SR 11-7 Model: <code>${escHtml(
            audit.sr117ModelId
          )}</code> · PII Redactions: <strong>${audit.piiDetections.length}</strong><br/>
          <span class="text-muted">${escHtml(audit.disclaimer)}</span>
        </div>`;
      }

      box.innerHTML = `<div class="glass pad-card stack-sm">
        <div class="flex-between row-rule" style="padding-bottom:0.75rem">
          <div>
            <div class="text-xs text-accent" style="text-transform:uppercase;letter-spacing:0.06em">${escHtml(
              reportTitle
            )} · ${escHtml(persona.shortLabel)}</div>
            <h3>${escHtml(type === 'cma' ? `Portfolio (${state.properties.length} Assets)` : p.address)}</h3>
          </div>
          <span class="badge ${tagCls}">${escHtml(tagText)}</span>
        </div>
        ${fidBadge}
        <div>${formatMarkdownToDuskHTML(finalMd)}</div>
      </div>`;
      emitAgUi('RUN_FINISHED', { reportType: type, engine: tagText });
    };

    const fallbackMd = buildQuantFallbackMarkdown({
      type,
      parcel: p,
      metrics: m,
      doe,
      mc,
      hazard,
      properties: state.properties,
      strategy: state.activeStrategy,
      persona,
    });

    if (state.provider === 'quant') {
      await renderDossierCard(
        fallbackMd,
        `QUANT · ${m.verdict}`,
        m.verdict === 'ACQUIRE' ? 'badge-acquire' : 'badge-negotiate'
      );
      return;
    }

    box.innerHTML = '';
    loader?.classList.remove('hidden');

    const userPrompt = customQ
      ? `${customQ}\n\nParcel Context: ${p.address} | Price ${fmtDollars(m.price)} | Rent ${fmtDollars(
          m.baseRent
        )}/mo | Cap ${m.capRate.toFixed(2)}% | DSCR ${m.dscr.toFixed(2)}x | 10-Yr IRR ${m.irr10Yr}% | DOE Pass ${
          doe.passCount
        }/8 | Storm Risk ${hazard.hazardScore}/100. Format in clean Markdown with a summary table.`
      : `Produce a concise, institutional ${reportTitle} in Markdown with headings, bullet points, and a metrics table for ${
          p.address
        }. Key numbers: Price ${fmtDollars(m.price)}, Down ${Math.round(m.downPct * 100)}%, Rent ${fmtDollars(
          m.baseRent
        )}/mo, Vacancy ${Math.round(m.vacancyPct * 100)}%, OpEx ${Math.round(m.opexPct * 100)}%, Cap ${m.capRate.toFixed(
          2
        )}%, CoC ${m.coc.toFixed(2)}%, DSCR ${m.dscr.toFixed(2)}x, 10-Yr IRR ${m.irr10Yr}%, EM ${
          m.equityMultiple10Yr
        }x, 2^3 DOE ${doe.passCount}/8 pass, Monte Carlo P10/P50 DSCR ${mc.dscrP10}x/${
          mc.dscrP50
        }x, Storm Hazard ${hazard.hazardScore}/100 (${hazard.tier}).`;

    try {
      const txt = await invokeAIProvider({
        provider: state.provider,
        baseUrl: state.baseUrl,
        modelId: state.modelId,
        apiKey: state.apiKey,
        systemPrompt: persona.systemPromptFraming,
        userPrompt,
        parcel: p,
        masternexUrl: state.masternexUrl,
      });
      if (!txt.trim()) throw new Error('Empty response');
      await renderDossierCard(txt, PROVIDER_PRESETS[state.provider].label, 'badge-peri');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      await renderDossierCard(fallbackMd, `QUANT FALLBACK (${msg})`, 'badge-negotiate');
    } finally {
      loader?.classList.add('hidden');
    }
  }

  // =========================================================================
  // EVENT WIRING
  // =========================================================================
  // Persona switcher
  const pStrip = document.getElementById('persona-strip');
  if (pStrip) {
    pStrip.innerHTML = PERSONA_LIST.map(
      (pr) =>
        `<button type="button" class="persona-btn ${pr.id === state.persona ? 'active' : ''}" data-persona="${
          pr.id
        }" title="${escHtml(pr.tagline)}">${escHtml(pr.shortLabel)}</button>`
    ).join('');
    pStrip.querySelectorAll<HTMLButtonElement>('.persona-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.persona as UserPersonaId;
        if (!PERSONA_PROFILES[next]) return;
        state.persona = next;
        state.activeStrategy = PERSONA_PROFILES[next].defaultStrategy;
        state.fiduciaryGuardEnabled = next === 'fiduciary';
        saveState();
        syncUWInputs();
        renderAll();
        showToast(`Persona switched: ${PERSONA_PROFILES[next].label}`);
        emitAgUi('STATE_DELTA', { persona: next, strategy: state.activeStrategy });
      });
    });
  }

  // Tabs
  document.querySelectorAll<HTMLButtonElement>('.ws-tab').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab as AppState['activeTab']))
  );

  // Underwriting inputs
  document.getElementById('uw-strategy-select')?.addEventListener('change', (e) => {
    state.activeStrategy = (e.target as HTMLSelectElement).value as UnderwritingStrategy;
    saveState();
    renderAll();
  });

  const sliderMap: Record<string, keyof PropertyParcel> = {
    'uw-price': 'price',
    'uw-rent': 'rent',
    'uw-down': 'downPct',
    'uw-rate': 'rate',
    'uw-opex': 'opexPct',
    'uw-vacancy': 'vacancyPct',
    'uw-growth': 'rentGrowthPct',
    'uw-apprec': 'appreciationPct',
    'uw-rehab': 'rehab',
    'uw-roof': 'roofAgeYears',
  };
  Object.entries(sliderMap).forEach(([id, field]) => {
    document.getElementById(id)?.addEventListener('input', (e) => {
      const p = getActiveParcel();
      (p[field] as number) = Number((e.target as HTMLInputElement).value);
      state.lastAttribution = null;
      saveState();
      renderAll();
    });
  });

  document.getElementById('inp-active-address')?.addEventListener('change', (e) => {
    getActiveParcel().address = (e.target as HTMLInputElement).value.trim();
    saveState();
    renderHeroAccounts();
  });

  // Geocode active parcel
  document.getElementById('btn-geocode-active')?.addEventListener('click', async () => {
    const q = (document.getElementById('inp-active-address') as HTMLInputElement | null)?.value || '';
    const res = await spatial.geocodeAddress(q);
    if (!res) {
      showToast('Geocoder unavailable — coordinates unchanged');
      return;
    }
    const p = getActiveParcel();
    p.lat = res.lat;
    p.lng = res.lng;
    p.address = res.label;
    saveState();
    syncUWInputs();
    renderAll();
    spatial.syncMarkers();
    spatial.flyToActive();
    showToast(`Geocoded via ${res.provider}`);
  });

  // Spatial controls
  document.getElementById('map-style-select')?.addEventListener('change', (e) => {
    spatial.mapStyle = (e.target as HTMLSelectElement).value;
    spatial.initOrRefresh();
  });
  document.querySelectorAll<HTMLButtonElement>('.persp-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const persp = b.dataset.persp as '2d' | 'iso' | 'street';
      document.querySelectorAll<HTMLButtonElement>('.persp-btn').forEach((x) => {
        x.classList.toggle('btn-peri', x === b);
        x.classList.toggle('btn-ghost', x !== b);
      });
      spatial.setPerspective(persp);
    })
  );
  document.getElementById('btn-fit-markers')?.addEventListener('click', () => spatial.flyToActive());
  document.getElementById('btn-load-amenities')?.addEventListener('click', async () => {
    const radius = Number((document.getElementById('overpass-radius-select') as HTMLSelectElement)?.value || 1600);
    const st = document.getElementById('map-overpass-status');
    if (st) {
      st.classList.remove('hidden');
      st.textContent = 'Scanning Overpass OSM mirrors…';
    }
    const audit = await spatial.scanOverpassPOIs(radius);
    if (!audit) {
      if (st) st.textContent = 'Overpass mirror busy — try again in a few seconds.';
      return;
    }
    if (st) {
      st.textContent = `Mapped ${audit.features.length} POIs · Location Score ${audit.score}/100 (${audit.tier}) · Schools ${audit.counts.schools}, Transit ${audit.counts.transit}, Retail ${audit.counts.retail}`;
    }
    renderAll();
    showToast(`Overpass audit complete: ${audit.score}/100`);
  });

  document.getElementById('btn-osm-search')?.addEventListener('click', async () => {
    const inp = document.getElementById('osm-search-input') as HTMLInputElement | null;
    if (!inp?.value.trim()) return;
    const res = await spatial.geocodeAddress(inp.value.trim());
    if (!res) {
      showToast('Address not found');
      return;
    }
    state.properties.push({
      ...DEFAULT_PROPERTIES[0],
      id: `geo-${Date.now()}`,
      address: res.label,
      lat: res.lat,
      lng: res.lng,
    });
    state.activeIndex = state.properties.length - 1;
    inp.value = '';
    saveState();
    syncUWInputs();
    renderAll();
    spatial.syncMarkers();
    spatial.flyToActive();
    showToast(`Pinned new parcel via ${res.provider}`);
  });

  // Hero & Report triggers
  document.getElementById('btn-hero-audit')?.addEventListener('click', () =>
    runReport(PERSONA_PROFILES[state.persona].defaultReport)
  );
  document.getElementById('btn-audit-deal-ai')?.addEventListener('click', () => runReport('ic_audit'));
  document.getElementById('btn-hero-map')?.addEventListener('click', () => switchTab('map'));
  document.querySelectorAll<HTMLButtonElement>('.report-trigger').forEach((b) =>
    b.addEventListener('click', () => runReport((b.dataset.reportType as ReportType) || 'ic_audit'))
  );
  document.getElementById('report-custom-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('report-custom-input') as HTMLInputElement | null;
    if (inp?.value.trim()) {
      runReport('custom', inp.value.trim());
      inp.value = '';
    }
  });

  // Ecosystem Hub actions
  document.getElementById('btn-masternex-seal')?.addEventListener('click', async () => {
    const p = getActiveParcel();
    const m = calcUnderwriting(p, state.activeStrategy);
    const doe = computeDOEFactorial(p, state.activeStrategy);
    const { attribution, aguiEvents } = await runMasternexUnderwrite({
      cfg: { baseUrl: state.masternexUrl, apiKey: state.masternexKey },
      parcel: p,
      metrics: m,
      doe,
      locationScore: getLocationScore(p),
      reportType: PERSONA_PROFILES[state.persona].defaultReport,
    });
    state.lastAttribution = attribution;
    aguiEvents.forEach((ev) => state.aguiEvents.unshift(ev));
    renderEcosystemPanel();
    showToast(
      attribution.source === 'masternex-live'
        ? `Sealed in MASTERNEX ACP-SQL (${attribution.packetId})`
        : 'Computed local exact Shapley preview (MASTERNEX offline)'
    );
  });

  document.getElementById('btn-atlas-probe')?.addEventListener('click', async () => {
    const res = await runMasternexStormHazard(
      { baseUrl: state.masternexUrl, apiKey: state.masternexKey },
      getActiveParcel()
    );
    showToast(`AUCTUM.atlas (${res.source}): ${res.hazardScore}/100 · ${res.tier}`);
    emitAgUi('CUSTOM', { action: 'atlas_hazard_eval', ...res });
  });

  document.getElementById('btn-agui-test-run')?.addEventListener('click', () => {
    emitAgUi('RUN_STARTED', { parcel: getActiveParcel().address, persona: state.persona });
    emitAgUi('STATE_DELTA', { strategy: state.activeStrategy });
    emitAgUi('RUN_FINISHED', { outcome: 'interrupt_hitl' });
    const msg = document.getElementById('agui-hitl-msg');
    if (msg) msg.textContent = `Approve ${PERSONA_PROFILES[state.persona].shortLabel} terms for ${getActiveParcel().address}?`;
    document.getElementById('agui-hitl-actions')?.classList.remove('hidden');
  });
  document.getElementById('btn-hitl-approve')?.addEventListener('click', () => {
    emitAgUi('CUSTOM', { hitl_verdict: 'APPROVED', parcel: getActiveParcel().address });
    document.getElementById('agui-hitl-actions')?.classList.add('hidden');
    showToast('HITL Approved & Logged');
  });
  document.getElementById('btn-hitl-reject')?.addEventListener('click', () => {
    emitAgUi('CUSTOM', { hitl_verdict: 'REJECTED', parcel: getActiveParcel().address });
    document.getElementById('agui-hitl-actions')?.classList.add('hidden');
    showToast('HITL Rejected & Logged');
  });

  // Hugging Face Datasets Benchmark Streamer
  const hfSelect = document.getElementById('hf-dataset-select') as HTMLSelectElement | null;
  if (hfSelect) {
    hfSelect.innerHTML = HF_DATASET_PRESETS.map(
      (pr) => `<option value="${pr.id}">${escHtml(pr.label)} (${escHtml(pr.dataset)})</option>`
    ).join('');
  }
  document.getElementById('btn-hf-fetch')?.addEventListener('click', async () => {
    const out = document.getElementById('hf-dataset-results');
    if (out) out.innerHTML = '<div class="text-xs text-accent">Streaming rows from Hugging Face Datasets Server…</div>';
    const res = await fetchHFDatasetBenchmarks(hfSelect?.value || 'housing_cal', 5);
    if (out) {
      out.innerHTML = `
        <div class="flex-between" style="margin-bottom:0.5rem">
          <span class="badge ${res.mode === 'hf-datasets-live' ? 'badge-acquire' : 'badge-negotiate'}">${res.mode}</span>
          <span class="text-xs text-muted">${escHtml(res.dataset)}</span>
        </div>
        <div class="stack-xs">
          ${res.rows
            .map(
              (r) =>
                `<div class="inner-well pad-well text-xs"><strong>${escHtml(r.market)}</strong> · <span class="text-accent">${escHtml(
                  r.metric
                )}</span> = <strong>${escHtml(r.value)}</strong><div class="text-muted">${escHtml(
                  r.context
                )}</div></div>`
            )
            .join('')}
        </div>`;
    }
    emitAgUi('CUSTOM', { action: 'hf_datasets_stream', mode: res.mode, dataset: res.dataset, rows: res.rowCount });
  });

  // Academic Literature Search
  document.getElementById('academic-search-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = document.getElementById('academic-search-input') as HTMLInputElement | null;
    const out = document.getElementById('academic-results');
    if (out) out.innerHTML = '<div class="text-xs text-accent">Searching Nature / OpenAlex / arXiv…</div>';
    const res = await searchAcademicLiterature(
      { baseUrl: state.masternexUrl, apiKey: state.masternexKey },
      inp?.value || 'real estate cap rate DSCR climate risk'
    );
    if (out) {
      out.innerHTML = `
        <div class="flex-between" style="margin-bottom:0.5rem">
          <span class="badge badge-peri">${res.mode}</span>
          <span class="text-xs text-muted">${res.papers.length} works</span>
        </div>
        <div class="stack-xs">
          ${res.papers
            .map(
              (paper) => `<div class="inner-well pad-well text-xs">
                <div class="text-accent">${escHtml(paper.source)} · ${escHtml(paper.year)}</div>
                <a href="${escHtml(paper.url)}" target="_blank" rel="noopener" style="font-weight:600;color:var(--color-ink)">${escHtml(
                  paper.title
                )} ↗</a>
                <div class="text-muted">${escHtml(paper.snippet)}</div>
              </div>`
            )
            .join('')}
        </div>`;
    }
  });

  // CSV Import & Export + Markdown Export
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    const csv = portfolioToCSV(state.properties, state.activeStrategy);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'AUCTUM_Insights_Portfolio.csv';
    a.click();
    showToast('Exported portfolio CSV');
  });

  document.getElementById('btn-export-md')?.addEventListener('click', () => {
    const p = getActiveParcel();
    const md = buildQuantFallbackMarkdown({
      type: 'cma',
      parcel: p,
      metrics: calcUnderwriting(p, state.activeStrategy),
      doe: computeDOEFactorial(p, state.activeStrategy),
      mc: runMonteCarloStress(p, state.activeStrategy, 1000, 42),
      hazard: evaluateLocalStormHazard(p),
      properties: state.properties,
      strategy: state.activeStrategy,
      persona: PERSONA_PROFILES[state.persona],
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = 'AUCTUM_Insights_Memo.md';
    a.click();
    showToast('Exported Markdown memo');
  });

  document.getElementById('inp-import-csv')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = parsePortfolioCSV(text);
    if (!imported.length) {
      showToast('No valid rows found in CSV (requires address column)');
      return;
    }
    state.properties.push(...imported);
    state.activeIndex = state.properties.length - 1;
    saveState();
    syncUWInputs();
    renderAll();
    showToast(`Imported ${imported.length} parcel(s) from CSV`);
  });

  // Add Property Modal (with live geocoding)
  const addDialog = document.getElementById('add-property-dialog') as HTMLDialogElement | null;
  document.getElementById('btn-add-property')?.addEventListener('click', () => addDialog?.showModal());
  document.getElementById('btn-close-add-prop')?.addEventListener('click', () => addDialog?.close());
  document.getElementById('btn-cancel-add-prop')?.addEventListener('click', () => addDialog?.close());
  document.getElementById('add-property-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const addr = (document.getElementById('new-prop-address') as HTMLInputElement).value.trim();
    const price = Number((document.getElementById('new-prop-price') as HTMLInputElement).value) || 350000;
    const rent = Number((document.getElementById('new-prop-rent') as HTMLInputElement).value) || 3100;
    const geo = await spatial.geocodeAddress(addr);
    state.properties.push({
      ...DEFAULT_PROPERTIES[0],
      id: `p-${Date.now()}`,
      address: geo?.label || addr,
      price,
      rent,
      lat: geo?.lat ?? 30.2672,
      lng: geo?.lng ?? -97.7431,
    });
    state.activeIndex = state.properties.length - 1;
    saveState();
    addDialog?.close();
    syncUWInputs();
    renderAll();
    showToast(geo ? `Added & geocoded via ${geo.provider}` : 'Added parcel');
  });

  // Settings & Connectors Modal
  const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement | null;
  const provSel = document.getElementById('inp-provider') as HTMLSelectElement | null;
  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
    if (provSel) provSel.value = state.provider;
    (document.getElementById('inp-base-url') as HTMLInputElement).value = state.baseUrl;
    (document.getElementById('inp-model-id') as HTMLInputElement).value = state.modelId;
    (document.getElementById('inp-api-key') as HTMLInputElement).value = state.apiKey;
    (document.getElementById('inp-masternex-url') as HTMLInputElement).value = state.masternexUrl;
    (document.getElementById('inp-masternex-key') as HTMLInputElement).value = state.masternexKey;
    (document.getElementById('inp-kdense-url') as HTMLInputElement).value = state.kdenseUrl;
    (document.getElementById('inp-gmaps-key') as HTMLInputElement).value = state.googleMapsKey;
    settingsDialog?.showModal();
  });
  provSel?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value as AIProviderId;
    const pr = PROVIDER_PRESETS[id];
    (document.getElementById('inp-base-url') as HTMLInputElement).value = pr.url;
    (document.getElementById('inp-model-id') as HTMLInputElement).value = pr.models[0];
  });
  document.getElementById('btn-close-dialog')?.addEventListener('click', () => settingsDialog?.close());
  document.getElementById('btn-cancel-dialog')?.addEventListener('click', () => settingsDialog?.close());
  document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    state.provider = (provSel?.value as AIProviderId) || 'pollinations';
    state.baseUrl =
      (document.getElementById('inp-base-url') as HTMLInputElement).value.trim() ||
      PROVIDER_PRESETS[state.provider].url;
    state.modelId =
      (document.getElementById('inp-model-id') as HTMLInputElement).value.trim() ||
      PROVIDER_PRESETS[state.provider].models[0];
    state.apiKey = (document.getElementById('inp-api-key') as HTMLInputElement).value.trim();
    state.masternexUrl =
      (document.getElementById('inp-masternex-url') as HTMLInputElement).value.trim() ||
      'http://127.0.0.1:8080';
    state.masternexKey = (document.getElementById('inp-masternex-key') as HTMLInputElement).value.trim();
    state.kdenseUrl =
      (document.getElementById('inp-kdense-url') as HTMLInputElement).value.trim() ||
      'http://127.0.0.1:8000';
    state.googleMapsKey = (document.getElementById('inp-gmaps-key') as HTMLInputElement).value.trim();
    saveState();
    settingsDialog?.close();
    renderAll();
    await refreshConnectorBadges();
    showToast(`Saved routing: ${PROVIDER_PRESETS[state.provider].label}`);
  });

  async function refreshConnectorBadges(): Promise<void> {
    let mnOk = false;
    if (window.location.protocol.startsWith('http')) {
      const proxyUrl = `${window.location.origin}/api/masternex`;
      if (await probeMasternexHealth({ baseUrl: proxyUrl, apiKey: state.masternexKey })) {
        state.masternexUrl = proxyUrl;
        mnOk = true;
      }
    }
    if (!mnOk) {
      mnOk = await probeMasternexHealth({ baseUrl: state.masternexUrl, apiKey: state.masternexKey });
    }
    const kdOk = await probeKDenseHealth(state.kdenseUrl);
    state.masternexOnline = mnOk;
    state.kdenseOnline = kdOk;
    const mnEl = document.getElementById('status-masternex');
    const kdEl = document.getElementById('status-kdense');
    if (mnEl) {
      mnEl.textContent = mnOk ? 'MASTERNEX: Live' : 'MASTERNEX: Local Fallback';
      mnEl.className = `badge ${mnOk ? 'badge-acquire' : 'badge-peri'}`;
    }
    if (kdEl) {
      kdEl.textContent = kdOk ? 'K-Dense: Live' : 'K-Dense: Skills Ready';
      kdEl.className = `badge ${kdOk ? 'badge-acquire' : 'badge-peri'}`;
    }
  }

  // Interactive Target-Price Solver controls
  document.getElementById('solver-metric-select')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    const inp = document.getElementById('solver-target-val') as HTMLInputElement | null;
    if (inp) {
      inp.value = val === 'dscr' ? '1.25' : val === 'capRate' ? '7.0' : '10.0';
      inp.step = val === 'dscr' ? '0.05' : '0.25';
    }
    renderAll();
  });
  document.getElementById('solver-target-val')?.addEventListener('input', () => renderAll());
  document.getElementById('btn-apply-solved-price')?.addEventListener('click', () => {
    const p = getActiveParcel();
    const metric =
      ((document.getElementById('solver-metric-select') as HTMLSelectElement | null)?.value as
        | 'dscr'
        | 'capRate'
        | 'coc') || 'dscr';
    const target =
      Number((document.getElementById('solver-target-val') as HTMLInputElement | null)?.value) || 1.25;
    const solved = solveTargetPrice(p, state.activeStrategy, metric, target);
    if (!solved.achievable) {
      showToast('Target not achievable by price adjustment alone');
      return;
    }
    p.price = solved.maxPrice;
    state.lastAttribution = null;
    saveState();
    syncUWInputs();
    renderAll();
    showToast(`Applied solved offer price: ${fmtDollars(solved.maxPrice)}`);
    emitAgUi('STATE_DELTA', { action: 'apply_target_price', maxPrice: solved.maxPrice, metric, target });
  });

  // Shareable Deal Link (#deal=<token>) & Print PDF
  document.getElementById('btn-share-deal')?.addEventListener('click', async () => {
    const token = encodeShareableDeal({
      v: 71,
      persona: state.persona,
      strategy: state.activeStrategy,
      parcel: getActiveParcel(),
    });
    const shareUrl = `${window.location.origin}${window.location.pathname}#deal=${token}`;
    window.history.replaceState(null, '', `#deal=${token}`);
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Copied shareable deal URL to clipboard');
    } catch {
      showToast('Updated URL hash — copy address bar to share');
    }
  });
  document.getElementById('btn-print-pdf')?.addEventListener('click', () => window.print());

  // Hydrate shared deal from URL hash if present
  if (window.location.hash.startsWith('#deal=')) {
    const shared = decodeShareableDeal(window.location.hash.slice('#deal='.length));
    if (shared) {
      state.persona = shared.persona;
      state.activeStrategy = shared.strategy;
      const existingIdx = state.properties.findIndex((x) => x.address === shared.parcel.address);
      if (existingIdx >= 0) {
        state.properties[existingIdx] = shared.parcel;
        state.activeIndex = existingIdx;
      } else {
        state.properties.push({ ...shared.parcel, id: `shared-${Date.now()}` });
        state.activeIndex = state.properties.length - 1;
      }
      showToast(`Loaded shared deal: ${shared.parcel.address}`);
    }
  }

  // Global Command Palette (Ctrl+K / ⌘K)
  const cmdDialog = document.getElementById('cmd-palette-dialog') as HTMLDialogElement | null;
  const cmdInput = document.getElementById('cmdk-input') as HTMLInputElement | null;
  const cmdList = document.getElementById('cmdk-list');

  const getCommandItems = () => [
    ...LAB_APPS.map((app) => ({
      group: 'Scientific App',
      label: app.title,
      hint: app.badge,
      run: () => {
        switchTab('lab');
        labApps.openApp(app.id);
      },
    })),
    ...PERSONA_LIST.map((pr) => ({
      group: 'Persona',
      label: `Switch Persona → ${pr.label}`,
      hint: pr.shortLabel,
      run: () => {
        state.persona = pr.id;
        state.activeStrategy = pr.defaultStrategy;
        state.fiduciaryGuardEnabled = pr.id === 'fiduciary';
        saveState();
        syncUWInputs();
        renderAll();
        showToast(`Persona switched: ${pr.label}`);
      },
    })),
    {
      group: 'Action',
      label: 'Generate IC Audit Dossier',
      hint: 'AI Studio',
      run: () => void runReport('ic_audit'),
    },
    {
      group: 'Action',
      label: 'Seal Active Parcel in MASTERNEX ACP-SQL',
      hint: 'ML-DSA-87',
      run: () => {
        switchTab('lab');
        labApps.openApp('masternex-scientific');
      },
    },
    {
      group: 'Action',
      label: 'Print / Save Executive PDF Tear-Sheet',
      hint: 'PDF',
      run: () => window.print(),
    },
  ];

  const renderCmdList = (q = '') => {
    if (!cmdList) return;
    const clean = q.trim().toLowerCase();
    const matches = getCommandItems().filter(
      (item) =>
        !clean ||
        item.label.toLowerCase().includes(clean) ||
        item.hint.toLowerCase().includes(clean) ||
        item.group.toLowerCase().includes(clean)
    );
    cmdList.innerHTML = matches.length
      ? matches
          .map(
            (item, idx) => `<button type="button" data-cmd-idx="${idx}" class="account-row" style="width:100%;text-align:left;border:1px solid oklch(100% 0 0 / 0.06)">
              <div>
                <div class="text-xs text-accent">${escHtml(item.group)}</div>
                <div class="text-sm" style="color:var(--color-ink)">${escHtml(item.label)}</div>
              </div>
              <span class="badge badge-peri">${escHtml(item.hint)}</span>
            </button>`
          )
          .join('')
      : '<div class="text-xs text-muted pad-well">No matching commands.</div>';

    cmdList.querySelectorAll<HTMLButtonElement>('[data-cmd-idx]').forEach((b) =>
      b.addEventListener('click', () => {
        const picked = matches[Number(b.dataset.cmdIdx)];
        cmdDialog?.close();
        picked?.run();
      })
    );
  };

  const openCmdPalette = () => {
    if (!cmdDialog) return;
    if (cmdInput) cmdInput.value = '';
    renderCmdList('');
    cmdDialog.showModal();
    cmdInput?.focus();
  };

  document.getElementById('btn-open-cmdk')?.addEventListener('click', openCmdPalette);
  document.getElementById('btn-close-cmdk')?.addEventListener('click', () => cmdDialog?.close());
  cmdInput?.addEventListener('input', (e) => renderCmdList((e.target as HTMLInputElement).value));
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (cmdDialog?.open) cmdDialog.close();
      else openCmdPalette();
    }
  });

  window.addEventListener('resize', () => charts.resizeAll());

  syncUWInputs();
  renderAll();
  void refreshConnectorBadges();
}
