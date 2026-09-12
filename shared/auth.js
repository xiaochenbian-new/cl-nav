/** CL Nav — 简单登录（设置页门禁） */
(function () {
  const KEY = "cl-nav-auth-v1";
  const USER = "xiaochenbian";
  const PASS = "xiaochenbian";

  window.NavAuth = {
    isLoggedIn() {
      try {
        return sessionStorage.getItem(KEY) === "1";
      } catch {
        return false;
      }
    },

    login(username, password) {
      const u = String(username || "").trim();
      const p = String(password || "");
      if (u === USER && p === PASS) {
        try {
          sessionStorage.setItem(KEY, "1");
        } catch (_) {}
        return true;
      }
      return false;
    },

    logout() {
      try {
        sessionStorage.removeItem(KEY);
      } catch (_) {}
    },

    requireLogin(onOk) {
      if (this.isLoggedIn()) {
        if (typeof onOk === "function") onOk();
        return true;
      }
      if (window.NavLoginUI?.open) {
        NavLoginUI.open(onOk);
        return false;
      }
      alert("请先登录后再进入设置");
      return false;
    },
  };
})();
