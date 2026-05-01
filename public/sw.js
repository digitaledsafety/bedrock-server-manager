const CACHE_NAME = 'bsm-v2';
const STATIC_ASSETS = [
  '/style.css',
  '/script.js',
  '/favicon.ico',
  '/icon.ico',
  '/fonts/MinecraftBold-nMK1.otf',
  '/fonts/MinecraftBoldItalic-1y1e.otf',
  '/fonts/MinecraftItalic-R8Mo.otf',
  '/fonts/MinecraftRegular-Bmg3.otf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first strategy for the root page and API calls
  if (url.pathname === '/' || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Optionally cache the latest response for offline viewing
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first strategy for static assets
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});
