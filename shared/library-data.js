/** CL Nav — 资源库数据与存储适配器占位（上传/下载后端待定） */
(function () {
  /**
   * 资源条目约定字段（后续接网盘或服务器时保持此结构即可）
   * {
   *   id, title, desc, category,
   *   version, size, platform,           // 展示用
   *   updatedAt,                         // ISO 或时间戳
   *   storage: { type: 'local'|'webdav'|'server'|'url', ... },
   *   downloadUrl,                       // 可直接下载时填写；否则由适配器解析
   * }
   */
  window.LIBRARY_DATA = {
    brand: "CL Nav",
    title: "资源库",
    tagline: "软件 · 安装包 · 常用资源",
    /** 存储策略占位：local | webdav | server —— 后续再选定 */
    storageMode: "pending",
    categories: [
      { id: "all", name: "全部" },
      { id: "software", name: "软件" },
      { id: "installer", name: "安装包" },
      { id: "docs", name: "文档" },
      { id: "driver", name: "驱动" },
      { id: "other", name: "其他" },
    ],
    /** 示例条目（空库时用于说明结构；正式上线可清空） */
    items: [
      {
        id: "demo-jdk",
        title: "示例：JDK 安装包",
        desc: "占位资源，下载能力尚未接入",
        category: "installer",
        version: "8uxxx",
        size: "—",
        platform: "Windows / Linux",
        updatedAt: "",
        storage: { type: "pending" },
        downloadUrl: "",
        demo: true,
      },
      {
        id: "demo-snipaste",
        title: "示例：截图工具",
        desc: "占位资源，后续可改为网盘或服务器直链",
        category: "software",
        version: "—",
        size: "—",
        platform: "Windows",
        updatedAt: "",
        storage: { type: "pending" },
        downloadUrl: "",
        demo: true,
      },
    ],
  };

  /**
   * 存储适配器接口（框架层）。真正实现时按 mode 切换即可。
   */
  window.LibraryStorage = {
    mode() {
      return (window.LIBRARY_DATA && LIBRARY_DATA.storageMode) || "pending";
    },

    async list() {
      return (LIBRARY_DATA.items || []).slice();
    },

    async getDownloadUrl(item) {
      if (item?.downloadUrl) return item.downloadUrl;
      const type = item?.storage?.type || this.mode();
      // 预留：webdav / server / local 的解析逻辑
      throw new Error(
        type === "pending"
          ? "下载通道尚未配置（网盘 / 服务器待定）"
          : `存储类型「${type}」尚未实现`
      );
    },

    async upload(file, meta = {}) {
      if (!file) throw new Error("未选择文件");
      // 本地占位：仅写入目录元数据，真实文件需接 R2 / 网盘
      const id = "local_" + Date.now().toString(36);
      const item = {
        id,
        title: meta.title || file.name,
        desc: meta.desc || "本地登记（文件本体待接云存储）",
        category: meta.category || "other",
        version: meta.version || "—",
        size: file.size ? Math.max(1, Math.round(file.size / 1024)) + " KB" : "—",
        platform: meta.platform || "—",
        updatedAt: new Date().toISOString().slice(0, 10),
        storage: { type: "pending", fileName: file.name },
        downloadUrl: "",
        demo: false,
      };
      LIBRARY_DATA.items = LIBRARY_DATA.items || [];
      LIBRARY_DATA.items.unshift(item);
      try {
        localStorage.setItem("cl-nav-library-items-v1", JSON.stringify(LIBRARY_DATA.items));
      } catch (_) {}
      return item;
    },

    async remove(id) {
      LIBRARY_DATA.items = (LIBRARY_DATA.items || []).filter((x) => x.id !== id);
      try {
        localStorage.setItem("cl-nav-library-items-v1", JSON.stringify(LIBRARY_DATA.items));
      } catch (_) {}
      return true;
    },
  };

  // 恢复本机登记的资源目录（不含大文件本体）
  try {
    const raw = localStorage.getItem("cl-nav-library-items-v1");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) LIBRARY_DATA.items = arr;
    }
  } catch (_) {}
})();
