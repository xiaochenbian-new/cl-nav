/**
 * 同步合并 / 状态机单测（Node 直接运行，无第三方依赖）
 *   node scripts/test-sync-merge.js
 */
const assert = require("node:assert/strict");
const merge = require("../shared/sync-merge.js");
const { createSyncEngine } = require("../shared/sync-engine.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function link(title, url, desc = "") {
  return { title, url, desc, domain: new URL(url).hostname };
}

function baseDoc() {
  return {
    version: 1,
    brand: "CL Nav",
    tagline: "开发者工具导航",
    engines: [{ id: "google", name: "Google", url: "https://www.google.com/search?q=", icon: "google.com" }],
    quickLinks: [link("B 站", "https://www.bilibili.com/")],
    categories: [
      {
        id: "cat_dev",
        name: "开发",
        links: [link("GitHub", "https://github.com/"), link("MDN", "https://developer.mozilla.org/")],
        children: [{ id: "sub_fe", name: "前端", links: [link("Vue", "https://vuejs.org/")] }],
      },
      {
        id: "cat_tools",
        name: "工具",
        links: [link("TinyPNG", "https://tinypng.com/")],
        children: [],
      },
    ],
    removedSeeds: [],
  };
}

function findLink(doc, catId, url) {
  const cat = doc.categories.find((c) => c.id === catId);
  return (cat?.links || []).find((l) => l.url === url);
}

function linkUrls(doc, catId) {
  const cat = doc.categories.find((c) => c.id === catId);
  return (cat?.links || []).map((l) => l.url);
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
    console.log("    " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n    ") : err));
  }
}

/** 内存版 Cloudflare D1 语义：单线程 + rev CAS */
class MemoryServer {
  constructor(doc) {
    this.rev = doc ? 1 : 0;
    this.doc = doc ? merge.normalizeDoc(doc) : null;
    this.writer = doc ? "seed" : "";
    this.writes = 0;
    this.beforePut = null;
  }

  snapshot() {
    return this.doc ? { rev: this.rev, doc: clone(this.doc), writer: this.writer } : null;
  }

  async getRemote() {
    // 模拟网络往返，给并发留出窗口
    await new Promise((resolve) => setTimeout(resolve, 0));
    return this.snapshot();
  }

  async putRemote(baseRev, doc, deviceId) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (typeof this.beforePut === "function") {
      const hook = this.beforePut;
      this.beforePut = null;
      await hook();
    }
    if (Number(baseRev) !== Number(this.rev)) {
      return {
        conflict: true,
        rev: this.rev,
        doc: this.doc ? clone(this.doc) : null,
        writer: this.writer,
      };
    }
    this.rev += 1;
    this.doc = merge.normalizeDoc(doc);
    this.writer = deviceId;
    this.writes += 1;
    return { ok: true, rev: this.rev };
  }
}

function makeClient(server, deviceId, initialDoc, opts = {}) {
  let base = null;
  let local = merge.normalizeDoc(initialDoc);
  let dirty = false;

  const deps = {
    deviceId: () => deviceId,
    getRemote: () => server.getRemote(),
    putRemote: (baseRev, doc) => server.putRemote(baseRev, doc, deviceId),
    applyRemote: async (doc) => {
      local = merge.normalizeDoc(doc);
      dirty = false;
    },
    exportLocal: () => clone(local),
    getBase: () => (base ? { rev: base.rev, doc: clone(base.doc) } : null),
    setBase: (rev, doc) => {
      base = { rev, doc: clone(doc) };
      dirty = false;
    },
    hasUserData: () => (opts.hasUserData ? opts.hasUserData() : true),
    isDirty: () => dirty,
  };

  return {
    deps,
    engine: createSyncEngine(deps),
    edit(fn) {
      fn(local);
      dirty = true;
    },
    replace(fn) {
      local = merge.normalizeDoc(fn(clone(local)));
      dirty = true;
    },
    get local() {
      return clone(local);
    },
    get base() {
      return base ? clone(base) : null;
    },
    get dirty() {
      return dirty;
    },
  };
}

async function main() {
  console.log("NavSyncMerge / NavSyncEngine tests\n");

  await test("merge3 无改动时原样返回", () => {
    const base = baseDoc();
    const out = merge.merge3(base, clone(base), clone(base), { localId: "A", remoteId: "B" });
    assert.deepEqual(out.doc, merge.normalizeDoc(base));
    assert.equal(out.conflicts.length, 0);
  });

  await test("双方各加一条链接 → 两条都保留", () => {
    const base = baseDoc();
    const remote = clone(base);
    remote.categories[0].links.push(link("A 站", "https://a.example.com/"));
    const local = clone(base);
    local.categories[0].links.push(link("B 站", "https://b.example.com/"));

    const out = merge.merge3(base, remote, local, { localId: "dev_a", remoteId: "dev_b" });
    const urls = linkUrls(out.doc, "cat_dev");
    assert.ok(urls.includes("https://a.example.com/"), "远端新增丢失");
    assert.ok(urls.includes("https://b.example.com/"), "本地新增丢失");
    assert.equal(out.conflicts.length, 0);
  });

  await test("双方独立新增（都没重排）→ 两个合并方向顺序完全一致", () => {
    const base = baseDoc();
    const local = clone(base);
    local.categories[0].links.push(link("B", "https://b.example.com/"));
    const remote = clone(base);
    remote.categories[0].links.push(link("C", "https://c.example.com/"));

    const ab = merge.merge3(base, remote, local, { localId: "dev_a", remoteId: "dev_b" });
    const ba = merge.merge3(base, local, remote, { localId: "dev_b", remoteId: "dev_a" });
    assert.deepEqual(ab.doc, ba.doc, "新增条目的顺序依赖合并方向，会来回覆盖");
  });

  await test("一方删除、另一方未动 → 删除生效", () => {
    const base = baseDoc();
    const remote = clone(base);
    remote.categories[0].links = remote.categories[0].links.filter((l) => l.url !== "https://github.com/");
    const local = clone(base);

    const out = merge.merge3(base, remote, local, { localId: "A", remoteId: "B" });
    assert.equal(findLink(out.doc, "cat_dev", "https://github.com/"), undefined);
    assert.equal(out.conflicts.length, 0);
  });

  await test("一方删除、另一方编辑 → 保留编辑并记录冲突", () => {
    const base = baseDoc();
    const remote = clone(base);
    remote.categories[0].links = remote.categories[0].links.filter((l) => l.url !== "https://github.com/");
    const local = clone(base);
    findLink(local, "cat_dev", "https://github.com/").title = "GitHub 改";

    const out = merge.merge3(base, remote, local, { localId: "A", remoteId: "B" });
    const kept = findLink(out.doc, "cat_dev", "https://github.com/");
    assert.ok(kept, "编辑过的链接被删除，数据丢失");
    assert.equal(kept.title, "GitHub 改");
    assert.ok(out.conflicts.some((c) => c.kind === "remote-deleted-local-edited"));
  });

  await test("同一字段双方改不同值 → 两个视角结果一致（确定性）", () => {
    const base = baseDoc();
    const a = clone(base);
    a.categories[1].name = "工具（A 改）";
    const b = clone(base);
    b.categories[1].name = "工具（B 改）";

    const ab = merge.merge3(base, b, a, { localId: "dev_a", remoteId: "dev_b" });
    const ba = merge.merge3(base, a, b, { localId: "dev_b", remoteId: "dev_a" });
    assert.deepEqual(ab.doc, ba.doc, "两个视角合并结果不一致，会来回覆盖");
    assert.equal(ab.doc.categories[1].name, "工具（A 改）");
    assert.ok(ab.conflicts.length >= 1);
  });

  await test("本地重排顺序 + 远端新增 → 顺序与新增都保留", () => {
    const base = baseDoc();
    const local = clone(base);
    local.categories.reverse();
    const remote = clone(base);
    remote.categories[0].links.push(link("新增", "https://new.example.com/"));

    const out = merge.merge3(base, remote, local, { localId: "dev_a", remoteId: "dev_b" });
    assert.deepEqual(
      out.doc.categories.map((c) => c.id),
      ["cat_tools", "cat_dev"]
    );
    assert.ok(linkUrls(out.doc, "cat_dev").includes("https://new.example.com/"));
  });

  await test("双方都重排 → 两个合并方向结果一致", () => {
    const base = baseDoc();
    base.categories.push({ id: "cat_extra", name: "额外", links: [], children: [] });
    const local = clone(base);
    local.categories = [local.categories[0], local.categories[2], local.categories[1]];
    const remote = clone(base);
    remote.categories = [remote.categories[1], remote.categories[0], remote.categories[2]];

    const ab = merge.merge3(base, remote, local, { localId: "dev_a", remoteId: "dev_b" });
    const ba = merge.merge3(base, local, remote, { localId: "dev_b", remoteId: "dev_a" });
    assert.deepEqual(ab.doc, ba.doc, "重排冲突结果依赖合并方向");
  });

  await test("删除墓碑 removedSeeds 取并集", () => {
    const base = baseDoc();
    base.removedSeeds = ["u:a"];
    const remote = clone(base);
    remote.removedSeeds = ["u:a", "u:b"];
    const local = clone(base);
    local.removedSeeds = ["u:a", "u:c"];

    const out = merge.merge3(base, remote, local, { localId: "A", remoteId: "B" });
    assert.deepEqual(out.doc.removedSeeds, ["u:a", "u:b", "u:c"]);
  });

  await test("首次连接（无 base）按并集合并，不丢任何一侧", () => {
    const remote = baseDoc();
    const local = baseDoc();
    local.categories.push({ id: "cat_local", name: "本机独有", links: [link("L", "https://l.example.com/")], children: [] });
    local.categories[0].links.push(link("本机新增", "https://local-new.example.com/"));

    const out = merge.merge3(null, remote, local, { localId: "A", remoteId: "B" });
    assert.ok(out.doc.categories.some((c) => c.id === "cat_local"));
    assert.ok(linkUrls(out.doc, "cat_dev").includes("https://local-new.example.com/"));
    assert.ok(linkUrls(out.doc, "cat_dev").includes("https://github.com/"));
  });

  await test("A 新增、B 新增 → 依次同步后双方收敛且都在云端", async () => {
    const server = new MemoryServer(baseDoc());
    const a = makeClient(server, "dev_a", baseDoc());
    const b = makeClient(server, "dev_b", baseDoc());

    a.edit((doc) => doc.categories[0].links.push(link("A", "https://a.example.com/")));
    b.edit((doc) => doc.categories[0].links.push(link("B", "https://b.example.com/")));

    await a.engine.sync("PUSH");
    await b.engine.sync("PUSH");

    assert.ok(linkUrls(server.doc, "cat_dev").includes("https://a.example.com/"));
    assert.ok(linkUrls(server.doc, "cat_dev").includes("https://b.example.com/"));
    assert.ok(linkUrls(b.local, "cat_dev").includes("https://a.example.com/"));

    await a.engine.sync("PULL");
    assert.ok(linkUrls(a.local, "cat_dev").includes("https://b.example.com/"));
    assert.deepEqual(a.local, b.local, "两端最终数据不一致");
  });

  await test("并发提交触发 409 → 自动重新合并且不丢更新", async () => {
    const server = new MemoryServer(baseDoc());
    const a = makeClient(server, "dev_a", baseDoc());
    const b = makeClient(server, "dev_b", baseDoc());
    const c = makeClient(server, "dev_c", baseDoc());
    // 先建立各自 base（真实设备首次连接后才会开始增量编辑）
    await a.engine.sync("PULL");
    await b.engine.sync("PULL");
    await c.engine.sync("PULL");

    a.edit((doc) => doc.categories[0].links.push(link("A", "https://a.example.com/")));
    b.edit((doc) => doc.categories[0].links.push(link("B", "https://b.example.com/")));
    c.edit((doc) => doc.categories[0].links.push(link("C", "https://c.example.com/")));

    await a.engine.sync("PUSH"); // rev 2：A 先落地

    // B 读取 rev2 后、提交前，C 抢先提交（rev3），B 的 baseRev 必然过期
    server.beforePut = async () => {
      await c.engine.sync("PUSH");
    };

    const resB = await b.engine.sync("PUSH");
    assert.ok(resB.rev >= 4, "409 后应重试成功");

    const urls = linkUrls(server.doc, "cat_dev");
    assert.ok(urls.includes("https://a.example.com/"), "A 的更新丢失");
    assert.ok(urls.includes("https://b.example.com/"), "B 的更新丢失");
    assert.ok(urls.includes("https://c.example.com/"), "C 的更新丢失");

    await a.engine.sync("PULL");
    await c.engine.sync("PULL");
    assert.deepEqual(a.local, server.doc);
    assert.deepEqual(c.local, server.doc);
  });

  await test("删除与编辑并发 → 编辑保留，最终两端一致", async () => {
    const server = new MemoryServer(baseDoc());
    const a = makeClient(server, "dev_a", baseDoc());
    const b = makeClient(server, "dev_b", baseDoc());
    await a.engine.sync("PULL");
    await b.engine.sync("PULL");

    a.edit((doc) => {
      doc.categories[0].links = doc.categories[0].links.filter((l) => l.url !== "https://github.com/");
    });
    b.edit((doc) => {
      findLink(doc, "cat_dev", "https://github.com/").title = "GitHub（改）";
    });

    await a.engine.sync("PUSH");
    await b.engine.sync("PUSH");
    await a.engine.sync("PULL");

    assert.ok(findLink(server.doc, "cat_dev", "https://github.com/"), "编辑被删除覆盖");
    assert.equal(findLink(server.doc, "cat_dev", "https://github.com/").title, "GitHub（改）");
    assert.ok(findLink(a.local, "cat_dev", "https://github.com/"));
    assert.deepEqual(a.local, server.doc);
  });

  await test("干净状态下重复 sync 不产生新版本", async () => {
    const server = new MemoryServer(baseDoc());
    const a = makeClient(server, "dev_a", baseDoc());

    await a.engine.sync("FULL");
    const writes = server.writes;
    await a.engine.sync("FULL");
    await a.engine.sync("PULL");
    assert.equal(server.writes, writes, "无改动时不应重复写云端");
  });

  await test("同步期间本机继续编辑：不覆盖新编辑，下一轮自动合并", async () => {
    const server = new MemoryServer(baseDoc());
    const a = makeClient(server, "dev_a", baseDoc());
    await a.engine.sync("PULL");
    a.edit((doc) => doc.categories[0].links.push(link("A", "https://a.example.com/")));

    let editedDuringSync = false;
    const originalPut = server.putRemote.bind(server);
    server.putRemote = async (baseRev, doc, deviceId) => {
      const res = await originalPut(baseRev, doc, deviceId);
      if (!editedDuringSync) {
        editedDuringSync = true;
        a.edit((doc) => doc.categories[0].links.push(link("A2", "https://a2.example.com/")));
      }
      return res;
    };

    await a.engine.sync("PUSH");
    await a.engine.sync("PUSH");

    const urls = linkUrls(server.doc, "cat_dev");
    assert.ok(urls.includes("https://a.example.com/"));
    assert.ok(urls.includes("https://a2.example.com/"), "同步期间的新编辑丢失");
    assert.deepEqual(a.local, server.doc);
  });

  await test("三设备随机并发编辑后收敛且无重复链接", async () => {
    let seed = 20261019;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

    const server = new MemoryServer(baseDoc());
    const clients = [
      makeClient(server, "dev_a", baseDoc()),
      makeClient(server, "dev_b", baseDoc()),
      makeClient(server, "dev_c", baseDoc()),
    ];
    for (const c of clients) await c.engine.sync("PULL");

    for (let step = 0; step < 24; step++) {
      const who = pick(clients);
      const op = Math.floor(rnd() * 4);
      who.edit((doc) => {
        if (op === 0) {
          pick(doc.categories).links.push(link("N" + step, "https://n" + step + ".example.com/"));
        } else if (op === 1) {
          const cat = pick(doc.categories);
          if (cat.links.length) cat.links.splice(Math.floor(rnd() * cat.links.length), 1);
        } else if (op === 2) {
          pick(doc.categories).name = "RN" + step;
        } else {
          doc.categories.reverse();
        }
      });
      await pick(clients).engine.sync("FULL");
    }

    // 模拟各设备陆续上线，反复同步直到稳定
    for (let round = 0; round < 2; round++) {
      for (const c of clients) await c.engine.sync("PULL");
      for (const c of clients) await c.engine.sync("FULL");
    }

    const finalDoc = server.doc;
    for (const c of clients) {
      assert.deepEqual(c.local, finalDoc, "三设备未收敛");
    }
    for (const cat of finalDoc.categories) {
      const urls = cat.links.map((l) => l.url);
      assert.equal(new Set(urls).size, urls.length, "合并后出现重复链接");
    }
  });

  console.log("\n" + passed + " passed, " + failures.length + " failed");
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
