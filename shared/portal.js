/** CL Nav — portal helpers + interactions */
(function () {
  const D = () => window.NAV_DATA;

  const MIRRORS = [
    {
      id: "cloudflare",
      short: "CF",
      name: "Cloudflare Pages",
      base: "https://cl-nav.pages.dev",
      match: (host) => /(?:^|\.)pages\.dev$/i.test(host),
    },
    {
      id: "github",
      short: "GH",
      name: "GitHub Pages",
      base: "https://xiaochenbian-new.github.io/cl-nav",
      match: (host) => /github\.io$/i.test(host),
    },
  ];

  function engineIconDomain(eng) {
    if (eng?.icon) return eng.icon;
    try {
      return new URL(eng.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function resolvePageFile() {
    let path = location.pathname || "/";
    path = path.replace(/\/cl-nav\/?/i, "/");
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) return "index.html";
    const last = parts[parts.length - 1];
    if (!last.includes(".")) return "index.html";
    return last;
  }

  function mirrorUrl(mirror) {
    const base = String(mirror.base || "").replace(/\/$/, "");
    return `${base}/${resolvePageFile()}${location.search || ""}${location.hash || ""}`;
  }

  window.Portal = {
    favicon(domain) {
      return window.navFavicon(domain);
    },

    engineOptions(selected) {
      const cur = selected || localStorage.getItem("cl-nav-engine") || D().engines[0].id;
      return D().engines
        .map((e) => `<option value="${e.id}" ${e.id === cur ? "selected" : ""}>${e.name}</option>`)
        .join("");
    },

    enginePickerHtml(selected) {
      const engines = D().engines || [];
      const curId = selected || localStorage.getItem("cl-nav-engine") || engines[0]?.id;
      const cur = engines.find((e) => e.id === curId) || engines[0];
      if (!cur) return "";
      const curDomain = engineIconDomain(cur);
      const curIcon = curDomain
        ? `<img src="${this.favicon(curDomain)}" alt="" data-domain="${curDomain}" data-step="0" decoding="async" referrerpolicy="no-referrer" onerror="Portal.onFaviconError(this)" />`
        : "";
      const options = engines
        .map((e) => {
          const domain = engineIconDomain(e);
          const icon = domain
            ? `<img src="${this.favicon(domain)}" alt="" data-domain="${domain}" data-step="0" decoding="async" referrerpolicy="no-referrer" onerror="Portal.onFaviconError(this)" />`
            : "";
          return `<button type="button" class="engine-option" role="option" data-engine="${e.id}" aria-selected="${
            e.id === cur.id ? "true" : "false"
          }">${icon}<span>${e.name}</span></button>`;
        })
        .join("");
      return `
        <div class="engine-picker" id="enginePicker">
          <input type="hidden" id="engine" value="${cur.id}" />
          <button type="button" class="engine-trigger" id="engineTrigger" aria-label="搜索引擎" aria-haspopup="listbox" aria-expanded="false">
            ${curIcon}<span class="engine-label">${cur.name}</span><span class="engine-caret" aria-hidden="true">▾</span>
          </button>
          <div class="engine-menu" id="engineMenu" role="listbox" hidden>${options}</div>
        </div>`;
    },

    mountEnginePicker(selected) {
      const host = document.getElementById("enginePickerHost");
      if (!host) return;
      host.innerHTML = this.enginePickerHtml(selected);
      this.hydrateFavicons(host);
      this.bindEnginePicker();
    },

    bindEnginePicker() {
      const picker = document.getElementById("enginePicker");
      const trigger = document.getElementById("engineTrigger");
      const menu = document.getElementById("engineMenu");
      const hidden = document.getElementById("engine");
      if (!picker || !trigger || !menu || !hidden || picker.dataset.bound === "1") return;
      picker.dataset.bound = "1";

      const close = () => {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      };

      const open = () => {
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
      };

      const setEngine = (id) => {
        const eng = (D().engines || []).find((e) => e.id === id);
        if (!eng) return;
        hidden.value = eng.id;
        localStorage.setItem("cl-nav-engine", eng.id);
        const domain = engineIconDomain(eng);
        const label = trigger.querySelector(".engine-label");
        if (label) label.textContent = eng.name;
        let img = trigger.querySelector("img");
        if (domain) {
          if (!img) {
            img = document.createElement("img");
            img.alt = "";
            img.decoding = "async";
            img.referrerPolicy = "no-referrer";
            img.onerror = function () {
              Portal.onFaviconError(this);
            };
            trigger.insertBefore(img, trigger.firstChild);
          }
          img.dataset.domain = domain;
          img.dataset.step = "0";
          img.dataset.fromCache = "0";
          img.src = this.favicon(domain);
        }
        menu.querySelectorAll(".engine-option").forEach((btn) => {
          btn.setAttribute("aria-selected", btn.dataset.engine === eng.id ? "true" : "false");
        });
        close();
      };

      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (menu.hidden) open();
        else close();
      });

      menu.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-engine]");
        if (!btn) return;
        e.preventDefault();
        setEngine(btn.dataset.engine);
      });

      if (!window.__clNavEngineDocBound) {
        window.__clNavEngineDocBound = true;
        document.addEventListener("click", (e) => {
          const p = document.getElementById("enginePicker");
          const m = document.getElementById("engineMenu");
          const t = document.getElementById("engineTrigger");
          if (!p || !m || !t) return;
          if (!p.contains(e.target)) {
            m.hidden = true;
            t.setAttribute("aria-expanded", "false");
          }
        });
        document.addEventListener("keydown", (e) => {
          if (e.key !== "Escape") return;
          const m = document.getElementById("engineMenu");
          const t = document.getElementById("engineTrigger");
          if (m) m.hidden = true;
          if (t) t.setAttribute("aria-expanded", "false");
        });
      }
    },

    mirrorSwitchHtml() {
      const host = typeof location !== "undefined" ? location.hostname : "";
      const current = MIRRORS.find((m) => m.match(host));
      if (!current) {
        return MIRRORS.map(
          (m) =>
            `<a class="mirror-switch" href="${mirrorUrl(m)}" title="打开 ${m.name}">${m.short}</a>`
        ).join("");
      }
      const other = MIRRORS.find((m) => m.id !== current.id) || MIRRORS[0];
      return `<a class="mirror-switch" href="${mirrorUrl(other)}" title="切换到 ${other.name}（当前 ${current.name}）">⇄ ${other.short}</a>`;
    },

    hotTags(list) {
      const tags = list || D().hotTags || [];
      return tags
        .map((t) => {
          const label = t.label || t.title || "";
          const url = t.url || "";
          const query = t.query || label;
          return `<a href="#" data-query="${query}" data-url="${url}">${label}</a>`;
        })
        .join("");
    },

    quickLinks(list) {
      return (list || [])
        .map(
          (l) =>
            `<a href="${l.url}" target="_blank" rel="noopener noreferrer" title="${l.desc || l.title}">${l.title}</a>`
        )
        .join("");
    },

    sideMenu(categories, active = "") {
      const items = categories || D().sideMenu || [];
      return items
        .map((m) => {
          const id = m.id;
          const name = m.name || m.title || id;
          return `<button type="button" class="${id === active ? "active" : ""}" data-id="${id}">${name}</button>`;
        })
        .join("");
    },

    topNav() {
      const tabs = (D().navTabs || [])
        .map(
          (t) =>
            `<a href="${t.href || "#"}" data-id="${t.id}" data-action="${t.action || "route"}" data-target="${
              t.target || ""
            }">${t.name}</a>`
        )
        .join("");
      return tabs + this.mirrorSwitchHtml();
    },

    iconLinks(list, cls = "site-card") {
      const escAttr = (s) =>
        String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;");
      return (list || [])
        .map((l) => {
          let domain = l.domain;
          if (!domain && l.url) {
            try {
              domain = new URL(l.url).hostname.replace(/^www\./, "");
            } catch (_) {}
          }
          const icon = domain
            ? `<img src="${this.favicon(domain)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-domain="${domain}" data-step="0" onerror="Portal.onFaviconError(this)" />`
            : `<span class="site-fallback">${(l.title || "?").slice(0, 1)}</span>`;
          const desc = l.desc || domain || l.url || "";
          const tip = desc && desc !== l.title ? `${l.title} — ${desc}` : l.title || desc;
          return `
          <a class="${cls}" href="${l.url}" target="_blank" rel="noopener noreferrer" title="${escAttr(tip)}">
            <div class="site-head">
              ${icon}
              <span class="site-title">${l.title}</span>
            </div>
            <p class="site-desc">${desc}</p>
          </a>`;
        })
        .join("");
    },

    onFaviconError(img) {
      const domain = img.dataset.domain;
      const step = Number(img.dataset.step || 0);
      if (!domain) {
        img.replaceWith(
          Object.assign(document.createElement("span"), {
            className: "site-fallback",
            textContent: "●",
          })
        );
        return;
      }
      const urls =
        window.FaviconCache?.remoteUrls?.(domain) ||
        [
          `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
          `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
          `https://favicon.im/${encodeURIComponent(domain)}?larger=true`,
        ];
      const next = step + 1;
      if (next < urls.length) {
        img.dataset.step = String(next);
        img.dataset.fromCache = "0";
        img.src = urls[next];
        return;
      }
      const span = document.createElement("span");
      span.className = "site-fallback";
      span.textContent = (domain[0] || "?").toUpperCase();
      img.replaceWith(span);
    },

    hydrateFavicons(root) {
      if (window.FaviconCache?.hydrate) FaviconCache.hydrate(root || document);
    },

    prefetchFavicons(domains) {
      if (window.FaviconCache?.prefetch) FaviconCache.prefetch(domains);
    },

    pillTools(list) {
      return (list || [])
        .map(
          (t) =>
            `<a class="pill" href="${t.url}" target="_blank" rel="noopener noreferrer">${t.title}</a>`
        )
        .join("");
    },

    hotNews() {
      return (D().widgets.hotNews || [])
        .map(
          (n, i) =>
            `<li><em>${i + 1}</em><a href="${n.url}" target="_blank" rel="noopener noreferrer">${n.title}</a></li>`
        )
        .join("");
    },

    doSearch() {
      const q = (document.getElementById("q")?.value || "").trim();
      if (!q) return;
      const id = document.getElementById("engine")?.value || D().engines[0].id;
      localStorage.setItem("cl-nav-engine", id);
      const eng = D().engines.find((x) => x.id === id) || D().engines[0];
      window.open(eng.url + encodeURIComponent(q), "_blank", "noopener,noreferrer");
    },

    bindSearch() {
      const form = document.getElementById("searchForm");
      if (!form) return;
      if (form.dataset.searchBound !== "1") {
        form.dataset.searchBound = "1";
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          this.doSearch();
        });
      }
      if (document.getElementById("enginePickerHost")) {
        this.mountEnginePicker();
      } else {
        const engine = document.getElementById("engine");
        if (engine && engine.tagName === "SELECT") {
          engine.innerHTML = this.engineOptions();
          if (engine.dataset.changeBound !== "1") {
            engine.dataset.changeBound = "1";
            engine.addEventListener("change", () => {
              localStorage.setItem("cl-nav-engine", engine.value);
            });
          }
        }
      }
    },

    bindHotTags() {
      document.getElementById("hotTags")?.addEventListener("click", (e) => {
        const a = e.target.closest("a");
        if (!a) return;
        e.preventDefault();
        const url = a.dataset.url;
        const query = a.dataset.query || a.textContent;
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
        const input = document.getElementById("q");
        if (input) input.value = query;
        this.doSearch();
      });
    },

    bindTheme() {
      const key = "cl-nav-theme";
      const apply = (mode) => {
        document.documentElement.dataset.theme = mode;
        localStorage.setItem(key, mode);
        document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.themeBtn === mode);
        });
      };
      apply(localStorage.getItem(key) || "light");
      document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
        if (btn.dataset.themeBound === "1") return;
        btn.dataset.themeBound = "1";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          apply(btn.dataset.themeBtn);
        });
      });
    },

    /** Sidebar + top nav linked category switching */
    bindCategoryNav(renderPanel, initial = "tools") {
      let active = initial;

      const setActive = (id) => {
        if (!D().categories[id]) id = "common";
        active = id;
        document.querySelectorAll("#sideMenu [data-id]").forEach((el) => {
          el.classList.toggle("active", el.dataset.id === id);
        });
        document.querySelectorAll("#topNav [data-target]").forEach((el) => {
          el.classList.toggle("active", el.dataset.target === id);
        });
        renderPanel(id);
        history.replaceState(null, "", `#${id}`);
      };

      document.getElementById("sideMenu")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-id]");
        if (!btn) return;
        e.preventDefault();
        setActive(btn.dataset.id);
      });

      document.getElementById("topNav")?.addEventListener("click", (e) => {
        const a = e.target.closest("[data-target]");
        if (!a) return;
        e.preventDefault();
        setActive(a.dataset.target);
        document.querySelector(".body-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      const fromHash = location.hash.replace("#", "");
      setActive(fromHash && D().categories[fromHash] ? fromHash : initial);

      window.addEventListener("hashchange", () => {
        const id = location.hash.replace("#", "");
        if (id && D().categories[id] && id !== active) setActive(id);
      });

      return { setActive, getActive: () => active };
    },
  };
})();
