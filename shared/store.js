/** CL Nav — configurable store (localStorage) */
(function () {
  const KEY = "cl-nav-config-v1";
  /** 已删除的「CL 应用」seed 链接墓碑：防止刷新后被 ensureClApps 复活 */
  const TOMB_KEY = "cl-nav-removed-seeds-v1";
  const CAT_CL_TOMB = "cat:cl_apps";

  function loadTombstones() {
    try {
      const arr = JSON.parse(localStorage.getItem(TOMB_KEY) || "[]");
      return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  }

  function saveTombstones(set) {
    try {
      localStorage.setItem(TOMB_KEY, JSON.stringify([...set]));
    } catch (_) {}
  }

  function rememberRemovedLinks(links) {
    const tomb = loadTombstones();
    let added = false;
    (links || []).forEach((l) => {
      const key = linkKey(l);
      if (key && !tomb.has(key)) {
        tomb.add(key);
        added = true;
      }
    });
    if (added) saveTombstones(tomb);
  }

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

  function normalizeChild(ch) {
    return {
      id: ch.id || uid("sub"),
      name: String(ch.name || "").trim() || "未命名子分类",
      links: (ch.links || []).map(normalizeLink),
    };
  }

  function normalizeCategory(c) {
    const children = Array.isArray(c.children) ? c.children.map(normalizeChild) : [];
    return {
      id: c.id || uid("cat"),
      name: String(c.name || "").trim() || "未命名分类",
      links: (c.links || []).map(normalizeLink),
      children,
    };
  }

  function catLinkCount(c) {
    const own = (c.links || []).length;
    const kids = (c.children || []).reduce((n, ch) => n + (ch.links || []).length, 0);
    return own + kids;
  }

  function linkKey(link) {
    return String(link.url || "")
      .trim()
      .toLowerCase()
      .replace(/\/+$/, "");
  }

  /** Resolve leaf container: parent links (childId null) or a child. */
  function resolveLeaf(categories, catId, childId) {
    const cat = (categories || []).find((c) => c.id === catId);
    if (!cat) return null;
    if (childId) {
      const child = (cat.children || []).find((ch) => ch.id === childId);
      return child || null;
    }
    return cat;
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
        return normalizeCategory({
          id,
          name: short || c.title || id,
          links: c.links || [],
          children: c.children || [],
        });
      });

    Object.keys(catMap).forEach((id) => {
      if (categories.some((c) => c.id === id)) return;
      categories.push(
        normalizeCategory({
          id,
          name: catMap[id].title || id,
          links: catMap[id].links || [],
          children: catMap[id].children || [],
        })
      );
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

  /** Union children by id, then by name; links union by URL. */
  function mergeChildren(listA, listB) {
    const result = (listA || []).map(normalizeChild);
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
        result.push(normalizeChild(ec));
      }
    });
    return result;
  }

  /** Union categories by id, then by name; links + children union. */
  function mergeCategories(listA, listB) {
    const result = (listA || []).map(normalizeCategory);

    (listB || []).forEach((ec) => {
      const id = ec.id || "";
      const name = (ec.name || "").trim();
      let target =
        (id && result.find((c) => c.id === id)) ||
        (name && result.find((c) => c.name === name)) ||
        null;
      if (target) {
        target.links = mergeLinks(target.links, ec.links || []);
        target.children = mergeChildren(target.children, ec.children || []);
        if (name && name.length > String(target.name || "").length) target.name = name;
      } else {
        result.push(normalizeCategory(ec));
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

  /** 工作区 Web 项目：补齐「CL 应用」测试/生产入口（不删用户其它链接） */
  function clAppsSeedLinks() {
    const raw = (window.NAV_DATA && window.NAV_DATA.categories && window.NAV_DATA.categories.cl_apps) || {};
    return (raw.links || []).map(normalizeLink).filter((l) => l.url);
  }

  /** 旧地址 → 规范生产/测试 URL（合并重复卡片） */
  const CL_APPS_URL_ALIASES = {
    "https://wangdou.win": "https://wangdou.win/",
    "https://cl-network-disk-web.pages.dev": "https://wangdou.win/",
    "https://cl-network-disk-web.pages.dev/": "https://wangdou.win/",
    "https://todo.wangdou.win": "https://todo.wangdou.win/",
    "https://cl-todo-app-web.pages.dev": "https://todo.wangdou.win/",
    "https://cl-todo-app-web.pages.dev/": "https://todo.wangdou.win/",
    "https://license.wangdou.win": "https://license.wangdou.win/",
    "https://cl-license.pages.dev": "https://license.wangdou.win/",
    "https://cl-license.pages.dev/": "https://license.wangdou.win/",
    "https://carphone.wangdou.win": "https://carphone.wangdou.win/",
    "https://cl-car-phone.pages.dev": "https://carphone.wangdou.win/",
    "https://cl-car-phone.pages.dev/": "https://carphone.wangdou.win/",
    "https://nav.wangdou.win": "https://nav.wangdou.win/",
    "https://cl-nav.pages.dev": "https://nav.wangdou.win/",
    "https://cl-nav.pages.dev/": "https://nav.wangdou.win/",
    "https://ctool-nav.wangdou.win": "https://ctool-nav.wangdou.win/",
    "https://tool-nav-10a.pages.dev": "https://ctool-nav.wangdou.win/",
    "https://tool-nav-10a.pages.dev/": "https://ctool-nav.wangdou.win/",
    "https://tool-nav-vbb.pages.dev": "https://ctool-nav.wangdou.win/",
    "https://tool-nav-vbb.pages.dev/": "https://ctool-nav.wangdou.win/",
  };

  function ensureClApps(cfg) {
    const config = normalizeConfig(cfg);
    const seed = clAppsSeedLinks();
    if (!seed.length) return config;
    const tombstones = loadTombstones();

    const seedByKey = new Map(seed.map((l) => [linkKey(l), l]));
    const aliasToCanonical = new Map();
    Object.entries(CL_APPS_URL_ALIASES).forEach(([from, to]) => {
      aliasToCanonical.set(linkKey({ url: from }), linkKey({ url: to }));
    });

    let cat =
      config.categories.find((c) => c.id === "cl_apps") ||
      config.categories.find((c) => String(c.name || "").trim() === "CL 应用");
    if (!cat) {
      // 用户删除过整个「CL 应用」分类：不再强制重建
      if (tombstones.has(CAT_CL_TOMB)) return config;
      cat = { id: "cl_apps", name: "CL 应用", links: [], children: [] };
      config.categories.unshift(cat);
    } else {
      cat.id = "cl_apps";
      cat.name = "CL 应用";
      if (!Array.isArray(cat.children)) cat.children = [];
      config.categories = [
        cat,
        ...config.categories.filter((c) => c !== cat),
      ];
    }

    const nextLinks = [];
    const seen = new Set();

    (cat.links || []).forEach((raw) => {
      const link = normalizeLink(raw);
      let key = linkKey(link);
      if (!key) return;
      const canonical = aliasToCanonical.get(key);
      if (canonical && seedByKey.has(canonical)) {
        key = canonical;
        const seeded = seedByKey.get(canonical);
        link.url = seeded.url;
        link.title = seeded.title;
        link.desc = seeded.desc || link.desc;
        link.domain = seeded.domain || link.domain;
      } else if (seedByKey.has(key)) {
        const seeded = seedByKey.get(key);
        link.title = seeded.title;
        link.desc = seeded.desc || link.desc;
        link.domain = seeded.domain || link.domain;
      }
      if (seen.has(key)) return;
      seen.add(key);
      nextLinks.push(link);
    });

    seed.forEach((seeded) => {
      const key = linkKey(seeded);
      // 墓碑里的 seed 视为用户已删除，不再补回
      if (!key || seen.has(key) || tombstones.has(key)) return;
      seen.add(key);
      nextLinks.push(seeded);
    });

    cat.links = nextLinks;
    return config;
  }

  function normalizeConfig(parsed) {
    return {
      version: 1,
      brand: parsed.brand || "CL Nav",
      tagline: parsed.tagline || "",
      engines: parsed.engines || buildDefaults().engines,
      quickLinks: (parsed.quickLinks || []).map(normalizeLink),
      categories: (parsed.categories || []).map(normalizeCategory),
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
          children: (c.children || [])
            .map((ch) => ({
              id: ch.id,
              name: ch.name,
              links: ch.links
                .map((l) => ({ title: l.title, url: linkKey(l), desc: l.desc }))
                .sort((a, b) => a.url.localeCompare(b.url)),
            }))
            .sort((a, b) => String(a.id).localeCompare(String(b.id))),
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
      if (!text) return ensureClApps(buildDefaults());
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.categories)) return ensureClApps(buildDefaults());
      // 本地 JSON 即为真相：删除的分类/网站不会在刷新后被默认数据加回来
      // 仅补齐「CL 应用」工作区测试/生产入口
      return ensureClApps(normalizeConfig(parsed));
    } catch {
      return ensureClApps(buildDefaults());
    }
  }

  let state = load();
  const listeners = new Set();
  let syncing = false;

  // 迁移写入：补齐 CL 应用后立刻持久化，便于 CF 同步带上新链接
  try {
    const before = localStorage.getItem(KEY);
    const after = JSON.stringify(state);
    if (before !== after) {
      localStorage.setItem(KEY, after);
      if (window.NavCfSync?.markDirty) {
        setTimeout(() => {
          try {
            NavCfSync.markDirty();
          } catch (_) {}
        }, 0);
      }
    }
  } catch (_) {}

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
    state = ensureClApps(normalizeConfig(next));
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
    ensureClApps,

    get() {
      return clone(state);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    reset() {
      // 恢复默认 = 清空删除墓碑，CL 应用 seed 一并回来
      saveTombstones(new Set());
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

    /** @param {string|null} [childId] parent links when null/omitted */
    reorderLinks(catId, from, to, childId) {
      const leaf = resolveLeaf(state.categories, catId, childId || null);
      if (!leaf) return;
      const arr = leaf.links;
      if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      persist();
    },

    /** Reorder links by original indices in their new order (grid drag). */
    reorderLinksByOrder(catId, orderedIndices, childId) {
      const leaf = resolveLeaf(state.categories, catId, childId || null);
      if (!leaf) return;
      const arr = leaf.links;
      const idxs = (orderedIndices || []).map((i) => +i);
      if (idxs.length !== arr.length) return;
      const seen = new Set();
      for (const i of idxs) {
        if (!Number.isInteger(i) || i < 0 || i >= arr.length || seen.has(i)) return;
        seen.add(i);
      }
      leaf.links = idxs.map((i) => arr[i]);
      persist();
    },

    reorderCategories(from, to) {
      const arr = state.categories;
      if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      persist();
    },

    reorderChildren(catId, from, to) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      const arr = cat.children || (cat.children = []);
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
      const cat = { id: uid("cat"), name: (name || "新分类").trim() || "新分类", links: [], children: [] };
      state.categories.push(cat);
      persist();
      return clone(cat);
    },

    addChildCategory(catId, name) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return null;
      if (!Array.isArray(cat.children)) cat.children = [];
      const child = {
        id: uid("sub"),
        name: (name || "新子分类").trim() || "新子分类",
        links: [],
      };
      cat.children.push(child);
      persist();
      return clone(child);
    },

    updateCategory(id, patch) {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return;
      if (patch.name != null) cat.name = String(patch.name).trim() || cat.name;
      persist();
    },

    updateChildCategory(catId, childId, patch) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      const child = (cat.children || []).find((ch) => ch.id === childId);
      if (!child) return;
      if (patch.name != null) child.name = String(patch.name).trim() || child.name;
      persist();
    },

    removeCategory(id) {
      if (id === "cl_apps") {
        const tomb = loadTombstones();
        if (!tomb.has(CAT_CL_TOMB)) {
          tomb.add(CAT_CL_TOMB);
          saveTombstones(tomb);
        }
      }
      state.categories = state.categories.filter((c) => c.id !== id);
      persist();
    },

    removeChildCategory(catId, childId) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat || !Array.isArray(cat.children)) return;
      cat.children = cat.children.filter((ch) => ch.id !== childId);
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

    moveChildCategory(catId, childId, dir) {
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat || !Array.isArray(cat.children)) return;
      const i = cat.children.findIndex((ch) => ch.id === childId);
      if (i < 0) return;
      const j = i + dir;
      if (j < 0 || j >= cat.children.length) return;
      const tmp = cat.children[i];
      cat.children[i] = cat.children[j];
      cat.children[j] = tmp;
      persist();
    },

    /** Move a child subcategory under another parent (append). */
    moveChildToParent(fromCatId, childId, toCatId) {
      if (!fromCatId || !toCatId || !childId) return false;
      const from = state.categories.find((c) => c.id === fromCatId);
      const to = state.categories.find((c) => c.id === toCatId);
      if (!from || !to) return false;
      if (!Array.isArray(from.children)) from.children = [];
      if (!Array.isArray(to.children)) to.children = [];
      const i = from.children.findIndex((ch) => ch.id === childId);
      if (i < 0) return false;
      if (fromCatId === toCatId) return false;
      const [child] = from.children.splice(i, 1);
      to.children.push(child);
      persist();
      return true;
    },

    addLink(catId, link, childId) {
      const leaf = resolveLeaf(state.categories, catId, childId || null);
      if (!leaf) return;
      leaf.links.push(normalizeLink(link));
      persist();
    },

    updateLink(catId, index, link, childId) {
      const leaf = resolveLeaf(state.categories, catId, childId || null);
      if (!leaf || index < 0 || index >= leaf.links.length) return;
      leaf.links[index] = normalizeLink(link);
      persist();
    },

    removeLink(catId, index, childId) {
      const leaf = resolveLeaf(state.categories, catId, childId || null);
      if (!leaf) return;
      const removed = leaf.links[index];
      leaf.links.splice(index, 1);
      rememberRemovedLinks([removed]);
      persist();
    },

    /** Remove multiple links by index (any order). */
    removeLinks(catId, indices, childId) {
      const leaf = resolveLeaf(state.categories, catId, childId || null);
      if (!leaf) return;
      const set = new Set(
        (indices || [])
          .map((i) => +i)
          .filter((i) => Number.isInteger(i) && i >= 0 && i < leaf.links.length)
      );
      if (!set.size) return;
      const removed = leaf.links.filter((_, i) => set.has(i));
      leaf.links = leaf.links.filter((_, i) => !set.has(i));
      rememberRemovedLinks(removed);
      persist();
    },

    moveLink(catId, index, dir, childId) {
      const leaf = resolveLeaf(state.categories, catId, childId || null);
      if (!leaf) return;
      const j = index + dir;
      if (index < 0 || j < 0 || index >= leaf.links.length || j >= leaf.links.length) return;
      const tmp = leaf.links[index];
      leaf.links[index] = leaf.links[j];
      leaf.links[j] = tmp;
      persist();
    },

    /**
     * Move a link between leaves.
     * toChildId null → parent-level links of toCatId.
     * fromChildId/toChildId optional for backward compat (parent↔parent).
     */
    moveLinkToCategory(fromCatId, linkIndex, toCatId, fromChildId, toChildId) {
      // Legacy 3-arg / 4th string as toCat only — support opts object as 4th arg
      let fromChild = fromChildId || null;
      let toChild = toChildId || null;
      if (fromChildId && typeof fromChildId === "object") {
        fromChild = fromChildId.fromChildId || null;
        toChild = fromChildId.toChildId || null;
      }
      if (!fromCatId || !toCatId) return false;
      const sameLeaf =
        fromCatId === toCatId && String(fromChild || "") === String(toChild || "");
      if (sameLeaf) return false;
      const from = resolveLeaf(state.categories, fromCatId, fromChild);
      const to = resolveLeaf(state.categories, toCatId, toChild);
      if (!from || !to) return false;
      const i = +linkIndex;
      if (!Number.isInteger(i) || i < 0 || i >= from.links.length) return false;
      const [link] = from.links.splice(i, 1);
      to.links.push(link);
      persist();
      return true;
    },

    catLinkCount,
    resolveLeaf,

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
