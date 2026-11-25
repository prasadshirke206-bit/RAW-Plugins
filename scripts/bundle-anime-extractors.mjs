import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "providers/anime/shared/extractors.js");
const targets = [
  "providers/anime/animostream.js",
  "providers/anime/animesalt.js"
];
const start = "/* BEGIN RAW SHARED EXTRACTORS — GENERATED; DO NOT EDIT */";
const end = "/* END RAW SHARED EXTRACTORS */";
const source = fs.readFileSync(sourcePath, "utf8").trimEnd();
const checkOnly = process.argv.includes("--check");
const block = start + "\n" + source + "\n" + end;

let stale = [];
for (const relativePath of targets) {
  const filename = path.join(root, relativePath);
  const current = fs.readFileSync(filename, "utf8");
  const pattern = new RegExp(escapeRegExp(start) + "[\\s\\S]*?" + escapeRegExp(end));
  if (!pattern.test(current)) {
    throw new Error("Missing shared-extractor markers in " + relativePath);
  }
  const updated = current.replace(pattern, block);
  if (updated !== current) {
    stale.push(relativePath);
    if (!checkOnly) fs.writeFileSync(filename, updated);
  }
}

if (checkOnly && stale.length) {
  console.error("Shared extractor bundle is stale in: " + stale.join(", "));
  process.exitCode = 1;
} else if (!checkOnly && stale.length) {
  console.log("Updated shared extractor bundle in: " + stale.join(", "));
} else {
  console.log("Shared extractor bundles are up to date.");
}

function escapeRegExp(value) {
  return value.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}
