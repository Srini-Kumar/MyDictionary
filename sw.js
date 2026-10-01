const CACHE_NAME = 'my-dict-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './scripts.js',
  './manifest.json',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

self.addEventListener('push', event => {
  event.waitUntil(
    self.registration.showNotification('Notification Title', {
      body: 'Notification Body Text',
      icon: 'icon-512.png',
      data: { path: '/MyDictionary/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || '/MyDictionary/';
  event.waitUntil(clients.openWindow(self.location.origin + path));
});
