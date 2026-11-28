import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeProviders = [
  ["animostream", "providers/anime/animostream.js", "rawResolveUniversalEmbed(AM_ID"],
  ["animesalt", "providers/anime/animesalt.js", "rawResolveUniversalEmbed(AZ_ID"],
  ["anichan", "providers/anime/anichan.js", "rawResolveUniversalEmbed(AC_ID"],
  ["anikage", "providers/anime/anikage.js", "rawResolveUniversalEmbed(ANIKAGE_ID"],
  ["miruro", "providers/anime/miruro.js", "rawResolveUniversalEmbed(MIRURO_ID"]
];

test("all UniversalExtractor-backed anime adapters are wired to the RAW native bridge", () => {
  for (const [id, relative, marker] of bridgeProviders) {
    const filename = path.join(root, relative);
    const source = fs.readFileSync(filename, "utf8");
    assert.ok(source.includes("async function rawResolveUniversalEmbed"), id + ": helper missing");
    assert.ok(source.includes(marker), id + ": provider adapter does not call native bridge");
    assert.ok(source.includes("raw.anime.webview-stream"), id + ": capability contract missing");
    assert.ok(source.includes("Number(result.episodeNumber) !== ep"), id + ": returned episode is not checked");
    assert.ok(source.includes("result.status !== \"resolved\""), id + ": status is not fail-closed");
    new vm.Script(source, { filename });
  }
});

function bridgeHelperSource() {
  const filename = path.join(root, "providers/anime/anichan.js");
  const source = fs.readFileSync(filename, "utf8");
  const start = source.indexOf("async function rawResolveUniversalEmbed(");
  assert.ok(start >= 0, "native helper not found");
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, "native helper end not found");
  return source.slice(start, end + 2) + "\nglobalThis.__testResolve = rawResolveUniversalEmbed;";
}

function createHelper(host) {
  const sandbox = { RAW_HOST: { resolveAnimeEmbed: host }, console: { log() {} } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bridgeHelperSource(), sandbox, { timeout: 3_000 });
  return sandbox.__testResolve;
}

test("native bridge helper preserves exact AniList episode and strips unsafe request headers", async () => {
  let captured;
  const resolve = createHelper(async (request) => {
    captured = request;
    return {
      status: "resolved",
      anilistId: "16498",
      episodeNumber: 7,
      streams: [
        { url: "http://127.0.0.1:42000/raw-anime/abcdef0123456789?u=x", protocol: "hls" },
        { url: "https://cdn.example/unproxied.m3u8", protocol: "hls" },
        { url: "http://127.0.0.1:42000/other-path?u=x", protocol: "hls" },
        { url: "http://127.0.0.1:42000/raw-anime/abcdef0123456789?u=y", protocol: "dash" }
      ],
      subtitles: [
        { url: "http://127.0.0.1:42000/raw-anime/abcdef0123456789?u=sub", lang: "English", format: "vtt" },
        { url: "https://cdn.example/sub.vtt", lang: "English" }
      ]
    };
  });

  const result = await resolve(
    "anichan", "https://embed.example/watch/7", "AniChan Sub", "sub", "16498", 7,
    "https://anichan.net/",
    { "User-Agent": "RAW-test-UA", "Accept": "text/html", "Cookie": "must-not-cross-QuickJS", "X-Private": "no" },
    []
  );

  assert.equal(captured.capability, "raw.anime.webview-stream");
  assert.equal(captured.version, 1);
  assert.equal(captured.provider, "anichan");
  assert.equal(captured.anilistId, "16498");
  assert.equal(captured.episodeNumber, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(captured.headers)), {
    "User-Agent": "RAW-test-UA", "Accept": "text/html"
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "http://127.0.0.1:42000/raw-anime/abcdef0123456789?u=x");
  assert.equal(result[0].type, "m3u8");
  assert.equal(result[0].anilistId, "16498");
  assert.equal(result[0].episodeNumber, 7);
  assert.equal(result[0].subtitles.length, 1);
  assert.equal(result[0].subtitles[0].lang, "English");
});

test("native bridge helper rejects identity mismatches and verification-required results", async () => {
  let status = "resolved";
  let wrongIdentity = false;
  const resolve = createHelper(async (request) => ({
    status,
    anilistId: wrongIdentity ? "99999" : request.anilistId,
    episodeNumber: request.episodeNumber,
    streams: [{ url: "http://127.0.0.1:42000/raw-anime/abcdef0123456789?u=x", protocol: "hls" }]
  }));

  assert.equal((await resolve("anikage", "https://embed.example/e", "label", "sub", "16498", 4, "https://anikage.cc/", {}, [])).length, 1);
  wrongIdentity = true;
  assert.equal((await resolve("anikage", "https://embed.example/e", "label", "sub", "16498", 4, "https://anikage.cc/", {}, [])).length, 0);
  wrongIdentity = false;
  status = "needs_user_action";
  assert.equal((await resolve("anikage", "https://embed.example/e", "label", "sub", "16498", 4, "https://anikage.cc/", {}, [])).length, 0);
});

test("native bridge helper does not invoke RAW for non-HTTPS embed or page URLs", async () => {
  let calls = 0;
  const resolve = createHelper(async () => { calls++; return { status: "resolved", streams: [] }; });
  assert.deepEqual(await resolve("anikage", "http://embed.example/e", "label", "sub", "16498", 4, "https://anikage.cc/", {}, []), []);
  assert.deepEqual(await resolve("anikage", "https://embed.example/e", "label", "sub", "16498", 4, "http://anikage.cc/", {}, []), []);
  assert.equal(calls, 0);
});
