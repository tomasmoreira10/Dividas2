// Service Worker para Contas (PWA) - cache simples para offline
const CACHE_NAME = 'contas-cache-v1';
const BASE_PATH = new URL('./', self.location).pathname;
const withBase = (path) => `${BASE_PATH}${path}`;
const urlsToCache = [
  withBase(''),
  withBase('index.html'),
  withBase('manifest.json'),
  withBase('src/main.js'),
  withBase('src/style.css'),
  withBase('icons/contas-192.svg'),
  withBase('icons/contas-512.svg'),
  withBase('icons/contas-ios.svg'),
  withBase('icons/contas-192.png'),
  withBase('icons/contas-180.png'),
  withBase('icons/contas-512.png')
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName)
          }
        })
      )
    }).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response
        }

        const responseToCache = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache))
        return response
      })
      .catch(() => {
        return caches.match(event.request).then((response) => {
          if (response) {
            return response
          }
          if (event.request.destination === 'document') {
            return caches.match(withBase(''))
          }
        })
      })
  )
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-debts') {
    event.waitUntil(Promise.resolve())
  }
})
