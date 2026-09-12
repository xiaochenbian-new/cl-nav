/** CL Nav — WebDAV client + sync (ported from cl-todo-app) */
(function () {
  const PREFS_KEY = "cl-nav-webdav-prefs-v1";
  const DEFAULT_PATH = "/cl-nav/backup.json";
  const DEFAULT_FOLDER = "/cl-nav";

  const PROPFIND_BODY =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

  function normalizeRemotePath(raw) {
    let p = String(raw || "").trim();
    if (!p) return DEFAULT_PATH;
    if (!p.startsWith("/")) p = "/" + p;
    const parts = p
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    if (parts.length === 1 && parts[0].includes(".")) {
      return DEFAULT_FOLDER + "/" + parts[0];
    }
    return p;
  }

  function parentDir(remotePath) {
    const p = normalizeRemotePath(remotePath);
    const idx = p.lastIndexOf("/");
    return idx <= 0 ? DEFAULT_FOLDER : p.slice(0, idx) || DEFAULT_FOLDER;
  }

  function historyPath(remotePath, timestamp) {
    return parentDir(remotePath) + "/history/backup-" + timestamp + ".json";
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        baseUrl: raw.baseUrl || "",
        username: raw.username || "",
        password: raw.password || "",
        remotePath: normalizeRemotePath(raw.remotePath || DEFAULT_PATH),
        autoBackup: !!raw.autoBackup,
        /** 海外边缘常连不上坚果云；默认关闭，国外 WebDAV 再手动开启 */
        useProxy: raw.useProxy != null ? !!raw.useProxy : false,
        proxyPath: raw.proxyPath || "/api/webdav",
        lastUploadExportedAt: Number(raw.lastUploadExportedAt) || 0,
        remoteNewerSkipAt: Number(raw.remoteNewerSkipAt) || 0,
        localDirty: !!raw.localDirty,
      };
    } catch {
      return {
        baseUrl: "",
        username: "",
        password: "",
        remotePath: DEFAULT_PATH,
        autoBackup: false,
        useProxy: false,
        proxyPath: "/api/webdav",
        lastUploadExportedAt: 0,
        remoteNewerSkipAt: 0,
        localDirty: false,
      };
    }
  }

  function savePrefs(patch) {
    const cur = loadPrefs();
    const next = { ...cur, ...patch };
    next.remotePath = normalizeRemotePath(next.remotePath);
    if (next.proxyPath != null) next.proxyPath = String(next.proxyPath).trim() || "/api/webdav";
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return next;
  }

  function isReady(cfg) {
    return !!(cfg.baseUrl && cfg.username && cfg.password);
  }

  function authHeader(username, password) {
    const raw = `${username.trim()}:${password.trim()}`;
    try {
      return "Basic " + btoa(unescape(encodeURIComponent(raw)));
    } catch {
      return "Basic " + btoa(raw);
    }
  }

  function resolveUrl(cfg) {
    const base = cfg.baseUrl.trim().replace(/\/+$/, "");
    return base + normalizeRemotePath(cfg.remotePath);
  }

  function validate(cfg) {
    if (!cfg.baseUrl.trim()) throw new Error("请先填写服务器地址");
    const url = cfg.baseUrl.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("地址需以 http:// 或 https:// 开头");
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      throw new Error("服务器地址格式不正确");
    }
    if (!cfg.username.trim()) throw new Error("请填写用户名");
    if (!cfg.password.trim()) throw new Error("请填写密码（坚果云请用「应用密码」）");
  }

  function isFileProtocol() {
    return typeof location !== "undefined" && location.protocol === "file:";
  }

  async function davFetch(method, url, cfg, { depth, body, contentType } = {}) {
    const headers = {
      Authorization: authHeader(cfg.username, cfg.password),
    };
    if (depth != null) headers.Depth = String(depth);
    if (contentType) headers["Content-Type"] = contentType;

    const prefs = loadPrefs();
    let fetchUrl = url;
    // file:// 下没有 /api/webdav，强制直连（仍会受 CORS 限制）
    const useProxy = prefs.useProxy && prefs.proxyPath && !isFileProtocol();
    if (useProxy) {
      const base = String(prefs.proxyPath).trim() || "/api/webdav";
      fetchUrl = base + (base.includes("?") ? "&" : "?") + "url=" + encodeURIComponent(url);
    }

    const init = { method, headers };
    if (body != null) init.body = body;
    else if (!/^(GET|HEAD)$/i.test(method)) init.body = "";

    try {
      return await fetch(fetchUrl, init);
    } catch (err) {
      if (prefs.useProxy && isFileProtocol()) {
        const e = new Error(
          "本地用 file:// 打开时没有 /api/webdav。请取消「同源代理」，或用本地静态服务器 / Cloudflare 站点访问；浏览器直连坚果云仍会因 CORS 失败，本地请用「本地 JSON」。"
        );
        e.cause = err;
        throw e;
      }
      if (prefs.useProxy) {
        const e = new Error(
          "无法连接代理 " +
            prefs.proxyPath +
            "（请确认 Cloudflare Pages 已部署 functions/api/webdav.js）。原始错误：" +
            (err && err.message ? err.message : "network")
        );
        e.cause = err;
        throw e;
      }
      throw err;
    }
  }

  async function mkcol(url, cfg) {
    try {
      await davFetch("MKCOL", url, cfg);
    } catch (_) {}
  }

  async function ensureParentCollections(cfg) {
    const path = normalizeRemotePath(cfg.remotePath);
    const segments = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    if (segments.length <= 1) return;
    let cur = cfg.baseUrl.trim().replace(/\/+$/, "");
    for (let i = 0; i < segments.length - 1; i++) {
      cur += "/" + segments[i];
      await mkcol(cur, cfg);
    }
  }

  function decideUpload({ remoteExists, remoteExportedAt, lastUploadedExportedAt, sameContent }) {
    if (!remoteExists) return "ALLOW";
    if (sameContent) return "SKIP_SAME";
    if (lastUploadedExportedAt <= 0) return "BLOCK_REMOTE_NEWER";
    return remoteExportedAt > lastUploadedExportedAt ? "BLOCK_REMOTE_NEWER" : "ALLOW";
  }

  function stampNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      "-" +
      p(d.getHours()) +
      p(d.getMinutes()) +
      p(d.getSeconds())
    );
  }

  async function uploadJson(cfg, json) {
    validate(cfg);
    await ensureParentCollections(cfg);
    let url = resolveUrl(cfg);
    let resp = await davFetch("PUT", url, cfg, {
      body: json,
      contentType: "application/json; charset=utf-8",
    });
    if (resp.status === 409) {
      await ensureParentCollections(cfg);
      resp = await davFetch("PUT", url, cfg, {
        body: json,
        contentType: "application/json; charset=utf-8",
      });
    }
    if (resp.status >= 200 && resp.status < 300) return "已上传到 WebDAV";
    if (resp.status === 401) throw new Error("上传失败：账号或密码不正确");
    if (resp.status === 403) throw new Error("上传失败：无权限写入该路径");
    if (resp.status === 409) throw new Error("上传失败：远程目录不存在");
    throw new Error("上传失败 (HTTP " + resp.status + ")");
  }

  async function downloadJson(cfg) {
    validate(cfg);
    const resp = await davFetch("GET", resolveUrl(cfg), cfg);
    if (resp.status >= 200 && resp.status < 300) return await resp.text();
    if (resp.status === 404) {
      const err = new Error("下载失败：远程还没有备份文件");
      err.code = "NOT_FOUND";
      throw err;
    }
    if (resp.status === 401) throw new Error("下载失败：账号或密码不正确");
    if (resp.status === 403) throw new Error("下载失败：无权限读取该路径");
    throw new Error("下载失败 (HTTP " + resp.status + ")");
  }

  async function downloadOrNull(cfg) {
    try {
      return await downloadJson(cfg);
    } catch (e) {
      if (e.code === "NOT_FOUND" || /还没有备份/.test(e.message || "")) return null;
      throw e;
    }
  }

  async function uploadHistoryCopy(cfg, remoteJson) {
    const histPath = historyPath(cfg.remotePath, stampNow());
    const histCfg = { ...cfg, remotePath: histPath };
    await ensureParentCollections(histCfg);
    await davFetch("PUT", resolveUrl(histCfg), histCfg, {
      body: remoteJson,
      contentType: "application/json; charset=utf-8",
    });
  }

  async function uploadSafe(cfg, json, { forceOverwrite = false } = {}) {
    validate(cfg);
    const prefs = loadPrefs();
    const localAt = NavStore.exportedAtOf(json);
    let remote = null;
    try {
      remote = await downloadJson(cfg);
    } catch (e) {
      if (e.code !== "NOT_FOUND" && !/还没有备份/.test(e.message || "")) throw e;
    }
    const remoteAt = remote ? NavStore.exportedAtOf(remote) : 0;
    const same = remote != null && NavStore.sameContent(remote, json);
    const decision = decideUpload({
      remoteExists: remote != null,
      remoteExportedAt: remoteAt,
      lastUploadedExportedAt: prefs.lastUploadExportedAt,
      sameContent: same,
    });

    if (decision === "SKIP_SAME") {
      const stamp = remoteAt > 0 ? remoteAt : prefs.lastUploadExportedAt || Date.now();
      savePrefs({ lastUploadExportedAt: stamp, remoteNewerSkipAt: 0, localDirty: false });
      return { message: "本地与网盘数据一致，无需上传", skipped: true };
    }

    if (!forceOverwrite && decision === "BLOCK_REMOTE_NEWER") {
      savePrefs({ remoteNewerSkipAt: remoteAt || 1 });
      const err = new Error("网盘备份比本机更新，已阻止覆盖");
      err.code = "REMOTE_NEWER";
      err.remoteExportedAt = remoteAt;
      err.localExportedAt = localAt;
      throw err;
    }

    if (remote != null) {
      try {
        await uploadHistoryCopy(cfg, remote);
      } catch (_) {}
    }

    const msg = await uploadJson(cfg, json);
    const stamp = localAt > 0 ? localAt : Date.now();
    savePrefs({ lastUploadExportedAt: stamp, remoteNewerSkipAt: 0, localDirty: false });
    return { message: msg, skipped: false };
  }

  async function testConnection(cfg) {
    const c = {
      ...cfg,
      baseUrl: (cfg.baseUrl || "").trim(),
      username: (cfg.username || "").trim(),
      password: (cfg.password || "").trim(),
      remotePath: normalizeRemotePath(cfg.remotePath),
    };
    try {
      validate(c);
    } catch (e) {
      return "配置不完整：" + e.message;
    }

    if (isFileProtocol()) {
      return (
        "本地 file:// 无法使用 WebDAV：没有代理服务，且浏览器禁止跨域访问坚果云。" +
        "请用下方「本地 JSON」备份；多端同步需在可访问坚果云的服务器上自建代理后再测。"
      );
    }

    const base = c.baseUrl.replace(/\/+$/, "");
    const fileUrl = resolveUrl(c);
    const parentUrl = fileUrl.includes("/") ? fileUrl.replace(/\/[^/]*$/, "") : base;

    const probes = [
      { method: "PROPFIND", url: base + "/", depth: "0", body: PROPFIND_BODY, ct: "application/xml; charset=utf-8" },
      { method: "PROPFIND", url: base, depth: "0", body: PROPFIND_BODY, ct: "application/xml; charset=utf-8" },
      { method: "PROPFIND", url: parentUrl + "/", depth: "0", body: PROPFIND_BODY, ct: "application/xml; charset=utf-8" },
      { method: "HEAD", url: fileUrl },
      { method: "GET", url: fileUrl },
      { method: "HEAD", url: base + "/" },
    ];

    let sawNetwork = false;
    let saw401 = false;
    let saw403 = false;
    let lastCode = -1;

    for (const p of probes) {
      try {
        const resp = await davFetch(p.method, p.url, c, {
          depth: p.depth,
          body: p.body,
          contentType: p.ct,
        });
        lastCode = resp.status;
        if ((resp.status >= 200 && resp.status < 300) || resp.status === 207) {
          return "连接成功：服务器可达，账号可用";
        }
        if (resp.status === 404) {
          return "连接成功：服务器可达（目标路径尚不存在，上传时会自动创建）";
        }
        if (resp.status === 405) return "连接成功：服务器可达，账号可用";
        if (resp.status === 401) saw401 = true;
        if (resp.status === 403) saw403 = true;
        if ([520, 521, 522, 523, 502].includes(resp.status)) {
          return (
            "测试失败：Cloudflare 边缘无法访问坚果云（HTTP " +
            resp.status +
            "）。同源代理解决不了跨境连通问题，请用下方「本地 JSON」备份/恢复，或改用可达的国外 WebDAV。"
          );
        }
        if ([301, 302, 307, 308].includes(resp.status)) {
          return "连接成功：服务器有重定向，请确认地址是否完整";
        }
      } catch (_) {
        sawNetwork = true;
      }
    }

    if (saw401 && !saw403) {
      return "测试失败：账号或密码不正确。坚果云请用登录邮箱 +「应用密码」";
    }
    if (saw403) return "连接成功：账号已通过验证（服务器禁止浏览目录，可直接备份）";
    if (saw401) return "测试失败：账号或密码不正确 (HTTP 401)";
    if (sawNetwork) {
      const prefs = loadPrefs();
      if (prefs.useProxy) {
        return (
          "测试失败：无法经代理连接。请确认已用 Cloudflare Pages 部署（含 functions/api/webdav.js），" +
          "且代理路径为 " +
          (prefs.proxyPath || "/api/webdav")
        );
      }
      return "测试失败：无法连接（坚果云等不支持浏览器跨域 CORS；请开启「同源代理」或改用 JSON 备份）";
    }
    return "测试失败：服务器返回异常 (HTTP " + lastCode + ")";
  }

  let pushTimer = null;

  function schedulePush() {
    const prefs = loadPrefs();
    if (!prefs.autoBackup || !isReady(prefs)) return;
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      sync("PUSH").catch(() => {});
    }, 2000);
  }

  /**
   * Pull: merge remote into local (union) so neither side loses sites.
   * Push: upload local (after ensuring defaults are present).
   */
  async function sync(mode = "FULL") {
    const prefs = loadPrefs();
    if (!isReady(prefs)) return { message: "请先配置 WebDAV 账号" };

    const cfg = {
      baseUrl: prefs.baseUrl,
      username: prefs.username,
      password: prefs.password,
      remotePath: prefs.remotePath,
    };

    const localJson = NavStore.exportBackup({ ensureDefaults: false });
    const remote = await downloadOrNull(cfg);
    const last = prefs.lastUploadExportedAt;
    const dirty = prefs.localDirty;

    if (remote == null) {
      const r = await uploadSafe(cfg, localJson, { forceOverwrite: true });
      return { message: r.message, pushed: true };
    }

    if (NavStore.sameContent(localJson, remote)) {
      const remoteAt = NavStore.exportedAtOf(remote);
      savePrefs({
        lastUploadExportedAt: remoteAt || Date.now(),
        localDirty: false,
        remoteNewerSkipAt: 0,
      });
      return { message: "本地与网盘数据一致" };
    }

    const remoteAt = NavStore.exportedAtOf(remote);
    const remoteNewer = last <= 0 || remoteAt > last;

    const doPull = () => {
      // 整份替换为网盘 JSON（删除会同步生效）
      NavStore.applyBackup(remote, { markClean: true, mode: "replace" });
      savePrefs({
        lastUploadExportedAt: remoteAt || Date.now(),
        localDirty: false,
        remoteNewerSkipAt: 0,
      });
      return { message: "已从网盘同步到本机", pulled: true };
    };

    const doPush = async () => {
      const json = NavStore.exportBackup({ ensureDefaults: false });
      const r = await uploadSafe(cfg, json, { forceOverwrite: true });
      return { message: r.message, pushed: true };
    };

    if (mode === "PULL") {
      if (!remoteNewer) return { message: "网盘无更新" };
      if (dirty) return doPush();
      if (last <= 0 && NavStore.hasUserData()) {
        savePrefs({ remoteNewerSkipAt: remoteAt || 1 });
        return { message: "网盘有备份且与本机不一致，请手动「从网盘恢复」或「立即同步」" };
      }
      return doPull();
    }

    if (mode === "PUSH") return doPush();

    // FULL
    if (remoteNewer && !dirty) {
      if (last <= 0 && NavStore.hasUserData()) {
        savePrefs({ remoteNewerSkipAt: remoteAt || 1 });
        return { message: "网盘有备份且与本机不一致，请手动「从网盘恢复」或「立即同步」" };
      }
      return doPull();
    }
    return doPush();
  }

  async function backupNow({ force = false } = {}) {
    const prefs = loadPrefs();
    if (!isReady(prefs)) throw new Error("请先配置并保存 WebDAV");
    const cfg = {
      baseUrl: prefs.baseUrl,
      username: prefs.username,
      password: prefs.password,
      remotePath: prefs.remotePath,
    };
    const json = NavStore.exportBackup({ ensureDefaults: false });
    try {
      return await uploadSafe(cfg, json, { forceOverwrite: force });
    } catch (e) {
      if (e.code === "REMOTE_NEWER") {
        if (confirm("网盘备份比本机更新。强制上传将覆盖网盘（旧文件会先存入 history）。继续？")) {
          return uploadSafe(cfg, json, { forceOverwrite: true });
        }
        throw e;
      }
      throw e;
    }
  }

  async function restoreNow() {
    const prefs = loadPrefs();
    if (!isReady(prefs)) throw new Error("请先配置并保存 WebDAV");
    const cfg = {
      baseUrl: prefs.baseUrl,
      username: prefs.username,
      password: prefs.password,
      remotePath: prefs.remotePath,
    };
    const remote = await downloadJson(cfg);
    if (!confirm("将用网盘 JSON 整份覆盖本机配置（本机多出来的分类/网站会丢失）。继续？")) {
      return { message: "已取消" };
    }
    NavStore.applyBackup(remote, { markClean: true, mode: "replace" });
    const remoteAt = NavStore.exportedAtOf(remote);
    savePrefs({
      lastUploadExportedAt: remoteAt || Date.now(),
      localDirty: false,
      remoteNewerSkipAt: 0,
    });
    return { message: "已从网盘恢复到本机" };
  }

  window.NavWebDav = {
    DEFAULT_PATH,
    normalizeRemotePath,
    loadPrefs,
    savePrefs,
    isReady,
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
