/** CL Nav — configurable store (localStorage) */
(function () {
  const KEY = "cl-nav-config-v1";

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function domainFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function normalizeLink(link) {
    const url = (link.url || "").trim();
    const title = (link.title || "").trim();
    const desc = (link.desc || "").trim();
    const domain = (link.domain || domainFromUrl(url) || "").trim();
    return { title, url, desc, domain };
  }

  function linkKey(link) {
    return String(link.url || "")
      .trim()
      .toLowerCase()
      .replace(/\/+$/, "");
  }

  function buildDefaults() {
    const raw = window.NAV_DATA || {};
    const order = (raw.sideMenu || []).map((s) => s.id);
    const catMap = raw.categories || {};
    const categories = order
      .filter((id) => catMap[id])
      .map((id) => {
        const c = catMap[id];
        const short = (raw.sideMenu || []).find((s) => s.id === id)?.name;
        return {
          id,
          name: short || c.title || id,
          links: (c.links || []).map(normalizeLink),
        };
      });

    Object.keys(catMap).forEach((id) => {
      if (categories.some((c) => c.id === id)) return;
      categories.push({
        id,
        name: catMap[id].title || id,
        links: (catMap[id].links || []).map(normalizeLink),
      });
    });

    const quickLinks = (raw.hotTags || []).map((t) =>
      normalizeLink({
        title: t.label || t.title || "",
        url: t.url || "",
        desc: t.query || t.label || "",
      })
    );

    return {
      version: 1,
      brand: raw.brand || "CL Nav",
      tagline: raw.tagline || "开发者工具导航",
      engines: raw.engines || [],
      quickLinks,
      categories,
    };
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function pickRicher(a, b, field) {
    const sa = String((a && a[field]) || "");
    const sb = String((b && b[field]) || "");
    return sb.length > sa.length ? sb : sa;
  }

  function mergeLinks(listA, listB) {
    const map = new Map();
    [...(listA || []), ...(listB || [])].forEach((raw) => {
      const link = normalizeLink(raw);
      const key = linkKey(link);
      if (!key) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, link);
        return;
      }
      map.set(
        key,
        normalizeLink({
          title: pickRicher(prev, link, "title") || prev.title || link.title,
          url: prev.url || link.url,
          desc: pickRicher(prev, link, "desc"),
          domain: prev.domain || link.domain,
        })
      );
    });
    return Array.from(map.values());
  }

  /** Union categories by id, then by name; links union by URL. */
  function mergeCategories(listA, listB) {
    const result = (listA || []).map((c) => ({
      id: c.id || uid("cat"),
      name: c.name || "未命名分类",
      links: (c.links || []).map(normalizeLink),
    }));

    (listB || []).forEach((ec) => {
      const id = ec.id || "";
      const name = (ec.name || "").trim();
      let target =
        (id && result.find((c) => c.id === id)) ||
        (name && result.find((c) => c.name === name)) ||
        null;
      if (target) {
        target.links = mergeLinks(target.links, ec.links || []);
        if (name && name.length > String(target.name || "").length) target.name = name;
      } else {
        result.push({
          id: id || uid("cat"),
          name: name || "未命名分类",
          links: (ec.links || []).map(normalizeLink),
        });
      }
    });
    return result;
  }

  /** Merge multiple configs; later sources add sites, never drop existing. */
  function mergeConfigs(...configs) {
    const defaults = buildDefaults();
    let acc = {
      version: 1,
      brand: defaults.brand,
      tagline: defaults.tagline,
      engines: defaults.engines,
      quickLinks: [],
      categories: [],
    };
    configs.filter(Boolean).forEach((cfg) => {
      if (cfg.brand) acc.brand = cfg.brand;
      if (cfg.tagline) acc.tagline = cfg.tagline;
      if (cfg.engines && cfg.engines.length) acc.engines = cfg.engines;
      acc.quickLinks = mergeLinks(acc.quickLinks, cfg.quickLinks || []);
      acc.categories = mergeCategories(acc.categories, cfg.categories || []);
    });
    return acc;
  }

  function ensureDefaultsIn(cfg) {
    return mergeConfigs(buildDefaults(), cfg);
  }

  function normalizeConfig(parsed) {
    return {
      version: 1,
      brand: parsed.brand || "CL Nav",
      tagline: parsed.tagline || "",
      engines: parsed.engines || buildDefaults().engines,
      quickLinks: (parsed.quickLinks || []).map(normalizeLink),
      categories: (parsed.categories || []).map((c) => ({
        id: c.id || uid("cat"),
        name: c.name || "未命名分类",
        links: (c.links || []).map(normalizeLink),
      })),
    };
  }

  function canonicalPayload(cfg) {
    const n = normalizeConfig(cfg);
    const out = {
      brand: n.brand,
      tagline: n.tagline,
      engines: n.engines,
      quickLinks: n.quickLinks
        .map((l) => ({ title: l.title, url: linkKey(l), desc: l.desc }))
        .sort((a, b) => a.url.localeCompare(b.url)),
      categories: n.categories
        .map((c) => ({
          id: c.id,
          name: c.name,
          links: c.links
            .map((l) => ({ title: l.title, url: linkKey(l), desc: l.desc }))
            .sort((a, b) => a.url.localeCompare(b.url)),
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    };
    if (cfg && cfg.library && typeof cfg.library === "object") {
      const cats = Array.isArray(cfg.library.categories) ? cfg.library.categories : [];
      const items = Array.isArray(cfg.library.items) ? cfg.library.items : [];
      out.library = {
        categories: cats
          .map((c) => ({ id: String(c.id || ""), name: String(c.name || "") }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        items: items
          .map((it) => ({
            id: String(it.id || ""),
            title: String(it.title || ""),
            category: String(it.category || ""),
            downloadUrl: String(it.downloadUrl || ""),
            updatedAt: String(it.updatedAt || ""),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    }
    return out;
  }

  function load() {
    try {
      const text = localStorage.getItem(KEY);
      if (!text) return clone(buildDefaults());
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.categories)) return clone(buildDefaults());
      // 本地 JSON 即为真相：删除的分类/网站不会在刷新后被默认数据加回来
      return normalizeConfig(parsed);
    } catch {
      return clone(buildDefaults());
    }
  }

  let state = load();
  const listeners = new Set();
  let syncing = false;

  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(clone(state));
      } catch (_) {}
    });
  }

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(state));
    if (!syncing && window.NavCfSync?.markDirty) {
      try {
        NavCfSync.markDirty();
      } catch (_) {}
    }
    if (!syncing && window.NavWebDav?.markDirty) {
      try {
        NavWebDav.markDirty();
      } catch (_) {}
    }
    emit();
  }

  function applyState(next, { fromSync = false } = {}) {
    syncing = fromSync;
    state = normalizeConfig(next);
    persist();
    syncing = false;
  }

  window.NavStore = {
    uid,
    domainFromUrl,
    normalizeLink,
    defaults: buildDefaults,
    mergeConfigs,
    ensureDefaultsIn,

    get() {
      return clone(state);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    reset() {
      applyState(buildDefaults());
    },

    replace(next) {
      applyState(next);
    },

    exportJson() {
      return JSON.stringify(state, null, 2);
    },

    /** 备份文档 = 当前本地配置（不强制塞回默认分类） */
    exportBackup({ ensureDefaults = false } = {}) {
      const payload = ensureDefaults ? ensureDefaultsIn(state) : normalizeConfig(state);
      return JSON.stringify(
        {
          ...payload,
          exportedAt: Date.now(),
        },
        null,
        2
      );
    },

    exportedAtOf(textOrObj) {
      try {
        const obj = typeof textOrObj === "string" ? JSON.parse(textOrObj) : textOrObj;
        return Number(obj?.exportedAt) || 0;
      } catch {
        return 0;
      }
    },

    sameContent(a, b) {
      try {
        const oa = typeof a === "string" ? JSON.parse(a) : a;
        const ob = typeof b === "string" ? JSON.parse(b) : b;
        return JSON.stringify(canonicalPayload(oa)) === JSON.stringify(canonicalPayload(ob));
      } catch {
        return false;
      }
    },

    hasUserData() {
      const d = buildDefaults();
      return !this.sameContent(state, d);
    },

    /**
     * 应用网盘/导入数据。
     * mode=replace：整份替换（与 WebDAV JSON 一致，删除会生效）
     * mode=merge：与当前本地合并（不并入内置默认，避免删了又回来）
     */
    applyBackup(remoteTextOrObj, { markClean = false, mode = "replace" } = {}) {
      let remote;
      try {
        remote = typeof remoteTextOrObj === "string" ? JSON.parse(remoteTextOrObj) : remoteTextOrObj;
      } catch {
        throw new Error("网盘数据格式有误");
      }
      if (!remote || !Array.isArray(remote.categories)) {
        throw new Error("网盘数据格式有误");
      }
      const next =
        mode === "merge" ? mergeConfigs(state, remote) : normalizeConfig(remote);
      applyState(next, { fromSync: markClean });
      if (markClean && window.NavCfSync?.clearDirty) NavCfSync.clearDirty();
      if (markClean && window.NavWebDav?.clearDirty) NavWebDav.clearDirty();
      return clone(state);
    },

    /** @deprecated 使用 applyBackup；保留别名避免旧调用报错 */
    applyMergedBackup(remoteTextOrObj, opts = {}) {
      return this.applyBackup(remoteTextOrObj, { ...opts, mode: opts.mode || "replace" });
    },

    importJson(text) {
      const parsed = JSON.parse(text);
      // 导入 JSON = 以该文件为准（整份替换）
      applyState(parsed);
    },

    setQuickLinks(list) {
      state.quickLinks = (list || []).map(normalizeLink);
      persist();
    },

    reorderQuickLinks(from, to) {
      const arr = state.quickLinks;
      if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      persist();
    },

    reorderLinks(catId, from, to) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      const arr = cat.links;
      if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      persist();
    },

    addQuickLink(link) {
      state.quickLinks.push(normalizeLink(link));
      persist();
    },

    updateQuickLink(index, link) {
      if (index < 0 || index >= state.quickLinks.length) return;
      state.quickLinks[index] = normalizeLink(link);
      persist();
    },

    removeQuickLink(index) {
      state.quickLinks.splice(index, 1);
      persist();
    },

    addCategory(name) {
      const cat = { id: uid("cat"), name: (name || "新分类").trim() || "新分类", links: [] };
      state.categories.push(cat);
      persist();
      return clone(cat);
    },

    updateCategory(id, patch) {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return;
      if (patch.name != null) cat.name = String(patch.name).trim() || cat.name;
      persist();
    },

    removeCategory(id) {
      state.categories = state.categories.filter((c) => c.id !== id);
      persist();
    },

    moveCategory(id, dir) {
      const i = state.categories.findIndex((c) => c.id === id);
      if (i < 0) return;
      const j = i + dir;
      if (j < 0 || j >= state.categories.length) return;
      const tmp = state.categories[i];
      state.categories[i] = state.categories[j];
      state.categories[j] = tmp;
      persist();
    },

    addLink(catId, link) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      cat.links.push(normalizeLink(link));
      persist();
    },

    updateLink(catId, index, link) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat || index < 0 || index >= cat.links.length) return;
      cat.links[index] = normalizeLink(link);
      persist();
    },

    removeLink(catId, index) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      cat.links.splice(index, 1);
      persist();
    },

    /** Remove multiple links by index (any order). */
    removeLinks(catId, indices) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      const set = new Set(
        (indices || [])
          .map((i) => +i)
          .filter((i) => Number.isInteger(i) && i >= 0 && i < cat.links.length)
      );
      if (!set.size) return;
      cat.links = cat.links.filter((_, i) => !set.has(i));
      persist();
    },

    moveLink(catId, index, dir) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      const j = index + dir;
      if (index < 0 || j < 0 || index >= cat.links.length || j >= cat.links.length) return;
      const tmp = cat.links[index];
      cat.links[index] = cat.links[j];
      cat.links[j] = tmp;
      persist();
    },

    moveQuickLink(index, dir) {
      const j = index + dir;
      if (index < 0 || j < 0 || index >= state.quickLinks.length || j >= state.quickLinks.length) return;
      const tmp = state.quickLinks[index];
      state.quickLinks[index] = state.quickLinks[j];
      state.quickLinks[j] = tmp;
      persist();
    },
  };

})();
