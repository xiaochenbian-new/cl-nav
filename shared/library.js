/** CL Nav — 资源库页面逻辑（框架） */
(function () {
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(d = new Date()) {
    const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " 周" +
      week +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()) +
      ":" +
      pad(d.getSeconds())
    );
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
    _clockTimer: 0,

    async init() {
      this.renderNav();
      this.renderToolbar();
      this.startClock();
      this.bind();
      if (window.LibUploadQueue) {
        const dock = document.getElementById("libPageUploadDock");
        if (dock) LibUploadQueue.bindDock(dock);
      }
      window.addEventListener("cl-nav-lib-uploaded", () => this.refreshListQuiet());
      try {
        this.items = await LibraryStorage.list();
        this.setStatus(this.items.length ? "" : "云端目录为空，请登录设置上传资源");
      } catch (err) {
        this.items = [];
        this.setStatus(err.message || "无法读取云端目录（请确认已创建 R2 并完成部署）", "err");
      }
      this.renderSide();
      this.renderSideLinks();
      this.renderList();
    },

    startClock() {
      const el = document.getElementById("libClock");
      if (!el) return;
      const tick = () => {
        const now = new Date();
        el.textContent = formatClock(now);
        el.dateTime = now.toISOString();
      };
      tick();
      window.clearInterval(this._clockTimer);
      this._clockTimer = window.setInterval(tick, 1000);
    },

    renderNav() {
      const nav = document.getElementById("topNav");
      if (!nav) return;
      // 与首页顶栏一致：时间旁为「返回首页」+「设置」+ GH（首页对应位置是「资源库」）
      nav.innerHTML = `
        <a href="index.html" data-id="home">返回首页</a>
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
      this.refreshListQuiet();
      this.renderSideLinks();
    },

    async refreshListQuiet() {
      if (!window.LibraryStorage?.list) return;
      try {
        this.items = await LibraryStorage.list();
        this.renderSide();
        this.renderSideLinks();
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

    renderSideLinks() {
      const el = document.getElementById("libSideLinks");
      const wrap = document.getElementById("libSideLinksWrap");
      const toggle = document.getElementById("libSideLinksToggle");
      if (!el) return;
      const links =
        window.LibraryStorage?.normalizeSidebarLinks?.(LIBRARY_DATA.sidebarLinks, {
          allowEmpty: true,
        }) || [];
      if (!links.length) {
        el.innerHTML = `<p class="lib-side-links-empty">暂无网盘入口，可在设置 → 资源库中配置</p>`;
      } else {
        el.innerHTML = links
          .map(
            (l) =>
              `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)}</a>`
          )
          .join("");
      }
      // 默认展开；刷新列表时保持用户当前展开/收起状态
      if (wrap && !wrap.dataset.inited) {
        wrap.classList.add("is-open");
        wrap.dataset.inited = "1";
        if (toggle) toggle.setAttribute("aria-expanded", "true");
      }
      if (wrap) wrap.hidden = false;
    },

    toggleSideLinks() {
      const wrap = document.getElementById("libSideLinksWrap");
      const toggle = document.getElementById("libSideLinksToggle");
      if (!wrap) return;
      const open = !wrap.classList.contains("is-open");
      wrap.classList.toggle("is-open", open);
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
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

      document.getElementById("libSideLinksToggle")?.addEventListener("click", () => {
        this.toggleSideLinks();
      });

      document.getElementById("libSearch")?.addEventListener("input", (e) => {
        this.filter.q = e.target.value || "";
        this.renderList();
      });

      document.getElementById("libList")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-dl]");
        if (!btn || !window.LibraryStorage) return;
        const item = this.items.find((x) => x.id === btn.dataset.dl);
        if (!item) return;
        const idx = Number(btn.dataset.dlIdx || 0);
        const links = LibraryStorage.itemLinks(item);
        const link = links[idx] || links[0] || null;
        try {
          const url = await LibraryStorage.getDownloadUrl(item, link);
          window.open(url, "_blank", "noopener");
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

      document.getElementById("libOpenSettings")?.addEventListener("click", (e) => {
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
