/**
 * Cloudflare Pages Function — 资源库目录（KV）
 * 不依赖 R2 / 绑卡：文件放外链（GitHub Releases、网盘等），这里只存目录。
 *
 * - GET                  列出目录
 * - GET ?id=&download=1  302 跳转到主下载地址
 * - POST JSON            登记外链 / 更新资源（需鉴权）
 * - DELETE ?id=          删除（需鉴权）
 *
 * 绑定：CL_NAV_SYNC（KV）
 * 可选：若绑定了 CL_NAV_R2，仍支持 multipart 真上传（有卡开通 R2 后可用）
 */
const CATALOG_KEY = "library:catalog";
const DEFAULT_ADMIN = "xiaochenbian";
const LINK_CHANNELS = new Set(["github", "lanzou", "baidu", "quark", "aliyun", "direct", "other"]);
const DEFAULT_LIB_CATEGORIES = [
  { id: "software", name: "软件" },
  { id: "installer", name: "安装包" },
  { id: "docs", name: "文档" },
  { id: "driver", name: "驱动" },
  { id: "other", name: "其他" },
];

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

function newId() {
  return "lib_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function safeName(name) {
  return (
    String(name || "file")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "file"
  );
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function normalizeLink(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url || raw.href || "").trim();
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/api/")) return null;
  let channel = String(raw.channel || "other").trim().toLowerCase() || "other";
  if (!LINK_CHANNELS.has(channel)) channel = "other";
  const label = String(raw.label || "").trim().slice(0, 40);
  return { url, channel, label };
}

function normalizeLinks(input, fallbackUrl, defaultChannel) {
  let links = [];
  if (Array.isArray(input)) {
    links = input.map(normalizeLink).filter(Boolean);
  }
  const single = String(fallbackUrl || "").trim();
  if (!links.length && (/^https?:\/\//i.test(single) || single.startsWith("/api/"))) {
    links = [
      {
        url: single,
        channel: LINK_CHANNELS.has(defaultChannel) ? defaultChannel : "direct",
        label: "",
      },
    ];
  }
  return links.slice(0, 20);
}

function primaryUrl(item) {
  if (!item) return "";
  if (item.downloadUrl && (/^https?:\/\//i.test(item.downloadUrl) || String(item.downloadUrl).startsWith("/api/"))) {
    return item.downloadUrl;
  }
  const links = Array.isArray(item.links) ? item.links : [];
  const hit = links.find(
    (l) => l && (/^https?:\/\//i.test(l.url) || String(l.url || "").startsWith("/api/"))
  );
  return hit ? hit.url : "";
}

function withNormalized(it) {
  if (!it || !it.id) return it;
  const defaultChannel = it.storage && it.storage.type === "github-release" ? "github" : "direct";
  const links = normalizeLinks(it.links, it.downloadUrl, defaultChannel);
  const downloadUrl = primaryUrl({ ...it, links }) || it.downloadUrl || "";
  return { ...it, links, downloadUrl };
}

function normalizeCategories(list) {
  const seen = new Set();
  const out = [];
  const src = Array.isArray(list) && list.length ? list : DEFAULT_LIB_CATEGORIES;
  for (const c of src) {
    if (!c) continue;
    let id = String(c.id || "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    if (!id || id === "all") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = String(c.name || id).trim().slice(0, 40) || id;
    out.push({ id, name });
  }
  if (!out.length) return DEFAULT_LIB_CATEGORIES.map((x) => ({ ...x }));
  if (!out.some((c) => c.id === "other")) out.push({ id: "other", name: "其他" });
  return out;
}

async function readCatalogDoc(kv) {
  if (!kv) return { items: [], categories: normalizeCategories(null), storageMode: "url" };
  const raw = await kv.get(CATALOG_KEY);
  if (!raw) return { items: [], categories: normalizeCategories(null), storageMode: "url" };
  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.items)
        ? parsed.items
        : [];
    return {
      items,
      categories: normalizeCategories(parsed && parsed.categories),
      storageMode: (parsed && parsed.storageMode) || "url",
    };
  } catch {
    return { items: [], categories: normalizeCategories(null), storageMode: "url" };
  }
}

async function writeCatalogDoc(kv, patch = {}) {
  const prev = await readCatalogDoc(kv);
  const items = patch.items !== undefined ? patch.items : prev.items;
  const categories =
    patch.categories !== undefined ? normalizeCategories(patch.categories) : prev.categories;
  const storageMode = patch.storageMode || prev.storageMode || "url";
  await kv.put(
    CATALOG_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      storageMode,
      categories,
      items,
    })
  );
  return { items, categories, storageMode };
}

async function readCatalog(kv) {
  return (await readCatalogDoc(kv)).items;
}

async function writeCatalog(kv, items) {
  await writeCatalogDoc(kv, { items });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }

  const kv = env && env.CL_NAV_SYNC;
  const r2 = env && env.CL_NAV_R2;
  if (!kv || typeof kv.get !== "function") {
    return json({ error: "未绑定 KV（CL_NAV_SYNC），无法保存资源目录。" }, 503, request);
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();
  const wantDownload = url.searchParams.get("download") === "1";

  try {
    if (request.method === "GET" && id && wantDownload) {
      const items = await readCatalog(kv);
      const item = withNormalized(items.find((x) => x && x.id === id));
      if (!item) return json({ error: "资源不存在" }, 404, request);

      const jump = primaryUrl(item);
      if (jump && /^https?:\/\//i.test(jump)) {
        return Response.redirect(jump, 302);
      }

      const key = item.storage && item.storage.key;
      if (key && r2 && typeof r2.get === "function") {
        const obj = await r2.get(key);
        if (!obj) return json({ error: "文件不存在于 R2" }, 404, request);
        const headers = new Headers(cors(request));
        const fileName = (item.storage && item.storage.fileName) || item.title || "download";
        headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
        headers.set(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
        );
        if (obj.size != null) headers.set("Content-Length", String(obj.size));
        return new Response(obj.body, { status: 200, headers });
      }

      return json({ error: "该资源没有可用下载地址" }, 404, request);
    }

    if (request.method === "GET") {
      const doc = await readCatalogDoc(kv);
      return json(
        {
          ok: true,
          storageMode: r2 ? "r2+url" : doc.storageMode || "url",
          categories: doc.categories,
          items: doc.items.map(withNormalized),
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
      if (item.storage && item.storage.key && r2 && typeof r2.delete === "function") {
        try {
          await r2.delete(item.storage.key);
        } catch (_) {}
      }
      await writeCatalog(
        kv,
        items.filter((x) => x.id !== id)
      );
      return json({ ok: true, id }, 200, request);
    }

    if (request.method === "POST") {
      if (!isAdmin(request, env)) return json({ error: "未授权：请先登录管理账号" }, 401, request);

      const ct = request.headers.get("Content-Type") || "";

      if (/application\/json/i.test(ct)) {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return json({ error: "JSON 无效" }, 400, request);

        const action = String(body.action || "").trim().toLowerCase();
        const itemId = String(body.id || "").trim();

        if (action === "deleteMany") {
          const ids = Array.isArray(body.ids)
            ? body.ids.map((x) => String(x || "").trim()).filter(Boolean)
            : [];
          if (!ids.length) return json({ error: "未选择要删除的资源" }, 400, request);
          const idSet = new Set(ids);
          const items = await readCatalog(kv);
          const keep = [];
          for (const item of items) {
            if (!item || !idSet.has(item.id)) {
              keep.push(item);
              continue;
            }
            if (item.storage && item.storage.key && r2 && typeof r2.delete === "function") {
              try {
                await r2.delete(item.storage.key);
              } catch (_) {}
            }
          }
          await writeCatalog(kv, keep);
          return json({ ok: true, deleted: ids.length }, 200, request);
        }

        if (action === "categoriesSave") {
          const categories = normalizeCategories(body.categories);
          const doc = await readCatalogDoc(kv);
          const valid = new Set(categories.map((c) => c.id));
          const items = (doc.items || []).map((it) => {
            if (!it) return it;
            if (it.category && !valid.has(it.category)) {
              return { ...it, category: "other", updatedAt: new Date().toISOString().slice(0, 10) };
            }
            return it;
          });
          const saved = await writeCatalogDoc(kv, { categories, items });
          return json({ ok: true, categories: saved.categories }, 200, request);
        }

        if (action === "replaceCatalog") {
          const categories = normalizeCategories(body.categories);
          const items = Array.isArray(body.items) ? body.items : [];
          const doc = await writeCatalogDoc(kv, { categories, items });
          return json(
            {
              ok: true,
              categories: doc.categories,
              items: doc.items.map(withNormalized),
            },
            200,
            request
          );
        }

        if (action === "update" || (itemId && action !== "create")) {
          if (!itemId) return json({ error: "更新缺少 id" }, 400, request);
          const items = await readCatalog(kv);
          const idx = items.findIndex((x) => x && x.id === itemId);
          if (idx < 0) return json({ error: "资源不存在" }, 404, request);
          const cur = items[idx];
          const next = { ...cur };

          if (body.title != null) next.title = String(body.title || "").trim() || cur.title || "未命名资源";
          if (body.desc != null) next.desc = String(body.desc || "").trim();
          if (body.category != null) next.category = String(body.category || "other").trim() || "other";
          if (body.version != null) next.version = String(body.version || "—").trim() || "—";
          if (body.platform != null) next.platform = String(body.platform || "—").trim() || "—";
          if (body.size != null) next.size = String(body.size || "—").trim() || "—";

          if (body.links != null || body.downloadUrl != null) {
            const defaultChannel =
              cur.storage && cur.storage.type === "github-release" ? "github" : "direct";
            const links = normalizeLinks(body.links, body.downloadUrl, defaultChannel);
            if (!links.length) {
              return json({ error: "请至少保留一个有效外链（http/https）" }, 400, request);
            }
            next.links = links;
            next.downloadUrl = links[0].url;
          }

          next.updatedAt = new Date().toISOString().slice(0, 10);
          items[idx] = next;
          await writeCatalog(kv, items);
          return json({ ok: true, item: withNormalized(next) }, 200, request);
        }

        const links = normalizeLinks(body.links, body.downloadUrl, String(body.channel || "direct"));
        if (!links.length) {
          return json({ error: "请填写至少一个以 http(s):// 开头的下载地址" }, 400, request);
        }
        const newItemId = newId();
        const title = String(body.title || "").trim() || "未命名资源";
        const item = {
          id: newItemId,
          title,
          desc: String(body.desc || "").trim(),
          category: String(body.category || "other").trim() || "other",
          version: String(body.version || "—").trim() || "—",
          size: String(body.size || "—").trim() || "—",
          platform: String(body.platform || "—").trim() || "—",
          updatedAt: new Date().toISOString().slice(0, 10),
          storage: { type: "url" },
          links,
          downloadUrl: links[0].url,
          demo: false,
        };
        const items = await readCatalog(kv);
        items.unshift(item);
        await writeCatalog(kv, items);
        return json({ ok: true, item: withNormalized(item) }, 200, request);
      }

      if (/multipart\/form-data/i.test(ct)) {
        if (!r2 || typeof r2.put !== "function") {
          return json(
            {
              error:
                "当前未开通 R2（需绑卡）。请改用「添加外链」：把文件放到 GitHub Releases / 网盘，再登记下载地址。",
            },
            503,
            request
          );
        }
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          return json({ error: "缺少 file 字段" }, 400, request);
        }
        const buf = await file.arrayBuffer();
        if (!buf.byteLength) return json({ error: "空文件" }, 400, request);
        if (buf.byteLength > 95 * 1024 * 1024) {
          return json({ error: "单文件超过约 95MB" }, 413, request);
        }
        const itemId = newId();
        const fileName = safeName(file.name || form.get("title") || "file");
        const key = `files/${itemId}/${fileName}`;
        await r2.put(key, buf, {
          httpMetadata: { contentType: file.type || "application/octet-stream" },
        });
        const downloadUrl = `/api/library?id=${encodeURIComponent(itemId)}&download=1`;
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
          links: [{ url: downloadUrl, channel: "direct", label: "本站下载" }],
          downloadUrl,
          demo: false,
        };
        const items = await readCatalog(kv);
        items.unshift(item);
        await writeCatalog(kv, items);
        return json({ ok: true, item: withNormalized(item) }, 200, request);
      }

      return json({ error: "请提交 JSON（外链）或 multipart（R2 上传）" }, 400, request);
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
