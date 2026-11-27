# AUCTUM.Insights v7.0 — Launch & Ecosystem Playbook

## 1. Deployment Topology (Zero-Backend Static + Optional Sovereign Bridges)

`AUCTUM.Insights` builds to a pure static bundle (`dist/`) with relative asset paths (`base: './'`), allowing zero-friction deployment on:
- **GitHub Pages**: Enabled automatically on push to `main` via `.github/workflows/ci-deploy.yml` (Settings → Pages → Source: **GitHub Actions**).
- **Cloudflare Pages / Vercel / Netlify**: Build command `npm run build`, output directory `dist`.
- **Air-Gapped / Local Desktop**: Run `npm run preview` or serve `dist/` with any static HTTP server.

## 2. Connecting Sovereign & Cloud Ecosystems

Open **AI & Connectors** in the top navigation bar:

| Connector | Default Endpoint | Key Required? | Offline Behavior |
|---|---|---|---|
| **MASTERNEX.os** | `http://127.0.0.1:8080` | Optional JWT / `X-API-Key` | Exact local Shapley bps (`10,000 bps`) + local Fiduciary PII guard + local `AUCTUM.atlas` hazard score |
| **K-Dense BYOK** | `http://127.0.0.1:8000` | None | One-click `/skill:*` clipboard handoff with full parcel JSON |
| **Hugging Face Router** | `https://router.huggingface.co/v1/chat/completions` | HF Token | Instant Quant Engine fallback |
| **Hugging Face Datasets** | `https://datasets-server.huggingface.co/rows` | None (public) | Curated Texas & Sunbelt institutional housing benchmarks |
| **Google Maps Platform** | Deep links (zero-key) / Maps APIs | Optional API Key | Zero-key 3D/StreetView/Directions links + MapLibre 3D + Esri Satellite + Overpass OSM |

## 3. Persona Go-To-Market Positioning

1. **Institutional PE / IC Analysts**: Position around verifiable `2³` DOE interaction effects, 1,000-trial Monte Carlo 95% CIs, and cryptographic `MASTERNEX.os` ACP-SQL receipts.
2. **Brokers & Acquisition Agents**: Lead with the **Target-Price Solver** (instant max offer price for `1.25x` DSCR), **Portfolio Compare CSV import**, and 1-click **Negotiation Strategy** memos.
3. **Fiduciary & Wealth Advisors**: Highlight **Education-Only SR 11-7 Compliance**, automated PII scrubbing, and break-even occupancy risk buffers.
4. **Catastrophe & Storm Underwriters**: Pair **AUCTUM.atlas** roof/hail exposure scoring with insurance shock stress testing.
5. **Retail / STR Investors**: Emphasize zero-key instant usability, 1% Rule check, 30-night occupancy cushion, and plain-English dossiers.

## 4. Launch Verification Checklist

- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm test` passes 100% of Vitest specs
- [ ] `npm run build` succeeds and produces `dist/index.html`
- [ ] Enable GitHub Pages (**GitHub Actions**) in repository Settings
- [ ] (Optional) Start `masternex serve` on `:8080` and verify live `MASTERNEX: Live` badge and `ML-DSA-87` sealed packet ID
