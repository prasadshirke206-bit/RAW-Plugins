import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("manifest runtime contract", () => {
  assert.equal(manifest.id, "raw-plugins");
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.runtime.engine, "QuickJS");
  assert.equal(manifest.runtime.entrypoint, "getStreams");
  assert.deepEqual(manifest.runtime.callArguments, ["tmdbId", "mediaType", "season", "episode"]);
});

test("provider IDs are unique and files exist", () => {
  const ids = manifest.providers.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const provider of manifest.providers) {
    assert.ok(fs.existsSync(path.join(root, provider.filename)), provider.filename);
    assert.ok(provider.supportedTypes.every((type) => ["movie", "tv"].includes(type)));
  }
});

test("template and imported providers are disabled pending validation", () => {
  const expectedImportedIds = [
    "bingr", "movy", "4khdhub", "hdhub4u", "bollyflix",
    "cinevood", "freekz", "net77", "uhdmovies", "vegamovies"
  ];
  const imported = manifest.providers.filter((provider) => provider.id !== "raw-provider-template");

  assert.equal(manifest.providers.find((provider) => provider.id === "raw-provider-template").enabled, false);
  assert.deepEqual(imported.map((provider) => provider.id).sort(), expectedImportedIds.sort());

  for (const provider of manifest.providers) {
    assert.equal(provider.enabled, false);
    assert.ok(!provider.supportedTypes.includes("anime"));
  }
});
