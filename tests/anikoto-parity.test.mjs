import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHmac, webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/anikoto.js");
const providerSource = fs.readFileSync(filename, "utf8");

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
  const logs = [];
  const sandbox = {
    module: { exports: {} },
    console: { log(...args) { logs.push(args.join(" ")); }, warn() {}, error() {} },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    },
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
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
    Math
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(providerSource, context, { filename, timeout: 5000 });
  return { getStreams: context.module.exports.getStreams, calls, logs, context };
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

test("Anikoto matches Kotlin episode VRF, MegaPlay HMAC token, referers and ASS subtitle preference", async () => {
  const embedUrl = "https://megaplay.buzz/stream/s-2/media-abc/sub?s=fixture-session";
  const firstPathKey = "0123456789abcdef0123456789abcdef";
  const secondPathKey = "abcdef0123456789abcdef0123456789";
  const masterUrl = "https://cdn.example/" + firstPathKey + "/" + secondPathKey + "/master.m3u8";
  const encrypted = await encryptMegaFile(masterUrl);
  const { getStreams, calls: providerCalls, logs: providerLogs } = loadProvider(async (url, init) => {
    const value = String(url);
    if (value === "https://anikototv.bz/watch/test-anime") {
      return response('<div data-id="site-id-123"></div>', { url: value });
    }
    if (value.startsWith("https://anikototv.bz/ajax/episode/list/site-id-123?")) {
      return response({
        result: '<a data-num="1" data-ids="srv-1"></a>'
      }, { url: value });
    }
    if (value === "https://anikototv.bz/ajax/server/list?servers=srv-1") {
      return response({
        result: '<div class="type" data-type="Sub"><ul><li data-link-id="srv-1">HD-1</li></ul></div>'
      }, { url: value });
    }
    if (value === "https://anikototv.bz/ajax/server?get=srv-1") {
      return response({ result: { url: embedUrl } }, { url: value });
    }
    if (value === embedUrl) {
      return response('<div data-id="media-id-token"></div>', { url: value });
    }
    if (value.startsWith("https://megaplay.buzz/stream/getSources?")) {
      return response({
        enc: encrypted,
        sources: null,
        tracks: [
          { file: "https://subs.example/english.vtt", label: "English", kind: "captions" },
          { file: "https://subs.example/english.ass", label: "English", kind: "captions" },
          { file: "https://subs.example/thumbnails.vtt", label: "Preview", kind: "thumbnails" },
          { file: "https://subs.example/french.vtt", label: "French", kind: "captions" }
        ],
        intro: { start: 3, end: 87 },
        outro: { start: 1250, end: 1320 }
      }, { url: value });
    }
    if (value.startsWith(masterUrl)) {
      return response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080\n1080.m3u8",
        { url: value }
      );
    }
    throw new Error("Unexpected Anikoto request: " + value);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, {
    title: "Fixture Anime",
    titles: ["Fixture Anime"],
    idMal: 12345,
    providerMappings: { anikoto: { url: "https://anikototv.bz/watch/test-anime" } },
    preferredAudio: "sub"
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://cdn.example/" + firstPathKey + "/" + secondPathKey + "/1080.m3u8");
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 1);
  assert.equal(candidates[0].subtitles.length, 2);
  assert.deepEqual(Array.from(candidates[0].subtitles.map((track) => track.url)), [
    "https://subs.example/english.ass",
    "https://subs.example/french.vtt"
  ]);
  assert.equal(candidates[0].internalData, "https://subs.example/thumbnails.vtt");
  assert.deepEqual(Array.from(candidates[0].timestamps.map((item) => item.name)), ["Intro", "Outro"]);

  const episodeCall = providerCalls.find((call) => call.url.includes("/ajax/episode/list/"));
  assert.ok(episodeCall, JSON.stringify({ calls: providerCalls.map((call) => call.url), logs: providerLogs }, null, 2));
  const episodeUrl = new URL(episodeCall.url);
  assert.ok(episodeUrl.searchParams.get("vrf"));
  assert.notEqual(episodeUrl.searchParams.get("vrf"), "");
  assert.equal(episodeCall.init.headers.Referer, "https://anikototv.bz/watch/test-anime");

  const sourcesCall = providerCalls.find((call) => call.url.includes("/stream/getSources?"));
  assert.ok(sourcesCall, JSON.stringify({ calls: providerCalls.map((call) => call.url), logs: providerLogs }, null, 2));
  const sourcesUrl = new URL(sourcesCall.url);
  assert.equal(sourcesUrl.searchParams.get("id"), "media-id-token");
  assert.equal(sourcesUrl.searchParams.get("st"), "other");
  assert.equal(sourcesUrl.searchParams.get("s"), "fixture-session");
  assert.equal(sourcesCall.init.headers.Referer, embedUrl);

  const masterCall = providerCalls.find((call) => call.url.startsWith(masterUrl));
  assert.ok(masterCall);
  assert.equal(masterCall.init.headers.Referer, "https://megaplay.buzz/");
  assert.equal(masterCall.init.headers.Origin, "https://megaplay.buzz");

  const token = new URL(masterCall.url).searchParams.get("token");
  assert.ok(token);
  const [payloadPart, signaturePart] = token.split(".");
  const payload = Buffer.from(payloadPart, "base64url").toString("utf8");
  const [expiryText, pathKey] = payload.split("|");
  assert.equal(pathKey, firstPathKey + "/" + secondPathKey);
  const expiry = Number(expiryText);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(expiry >= now + 88 && expiry <= now + 91);
  const expectedSignature = createHmac("sha256", "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s")
    .update(payload, "utf8")
    .digest("base64url");
  assert.equal(signaturePart, expectedSignature);
});

test("Anikoto does not append a redundant HMAC token to a source that already has one", async () => {
  const { context } = loadProvider(async () => response(""));
  const existing = "https://cdn.example/" + "1".repeat(32) + "/" + "2".repeat(32) + "/master.m3u8?token=already-present";
  assert.equal(await context.koSignMegaPlayUrl(existing, true), existing);
});
