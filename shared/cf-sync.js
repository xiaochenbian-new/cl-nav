/** CL Nav — Cloudflare KV 同源多端同步 */
(function () {
  const PREFS_KEY = "cl-nav-cf-sync-prefs-v1";
  const API_PATH = "/api/sync";

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        token: String(raw.token || ""),
        autoSync: !!raw.autoSync,
        lastUploadExportedAt: Number(raw.lastUploadExportedAt) || 0,
        remoteNewerSkipAt: Number(raw.remoteNewerSkipAt) || 0,
        localDirty: !!raw.localDirty,
      };
    } catch {
      return {
        token: "",
        autoSync: false,
        lastUploadExportedAt: 0,
        remoteNewerSkipAt: 0,
        localDirty: false,
      };
    }
  }

  function savePrefs(patch) {
    const next = { ...loadPrefs(), ...patch };
    next.token = String(next.token || "").trim();
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return next;
  }

  function isFileProtocol() {
    return typeof location !== "undefined" && location.protocol === "file:";
  }

  function isReady(cfg) {
    const c = cfg || loadPrefs();
    return !!(c.token && c.token.length >= 8);
  }

  function validate(cfg) {
    if (isFileProtocol()) {
      throw new Error("请用 https://cl-nav.pages.dev 打开后再用云端同步（file:// 无 /api/sync）");
    }
    if (!cfg.token || cfg.token.length < 8) {
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

  async function api(method, cfg, body) {
    validate(cfg);
    const init = {
      method,
      headers: {
        Authorization: "Bearer " + cfg.token.trim(),
      },
      cache: "no-store",
    };
    if (body != null) {
      init.headers["Content-Type"] = "application/json; charset=utf-8";
      init.body = body;
    }
    let res;
    try {
      res = await fetch(API_PATH, init);
    } catch (err) {
      throw new Error(
        "无法连接同步接口 /api/sync（请确认已部署在 Cloudflare Pages）。" +
          (err && err.message ? " " + err.message : "")
      );
    }
    return res;
  }

  async function downloadOrNull(cfg) {
    const res = await api("GET", cfg);
    if (res.status === 404) {
      const j = await res.json().catch(() => ({}));
      if (j.empty) return null;
      return null;
    }
    if (res.status === 503) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "云端 KV 未绑定（CL_NAV_SYNC）");
    }
    if (res.status === 401) throw new Error("同步口令无效或过短");
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "下载失败 HTTP " + res.status);
    }
    return await res.text();
  }

  async function upload(cfg, jsonText) {
    const res = await api("PUT", cfg, jsonText);
    if (res.status === 503) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "云端 KV 未绑定（CL_NAV_SYNC）");
    }
    if (res.status === 401) throw new Error("同步口令无效或过短");
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "上传失败 HTTP " + res.status);
    }
    const info = await res.json().catch(() => ({}));
    const stamp = Number(info.exportedAt) || NavStore.exportedAtOf(jsonText) || Date.now();
    savePrefs({ lastUploadExportedAt: stamp, remoteNewerSkipAt: 0, localDirty: false });
    return { message: "已上传到 Cloudflare 云端", exportedAt: stamp };
  }

  async function testConnection(cfg) {
    const c = { ...(cfg || loadPrefs()), token: String((cfg || loadPrefs()).token || "").trim() };
    try {
      validate(c);
    } catch (e) {
      return "配置不完整：" + e.message;
    }
    const res = await api("HEAD", c).catch((e) => ({ ok: false, status: 0, _err: e }));
    if (res._err) return "测试失败：" + res._err.message;
    if (res.status === 503) {
      try {
        const g = await api("GET", c);
        const j = await g.json().catch(() => ({}));
        return j.error || "测试失败：请在 Pages 绑定 KV（CL_NAV_SYNC）";
      } catch (e) {
        return e.message || "测试失败：KV 未绑定";
      }
    }
    if (res.status === 401) return "测试失败：同步口令无效";
    if (res.status === 404) return "连接成功：云端可达（尚无备份，上传后即可多端同步）";
    if (res.status === 200) return "连接成功：云端可达，已有备份";
    if (res.status === 0) return "测试失败：无法连接 /api/sync";
    return "测试失败：HTTP " + res.status;
  }

  let pushTimer = null;

  function schedulePush() {
    const prefs = loadPrefs();
    if (!prefs.autoSync || !isReady(prefs)) return;
    window.clearTimeout(pushTimer);
    // 短防抖：连续编辑合并为一次上传，停手后很快推到云端
    pushTimer = window.setTimeout(() => {
      sync("PUSH").catch(() => {});
    }, 400);
  }

  async function exportFullBackup() {
    let json = NavStore.exportBackup({ ensureDefaults: false });
    if (window.LibraryStorage?.enrichBackupJson) {
      try {
        json = await LibraryStorage.enrichBackupJson(json);
      } catch (_) {}
    }
    return json;
  }

  async function applyFullBackup(remote, opts) {
    NavStore.applyBackup(remote, opts);
    if (window.LibraryStorage?.applyBackupLibrary) {
      try {
        await LibraryStorage.applyBackupLibrary(remote);
      } catch (_) {}
    }
  }

  async function sync(mode = "FULL") {
    const prefs = loadPrefs();
    if (!isReady(prefs)) return { message: "请先设置同步口令" };
    validate(prefs);

    const localJson = await exportFullBackup();
    const remote = await downloadOrNull(prefs);
    const last = prefs.lastUploadExportedAt;
    const dirty = prefs.localDirty;

    if (remote == null) {
      const r = await upload(prefs, localJson);
      return { message: r.message, pushed: true };
    }

    if (NavStore.sameContent(localJson, remote)) {
      const remoteAt = NavStore.exportedAtOf(remote);
      savePrefs({
        lastUploadExportedAt: remoteAt || Date.now(),
        localDirty: false,
        remoteNewerSkipAt: 0,
      });
      return { message: "本地与云端数据一致" };
    }

    const remoteAt = NavStore.exportedAtOf(remote);
    const remoteNewer = last <= 0 || remoteAt > last;

    const doPull = async () => {
      await applyFullBackup(remote, { markClean: true, mode: "replace" });
      savePrefs({
        lastUploadExportedAt: remoteAt || Date.now(),
        localDirty: false,
        remoteNewerSkipAt: 0,
      });
      return { message: "已从云端同步到本机", pulled: true };
    };

    const doPush = async () => {
      const json = await exportFullBackup();
      const r = await upload(prefs, json);
      return { message: r.message, pushed: true };
    };

    if (mode === "PULL") {
      if (!remoteNewer) return { message: "云端无更新" };
      if (dirty) return doPush();
      if (last <= 0 && NavStore.hasUserData()) {
        savePrefs({ remoteNewerSkipAt: remoteAt || 1 });
        return { message: "云端有备份且与本机不一致，请手动「从云端恢复」或「立即同步」" };
      }
      return doPull();
    }

    if (mode === "PUSH") return doPush();

    if (remoteNewer && !dirty) {
      if (last <= 0 && NavStore.hasUserData()) {
        savePrefs({ remoteNewerSkipAt: remoteAt || 1 });
        return { message: "云端有备份且与本机不一致，请手动「从云端恢复」或「立即同步」" };
      }
      return doPull();
    }
    return doPush();
  }

  async function backupNow() {
    const prefs = loadPrefs();
    validate(prefs);
    const json = await exportFullBackup();
    return upload(prefs, json);
  }

  async function restoreNow() {
    const prefs = loadPrefs();
    validate(prefs);
    const remote = await downloadOrNull(prefs);
    if (remote == null) throw new Error("云端尚无备份");
    if (!confirm("将用云端 JSON 整份覆盖本机配置（含资源库分类与目录）。继续？")) {
      return { message: "已取消" };
    }
    await applyFullBackup(remote, { markClean: true, mode: "replace" });
    const remoteAt = NavStore.exportedAtOf(remote);
    savePrefs({
      lastUploadExportedAt: remoteAt || Date.now(),
      localDirty: false,
      remoteNewerSkipAt: 0,
    });
    return { message: "已从云端恢复到本机" };
  }

  window.NavCfSync = {
    loadPrefs,
    savePrefs,
    isReady,
    generateToken,
    testConnection,
    sync,
    backupNow,
    restoreNow,
    schedulePush,
    markDirty() {
      savePrefs({ localDirty: true });
      schedulePush();
    },
    clearDirty() {
      savePrefs({ localDirty: false });
    },
  };
})();
