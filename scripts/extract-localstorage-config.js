const fs = require("fs");
const path = require("path");

const needle = Buffer.from("cl-nav-config", "utf8");
const needle16 = Buffer.from("c\0l\0-\0n\0a\0v\0-\0c\0o\0n\0f\0i\0g", "utf8");

const roots = [
  path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data"),
  path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "User Data"),
];

function scanDir(dir, hits) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "Cache" || ent.name === "Code Cache" || ent.name === "GPUCache") continue;
      if (dir.includes("Local Storage") && ent.name === "leveldb") {
        scanLeveldb(p, hits);
      } else if (!dir.includes("Local Storage\\leveldb")) {
        // only descend into profile folders and Local Storage
        if (
          /^(Default|Profile \d+|Guest Profile)$/i.test(ent.name) ||
          ent.name === "Local Storage" ||
          dir.endsWith("User Data")
        ) {
          scanDir(p, hits);
        }
      }
    }
  }
}

function scanLeveldb(dir, hits) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    if (!/\.(ldb|log)$/i.test(f)) continue;
    let buf;
    try {
      buf = fs.readFileSync(path.join(dir, f));
    } catch {
      continue;
    }
    for (const n of [needle, needle16]) {
      let idx = buf.indexOf(n);
      while (idx >= 0) {
        hits.push({ file: path.join(dir, f), idx, enc: n === needle ? "utf8" : "utf16" });
        idx = buf.indexOf(n, idx + 1);
      }
    }
  }
}

function extractJson(buf, from, enc) {
  // find first { after key
  let start = -1;
  if (enc === "utf8") {
    start = buf.indexOf(0x7b, from); // {
  } else {
    // { as 7b 00
    for (let i = from; i < buf.length - 1; i++) {
      if (buf[i] === 0x7b && buf[i + 1] === 0x00) {
        start = i;
        break;
      }
    }
  }
  if (start < 0) return null;

  if (enc === "utf16") {
    const chars = [];
    for (let i = start; i < Math.min(buf.length - 1, start + 8_000_000); i += 2) {
      const code = buf[i] | (buf[i + 1] << 8);
      if (code === 0) break;
      chars.push(String.fromCharCode(code));
      const s = chars.join("");
      if (chars.length > 20 && chars.length % 1000 === 0) {
        try {
          const obj = JSON.parse(s);
          if (obj && Array.isArray(obj.categories)) return obj;
        } catch (_) {}
      }
    }
    const s = chars.join("");
    // try trim to last }
    const last = s.lastIndexOf("}");
    if (last > 0) {
      try {
        return JSON.parse(s.slice(0, last + 1));
      } catch (_) {}
    }
    return null;
  }

  // utf8 brace match
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === 0x5c) esc = true;
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x7b) depth++;
    else if (c === 0x7d) {
      depth--;
      if (depth === 0) {
        const text = buf.slice(start, i + 1).toString("utf8");
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const hits = [];
for (const r of roots) {
  if (fs.existsSync(r)) scanDir(r, hits);
}
console.log("hits", hits.length);
hits.slice(0, 20).forEach((h) => console.log(h.enc, h.idx, h.file));

for (const h of hits) {
  const buf = fs.readFileSync(h.file);
  const obj = extractJson(buf, h.idx, h.enc);
  if (obj && Array.isArray(obj.categories)) {
    const out = path.join(__dirname, "..", "user-config.json");
    fs.writeFileSync(out, JSON.stringify(obj, null, 2));
    console.log(
      "WROTE",
      out,
      "cats",
      obj.categories.length,
      "links",
      obj.categories.reduce((n, c) => n + (c.links || []).length, 0)
    );
    process.exit(0);
  }
}
console.log("NO_CONFIG_FOUND");
process.exit(2);
