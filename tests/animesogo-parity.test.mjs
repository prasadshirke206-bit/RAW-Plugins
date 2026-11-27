import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/animesogo.js");
const providerSource = fs.readFileSync(filename, "utf8");

function response(body, options = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: true,
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

test("AnimeSogo VRF matches AnikotoRC4.encodeAnimeSogoVrf", () => {
  const { exports } = loadProvider(async () => response(""));
  assert.equal(exports.sogoVrf("12345"), "cE9mRHFGM2htNXRBMmFSTQ%3D%3D");
  assert.equal(exports.sogoVrf("123"), "cEpfVjExcm9oLWc9");
  assert.equal(exports.sogoVrf("42"), "cEpfRjFTSG91dWc9");
});

test("AnimeSogo resolves only the exact AniList episode and Sogo server links", async () => {
  const calls = [];
  const { exports } = loadProvider(async (url, init) => {
    calls.push({ url, init });
    if (url === "https://animesogo.to/filter?keyword=Sogo%20Fixture&page=1") {
      return response('<a class="name d-title" href="/watch/sogo-fixture">Sogo Fixture</a>', { url });
    }
    if (url === "https://animesogo.to/watch/sogo-fixture") {
      return response('<div data-id="500"></div>', { url });
    }
    if (url.startsWith("https://animesogo.to/ajax/episode/list/500?vrf=")) {
      return response({
        result:
          '<a data-ids="episode-5" data-num="5" data-mal="9005">Episode 5</a>' +
          '<a data-ids="episode-6" data-slug="6" data-mal="9006">Episode 6</a>'
      }, { url });
    }
    if (url === "https://animesogo.to/ajax/server/list?servers=episode-6") {
      return response({
        result:
          '<div class="type" data-type="sub">' +
            '<a class="server" data-link-id="server-6">HD-1</a>' +
            '<div class="server" data-link-id="server-6b">HD-2</div>' +
          '</div>'
      }, { url });
    }
    if (url === "https://animesogo.to/ajax/server?get=server-6") {
      return response({ result: { url: "https://cdn.example/master.m3u8" } }, { url });
    }
    if (url === "https://animesogo.to/ajax/server?get=server-6b") {
      return response({ result: { url: "https://cdn.example/video.mp4" } }, { url });
    }
    if (url === "https://cdn.example/master.m3u8") {
      return response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080p.m3u8",
        { url }
      );
    }
    if (url === "https://cdn.example/1080p.m3u8") {
      return response("#EXTM3U\n#EXTINF:6,\nsegment.ts", { url });
    }
    throw new Error("Unexpected AnimeSogo request: " + url);
  });

  const candidates = await exports.getStreams("16498", "anime", 1, 6, {
    title: "Sogo Fixture",
    titles: ["Sogo Fixture"]
  });

  assert.equal(candidates.length, 2, JSON.stringify({ calls: calls.map((x) => x.url) }, null, 2));
  const hls = candidates.find((candidate) => candidate.type === "m3u8");
  const mp4 = candidates.find((candidate) => candidate.type === "mp4");
  assert.ok(hls);
  assert.ok(mp4);
  assert.equal(hls.url, "https://cdn.example/1080p.m3u8");
  assert.equal(hls.quality, "1080p");
  assert.equal(mp4.url, "https://cdn.example/video.mp4");
  for (const candidate of candidates) {
    assert.equal(candidate.provider, "animesogo");
    assert.equal(candidate.anilistId, "16498");
    assert.equal(candidate.episodeNumber, 6);
  }

  const search = calls.find((call) => call.url.includes("/filter?"));
  assert.ok(search);
  assert.equal(new URL(search.url).searchParams.get("vrf"), null);

  const episode = calls.find((call) => call.url.includes("/ajax/episode/list/"));
  assert.ok(episode);
  assert.equal(new URL(episode.url).searchParams.get("vrf"), exports.sogoVrf("500"));

  assert.ok(calls.some((call) => call.url === "https://animesogo.to/ajax/server?get=server-6"));
  assert.ok(calls.some((call) => call.url === "https://animesogo.to/ajax/server?get=server-6b"));
  assert.ok(!calls.some((call) => call.url.includes("servers=episode-5")));
  assert.ok(!calls.some((call) => call.url.includes("mapper.nekostream.site")));
});

test("AnimeSogo fails closed for invalid media or episode identity", async () => {
  const { exports, calls } = loadProvider(async () => {
    throw new Error("network must not run for invalid input");
  });
  assert.deepEqual(Array.from(await exports.getStreams("16498", "movie", 1, 1)), []);
  assert.deepEqual(Array.from(await exports.getStreams("bad-id", "anime", 1, 2)), []);
  assert.deepEqual(Array.from(await exports.getStreams("16498", "anime", 1, 0)), []);
  assert.equal(calls.length, 0);
});
