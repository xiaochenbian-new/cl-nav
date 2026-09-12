/**
 * Cloudflare Pages Function — 资源库（R2 文件 + KV 目录索引）
 * 路由：/api/library
 * - GET                  列出目录
 * - GET ?id=&download=1  下载文件（流式）
 * - POST multipart       上传（需 Authorization: Bearer <管理密码>）
 * - DELETE ?id=          删除（需鉴权）
 *
 * 绑定：
 * - CL_NAV_R2   R2 bucket
 * - CL_NAV_SYNC KV（存 catalog）
 */
const CATALOG_KEY = "library:catalog";
const DEFAULT_ADMIN = "xiaochenbian";

function cors(req) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

function getBearer(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : "";
}

function isAdmin(request, env) {
  const pass = String((env && env.LIBRARY_ADMIN_PASS) || DEFAULT_ADMIN);
  return getBearer(request) === pass;
}

function safeName(name) {
  return String(name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "file";
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function newId() {
  return "r2_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

async function readCatalog(kv) {
  if (!kv) return [];
  const raw = await kv.get(CATALOG_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writeCatalog(kv, items) {
  await kv.put(
    CATALOG_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      items,
    })
  );
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }

  const r2 = env && env.CL_NAV_R2;
  const kv = env && env.CL_NAV_SYNC;
  if (!r2 || typeof r2.put !== "function") {
    return json(
      {
        error:
          "未绑定 R2：请在 Cloudflare 创建 bucket（建议名 cl-nav-library），并在 wrangler.toml 配置 [[r2_buckets]] binding = CL_NAV_R2。",
      },
      503,
      request
    );
  }
  if (!kv || typeof kv.get !== "function") {
    return json({ error: "未绑定 KV（CL_NAV_SYNC），无法保存目录索引。" }, 503, request);
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();
  const wantDownload = url.searchParams.get("download") === "1";

  try {
    if (request.method === "GET" && id && wantDownload) {
      const items = await readCatalog(kv);
      const item = items.find((x) => x && x.id === id);
      if (!item) return json({ error: "资源不存在" }, 404, request);
      const key = item.storage && item.storage.key;
      if (!key) return json({ error: "该条目没有文件" }, 404, request);
      const obj = await r2.get(key);
      if (!obj) return json({ error: "文件不存在于 R2" }, 404, request);

      const headers = new Headers(cors(request));
      const fileName = (item.storage && item.storage.fileName) || item.title || "download";
      headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      if (obj.size != null) headers.set("Content-Length", String(obj.size));
      headers.set("Cache-Control", "private, max-age=60");
      return new Response(obj.body, { status: 200, headers });
    }

    if (request.method === "GET") {
      const items = await readCatalog(kv);
      return json(
        {
          ok: true,
          storageMode: "r2",
          items: items.map((it) => ({
            ...it,
            downloadUrl: it.id ? `/api/library?id=${encodeURIComponent(it.id)}&download=1` : "",
          })),
        },
        200,
        request
      );
    }

    if (request.method === "DELETE") {
      if (!isAdmin(request, env)) return json({ error: "未授权：请先登录管理账号" }, 401, request);
      if (!id) return json({ error: "缺少 id" }, 400, request);
      const items = await readCatalog(kv);
      const item = items.find((x) => x.id === id);
      if (!item) return json({ error: "资源不存在" }, 404, request);
      if (item.storage && item.storage.key) {
        try {
          await r2.delete(item.storage.key);
        } catch (_) {}
      }
      const next = items.filter((x) => x.id !== id);
      await writeCatalog(kv, next);
      return json({ ok: true, id }, 200, request);
    }

    if (request.method === "POST") {
      if (!isAdmin(request, env)) return json({ error: "未授权：请先登录管理账号" }, 401, request);

      const ct = request.headers.get("Content-Type") || "";
      if (!/multipart\/form-data/i.test(ct)) {
        return json({ error: "请使用 multipart/form-data 上传" }, 400, request);
      }

      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return json({ error: "缺少 file 字段" }, 400, request);
      }

      const buf = await file.arrayBuffer();
      if (!buf.byteLength) return json({ error: "空文件" }, 400, request);
      // Workers 请求体有上限；过大时提示
      if (buf.byteLength > 95 * 1024 * 1024) {
        return json({ error: "单文件超过约 95MB，请拆分或改用其它通道" }, 413, request);
      }

      const itemId = newId();
      const fileName = safeName(file.name || form.get("title") || "file");
      const key = `files/${itemId}/${fileName}`;
      const contentType = file.type || "application/octet-stream";

      await r2.put(key, buf, {
        httpMetadata: { contentType },
        customMetadata: { title: String(form.get("title") || fileName) },
      });

      const item = {
        id: itemId,
        title: String(form.get("title") || fileName).trim() || fileName,
        desc: String(form.get("desc") || "").trim(),
        category: String(form.get("category") || "other").trim() || "other",
        version: String(form.get("version") || "—").trim() || "—",
        size: formatSize(buf.byteLength),
        platform: String(form.get("platform") || "—").trim() || "—",
        updatedAt: new Date().toISOString().slice(0, 10),
        storage: { type: "r2", key, fileName, bytes: buf.byteLength },
        downloadUrl: `/api/library?id=${encodeURIComponent(itemId)}&download=1`,
        demo: false,
      };

      const items = await readCatalog(kv);
      items.unshift(item);
      await writeCatalog(kv, items);

      return json({ ok: true, item }, 200, request);
    }

    return json({ error: "Method Not Allowed" }, 405, request);
  } catch (err) {
    return json(
      { error: "资源库服务异常：" + (err && err.message ? err.message : String(err)) },
      500,
      request
    );
  }
}
