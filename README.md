# AUCTUM.Insights (v7.4)

**Sovereign Real Estate Underwriting, Experimental Design, Spatial Intelligence & Fiduciary Decision Platform** — *Hallmark Dusk & Daylight Editorial Editions*

Part of the **MASTERNEX.os Ecosystem** (Bucket 4 — Fiduciary & Decision Intelligence · `lora_fiduciary`). Runs **100% static / zero-backend-required** in any modern browser or GitHub Pages deployment, or as a **full-stack Docker Compose deployment** paired with live **MASTERNEX.os**, **K-Dense BYOK**, **Hugging Face Hub**, and **Google Maps Platform**.

## Highlights in v7.4

- **5 Adaptive User Personas**: Switch instantaneously between **Institutional PE / IC**, **Broker / Acquisition**, **Fiduciary / Wealth Advisor (SR 11-7)**, **Storm & Risk Underwriter (`AUCTUM.atlas`)**, and **Retail / House-Hacker / STR**.
- **Institutional Underwriting & Financing Studio**: 10-year **Levered IRR** (Newton-Raphson), **Equity Multiple**, **Break-Even Occupancy %**, **BRRRR 75% LTV Refi Recapture**, **Interactive Target-Price Solver** (selectable DSCR/Cap/CoC target + 1-click Apply), **2-1 Rate Buydown & Seller Credit Calculator**, **27.5-Yr Depreciation Tax Shield**, **Portfolio Comparison Matrix**, CSV import/export, **Shareable `#deal=` URLs**, and **Print/PDF Executive Tear-Sheet**.
- **8-App Scientific Apps Lab**:
  1. **Experimental Design Lab** (`/skill:experimental-design`): Live ECharts Power Curve, sample-size calculator ($\alpha$, $1-\beta$, Cohen's $d$), and 2³ orthogonal DOE main/interaction effects.
  2. **MASTERNEX Verification App** (`/skill:masternex-scientific`): 5-point honest-by-construction audit contract, live ACP-SQL / `ML-DSA-87` seal, and Auditor Pack JSON export.
  3. **Econometrics & Tail-Risk Lab** (`/skill:statistical-analysis`): Portfolio OLS scatter + fit line ($R^2$, RMSE) and 95%/99% VaR & CVaR annual cash-flow shortfall.
  4. **Geospatial & Huff Gravity App** (`/skill:geospatial-analysis`): Adjustable distance-decay ($\beta$) gravity model, H3 cell, Overpass POI scan, and `AUCTUM.atlas` storm exposure.
  5. **Scientific Writing & LaTeX Studio** (`/skill:scientific-writing`): Publication-ready `.tex` (`booktabs`) and `.md` dossiers with auto-injected bibliography.
  6. **HF Datasets Benchmark Workbench**: Stream any public Hugging Face dataset (`datasets-server.huggingface.co/rows`) with pagination, keyword filter, automatic sentiment/keyword analytics, and CSV export.
  7. **Peer-Reviewed Literature Workbench**: Live Nature / OpenAlex / arXiv search, **Cite in Paper** Bibliography Cart, and `.bib` BibTeX export.
  8. **Portfolio Capital Allocator**: Exact 0/1 budget-constrained portfolio optimizer maximizing Cash Flow, Levered IRR, or Risk-Adjusted (`DSCR × IRR`) return.
- **Global `⌘K` / `Ctrl+K` Command Palette** & **Dusk ☾ / Daylight ☀** WCAG 2.2 AA theme switcher.

## Quick Start (Local Vite)

```bash
npm install
npm run dev        # local dev server at http://localhost:4173
npm run typecheck  # strict TypeScript check
npm test           # Vitest suite (27 specs across 7 files)
npm run build      # static production bundle in dist/
```

## Full-Stack Docker Compose (AUCTUM.Insights + MASTERNEX.os)

```bash
docker compose up -d --build
# Frontend + Nginx reverse proxy: http://127.0.0.1:8088
# MASTERNEX.os API (proxied at /api/masternex): http://127.0.0.1:8080
```
