/* ════════════════════════════════════════════════════
   NOTRE CUISINE — Service Worker
   Stratégie : Network-first pour tout — toujours la dernière version
════════════════════════════════════════════════════ */

const CACHE_NAME = 'notre-cuisine-v3';

// À l'installation, on prend le contrôle immédiatement
self.addEventListener('install', event => {
  self.skipWaiting();
});

// À l'activation, on supprime les anciens caches et on prend le contrôle
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first : toujours essayer le réseau en premier
// Le cache est juste un filet de sécurité si offline
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Mettre en cache la réponse fraîche
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // Offline : utiliser le cache si disponible
        return caches.match(event.request);
      })
  );
});
