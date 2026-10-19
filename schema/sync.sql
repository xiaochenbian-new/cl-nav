-- CL Nav 同步 v2（D1）表结构
-- 接口 /api/sync2 首次请求会自动建表；本文件用于手动初始化 / 迁移 / 备份参考。
--   npx wrangler d1 execute cl-nav-sync --remote --file=./schema/sync.sql

CREATE TABLE IF NOT EXISTS sync_docs (
  token_hash TEXT PRIMARY KEY,          -- sha256("cl-nav-sync-v2:" + 同步口令)
  rev INTEGER NOT NULL,                 -- 单调递增版本号
  doc TEXT NOT NULL,                    -- 导航配置 JSON
  updated_at INTEGER NOT NULL,          -- 服务端毫秒时间戳
  updated_by TEXT NOT NULL DEFAULT ''   -- 提交设备 ID（用于确定性冲突裁决）
);

CREATE TABLE IF NOT EXISTS sync_history (
  token_hash TEXT NOT NULL,
  rev INTEGER NOT NULL,
  doc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (token_hash, rev)
);

CREATE INDEX IF NOT EXISTS idx_sync_history_token_rev
  ON sync_history (token_hash, rev DESC);
