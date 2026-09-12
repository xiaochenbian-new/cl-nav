/**
 * Cloudflare Pages Function — 多端配置同步（KV）
 * 路由：/api/sync
 * - GET  拉取备份 JSON（Header: Authorization: Bearer <同步口令>）
 * - PUT  上传备份 JSON（同上）
 * - HEAD 探测是否存在
 *
 * Dashboard 绑定：Settings → Functions → KV namespace bindings
 * Binding name 必须为：CL_NAV_SYNC
 */
function cors(req) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, req) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(req) },
  });
}

function getToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  try {
    return new URL(request.url).searchParams.get("token") || "";
  } catch {
    return "";
  }
}

async function tokenToKey(token) {
  const raw = "cl-nav-sync-v1:" + String(token || "").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "backup:" + hex;
}

function exportedAtOf(text) {
  try {
    const o = JSON.parse(text);
    const n = Number(o && o.exportedAt);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }

  const kv = env && env.CL_NAV_SYNC;
  if (!kv || typeof kv.get !== "function") {
    return json(
      {
        error:
          "未绑定 KV：请在 Cloudflare Pages → 本项目 Settings → Functions → KV namespace bindings 中添加绑定，名称填 CL_NAV_SYNC。",
      },
      503,
      request
    );
  }

  const token = getToken(request);
  if (!token || token.length < 8) {
    return json({ error: "请提供至少 8 位的同步口令（Authorization: Bearer …）" }, 401, request);
  }

  const key = await tokenToKey(token);

  try {
    if (request.method === "HEAD") {
      const cur = await kv.get(key);
      const headers = new Headers(cors(request));
      if (!cur) return new Response(null, { status: 404, headers });
      const meta = (() => {
        try {
          return JSON.parse(cur);
        } catch {
          return null;
        }
      })();
      if (meta && meta.exportedAt) headers.set("X-Exported-At", String(meta.exportedAt));
      headers.set("X-Updated-At", String((meta && meta.updatedAt) || 0));
      return new Response(null, { status: 200, headers });
    }

    if (request.method === "GET") {
      const cur = await kv.get(key);
      if (!cur) {
        return json({ error: "云端尚无备份", empty: true }, 404, request);
      }
      let meta;
      try {
        meta = JSON.parse(cur);
      } catch {
        return json({ error: "云端数据损坏" }, 500, request);
      }
      const body = typeof meta.body === "string" ? meta.body : JSON.stringify(meta.body || meta);
      const headers = {
        ...cors(request),
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Exported-At": String(meta.exportedAt || exportedAtOf(body) || 0),
        "X-Updated-At": String(meta.updatedAt || 0),
      };
      return new Response(body, { status: 200, headers });
    }

    if (request.method === "PUT") {
      const text = await request.text();
      if (!text || text.length < 2) {
        return json({ error: "请求体为空" }, 400, request);
      }
      if (text.length > 2_500_000) {
        return json({ error: "备份过大（上限约 2.5MB）" }, 413, request);
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return json({ error: "不是合法 JSON" }, 400, request);
      }
      if (!parsed || typeof parsed !== "object") {
        return json({ error: "备份格式不正确" }, 400, request);
      }

      const exportedAt = exportedAtOf(text) || Date.now();
      const updatedAt = Date.now();
      const record = JSON.stringify({
        body: text,
        exportedAt,
        updatedAt,
        bytes: text.length,
      });
      await kv.put(key, record);

      return json(
        {
          ok: true,
          exportedAt,
          updatedAt,
          bytes: text.length,
        },
        200,
        request
      );
    }

    return json({ error: "Method Not Allowed" }, 405, request);
  } catch (err) {
    return json(
      { error: "同步服务异常：" + (err && err.message ? err.message : String(err)) },
      500,
      request
    );
  }
}
