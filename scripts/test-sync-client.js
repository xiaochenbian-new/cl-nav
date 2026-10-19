/**
 * cf-sync.js 集成测试：用 vm 模拟两个浏览器的 localStorage / fetch / NavStore，
 * 服务端用内存实现 D1 的 rev CAS 语义。
 *   node scripts/test-sync-client.js
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const merge = require("../shared/sync-merge.js");
const syncEngine = require("../shared/sync-engine.js");

const CF_SYNC_SOURCE = fs.readFileSync(path.join(__dirname, "../shared/cf-sync.js"), "utf8");
const TOKEN = "test-token-123456";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function makeStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    _map: map,
  };
}

function baseDoc() {
  return {
    version: 1,
    brand: "CL Nav",
    tagline: "导航",
    engines: [{ id: "google", name: "Google", url: "https://www.google.com/search?q=", icon: "g" }],
    quickLinks: [],
    categories: [
      {
        id: "cat_a",
        name: "分类 A",
        links: [{ title: "GitHub", url: "https://github.com/", desc: "", domain: "github.com" }],
        children: [],
      },
    ],
    removedSeeds: [],
  };
}

/** 内存版 D1：单线程 + rev CAS */
class Server {
  constructor(opts = {}) {
    this.rows = new Map(); // token -> {rev, doc, writer}
    this.legacy = new Map(); // token -> body
    this.d1 = opts.d1 !== false;
    this.writes = 0;
    this.failNextPutWithConflict = false;
  }

  row(token) {
    return this.rows.get(token) || null;
  }

  async fetch(input, init = {}) {
    const url = new URL(String(input), "https://example.com");
    const method = String(init.method || "GET").toUpperCase();
    const auth = (init.headers && init.headers.Authorization) || "";
    const token = String(auth).replace(/^Bearer\s+/i, "").trim();
    const headers = { "content-type": "application/json; charset=utf-8" };
    const json = (body, status = 200, extra = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

    if (url.pathname === "/api/sync2") {
      if (!this.d1) {
        return json({ error: "未绑定 D1", code: "D1_NOT_BOUND" }, 503);
      }
      if (method === "GET") {
        const row = this.row(token);
        if (!row) return json({ error: "云端尚无备份", empty: true }, 404);
        return json({ rev: row.rev, doc: clone(row.doc), updatedAt: 1, writer: row.writer });
      }
      if (method === "PUT") {
        const payload = JSON.parse(init.body);
        const row = this.row(token);
        const currentRev = row ? row.rev : 0;
        if (Number(payload.baseRev) !== currentRev) {
          return json(
            row
              ? { error: "conflict", rev: row.rev, doc: clone(row.doc), updatedAt: 1, writer: row.writer }
              : { error: "conflict", rev: 0, doc: null, updatedAt: 0, writer: "" },
            409
          );
        }
        const rev = currentRev + 1;
        this.rows.set(token, {
          rev,
          doc: merge.normalizeDoc(payload.doc),
          writer: String(payload.deviceId || ""),
        });
        this.writes += 1;
        return json({ ok: true, rev, updatedAt: 2, writer: payload.deviceId });
      }
      return json({ error: "Method Not Allowed" }, 405);
    }

    if (url.pathname === "/api/sync") {
      if (method === "GET") {
        const body = this.legacy.get(token);
        return body ? new Response(body, { status: 200, headers }) : json({ empty: true }, 404);
      }
      if (method === "PUT") {
        this.legacy.set(token, String(init.body));
        return json({ ok: true, exportedAt: Date.now(), updatedAt: Date.now() });
      }
    }

    return json({ error: "not found" }, 404);
  }
}

function makeDevice(server, initialDoc) {
  const store = {
    state: merge.normalizeDoc(initialDoc),
    exportBackup() {
      return JSON.stringify({
        ...this.state,
        // 故意带上 library：cf-sync 必须把它剔除，不能覆盖服务端资源库
        library: { categories: [{ id: "software", name: "软件" }], items: [] },
        exportedAt: Date.now(),
      });
    },
    get() {
      return clone(this.state);
    },
    applyBackup(doc) {
      this.state = merge.normalizeDoc(doc);
    },
    hasUserData() {
      return true;
    },
    exportedAtOf() {
      return 0;
    },
    sameContent() {
      return false;
    },
  };

  const sandbox = {
    console,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    Response,
    URL,
    TextEncoder,
    JSON,
    Math,
    Date,
    Promise,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    fetch: (url, init) => server.fetch(url, init),
    confirm: () => true,
    NavStore: store,
    NavSyncMerge: merge,
    NavSyncEngine: syncEngine,
    window: {
      NavSyncMerge: merge,
      NavSyncEngine: syncEngine,
      NavStore: store,
      ClNavApi: { url: (p) => p },
      setTimeout,
      clearTimeout,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CF_SYNC_SOURCE, sandbox, { filename: "shared/cf-sync.js" });
  const sync = sandbox.window.NavCfSync;
  sync.savePrefs({ token: TOKEN, autoSync: true });
  return { sync, store, sandbox };
}

function urls(doc) {
  return (doc.categories[0]?.links || []).map((l) => l.url);
}

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("  ✓ " + name);
  } catch (err) {
    failures.push({ name, err });
    console.log("  ✗ " + name);
    console.log("    " + (err && err.stack ? err.stack.split("\n").slice(0, 5).join("\n    ") : err));
  }
}

async function main() {
  console.log("cf-sync client integration tests\n");

  await test("首次上传建立 rev1，且不会把 library 带进同步文档", async () => {
    const server = new Server();
    const a = makeDevice(server, baseDoc());
    a.store.state.categories[0].links.push({ title: "A", url: "https://a.example.com/", desc: "", domain: "a.example.com" });

    const r = await a.sync.sync("PUSH");
    assert.equal(r.rev, 1);
    const row = server.row(TOKEN);
    assert.ok(row, "云端未建立文档");
    assert.equal(row.doc.library, undefined, "library 被同步到云端，会覆盖资源库");
    assert.ok(urls(row.doc).includes("https://a.example.com/"));
    assert.equal(a.sync.status().rev, 1);
  });

  await test("第二台设备首次连接按并集合并，不丢任何一侧", async () => {
    const server = new Server();
    const a = makeDevice(server, baseDoc());
    a.store.state.categories[0].links.push({ title: "A", url: "https://a.example.com/", desc: "", domain: "a.example.com" });
    await a.sync.sync("PUSH");

    const b = makeDevice(server, baseDoc());
    b.store.state.categories[0].links.push({ title: "B", url: "https://b.example.com/", desc: "", domain: "b.example.com" });
    const r = await b.sync.sync("PUSH");

    assert.ok(r.rev >= 2);
    const doc = server.row(TOKEN).doc;
    assert.ok(urls(doc).includes("https://a.example.com/"), "A 的数据丢失");
    assert.ok(urls(doc).includes("https://b.example.com/"), "B 的数据丢失");

    await a.sync.sync("PULL");
    assert.ok(urls(a.store.state).includes("https://b.example.com/"), "A 未拉取到 B 的数据");
    assert.deepEqual(a.store.state, server.row(TOKEN).doc);
  });

  await test("两台设备基于同一 base 修改不同字段 → 双方都保留", async () => {
    const server = new Server();
    const a = makeDevice(server, baseDoc());
    const b = makeDevice(server, baseDoc());
    await a.sync.sync("PULL");
    await b.sync.sync("PULL");

    a.store.state.brand = "CL Nav A";
    a.store.state.categories[0].links.push({ title: "A2", url: "https://a2.example.com/", desc: "", domain: "a2.example.com" });
    b.store.state.tagline = "B 的标语";

    await a.sync.sync("PUSH");
    await b.sync.sync("PUSH");
    await a.sync.sync("PULL");

    const doc = server.row(TOKEN).doc;
    assert.equal(doc.brand, "CL Nav A");
    assert.equal(doc.tagline, "B 的标语");
    assert.ok(urls(doc).includes("https://a2.example.com/"));
    assert.deepEqual(a.store.state, doc);
  });

  await test("同一字段冲突 → 两台设备最终一致（确定性裁决）", async () => {
    const server = new Server();
    const a = makeDevice(server, baseDoc());
    const b = makeDevice(server, baseDoc());
    await a.sync.sync("PULL");
    await b.sync.sync("PULL");

    a.store.state.categories[0].name = "A 的名字";
    b.store.state.categories[0].name = "B 的名字";

    await a.sync.sync("PUSH");
    const rb = await b.sync.sync("PUSH");
    await a.sync.sync("PULL");

    const doc = server.row(TOKEN).doc;
    assert.ok(
      doc.categories[0].name === "A 的名字" || doc.categories[0].name === "B 的名字",
      "冲突结果必须是其中一个值"
    );
    assert.deepEqual(a.store.state, doc, "A 未收敛");
    assert.deepEqual(b.store.state, doc, "B 未收敛");
    assert.ok(rb.conflicts && rb.conflicts.length >= 1, "应记录冲突");
    assert.ok(b.sync.status().conflictCount >= 1);
  });

  await test("D1 未绑定时回退旧 KV，并给出兼容模式警告", async () => {
    const server = new Server({ d1: false });
    const a = makeDevice(server, baseDoc());
    const r = await a.sync.sync("FULL");

    assert.equal(r.fallback, true);
    assert.equal(r.mode, "legacy");
    assert.match(r.message, /兼容模式/);
    assert.ok(server.legacy.get(TOKEN), "旧 KV 未被写入");
    assert.equal(a.sync.status().mode, "legacy");
  });

  await test("切换同步口令会清空 base，避免拿旧基线覆盖新口令", async () => {
    const server = new Server();
    const a = makeDevice(server, baseDoc());
    await a.sync.sync("PUSH");
    assert.equal(a.sync.status().rev, 1);

    a.sync.savePrefs({ token: "another-token-98765" });
    assert.equal(a.sync.status().rev, 0);
    assert.equal(a.sync.loadPrefs().dirty, true);
    assert.equal(a.sandbox.sessionStorage.getItem("cl-nav-cf-sync-base-v2"), null);
  });

  console.log("\n" + passed + " passed, " + failures.length + " failed");
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
