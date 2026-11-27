import type { AIProviderId, PropertyParcel } from '../engine/types';
import { HF_INFERENCE_MODELS } from './huggingface';

export interface ProviderPreset {
  id: AIProviderId;
  label: string;
  url: string;
  needsKey: boolean;
  models: string[];
}

export const PROVIDER_PRESETS: Record<AIProviderId, ProviderPreset> = {
  pollinations: {
    id: 'pollinations',
    label: 'Pollinations OSS (Free)',
    url: 'https://text.pollinations.ai/openai',
    needsKey: false,
    models: ['openai'],
  },
  quant: {
    id: 'quant',
    label: 'Quant Engine (Offline)',
    url: '',
    needsKey: false,
    models: ['deterministic-pe-v7'],
  },
  masternex: {
    id: 'masternex',
    label: 'MASTERNEX Attested BYOK',
    url: 'http://127.0.0.1:8080/v1/connectors/infer',
    needsKey: false,
    models: ['masternex-byok-router'],
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face Router',
    url: 'https://router.huggingface.co/v1/chat/completions',
    needsKey: true,
    models: [...HF_INFERENCE_MODELS],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama Local',
    url: 'http://localhost:11434/v1/chat/completions',
    needsKey: false,
    models: ['qwen3:8b', 'llama3.3'],
  },
  claude: {
    id: 'claude',
    label: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    needsKey: true,
    models: ['claude-sonnet-4-5-20250929'],
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
    needsKey: true,
    models: ['gemini-2.5-pro'],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter OSS',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    needsKey: true,
    models: ['qwen/qwen3-235b-a22b:free', 'deepseek/deepseek-r1:free'],
  },
  groq: {
    id: 'groq',
    label: 'Groq Open-Weight',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    needsKey: true,
    models: ['llama-3.3-70b-versatile'],
  },
};

export async function invokeAIProvider(params: {
  provider: AIProviderId;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  parcel: PropertyParcel;
  masternexUrl: string;
}): Promise<string> {
  const { provider, baseUrl, modelId, apiKey, systemPrompt, userPrompt, parcel, masternexUrl } = params;

  if (provider === 'pollinations') {
    const r = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId || 'openai',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Pollinations HTTP ${r.status}`);
    const d = await r.json();
    return String(d?.choices?.[0]?.message?.content || '');
  }

  if (provider === 'masternex') {
    const url = `${masternexUrl.replace(/\/$/, '')}/v1/connectors/infer`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({
        prompt: userPrompt,
        system: systemPrompt,
        platform: 'auctum.insights',
        tenant_id: 'auctum-insights',
        max_tokens: 1400,
      }),
    });
    if (!r.ok) throw new Error(`MASTERNEX HTTP ${r.status}`);
    const d = await r.json();
    return String(d?.content || d?.text || d?.output || '');
  }

  if (provider === 'claude') {
    const r = await fetch(baseUrl || PROVIDER_PRESETS.claude.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Claude HTTP ${r.status}`);
    return Array.isArray(d?.content) ? d.content.map((c: { text?: string }) => c.text || '').join('\n') : '';
  }

  if (provider === 'gemini') {
    const r = await fetch(baseUrl || PROVIDER_PRESETS.gemini.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: modelId,
        input: `${systemPrompt}\n\n${userPrompt}`,
        tools: [
          { type: 'google_search' },
          { type: 'google_maps', latitude: parcel.lat, longitude: parcel.lng },
        ],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Gemini HTTP ${r.status}`);
    return String(d?.output_text || '');
  }

  // OpenAI-compatible: Hugging Face Router, Ollama, OpenRouter, Groq
  const r = await fetch(baseUrl || PROVIDER_PRESETS[provider].url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `${provider} HTTP ${r.status}`);
  return String(d?.choices?.[0]?.message?.content || '');
}
