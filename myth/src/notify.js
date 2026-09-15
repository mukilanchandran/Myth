// Notifications: the Notification Intelligence Engine (src/ai/notifications.js)
// decides what is worth saying and when; this module only delivers it — the
// bell, the app-icon badge, lock-screen notifications through the service
// worker, and background-push registration.
import dayjs from 'dayjs';
import { notifications } from '@mantine/notifications';
import { APP_NAME, asset } from './config/env';
import * as cloud from './cloud/netlify';
import { visibleNotifications, selectForDelivery, composeDigest, prefsOf } from './ai/notifications.js';
import { dailyBrief, briefText } from './ai/dailyBrief.js';

// What the bell shows: everything the engine has a reason for, minus snoozed and dismissed items.
export function pendingReminders(state, now = dayjs()) {
  return visibleNotifications(state, now);
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
  await showSystemNotification(`${APP_NAME} 🔔`, 'Notifications are on — Myth will only interrupt you when it can say why.');
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

// Red badge on the home-screen icon with the number of things that need a decision.
export function updateAppBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch { /* not supported — fine */ }
}

// ---- delivery loop (runs while the app is open) ----
// The engine's delivery policy decides what may interrupt: quiet hours, the
// daily budget, at most two per check, and never the same situation twice
// unless it changed or got worse. The per-device log lives in localStorage
// and keeps a week.
const LOG_KEY = 'myth-notify-log';
const LOG_DAYS = 7;

export function readDeliveryLog() {
  try {
    const log = JSON.parse(localStorage.getItem(LOG_KEY)) ?? [];
    const cutoff = Date.now() - LOG_DAYS * 86_400_000;
    return Array.isArray(log) ? log.filter((l) => l && l.ts >= cutoff) : [];
  } catch { return []; }
}

const writeDeliveryLog = (log) => {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-200))); } catch { /* storage blocked — fine */ }
};

export function runReminderNotifications(state) {
  if (!state.settings.notifications) { updateAppBadge(0); return []; }
  const now = dayjs();
  const visible = visibleNotifications(state, now);
  updateAppBadge(visible.filter((n) => n.level !== 'fyi').length);
  if (notifyStatus() !== 'granted' || !visible.length) return [];

  const log = readDeliveryLog();
  const picked = selectForDelivery(visible, log, now, prefsOf(state.settings));
  picked.forEach((n) => showSystemNotification(n.headline, n.lines.join('\n'), `myth-${n.key}`));
  if (picked.length) {
    writeDeliveryLog([...log, ...picked.map((n) => ({ key: n.key, fp: n.fp, level: n.level, ts: now.valueOf(), ...(n.exempt ? { exempt: true } : {}) }))]);
  }
  return picked;
}

let lastDigest = null;

// In-app greeting toast, once per day, led by the top item and its reasoning.
export function runDailyDigest(state) {
  if (!state.settings.notifications) return;
  const key = dayjs().format('YYYY-MM-DD');
  if (lastDigest === key) return;
  lastDigest = key;

  const h = dayjs().hour();
  // mornings open with the Myth Daily Brief; later in the day the digest is the notifications that matter
  if (h >= 5 && h < 12) {
    const brief = dailyBrief(state);
    notifications.show({ title: `${APP_NAME} Daily Brief`, message: briefText(brief, { schedule: false }).replace(/^.*\n\n/, ''), color: 'forest', autoClose: 12000 });
    return;
  }
  const digest = composeDigest(
    visibleNotifications(state).filter((n) => n.level !== 'fyi'),
    h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening',
  );
  if (!digest) return;
  notifications.show({ title: digest.title, message: digest.body, color: 'forest', autoClose: 9000 });
}
