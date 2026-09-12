const { ClassicLevel } = require("classic-level");
const fs = require("fs");
const path = require("path");
const os = require("os");

async function readDb(dbPath) {
  // Chrome locks the DB — copy to temp
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clnav-ls-"));
  for (const f of fs.readdirSync(dbPath)) {
    try {
      fs.copyFileSync(path.join(dbPath, f), path.join(tmp, f));
    } catch (_) {}
  }
  // remove LOCK
  try {
    fs.unlinkSync(path.join(tmp, "LOCK"));
  } catch (_) {}

  const db = new ClassicLevel(tmp, { keyEncoding: "buffer", valueEncoding: "buffer" });
  await db.open();
  const found = [];
  for await (const [key, value] of db.iterator()) {
    const ks = key.toString("utf8");
    if (ks.includes("cl-nav-config")) {
      found.push({ key: ks, value });
    }
    // also utf16 key?
    const k16 = key.toString("utf16le");
    if (k16.includes("cl-nav-config")) {
      found.push({ key: k16, value });
    }
  }
  await db.close();
  return found;
}

function decodeValue(value) {
  // try utf16le json
  const u16 = value.toString("utf16le");
  const i16 = u16.indexOf("{");
  if (i16 >= 0) {
    const j = u16.lastIndexOf("}");
    try {
      const obj = JSON.parse(u16.slice(i16, j + 1));
      if (obj?.categories) return obj;
    } catch (_) {}
  }
  const u8 = value.toString("utf8");
  const i8 = u8.indexOf("{");
  if (i8 >= 0) {
    try {
      const obj = JSON.parse(u8.slice(i8, u8.lastIndexOf("}") + 1));
      if (obj?.categories) return obj;
    } catch (_) {}
  }
  // strip leading non-json bytes then utf16
  for (let off = 0; off < Math.min(32, value.length); off++) {
    if (value[off] === 0x7b && value[off + 1] === 0x00) {
      const text = value.slice(off).toString("utf16le");
      try {
        return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
      } catch (_) {}
    }
    if (value[off] === 0x7b) {
      const text = value.slice(off).toString("utf8");
      try {
        return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
      } catch (_) {}
    }
  }
  return null;
}

(async () => {
  const dbPath =
    process.env.LOCALAPPDATA +
    "/Google/Chrome/User Data/Default/Local Storage/leveldb";
  try {
    const found = await readDb(dbPath);
    console.log("found keys", found.length);
    for (const f of found) {
      console.log("key", JSON.stringify(f.key).slice(0, 120), "vlen", f.value.length);
      console.log("vhead", [...f.value.slice(0, 40)].map((b) => b.toString(16).padStart(2, "0")).join(" "));
      const obj = decodeValue(f.value);
      if (obj?.categories) {
        const out = path.join(__dirname, "..", "user-config.json");
        fs.writeFileSync(out, JSON.stringify(obj, null, 2));
        console.log(
          "WROTE",
          out,
          "cats",
          obj.categories.length,
          "links",
          obj.categories.reduce((n, c) => n + (c.links?.length || 0), 0),
          "quick",
          (obj.quickLinks || []).length
        );
        process.exit(0);
      }
    }
    console.log("decode failed");
    process.exit(2);
  } catch (e) {
    console.error("ERR", e);
    process.exit(1);
  }
})();
