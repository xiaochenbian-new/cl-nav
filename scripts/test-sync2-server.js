/**
 * /api/sync2 服务端测试：用 Node 内置 SQLite 模拟 D1，验证 CAS / 409 / HEAD / 旧 KV 迁移。
 *   node scripts/test-sync2-server.js
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const SYNC2_PATH = path.join(__dirname, "../functions/api/sync2.js");
const TOKEN = "server-test-token-123";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** 最小 D1 适配层（node:sqlite） */
class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    const db = this.db;
    return {
      _params: [],
      bind(...params) {
        this._params = params;
        return this;
      },
      async first() {
        const row = db.prepare(sql).get(...this._params);
        return row == null ? null : { ...row };
      },
      async run() {
        const info = db.prepare(sql).run(...this._params);
        return {
          success: true,
          meta: { changes: Number(info.changes) || 0, last_row_id: Number(info.lastInsertRowid) || 0 },
        };
      },
      async all() {
        return { results: db.prepare(sql).all(...this._params) };
      },
    };
  }
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function docWith(title = "GitHub") {
  return {
    version: 1,
    brand: "CL Nav",
    tagline: "",
    engines: [],
    quickLinks: [],
    categories: [
      {
        id: "cat_dev",
        name: "开发",
        links: [{ title, url: "https://github.com/", desc: "", domain: "github.com" }],
        children: [],
      },
    ],
    removedSeeds: [],
  };
}

function request(method, body, token = TOKEN) {
  return new Request("https://example.com/api/sync2", {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body == null ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

async function call(onRequest, method, body, env, token = TOKEN) {
  const res = await onRequest({ request: request(method, body, token), env });
  let json = null;
  try {
    json = method === "HEAD" ? null : await res.json();
  } catch (_) {}
  return { res, json };
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
  const tmp = path.join(os.tmpdir(), "cl-nav-sync2-test-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, fs.readFileSync(SYNC2_PATH, "utf8"));
  const { onRequest } = await import(pathToFileURL(tmp).href);

  // 所有用例共用一个 D1 实例：模块级 schema 缓存按 isolate 生效，与 Workers 运行时一致
  const sharedD1 = new FakeD1();
  const freshEnv = (extra) => {
    try {
      sharedD1.db.exec("DELETE FROM sync_docs; DELETE FROM sync_history;");
    } catch (_) {
      // 首次使用时表还没建
    }
    return { CL_NAV_DB: sharedD1, ...(extra || {}) };
  };

  console.log("/api/sync2 server tests\n");

  await test("未绑定 D1 返回 503 + D1_NOT_BOUND", async () => {
    const { res, json } = await call(onRequest, "GET", null, {});
    assert.equal(res.status, 503);
    assert.equal(json.code, "D1_NOT_BOUND");
  });

  await test("空云端 GET 返回 404 empty", async () => {
    const env = freshEnv();
    const { res, json } = await call(onRequest, "GET", null, env);
    assert.equal(res.status, 404);
    assert.equal(json.empty, true);
    assert.equal(json.rev, 0);
  });

  await test("首次 PUT(baseRev=0) 建立 rev1，GET/HEAD 可读", async () => {
    const env = freshEnv();
    const put = await call(onRequest, "PUT", { baseRev: 0, doc: docWith("A"), deviceId: "dev_a" }, env);
    assert.equal(put.res.status, 200);
    assert.equal(put.json.rev, 1);

    const got = await call(onRequest, "GET", null, env);
    assert.equal(got.res.status, 200);
    assert.equal(got.json.rev, 1);
    assert.equal(got.json.writer, "dev_a");
    assert.equal(got.json.doc.categories[0].links[0].title, "A");
    assert.equal(got.res.headers.get("X-Sync-Rev"), "1");

    const head = await call(onRequest, "HEAD", null, env);
    assert.equal(head.res.status, 200);
    assert.equal(head.res.headers.get("X-Sync-Rev"), "1");
  });

  await test("重复 baseRev=0 返回 409，并带回云端文档", async () => {
    const env = freshEnv();
    await call(onRequest, "PUT", { baseRev: 0, doc: docWith("A"), deviceId: "dev_a" }, env);
    const second = await call(onRequest, "PUT", { baseRev: 0, doc: docWith("B"), deviceId: "dev_b" }, env);
    assert.equal(second.res.status, 409);
    assert.equal(second.json.error, "conflict");
    assert.equal(second.json.rev, 1);
    assert.equal(second.json.doc.categories[0].links[0].title, "A");
    assert.equal(second.json.writer, "dev_a");
  });

  await test("过期 baseRev 不覆盖：返回 409 + 最新版本", async () => {
    const env = freshEnv();
    await call(onRequest, "PUT", { baseRev: 0, doc: docWith("A"), deviceId: "dev_a" }, env);
    const ok = await call(onRequest, "PUT", { baseRev: 1, doc: docWith("B"), deviceId: "dev_b" }, env);
    assert.equal(ok.res.status, 200);
    assert.equal(ok.json.rev, 2);

    const stale = await call(onRequest, "PUT", { baseRev: 1, doc: docWith("A"), deviceId: "dev_a" }, env);
    assert.equal(stale.res.status, 409);
    assert.equal(stale.json.rev, 2);
    assert.equal(stale.json.doc.categories[0].links[0].title, "B");

    const got = await call(onRequest, "GET", null, env);
    assert.equal(got.json.doc.categories[0].links[0].title, "B", "旧版本覆盖了新版本");
  });

  await test("并发两个相同 baseRev：只有一个成功", async () => {
    const env = freshEnv();
    await call(onRequest, "PUT", { baseRev: 0, doc: docWith("base"), deviceId: "seed" }, env);
    const [a, b] = await Promise.all([
      call(onRequest, "PUT", { baseRev: 1, doc: docWith("A"), deviceId: "dev_a" }, env),
      call(onRequest, "PUT", { baseRev: 1, doc: docWith("B"), deviceId: "dev_b" }, env),
    ]);
    const okCount = [a, b].filter((x) => x.res.status === 200).length;
    const conflictCount = [a, b].filter((x) => x.res.status === 409).length;
    assert.equal(okCount, 1);
    assert.equal(conflictCount, 1);
    assert.equal((await call(onRequest, "GET", null, env)).json.rev, 2);
  });

  await test("baseRev>0 但云端文档不存在 → 409 rev0", async () => {
    const env = freshEnv();
    await call(onRequest, "GET", null, env); // 建表
    const res = await call(onRequest, "PUT", { baseRev: 5, doc: docWith("A"), deviceId: "dev_a" }, env);
    assert.equal(res.res.status, 409);
    assert.equal(res.json.rev, 0);
    assert.equal(res.json.doc, null);
  });

  await test("首次 GET 自动从旧 KV 迁移，并剔除 library", async () => {
    const legacyDoc = docWith("Legacy");
    legacyDoc.library = { categories: [{ id: "software", name: "软件" }], items: [] };
    const legacyKey = await sha256Hex("cl-nav-sync-v1:" + TOKEN);
    const kv = {
      async get(key) {
        if (key !== "backup:" + legacyKey) return null;
        return JSON.stringify({ body: JSON.stringify(legacyDoc), exportedAt: 1, updatedAt: 1 });
      },
    };
    const env = freshEnv({ CL_NAV_SYNC: kv });

    const got = await call(onRequest, "GET", null, env);
    assert.equal(got.res.status, 200);
    assert.equal(got.json.rev, 1);
    assert.equal(got.json.migrated, true);
    assert.equal(got.json.doc.library, undefined);
    assert.equal(got.json.doc.categories[0].links[0].title, "Legacy");

    // 第二次 GET 不再迁移
    const again = await call(onRequest, "GET", null, env);
    assert.equal(again.json.migrated, undefined);
    assert.equal(again.json.rev, 1);
  });

  await test("历史版本只保留最近 40 个", async () => {
    const env = freshEnv();
    let rev = 0;
    for (let i = 0; i < 45; i++) {
      const res = await call(
        onRequest,
        "PUT",
        { baseRev: rev, doc: docWith("v" + i), deviceId: "dev_hist" },
        env
      );
      assert.equal(res.res.status, 200);
      rev = res.json.rev;
    }
    const row = sharedD1.db.prepare("SELECT COUNT(*) AS c FROM sync_history").get();
    assert.ok(row.c <= 40, "历史版本未按预期裁剪：" + row.c);
    assert.ok(row.c >= 1);
  });

  await test("超长文档返回 413", async () => {
    const env = freshEnv();
    const big = docWith("A");
    big.categories[0].links[0].desc = "x".repeat(1_600_000);
    const res = await call(onRequest, "PUT", { baseRev: 0, doc: big, deviceId: "dev" }, env);
    assert.equal(res.res.status, 413);
  });

  await test("非法参数返回 400", async () => {
    const env = freshEnv();
    assert.equal((await call(onRequest, "PUT", { baseRev: -1, doc: docWith() }, env)).res.status, 400);
    assert.equal((await call(onRequest, "PUT", { baseRev: 0 }, env)).res.status, 400);
    assert.equal((await call(onRequest, "GET", null, env, "short")).res.status, 401);
  });

  fs.unlinkSync(tmp);
  console.log("\n" + passed + " passed, " + failures.length + " failed");
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
