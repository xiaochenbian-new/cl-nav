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

## 部署与同步（与 tool-nav 同套方案）

```
你 push 到 gitee（源） →（本机定时任务，每15分钟）push 到 github
   → github Actions: deploy-pages → 发布 GitHub Pages
   → Cloudflare Pages 自动重建（若已接入）
```

### 远程仓库

| 名称 | 地址 |
|---|---|
| `origin` | `https://gitee.com/xiaochenbian/cl-nav.git`（源） |
| `github` | `git@github.com:xiaochenbian-new/cl-nav.git`（镜像，SSH） |

### 为什么不用 GitHub Actions 定时同步 gitee

gitee 对 **GitHub Actions 数据中心 IP** 做了防滥用限流（`HTTP 429`），CI 里 clone gitee 几乎必失败，因此**同步改用本机定时任务**（本机 IP 不受限）：

- 隐藏执行脚本：`scripts/sync-github-hidden.vbs`（`wscript` 调用，SW_HIDE 无窗口）
- Windows 任务计划：每 15 分钟运行该 VBS → 后台静默 `git push github main`

> 更通用的做法与踩坑记录见：`C:\Users\16372\IdeaProjects\cursor-tools-nav\tool-nav\docs\gitee-github-auto-sync.md`

### 启用步骤（首次）

1. 在 gitee 建库 `cl-nav`（公开或私有均可），在 github 建库 `cl-nav`
2. 本机推送：`git push -u origin main` && `git push github main`
3. github 仓库 **Settings → Pages → Source** 选 **GitHub Actions**（启用 Pages 发布）
4. Cloudflare Pages：**Workers & Pages → Create application → Pages → Connect to Git**，选本仓库：
   - 框架预设：**无（None）**
   - 构建命令：**留空**（纯静态站，无需构建）
   - 构建输出目录：**`/`**（仓库根目录即站点）
   - 开发文件（`.github`、`scripts`、`node_modules` 等）已由仓库里的 **`.assetsignore`** 排除，不会对外发布
