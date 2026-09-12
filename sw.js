/** CL Nav — cache favicon CDN responses (opaque OK for <img>) */
const CACHE = "cl-nav-favicons-v1";
const HOSTS = ["icons.duckduckgo.com", "www.google.com", "favicon.im", "www.google.cn"];

function isIconRequest(url) {
  try {
    const u = new URL(url);
    return HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("cl-nav-favicons-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !isIconRequest(req.url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;

      try {
        const res = await fetch(req);
        // Cache successful & opaque (no-cors img) responses for next visit
        if (res && (res.ok || res.type === "opaque")) {
          try {
            await cache.put(req, res.clone());
          } catch (_) {}
        }
        return res;
      } catch (err) {
        const again = await cache.match(req);
        if (again) return again;
        throw err;
      }
    })()
  );
});
