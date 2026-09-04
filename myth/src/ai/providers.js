// Free AI provider presets — all open-source-model hosts with an OpenAI-compatible
// API, a genuinely free tier (no credit card), and CORS enabled so the browser can
// call them directly. Users pick one in Settings → AI brain, paste a free key, done.

import { AI_ENDPOINT } from '../config/env';

export const PROVIDERS = [
  {
    id: 'llm7',
    label: 'LLM7 — free, no signup, no key (default)',
    endpoint: 'https://api.llm7.io/v1',
    keyUrl: 'https://token.llm7.io',
    needsKey: false,
    defaultModel: 'gpt-oss:20b',
    note: 'Works instantly — no account, no API key. An optional free token from token.llm7.io raises rate limits.',
    // Keep only the anonymous free-tier chat models.
    mapModels: (models) => models.filter((m) => /^(gpt-oss|gemma4|minimax|mistral-Nemo)/i.test(m)),
    fallbackModels: ['gpt-oss:20b', 'gemma4:31b', 'minimax-m2.7', 'mistral-Nemo-Instruct-2407'],
  },
  {
    id: 'groq',
    label: 'Groq Cloud — free & very fast (recommended)',
    endpoint: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    needsKey: true,
    defaultModel: 'llama-3.3-70b-versatile',
    note: 'Free tier, no credit card. Runs open models (Llama 3.3 70B, GPT-OSS…) at ~300 tokens/sec.',
    // Hide non-chat models (whisper audio, TTS, guard/moderation models).
    mapModels: (models) => models.filter((m) => !/whisper|tts|guard|embed|moderation|allam/i.test(m)),
    fallbackModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter — many free models',
    endpoint: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys',
    needsKey: true,
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    note: 'Free tier, no credit card. Only models tagged ":free" cost nothing — the list below is already filtered to those (includes NVIDIA Nemotron & OpenAI gpt-oss).',
    mapModels: (models) => models.filter((m) => m.endsWith(':free') && !/safety|content-safety|-vl/i.test(m)),
    fallbackModels: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'openai/gpt-oss-20b:free',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini — free tier',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsKey: true,
    defaultModel: 'gemini-2.5-flash',
    note: 'Free tier from Google AI Studio, no credit card. Not open-source, but free to use.',
    mapModels: (models) =>
      models
        .map((m) => m.replace(/^models\//, ''))
        .filter((m) => /^gemini-\d/.test(m) && !/embedding|tts|image|audio|live|thinking/i.test(m)),
    fallbackModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  },
  {
    id: 'ollama',
    label: 'Ollama — local on this device',
    endpoint: 'http://localhost:11434/v1',
    keyUrl: null,
    needsKey: false,
    defaultModel: '',
    note: 'Fully private and offline, but only reachable on the machine where Ollama runs — it cannot power a deployed app for other devices.',
    mapModels: (models) => models,
    fallbackModels: [],
  },
];

/** Find the preset matching an endpoint; null → custom/unknown endpoint. */
export function providerFor(endpoint) {
  const e = (endpoint || AI_ENDPOINT).replace(/\/$/, '');
  return (
    PROVIDERS.find((p) => e === p.endpoint || e.startsWith(p.endpoint)) ??
    (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(e) ? PROVIDERS.find((p) => p.id === 'ollama') : null)
  );
}

/** True when the endpoint is on this machine (local Ollama / LM Studio…). */
export function isLocalEndpoint(endpoint) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(endpoint || AI_ENDPOINT);
}
