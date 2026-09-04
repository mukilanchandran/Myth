// Smart reminders: computed from live data + pushed as browser notifications.
// Each reminder carries a `kind` that the UI resolves to a design-system icon.
import dayjs from 'dayjs';
import { notifications } from '@mantine/notifications';
import { APP_NAME, asset } from './config/env';
import * as cloud from './cloud/netlify';

export function pendingReminders(state) {
  const out = [];
  const t = dayjs();
  const mode = state.settings.mode;

  state.tasks
    .filter((x) => x.mode === mode && x.status !== 'done' && x.due)
    .forEach((x) => {
      const diff = dayjs(x.due).startOf('day').diff(t.startOf('day'), 'day');
      if (diff < 0) out.push({ kind: 'overdue', text: `Overdue: ${x.title} (${dayjs(x.due).format('MMM D')})` });
      else if (diff === 0) out.push({ kind: 'today', text: `Due today: ${x.title}` });
      else if (diff === 1) out.push({ kind: 'soon', text: `Due tomorrow: ${x.title}` });
    });

  state.events.forEach((e) => {
    let d = dayjs(e.date);
    if (e.yearly) d = d.year(t.year()).isBefore(t, 'day') ? d.year(t.year() + 1) : d.year(t.year());
    const diff = d.startOf('day').diff(t.startOf('day'), 'day');
    if (diff >= 0 && diff <= 3) {
      out.push({ kind: e.kind ?? 'event', text: `${e.title} — ${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`}${e.time ? ` ${e.time}` : ''}` });
    }
  });

  // habit nudge in the evening
  if (t.hour() >= 18 && state.settings.mode === 'personal') {
    const todayKey = t.format('YYYY-MM-DD');
    const missed = state.habits.filter((h) => !h.log[todayKey]);
    if (missed.length) out.push({ kind: 'habit', text: `${missed.length} habit${missed.length > 1 ? 's' : ''} still open today` });
  }

  return out.slice(0, 12);
}

// ---------------------------------------------------------------------------
// System notifications, the app-store-app way.
// iOS home-screen web apps (16.4+) ONLY deliver notifications through a
// service worker registration — `new Notification()` throws. So everything
// below goes through the SW when available and falls back otherwise.
// ---------------------------------------------------------------------------

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// 'granted' | 'denied' | 'default' | 'unsupported' | 'needs-install' (iOS Safari tab)
export function notifyStatus() {
  if (!('Notification' in window)) {
    // iOS Safari (not installed) hides the API entirely
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (isIOS() && !isStandalone() && Notification.permission !== 'granted') return 'needs-install';
  return Notification.permission;
}

export async function showSystemNotification(title, body, tag) {
  if (notifyStatus() !== 'granted') return false;
  const opts = { body, icon: asset('logo-icon.png'), badge: asset('icon-192.png'), tag };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) { await reg.showNotification(title, opts); return true; }
  } catch { /* fall through */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}

// MUST be called from a user tap (iOS ignores permission prompts otherwise).
export async function enableNotifications() {
  const status = notifyStatus();
  if (status === 'needs-install') {
    return { ok: false, reason: 'Open the app from your Home Screen icon (Share → Add to Home Screen), then enable notifications inside it. Needs iOS 16.4 or newer.' };
  }
  if (status === 'unsupported') return { ok: false, reason: 'This browser does not support notifications.' };
  if (status === 'denied') {
    return { ok: false, reason: 'Notifications are blocked. Allow them in Settings → Notifications → Myth (iPhone) or the browser site settings.' };
  }
  const perm = status === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'Permission was not granted.' };
  await showSystemNotification(`${APP_NAME} 🔔`, 'Notifications are on — reminders will now reach you like a regular app.');
  return { ok: true };
}

// ---- background push (notifications while the app is CLOSED) ----
// Requires: device notifications granted + signed into Cloud sync + the
// VAPID public key from PUSH-SETUP.md saved in Settings.

const b64ToUint8 = (base64) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function getPushSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return (await reg?.pushManager?.getSubscription()) ?? null;
  } catch { return null; }
}

export async function enableBackgroundPush(settings) {
  if (notifyStatus() !== 'granted') {
    return { ok: false, reason: 'Enable device notifications first (button above).' };
  }
  const key = settings.vapidPublicKey?.trim();
  if (!key) return { ok: false, reason: 'Paste your push public key first — see PUSH-SETUP.md for the one-time server setup.' };
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg?.pushManager) return { ok: false, reason: 'Push is not available here — reload the app and try again.' };
  try {
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) });
    await cloud.savePushSubscription(settings, sub.toJSON());
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function disableBackgroundPush(settings) {
  const sub = await getPushSubscription();
  if (!sub) return;
  try { await cloud.removePushSubscription(settings, sub.endpoint); } catch { /* server row may stay; digest will prune it */ }
  await sub.unsubscribe();
}

// Red badge on the home-screen icon with the number of pending reminders.
export function updateAppBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch { /* not supported — fine */ }
}

// ---- reminder push loop (runs while the app is open) ----
// Each reminder fires as a real notification once per day; the icon badge
// stays in sync. Survives re-renders via localStorage dedupe.
const SENT_KEY = 'myth-notified';

export function runReminderNotifications(state) {
  if (!state.settings.notifications) return;
  const reminders = pendingReminders(state);
  updateAppBadge(reminders.length);
  if (notifyStatus() !== 'granted' || !reminders.length) return;

  const today = dayjs().format('YYYY-MM-DD');
  let sent;
  try { sent = JSON.parse(localStorage.getItem(SENT_KEY)) ?? {}; } catch { sent = {}; }
  if (sent.date !== today) sent = { date: today, keys: [] };

  const fresh = reminders.filter((r) => !sent.keys.includes(r.text));
  if (!fresh.length) return;

  if (fresh.length === 1) {
    showSystemNotification(APP_NAME, fresh[0].text, `myth-${today}-${sent.keys.length}`);
  } else {
    showSystemNotification(
      `${APP_NAME} — ${fresh.length} reminders`,
      fresh.slice(0, 5).map((r) => `• ${r.text}`).join('\n'),
      `myth-${today}-${sent.keys.length}`
    );
  }
  sent.keys.push(...fresh.map((r) => r.text));
  localStorage.setItem(SENT_KEY, JSON.stringify(sent));
}

let lastDigest = null;

export function runDailyDigest(state) {
  if (!state.settings.notifications) return;
  const key = dayjs().format('YYYY-MM-DD') + state.settings.mode;
  if (lastDigest === key) return;
  lastDigest = key;

  const reminders = pendingReminders(state);
  if (!reminders.length) return;

  notifications.show({
    title: `Good ${dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'}, Boss`,
    message: reminders.slice(0, 4).map((r) => `• ${r.text}`).join('\n'),
    color: 'forest',
    autoClose: 9000,
  });
}
