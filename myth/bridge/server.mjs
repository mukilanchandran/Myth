#!/usr/bin/env node
// Myth Bridge — turns Myth into a personal data layer.
//
// A tiny local HTTP server (Node ≥ 20, zero dependencies) that
//   • keeps the app's last export as a read-only snapshot (GET /tasks, /projects, /calendar, …)
//   • holds a queue of items produced by external agents (POST /capture, /tasks, /memory)
//     that the app pulls into its Life Inbox — nothing executes without a human approving it
//   • delivers webhooks (snapshot.updated, capture.created, task.created, memory.created)
//
// Env: MYTH_BRIDGE_PORT (8787)  MYTH_BRIDGE_HOST (127.0.0.1)  MYTH_BRIDGE_KEY (optional auth)
//      MYTH_BRIDGE_DATA (./data)  MYTH_BRIDGE_MAX_SNAPSHOT (bytes, default 32 MB)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.MYTH_BRIDGE_DATA || path.join(HERE, 'data');
const PORT = Number(process.env.MYTH_BRIDGE_PORT || 8787);
const HOST = process.env.MYTH_BRIDGE_HOST || '127.0.0.1';
const KEY = process.env.MYTH_BRIDGE_KEY || '';
const MAX_BODY = 2 * 1024 * 1024; // 2 MB for normal requests
const MAX_SNAPSHOT = Number(process.env.MYTH_BRIDGE_MAX_SNAPSHOT || 32 * 1024 * 1024);
const WEBHOOK_TIMEOUT = 5000;
const VERSION = readVersion();
const EVENTS = ['snapshot.updated', 'capture.created', 'task.created', 'memory.created'];
const MEMORY_KINDS = ['preference', 'fact', 'person', 'procedure', 'episode'];

const FILES = {
  snapshot: path.join(DATA_DIR, 'snapshot.json'),
  queue: path.join(DATA_DIR, 'queue.json'),
  webhooks: path.join(DATA_DIR, 'webhooks.json'),
  memory: path.join(DATA_DIR, 'memory.json'),
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version || '1.0.0'; }
  catch { return '1.0.0'; }
}
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomBytes(6).toString('hex') + Date.now().toString(36);
const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date (YYYY-MM-DD) of a Date. */
function localDate(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(dateStr, n) { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return localDate(d); }
/** Normalise any date-ish input to YYYY-MM-DD, or null when it cannot be parsed. */
function toDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : localDate(d);
}
const lower = (s) => String(s ?? '').toLowerCase();
const stripHtml = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const str = (v, max = 60) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') console.error(`[bridge] could not read ${path.basename(file)}: ${e.message}`);
    return fallback;
  }
}
/** Atomic write: temp file + rename so a crash never leaves a half-written JSON. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Myth-Key',
    'Access-Control-Expose-Headers': 'X-Myth-Version',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function send(res, status, body, extra = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    'X-Myth-Version': VERSION,
    ...corsHeaders(res.req),
    ...extra,
  });
  res.end(json);
}
function parseBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `Body larger than ${Math.round(limit / 1024 / 1024)} MB`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}
function requireString(body, key, { max = 4000 } = {}) {
  const v = body?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `"${key}" (string) is required`);
  return v.trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// state (loaded once, persisted on every change)
// ---------------------------------------------------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });
const state = {
  snapshot: readJson(FILES.snapshot, null),
  queue: readJson(FILES.queue, []),
  webhooks: readJson(FILES.webhooks, []),
  memory: readJson(FILES.memory, []),
};
if (!Array.isArray(state.queue)) state.queue = [];
if (!Array.isArray(state.webhooks)) state.webhooks = [];
if (!Array.isArray(state.memory)) state.memory = [];
const saveQueue = () => writeJson(FILES.queue, state.queue);
const saveWebhooks = () => writeJson(FILES.webhooks, state.webhooks);
const saveMemory = () => writeJson(FILES.memory, state.memory);

const data = () => state.snapshot?.data ?? {};
const col = (name) => (Array.isArray(data()[name]) ? data()[name] : []);
const NO_SNAPSHOT_HINT = 'No snapshot yet — open Myth → Settings → Bridge → "Sync now" to publish your data here.';
const hintFor = () => (state.snapshot ? undefined : NO_SNAPSHOT_HINT);
function snapshotCounts(d = data()) {
  const out = {};
  for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) out[k] = v.length;
  return out;
}

/** Drop base64 / inline blobs from a list of records (drive items, file meta). */
function stripBlobs(list) {
  return list.map((item) => {
    const clean = {};
    for (const [k, v] of Object.entries(item ?? {})) {
      if (typeof v === 'string' && (v.startsWith('data:') || v.length > 8192)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && ['data', 'blob', 'buffer', 'bytes'].includes(k)) continue;
      clean[k] = v;
    }
    return clean;
  });
}
function normaliseSnapshot(input) {
  const payload = input?.snapshot ?? input;
  const d = payload?.data ?? payload;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'Expected { snapshot: <exportEverything() payload> }');
  const clean = { ...d };
  delete clean.chat;
  delete clean.chatHistory;
  delete clean.authed;
  if (Array.isArray(clean.drive)) clean.drive = stripBlobs(clean.drive);
  if (Array.isArray(clean.files)) clean.files = stripBlobs(clean.files);
  if (clean.settings && typeof clean.settings === 'object') {
    // never keep secrets the app may have exported
    clean.settings = { ...clean.settings };
    delete clean.settings.aiKey;
    delete clean.settings.bridgeKey;
  }
  return {
    app: payload.app ?? 'myth',
    version: payload.version ?? null,
    exportedAt: payload.exportedAt ?? null,
    receivedAt: nowIso(),
    data: clean,
  };
}

// ---------------------------------------------------------------------------
// webhooks
// ---------------------------------------------------------------------------
function sign(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}
function fire(event, payload, targets = state.webhooks.filter((w) => w.active !== false && (w.events.includes('*') || w.events.includes(event)))) {
  if (!targets.length) return;
  const at = nowIso();
  const body = JSON.stringify({ event, at, data: payload });
  for (const hook of targets) {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': `myth-bridge/${VERSION}`,
      'X-Myth-Event': event,
      'X-Myth-Delivery': uid(),
    };
    if (hook.secret) headers['X-Myth-Signature'] = sign(hook.secret, body);
    // fire-and-forget — the HTTP response is never blocked by a slow subscriber
    fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT) })
      .then((r) => {
        hook.deliveries = (hook.deliveries ?? 0) + 1;
        hook.lastStatus = r.status;
        hook.lastAt = nowIso();
        hook.lastError = r.ok ? null : `responded ${r.status}`;
        if (!r.ok) { hook.failures = (hook.failures ?? 0) + 1; console.error(`[webhook] ${event} → ${hook.url} responded ${r.status}`); }
      })
      .catch((e) => {
        hook.deliveries = (hook.deliveries ?? 0) + 1;
        hook.failures = (hook.failures ?? 0) + 1;
        hook.lastStatus = 0;
        hook.lastAt = nowIso();
        hook.lastError = e.name === 'TimeoutError' ? `timeout after ${WEBHOOK_TIMEOUT} ms` : (e.cause?.message || e.message);
        console.error(`[webhook] ${event} → ${hook.url} failed: ${hook.lastError}`);
      })
      .finally(() => { try { saveWebhooks(); } catch (e) { console.error(`[webhook] could not persist stats: ${e.message}`); } });
  }
}
const publicHook = ({ secret, ...w }) => ({ ...w, hasSecret: Boolean(secret) });

// ---------------------------------------------------------------------------
// queue (items waiting for the app to pull)
// ---------------------------------------------------------------------------
function enqueue(item) {
  const it = { id: uid(), at: nowIso(), ...item };
  state.queue.push(it);
  if (state.queue.length > 2000) state.queue = state.queue.slice(-2000);
  saveQueue();
  return it;
}
/**
 * Text the app's capture parser understands: it reads "urgent" / "low priority" as
 * priority, "by <date>" as the due date and an existing project name as the project.
 */
function taskText({ title, due, priority, project }) {
  let t = title;
  if (project) t += ` project ${project}`;
  if (priority >= 4) t += ' urgent';
  else if (priority <= 2) t += ' low priority';
  if (due) t += ` by ${due}`;
  return t;
}

// ---------------------------------------------------------------------------
// snapshot readers
// ---------------------------------------------------------------------------
function projectName(id) { return col('projects').find((p) => p.id === id)?.name ?? null; }
function personName(id) { return col('people').find((p) => p.id === id)?.name ?? null; }
function findProject(q) {
  const s = lower(q).trim();
  if (!s) return null;
  return col('projects').find((p) => lower(p.name) === s) ?? col('projects').find((p) => lower(p.name).includes(s)) ?? null;
}
const withProject = (t) => ({ ...t, project: t.projectId ? projectName(t.projectId) : null });
const withPeople = (x) => ({ ...x, people: (x.personIds ?? []).map(personName).filter(Boolean) });
const byDue = (a, b) => `${a.due ?? '9999'}`.localeCompare(`${b.due ?? '9999'}`) || (b.priority ?? 3) - (a.priority ?? 3);

function listTasks({ status = 'open', project } = {}) {
  let tasks = col('tasks');
  if (status === 'open') tasks = tasks.filter((t) => t.status !== 'done');
  else if (status === 'done') tasks = tasks.filter((t) => t.status === 'done');
  else if (status !== 'all') tasks = tasks.filter((t) => t.status === status);
  if (project) {
    const p = findProject(project);
    tasks = p ? tasks.filter((t) => t.projectId === p.id) : [];
  }
  const today = localDate();
  return tasks.map((t) => ({ ...withProject(withPeople(t)), overdue: Boolean(t.due && t.status !== 'done' && t.due < today) })).sort(byDue);
}

function listProjects() {
  const tasks = col('tasks');
  const today = localDate();
  return col('projects').map((p) => {
    const mine = tasks.filter((t) => t.projectId === p.id);
    const open = mine.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => t.due && t.due < today);
    const milestones = p.milestones ?? [];
    return {
      ...withPeople(p),
      goal: p.goalId ? col('goals').find((g) => g.id === p.goalId)?.title ?? null : null,
      tasks: { total: mine.length, open: open.length, done: mine.length - open.length, overdue: overdue.length },
      milestones: { total: milestones.length, done: milestones.filter((m) => m.done).length, next: milestones.find((m) => !m.done) ?? null, list: milestones },
      pct: mine.length ? Math.round(((mine.length - open.length) / mine.length) * 100) : 0,
    };
  });
}

function calendar({ from, to } = {}) {
  const start = toDate(from) ?? localDate();
  const end = toDate(to) ?? addDays(start, 14);
  const inRange = (d) => Boolean(d) && d >= start && d <= end;
  const events = [];
  for (const ev of col('events')) {
    if (!ev.date) continue;
    if (ev.yearly) {
      const mmdd = ev.date.slice(5);
      for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
        const d = `${y}-${mmdd}`;
        if (inRange(d)) events.push({ ...withPeople(ev), date: d, occurrence: true });
      }
    } else if (inRange(ev.date)) events.push(withPeople(ev));
  }
  const meetings = col('notes')
    .filter((n) => n.type === 'meeting' && inRange(n.meeting?.date))
    .map((n) => ({
      id: n.id, title: n.title, date: n.meeting.date, time: n.meeting.time ?? null,
      participants: n.meeting.participants ?? '', agenda: n.meeting.agenda ?? '', outcome: n.meeting.outcome ?? '',
      decisions: n.meeting.decisions ?? [], actionItems: n.meeting.actionItems ?? [],
      project: n.projectId ? projectName(n.projectId) : null, people: (n.personIds ?? []).map(personName).filter(Boolean),
    }));
  const schedule = data().schedule && typeof data().schedule === 'object' ? data().schedule : {};
  const blocks = Object.entries(schedule)
    .filter(([date]) => inRange(date))
    .flatMap(([date, list]) => (Array.isArray(list) ? list : []).map((b) => ({ ...b, date })));
  const dueTasks = col('tasks').filter((t) => t.status !== 'done' && inRange(t.due)).map(withProject);
  const key = (x) => `${x.date} ${x.time ?? '99:99'}`;
  const agenda = [
    ...events.map((e) => ({ type: e.kind === 'meeting' ? 'meeting' : 'event', date: e.date, time: e.time ?? null, title: e.title, id: e.id })),
    ...meetings.map((m) => ({ type: 'meeting-note', date: m.date, time: m.time, title: m.title, id: m.id })),
    ...blocks.map((b) => ({ type: `block:${b.kind}`, date: b.date, time: b.start, end: b.end, title: b.title, id: b.id })),
    ...dueTasks.map((t) => ({ type: 'task-due', date: t.due, time: null, title: t.title, id: t.id })),
  ].sort((a, b) => key(a).localeCompare(key(b)));
  return { from: start, to: end, events, meetings, blocks, dueTasks, agenda };
}

function listPeople() {
  const commitments = col('commitments');
  const interactions = col('interactions');
  const tasks = col('tasks');
  return col('people').map((p) => ({
    ...p,
    openCommitments: commitments.filter((c) => c.personId === p.id && c.status === 'open').length,
    interactions: interactions.filter((i) => i.personId === p.id).length,
    openTasks: tasks.filter((t) => t.status !== 'done' && (t.personIds ?? []).includes(p.id)).length,
    projects: col('projects').filter((pr) => (pr.personIds ?? []).includes(p.id)).map((pr) => pr.name),
  })).sort((a, b) => lower(a.name).localeCompare(lower(b.name)));
}

function listCommitments({ status = 'open' } = {}) {
  const today = localDate();
  let list = col('commitments');
  if (status !== 'all') list = list.filter((c) => c.status === status);
  return list.map((c) => ({
    ...c,
    person: c.personName || (c.personId ? personName(c.personId) : null),
    overdue: Boolean(c.due && c.status === 'open' && c.due < today),
    days: c.due ? Math.round((new Date(`${c.due}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null,
  })).sort(byDue);
}

function listGoals() {
  return col('goals').map((g) => {
    const projects = col('projects').filter((p) => p.goalId === g.id);
    const tasks = col('tasks').filter((t) => t.goalId === g.id);
    const krs = g.keyResults ?? [];
    return {
      ...g,
      projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status })),
      tasks: { total: tasks.length, open: tasks.filter((t) => t.status !== 'done').length },
      keyResults: krs,
      pct: krs.length ? Math.round((krs.filter((k) => k.done).length / krs.length) * 100) : null,
    };
  });
}

function listNotes({ type } = {}) {
  let notes = col('notes');
  if (type && type !== 'all') notes = notes.filter((n) => n.type === type);
  return notes
    .map((n) => ({ ...withPeople(n), project: n.projectId ? projectName(n.projectId) : null, text: stripHtml(n.body).slice(0, 2000) }))
    .sort((a, b) => `${b.pinned ? 1 : 0}${b.created ?? ''}`.localeCompare(`${a.pinned ? 1 : 0}${a.created ?? ''}`));
}

function search(q) {
  const s = lower(q).trim();
  if (!s) throw new HttpError(400, '"q" is required');
  const has = (...fields) => fields.some((f) => lower(f).includes(s));
  const take = (list) => list.slice(0, 25);
  const results = {
    tasks: take(col('tasks').filter((t) => has(t.title, t.desc, ...(t.tags ?? []))).map(withProject)),
    projects: take(col('projects').filter((p) => has(p.name, p.desc))),
    notes: take(col('notes').filter((n) => has(n.title, stripHtml(n.body))).map((n) => ({ id: n.id, title: n.title, type: n.type, project: n.projectId ? projectName(n.projectId) : null, text: stripHtml(n.body).slice(0, 400) }))),
    people: take(col('people').filter((p) => has(p.name, ...(p.aliases ?? []), ...(p.tags ?? [])))),
    events: take(col('events').filter((e) => has(e.title, e.location))),
    goals: take(col('goals').filter((g) => has(g.title, g.why))),
    commitments: take(col('commitments').filter((c) => has(c.text, c.personName))),
    memories: take(col('memories').filter((m) => has(m.text))),
    learning: take(col('learning').filter((l) => has(l.title, l.summary))),
    habits: take(col('habits').filter((h) => has(h.name))),
    reminders: take(col('reminders').filter((r) => !r.done && has(r.title, r.note))),
    moments: take(col('moments').filter((m) => has(m.title, m.note))),
    routines: take(col('routines').filter((r) => has(r.name, ...(r.steps ?? []).map((st) => st.text)))),
  };
  const total = Object.values(results).reduce((n, l) => n + l.length, 0);
  const out = { q, total, results };
  const project = findProject(s);
  if (project) {
    out.project = {
      ...listProjects().find((p) => p.id === project.id),
      openTasks: listTasks({ status: 'open', project: project.name }),
      notes: col('notes').filter((n) => n.projectId === project.id).map((n) => ({ id: n.id, title: n.title, type: n.type, text: stripHtml(n.body).slice(0, 400) })),
      people: (project.personIds ?? []).map(personName).filter(Boolean),
      commitments: listCommitments({ status: 'open' }).filter((c) => lower(c.text).includes(lower(project.name))),
    };
  }
  const person = col('people').find((p) => lower(p.name).includes(s) || (p.aliases ?? []).some((a) => lower(a) === s));
  if (person) {
    out.person = {
      ...listPeople().find((p) => p.id === person.id),
      openCommitments: listCommitments({ status: 'open' }).filter((c) => c.personId === person.id),
      openTasks: listTasks({ status: 'open' }).filter((t) => (t.personIds ?? []).includes(person.id)),
      recentInteractions: col('interactions').filter((i) => i.personId === person.id).sort((a, b) => `${b.date}`.localeCompare(`${a.date}`)).slice(0, 10),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ method, pattern, rx, keys, handler, opts });
}
const withHint = (obj) => (hintFor() ? { ...obj, hint: hintFor() } : obj);

route('GET', '/health', () => ({
  ok: true, app: 'myth-bridge', version: VERSION, at: nowIso(),
  snapshotAt: state.snapshot?.receivedAt ?? null, exportedAt: state.snapshot?.exportedAt ?? null,
  counts: state.snapshot ? snapshotCounts() : null,
  queue: state.queue.length, webhooks: state.webhooks.length, memory: state.memory.length,
  auth: Boolean(KEY),
}));

route('POST', '/sync', ({ body }) => {
  state.snapshot = normaliseSnapshot(body);
  writeJson(FILES.snapshot, state.snapshot);
  const counts = snapshotCounts();
  fire('snapshot.updated', { receivedAt: state.snapshot.receivedAt, exportedAt: state.snapshot.exportedAt, counts });
  return { ok: true, receivedAt: state.snapshot.receivedAt, counts, bytes: Buffer.byteLength(JSON.stringify(state.snapshot)) };
}, { limit: MAX_SNAPSHOT });

route('GET', '/snapshot', () => {
  if (!state.snapshot) throw new HttpError(404, NO_SNAPSHOT_HINT);
  return state.snapshot.data;
});

route('GET', '/tasks', ({ query }) => {
  const status = query.get('status') || 'open';
  const project = query.get('project') || null;
  return withHint({ status, project, tasks: listTasks({ status, project: project ?? undefined }) });
});
route('GET', '/projects', () => withHint({ projects: listProjects() }));
route('GET', '/calendar', ({ query }) => withHint(calendar({ from: query.get('from'), to: query.get('to') })));
route('GET', '/people', () => withHint({ people: listPeople() }));
route('GET', '/commitments', ({ query }) => {
  const status = query.get('status') || 'open';
  return withHint({ status, commitments: listCommitments({ status }) });
});
route('GET', '/goals', () => withHint({ goals: listGoals() }));
route('GET', '/notes', ({ query }) => {
  const type = query.get('type') || 'all';
  return withHint({ type, notes: listNotes({ type }) });
});
route('GET', '/context', ({ query }) => withHint(search(query.get('q') ?? '')));

route('POST', '/capture', ({ body }) => {
  const text = requireString(body, 'text');
  const item = enqueue({ type: 'capture', text, source: str(body.source) ?? 'api', meta: body.meta && typeof body.meta === 'object' ? body.meta : undefined });
  fire('capture.created', item);
  return { ok: true, queued: state.queue.length, item };
}, { status: 201 });

route('POST', '/tasks', ({ body }) => {
  const title = requireString(body, 'title', { max: 300 });
  const due = body.due ? toDate(body.due) : null;
  if (body.due && !due) throw new HttpError(400, '"due" must be a date (YYYY-MM-DD)');
  const priority = body.priority == null ? 3 : clamp(Math.round(Number(body.priority)), 1, 5);
  if (Number.isNaN(priority)) throw new HttpError(400, '"priority" must be 1-5');
  const project = str(body.project, 80);
  const known = project ? findProject(project) : null;
  const task = { title, due, priority, project: known?.name ?? project, projectId: known?.id ?? null, projectKnown: Boolean(known) };
  const item = enqueue({ type: 'task', text: taskText(task), source: str(body.source) ?? 'api', task });
  fire('task.created', item);
  return { ok: true, queued: state.queue.length, item };
}, { status: 201 });

route('POST', '/memory', ({ body }) => {
  const text = requireString(body, 'text', { max: 2000 });
  const kind = MEMORY_KINDS.includes(body.kind) ? body.kind : 'fact';
  const item = enqueue({ type: 'memory', text, kind, source: str(body.source) ?? 'api' });
  state.memory.push({ id: item.id, text, kind, source: item.source, at: item.at });
  if (state.memory.length > 1000) state.memory = state.memory.slice(-1000);
  saveMemory();
  fire('memory.created', item);
  return { ok: true, queued: state.queue.length, item };
}, { status: 201 });
route('GET', '/memory', () => ({ count: state.memory.length, memory: state.memory }));

route('GET', '/queue', () => ({ count: state.queue.length, items: state.queue }));
route('POST', '/queue/ack', ({ body }) => {
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
  if (!ids) throw new HttpError(400, '"ids" (array) is required');
  const before = state.queue.length;
  state.queue = state.queue.filter((it) => !ids.includes(it.id));
  saveQueue();
  return { ok: true, removed: before - state.queue.length, remaining: state.queue.length };
});
route('DELETE', '/queue/:id', ({ params }) => {
  const before = state.queue.length;
  state.queue = state.queue.filter((it) => it.id !== params.id);
  if (state.queue.length === before) throw new HttpError(404, 'No such queue item');
  saveQueue();
  return { ok: true, remaining: state.queue.length };
});

route('GET', '/webhooks', () => ({ events: EVENTS, webhooks: state.webhooks.map(publicHook) }));
route('POST', '/webhooks', ({ body }) => {
  const url = requireString(body, 'url', { max: 2000 });
  let parsed;
  try { parsed = new URL(url); } catch { throw new HttpError(400, '"url" must be a valid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, '"url" must be http(s)');
  let events = ['*'];
  if (Array.isArray(body.events) && body.events.length) {
    const bad = body.events.filter((e) => e !== '*' && !EVENTS.includes(e));
    if (bad.length) throw new HttpError(400, `Unknown events: ${bad.join(', ')}. Known: ${EVENTS.join(', ')}`);
    events = [...new Set(body.events)];
  }
  const hook = { id: uid(), url, events, secret: typeof body.secret === 'string' ? body.secret : '', active: true, created: nowIso(), deliveries: 0, failures: 0, lastStatus: null, lastAt: null, lastError: null };
  state.webhooks.push(hook);
  saveWebhooks();
  return { ok: true, webhook: publicHook(hook) };
}, { status: 201 });
route('DELETE', '/webhooks/:id', ({ params }) => {
  const before = state.webhooks.length;
  state.webhooks = state.webhooks.filter((w) => w.id !== params.id);
  if (state.webhooks.length === before) throw new HttpError(404, 'No such webhook');
  saveWebhooks();
  return { ok: true, remaining: state.webhooks.length };
});
route('POST', '/webhooks/:id/test', ({ params }) => {
  const hook = state.webhooks.find((w) => w.id === params.id);
  if (!hook) throw new HttpError(404, 'No such webhook');
  fire('ping', { test: true, webhook: hook.id }, [hook]); // deliver only to this one, whatever it subscribed to
  return { ok: true, sent: `a "ping" delivery is on its way to ${hook.url}` };
});

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------
function authorised(req) {
  if (!KEY) return true;
  const header = req.headers['x-myth-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!header) return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  res.req = req;
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req)); res.end(); return; }
    if (pathname === '/') { send(res, 200, { ok: true, app: 'myth-bridge', version: VERSION, docs: 'bridge/README.md', endpoints: routes.map((r) => `${r.method} ${r.pattern}`) }); return; }
    if (pathname !== '/health' && !authorised(req)) { send(res, 401, { ok: false, error: 'Unauthorised — send X-Myth-Key: <MYTH_BRIDGE_KEY> (or Authorization: Bearer <key>)' }); return; }
    const matches = routes.filter((r) => r.rx.test(pathname));
    if (!matches.length) { send(res, 404, { ok: false, error: `No route ${req.method} ${pathname}`, hint: 'GET / lists every endpoint' }); return; }
    const match = matches.find((r) => r.method === req.method);
    if (!match) { send(res, 405, { ok: false, error: `Method ${req.method} not allowed on ${pathname}` }, { Allow: matches.map((r) => r.method).join(', ') }); return; }
    const m = pathname.match(match.rx);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await parseBody(req, match.opts.limit) : {};
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');
    const out = await match.handler({ req, params, query: url.searchParams, body });
    send(res, match.opts.status ?? 200, out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(`[bridge] ${req.method} ${pathname} crashed:`, e);
    if (!res.headersSent) send(res, status, { ok: false, error: e.message || 'Internal error' });
    else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`[bridge] port ${PORT} is already in use — set MYTH_BRIDGE_PORT to another port`);
  else console.error('[bridge] server error:', e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const records = state.snapshot ? Object.values(snapshotCounts()).reduce((a, b) => a + b, 0) : 0;
  console.log(`Myth bridge v${VERSION} listening on http://${HOST}:${PORT}`);
  console.log(`data: ${DATA_DIR} · auth: ${KEY ? 'key required' : 'open (set MYTH_BRIDGE_KEY to lock it)'}`);
  console.log(`snapshot: ${state.snapshot ? `${state.snapshot.receivedAt} (${records} records)` : 'none yet'} · queue: ${state.queue.length} · webhooks: ${state.webhooks.length}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[bridge] ${sig} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
