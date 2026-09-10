// Unit tests for the auto-sync engine against a fake cloud and a fake browser.
// Covers: first device pushes, second device pulls, change → push, cloud moved
// on → pull on focus, first connection with data on both sides → conflict,
// erase propagates, URL key adoption. Run: npm test
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from 'zustand/vanilla';

// ---- fake browser ----
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
const listeners = {};
globalThis.document = { hidden: false, addEventListener: (e, f) => { (listeners[e] ??= []).push(f); }, removeEventListener: () => {} };
globalThis.window = { addEventListener: (e, f) => { (listeners[e] ??= []).push(f); }, removeEventListener: () => {}, location: { href: 'https://myth.test/?sync=summit-harbor-ember-3174&x=1', pathname: '/', search: '?x=1' }, history: { replaceState: (_, __, url) => { globalThis.window.location.href = 'https://myth.test' + url; } } };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const fire = (e) => (listeners[e] ?? []).forEach((f) => f());

const { startAutoSync, adoptKeyFromUrl, hasData } = await import('../src/cloud/autoSync.js');

// ---- fake cloud: one shared "server", devices are separate stores + localStorage snapshots ----
const server = { backup: null, updatedAt: null, calls: [] };
let clock = 0;
const fakeCloud = {
  isConfigured: (s) => !!s.cloudKey?.trim(),
  cloudInfo: async () => { server.calls.push('info'); return server.backup ? { updatedAt: server.updatedAt } : null; },
  syncUp: async () => { server.calls.push('up'); server.backup = JSON.parse(localStorage.getItem('myth-db')); server.updatedAt = `t${++clock}`; },
  fetchBackup: async () => { server.calls.push('down'); return server.backup ? { data: server.backup, updatedAt: server.updatedAt, downloaded: 0 } : null; },
};

const blank = () => ({ tasks: [], projects: [], notes: [], files: [], drive: [], habits: [], transactions: [], journal: [], plans: {}, learning: [], events: [], plannerSessions: [], chat: [], chatHistory: [], xp: { points: 0 }, notifyMuted: {}, nowLearn: null });
const makeStore = (over = {}) => createStore((set) => ({
  settings: { cloudKey: 'summit-harbor-ember-3174', cloudUrl: '', aiKey: '', name: 'Boss' }, ...blank(),
  syncState: 'off', syncConflict: null,
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  ...over,
}));
// mimic zustand persist: keep localStorage in step with the store
const persist = (store) => { const w = () => localStorage.setItem('myth-db', JSON.stringify({ state: store.getState(), version: 7 })); w(); store.subscribe(w); };
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
// a "device" = its own localStorage snapshot; switching devices swaps the snapshot in
const devices = {};
const useDevice = (name) => { mem.clear(); for (const [k, v] of Object.entries(devices[name] ?? {})) mem.set(k, v); };
const saveDevice = (name) => { devices[name] = Object.fromEntries(mem); };

let engine;
after(() => engine?.stop());
beforeEach(() => { engine?.stop(); mem.clear(); for (const k of Object.keys(devices)) delete devices[k]; server.backup = null; server.updatedAt = null; server.calls = []; });

test('hasData and URL key adoption', () => {
  const store = makeStore({ settings: { cloudKey: '' } });
  assert.equal(hasData(store.getState()), false);
  assert.equal(adoptKeyFromUrl(store), true);
  assert.equal(store.getState().settings.cloudKey, 'summit-harbor-ember-3174');
  assert.equal(globalThis.window.location.href, 'https://myth.test/?x=1');
});

test('the first device pushes; a change pushes again within the debounce', async () => {
  const laptop = makeStore({ tasks: [{ id: 't1', title: 'Pay rent' }] });
  persist(laptop);
  engine = startAutoSync(laptop, { cloud: fakeCloud });
  await tick(2700);
  assert.equal(server.backup.state.tasks.length, 1);
  assert.equal(laptop.getState().syncState, 'synced');
  laptop.setState({ tasks: [...laptop.getState().tasks, { id: 't2', title: 'Call vendor' }] });
  await tick(2700);
  assert.equal(server.backup.state.tasks.length, 2);
  saveDevice('laptop');
});

test('a fresh phone with the key pulls the laptop\'s data, and later changes flow both ways', async () => {
  // laptop seeds the cloud
  const laptop = makeStore({ tasks: [{ id: 't1', title: 'Pay rent' }], notes: [{ id: 'n1', title: 'Idea' }] });
  persist(laptop);
  engine = startAutoSync(laptop, { cloud: fakeCloud });
  await tick(2700);
  engine.stop();
  saveDevice('laptop');

  // phone: empty, same key
  useDevice('phone');
  const phone = makeStore();
  persist(phone);
  engine = startAutoSync(phone, { cloud: fakeCloud });
  await tick(100);
  assert.equal(phone.getState().tasks[0].title, 'Pay rent');
  assert.equal(phone.getState().notes.length, 1);
  assert.equal(phone.getState().syncState, 'synced');
  assert.equal(phone.getState().settings.cloudKey, 'summit-harbor-ember-3174');

  // phone adds a task → cloud
  phone.setState({ tasks: [...phone.getState().tasks, { id: 't9', title: 'Buy milk' }] });
  await tick(2700);
  assert.equal(server.backup.state.tasks.length, 2);
  engine.stop();
  saveDevice('phone');

  // laptop comes back to the front → pulls the phone's task
  useDevice('laptop');
  const laptop2 = makeStore({ tasks: [{ id: 't1', title: 'Pay rent' }], notes: [{ id: 'n1', title: 'Idea' }] });
  persist(laptop2);
  engine = startAutoSync(laptop2, { cloud: fakeCloud });
  await tick(100);
  assert.deepEqual(laptop2.getState().tasks.map((t) => t.title), ['Pay rent', 'Buy milk']);
  fire('visibilitychange');
  await tick(60);
  assert.ok(server.calls.filter((c) => c === 'info').length >= 2, 'focus re-checks the cloud');
});

test('first connection with data on both sides asks, and honours the choice', async () => {
  server.backup = { state: { ...blank(), tasks: [{ id: 'c1', title: 'Cloud task' }], settings: { cloudKey: 'summit-harbor-ember-3174', name: 'Boss' } }, version: 7 };
  server.updatedAt = 't-cloud';
  const device = makeStore({ tasks: [{ id: 'l1', title: 'Local task' }, { id: 'l2', title: 'Another' }] });
  persist(device);
  engine = startAutoSync(device, { cloud: fakeCloud });
  await tick(80);
  const c = device.getState().syncConflict;
  assert.ok(c, 'a conflict is raised');
  assert.equal(c.cloudCount, 1);
  assert.equal(c.localCount, 2);
  assert.equal(device.getState().syncState, 'conflict');
  engine.resolveConflict('cloud');
  await tick(20);
  assert.deepEqual(device.getState().tasks.map((t) => t.title), ['Cloud task']);
  assert.equal(device.getState().syncConflict, null);

  // the other way round on a second device
  engine.stop(); mem.clear();
  const device2 = makeStore({ tasks: [{ id: 'l3', title: 'Keep me' }] });
  persist(device2);
  engine = startAutoSync(device2, { cloud: fakeCloud });
  await tick(80);
  engine.resolveConflict('local');
  await tick(80);
  assert.deepEqual(server.backup.state.tasks.map((t) => t.title), ['Keep me']);
});

test('erasing on one device empties the cloud, and another device empties on its next open', async () => {
  const a = makeStore({ tasks: [{ id: 't1', title: 'Pay rent' }] });
  persist(a);
  engine = startAutoSync(a, { cloud: fakeCloud });
  await tick(2700);
  a.setState({ ...blank() }); // what resetData does
  await engine.flush();
  assert.equal(server.backup.state.tasks.length, 0);
  engine.stop(); mem.clear();

  const b = makeStore({ tasks: [{ id: 't1', title: 'Pay rent' }] });
  mem.set('myth-sync-meta', JSON.stringify({ cloudUpdatedAt: 't1' })); // b had synced before
  persist(b);
  engine = startAutoSync(b, { cloud: fakeCloud });
  await tick(80);
  assert.equal(b.getState().tasks.length, 0);
});

test('without a key nothing is pushed and the state reads off', async () => {
  const s = makeStore({ settings: { cloudKey: '' }, tasks: [{ id: 't1', title: 'x' }] });
  persist(s);
  globalThis.window.location.href = 'https://myth.test/';
  engine = startAutoSync(s, { cloud: fakeCloud });
  s.setState({ tasks: [] });
  await tick(2700);
  assert.equal(server.calls.length, 0);
  assert.equal(s.getState().syncState, 'off');
});
