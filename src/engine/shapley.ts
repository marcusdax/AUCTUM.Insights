import type { DOEResult, ShapleyAttribution, UnderwritingMetrics } from './types';

/**
 * Exact 3-player cooperative game Shapley attribution across:
 *  - NADE (anomaly & DOE debt-coverage resilience)
 *  - GIE  (spatial / location accessibility score)
 *  - BNE  (behavioral demand, occupancy cushion & yield)
 *
 * Mirrors MASTERNEX.os `masternex/auctum/insights.py` so offline local
 * computation matches the server-side DTA basis-point engine exactly.
 */
export function computeLocalShapley(
  m: UnderwritingMetrics,
  doe: DOEResult,
  locationScore: number,
  lat: number,
  lng: number
): ShapleyAttribution {
  const yieldScore = Math.min(100, Math.max(0, m.capRate * 12));
  const dscrScore = Math.min(100, Math.max(0, m.dscr * 65));
  const doeResilience = Math.min(100, Math.max(0, doe.minDscr * 70));
  const occCushion = Math.min(100, Math.max(0, (1 - m.vacancyPct) * 100));

  const nadeS = (doeResilience + dscrScore) / 200;
  const gieS = Math.min(100, Math.max(0, locationScore)) / 100;
  const bneS = (occCushion + yieldScore) / 200;

  const val = (coalition: Set<string>): number => {
    let tot = 0;
    if (coalition.has('NADE')) tot += 0.4 * nadeS;
    if (coalition.has('GIE')) tot += 0.3 * gieS;
    if (coalition.has('BNE')) tot += 0.3 * bneS;
    if (coalition.has('NADE') && coalition.has('GIE')) tot += 0.05 * nadeS * gieS;
    if (coalition.has('GIE') && coalition.has('BNE')) tot += 0.05 * gieS * bneS;
    return tot;
  };

  const players = ['NADE', 'GIE', 'BNE'] as const;
  const perms: (typeof players[number])[][]= [
    ['NADE', 'GIE', 'BNE'],
    ['NADE', 'BNE', 'GIE'],
    ['GIE', 'NADE', 'BNE'],
    ['GIE', 'BNE', 'NADE'],
    ['BNE', 'NADE', 'GIE'],
    ['BNE', 'GIE', 'NADE'],
  ];

  const phi: Record<string, number> = { NADE: 0, GIE: 0, BNE: 0 };
  for (const perm of perms) {
    const s = new Set<string>();
    for (const player of perm) {
      const before = val(s);
      s.add(player);
      const after = val(s);
      phi[player] += (after - before) / perms.length;
    }
  }

  const total = Math.max(1e-9, phi.NADE + phi.GIE + phi.BNE);
  const rawNade = Math.round((phi.NADE / total) * 10000);
  const rawGie = Math.round((phi.GIE / total) * 10000);
  // Guarantee exact sum to 10,000 bps
  const rawBne = 10000 - rawNade - rawGie;

  const hexQ = Math.round(lat * 100);
  const hexR = Math.round(lng * 100);
  const hexCell = `h3-r10:${hexQ}:${hexR}`;

  // Deterministic lightweight preview digest (non-cryptographic fallback when offline)
  const payload = `${hexCell}|${m.capRate.toFixed(2)}|${m.dscr.toFixed(3)}|${rawNade}|${rawGie}|${rawBne}`;
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const digest =
    ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).repeat(2);

  return {
    source: 'local-exact-shapley',
    nadeBps: rawNade,
    gieBps: rawGie,
    bneBps: rawBne,
    compositeScore: Number((total * 100).toFixed(1)),
    hexCell,
    packetId: `local-preview-${digest.slice(0, 12)}`,
    signatureAlg: 'Local Preview (Connect MASTERNEX.os for ML-DSA-87)',
    signatureVerified: false,
    ledgerVerified: false,
    digest,
  };
}
