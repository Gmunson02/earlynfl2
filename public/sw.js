// Minimal SW to take control quickly
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// (Optional) you can add offline caching later; keeping fetch passthrough for now.
