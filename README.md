# AUCTUM.Insights

**PropertyInsight AI — Hallmark Dusk Edition**

A standalone, zero-backend-required real estate underwriting, spatial intelligence, and AI decisioning dashboard built with:

- **Hallmark Dusk UI** (`fog / periwinkle-apricot / glass`) — responsive desktop & mobile layout
- **Open-Source Spatial Stack** — MapLibre GL JS with Carto Dark / OpenTopo / Esri Satellite layers, 3D building extrusions, cap-rate heatmap, 0.5mi / 1mi / 3mi trade-area rings, and live Overpass API amenity & transit POI scanning
- **Apache ECharts Suite** — 10-year equity & cash-flow trajectory, monthly NOI-to-net waterfall, 30-night occupancy cushion, 6-pillar underwriting radar, 2³ factorial DOE stress test, and MasterNex basis-point attribution (NADE / GIE / BNE) with dynamic analytical explanations
- **Multi-Provider AI Report Studio** — Pollinations OSS (free, zero-key), Anthropic Claude, Google Gemini, Ollama / OpenAI-compatible endpoints, and deterministic Quant fallback, with Markdown-to-HTML dossier formatting for **IC Audit**, **Negotiation**, **Portfolio CMA**, and **LP Brief**
- **AG-UI 1.0 Event Stream** — live agentic telemetry and decision trace

## Quick Start

Open `index.html` directly in any browser, or serve locally:

```bash
python -m http.server 8765
```

Then visit `http://127.0.0.1:8765/`.

## Repository Contents

- `index.html` — Primary dashboard entry point (mirrors `property_insight_ai_dashboard.html`)
- `property_insight_ai_dashboard.html` — Full standalone dashboard source
- `property_underwriting_widget.html` — Compact interactive underwriting widget
- `property_insight_portfolio_analytics.ipynb` — Portfolio analytics & DOE modeling notebook
- `property_insight_architecture_pack.md` — System architecture & specification notes
