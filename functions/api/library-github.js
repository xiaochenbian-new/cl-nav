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

/** 空格/特殊横线 → 普通横杠，避免 Owner 写成 xiaochenbian new */
function normalizeGhPart(s, kind) {
  let v = String(s || "")
    .trim()
    .replace(/^@/, "");
  v = v.replace(/[\u00A0\u3000]/g, " ");
  v = v.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  v = v.replace(/[\s_]+/g, "-");
  v = v.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (kind === "owner") v = v.toLowerCase();
  return v;
}

function readGhCreds(form, env) {
  const owner = normalizeGhPart(form.get("ghOwner") || env.GITHUB_OWNER || "", "owner");
  const repo = normalizeGhPart(form.get("ghRepo") || env.GITHUB_REPO || "", "repo");
  const token = String(form.get("ghToken") || env.GITHUB_TOKEN || "").trim();
  return { owner, repo, token };
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

function toBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function formatGhError(body, fallback) {
  let msg = (body && body.message) || fallback || "GitHub 请求失败";
  if (body && Array.isArray(body.errors) && body.errors.length) {
    const parts = body.errors.map((e) => {
      if (e && e.message) return e.message;
      return [e && e.resource, e && e.field, e && e.code].filter(Boolean).join(".");
    });
    msg += "（" + parts.join("；") + "）";
  }
  return msg;
}

/** 空仓库无法创建 Release：用分支/文件探测，必要时自动写 README */
async function ensureRepoNotEmpty(owner, repo, token) {
  const repoRes = await ghFetch(`/repos/${owner}/${repo}`, token);
  const repoBody = await repoRes.json().catch(() => ({}));
  if (!repoRes.ok) {
    return { ok: false, error: formatGhError(repoBody, "无法读取仓库"), detail: repoBody, status: repoRes.status };
  }

  const defaultBranch = String(repoBody.default_branch || "main").trim() || "main";

  async function hasBranchTip(branch) {
    const refRes = await ghFetch(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      token
    );
    return refRes.ok;
  }

  async function hasAnyContent() {
    const rootRes = await ghFetch(`/repos/${owner}/${repo}/contents/`, token);
    if (rootRes.ok) return true;
    const readmeRes = await ghFetch(`/repos/${owner}/${repo}/contents/README.md`, token);
    return readmeRes.ok;
  }

  // size 字段对新仓库经常滞后，优先看分支 tip / 根目录
  if (await hasBranchTip(defaultBranch)) {
    return { ok: true, repo: repoBody, initialized: false };
  }
  if (defaultBranch !== "master" && (await hasBranchTip("master"))) {
    return { ok: true, repo: { ...repoBody, default_branch: "master" }, initialized: false };
  }
  if (await hasAnyContent()) {
    return { ok: true, repo: repoBody, initialized: false };
  }
  if (Number(repoBody.size) > 0) {
    return { ok: true, repo: repoBody, initialized: false };
  }

  const readmePath = `/repos/${owner}/${repo}/contents/README.md`;
  const readmeBody =
    "# cl-nav-file\n\nAuto-created by CL Nav so GitHub Releases can attach download files.\n";

  // 若文件已存在，PUT 必须带 sha；先 GET 再决定 create/update
  const existingRes = await ghFetch(readmePath, token);
  const existingBody = await existingRes.json().catch(() => ({}));
  const payload = {
    message: "chore: initial commit for GitHub Releases",
    content: toBase64(readmeBody),
    branch: defaultBranch,
  };
  if (existingRes.ok && existingBody && existingBody.sha) {
    // 已有 README：仓库其实不空，直接可用
    return { ok: true, repo: repoBody, initialized: false };
  }

  const putRes = await ghFetch(readmePath, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const putBody = await putRes.json().catch(() => ({}));
  if (putRes.ok) {
    return { ok: true, repo: repoBody, initialized: true };
  }

  const msg = formatGhError(putBody, "空仓库初始化失败");
  // 并发/二次上传：文件已存在但未带 sha → 说明已有 commit，可继续
  if (/sha/i.test(msg) || putRes.status === 409 || putRes.status === 422) {
    if (await hasAnyContent() || (await hasBranchTip(defaultBranch))) {
      return { ok: true, repo: repoBody, initialized: false };
    }
    // 再试一次：带上 sha 更新（有时 GET 与 PUT 之间刚创建出来）
    const again = await ghFetch(readmePath, token);
    const againBody = await again.json().catch(() => ({}));
    if (again.ok && againBody.sha) {
      const upd = await ghFetch(readmePath, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sha: againBody.sha }),
      });
      if (upd.ok) return { ok: true, repo: repoBody, initialized: true };
      // 即使更新失败，有 sha 就说明仓库已有提交
      return { ok: true, repo: repoBody, initialized: false };
    }
  }

  return {
    ok: false,
    error: msg + "。请打开仓库确认已有至少一次提交，或给 Token 勾选 repo / Contents 写权限",
    detail: putBody,
    status: putRes.status,
  };
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
    const { owner, repo, token } = readGhCreds(form, env);
    const action = String(form.get("action") || "upload").trim().toLowerCase();

    if (!owner || !repo) {
      return json(
        { error: "请填写 GitHub 仓库：owner / repo（例如 xiaochenbian-new / cl-nav-file）" },
        400,
        request
      );
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

    // 仅测试 Token + 仓库，不上传文件
    if (action === "test") {
      const repoRes = await ghFetch(`/repos/${owner}/${repo}`, token);
      const repoBody = await repoRes.json().catch(() => ({}));
      if (!repoRes.ok) {
        const msg = formatGhError(repoBody, "无法访问仓库 HTTP " + repoRes.status);
        let hint = "";
        if (repoRes.status === 404) {
          hint =
            "。请核对仓库是 xiaochenbian-new/cl-nav-file，且 Token 勾选了 repo（或 fine-grained 勾选该仓库）";
        } else if (repoRes.status === 401 || repoRes.status === 403) {
          hint = "。Token 无效或权限不足，请重新生成 classic token 并勾选 repo";
        }
        return json({ error: msg + hint, repo: `${owner}/${repo}` }, 502, request);
      }
      const empty = !(Number(repoBody.size) > 0);
      // size 可能滞后：再探一下默认分支
      let reallyEmpty = empty;
      if (empty) {
        const br = String(repoBody.default_branch || "main");
        const refRes = await ghFetch(
          `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(br)}`,
          token
        );
        reallyEmpty = !refRes.ok;
      }
      return json(
        {
          ok: true,
          message: reallyEmpty
            ? "连接成功（仓库还是空的，首次上传会自动初始化）"
            : "连接成功，可以上传",
          empty: reallyEmpty,
          repo: `${owner}/${repo}`,
          htmlUrl: repoBody.html_url || `https://github.com/${owner}/${repo}`,
          private: !!repoBody.private,
          permissions: repoBody.permissions || null,
        },
        200,
        request
      );
    }

    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ error: "缺少 file 字段：请点蓝色按钮选择要上传的文件" }, 400, request);
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

    const ready = await ensureRepoNotEmpty(owner, repo, token);
    if (!ready.ok) {
      return json(
        { error: ready.error, detail: ready.detail, repo: `${owner}/${repo}` },
        ready.status === 401 ? 401 : 502,
        request
      );
    }

    const defaultBranch = (ready.repo && ready.repo.default_branch) || "main";

    // 1) 创建 Release
    const createRes = await ghFetch(`/repos/${owner}/${repo}/releases`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: defaultBranch,
        name: title,
        body: desc || `Uploaded via CL Nav · ${fileName}`,
        draft: false,
        prerelease: false,
      }),
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      let msg = formatGhError(createBody, "创建 Release 失败 HTTP " + createRes.status);
      let hint = "";
      if (createRes.status === 404) {
        hint =
          "。请核对：1) Owner=xiaochenbian-new 2) Repo=cl-nav-file（不要多 s）3) Token 若是 fine-grained，必须勾选该仓库，并给 Contents 读写权限；建议改用 classic 且勾选 repo";
      } else if (createRes.status === 401 || createRes.status === 403) {
        hint = "。Token 无效或权限不足：请重新生成 classic token 并勾选 repo，保存后再上传";
      } else if (createRes.status === 422 || /validation failed/i.test(msg)) {
        hint =
          "。常见原因：仓库没有任何提交。请打开 https://github.com/" +
          owner +
          "/" +
          repo +
          " 点 Add a README 提交一次，或确认 Token 有 Contents 写权限";
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
      links: [{ url: downloadUrl, channel: "github", label: "GitHub Release" }],
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
