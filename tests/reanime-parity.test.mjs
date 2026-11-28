import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/reanime.js");
const source = fs.readFileSync(filename, "utf8");
const MASK = [157, 42, 241, 71, 179, 142, 92, 112, 166, 25, 228, 59, 216, 98, 15, 197];
const MASK_B64 = "nSrxR7OOXHCmGeQ72GIPxQ==";

function response(body, options = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: true,
    status: options.status || 200,
    url: options.url || "",
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

function loadProvider(fetchImpl, proxyImpl) {
  const calls = [];
  const proxies = [];
  let proxyIndex = 0;
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    },
    __raw_create_media_proxy: (url, headersJson, optionsJson) => {
      const item = {
        url: String(url),
        headers: JSON.parse(String(headersJson)),
        options: JSON.parse(String(optionsJson))
      };
      proxies.push(item);
      proxyIndex++;
      return "http://127.0.0.1:43522/hls/reanime" + proxyIndex + "?u=" + encodeURIComponent(item.url);
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
  return { exports: context.module.exports, calls, proxies };
}

const embedHtml = '<link rel="preload" href="/assets/hls.js">' +
  '<script>type: "data", data: { file: "fixture", subtitles: [{url: "https://subs.example/en.vtt", language: "English"}], intro_chapter: {start: 3, end: 87}, outro_chapter: {start: 120, end: 180}, optional: undefined,}, uses: "fixture"</script>';

test("ReAnime parses Kotlin JSON5 embed data and uses its 16-byte fallback mask", () => {
  const { exports } = loadProvider(async () => response(""));
  const embed = exports.__test.findEmbedData(embedHtml);
  assert.equal(embed.file, "fixture");
  assert.deepEqual(Array.from(embed.subtitles.map((x) => x.language)), ["English"]);
  assert.equal(embed.intro_chapter.start, 3);
  assert.equal(embed.optional, null);
  assert.equal(exports.__test.maskToBase64(exports.__test.fallbackMask), MASK_B64);
});

test("ReAnime follows AniList → exact episode → FlixCloud token/stream and RAW proxy flow", async () => {
  const { exports, calls, proxies } = loadProvider(async (url, init = {}) => {
    if (url === "https://reanime.to/api/v1/search?limit=36&offset=0&q=ReAnime%20Fixture") {
      return response({
        limit: 36, offset: 0, total: 1,
        results: [{ anime_id: "fixture-slug", title: { english: "ReAnime Fixture", romaji: "ReAnime Fixture" } }]
      }, { url });
    }
    if (url === "https://reanime.to/api/v1/anime/fixture-slug") {
      return response({ anime_id: "fixture-slug", anilist_id: 16498, subbed: 12, dubbed: 8 }, { url });
    }
    if (url === "https://reanime.to/api/v1/anime/fixture-slug/episodes?limit=2000") {
      return response({
        data: [
          { episodeId: "ep-4", episode_number: 4, title: "Previous" },
          { episodeId: "ep-5", episode_number: 5, title: "The Exact Episode" }
        ]
      }, { url });
    }
    if (url === "https://reanime.to/api/flix/16498/5") {
      return response({
        success: true,
        servers: [{ serverName: "HD-1", dataLink: "https://flixcloud.cc/embed/fixture" }]
      }, { url });
    }
    if (url === "https://flixcloud.cc/embed/fixture") {
      return response(embedHtml, { url });
    }
    if (url === "https://flixcloud.cc/assets/hls.js") {
      return response("function init(){for(var f=[157,42,241,71,179,142,92,112,166,25,228,59,216,98,15,197](){}}", { url });
    }
    if (url === "https://enc-dec.app/api/dec-flixcloud?type=token") {
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.data.file, "fixture");
      assert.equal(body.data.optional, null);
      assert.equal(body.data.subtitles, undefined);
      assert.equal(body.data.intro_chapter, undefined);
      assert.equal(body.data.outro_chapter, undefined);
      return response({ status: 200, result: { token: "fixture-token", context: { tokenContext: "ctx" } } }, { url });
    }
    if (url === "https://flixcloud.cc/api/m3u8/fixture-token") {
      return response({ encrypted: "fixture-stream-response" }, { url });
    }
    if (url === "https://enc-dec.app/api/dec-flixcloud?type=stream") {
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.data.context.tokenContext, "ctx");
      assert.equal(body.data.stream_response.encrypted, "fixture-stream-response");
      return response({
        status: 200,
        result: {
          stream: "https://cdn.flixcloud.cc/master.m3u8?token=parent-token",
          context: { w_payload: "fixture-w-payload" }
        }
      }, { url });
    }
    throw new Error("Unexpected ReAnime request: " + url);
  });

  const candidates = await exports.getStreams("16498", "anime", 1, 5, {
    title: "ReAnime Fixture",
    titles: ["ReAnime Fixture"]
  });
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.provider, "reanime");
  assert.equal(candidate.anilistId, "16498");
  assert.equal(candidate.episodeNumber, 5);
  assert.equal(candidate.type, "m3u8");
  assert.equal(candidate.quality, "Auto");
  assert.ok(candidate.url.startsWith("http://127.0.0.1:43522/hls/reanime"));
  assert.equal(candidate.subtitles.length, 1);
  assert.ok(candidate.subtitles[0].url.startsWith("http://127.0.0.1:43522/hls/reanime"));

  const playlistProxy = proxies.find((proxy) => proxy.url === "https://cdn.flixcloud.cc/master.m3u8?token=parent-token");
  assert.ok(playlistProxy);
  assert.equal(playlistProxy.options.rewriteManifests, true);
  assert.equal(playlistProxy.options.stripMode, "png-webp");
  assert.equal(playlistProxy.options.xorMaskBase64, MASK_B64);
  assert.equal(playlistProxy.options.xorOnlyWhenStripped, true);
  assert.equal(playlistProxy.options.manifestWrapperEndpoint, "https://enc-dec.app/api/parse-flixcloud");
  assert.equal(playlistProxy.options.manifestWrapperPayload, "fixture-w-payload");
  assert.deepEqual(Array.from(playlistProxy.options.inheritQueryParameters), ["token"]);
  assert.equal(playlistProxy.options.forceSegmentContentType, true);
  assert.equal(playlistProxy.options.manifestWrapperHeaders.Origin, "https://enc-dec.app");
  assert.equal(playlistProxy.options.manifestWrapperHeaders.Referer, "https://enc-dec.app/");

  const subtitleProxy = proxies.find((proxy) => proxy.url === "https://subs.example/en.vtt");
  assert.ok(subtitleProxy);
  assert.equal(subtitleProxy.options.rewriteManifests, false);
  assert.equal(subtitleProxy.options.stripMode, undefined);

  const episodeApi = calls.find((call) => call.url.includes("/episodes?"));
  assert.ok(episodeApi);
  const flixCall = calls.find((call) => call.url === "https://reanime.to/api/flix/16498/5");
  assert.ok(flixCall);
});

test("ReAnime refuses a site result that maps to a different AniList ID", async () => {
  let proxyCreated = false;
  const { exports } = loadProvider(async (url) => {
    if (url.includes("/api/v1/search?")) {
      return response({ results: [{ anime_id: "wrong", title: { english: "Wrong Fixture" } }], offset: 0, limit: 36, total: 1 }, { url });
    }
    if (url === "https://reanime.to/api/v1/anime/wrong") {
      return response({ anime_id: "wrong", anilist_id: 99999 }, { url });
    }
    throw new Error("Unexpected ReAnime request: " + url);
  }, () => { proxyCreated = true; return "http://127.0.0.1:43522/hls"; });
  const candidates = await exports.getStreams("16498", "anime", 1, 1, {
    title: "Wrong Fixture",
    titles: ["Wrong Fixture"]
  });
  assert.deepEqual(Array.from(candidates), []);
  assert.equal(proxyCreated, false);
});

test("ReAnime rejects wrong media types and invalid episode IDs without networking", async () => {
  const { exports, calls } = loadProvider(async () => {
    throw new Error("network must not run for invalid input");
  });
  assert.deepEqual(Array.from(await exports.getStreams("16498", "movie", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("bad", "anime", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("16498", "anime", 1, 0)), []);
  assert.equal(calls.length, 0);
});
