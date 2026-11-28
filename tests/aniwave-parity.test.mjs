import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/aniwave.js");
const source = fs.readFileSync(filename, "utf8");

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

function loadProvider(fetchImpl) {
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
    __raw_create_media_proxy: (url, headers, options) => {
      proxyCalls.push({
        url: String(url),
        headers: JSON.parse(String(headers)),
        options: JSON.parse(String(options))
      });
      proxyIndex++;
      return "http://127.0.0.1:43523/hls/aniwave" + proxyIndex;
    },
    crypto: webcrypto,
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

async function encryptMegaFile(fileUrl) {
  const keyBytes = new Uint8Array(32);
  keyBytes.set(new TextEncoder().encode("i?LMTAx0Q6,:}50U"));
  const iv = new TextEncoder().encode("W0;27ToaUpl_P%'c");
  const key = await webcrypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    new TextEncoder().encode(JSON.stringify({ file: fileUrl }))
  );
  return Buffer.from(new Uint8Array(encrypted)).toString("base64url");
}

test("AniWave eight-stage VRF matches Kotlin and remains distinct from Anikoto/Sogo", () => {
  const { exports } = loadProvider(async () => response(""));
  assert.equal(exports.__test.vrf("12345"), "cE9mRHFGM2htNXRBMmFSTQ%3D%3D");
  assert.equal(exports.__test.vrf("123"), "cEpfVjExcm9oLWc9");
  assert.equal(exports.__test.vrf("42"), "cEpfRjFTSG91dWc9");
});

test("AniWave maps the exact AniList episode, applies its VRF, and resolves the requested HTML server", async () => {
  const holder = {};
  let proxyIndex = 0;
  const { exports, calls, proxyCalls } = loadProvider(async (url, init = {}) => {
    if (url === "https://animewave.to/filter?keyword=Wave%20Fixture&page=1&vrf=" + holder.vrf) {
      return response('<div class="ani items"><div class="item"><a class="name" href="/watch/wave-fixture">Wave Fixture</a></div></div>', { url });
    }
    if (url === "https://animewave.to/watch/wave-fixture") {
      return response('<div data-id="wave-id-500"></div>', { url });
    }
    if (url === "https://animewave.to/ajax/episode/list/wave-id-500") {
      return response({
        result:
          '<div class="episodes"><ul>' +
          '<li><a data-num="4" data-ids="old-server" data-mal="90" data-slug="old" data-timestamp="1">4</a></li>' +
          '<li><a data-num="5" data-ids="selected-servers" data-mal="100" data-slug="selected" data-timestamp="2" data-sub="1">5</a></li>' +
          '</ul></div>'
      }, { url });
    }
    if (url === "https://animewave.to/ajax/server/list?servers=selected-servers") {
      return response({
        result:
          '<div class="servers"><div class="type" data-type="sub"><label>Sub</label>' +
          '<ul><li data-link-id="server-5">VidPlay</li><li data-link-id="server-6">HD-1</li></ul>' +
          '</div></div>'
      }, { url });
    }
    if (url === "https://animewave.to/ajax/server?get=server-5") {
      return response({ result: { url: "https://vidplay.example/embed/5/sub" } }, { url });
    }
    if (url === "https://animewave.to/ajax/server?get=server-6") {
      return response({ result: { url: "https://cdn.example/direct.m3u8" } }, { url });
    }
    if (url === "https://vidplay.example/embed/5/sub") {
      return response('<div data-id="vid-5"></div>', { url });
    }
    if (url.startsWith("https://vidplay.example/stream/getSources?")) {
      return response({ sources: "https://cdn.example/megaplay-master.m3u8", tracks: [{ kind: "captions", label: "English", file: "https://subs.example/en.vtt" }] }, { url });
    }
    if (url === "https://cdn.example/direct.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080\n1080.m3u8", { url });
    }
    if (url === "https://cdn.example/1080.m3u8") {
      return response("#EXTM3U\n#EXTINF:6,\nsegment.ts", { url });
    }
    if (url === "https://cdn.example/megaplay-master.m3u8") {
      return response("#EXTM3U\n#EXTINF:6,\nsegment.ts", { url });
    }
    if (url === "https://subs.example/en.vtt") return response("WEBVTT\n", { url });
    throw new Error("Unexpected AniWave request: " + url);
  });

  holder.vrf = (await loadProvider(async () => response(""))).exports.__test.vrf("Wave Fixture");
  const candidates = await exports.getStreams("16498", "anime", 1, 5, {
    title: "Wave Fixture",
    titles: ["Wave Fixture"],
    preferredServer: "VidPlay",
    preferredType: "Sub"
  });
  assert.ok(candidates.length >= 1);
  for (const item of candidates) {
    assert.equal(item.anilistId, "16498");
    assert.equal(item.episodeNumber, 5);
    assert.equal(item.provider, "aniwave");
  }
  assert.ok(candidates.every((item) => item.url.startsWith("http://127.0.0.1:43523/hls/aniwave")));
  const search = calls.find((call) => call.url.includes("/filter?"));
  assert.ok(search);
  assert.equal(new URL(search.url).searchParams.get("vrf"), holder.vrf);
  assert.ok(calls.some((call) => call.url === "https://animewave.to/ajax/server?get=server-5"));
  assert.ok(calls.some((call) => call.url === "https://animewave.to/ajax/server?get=server-6"));
  assert.ok(!calls.some((call) => call.url.includes("servers=old-server")));
  assert.ok(proxyCalls.some((call) => call.options.stripMode === "png-webp"));
  assert.ok(proxyCalls.some((call) => call.options.stripMode === "image-to-ts"));
  assert.ok(candidates.some((candidate) => candidate.subtitles.length === 1));
});

test("AniWave getSources retries new endpoint/CDN selector and decodes an AES-CBC MegaPlay enc payload", async () => {
  const encrypted = await encryptMegaFile("https://cdn.example/encrypted-master.m3u8");
  const { exports, calls, proxyCalls } = loadProvider(async (url) => {
    if (url.includes("/filter?")) return response('<a href="/watch/wave-encrypted">Wave Encrypted</a>', { url });
    if (url === "https://animewave.to/watch/wave-encrypted") return response('<div data-id="wave-encrypted-id"></div>', { url });
    if (url.startsWith("https://animewave.to/ajax/episode/list/")) {
      return response({ result: '<a data-num="2" data-ids="two" data-mal="1" data-slug="slug" data-timestamp="2">2</a>' }, { url });
    }
    if (url === "https://animewave.to/ajax/server/list?servers=two") {
      return response({ result: '<div class="type" data-type="sub"><label>Sub</label><li data-link-id="encrypted-server">VidPlay</li></div>' }, { url });
    }
    if (url === "https://animewave.to/ajax/server?get=encrypted-server") return response({ result: { url: "https://megaplay.buzz/stream/fixture/sub?s=cdn-choice" } }, { url });
    if (url.startsWith("https://megaplay.buzz/stream/fixture/sub")) return response('<div data-id="encrypted-data-id"></div>', { url });
    if (url.startsWith("https://megaplay.buzz/stream/getSources?")) return response({ sources: "", enc: encrypted, tracks: [] }, { url });
    if (url.startsWith("https://megaplay.buzz/stream/getSourcesNew?")) return response({ enc: encrypted, tracks: [] }, { url });
    if (url === "https://cdn.example/encrypted-master.m3u8") return response("#EXTM3U\n#EXTINF:6,\nsegment.ts", { url });
    throw new Error("Unexpected encrypted AniWave request: " + url);
  });
  const candidates = await exports.getStreams("16498", "anime", 1, 2, {
    title: "Wave Encrypted",
    titles: ["Wave Encrypted"]
  });
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].url.startsWith("http://127.0.0.1:43523/"));
  const sourceCalls = calls.filter((call) => call.url.includes("/stream/getSources"));
  assert.ok(sourceCalls.some((call) => call.url.includes("s=cdn-choice")));
  assert.ok(sourceCalls.some((call) => call.url.includes("getSourcesNew")));
  assert.ok(proxyCalls.some((call) => call.options.stripMode === "png-webp"));
});

test("AniWave rejects invalid media and AniList identities without networking", async () => {
  const { exports, calls } = loadProvider(async () => {
    throw new Error("network must not run for invalid input");
  });
  assert.deepEqual(Array.from(await exports.getStreams("16498", "movie", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("bad", "anime", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("16498", "anime", 1, 0)), []);
  assert.equal(calls.length, 0);
});
