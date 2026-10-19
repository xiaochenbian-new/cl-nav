/**
 * Cloudflare Pages Function — 强一致配置同步 v2（D1）
 * 路由：/api/sync2
 *
 * 与旧版 /api/sync（KV 整份覆盖）的区别：
 *   - 每个同步口令一行文档 + 单调递增 rev；
 *   - 提交必须带 baseRev，SQL 里用 UPDATE ... WHERE rev = baseRev 做原子 CAS；
 *   - 版本过期返回 409 + 云端最新文档，客户端三方合并后重试 —— 旧设备无法再静默覆盖新版本；
 *   - D1 单库单线程串行执行，写入是强一致的。
 *
 * 绑定：
 *   CL_NAV_DB      D1 数据库（必需）
 *   CL_NAV_SYNC    KV（可选，仅用于首次从旧版数据迁移）
 *
 * 接口：
 *   GET   /api/sync2                → { rev, doc, updatedAt, writer } | 404 {empty:true}
 *   PUT   /api/sync2                → { baseRev, doc, deviceId }
 *                                    成功 { ok:true, rev, updatedAt }
 *                                    冲突 409 { error:"conflict", rev, doc, updatedAt, writer }
 *   HEAD  /api/sync2                → X-Sync-Rev / X-Sync-Updated-At
 */

const MAX_DOC_BYTES = 1_500_000; // D1 单行上限 2MB，留出余量
const KEEP_HISTORY = 40; // 每个口令保留最近 40 个版本

let schemaPromise = null;

function cors(req) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match",
    "Access-Control-Expose-Headers": "X-Sync-Rev, X-Sync-Updated-At, X-Sync-Writer",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, req, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors(req),
      ...(extraHeaders || {}),
    },
  });
}

function getToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  try {
    return new URL(request.url).searchParams.get("token") || "";
  } catch {
    return "";
  }
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tokenToKey(token) {
  return sha256Hex("cl-nav-sync-v2:" + String(token || "").trim());
}

async function tokenToLegacyKey(token) {
  return sha256Hex("cl-nav-sync-v1:" + String(token || "").trim());
}

function byteLength(text) {
  try {
    return new TextEncoder().encode(text).length;
  } catch (_) {
    return String(text || "").length;
  }
}

/** 去掉不属于导航同步的字段（资源库由服务端 /api/library 单独维护，避免被旧快照覆盖） */
function sanitizeDoc(input) {
  let doc = input;
  if (typeof doc === "string") doc = JSON.parse(doc);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("doc 必须是对象");
  }
  const out = { ...doc };
  delete out.library;
  delete out.exportedAt;
  delete out._sync;
  if (!Array.isArray(out.categories)) {
    throw new Error("doc.categories 必须是数组");
  }
  if (!out.categories.length) {
    // 空分类会被前端视为损坏并重置为默认，拒绝写入以免把坏状态同步给所有设备
    throw new Error("doc.categories 不能为空");
  }
  return out;
}

function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS sync_docs (
             token_hash TEXT PRIMARY KEY,
             rev INTEGER NOT NULL,
             doc TEXT NOT NULL,
             updated_at INTEGER NOT NULL,
             updated_by TEXT NOT NULL DEFAULT ''
           )`
        )
        .run();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS sync_history (
             token_hash TEXT NOT NULL,
             rev INTEGER NOT NULL,
             doc TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             updated_by TEXT NOT NULL DEFAULT '',
             PRIMARY KEY (token_hash, rev)
           )`
        )
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_sync_history_token_rev
             ON sync_history (token_hash, rev DESC)`
        )
        .run();
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function readRow(db, key) {
  return await db
    .prepare("SELECT rev, doc, updated_at, updated_by FROM sync_docs WHERE token_hash = ?")
    .bind(key)
    .first();
}

function rowToRemote(row) {
  return {
    rev: Number(row.rev) || 0,
    doc: JSON.parse(row.doc),
    updatedAt: Number(row.updated_at) || 0,
    writer: String(row.updated_by || ""),
  };
}

/** 从旧 KV 备份迁移一份数据（只在 D1 里还没有该口令时执行） */
async function legacyDoc(env, token) {
  const kv = env && env.CL_NAV_SYNC;
  if (!kv || typeof kv.get !== "function") return null;
  const key = await tokenToLegacyKey(token);
  // KV 读失败要让请求失败（500），不能当成“没有旧数据”返回 404：
  // 否则客户端会把自己的本地状态当成首份数据上传，看起来像旧数据丢了。
  const raw = await kv.get("backup:" + key);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    const body = record && record.body != null ? record.body : record;
    return sanitizeDoc(body);
  } catch (_) {
    return null;
  }
}

async function writeHistory(db, key, rev, docText, now, deviceId) {
  try {
    await db
      .prepare(
        "INSERT OR REPLACE INTO sync_history (token_hash, rev, doc, created_at, updated_by) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(key, rev, docText, now, deviceId)
      .run();
    await db
      .prepare(
        `DELETE FROM sync_history
          WHERE token_hash = ?
            AND rev <= (SELECT rev FROM sync_history WHERE token_hash = ? ORDER BY rev DESC LIMIT 1 OFFSET ?)`
      )
      .bind(key, key, KEEP_HISTORY)
      .run();
  } catch (_) {
    // 历史记录失败不影响主流程
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }

  const db = env && env.CL_NAV_DB;
  if (!db || typeof db.prepare !== "function") {
    return json(
      {
        error:
          "未绑定 D1：请在 Cloudflare Dashboard → Workers & Pages → cl-nav → Settings → Bindings 添加 D1 数据库绑定，变量名填 CL_NAV_DB（旧 KV 数据会在首次读取时自动迁移）。",
        code: "D1_NOT_BOUND",
      },
      503,
      request
    );
  }

  const token = getToken(request);
  if (!token || token.length < 8) {
    return json({ error: "请提供至少 8 位的同步口令（Authorization: Bearer …）", code: "BAD_TOKEN" }, 401, request);
  }

  const key = await tokenToKey(token);

  try {
    await ensureSchema(db);

    if (request.method === "HEAD") {
      const row = await readRow(db, key);
      const headers = new Headers(cors(request));
      headers.set("Cache-Control", "no-store");
      if (!row) return new Response(null, { status: 404, headers });
      headers.set("X-Sync-Rev", String(Number(row.rev) || 0));
      headers.set("X-Sync-Updated-At", String(Number(row.updated_at) || 0));
      headers.set("X-Sync-Writer", String(row.updated_by || ""));
      return new Response(null, { status: 200, headers });
    }

    if (request.method === "GET") {
      let row = await readRow(db, key);

      if (!row) {
        // 首次使用 v2：把旧 KV 里同一口令的备份迁进来（rev = 1）
        const doc = await legacyDoc(env, token);
        if (doc) {
          const now = Date.now();
          const docText = JSON.stringify(doc);
          if (byteLength(docText) > MAX_DOC_BYTES) {
            return json({ error: "旧备份过大，无法迁移到 D1（上限约 1.5MB）", code: "DOC_TOO_LARGE" }, 413, request);
          }
          try {
            const inserted = await db
              .prepare(
                `INSERT INTO sync_docs (token_hash, rev, doc, updated_at, updated_by)
                 VALUES (?, 1, ?, ?, 'migrated')
                 ON CONFLICT(token_hash) DO NOTHING
                 RETURNING rev`
              )
              .bind(key, docText, now)
              .first();
            if (inserted) {
              return json(
                { rev: 1, doc, updatedAt: now, writer: "migrated", migrated: true },
                200,
                request,
                { "X-Sync-Rev": "1" }
              );
            }
          } catch (_) {
            // 并发迁移冲突，继续按已存在处理
          }
          row = await readRow(db, key);
        }
      }

      if (!row) {
        return json({ error: "云端尚无备份", empty: true, rev: 0 }, 404, request);
      }

      const remote = rowToRemote(row);
      return json(remote, 200, request, {
        "X-Sync-Rev": String(remote.rev),
        "X-Sync-Updated-At": String(remote.updatedAt),
        "X-Sync-Writer": remote.writer,
      });
    }

    if (request.method === "PUT") {
      const text = await request.text();
      if (!text || text.length < 2) return json({ error: "请求体为空" }, 400, request);
      if (text.length > 2_000_000) return json({ error: "请求体过大" }, 413, request);

      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        return json({ error: "不是合法 JSON" }, 400, request);
      }

      const baseRev = Number(payload && payload.baseRev);
      if (!Number.isInteger(baseRev) || baseRev < 0) {
        return json({ error: "baseRev 必须是非负整数" }, 400, request);
      }
      if (!payload || !payload.doc || typeof payload.doc !== "object") {
        return json({ error: "doc 不能为空" }, 400, request);
      }

      let doc;
      try {
        doc = sanitizeDoc(payload.doc);
      } catch (err) {
        return json({ error: err.message || "doc 格式不正确" }, 400, request);
      }

      const docText = JSON.stringify(doc);
      if (byteLength(docText) > MAX_DOC_BYTES) {
        return json(
          { error: "配置过大（上限约 1.5MB），请精简后再同步", code: "DOC_TOO_LARGE" },
          413,
          request
        );
      }

      const deviceId = String((payload && payload.deviceId) || "").slice(0, 64);
      const now = Date.now();
      let newRev = 0;

      if (baseRev === 0) {
        // 首次建立文档：ON CONFLICT DO NOTHING 保证并发时只有一个成功
        const inserted = await db
          .prepare(
            `INSERT INTO sync_docs (token_hash, rev, doc, updated_at, updated_by)
             VALUES (?, 1, ?, ?, ?)
             ON CONFLICT(token_hash) DO NOTHING
             RETURNING rev`
          )
          .bind(key, docText, now, deviceId)
          .first();
        if (inserted) newRev = Number(inserted.rev) || 1;
      } else {
        // 原子 CAS：只有 rev 仍等于 baseRev 才会写入并 +1
        const updated = await db
          .prepare(
            `UPDATE sync_docs
                SET rev = rev + 1, doc = ?, updated_at = ?, updated_by = ?
              WHERE token_hash = ? AND rev = ?
              RETURNING rev`
          )
          .bind(docText, now, deviceId, key, baseRev)
          .first();
        if (updated) newRev = Number(updated.rev) || 0;
      }

      if (!newRev) {
        const row = await readRow(db, key);
        if (!row) {
          // 本机以为有 rev，但云端文档不存在（换库/清空）：按冲突返回，客户端会重新首次合并
          return json(
            { error: "conflict", rev: 0, doc: null, updatedAt: 0, writer: "" },
            409,
            request
          );
        }
        const remote = rowToRemote(row);
        return json(
          { error: "conflict", rev: remote.rev, doc: remote.doc, updatedAt: remote.updatedAt, writer: remote.writer },
          409,
          request,
          {
            "X-Sync-Rev": String(remote.rev),
            "X-Sync-Updated-At": String(remote.updatedAt),
            "X-Sync-Writer": remote.writer,
          }
        );
      }

      await writeHistory(db, key, newRev, docText, now, deviceId);

      return json(
        { ok: true, rev: newRev, updatedAt: now, writer: deviceId },
        200,
        request,
        { "X-Sync-Rev": String(newRev), "X-Sync-Updated-At": String(now) }
      );
    }

    return json({ error: "Method Not Allowed" }, 405, request);
  } catch (err) {
    return json(
      {
        error: "同步服务异常：" + (err && err.message ? err.message : String(err)),
        code: "SYNC_ERROR",
      },
      500,
      request
    );
  }
}
