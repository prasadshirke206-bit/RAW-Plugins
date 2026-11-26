import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/anilight.js");
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
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    Uint8Array,
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

function fixtureContext() {
  return {
    title: "AniLight Fixture Anime",
    titles: ["AniLight Fixture Anime"],
    providerMappings: { anilight: { slug: "fixture-anime" } },
    preferredAudio: "sub"
  };
}

async function encryptMegaFile(file, keyText, ivText) {
  const keyBytes = new Uint8Array(32);
  keyBytes.set(new TextEncoder().encode(keyText).slice(0, 32));
  const key = await webcrypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const cipher = await webcrypto.subtle.encrypt(
    { name: "AES-CBC", iv: new TextEncoder().encode(ivText) },
    key,
    new TextEncoder().encode(JSON.stringify({ file }))
  );
  return Buffer.from(new Uint8Array(cipher)).toString("base64url");
}

test("AniLight follows Kotlin's MegaPlay getSources URL, referer and track filtering", async () => {
  const calls = [];
  const embedUrl = "https://megaplay.buzz/stream/s-2/fixture/sub";
  const masterUrl = "https://cdn.example/master.m3u8";
  const { getStreams } = loadProvider(async (url, options) => {
    const value = String(url);
    calls.push({ url: value, options: options || {} });
    if (value === "https://api.anilight.live/api/watch/fixture-anime") {
      return response({ episodes: [{ number: 1, embed_url: { sub: embedUrl } }] });
    }
    if (value === embedUrl) return response('<div data-id="media-abc-123"></div>', 200, "text/html");
    if (value === "https://megaplay.buzz/stream/getSources?id=media-abc-123&id=media-abc-123") {
      return response({
        sources: { file: masterUrl },
        tracks: [
          { file: "https://subs.example/en.vtt", label: "English", kind: "captions" },
          { file: "https://subs.example/unknown.vtt", label: "Alt", kind: "custom" },
          { file: "https://subs.example/thumbs.vtt", label: "Preview", kind: "thumbnails" }
        ]
      });
    }
    if (value === masterUrl) {
      return response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720\n720.m3u8",
        200,
        "application/vnd.apple.mpegurl"
      );
    }
    throw new Error("Unexpected AniLight request: " + value);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, fixtureContext());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://cdn.example/720.m3u8");
  assert.equal(candidates[0].quality, "720p");
  assert.equal(candidates[0].title, "720p [Soft Sub]");
  assert.equal(candidates[0].language, "sub");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 1);
  assert.equal(candidates[0].subtitles.length, 2);
  assert.ok(!candidates[0].subtitles.some((track) => track.url.includes("thumbs")));
  const sourceCall = calls.find((call) => call.url.includes("/stream/getSources"));
  assert.ok(sourceCall);
  assert.equal(sourceCall.url, "https://megaplay.buzz/stream/getSources?id=media-abc-123&id=media-abc-123");
  assert.equal(sourceCall.options.headers.Referer, "https://megaplay.buzz/");
  const playlistCall = calls.find((call) => call.url === masterUrl);
  assert.equal(playlistCall.options.headers.Referer, "https://megaplay.buzz/");
});

test("AniLight refreshes the rotated MegaPlay AES key and IV like Kotlin", async () => {
  const calls = [];
  const embedUrl = "https://megaplay.buzz/stream/s-2/fixture/sub";
  const masterUrl = "https://cdn.example/rotated-master.m3u8";
  const rotatedKey = "rotated-key-material-2026";
  const rotatedIv = "0123456789abcdef";
  const encrypted = await encryptMegaFile(masterUrl, rotatedKey, rotatedIv);
  const { getStreams } = loadProvider(async (url, options) => {
    const value = String(url);
    calls.push({ url: value, options: options || {} });
    if (value === "https://api.anilight.live/api/watch/fixture-anime") {
      return response({ episodes: [{ number: 1, embed_url: { sub: embedUrl } }] });
    }
    if (value === embedUrl) return response('<div data-id="654321"></div>', 200, "text/html");
    if (value === "https://megaplay.buzz/stream/getSources?id=654321&id=654321") {
      return response({ enc: encrypted, tracks: [] });
    }
    if (value === "https://megaplay.buzz/lib/newclient.min.js") {
      return response(
        'const key = ["trustAesKey", "TRUST_AES_KEY"], "' + rotatedKey + '";' +
        'const iv = ["trustAesIv", "TRUST_AES_IV"], "' + rotatedIv + '";',
        200,
        "text/javascript"
      );
    }
    if (value === masterUrl) return response("#EXTM3U\n#EXTINF:5,\nsegment.ts", 200, "application/vnd.apple.mpegurl");
    throw new Error("Unexpected AniLight request: " + value);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, fixtureContext());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, masterUrl);
  assert.equal(candidates[0].title, "Auto [Sub]");
  assert.ok(calls.some((call) => call.url === "https://megaplay.buzz/lib/newclient.min.js"));
});

test("AniLight parses arbitrary non-numeric MegaPlay data-id values", async () => {
  const calls = [];
  const embedUrl = "https://megaplay.buzz/stream/s-2/fixture/dub";
  const { getStreams } = loadProvider(async (url, options) => {
    const value = String(url);
    calls.push({ url: value, options: options || {} });
    if (value === "https://api.anilight.live/api/watch/fixture-anime") {
      return response({ episodes: [{ number: 1, embed_url: { dub: embedUrl } }] });
    }
    if (value === embedUrl) return response('<div data-id="stream-token-42"></div>', 200, "text/html");
    if (value === "https://megaplay.buzz/stream/getSources?id=stream-token-42&id=stream-token-42") {
      return response({ sources: { file: "https://cdn.example/dub.m3u8" }, tracks: [] });
    }
    if (value === "https://cdn.example/dub.m3u8") return response("#EXTM3U\n#EXTINF:5,\nseg.ts", 200, "application/vnd.apple.mpegurl");
    throw new Error("Unexpected AniLight request: " + value);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, fixtureContext());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, "Auto [Dub]");
  assert.ok(calls.some((call) => call.url.endsWith("id=stream-token-42&id=stream-token-42")));
});
