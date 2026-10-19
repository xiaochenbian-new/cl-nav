# 多端同步：从「整份覆盖」到「版本 CAS + 三方合并」

> 适用版本：`/api/sync2`、`shared/cf-sync.js`、`shared/sync-merge.js`、`shared/sync-engine.js`

## 1. 为什么原来的同步会互相覆盖

旧版协议（`functions/api/sync.js` + `shared/cf-sync.js`）本质是**网盘式备份**：

| 问题 | 代码位置 | 后果 |
|---|---|---|
| `PUT` 直接把整份 JSON 写到 `backup:<token>`，没有版本校验 | `functions/api/sync.js` PUT 分支 | 谁后写谁赢，旧设备必然覆盖新版本 |
| 本地 `localDirty` 时无条件 `PUSH` | `shared/cf-sync.js` 的 `sync()` | 即使云端已有别的电脑的新改动，也会被本机旧快照覆盖 |
| 用各设备的 `Date.now()` 比较新旧 | `exportedAt` / `remoteAt > last` | 电脑时钟不准时“谁更新”会判反 |
| 备份里夹带资源库目录，拉取时 `replaceCatalog` 写回服务端 | `LibraryStorage.enrichBackupJson` / `applyBackupLibrary` | 导航同步会顺手用旧副本覆盖资源库 |
| KV 跨区域最终一致且没有 CAS | Cloudflare KV 本身 | 并发写即使逻辑正确也可能丢更新 |
| 删除只靠本地墓碑、且不进备份 | `cl-nav-removed-seeds-v1` | 已删除的条目会被其它设备带回来 |

结论：这是**协议缺少并发控制**，不是网络偶发问题。

## 2. 新协议

### 2.1 服务端：每个口令一份文档 + rev

D1 表 `sync_docs`：

```sql
token_hash TEXT PRIMARY KEY,
rev INTEGER NOT NULL,
doc TEXT NOT NULL,
updated_at INTEGER NOT NULL,
updated_by TEXT NOT NULL
```

- `GET /api/sync2` → `{ rev, doc, updatedAt, writer }`
- `PUT /api/sync2` body `{ baseRev, doc, deviceId }`
  - `baseRev === 当前 rev`：`UPDATE ... SET rev = rev + 1 WHERE rev = baseRev`，原子提交
  - 否则：`409 { error:"conflict", rev, doc, writer }`

D1 单库单线程，`UPDATE ... WHERE rev = ?` 是原子的，因此**每次提交都基于一个确切版本**。旧设备拿着过期 `baseRev` 提交时会被拒绝，而不是覆盖。

同时写入 `sync_history`（每个口令保留最近 40 版），便于排查和手动回滚。

### 2.2 客户端：落后时先三方合并再重试

每台设备保存：

- `base`：上次同步成功时的文档
- `baseRev`：该文档对应的服务端版本
- `local`：当前本地文档

同步流程（`shared/sync-engine.js`）：

1. `GET` 云端最新。
2. `remote.rev === baseRev` 且本机有改动 → 直接 CAS 提交。
3. `remote.rev > baseRev` → `merge3(base, remote, local)`：
   - 本机没改 → 采用云端（纯拉取）
   - 本机改了 → 合并后以 `remote.rev` 为 base 提交
4. 提交返回 `409` → 用返回的最新文档重新 `merge3`，最多重试 6 次。
5. 提交成功后才更新本地 `base/baseRev`；若同步期间本机又产生新编辑，**不覆盖新编辑**，保留旧 base，下一轮重新合并。

### 2.3 合并规则（`shared/sync-merge.js`）

按条目合并，条目身份：

- 分类 / 子分类：`id`，其次 `name`
- 网站链接 / 常用网站：`URL`（忽略大小写和末尾 `/`），其次标题
- 搜索引擎：`id`，其次 URL

| base / local / remote 状态 | 结果 |
|---|---|
| local 与 remote 相同 | 保留 |
| 只有一方相对 base 改动（含删除） | 取改动方 |
| 双方都改，字段不同 | 字段级合并 |
| 双方都改同一字段且值不同 | 取 JSON 序列化较小的一方（与合并方向无关，两台设备算出同一结果），记录冲突 |
| 一方删除、另一方修改 | **保留修改**，记录冲突（宁可多一条，不丢数据） |
| 双方都删 | 删除 |
| 只有一方新增 | 新增 |
| 顺序：只有一方调整 | 采纳该方顺序 |
| 顺序：双方都调整 | 按内容确定性选一方顺序，另一方独有的条目追加到末尾 |

另外：

- `removedSeeds`（已删除的 CL 应用 seed 链接墓碑）取并集，随备份同步，避免删除后复活。
- 首次连接（没有 base）按**并集**合并，只增不删，绝不丢数据。
- 资源库目录不再进入导航同步文档：它本来就存在服务端 `/api/library`，各设备打开时读取同一份，避免旧快照回写。

## 3. 部署步骤

> 以下命令在 `cl-nav/` 目录执行。

1. 创建 D1 数据库：

   ```bash
   npx wrangler d1 create cl-nav-sync
   ```

2. 绑定到 Pages（二选一）：

   - 控制台：Workers & Pages → cl-nav → Settings → Bindings → 添加 **D1 database**，变量名 `CL_NAV_DB`
   - 或取消 `wrangler.toml` 里 `[[d1_databases]]` 注释并填入返回的 `database_id`

   > Preview 环境需要单独绑定（可以指向同一个 D1 库）；只绑定 Production 时，预览站会走旧 KV 兼容模式。

3. （可选）手动建表。接口首次请求也会自动建表：

   ```bash
   npx wrangler d1 execute cl-nav-sync --remote --file=./schema/sync.sql
   ```

4. 重新部署（Pages 需要重新部署后绑定才生效）。

5. 打开设置 → 备份：点「测试」，应显示「D1 强一致同步可用」。

### 旧数据迁移

第一次 `GET /api/sync2` 时，如果 D1 里没有该口令，服务端会读取旧 KV `backup:<sha256("cl-nav-sync-v1:"+token)>`，去掉 `library` 后写入 D1，`rev = 1`，`writer = "migrated"`。

因此：**先保持旧 KV 绑定**（`CL_NAV_SYNC` 已在 `wrangler.toml` 里），部署新代码后各设备正常同步一次即可完成迁移。确认迁移完成后，KV 可继续留着做冷备，不影响新协议。

> 部署后请让**每台设备都刷新一次页面**（必要时 Ctrl/Cmd+Shift+R）。旧页面里的 `cf-sync.js` 仍只会读写旧 KV，不会走 D1；在新旧页面混用的短暂窗口里，两边可能不同步。

### 回退

- 新代码在 D1 未绑定时会自动回退旧 `/api/sync`（结果里会提示“兼容模式”），不会因忘记绑定而完全不可用。
- 若要完全回退：先在设置 → 备份里「导出 JSON」（拿到的是 D1 最新数据），再换回旧版 `shared/cf-sync.js` 并导入/上传。**D1 不会自动回写 KV**，直接回退只能看到 KV 里的旧快照。

## 4. 本地测试

```bash
cd cl-nav
node scripts/test-sync-merge.js    # 合并规则 + 并发状态机
node scripts/test-sync-client.js   # 两个“浏览器”走完整 cf-sync 流程
node scripts/test-sync2-server.js  # 用 node:sqlite 模拟 D1 验证 CAS/409/迁移
```

`scripts/package.json` 里也有 `npm test`，会依次跑完三个文件。

## 5. 多标签页说明

`base`（上次同步基准）放在 **sessionStorage**，每个标签页一份：

- 标签页 A 同步后，标签页 B 的 base 不会跟着变，B 下次拉取时会把 A 的提交当成“远端改动”正常合并，不会把 A 的改动覆盖回去；
- 同一个标签页刷新后 base 仍在，避免每次刷新都触发首次并集合并；
- 新标签页没有 base，会按「本地当前配置 vs 云端」首次连接规则处理（相同则直接接管，不同则并集合并）。

## 6. 已知边界

- 冲突自动裁决是“确定性内容裁决”（同一字段取 JSON 序列化较小者），不是人工合并 UI；冲突会记录在设置页「最近自动解决的冲突」里。
- 删除 vs 编辑选择保留编辑，极端情况下会出现“删了又回来”，但不会静默丢数据。
- 资源库 `functions/api/library.js` 仍是 KV 读改写；它需要登录后操作，冲突概率远低于导航配置。如果以后多人同时维护资源库，建议同样迁移到 D1。
- WebDAV 备份仍是整份快照（用于离线/第三方备份），不参与强一致同步。
