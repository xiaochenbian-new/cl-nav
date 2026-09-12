/** CL Nav — 登录弹层 */
(function () {
  function ensureDom() {
    let panel = document.getElementById("loginPanel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "loginPanel";
    panel.className = "login-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="login-card" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <div class="login-head">
          <strong id="loginTitle">登录后进入设置</strong>
          <button type="button" id="loginClose" aria-label="关闭">×</button>
        </div>
        <form class="login-body" id="loginForm" autocomplete="on">
          <label>
            <span>账号</span>
            <input type="text" id="loginUser" name="username" autocomplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input type="password" id="loginPass" name="password" autocomplete="current-password" required />
          </label>
          <p class="login-status" id="loginStatus"></p>
          <div class="login-actions">
            <button type="submit" class="cfg-btn primary" id="loginSubmit">登录</button>
            <button type="button" class="cfg-btn" id="loginCancel">取消</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(panel);
    return panel;
  }

  let pendingOk = null;

  window.NavLoginUI = {
    open(onOk) {
      pendingOk = typeof onOk === "function" ? onOk : null;
      const panel = ensureDom();
      panel.hidden = false;
      const status = document.getElementById("loginStatus");
      if (status) {
        status.textContent = "";
        status.className = "login-status";
      }
      const user = document.getElementById("loginUser");
      const pass = document.getElementById("loginPass");
      if (user) user.value = "";
      if (pass) pass.value = "";
      setTimeout(() => user?.focus(), 30);
      this.bindOnce();
    },

    close() {
      const panel = document.getElementById("loginPanel");
      if (panel) panel.hidden = true;
      pendingOk = null;
    },

    bindOnce() {
      const panel = document.getElementById("loginPanel");
      if (!panel || panel.dataset.bound === "1") return;
      panel.dataset.bound = "1";

      const finishOk = () => {
        const cb = pendingOk;
        pendingOk = null;
        panel.hidden = true;
        if (cb) cb();
      };

      document.getElementById("loginClose")?.addEventListener("click", () => this.close());
      document.getElementById("loginCancel")?.addEventListener("click", () => this.close());
      panel.addEventListener("click", (e) => {
        if (e.target.id === "loginPanel") this.close();
      });
      document.getElementById("loginForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const u = document.getElementById("loginUser")?.value || "";
        const p = document.getElementById("loginPass")?.value || "";
        const status = document.getElementById("loginStatus");
        if (!window.NavAuth?.login(u, p)) {
          if (status) {
            status.textContent = "账号或密码错误";
            status.className = "login-status err";
          }
          return;
        }
        if (status) {
          status.textContent = "登录成功";
          status.className = "login-status ok";
        }
        finishOk();
      });
    },
  };
})();
