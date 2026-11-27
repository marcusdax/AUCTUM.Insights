export interface HFDatasetPreset {
  id: string;
  label: string;
  dataset: string;
  config: string;
  split: string;
  description: string;
}

export interface HFBenchmarkRow {
  market: string;
  metric: string;
  value: string;
  context: string;
}

export interface HFDatasetResponse {
  mode: 'hf-datasets-live' | 'curated-fallback';
  dataset: string;
  rowCount: number;
  rows: HFBenchmarkRow[];
}

export const HF_INFERENCE_MODELS = [
  'Qwen/Qwen2.5-72B-Instruct',
  'meta-llama/Llama-3.3-70B-Instruct',
  'deepseek-ai/DeepSeek-R1',
  'mistralai/Mistral-Small-24B-Instruct-2501',
] as const;

export const HF_DATASET_PRESETS: HFDatasetPreset[] = [
  {
    id: 'housing_cal',
    label: 'California Housing Benchmarks',
    dataset: 'gvlassis/california_housing',
    config: 'default',
    split: 'train',
    description: 'Median income, house age, rooms, and median property valuation benchmarks.',
  },
  {
    id: 'fin_qa',
    label: 'Financial Reasoning (FinQA / Earnings)',
    dataset: 'FinGPT/fingpt-sentiment-train',
    config: 'default',
    split: 'train',
    description: 'Open financial sentiment and credit underwriting discourse benchmarks.',
  },
  {
    id: 'smoltalk',
    label: 'SmolLM2 Curriculum (MASTERNEX Preset)',
    dataset: 'HuggingFaceTB/smoltalk',
    config: 'all',
    split: 'train',
    description: 'Aligned with MASTERNEX.os `hf_datasets.py` SmolTalk SFT connector.',
  },
];

const CURATED_HOUSING_BENCHMARKS: HFBenchmarkRow[] = [
  {
    market: 'Dallas–Fort Worth / Burleson, TX',
    metric: 'Median SFR Cap Rate',
    value: '6.45%',
    context: 'Suburban SFR 3-4BR · Rent-to-Price ~0.88% · Avg Vacancy 5.2%',
  },
  {
    market: 'Houston Inner Loop / 77004, TX',
    metric: 'Median SFR Cap Rate',
    value: '6.15%',
    context: 'Urban infill · Higher insurance & property tax load (OpEx ~34–38%)',
  },
  {
    market: 'Austin East / 78702, TX',
    metric: 'Median SFR Cap Rate',
    value: '5.40%',
    context: 'Appreciation-weighted growth corridor · Long-term rent CAGR ~3.6%',
  },
  {
    market: 'Sunbelt Institutional Benchmark',
    metric: 'Target IC DSCR Floor',
    value: '1.25x',
    context: 'Standard agency/DSCR lender covenant threshold at 6.25–6.75% debt',
  },
];

/**
 * Streams live rows from Hugging Face Datasets Server REST API
 * (https://datasets-server.huggingface.co/rows) with zero extra dependencies
 * and automatic curated fallback when offline or rate-limited.
 */
export async function fetchHFDatasetBenchmarks(
  presetId: string,
  length = 6,
  offset = 0
): Promise<HFDatasetResponse> {
  const preset = HF_DATASET_PRESETS.find((p) => p.id === presetId) ?? HF_DATASET_PRESETS[0];
  return fetchCustomHFDataset({
    dataset: preset.dataset,
    config: preset.config,
    split: preset.split,
    length,
    offset,
    description: preset.description,
  });
}

export async function fetchCustomHFDataset(params: {
  dataset: string;
  config?: string;
  split?: string;
  length?: number;
  offset?: number;
  description?: string;
}): Promise<HFDatasetResponse> {
  const dataset = params.dataset.trim() || HF_DATASET_PRESETS[0].dataset;
  const config = params.config?.trim() || 'default';
  const split = params.split?.trim() || 'train';
  const length = Math.min(25, Math.max(1, params.length ?? 6));
  const offset = Math.max(0, params.offset ?? 0);

  const qs = new URLSearchParams({
    dataset,
    config,
    split,
    offset: String(offset),
    length: String(length),
  });

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://datasets-server.huggingface.co/rows?${qs.toString()}`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HF Datasets HTTP ${res.status}`);
    const data = await res.json();
    const rawRows = Array.isArray(data.rows) ? data.rows : [];
    if (!rawRows.length) throw new Error('No rows returned');

    const rows: HFBenchmarkRow[] = rawRows
      .slice(0, length)
      .map((item: { row?: Record<string, unknown> }, i: number) => {
        const r = item.row || {};
        const keys = Object.keys(r);
        const firstVal = keys[0] ? String(r[keys[0]]).slice(0, 90) : `Row #${offset + i + 1}`;
        const secondKey = keys[1] || 'field';
        const secondVal = keys[1] ? String(r[keys[1]]).slice(0, 70) : '';
        const rest = keys
          .slice(2, 5)
          .map((k) => `${k}: ${String(r[k]).slice(0, 55)}`)
          .join(' · ');
        return {
          market: `${dataset} #${offset + i + 1}`,
          metric: `${keys[0] || 'record'}: ${firstVal}`,
          value: `${secondKey}: ${secondVal}`,
          context: rest || params.description || 'Live Hugging Face Datasets Server row',
        };
      });

    return {
      mode: 'hf-datasets-live',
      dataset,
      rowCount: rows.length,
      rows,
    };
  } catch {
    return {
      mode: 'curated-fallback',
      dataset: `${dataset} (Curated Offline Benchmark)`,
      rowCount: CURATED_HOUSING_BENCHMARKS.length,
      rows: CURATED_HOUSING_BENCHMARKS,
    };
  }
}

export function hfRowsToCSV(rows: HFBenchmarkRow[]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  return [
    'market,metric,value,context',
    ...rows.map((r) => [esc(r.market), esc(r.metric), esc(r.value), esc(r.context)].join(',')),
  ].join('\n');
}
