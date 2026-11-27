import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/animesuge.js");
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
    Math
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(providerSource, context, { filename, timeout: 5000 });
  return { exports: context.module.exports, calls };
}

test("AnimeSuge VRF matches the Kotlin RC4, shift, Base64URL and ROT13 sequence", () => {
  const { exports } = loadProvider(async () => response(""));
  assert.equal(exports.sugeVrf("12345"), "F00-BTODq0V=");
  assert.equal(exports.sugeVrf("123"), "F00-BN==");
  assert.equal(exports.sugeVrf("42"), "Fy09Cj==");
});

test("AnimeSuge maps AniList ID and exact episode through the Kotlin episode/server contract", async () => {
  const calls = [];
  const getStreams = loadProvider(async (url, init) => {
    calls.push({ url, init });
    if (url === "https://animesuge.cz/filter?keyword=Suge%20Test&page=1") {
      return response('<a href="/anime/test-show">Suge Test</a>', { url });
    }
    if (url === "https://animesuge.cz/anime/test-show") {
      return response('<div class="favourite" data-id="100"></div>', { url });
    }
    if (url.startsWith("https://animesuge.cz/ajax/episode/list/100?vrf=")) {
      return response({
        result:
          '<a data-ids="episode-4" data-slug="4" data-mal="9004">4</a>' +
          '<a data-ids="episode-5" data-slug="5" data-mal="9005">Episode 5</a>'
      }, { url });
    }
    if (url === "https://animesuge.cz/ajax/server/list?servers=episode-5") {
      return response({
        result: '<div class="type" data-type="Sub"><li data-link-id="server-5">HD-1</li></div>'
      }, { url });
    }
    if (url === "https://animesuge.cz/ajax/server?get=server-5") {
      return response({ result: { url: "https://cdn.example/video.m3u8" } }, { url });
    }
    if (url === "https://cdn.example/video.m3u8") {
      return response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080p.m3u8",
        { url }
      );
    }
    if (url === "https://cdn.example/1080p.m3u8") {
      return response("#EXTM3U\n#EXTINF:6,\nsegment.ts", { url });
    }
    throw new Error("Unexpected AnimeSuge request: " + url);
  });

  const candidates = await getStreams.exports.getStreams("16498", "anime", 1, 5, {
    title: "Suge Test",
    titles: ["Suge Test"]
  });

  assert.equal(candidates.length, 1, JSON.stringify({ calls }, null, 2));
  assert.equal(candidates[0].url, "https://cdn.example/1080p.m3u8");
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(candidates[0].provider, "animesuge");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 5);

  const searchCall = calls.find((call) => call.url.includes("/filter?"));
  assert.ok(searchCall);
  assert.equal(new URL(searchCall.url).searchParams.get("vrf"), null);

  const episodeCall = calls.find((call) => call.url.includes("/ajax/episode/list/100?"));
  assert.ok(episodeCall);
  assert.equal(new URL(episodeCall.url).searchParams.get("vrf"), getStreams.exports.sugeVrf("100"));

  assert.ok(calls.some((call) => call.url === "https://animesuge.cz/ajax/server/list?servers=episode-5"));
  assert.ok(!calls.some((call) => call.url.includes("servers=episode-4")));
  assert.ok(calls.some((call) => call.url === "https://animesuge.cz/ajax/server?get=server-5"));
});

test("AnimeSuge fails closed for wrong media type and invalid episode identity", async () => {
  const { exports } = loadProvider(async () => {
    throw new Error("network must not run for invalid identity");
  });
  assert.deepEqual(Array.from(await exports.getStreams("16498", "movie", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("not-an-id", "anime", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("16498", "anime", 1, 0)), []);
});
