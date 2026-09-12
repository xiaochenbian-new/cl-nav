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
      const panel = document.getElementById("settingsPanel");
      if (!panel) return;
      panel.hidden = false;
      this.render();
    },

    close() {
      const panel = document.getElementById("settingsPanel");
      if (panel) panel.hidden = true;
      document.getElementById("cfgLinkDialog")?.remove();
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

      root.innerHTML = `
        <div class="cfg-tabs" id="cfgTabs">
          <button type="button" data-tab="quick" class="${tab === "quick" ? "active" : ""}">常用网站</button>
          <button type="button" data-tab="cats" class="${tab === "cats" ? "active" : ""}">分类管理</button>
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
        <div class="cfg-pane" data-pane="data" ${tab !== "data" ? "hidden" : ""}>
          <div class="cfg-webdav">
            <h4>WebDAV 多端同步</h4>
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
              <label class="chk" title="经本站 /api/webdav 转发以绕过 CORS；坚果云在 Cloudflare 上通常仍不可达"><input type="checkbox" id="wdProxy" ${
                wd.useProxy ? "checked" : ""
              } /> 同源代理（Cloudflare）</label>
              <button type="button" class="cfg-btn" id="wdSave">保存配置</button>
              <button type="button" class="cfg-btn" id="wdTest">测试连接</button>
              <button type="button" class="cfg-btn primary" id="wdSync">立即同步</button>
              <button type="button" class="cfg-btn" id="wdUpload">备份到网盘</button>
              <button type="button" class="cfg-btn" id="wdDownload">从网盘恢复</button>
            </div>
            <p class="cfg-status ${wd.remoteNewerSkipAt ? "warn" : ""}" id="wdStatus">${
              wd.remoteNewerSkipAt
                ? "网盘有更新备份，建议「从网盘恢复」或「立即同步」。"
                : "同步上传/下载的是当前本地 JSON；删除的分类与网站会随 JSON 一起生效。"
            }</p>
            <p class="settings-tip">浏览器无法直连坚果云（无 CORS）。Cloudflare 同源代理能转发请求，但其海外节点通常访问不了坚果云（易出现 HTTP 520），此时请用下方「本地 JSON」导入/导出。若使用国外 WebDAV，可勾选「同源代理」。</p>
          </div>
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
          <p class="settings-tip">配置保存在浏览器 localStorage；导出/WebDAV 同步的就是这份 JSON。只有点「恢复默认」才会重新载入内置站点。</p>
        </div>
        <div class="cfg-pane" data-pane="theme" ${tab !== "theme" ? "hidden" : ""}>
          <div class="settings-row">
            <span>外观主题</span>
            <div class="search-actions">
              <button type="button" data-theme-btn="light">☀ 浅色</button>
              <button type="button" data-theme-btn="dark">☾ 深色</button>
            </div>
          </div>
          <p class="settings-tip">搜索栏下方是「常用网站」；下方各分类等级相同，均可自由增删与排序。</p>
        </div>
      `;

      this.bind(root);
      if (window.Portal?.bindTheme) Portal.bindTheme();
    },

    bind(root) {
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
