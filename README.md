# cl-nav

一个**静态**的导航 / 收藏门户站点，包含多套布局预览。

- 入口：`index.html`（导航主页）、`library.html`（库）、`previews.html`（布局预览）
- 资源：`shared/`（JS / CSS：portal、store、webdav、config-ui 等）
- 布局：`layouts/`（01～10 套可选布局）
- 离线：`sw.js`（Service Worker）
- 工具脚本：`scripts/`（开发辅助，不参与站点发布）

## 本地预览

纯静态，直接用浏览器打开 `index.html`，或起个本地服务：

```bash
npx serve .
# 或
python -m http.server 8080
```

## 环境与部署

| 环境 | 分支 | 托管 |
|------|------|------|
| **测试** | `main` | GitHub Pages（Actions）；API 仍指向 CF 生产（见 `shared/api-base.js`） |
| **生产** | `production` | Cloudflare Pages（`cl-nav.pages.dev`）+ Functions/KV |

代码源以 **GitHub** 为准。日常：`git push github main`（测）→ merge/推送 `production`（产）。Gitee `origin` 仅作可选镜像。

### 远程仓库

| 名称 | 地址 |
|---|---|
| `github` | `git@github.com:xiaochenbian-new/cl-nav.git`（部署源） |
| `origin` | `https://gitee.com/xiaochenbian/cl-nav.git`（可选镜像） |

### Cloudflare

Dashboard：**Connect to Git** → 本仓库，**Production branch = `production`**，Preview = `main`。

- 框架预设：**无（None）**；构建命令留空；输出目录 `/`
- `.assetsignore` 已排除 `.github`、`scripts` 等

### GitHub Pages（测试）

推送 `main` → `.github/workflows/deploy-pages.yml`。Settings → Pages → Source = **GitHub Actions**。

## 多端同步（强一致）

导航配置使用 **Cloudflare D1 + 版本号 CAS + 三方合并**，不再是整份 JSON 覆盖：

- 每台设备提交时带 `baseRev`，服务端 `UPDATE ... WHERE rev = baseRev` 原子校验；
- 版本落后返回 `409`，客户端把「上次同步版本 / 云端最新 / 本机当前」三方合并后重试；
- 双方新增都保留，删除能正确传播，同一字段冲突按设备 ID 确定性裁决；
- 资源库目录不再进入导航备份，避免旧快照覆盖服务端资源库。

部署需要给 Pages 绑定 D1 数据库（变量名 `CL_NAV_DB`），旧 KV 数据会在首次读取时自动迁移。未绑定时自动回退旧 KV（仍可能互相覆盖）。完整说明见 [docs/multi-device-sync.md](docs/multi-device-sync.md)。

本地合并测试：

```bash
node scripts/test-sync-merge.js
node scripts/test-sync-client.js
node scripts/test-sync2-server.js
```
