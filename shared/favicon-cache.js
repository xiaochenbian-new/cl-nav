/** CL Nav — favicon local cache (memory + IndexedDB) + same-origin / CDN fallbacks */
(function () {
  const DB_NAME = "cl-nav-favicon-db";
  const STORE = "icons";
  const DB_VER = 1;
  const memory = new Map(); // domain -> objectURL | remote url
  const pending = new Map();

  function canUseLocalProxy() {
    return typeof location !== "undefined" && /^https?:$/i.test(location.protocol);
  }

  function localProxyUrl(domain) {
    if (!canUseLocalProxy()) return "";
    return (window.ClNavApi?.url?.("/api/favicon") || "/api/favicon") + "?domain=" + encodeURIComponent(domain);
  }

  function remoteUrls(domain) {
    const d = encodeURIComponent(domain);
    const list = [];
    const local = localProxyUrl(domain);
    // 同源代理优先：国内打不开 DDG/Google，由 Cloudflare 边缘代拉并可写入 IDB
    if (local) list.push(local);
    list.push(
      `https://icons.duckduckgo.com/ip3/${d}.ico`,
      `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
      `https://favicon.im/${d}?larger=true`
    );
    return list;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "domain" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(domain) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(domain);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function idbPut(domain, blob, source) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({
          domain,
          blob,
          source: source || "",
          savedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  function blobToUrl(blob) {
    return URL.createObjectURL(blob);
  }

  /** Sync: memory hit or best remote URL (for first paint). */
  function urlFor(domain) {
    if (!domain) return "";
    if (memory.has(domain)) return memory.get(domain);
    return remoteUrls(domain)[0];
  }

  /** Resolve preferring IndexedDB blob. */
  async function resolve(domain) {
    if (!domain) return "";
    if (memory.has(domain) && String(memory.get(domain)).startsWith("blob:")) {
      return memory.get(domain);
    }
    if (pending.has(domain)) return pending.get(domain);

    const task = (async () => {
      const row = await idbGet(domain);
      if (row?.blob instanceof Blob && row.blob.size > 0) {
        const u = blobToUrl(row.blob);
        memory.set(domain, u);
        return u;
      }
      const remote = remoteUrls(domain)[0];
      memory.set(domain, remote);
      downloadAndStore(domain).catch(() => {});
      return remote;
    })();

    pending.set(domain, task);
    try {
      return await task;
    } finally {
      pending.delete(domain);
    }
  }

  async function downloadAndStore(domain) {
    const urls = remoteUrls(domain);
    for (const url of urls) {
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob || blob.size < 16) continue;
        if (blob.type && /html|json/i.test(blob.type)) continue;
        await idbPut(domain, blob, url);
        const obj = blobToUrl(blob);
        memory.set(domain, obj);
        return obj;
      } catch (_) {
        /* try next */
      }
    }
    return null;
  }

  /** After <img> shows a network icon, persist bytes into IDB. */
  async function persistFromNetwork(domain, src) {
    if (!domain || !src || String(src).startsWith("blob:")) return;
    const existing = await idbGet(domain);
    if (existing?.blob?.size > 0) return;

    // Same-origin /api/favicon or Cache API (readable, non-opaque)
    try {
      if (window.caches) {
        const cache = await caches.open("cl-nav-favicons-v1");
        let hit = await cache.match(src);
        if (!hit && src.startsWith("/")) {
          hit = await cache.match(new URL(src, location.origin).href);
        }
        if (hit && hit.type !== "opaque") {
          const blob = await hit.blob();
          if (blob && blob.size > 16 && !(blob.type && /html|json/i.test(blob.type))) {
            await idbPut(domain, blob, src);
            memory.set(domain, blobToUrl(blob));
            return;
          }
        }
      }
    } catch (_) {}

    // Prefer re-fetch via same-origin proxy (CORS OK)
    const proxy = localProxyUrl(domain);
    const candidates = proxy && src !== proxy ? [proxy, src] : [src];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob || blob.size < 16) continue;
        if (blob.type && /html|json/i.test(blob.type)) continue;
        await idbPut(domain, blob, url);
        memory.set(domain, blobToUrl(blob));
        return;
      } catch (_) {}
    }
  }

  /** Replace img src with cached blob when ready; wire load→persist. */
  function hydrate(root = document) {
    const imgs = root.querySelectorAll("img[data-domain]");
    imgs.forEach((img) => {
      const domain = img.dataset.domain;
      if (!domain) return;

      if (!img.dataset.cacheBound) {
        img.dataset.cacheBound = "1";
        img.addEventListener("load", () => {
          if (img.dataset.fromCache === "1") return;
          persistFromNetwork(domain, img.currentSrc || img.src);
        });
      }

      resolve(domain).then((url) => {
        if (!url) return;
        if (String(url).startsWith("blob:")) {
          if (img.getAttribute("src") === url) return;
          img.dataset.fromCache = "1";
          img.src = url;
          return;
        }
        // 尚无 IDB：切到同源代理 URL，避免一直卡在国外 CDN
        const cur = img.getAttribute("src") || "";
        if (cur !== url && (cur.includes("duckduckgo.com") || cur.includes("google.com") || !cur)) {
          img.dataset.fromCache = "0";
          img.dataset.step = "0";
          img.src = url;
        }
      });
    });
  }

  /** Prefetch a list of domains into IDB / HTTP(SW) cache. */
  function prefetch(domains) {
    const list = [...new Set((domains || []).filter(Boolean))];
    let i = 0;
    const run = () => {
      const batch = list.slice(i, i + 4);
      i += 4;
      batch.forEach((d) => {
        resolve(d).then((url) => {
          if (url && !String(url).startsWith("blob:")) {
            downloadAndStore(d).catch(() => {});
          }
        });
      });
      if (i < list.length) {
        if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 1500 });
        else setTimeout(run, 80);
      }
    };
    if (list.length) run();
  }

  window.FaviconCache = {
    urlFor,
    resolve,
    hydrate,
    prefetch,
    remoteUrls,
    persistFromNetwork,
  };

  window.navFavicon = (domain) => FaviconCache.urlFor(domain);
})();
