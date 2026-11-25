import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "providers/anime/shared/extractors.js");
const synchronyPath = path.join(root, "libraries/synchrony/src/main/assets/synchrony-v2.4.5.1.js");
const targets = [
  "providers/anime/animostream.js",
  "providers/anime/animesalt.js"
];
const start = "/* BEGIN RAW SHARED EXTRACTORS — GENERATED; DO NOT EDIT */";
const end = "/* END RAW SHARED EXTRACTORS */";
const synchronyStart = "/* BEGIN RAW SYNCHRONY 2.4.5.1 — GENERATED; DO NOT EDIT */";
const synchronyEnd = "/* END RAW SYNCHRONY */";
const source = fs.readFileSync(sourcePath, "utf8").trimEnd();
const rawSynchrony = fs.readFileSync(synchronyPath, "utf8").trimEnd();
const synchronyExport = /export\{([A-Za-z_$][\w$]*) as Deobfuscator,([A-Za-z_$][\w$]*) as Transformer\};/;
const synchronyMatch = synchronyExport.exec(rawSynchrony);
if (!synchronyMatch) {
  throw new Error("Could not locate the Synchrony Deobfuscator/Transformer exports");
}
const synchronyProgram = rawSynchrony.replace(
  synchronyExport,
  "root.RAW_SYNCHRONY = { Deobfuscator: " + synchronyMatch[1] +
    ", Transformer: " + synchronyMatch[2] + " };"
);
const checkOnly = process.argv.includes("--check");
const block = start + "\n" + source + "\n" + end;
const synchronyBlock = synchronyStart + "\n(function (root) {\n" +
  synchronyProgram + "\n})(globalThis);\n" + synchronyEnd;

let stale = [];
for (const relativePath of targets) {
  const filename = path.join(root, relativePath);
  const current = fs.readFileSync(filename, "utf8");
  const pattern = new RegExp(escapeRegExp(start) + "[\\s\\S]*?" + escapeRegExp(end));
  if (!pattern.test(current)) {
    throw new Error("Missing shared-extractor markers in " + relativePath);
  }
  let updated = current.replace(pattern, () => block);

  if (relativePath === "providers/anime/animostream.js") {
    const synchronyPattern = new RegExp(
      escapeRegExp(synchronyStart) + "[\\s\\S]*?" + escapeRegExp(synchronyEnd)
    );
    if (synchronyPattern.test(updated)) {
      updated = updated.replace(synchronyPattern, () => synchronyBlock);
    } else {
      updated = updated.replace(end, () => end + "\n" + synchronyBlock);
    }
  }

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
