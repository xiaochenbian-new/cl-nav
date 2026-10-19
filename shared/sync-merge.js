/**
 * CL Nav — 同步三方合并引擎（纯函数）
 *
 * 用于「base（本机上次同步的版本） / remote（云端最新） / local（本机当前）」三方合并。
 * 目标：多台电脑同时编辑时不再整份覆盖，双方改动都保留，删除也能正确传播。
 *
 * 合并规则（对每个条目）：
 *   1. local 与 remote 相同            → 保留
 *   2. 只有一方相对 base 改动           → 取改动方（含删除）
 *   3. 双方都改且字段不同               → 字段级合并；同一字段冲突取 JSON 序列化较小者
 *      （与合并方向无关，两台设备结果一致）
 *   4. 一方删除、另一方修改             → 保留修改（宁可多一条，不丢数据），并记录冲突
 *   5. 数组顺序：只有一方调整时采纳该方；双方都调整时同样按内容确定性选择
 *      （被选中顺序里缺失的存活条目会追加，不会丢）
 *
 * 条目身份：
 *   - 分类/子分类：id，其次 name
 *   - 网站链接：URL（忽略大小写与末尾 /），其次标题
 *   - 搜索引擎：id，其次 URL
 *
 * 该文件同时支持浏览器（window.NavSyncMerge）与 Node（module.exports），便于单测。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NavSyncMerge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EMPTY_DOC = {
    version: 1,
    brand: "",
    tagline: "",
    engines: [],
    quickLinks: [],
    categories: [],
    removedSeeds: [],
  };

  function str(v) {
    return v == null ? "" : String(v);
  }

  function trim(v) {
    return str(v).trim();
  }

  function urlKey(url) {
    return trim(url).toLowerCase().replace(/\/+$/, "");
  }

  function linkKey(link) {
    const u = urlKey(link && link.url);
    if (u) return "u:" + u;
    const title = trim(link && link.title).toLowerCase();
    return "t:" + title + "|" + trim(link && link.desc).toLowerCase();
  }

  function catKey(cat) {
    const id = trim(cat && cat.id);
    if (id) return "id:" + id;
    return "name:" + trim(cat && cat.name).toLowerCase();
  }

  function childKey(child) {
    const id = trim(child && child.id);
    if (id) return "id:" + id;
    return "name:" + trim(child && child.name).toLowerCase();
  }

  function engineKey(engine) {
    const id = trim(engine && engine.id);
    if (id) return "id:" + id;
    return "url:" + urlKey(engine && engine.url);
  }

  function normLink(raw) {
    const l = raw && typeof raw === "object" ? raw : {};
    return {
      title: trim(l.title),
      url: trim(l.url),
      desc: trim(l.desc),
      domain: trim(l.domain),
    };
  }

  function normChild(raw) {
    const c = raw && typeof raw === "object" ? raw : {};
    return {
      id: trim(c.id),
      name: trim(c.name),
      links: (Array.isArray(c.links) ? c.links : []).map(normLink),
    };
  }

  function normCategory(raw) {
    const c = raw && typeof raw === "object" ? raw : {};
    return {
      id: trim(c.id),
      name: trim(c.name),
      links: (Array.isArray(c.links) ? c.links : []).map(normLink),
      children: (Array.isArray(c.children) ? c.children : []).map(normChild),
    };
  }

  function normEngine(raw) {
    const e = raw && typeof raw === "object" ? raw : {};
    return {
      id: trim(e.id),
      name: trim(e.name),
      url: trim(e.url),
      icon: trim(e.icon),
    };
  }

  /** 归一化一份备份文档（同时也是发送给服务端的标准结构） */
  function normalizeDoc(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    return {
      version: Number(d.version) || 1,
      brand: trim(d.brand),
      tagline: trim(d.tagline),
      engines: (Array.isArray(d.engines) ? d.engines : []).map(normEngine),
      quickLinks: (Array.isArray(d.quickLinks) ? d.quickLinks : []).map(normLink),
      categories: (Array.isArray(d.categories) ? d.categories : []).map(normCategory),
      removedSeeds: Array.isArray(d.removedSeeds)
        ? [...new Set(d.removedSeeds.map((x) => trim(x)).filter(Boolean))].sort()
        : [],
    };
  }

  function emptyDoc() {
    return normalizeDoc(EMPTY_DOC);
  }

  function eq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function sameDoc(a, b) {
    return eq(normalizeDoc(a), normalizeDoc(b));
  }

  function sameSeq(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function brief(value) {
    if (value === undefined || value === null) return null;
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > 180 ? s.slice(0, 180) + "…" : s;
  }

  function record(ctx, path, kind, base, local, remote, chosen) {
    if (!ctx || ctx.conflicts.length >= 200) return;
    ctx.conflicts.push({
      path,
      kind,
      base: brief(base),
      local: brief(local),
      remote: brief(remote),
      chosen: brief(chosen),
    });
  }

  /**
   * 同一字段两边改成不同值时的确定性裁决：
   * 取 JSON 序列化后较小的一方。该规则与“哪边是 local”无关，
   * 因此任意设备、任意合并方向都会得到相同结果。
   */
  function pickDeterministic(a, b) {
    const sa = typeof a === "string" ? a : JSON.stringify(a);
    const sb = typeof b === "string" ? b : JSON.stringify(b);
    return sa <= sb ? a : b;
  }

  function mergeScalar(base, local, remote, path, ctx, hasBase) {
    if (local === remote) return local;
    if (hasBase && local === base) return remote;
    if (hasBase && remote === base) return local;
    const chosen = pickDeterministic(local, remote);
    record(ctx, path, "both-changed", base, local, remote, chosen);
    return chosen;
  }

  function indexList(list, keyFn) {
    const map = new Map();
    for (const item of list || []) {
      const key = keyFn(item);
      if (!key) continue;
      if (!map.has(key)) map.set(key, item);
    }
    return map;
  }

  function collectKeys(baseOrder, localOrder, remoteOrder, maps) {
    const out = [];
    const seen = new Set();
    const add = (key) => {
      if (!key || seen.has(key)) return;
      if (!maps.some((m) => m.has(key))) return;
      seen.add(key);
      out.push(key);
    };
    baseOrder.forEach(add);
    localOrder.forEach(add);
    remoteOrder.forEach(add);
    for (const map of maps) for (const key of map.keys()) add(key);
    return out;
  }

  function applyOrder(alive, baseOrder, localOrder, remoteOrder) {
    const has = (key) => alive.has(key);
    const b = baseOrder.filter(has);
    const l = localOrder.filter(has);
    const r = remoteOrder.filter(has);
    const baseSet = new Set(baseOrder);
    const lCommon = l.filter((key) => baseSet.has(key));
    const rCommon = r.filter((key) => baseSet.has(key));
    const movedLocal = !sameSeq(lCommon, b);
    const movedRemote = !sameSeq(rCommon, b);

    let chosen;
    if (movedLocal && movedRemote) {
      chosen = sameSeq(l, r) ? l : pickDeterministic(l, r);
    } else if (movedLocal) {
      chosen = l;
    } else if (movedRemote) {
      chosen = r;
    } else {
      chosen = b;
    }

    const out = [];
    const seen = new Set();
    const add = (key) => {
      if (!has(key) || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    };
    chosen.forEach(add);
    if (chosen === b) {
      // 双方都没有调整顺序，只是各自新增了条目：
      // 按 key 排序追加，保证 merge3(base, remote, local) 与
      // merge3(base, local, remote) 得到完全相同的顺序。
      [...alive.keys()].sort().forEach(add);
    } else {
      // 采纳一方的顺序，再把另一方的条目按它自己的顺序追加，最后兜底
      (chosen === r ? l : r).forEach(add);
      localOrder.forEach(add);
      remoteOrder.forEach(add);
      baseOrder.forEach(add);
      [...alive.keys()].sort().forEach(add);
    }
    return out.map((key) => alive.get(key));
  }

  function mergeEntityList(
    baseList,
    localList,
    remoteList,
    keyFn,
    mergeFields,
    path,
    ctx,
    hasBase
  ) {
    const bMap = indexList(baseList, keyFn);
    const lMap = indexList(localList, keyFn);
    const rMap = indexList(remoteList, keyFn);
    const bOrder = (baseList || []).map(keyFn).filter(Boolean);
    const lOrder = (localList || []).map(keyFn).filter(Boolean);
    const rOrder = (remoteList || []).map(keyFn).filter(Boolean);

    const alive = new Map();
    const keys = collectKeys(bOrder, lOrder, rOrder, [bMap, lMap, rMap]);

    for (const key of keys) {
      const childPath = path ? path + "/" + key : key;
      const b = hasBase ? bMap.get(key) : undefined;
      const l = lMap.get(key);
      const r = rMap.get(key);
      let out = null;

      if (l && r) {
        if (eq(l, r)) out = l;
        else if (b && eq(l, b)) out = r;
        else if (b && eq(r, b)) out = l;
        else out = mergeFields(b, l, r, childPath, ctx);
      } else if (l) {
        if (!b) {
          out = l;
        } else if (!eq(l, b)) {
          record(ctx, childPath, "remote-deleted-local-edited", b, l, null, l);
          out = l;
        }
      } else if (r) {
        if (!b) {
          out = r;
        } else if (!eq(r, b)) {
          record(ctx, childPath, "local-deleted-remote-edited", b, null, r, r);
          out = r;
        }
      }

      if (out) alive.set(key, out);
    }

    return applyOrder(alive, bOrder, lOrder, rOrder);
  }

  function mergeLinkFields(base, local, remote, path, ctx) {
    return {
      title: mergeScalar(base && base.title, local.title, remote.title, path + ".title", ctx, !!base),
      url: local.url || remote.url || (base && base.url) || "",
      desc: mergeScalar(base && base.desc, local.desc, remote.desc, path + ".desc", ctx, !!base),
      domain: mergeScalar(base && base.domain, local.domain, remote.domain, path + ".domain", ctx, !!base),
    };
  }

  function mergeChildFields(base, local, remote, path, ctx) {
    return {
      id: local.id || remote.id || (base && base.id) || "",
      name: mergeScalar(base && base.name, local.name, remote.name, path + ".name", ctx, !!base),
      links: mergeEntityList(
        base ? base.links : [],
        local.links,
        remote.links,
        linkKey,
        mergeLinkFields,
        path + ".links",
        ctx,
        !!base
      ),
    };
  }

  function mergeCategoryFields(base, local, remote, path, ctx) {
    return {
      id: local.id || remote.id || (base && base.id) || "",
      name: mergeScalar(base && base.name, local.name, remote.name, path + ".name", ctx, !!base),
      links: mergeEntityList(
        base ? base.links : [],
        local.links,
        remote.links,
        linkKey,
        mergeLinkFields,
        path + ".links",
        ctx,
        !!base
      ),
      children: mergeEntityList(
        base ? base.children : [],
        local.children,
        remote.children,
        childKey,
        mergeChildFields,
        path + ".children",
        ctx,
        !!base
      ),
    };
  }

  function mergeEngineFields(base, local, remote, path, ctx) {
    return {
      id: local.id || remote.id || (base && base.id) || "",
      name: mergeScalar(base && base.name, local.name, remote.name, path + ".name", ctx, !!base),
      url: mergeScalar(base && base.url, local.url, remote.url, path + ".url", ctx, !!base),
      icon: mergeScalar(base && base.icon, local.icon, remote.icon, path + ".icon", ctx, !!base),
    };
  }

  /**
   * 三方合并。
   * @param {object|null} baseDoc  上次同步时的文档；传 null 表示没有共同祖先（首次连接，按并集处理）
   * @param {object} remoteDoc     云端最新文档
   * @param {object} localDoc      本机当前文档
   * @param {{localId?:string, remoteId?:string}} [opts] 兼容旧调用，合并规则不再依赖设备 ID
   * @returns {{doc: object, conflicts: Array}}
   */
  function merge3(baseDoc, remoteDoc, localDoc, opts) {
    void opts;
    const hasBase = !!baseDoc && typeof baseDoc === "object";
    const base = normalizeDoc(hasBase ? baseDoc : EMPTY_DOC);
    const remote = normalizeDoc(remoteDoc);
    const local = normalizeDoc(localDoc);

    const ctx = { conflicts: [] };

    const doc = {
      version: Math.max(base.version || 1, remote.version || 1, local.version || 1),
      brand: mergeScalar(
        hasBase ? base.brand : undefined,
        local.brand,
        remote.brand,
        "brand",
        ctx,
        hasBase
      ),
      tagline: mergeScalar(
        hasBase ? base.tagline : undefined,
        local.tagline,
        remote.tagline,
        "tagline",
        ctx,
        hasBase
      ),
      engines: mergeEntityList(
        hasBase ? base.engines : [],
        local.engines,
        remote.engines,
        engineKey,
        mergeEngineFields,
        "engines",
        ctx,
        hasBase
      ),
      quickLinks: mergeEntityList(
        hasBase ? base.quickLinks : [],
        local.quickLinks,
        remote.quickLinks,
        linkKey,
        mergeLinkFields,
        "quickLinks",
        ctx,
        hasBase
      ),
      categories: mergeEntityList(
        hasBase ? base.categories : [],
        local.categories,
        remote.categories,
        catKey,
        mergeCategoryFields,
        "categories",
        ctx,
        hasBase
      ),
      removedSeeds: [...new Set([...(remote.removedSeeds || []), ...(local.removedSeeds || [])])].sort(),
    };

    return { doc: normalizeDoc(doc), conflicts: ctx.conflicts };
  }

  /** 给 UI 用的简短冲突描述 */
  function describeConflict(conflict) {
    if (!conflict || typeof conflict !== "object") return "";
    const path = String(conflict.path || "").replace(/^categories\/id:/, "分类 ").replace(/\/links\/u:/g, " / 链接 ");
    const kindMap = {
      "both-changed": "两边都修改了同一字段",
      "remote-deleted-local-edited": "云端删除了、本机修改了（保留修改）",
      "local-deleted-remote-edited": "本机删除了、云端修改了（保留修改）",
    };
    return (kindMap[conflict.kind] || conflict.kind || "冲突") + "：" + path;
  }

  return {
    EMPTY_DOC,
    normalizeDoc,
    emptyDoc,
    sameDoc,
    merge3,
    describeConflict,
    // 便于测试/排查
    _internals: { linkKey, catKey, childKey, engineKey, eq, sameSeq },
  };
});
