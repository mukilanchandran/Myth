// Shared auth for the Netlify cloud functions.
//
// Myth has no user accounts: the app is a personal tool. Access to the cloud
// copy is guarded by a *sync key* — a long passphrase you set once as the
// MYTH_SYNC_KEY environment variable in Netlify and paste into the app on each
// device. The key never ships in the built bundle (it is not a VITE_* value);
// it lives only in Netlify's env and in the browser's local settings.
//
// Several people can share one site: put several keys in MYTH_SYNC_KEY
// separated by commas. Every key gets its own private namespace in the store,
// derived from a hash of the key, so one key can never see another's data.
import { createHash, timingSafeEqual } from 'node:crypto';

export const MIN_KEY_LENGTH = 12;

/** All keys accepted by this site, from the MYTH_SYNC_KEY env var. */
export function syncKeys() {
  return (process.env.MYTH_SYNC_KEY ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length >= MIN_KEY_LENGTH);
}

/** Stable private namespace for a key — never store the key itself. */
export const namespaceFor = (key) => createHash('sha256').update(key).digest('hex').slice(0, 24);

/** Short stable id for a push endpoint URL. */
export const endpointId = (endpoint) => createHash('sha1').update(endpoint).digest('hex').slice(0, 20);

const same = (a, b) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/**
 * Resolve the request's bearer key to a namespace.
 * Returns { ns } on success, or { error, status } describing why not.
 */
export function authorize(req) {
  const keys = syncKeys();
  if (!keys.length) {
    return {
      status: 503,
      error: `Cloud storage is not set up on this site yet — add a MYTH_SYNC_KEY environment variable (at least ${MIN_KEY_LENGTH} characters) in Netlify and redeploy.`,
    };
  }
  const header = req.headers.get('authorization') ?? '';
  const presented = header.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return { status: 401, error: 'Missing sync key' };
  for (const key of keys) {
    if (same(key, presented)) return { ns: namespaceFor(key) };
  }
  return { status: 401, error: 'Sync key does not match the one set in Netlify' };
}

// The app may run on another origin (Vite dev server, Docker, GitHub Pages)
// and point at this site as its cloud — allow that. Auth is the bearer key,
// not the origin, so a permissive CORS policy gives nothing away.
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-max-age': '86400',
};
