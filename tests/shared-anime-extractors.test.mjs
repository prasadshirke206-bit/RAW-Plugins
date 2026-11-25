import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { webcrypto, createCipheriv, createHash } from "node:crypto";

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
    text: async () => body,
    json: async () => typeof body === "string" ? JSON.parse(body) : body
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
    Error,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    atob,
    btoa,
    decodeURIComponent,
    encodeURIComponent,
    unescape
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


function abyssKeyForTest(seed) {
  let cleaned = String(seed);
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) cleaned = cleaned.slice(0, firstDot) + cleaned.slice(firstDot + 1);
  cleaned = cleaned.replace(/:/g, "").replace(/-/g, "");
  const allDigits = cleaned.length > 0 && /^[0-9]+$/.test(cleaned);
  const source = allDigits
    ? Buffer.from(Array.from(String(seed), (ch) => /^[0-9]$/.test(ch) ? Number(ch) : ch.charCodeAt(0) & 255))
    : Buffer.from(String(seed), "utf8");
  return Buffer.from(createHash("md5").update(source).digest("hex"), "utf8");
}

function encryptAbyssForTest(plainText, seed) {
  const key = abyssKeyForTest(seed);
  const cipher = createCipheriv("aes-256-ctr", key, key.subarray(0, 16));
  return Buffer.concat([cipher.update(Buffer.from(plainText, "utf8")), cipher.final()]);
}

function abyssDatasHtml(mediaPayload, metadata = {}) {
  const seed = String(metadata.user_id || "42") + ":" + String(metadata.slug || "test-slug") + ":" + String(metadata.md5_id || "123");
  const encrypted = encryptAbyssForTest(JSON.stringify(mediaPayload), seed);
  const binaryJson = '{"slug":"' + (metadata.slug || "test-slug") +
    '","md5_id":"' + (metadata.md5_id || "123") +
    '","user_id":"' + (metadata.user_id || "42") +
    '","media":"' + Array.from(encrypted, (byte) => "\\u" + byte.toString(16).padStart(4, "0")).join("") +
    '","isDownload":false}';
  return '<script>const datas = "' + Buffer.from(binaryJson, "latin1").toString("base64") + '";</script>';
}

test("Abyss decrypts the Kotlin MD5/AES-CTR datas payload and returns HLS, MP4 and subtitles", async () => {
  const html = abyssDatasHtml({
    hls: { file: "https://cdn.example/abyss/master.m3u8", label: "Main" },
    mp4: {
      sources: [{ label: "720p", size: "100", file: "https://cdn.example/abyss/video.mp4" }],
      domains: []
    },
    subtitles: [{ src: "https://cdn.example/abyss/en.vtt", label: "English" }]
  });
  const calls = [];
  const extractors = loadExtractors(async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value === "https://abyssplayer.com/?v=epabc") return response(html, { url: value });
    if (value === "https://cdn.example/abyss/master.m3u8") {
      return response([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
        "720/index.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected Abyss request " + value);
  });

  const candidates = await extractors.abyss("https://short.icu/epabc", {
    provider: "animesalt",
    anilistId: "16498",
    episodeNumber: 5,
    language: "sub",
    referer: "https://animesalt.me/"
  });

  assert.equal(calls[0].url, "https://abyssplayer.com/?v=epabc");
  assert.equal(calls[0].options.headers.Referer, "https://animesalt.me/");
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, "https://cdn.example/abyss/720/index.m3u8");
  assert.equal(candidates[0].quality, "720p");
  assert.equal(candidates[0].type, "m3u8");
  assert.equal(candidates[1].url, "https://cdn.example/abyss/video.mp4?ext=.mp4");
  assert.equal(candidates[1].type, "mp4");
  assert.ok(candidates.every((item) => item.provider === "animesalt"));
  assert.ok(candidates.every((item) => item.anilistId === "16498" && item.episodeNumber === 5));
  assert.ok(candidates.every((item) => item.subtitles.some((sub) => sub.url === "https://cdn.example/abyss/en.vtt" && sub.lang === "English")));
});

test("Abyss matches Kotlin numeric-seed Sora AES-CTR token construction", async () => {
  const payload = {
    mp4: {
      domains: ["https://sora.example"],
      sources: [{ label: "1080p", size: "12345", res_id: "res-1", sub: "sora.example" }]
    }
  };
  const html = abyssDatasHtml(payload);
  const extractors = loadExtractors(async (url) => {
    if (String(url) === "https://abyssplayer.com/?v=episode") return response(html, { url: String(url) });
    throw new Error("Unexpected request " + url);
  });

  const candidates = await extractors.abyss("https://abyssplayer.com/?v=episode", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 9,
    referer: "https://www.animostream.xyz/"
  });

  const key = abyssKeyForTest("12345");
  const cipher = createCipheriv("aes-256-ctr", key, key.subarray(0, 16));
  const pathValue = "/mp4/123/res-1/12345?v=test-slug";
  const transformed = Buffer.concat([cipher.update(Buffer.from(pathValue, "utf8")), cipher.final()]);
  const first = transformed.toString("base64").replace(/=+$/g, "");
  const expectedToken = Buffer.from(first, "utf8").toString("base64").replace(/=+$/g, "");

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://sora.example/sora/12345/" + expectedToken);
  assert.equal(candidates[0].name, "Abyss - 1080p (Sora)");
  assert.equal(candidates[0].type, "mp4");
  assert.equal(candidates[0].anilistId, "21");
  assert.equal(candidates[0].episodeNumber, 9);
});

test("Abyss rejects invalid anime identity before making requests", async () => {
  let requests = 0;
  const extractors = loadExtractors(async () => {
    requests++;
    throw new Error("Network should not be used");
  });
  assert.deepEqual(Array.from(await extractors.abyss("https://abyssplayer.com/?v=x", {
    provider: "animostream",
    anilistId: "0",
    episodeNumber: 1
  })), []);
  assert.deepEqual(Array.from(await extractors.abyss("https://abyssplayer.com/?v=x", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 0
  })), []);
  assert.equal(requests, 0);
});

test("Abyss fails closed when encrypted media cannot be decrypted", async () => {
  const raw = '{"slug":"wrong","md5_id":"123","user_id":"42","media":"not-valid-ciphertext"}';
  const html = '<script>var datas = "' + Buffer.from(raw, "latin1").toString("base64") + '";</script>';
  const extractors = loadExtractors(async (url) => {
    if (String(url) === "https://abyssplayer.com/?v=x") return response(html, { url: String(url) });
    throw new Error("Unexpected request " + url);
  });
  const candidates = await extractors.abyss("https://abyssplayer.com/?v=x", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 1
  });
  assert.deepEqual(Array.from(candidates), []);
});

test("Abyss legacy domain/id fallback remains available", async () => {
  const html = '<script>var player = {"domain":"legacy.example","id":"stream123"};</script>';
  const extractors = loadExtractors(async (url) => response(html, { url: String(url) }));
  const candidates = await extractors.abyss("https://abyssplayer.com/?v=legacy", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 1
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://legacy.example/stream123");
  assert.equal(candidates[0].name, "Abyss - Video");
  assert.equal(candidates[0].headers.Referer, "https://abyssplayer.com/?v=legacy");
});


test("AnimeSalt and Animostream route recognized Abyss hosts into the shared runtime", () => {
  const animostream = fs.readFileSync(path.join(root, "providers/anime/animostream.js"), "utf8");
  const animesalt = fs.readFileSync(path.join(root, "providers/anime/animesalt.js"), "utf8");
  assert.match(animostream, /ext\.abyss\(u,/);
  assert.match(animesalt, /abyssShared\.abyss\(azAbs\(u,page\)/);
});


test("Filemoon unpacks P.A.C.K.E.R. and returns HLS variants plus subtitle metadata", async () => {
  const pageUrl = "https://filemoon.sx/e/abc?sub.info=https%3A%2F%2Fsubs.example%2Flist.json";
  const packed = '<script>eval(function(p,a,c,k,e,d){return p;}(' +
    '\'({file:"0"})\',36,1,\'https://media.example/master.m3u8\'.split(\'|\'),0,{}))</script>';
  const calls = [];
  const extractors = loadExtractors(async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value === pageUrl) return response(packed, { url: pageUrl });
    if (value === "https://subs.example/list.json") {
      return response(JSON.stringify([{ file: "https://subs.example/en.vtt", label: "English" }]));
    }
    if (value === "https://media.example/master.m3u8") {
      return response([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080",
        "1080/index.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720",
        "720/index.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected Filemoon request " + value);
  });

  const candidates = await extractors.filemoon(pageUrl, {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 4,
    language: "sub"
  });

  assert.equal(calls[0].url, pageUrl);
  assert.equal(calls[0].options.headers.Referer, pageUrl);
  assert.equal(calls[0].options.headers.Origin, "https://filemoon.sx");
  assert.ok(calls.some((call) => call.url === "https://subs.example/list.json"));
  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((item) =>
    item.url === "https://media.example/1080/index.m3u8" &&
    item.quality === "1080p" &&
    item.name === "FileMoon - 1080p"
  ));
  assert.ok(candidates.some((item) =>
    item.url === "https://media.example/720/index.m3u8" &&
    item.quality === "720p" &&
    item.name === "FileMoon - 720p"
  ));
  assert.ok(candidates.every((item) => item.provider === "animostream"));
  assert.ok(candidates.every((item) => item.anilistId === "21" && item.episodeNumber === 4));
  assert.ok(candidates.every((item) =>
    item.subtitles.some((sub) => sub.url === "https://subs.example/en.vtt" && sub.lang === "English")
  ));
  assert.ok(candidates.every((item) => item.headers.Referer === "https://filemoon.sx/"));
});

test("Filemoon follows an iframe when the parent page has no packed player script", async () => {
  const pageUrl = "https://filemoon.sx/e/iframe-case";
  const iframeUrl = "https://embed.filemoon.sx/embed/xyz";
  const packed = '<script>eval(function(p,a,c,k,e,d){return p;}(' +
    '\'({file:"0"})\',36,1,\'https://media.example/iframe-master.m3u8\'.split(\'|\'),0,{}))</script>';
  const calls = [];
  const extractors = loadExtractors(async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value === pageUrl) return response('<iframe src="https://embed.filemoon.sx/embed/xyz"></iframe>', { url: pageUrl });
    if (value === iframeUrl) return response(packed, { url: iframeUrl });
    if (value === "https://media.example/iframe-master.m3u8") {
      return response([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480",
        "480/index.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected Filemoon request " + value);
  });

  const candidates = await extractors.filemoon(pageUrl, {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 1
  });

  assert.deepEqual(calls.slice(0, 2).map((call) => call.url), [pageUrl, iframeUrl]);
  assert.equal(calls[1].options.headers.Referer, pageUrl);
  assert.equal(calls[1].options.headers.Origin, "https://filemoon.sx");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://media.example/480/index.m3u8");
  assert.equal(candidates[0].quality, "480p");
  assert.equal(candidates[0].headers.Referer, "https://embed.filemoon.sx/");
});

test("Filemoon rejects non-P.A.C.K.E.R. embeds and invalid anime identity", async () => {
  let requests = 0;
  const extractors = loadExtractors(async (url) => {
    requests++;
    return response('<script>var player = {file:"https://cdn.example/master.m3u8"}</script>', { url: String(url) });
  });

  assert.deepEqual(Array.from(await extractors.filemoon("https://filemoon.sx/e/not-packed", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 1
  })), []);
  assert.deepEqual(Array.from(await extractors.filemoon("https://filemoon.sx/e/invalid-id", {
    provider: "animostream",
    anilistId: "0",
    episodeNumber: 1
  })), []);
  assert.equal(requests, 1);
});

test("Animostream routes Filemoon links into the shared extractor", () => {
  const source = fs.readFileSync(path.join(root, "providers/anime/animostream.js"), "utf8");
  assert.match(source, /ext\.filemoon\(u,/);
});


test("Filemoon P.A.C.K.E.R. supports the Kotlin radix-95 alphabet", async () => {
  const symbols = Array(37).fill("").concat("https://media.example/radix95.m3u8").join("|");
  const packed = '<script>eval(function(p,a,c,k,e,d){return p;}(' +
    '\'({file:"D"})\',95,38,\'' + symbols + '\'.split(\'|\'),0,{}))</script>';
  const extractors = loadExtractors(async (url) => {
    const value = String(url);
    if (value === "https://filemoon.sx/e/radix95") return response(packed, { url: value });
    if (value === "https://media.example/radix95.m3u8") {
      return response([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
        "360/index.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected Filemoon request " + value);
  });

  const candidates = await extractors.filemoon("https://filemoon.sx/e/radix95", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 12
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://media.example/360/index.m3u8");
  assert.equal(candidates[0].quality, "360p");
});


function encryptEmbedSeekForTest(value) {
  const key = Buffer.from("kiemtienmua911ca", "utf8");
  const iv = Buffer.from("1234567890oiuytr", "utf8");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final()
  ]).toString("hex");
}

test("EmbedSeek decrypts Kotlin AES-CBC payload and returns exact HLS variants/subtitles", async () => {
  const payload = {
    source: "https://cdn.example/embedseek/master.m3u8",
    subtitle: {
      en: "/subs/embedseek-en.vtt#session",
      hi: "https://subs.example/embedseek-hi.vtt#token",
      jp: ""
    }
  };
  const encrypted = encryptEmbedSeekForTest(payload);
  const calls = [];
  const extractors = loadExtractors(async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value === "https://animostream.embedseek.online/api/v1/video?id=episode-77&w=1920&h=1080&r=www.animostream.xyz") {
      return response(encrypted);
    }
    if (value === payload.source) {
      return response([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080",
        "1080/index.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=2100000,RESOLUTION=1280x720",
        "720/index.m3u8"
      ].join("\n"));
    }
    throw new Error("Unexpected EmbedSeek request " + value);
  });

  const candidates = await extractors.embedseek(
    "https://www.animostream.xyz/watch/#episode-77&source=embedseek",
    {
      provider: "animostream",
      anilistId: "21",
      episodeNumber: 77,
      referer: "https://www.animostream.xyz/"
    }
  );

  assert.equal(calls[0].url, "https://animostream.embedseek.online/api/v1/video?id=episode-77&w=1920&h=1080&r=www.animostream.xyz");
  assert.equal(calls[0].options.headers.Referer, "https://www.animostream.xyz/");
  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((item) =>
    item.url === "https://cdn.example/embedseek/1080/index.m3u8" &&
    item.quality === "1080p" &&
    item.name === "EmbedSeek - 1080p"
  ));
  assert.ok(candidates.some((item) =>
    item.url === "https://cdn.example/embedseek/720/index.m3u8" &&
    item.quality === "720p" &&
    item.name === "EmbedSeek - 720p"
  ));
  assert.ok(candidates.every((item) => item.provider === "animestream"));
  assert.ok(candidates.every((item) => item.anilistId === "21" && item.episodeNumber === 77));
  assert.ok(candidates.every((item) =>
    item.subtitles.some((sub) => sub.url === "https://animostream.embedseek.online/subs/embedseek-en.vtt" && sub.lang === "English") &&
    item.subtitles.some((sub) => sub.url === "https://subs.example/embedseek-hi.vtt#token" && sub.lang === "Hindi")
  ));
  assert.ok(candidates.every((item) => item.headers.Referer === "https://animostream.embedseek.online/"));
});

test("EmbedSeek returns direct MP4 source with provider subtitle tracks", async () => {
  const payload = {
    source: "https://cdn.example/embedseek/video.mp4",
    subtitle: { en: "/subs/direct-en.vtt" }
  };
  const encrypted = encryptEmbedSeekForTest(payload);
  const extractors = loadExtractors(async (url) => {
    assert.equal(String(url), "https://animostream.embedseek.online/api/v1/video?id=direct-ep&w=1920&h=1080&r=www.animostream.xyz");
    return response(encrypted);
  });

  const candidates = await extractors.embedseek("https://www.animostream.xyz/watch?id=direct-ep", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 2,
    referer: "https://www.animostream.xyz/"
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, payload.source);
  assert.equal(candidates[0].name, "EmbedSeek - Video");
  assert.equal(candidates[0].type, "mp4");
  assert.equal(candidates[0].subtitles[0].url, "https://animostream.embedseek.online/subs/direct-en.vtt");
  assert.equal(candidates[0].anilistId, "21");
  assert.equal(candidates[0].episodeNumber, 2);
});

test("EmbedSeek fails closed on invalid ciphertext and invalid anime identity", async () => {
  let requests = 0;
  const extractors = loadExtractors(async () => {
    requests++;
    return response("not-hex-ciphertext");
  });

  assert.deepEqual(Array.from(await extractors.embedseek("https://animostream.xyz/watch?id=bad", {
    provider: "animostream",
    anilistId: "21",
    episodeNumber: 1
  })), []);
  assert.deepEqual(Array.from(await extractors.embedseek("https://animostream.xyz/watch?id=bad", {
    provider: "animostream",
    anilistId: "0",
    episodeNumber: 1
  })), []);
  assert.equal(requests, 1);
});

test("Animostream routes EmbedSeek links into the shared extractor", () => {
  const source = fs.readFileSync(path.join(root, "providers/anime/animostream.js"), "utf8");
  assert.match(source, /ext\.embedseek\(u,/);
});
