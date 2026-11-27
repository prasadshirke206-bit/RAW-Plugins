import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/anisnatch.js");
const source = fs.readFileSync(filename, "utf8");

const marker = Buffer.from([0x41, 0x4e, 0x53, 0x21]);
const siteToken = "fixture-site-token";
const siteVersion = "2.4.1";
const serverTime = "1760000000";
const alphabet = "0123456789abcdef";

function response(body, options = {}) {
  if (body instanceof Uint8Array || Buffer.isBuffer(body)) {
    const bytes = Buffer.from(body);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => bytes.toString("utf8")
    };
  }
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    url: options.url || "",
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => {
      const bytes = Buffer.from(text);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function buildConfigHtml() {
  const config = Buffer.from(JSON.stringify({ key: alphabet, mark: Array.from(marker) }));
  const xorKey = Buffer.from(siteToken + siteVersion + serverTime);
  const encrypted = Buffer.from(config);
  for (let i = 0; i < encrypted.length; i++) encrypted[i] ^= xorKey[i % xorKey.length];
  const encoded = encrypted.toString("base64");
  return '<meta name="token" content="' + siteToken + '">' +
    "<script>var configToken = '" + encoded + "'; var version = '" +
    siteVersion + "'; var serverTime = " + serverTime + ";</script>";
}

function sealApiResponse(data, authenticator) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(data)));
  const key = Buffer.from(String(authenticator), "utf8");
  const encrypted = Buffer.from(compressed);
  for (let i = 0; i < encrypted.length; i++) encrypted[i] ^= key[i % key.length];
  return Buffer.concat([Buffer.from([0x00, 0x02, 0x03]), marker, encrypted]);
}

function loadProvider(fetchImpl) {
  const calls = [];
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
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
    crypto: globalThis.crypto
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename, timeout: 5000 });
  return { exports: context.module.exports, calls };
}

test("AniSnatch dynamic SMC helpers preserve the Kotlin cipher's reversible shift and authenticator", async () => {
  const { exports } = loadProvider(async () => response(buildConfigHtml()));
  await exports.internals.nsEnsureConfig();
  const shifted = exports.internals.nsSmcShift("0123456789abcdef", true, 3);
  assert.equal(exports.internals.nsSmcShift(shifted, false, 3), "0123456789abcdef");
  assert.equal(exports.internals.nsStr2Aci("abc123"), "444");
  const payload = exports.internals.nsBuildPayload('{"keyword":"Fixture"}');
  const parsed = JSON.parse(payload.body);
  assert.ok(Array.isArray(parsed.data));
  assert.ok(Array.isArray(parsed.key));
  assert.equal(parsed.data.length, parsed.key.length);
  assert.equal(parsed.authenticator, payload.authenticator);
  assert.equal(parsed.authenticator, Array.from(parsed.token).reduce((sum, ch) => sum + ch.charCodeAt(0), 0).toString());
});

test("AniSnatch decrypts a marker + XOR + gzip API response and resolves the exact AniList episode", async () => {
  const apiRequests = [];
  const apiBody = (data, authenticator) => response(sealApiResponse(data, authenticator));
  const { exports, calls } = loadProvider(async (url, init = {}) => {
    if (url === "https://anisnatch.top/") return response(buildConfigHtml(), { url });

    const route = url.match(/^https:\/\/anisnatch\.top\/(api\/[^/]+)\/(\d+)$/);
    if (route) {
      const payload = JSON.parse(init.body || "{}");
      apiRequests.push({ endpoint: route[1], payload });
      if (route[1] === "api/search") {
        return apiBody({
          data: { anime: [
            { id: "41", title_en: "Different Anime" },
            { id: "77", title_en: "Fixture Anime" }
          ] },
          totalPages: 1
        }, payload.authenticator);
      }
      if (route[1] === "api/anime") {
        return apiBody({
          data: {
            anime: { lastep: 2, dub: 1 },
            list: [{ number: 1 }, { number: 2, sub: true, dub: false, title: "The Exact Episode" }]
          }
        }, payload.authenticator);
      }
      if (route[1] === "api/init") {
        return apiBody({ token: "fixture-session-token" }, payload.authenticator);
      }
      if (route[1] === "api/loadSVs") {
        return apiBody({
          server: {
            sub: [{ title: "AniVibe", source: "fixture-video-id" }]
          }
        }, payload.authenticator);
      }
      throw new Error("Unexpected AniSnatch API route: " + route[1]);
    }

    if (url === "https://anisnatch.top/video/fixture-video-id") {
      return response(
        'streamURL = "https://player.example/embed/fixture";',
        { url }
      );
    }
    if (url === "https://player.example/embed/fixture") {
      return response(
        'srcs: [{"url":"https://cdn.example/master.m3u8","label":"1080p","type":"hls"}]; ' +
        'subtitles: [{"file":"https://subs.example/en.vtt","label":"English"}];',
        { url }
      );
    }
    if (url === "https://cdn.example/master.m3u8") {
      return response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720\n720p.m3u8",
        { url }
      );
    }
    throw new Error("Unexpected AniSnatch request: " + url);
  });

  const candidates = await exports.getStreams("16498", "anime", 1, 2, {
    title: "Fixture Anime",
    titles: ["Fixture Anime"]
  });

  assert.equal(candidates.length, 1, JSON.stringify({ calls: calls.map((x) => x.url) }, null, 2));
  assert.equal(candidates[0].url, "https://cdn.example/720p.m3u8");
  assert.equal(candidates[0].quality, "720p");
  assert.equal(candidates[0].provider, "anisnatch");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 2);
  assert.equal(candidates[0].language, "sub");
  assert.deepEqual(Array.from(candidates[0].subtitles.map((x) => x.url)), [
    "https://subs.example/en.vtt"
  ]);

  assert.deepEqual(apiRequests.map((x) => x.endpoint), [
    "api/search", "api/anime", "api/init", "api/loadSVs"
  ]);
  assert.equal(apiRequests[0].payload.keyword, "Fixture Anime");
  assert.equal(apiRequests[0].payload.page, 1);
  assert.equal(apiRequests[3].payload.id, 77);
  assert.equal(apiRequests[3].payload.ep, 2);
  assert.equal(apiRequests[3].payload.token, "fixture-session-token");
  for (const request of apiRequests) {
    const expectedAuthenticator = Array.from(request.payload.token).reduce((sum, ch) => sum + ch.charCodeAt(0), 0).toString();
    assert.equal(request.payload.authenticator, expectedAuthenticator);
    assert.ok(request.payload.data.length === request.payload.key.length);
  }
});

test("AniSnatch rejects wrong media types and invalid AniList/episode inputs without networking", async () => {
  const { exports, calls } = loadProvider(async () => {
    throw new Error("network must not run for invalid input");
  });
  assert.deepEqual(Array.from(await exports.getStreams("16498", "movie", 1, 2)), []);
  assert.deepEqual(Array.from(await exports.getStreams("bad-id", "anime", 1, 2)), []);
  assert.deepEqual(Array.from(await exports.getStreams("16498", "anime", 1, 0)), []);
  assert.equal(calls.length, 0);
});
