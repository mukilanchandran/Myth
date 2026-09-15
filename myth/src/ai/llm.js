// LLM transport — talks to any OpenAI-compatible chat API: the free cloud
// providers in providers.js, or a custom /v1 endpoint set in Settings → AI brain.

import { AI_ENDPOINT } from '../config/env';

export const DEFAULT_ENDPOINT = AI_ENDPOINT;

// Session cache so we don't probe on every keystroke.
let detected = null; // { ok: boolean, models: string[], endpoint, key, at: number }

/** Probe an endpoint and list its available models. Providers that need an API key need it here too. */
export async function detectAI(endpoint = DEFAULT_ENDPOINT, { force = false, apiKey = '' } = {}) {
  const key = apiKey || '';
  if (!force && detected && Date.now() - detected.at < 60_000 && detected.endpoint === endpoint && detected.key === key) {
    return detected;
  }
  try {
    const base = endpoint.replace(/\/$/, '');
    const res = await fetch(`${base}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const models = (data.data ?? []).map((m) => m.id);
    detected = { ok: true, models, endpoint, key, at: Date.now() };
  } catch {
    detected = { ok: false, models: [], endpoint, key, at: Date.now() };
  }
  return detected;
}

// Quality ranking for auto-selection — best general open models first.
const MODEL_RANK = [
  /gpt-5(?!-nano)/i,
  /gpt-4\.1(?!-nano|-mini)/i,
  /gpt-4o(?!-mini)/i,
  /nemotron-3-ultra/i,
  /llama[-.]?3\.3[-.]?70b/i,
  /gpt-oss-120b/i,
  /nemotron-3-super/i,
  /gemma-4-31b|gemma4[:\-]31b/i,
  /gpt-oss[:\-]?20b/i,
  /minimax/i,
  /deepseek-chat/i,
  /qwen3(?:[:\-](?!0\.6b|1\.7b))/i,
  /gemini-2\.5-flash(?!-lite)/i,
  /llama3\.1|llama-3\.1/i,
  /qwen2\.5(?::(?!0\.5b|1\.5b))/i,
  /gemma3(?::(?!1b))|gemma-3-27b/i,
  /mistral(?!-embed)/i,
  /llama3\.2|llama-3\.2/i,
  /gemini-2\.5-flash-lite/i,
  /phi/i,
];

/** Rank available models by quality; chat models only. */
export function rankModels(models) {
  const chatty = models.filter((m) => !/embed|bge|nomic|minilm|code/i.test(m));
  return [...chatty].sort((a, b) => {
    const ra = MODEL_RANK.findIndex((rx) => rx.test(a));
    const rb = MODEL_RANK.findIndex((rx) => rx.test(b));
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
}

/**
 * Pick the model to use. An explicit preference wins when available;
 * otherwise the top-ranked available model is chosen automatically.
 */
export function pickModel(preferred, models) {
  if (!models.length) return preferred || '';
  if (preferred && models.some((m) => m === preferred || m.startsWith(preferred + ':'))) {
    return models.find((m) => m === preferred) ?? models.find((m) => m.startsWith(preferred + ':'));
  }
  const ranked = rankModels(models);
  return ranked[0] ?? models[0];
}

/**
 * Streaming chat completion. Calls onToken(fullTextSoFar) as tokens arrive.
 * Returns the final text. Throws on network/HTTP errors.
 */
export async function streamChat({ endpoint, model, apiKey, messages, onToken, temperature = 0.5 }) {
  const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, temperature, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`AI endpoint returned ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line for next chunk
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, '').trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onToken?.(text);
        }
      } catch { /* partial JSON — ignored, handled by buffering */ }
    }
  }
  return text;
}
