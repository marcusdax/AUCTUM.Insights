import type {
  PropertyParcel,
  UnderwritingMetrics,
  UnderwritingStrategy,
  UserPersonaId,
} from '../engine/types';
import { PERSONA_PROFILES } from '../engine/personas';

export const WEALTH_SYMPHONY_DEFAULT_URL = 'http://127.0.0.1:3001';
export const WEALTH_SYMPHONY_BRIDGE_SOURCE = 'auctum-insights' as const;
export const WEALTH_SYMPHONY_BRIDGE_VERSION = '7.6' as const;

export interface WealthSymphonyConfig {
  baseUrl: string;
  accessToken?: string;
  timeoutMs?: number;
}

export interface WealthSymphonyHolding {
  id?: string;
  portfolioId?: string;
  symbol: string;
  quantity: number;
  avgCost: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WealthSymphonyPortfolio {
  id?: string;
  userId?: string;
  totalValue: number;
  holdings: WealthSymphonyHolding[];
}

export interface WealthSymphonyProfile {
  userId?: string;
  age?: number;
  retirementAge?: number;
  filingStatus?: 'single' | 'married' | 'head';
  stateTaxRate?: number;
  employmentStatus?: 'employed' | 'self' | 'retired' | 'semi';
  annualIncome?: number;
  investableAssets?: number;
  monthlyExpenses?: number;
  retirementSavings?: number;
  primaryGoal?: 'retire' | 'grow' | 'protect' | 'income' | 'legacy';
  riskTolerance?: number;
  investmentStyle?: 'passive' | 'active' | 'dividend' | 'growth';
  cryptoAllocation?: number;
  notes?: string;
}

export interface WealthSymphonyPlanPayload {
  generatedAt: string;
  source: typeof WEALTH_SYMPHONY_BRIDGE_SOURCE;
  version: typeof WEALTH_SYMPHONY_BRIDGE_VERSION;
  persona: UserPersonaId;
  strategy: UnderwritingStrategy;
  parcelId: string;
  symbol: string;
  address: string;
  holding: {
    symbol: string;
    quantity: number;
    avgCost: number;
  };
  metrics: {
    price: number;
    cashIn: number;
    monthlyRent: number;
    monthlyCashFlow: number;
    annualCashFlow: number;
    capRate: number;
    cashOnCash: number;
    dscr: number;
    irr10Yr: number;
    equityMultiple10Yr: number;
    breakEvenOccPct: number;
    verdict: UnderwritingMetrics['verdict'];
  };
  profileNote: string;
}

export type WealthSymphonyPushMode =
  | 'wealth-symphony-live'
  | 'embed-postmessage'
  | 'local-preview';

export interface WealthSymphonyPushResult {
  ok: boolean;
  mode: WealthSymphonyPushMode;
  payload: WealthSymphonyPlanPayload;
  portfolio?: WealthSymphonyPortfolio;
  profile?: WealthSymphonyProfile;
  profileUpdated?: boolean;
  message: string;
  httpStatus?: number;
}

export interface EmbedOptions {
  embed: 'wealth-symphony' | null;
  persona: UserPersonaId | null;
  wsOrigin: string | null;
  wsUrl: string | null;
}

export type OutboundBridgeMessageType =
  | 'AUCTUM_INSIGHTS_READY'
  | 'AUCTUM_INSIGHTS_PUSH_PLAN'
  | 'AUCTUM_INSIGHTS_STATE_SYNC';

export interface OutboundBridgeMessage<T = unknown> {
  source: typeof WEALTH_SYMPHONY_BRIDGE_SOURCE;
  version: typeof WEALTH_SYMPHONY_BRIDGE_VERSION;
  type: OutboundBridgeMessageType;
  payload: T;
}

export interface InboundSetConfigPayload {
  baseUrl?: string;
  accessToken?: string;
  persona?: UserPersonaId;
  theme?: 'dusk' | 'daylight';
}

export type InboundBridgeMessage =
  | {
      type: 'WEALTH_SYMPHONY_SET_CONFIG';
      payload: InboundSetConfigPayload;
    }
  | {
      type: 'WEALTH_SYMPHONY_LOAD_PARCEL';
      payload: Partial<PropertyParcel>;
    }
  | {
      type: 'WEALTH_SYMPHONY_REQUEST_STATE';
      payload?: Record<string, unknown>;
    };

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || WEALTH_SYMPHONY_DEFAULT_URL).trim().replace(/\/+$/, '');
}

function buildHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (accessToken?.trim()) {
    headers['Authorization'] = `Bearer ${accessToken.trim()}`;
  }
  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 3000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function validateHttpUrl(raw: string | null | undefined, originOnly = false): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return originOnly ? parsed.origin : parsed.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function parseEmbedParams(search: string): EmbedOptions {
  const params = new URLSearchParams(search || '');
  const rawEmbed = params.get('embed')?.trim().toLowerCase() ?? '';
  const embed = rawEmbed === 'wealth-symphony' ? 'wealth-symphony' : null;

  const rawPersona = params.get('persona')?.trim() ?? '';
  const persona: UserPersonaId | null =
    rawPersona && Object.prototype.hasOwnProperty.call(PERSONA_PROFILES, rawPersona)
      ? (rawPersona as UserPersonaId)
      : null;

  const wsOrigin = validateHttpUrl(params.get('wsOrigin'), true);
  const wsUrl = validateHttpUrl(params.get('wsUrl'), false);

  return { embed, persona, wsOrigin, wsUrl };
}

/**
 * Converts a PropertyParcel into a deterministic, sanitized Wealth Symphony holding symbol.
 * Guaranteed: prefixed with `RE-`, uppercase alphanumeric + hyphens, max 30 characters.
 */
export function parcelToHoldingSymbol(parcel: Pick<PropertyParcel, 'id' | 'address'>): string {
  const sanitize = (input: string): string =>
    input
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  const primary = sanitize(parcel.address || '');
  const fallback = sanitize(parcel.id || '') || 'PARCEL';
  const body = primary || fallback;
  const prefixed = body.startsWith('RE-') ? body : `RE-${body}`;
  const truncated = prefixed.slice(0, 30).replace(/-+$/, '');
  return truncated.length >= 3 ? truncated : 'RE-PARCEL';
}

export function parcelToWealthSymphonyHolding(
  parcel: PropertyParcel,
  metrics: UnderwritingMetrics
): { symbol: string; quantity: number; avgCost: number } {
  const symbol = parcelToHoldingSymbol(parcel);
  const rawCost = Number.isFinite(metrics.price) && metrics.price > 0 ? metrics.price : parcel.price;
  const avgCost = Math.min(1e12, Math.max(0, Math.round(rawCost)));
  return {
    symbol,
    quantity: 1,
    avgCost,
  };
}

export function buildFiduciaryProfileNote(
  symbol: string,
  metrics: UnderwritingMetrics,
  strategy: UnderwritingStrategy,
  generatedAt: string
): string {
  const priceStr = Math.round(metrics.price).toLocaleString('en-US');
  const cashInStr = Math.round(metrics.cashIn).toLocaleString('en-US');
  const cfStr = Math.round(metrics.mCf).toLocaleString('en-US');
  return `[AUCTUM.Insights v${WEALTH_SYMPHONY_BRIDGE_VERSION} · SR 11-7] ${symbol} (${strategy.toUpperCase()}): Price $${priceStr} · Equity $${cashInStr} · Cap ${metrics.capRate.toFixed(
    2
  )}% · DSCR ${metrics.dscr.toFixed(2)}x · 10-Yr IRR ${metrics.irr10Yr.toFixed(
    2
  )}% · Net CF $${cfStr}/mo · Verdict ${metrics.verdict} (${generatedAt})`;
}

export function buildWealthSymphonyPlanPayload(params: {
  parcel: PropertyParcel;
  metrics: UnderwritingMetrics;
  persona: UserPersonaId;
  strategy: UnderwritingStrategy;
  generatedAt?: string;
}): WealthSymphonyPlanPayload {
  const { parcel, metrics, persona, strategy } = params;
  const generatedAt = params.generatedAt || new Date().toISOString();
  const holding = parcelToWealthSymphonyHolding(parcel, metrics);
  const profileNote = buildFiduciaryProfileNote(holding.symbol, metrics, strategy, generatedAt);

  return {
    generatedAt,
    source: WEALTH_SYMPHONY_BRIDGE_SOURCE,
    version: WEALTH_SYMPHONY_BRIDGE_VERSION,
    persona,
    strategy,
    parcelId: parcel.id,
    symbol: holding.symbol,
    address: parcel.address,
    holding,
    metrics: {
      price: Math.round(metrics.price),
      cashIn: Math.round(metrics.cashIn),
      monthlyRent: Math.round(metrics.baseRent),
      monthlyCashFlow: Math.round(metrics.mCf),
      annualCashFlow: Math.round(metrics.aCf),
      capRate: Number(metrics.capRate.toFixed(2)),
      cashOnCash: Number(metrics.coc.toFixed(2)),
      dscr: Number(metrics.dscr.toFixed(2)),
      irr10Yr: Number(metrics.irr10Yr.toFixed(2)),
      equityMultiple10Yr: Number(metrics.equityMultiple10Yr.toFixed(2)),
      breakEvenOccPct: Number(metrics.breakEvenOccPct.toFixed(1)),
      verdict: metrics.verdict,
    },
    profileNote,
  };
}

export function mergePortfolioHoldings(
  existing: WealthSymphonyPortfolio | null,
  incoming: { symbol: string; quantity: number; avgCost: number }
): { totalValue: number; holdings: Array<{ symbol: string; quantity: number; avgCost: number }> } {
  const bySymbol = new Map<string, { symbol: string; quantity: number; avgCost: number }>();

  for (const h of existing?.holdings ?? []) {
    const sym = String(h.symbol || '').trim().toUpperCase().slice(0, 30);
    if (!sym) continue;
    bySymbol.set(sym, {
      symbol: sym,
      quantity: Math.min(1e12, Math.max(0, Number(h.quantity) || 0)),
      avgCost: Math.min(1e12, Math.max(0, Number(h.avgCost) || 0)),
    });
  }

  const normalizedIncomingSym = incoming.symbol.trim().toUpperCase().slice(0, 30);
  bySymbol.set(normalizedIncomingSym, {
    symbol: normalizedIncomingSym,
    quantity: Math.min(1e12, Math.max(0, Number(incoming.quantity) || 0)),
    avgCost: Math.min(1e12, Math.max(0, Number(incoming.avgCost) || 0)),
  });

  const holdings = Array.from(bySymbol.values()).slice(0, 200);
  const totalValue = Number(
    holdings
      .reduce((acc, item) => acc + item.quantity * item.avgCost, 0)
      .toFixed(2)
  );

  return { totalValue, holdings };
}

export function buildProfileUpdateBody(
  existing: WealthSymphonyProfile | null,
  payload: WealthSymphonyPlanPayload,
  mergedPortfolioTotal?: number
): Partial<WealthSymphonyProfile> {
  const prevNotes = typeof existing?.notes === 'string' ? existing.notes.trim() : '';
  const nextNotes = prevNotes ? `${prevNotes}\n${payload.profileNote}` : payload.profileNote;

  const body: Partial<WealthSymphonyProfile> = {
    notes: nextNotes,
  };

  if (typeof existing?.investableAssets === 'number' && Number.isFinite(existing.investableAssets)) {
    const targetAssets =
      typeof mergedPortfolioTotal === 'number' && Number.isFinite(mergedPortfolioTotal)
        ? Math.max(existing.investableAssets, mergedPortfolioTotal)
        : existing.investableAssets;
    body.investableAssets = Math.max(0, Math.round(targetAssets));
  } else if (typeof mergedPortfolioTotal === 'number' && Number.isFinite(mergedPortfolioTotal)) {
    body.investableAssets = Math.max(0, Math.round(mergedPortfolioTotal));
  }

  return body;
}

export async function probeWealthSymphonyHealth(cfg: WealthSymphonyConfig): Promise<boolean> {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/health`;
  try {
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Accept: 'application/json' } },
      cfg.timeoutMs ?? 2500
    );
    if (!res.ok) return false;
    try {
      const data = (await res.json()) as { status?: string };
      if (typeof data.status === 'string') {
        return data.status.toLowerCase() === 'healthy' || data.status.toLowerCase() === 'ok';
      }
      return true;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

export async function fetchWealthSymphonyPortfolio(
  cfg: WealthSymphonyConfig
): Promise<WealthSymphonyPortfolio | null> {
  if (!cfg.accessToken?.trim()) return null;
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/api/v1/portfolio`;
  try {
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: buildHeaders(cfg.accessToken) },
      cfg.timeoutMs ?? 3000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as WealthSymphonyPortfolio;
    return {
      ...data,
      totalValue: Number(data.totalValue) || 0,
      holdings: Array.isArray(data.holdings) ? data.holdings : [],
    };
  } catch {
    return null;
  }
}

export async function appendWealthSymphonyHolding(
  cfg: WealthSymphonyConfig,
  holding: { symbol: string; quantity: number; avgCost: number }
): Promise<WealthSymphonyHolding | null> {
  if (!cfg.accessToken?.trim()) return null;
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/api/v1/portfolio/holdings`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: buildHeaders(cfg.accessToken),
        body: JSON.stringify({
          symbol: holding.symbol.trim().toUpperCase().slice(0, 30),
          quantity: Math.min(1e12, Math.max(0, Number(holding.quantity) || 0)),
          avgCost: Math.min(1e12, Math.max(0, Number(holding.avgCost) || 0)),
        }),
      },
      cfg.timeoutMs ?? 3000
    );
    if (!res.ok) return null;
    return (await res.json()) as WealthSymphonyHolding;
  } catch {
    return null;
  }
}

export async function fetchWealthSymphonyProfile(
  cfg: WealthSymphonyConfig
): Promise<WealthSymphonyProfile | null> {
  if (!cfg.accessToken?.trim()) return null;
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/api/v1/profile`;
  try {
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: buildHeaders(cfg.accessToken) },
      cfg.timeoutMs ?? 3000
    );
    if (!res.ok) return null;
    return (await res.json()) as WealthSymphonyProfile;
  } catch {
    return null;
  }
}

export function postToWealthSymphonyHost<T>(
  type: OutboundBridgeMessageType,
  payload: T,
  targetOrigin?: string | null,
  parentWindow?: Pick<Window, 'postMessage'> | null
): boolean {
  const target =
    parentWindow ??
    (typeof window !== 'undefined' && window.parent && window.parent !== window
      ? window.parent
      : null);

  if (!target || typeof target.postMessage !== 'function') {
    return false;
  }

  const message: OutboundBridgeMessage<T> = {
    source: WEALTH_SYMPHONY_BRIDGE_SOURCE,
    version: WEALTH_SYMPHONY_BRIDGE_VERSION,
    type,
    payload,
  };

  const safeOrigin = validateHttpUrl(targetOrigin, true) || '*';
  try {
    target.postMessage(message, safeOrigin);
    return true;
  } catch {
    return false;
  }
}

export function isInboundWealthSymphonyMessage(
  data: unknown,
  origin?: string,
  allowedOrigin?: string | null
): data is InboundBridgeMessage {
  if (allowedOrigin && allowedOrigin.trim()) {
    if (!origin || origin !== allowedOrigin.trim()) {
      return false;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || !candidate.type.startsWith('WEALTH_SYMPHONY_')) {
    return false;
  }

  if (candidate.type === 'WEALTH_SYMPHONY_REQUEST_STATE') {
    return true;
  }

  if (
    candidate.type === 'WEALTH_SYMPHONY_SET_CONFIG' ||
    candidate.type === 'WEALTH_SYMPHONY_LOAD_PARCEL'
  ) {
    return (
      candidate.payload !== null &&
      typeof candidate.payload === 'object' &&
      !Array.isArray(candidate.payload)
    );
  }

  return false;
}

export async function pushParcelToWealthSymphony(params: {
  cfg: WealthSymphonyConfig;
  parcel: PropertyParcel;
  metrics: UnderwritingMetrics;
  persona: UserPersonaId;
  strategy: UnderwritingStrategy;
  embedded?: boolean;
  targetOrigin?: string | null;
  parentWindow?: Pick<Window, 'postMessage'> | null;
  updateProfile?: boolean;
}): Promise<WealthSymphonyPushResult> {
  const {
    cfg,
    parcel,
    metrics,
    persona,
    strategy,
    embedded = false,
    targetOrigin = null,
    parentWindow = null,
    updateProfile = true,
  } = params;

  const payload = buildWealthSymphonyPlanPayload({ parcel, metrics, persona, strategy });

  if (embedded) {
    postToWealthSymphonyHost('AUCTUM_INSIGHTS_PUSH_PLAN', payload, targetOrigin, parentWindow);
  }

  const token = cfg.accessToken?.trim() ?? '';
  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  const timeoutMs = cfg.timeoutMs ?? 3000;

  if (!token) {
    if (embedded) {
      return {
        ok: true,
        mode: 'embed-postmessage',
        payload,
        message: `Pushed ${payload.symbol} to Wealth Symphony host via postMessage bridge`,
      };
    }
    return {
      ok: true,
      mode: 'local-preview',
      payload,
      message: `Prepared ${payload.symbol} plan payload (local preview — add Bearer JWT in AI & Connectors to sync live)`,
    };
  }

  try {
    // 1. GET existing portfolio so PUT preserves all existing holdings
    const getRes = await fetchWithTimeout(
      `${baseUrl}/api/v1/portfolio`,
      { method: 'GET', headers: buildHeaders(token) },
      timeoutMs
    );

    if (getRes.status === 401 || getRes.status === 403) {
      return {
        ok: embedded,
        mode: embedded ? 'embed-postmessage' : 'local-preview',
        payload,
        httpStatus: getRes.status,
        message: embedded
          ? `Wealth Symphony API returned ${getRes.status}; delivered ${payload.symbol} via postMessage`
          : `Wealth Symphony API rejected token (HTTP ${getRes.status}) — prepared local preview payload`,
      };
    }

    let existingPortfolio: WealthSymphonyPortfolio | null = null;
    if (getRes.ok) {
      const data = (await getRes.json()) as WealthSymphonyPortfolio;
      existingPortfolio = {
        ...data,
        totalValue: Number(data.totalValue) || 0,
        holdings: Array.isArray(data.holdings) ? data.holdings : [],
      };
    } else if (getRes.status !== 404) {
      return {
        ok: embedded,
        mode: embedded ? 'embed-postmessage' : 'local-preview',
        payload,
        httpStatus: getRes.status,
        message: `Wealth Symphony portfolio read failed (HTTP ${getRes.status}) — fell back to ${
          embedded ? 'postMessage' : 'local preview'
        }`,
      };
    }

    // 2. Merge / deduplicate holdings & recompute totalValue
    const merged = mergePortfolioHoldings(existingPortfolio, payload.holding);

    // 3. PUT merged portfolio
    const putRes = await fetchWithTimeout(
      `${baseUrl}/api/v1/portfolio`,
      {
        method: 'PUT',
        headers: buildHeaders(token),
        body: JSON.stringify(merged),
      },
      timeoutMs
    );

    if (!putRes.ok) {
      return {
        ok: embedded,
        mode: embedded ? 'embed-postmessage' : 'local-preview',
        payload,
        httpStatus: putRes.status,
        message: `Wealth Symphony portfolio update failed (HTTP ${putRes.status}) — fell back to ${
          embedded ? 'postMessage' : 'local preview'
        }`,
      };
    }

    const updatedPortfolio = (await putRes.json()) as WealthSymphonyPortfolio;

    // 4. Optional GET → merge notes & integer-safe investableAssets → PUT /api/v1/profile
    let updatedProfile: WealthSymphonyProfile | undefined;
    let profileUpdated = false;
    if (updateProfile) {
      try {
        const profGetRes = await fetchWithTimeout(
          `${baseUrl}/api/v1/profile`,
          { method: 'GET', headers: buildHeaders(token) },
          timeoutMs
        );
        const existingProfile: WealthSymphonyProfile | null = profGetRes.ok
          ? ((await profGetRes.json()) as WealthSymphonyProfile)
          : null;

        const profilePatch = buildProfileUpdateBody(existingProfile, payload, merged.totalValue);
        const profPutRes = await fetchWithTimeout(
          `${baseUrl}/api/v1/profile`,
          {
            method: 'PUT',
            headers: buildHeaders(token),
            body: JSON.stringify(profilePatch),
          },
          timeoutMs
        );
        if (profPutRes.ok) {
          updatedProfile = (await profPutRes.json()) as WealthSymphonyProfile;
          profileUpdated = true;
        }
      } catch {
        // Profile sync is best-effort once portfolio upsert succeeds
      }
    }

    return {
      ok: true,
      mode: 'wealth-symphony-live',
      payload,
      portfolio: updatedPortfolio,
      profile: updatedProfile,
      profileUpdated,
      httpStatus: putRes.status,
      message: `Synced ${payload.symbol} to Wealth Symphony Plan (${merged.holdings.length} holding${
        merged.holdings.length === 1 ? '' : 's'
      }${profileUpdated ? ' + SR 11-7 profile note' : ''})`,
    };
  } catch {
    return {
      ok: true,
      mode: embedded ? 'embed-postmessage' : 'local-preview',
      payload,
      message: embedded
        ? `Wealth Symphony API unreachable — delivered ${payload.symbol} via postMessage bridge`
        : `Wealth Symphony API unreachable — prepared ${payload.symbol} local preview payload`,
    };
  }
}
