// Single source of truth for build-time configuration.
// Copy .env.example to .env.local and override anything you need — Vite inlines
// VITE_* values at build time, so a deployed bundle carries whatever was set
// when `npm run build` ran.

const bool = (v, fallback) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1');

/** Product name shown in the lock screen and notifications. */
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Myth';

/**
 * Lock-screen password. This is a convenience lock, NOT security: the value ships
 * inside the JavaScript bundle and anyone can read it. Never put anything on a
 * public URL that you would mind a stranger seeing.
 */
export const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD || 'mukilx';

/** Default AI endpoint (OpenAI-compatible). Users can override it in Settings. */
export const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || 'http://localhost:11434/v1';

/** Preferred model. Empty means "auto-pick the best installed one". */
export const AI_MODEL = import.meta.env.VITE_AI_MODEL || '';

/** Pin the model in RAM so the first question doesn't pay a cold-start penalty. */
export const AI_WARMUP = bool(import.meta.env.VITE_AI_WARMUP, true);

/**
 * Resolve a file in public/ against the deploy base path.
 * Hardcoding "/logo.png" breaks when the app is served from a subpath
 * (e.g. a GitHub Pages project site at /myth/).
 */
export const asset = (path) => `${import.meta.env.BASE_URL}${String(path).replace(/^\//, '')}`;
