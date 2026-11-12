/* InfraReport offline support.
 * Keeps the app usable with poor or no connectivity once it has been opened:
 *  - hashed build assets: cache first (they never change)
 *  - pages and route data: network first, falling back to the last cached copy
 * Inspection data itself never goes through here; it lives on the device
 * (localStorage + IndexedDB) and is not uploaded anywhere.
 */
const CACHE = "infrareport-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(6000)]);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreVary: true }) || await cache.match(request, { ignoreVary: true, ignoreSearch: true });
    if (hit) return hit;
    if (fallbackUrl) {
      const shell = await cache.match(fallbackUrl, { ignoreVary: true });
      if (shell) return shell;
    }
    return new Response("Offline and this page has not been opened on this device yet.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || /\.(png|ico|svg|woff2?|mjs)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, "/"));
    return;
  }
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(req));
  }
});
