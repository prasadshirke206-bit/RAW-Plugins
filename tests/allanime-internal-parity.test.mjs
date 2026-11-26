import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/allanime.js");
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
  vm.runInContext(providerSource, context, { filename, timeout: 10000 });
  return { internal: context.aaInternal, calls, context };
}

test("AllAnime internal clock parser returns MP4, HLS, adaptive DASH/HLS and DASH audio renditions", async () => {
  const endpoint = "https://blog.allanime.day";
  const clockUrl = endpoint + "/apivtwo/clock.json?token=fixture";
  const calls = [];
  const { internal } = loadProvider(async (url, init) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value === clockUrl) {
      return response({
        links: [
          {
            mp4: true,
            link: "https://cdn.example/internal/1080.mp4",
            resolutionStr: "1080p",
            subtitles: [{ lang: "en", src: "https://subs.example/internal-en.vtt", label: "CC" }]
          },
          {
            hls: true,
            link: "https://cdn.example/internal/hls/master.m3u8",
            resolutionStr: "720p",
            subtitles: []
          },
          {
            crIframe: true,
            portData: {
              streams: [
                { format: "adaptive_dash", url: "https://cdn.example/cr/adaptive.mpd", hardsub_lang: "English" },
                { format: "adaptive_hls", url: "https://cdn.example/cr/master.m3u8", hardsub_lang: "Japanese" }
              ]
            },
            subtitles: []
          },
          {
            dash: true,
            rawUrls: {
              audios: [
                { url: "https://cdn.example/audio/en.m4a", bandwidth: 128000 },
                { url: "https://cdn.example/audio/jp.m4a", bandwidth: 256000 }
              ],
              vids: [
                { url: "https://cdn.example/dash/video.mpd", height: 1080, bandwidth: 3000000 }
              ]
            },
            subtitles: []
          }
        ]
      });
    }
    if (value === "https://cdn.example/internal/hls/master.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n720.m3u8");
    }
    if (value === "https://cdn.example/cr/master.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=720x480\n480.m3u8");
    }
    throw new Error("Unexpected AllAnime internal request: " + value);
  });

  const candidates = await internal(
    "/apivtwo/clock?token=fixture",
    "Default",
    "sub",
    endpoint
  );
  assert.equal(candidates.length, 5);
  assert.ok(candidates.some((item) => item.url === "https://cdn.example/internal/1080.mp4" && item.type === "mp4"));
  assert.ok(candidates.some((item) => item.url === "https://cdn.example/internal/hls/720.m3u8" && item.quality === "720p"));
  assert.ok(candidates.some((item) => item.url === "https://cdn.example/cr/adaptive.mpd" && /Hardsub: English/.test(item.title)));
  assert.ok(candidates.some((item) => item.url === "https://cdn.example/cr/480.m3u8" && /AC - HLS - Hardsub: Japanese/.test(item.title)));
  const dash = candidates.find((item) => item.url === "https://cdn.example/dash/video.mpd");
  assert.ok(dash);
  assert.equal(dash.type, "mpd");
  assert.equal(dash.quality, "1080p");
  assert.deepEqual(Array.from(dash.audioTracks.map((track) => track.url)), [
    "https://cdn.example/audio/en.m4a",
    "https://cdn.example/audio/jp.m4a"
  ]);
  assert.deepEqual(Array.from(dash.audioTracks.map((track) => track.lang)), ["128 kb/s", "256 kb/s"]);

  const hlsCall = calls.find((call) => call.url === "https://cdn.example/internal/hls/master.m3u8");
  assert.ok(hlsCall);
  assert.equal(hlsCall.init.headers.Host, "cdn.example");
  assert.equal(hlsCall.init.headers.Origin, endpoint);
  assert.equal(hlsCall.init.headers.Referer, endpoint + "/");
  assert.equal(calls[0].url, clockUrl);
});
