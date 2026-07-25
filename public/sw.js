const CACHE_NAME = 'body-explorer-v9-mediapipe-assets';

// Only stable, always-present paths go here. addAll() fails the whole install if
// any one 404s, so we don't list the model files: in production Vite bundles them
// to hashed /assets/ names (which change per build) and they get cached at
// runtime by the fetch handler instead.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/difficulty-easy.png',
  '/icons/difficulty-medium.png',
  '/icons/difficulty-hard.png',
  '/wasm/mediapipe/vision_wasm_internal.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  if (event.request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }
  
  // Do not cache dev server hot updates or debug URLs
  if (url.pathname.includes('@vite') || url.pathname.includes('.vite')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then(response => {
        // Cache successful responses only
        if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors')) {
          return response;
        }
        
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        
        return response;
      });
    })
  );
});
