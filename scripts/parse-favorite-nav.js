const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(
  path.join(__dirname, "..", "_yuque_dump", "favorite-index.html"),
  "utf8"
);

function clean(s) {
  return String(s || "")
    .replace(/&bullet;|&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const categories = [];
const listRe = /<div\s+id=["']([^"']+)["']\s+class=["']jj-list["']>([\s\S]*?)(?=<div\s+id=["'][^"']+["']\s+class=["']jj-list["']>|<\/div>\s*<\/main>|$)/gi;
// Simpler: split by jj-list id blocks
const blocks = html.split(/<div\s+id=["']/i).slice(1);
for (const block of blocks) {
  const idMatch = block.match(/^([^"']+)["']\s+class=["']jj-list["']>/i);
  if (!idMatch) continue;
  const id = idMatch[1];
  const body = block;
  const tit = clean((body.match(/class=["']jj-list-tit["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || id);
  const name = tit.replace(/^[\u2022•\-\s]+/, "").replace(/\s*-\s*.*$/, (m, offset, s) => {
    // keep subtitle lightly: "影 音 - 视频、音乐" -> "影音"
    return "";
  }).replace(/\s+/g, "");
  // Better name cleanup
  let displayName = tit
    .replace(/^[\u2022•\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  // "求 职" -> "求职", "影 音 - 视频、音乐" -> "影音"
  displayName = displayName.replace(/\s*-\s*.+$/, "").replace(/\s+/g, "");

  const links = [];
  const seen = new Set();
  const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let lm;
  while ((lm = liRe.exec(body)) !== null) {
    const liAttrs = lm[1];
    const liInner = lm[2];
    const href = ((liInner.match(/<a\b[^>]*href=["']([^"']+)["']/i) || [])[1] || "").trim();
    if (!/^https?:\/\//i.test(href)) continue;
    let title = clean((liInner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || "");
    // remove leftover after img alt text already cleaned
    title = title.replace(/\s+/g, " ").trim();
    if (!title) continue;
    const desc = clean((liAttrs.match(/title=["']([^"']+)["']/i) || [])[1] || "");
    const key = href.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      title,
      url: href,
      desc: desc || title,
      domain: domainOf(href),
    });
  }
  if (links.length) categories.push({ id, name: displayName || id, links });
}

console.log(categories.map((c) => `${c.id}\t${c.name}\t${c.links.length}`).join("\n"));
console.log("total", categories.reduce((n, c) => n + c.links.length, 0));

fs.writeFileSync(
  path.join(__dirname, "..", "_yuque_dump", "parsed-nav.json"),
  JSON.stringify(
    {
      source: "https://github.com/xiaochenbian-new/favorite (小城边-个人导航)",
      note: "语雀主页为数字花园动态页，公开接口无法拉取导航明细；已同步作者同系列公开导航站内容",
      yuque: "https://www.yuque.com/xiaochenbian",
      categories,
    },
    null,
    2
  )
);
