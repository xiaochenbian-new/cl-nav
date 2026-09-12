/** CL Nav — settings / config UI */
(function () {
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function domainFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  /** HTML5 drag-reorder for .cfg-item lists (drag from ⠿ handle) */
  function bindDragSort(listEl, { onReorder }) {
    if (!listEl) return;
    let dragEl = null;

    listEl.querySelectorAll(".cfg-item[data-sortable]").forEach((item) => {
      const handle = item.querySelector(".cfg-drag");
      item.setAttribute("draggable", "false");

      const setDrag = (on) => {
        item.setAttribute("draggable", on ? "true" : "false");
      };

      if (handle) {
        handle.addEventListener("mousedown", () => setDrag(true));
        handle.addEventListener("touchstart", () => setDrag(true), { passive: true });
      }
      item.addEventListener("mouseup", () => setDrag(false));
      item.addEventListener("mouseleave", () => {
        if (!dragEl) setDrag(false);
      });

      item.addEventListener("dragstart", (e) => {
        if (item.getAttribute("draggable") !== "true") {
          e.preventDefault();
          return;
        }
        dragEl = item;
        item.classList.add("dragging");
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", "sort");
        } catch (_) {}
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        listEl.querySelectorAll(".cfg-item").forEach((el) => el.classList.remove("drag-over"));
        setDrag(false);
        dragEl = null;
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === item) return;
        const rect = item.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        listEl.querySelectorAll(".cfg-item").forEach((el) => el.classList.remove("drag-over"));
        item.classList.add("drag-over");
        item.dataset.dropBefore = before ? "1" : "0";
        try {
          e.dataTransfer.dropEffect = "move";
        } catch (_) {}
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("drag-over");
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        if (!dragEl || dragEl === item) return;
        const items = [...listEl.querySelectorAll(".cfg-item[data-sortable]")];
        const from = items.indexOf(dragEl);
        let to = items.indexOf(item);
        if (from < 0 || to < 0) return;
        const before = item.dataset.dropBefore === "1";
        if (from < to && before) to -= 1;
        if (from > to && !before) to += 1;
        if (from === to) return;
        onReorder(from, to);
      });
    });
  }

  /** One dialog: 名称 → 地址 → 备注 */
  function openLinkDialog(initial = {}, titleText = "添加网站") {
    return new Promise((resolve) => {
      const old = document.getElementById("cfgLinkDialog");
      if (old) old.remove();

      const overlay = document.createElement("div");
      overlay.id = "cfgLinkDialog";
      overlay.className = "cfg-dialog-overlay";
      overlay.innerHTML = `
        <div class="cfg-dialog" role="dialog" aria-modal="true" aria-labelledby="cfgDialogTitle">
          <h3 id="cfgDialogTitle">${esc(titleText)}</h3>
          <label class="cfg-field">
            <span>名称</span>
            <input type="text" id="cfgDlgTitle" placeholder="如 GitHub" value="${esc(initial.title || "")}" autocomplete="off" />
          </label>
          <label class="cfg-field">
            <span>网站地址</span>
            <input type="url" id="cfgDlgUrl" placeholder="https://example.com" value="${esc(initial.url || "")}" autocomplete="off" />
          </label>
          <label class="cfg-field">
            <span>备注</span>
            <input type="text" id="cfgDlgDesc" placeholder="一句话说明（可选）" value="${esc(initial.desc || "")}" autocomplete="off" />
          </label>
          <p class="cfg-dialog-err" id="cfgDlgErr" hidden></p>
          <div class="cfg-dialog-actions">
            <button type="button" class="cfg-btn" id="cfgDlgCancel">取消</button>
            <button type="button" class="cfg-btn primary" id="cfgDlgOk">确定</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const urlInput = overlay.querySelector("#cfgDlgUrl");
      const descInput = overlay.querySelector("#cfgDlgDesc");
      const titleInput = overlay.querySelector("#cfgDlgTitle");
      const errEl = overlay.querySelector("#cfgDlgErr");

      const close = (result) => {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };

      const submit = () => {
        let url = (urlInput.value || "").trim();
        if (!url) {
          errEl.hidden = false;
          errEl.textContent = "请填写网站地址";
          urlInput.focus();
          return;
        }
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        const desc = (descInput.value || "").trim();
        let title = (titleInput.value || "").trim();
        if (!title) title = domainFromUrl(url) || url;
        close(NavStore.normalizeLink({ title, url, desc }));
      };

      const onKey = (e) => {
        if (e.key === "Escape") close(null);
        if (e.key === "Enter" && e.target.tagName === "INPUT") {
          e.preventDefault();
          submit();
        }
      };
      document.addEventListener("keydown", onKey);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });
      overlay.querySelector("#cfgDlgCancel").addEventListener("click", () => close(null));
      overlay.querySelector("#cfgDlgOk").addEventListener("click", submit);

      titleInput.focus();
      titleInput.select();
    });
  }

  window.NavConfigUI = {
    selectedCatId: "",
    activeTab: "quick",

    open() {
      const go = () => {
        const panel = document.getElementById("settingsPanel");
        if (!panel) return;
        panel.hidden = false;
        this.render();
      };
      if (window.NavAuth?.requireLogin) {
        NavAuth.requireLogin(go);
        return;
      }
      go();
    },

    close() {
      const panel = document.getElementById("settingsPanel");
      if (panel) panel.hidden = true;
      document.getElementById("cfgLinkDialog")?.remove();
    },

    logout() {
      if (window.NavAuth?.logout) NavAuth.logout();
      this.close();
    },

    setTab(tab) {
      this.activeTab = tab || "theme";
      const root = document.getElementById("settingsBody");
      if (!root) return;
      root.querySelectorAll(".cfg-tabs [data-tab]").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === this.activeTab);
      });
      root.querySelectorAll(".cfg-pane").forEach((p) => {
        p.hidden = p.dataset.pane !== this.activeTab;
      });
      if (this.activeTab === "library") this.renderLibraryAdmin(root);
    },

    render() {
      const root = document.getElementById("settingsBody");
      if (!root || !window.NavStore) return;
      const cfg = NavStore.get();
      if (!this.selectedCatId || !cfg.categories.some((c) => c.id === this.selectedCatId)) {
        this.selectedCatId = cfg.categories[0]?.id || "";
      }
      const selected = cfg.categories.find((c) => c.id === this.selectedCatId);
      const tab = this.activeTab || "theme";
      const wd = window.NavWebDav?.loadPrefs?.() || {
        baseUrl: "",
        username: "",
        password: "",
        remotePath: "/cl-nav/backup.json",
        autoBackup: false,
        remoteNewerSkipAt: 0,
      };
      const cf = window.NavCfSync?.loadPrefs?.() || {
        token: "",
        autoSync: false,
        remoteNewerSkipAt: 0,
      };

      root.innerHTML = `
        <div class="cfg-tabs" id="cfgTabs">
          <button type="button" data-tab="quick" class="${tab === "quick" ? "active" : ""}">常用网站</button>
          <button type="button" data-tab="cats" class="${tab === "cats" ? "active" : ""}">分类管理</button>
          <button type="button" data-tab="library" class="${tab === "library" ? "active" : ""}">资源库</button>
          <button type="button" data-tab="data" class="${tab === "data" ? "active" : ""}">备份</button>
          <button type="button" data-tab="theme" class="${tab === "theme" ? "active" : ""}">主题</button>
        </div>
        <div class="cfg-pane" data-pane="quick" ${tab !== "quick" ? "hidden" : ""}>
          <div class="cfg-toolbar">
            <strong>常用网站（搜索栏下方）</strong>
            <button type="button" class="cfg-btn primary" id="cfgAddQuick">＋ 添加</button>
          </div>
          <p class="settings-tip" style="margin:0 0 0.45rem">按住左侧 ⠿ 拖动可排序</p>
          <div class="cfg-list" id="cfgQuickList">
            ${
              cfg.quickLinks.length
                ? cfg.quickLinks
                    .map(
                      (l, i) => `
              <div class="cfg-item" data-sortable data-qi="${i}">
                <span class="cfg-drag" title="拖动排序" aria-hidden="true">⠿</span>
                <div class="cfg-item-main">
                  <strong>${esc(l.title)}</strong>
                  <span>${esc(l.desc || l.url)}</span>
                </div>
                <div class="cfg-item-actions">
                  <button type="button" data-q-edit="${i}">编辑</button>
                  <button type="button" data-q-del="${i}">删除</button>
                </div>
              </div>`
                    )
                    .join("")
                : `<p class="settings-tip">暂无常用网站，点击「添加」创建。</p>`
            }
          </div>
        </div>
        <div class="cfg-pane" data-pane="cats" ${tab !== "cats" ? "hidden" : ""}>
          <div class="cfg-split">
            <div class="cfg-col">
              <div class="cfg-toolbar">
                <strong>分类</strong>
                <button type="button" class="cfg-btn primary" id="cfgAddCat">＋ 新建</button>
              </div>
              <div class="cfg-list" id="cfgCatList">
                ${cfg.categories
                  .map(
                    (c) => `
                  <button type="button" class="cfg-cat ${c.id === this.selectedCatId ? "active" : ""}" data-cat="${c.id}">
                    <span>${esc(c.name)}</span>
                    <em>${c.links.length}</em>
                  </button>`
                  )
                  .join("")}
              </div>
            </div>
            <div class="cfg-col">
              <div class="cfg-toolbar">
                <strong>${selected ? esc(selected.name) : "网站列表"}</strong>
                <div class="cfg-item-actions">
                  ${
                    selected
                      ? `
                    <button type="button" id="cfgRenameCat">重命名</button>
                    <button type="button" id="cfgUpCat">上移</button>
                    <button type="button" id="cfgDownCat">下移</button>
                    <button type="button" id="cfgDelCat">删除分类</button>
                    <button type="button" class="cfg-btn primary" id="cfgAddLink">＋ 网站</button>`
                      : ""
                  }
                </div>
              </div>
              <p class="settings-tip" style="margin:0 0 0.45rem">按住左侧 ⠿ 拖动可排序；勾选后可批量删除</p>
              ${
                selected && selected.links.length
                  ? `<div class="cfg-batch-bar">
                      <label class="chk"><input type="checkbox" id="cfgLinkCheckAll" /> 全选</label>
                      <button type="button" class="cfg-btn danger" id="cfgBatchDelLinks" disabled>批量删除</button>
                      <span class="settings-tip" id="cfgBatchHint">已选 0 项</span>
                    </div>`
                  : ""
              }
              <div class="cfg-list" id="cfgLinkList">
                ${
                  selected
                    ? selected.links.length
                      ? selected.links
                          .map(
                            (l, i) => `
                    <div class="cfg-item" data-sortable data-li="${i}">
                      <label class="cfg-check" title="选择">
                        <input type="checkbox" data-l-check="${i}" />
                      </label>
                      <span class="cfg-drag" title="拖动排序" aria-hidden="true">⠿</span>
                      <div class="cfg-item-main">
                        <strong>${esc(l.title)}</strong>
                        <span>${esc(l.desc || l.url)}</span>
                      </div>
                      <div class="cfg-item-actions">
                        <button type="button" data-l-edit="${i}">编辑</button>
                        <button type="button" data-l-del="${i}">删除</button>
                      </div>
                    </div>`
                          )
                          .join("")
                      : `<p class="settings-tip">该分类还没有网站，点击「＋ 网站」添加。</p>`
                    : `<p class="settings-tip">请先选择或新建分类。</p>`
                }
              </div>
            </div>
          </div>
        </div>
        <div class="cfg-pane" data-pane="library" ${tab !== "library" ? "hidden" : ""}>
          <div class="cfg-toolbar">
            <strong>资源库管理</strong>
            <button type="button" class="cfg-btn primary" id="libAdminUpload">＋ 上传资源</button>
            <input id="libAdminFile" type="file" hidden />
          </div>
          <p class="settings-tip" style="margin:0 0 0.5rem">
            访客在「资源库」页只能下载。上传 / 删除请在此操作（需登录）。文件存 Cloudflare R2，目录索引在 KV。
          </p>
          <p class="settings-tip" style="margin:0 0 0.5rem">
            首次使用：Dashboard → R2 → Create bucket，名称填 <code>cl-nav-library</code>（与 wrangler.toml 一致）后重新部署。单文件建议 &lt; 95MB。
          </p>
          <p class="cfg-status" id="libAdminStatus"></p>
          <div class="cfg-list" id="libAdminList"></div>
        </div>
        <div class="cfg-pane" data-pane="data" ${tab !== "data" ? "hidden" : ""}>
          <div class="cfg-webdav">
            <h4>Cloudflare 云端同步（推荐）</h4>
            <label class="cfg-field">
              <span>同步口令（各设备相同，至少 8 位）</span>
              <div class="cfg-webdav-row" style="margin:0">
                <input type="text" id="cfToken" placeholder="点击「生成口令」或自行填写" value="${esc(cf.token)}" autocomplete="off" style="flex:1;min-width:12rem" />
                <button type="button" class="cfg-btn" id="cfGenToken">生成口令</button>
              </div>
            </label>
            <div class="cfg-webdav-row">
              <label class="chk"><input type="checkbox" id="cfAuto" ${cf.autoSync ? "checked" : ""} /> 自动同步</label>
              <button type="button" class="cfg-btn" id="cfSave">保存</button>
              <button type="button" class="cfg-btn" id="cfTest">测试</button>
              <button type="button" class="cfg-btn primary" id="cfSync">立即同步</button>
              <button type="button" class="cfg-btn" id="cfUpload">上传到云端</button>
              <button type="button" class="cfg-btn" id="cfDownload">从云端恢复</button>
            </div>
            <p class="cfg-status ${cf.remoteNewerSkipAt ? "warn" : ""}" id="cfStatus">${
              cf.remoteNewerSkipAt
                ? "云端有更新备份，建议「从云端恢复」或「立即同步」。"
                : "勾选「自动同步」并保存后：添加/修改网站约 0.4 秒会上传云端；其它设备打开或切回页面时自动拉取。"
            }</p>
            <p class="settings-tip">在 Cloudflare Dashboard → Workers &amp; Pages → cl-nav → Settings → Functions → KV namespace bindings，添加绑定，变量名填 <code>CL_NAV_SYNC</code>（先创建任意 KV 命名空间即可）。部署后在此设置相同口令。</p>
          </div>
          <div class="cfg-section-divider"></div>
          <details class="cfg-webdav-details">
            <summary>WebDAV（可选，坚果云在 Cloudflare 上通常不可用）</summary>
            <div class="cfg-webdav" style="margin-top:0.6rem;box-shadow:none;border:0;padding:0">
            <div class="cfg-webdav-grid">
              <label>
                <span>服务器地址</span>
                <input type="url" id="wdBaseUrl" placeholder="https://dav.jianguoyun.com/dav/" value="${esc(wd.baseUrl)}" autocomplete="off" />
              </label>
              <label>
                <span>远程路径</span>
                <input type="text" id="wdPath" placeholder="/cl-nav/backup.json" value="${esc(wd.remotePath)}" autocomplete="off" />
              </label>
              <label>
                <span>用户名</span>
                <input type="text" id="wdUser" placeholder="邮箱" value="${esc(wd.username)}" autocomplete="username" />
              </label>
              <label>
                <span>密码</span>
                <input type="password" id="wdPass" placeholder="坚果云请用应用密码" value="${esc(wd.password)}" autocomplete="current-password" />
              </label>
            </div>
            <div class="cfg-webdav-row">
              <label class="chk"><input type="checkbox" id="wdAuto" ${wd.autoBackup ? "checked" : ""} /> 自动同步</label>
              <label class="chk" title="经本站 /api/webdav 转发"><input type="checkbox" id="wdProxy" ${
                wd.useProxy ? "checked" : ""
              } /> 同源代理</label>
              <button type="button" class="cfg-btn" id="wdSave">保存配置</button>
              <button type="button" class="cfg-btn" id="wdTest">测试连接</button>
              <button type="button" class="cfg-btn primary" id="wdSync">立即同步</button>
              <button type="button" class="cfg-btn" id="wdUpload">备份到网盘</button>
              <button type="button" class="cfg-btn" id="wdDownload">从网盘恢复</button>
            </div>
            <p class="cfg-status ${wd.remoteNewerSkipAt ? "warn" : ""}" id="wdStatus">${
              wd.remoteNewerSkipAt
                ? "网盘有更新备份，建议「从网盘恢复」或「立即同步」。"
                : "国外 WebDAV 可试；坚果云经 Cloudflare 易 520。"
            }</p>
            </div>
          </details>
          <div class="cfg-section-divider"></div>
          <div class="cfg-toolbar">
            <strong>本地 JSON</strong>
          </div>
          <div class="cfg-data-actions">
            <button type="button" class="cfg-btn" id="cfgExport">导出 JSON</button>
            <button type="button" class="cfg-btn" id="cfgImport">导入 JSON</button>
            <button type="button" class="cfg-btn danger" id="cfgReset">恢复默认</button>
          </div>
          <textarea id="cfgJson" class="cfg-json" spellcheck="false" placeholder="导入时粘贴 JSON，或导出后复制保存"></textarea>
          <p class="settings-tip">配置保存在浏览器 localStorage；云端/WebDAV/导出的都是这份 JSON。</p>
        </div>
        <div class="cfg-pane" data-pane="theme" ${tab !== "theme" ? "hidden" : ""}>
          <div class="settings-row">
            <span>外观主题</span>
            <div class="search-actions">
              <button type="button" data-theme-btn="light">☀ 浅色</button>
              <button type="button" data-theme-btn="dark">☾ 深色</button>
            </div>
          </div>
          <div class="settings-row" style="margin-top:0.75rem">
            <span>登录会话</span>
            <button type="button" class="cfg-btn" id="cfgLogout">退出登录</button>
          </div>
          <p class="settings-tip">搜索栏下方是「常用网站」；下方各分类等级相同，均可自由增删与排序。关闭浏览器标签后需重新登录才能进入设置。</p>
        </div>
      `;

      this.bind(root);
      this.renderLibraryAdmin(root);
      if (window.Portal?.bindTheme) Portal.bindTheme();
    },

    async renderLibraryAdmin(root) {
      const listEl = root?.querySelector("#libAdminList");
      if (!listEl) return;

      if (!window.LibraryStorage) {
        listEl.innerHTML = `<p class="settings-tip">未加载资源库模块。</p>`;
        return;
      }

      let items = [];
      try {
        items = await LibraryStorage.list();
      } catch (e) {
        listEl.innerHTML = `<p class="settings-tip">读取失败：${esc(e.message || e)}</p>`;
        return;
      }

      const catName = (id) => {
        const c = (window.LIBRARY_DATA?.categories || []).find((x) => x.id === id);
        return c ? c.name : id || "未分类";
      };

      if (!items.length) {
        listEl.innerHTML = `<p class="settings-tip">暂无资源条目。可点「上传资源」或在 library-data.js 配置。</p>`;
        return;
      }

      listEl.innerHTML = items
        .map(
          (it) => `
          <div class="cfg-item">
            <div class="cfg-item-main">
              <strong>${esc(it.title)}</strong>
              <span>${esc(catName(it.category))} · ${esc(it.version || "—")} · ${
                it.downloadUrl ? "可下载" : "未接下载"
              }</span>
            </div>
            <div class="cfg-item-actions">
              <button type="button" data-lib-del="${esc(it.id)}">删除</button>
            </div>
          </div>`
        )
        .join("");
    },

    bind(root) {
      const setLibStatus = (text, kind = "") => {
        const el = root.querySelector("#libAdminStatus");
        if (!el) return;
        el.textContent = text || "";
        el.className = "cfg-status" + (kind ? " " + kind : "");
      };

      root.querySelector("#cfgLogout")?.addEventListener("click", () => {
        this.logout();
      });

      root.querySelector("#libAdminUpload")?.addEventListener("click", () => {
        root.querySelector("#libAdminFile")?.click();
      });

      root.querySelector("#libAdminFile")?.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file || !window.LibraryStorage) return;
        this.activeTab = "library";
        setLibStatus("正在上传…");
        try {
          await LibraryStorage.upload(file, { title: file.name });
          setLibStatus("上传成功", "ok");
          await this.renderLibraryAdmin(root);
        } catch (err) {
          setLibStatus(err.message || "上传失败（存储后端待接入）", "err");
        }
      });

      root.querySelector("#libAdminList")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-lib-del]");
        if (!btn || !window.LibraryStorage) return;
        if (!confirm("确定删除该资源条目？")) return;
        this.activeTab = "library";
        try {
          await LibraryStorage.remove(btn.dataset.libDel);
          setLibStatus("已删除", "ok");
          await this.renderLibraryAdmin(root);
        } catch (err) {
          setLibStatus(err.message || "删除失败", "err");
        }
      });

      root.querySelectorAll(".cfg-tabs [data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.activeTab = btn.dataset.tab;
          this.setTab(this.activeTab);
        });
      });

      root.querySelector("#cfgAddQuick")?.addEventListener("click", async () => {
        const link = await openLinkDialog({}, "添加常用网站");
        if (!link) return;
        this.activeTab = "quick";
        NavStore.addQuickLink(link);
      });

      root.querySelectorAll("[data-q-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const i = +btn.dataset.qEdit;
          const cur = NavStore.get().quickLinks[i];
          const link = await openLinkDialog(cur, "编辑常用网站");
          if (!link) return;
          this.activeTab = "quick";
          NavStore.updateQuickLink(i, link);
        });
      });

      root.querySelectorAll("[data-q-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!confirm("确定删除该常用网站？")) return;
          this.activeTab = "quick";
          NavStore.removeQuickLink(+btn.dataset.qDel);
        });
      });

      bindDragSort(root.querySelector("#cfgQuickList"), {
        onReorder: (from, to) => {
          this.activeTab = "quick";
          NavStore.reorderQuickLinks(from, to);
        },
      });

      root.querySelector("#cfgAddCat")?.addEventListener("click", () => {
        const name = window.prompt("分类名称", "新分类");
        if (name == null || !name.trim()) return;
        this.activeTab = "cats";
        const cat = NavStore.addCategory(name.trim());
        this.selectedCatId = cat.id;
      });

      root.querySelectorAll("[data-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.selectedCatId = btn.dataset.cat;
          this.activeTab = "cats";
          this.render();
        });
      });

      root.querySelector("#cfgRenameCat")?.addEventListener("click", () => {
        const cat = NavStore.get().categories.find((c) => c.id === this.selectedCatId);
        if (!cat) return;
        const name = window.prompt("分类名称", cat.name);
        if (name == null || !name.trim()) return;
        this.activeTab = "cats";
        NavStore.updateCategory(cat.id, { name: name.trim() });
      });

      root.querySelector("#cfgUpCat")?.addEventListener("click", () => {
        this.activeTab = "cats";
        NavStore.moveCategory(this.selectedCatId, -1);
      });

      root.querySelector("#cfgDownCat")?.addEventListener("click", () => {
        this.activeTab = "cats";
        NavStore.moveCategory(this.selectedCatId, 1);
      });

      root.querySelector("#cfgDelCat")?.addEventListener("click", () => {
        const cat = NavStore.get().categories.find((c) => c.id === this.selectedCatId);
        if (!cat) return;
        if (!confirm(`确定删除分类「${cat.name}」及其全部网站？`)) return;
        this.activeTab = "cats";
        NavStore.removeCategory(cat.id);
        this.selectedCatId = "";
      });

      root.querySelector("#cfgAddLink")?.addEventListener("click", async () => {
        if (!this.selectedCatId) return;
        const link = await openLinkDialog({}, "添加网站");
        if (!link) return;
        this.activeTab = "cats";
        NavStore.addLink(this.selectedCatId, link);
      });

      root.querySelectorAll("[data-l-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const i = +btn.dataset.lEdit;
          const cat = NavStore.get().categories.find((c) => c.id === this.selectedCatId);
          if (!cat) return;
          const link = await openLinkDialog(cat.links[i], "编辑网站");
          if (!link) return;
          this.activeTab = "cats";
          NavStore.updateLink(this.selectedCatId, i, link);
        });
      });

      root.querySelectorAll("[data-l-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!confirm("确定删除该网站？")) return;
          this.activeTab = "cats";
          NavStore.removeLink(this.selectedCatId, +btn.dataset.lDel);
        });
      });

      const syncBatchUi = () => {
        const boxes = [...root.querySelectorAll("[data-l-check]")];
        const checked = boxes.filter((b) => b.checked);
        const all = root.querySelector("#cfgLinkCheckAll");
        const delBtn = root.querySelector("#cfgBatchDelLinks");
        const hint = root.querySelector("#cfgBatchHint");
        if (all) {
          all.checked = boxes.length > 0 && checked.length === boxes.length;
          all.indeterminate = checked.length > 0 && checked.length < boxes.length;
        }
        if (delBtn) delBtn.disabled = checked.length === 0;
        if (hint) hint.textContent = `已选 ${checked.length} 项`;
      };

      root.querySelectorAll("[data-l-check]").forEach((box) => {
        box.addEventListener("click", (e) => e.stopPropagation());
        box.addEventListener("change", syncBatchUi);
      });

      root.querySelector("#cfgLinkCheckAll")?.addEventListener("change", (e) => {
        const on = !!e.target.checked;
        root.querySelectorAll("[data-l-check]").forEach((box) => {
          box.checked = on;
        });
        syncBatchUi();
      });

      root.querySelector("#cfgBatchDelLinks")?.addEventListener("click", () => {
        const indices = [...root.querySelectorAll("[data-l-check]:checked")].map((b) => +b.dataset.lCheck);
        if (!indices.length) return;
        if (!confirm(`确定删除选中的 ${indices.length} 个网站？`)) return;
        this.activeTab = "cats";
        NavStore.removeLinks(this.selectedCatId, indices);
      });

      bindDragSort(root.querySelector("#cfgLinkList"), {
        onReorder: (from, to) => {
          this.activeTab = "cats";
          NavStore.reorderLinks(this.selectedCatId, from, to);
        },
      });

      root.querySelector("#cfgExport")?.addEventListener("click", () => {
        const ta = root.querySelector("#cfgJson");
        ta.value = NavStore.exportBackup({ ensureDefaults: false });
        ta.select();
        try {
          navigator.clipboard?.writeText(ta.value);
        } catch (_) {}
        alert("已导出到文本框" + (navigator.clipboard ? "（并尝试复制到剪贴板）" : ""));
      });

      root.querySelector("#cfgImport")?.addEventListener("click", () => {
        const ta = root.querySelector("#cfgJson");
        if (!ta.value.trim()) {
          alert("请先粘贴 JSON");
          return;
        }
        if (!confirm("导入将用该 JSON 整份覆盖当前配置，是否继续？")) return;
        try {
          this.activeTab = "data";
          NavStore.importJson(ta.value);
          alert("导入成功");
        } catch (err) {
          alert("导入失败：" + err.message);
        }
      });

      root.querySelector("#cfgReset")?.addEventListener("click", () => {
        if (!confirm("确定恢复默认配置？当前自定义内容将丢失。")) return;
        this.activeTab = "data";
        NavStore.reset();
        this.selectedCatId = "";
      });

      const setCfStatus = (text, kind = "") => {
        const el = root.querySelector("#cfStatus");
        if (!el) return;
        el.textContent = text;
        el.className = "cfg-status" + (kind ? " " + kind : "");
      };

      root.querySelector("#cfGenToken")?.addEventListener("click", () => {
        if (!window.NavCfSync) return;
        const input = root.querySelector("#cfToken");
        if (!input) return;
        if (input.value.trim() && !confirm("将覆盖当前口令；其它设备需改成新口令才能同步。继续？")) return;
        input.value = NavCfSync.generateToken();
        setCfStatus("已生成新口令，请点「保存」并抄到其它设备", "ok");
      });

      root.querySelector("#cfSave")?.addEventListener("click", () => {
        if (!window.NavCfSync) return;
        this.activeTab = "data";
        const token = root.querySelector("#cfToken")?.value || "";
        const autoSync = !!root.querySelector("#cfAuto")?.checked;
        NavCfSync.savePrefs({ token, autoSync });
        setCfStatus("同步配置已保存", "ok");
        if (autoSync && NavCfSync.isReady()) {
          NavCfSync.sync("FULL")
            .then((r) => setCfStatus(r.message || "同步完成", "ok"))
            .catch((e) => setCfStatus(e.message || "同步失败", "err"));
        }
      });

      root.querySelector("#cfAuto")?.addEventListener("change", () => {
        if (!window.NavCfSync) return;
        NavCfSync.savePrefs({
          token: root.querySelector("#cfToken")?.value || "",
          autoSync: !!root.querySelector("#cfAuto").checked,
        });
      });

      root.querySelector("#cfTest")?.addEventListener("click", async () => {
        if (!window.NavCfSync) return;
        this.activeTab = "data";
        NavCfSync.savePrefs({
          token: root.querySelector("#cfToken")?.value || "",
          autoSync: !!root.querySelector("#cfAuto")?.checked,
        });
        setCfStatus("正在测试…");
        const msg = await NavCfSync.testConnection(NavCfSync.loadPrefs());
        setCfStatus(msg, /成功/.test(msg) ? "ok" : "err");
      });

      root.querySelector("#cfSync")?.addEventListener("click", async () => {
        if (!window.NavCfSync) return;
        this.activeTab = "data";
        NavCfSync.savePrefs({
          token: root.querySelector("#cfToken")?.value || "",
          autoSync: !!root.querySelector("#cfAuto")?.checked,
        });
        setCfStatus("正在同步…");
        try {
          const r = await NavCfSync.sync("FULL");
          setCfStatus(r.message || "同步完成", "ok");
        } catch (e) {
          setCfStatus(e.message || "同步失败", "err");
        }
      });

      root.querySelector("#cfUpload")?.addEventListener("click", async () => {
        if (!window.NavCfSync) return;
        this.activeTab = "data";
        NavCfSync.savePrefs({
          token: root.querySelector("#cfToken")?.value || "",
          autoSync: !!root.querySelector("#cfAuto")?.checked,
        });
        setCfStatus("正在上传…");
        try {
          const r = await NavCfSync.backupNow();
          setCfStatus(r.message || "上传完成", "ok");
        } catch (e) {
          setCfStatus(e.message || "上传失败", "err");
        }
      });

      root.querySelector("#cfDownload")?.addEventListener("click", async () => {
        if (!window.NavCfSync) return;
        this.activeTab = "data";
        NavCfSync.savePrefs({
          token: root.querySelector("#cfToken")?.value || "",
          autoSync: !!root.querySelector("#cfAuto")?.checked,
        });
        setCfStatus("正在恢复…");
        try {
          const r = await NavCfSync.restoreNow();
          setCfStatus(r.message || "恢复完成", "ok");
        } catch (e) {
          setCfStatus(e.message || "恢复失败", "err");
        }
      });

      const setWdStatus = (text, kind = "") => {
        const el = root.querySelector("#wdStatus");
        if (!el) return;
        el.textContent = text;
        el.className = "cfg-status" + (kind ? " " + kind : "");
      };

      const readWdForm = () => ({
        baseUrl: root.querySelector("#wdBaseUrl")?.value || "",
        username: root.querySelector("#wdUser")?.value || "",
        password: root.querySelector("#wdPass")?.value || "",
        remotePath: root.querySelector("#wdPath")?.value || "/cl-nav/backup.json",
        autoBackup: !!root.querySelector("#wdAuto")?.checked,
        useProxy: !!root.querySelector("#wdProxy")?.checked,
        proxyPath: "/api/webdav",
      });

      root.querySelector("#wdSave")?.addEventListener("click", () => {
        if (!window.NavWebDav) return;
        this.activeTab = "data";
        const form = readWdForm();
        NavWebDav.savePrefs(form);
        setWdStatus("WebDAV 配置已保存", "ok");
        if (form.autoBackup && NavWebDav.isReady(form)) {
          NavWebDav.sync("FULL")
            .then((r) => setWdStatus(r.message || "同步完成", "ok"))
            .catch((e) => setWdStatus(e.message || "同步失败", "err"));
        }
      });

      root.querySelector("#wdAuto")?.addEventListener("change", () => {
        if (!window.NavWebDav) return;
        NavWebDav.savePrefs({ autoBackup: !!root.querySelector("#wdAuto").checked });
      });

      root.querySelector("#wdProxy")?.addEventListener("change", () => {
        if (!window.NavWebDav) return;
        NavWebDav.savePrefs({
          useProxy: !!root.querySelector("#wdProxy").checked,
          proxyPath: "/api/webdav",
        });
      });

      root.querySelector("#wdTest")?.addEventListener("click", async () => {
        if (!window.NavWebDav) return;
        this.activeTab = "data";
        setWdStatus("正在测试连接…");
        const msg = await NavWebDav.testConnection(readWdForm());
        setWdStatus(msg, /成功/.test(msg) ? "ok" : "err");
      });

      root.querySelector("#wdSync")?.addEventListener("click", async () => {
        if (!window.NavWebDav) return;
        this.activeTab = "data";
        NavWebDav.savePrefs(readWdForm());
        setWdStatus("正在同步…");
        try {
          const r = await NavWebDav.sync("FULL");
          setWdStatus(r.message || "同步完成", "ok");
        } catch (e) {
          setWdStatus(e.message || "同步失败", "err");
        }
      });

      root.querySelector("#wdUpload")?.addEventListener("click", async () => {
        if (!window.NavWebDav) return;
        this.activeTab = "data";
        NavWebDav.savePrefs(readWdForm());
        setWdStatus("正在备份到网盘…");
        try {
          const r = await NavWebDav.backupNow();
          setWdStatus(r.message || "备份完成", "ok");
        } catch (e) {
          setWdStatus(e.message || "备份失败", "err");
        }
      });

      root.querySelector("#wdDownload")?.addEventListener("click", async () => {
        if (!window.NavWebDav) return;
        this.activeTab = "data";
        NavWebDav.savePrefs(readWdForm());
        setWdStatus("正在从网盘恢复…");
        try {
          const r = await NavWebDav.restoreNow();
          setWdStatus(r.message || "恢复完成", "ok");
        } catch (e) {
          setWdStatus(e.message || "恢复失败", "err");
        }
      });
    },
  };
})();
