# AUCTUM.Insights (v7.0)

**Sovereign Real Estate Underwriting, Experimental Design, Spatial Intelligence & Fiduciary Decision Platform** — *Hallmark Dusk Edition*

Part of the **MASTERNEX.os Ecosystem** (Bucket 4 — Fiduciary & Decision Intelligence · `lora_fiduciary`). Runs **100% static / zero-backend-required** in any modern browser or GitHub Pages deployment, while seamlessly connecting to **MASTERNEX.os**, **K-Dense BYOK**, **Hugging Face Hub**, and **Google Maps Platform** when available.

## What's New in v7.0

- **5 Adaptive User Personas**: Switch instantaneously between **Institutional PE / IC**, **Broker / Acquisition**, **Fiduciary / Wealth Advisor (SR 11-7)**, **Storm & Risk Underwriter (`AUCTUM.atlas`)**, and **Retail / House-Hacker / STR** — dynamically adapting hero framing, guardrails, default strategies, and AI dossier prompts.
- **Institutional Underwriting & Target-Price Solver**: Full 10-year **Levered IRR** (Newton-Raphson solver), **Equity Multiple**, **Break-Even Occupancy %**, **Debt Yield**, **1% Rule**, **BRRRR 75% LTV Refi Recapture**, **Target-Price Solver** (exact max price for `1.25x` DSCR), **Portfolio Comparison Matrix**, full parcel CRUD, `localStorage` auto-save, and **CSV import/export**.
- **Experimental Design (`2³` DOE + Monte Carlo)**: Orthogonal 8-run `2³` factorial stress matrix with **Main Effects & 2-Way Interaction Effects** Pareto charting plus a seeded **1,000-trial Monte Carlo** simulation with **P10/P50/P90** and **95% bootstrap confidence intervals**.
- **Live Ecosystem Connectors (Graceful Offline Fallback)**:
  - **MASTERNEX.os** (`:8080`): Live `/v1/auctum/insights/underwrite` ACP-SQL sealing & `ML-DSA-87` signature verification, exact NADE/GIE/BNE Shapley bps attribution (`sum = 10,000 bps`), `/v1/auctum/fiduciary/evaluate` PII scrubber, `/v1/auctum/atlas/signal-to-dossier` storm risk, and `/v1/connectors/academic/search` (Nature, OpenAlex, arXiv, PubMed).
  - **Hugging Face**: **HF Inference Router** (`Qwen2.5-72B`, `Llama-3.3-70B`, `DeepSeek-R1`, `Mistral-Small`) + zero-dependency **HF Datasets Server** benchmark streamer (`datasets-server.huggingface.co/rows`).
  - **K-Dense BYOK** (`:8000`): Health probe + one-click `/skill:*` research prompt launcher pre-populated with active parcel JSON, 2³ DOE, and spatial audit.
  - **Google Maps Platform + Open Spatial Stack**: MapLibre GL 3D OpenFreeMap + Leaflet (Esri Satellite, OpenTopoMap, Carto Dusk) + Photon/Nominatim + Overpass POIs + zero-key Google Maps 3D / Street View / Directions links + optional BYOK Google Street View Static & Geocoding.

## Quick Start

```bash
npm install
npm run dev        # local dev server at http://localhost:4173
npm run typecheck  # strict TypeScript check
npm test           # Vitest unit test suite
npm run build      # static production bundle in dist/
```

## Repository Layout

- `index.html` — Semantic Hallmark Dusk v7.0 entry point
- `src/engine/` — Pure deterministic underwriting, 2³ DOE, Monte Carlo, Shapley, Fiduciary, Persona, and Markdown engines
- `src/connectors/` — MASTERNEX.os, Hugging Face, K-Dense BYOK, Google Maps Platform, and Multi-Provider AI router
- `src/ui/` & `src/styles/` — Vanilla CSS Hallmark Dusk design system, 7-chart Apache ECharts suite, and dual MapLibre/Leaflet map controller
- `tests/` — Vitest unit test suite
- `.github/workflows/ci-deploy.yml` — Automated CI verification + GitHub Pages static deployment
- `docs/LAUNCH_PLAYBOOK.md` — Go-to-market positioning, connector wiring, and deployment checklist
- `property_underwriting_widget.html` — Compact standalone editorial underwriting widget
- `property_insight_portfolio_analytics.ipynb` — Portfolio analytics & DOE modeling notebook
