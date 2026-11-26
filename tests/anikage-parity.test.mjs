import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/anikage.js");
const source = fs.readFileSync(filename, "utf8");

function response(body, status = 200, contentType = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name.toLowerCase() === "content-type" ? contentType : null; } },
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

function loadProvider(fetchImpl) {
  const logs = [];
  const sandbox = {
    module: { exports: {} },
    console: { log(...args) { logs.push(args.join(" ")); }, warn() {}, error() {} },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    URL,
    Promise,
    Date,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error,
    Math
  };
  vm.runInNewContext(source, sandbox, { filename, timeout: 3000 });
  return { getStreams: sandbox.module.exports.getStreams, logs };
}

function requestContext() {
  return {
    title: "Parity Fixture Anime",
    titles: ["Parity Fixture Anime", "Parity Fixture Anime Romaji"],
    providerMappings: { anikage: { slug: "parity-fixture" } },
    preferredAudio: "sub"
  };
}

function baseRequests(url, options, calls) {
  calls.push({ url: String(url), options: options || {} });
  if (String(url) === "https://anikage.cc/api/media/anime/parity-fixture/episodes") {
    return response([{ number: 1, title: "Episode 1" }]);
  }
  if (String(url) === "https://anikage.cc/api/media/anime/parity-fixture/episodes/1/servers") {
    return response({ servers: [{ id: "koto", subTypes: ["sub"] }] });
  }
  if (String(url) === "https://anikage.cc") {
    return response('<script>window.config = {"PUBLIC_PROXY_URL":"https://edge.example/proxy/"};</script>', 200, "text/html");
  }
  return null;
}

test("Anikage uses the live Kotlin PUBLIC_PROXY_URL for token streams and caption tracks", async () => {
  const calls = [];
  const { getStreams } = loadProvider(async (url, options) => {
    const fixed = baseRequests(url, options, calls);
    if (fixed) return fixed;

    const value = String(url);
    if (value.includes("/sources?provider=koto&lang=sub&server=koto")) {
      calls.push({ url: value, options: options || {} });
      return response({
        sources: [{ url: "episode-token", isM3U8: true, quality: "1080p", server: "Koto" }],
        subtitles: [
          { file: "caption-token", label: "English", kind: "captions" },
          { file: "thumbnail-token", label: "Preview", kind: "thumbnails" }
        ]
      });
    }
    if (value === "https://edge.example/proxy/m3u8/episode-token") {
      calls.push({ url: value, options: options || {} });
      return response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nvariant.m3u8",
        200,
        "application/vnd.apple.mpegurl"
      );
    }
    throw new Error("Unexpected Anikage request: " + value);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, requestContext());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://edge.example/proxy/m3u8/variant.m3u8");
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(candidates[0].type, "m3u8");
  assert.equal(candidates[0].language, "sub");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 1);
  assert.equal(candidates[0].subtitles.length, 1);
  assert.equal(candidates[0].subtitles[0].url, "https://edge.example/proxy/stream/caption-token?ext=.vtt");
  assert.ok(!candidates[0].subtitles.some((track) => track.url.includes("thumbnail-token")));
  assert.ok(calls.some((call) => call.url === "https://anikage.cc"));
});

test("Anikage honors Kotlin embedOptions labels and resolves VibePlayer direct HLS", async () => {
  const calls = [];
  const embedUrl = "https://vibe.example/embed/episode-1?sub=https%3A%2F%2Fsubs.example%2Fen.vtt";
  const { getStreams } = loadProvider(async (url, options) => {
    const fixed = baseRequests(url, options, calls);
    if (fixed) return fixed;

    const value = String(url);
    if (value.includes("/sources?provider=koto&lang=sub&server=koto")) {
      calls.push({ url: value, options: options || {} });
      return response({
        sources: [{ embedUrl, server: "Koto", quality: "Auto", isM3U8: true }],
        embeds: [{ url: embedUrl, server: "Legacy label" }],
        embedOptions: [{ url: embedUrl, label: "E-Koto" }]
      });
    }
    if (value === embedUrl) {
      calls.push({ url: value, options: options || {} });
      return response('const src = "https://cdn.example/master.m3u8";', 200, "text/html");
    }
    if (value === "https://cdn.example/master.m3u8") {
      calls.push({ url: value, options: options || {} });
      return response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720\n720.m3u8",
        200,
        "application/vnd.apple.mpegurl"
      );
    }
    throw new Error("Unexpected Anikage request: " + value);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, requestContext());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://cdn.example/720.m3u8");
  assert.equal(candidates[0].quality, "720p");
  assert.match(candidates[0].title, /E-Koto/);
  assert.equal(candidates[0].language, "sub");
  assert.equal(candidates[0].subtitles[0].url, "https://subs.example/en.vtt");
  assert.ok(calls.some((call) => call.url === embedUrl));
});

test("Anikage fails closed for UniversalExtractor-only embeds instead of returning the page", async () => {
  const calls = [];
  const embedUrl = "https://megacloud.example/embed/episode-1";
  const { getStreams, logs } = loadProvider(async (url, options) => {
    const fixed = baseRequests(url, options, calls);
    if (fixed) return fixed;

    const value = String(url);
    if (value.includes("/sources?provider=koto&lang=sub&server=koto")) {
      calls.push({ url: value, options: options || {} });
      return response({
        sources: [{ embedUrl, server: "Megacloud", quality: "Auto", isM3U8: true }]
      });
    }
    throw new Error("Unexpected Anikage request: " + value);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, requestContext());
  assert.deepEqual(Array.from(candidates), []);
  assert.ok(logs.some((line) => line.includes("UniversalExtractor route requires a RAW host capability")));
  assert.ok(!candidates.some((item) => item.url === embedUrl));
});

test("Anikage treats an empty server subTypes list as both sub and dub, like Kotlin", async () => {
  const calls = [];
  const { getStreams } = loadProvider(async (url, options) => {
    const fixed = baseRequests(url, options, calls);
    if (fixed) return fixed;

    const value = String(url);
    if (value.includes("/sources?provider=koto&lang=sub&server=koto")) {
      calls.push({ url: value, options: options || {} });
      return response({ sources: [] });
    }
    if (value.includes("/sources?provider=koto&lang=dub&server=koto")) {
      calls.push({ url: value, options: options || {} });
      return response({
        sources: [{ url: "dub-token", isM3U8: false, quality: "720p", server: "Koto Dub" }],
        subtitles: []
      });
    }
    if (value === "https://edge.example/proxy/stream/dub-token") {
      calls.push({ url: value, options: options || {} });
      return response("video bytes", 200, "video/mp4");
    }
    // Override the shared server fixture with the empty-list edge case.
    if (value === "https://anikage.cc/api/media/anime/parity-fixture/episodes/1/servers") {
      calls.push({ url: value, options: options || {} });
      return response({ servers: [{ id: "koto", subTypes: [] }] });
    }
    throw new Error("Unexpected Anikage request: " + value);
  });

  const context = Object.assign(requestContext(), { preferredAudio: "dub" });
  const candidates = await getStreams("16498", "anime", 1, 1, context);
  assert.ok(calls.some((call) => call.url.includes("lang=dub")));
  assert.ok(calls.some((call) => call.url.includes("lang=sub")));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://edge.example/proxy/stream/dub-token");
  assert.equal(candidates[0].language, "dub");
  assert.equal(candidates[0].type, "mp4");
});
