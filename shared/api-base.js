/** CL Nav — API origin（GitHub Pages 无 Functions，跨域走 Cloudflare Pages） */
(function () {
  const CF_ORIGIN = "https://cl-nav.pages.dev";

  function origin() {
    try {
      if (typeof location === "undefined") return CF_ORIGIN;
      if (location.protocol === "file:") return CF_ORIGIN;
      const host = String(location.hostname || "");
      if (/\.github\.io$/i.test(host)) return CF_ORIGIN;
      // 本机静态预览也没有 Pages Functions
      if (host === "localhost" || host === "127.0.0.1") return CF_ORIGIN;
      return "";
    } catch {
      return CF_ORIGIN;
    }
  }

  function url(path) {
    const p = String(path || "");
    const normalized = p.startsWith("/") ? p : "/" + p;
    return origin() + normalized;
  }

  function isCrossOrigin() {
    return !!origin();
  }

  window.ClNavApi = {
    CF_ORIGIN,
    origin,
    url,
    isCrossOrigin,
  };
})();
