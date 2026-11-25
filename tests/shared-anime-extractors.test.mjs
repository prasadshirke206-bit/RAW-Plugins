import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedPath = path.join(root, "providers/anime/shared/extractors.js");
const sharedSource = fs.readFileSync(sharedPath, "utf8");
const startMarker = "/* BEGIN RAW SHARED EXTRACTORS — GENERATED; DO NOT EDIT */";
const endMarker = "/* END RAW SHARED EXTRACTORS */";
const providerFiles = [
  "providers/anime/animostream.js",
  "providers/anime/animesalt.js"
];

function response(body, options = {}) {
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    url: options.url || "",
    text: async () => body
  };
}

function loadExtractors(fetchImpl) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Promise,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error
  };
  vm.runInNewContext(sharedSource, sandbox, { filename: sharedPath, timeout: 4000 });
  return sandbox.RAWAnimeExtractors;
}

test("standalone provider bundles stay synchronized with shared extractor source", () => {
  const expected = startMarker + "\n" + sharedSource.trimEnd() + "\n" + endMarker;
  for (const relativePath of providerFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, relativePath + " is missing generated markers");
    const actual = source.slice(start, end + endMarker.length);
    assert.equal(actual, expected, relativePath + " has stale shared code");
  }
});

test("Dood follows Kotlin pass_md5 token and expiry construction", async () => {
  const calls = [];
  const extractors = loadExtractors(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u === "https://dood.wf/e/abc") {
      return response(
        "<html><title>Example Anime 1080p</title><script>var src = '/pass_md5/hash123';</script></html>",
        { url: "https://doodstream.com/e/abc" }
      );
    }
    if (u === "https://doodstream.com/pass_md5/hash123") {
      return response("https://cdn.example/video/");
    }
    throw new Error("Unexpected request " + u);
  });

  const candidates = await extractors.dood("https://dood.wf/e/abc", {
    provider: "animostream",
    anilistId: "16498",
    episodeNumber: 7,
    language: "multi",
    labelPrefix: "Mirror [SUB]"
  });

  assert.equal(candidates.length, 1);
  assert.match(candidates[0].url, /^https:\/\/cdn\.example\/video\/[A-Za-z0-9]{10}\?token=hash123&expiry=\d+$/);
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(candidates[0].type, "mp4");
  assert.equal(candidates[0].provider, "animostream");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 7);
  assert.equal(candidates[0].headers["User-Agent"], "Aniyomi");
  assert.equal(candidates[0].headers.Referer, "https://doodstream.com/");
  assert.equal(calls[1].options.headers.Referer, "https://doodstream.com/e/abc");
});

test("Dood fails closed without a pass_md5 endpoint", async () => {
  let requests = 0;
  const extractors = loadExtractors(async () => {
    requests += 1;
    return response("<html><title>not a Dood page</title></html>");
  });
  const candidates = await extractors.dood("https://dood.wf/e/abc", {
    provider: "animostream",
    anilistId: "16498",
    episodeNumber: 7
  });
  assert.deepEqual(Array.from(candidates), []);
  assert.equal(requests, 1);
});

test("StreamTape reproduces the robotlink URL assembly and /e/{id} mapping", async () => {
  const calls = [];
  const extractors = loadExtractors(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://streamtape.com/e/abc123") {
      return response(
        "<script>document.getElementById('robotlink').innerHTML = '//streamtape.com/get_video?id=abc' + ('xcd12345');</script>"
      );
    }
    throw new Error("Unexpected request " + url);
  });

  const candidates = await extractors.streamtape("https://streamtape.com/v/abc123/title", {
    provider: "animostream",
    anilistId: "16498",
    episodeNumber: 2,
    labelPrefix: "StreamTape [DUB]"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://streamtape.com/e/abc123");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://streamtape.com/get_video?id=abc12345");
  assert.equal(candidates[0].type, "mp4");
  assert.equal(candidates[0].quality, "Auto");
  assert.equal(candidates[0].name, "StreamTape [DUB]");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 2);
});

test("VidMoly normalizes its host, preserves headers and parses HLS variants/subtitles", async () => {
  const calls = [];
  const extractors = loadExtractors(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u === "https://vidmoly.biz/video/xyz") {
      return response('<script>var player = { sources: [{file:"https://media.example/master.m3u8"}], tracks: [] };</script>');
    }
    if (u === "https://media.example/master.m3u8") {
      return response([
        "#EXTM3U",
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en.m3u8"',
        "#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080",
        "1080/index.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720",
        "720/index.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected request " + u);
  });

  const candidates = await extractors.vidmoly("https://other-host.example/video/xyz", {
    provider: "animesalt",
    anilistId: "16498",
    episodeNumber: 3,
    language: "Japanese",
    labelPrefix: "JP · Main"
  });

  assert.equal(calls[0].url, "https://vidmoly.biz/video/xyz");
  assert.equal(calls[0].options.headers.Origin, "https://vidmoly.biz");
  assert.equal(calls[0].options.headers.Referer, "https://vidmoly.biz/");
  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((item) => item.url === "https://media.example/1080/index.m3u8" && item.quality === "1080p"));
  assert.ok(candidates.some((item) => item.url === "https://media.example/720/index.m3u8" && item.quality === "720p"));
  assert.ok(candidates.every((item) => item.provider === "animesalt"));
  assert.ok(candidates.every((item) => item.anilistId === "16498" && item.episodeNumber === 3));
  assert.ok(candidates.every((item) => item.subtitles.some((sub) => sub.url === "https://media.example/subs/en.m3u8" && sub.lang === "en")));
});

test("VidMoly preserves the master when separate audio groups are declared", async () => {
  const extractors = loadExtractors(async (url) => {
    if (String(url) === "https://vidmoly.biz/embed/xyz") {
      return response('<script>var player = { sources: [{file:"https://media.example/audio-master.m3u8"}], };</script>');
    }
    if (String(url) === "https://media.example/audio-master.m3u8") {
      return response([
        "#EXTM3U",
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",LANGUAGE="ja",URI="audio/ja.m3u8"',
        "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO=\"audio\"",
        "video/720.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected request " + url);
  });

  const candidates = await extractors.vidmoly("https://vidmoly.biz/embed/xyz", {
    provider: "animesalt",
    anilistId: "16498",
    episodeNumber: 4
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://media.example/audio-master.m3u8");
  assert.equal(candidates[0].quality, "Auto");
});

test("shared extractors reject mismatched or incomplete anime identity before networking", async () => {
  let requests = 0;
  const extractors = loadExtractors(async () => {
    requests += 1;
    throw new Error("Network should not be used");
  });
  const options = { provider: "animostream", anilistId: "0", episodeNumber: 1 };
  assert.deepEqual(Array.from(await extractors.dood("https://dood.wf/e/a", options)), []);
  assert.deepEqual(Array.from(await extractors.streamtape("https://streamtape.com/v/a", options)), []);
  assert.deepEqual(Array.from(await extractors.vidmoly("https://vidmoly.biz/e/a", options)), []);
  assert.equal(requests, 0);
});
