// Automatic cloud sync — the same data on every device that opens the link.
//
//   • pull on open, when the tab comes back to the front, and every 2 minutes
//     (one cheap status call; the backup is downloaded only when it changed)
//   • push 2.5 s after any change, coalesced; files this device added ride along
//   • last write wins per snapshot. Pull-on-focus happens before you start
//     editing, so two devices editing at the very same minute is the only case
//     where one side's change can be lost.
//   • the first time a device connects while BOTH sides already hold data, it
//     asks which copy to keep instead of guessing (store.syncConflict).
//
// The key can arrive in the URL once — https://site/?sync=KEY — so one link
// works on every device; it is stored and stripped from the address bar.
import * as netlifyCloud from './netlify.js';

const META_KEY = 'myth-sync-meta'; // { cloudUpdatedAt } — what this device last pulled/pushed
const DATA_KEYS = ['tasks', 'projects', 'notes', 'files', 'drive', 'habits', 'transactions', 'journal', 'plans', 'learning', 'events', 'plannerSessions', 'chat', 'chatHistory', 'xp', 'notifyMuted', 'nowLearn', 'settings'];
const PUSH_DELAY = 2500;
const POLL_MS = 2 * 60 * 1000;

const readMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY)) ?? {}; } catch { return {}; } };
const writeMeta = (m) => { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* storage may be full or blocked */ } };

export const hasData = (s) => ['tasks', 'projects', 'notes', 'habits', 'transactions', 'journal', 'events', 'learning', 'drive', 'plannerSessions'].some((k) => (s[k]?.length ?? 0) > 0);
export const countOf = (s) => ['tasks', 'projects', 'notes', 'habits', 'events', 'journal'].reduce((a, k) => a + (s[k]?.length ?? 0), 0);

// ?sync=KEY or #sync=KEY → remember it, clean the address bar
export function adoptKeyFromUrl(store) {
  try {
    const url = new URL(window.location.href);
    const key = url.searchParams.get('sync') ?? new URLSearchParams(url.hash.replace(/^#/, '')).get('sync');
    if (!key || key.trim().length < 12) return false;
    store.getState().setSettings({ cloudKey: key.trim() });
    url.searchParams.delete('sync');
    url.hash = '';
    window.history.replaceState(null, '', url.pathname + url.search);
    return true;
  } catch { return false; }
}

let engine = null;

// `deps.cloud` lets tests plug in a fake cloud; the app uses the Netlify client.
export function startAutoSync(store, deps = {}) {
  if (engine) return engine;
  const cloud = deps.cloud ?? netlifyCloud;
  let applying = false;   // a cloud pull is being applied — don't echo it back
  let dirty = false;      // local changes not yet pushed
  let pushing = false;
  let timer = null;
  let stopped = false;
  const setSync = (patch) => store.setState(patch);
  const settings = () => store.getState().settings;

  const applyCloud = (data, updatedAt) => {
    const incoming = data?.state ?? {};
    const mine = settings();
    applying = true;
    try {
      const next = {};
      for (const k of DATA_KEYS) if (k in incoming) next[k] = incoming[k];
      // this device's connection details always win — they are what reached the cloud
      next.settings = { ...(incoming.settings ?? {}), cloudKey: mine.cloudKey, cloudUrl: mine.cloudUrl, aiKey: mine.aiKey || incoming.settings?.aiKey || '' };
      store.setState(next);
    } finally { applying = false; }
    writeMeta({ cloudUpdatedAt: updatedAt });
    setSync({ syncState: 'synced', lastSyncAt: Date.now(), syncError: null });
  };

  const push = async () => {
    if (!cloud.isConfigured(settings()) || pushing || stopped) return;
    pushing = true; dirty = false;
    setSync({ syncState: 'syncing' });
    try {
      await cloud.syncUp(settings());
      const info = await cloud.cloudInfo(settings());
      writeMeta({ cloudUpdatedAt: info?.updatedAt ?? new Date().toISOString() });
      setSync({ syncState: 'synced', lastSyncAt: Date.now(), syncError: null });
    } catch (e) {
      dirty = true;
      setSync({ syncState: navigator.onLine ? 'error' : 'offline', syncError: e.message });
    } finally {
      pushing = false;
      if (dirty && !stopped) schedule();
    }
  };

  const schedule = () => { clearTimeout(timer); timer = setTimeout(push, PUSH_DELAY); };

  // Pull when the cloud moved on. First connection with data on both sides → ask.
  const pull = async ({ first = false } = {}) => {
    const s = settings();
    if (!cloud.isConfigured(s) || stopped || store.getState().syncConflict) return;
    if (dirty || pushing) { schedule(); return; } // our change goes up first; last write wins
    setSync({ syncState: 'syncing' });
    try {
      const info = await cloud.cloudInfo(s);
      const meta = readMeta();
      if (!info) {
        // nothing in the cloud yet: this device becomes the source
        if (hasData(store.getState())) { dirty = true; schedule(); } else setSync({ syncState: 'synced', lastSyncAt: Date.now(), syncError: null });
        return;
      }
      if (info.updatedAt === meta.cloudUpdatedAt) { setSync({ syncState: 'synced', lastSyncAt: Date.now(), syncError: null }); return; }
      if (first && !meta.cloudUpdatedAt && hasData(store.getState())) {
        // never synced here, and both sides hold data — the user decides
        const remote = await cloud.fetchBackup(s);
        setSync({ syncState: 'conflict', syncConflict: { cloudUpdatedAt: remote.updatedAt, cloudCount: countOf(remote.data.state ?? {}), localCount: countOf(store.getState()), remote } });
        return;
      }
      const remote = await cloud.fetchBackup(s);
      if (remote) applyCloud(remote.data, remote.updatedAt);
    } catch (e) {
      setSync({ syncState: navigator.onLine ? 'error' : 'offline', syncError: e.message });
    }
  };

  // any data change → push soon
  let prev = store.getState();
  const unsubscribe = store.subscribe((state) => {
    if (applying || stopped) { prev = state; return; }
    const changed = DATA_KEYS.some((k) => state[k] !== prev[k]);
    const keyChanged = state.settings.cloudKey !== prev.settings.cloudKey;
    prev = state;
    if (keyChanged) {
      writeMeta({});
      if (cloud.isConfigured(state.settings)) pull({ first: true });
      else setSync({ syncState: 'off', syncConflict: null });
      return;
    }
    if (changed && cloud.isConfigured(state.settings)) { dirty = true; schedule(); }
  });

  const onVisible = () => { if (!document.hidden) pull(); };
  const onOnline = () => (dirty ? schedule() : pull());
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onOnline);
  const poll = setInterval(() => { if (!document.hidden) pull(); }, POLL_MS);
  poll.unref?.(); // never keeps a Node process (tests) alive; no-op in browsers
  // flush a pending push when the tab is closed (best effort, fetch keeps going)
  const onHide = () => { if (dirty && !pushing) { clearTimeout(timer); push(); } };
  window.addEventListener('pagehide', onHide);

  adoptKeyFromUrl(store);
  setSync({ syncState: cloud.isConfigured(settings()) ? 'syncing' : 'off' });
  pull({ first: true });

  engine = {
    // the user chose a side in the first-connection dialog
    resolveConflict: (keep) => {
      const c = store.getState().syncConflict;
      setSync({ syncConflict: null });
      if (!c) return;
      if (keep === 'cloud') applyCloud(c.remote.data, c.remote.updatedAt);
      else { dirty = true; push(); }
    },
    pullNow: () => pull(),
    flush: async () => { clearTimeout(timer); if (dirty || pushing) { while (pushing) await new Promise((r) => setTimeout(r, 100)); if (dirty) await push(); } },
    stop: () => { stopped = true; unsubscribe(); clearTimeout(timer); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); window.removeEventListener('online', onOnline); window.removeEventListener('pagehide', onHide); engine = null; },
  };
  return engine;
}

export const autoSync = () => engine;
