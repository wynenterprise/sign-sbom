// Minimal dependency-free glob over node:fs (works on Node 18+).
// Supported: *  ?  **  [abc] [a-z] [!a]  {a,b} (not nested).
// Matches regular files only. Dot entries and node_modules are skipped unless the
// pattern segment names them explicitly. Directory symlinks are not followed.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAGIC = /[*?[{]/;
const SKIP_DIRS = new Set(["node_modules"]);
// Windows file systems are case-insensitive; matching and de-duplication follow that.
export const IGNORE_CASE = process.platform === "win32";

export function hasMagic(pattern) {
  return MAGIC.test(pattern);
}

// Expand {a,b} groups (one level). Returns an array of patterns without braces.
function expandBraces(pattern) {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  const close = pattern.indexOf("}", open);
  if (close === -1) return [pattern];
  const body = pattern.slice(open + 1, close);
  if (body.includes("{")) {
    throw new Error(`Nested braces are not supported: ${pattern}`);
  }
  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);
  return body
    .split(",")
    .flatMap((alt) => expandBraces(head + alt + tail));
}

// Compile one path segment (no "/") into a RegExp.
function segmentToRegExp(seg) {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "[") {
      const end = seg.indexOf("]", i + 2);
      if (end === -1) {
        re += "\\[";
      } else {
        let cls = seg.slice(i + 1, end);
        if (cls[0] === "!") cls = "^" + cls.slice(1);
        re += `[${cls.replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else {
      re += c.replace(/[.+^${}()|\\/]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, IGNORE_CASE ? "i" : "");
}

function splitRoot(pattern) {
  const m = /^([A-Za-z]:\/|\/)/.exec(pattern);
  if (m) return [m[1], pattern.slice(m[1].length)];
  return ["", pattern];
}

function isRegularFile(dir, ent) {
  if (ent.isFile()) return true;
  if (ent.isSymbolicLink()) {
    try {
      return statSync(join(dir, ent.name)).isFile();
    } catch {
      return false;
    }
  }
  return false;
}

function readEntriesUncached(dir) {
  try {
    return readdirSync(dir || ".", { withFileTypes: true });
  } catch {
    return [];
  }
}

function joinPath(dir, name) {
  if (!dir) return name;
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

function globOne(pattern, out) {
  const [root, rest] = splitRoot(pattern);
  const segs = rest.split("/").filter((s) => s !== "" && s !== ".");

  // The static leading segments are walked as a plain path, not scanned.
  let i = 0;
  let base = root;
  while (i < segs.length - 1 && !MAGIC.test(segs[i])) {
    base = joinPath(base, segs[i]);
    i++;
  }
  const rest2 = segs.slice(i);
  if (rest2.length === 0) return;

  // With ** in the middle the same directory is visited for "zero levels" and while
  // descending; cache the listings so each directory is read once per pattern.
  const listings = new Map();
  const readEntries = (dir) => {
    let entries = listings.get(dir);
    if (!entries) {
      entries = readEntriesUncached(dir);
      listings.set(dir, entries);
    }
    return entries;
  };

  const matchers = rest2.map((s) => (s === "**" ? null : segmentToRegExp(s)));
  const explicitDot = rest2.map((s) => s.startsWith("."));

  const visibleName = (name, idx) =>
    !name.startsWith(".") || (idx >= 0 && explicitDot[idx]);

  // Collect every regular file below dir (used when ** is the last segment).
  const walkAll = (dir) => {
    for (const ent of readEntries(dir)) {
      if (ent.name.startsWith(".")) continue;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walkAll(joinPath(dir, ent.name));
      } else if (isRegularFile(dir, ent)) {
        out.add(joinPath(dir, ent.name));
      }
    }
  };

  const walk = (dir, idx) => {
    const m = matchers[idx];
    const last = idx === matchers.length - 1;

    if (m === null) {
      if (last) {
        walkAll(dir);
        return;
      }
      walk(dir, idx + 1); // ** matches zero directories
      for (const ent of readEntries(dir)) {
        if (!ent.isDirectory() || ent.name.startsWith(".") || SKIP_DIRS.has(ent.name)) {
          continue;
        }
        walk(joinPath(dir, ent.name), idx); // ** matches one or more
      }
      return;
    }

    for (const ent of readEntries(dir)) {
      if (!visibleName(ent.name, idx) || !m.test(ent.name)) continue;
      if (last) {
        if (isRegularFile(dir, ent)) out.add(joinPath(dir, ent.name));
      } else if (ent.isDirectory()) {
        walk(joinPath(dir, ent.name), idx + 1);
      }
    }
  };

  walk(base, 0);
}

// Returns a sorted array of unique file paths (forward slashes). The leading static
// part of the pattern is kept as written, so relative patterns give relative results.
export function globSync(pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  const out = new Set();
  for (const p of expandBraces(normalized)) globOne(p, out);
  return [...out].sort();
}
