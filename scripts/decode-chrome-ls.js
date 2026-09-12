const fs = require("fs");
const path = require("path");
const snappy = require("snappy");

const file =
  "C:/Users/16372/AppData/Local/Google/Chrome/User Data/Default/Local Storage/leveldb/000474.ldb";
const buf = fs.readFileSync(file);
const key = Buffer.from("cl-nav-config-v1", "utf8");

function tryParseUtf16(buf, start) {
  // find 7b 00
  let s = -1;
  for (let i = start; i < Math.min(buf.length - 1, start + 100); i++) {
    if (buf[i] === 0x7b && buf[i + 1] === 0x00) {
      s = i;
      break;
    }
  }
  if (s < 0) return null;

  // Collect code units; when we hit suspicious non-ascii patterns that break JSON, try recovery
  const chars = [];
  for (let i = s; i + 1 < buf.length; i += 2) {
    const lo = buf[i];
    const hi = buf[i + 1];
    const code = lo | (hi << 8);
    chars.push(code);
  }

  // Method: extract only plausible UTF-16 JSON by walking with a state machine that
  // skips compression islands (bytes that don't form valid continuation)
  // Simpler: convert all, then take substring from { to last } and fix replacement chars

  let str = String.fromCharCode(...chars.slice(0, Math.min(chars.length, 2_000_000)));
  // If string has many \u0000 early issues, fail
  const first = str.indexOf("{");
  if (first < 0) return null;
  str = str.slice(first);

  // Try progressive parse: find matching braces ignoring strings
  for (let end = str.lastIndexOf("}"); end > 100; end = str.lastIndexOf("}", end - 1)) {
    const cand = str.slice(0, end + 1);
    try {
      const obj = JSON.parse(cand);
      if (obj && Array.isArray(obj.categories)) return obj;
    } catch (_) {}
  }
  return null;
}

function snappyAttempts(buf, keyIdx) {
  const results = [];
  // try decompress from various offsets after key
  for (let off = 0; off < 40; off++) {
    const start = keyIdx + key.length + off;
    for (const len of [null, 10000, 50000, 200000, 500000]) {
      try {
        const slice = len ? buf.slice(start, start + len) : buf.slice(start);
        const out = snappy.uncompressSync(slice);
        results.push({ off, len, outLen: out.length, head: out.slice(0, 40).toString("utf8") });
        const text = out.toString("utf16le");
        if (text.includes('"categories"')) {
          const i = text.indexOf("{");
          const j = text.lastIndexOf("}");
          if (i >= 0 && j > i) {
            try {
              const obj = JSON.parse(text.slice(i, j + 1));
              if (obj.categories) return { obj, off, len };
            } catch (_) {}
          }
        }
        const text8 = out.toString("utf8");
        if (text8.includes('"categories"')) {
          const i = text8.indexOf("{");
          const j = text8.lastIndexOf("}");
          if (i >= 0 && j > i) {
            try {
              const obj = JSON.parse(text8.slice(i, j + 1));
              if (obj.categories) return { obj, off, len };
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
  }
  console.log("snappy sample", results.slice(0, 5));
  return null;
}

let idx = 0;
let n = 0;
while ((idx = buf.indexOf(key, idx)) >= 0 && n < 10) {
  console.log("\n=== hit", idx, "===");
  const r = snappyAttempts(buf, idx);
  if (r?.obj) {
    const out = path.join(__dirname, "..", "user-config.json");
    fs.writeFileSync(out, JSON.stringify(r.obj, null, 2));
    console.log("SUCCESS", out, r.obj.categories.length);
    process.exit(0);
  }
  const obj = tryParseUtf16(buf, idx + key.length);
  if (obj) {
    const out = path.join(__dirname, "..", "user-config.json");
    fs.writeFileSync(out, JSON.stringify(obj, null, 2));
    console.log("SUCCESS utf16", out, obj.categories.length);
    process.exit(0);
  }
  idx++;
  n++;
}
console.log("failed");
