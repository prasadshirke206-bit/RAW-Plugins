import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const existingMovieTvIds = [
  "bingr", "movy", "4khdhub", "hdhub4u", "bollyflix",
  "cinevood", "freekz", "net77", "uhdmovies", "vegamovies"
];
const animeIds = ["allanime", "anikage", "anikoto", "anilight"];

test("manifest retains the existing QuickJS movie/TV contract", () => {
  assert.equal(manifest.id, "raw-plugins");
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.runtime.engine, "QuickJS");
  assert.equal(manifest.runtime.apiVersion, 1);
  assert.equal(manifest.runtime.entrypoint, "getStreams");
  assert.deepEqual(manifest.runtime.callArguments, ["tmdbId", "mediaType", "season", "episode"]);
  assert.equal(manifest.runtime.requestContext, "globalThis.__CALL_ARGS__");
});

test("anime has a separate AniList invocation contract", () => {
  assert.deepEqual(manifest.runtime.animeCallArguments, ["anilistId", "mediaType", "season", "episode"]);
  assert.equal(manifest.runtime.animeContract.identity, "AniList");
  assert.equal(manifest.runtime.animeContract.idArgument, "anilistId");
  assert.equal(manifest.runtime.animeContract.mediaType, "anime");
  assert.deepEqual(manifest.runtime.animeContract.candidateIdentityFields, ["anilistId", "episodeNumber"]);
});

test("provider IDs are unique and all referenced files exist", () => {
  const ids = manifest.providers.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const provider of manifest.providers) {
    assert.ok(fs.existsSync(path.join(root, provider.filename)), provider.filename);
    assert.ok(provider.supportedTypes.length > 0);
    assert.ok(provider.supportedTypes.every((type) => ["movie", "tv", "anime"].includes(type)));
  }
});

test("movie/TV provider catalogue entries remain intact", () => {
  const movieTv = manifest.providers.filter((provider) =>
    provider.supportedTypes.includes("movie") || provider.supportedTypes.includes("tv")
  );
  assert.deepEqual(movieTv.map((provider) => provider.id).sort(), existingMovieTvIds.slice().sort());
  for (const provider of movieTv) {
    assert.ok(provider.filename.startsWith("providers/movie-tv/"));
    assert.ok(provider.supportedTypes.every((type) => type === "movie" || type === "tv"));
  }
});

test("exactly four anime providers are registered in the anime folder", () => {
  const anime = manifest.providers.filter((provider) => provider.supportedTypes.includes("anime"));
  assert.deepEqual(anime.map((provider) => provider.id).sort(), animeIds.slice().sort());
  for (const provider of anime) {
    assert.deepEqual(provider.supportedTypes, ["anime"]);
    assert.equal(provider.enabled, true);
    assert.ok(provider.filename.startsWith("providers/anime/"));
    assert.ok(provider.filename.endsWith(".js"));
  }
});

test("anime QuickJS scripts parse and expose a fail-closed getStreams entrypoint", async () => {
  for (const provider of manifest.providers.filter((item) => item.supportedTypes.includes("anime"))) {
    const filename = path.join(root, provider.filename);
    const source = fs.readFileSync(filename, "utf8");
    assert.match(source, /async function getStreams\s*\(\s*anilistId\s*,\s*mediaType\s*,\s*season\s*,\s*episode/);
    assert.match(source, /globalThis\.getStreams\s*=\s*getStreams/);
    assert.match(source, /anilistId\s*=\s*id/);
    assert.match(source, /episodeNumber\s*=\s*ep/);
    new vm.Script(source, { filename });

    const context = {
      module: { exports: {} },
      console: { log() {}, warn() {}, error() {} },
      fetch: async () => { throw new Error("network must not be called in invalid-input test"); },
      setTimeout,
      clearTimeout,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      atob,
      btoa
    };
    vm.runInNewContext(source, context, { filename, timeout: 2000 });
    assert.equal(typeof context.module.exports.getStreams, "function", provider.id);

    const wrongType = await context.module.exports.getStreams("16498", "movie", 1, 1, {});
    assert.deepEqual(Array.from(wrongType), []);
    const invalidId = await context.module.exports.getStreams("not-an-anilist-id", "anime", 1, 1, {});
    assert.deepEqual(Array.from(invalidId), []);
    const missingEpisode = await context.module.exports.getStreams("16498", "anime", 1, 0, {});
    assert.deepEqual(Array.from(missingEpisode), []);
  }
});
