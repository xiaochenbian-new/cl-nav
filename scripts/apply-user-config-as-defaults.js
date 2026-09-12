/**
 * Apply user-config.json (current browser config) as built-in defaults in shared/data.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const userPath = path.join(root, "user-config.json");
if (!fs.existsSync(userPath)) {
  console.error("Missing user-config.json");
  process.exit(1);
}

const user = JSON.parse(fs.readFileSync(userPath, "utf8"));
const dataCode = fs.readFileSync(path.join(root, "shared", "data.js"), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(dataCode, sandbox);
const prev = sandbox.window.NAV_DATA || {};

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normLink(l) {
  const url = String(l.url || "").trim();
  return {
    title: String(l.title || "").trim(),
    url,
    desc: String(l.desc || "").trim(),
    domain: String(l.domain || domainOf(url) || "").trim(),
  };
}

const categoriesArr = (user.categories || []).map((c) => ({
  id: c.id,
  name: c.name,
  links: (c.links || []).map(normLink),
}));

const sideMenu = categoriesArr.map((c) => ({ id: c.id, name: c.name }));

const categories = {};
for (const c of categoriesArr) {
  categories[c.id] = {
    title: c.name,
    links: c.links,
  };
}

const quickLinks = (user.quickLinks || []).map(normLink);
const hotTags = quickLinks.map((l) => ({
  label: l.title,
  query: l.title,
  url: l.url,
}));

const out = {
  brand: user.brand || prev.brand || "CL Nav",
  tagline: user.tagline || prev.tagline || "开发者工具导航",
  navTabs: prev.navTabs || [
    { id: "library", name: "资源库", href: "#resource", action: "route", target: "resource" },
    { id: "settings", name: "设置", href: "#settings", action: "settings" },
  ],
  engines: user.engines?.length ? user.engines : prev.engines,
  hotTags,
  sideMenu,
  quick: quickLinks,
  categories,
  _meta: {
    capturedFromUserConfig: true,
    capturedAt: new Date().toISOString(),
    categoryCount: sideMenu.length,
    linkCount: categoriesArr.reduce((n, c) => n + c.links.length, 0),
    quickCount: quickLinks.length,
  },
};

// Fix navTabs target if resource id missing — point library to last or first cat
const lib = out.navTabs.find((t) => t.id === "library");
if (lib) {
  const prefer =
    sideMenu.find((s) => s.id === "resource" || (s.name || "").includes("资源")) ||
    sideMenu[sideMenu.length - 1] ||
    sideMenu[0];
  if (prefer) {
    lib.target = prefer.id;
    lib.href = `#${prefer.id}`;
  }
}

const file = `/** CL Nav — site data
 * 默认内置站点来自用户当前配置快照（${out._meta.capturedAt}）
 * 分类 ${out._meta.categoryCount} 个，网站 ${out._meta.linkCount} 个，常用 ${out._meta.quickCount} 个
 */
window.NAV_DATA = ${JSON.stringify(out, null, 2)};

window.navFavicon = (domain) =>
  \`https://icons.duckduckgo.com/ip3/\${encodeURIComponent(domain)}.ico\`;
`;

fs.writeFileSync(path.join(root, "shared", "data.js"), file);
console.log("Updated shared/data.js");
console.log(
  "categories:",
  sideMenu.map((s) => `${s.name}(${categories[s.id].links.length})`).join(", ")
);
console.log("quickLinks:", quickLinks.map((l) => l.title).join(", "));
