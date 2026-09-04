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

// ---- reminder rules (mirror of src/notify.js pendingReminders) ----
export function computeReminders(state, now = localNow()) {
  const out = [];
  if (!state || state.settings?.notifications === false) return out;

  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const hour = now.getUTCHours();
  const dayDiff = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - todayUTC) / 86_400_000);
  };
  const fmt = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  for (const t of state.tasks ?? []) {
    if (t.status === 'done' || !t.due) continue;
    const diff = dayDiff(t.due);
    if (diff < 0) out.push(`Overdue: ${t.title} (${fmt(t.due)})`);
    else if (diff === 0) out.push(`Due today: ${t.title}`);
    else if (diff === 1) out.push(`Due tomorrow: ${t.title}`);
  }

  for (const e of state.events ?? []) {
    if (!e.date) continue;
    let diff = dayDiff(e.date);
    if (e.yearly) {
      // birthdays/anniversaries recur — roll into this or next year
      const [, m, d] = e.date.slice(0, 10).split('-').map(Number);
      let target = Date.UTC(now.getUTCFullYear(), m - 1, d);
      if (target < todayUTC) target = Date.UTC(now.getUTCFullYear() + 1, m - 1, d);
      diff = Math.round((target - todayUTC) / 86_400_000);
    }
    if (diff >= 0 && diff <= 3) {
      const when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`;
      out.push(`${e.title} — ${when}${e.time ? ` ${e.time}` : ''}`);
    }
  }

  // habit nudge only in the evening run
  if (hour >= 17) {
    const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const missed = (state.habits ?? []).filter((h) => !h.log?.[key]).length;
    if (missed > 0) out.push(`${missed} habit${missed > 1 ? 's' : ''} still open today`);
  }

  return out.slice(0, 6);
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

    const payload = {
      title: `Myth — good ${greeting}, Boss`,
      body: reminders.map((r) => `• ${r}`).join('\n'),
      tag: `myth-${label}-${now.toISOString().slice(0, 10)}-${greeting}`,
      url: './',
    };
    const { sent, removed } = await pushToNamespace(store, ns, payload);
    totals.sent += sent;
    totals.removed += removed;
  }
  return totals;
}
