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

  /** Horizontal drag-reorder for library category chips */
  function bindCatChipDrag(listEl, { onReorder }) {
    if (!listEl || listEl.dataset.dragBound === "1") return;
    listEl.dataset.dragBound = "1";
    let dragEl = null;

    listEl.addEventListener("mousedown", (e) => {
      const handle = e.target.closest("[data-cat-drag]");
      const chip = e.target.closest(".cfg-lib-cat-chip[data-cat-id]");
      if (!handle || !chip || !listEl.contains(chip)) return;
      chip.setAttribute("draggable", "true");
    });

    listEl.addEventListener("mouseup", () => {
      listEl.querySelectorAll(".cfg-lib-cat-chip[draggable='true']").forEach((el) => {
        if (!dragEl) el.setAttribute("draggable", "false");
      });
    });

    listEl.addEventListener("dragstart", (e) => {
      const chip = e.target.closest(".cfg-lib-cat-chip[data-cat-id]");
      if (!chip || !listEl.contains(chip) || chip.getAttribute("draggable") !== "true") {
        e.preventDefault();
        return;
      }
      dragEl = chip;
      chip.classList.add("dragging");
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", chip.dataset.catId || "cat");
      } catch (_) {}
    });

    listEl.addEventListener("dragend", () => {
      if (dragEl) {
        dragEl.classList.remove("dragging");
        dragEl.setAttribute("draggable", "false");
      }
      listEl.querySelectorAll(".cfg-lib-cat-chip").forEach((el) => {
        el.classList.remove("drag-over", "drag-before", "drag-after");
        el.setAttribute("draggable", "false");
      });
      dragEl = null;
    });

    listEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      const chip = e.target.closest(".cfg-lib-cat-chip[data-cat-id]");
      if (!dragEl || !chip || chip === dragEl || !listEl.contains(chip)) return;
      const rect = chip.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      listEl.querySelectorAll(".cfg-lib-cat-chip").forEach((el) => {
        el.classList.remove("drag-over", "drag-before", "drag-after");
      });
      chip.classList.add("drag-over", before ? "drag-before" : "drag-after");
      chip.dataset.dropBefore = before ? "1" : "0";
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (_) {}
    });

    listEl.addEventListener("drop", (e) => {
      e.preventDefault();
      const chip = e.target.closest(".cfg-lib-cat-chip[data-cat-id]");
      listEl.querySelectorAll(".cfg-lib-cat-chip").forEach((el) => {
        el.classList.remove("drag-over", "drag-before", "drag-after");
      });
      if (!dragEl || !chip || dragEl === chip) return;
      const items = [...listEl.querySelectorAll(".cfg-lib-cat-chip[data-cat-id]")];
      const from = items.indexOf(dragEl);
      let to = items.indexOf(chip);
      if (from < 0 || to < 0) return;
      const before = chip.dataset.dropBefore === "1";
      if (from < to && before) to -= 1;
      if (from > to && !before) to += 1;
      if (from === to) return;
      onReorder(from, to);
    });
  }

  /** Drafts kept when dialogs are dismissed by overlay / Escape (not Cancel / success). */
  const dialogDrafts = {
    linkAdd: null,
    libResource: null,
  };

  function readLinkDialogValues(overlay) {
    return {
      title: String(overlay.querySelector("#cfgDlgTitle")?.value || "").trim(),
      url: String(overlay.querySelector("#cfgDlgUrl")?.value || "").trim(),
      desc: String(overlay.querySelector("#cfgDlgDesc")?.value || "").trim(),
    };
  }

  function isLinkDraftEmpty(d) {
    return !d || !(d.title || d.url || d.desc);
  }

  function openLinkDialog(initial = {}, titleText = "添加网站") {
    return new Promise((resolve) => {
      const old = document.getElementById("cfgLinkDialog");
      if (old) old.remove();

      const isAdd = !initial || (!initial.url && !initial.title);
      const seed =
        isAdd && dialogDrafts.linkAdd && !isLinkDraftEmpty(dialogDrafts.linkAdd)
          ? { ...dialogDrafts.linkAdd }
          : initial || {};

      const overlay = document.createElement("div");
      overlay.id = "cfgLinkDialog";
      overlay.className = "cfg-dialog-overlay";
      overlay.innerHTML = `
        <div class="cfg-dialog" role="dialog" aria-modal="true" aria-labelledby="cfgDialogTitle">
          <h3 id="cfgDialogTitle">${esc(titleText)}</h3>
          <label class="cfg-field">
            <span>名称</span>
            <input type="text" id="cfgDlgTitle" placeholder="如 GitHub" value="${esc(seed.title || "")}" autocomplete="off" />
          </label>
          <label class="cfg-field">
            <span>网站地址</span>
            <input type="url" id="cfgDlgUrl" placeholder="https://example.com" value="${esc(seed.url || "")}" autocomplete="off" />
          </label>
          <label class="cfg-field">
            <span>备注</span>
            <input type="text" id="cfgDlgDesc" placeholder="一句话说明（可选）" value="${esc(seed.desc || "")}" autocomplete="off" />
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

      const close = (result, { keepDraft = false, clearDraft = false } = {}) => {
        if (isAdd) {
          if (clearDraft) dialogDrafts.linkAdd = null;
          else if (keepDraft) {
            const vals = readLinkDialogValues(overlay);
            dialogDrafts.linkAdd = isLinkDraftEmpty(vals) ? null : vals;
          }
        }
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
        close(NavStore.normalizeLink({ title, url, desc }), { clearDraft: true });
      };

      const onKey = (e) => {
        if (e.key === "Escape") close(null, { keepDraft: true });
        if (e.key === "Enter" && e.target.tagName === "INPUT") {
          e.preventDefault();
          submit();
        }
      };
      document.addEventListener("keydown", onKey);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null, { keepDraft: true });
      });
      overlay.querySelector("#cfgDlgCancel").addEventListener("click", () =>
        close(null, { clearDraft: true })
      );
      overlay.querySelector("#cfgDlgOk").addEventListener("click", submit);

      titleInput.focus();
      if (!seed.title && !seed.url) titleInput.select();
    });
  }

  function channelOptionsHtml(selected) {
    const channels = window.LibraryStorage?.channels || [
      { id: "direct", name: "直链" },
      { id: "github", name: "GitHub" },
      { id: "lanzou", name: "蓝奏云" },
      { id: "baidu", name: "百度网盘" },
      { id: "quark", name: "夸克网盘" },
      { id: "aliyun", name: "阿里云盘" },
      { id: "other", name: "其他" },
    ];
    return channels
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === (selected || "direct") ? "selected" : ""}>${esc(c.name)}</option>`
      )
      .join("");
  }

  function categoryOptionsHtml(selected) {
    const cats = window.LibraryStorage?.normalizeCategories?.(window.LIBRARY_DATA?.categories) || [
      { id: "other", name: "其他" },
    ];
    const cur = selected || "other";
    return cats
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === cur ? "selected" : ""}>${esc(c.name)}</option>`
      )
      .join("");
  }

  function linkRowHtml(link = {}) {
    return `
      <div class="cfg-lib-link-row" data-link-row>
        <select data-link-channel aria-label="渠道">${channelOptionsHtml(link.channel || "direct")}</select>
        <input type="text" data-link-url placeholder="https://…" value="${esc(link.url || "")}" spellcheck="false" />
        <input type="text" data-link-label placeholder="备注" value="${esc(link.label || "")}" />
        <button type="button" class="cfg-btn cfg-lib-x" data-link-remove title="移除">×</button>
      </div>`;
  }

  function openLibResourceDialog() {
    return new Promise((resolve) => {
      document.getElementById("cfgLibResourceDialog")?.remove();
      const draft = dialogDrafts.libResource;
      const seed = draft || { title: "", category: "other", desc: "", links: [{ channel: "direct", url: "", label: "" }] };
      const linkRows = (Array.isArray(seed.links) && seed.links.length ? seed.links : [{ channel: "direct", url: "", label: "" }])
        .map((l) => linkRowHtml(l))
        .join("");

      const overlay = document.createElement("div");
      overlay.id = "cfgLibResourceDialog";
      overlay.className = "cfg-dialog-overlay";
      overlay.innerHTML = `
        <div class="cfg-dialog cfg-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="cfgLibDlgTitle">
          <h3 id="cfgLibDlgTitle">添加外链资源</h3>
          <div class="cfg-lib-form">
            <label><span>名称</span><input type="text" id="cfgLibDlgName" placeholder="例如 JDK 安装包" value="${esc(
              seed.title || ""
            )}" autocomplete="off" /></label>
            <label><span>分类</span><select id="cfgLibDlgCat">${categoryOptionsHtml(seed.category || "other")}</select></label>
            <label class="cfg-lib-span2"><span>说明</span><textarea id="cfgLibDlgDesc" rows="2" placeholder="可选，展示在资源库页面">${esc(
              seed.desc || ""
            )}</textarea></label>
          </div>
          <div class="cfg-lib-links cfg-lib-dlg-links">
            <div class="cfg-lib-links-head">
              <strong>下载渠道</strong>
              <button type="button" class="cfg-btn" id="cfgLibDlgAddLink">＋ 添加</button>
            </div>
            <div class="cfg-lib-link-list" id="cfgLibDlgLinkList">${linkRows}</div>
          </div>
          <p class="cfg-dialog-err" id="cfgLibDlgErr" hidden></p>
          <div class="cfg-dialog-actions">
            <button type="button" class="cfg-btn" id="cfgLibDlgCancel">取消</button>
            <button type="button" class="cfg-btn primary" id="cfgLibDlgOk">添加</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const list = overlay.querySelector("#cfgLibDlgLinkList");
      const errEl = overlay.querySelector("#cfgLibDlgErr");
      const nameInput = overlay.querySelector("#cfgLibDlgName");

      const readLinks = () =>
        [...list.querySelectorAll("[data-link-row]")].map((row) => ({
          channel: row.querySelector("[data-link-channel]")?.value || "other",
          url: String(row.querySelector("[data-link-url]")?.value || "").trim(),
          label: String(row.querySelector("[data-link-label]")?.value || "").trim(),
        }));

      const readDraft = () => ({
        title: String(nameInput.value || "").trim(),
        category: overlay.querySelector("#cfgLibDlgCat")?.value || "other",
        desc: String(overlay.querySelector("#cfgLibDlgDesc")?.value || "").trim(),
        links: readLinks(),
      });

      const isDraftEmpty = (d) => {
        if (!d) return true;
        const hasLink = (d.links || []).some((l) => l.url || l.label);
        return !(d.title || d.desc || hasLink);
      };

      const close = (result, { keepDraft = false, clearDraft = false } = {}) => {
        if (clearDraft) dialogDrafts.libResource = null;
        else if (keepDraft) {
          const vals = readDraft();
          dialogDrafts.libResource = isDraftEmpty(vals) ? null : vals;
        }
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };

      const submit = () => {
        const title = String(nameInput.value || "").trim();
        const category = overlay.querySelector("#cfgLibDlgCat")?.value || "other";
        const desc = String(overlay.querySelector("#cfgLibDlgDesc")?.value || "").trim();
        const links = readLinks().filter((l) => /^https?:\/\//i.test(l.url));
        if (!links.length) {
          errEl.hidden = false;
          errEl.textContent = "请至少填写一个以 http(s):// 开头的下载地址";
          return;
        }
        close(
          {
            title: title || "未命名资源",
            category,
            desc,
            links,
            downloadUrl: links[0].url,
            channel: links[0].channel,
          },
          { clearDraft: true }
        );
      };

      const onKey = (e) => {
        if (e.key === "Escape") close(null, { keepDraft: true });
      };
      document.addEventListener("keydown", onKey);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null, { keepDraft: true });
      });
      overlay.querySelector("#cfgLibDlgCancel").addEventListener("click", () =>
        close(null, { clearDraft: true })
      );
      overlay.querySelector("#cfgLibDlgOk").addEventListener("click", submit);
      overlay.querySelector("#cfgLibDlgAddLink").addEventListener("click", () => {
        list.insertAdjacentHTML("beforeend", linkRowHtml());
      });
      list.addEventListener("click", (e) => {
        if (!e.target.closest("[data-link-remove]")) return;
        const row = e.target.closest("[data-link-row]");
        if (!row) return;
        if (list.querySelectorAll("[data-link-row]").length <= 1) {
          row.querySelector("[data-link-url]").value = "";
          row.querySelector("[data-link-label]").value = "";
        } else {
          row.remove();
        }
      });

      nameInput.focus();
    });
  }

  window.NavConfigUI = {
    selectedCatId: "",
    activeTab: "quick",
    libEditingId: "",
    libFilterCategory: "all",

    open(opts) {
      if (opts && opts.tab) this.activeTab = opts.tab;
      const go = () => {
        const panel = document.getElementById("settingsPanel");
        if (!panel) return;
        panel.hidden = false;
        const root = document.getElementById("settingsBody");
        const hasUi = !!(root && root.querySelector(".cfg-tabs"));
        // 再次打开时保留未保存的输入，避免整页重绘清空
        if (!hasUi || opts?.force) this.render();
        else this.setTab(this.activeTab);
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
      // 点遮罩关闭设置时，若子弹窗仍开着也一并收起并保留草稿
      const linkDlg = document.getElementById("cfgLinkDialog");
      if (linkDlg) {
        const vals = readLinkDialogValues(linkDlg);
        if (!isLinkDraftEmpty(vals)) dialogDrafts.linkAdd = vals;
        linkDlg.remove();
      }
      const libDlg = document.getElementById("cfgLibResourceDialog");
      if (libDlg) {
        const name = String(libDlg.querySelector("#cfgLibDlgName")?.value || "").trim();
        const category = libDlg.querySelector("#cfgLibDlgCat")?.value || "other";
        const desc = String(libDlg.querySelector("#cfgLibDlgDesc")?.value || "").trim();
        const links = [...libDlg.querySelectorAll("[data-link-row]")].map((row) => ({
          channel: row.querySelector("[data-link-channel]")?.value || "other",
          url: String(row.querySelector("[data-link-url]")?.value || "").trim(),
          label: String(row.querySelector("[data-link-label]")?.value || "").trim(),
        }));
        if (name || desc || links.some((l) => l.url || l.label)) {
          dialogDrafts.libResource = { title: name, category, desc, links };
        }
        libDlg.remove();
      }
    },

    logout() {
      if (window.NavAuth?.logout) NavAuth.logout();
      this.close();
      dialogDrafts.linkAdd = null;
      dialogDrafts.libResource = null;
      const root = document.getElementById("settingsBody");
      if (root) root.innerHTML = "";
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
          <div class="cfg-toolbar cfg-lib-toolbar">
            <div>
              <strong>资源库</strong>
              <p class="settings-tip" style="margin:0.2rem 0 0">上传到 GitHub Releases，或添加多渠道外链</p>
            </div>
            <div class="cfg-item-actions">
              <button type="button" class="cfg-btn" id="libAddLinkBtn">外链</button>
              <button type="button" class="cfg-btn primary" id="ghUploadBtn">上传到 Release</button>
              <input id="ghFileInput" type="file" multiple hidden />
            </div>
          </div>
          <p class="cfg-status" id="libAdminStatus"></p>

          <details class="cfg-lib-config" id="libConfigPanel">
            <summary>配置管理</summary>
            <div class="cfg-lib-config-body">
              <section class="cfg-lib-section">
                <header class="cfg-lib-section-h">
                  <strong>GitHub Releases</strong>
                  <span>Token 仅保存在本机</span>
                </header>
                <div class="cfg-lib-form">
                  <label><span>Owner</span><input type="text" id="ghOwner" placeholder="xiaochenbian-new" value="${esc(
                    (window.LibraryStorage?.loadGhPrefs?.() || {}).owner || "xiaochenbian-new"
                  )}" autocomplete="off" spellcheck="false" /></label>
                  <label><span>Repo</span><input type="text" id="ghRepo" placeholder="cl-nav-file" value="${esc(
                    (window.LibraryStorage?.loadGhPrefs?.() || {}).repo || "cl-nav-file"
                  )}" autocomplete="off" spellcheck="false" /></label>
                  <label class="cfg-lib-span2"><span>Token</span><input type="password" id="ghToken" placeholder="ghp_… 勾选 repo" value="${esc(
                    (window.LibraryStorage?.loadGhPrefs?.() || {}).token || ""
                  )}" autocomplete="off" /></label>
                </div>
                <div class="cfg-lib-actions">
                  <button type="button" class="cfg-btn" id="ghSavePrefs">保存</button>
                  <button type="button" class="cfg-btn" id="ghTestBtn">测试连接</button>
                  <span class="settings-tip">xiaochenbian-new / cl-nav-file · 单文件 &lt;95MB · 最多同时 3 个 · 更大请用外链</span>
                </div>
              </section>
            </div>
          </details>

          <section class="cfg-lib-cats-panel">
            <div class="cfg-lib-cats-line">
              <strong class="cfg-lib-cats-label">资源分类：</strong>
              <div class="cfg-lib-cats" id="libCatChips"></div>
              <button type="button" class="cfg-lib-cat-plus" id="libCatAddToggle" title="添加分类">+</button>
              <span class="cfg-lib-cat-composer" id="libCatComposer" hidden>
                <input type="text" id="libCatNewName" placeholder="新分类名称" maxlength="40" autocomplete="off" />
                <button type="button" class="cfg-btn" id="libCatAdd">添加</button>
              </span>
            </div>
          </section>

          <details class="cfg-lib-config cfg-lib-side-links-admin" id="libSideLinksAdminPanel">
            <summary>侧栏网盘入口</summary>
            <div class="cfg-lib-config-body">
              <section class="cfg-lib-section">
                <header class="cfg-lib-section-h">
                  <strong>侧栏网盘入口</strong>
                  <span>显示在资源库左侧分类下方</span>
                </header>
                <div class="cfg-lib-side-link-list" id="libSideLinkAdmin"></div>
                <div class="cfg-lib-actions">
                  <button type="button" class="cfg-btn" id="libSideLinkAdd">＋ 添加入口</button>
                  <button type="button" class="cfg-btn primary" id="libSideLinkSave">保存入口</button>
                </div>
              </section>
            </div>
          </details>
          <div class="cfg-lib-upload-dock" id="libUploadDock" hidden></div>

          <div class="cfg-lib-list-head">
            <strong>已上传资源</strong>
            <div class="cfg-batch-bar cfg-lib-batch" id="libBatchBar" hidden>
              <label class="chk"><input type="checkbox" id="libCheckAll" /> 全选</label>
              <button type="button" class="cfg-btn danger" id="libBatchDel" disabled>批量删除</button>
              <span class="settings-tip" id="libBatchHint">已选 0 项</span>
            </div>
          </div>
          <div class="cfg-lib-filter" id="libAdminFilter" role="tablist" aria-label="按分类筛选"></div>
          <div class="cfg-lib-list" id="libAdminList"></div>
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
            <p class="settings-tip">在 Cloudflare Dashboard → Workers &amp; Pages → cl-nav → Settings → Functions → KV namespace bindings，添加绑定，变量名填 <code>CL_NAV_SYNC</code>。GitHub Pages 会自动走 <code>cl-nav.pages.dev</code> 的同步接口，两站填相同口令即可互通。</p>
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
      const batchBar = root?.querySelector("#libBatchBar");
      const filterEl = root?.querySelector("#libAdminFilter");
      if (!listEl) return;

      if (!window.LibraryStorage) {
        listEl.innerHTML = `<p class="settings-tip">未加载资源库模块。</p>`;
        if (batchBar) batchBar.hidden = true;
        if (filterEl) filterEl.innerHTML = "";
        return;
      }

      let items = [];
      try {
        items = await LibraryStorage.list();
      } catch (e) {
        listEl.innerHTML = `<p class="settings-tip">读取失败：${esc(e.message || e)}</p>`;
        if (batchBar) batchBar.hidden = true;
        if (filterEl) filterEl.innerHTML = "";
        return;
      }

      this.renderLibCategoryUi(root);

      const editableCats = LibraryStorage.normalizeCategories?.(LIBRARY_DATA.categories) || [];
      const catIds = new Set(editableCats.map((c) => c.id));
      if (this.libFilterCategory !== "all" && !catIds.has(this.libFilterCategory)) {
        this.libFilterCategory = "all";
      }

      if (filterEl) {
        const tabs = [{ id: "all", name: "全部" }, ...editableCats];
        filterEl.innerHTML = tabs
          .map((c) => {
            const count =
              c.id === "all" ? items.length : items.filter((i) => i.category === c.id).length;
            const active = c.id === this.libFilterCategory ? " is-active" : "";
            return `<button type="button" class="cfg-lib-filter-btn${active}" data-lib-filter="${esc(
              c.id
            )}" role="tab" aria-selected="${c.id === this.libFilterCategory ? "true" : "false"}">
              <span>${esc(c.name)}</span><em>${count}</em>
            </button>`;
          })
          .join("");
      }

      const filtered =
        this.libFilterCategory === "all"
          ? items
          : items.filter((it) => it.category === this.libFilterCategory);

      const catName = (id) => {
        const c = editableCats.find((x) => x.id === id) || (LibraryStorage.uiCategories?.() || []).find((x) => x.id === id);
        return c ? c.name : id || "未分类";
      };
      const channels = LibraryStorage.channels || [];
      const channelOpts = (selected) =>
        channels
          .map(
            (c) =>
              `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`
          )
          .join("");

      if (batchBar) batchBar.hidden = !filtered.length;

      if (!items.length) {
        listEl.innerHTML = `<p class="settings-tip cfg-lib-empty">还没有资源。可先展开「配置管理」测试连接，再点「上传到 Release」。</p>`;
        return;
      }

      if (!filtered.length) {
        listEl.innerHTML = `<p class="settings-tip cfg-lib-empty">该分类下暂无资源。</p>`;
        this.syncLibBatchUi(root);
        return;
      }

      listEl.innerHTML = filtered
        .map((it) => {
          const open = this.libEditingId === it.id;
          const links = LibraryStorage.itemLinks(it);
          const pills = [
            `<em class="cfg-lib-pill">${esc(catName(it.category))}</em>`,
            it.size ? `<em class="cfg-lib-pill muted">${esc(it.size)}</em>` : "",
            ...links.map(
              (l) =>
                `<em class="cfg-lib-pill channel">${esc(
                  LibraryStorage.channelName(l.channel) + (l.label ? " · " + l.label : "")
                )}</em>`
            ),
          ]
            .filter(Boolean)
            .join("");

          const linkRows = (links.length ? links : [{ url: "", channel: "direct", label: "" }])
            .map(
              (l) => `
              <div class="cfg-lib-link-row" data-link-row>
                <select data-link-channel aria-label="渠道">${channelOpts(l.channel || "direct")}</select>
                <input type="text" data-link-url placeholder="https://…" value="${esc(l.url || "")}" spellcheck="false" />
                <input type="text" data-link-label placeholder="备注" value="${esc(l.label || "")}" />
                <button type="button" class="cfg-btn cfg-lib-x" data-link-remove title="移除">×</button>
              </div>`
            )
            .join("");

          const catOpts = editableCats
            .map(
              (c) =>
                `<option value="${esc(c.id)}" ${c.id === it.category ? "selected" : ""}>${esc(c.name)}</option>`
            )
            .join("");

          return `
          <article class="cfg-lib-row ${open ? "is-open" : ""}" data-lib-card="${esc(it.id)}">
            <div class="cfg-lib-row-main">
              <label class="cfg-check"><input type="checkbox" data-lib-check="${esc(it.id)}" /></label>
              <div class="cfg-lib-row-text">
                <strong>${esc(it.title)}</strong>
                <div class="cfg-lib-pills">${pills || `<em class="cfg-lib-pill muted">无外链</em>`}</div>
                ${it.desc && !open ? `<p class="cfg-lib-desc">${esc(it.desc)}</p>` : ""}
              </div>
              <div class="cfg-item-actions">
                <button type="button" data-lib-edit="${esc(it.id)}">${open ? "收起" : "编辑"}</button>
                <button type="button" data-lib-del="${esc(it.id)}">删除</button>
              </div>
            </div>
            ${
              open
                ? `<div class="cfg-lib-editor">
              <div class="cfg-lib-form">
                <label><span>名称</span><input type="text" data-edit-title value="${esc(it.title || "")}" /></label>
                <label><span>分类</span><select data-edit-cat>${catOpts}</select></label>
                <label class="cfg-lib-span2"><span>说明</span><textarea data-edit-desc rows="2" placeholder="展示在资源库页面的说明">${esc(
                  it.desc || ""
                )}</textarea></label>
              </div>
              <div class="cfg-lib-links">
                <div class="cfg-lib-links-head">
                  <strong>下载渠道</strong>
                  <button type="button" class="cfg-btn" data-link-add="${esc(it.id)}">＋ 添加</button>
                </div>
                <div class="cfg-lib-link-list" data-link-list>${linkRows}</div>
              </div>
              <div class="cfg-lib-actions">
                <button type="button" class="cfg-btn primary" data-lib-save="${esc(it.id)}">保存修改</button>
              </div>
            </div>`
                : ""
            }
          </article>`;
        })
        .join("");

      this.syncLibBatchUi(root);
    },

    renderLibCategoryUi(root) {
      if (!root || !window.LibraryStorage) return;
      const cats = LibraryStorage.normalizeCategories?.(LIBRARY_DATA.categories) || [];
      const chips = root.querySelector("#libCatChips");
      if (!chips) return;
      chips.innerHTML = cats
        .map(
          (c) => `
          <span class="cfg-lib-cat-chip" data-cat-id="${esc(c.id)}" draggable="false">
            <span class="cfg-lib-cat-drag" data-cat-drag title="拖动排序" aria-hidden="true">⠿</span>
            <button type="button" data-cat-rename="${esc(c.id)}" title="重命名">${esc(c.name)}</button>
            ${
              c.id === "other"
                ? ""
                : `<button type="button" class="cfg-lib-x" data-cat-del="${esc(c.id)}" title="删除">×</button>`
            }
          </span>`
        )
        .join("");

      bindCatChipDrag(chips, {
        onReorder: async (from, to) => {
          const list = LibraryStorage.normalizeCategories(LIBRARY_DATA.categories);
          if (from < 0 || to < 0 || from >= list.length || to >= list.length) return;
          const [moved] = list.splice(from, 1);
          list.splice(to, 0, moved);
          LIBRARY_DATA.categories = list;
          this.renderLibCategoryUi(root);
          const status = root.querySelector("#libAdminStatus");
          const setStatus = (text, kind = "") => {
            if (!status) return;
            status.textContent = text || "";
            status.className = "cfg-status" + (kind ? " " + kind : "");
          };
          setStatus("正在保存排序…");
          try {
            await LibraryStorage.saveCategories(list);
            setStatus("分类顺序已保存", "ok");
            await this.renderLibraryAdmin(root);
            if (window.LibraryUI?.refreshListQuiet) LibraryUI.refreshListQuiet();
          } catch (err) {
            setStatus(err.message || "保存排序失败", "err");
            await this.renderLibraryAdmin(root);
          }
        },
      });

      this.renderLibSidebarLinksAdmin(root);
    },

    renderLibSidebarLinksAdmin(root, links) {
      const list = root?.querySelector("#libSideLinkAdmin");
      if (!list) return;
      const rows =
        links ||
        LibraryStorage.normalizeSidebarLinks?.(LIBRARY_DATA.sidebarLinks, { allowEmpty: true }) ||
        [];
      const data = rows.length ? rows : [{ id: "", name: "", url: "" }];
      list.innerHTML = data
        .map(
          (l) => `
        <div class="cfg-lib-side-link-row" data-side-link-row>
          <input type="hidden" data-side-link-id value="${esc(l.id || "")}" />
          <input type="text" data-side-link-name placeholder="名称，如 123网盘" value="${esc(l.name || "")}" />
          <input type="url" data-side-link-url placeholder="https://…" value="${esc(l.url || "")}" spellcheck="false" />
          <button type="button" class="cfg-btn cfg-lib-x" data-side-link-remove title="移除">×</button>
        </div>`
        )
        .join("");
    },

    syncLibBatchUi(root) {
      if (!root) return;
      const boxes = [...root.querySelectorAll("[data-lib-check]")];
      const checked = boxes.filter((b) => b.checked);
      const all = root.querySelector("#libCheckAll");
      const delBtn = root.querySelector("#libBatchDel");
      const hint = root.querySelector("#libBatchHint");
      if (all) {
        all.checked = boxes.length > 0 && checked.length === boxes.length;
        all.indeterminate = checked.length > 0 && checked.length < boxes.length;
      }
      if (delBtn) delBtn.disabled = !checked.length;
      if (hint) hint.textContent = "已选 " + checked.length + " 项";
    },

    bind(root) {
      const setLibStatus = (text, kind = "") => {
        const el = root.querySelector("#libAdminStatus");
        if (!el) return;
        el.textContent = text || "";
        el.className = "cfg-status" + (kind ? " " + kind : "");
      };

      const dock = root.querySelector("#libUploadDock");
      if (dock && window.LibUploadQueue) LibUploadQueue.bindDock(dock);

      root.querySelector("#cfgLogout")?.addEventListener("click", () => {
        this.logout();
      });

      const syncGhFields = () => {
        if (!window.LibraryStorage?.saveGhPrefs) return null;
        const saved = LibraryStorage.saveGhPrefs({
          owner: root.querySelector("#ghOwner")?.value || "",
          repo: root.querySelector("#ghRepo")?.value || "",
          token: root.querySelector("#ghToken")?.value || "",
        });
        const ownerEl = root.querySelector("#ghOwner");
        const repoEl = root.querySelector("#ghRepo");
        if (ownerEl) ownerEl.value = saved.owner;
        if (repoEl) repoEl.value = saved.repo;
        return saved;
      };

      root.querySelector("#ghSavePrefs")?.addEventListener("click", () => {
        this.activeTab = "library";
        const saved = syncGhFields();
        if (!saved) return;
        setLibStatus(
          "已保存（非错误）。仓库：https://github.com/" + saved.owner + "/" + saved.repo + " —— 请再点「测试连接」",
          "ok"
        );
      });

      root.querySelector("#ghTestBtn")?.addEventListener("click", async () => {
        if (!window.LibraryStorage?.testGitHub) return;
        this.activeTab = "library";
        const saved = syncGhFields();
        setLibStatus("正在测试 GitHub 连接…");
        try {
          const j = await LibraryStorage.testGitHub(saved);
          setLibStatus(
            (j.message || "连接成功") +
              "：" +
              (j.htmlUrl || j.repo) +
              (j.empty ? "" : " —— 可以点蓝色按钮上传文件了"),
            "ok"
          );
        } catch (err) {
          setLibStatus(err.message || "测试失败", "err");
        }
      });

      root.querySelector("#ghUploadBtn")?.addEventListener("click", () => {
        syncGhFields();
        root.querySelector("#ghFileInput")?.click();
      });

      root.querySelector("#ghFileInput")?.addEventListener("change", (e) => {
        const files = e.target.files ? [...e.target.files] : [];
        e.target.value = "";
        if (!files.length || !window.LibUploadQueue) return;
        this.activeTab = "library";
        syncGhFields();
        try {
          LibUploadQueue.enqueue(files, { category: "other" });
          const n = files.length;
          setLibStatus(
            n > 1
              ? `已加入 ${n} 个上传任务（最多同时 ${LibUploadQueue.MAX_CONCURRENT} 个）`
              : `已开始上传「${files[0].name}」`,
            "ok"
          );
        } catch (err) {
          setLibStatus(err.message || "无法开始上传", "err");
        }
      });

      const onUploaded = async () => {
        if (this.activeTab === "library") {
          try {
            await this.renderLibraryAdmin(root);
          } catch (_) {}
        }
        if (window.LibraryUI?.refreshListQuiet) LibraryUI.refreshListQuiet();
      };
      window.addEventListener("cl-nav-lib-uploaded", onUploaded);

      root.querySelector("#libAddLinkBtn")?.addEventListener("click", async () => {
        if (!window.LibraryStorage?.addLink) return;
        this.activeTab = "library";
        const data = await openLibResourceDialog();
        if (!data) return;
        setLibStatus("正在添加…");
        try {
          await LibraryStorage.addLink(data);
          setLibStatus("已添加外链资源", "ok");
          await this.renderLibraryAdmin(root);
          if (window.LibraryUI?.refreshListQuiet) LibraryUI.refreshListQuiet();
        } catch (err) {
          setLibStatus(err.message || "添加失败", "err");
        }
      });

      root.querySelector("#libAdminFilter")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-lib-filter]");
        if (!btn) return;
        const id = btn.dataset.libFilter || "all";
        if (id === this.libFilterCategory) return;
        this.libFilterCategory = id;
        this.activeTab = "library";
        this.renderLibraryAdmin(root);
      });

      const hideCatComposer = () => {
        const composer = root.querySelector("#libCatComposer");
        const plus = root.querySelector("#libCatAddToggle");
        if (composer) composer.hidden = true;
        if (plus) plus.hidden = false;
        const input = root.querySelector("#libCatNewName");
        if (input) input.value = "";
      };

      const showCatComposer = () => {
        const composer = root.querySelector("#libCatComposer");
        const plus = root.querySelector("#libCatAddToggle");
        if (composer) composer.hidden = false;
        if (plus) plus.hidden = true;
        const input = root.querySelector("#libCatNewName");
        input?.focus();
      };

      root.querySelector("#libCatAddToggle")?.addEventListener("click", () => {
        this.activeTab = "library";
        showCatComposer();
      });

      root.querySelector("#libCatNewName")?.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          hideCatComposer();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          root.querySelector("#libCatAdd")?.click();
        }
      });

      root.querySelector("#libCatAdd")?.addEventListener("click", async () => {
        if (!window.LibraryStorage?.saveCategories) return;
        const name = String(root.querySelector("#libCatNewName")?.value || "").trim();
        if (!name) {
          setLibStatus("请填写新分类名称", "err");
          root.querySelector("#libCatNewName")?.focus();
          return;
        }
        this.activeTab = "library";
        const cats = LibraryStorage.normalizeCategories(LIBRARY_DATA.categories);
        const id = LibraryStorage.newCatId(name);
        cats.push({ id, name });
        setLibStatus("正在添加分类…");
        try {
          await LibraryStorage.saveCategories(cats);
          hideCatComposer();
          setLibStatus("已添加分类：" + name, "ok");
          await this.renderLibraryAdmin(root);
          if (window.LibraryUI?.refreshListQuiet) LibraryUI.refreshListQuiet();
        } catch (err) {
          setLibStatus(err.message || "添加分类失败", "err");
        }
      });

      const readSideLinkRows = () =>
        [...root.querySelectorAll("#libSideLinkAdmin [data-side-link-row]")].map((row) => ({
          id: String(row.querySelector("[data-side-link-id]")?.value || "").trim(),
          name: String(row.querySelector("[data-side-link-name]")?.value || "").trim(),
          url: String(row.querySelector("[data-side-link-url]")?.value || "").trim(),
        }));

      root.querySelector("#libSideLinkAdd")?.addEventListener("click", () => {
        this.activeTab = "library";
        const list = root.querySelector("#libSideLinkAdmin");
        if (!list) return;
        list.insertAdjacentHTML(
          "beforeend",
          `<div class="cfg-lib-side-link-row" data-side-link-row>
            <input type="hidden" data-side-link-id value="" />
            <input type="text" data-side-link-name placeholder="名称，如 123网盘" value="" />
            <input type="url" data-side-link-url placeholder="https://…" value="" spellcheck="false" />
            <button type="button" class="cfg-btn cfg-lib-x" data-side-link-remove title="移除">×</button>
          </div>`
        );
      });

      root.querySelector("#libSideLinkAdmin")?.addEventListener("click", (e) => {
        if (!e.target.closest("[data-side-link-remove]")) return;
        const row = e.target.closest("[data-side-link-row]");
        const list = root.querySelector("#libSideLinkAdmin");
        if (!row || !list) return;
        if (list.querySelectorAll("[data-side-link-row]").length <= 1) {
          row.querySelector("[data-side-link-name]").value = "";
          row.querySelector("[data-side-link-url]").value = "";
          row.querySelector("[data-side-link-id]").value = "";
        } else {
          row.remove();
        }
      });

      root.querySelector("#libSideLinkSave")?.addEventListener("click", async () => {
        if (!window.LibraryStorage?.saveSidebarLinks) return;
        this.activeTab = "library";
        const rows = readSideLinkRows().filter((r) => r.name && r.url);
        setLibStatus("正在保存侧栏入口…");
        try {
          await LibraryStorage.saveSidebarLinks(rows);
          setLibStatus("侧栏网盘入口已保存", "ok");
          this.renderLibSidebarLinksAdmin(root);
          if (window.LibraryUI?.renderSideLinks) LibraryUI.renderSideLinks();
        } catch (err) {
          setLibStatus(err.message || "保存侧栏入口失败", "err");
        }
      });

      root.querySelector("#libCatChips")?.addEventListener("click", async (e) => {
        if (!window.LibraryStorage?.saveCategories) return;
        const del = e.target.closest("[data-cat-del]");
        const rename = e.target.closest("[data-cat-rename]");
        this.activeTab = "library";
        let cats = LibraryStorage.normalizeCategories(LIBRARY_DATA.categories);

        if (del) {
          const id = del.dataset.catDel;
          if (!id || id === "other") return;
          const hit = cats.find((c) => c.id === id);
          if (!confirm(`删除分类「${hit?.name || id}」？该分类下的资源将归入「其他」。`)) return;
          cats = cats.filter((c) => c.id !== id);
          setLibStatus("正在删除分类…");
          try {
            await LibraryStorage.saveCategories(cats);
            setLibStatus("已删除分类", "ok");
            await this.renderLibraryAdmin(root);
            if (window.LibraryUI?.refreshListQuiet) LibraryUI.refreshListQuiet();
          } catch (err) {
            setLibStatus(err.message || "删除分类失败", "err");
          }
          return;
        }

        if (rename) {
          const id = rename.dataset.catRename;
          const hit = cats.find((c) => c.id === id);
          if (!hit) return;
          const name = window.prompt("分类名称", hit.name);
          if (name == null || !String(name).trim()) return;
          hit.name = String(name).trim().slice(0, 40);
          setLibStatus("正在重命名…");
          try {
            await LibraryStorage.saveCategories(cats);
            setLibStatus("已重命名", "ok");
            await this.renderLibraryAdmin(root);
            if (window.LibraryUI?.refreshListQuiet) LibraryUI.refreshListQuiet();
          } catch (err) {
            setLibStatus(err.message || "重命名失败", "err");
          }
        }
      });

      root.querySelector("#libAdminList")?.addEventListener("click", async (e) => {
        const editBtn = e.target.closest("[data-lib-edit]");
        if (editBtn) {
          const id = editBtn.dataset.libEdit;
          this.libEditingId = this.libEditingId === id ? "" : id;
          this.activeTab = "library";
          await this.renderLibraryAdmin(root);
          return;
        }

        const addLinkBtn = e.target.closest("[data-link-add]");
        if (addLinkBtn) {
          const card = addLinkBtn.closest("[data-lib-card]");
          const list = card?.querySelector("[data-link-list]");
          if (!list) return;
          const channels = window.LibraryStorage?.channels || [];
          const opts = channels
            .map((c) => `<option value="${esc(c.id)}" ${c.id === "direct" ? "selected" : ""}>${esc(c.name)}</option>`)
            .join("");
          const row = document.createElement("div");
          row.className = "cfg-lib-link-row";
          row.dataset.linkRow = "";
          row.innerHTML = `
            <select data-link-channel aria-label="渠道">${opts}</select>
            <input type="text" data-link-url placeholder="https://…" spellcheck="false" />
            <input type="text" data-link-label placeholder="备注" />
            <button type="button" class="cfg-btn cfg-lib-x" data-link-remove title="移除">×</button>`;
          list.appendChild(row);
          return;
        }

        if (e.target.closest("[data-link-remove]")) {
          const row = e.target.closest("[data-link-row]");
          const list = row?.parentElement;
          if (row && list) {
            if (list.querySelectorAll("[data-link-row]").length <= 1) {
              row.querySelector("[data-link-url]").value = "";
              row.querySelector("[data-link-label]").value = "";
            } else {
              row.remove();
            }
          }
          return;
        }

        const saveBtn = e.target.closest("[data-lib-save]");
        if (saveBtn && window.LibraryStorage?.update) {
          const id = saveBtn.dataset.libSave;
          const card = saveBtn.closest("[data-lib-card]");
          if (!card) return;
          const links = [...card.querySelectorAll("[data-link-row]")].map((row) => ({
            channel: row.querySelector("[data-link-channel]")?.value || "other",
            url: row.querySelector("[data-link-url]")?.value || "",
            label: row.querySelector("[data-link-label]")?.value || "",
          }));
          this.activeTab = "library";
          setLibStatus("正在保存…");
          try {
            await LibraryStorage.update(id, {
              title: card.querySelector("[data-edit-title]")?.value || "",
              desc: card.querySelector("[data-edit-desc]")?.value || "",
              category: card.querySelector("[data-edit-cat]")?.value || "other",
              links,
            });
            setLibStatus("已保存", "ok");
            this.libEditingId = "";
            await this.renderLibraryAdmin(root);
          } catch (err) {
            setLibStatus(err.message || "保存失败", "err");
          }
          return;
        }

        const btn = e.target.closest("[data-lib-del]");
        if (!btn || !window.LibraryStorage) return;
        if (!confirm("确定删除该资源条目？")) return;
        this.activeTab = "library";
        try {
          await LibraryStorage.remove(btn.dataset.libDel);
          if (this.libEditingId === btn.dataset.libDel) this.libEditingId = "";
          setLibStatus("已删除", "ok");
          await this.renderLibraryAdmin(root);
        } catch (err) {
          setLibStatus(err.message || "删除失败", "err");
        }
      });

      root.querySelector("#libAdminList")?.addEventListener("change", (e) => {
        if (e.target.matches("[data-lib-check]")) this.syncLibBatchUi(root);
      });

      root.querySelector("#libCheckAll")?.addEventListener("change", (e) => {
        const on = !!e.target.checked;
        root.querySelectorAll("[data-lib-check]").forEach((box) => {
          box.checked = on;
        });
        this.syncLibBatchUi(root);
      });

      root.querySelector("#libBatchDel")?.addEventListener("click", async () => {
        if (!window.LibraryStorage?.removeMany) return;
        const ids = [...root.querySelectorAll("[data-lib-check]:checked")].map((b) => b.dataset.libCheck);
        if (!ids.length) return;
        if (!confirm("确定删除选中的 " + ids.length + " 个资源？")) return;
        this.activeTab = "library";
        setLibStatus("正在批量删除…");
        try {
          const n = await LibraryStorage.removeMany(ids);
          if (ids.includes(this.libEditingId)) this.libEditingId = "";
          setLibStatus("已删除 " + n + " 项", "ok");
          await this.renderLibraryAdmin(root);
        } catch (err) {
          setLibStatus(err.message || "批量删除失败", "err");
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
