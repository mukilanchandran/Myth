// Object layout inside the Netlify Blobs store (store name: "myth").
//
//   <ns>/index                       JSON — everything the UI needs in one read:
//                                    { objects: { [id]: manifest }, push: { [devId]: { endpoint, sub, added } } }
//   <ns>/obj/<id>/parts/<n>          raw bytes, at most PART_BYTES each
//
// Netlify Functions cap a request/response body at 6 MB, so every object —
// the platform-data backup and each uploaded document — travels in parts.
// The manifest for an object is written into the index only after all its
// parts are in place, so a half-finished upload is never listed.
//
// One index per namespace keeps reads strongly consistent and cheap (Blobs'
// list() is only eventually consistent). Manifests are tiny; the index stays
// well under a megabyte even with hundreds of documents.
import { getStore } from '@netlify/blobs';

export const STORE_NAME = 'myth';
export const PART_BYTES = 4 * 1024 * 1024; // 4 MB: safe under the 6 MB function payload limit
export const BACKUP_ID = 'backup';          // the platform-data object
export const FILE_PREFIX = 'f_';            // document objects: f_<file id>

/** Strongly-consistent store — a device must see its own writes immediately. */
export const openStore = () => getStore({ name: STORE_NAME, consistency: 'strong' });

const emptyIndex = () => ({ objects: {}, push: {} });

export async function readIndex(store, ns) {
  const idx = await store.get(`${ns}/index`, { type: 'json' });
  return idx && typeof idx === 'object' ? { ...emptyIndex(), ...idx } : emptyIndex();
}

export const writeIndex = (store, ns, idx) => store.setJSON(`${ns}/index`, idx);

export const partKey = (ns, id, n) => `${ns}/obj/${id}/parts/${n}`;

/** Reassemble a stored object into one Buffer (null if it doesn't exist). */
export async function readObject(store, ns, id, manifest) {
  const m = manifest ?? (await readIndex(store, ns)).objects[id];
  if (!m) return null;
  const parts = [];
  for (let n = 0; n < m.parts; n++) {
    const buf = await store.get(partKey(ns, id, n), { type: 'arrayBuffer' });
    if (!buf) return null; // damaged upload
    parts.push(Buffer.from(buf));
  }
  return Buffer.concat(parts);
}

/** Remove every part of an object (manifest removal is the caller's job). */
export async function deleteParts(store, ns, id, count) {
  // Delete generously: a re-upload with fewer parts may leave stale tails behind.
  const max = Math.max(count ?? 0, 0) + 8;
  for (let n = 0; n < max; n++) await store.delete(partKey(ns, id, n));
}

/** The synced platform state ({ state, version }) or null. */
export async function readBackupState(store, ns, idx) {
  const index = idx ?? (await readIndex(store, ns));
  const m = index.objects[BACKUP_ID];
  if (!m) return null;
  const buf = await readObject(store, ns, BACKUP_ID, m);
  if (!buf) return null;
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}
