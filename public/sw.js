// LinkPC Service Worker v2
const CACHE_NAME = 'linkpc-v2';
const ASSETS = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

// ─── Install: pre-carica assets ───────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: pulisce vecchie cache ──────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: serve dalla cache se offline ──────────────────────────────────────
self.addEventListener('fetch', e => {
  // Solo GET, ignora richieste API/WS
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/vapid-public-key') ||
      e.request.url.includes('/subscribe') ||
      e.request.url.includes('/unsubscribe')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ─── Push: riceve notifica dal server ─────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'LinkPC', body: 'Nuovo messaggio', icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: 'linkpc-msg', data: { url: '/' } };

  if (e.data) {
    try { data = { ...data, ...e.data.json() }; }
    catch { data.body = e.data.text(); }
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      renotify: data.renotify || false,
      vibrate: [200, 100, 200],
      data: data.data || {}
    })
  );
});

// ─── Notification click: apre/focalizza l'app ─────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Se c'è già una finestra aperta, focalizzala
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Altrimenti apri nuova finestra
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
