const CACHE_NAME = 'ner-lmrs-shell-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/favicon.svg'
];

// Install event: cache basic app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => console.error('Failed to cache assets during SW install', err))
  );
});

// Activate event: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event: Network-first for API, Cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRITICAL SAFETY RULE: Never cache live environmental/risk API responses.
  // Bypass cache completely for API requests.
  if (url.pathname.startsWith('/api/') || url.port === '5000') {
    return; // Fall through to standard browser fetch (network only)
  }

  // For static assets (JS, CSS, HTML, Vite chunks), use Stale-While-Revalidate or Cache-First
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return from cache, but maybe fetch in background to update (Stale-While-Revalidate)
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        }).catch(() => {
          // Ignore network errors on background update
        });
        
        return cachedResponse;
      }
      
      // If not in cache, fetch from network and cache it (cache on the fly for assets)
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      }).catch(() => {
        // Return an offline fallback if we had one for HTML, but single page app handles this mostly
        // For navigation requests that fail, return the cached index.html shell
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html').then(response => {
            if (response) return response;
            return new Response('Offline mode: Application not cached.', { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'text/plain' } });
          });
        }
        return new Response('Network error.', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
