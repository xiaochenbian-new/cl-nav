/** CL Nav — 资源库：KV 目录 + 外链下载（无需 R2 / 绑卡） */
(function () {
  const DEFAULT_CATEGORIES = [
    { id: "software", name: "软件" },
    { id: "installer", name: "安装包" },
    { id: "docs", name: "文档" },
    { id: "driver", name: "驱动" },
    { id: "other", name: "其他" },
  ];

  const DEFAULT_SIDEBAR_LINKS = [
    { id: "pan123", name: "123网盘", url: "https://www.123pan.com/" },
    { id: "baidu", name: "百度网盘", url: "https://pan.baidu.com/" },
  ];

  window.LIBRARY_DATA = {
    brand: "CL Nav",
    title: "资源库",
    tagline: "软件 · 安装包 · 常用资源",
    storageMode: "url",
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    sidebarLinks: DEFAULT_SIDEBAR_LINKS.map((c) => ({ ...c })),
    items: [],
  };

  const API = "/api/library";
  const API_GH = "/api/library-github";
  const GH_PREFS_KEY = "cl-nav-github-release-v1";
  const GH_DEFAULTS = { owner: "xiaochenbian-new", repo: "cl-nav-file" };
  /** Cloudflare Free/Pro 请求体上限约 100MB，留余量后按 95MB 拦截 */
  const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

  function apiUrl(path) {
    return window.ClNavApi?.url?.(path) || path;
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + " B";
    if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10 * 1024 ? 1 : 0) + " KB";
    return (v / (1024 * 1024)).toFixed(1) + " MB";
  }

  function normalizeCategories(list) {
    const seen = new Set();
    const out = [];
    const src = Array.isArray(list) && list.length ? list : DEFAULT_CATEGORIES;
    for (const c of src) {
      if (!c) continue;
      let id = String(c.id || "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 40);
      if (!id || id === "all") continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: String(c.name || id).trim().slice(0, 40) || id });
    }
    if (!out.length) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    if (!out.some((c) => c.id === "other")) out.push({ id: "other", name: "其他" });
    return out;
  }

  function normalizeSidebarLinks(list, { allowEmpty = true } = {}) {
    if (!Array.isArray(list)) return DEFAULT_SIDEBAR_LINKS.map((c) => ({ ...c }));
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      if (!raw) continue;
      const name = String(raw.name || "").trim().slice(0, 40);
      let url = String(raw.url || raw.href || "").trim();
      if (!name || !url) continue;
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      let id = String(raw.id || "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 40);
      if (!id) id = "link_" + Math.random().toString(36).slice(2, 8);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name, url: url.slice(0, 500) });
    }
    if (!out.length && !allowEmpty) return DEFAULT_SIDEBAR_LINKS.map((c) => ({ ...c }));
    return out;
  }

  function uiCategories() {
    return [{ id: "all", name: "全部" }, ...normalizeCategories(LIBRARY_DATA.categories)];
  }

  function categoryOptionsHtml(selected, { includeAll = false } = {}) {
    const list = includeAll ? uiCategories() : normalizeCategories(LIBRARY_DATA.categories);
    return list
      .map((c) => {
        const sel = c.id === selected ? " selected" : "";
        return `<option value="${String(c.id).replace(/"/g, "&quot;")}"${sel}>${String(c.name)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</option>`;
      })
      .join("");
  }

  function markSyncDirty() {
    try {
      window.NavWebDav?.markDirty?.();
    } catch (_) {}
    try {
      window.NavCfSync?.markDirty?.();
    } catch (_) {}
  }

  function newCatId(name) {
    const base = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "")
      .slice(0, 24);
    let id = base || "cat";
    if (id === "all") id = "cat";
    const existing = new Set(normalizeCategories(LIBRARY_DATA.categories).map((c) => c.id));
    if (!existing.has(id)) return id;
    return id + "_" + Math.random().toString(36).slice(2, 6);
  }

  function normalizeGhPart(s, kind) {
    let v = String(s || "")
      .trim()
      .replace(/^@/, "");
    // 全角空格、各种横线 → 统一
    v = v.replace(/[\u00A0\u3000]/g, " ");
    v = v.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
    // 空格、下划线多余分隔 → 横杠
    v = v.replace(/[\s_]+/g, "-");
    v = v.replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (kind === "owner") v = v.toLowerCase();
    return v;
  }

  function loadGhPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(GH_PREFS_KEY) || "{}");
      return {
        owner: normalizeGhPart(raw.owner || GH_DEFAULTS.owner, "owner") || GH_DEFAULTS.owner,
        repo: normalizeGhPart(raw.repo || GH_DEFAULTS.repo, "repo") || GH_DEFAULTS.repo,
        token: String(raw.token || "").trim(),
      };
    } catch {
      return { owner: GH_DEFAULTS.owner, repo: GH_DEFAULTS.repo, token: "" };
    }
  }

  function saveGhPrefs(patch) {
    const cur = loadGhPrefs();
    const next = {
      owner: normalizeGhPart(patch.owner != null ? patch.owner : cur.owner, "owner"),
      repo: normalizeGhPart(patch.repo != null ? patch.repo : cur.repo, "repo"),
      token: String(patch.token != null ? patch.token : cur.token || "").trim(),
    };
    localStorage.setItem(GH_PREFS_KEY, JSON.stringify(next));
    return next;
  }

  function authHeaders(json) {
    const h = {};
    if (window.NavAuth?.isLoggedIn?.()) {
      h.Authorization = "Bearer " + (window.NavAuth.adminPass?.() || "xiaochenbian");
    }
    if (json) h["Content-Type"] = "application/json; charset=utf-8";
    return h;
  }

  function isFileProtocol() {
    return typeof location !== "undefined" && location.protocol === "file:";
  }

  async function api(method, { id, download, body, headers } = {}) {
    let url = apiUrl(API);
    const q = [];
    if (id) q.push("id=" + encodeURIComponent(id));
    if (download) q.push("download=1");
    if (q.length) url += (url.includes("?") ? "&" : "?") + q.join("&");

    const init = { method, headers: { ...(headers || {}) }, cache: "no-store" };
    if (body != null) init.body = body;

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new Error("无法连接资源库接口 " + apiUrl(API));
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) {
      throw new Error(
        "云端还是旧版本（/api/library 未生效）。请到 Cloudflare Pages → Deployments 对最新提交 Retry deployment。"
      );
    }
    return res;
  }

  const LINK_CHANNELS = [
    { id: "github", name: "GitHub" },
    { id: "lanzou", name: "蓝奏云" },
    { id: "baidu", name: "百度网盘" },
    { id: "quark", name: "夸克网盘" },
    { id: "aliyun", name: "阿里云盘" },
    { id: "123", name: "123网盘" },
    { id: "direct", name: "直链" },
    { id: "other", name: "其他" },
  ];

  function channelName(id) {
    const hit = LINK_CHANNELS.find((c) => c.id === id);
    return hit ? hit.name : id || "其他";
  }

  /** 从 label / 说明里解析提取码 */
  function extractCode(label) {
    const s = String(label || "").trim();
    if (!s) return "";
    const m = /(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{3,8})/i.exec(s);
    if (m) return m[1];
    if (/^[a-zA-Z0-9]{4}$/.test(s)) return s;
    return "";
  }

  function linkButtonName(link) {
    if (!link) return "下载";
    const ch = channelName(link.channel);
    if (link.channel === "github") return "GitHub Release";
    if (link.channel === "direct" || link.channel === "other") {
      // 无明确渠道时才用自定义短标签（排除提取码文案）
      const lab = String(link.label || "").trim();
      if (lab && !/(?:提取码|密码|pwd)/i.test(lab) && !extractCode(lab)) {
        return lab.slice(0, 12);
      }
    }
    return ch || "下载";
  }

  function itemLinks(item) {
    if (!item) return [];
    if (Array.isArray(item.links) && item.links.length) {
      return item.links
        .map((l) => ({
          url: String(l.url || "").trim(),
          channel: String(l.channel || "other").trim() || "other",
          label: String(l.label || "").trim(),
        }))
        .filter((l) => /^https?:\/\//i.test(l.url) || l.url.startsWith("/api/"));
    }
    if (item.downloadUrl) {
      const ch = item.storage && item.storage.type === "github-release" ? "github" : "direct";
      return [{ url: item.downloadUrl, channel: ch, label: "" }];
    }
    return [];
  }

  window.LibraryStorage = {
    mode() {
      return LIBRARY_DATA.storageMode || "url";
    },

    channels: LINK_CHANNELS,
    channelName,
    extractCode,
    linkButtonName,
    itemLinks,

    async list() {
      const res = await api("GET");
      if (res.status === 503) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "KV 未绑定");
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "读取目录失败 HTTP " + res.status);
      }
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      LIBRARY_DATA.items = items;
      LIBRARY_DATA.categories = normalizeCategories(data.categories);
      LIBRARY_DATA.sidebarLinks = normalizeSidebarLinks(data.sidebarLinks);
      LIBRARY_DATA.storageMode = data.storageMode || "url";
      return items.slice();
    },

    defaultCategories: DEFAULT_CATEGORIES,
    defaultSidebarLinks: DEFAULT_SIDEBAR_LINKS,
    normalizeCategories,
    normalizeSidebarLinks,
    uiCategories,
    categoryOptionsHtml,
    newCatId,

    async saveCategories(categories) {
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再管理分类");
      const next = normalizeCategories(categories);
      const res = await api("POST", {
        body: JSON.stringify({ action: "categoriesSave", categories: next }),
        headers: authHeaders(true),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "保存分类失败 HTTP " + res.status);
      LIBRARY_DATA.categories = normalizeCategories(j.categories || next);
      if (j.sidebarLinks) LIBRARY_DATA.sidebarLinks = normalizeSidebarLinks(j.sidebarLinks);
      markSyncDirty();
      return LIBRARY_DATA.categories.slice();
    },

    async saveSidebarLinks(links) {
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再管理侧栏入口");
      const next = normalizeSidebarLinks(links, { allowEmpty: true });
      const res = await api("POST", {
        body: JSON.stringify({ action: "sidebarLinksSave", sidebarLinks: next }),
        headers: authHeaders(true),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "保存侧栏入口失败 HTTP " + res.status);
      LIBRARY_DATA.sidebarLinks = normalizeSidebarLinks(j.sidebarLinks || next, { allowEmpty: true });
      markSyncDirty();
      return LIBRARY_DATA.sidebarLinks.slice();
    },

    async exportCatalog() {
      try {
        await this.list();
      } catch (_) {}
      return {
        version: 1,
        categories: normalizeCategories(LIBRARY_DATA.categories),
        sidebarLinks: normalizeSidebarLinks(LIBRARY_DATA.sidebarLinks, { allowEmpty: true }),
        items: Array.isArray(LIBRARY_DATA.items) ? LIBRARY_DATA.items.slice() : [],
        storageMode: LIBRARY_DATA.storageMode || "url",
      };
    },

    async importCatalog(catalog) {
      if (!catalog || typeof catalog !== "object") return false;
      const categories = normalizeCategories(catalog.categories);
      const items = Array.isArray(catalog.items) ? catalog.items : [];
      const sidebarLinks =
        catalog.sidebarLinks !== undefined
          ? normalizeSidebarLinks(catalog.sidebarLinks, { allowEmpty: true })
          : undefined;
      const headers = authHeaders(true);
      if (!headers.Authorization) {
        headers.Authorization = "Bearer " + (window.NavAuth?.adminPass?.() || "xiaochenbian");
      }
      const body = { action: "replaceCatalog", categories, items };
      if (sidebarLinks) body.sidebarLinks = sidebarLinks;
      const res = await api("POST", {
        body: JSON.stringify(body),
        headers,
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "导入资源库失败 HTTP " + res.status);
      LIBRARY_DATA.categories = normalizeCategories(j.categories || categories);
      LIBRARY_DATA.items = Array.isArray(j.items) ? j.items : items;
      LIBRARY_DATA.sidebarLinks = normalizeSidebarLinks(
        j.sidebarLinks !== undefined ? j.sidebarLinks : sidebarLinks,
        { allowEmpty: true }
      );
      return true;
    },

    /** 把资源库目录并入导航备份 JSON（WebDAV / CF 同步用） */
    async enrichBackupJson(jsonText) {
      const obj = typeof jsonText === "string" ? JSON.parse(jsonText) : { ...(jsonText || {}) };
      obj.library = await this.exportCatalog();
      obj.exportedAt = Date.now();
      return JSON.stringify(obj, null, 2);
    },

    async applyBackupLibrary(remoteTextOrObj) {
      let obj = remoteTextOrObj;
      if (typeof obj === "string") {
        try {
          obj = JSON.parse(obj);
        } catch {
          return false;
        }
      }
      if (!obj || !obj.library) return false;
      await this.importCatalog(obj.library);
      return true;
    },

    async getDownloadUrl(item, link) {
      if (link?.url) {
        if (/^https?:\/\//i.test(link.url)) return link.url;
        if (link.url.startsWith("/")) return link.url;
      }
      const links = itemLinks(item);
      if (links[0]?.url && /^https?:\/\//i.test(links[0].url)) return links[0].url;
      if (item?.downloadUrl && /^https?:\/\//i.test(item.downloadUrl)) return item.downloadUrl;
      if (item?.id) return API + "?id=" + encodeURIComponent(item.id) + "&download=1";
      if (item?.downloadUrl) return item.downloadUrl;
      throw new Error("该资源没有下载地址");
    },

    /** 登记外链（可多条） */
    async addLink(meta = {}) {
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再添加");
      let links = Array.isArray(meta.links) ? meta.links.slice() : [];
      if (!links.length && meta.downloadUrl) {
        links = [
          {
            url: meta.downloadUrl,
            channel: meta.channel || "direct",
            label: meta.linkLabel || "",
          },
        ];
      }
      links = links
        .map((l) => ({
          url: String(l.url || "").trim(),
          channel: String(l.channel || "other").trim() || "other",
          label: String(l.label || "").trim(),
        }))
        .filter((l) => /^https?:\/\//i.test(l.url));
      if (!links.length) throw new Error("请填写至少一个以 http(s):// 开头的下载地址");

      const res = await api("POST", {
        body: JSON.stringify({
          action: "create",
          title: meta.title || "未命名资源",
          desc: meta.desc || "",
          category: meta.category || "other",
          version: meta.version || "—",
          size: meta.size || "—",
          platform: meta.platform || "—",
          links,
          downloadUrl: links[0].url,
        }),
        headers: authHeaders(true),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "添加失败 HTTP " + res.status);
      if (j.item) {
        LIBRARY_DATA.items = LIBRARY_DATA.items || [];
        LIBRARY_DATA.items.unshift(j.item);
      }
      markSyncDirty();
      return j.item;
    },

    /** 批量登记外链资源（多网盘一键导入） */
    async addLinks(list = []) {
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再添加");
      const items = (Array.isArray(list) ? list : [])
        .map((meta) => {
          let links = Array.isArray(meta.links) ? meta.links.slice() : [];
          if (!links.length && meta.downloadUrl) {
            links = [
              {
                url: meta.downloadUrl,
                channel: meta.channel || "direct",
                label: meta.linkLabel || "",
              },
            ];
          }
          links = links
            .map((l) => ({
              url: String(l.url || "").trim(),
              channel: String(l.channel || "other").trim() || "other",
              label: String(l.label || "").trim(),
            }))
            .filter((l) => /^https?:\/\//i.test(l.url));
          if (!links.length) return null;
          return {
            title: meta.title || "未命名资源",
            desc: meta.desc || "",
            category: meta.category || "other",
            version: meta.version || "—",
            size: meta.size || "—",
            platform: meta.platform || "—",
            links,
            downloadUrl: links[0].url,
          };
        })
        .filter(Boolean);
      if (!items.length) throw new Error("没有可添加的有效链接");

      const res = await api("POST", {
        body: JSON.stringify({ action: "createMany", items }),
        headers: authHeaders(true),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "批量添加失败 HTTP " + res.status);
      const created = Array.isArray(j.items) ? j.items : [];
      if (created.length) {
        LIBRARY_DATA.items = LIBRARY_DATA.items || [];
        LIBRARY_DATA.items = created.concat(LIBRARY_DATA.items);
      }
      markSyncDirty();
      return created;
    },

    /** 更新说明 / 外链等 */
    async update(id, patch = {}) {
      if (!id) throw new Error("缺少 id");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再保存");
      const body = { action: "update", id, ...patch };
      if (Array.isArray(patch.links)) {
        body.links = patch.links
          .map((l) => ({
            url: String(l.url || "").trim(),
            channel: String(l.channel || "other").trim() || "other",
            label: String(l.label || "").trim(),
          }))
          .filter((l) => /^https?:\/\//i.test(l.url) || String(l.url || "").startsWith("/api/"));
        if (!body.links.length) throw new Error("请至少保留一个有效外链");
      }
      const res = await api("POST", {
        body: JSON.stringify(body),
        headers: authHeaders(true),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "保存失败 HTTP " + res.status);
      if (j.item) {
        LIBRARY_DATA.items = (LIBRARY_DATA.items || []).map((x) => (x.id === id ? j.item : x));
      }
      markSyncDirty();
      return j.item;
    },

    async upload(file, meta = {}) {
      if (meta && meta.downloadUrl) return this.addLink({ ...meta, title: meta.title || (file && file.name) });
      return this.uploadToGitHub(file, meta);
    },

    /** 测试 Token 能否访问目标仓库（不上传文件） */
    async testGitHub(prefs) {
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再测试");
      if (typeof location !== "undefined" && location.protocol === "file:") {
        throw new Error("请用 Cloudflare Pages 打开后再测试");
      }
      const gh = { ...loadGhPrefs(), ...(prefs || {}) };
      gh.owner = normalizeGhPart(gh.owner, "owner");
      gh.repo = normalizeGhPart(gh.repo, "repo");
      gh.token = String(gh.token || "").trim();
      if (!gh.owner || !gh.repo) throw new Error("请先填写仓库 Owner / Repo");
      if (!gh.token) throw new Error("请先填写 GitHub Token");

      const fd = new FormData();
      fd.append("action", "test");
      fd.append("ghOwner", gh.owner);
      fd.append("ghRepo", gh.repo);
      fd.append("ghToken", gh.token);

      let res;
      try {
        res = await fetch(apiUrl(API_GH), {
          method: "POST",
          headers: authHeaders(false),
          body: fd,
          cache: "no-store",
        });
      } catch (err) {
        throw new Error("无法连接 " + apiUrl(API_GH));
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html")) {
        throw new Error("接口未部署：请确认 Cloudflare 已部署最新 Functions");
      }
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "测试失败 HTTP " + res.status);
      return j;
    },

    /** 上传到 GitHub Releases，并自动写入资源库目录
     * @param {File} file
     * @param {object} meta
     * @param {Function|{ onProgress?: Function, signal?: AbortSignal }} [onProgressOrOpts]
     */
    async uploadToGitHub(file, meta = {}, onProgressOrOpts) {
      if (!file) throw new Error("未选择文件");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再上传");
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          "「" +
            (file.name || "文件") +
            "」约 " +
            formatBytes(file.size) +
            "，超过上限 " +
            formatBytes(MAX_UPLOAD_BYTES) +
            "（Cloudflare 请求体限制）。请压缩后上传，或改用外链登记大文件。"
        );
      }
      if (typeof location !== "undefined" && location.protocol === "file:" && !window.ClNavApi?.origin?.()) {
        throw new Error("请用 Cloudflare / GitHub Pages 打开后再上传");
      }

      const opts =
        typeof onProgressOrOpts === "function"
          ? { onProgress: onProgressOrOpts }
          : onProgressOrOpts && typeof onProgressOrOpts === "object"
            ? onProgressOrOpts
            : {};
      const onProgress = opts.onProgress;
      const signal = opts.signal;

      const gh = { ...loadGhPrefs(), ...(meta.github || {}) };
      gh.owner = normalizeGhPart(gh.owner, "owner");
      gh.repo = normalizeGhPart(gh.repo, "repo");
      gh.token = String(gh.token || "").trim();
      if (!gh.owner || !gh.repo) throw new Error("请先填写并保存 GitHub 仓库 owner / repo");
      if (!gh.token) throw new Error("请先填写并保存 GitHub Token");
      if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i.test(gh.owner)) {
        throw new Error("Owner 格式不正确，应为 xiaochenbian-new（只能字母数字和横杠）");
      }
      if (!/^[A-Za-z0-9_.-]+$/.test(gh.repo)) {
        throw new Error("Repo 格式不正确，应为 cl-nav-file（不能有空格）");
      }

      const fd = new FormData();
      fd.append("action", "upload");
      fd.append("file", file, file.name);
      fd.append("title", meta.title || file.name);
      fd.append("desc", meta.desc || "");
      fd.append("category", meta.category || "other");
      fd.append("version", meta.version || "—");
      fd.append("platform", meta.platform || "—");
      fd.append("ghOwner", gh.owner);
      fd.append("ghRepo", gh.repo);
      fd.append("ghToken", gh.token);

      const notify = (info) => {
        try {
          if (typeof onProgress === "function") onProgress(info);
        } catch (_) {}
      };

      const cancelledErr = () => Object.assign(new Error("已取消上传"), { cancelled: true });

      if (signal?.aborted) throw cancelledErr();

      notify({ ratio: 0, phase: "upload", loaded: 0, total: file.size || 0 });

      const j = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", apiUrl(API_GH));
        xhr.responseType = "text";
        xhr.timeout = 15 * 60 * 1000;

        const headers = authHeaders(false);
        Object.keys(headers).forEach((k) => {
          try {
            xhr.setRequestHeader(k, headers[k]);
          } catch (_) {}
        });

        const onAbort = () => {
          try {
            xhr.abort();
          } catch (_) {}
        };
        if (signal) signal.addEventListener("abort", onAbort);

        const cleanup = () => {
          if (signal) signal.removeEventListener("abort", onAbort);
        };

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) {
            notify({ ratio: 0.05, phase: "upload" });
            return;
          }
          const ratio = Math.max(0, Math.min(0.95, e.loaded / e.total));
          notify({ ratio, phase: "upload", loaded: e.loaded, total: e.total });
        };

        xhr.upload.onload = () => {
          notify({ ratio: 0.96, phase: "server", loaded: file.size, total: file.size });
        };

        xhr.onabort = () => {
          cleanup();
          reject(cancelledErr());
        };
        xhr.onerror = () => {
          cleanup();
          reject(new Error("无法连接 " + apiUrl(API_GH)));
        };
        xhr.ontimeout = () => {
          cleanup();
          reject(new Error("上传超时，请稍后重试或换较小文件"));
        };

        xhr.onload = () => {
          cleanup();
          const ct = (xhr.getResponseHeader("content-type") || "").toLowerCase();
          const raw = String(xhr.responseText || "");
          if (xhr.status === 413) {
            reject(
              new Error(
                "文件过大（超过约 " +
                  formatBytes(MAX_UPLOAD_BYTES) +
                  "）。进度到 100% 只表示浏览器发完了，Cloudflare 会拒绝更大请求。"
              )
            );
            return;
          }
          if (ct.includes("text/html") || (raw && raw.trimStart().startsWith("<"))) {
            reject(
              new Error(
                xhr.status >= 500
                  ? "上传接口异常 HTTP " + xhr.status + "（可能超时或文件过大）"
                  : "接口未部署或返回了错误页 HTTP " + xhr.status
              )
            );
            return;
          }
          let data = {};
          try {
            data = JSON.parse(raw || "{}");
          } catch (_) {
            data = {};
          }
          if (xhr.status === 401) {
            reject(new Error(data.error || "未授权，请重新登录"));
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(data.error || "GitHub 上传失败 HTTP " + xhr.status));
            return;
          }
          notify({ ratio: 1, phase: "done" });
          resolve(data);
        };

        xhr.send(fd);
      });

      if (j.item) {
        LIBRARY_DATA.items = LIBRARY_DATA.items || [];
        LIBRARY_DATA.items.unshift(j.item);
      }
      markSyncDirty();
      return j.item;
    },

    loadGhPrefs,
    saveGhPrefs,
    normalizeGhPart,
    MAX_UPLOAD_BYTES,
    formatBytes,

    async remove(id) {
      if (!id) throw new Error("缺少 id");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再删除");
      const res = await api("DELETE", { id, headers: authHeaders(false) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "删除失败 HTTP " + res.status);
      LIBRARY_DATA.items = (LIBRARY_DATA.items || []).filter((x) => x.id !== id);
      markSyncDirty();
      return true;
    },

    async removeMany(ids) {
      const list = (Array.isArray(ids) ? ids : []).map((x) => String(x || "").trim()).filter(Boolean);
      if (!list.length) throw new Error("请先勾选要删除的资源");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再删除");
      const res = await api("POST", {
        body: JSON.stringify({ action: "deleteMany", ids: list }),
        headers: authHeaders(true),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "批量删除失败 HTTP " + res.status);
      const gone = new Set(list);
      LIBRARY_DATA.items = (LIBRARY_DATA.items || []).filter((x) => !gone.has(x.id));
      markSyncDirty();
      return j.deleted || list.length;
    },
  };

  function escUpload(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** 多文件上传队列：最多同时 3 个，可取消；关闭设置后进度仍可渲染 */
  window.LibUploadQueue = {
    MAX_CONCURRENT: 3,
    jobs: [],
    _subs: new Set(),
    _running: 0,
    _pumping: false,

    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      this._subs.add(fn);
      try {
        fn(this.visibleJobs());
      } catch (_) {}
      return () => this._subs.delete(fn);
    },

    notify() {
      const snap = this.visibleJobs();
      this._subs.forEach((fn) => {
        try {
          fn(snap);
        } catch (_) {}
      });
    },

    visibleJobs() {
      return this.jobs.filter((j) => j.status !== "gone");
    },

    hasActive() {
      return this.jobs.some((j) => j.status === "queued" || j.status === "uploading" || j.status === "server");
    },

    enqueue(files, meta = {}) {
      const list = [...(files || [])].filter(Boolean);
      if (!list.length) return [];
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再上传");
      const tooBig = list.filter((f) => f && f.size > MAX_UPLOAD_BYTES);
      if (tooBig.length) {
        const names = tooBig
          .slice(0, 3)
          .map((f) => "「" + f.name + "」" + formatBytes(f.size))
          .join("、");
        throw new Error(
          "以下文件超过上限 " +
            formatBytes(MAX_UPLOAD_BYTES) +
            "：" +
            names +
            (tooBig.length > 3 ? " 等" : "") +
            "。请压缩后上传，或用「外链」登记网盘/直链地址。"
        );
      }
      const ids = [];
      for (const file of list) {
        const id = "up_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
        this.jobs.push({
          id,
          file,
          name: file.name || "未命名文件",
          status: "queued",
          ratio: 0,
          message: "排队中",
          error: "",
          controller: null,
          item: null,
          meta: { ...meta },
        });
        ids.push(id);
      }
      this.notify();
      this.pump();
      return ids;
    },

    cancel(id) {
      const job = this.jobs.find((j) => j.id === id);
      if (!job) return;
      if (job.status === "queued") {
        job.status = "cancelled";
        job.message = "已取消";
        this._forgetLater(job);
        this.notify();
        return;
      }
      if (job.controller) {
        try {
          job.controller.abort();
        } catch (_) {}
      } else {
        job.status = "cancelled";
        job.message = "已取消";
        this._forgetLater(job);
        this.notify();
      }
    },

    _forgetLater(job, ms = 2200) {
      window.setTimeout(() => {
        job.status = "gone";
        this.jobs = this.jobs.filter((j) => j.status !== "gone");
        this.notify();
      }, ms);
    },

    pump() {
      if (this._pumping) return;
      this._pumping = true;
      try {
        while (this._running < this.MAX_CONCURRENT) {
          const next = this.jobs.find((j) => j.status === "queued");
          if (!next) break;
          this._start(next);
        }
      } finally {
        this._pumping = false;
      }
    },

    async _start(job) {
      this._running += 1;
      job.status = "uploading";
      job.message = "上传中 0%";
      job.ratio = 0;
      const ac = new AbortController();
      job.controller = ac;
      this.notify();
      try {
        const item = await LibraryStorage.uploadToGitHub(
          job.file,
          {
            title: job.meta.title || job.file.name,
            desc: job.meta.desc || "",
            category: job.meta.category || "other",
          },
          {
            signal: ac.signal,
            onProgress: (info) => {
              if (job.status === "cancelled") return;
              if (info.phase === "upload") {
                job.status = "uploading";
                job.ratio = info.ratio || 0;
                job.message = "上传中 " + Math.round(job.ratio * 100) + "%";
              } else if (info.phase === "server") {
                job.status = "server";
                job.ratio = 0.97;
                job.message = "创建 Release…";
              } else if (info.phase === "done") {
                job.ratio = 1;
                job.message = "完成";
              }
              this.notify();
            },
          }
        );
        job.item = item;
        job.status = "done";
        job.ratio = 1;
        job.message = "上传成功";
        this._forgetLater(job, 1800);
        try {
          window.dispatchEvent(new CustomEvent("cl-nav-lib-uploaded", { detail: { item, jobId: job.id } }));
        } catch (_) {}
      } catch (err) {
        if (err?.cancelled || ac.signal.aborted) {
          job.status = "cancelled";
          job.message = "已取消";
        } else {
          job.status = "error";
          job.error = err?.message || "上传失败";
          job.message = job.error;
        }
        this._forgetLater(job, job.status === "error" ? 4500 : 1800);
      } finally {
        job.controller = null;
        this._running = Math.max(0, this._running - 1);
        this.notify();
        this.pump();
      }
    },

    renderDock(container) {
      if (!container) return;
      const jobs = this.visibleJobs();
      if (!jobs.length) {
        container.hidden = true;
        container.innerHTML = "";
        return;
      }
      container.hidden = false;
      container.innerHTML = jobs
        .map((j) => {
          const pct = Math.round((j.ratio || 0) * 100);
          const canCancel = j.status === "queued" || j.status === "uploading" || j.status === "server";
          const ind = j.status === "server" ? " is-indeterminate" : "";
          return `
          <div class="lib-upload-row" data-upload-id="${escUpload(j.id)}">
            <div class="lib-upload-row-top">
              <strong title="${escUpload(j.name)}">${escUpload(j.name)}</strong>
              <span>${escUpload(j.message)}</span>
              ${
                canCancel
                  ? `<button type="button" class="cfg-btn lib-upload-cancel" data-upload-cancel="${escUpload(
                      j.id
                    )}">取消</button>`
                  : ""
              }
            </div>
            <div class="cfg-lib-progress${ind}">
              <div class="cfg-lib-progress-track" aria-hidden="true">
                <div class="cfg-lib-progress-bar" style="width:${j.status === "server" ? 40 : pct}%"></div>
              </div>
              <span class="cfg-lib-progress-text">${j.status === "server" ? "…" : pct + "%"}</span>
            </div>
          </div>`;
        })
        .join("");
    },

    bindDock(container) {
      if (!container) return;
      if (!this._docks) this._docks = new Set();
      this._docks.add(container);
      if (container.dataset.uploadBound !== "1") {
        container.dataset.uploadBound = "1";
        container.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-upload-cancel]");
          if (!btn) return;
          this.cancel(btn.dataset.uploadCancel);
        });
      }
      if (!this._dockUiBound) {
        this._dockUiBound = true;
        this.subscribe(() => {
          [...(this._docks || [])].forEach((el) => {
            if (!el.isConnected) {
              this._docks.delete(el);
              return;
            }
            this.renderDock(el);
          });
        });
      } else {
        this.renderDock(container);
      }
    },
  };
})();
