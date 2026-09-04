// Cloud storage & sync — Netlify Blobs, reached through the site's own
// serverless function (netlify/functions/cloud.mjs). Free on Netlify's Free
// plan; no separate account, no card. The whole platform state (tasks, notes,
// money, settings…) syncs as one JSON object; uploaded documents sync
// object-by-object. Every object travels in ≤ 4 MB parts because a Netlify
// Function can't carry more than 6 MB per request.
//
// Access is a single *sync key*: set MYTH_SYNC_KEY in Netlify's environment
// variables and paste the same value here (Settings → Cloud storage & sync).
// Same key on another device = same cloud copy.
import { getBlob, putBlob } from '../store/fileStore';

const DB_KEY = 'myth-db'; // zustand persist key — the exact JSON we back up
const PART_BYTES = 4 * 1024 * 1024;
const BACKUP_ID = 'backup';
const FILE_PREFIX = 'f_';

export const isConfigured = (settings) => !!settings.cloudKey?.trim();

/** "" = the site the app is served from (Netlify). Otherwise a Netlify site URL. */
const apiBase = (settings) => `${(settings.cloudUrl ?? '').trim().replace(/\/+$/, '')}/api/cloud`;

async function call(settings, path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${apiBase(settings)}/${path}`, {
    method,
    headers: { authorization: `Bearer ${settings.cloudKey.trim()}`, ...headers },
    body,
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  if (!res.ok) {
    let msg = `Cloud error ${res.status}`;
    if (isJson) { try { msg = (await res.json()).error ?? msg; } catch { /* keep */ } }
    throw new Error(msg);
  }
  if (raw) return res;
  if (!isJson) {
    // Vite's dev server (and any plain static host) answers with the app shell
    // instead of the function — the API only exists on Netlify.
    throw new Error(
      `No cloud API at ${apiBase(settings)}. Open the app from its Netlify address, run "npm run dev:cloud", or set "Site URL" to your Netlify address.`,
    );
  }
  return res.json();
}

/** Verify the key and fetch the cloud snapshot: { backup, files, devices, pushReady }. */
export const connect = (settings) => call(settings, 'status');

/** When was the cloud copy last updated? null → no backup yet. */
export async function cloudInfo(settings) {
  const s = await connect(settings);
  return s.backup ? { updatedAt: s.backup.updatedAt } : null;
}

// ---- objects (backup + documents), in parts ----

async function uploadObject(settings, id, blob, meta, onProgress) {
  const parts = Math.max(1, Math.ceil(blob.size / PART_BYTES));
  for (let n = 0; n < parts; n++) {
    if (parts > 1) onProgress?.(`${meta.name} — part ${n + 1} of ${parts}…`);
    await call(settings, `objects/${id}/parts/${n}`, {
      method: 'PUT',
      body: blob.slice(n * PART_BYTES, (n + 1) * PART_BYTES),
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
  return call(settings, `objects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: meta.name, type: meta.type, bytes: blob.size, parts }),
    headers: { 'content-type': 'application/json' },
  });
}

async function downloadObject(settings, id) {
  const manifest = await call(settings, `objects/${id}`);
  const chunks = [];
  for (let n = 0; n < manifest.parts; n++) {
    const res = await call(settings, `objects/${id}/parts/${n}`, { raw: true });
    chunks.push(await res.blob());
  }
  return { blob: new Blob(chunks, { type: manifest.type }), manifest };
}

/**
 * Push everything to the cloud: platform data (one object, last write wins)
 * plus any document blobs the cloud doesn't have yet.
 * onProgress(text) keeps the UI informed. Returns {files: uploadedCount}.
 */
export async function syncUp(settings, onProgress) {
  if (!isConfigured(settings)) throw new Error('Paste your sync key first');
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) throw new Error('Nothing to back up yet');

  const status = await connect(settings); // also validates the key before any upload
  onProgress?.('Backing up platform data…');
  await uploadObject(settings, BACKUP_ID, new Blob([raw], { type: 'application/json' }),
    { name: 'myth-db.json', type: 'application/json' }, onProgress);

  const metas = JSON.parse(raw)?.state?.files ?? [];
  const existing = new Set(status.files.map((f) => f.id));
  let uploaded = 0;
  for (const meta of metas) {
    const oid = FILE_PREFIX + meta.id;
    if (existing.has(oid)) continue;
    const blob = await getBlob(meta.id);
    if (!blob) continue; // meta without local blob (uploaded from another device)
    onProgress?.(`Uploading ${meta.name}…`);
    await uploadObject(settings, oid, blob,
      { name: meta.name, type: meta.type || blob.type || 'application/octet-stream' }, onProgress);
    uploaded++;
  }
  return { files: uploaded };
}

/**
 * Pull the cloud copy onto this device: download document blobs this device is
 * missing, then overwrite local platform data with the cloud JSON.
 * Destructive for local-only changes — callers must confirm with the user first.
 * Returns {files: downloadedCount}; caller reloads the page to apply state.
 */
export async function syncDown(settings, onProgress) {
  if (!isConfigured(settings)) throw new Error('Paste your sync key first');
  onProgress?.('Fetching cloud backup…');
  const status = await connect(settings);
  if (!status.backup) throw new Error('No cloud backup found yet — upload from your main device first');

  const { blob } = await downloadObject(settings, BACKUP_ID);
  const text = await blob.text();
  const data = JSON.parse(text);

  const metas = data?.state?.files ?? [];
  const inCloud = new Set(status.files.map((f) => f.id));
  let downloaded = 0;
  for (const meta of metas) {
    if (!inCloud.has(FILE_PREFIX + meta.id)) continue;
    if (await getBlob(meta.id)) continue; // already on this device
    onProgress?.(`Downloading ${meta.name}…`);
    const { blob: fileBlob } = await downloadObject(settings, FILE_PREFIX + meta.id);
    await putBlob(meta.id, fileBlob);
    downloaded++;
  }

  localStorage.setItem(DB_KEY, text);
  return { files: downloaded };
}

// ---- storage status ----

const utf8Bytes = (str) => new TextEncoder().encode(str).length;

/**
 * Usage snapshot: backup size (cloud + local copy), document count/bytes,
 * registered push devices. Netlify Blobs has no fixed free quota — usage
 * counts against the plan's monthly credits — so there are no hard limits here.
 */
export async function storageStatus(settings) {
  const s = await connect(settings);
  const localRaw = localStorage.getItem(DB_KEY);
  const fileBytes = s.files.reduce((a, f) => a + (f.bytes ?? 0), 0);
  const largestBytes = s.files.reduce((a, f) => Math.max(a, f.bytes ?? 0), 0);
  return {
    updatedAt: s.backup?.updatedAt ?? null,
    devices: s.devices,
    pushReady: s.pushReady,
    db: { cloudBytes: s.backup?.bytes ?? 0, localBytes: localRaw ? utf8Bytes(localRaw) : 0 },
    files: { count: s.files.length, bytes: fileBytes, largestBytes },
  };
}

// ---- background push subscriptions (one entry per device) ----

export function savePushSubscription(settings, subJson) {
  if (!isConfigured(settings)) throw new Error('Connect Cloud sync first');
  return call(settings, 'push', {
    method: 'PUT', body: JSON.stringify(subJson), headers: { 'content-type': 'application/json' },
  });
}

export function removePushSubscription(settings, endpoint) {
  if (!isConfigured(settings)) return Promise.resolve();
  return call(settings, `push?endpoint=${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
}

/** Ask the server to push a test notification to every device on this key. */
export const sendTestPush = (settings) => call(settings, 'push/test', { method: 'POST' });
