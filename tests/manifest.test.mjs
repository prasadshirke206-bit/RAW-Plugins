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
const activeAnimeIds = ["allanime","anikage","anikoto","anilight","miruro","anichan","anikura","anikuro","animeheaven","anipm","animesaga","anitusk","animesalt","fouranimo","animotvslash","anineko","animestream","animostream","animesuge","anisnatch"];
const pendingAnimeIds = ["anilab","animepahe","animesogo","aniwave","av1encodes","reanime","senshi"];
const animeIds = [...activeAnimeIds, ...pendingAnimeIds];

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

test("NetMirror remains disabled until a legitimate user-completed verification handoff exists", () => {
  const provider = manifest.providers.find((item) => item.id === "net77");
  assert.ok(provider, "net77 catalogue entry");
  assert.equal(provider.enabled, false);
  assert.match(provider.description, /user-completed NetMirror verification/i);
  assert.match(provider.description, /synthetic reCAPTCHA response path is not used/i);
});

test("movie/TV provider catalogue entries remain intact", () => {
  const movieTv = manifest.providers.filter((provider) =>
    provider.supportedTypes.includes("movie") || provider.supportedTypes.includes("tv")
  );
  assert.deepEqual(movieTv.map((provider) => provider.id).sort(), existingMovieTvIds.slice().sort());
  for (const provider of movieTv) {
    assert.ok(provider.filename.startsWith("providers/movie-tv/"));
    if (provider.enabled) assert.doesNotMatch(provider.description, /disabled pending|must not be enabled/i, provider.id);
    assert.ok(provider.supportedTypes.every((type) => type === "movie" || type === "tv"));
  }
});

test("exactly 27 anime providers are registered with explicit enablement", () => {
  const anime = manifest.providers.filter((provider) => provider.supportedTypes.includes("anime"));
  assert.deepEqual(anime.map((provider) => provider.id).sort(), animeIds.slice().sort());
  for (const provider of anime) {
    assert.deepEqual(provider.supportedTypes, ["anime"]);
    // All registered anime providers are enabled in the catalogue by user decision.
    // Pending implementations remain fail-closed until their QuickJS ports are complete.
    assert.equal(provider.enabled, true, provider.id);
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
    if (activeAnimeIds.includes(provider.id)) {
      assert.match(source, /anilistId/);
      assert.match(source, /episodeNumber/);
    } else {
      // Catalogue-enabled does not mean extraction is implemented. Until its
      // provider-specific port lands, the placeholder must fail closed.
      assert.match(source, /return\s*\[\]\s*;/, provider.id);
    }
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
