// Makes Houseago Asset Management installable as an app (via manifest.webmanifest)
// and loads instantly once visited once, by keeping its own pages/styles/scripts
// in a local cache. Bump CACHE_NAME whenever the site's files change so visitors
// pick up the update rather than an old cached copy.
//
// Only same-origin requests (this site's own files) are ever cached or
// intercepted here. Everything else — Supabase (your data and documents),
// Google Fonts, and the CDN scripts used for scanning receipts — always goes
// straight to the network, untouched, so nothing here can ever serve stale
// or incorrect account data.

var CACHE_NAME = 'houseago-asset-management-v20';

var PRECACHE_URLS = [
  './',
  'index.html',
  'dashboard.html',
  'receipts.html',
  'property.html',
  'person.html',
  'security.html',
  'manifest.webmanifest',
  'assets/style.css',
  'assets/auth.js',
  'assets/receipts.js',
  'assets/property.js',
  'assets/person.js',
  'assets/security.js',
  'assets/pdf-convert.js',
  'assets/doc-scan.js',
  'assets/supabase-config.js',
  'assets/pwa.js',
  'assets/favicon.svg',
  'assets/favicon-32.png',
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-192.png',
  'assets/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE_URLS); })
      .catch(function () { /* offline on first install, or a file briefly missing — fine, fetch handler below covers it */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts, CDN scripts: always live

  // Stale-while-revalidate: answer instantly from the cache if we have it
  // (so the app opens instantly), while quietly fetching the latest version
  // in the background for next time.
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var network = fetch(req).then(function (response) {
          if (response && response.ok) cache.put(req, response.clone());
          return response;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
