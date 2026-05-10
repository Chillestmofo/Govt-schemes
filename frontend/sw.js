/**
 * Emergency Cache Kill Script
 * This version of sw.js will delete all caches and unregister itself.
 */

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => caches.delete(key)));
        }).then(() => {
            return self.registration.unregister();
        }).then(() => {
            return self.clients.matchAll();
        }).then((clients) => {
            clients.forEach(client => client.navigate(client.url));
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Bypass all caching
    event.respondWith(fetch(event.request));
});
