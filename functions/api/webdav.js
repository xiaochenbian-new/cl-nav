/**
 * Cloudflare Pages Function — WebDAV CORS 代理
 * 路由：/api/webdav?url=<encodeURIComponent(完整 WebDAV URL)>
 *
 * 浏览器无法直连坚果云等 DAV（无 CORS），由本函数在边缘转发请求。
 */
const ALLOWED_HOSTS = [
  "dav.jianguoyun.com",
  "jianguoyun.com",
  // 可按需追加其它 WebDAV 主机
];

function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, DELETE, MKCOL, PROPFIND, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Depth, Destination, Overwrite, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function hostAllowed(hostname) {
  const h = String(hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some((allow) => h === allow || h.endsWith("." + allow));
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    const reqUrl = new URL(request.url);
    const targetRaw = reqUrl.searchParams.get("url");
    if (!targetRaw) {
      return json({ error: "缺少 url 参数" }, 400, request);
    }

    let target;
    try {
      target = new URL(targetRaw);
    } catch {
      return json({ error: "url 非法" }, 400, request);
    }

    if (!/^https?:$/i.test(target.protocol)) {
      return json({ error: "仅允许 http/https" }, 400, request);
    }
    if (!hostAllowed(target.hostname)) {
      return json(
        { error: "该 WebDAV 主机未在代理白名单中：" + target.hostname },
        403,
        request
      );
    }

    const headers = new Headers();
    const pass = ["authorization", "content-type", "depth", "destination", "overwrite"];
    for (const name of pass) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }

    const init = {
      method: request.method,
      headers,
      redirect: "follow",
    };

    if (!/^(GET|HEAD)$/i.test(request.method)) {
      init.body = await request.arrayBuffer();
    }

    const upstream = await fetch(target.toString(), init);

    // Cloudflare / Vercel 等海外边缘常无法直连坚果云（国内 IP），会表现为 520
    if (upstream.status === 520 || upstream.status === 521 || upstream.status === 522 || upstream.status === 523) {
      return json(
        {
          error:
            "无法从 Cloudflare 边缘访问该 WebDAV（HTTP " +
            upstream.status +
            "）。坚果云等国内服务通常拦截或不可达海外节点，请改用「本地 JSON」备份，或自建国内代理。",
          status: upstream.status,
          host: target.hostname,
        },
        502,
        request
      );
    }

    const outHeaders = new Headers(corsHeaders(request));
    const ct = upstream.headers.get("content-type");
    if (ct) outHeaders.set("Content-Type", ct);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err) {
    return json(
      {
        error:
          "代理请求失败：" +
          (err && err.message ? err.message : String(err)) +
          "。若目标是坚果云，Cloudflare Pages 海外节点通常无法连通，请用本地 JSON 或国内代理。",
      },
      502,
      request
    );
  }
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}
