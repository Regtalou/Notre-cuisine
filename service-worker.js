/* ════════════════════════════════════════════════════
   NOTRE CUISINE — Service Worker
   Stratégie : Cache-first pour assets, Network-first pour Firebase
════════════════════════════════════════════════════ */

const CACHE_NAME = 'notre-cuisine-v1';
const CACHE_STATIC = 'nc-static-v1';

// Assets à mettre en cache immédiatement
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap',
];

/* ── INSTALL : mise en cache des assets statiques ── */
self.addEventListener('install', event => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      // On ignore les erreurs individuelles (fonts réseau...)
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE : nettoyage des anciens caches ──────── */
self.addEventListener('activate', event => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH : stratégie mixte ──────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // Firebase / API Anthropic → Network only (jamais cacher)
  if (
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    event.respondWith(fetch(request).catch(() => offlineFallback(request)));
    return;
  }

  // Assets statiques → Cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Ne mettre en cache que les réponses valides
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_STATIC).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => offlineFallback(request));
    })
  );
});

/* ── FALLBACK HORS LIGNE ──────────────────────────── */
function offlineFallback(request) {
  if (request.destination === 'document') {
    return caches.match('/index.html');
  }
  return new Response('Offline — Notre Cuisine', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

/* ── SYNC EN ARRIÈRE-PLAN (futur) ─────────────────── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-recipes') {
    console.log('[SW] Background sync: recipes');
    // Réservé pour synchronisation différée
  }
});

/* ── NOTIFICATIONS PUSH (futur) ──────────────────── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Notre Cuisine', {
    body: data.body || '',
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
  });
});
