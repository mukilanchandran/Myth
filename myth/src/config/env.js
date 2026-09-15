// Single source of truth for build-time configuration.
// Copy .env.example to .env.local and override anything you need — Vite inlines
// VITE_* values at build time, so a deployed bundle carries whatever was set
// when `npm run build` ran.

/** Product name shown in the lock screen and notifications. */
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Myth';

/**
 * Lock-screen password. This is a convenience lock, NOT security: the value ships
 * inside the JavaScript bundle and anyone can read it. Never put anything on a
 * public URL that you would mind a stranger seeing.
 */
export const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD || 'mukilx';

/**
 * Default AI endpoint (OpenAI-compatible) used when nothing is picked in
 * Settings → AI brain. LLM7 is free and needs no key. Users can override it in Settings.
 */
export const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || 'https://api.llm7.io/v1';

/** Preferred model. Empty means "auto-pick the best available one". */
export const AI_MODEL = import.meta.env.VITE_AI_MODEL || '';

/**
 * Resolve a file in public/ against the deploy base path.
 * Hardcoding "/logo.png" breaks when the app is served from a subpath
 * (e.g. a GitHub Pages project site at /myth/).
 */
export const asset = (path) => `${import.meta.env.BASE_URL}${String(path).replace(/^\//, '')}`;
