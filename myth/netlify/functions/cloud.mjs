// Myth cloud storage API — a Netlify Function in front of Netlify Blobs.
// The browser cannot talk to Blobs directly, so this is the (only) door.
// Reached at /api/cloud/* (rewrite in netlify.toml → /.netlify/functions/cloud/*).
//
// Every request carries `Authorization: Bearer <sync key>` (see lib/auth.mjs).
//
//   GET    status                        backup manifest, document list, push device count
//   GET    objects                       all manifests
//   GET    objects/:id                   one manifest
//   PUT    objects/:id/parts/:n          upload one raw part (≤ 4 MB)
//   GET    objects/:id/parts/:n          download one raw part
//   PUT    objects/:id                   commit: { name, type, bytes, parts } after all parts are up
//   DELETE objects/:id                   remove manifest + parts
//   PUT    push                          register this device's Web Push subscription
//   DELETE push?endpoint=…               unregister a device
//   POST   push/test                     send a test notification to every device of this key
import { authorize, CORS, endpointId } from '../lib/auth.mjs';
import { openStore, readIndex, writeIndex, partKey, deleteParts, PART_BYTES, BACKUP_ID } from '../lib/store.mjs';
import { pushToNamespace, vapidReady } from '../lib/digest.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });
const fail = (error, status) => json({ error }, status);

const SAFE_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_PARTS = 2000; // 8 GB — far beyond Blobs' 5 GB object cap anyway

function statusOf(idx) {
  const backup = idx.objects[BACKUP_ID] ?? null;
  const files = Object.values(idx.objects).filter((o) => o.id !== BACKUP_ID);
  return { ok: true, backup, files, devices: Object.keys(idx.push).length, pushReady: vapidReady() };
}

/** Route one request against a store. Exported so it can be tested without Netlify. */
export async function handle(req, store) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const auth = authorize(req);
  if (!auth.ns) return fail(auth.error, auth.status);
  const { ns } = auth;

  const url = new URL(req.url);
  const path = url.pathname;
  const at = path.indexOf('/cloud/');
  const seg = (at >= 0 ? path.slice(at + '/cloud/'.length) : '').split('/').filter(Boolean).map(decodeURIComponent);
  const [head, id, sub, n] = seg;
  const m = req.method;

  try {
    if (head === 'status' && m === 'GET') {
      return json(statusOf(await readIndex(store, ns)));
    }

    if (head === 'objects') {
      if (!id) {
        if (m !== 'GET') return fail('Method not allowed', 405);
        const idx = await readIndex(store, ns);
        return json({ objects: idx.objects });
      }
      if (!SAFE_ID.test(id)) return fail('Bad object id', 400);

      if (sub === 'parts') {
        const part = Number(n);
        if (!Number.isInteger(part) || part < 0 || part >= MAX_PARTS) return fail('Bad part number', 400);
        if (m === 'PUT') {
          const body = await req.arrayBuffer();
          if (body.byteLength > PART_BYTES + 1024) return fail(`Part too large — max ${PART_BYTES} bytes`, 413);
          await store.set(partKey(ns, id, part), body);
          return json({ ok: true, bytes: body.byteLength });
        }
        if (m === 'GET') {
          const buf = await store.get(partKey(ns, id, part), { type: 'arrayBuffer' });
          if (!buf) return fail('Part not found', 404);
          return new Response(buf, { status: 200, headers: { 'content-type': 'application/octet-stream', ...CORS } });
        }
        return fail('Method not allowed', 405);
      }
      if (sub) return fail('Not found', 404);

      if (m === 'GET') {
        const idx = await readIndex(store, ns);
        return idx.objects[id] ? json(idx.objects[id]) : fail('Object not found', 404);
      }
      if (m === 'PUT') {
        const body = await req.json().catch(() => null);
        if (!body || !Number.isInteger(body.parts) || body.parts < 1 || body.parts > MAX_PARTS || !Number.isInteger(body.bytes) || body.bytes < 0) {
          return fail('Bad manifest', 400);
        }
        // Refuse to list an object whose parts never fully arrived.
        for (let i = 0; i < body.parts; i++) {
          if (!(await store.getMetadata(partKey(ns, id, i)))) return fail(`Part ${i} is missing — upload again`, 409);
        }
        const manifest = {
          id,
          name: String(body.name ?? id).slice(0, 200),
          type: String(body.type ?? 'application/octet-stream').slice(0, 100),
          bytes: body.bytes,
          parts: body.parts,
          updatedAt: new Date().toISOString(),
        };
        const idx = await readIndex(store, ns);
        const prev = idx.objects[id];
        idx.objects[id] = manifest;
        await writeIndex(store, ns, idx);
        // A shorter re-upload leaves stale tail parts from the previous version.
        if (prev && prev.parts > manifest.parts) {
          for (let i = manifest.parts; i < prev.parts; i++) await store.delete(partKey(ns, id, i));
        }
        return json(manifest);
      }
      if (m === 'DELETE') {
        const idx = await readIndex(store, ns);
        const prev = idx.objects[id];
        delete idx.objects[id];
        await writeIndex(store, ns, idx);
        await deleteParts(store, ns, id, prev?.parts);
        return json({ ok: true });
      }
      return fail('Method not allowed', 405);
    }

    if (head === 'push') {
      if (!id && m === 'PUT') {
        const subscription = await req.json().catch(() => null);
        if (!subscription?.endpoint || !subscription?.keys) return fail('Bad push subscription', 400);
        const idx = await readIndex(store, ns);
        idx.push[endpointId(subscription.endpoint)] = { endpoint: subscription.endpoint, sub: subscription, added: new Date().toISOString() };
        await writeIndex(store, ns, idx);
        return json({ ok: true, devices: Object.keys(idx.push).length });
      }
      if (!id && m === 'DELETE') {
        const endpoint = url.searchParams.get('endpoint');
        if (!endpoint) return fail('endpoint required', 400);
        const idx = await readIndex(store, ns);
        delete idx.push[endpointId(endpoint)];
        await writeIndex(store, ns, idx);
        return json({ ok: true, devices: Object.keys(idx.push).length });
      }
      if (id === 'test' && m === 'POST') {
        if (!vapidReady()) return fail('Push is not set up on this site — add the VAPID_* variables in Netlify (see PUSH-SETUP.md).', 503);
        const r = await pushToNamespace(store, ns, {
          title: 'Myth — test push',
          body: 'Background push works on this device ✓',
          tag: `myth-test-${Date.now()}`,
          url: './',
        });
        return json(r);
      }
    }

    return fail('Not found', 404);
  } catch (e) {
    console.error('cloud function error', e);
    return fail(e?.message ?? 'Server error', 500);
  }
}

export default async (req) => handle(req, openStore());
