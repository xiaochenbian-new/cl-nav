/**
 * CL Nav — Cloudflare 多端同步
 *
 * v2（推荐）：/api/sync2 + D1
 *   - 每个口令一份文档 + 单调递增 rev
 *   - 提交必须带 baseRev，服务端用 SQL CAS 原子校验
 *   - 版本落后返回 409，客户端三方合并后重试
 *   - 结果：旧设备无法再整份覆盖新版本，双方改动都会保留
 *
 * 兼容：若服务端未绑定 D1（503），自动回退到旧 /api/sync + KV 整份覆盖，
 *       并在结果里明确提示“兼容模式”，避免升级代码后同步直接不可用。
 */
(function () {
  const PREFS_KEY = "cl-nav-cf-sync-prefs-v1";
  const BASE_KEY = "cl-nav-cf-sync-base-v2";
  const V2_PATH = "/api/sync2";
  const LEGACY_PATH = "/api/sync";
  const PUSH_DEBOUNCE_MS = 1500;

  function syncUrl(path) {
    return window.ClNavApi?.url?.(path) || path;
  }

  function defaultPrefs() {
    return {
      token: "",
      autoSync: false,
      deviceId: "",
      dirty: false,
      baseRev: 0,
      lastSyncAt: 0,
      lastMessage: "",
      lastConflicts: [],
      lastConflictCount: 0,
      mode: "",
      // 旧版兼容模式字段
      lastUploadExportedAt: 0,
      remoteNewerSkipAt: 0,
    };
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        ...defaultPrefs(),
        ...raw,
        token: String(raw.token || "").trim(),
        deviceId: String(raw.deviceId || "").trim(),
        autoSync: !!raw.autoSync,
        // 旧版字段是 localDirty；升级后沿用，避免首次 v2 同步漏推
        dirty: raw.dirty != null ? !!raw.dirty : !!raw.localDirty,
        baseRev: Number(raw.baseRev) || 0,
        lastConflicts: Array.isArray(raw.lastConflicts) ? raw.lastConflicts.slice(0, 20) : [],
        lastConflictCount: Number(raw.lastConflictCount) || 0,
      };
    } catch (_) {
      return defaultPrefs();
    }
  }

  function savePrefs(patch) {
    const cur = loadPrefs();
    const next = { ...cur, ...(patch || {}) };
    const tokenChanged =
      patch && patch.token != null && String(patch.token).trim() !== String(cur.token || "").trim();
    if (tokenChanged) {
      // 换口令 = 换一份云端文档，旧 base 不能再用
      next.baseRev = 0;
      next.dirty = true;
      next.lastUploadExportedAt = 0;
      next.lastSyncAt = 0;
      next.lastConflicts = [];
      next.lastConflictCount = 0;
      next.lastMessage = "";
      clearBase();
    }
    next.token = String(next.token || "").trim();
    next.deviceId = String(next.deviceId || "").trim();
    next.dirty = !!next.dirty;
    next.autoSync = !!next.autoSync;
    next.baseRev = Number(next.baseRev) || 0;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch (_) {}
    return next;
  }

  /**
   * base（上次同步的基准）必须和「本标签页内存里的 NavStore 状态」一一对应，
   * 所以存 sessionStorage：多标签页各自独立同步，避免 A 标签同步后
   * B 标签拿着旧状态 + 新 base 把 A 的改动“合并回去”。
   * 没有 sessionStorage 时退回 localStorage（单标签页/测试环境）。
   */
  function baseStorage() {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) return sessionStorage;
    } catch (_) {}
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch (_) {}
    return null;
  }

  function loadBase() {
    try {
      const storage = baseStorage();
      if (!storage) return null;
      const raw = JSON.parse(storage.getItem(BASE_KEY) || "null");
      if (!raw || typeof raw !== "object" || !raw.doc) return null;
      if (String(raw.token || "") !== String(loadPrefs().token || "")) return null;
      return { rev: Number(raw.rev) || 0, doc: raw.doc };
    } catch (_) {
      return null;
    }
  }

  function saveBase(rev, doc, token) {
    try {
      const storage = baseStorage();
      if (!storage) return;
      storage.setItem(
        BASE_KEY,
        JSON.stringify({ token: String(token || ""), rev: Number(rev) || 0, doc })
      );
    } catch (_) {}
  }

  function clearBase() {
    try {
      const storage = baseStorage();
      if (storage) storage.removeItem(BASE_KEY);
    } catch (_) {}
  }

  function getDeviceId() {
    const prefs = loadPrefs();
    if (prefs.deviceId) return prefs.deviceId;
    let id = "";
    try {
      const bytes = new Uint8Array(9);
      crypto.getRandomValues(bytes);
      id = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
    } catch (_) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    }
    id = "dev_" + (id || Math.random().toString(36).slice(2, 10));
    savePrefs({ deviceId: id });
    return id;
  }

  function isReady(cfg) {
    const c = cfg || loadPrefs();
    return !!(c.token && String(c.token).trim().length >= 8);
  }

  function validate(cfg) {
    if (!cfg || !cfg.token || String(cfg.token).trim().length < 8) {
      throw new Error("请设置至少 8 位同步口令（各设备填写相同口令）");
    }
  }

  function generateToken() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz";
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  async function api(method, cfg, path, body) {
    validate(cfg);
    const init = {
      method,
      headers: { Authorization: "Bearer " + String(cfg.token).trim() },
      cache: "no-store",
    };
    if (body != null) {
      init.headers["Content-Type"] = "application/json; charset=utf-8";
      init.body = body;
    }
    try {
      return await fetch(syncUrl(path), init);
    } catch (err) {
      throw new Error(
        "无法连接同步接口 " +
          syncUrl(path) +
          "（GitHub Pages 会自动走 cl-nav.pages.dev）。" +
          (err && err.message ? " " + err.message : "")
      );
    }
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch (_) {
      return {};
    }
  }

  function d1NotBound(message) {
    const err = new Error(message || "D1 未绑定");
    err.code = "D1_NOT_BOUND";
    return err;
  }

  // ---------------------------------------------------------------- v2（D1）

  async function readRemoteV2(cfg) {
    const res = await api("GET", cfg, V2_PATH);
    if (res.status === 200) {
      const j = await readJson(res);
      if (!j || typeof j !== "object" || !j.doc || !Array.isArray(j.doc.categories)) {
        throw new Error("云端返回格式不正确");
      }
      return {
        rev: Number(j.rev) || 0,
        doc: j.doc,
        updatedAt: Number(j.updatedAt) || 0,
        writer: String(j.writer || ""),
      };
    }
    if (res.status === 404) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) {
        // 接口还不存在（旧部署）：回退旧 KV
        throw d1NotBound("同步接口 /api/sync2 尚未部署");
      }
      const j = await readJson(res);
      if (j.empty) return null;
      return null;
    }
    if (res.status === 401) throw new Error("同步口令无效或过短");
    if (res.status === 503) {
      const j = await readJson(res);
      if (j && j.code === "D1_NOT_BOUND") throw d1NotBound(j.error);
      throw new Error(j.error || "云端暂时不可用（HTTP 503），请稍后重试");
    }
    const j = await readJson(res);
    throw new Error(j.error || "读取云端失败 HTTP " + res.status);
  }

  async function putRemoteV2(cfg, baseRev, doc) {
    const res = await api(
      "PUT",
      cfg,
      V2_PATH,
      JSON.stringify({ baseRev, doc, deviceId: cfg.deviceId })
    );
    if (res.status === 200) {
      const j = await readJson(res);
      return { ok: true, rev: Number(j.rev) || 0, updatedAt: Number(j.updatedAt) || 0 };
    }
    if (res.status === 409) {
      const j = await readJson(res);
      if (!j || typeof j !== "object" || !Object.prototype.hasOwnProperty.call(j, "rev")) {
        throw new Error("云端冲突响应异常，已中止以避免误覆盖");
      }
      return {
        conflict: true,
        rev: Number(j.rev) || 0,
        doc: j.doc || null,
        writer: String(j.writer || ""),
        error: j.error,
      };
    }
    if (res.status === 401) throw new Error("同步口令无效或过短");
    if (res.status === 503) {
      const j = await readJson(res);
      if (j && j.code === "D1_NOT_BOUND") throw d1NotBound(j.error);
      throw new Error(j.error || "云端暂时不可用（HTTP 503），请稍后重试");
    }
    const j = await readJson(res);
    throw new Error(j.error || "提交到云端失败 HTTP " + res.status);
  }

  function exportLocalDoc() {
    let obj;
    try {
      obj = JSON.parse(NavStore.exportBackup({ ensureDefaults: false }));
    } catch (_) {
      obj = NavStore.get();
    }
    delete obj.exportedAt;
    delete obj.library;
    return window.NavSyncMerge ? NavSyncMerge.normalizeDoc(obj) : obj;
  }

  function applyNavDoc(doc) {
    NavStore.applyBackup(doc, { markClean: true, mode: "replace" });
  }

  function recordConflicts(conflicts) {
    if (!conflicts || !conflicts.length) return;
    const items = conflicts
      .slice(0, 20)
      .map((c) => (window.NavSyncMerge ? NavSyncMerge.describeConflict(c) : String(c && c.path)))
      .filter(Boolean);
    savePrefs({
      lastConflicts: items,
      lastConflictCount: conflicts.length,
      lastSyncAt: Date.now(),
    });
  }

  let engine = null;
  let engineToken = "";
  let pendingPushTries = 0;

  function getEngine(cfg) {
    if (!window.NavSyncEngine || !window.NavSyncMerge) {
      throw new Error("同步模块未加载：请确认 sync-merge.js / sync-engine.js 已引入");
    }
    if (engine && engineToken === cfg.token) return engine;
    engineToken = cfg.token;
    engine = window.NavSyncEngine.createSyncEngine({
      deviceId: () => cfg.deviceId,
      getRemote: () => readRemoteV2(cfg),
      putRemote: (baseRev, doc) => putRemoteV2(cfg, baseRev, doc),
      applyRemote: async (doc) => applyNavDoc(doc),
      exportLocal: exportLocalDoc,
      getBase: () => {
        const base = loadBase();
        return base ? { rev: base.rev, doc: base.doc } : null;
      },
      setBase: (rev, doc) => {
        saveBase(rev, doc, cfg.token);
        savePrefs({ baseRev: rev, dirty: false, lastSyncAt: Date.now(), mode: "v2" });
      },
      hasUserData: () => NavStore.hasUserData(),
      isDirty: () => loadPrefs().dirty,
    });
    return engine;
  }

  async function runSyncV2(cfg, mode) {
    const result = await getEngine(cfg).sync(mode);
    recordConflicts(result.conflicts);
    // 提交/拉取成功后，本机可能还有“同步期间产生的新编辑”或 store 规范化差异；
    // 与 base 比较后再决定 dirty，避免这些改动要等到下次打开页面才上传。
    let pending = false;
    try {
      const base = loadBase();
      pending = !base || !window.NavSyncMerge.sameDoc(exportLocalDoc(), base.doc);
    } catch (_) {
      pending = true;
    }
    const baseMessage = result.message || "同步完成";
    const message =
      pending && !/本机还有改动|稍后继续/.test(baseMessage)
        ? baseMessage + "；本机还有改动待上传"
        : baseMessage;
    savePrefs({
      mode: "v2",
      lastSyncAt: Date.now(),
      lastMessage: message,
      dirty: pending,
      remoteNewerSkipAt: 0,
    });
    if (!pending) {
      pendingPushTries = 0;
    } else if (pendingPushTries < 3) {
      // 最多连续补推 3 次，防止 store 规范化差异导致无限推送
      pendingPushTries += 1;
      schedulePush(800);
    }
    return { ...result, message, pending };
  }

  // ------------------------------------------------------- 旧版 KV（兼容回退）

  async function downloadLegacyOrNull(cfg) {
    const res = await api("GET", cfg, LEGACY_PATH);
    if (res.status === 404) return null;
    if (res.status === 503) {
      const j = await readJson(res);
      throw new Error(j.error || "云端 KV 未绑定（CL_NAV_SYNC）");
    }
    if (res.status === 401) throw new Error("同步口令无效或过短");
    if (!res.ok) {
      const j = await readJson(res);
      throw new Error(j.error || "下载失败 HTTP " + res.status);
    }
    return await res.text();
  }

  async function uploadLegacy(cfg, jsonText) {
    const res = await api("PUT", cfg, LEGACY_PATH, jsonText);
    if (res.status === 503) {
      const j = await readJson(res);
      throw new Error(j.error || "云端 KV 未绑定（CL_NAV_SYNC）");
    }
    if (res.status === 401) throw new Error("同步口令无效或过短");
    if (!res.ok) {
      const j = await readJson(res);
      throw new Error(j.error || "上传失败 HTTP " + res.status);
    }
    const info = await readJson(res);
    const stamp =
      Number(info.exportedAt) || NavStore.exportedAtOf(jsonText) || Date.now();
    savePrefs({ lastUploadExportedAt: stamp, remoteNewerSkipAt: 0, dirty: false });
    return { message: "已上传到 Cloudflare 云端（兼容模式）", exportedAt: stamp, mode: "legacy" };
  }

  async function runSyncLegacy(cfg, mode) {
    const localJson = NavStore.exportBackup({ ensureDefaults: false });
    const remote = await downloadLegacyOrNull(cfg);
    const prefs = loadPrefs();
    const last = prefs.lastUploadExportedAt;
    const dirty = prefs.dirty;

    if (remote == null) {
      const r = await uploadLegacy(cfg, localJson);
      return { ...r, pushed: true, message: r.message };
    }

    if (NavStore.sameContent(localJson, remote)) {
      const remoteAt = NavStore.exportedAtOf(remote);
      savePrefs({
        lastUploadExportedAt: remoteAt || Date.now(),
        dirty: false,
        remoteNewerSkipAt: 0,
        mode: "legacy",
      });
      return { message: "本地与云端数据一致（兼容模式）", mode: "legacy" };
    }

    const remoteAt = NavStore.exportedAtOf(remote);
    const remoteNewer = last <= 0 || remoteAt > last;

    const doPull = async () => {
      NavStore.applyBackup(remote, { markClean: true, mode: "replace" });
      savePrefs({
        lastUploadExportedAt: remoteAt || Date.now(),
        dirty: false,
        remoteNewerSkipAt: 0,
        mode: "legacy",
      });
      return { message: "已从云端同步到本机（兼容模式）", pulled: true, mode: "legacy" };
    };

    const doPush = async () => {
      const json = NavStore.exportBackup({ ensureDefaults: false });
      const r = await uploadLegacy(cfg, json);
      return { ...r, pushed: true };
    };

    if (mode === "PULL") {
      if (!remoteNewer) return { message: "云端无更新（兼容模式）", mode: "legacy" };
      if (dirty) return doPush();
      if (last <= 0 && NavStore.hasUserData()) {
        savePrefs({ remoteNewerSkipAt: remoteAt || 1, mode: "legacy" });
        return {
          message: "云端有备份且与本机不一致，请手动「从云端恢复」或「立即同步」（兼容模式）",
          mode: "legacy",
        };
      }
      return doPull();
    }

    if (mode === "PUSH") return doPush();

    if (remoteNewer && !dirty) {
      if (last <= 0 && NavStore.hasUserData()) {
        savePrefs({ remoteNewerSkipAt: remoteAt || 1, mode: "legacy" });
        return {
          message: "云端有备份且与本机不一致，请手动「从云端恢复」或「立即同步」（兼容模式）",
          mode: "legacy",
        };
      }
      return doPull();
    }
    return doPush();
  }

  async function runSync(mode) {
    const prefs = loadPrefs();
    if (!isReady(prefs)) return { message: "请先设置同步口令" };
    validate(prefs);
    const cfg = { token: prefs.token.trim(), deviceId: getDeviceId() };

    try {
      return await runSyncV2(cfg, mode);
    } catch (err) {
      if (err && err.code === "D1_NOT_BOUND") {
        const legacy = await runSyncLegacy(cfg, mode);
        const fallbackMessage =
          (legacy.message || "已按兼容模式同步") +
          "｜注意：D1 未绑定，当前仍是旧版「整份覆盖」，多台电脑同时编辑可能互相覆盖。请按设置页说明绑定 CL_NAV_DB。";
        savePrefs({ mode: "legacy", lastMessage: fallbackMessage });
        return {
          ...legacy,
          mode: "legacy",
          fallback: true,
          message: fallbackMessage,
        };
      }
      savePrefs({ lastMessage: (err && err.message) || "同步失败" });
      throw err;
    }
  }

  // 串行化，避免“自动推送 + 手动同步”同时跑
  let chain = Promise.resolve();
  function sync(mode = "FULL") {
    const run = () => runSync(String(mode || "FULL").toUpperCase());
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  let pushTimer = null;

  function schedulePush(delayMs = PUSH_DEBOUNCE_MS) {
    const prefs = loadPrefs();
    if (!prefs.autoSync || !isReady(prefs)) return;
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      pushTimer = null;
      sync("PUSH").catch(() => {});
    }, Math.max(0, delayMs));
  }

  function flushPush() {
    const prefs = loadPrefs();
    if (!prefs.autoSync || !isReady(prefs)) return;
    window.clearTimeout(pushTimer);
    pushTimer = null;
    sync("PUSH").catch(() => {});
  }

  async function backupNow() {
    return sync("PUSH");
  }

  async function restoreNow() {
    const prefs = loadPrefs();
    validate(prefs);
    const cfg = { token: prefs.token.trim(), deviceId: getDeviceId() };

    let remote = null;
    let isV2 = true;
    try {
      remote = await readRemoteV2(cfg);
    } catch (err) {
      if (err && err.code === "D1_NOT_BOUND") {
        isV2 = false;
        remote = await downloadLegacyOrNull(cfg);
      } else {
        throw err;
      }
    }

    if (remote == null) throw new Error("云端尚无备份");
    const doc = isV2 ? remote.doc : remote;
    if (
      !confirm(
        "将用云端最新版本整份覆盖本机配置（含分类、网站与常用网站）。\n" +
          "本机未同步的改动会丢失，确定继续？"
      )
    ) {
      return { message: "已取消" };
    }

    applyNavDoc(doc);
    if (isV2) {
      saveBase(remote.rev, remote.doc, cfg.token);
      savePrefs({ baseRev: remote.rev, dirty: false, remoteNewerSkipAt: 0, mode: "v2" });
      return { message: "已从云端恢复到本机（rev " + remote.rev + "）", rev: remote.rev };
    }

    const remoteAt = NavStore.exportedAtOf(remote);
    savePrefs({
      lastUploadExportedAt: remoteAt || Date.now(),
      dirty: false,
      remoteNewerSkipAt: 0,
      mode: "legacy",
    });
    return { message: "已从云端恢复到本机（兼容模式）", mode: "legacy" };
  }

  async function testConnection(cfg) {
    const c = { ...(cfg || loadPrefs()), token: String((cfg || loadPrefs()).token || "").trim() };
    try {
      validate(c);
    } catch (e) {
      return "配置不完整：" + e.message;
    }

    try {
      const remote = await readRemoteV2(c);
      if (remote) {
        return "连接成功：D1 强一致同步可用（云端 rev " + remote.rev + "）";
      }
      return "连接成功：D1 已就绪（云端尚无备份，首次同步会创建 rev 1）";
    } catch (err) {
      if (!err || err.code !== "D1_NOT_BOUND") {
        return "测试失败：" + ((err && err.message) || "无法连接 " + syncUrl(V2_PATH));
      }
    }

    // v2 不可用：给出明确指引，并顺带测试旧 KV 是否可达
    try {
      const res = await api("HEAD", c, LEGACY_PATH).catch(() => null);
      const legacyHint =
        !res || res.status === 0
          ? ""
          : res.status === 404
            ? "旧 KV 也未绑定。"
            : res.status === 200
              ? "旧 KV 可用，但仍是整份覆盖模式。"
              : "";
      return (
        "D1 未绑定：请在 Cloudflare Dashboard → Workers & Pages → cl-nav → Settings → Bindings 添加 D1 数据库，变量名填 CL_NAV_DB。当前会回退旧 KV 兼容模式（多机同时编辑仍可能互相覆盖）。" +
        legacyHint
      );
    } catch (_) {
      return "D1 未绑定：请添加 CL_NAV_DB 绑定后重试。";
    }
  }

  function status() {
    const prefs = loadPrefs();
    return {
      rev: prefs.baseRev,
      dirty: prefs.dirty,
      mode: prefs.mode,
      lastSyncAt: prefs.lastSyncAt,
      lastMessage: prefs.lastMessage,
      conflicts: prefs.lastConflicts,
      conflictCount: prefs.lastConflictCount,
    };
  }

  window.NavCfSync = {
    loadPrefs,
    savePrefs,
    isReady,
    generateToken,
    getDeviceId,
    testConnection,
    sync,
    backupNow,
    restoreNow,
    schedulePush,
    flushPush,
    status,
    markDirty() {
      savePrefs({ dirty: true });
      schedulePush();
    },
    clearDirty() {
      savePrefs({ dirty: false });
    },
    /** 仅供调试：清掉本机 base（下次按首次连接重新合并） */
    resetBase() {
      clearBase();
      savePrefs({ baseRev: 0, dirty: true });
    },
  };
})();
