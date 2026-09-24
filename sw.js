/* Offline shell. Caches the app's own files so the PWA opens with no network at all.
 *
 * It deliberately does NOT cache anything from the Apps Script endpoint or from
 * Google Identity Services: data freshness is the app's job (IndexedDB snapshot +
 * a visible sync status line), and a stale cached API response would silently lie
 * about how current a card is.
 */

// The cache name comes from config.js: one cache per event (slug) and per
// deployment (shellVersion). Two events on one origin must never share a shell.
importScripts("config.js");
const PREFIX = "deepip-field-" + (EVENT.slug || "event") + "-";
const CACHE = PREFIX + "v" + (EVENT.shellVersion || 1);
const SHELL = [
  "./", "./index.html", "./styles.css",
  "./config.js", "./store.js", "./auth.js", "./sync.js", "./model.js", "./ui.js", "./app.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; one 404 would leave the app with no shell at all.
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      // Only this event's older shells. Another event's cache on the same origin
      // belongs to another app and is left alone.
      .then(keys => Promise.all(keys.filter(k => k.indexOf(PREFIX) === 0 && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                       // never touch the sync POSTs
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // GIS, Apps Script: straight to network

  // Network-first for our own files so a redeploy is picked up as soon as there is
  // a connection, with the cache as the fallback when there is not.
  // `no-cache` makes the browser revalidate with the server (a cheap 304 when
  // nothing changed) instead of reusing its HTTP cache: GitHub Pages sends
  // max-age=600, so a plain fetch kept serving the previous build for ten
  // minutes after every publish.
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => {
        if (hit) return hit;
        // Only a navigation should fall back to the shell; answering a missing
        // .js request with HTML would break the page in a confusing way.
        return req.mode === "navigate" ? caches.match("./index.html") : Response.error();
      }))
  );
});
