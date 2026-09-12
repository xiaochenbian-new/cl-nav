/**
 * Merge 小城边导航 into cl-nav shared/data.js defaults.
 * Source: author's public nav (favorite) — Yuque garden itself is not scrapable.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const parsed = JSON.parse(
  fs.readFileSync(path.join(root, "_yuque_dump", "parsed-nav.json"), "utf8")
);

// Evaluate current data.js
const dataCode = fs.readFileSync(path.join(root, "shared", "data.js"), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(dataCode, sandbox);
const NAV = sandbox.window.NAV_DATA;

function linkKey(l) {
  return String(l.url || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
}

function normalize(l) {
  let domain = l.domain || "";
  if (!domain && l.url) {
    try {
      domain = new URL(l.url).hostname.replace(/^www\./, "");
    } catch (_) {}
  }
  return {
    title: String(l.title || "").trim(),
    url: String(l.url || "").trim(),
    desc: String(l.desc || l.title || "").trim(),
    domain,
  };
}

function mergeLinks(a, b) {
  const map = new Map();
  [...(a || []), ...(b || [])].forEach((raw) => {
    const l = normalize(raw);
    const k = linkKey(l);
    if (!k || !l.title) return;
    const prev = map.get(k);
    if (!prev) map.set(k, l);
    else {
      map.set(k, {
        title: (l.title.length >= prev.title.length ? l.title : prev.title) || prev.title,
        url: prev.url || l.url,
        desc: (l.desc && l.desc !== l.title && l.desc.length >= (prev.desc || "").length
          ? l.desc
          : prev.desc || l.desc || prev.title),
        domain: prev.domain || l.domain,
      });
    }
  });
  return [...map.values()];
}

/** Map 小城边分组 → CL Nav 分类 id */
const MAP = {
  sns: "office", // 知识库/笔记/脑图 → 办公（语雀等到资源也补一份通用入口在 resource）
  devops: "tools",
  cloud: "ai",
  server: "cloud",
  life: "tools",
  "idea-plug": "tools",
  job: "job",
  media: "media", // new
  other: "resource",
};

// Extra: 知识库里的社区向链接也进 community / resource
const EXTRA_RULES = [
  { test: /juejin|csdn|zhihu|processon|zhixi/i, cats: ["community", "office"] },
  { test: /yuque|youdao|note/i, cats: ["office", "resource"] },
  { test: /github|gitee/i, cats: ["common", "community"] },
  { test: /bilibili|douyin|youtube|iqiyi|youku|music|qq\.com\/music|kugou|netease/i, cats: ["media"] },
];

const cats = { ...NAV.categories };
// ensure media category
if (!cats.media) {
  cats.media = { title: "影音", links: [] };
}

for (const src of parsed.categories) {
  const targetId = MAP[src.id] || "resource";
  if (!cats[targetId]) {
    cats[targetId] = { title: src.name, links: [] };
  }
  cats[targetId].links = mergeLinks(cats[targetId].links, src.links);

  // dual-home some links
  for (const link of src.links) {
    for (const rule of EXTRA_RULES) {
      if (rule.test.test(link.url) || rule.test.test(link.title)) {
        for (const cid of rule.cats) {
          if (!cats[cid]) continue;
          cats[cid].links = mergeLinks(cats[cid].links, [link]);
        }
      }
    }
  }
}

// side menu: insert 影音 before 资源
const sideMenu = [...NAV.sideMenu];
if (!sideMenu.some((s) => s.id === "media")) {
  const idx = sideMenu.findIndex((s) => s.id === "resource");
  sideMenu.splice(idx >= 0 ? idx : sideMenu.length, 0, { id: "media", name: "影音" });
}

// Build new data.js text carefully — rewrite categories + sideMenu only via JSON embed
const outNav = {
  ...NAV,
  sideMenu,
  categories: cats,
  _meta: {
    syncedFrom: parsed.source,
    yuque: parsed.yuque,
    syncedAt: new Date().toISOString(),
  },
};

// Serialize data.js
function dump(obj, indent = 2) {
  return JSON.stringify(obj, null, indent);
}

const file = `/** CL Nav — site data (含小城边公开导航同步) */
window.NAV_DATA = ${dump(outNav).replace(/"([^"]+)":/g, "$1:")};
`;

// The unquoted key replace is risky for URLs with colons - DON'T do that.
// Use proper JSON assigned form instead which is valid JS:
const file2 = `/** CL Nav — site data
 * 已合并「小城边」公开个人导航（GitHub favorite）。
 * 语雀主页 https://www.yuque.com/xiaochenbian 为数字花园动态页，无法直接抓取明细。
 */
window.NAV_DATA = ${JSON.stringify(outNav, null, 2)};

window.navFavicon = (domain) =>
  \`https://icons.duckduckgo.com/ip3/\${encodeURIComponent(domain)}.ico\`;
`;

fs.writeFileSync(path.join(root, "shared", "data.js"), file2);

const stats = Object.fromEntries(
  Object.entries(cats).map(([id, c]) => [id, (c.links || []).length])
);
console.log("sideMenu", sideMenu.map((s) => s.name).join(" / "));
console.log("counts", stats);
console.log("total links", Object.values(cats).reduce((n, c) => n + (c.links || []).length, 0));
fs.writeFileSync(
  path.join(root, "_yuque_dump", "merged-stats.json"),
  JSON.stringify({ sideMenu, stats, meta: outNav._meta }, null, 2)
);
