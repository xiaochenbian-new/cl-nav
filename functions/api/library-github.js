/**
 * Cloudflare Pages Function — 上传到 GitHub Releases 并写入资源库目录
 * 路由：POST /api/library-github
 *
 * multipart 字段：
 * - file（必填）
 * - title, desc, category, version, platform（可选）
 * - ghOwner, ghRepo, ghToken（可选；也可用环境变量 GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN）
 *
 * Header: Authorization: Bearer <站点管理密码>
 */
const CATALOG_KEY = "library:catalog";
const DEFAULT_ADMIN = "xiaochenbian";

function cors(req) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function newId() {
  return "gh_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function newTag() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    "cl-nav-" +
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "-" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "-" +
    Math.random().toString(36).slice(2, 6)
  );
}

async function readCatalog(kv) {
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
      storageMode: "github-release",
      items,
    })
  );
}

async function ghFetch(path, token, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", "Bearer " + token);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "cl-nav-library");
  return fetch("https://api.github.com" + path, { ...init, headers });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405, request);
  }
  if (!isAdmin(request, env)) {
    return json({ error: "未授权：请先登录管理账号" }, 401, request);
  }

  const kv = env && env.CL_NAV_SYNC;
  if (!kv || typeof kv.get !== "function") {
    return json({ error: "未绑定 KV（CL_NAV_SYNC）" }, 503, request);
  }

  const ct = request.headers.get("Content-Type") || "";
  if (!/multipart\/form-data/i.test(ct)) {
    return json({ error: "请使用 multipart/form-data 上传文件" }, 400, request);
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ error: "缺少 file 字段" }, 400, request);
    }

    const owner = String(form.get("ghOwner") || env.GITHUB_OWNER || "")
      .trim()
      .replace(/^@/, "");
    const repo = String(form.get("ghRepo") || env.GITHUB_REPO || "").trim();
    const token = String(form.get("ghToken") || env.GITHUB_TOKEN || "").trim();

    if (!owner || !repo) {
      return json({ error: "请填写 GitHub 仓库：owner / repo（例如 xiaochenbian-new / cl-nav-files）" }, 400, request);
    }
    if (!token) {
      return json(
        {
          error:
            "请填写 GitHub Token（classic：勾选 repo；或 fine-grained：该仓库 Contents/Releases 写权限）",
        },
        400,
        request
      );
    }

    const buf = await file.arrayBuffer();
    if (!buf.byteLength) return json({ error: "空文件" }, 400, request);
    if (buf.byteLength > 95 * 1024 * 1024) {
      return json({ error: "单文件超过约 95MB（Cloudflare 请求体限制）" }, 413, request);
    }

    const fileName = safeName(file.name || form.get("title") || "file");
    const title = String(form.get("title") || fileName).trim() || fileName;
    const desc = String(form.get("desc") || "").trim();
    const category = String(form.get("category") || "other").trim() || "other";
    const version = String(form.get("version") || "—").trim() || "—";
    const platform = String(form.get("platform") || "—").trim() || "—";
    const tag = newTag();

    // 1) 创建 Release
    const createRes = await ghFetch(`/repos/${owner}/${repo}/releases`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: title,
        body: desc || `Uploaded via CL Nav · ${fileName}`,
        draft: false,
        prerelease: false,
      }),
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      const msg = createBody.message || "创建 Release 失败 HTTP " + createRes.status;
      let hint = "";
      if (createRes.status === 404) {
        hint =
          "。请核对：1) Owner=xiaochenbian-new 2) Repo=cl-nav-file（不要多 s）3) Token 若是 fine-grained，必须勾选该仓库，并给 Contents 读写权限；建议改用 classic 且勾选 repo";
      } else if (createRes.status === 401 || createRes.status === 403) {
        hint = "。Token 无效或权限不足：请重新生成 classic token 并勾选 repo，保存后再上传";
      }
      return json(
        { error: msg + hint, detail: createBody, repo: `${owner}/${repo}` },
        createRes.status === 401 ? 401 : 502,
        request
      );
    }

    const releaseId = createBody.id;
    if (!releaseId) return json({ error: "GitHub 未返回 release id", detail: createBody }, 502, request);

    // 2) 上传 Asset
    const uploadUrl =
      `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets` +
      `?name=${encodeURIComponent(fileName)}`;
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": file.type || "application/octet-stream",
        "Content-Length": String(buf.byteLength),
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cl-nav-library",
      },
      body: buf,
    });
    const upBody = await upRes.json().catch(() => ({}));
    if (!upRes.ok) {
      return json(
        {
          error: (upBody.message || "上传 Release 资源失败 HTTP " + upRes.status) + "（Release 可能已创建，请到 GitHub 仓库 Releases 检查）",
          detail: upBody,
          releaseUrl: createBody.html_url || "",
        },
        502,
        request
      );
    }

    const downloadUrl = upBody.browser_download_url || upBody.url;
    if (!downloadUrl) {
      return json({ error: "上传成功但未返回下载地址", detail: upBody }, 502, request);
    }

    // 3) 写入 KV 目录
    const itemId = newId();
    const item = {
      id: itemId,
      title,
      desc,
      category,
      version,
      size: formatSize(buf.byteLength),
      platform,
      updatedAt: new Date().toISOString().slice(0, 10),
      storage: {
        type: "github-release",
        owner,
        repo,
        tag,
        releaseId,
        assetId: upBody.id,
        fileName,
      },
      downloadUrl,
      demo: false,
    };

    const items = await readCatalog(kv);
    items.unshift(item);
    await writeCatalog(kv, items);

    return json(
      {
        ok: true,
        item,
        releaseUrl: createBody.html_url || "",
      },
      200,
      request
    );
  } catch (err) {
    return json(
      { error: "GitHub 上传异常：" + (err && err.message ? err.message : String(err)) },
      500,
      request
    );
  }
}
