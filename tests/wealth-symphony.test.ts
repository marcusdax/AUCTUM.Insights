import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROPERTIES, calcUnderwriting } from '../src/engine/underwriting';
import {
  WEALTH_SYMPHONY_BRIDGE_SOURCE,
  WEALTH_SYMPHONY_BRIDGE_VERSION,
  appendWealthSymphonyHolding,
  buildWealthSymphonyPlanPayload,
  isInboundWealthSymphonyMessage,
  mergePortfolioHoldings,
  parcelToHoldingSymbol,
  parcelToWealthSymphonyHolding,
  parseEmbedParams,
  postToWealthSymphonyHost,
  probeWealthSymphonyHealth,
  pushParcelToWealthSymphony,
} from '../src/connectors/wealthSymphony';

const sampleParcel = DEFAULT_PROPERTIES[0];
const sampleMetrics = calcUnderwriting(sampleParcel, 'hold');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Wealth Symphony Bridge — Symbol & Payload Builders', () => {
  it('generates deterministic, sanitized RE- symbols capped at 30 chars', () => {
    const sym1 = parcelToHoldingSymbol({
      id: 'p-1',
      address: '1042 Oak Lane, Apt #4B, Austin, TX 78704',
    });
    const sym2 = parcelToHoldingSymbol({
      id: 'p-1',
      address: '1042 Oak Lane, Apt #4B, Austin, TX 78704',
    });

    expect(sym1).toBe(sym2);
    expect(sym1.startsWith('RE-')).toBe(true);
    expect(sym1.length).toBeLessThanOrEqual(30);
    expect(sym1).toMatch(/^RE-[A-Z0-9-]+$/);
    expect(sym1.endsWith('-')).toBe(false);
  });

  it('falls back to parcel id when address has no alphanumeric characters and avoids double RE- prefix', () => {
    expect(parcelToHoldingSymbol({ id: 'lot_99', address: '   !!!   ' })).toBe('RE-LOT-99');
    expect(parcelToHoldingSymbol({ id: 'p-2', address: 'RE-CUSTOM-PARCEL' })).toBe('RE-CUSTOM-PARCEL');
  });

  it('builds a valid holding and structured WealthSymphonyPlanPayload with SR 11-7 note', () => {
    const holding = parcelToWealthSymphonyHolding(sampleParcel, sampleMetrics);
    expect(holding.symbol).toBe(parcelToHoldingSymbol(sampleParcel));
    expect(holding.quantity).toBe(1);
    expect(holding.avgCost).toBe(Math.round(sampleMetrics.price));

    const payload = buildWealthSymphonyPlanPayload({
      parcel: sampleParcel,
      metrics: sampleMetrics,
      persona: 'fiduciary',
      strategy: 'hold',
      generatedAt: '2026-11-27T17:00:00.000Z',
    });

    expect(payload.source).toBe(WEALTH_SYMPHONY_BRIDGE_SOURCE);
    expect(payload.version).toBe(WEALTH_SYMPHONY_BRIDGE_VERSION);
    expect(payload.persona).toBe('fiduciary');
    expect(payload.strategy).toBe('hold');
    expect(payload.holding).toEqual(holding);
    expect(payload.metrics.dscr).toBeCloseTo(sampleMetrics.dscr, 1);
    expect(payload.profileNote).toContain('SR 11-7');
    expect(payload.profileNote).toContain(holding.symbol);
    expect(payload.profileNote).toContain('2026-11-27T17:00:00.000Z');
  });

  it('merges and deduplicates holdings while preserving existing positions and recomputing totalValue', () => {
    const merged = mergePortfolioHoldings(
      {
        totalValue: 100000,
        holdings: [
          { symbol: 'VTI', quantity: 200, avgCost: 250 },
          { symbol: 'RE-1042-OAK-LN', quantity: 1, avgCost: 300000 },
        ],
      },
      { symbol: 'RE-1042-OAK-LN', quantity: 1, avgCost: 365000 }
    );

    expect(merged.holdings).toHaveLength(2);
    expect(merged.holdings.find((h) => h.symbol === 'VTI')).toEqual({
      symbol: 'VTI',
      quantity: 200,
      avgCost: 250,
    });
    expect(merged.holdings.find((h) => h.symbol === 'RE-1042-OAK-LN')).toEqual({
      symbol: 'RE-1042-OAK-LN',
      quantity: 1,
      avgCost: 365000,
    });
    expect(merged.totalValue).toBe(415000);
  });
});

describe('Wealth Symphony Bridge — Embed Params & postMessage Validation', () => {
  it('parses ?embed=wealth-symphony&persona=fiduciary and validates wsOrigin/wsUrl', () => {
    const parsed = parseEmbedParams(
      '?embed=wealth-symphony&persona=fiduciary&wsOrigin=https://wealth.auctum.io/dashboard&wsUrl=http://127.0.0.1:3001/'
    );

    expect(parsed).toEqual({
      embed: 'wealth-symphony',
      persona: 'fiduciary',
      wsOrigin: 'https://wealth.auctum.io',
      wsUrl: 'http://127.0.0.1:3001',
    });
  });

  it('rejects invalid persona and unsafe URL schemes in parseEmbedParams', () => {
    const parsed = parseEmbedParams(
      '?embed=other&persona=unknown_role&wsOrigin=javascript:alert(1)&wsUrl=data:text/html,hi'
    );

    expect(parsed).toEqual({
      embed: null,
      persona: null,
      wsOrigin: null,
      wsUrl: null,
    });
  });

  it('validates inbound postMessage payloads and enforces allowedOrigin', () => {
    expect(
      isInboundWealthSymphonyMessage(
        { type: 'WEALTH_SYMPHONY_SET_CONFIG', payload: { accessToken: 'eyJ.abc', persona: 'fiduciary' } },
        'https://wealth.auctum.io',
        'https://wealth.auctum.io'
      )
    ).toBe(true);

    expect(
      isInboundWealthSymphonyMessage(
        { type: 'WEALTH_SYMPHONY_SET_CONFIG', payload: { accessToken: 'eyJ.abc' } },
        'https://evil.example.com',
        'https://wealth.auctum.io'
      )
    ).toBe(false);

    expect(
      isInboundWealthSymphonyMessage(
        { type: 'WEALTH_SYMPHONY_LOAD_PARCEL', payload: { address: '500 Congress Ave', price: 525000 } },
        'https://wealth.auctum.io',
        null
      )
    ).toBe(true);

    expect(
      isInboundWealthSymphonyMessage({ type: 'WEALTH_SYMPHONY_REQUEST_STATE' }, 'https://wealth.auctum.io')
    ).toBe(true);

    // Invalid shapes
    expect(isInboundWealthSymphonyMessage(null)).toBe(false);
    expect(isInboundWealthSymphonyMessage(['WEALTH_SYMPHONY_REQUEST_STATE'])).toBe(false);
    expect(isInboundWealthSymphonyMessage({ type: 'OTHER_EVENT', payload: {} })).toBe(false);
    expect(isInboundWealthSymphonyMessage({ type: 'WEALTH_SYMPHONY_SET_CONFIG', payload: null })).toBe(
      false
    );
    expect(isInboundWealthSymphonyMessage({ type: 'WEALTH_SYMPHONY_LOAD_PARCEL', payload: [] })).toBe(
      false
    );
  });

  it('posts versioned outbound messages via postToWealthSymphonyHost', () => {
    const postMessage = vi.fn();
    const sent = postToWealthSymphonyHost(
      'AUCTUM_INSIGHTS_READY',
      { embed: 'wealth-symphony', persona: 'fiduciary' },
      'https://wealth.auctum.io/app',
      { postMessage }
    );

    expect(sent).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: 'auctum-insights',
        version: '7.6',
        type: 'AUCTUM_INSIGHTS_READY',
        payload: { embed: 'wealth-symphony', persona: 'fiduciary' },
      },
      'https://wealth.auctum.io'
    );
  });
});

describe('Wealth Symphony Bridge — HTTP Client & Fallbacks', () => {
  it('probes GET /health for 200 healthy, 503 unhealthy, and network errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'unhealthy' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    vi.stubGlobal('fetch', fetchMock);

    expect(await probeWealthSymphonyHealth({ baseUrl: 'http://127.0.0.1:3001' })).toBe(true);
    expect(await probeWealthSymphonyHealth({ baseUrl: 'http://127.0.0.1:3001' })).toBe(false);
    expect(await probeWealthSymphonyHealth({ baseUrl: 'http://127.0.0.1:3001' })).toBe(false);
  });

  it('executes live GET->merge->PUT /api/v1/portfolio and integer-safe GET->PUT /api/v1/profile with Bearer JWT', async () => {
    const calls: Array<{ url: string; method: string; auth: string | null; body?: unknown }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, auth: headers.get('Authorization'), body });

      if (url.endsWith('/api/v1/portfolio') && method === 'GET') {
        return new Response(
          JSON.stringify({
            id: 'port-1',
            userId: 'user-1',
            totalValue: 50000,
            holdings: [{ symbol: 'VTI', quantity: 200, avgCost: 250 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/v1/portfolio') && method === 'PUT') {
        return new Response(JSON.stringify({ id: 'port-1', ...(body as object) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/profile') && method === 'GET') {
        return new Response(
          JSON.stringify({
            userId: 'user-1',
            investableAssets: 250000.4,
            notes: 'Existing fiduciary memo',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/v1/profile') && method === 'PUT') {
        return new Response(JSON.stringify({ userId: 'user-1', ...(body as object) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const res = await pushParcelToWealthSymphony({
      cfg: { baseUrl: 'http://127.0.0.1:3001', accessToken: 'eyJ.mock.jwt' },
      parcel: sampleParcel,
      metrics: sampleMetrics,
      persona: 'fiduciary',
      strategy: 'hold',
    });

    expect(res.ok).toBe(true);
    expect(res.mode).toBe('wealth-symphony-live');
    expect(res.profileUpdated).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.auth === 'Bearer eyJ.mock.jwt')).toBe(true);

    // Portfolio PUT merges existing VTI + new RE-* holding
    const putPortfolio = calls[1];
    expect(putPortfolio.method).toBe('PUT');
    expect(putPortfolio.url).toBe('http://127.0.0.1:3001/api/v1/portfolio');
    const putPortBody = putPortfolio.body as {
      totalValue: number;
      holdings: Array<{ symbol: string; quantity: number; avgCost: number }>;
    };
    expect(putPortBody.holdings).toHaveLength(2);
    expect(putPortBody.holdings[0].symbol).toBe('VTI');
    expect(putPortBody.holdings[1].symbol).toBe(parcelToHoldingSymbol(sampleParcel));
    expect(putPortBody.totalValue).toBe(50000 + Math.round(sampleMetrics.price));

    // Profile PUT uses Math.round integer investableAssets and appends SR 11-7 note
    const putProfile = calls[3];
    expect(putProfile.method).toBe('PUT');
    const putProfBody = putProfile.body as { investableAssets: number; notes: string };
    expect(Number.isInteger(putProfBody.investableAssets)).toBe(true);
    expect(putProfBody.notes).toContain('Existing fiduciary memo');
    expect(putProfBody.notes).toContain('SR 11-7');
  });

  it('falls back to embed-postmessage when embedded without token and emits AUCTUM_INSIGHTS_PUSH_PLAN', async () => {
    const postMessage = vi.fn();

    const res = await pushParcelToWealthSymphony({
      cfg: { baseUrl: 'http://127.0.0.1:3001' },
      parcel: sampleParcel,
      metrics: sampleMetrics,
      persona: 'fiduciary',
      strategy: 'hold',
      embedded: true,
      targetOrigin: 'https://wealth.auctum.io',
      parentWindow: { postMessage },
    });

    expect(res.ok).toBe(true);
    expect(res.mode).toBe('embed-postmessage');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      source: 'auctum-insights',
      version: '7.6',
      type: 'AUCTUM_INSIGHTS_PUSH_PLAN',
    });
    expect(postMessage.mock.calls[0][1]).toBe('https://wealth.auctum.io');
  });

  it('falls back to local-preview when no token is configured or API returns 401', async () => {
    const noTokenRes = await pushParcelToWealthSymphony({
      cfg: { baseUrl: 'http://127.0.0.1:3001' },
      parcel: sampleParcel,
      metrics: sampleMetrics,
      persona: 'pe_ic',
      strategy: 'hold',
    });
    expect(noTokenRes.ok).toBe(true);
    expect(noTokenRes.mode).toBe('local-preview');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 }))
    );

    const unauthRes = await pushParcelToWealthSymphony({
      cfg: { baseUrl: 'http://127.0.0.1:3001', accessToken: 'expired-jwt' },
      parcel: sampleParcel,
      metrics: sampleMetrics,
      persona: 'pe_ic',
      strategy: 'hold',
    });
    expect(unauthRes.mode).toBe('local-preview');
    expect(unauthRes.httpStatus).toBe(401);
  });

  it('supports appendWealthSymphonyHolding via POST /api/v1/portfolio/holdings', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'h-1', symbol: 'RE-TEST', quantity: 1, avgCost: 350000 }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const created = await appendWealthSymphonyHolding(
      { baseUrl: 'http://127.0.0.1:3001', accessToken: 'eyJ.jwt' },
      { symbol: 'RE-TEST', quantity: 1, avgCost: 350000 }
    );
    expect(created).toEqual({ id: 'h-1', symbol: 'RE-TEST', quantity: 1, avgCost: 350000 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/v1/portfolio/holdings',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
