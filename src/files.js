import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync, hasMagic } from "./glob.js";

const IGNORE_CASE = process.platform === "win32";

export function isPlainPath(arg) {
  return !arg.startsWith("@") && !arg.startsWith("!") && !hasMagic(arg);
}

function readList(listPath) {
  let text;
  try {
    text = readFileSync(listPath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(`File list not found: ${listPath}`);
    throw new Error(`Cannot read file list ${listPath}: ${e.message}`);
  }
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

function keyOf(path) {
  const abs = resolve(path);
  return IGNORE_CASE ? abs.toLowerCase() : abs;
}

// Expand CLI arguments (plain paths, masks, @filelist, !exclusions) into a unique,
// ordered list of files. Plain paths are kept as given (a missing file is reported
// later, when it is read); a mask that matches nothing is an error.
export function expandInputs(args) {
  const items = [];
  for (const arg of args) {
    if (arg.startsWith("@")) {
      const listPath = arg.slice(1);
      if (!listPath) throw new Error("Empty file list name after '@'");
      for (const line of readList(listPath)) {
        if (line.startsWith("@")) {
          throw new Error(`Nested file lists are not supported: ${line} (in ${listPath})`);
        }
        items.push(line);
      }
    } else {
      items.push(arg);
    }
  }

  const included = [];
  const excluded = new Set();
  for (const item of items) {
    if (item.startsWith("!")) {
      const pattern = item.slice(1);
      const matches = hasMagic(pattern) ? globSync(pattern) : [pattern];
      for (const m of matches) excluded.add(keyOf(m));
    } else if (hasMagic(item) && !existsSync(item)) {
      const matches = globSync(item);
      if (matches.length === 0) throw new Error(`No files match: ${item}`);
      included.push(...matches);
    } else {
      included.push(item);
    }
  }

  const seen = new Set();
  const result = [];
  for (const path of included) {
    const key = keyOf(path);
    if (excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  if (result.length === 0) throw new Error("No input files after applying exclusions");
  return result;
}
