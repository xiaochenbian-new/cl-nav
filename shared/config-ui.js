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

  function linkCardIconHtml(link) {
    const domain = link.domain || domainFromUrl(link.url);
    if (domain) {
      const src =
        (window.Portal && typeof Portal.favicon === "function" && Portal.favicon(domain)) ||
        `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
      return `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-domain="${esc(
        domain
      )}" data-step="0" onerror="Portal.onFaviconError(this)" />`;
    }
    const ch = String(link.title || "?").slice(0, 1);
    return `<span class="site-fallback">${esc(ch)}</span>`;
  }

  /** Push auto-backup / CF sync immediately when enabled. */
  function flushAutoBackup() {
    try {
      window.NavWebDav?.flushPush?.();
    } catch (_) {}
    try {
      window.NavCfSync?.flushPush?.();
    } catch (_) {}
  }

  /**
   * 网站剪贴板：复制/剪切后可跨分类、跨子分类粘贴。
   * mode: "copy" 保留源站；"cut" 粘贴时从源移走。仅存于内存 + sessionStorage。
   */
  const LINK_CLIP_KEY = "cl-nav-link-clip-v1";
  let linkClip = (() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(LINK_CLIP_KEY) || "null");
      if (raw && Array.isArray(raw.links)) return raw;
    } catch (_) {}
    return { mode: "copy", links: [] };
  })();

  function setLinkClip(mode, links) {
    linkClip = { mode: mode === "cut" ? "cut" : "copy", links: links || [] };
    try {
      sessionStorage.setItem(LINK_CLIP_KEY, JSON.stringify(linkClip));
    } catch (_) {}
  }

  function clearLinkClip() {
    linkClip = { mode: "copy", links: [] };
    try {
      sessionStorage.removeItem(LINK_CLIP_KEY);
    } catch (_) {}
  }

  function clipCount() {
    return (linkClip.links || []).length;
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

  /** Shared drag state so category list can accept site-card drops reliably. */
  const paneDrag = {
    kind: null, // 'link' | 'cat' | 'child' | null
    linkEl: null,
    linkIndex: -1,
  };

  /**
   * Grid drag-reorder like phone app icons: while dragging, the item
   * takes the hovered slot and siblings shift to fill the gap; persist on end.
   * Drag from anywhere on the card except interactive controls.
   * Optional: drop onto category / subcategory buttons to move the link.
   */
  function bindGridDragSort(listEl, { onReorder, catListEl, selectedCatId, selectedChildId, onMoveToCategory }) {
    if (!listEl) return;
    let dragEl = null;
    let startOrder = null;
    let moved = false;
    let dropCatId = null;
    let dropChildId = null;
    let movedToCat = false;
    const curChild = selectedChildId || "";

    const items = () => [...listEl.querySelectorAll(".cfg-item[data-sortable]")];
    const isInteractive = (t) =>
      !!t.closest("button, input, label, a, .cfg-link-check, .cfg-link-del, .cfg-link-edit");

    const sameLeaf = (catId, childId) =>
      catId === selectedCatId && String(childId || "") === String(curChild);

    const clearCatDrop = () => {
      dropCatId = null;
      dropChildId = null;
      catListEl?.querySelectorAll(".cfg-cat").forEach((el) => el.classList.remove("drop-target"));
    };

    listEl.querySelectorAll(".cfg-item[data-sortable]").forEach((item) => {
      item.setAttribute("draggable", "false");

      const setDrag = (on) => {
        item.setAttribute("draggable", on ? "true" : "false");
      };

      item.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || isInteractive(e.target)) return;
        setDrag(true);
      });
      item.addEventListener(
        "touchstart",
        (e) => {
          if (isInteractive(e.target)) return;
          setDrag(true);
        },
        { passive: true }
      );
      item.addEventListener("mouseup", () => {
        if (!dragEl) setDrag(false);
      });
      item.addEventListener("mouseleave", () => {
        if (!dragEl) setDrag(false);
      });

      item.addEventListener("dragstart", (e) => {
        if (item.getAttribute("draggable") !== "true") {
          e.preventDefault();
          return;
        }
        dragEl = item;
        moved = false;
        movedToCat = false;
        dropCatId = null;
        dropChildId = null;
        startOrder = items().map((el) => el.dataset.li);
        paneDrag.kind = "link";
        paneDrag.linkEl = item;
        paneDrag.linkIndex = +item.dataset.li;
        item.classList.add("dragging");
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", "link:" + (item.dataset.li || "0"));
        } catch (_) {}
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === item) return;
        clearCatDrop();
        const all = items();
        const from = all.indexOf(dragEl);
        const to = all.indexOf(item);
        if (from < 0 || to < 0 || from === to) return;
        if (from < to) item.after(dragEl);
        else item.before(dragEl);
        moved = true;
        try {
          e.dataTransfer.dropEffect = "move";
        } catch (_) {}
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        setDrag(false);
        const endOrder = items().map((el) => el.dataset.li);
        const changed =
          !movedToCat &&
          moved &&
          startOrder &&
          endOrder.length === startOrder.length &&
          endOrder.some((v, i) => v !== startOrder[i]);
        clearCatDrop();
        dragEl = null;
        startOrder = null;
        moved = false;
        paneDrag.kind = null;
        paneDrag.linkEl = null;
        paneDrag.linkIndex = -1;
        if (changed) onReorder(endOrder.map((v) => +v));
        movedToCat = false;
      });
    });

    if (catListEl && typeof onMoveToCategory === "function") {
      catListEl.addEventListener("dragover", (e) => {
        if (paneDrag.kind !== "link" || !dragEl) return;
        const cat = e.target.closest(".cfg-cat[data-cat]");
        if (!cat || !catListEl.contains(cat)) return;
        e.preventDefault();
        e.stopPropagation();
        const id = cat.dataset.cat;
        const childId = cat.dataset.child || "";
        catListEl.querySelectorAll(".cfg-cat").forEach((el) => el.classList.remove("drop-target"));
        if (id && !sameLeaf(id, childId)) {
          cat.classList.add("drop-target");
          dropCatId = id;
          dropChildId = childId;
        } else {
          dropCatId = null;
          dropChildId = null;
        }
        try {
          e.dataTransfer.dropEffect = "move";
        } catch (_) {}
      });

      catListEl.addEventListener("dragleave", (e) => {
        if (paneDrag.kind !== "link") return;
        const to = e.relatedTarget;
        if (to && catListEl.contains(to)) return;
        clearCatDrop();
      });

      catListEl.addEventListener("drop", (e) => {
        if (paneDrag.kind !== "link" || !dragEl) return;
        const cat = e.target.closest(".cfg-cat[data-cat]");
        e.preventDefault();
        e.stopPropagation();
        const id = cat?.dataset.cat || dropCatId;
        const childId = cat?.dataset.child != null ? cat.dataset.child || "" : dropChildId || "";
        const idx = Number.isInteger(paneDrag.linkIndex) ? paneDrag.linkIndex : +dragEl.dataset.li;
        clearCatDrop();
        if (!id || sameLeaf(id, childId) || !Number.isInteger(idx) || idx < 0) return;
        movedToCat = true;
        // Defer so dragend can finish before store re-render tears down the DOM
        window.setTimeout(() => onMoveToCategory(idx, id, childId || null), 0);
      });
    }
  }

  /** Parent row + following subcategory rows as one block. */
  function catParentBlock(parentBtn) {
    const nodes = [parentBtn];
    let n = parentBtn.nextElementSibling;
    while (n && n.classList.contains("cfg-cat-sub")) {
      nodes.push(n);
      n = n.nextElementSibling;
    }
    return nodes;
  }

  /**
   * Vertical drag for category sidebar:
   * - parent rows reorder among parents (move block with children)
   * - child rows reorder within same parent, or drop onto another parent to migrate
   */
  function bindCatListDrag(listEl, { onReorderParent, onReorderChild, onMoveChildToParent }) {
    if (!listEl || listEl.dataset.dragBound === "1") return;
    listEl.dataset.dragBound = "1";
    let dragEl = null;
    let dragKind = null; // 'cat' | 'child'
    let suppressClick = false;
    let dropParentId = null;
    let didStructuralMove = false;
    let handledByDrop = false;

    const clearMarks = () => {
      dropParentId = null;
      listEl.querySelectorAll(".cfg-cat").forEach((el) => {
        el.classList.remove("dragging", "drag-over", "drop-target");
        el.setAttribute("draggable", "false");
      });
    };

    listEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const cat = e.target.closest(".cfg-cat[data-sortable]");
      if (!cat || !listEl.contains(cat)) return;
      cat.setAttribute("draggable", "true");
    });

    listEl.addEventListener(
      "touchstart",
      (e) => {
        const cat = e.target.closest(".cfg-cat[data-sortable]");
        if (!cat || !listEl.contains(cat)) return;
        cat.setAttribute("draggable", "true");
      },
      { passive: true }
    );

    listEl.addEventListener("mouseup", () => {
      listEl.querySelectorAll(".cfg-cat[draggable='true']").forEach((el) => {
        if (!dragEl) el.setAttribute("draggable", "false");
      });
    });

    listEl.addEventListener("dragstart", (e) => {
      if (paneDrag.kind === "link") {
        e.preventDefault();
        return;
      }
      const cat = e.target.closest(".cfg-cat[data-sortable]");
      if (!cat || !listEl.contains(cat) || cat.getAttribute("draggable") !== "true") {
        e.preventDefault();
        return;
      }
      dragEl = cat;
      dragKind = cat.dataset.sortable === "child" ? "child" : "cat";
      suppressClick = false;
      didStructuralMove = false;
      handledByDrop = false;
      dropParentId = null;
      paneDrag.kind = dragKind;
      cat.classList.add("dragging");
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
          "text/plain",
          dragKind === "child"
            ? "child:" + (cat.dataset.cat || "") + ":" + (cat.dataset.child || "")
            : "cat:" + (cat.dataset.cat || "")
        );
      } catch (_) {}
    });

    listEl.addEventListener("dragover", (e) => {
      if (paneDrag.kind === "link") return;
      if (!dragEl || !dragKind) return;
      e.preventDefault();

      if (dragKind === "cat") {
        const overParent = e.target.closest(".cfg-cat[data-sortable='cat']");
        if (!overParent || overParent === dragEl || !listEl.contains(overParent)) return;
        const parents = [...listEl.querySelectorAll(".cfg-cat[data-sortable='cat']")];
        const from = parents.indexOf(dragEl);
        const to = parents.indexOf(overParent);
        if (from < 0 || to < 0 || from === to) return;
        const block = catParentBlock(dragEl);
        if (from < to) {
          const overBlock = catParentBlock(overParent);
          const last = overBlock[overBlock.length - 1];
          last.after(...block);
        } else {
          overParent.before(...block);
        }
        suppressClick = true;
        didStructuralMove = true;
        listEl.querySelectorAll(".cfg-cat").forEach((el) => el.classList.remove("drag-over", "drop-target"));
        overParent.classList.add("drag-over");
      } else {
        // child: reorder among siblings, or highlight another parent as migrate target
        const overChild = e.target.closest(".cfg-cat[data-sortable='child']");
        const overParent = e.target.closest(".cfg-cat[data-sortable='cat']");
        listEl.querySelectorAll(".cfg-cat").forEach((el) => el.classList.remove("drag-over", "drop-target"));

        if (overChild && overChild !== dragEl && overChild.dataset.cat === dragEl.dataset.cat) {
          dropParentId = null;
          const siblings = [
            ...listEl.querySelectorAll(`.cfg-cat[data-sortable='child'][data-cat="${dragEl.dataset.cat}"]`),
          ];
          const from = siblings.indexOf(dragEl);
          const to = siblings.indexOf(overChild);
          if (from < 0 || to < 0 || from === to) return;
          if (from < to) overChild.after(dragEl);
          else overChild.before(dragEl);
          suppressClick = true;
          didStructuralMove = true;
          overChild.classList.add("drag-over");
        } else if (overParent && overParent.dataset.cat !== dragEl.dataset.cat) {
          overParent.classList.add("drop-target");
          dropParentId = overParent.dataset.cat;
          suppressClick = true;
        }
      }
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (_) {}
    });

    listEl.addEventListener("drop", (e) => {
      if (paneDrag.kind === "link") return;
      e.preventDefault();
      if (dragKind !== "child" || !dragEl) return;
      const overParent = e.target.closest(".cfg-cat[data-sortable='cat']");
      const toParent = overParent?.dataset.cat || dropParentId;
      if (!toParent || toParent === dragEl.dataset.cat) return;
      const fromCatId = dragEl.dataset.cat;
      const childId = dragEl.dataset.child;
      handledByDrop = true;
      didStructuralMove = true;
      clearMarks();
      dragEl = null;
      dragKind = null;
      paneDrag.kind = null;
      window.setTimeout(() => {
        onMoveChildToParent?.(fromCatId, childId, toParent);
      }, 0);
    });

    listEl.addEventListener("dragend", () => {
      if (handledByDrop) {
        handledByDrop = false;
        clearMarks();
        dragEl = null;
        dragKind = null;
        if (paneDrag.kind === "cat" || paneDrag.kind === "child") paneDrag.kind = null;
        return;
      }
      const kind = dragKind;
      const el = dragEl;
      const didMove = didStructuralMove || suppressClick;
      const migrateTo = dropParentId;
      clearMarks();
      if (paneDrag.kind === "cat" || paneDrag.kind === "child") paneDrag.kind = null;
      dragEl = null;
      dragKind = null;
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
      if (!el || !didMove) return;
      const cfg = window.NavStore?.get?.();
      if (!cfg) return;

      if (kind === "cat") {
        const endIds = [...listEl.querySelectorAll(".cfg-cat[data-sortable='cat']")].map((n) => n.dataset.cat);
        const origIds = cfg.categories.map((c) => c.id);
        const fromIdx = origIds.indexOf(el.dataset.cat);
        const toIdx = endIds.indexOf(el.dataset.cat);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        onReorderParent?.(fromIdx, toIdx);
        return;
      }

      if (kind === "child") {
        if (migrateTo && migrateTo !== el.dataset.cat) {
          onMoveChildToParent?.(el.dataset.cat, el.dataset.child, migrateTo);
          return;
        }
        const parentId = el.dataset.cat;
        const parent = cfg.categories.find((c) => c.id === parentId);
        if (!parent) return;
        const endIds = [
          ...listEl.querySelectorAll(`.cfg-cat[data-sortable='child'][data-cat="${parentId}"]`),
        ].map((n) => n.dataset.child);
        const origIds = (parent.children || []).map((c) => c.id);
        const fromIdx = origIds.indexOf(el.dataset.child);
        const toIdx = endIds.indexOf(el.dataset.child);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        onReorderChild?.(parentId, fromIdx, toIdx);
      }
    });

    listEl.addEventListener(
      "click",
      (e) => {
        if (!suppressClick) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
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

  /**
   * 选择「粘贴目标」分类 / 子分类。返回 {catId, childId} 或 null。
   * 目标下拉列出全部一级分类，选中带子分类的一级后出现二级下拉。
   */
  function openPasteTargetDialog({ count = 0, mode = "copy", title = "选择目标分类" } = {}) {
    return new Promise((resolve) => {
      const old = document.getElementById("cfgPasteDialog");
      if (old) old.remove();

      const cats = (NavStore.get().categories || []).filter(Boolean);
      if (!cats.length) {
        alert("还没有任何分类，请先新建分类。");
        resolve(null);
        return;
      }

      const isCut = mode === "cut";
      const modeLabel = isCut ? "移动" : "复制";
      const pasteIcon = isCut
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M10 12h6"/><polyline points="13.5 9.5 16 12 13.5 14.5"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;

      const overlay = document.createElement("div");
      overlay.id = "cfgPasteDialog";
      overlay.className = "cfg-dialog-overlay";
      overlay.innerHTML = `
        <div class="cfg-dialog cfg-paste-dialog" role="dialog" aria-modal="true" aria-labelledby="cfgPasteTitle">
          <div class="cfg-paste-head">
            <span class="cfg-paste-badge" data-mode="${isCut ? "cut" : "copy"}" aria-hidden="true">${pasteIcon}</span>
            <div class="cfg-paste-heading">
              <h3 id="cfgPasteTitle">${esc(title)}</h3>
              <p class="cfg-paste-sub">将 <b>${count}</b> 个网站以「${modeLabel}」方式放到：</p>
            </div>
          </div>
          <div class="cfg-paste-fields">
            <label class="cfg-field">
              <span>一级分类</span>
              <select id="cfgPasteCat"></select>
            </label>
            <label class="cfg-field" id="cfgPasteChildWrap" hidden>
              <span>子分类</span>
              <select id="cfgPasteChild"></select>
            </label>
          </div>
          <p class="cfg-dialog-err" id="cfgPasteErr" hidden></p>
          <div class="cfg-dialog-actions">
            <button type="button" class="cfg-btn" id="cfgPasteCancel">取消</button>
            <button type="button" class="cfg-btn primary" id="cfgPasteOk">确定</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const catSel = overlay.querySelector("#cfgPasteCat");
      const childSel = overlay.querySelector("#cfgPasteChild");
      const childWrap = overlay.querySelector("#cfgPasteChildWrap");

      const fillCats = () => {
        catSel.innerHTML = cats
          .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
          .join("");
      };

      const fillChildren = () => {
        const cat = cats.find((c) => c.id === catSel.value);
        const kids = (cat && cat.children) || [];
        if (!kids.length) {
          childWrap.hidden = true;
          childSel.innerHTML = "";
          return;
        }
        childWrap.hidden = false;
        childSel.innerHTML =
          `<option value="">未分组（${esc(cat.name)} 直属）</option>` +
          kids.map((ch) => `<option value="${esc(ch.id)}">${esc(ch.name)}</option>`).join("");
      };

      fillCats();
      fillChildren();

      const close = (result) => {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };

      const onKey = (e) => {
        if (e.key === "Escape") close(null);
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      };
      const submit = () => {
        const catId = catSel.value;
        if (!catId) {
          const errEl = overlay.querySelector("#cfgPasteErr");
          errEl.hidden = false;
          errEl.textContent = "请选择目标分类";
          return;
        }
        close({ catId, childId: childWrap.hidden ? "" : childSel.value || "" });
      };

      catSel.addEventListener("change", fillChildren);
      document.addEventListener("keydown", onKey);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });
      overlay.querySelector("#cfgPasteCancel").addEventListener("click", () => close(null));
      overlay.querySelector("#cfgPasteOk").addEventListener("click", submit);
      catSel.focus();
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
      { id: "123", name: "123网盘" },
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
    selectedChildId: "", // "" = parent leaf (未分组); otherwise subcategory id
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
        this.selectedChildId = "";
      }
      const selected = cfg.categories.find((c) => c.id === this.selectedCatId);
      if (
        this.selectedChildId &&
        !(selected?.children || []).some((ch) => ch.id === this.selectedChildId)
      ) {
        this.selectedChildId = "";
      }
      const selectedChild = this.selectedChildId
        ? (selected?.children || []).find((ch) => ch.id === this.selectedChildId)
        : null;
      const leafLinks = selectedChild ? selectedChild.links || [] : selected?.links || [];
      const leafTitle = selectedChild
        ? `${selected.name} / ${selectedChild.name}`
        : selected
          ? selected.children?.length
            ? `${selected.name} · 未分组`
            : selected.name
          : "网站列表";
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
        baseRev: 0,
        mode: "",
        lastMessage: "",
        lastConflicts: [],
        lastConflictCount: 0,
      };
      const cfStatusText = (() => {
        if (cf.lastMessage) return cf.lastMessage;
        if (cf.mode === "legacy") {
          return "当前为兼容模式：D1 未绑定，仍是旧版整份覆盖，多机同时编辑可能互相覆盖。";
        }
        if (cf.baseRev > 0) return "强一致同步已连接，本机版本 rev " + cf.baseRev + "。";
        return "填写相同口令并保存后：多台电脑的改动会自动三方合并，不再互相覆盖。";
      })();
      const cfStatusKind =
        cf.mode === "legacy" || cf.remoteNewerSkipAt ? "warn" : cf.baseRev > 0 ? "ok" : "";
      const cfConflictsHtml =
        Array.isArray(cf.lastConflicts) && cf.lastConflicts.length
          ? `<details class="cfg-conflicts"><summary>最近自动解决的冲突（${
              Number(cf.lastConflictCount) || cf.lastConflicts.length
            } 处）</summary><ul>${cf.lastConflicts
              .map((x) => `<li>${esc(x)}</li>`)
              .join("")}</ul></details>`
          : "";

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
              <p class="settings-tip" style="margin:0 0 0.45rem">按住可拖动排序；子分类可拖到其它一级下；右侧网站可拖到一级/二级迁移</p>
              <div class="cfg-list" id="cfgCatList">
                ${cfg.categories
                  .map((c, i) => {
                    const parentActive = c.id === this.selectedCatId && !this.selectedChildId;
                    const count =
                      typeof NavStore.catLinkCount === "function"
                        ? NavStore.catLinkCount(c)
                        : (c.links || []).length;
                    const parentBtn = `
                  <button type="button" class="cfg-cat ${parentActive ? "active" : ""}" data-sortable="cat" data-level="1" data-cat="${c.id}" data-ci="${i}">
                    <span class="cfg-cat-label">${esc(c.name)}</span>
                    <em>${count}</em>
                  </button>`;
                    const childBtns = (c.children || [])
                      .map((ch, j) => {
                        const childActive =
                          c.id === this.selectedCatId && this.selectedChildId === ch.id;
                        return `
                  <button type="button" class="cfg-cat cfg-cat-sub ${childActive ? "active" : ""}" data-sortable="child" data-level="2" data-cat="${c.id}" data-child="${ch.id}" data-cji="${j}">
                    <span class="cfg-cat-label">${esc(ch.name)}</span>
                    <em>${(ch.links || []).length}</em>
                  </button>`;
                      })
                      .join("");
                    return parentBtn + childBtns;
                  })
                  .join("")}
              </div>
            </div>
            <div class="cfg-col">
              <div class="cfg-toolbar">
                <strong>${selected ? esc(leafTitle) : "网站列表"}</strong>
                <div class="cfg-item-actions">
                  ${
                    selected
                      ? selectedChild
                        ? `
                    <button type="button" id="cfgRenameCat">重命名</button>
                    <button type="button" id="cfgUpCat">上移</button>
                    <button type="button" id="cfgDownCat">下移</button>
                    <button type="button" id="cfgDelCat">删除子分类</button>
                    <button type="button" class="cfg-btn primary" id="cfgAddLink">＋ 网站</button>`
                        : `
                    <button type="button" id="cfgRenameCat">重命名</button>
                    <button type="button" id="cfgUpCat">上移</button>
                    <button type="button" id="cfgDownCat">下移</button>
                    <button type="button" id="cfgDelCat">删除分类</button>
                    <button type="button" id="cfgAddChild">＋ 子分类</button>
                    <button type="button" class="cfg-btn primary" id="cfgAddLink">＋ 网站</button>`
                      : ""
                  }
                </div>
              </div>
              <p class="settings-tip" style="margin:0 0 0.45rem">拖动卡片可排序；拖到左侧一级/二级可迁移；勾选后可批量删除、复制或移动；也可右键卡片操作</p>
              ${
                selected && leafLinks.length
                  ? `<div class="cfg-batch-bar">
                      <label class="chk"><input type="checkbox" id="cfgLinkCheckAll" /> 全选</label>
                      <button type="button" class="cfg-btn" id="cfgBatchCopyLinks" disabled>复制</button>
                      <button type="button" class="cfg-btn" id="cfgBatchCutLinks" disabled>剪切</button>
                      <button type="button" class="cfg-btn danger" id="cfgBatchDelLinks" disabled>删除</button>
                      <button type="button" class="cfg-btn primary" id="cfgBatchPaste" hidden>粘贴到…</button>
                      <span class="cfg-clip-chip" id="cfgClipChip" hidden></span>
                      <button type="button" class="cfg-clip-clear" id="cfgClipClear" hidden title="清空剪贴板">×</button>
                      <span class="settings-tip" id="cfgBatchHint">已选 0 项</span>
                    </div>`
                  : ""
              }
              <div class="cfg-list cfg-link-grid" id="cfgLinkList">
                ${
                  selected
                    ? leafLinks.length
                      ? leafLinks
                          .map((l, i) => {
                            const domain = l.domain || domainFromUrl(l.url);
                            const desc = l.desc || domain || l.url || "";
                            return `
                    <div class="cfg-item cfg-link-card" data-sortable data-li="${i}" title="${esc(
                              l.title || desc
                            )}">
                      <label class="cfg-link-check" title="选择">
                        <input type="checkbox" data-l-check="${i}" />
                      </label>
                      <button type="button" class="cfg-link-del" data-l-del="${i}" title="删除">删</button>
                      <div class="site-head">
                        ${linkCardIconHtml(l)}
                        <span class="site-title">${esc(l.title)}</span>
                      </div>
                      <p class="site-desc">${esc(desc)}</p>
                      <button type="button" class="cfg-link-edit" data-l-edit="${i}" title="编辑">编辑</button>
                    </div>`;
                          })
                          .join("")
                      : `<p class="settings-tip cfg-link-grid-empty">${
                          selectedChild
                            ? "该子分类还没有网站，点击「＋ 网站」添加。"
                            : selected.children?.length
                              ? "未分组下暂无网站；可添加，或拖到左侧子分类。"
                              : "该分类还没有网站，点击「＋ 网站」添加。"
                        }</p>`
                    : `<p class="settings-tip cfg-link-grid-empty">请先选择或新建分类。</p>`
                }
              </div>
            </div>
          </div>
          <div class="cfg-menu" id="cfgLinkMenu" hidden role="menu"></div>
        </div>
        <div class="cfg-pane" data-pane="library" ${tab !== "library" ? "hidden" : ""}>
          <div class="cfg-toolbar cfg-lib-toolbar">
            <div>
              <strong>资源库</strong>
              <p class="settings-tip" style="margin:0.2rem 0 0">上传到 GitHub Releases，或添加多渠道外链</p>
            </div>
            <div class="cfg-item-actions">
              <button type="button" class="cfg-btn" id="libAddLinkBtn">外链</button>
              <button type="button" class="cfg-btn" id="libBatchImportBtn" title="粘贴多网盘分享链接批量导入">批量导入</button>
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
            <h4>Cloudflare 云端同步（强一致）</h4>
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
              <button type="button" class="cfg-btn" id="cfUpload">上传本机改动</button>
              <button type="button" class="cfg-btn" id="cfDownload">从云端恢复</button>
            </div>
            <p class="cfg-status ${cfStatusKind}" id="cfStatus">${esc(cfStatusText)}</p>
            ${cfConflictsHtml}
            <p class="settings-tip">需要先绑定 D1 数据库：Cloudflare Dashboard → Workers &amp; Pages → cl-nav → Settings → Bindings → 添加 <strong>D1 database</strong>，变量名填 <code>CL_NAV_DB</code>。首次读取时会把旧 KV 备份自动迁移为 rev 1。未绑定时自动回退旧 KV（整份覆盖，仍可能互相覆盖，不建议长期使用）。GitHub Pages 会走 <code>cl-nav.pages.dev</code> 的接口。</p>
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
          <p class="settings-tip">配置保存在浏览器 localStorage；本地 JSON / WebDAV 备份是这份配置。Cloudflare 云端同步不包含资源库目录（资源库由服务端单独维护，避免旧快照覆盖）。</p>
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

      root.querySelector("#libBatchImportBtn")?.addEventListener("click", async () => {
        if (!window.LibraryStorage?.addLinks && !window.LibraryStorage?.addLink) return;
        this.activeTab = "library";
        const raw = window.prompt(
          "粘贴分享文本（可多段，用空行分隔）。每段第一行作标题，其余识别 http(s) 链接与提取码：",
          ""
        );
        if (raw == null) return;
        const blocks = String(raw)
          .split(/\n\s*\n/)
          .map((b) => b.trim())
          .filter(Boolean);
        const items = [];
        for (const block of blocks) {
          const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          if (!lines.length) continue;
          const urls = [];
          let pwd = "";
          let title = "";
          for (const line of lines) {
            const mPwd = /提取码[:：\s]*([a-zA-Z0-9]{3,8})/.exec(line);
            if (mPwd) pwd = mPwd[1];
            const mUrl = /(https?:\/\/[^\s]+)/i.exec(line);
            if (mUrl) {
              urls.push(mUrl[1].replace(/[)\]>,，。]+$/, ""));
              continue;
            }
            if (!title && !/^https?:\/\//i.test(line) && !/提取码/.test(line)) title = line;
          }
          if (!urls.length) continue;
          items.push({
            title: title || urls[0],
            category: "other",
            links: urls.map((url) => {
              let channel = "other";
              if (/baidu\.com/i.test(url)) channel = "baidu";
              else if (/alipan\.com|aliyundrive\.com/i.test(url)) channel = "aliyun";
              else if (/123pan\.com|123684\.com/i.test(url)) channel = "123";
              else if (/lanzou/i.test(url)) channel = "lanzou";
              return {
                url,
                channel,
                label: pwd && /baidu/i.test(url) ? `提取码 ${pwd}` : "",
              };
            }),
          });
        }
        if (!items.length) {
          setLibStatus("未识别到有效链接", "err");
          return;
        }
        setLibStatus(`正在导入 ${items.length} 条…`);
        try {
          if (window.LibraryStorage.addLinks) {
            await LibraryStorage.addLinks(items);
          } else {
            for (const it of items) await LibraryStorage.addLink(it);
          }
          setLibStatus(`已导入 ${items.length} 条资源`, "ok");
          await this.renderLibraryAdmin(root);
          if (window.LibraryUI?.refreshListQuiet) LibraryUI.refreshListQuiet();
        } catch (err) {
          setLibStatus(err.message || "批量导入失败", "err");
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
        flushAutoBackup();
      });

      root.querySelectorAll("[data-q-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const i = +btn.dataset.qEdit;
          const cur = NavStore.get().quickLinks[i];
          const link = await openLinkDialog(cur, "编辑常用网站");
          if (!link) return;
          this.activeTab = "quick";
          NavStore.updateQuickLink(i, link);
          flushAutoBackup();
        });
      });

      root.querySelectorAll("[data-q-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!confirm("确定删除该常用网站？")) return;
          this.activeTab = "quick";
          NavStore.removeQuickLink(+btn.dataset.qDel);
          flushAutoBackup();
        });
      });

      bindDragSort(root.querySelector("#cfgQuickList"), {
        onReorder: (from, to) => {
          this.activeTab = "quick";
          NavStore.reorderQuickLinks(from, to);
          flushAutoBackup();
        },
      });

      root.querySelector("#cfgAddCat")?.addEventListener("click", () => {
        const name = window.prompt("分类名称", "新分类");
        if (name == null || !name.trim()) return;
        this.activeTab = "cats";
        const cat = NavStore.addCategory(name.trim());
        this.selectedCatId = cat.id;
        this.selectedChildId = "";
        flushAutoBackup();
      });

      root.querySelectorAll("#cfgCatList [data-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.selectedCatId = btn.dataset.cat;
          this.selectedChildId = btn.dataset.child || "";
          this.activeTab = "cats";
          this.render();
        });
      });

      bindCatListDrag(root.querySelector("#cfgCatList"), {
        onReorderParent: (from, to) => {
          this.activeTab = "cats";
          NavStore.reorderCategories(from, to);
          flushAutoBackup();
        },
        onReorderChild: (catId, from, to) => {
          this.activeTab = "cats";
          NavStore.reorderChildren(catId, from, to);
          flushAutoBackup();
        },
        onMoveChildToParent: (fromCatId, childId, toCatId) => {
          this.activeTab = "cats";
          const ok = NavStore.moveChildToParent(fromCatId, childId, toCatId);
          if (ok) {
            this.selectedCatId = toCatId;
            this.selectedChildId = childId;
            flushAutoBackup();
          }
        },
      });

      root.querySelector("#cfgAddChild")?.addEventListener("click", () => {
        if (!this.selectedCatId || this.selectedChildId) return;
        const name = window.prompt("子分类名称", "新子分类");
        if (name == null || !name.trim()) return;
        this.activeTab = "cats";
        const child = NavStore.addChildCategory(this.selectedCatId, name.trim());
        if (child) {
          this.selectedChildId = child.id;
          flushAutoBackup();
        }
      });

      root.querySelector("#cfgRenameCat")?.addEventListener("click", () => {
        const cat = NavStore.get().categories.find((c) => c.id === this.selectedCatId);
        if (!cat) return;
        if (this.selectedChildId) {
          const child = (cat.children || []).find((ch) => ch.id === this.selectedChildId);
          if (!child) return;
          const name = window.prompt("子分类名称", child.name);
          if (name == null || !name.trim()) return;
          this.activeTab = "cats";
          NavStore.updateChildCategory(cat.id, child.id, { name: name.trim() });
          flushAutoBackup();
          return;
        }
        const name = window.prompt("分类名称", cat.name);
        if (name == null || !name.trim()) return;
        this.activeTab = "cats";
        NavStore.updateCategory(cat.id, { name: name.trim() });
        flushAutoBackup();
      });

      root.querySelector("#cfgUpCat")?.addEventListener("click", () => {
        this.activeTab = "cats";
        if (this.selectedChildId) {
          NavStore.moveChildCategory(this.selectedCatId, this.selectedChildId, -1);
        } else {
          NavStore.moveCategory(this.selectedCatId, -1);
        }
        flushAutoBackup();
      });

      root.querySelector("#cfgDownCat")?.addEventListener("click", () => {
        this.activeTab = "cats";
        if (this.selectedChildId) {
          NavStore.moveChildCategory(this.selectedCatId, this.selectedChildId, 1);
        } else {
          NavStore.moveCategory(this.selectedCatId, 1);
        }
        flushAutoBackup();
      });

      root.querySelector("#cfgDelCat")?.addEventListener("click", () => {
        const cat = NavStore.get().categories.find((c) => c.id === this.selectedCatId);
        if (!cat) return;
        if (this.selectedChildId) {
          const child = (cat.children || []).find((ch) => ch.id === this.selectedChildId);
          if (!child) return;
          if (!confirm(`确定删除子分类「${child.name}」及其全部网站？`)) return;
          this.activeTab = "cats";
          NavStore.removeChildCategory(cat.id, child.id);
          this.selectedChildId = "";
          flushAutoBackup();
          return;
        }
        if (!confirm(`确定删除分类「${cat.name}」及其子分类与全部网站？`)) return;
        this.activeTab = "cats";
        NavStore.removeCategory(cat.id);
        this.selectedCatId = "";
        this.selectedChildId = "";
        flushAutoBackup();
      });

      const leafChildId = () => this.selectedChildId || null;

      root.querySelector("#cfgAddLink")?.addEventListener("click", async () => {
        if (!this.selectedCatId) return;
        const link = await openLinkDialog({}, "添加网站");
        if (!link) return;
        this.activeTab = "cats";
        NavStore.addLink(this.selectedCatId, link, leafChildId());
        flushAutoBackup();
      });

      root.querySelectorAll("[data-l-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const i = +btn.dataset.lEdit;
          const leaf = NavStore.resolveLeaf
            ? NavStore.resolveLeaf(NavStore.get().categories, this.selectedCatId, leafChildId())
            : NavStore.get().categories.find((c) => c.id === this.selectedCatId);
          if (!leaf) return;
          const link = await openLinkDialog(leaf.links[i], "编辑网站");
          if (!link) return;
          this.activeTab = "cats";
          NavStore.updateLink(this.selectedCatId, i, link, leafChildId());
          flushAutoBackup();
        });
      });

      root.querySelectorAll("[data-l-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!confirm("确定删除该网站？")) return;
          this.activeTab = "cats";
          NavStore.removeLink(this.selectedCatId, +btn.dataset.lDel, leafChildId());
          flushAutoBackup();
        });
      });

      const syncBatchUi = () => {
        const boxes = [...root.querySelectorAll("[data-l-check]")];
        const checked = boxes.filter((b) => b.checked);
        const all = root.querySelector("#cfgLinkCheckAll");
        const delBtn = root.querySelector("#cfgBatchDelLinks");
        const copyBtn = root.querySelector("#cfgBatchCopyLinks");
        const cutBtn = root.querySelector("#cfgBatchCutLinks");
        const pasteBtn = root.querySelector("#cfgBatchPaste");
        const chip = root.querySelector("#cfgClipChip");
        const clearBtn = root.querySelector("#cfgClipClear");
        const hint = root.querySelector("#cfgBatchHint");
        if (all) {
          all.checked = boxes.length > 0 && checked.length === boxes.length;
          all.indeterminate = checked.length > 0 && checked.length < boxes.length;
        }
        const n = checked.length;
        if (delBtn) delBtn.disabled = n === 0;
        if (copyBtn) copyBtn.disabled = n === 0;
        if (cutBtn) cutBtn.disabled = n === 0;
        if (hint) hint.textContent = `已选 ${n} 项`;
        const cn = clipCount();
        if (pasteBtn) pasteBtn.hidden = cn === 0;
        if (chip) {
          chip.hidden = cn === 0;
          if (cn) chip.textContent = `剪贴板 ${cn} 项（${linkClip.mode === "cut" ? "移动" : "复制"}）`;
        }
        if (clearBtn) clearBtn.hidden = cn === 0;
      };

      /** 把当前选中的卡片索引取出来（升序） */
      const checkedIndices = () =>
        [...root.querySelectorAll("[data-l-check]:checked")]
          .map((b) => +b.dataset.lCheck)
          .sort((a, b) => a - b);

      /** 复制/剪切选中卡片到剪贴板 */
      const clipSelected = (mode) => {
        const indices = checkedIndices();
        if (!indices.length) return;
        const links = NavStore.pickLinks(this.selectedCatId, indices, leafChildId());
        if (!links.length) return;
        setLinkClip(mode, links);
        // 剪切后清空勾选，避免误以为还要再删一次
        root.querySelectorAll("[data-l-check]").forEach((b) => (b.checked = false));
        syncBatchUi();
      };

      /**
       * 把剪贴板内容粘贴到目标分类并刷新。
       * - copy：目标处新增副本，源保持不变。
       * - cut ：目标处新增副本后，按「标题+URL」从源叶子移除原项（= 移动）。
       * 同源同目标时直接拒绝，避免原地增删。
       */
      const pasteTo = async (toCatId, toChildId) => {
        const links = linkClip.links || [];
        if (!links.length) return;
        const mode = linkClip.mode === "cut" ? "cut" : "copy";
        const sameLeaf =
          toCatId === this.selectedCatId &&
          String(toChildId || "") === String(leafChildId() || "");
        if (mode === "cut" && sameLeaf) {
          alert("源分类与目标分类相同，无需移动。");
          return;
        }
        const added = NavStore.copyLinksToCategory(links, toCatId, toChildId);
        if (!added) {
          alert("粘贴失败：目标分类不存在。");
          return;
        }
        if (mode === "cut") {
          // 副本已追加到目标，现在从源叶子移除原项（按标题+URL 匹配）
          const keys = new Set(links.map((l) => `${l.title}\u0000${l.url}`));
          const src = NavStore.resolveLeaf(
            NavStore.get().categories,
            this.selectedCatId,
            leafChildId()
          );
          const idxs = [];
          (src?.links || []).forEach((l, i) => {
            if (keys.has(`${l.title}\u0000${l.url}`)) idxs.push(i);
          });
          if (idxs.length) NavStore.removeLinks(this.selectedCatId, idxs, leafChildId());
        }
        clearLinkClip();
        this.activeTab = "cats";
        flushAutoBackup();
        this.render();
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

      root.querySelector("#cfgBatchCopyLinks")?.addEventListener("click", () => clipSelected("copy"));
      root.querySelector("#cfgBatchCutLinks")?.addEventListener("click", () => clipSelected("cut"));
      root.querySelector("#cfgClipClear")?.addEventListener("click", () => {
        clearLinkClip();
        syncBatchUi();
      });

      root.querySelector("#cfgBatchPaste")?.addEventListener("click", async () => {
        const n = clipCount();
        if (!n) return;
        const target = await openPasteTargetDialog({
          count: n,
          mode: linkClip.mode,
          title: linkClip.mode === "cut" ? "移动到分类" : "复制到分类",
        });
        if (!target) return;
        await pasteTo(target.catId, target.childId);
      });

      // ---- 右键菜单：复制 / 剪切 / 粘贴到该分类 ----
      const menu = root.querySelector("#cfgLinkMenu");
      const hideMenu = () => {
        if (menu) menu.hidden = true;
      };
      const showMenu = (x, y, html, handlers) => {
        if (!menu) return;
        menu.innerHTML = html;
        menu.hidden = false;
        // 视口边界收敛
        const r = menu.getBoundingClientRect();
        const px = Math.min(x, window.innerWidth - r.width - 8);
        const py = Math.min(y, window.innerHeight - r.height - 8);
        menu.style.left = `${Math.max(8, px)}px`;
        menu.style.top = `${Math.max(8, py)}px`;
        Object.entries(handlers).forEach(([key, fn]) => {
          menu.querySelector(`[data-menu="${key}"]`)?.addEventListener("click", () => {
            hideMenu();
            fn();
          });
        });
      };

      root.addEventListener("click", (e) => {
        if (menu && !menu.contains(e.target)) hideMenu();
      });

      root.querySelectorAll(".cfg-item[data-li]").forEach((card) => {
        card.addEventListener("contextmenu", (e) => {
          const idx = +card.dataset.li;
          // 若该卡片已勾选，则整批操作；否则只针对当前卡片
          const box = card.querySelector("[data-l-check]");
          const useBatch = !!box?.checked && checkedIndices().length > 1;
          const indices = useBatch ? checkedIndices() : [idx];
          const label = useBatch ? `${indices.length} 个网站` : "该网站";
          e.preventDefault();
          const cn = clipCount();
          const items = [
            `<button type="button" data-menu="copy">复制${useBatch ? `（${indices.length}）` : ""}</button>`,
            `<button type="button" data-menu="cut">剪切${useBatch ? `（${indices.length}）` : ""}</button>`,
            cn && !useBatch ? `<button type="button" data-menu="paste">粘贴 ${cn} 项到当前分类</button>` : "",
            `<span class="cfg-menu-sep"></span>`,
            `<button type="button" data-menu="edit">编辑</button>`,
            `<button type="button" data-menu="del" class="danger">删除</button>`,
          ].join("");
          showMenu(e.clientX, e.clientY, items, {
            copy: () => {
              const links = NavStore.pickLinks(this.selectedCatId, indices, leafChildId());
              if (!links.length) return;
              setLinkClip("copy", links);
              syncBatchUi();
            },
            cut: () => {
              const links = NavStore.pickLinks(this.selectedCatId, indices, leafChildId());
              if (!links.length) return;
              setLinkClip("cut", links);
              syncBatchUi();
            },
            paste: () => {
              // 粘贴到当前正在查看的叶子：把剪贴板源视为来源，直接复用 pasteTo
              void pasteTo(this.selectedCatId, leafChildId());
            },
            edit: () => {
              root.querySelector(`[data-l-edit="${idx}"]`)?.click();
            },
            del: () => {
              if (!confirm(`确定删除 ${label}？`)) return;
              this.activeTab = "cats";
              NavStore.removeLinks(this.selectedCatId, indices, leafChildId());
              flushAutoBackup();
            },
          });
        });
      });
      // 目标分类上右键 → 直接粘贴到该分类
      root.querySelectorAll(".cfg-cat[data-cat]").forEach((btn) => {
        btn.addEventListener("contextmenu", (e) => {
          const cn = clipCount();
          if (!cn) return; // 没有剪贴板内容时交给浏览器默认菜单
          e.preventDefault();
          const catId = btn.dataset.cat;
          const childId = btn.dataset.child || "";
          const name = (NavStore.get().categories.find((c) => c.id === catId) || {}).name || "";
          const childName = childId
            ? ((NavStore.get().categories.find((c) => c.id === catId) || {}).children || []).find(
                (ch) => ch.id === childId
              )?.name || ""
            : "";
          const where = childName ? `${name} / ${childName}` : name;
          showMenu(
            e.clientX,
            e.clientY,
            `<button type="button" data-menu="paste">粘贴 ${cn} 项到「${esc(where)}」</button>`,
            { paste: () => void pasteTo(catId, childId) }
          );
        });
      });

      document.addEventListener("keydown", function onEsc(e) {
        if (e.key === "Escape") hideMenu();
      });
      root.addEventListener("scroll", hideMenu, true);
      syncBatchUi();

      root.querySelector("#cfgBatchDelLinks")?.addEventListener("click", () => {
        const indices = [...root.querySelectorAll("[data-l-check]:checked")].map((b) => +b.dataset.lCheck);
        if (!indices.length) return;
        if (!confirm(`确定删除选中的 ${indices.length} 个网站？`)) return;
        this.activeTab = "cats";
        NavStore.removeLinks(this.selectedCatId, indices, leafChildId());
        flushAutoBackup();
      });

      bindGridDragSort(root.querySelector("#cfgLinkList"), {
        onReorder: (orderedIndices) => {
          this.activeTab = "cats";
          NavStore.reorderLinksByOrder(this.selectedCatId, orderedIndices, leafChildId());
          flushAutoBackup();
        },
        catListEl: root.querySelector("#cfgCatList"),
        selectedCatId: this.selectedCatId,
        selectedChildId: this.selectedChildId,
        onMoveToCategory: (linkIndex, toCatId, toChildId) => {
          this.activeTab = "cats";
          const ok = NavStore.moveLinkToCategory(
            this.selectedCatId,
            linkIndex,
            toCatId,
            { fromChildId: leafChildId(), toChildId: toChildId || null }
          );
          if (ok) flushAutoBackup();
        },
      });

      try {
        window.Portal?.hydrateFavicons?.(root.querySelector("#cfgLinkList"));
      } catch (_) {}

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
        this.selectedChildId = "";
      });

      const setCfStatus = (text, kind = "") => {
        const el = root.querySelector("#cfStatus");
        if (!el) return;
        el.textContent = text;
        el.className = "cfg-status" + (kind ? " " + kind : "");
      };

      const applyCfResult = (r, fallback) => {
        const list = r && Array.isArray(r.conflicts) ? r.conflicts : [];
        const extra = list.length
          ? "｜自动合并：" +
            list
              .slice(0, 4)
              .map((c) =>
                window.NavSyncMerge ? window.NavSyncMerge.describeConflict(c) : c.path
              )
              .join("；") +
            (list.length > 4 ? " 等 " + list.length + " 处" : "")
          : "";
        const text = ((r && r.message) || fallback || "同步完成") + extra;
        const kind = r && (r.fallback || r.mode === "legacy") ? "warn" : "ok";
        setCfStatus(text, kind);
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
            .then((r) => applyCfResult(r, "同步完成"))
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
        const kind = /成功/.test(msg) ? "ok" : /未绑定|兼容/.test(msg) ? "warn" : "err";
        setCfStatus(msg, kind);
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
          applyCfResult(r, "同步完成");
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
          applyCfResult(r, "上传完成");
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
          applyCfResult(r, "恢复完成");
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
