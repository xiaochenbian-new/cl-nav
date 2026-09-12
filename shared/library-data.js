/** CL Nav — 资源库：Cloudflare R2 + KV 目录索引 */
(function () {
  window.LIBRARY_DATA = {
    brand: "CL Nav",
    title: "资源库",
    tagline: "软件 · 安装包 · 常用资源",
    storageMode: "r2",
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

  function authHeaders() {
    if (!window.NavAuth?.isLoggedIn?.()) return {};
    const pass = window.NavAuth.adminPass?.() || "xiaochenbian";
    return { Authorization: "Bearer " + pass };
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
        "云端还是旧版本（/api/library 未生效）。请在 Cloudflare 创建 R2 桶「cl-nav-library」后，到 Pages → Deployments 里 Retry 最新部署。"
      );
    }

    return res;
  }

  window.LibraryStorage = {
    mode() {
      return "r2";
    },

    async list() {
      try {
        const res = await api("GET");
        if (res.status === 503) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "R2/KV 未绑定");
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "读取目录失败 HTTP " + res.status);
        }
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        LIBRARY_DATA.items = items;
        LIBRARY_DATA.storageMode = data.storageMode || "r2";
        return items.slice();
      } catch (err) {
        // 离线兜底：空列表，避免整页挂死
        if (!LIBRARY_DATA.items) LIBRARY_DATA.items = [];
        throw err;
      }
    },

    async getDownloadUrl(item) {
      if (item?.downloadUrl) return item.downloadUrl;
      if (item?.id) return API + "?id=" + encodeURIComponent(item.id) + "&download=1";
      throw new Error("该资源没有下载地址");
    },

    async upload(file, meta = {}) {
      if (!file) throw new Error("未选择文件");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再上传");

      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("title", meta.title || file.name);
      fd.append("desc", meta.desc || "");
      fd.append("category", meta.category || "other");
      fd.append("version", meta.version || "—");
      fd.append("platform", meta.platform || "—");

      const res = await api("POST", { body: fd, headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (res.status === 503) throw new Error(j.error || "R2 未绑定，请先创建 bucket cl-nav-library");
      if (!res.ok) throw new Error(j.error || "上传失败 HTTP " + res.status);
      if (j.item) {
        LIBRARY_DATA.items = LIBRARY_DATA.items || [];
        LIBRARY_DATA.items.unshift(j.item);
      }
      return j.item;
    },

    async remove(id) {
      if (!id) throw new Error("缺少 id");
      if (!window.NavAuth?.isLoggedIn?.()) throw new Error("请先登录后再删除");
      const res = await api("DELETE", { id, headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(j.error || "未授权，请重新登录");
      if (!res.ok) throw new Error(j.error || "删除失败 HTTP " + res.status);
      LIBRARY_DATA.items = (LIBRARY_DATA.items || []).filter((x) => x.id !== id);
      return true;
    },
  };
})();
