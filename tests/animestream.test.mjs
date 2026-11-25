import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/animestream.js");
const source = fs.readFileSync(filename, "utf8");

const BASE = "https://anime.uniquestream.net";
const EXPECTED_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
    JSON
  };
  vm.runInNewContext(source, sandbox, { filename, timeout: 4000 });
  return sandbox.module.exports.getStreams;
}

function playlist() {
  return "#EXTM3U\n#EXTINF:6,\nsegment.ts\n";
}

function mediaPayload() {
  return {
    media_id: "media-id-123",
    hls: {
      locale: "ja-JP",
      playlist: BASE + "/hls/jp/main.m3u8",
      hard_subs: [
        { locale: "en-US", playlist: BASE + "/hls/jp/hardsub-en.m3u8" }
      ]
    },
    versions: {
      hls: [
        { locale: "en-US", playlist: BASE + "/hls/en/main.m3u8" }
      ]
    }
  };
}

function baseApiFetch(calls, overrides = {}) {
  return async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u === BASE + "/api/v1/series/series-1") {
      return response({ seasons: [{ content_id: "season-1", season_number: 1, episode_count: 1 }] });
    }
    if (u === BASE + "/api/v1/season/season-1/episodes?limit=20&page=1") {
      return response([{ content_id: "episode-1", episode_number: 1 }]);
    }
    if (u === BASE + "/api/v1/episode/episode-1/media/hls/ja-JP") {
      return response(mediaPayload());
    }
    if (u.startsWith(BASE + "/hls/")) {
      if (overrides[u]) return response(overrides[u]);
      return response(playlist());
    }
    throw new Error("Unexpected URL: " + u);
  };
}

const context = {
  title: "Sample anime",
  providerMappings: { animestream: { contentId: "series-1" } }
};

test("AnimeStream returns main, alternate audio, and hard-sub playlist variants", async () => {
  const calls = [];
  const getStreams = loadProvider(baseApiFetch(calls));

  const candidates = await getStreams("16498", "anime", 1, 1, context);

  assert.equal(candidates.length, 3);
  assert.ok(candidates.some((x) => x.url === BASE + "/hls/jp/main.m3u8"));
  assert.ok(candidates.some((x) => x.url === BASE + "/hls/jp/hardsub-en.m3u8"));
  assert.ok(candidates.some((x) => x.url === BASE + "/hls/en/main.m3u8"));
  assert.ok(candidates.some((x) => x.title.includes("Hardsub: English")));
  assert.ok(candidates.some((x) => x.language === "en-US"));
  assert.ok(candidates.every((x) => x.anilistId === "16498"));
  assert.ok(candidates.every((x) => x.episodeNumber === 1));
  assert.ok(candidates.every((x) => x.provider === "animestream"));
  assert.ok(candidates.every((x) => x.type === "m3u8"));
  assert.ok(candidates.every((x) => x.headers.Referer === BASE + "/"));
  assert.ok(candidates.every((x) => x.headers["User-Agent"] === EXPECTED_UA));

  const playlistCalls = calls.filter((x) => x.url.indexOf("/hls/") >= 0);
  assert.equal(playlistCalls.length, 3);
  assert.ok(playlistCalls.every((x) =>
    x.options.headers["Accept"].indexOf("application/vnd.apple.mpegurl") >= 0
  ));
});

test("AnimeStream checks child variant playlists and rejects native-key proxy dependencies", async () => {
  const calls = [];
  const overrides = {};
  overrides[BASE + "/hls/jp/main.m3u8"] = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080",
    "1080/index.m3u8"
  ].join("\n");
  overrides[BASE + "/hls/jp/1080/index.m3u8"] = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="../../keys/encrypted.key"',
    "#EXTINF:6,",
    "segment.ts"
  ].join("\n");

  const getStreams = loadProvider(baseApiFetch(calls, overrides));
  const candidates = await getStreams("16498", "anime", 1, 1, context);

  assert.equal(candidates.length, 2);
  assert.ok(!candidates.some((x) => x.url === BASE + "/hls/jp/main.m3u8"));
  assert.ok(candidates.some((x) => x.url === BASE + "/hls/jp/hardsub-en.m3u8"));
  assert.ok(candidates.some((x) => x.url === BASE + "/hls/en/main.m3u8"));
  assert.ok(calls.some((x) => x.url === BASE + "/hls/jp/1080/index.m3u8"));
});

test("AnimeStream preserves alternate audio masters rather than stripping their audio group", async () => {
  const calls = [];
  const overrides = {};
  overrides[BASE + "/hls/jp/main.m3u8"] = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",URI="audio/ja.m3u8"',
    "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,AUDIO=\"audio\"",
    "1080/index.m3u8"
  ].join("\n");
  overrides[BASE + "/hls/jp/audio/ja.m3u8"] = playlist();
  overrides[BASE + "/hls/jp/1080/index.m3u8"] = playlist();

  const getStreams = loadProvider(baseApiFetch(calls, overrides));
  const candidates = await getStreams("16498", "anime", 1, 1, context);
  const jpMain = candidates.find((x) => x.url === BASE + "/hls/jp/main.m3u8");

  assert.ok(jpMain);
  assert.equal(jpMain.quality, "Auto");
  assert.ok(calls.some((x) => x.url === BASE + "/hls/jp/audio/ja.m3u8"));
});

test("AnimeStream fails closed when repeated episode numbers make the season ambiguous", async () => {
  const calls = [];
  const getStreams = loadProvider(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u === BASE + "/api/v1/series/series-1") {
      return response({ seasons: [
        { content_id: "season-1", season_number: 1, episode_count: 1 },
        { content_id: "season-2", season_number: 2, episode_count: 1 }
      ] });
    }
    if (u === BASE + "/api/v1/season/season-1/episodes?limit=20&page=1") {
      return response([{ content_id: "episode-s1", episode_number: 1 }]);
    }
    if (u === BASE + "/api/v1/season/season-2/episodes?limit=20&page=1") {
      return response([{ content_id: "episode-s2", episode_number: 1 }]);
    }
    throw new Error("Should not resolve media for an ambiguous episode: " + u);
  });

  const candidates = await getStreams("16498", "anime", 0, 1, context);
  assert.deepEqual(Array.from(candidates), []);
  assert.equal(calls.filter((x) => x.url.indexOf("/media/hls/") >= 0).length, 0);
});

test("AnimeStream follows Kotlin's paginated season episode list", async () => {
  const calls = [];
  const getStreams = loadProvider(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u === BASE + "/api/v1/series/series-1") {
      return response({ seasons: [{ content_id: "season-1", season_number: 1, episode_count: 21 }] });
    }
    if (u === BASE + "/api/v1/season/season-1/episodes?limit=20&page=1") {
      return response(Array.from({ length: 20 }, (_, i) => ({
        content_id: "episode-" + (i + 1),
        episode_number: i + 1
      })));
    }
    if (u === BASE + "/api/v1/season/season-1/episodes?limit=20&page=2") {
      return response([{ content_id: "episode-21", episode_number: 21 }]);
    }
    if (u === BASE + "/api/v1/episode/episode-21/media/hls/ja-JP") {
      return response({
        hls: { locale: "ja-JP", playlist: BASE + "/hls/21/main.m3u8" }
      });
    }
    if (u === BASE + "/hls/21/main.m3u8") return response(playlist());
    throw new Error("Unexpected URL: " + u);
  });

  const candidates = await getStreams("16498", "anime", 1, 21, context);
  assert.equal(candidates.length, 1);
  assert.ok(calls.some((x) => x.url === BASE + "/api/v1/season/season-1/episodes?limit=20&page=2"));
  assert.ok(calls.some((x) => x.url === BASE + "/api/v1/episode/episode-21/media/hls/ja-JP"));
  assert.equal(candidates[0].episodeNumber, 21);
});
