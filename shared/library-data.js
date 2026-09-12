/** CL Nav — 资源库：KV 目录 + 外链下载（无需 R2 / 绑卡） */
(function () {
  const DEFAULT_CATEGORIES = [
    { id: "software", name: "软件" },
    { id: "installer", name: "安装包" },
    { id: "docs", name: "文档" },
    { id: "driver", name: "驱动" },
    { id: "other", name: "其他" },
  ];

  window.LIBRARY_DATA = {
    brand: "CL Nav",
    title: "资源库",
    tagline: "软件 · 安装包 · 常用资源",
    storageMode: "url",
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    items: [],
  };

  const API = "/api/library";
  const API_GH = "/api/library-github";
  const GH_PREFS_KEY = "cl-nav-github-release-v1";
  const GH_DEFAULTS = { owner: "xiaochenbian-new", repo: "cl-nav-file" };

  function apiUrl(path) {
    return window.ClNavApi?.url?.(path) || path;
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
    { id: "direct", name: "直链" },
    { id: "other", name: "其他" },
  ];

  function channelName(id) {
    const hit = LINK_CHANNELS.find((c) => c.id === id);
    return hit ? hit.name : id || "其他";
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
      LIBRARY_DATA.storageMode = data.storageMode || "url";
      return items.slice();
    },

    defaultCategories: DEFAULT_CATEGORIES,
    normalizeCategories,
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
      markSyncDirty();
      return LIBRARY_DATA.categories.slice();
    },

    async exportCatalog() {
      try {
        await this.list();
      } catch (_) {}
      return {
        version: 1,
        categories: normalizeCategories(LIBRARY_DATA.categories),
        items: Array.isArray(LIBRARY_DATA.items) ? LIBRARY_DATA.items.slice() : [],
        storageMode: LIBRARY_DATA.storageMode || "url",
      };
    },

    async importCatalog(catalog) {
      if (!catalog || typeof catalog !== "object") return false;
      const categories = normalizeCategories(catalog.categories);
      const items = Array.isArray(catalog.items) ? catalog.items : [];
      const headers = authHeaders(true);
      if (!headers.Authorization) {
        headers.Authorization = "Bearer " + (window.NavAuth?.adminPass?.() || "xiaochenbian");
      }
      const res = await api("POST", {
        body: JSON.stringify({ action: "replaceCatalog", categories, items }),
        headers,
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "导入资源库失败 HTTP " + res.status);
      LIBRARY_DATA.categories = normalizeCategories(j.categories || categories);
      LIBRARY_DATA.items = Array.isArray(j.items) ? j.items : items;
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
     * @param {(info: { ratio: number, phase: string, loaded?: number, total?: number }) => void} [onProgress]
     */
    async uploadToGitHub(file, meta = {}, onProgress) {
      if (!file) throw new Error("未选择文件");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再上传");
      if (typeof location !== "undefined" && location.protocol === "file:" && !window.ClNavApi?.origin?.()) {
        throw new Error("请用 Cloudflare / GitHub Pages 打开后再上传");
      }

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

        xhr.onerror = () => reject(new Error("无法连接 " + apiUrl(API_GH)));
        xhr.ontimeout = () => reject(new Error("上传超时，请稍后重试或换较小文件"));

        xhr.onload = () => {
          const ct = (xhr.getResponseHeader("content-type") || "").toLowerCase();
          if (ct.includes("text/html")) {
            reject(new Error("接口未部署：请确认 Cloudflare 已部署 functions/api/library-github.js"));
            return;
          }
          let data = {};
          try {
            data = JSON.parse(xhr.responseText || "{}");
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
})();
