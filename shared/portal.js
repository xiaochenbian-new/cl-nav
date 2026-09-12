/** CL Nav — portal helpers + interactions */
(function () {
  const D = () => window.NAV_DATA;

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
      return D().navTabs
        .map(
          (t) =>
            `<a href="${t.href || "#"}" data-id="${t.id}" data-action="${t.action || "route"}" data-target="${
              t.target || ""
            }">${t.name}</a>`
        )
        .join("");
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
      // step 0 already failed primary; try next indices
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
      const engine = document.getElementById("engine");
      if (!form) return;
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.doSearch();
      });
      engine?.addEventListener("change", () => {
        localStorage.setItem("cl-nav-engine", engine.value);
      });
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
