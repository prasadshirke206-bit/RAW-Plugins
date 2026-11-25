import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/animesalt.js");
const source = fs.readFileSync(filename, "utf8");
const PAGE = "https://animesalt.me/show/episode-1";
const FIRE = "https://as-cdn26.top/video/abcdef0123456789abcdef01";

function response(value, status = 200) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  };
}

function loadProvider(fetchImpl) {
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Promise,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error,
    Math,
    JSON,
    atob
  };
  vm.runInNewContext(source, sandbox, { filename, timeout: 4000 });
  return sandbox.module.exports.getStreams;
}

function episodePage(serverUrl) {
  const servers = JSON.stringify([{ url: serverUrl, lang: "sub", name: "FirePlayer" }]);
  return '<div class="ep-tile" onclick=\'triggerEpisode(' + servers +
    ',"Episode 1","ep-1")\'>Episode 1</div>';
}

test("AnimeSalt FirePlayer uses Kotlin POST contract and emits verified HLS variants", async () => {
  const calls = [];
  const getStreams = loadProvider(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u === PAGE) return response(episodePage(FIRE));
    if (u === "https://as-cdn26.top/player/index.php?data=abcdef0123456789abcdef01&do=getVideo") {
      return response({
        videoSource: "https://media.example/animesalt/master.m3u8"
      });
    }
    if (u === "https://media.example/animesalt/master.m3u8") {
      return response([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080",
        "1080/index.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720",
        "720/index.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected URL " + u);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, {
    title: "Sample anime",
    providerMappings: { animesalt: { url: PAGE } }
  });

  const post = calls.find((x) => x.url.includes("/player/index.php?"));
  assert.ok(post);
  assert.equal(post.options.method, "POST");
  assert.equal(post.options.headers.Origin, "https://as-cdn26.top");
  assert.equal(post.options.headers.Referer, FIRE);
  assert.equal(
    post.options.body,
    "hash=abcdef0123456789abcdef01&r=https%3A%2F%2Fanimesalt.me%2F"
  );

  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((x) => x.url === "https://media.example/animesalt/1080/index.m3u8" && x.quality === "1080p"));
  assert.ok(candidates.some((x) => x.url === "https://media.example/animesalt/720/index.m3u8" && x.quality === "720p"));
  assert.ok(candidates.every((x) => x.anilistId === "16498"));
  assert.ok(candidates.every((x) => x.episodeNumber === 1));
  assert.ok(candidates.every((x) => x.provider === "animesalt"));
  assert.ok(candidates.every((x) => x.headers.Referer === "https://as-cdn26.top/"));
});

test("AnimeSalt does not emit a FirePlayer iframe or non-media JSON value", async () => {
  const getStreams = loadProvider(async (url) => {
    const u = String(url);
    if (u === PAGE) return response(episodePage(FIRE));
    if (u.includes("/player/index.php?")) return response({ message: "not a media source" });
    throw new Error("Unexpected URL " + u);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, {
    title: "Sample anime",
    providerMappings: { animesalt: { url: PAGE } }
  });
  assert.deepEqual(Array.from(candidates), []);
});


test("AnimeSalt VidMoly follows Kotlin host normalization, source parsing and HLS extraction", async () => {
  const calls = [];
  const getStreams = loadProvider(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u === PAGE) return response(episodePage("https://vidmoly.to/embed/abc123"));
    if (u === "https://vidmoly.biz/embed/abc123") {
      return response('<script>var player = { sources: [{file: "https://media.example/vidmoly/master.m3u8"}], }; </script>');
    }
    if (u === "https://media.example/vidmoly/master.m3u8") {
      return response([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
        "1080/stream.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720",
        "720/stream.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected URL " + u);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, {
    title: "Sample anime",
    providerMappings: { animesalt: { url: PAGE } }
  });

  const vidmolyRequest = calls.find((x) => x.url === "https://vidmoly.biz/embed/abc123");
  assert.ok(vidmolyRequest);
  assert.equal(vidmolyRequest.options.headers.Origin, "https://vidmoly.biz");
  assert.equal(vidmolyRequest.options.headers.Referer, "https://vidmoly.biz/");
  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((x) => x.url === "https://media.example/vidmoly/1080/stream.m3u8" && x.quality === "1080p"));
  assert.ok(candidates.some((x) => x.url === "https://media.example/vidmoly/720/stream.m3u8" && x.quality === "720p"));
  assert.ok(candidates.every((x) => x.provider === "animesalt"));
  assert.ok(candidates.every((x) => x.anilistId === "16498" && x.episodeNumber === 1));
});

test("AnimeSalt VidMoly fails closed when no sources playlist is exposed", async () => {
  const getStreams = loadProvider(async (url) => {
    const u = String(url);
    if (u === PAGE) return response(episodePage("https://vidmoly.to/embed/abc123"));
    if (u === "https://vidmoly.biz/embed/abc123") return response("<html><body>player unavailable</body></html>");
    throw new Error("Unexpected URL " + u);
  });
  const candidates = await getStreams("16498", "anime", 1, 1, {
    title: "Sample anime",
    providerMappings: { animesalt: { url: PAGE } }
  });
  assert.deepEqual(Array.from(candidates), []);
});
