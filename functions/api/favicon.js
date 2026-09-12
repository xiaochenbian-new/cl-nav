/**
 * Cloudflare Pages Function — 同源 favicon 代理
 * 路由：/api/favicon?domain=example.com
 *
 * 国内浏览器常无法直连 DDG/Google 图标 CDN；由边缘拉取后回传，便于缓存与 IndexedDB。
 */
const UPSTREAMS = (domain) => [
  `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  `https://favicon.im/${encodeURIComponent(domain)}?larger=true`,
  `https://${domain}/favicon.ico`,
  `https://www.${domain}/favicon.ico`,
];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function normalizeDomain(raw) {
  let d = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .replace(/^www\./, "");
  if (!d || d.length > 253 || !/^[a-z0-9._-]+$/i.test(d)) return "";
  return d;
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: cors() });
  }

  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain"));
  if (!domain) {
    return new Response(JSON.stringify({ error: "缺少 domain" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8", ...cors() },
    });
  }

  for (const url of UPSTREAMS(domain)) {
    try {
      const upstream = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "CL-Nav-FaviconProxy/1.0",
          Accept: "image/*,*/*;q=0.8",
        },
        redirect: "follow",
        cf: { cacheTtl: 86400, cacheEverything: true },
      });
      if (!upstream.ok) continue;

      const buf = await upstream.arrayBuffer();
      if (!buf || buf.byteLength < 16 || buf.byteLength > 512 * 1024) continue;

      const ct = (upstream.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html") || ct.includes("application/json")) continue;

      const headers = {
        ...cors(),
        "Content-Type": ct && ct.startsWith("image/") ? ct : "image/x-icon",
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
        Vary: "Accept",
      };

      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      return new Response(buf, { status: 200, headers });
    } catch (_) {
      /* try next */
    }
  }

  return new Response(JSON.stringify({ error: "未找到图标", domain }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() },
  });
}
