// Service worker: funcionamiento sin conexión y recepción de notificaciones.
// Los datos de la agenda NO están aquí (viven en IndexedDB): actualizar o
// borrar esta caché nunca borra actividades ni tareas.

const VERSION = '1.1.0'; // cámbialo al publicar una versión nueva
const CACHE = `agenda-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/actions.js',
  './js/store.js',
  './js/sync.js',
  './js/vendor/preact-htm.js',
  './js/shared/dates.js',
  './js/shared/model.js',
  './js/shared/reminders.js',
  './js/shared/tz.js',
  './js/shared/ics.js',
  './js/shared/quick.js',
  './js/shared/slots.js',
  './js/shared/stats.js',
  './js/shared/icsimport.js',
  './js/ui/common.js',
  './js/ui/home.js',
  './js/ui/calendar.js',
  './js/ui/tasks.js',
  './js/ui/settings.js',
  './js/ui/editor.js',
  './js/ui/detail.js',
  './js/ui/extras.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('agenda-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Archivos de la app: se sirven al instante desde la caché y, si hay red, se
// renuevan en segundo plano para la siguiente apertura.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // el servidor de la agenda nunca se cachea
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = req.mode === 'navigate' ? new Request('./index.html') : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const refresh = fetch(req.mode === 'navigate' ? './index.html' : req.url, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return (await refresh) || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })()
  );
});

// ---------- Notificaciones push ----------
// En iOS 18.4 o posterior el sistema muestra el aviso por sí mismo (formato
// declarativo). En versiones anteriores lo muestra este código.
self.addEventListener('push', (event) => {
  let n = {};
  try {
    const data = event.data ? event.data.json() : {};
    n = data.notification || data || {};
  } catch (e) {
    n = { title: 'Agenda', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(n.title || 'Agenda', {
      body: n.body || 'Tienes un recordatorio.',
      lang: 'es',
      icon: './icons/icon-192.png',
      data: { url: n.navigate || './' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'open', url });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
