/**
 * CL Nav — 同步状态机（与运行环境无关，便于单测）
 *
 * 协议：服务端为每个同步口令维护一份文档 + 单调递增 rev。
 *   - 读取：GET  → { rev, doc, writer }
 *   - 提交：PUT  { baseRev, doc, deviceId }
 *       baseRev === 当前 rev → 原子写入，rev + 1
 *       baseRev !== 当前 rev → 409 + 云端最新文档，客户端三方合并后重试
 *
 * 这样每次提交都是「基于某个确切版本」的 CAS：
 * 旧设备不可能再无声覆盖新版本，冲突会显式暴露并自动合并。
 *
 * 依赖注入（cf-sync.js 提供真实实现，测试里用内存实现）：
 *   getRemote(): Promise<{rev, doc, writer}|null>
 *   putRemote(baseRev, doc): Promise<{ok:true, rev}|{conflict:true, rev, doc, writer, error?}>
 *   applyRemote(doc): Promise<void>
 *   exportLocal(): object
 *   getBase(): {rev, doc}|null
 *   setBase(rev, doc): void
 *   hasUserData(): boolean
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NavSyncEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_MAX_RETRIES = 6;

  function resolveMerge(deps) {
    if (deps && deps.merge) return deps.merge;
    if (typeof globalThis !== "undefined" && globalThis.NavSyncMerge) return globalThis.NavSyncMerge;
    if (typeof require === "function") return require("./sync-merge.js");
    throw new Error("合并引擎 NavSyncMerge 未加载");
  }

  function createSyncEngine(deps) {
    if (!deps || typeof deps !== "object") throw new Error("createSyncEngine 需要 deps");
    const M = resolveMerge(deps);
    const maxRetries = Math.max(1, Number(deps.maxRetries) || DEFAULT_MAX_RETRIES);

    function remoteFromConflict(res) {
      if (!res || res.ok) return null;
      if (!res.conflict) throw new Error((res && res.error) || "云端提交失败");
      const rev = Number(res.rev) || 0;
      if (rev > 0 && !res.doc) {
        // 防御：绝不能把“缺失的云端文档”当成空文档去合并，否则会误删数据
        throw new Error("云端冲突响应缺少文档，已中止本次同步");
      }
      return {
        rev,
        doc: res.doc || null,
        writer: res.writer || "",
      };
    }

    function conflictSummary(conflicts) {
      return (conflicts || [])
        .slice(0, 6)
        .map((c) => M.describeConflict(c))
        .join("；");
    }

    /**
     * 提交成功后更新本机。
     * 如果同步期间本机又产生了新编辑（local 已不是提交时的快照），
     * 不能把 merged 当成新的 base（它不是新编辑的祖先），
     * 否则下一轮会把远端改动又“改回去”。此时保留旧 base，等下一轮重新三方合并。
     */
    async function applyAfterCommit(snapshot, doc, rev) {
      const current = deps.exportLocal();
      if (!M.sameDoc(current, snapshot)) return false;
      // 本地已经等于合并结果时不要再 apply：无意义的 store 重绘会打断设置面板输入
      if (!M.sameDoc(current, doc)) await deps.applyRemote(doc);
      deps.setBase(rev, doc);
      return true;
    }

    async function sync(mode) {
      let base = deps.getBase() || null;
      let local = deps.exportLocal();
      let remote = await deps.getRemote();

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // 1) 云端还没有任何数据：建立 rev 1
        if (!remote) {
          const res = await deps.putRemote(0, local);
          if (res && res.ok) {
            deps.setBase(res.rev, local);
            return { message: "已上传到云端（rev " + res.rev + "）", pushed: true, rev: res.rev };
          }
          remote = remoteFromConflict(res);
          continue;
        }

        // 2) 本机还没有 base：首次连接
        if (!base || !(Number(base.rev) > 0)) {
          if (M.sameDoc(local, remote.doc)) {
            deps.setBase(remote.rev, remote.doc);
            return { message: "已连接云端（rev " + remote.rev + "）", rev: Number(remote.rev) };
          }
          if (!deps.hasUserData()) {
            if (M.sameDoc(deps.exportLocal(), local)) {
              await deps.applyRemote(remote.doc);
              deps.setBase(remote.rev, remote.doc);
            }
            return { message: "已从云端同步到本机（rev " + remote.rev + "）", pulled: true, rev: Number(remote.rev) };
          }

          // 两边都有数据：没有共同祖先，按并集合并（只增不删，绝不丢数据）
          const merged = M.merge3(null, remote.doc, local);
          const res = await deps.putRemote(remote.rev, merged.doc);
          if (res && res.ok) {
            const applied = await applyAfterCommit(local, merged.doc, res.rev);
            return {
              message:
                "首次连接：已合并本机与云端（rev " +
                res.rev +
                (merged.conflicts.length ? "，自动解决 " + merged.conflicts.length + " 处冲突" : "") +
                (applied ? "" : "；本机仍有新编辑，稍后继续同步") +
                "）",
              pushed: true,
              rev: res.rev,
              conflicts: merged.conflicts,
            };
          }
          remote = remoteFromConflict(res);
          continue;
        }

        // 3) 云端版本比本机 base 还旧（换库/回滚）：丢弃 base，按首次连接安全合并
        if (Number(remote.rev) < Number(base.rev)) {
          base = null;
          continue;
        }

        // 4) 云端没变：本机有改动就提交
        if (Number(remote.rev) === Number(base.rev)) {
          if (M.sameDoc(local, base.doc)) {
            return { message: "已是最新（rev " + base.rev + "）", rev: Number(base.rev), pending: false };
          }
          const res = await deps.putRemote(base.rev, local);
          if (res && res.ok) {
            deps.setBase(res.rev, local);
            return { message: "已同步到云端（rev " + res.rev + "）", pushed: true, rev: res.rev };
          }
          remote = remoteFromConflict(res);
          continue;
        }

        // 5) 云端领先：三方合并
        const merged = M.merge3(base.doc, remote.doc, local);
        const localChanged = !M.sameDoc(local, base.doc);

        // 合并结果就是云端当前版本：直接采用，不再多写一版
        if (M.sameDoc(merged.doc, remote.doc)) {
          let applied = M.sameDoc(local, remote.doc);
          if (!applied && M.sameDoc(deps.exportLocal(), local)) {
            await deps.applyRemote(remote.doc);
            applied = true;
          }
          if (applied) deps.setBase(remote.rev, remote.doc);
          return {
            message:
              (localChanged ? "本机改动已包含在云端最新版本中" : "已从云端同步到本机") +
              "（rev " +
              remote.rev +
              "）",
            pulled: true,
            rev: Number(remote.rev),
            pending: !applied,
            conflicts: merged.conflicts,
          };
        }

        const res = await deps.putRemote(remote.rev, merged.doc);
        if (res && res.ok) {
          const applied = await applyAfterCommit(local, merged.doc, res.rev);
          return {
            message:
              (localChanged ? "已合并并同步到云端" : "已同步到云端") +
              "（rev " +
              res.rev +
              (merged.conflicts.length ? "，自动解决冲突 " + merged.conflicts.length + " 处" : "") +
              (applied ? "" : "；本机仍有新编辑，稍后继续同步") +
              "）",
            pushed: true,
            pulled: Number(remote.rev) > Number(base.rev),
            rev: res.rev,
            conflicts: merged.conflicts,
          };
        }
        remote = remoteFromConflict(res);
      }

      throw new Error("云端并发冲突重试次数过多，请稍后再试");
    }

    return { sync, conflictSummary };
  }

  return { createSyncEngine, DEFAULT_MAX_RETRIES };
});
