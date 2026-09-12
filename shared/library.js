/** CL Nav — 资源库页面逻辑（框架） */
(function () {
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(v) {
    if (!v) return "—";
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString("zh-CN");
    } catch {
      return "—";
    }
  }

  function catName(id) {
    const list = window.LibraryStorage?.uiCategories?.() || LIBRARY_DATA.categories || [];
    const c = list.find((x) => x.id === id);
    return c ? c.name : id || "未分类";
  }

  window.LibraryUI = {
    filter: { category: "all", q: "" },
    items: [],

    async init() {
      this.renderNav();
      this.renderToolbar();
      this.bind();
      if (window.Portal?.bindTheme) Portal.bindTheme();
      try {
        this.items = await LibraryStorage.list();
        this.setStatus(this.items.length ? "" : "云端目录为空，请登录设置上传资源");
      } catch (err) {
        this.items = [];
        this.setStatus(err.message || "无法读取云端目录（请确认已创建 R2 并完成部署）", "err");
      }
      this.renderSide();
      this.renderList();
    },

    renderNav() {
      const nav = document.getElementById("topNav");
      if (!nav) return;
      nav.innerHTML = `
        <a href="index.html" data-id="home">导航首页</a>
        <a href="library.html" data-id="library" class="active">资源库</a>
        <a href="#settings" data-id="settings" data-action="settings">设置</a>
        ${window.Portal?.mirrorSwitchHtml?.() || ""}
      `;
    },

    openSettings() {
      if (!window.NavConfigUI?.open) return;
      NavConfigUI.open({ tab: "library" });
    },

    closeSettings() {
      if (window.NavConfigUI?.close) NavConfigUI.close();
      if (location.hash === "#settings") {
        history.replaceState(null, "", location.pathname + location.search);
      }
      // 关闭后刷新资源列表（可能刚在设置里改过）
      this.refreshListQuiet();
    },

    async refreshListQuiet() {
      if (!window.LibraryStorage?.list) return;
      try {
        this.items = await LibraryStorage.list();
        this.renderSide();
        this.renderList();
      } catch (_) {}
    },

    renderSide() {
      const side = document.getElementById("libSide");
      if (!side) return;
      const cur = this.filter.category;
      side.innerHTML = (window.LibraryStorage?.uiCategories?.() || LIBRARY_DATA.categories || [])
        .map((c) => {
          const count =
            c.id === "all"
              ? this.items.length
              : this.items.filter((i) => i.category === c.id).length;
          return `<button type="button" class="${c.id === cur ? "active" : ""}" data-cat="${c.id}">
            <span>${esc(c.name)}</span><em>${count}</em>
          </button>`;
        })
        .join("");
    },

    renderToolbar() {
      const badge = document.getElementById("storageBadge");
      if (badge) badge.textContent = "存储：GitHub Releases / 外链";
    },

    filtered() {
      const q = (this.filter.q || "").trim().toLowerCase();
      return this.items.filter((it) => {
        if (this.filter.category !== "all" && it.category !== this.filter.category) return false;
        if (!q) return true;
        const blob = `${it.title} ${it.desc} ${it.version} ${it.platform}`.toLowerCase();
        return blob.includes(q);
      });
    },

    renderList() {
      const root = document.getElementById("libList");
      const empty = document.getElementById("libEmpty");
      if (!root) return;
      const list = this.filtered();
      if (!list.length) {
        root.innerHTML = "";
        if (empty) empty.hidden = false;
        return;
      }
      if (empty) empty.hidden = true;
      root.innerHTML = list
        .map((it) => {
          const demo = it.demo ? `<span class="lib-tag">示例</span>` : "";
          const links = window.LibraryStorage?.itemLinks?.(it) || [];
          const ready = links.length > 0 || !!it.downloadUrl;
          const actions = ready
            ? links.length
              ? links
                  .map((l, idx) => {
                    const name =
                      (l.label && String(l.label).trim()) ||
                      (window.LibraryStorage?.channelName?.(l.channel) || l.channel || "下载");
                    const primary = idx === 0 ? " primary" : "";
                    return `<button type="button" class="lib-btn${primary}" data-dl="${esc(it.id)}" data-dl-idx="${idx}" title="${esc(
                      l.url
                    )}">${esc(name)}</button>`;
                  })
                  .join("")
              : `<button type="button" class="lib-btn primary" data-dl="${esc(it.id)}" data-dl-idx="0">下载</button>`
            : `<button type="button" class="lib-btn" disabled>即将支持</button>`;
          return `
          <article class="lib-card" data-id="${esc(it.id)}">
            <div class="lib-card-main">
              <div class="lib-card-title">
                <strong>${esc(it.title)}</strong>
                ${demo}
                <span class="lib-tag muted">${esc(catName(it.category))}</span>
              </div>
              <p class="lib-card-desc">${esc(it.desc || "暂无说明")}</p>
              <div class="lib-meta">
                <span>版本 ${esc(it.version || "—")}</span>
                <span>大小 ${esc(it.size || "—")}</span>
                <span>${esc(it.platform || "—")}</span>
                <span>更新 ${esc(formatDate(it.updatedAt))}</span>
              </div>
            </div>
            <div class="lib-card-actions">${actions}</div>
          </article>`;
        })
        .join("");
    },

    setStatus(msg, kind = "") {
      const el = document.getElementById("libStatus");
      if (!el) return;
      el.textContent = msg || "";
      el.className = "lib-status" + (kind ? " " + kind : "");
    },

    bind() {
      document.getElementById("libSide")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-cat]");
        if (!btn) return;
        this.filter.category = btn.dataset.cat;
        this.renderSide();
        this.renderList();
      });

      document.getElementById("libSearch")?.addEventListener("input", (e) => {
        this.filter.q = e.target.value || "";
        this.renderList();
      });

      document.getElementById("libList")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-dl]");
        if (!btn || btn.disabled) return;
        const id = btn.dataset.dl;
        const idx = Number(btn.dataset.dlIdx || 0);
        const item = this.items.find((x) => x.id === id);
        if (!item) return;
        try {
          const links = window.LibraryStorage?.itemLinks?.(item) || [];
          const link = links[idx] || links[0] || null;
          const url = await LibraryStorage.getDownloadUrl(item, link);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (err) {
          this.setStatus(err.message || "下载失败", "err");
        }
      });

      document.getElementById("backTop")?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      document.getElementById("topNav")?.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-action='settings']");
        if (!a) return;
        e.preventDefault();
        this.openSettings();
      });

      document.getElementById("settingsClose")?.addEventListener("click", () => {
        this.closeSettings();
      });

      document.getElementById("settingsPanel")?.addEventListener("click", (e) => {
        if (e.target.id === "settingsPanel") this.closeSettings();
      });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const panel = document.getElementById("settingsPanel");
        if (panel && !panel.hidden) this.closeSettings();
      });

      if (location.hash === "#settings") {
        setTimeout(() => this.openSettings(), 0);
      }
    },
  };
})();
