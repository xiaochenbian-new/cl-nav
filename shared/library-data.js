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

    async upload(_file, _meta) {
      throw new Error("上传通道尚未配置（网盘 / 服务器待定）");
    },

    async remove(_id) {
      throw new Error("删除接口尚未配置");
    },
  };
})();
