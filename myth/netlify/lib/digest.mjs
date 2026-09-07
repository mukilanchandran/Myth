// Background push digest — runs on a schedule (see netlify/functions/push-digest-*.mjs).
// For every sync key it reads the latest synced backup, computes today's
// reminders (same rules as src/notify.js pendingReminders) and delivers them
// as Web Push notifications to every device registered under that key —
// even when the app is fully closed.
//
// Required Netlify environment variables (Site configuration → Environment variables):
//   MYTH_SYNC_KEY                        — the sync key(s), same as for cloud storage
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT                        — mailto:you@example.com
// Optional:
//   PUSH_TZ_OFFSET_MIN                   — minutes from UTC, default 330 (IST)
import webpush from 'web-push';
import dayjs from 'dayjs';
import { smartNotifications, isMuted, composeDigest } from '../../src/ai/notifications.js';
import { syncKeys, namespaceFor } from './auth.mjs';
import { readIndex, writeIndex, readBackupState } from './store.mjs';

export const TZ_OFFSET_MIN = parseInt(process.env.PUSH_TZ_OFFSET_MIN ?? '330', 10);

export function vapidReady() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureVapid() {
  if (!vapidReady()) {
    throw new Error('Push is not set up on this site — add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in Netlify (see PUSH-SETUP.md).');
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

/** "Now" in the user's timezone, read through getUTC* accessors. */
const localNow = () => new Date(Date.now() + TZ_OFFSET_MIN * 60_000);

// ---- what to say: the Notification Intelligence Engine, shared with the app ----
// `now` is already shifted into the user's timezone (localNow), so wrapping it in
// dayjs on a UTC server yields the user's local hours and dates. Returns the
// notifications worth a lock screen, most important first, minus muted ones.
export function computeReminders(state, now = localNow()) {
  if (!state || state.settings?.notifications === false) return [];
  const at = dayjs(now);
  return smartNotifications(state, at)
    .filter((n) => !isMuted(n, state.notifyMuted, at))
    .filter((n) => n.level !== 'fyi')
    .slice(0, 4);
}

/**
 * Send one payload to every device in a namespace. Devices whose subscription
 * expired (404/410 from the push service) are pruned from the index.
 * Returns { sent, removed }.
 */
export async function pushToNamespace(store, ns, payload) {
  configureVapid();
  const idx = await readIndex(store, ns);
  let sent = 0, removed = 0, changed = false;
  for (const [devId, dev] of Object.entries(idx.push)) {
    try {
      await webpush.sendNotification(dev.sub, JSON.stringify(payload));
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        delete idx.push[devId];
        removed++;
        changed = true;
      }
    }
  }
  if (changed) await writeIndex(store, ns, idx);
  return { sent, removed };
}

/** The scheduled job: one digest per sync key. Returns counts for the log. */
export async function runDigest(store, { label = 'digest' } = {}) {
  configureVapid();
  const now = localNow();
  const greeting = now.getUTCHours() < 12 ? 'morning' : now.getUTCHours() < 17 ? 'afternoon' : 'evening';
  const totals = { sent: 0, skipped: 0, removed: 0, keys: 0 };

  for (const key of syncKeys()) {
    totals.keys++;
    const ns = namespaceFor(key);
    const idx = await readIndex(store, ns);
    if (!Object.keys(idx.push).length) { totals.skipped++; continue; }

    const backup = await readBackupState(store, ns, idx);
    const reminders = computeReminders(backup?.state, now);
    if (!reminders.length) { totals.skipped++; continue; }

    const digest = composeDigest(reminders, greeting);
    const payload = {
      title: digest.title,
      body: digest.body,
      tag: `myth-${label}-${now.toISOString().slice(0, 10)}-${greeting}`,
      url: './',
    };
    const { sent, removed } = await pushToNamespace(store, ns, payload);
    totals.sent += sent;
    totals.removed += removed;
  }
  return totals;
}
