/** CL Nav — 资源库：KV 目录 + 外链下载（无需 R2 / 绑卡） */
(function () {
  window.LIBRARY_DATA = {
    brand: "CL Nav",
    title: "资源库",
    tagline: "软件 · 安装包 · 常用资源",
    storageMode: "url",
    categories: [
      { id: "all", name: "全部" },
      { id: "software", name: "软件" },
      { id: "installer", name: "安装包" },
      { id: "docs", name: "文档" },
      { id: "driver", name: "驱动" },
      { id: "other", name: "其他" },
    ],
    items: [],
  };

  const API = "/api/library";

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
    if (isFileProtocol()) {
      throw new Error("请用 Cloudflare Pages 打开站点（file:// 无 /api/library）");
    }
    let url = API;
    const q = [];
    if (id) q.push("id=" + encodeURIComponent(id));
    if (download) q.push("download=1");
    if (q.length) url += "?" + q.join("&");

    const init = { method, headers: { ...(headers || {}) }, cache: "no-store" };
    if (body != null) init.body = body;

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new Error("无法连接资源库接口 /api/library");
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) {
      throw new Error(
        "云端还是旧版本（/api/library 未生效）。请到 Cloudflare Pages → Deployments 对最新提交 Retry deployment。"
      );
    }
    return res;
  }

  window.LibraryStorage = {
    mode() {
      return LIBRARY_DATA.storageMode || "url";
    },

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
      LIBRARY_DATA.storageMode = data.storageMode || "url";
      return items.slice();
    },

    async getDownloadUrl(item) {
      if (item?.downloadUrl && /^https?:\/\//i.test(item.downloadUrl)) return item.downloadUrl;
      if (item?.id) return API + "?id=" + encodeURIComponent(item.id) + "&download=1";
      if (item?.downloadUrl) return item.downloadUrl;
      throw new Error("该资源没有下载地址");
    },

    /** 登记外链（推荐，无需绑卡） */
    async addLink(meta = {}) {
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再添加");
      const downloadUrl = String(meta.downloadUrl || "").trim();
      if (!/^https?:\/\//i.test(downloadUrl)) {
        throw new Error("请填写以 http(s):// 开头的下载地址");
      }
      const res = await api("POST", {
        body: JSON.stringify({
          title: meta.title || "未命名资源",
          desc: meta.desc || "",
          category: meta.category || "other",
          version: meta.version || "—",
          size: meta.size || "—",
          platform: meta.platform || "—",
          downloadUrl,
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
      return j.item;
    },

    async upload(file, meta = {}) {
      // 兼容旧按钮：无 R2 时引导用外链
      if (meta && meta.downloadUrl) return this.addLink({ ...meta, title: meta.title || (file && file.name) });
      throw new Error("未开通 R2（需绑卡）。请使用「添加外链」填写下载地址。");
    },

    async remove(id) {
      if (!id) throw new Error("缺少 id");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再删除");
      const res = await api("DELETE", { id, headers: authHeaders(false) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "删除失败 HTTP " + res.status);
      LIBRARY_DATA.items = (LIBRARY_DATA.items || []).filter((x) => x.id !== id);
      return true;
    },
  };
})();
