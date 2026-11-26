import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const bundles = [
  "providers/anime/allanime.js",
  "providers/anime/animostream.js",
  "providers/anime/animesalt.js",
  "providers/anime/animotvslash.js",
  "providers/anime/anineko.js",
  "providers/anime/animesaga.js",
  "providers/anime/anitusk.js"
];

const expectedRoutes = {
  "providers/anime/animesalt.js": ["extractorApi.dood(", "extractorApi.streamtape("],
  "providers/anime/animotvslash.js": ["ext.streamwish(", "ext.vidhide(", "ext.vidara(", "ext.abyss("],
  "providers/anime/anineko.js": ["ext.vidhide(", "ext.dood("],
  "providers/anime/animesaga.js": ["ext.vidhide(", "ext.dood("],
  "providers/anime/anitusk.js": ["ext.vidhide(", "ext.dood(", "ext.streamwish(", "ext.vidara("]
};

test("shared-extractor provider bundles parse and preserve their routing integrations", () => {
  for (const relativePath of bundles) {
    const filename = path.join(root, relativePath);
    const source = fs.readFileSync(filename, "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename }), relativePath + " must parse as JavaScript");

    for (const route of expectedRoutes[relativePath] || []) {
      assert.ok(source.includes(route), relativePath + " is missing shared route " + route);
    }
  }
});
