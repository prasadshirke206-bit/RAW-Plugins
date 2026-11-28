import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/senshi.js");
const source = fs.readFileSync(filename, "utf8");
const GCM_KEY_B64 = "buJyEyftRpu22Tq5t6g4BFGQtbqF2c6jseF4Bfe0rvY=";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function response(body, options = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    url: options.url || "",
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

function loadProvider(fetchImpl, resolverImpl) {
  const calls = [];
  const proxyCalls = [];
  let proxyIndex = 0;
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    },
    __raw_senshi_resolve: resolverImpl,
    __raw_create_media_proxy: (url, headersJson, optionsJson) => {
      const parsed = {
        url: String(url),
        headers: JSON.parse(String(headersJson)),
        options: JSON.parse(String(optionsJson))
      };
      proxyCalls.push(parsed);
      proxyIndex++;
      return "http://127.0.0.1:43521/hls/session" + proxyIndex + "?u=" + encodeURIComponent(parsed.url);
    },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Promise,
    Date,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error,
    Math,
    JSON
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename, timeout: 5000 });
  return { exports: context.module.exports, calls, proxyCalls };
}

test("Senshi follows Kotlin AniList → search → numeric ID → exact episode → embed → native __oct flow", async () => {
  const resolverCalls = [];
  const fixtureCalls = [];
  const { exports, calls, proxyCalls } = loadProvider(async (url, init = {}) => {
    fixtureCalls.push({ url, init });
    if (url === "https://senshi.to/anime/filter") {
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.searchTerm, "Senshi Fixture");
      assert.equal(body.page, 1);
      assert.equal(body.limit, 24);
      return response({ data: [{ public_id: "fixture-ani", title_english: "Senshi Fixture", title: "Fixture Native" }] }, { url });
    }
    if (url === "https://senshi.to/anime/fixture-ani") {
      return response({ id: 8123, public_id: "fixture-ani", title: "Senshi Fixture" }, { url });
    }
    if (url === "https://senshi.to/episodes/8123") {
      return response([
        { ep_id: 4, episode_number: 4, ep_title: "Previous" },
        { ep_id: 5, episode_number: 5, ep_title: "The Exact Episode" }
      ], { url });
    }
    if (url === "https://senshi.to/episode-embeds/8123/5") {
      return response([
        { remote_source_id: 501, status: "HardSub" },
        { remote_source_id: 502, status: "Dub" }
      ], { url });
    }
    throw new Error("Unexpected Senshi fetch: " + url);
  }, async (baseUrl, remoteId, userAgent, timeout) => {
    resolverCalls.push({ baseUrl, remoteId, userAgent, timeout });
    return JSON.stringify([{
      source: [
        { label: "sub", src: "https://cdn.example/senshi-sub.m3u8", quality: "1080p" },
        { label: "dub", src: "https://cdn.example/senshi-dub.m3u8", quality: "720p" }
      ],
      tracks: [
        { label: "English", vtt_url: "https://subs.example/en.vtt" },
        { label: "Chapter", url: "https://subs.example/chapters.vtt" },
        { label: "Japanese", url: "https://subs.example/ja.vtt" }
      ]
    }]);
  });

  const candidates = await exports.getStreams("16498", "anime", 1, 5, {
    title: "Senshi Fixture",
    titles: ["Senshi Fixture", "Fixture Native"],
    preferredQuality: "auto"
  });

  assert.equal(candidates.length, 2);
  assert.equal(resolverCalls.length, 2);
  assert.deepEqual(resolverCalls.map((call) => call.remoteId).sort(), [501, 502]);
  for (const call of resolverCalls) {
    assert.equal(call.baseUrl, "https://senshi.to");
    assert.equal(call.userAgent, UA);
    assert.equal(call.timeout, 25);
  }

  const dub = candidates.find((candidate) => candidate.title.includes("[Dub]"));
  const sub = candidates.find((candidate) => candidate.title.includes("[Sub]"));
  assert.ok(dub);
  assert.ok(sub);
  assert.equal(dub.url.startsWith("http://127.0.0.1:43521/hls/"), true);
  assert.equal(dub.type, "m3u8");
  assert.equal(dub.quality, "Auto");
  assert.equal(dub.anilistId, "16498");
  assert.equal(dub.episodeNumber, 5);
  assert.equal(dub.provider, "senshi");
  assert.equal(dub.subtitles.length, 2);
  assert.deepEqual(Array.from(dub.subtitles.map((track) => track.lang)), ["English", "Japanese"]);
  assert.ok(dub.subtitles.every((track) => track.url.startsWith("http://127.0.0.1:43521/hls/")));

  assert.equal(proxyCalls.length, 6); // 2 source playlists + 2 subtitle tracks per embed.
  const playlistProxy = proxyCalls.find((call) => call.url === "https://cdn.example/senshi-dub.m3u8");
  assert.ok(playlistProxy);
  assert.equal(playlistProxy.options.rewriteManifests, true);
  assert.equal(playlistProxy.options.aesGcmHlsKeyBase64, GCM_KEY_B64);
  assert.equal(playlistProxy.options.aesGcmEnvelopePrefix, "EM3U8v1:");
  assert.equal(playlistProxy.options.forceSegmentContentType, true);
  assert.equal(playlistProxy.options.sessionTtlMillis, 7200000);
  const subtitleProxy = proxyCalls.find((call) => call.url === "https://subs.example/en.vtt");
  assert.ok(subtitleProxy);
  assert.equal(subtitleProxy.options.rewriteManifests, false);
  assert.equal(subtitleProxy.options.aesGcmHlsKeyBase64, undefined);

  const episodeCall = calls.find((call) => call.url === "https://senshi.to/episodes/8123");
  assert.ok(episodeCall);
  const embedCall = calls.find((call) => call.url === "https://senshi.to/episode-embeds/8123/5");
  assert.ok(embedCall);
  assert.ok(!calls.some((call) => call.url.includes("/episode-embeds/8123/4")));
});

test("Senshi uses the same source endpoint when the native WebView resolver has no result", async () => {
  const { exports } = loadProvider(async (url) => {
    if (url === "https://senshi.to/anime/filter") return response({ data: [{ public_id: "fallback", title: "Fallback Fixture" }] }, { url });
    if (url === "https://senshi.to/anime/fallback") return response({ id: 200 }, { url });
    if (url === "https://senshi.to/episodes/200") return response([{ ep_id: 1, episode_number: 1 }], { url });
    if (url === "https://senshi.to/episode-embeds/200/1") return response([{ remote_source_id: 600, status: "HardSub" }], { url });
    if (url === "https://s.vidcloud.se/_v1/sources?id=600") {
      return response([{ source: { src: "https://cdn.example/fallback.m3u8", quality: "1080p" }, tracks: [] }], { url });
    }
    throw new Error("Unexpected fallback request: " + url);
  }, async () => null);

  const candidates = await exports.getStreams("16498", "anime", 1, 1, {
    title: "Fallback Fixture",
    titles: ["Fallback Fixture"]
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 1);
});

test("Senshi rejects invalid media, AniList IDs and missing exact episodes", async () => {
  const { exports } = loadProvider(async () => {
    throw new Error("network must not run for invalid media or identity");
  }, async () => null);
  assert.deepEqual(Array.from(await exports.getStreams("16498", "movie", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("bad", "anime", 1, 1)), []);
});
