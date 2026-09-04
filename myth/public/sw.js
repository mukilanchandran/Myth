/* Myth service worker — makes notifications work like a native app,
   including on iPhone home-screen installs (iOS 16.4+), and handles taps. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Future-proof: if a push server is added later, incoming pushes just work.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Myth', {
      body: data.body ?? '',
      icon: 'logo-icon.png',
      badge: 'icon-192.png',
      tag: data.tag,
      data: { url: data.url ?? './' },
    })
  );
});

// Tapping a notification focuses the app (or opens it if closed).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      if (open) return open.focus();
      return self.clients.openWindow(event.notification.data?.url ?? './');
    })
  );
});
