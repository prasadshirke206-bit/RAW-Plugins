import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/anitusk.js");
const source = fs.readFileSync(filename, "utf8");
const SITE = "https://anitummy.cc";

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
  const logs = [];
  const sandbox = {
    module: { exports: {} },
    console: { log(...args) { logs.push(args.map(String).join(" ")); }, warn() {}, error() {} },
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
  const getStreams = sandbox.module.exports.getStreams;
  getStreams.__logs = logs;
  return getStreams;
}

test("Anitusk returns real sub and dub MP4s from Kiwi, Net, and Ally routes", async () => {
  const calls = [];
  const getStreams = loadProvider(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u.startsWith("https://miruro.anifake.com/watch/")) {
      const match = u.match(/\/watch\/(kiwi|bonk|ally)\/16498\/(sub|dub)\/animepahe-7$/);
      assert.ok(match, "unexpected Anitusk API route " + u);
      const route = match[1];
      const lang = match[2];
      return response({
        streams: [{
          type: "mp4",
          url: "https://cdn.example/" + route + "-" + lang + ".mp4",
          quality: "720p",
          referer: "https://origin.example/",
          server: route + " CDN"
        }]
      });
    }
    if (u.startsWith("https://megaplay.buzz/")) return response("not found", 404);
    if (u.startsWith("https://vidnest.fun/")) return response("no direct media in this test");
    throw new Error("Unexpected URL " + u);
  });

  const candidates = await getStreams("16498", "anime", 1, 7, { preferredAudio: "dub" });

  assert.equal(candidates.length, 6, JSON.stringify({ candidates, calls, logs: getStreams.__logs }));
  for (const route of ["kiwi", "bonk", "ally"]) {
    for (const lang of ["sub", "dub"]) {
      assert.ok(calls.some((x) => x.url.endsWith("/" + route + "/16498/" + lang + "/animepahe-7")));
      assert.ok(candidates.some((x) => x.url === "https://cdn.example/" + route + "-" + lang + ".mp4"));
    }
  }
  assert.ok(candidates.every((x) => x.anilistId === "16498"));
  assert.ok(candidates.every((x) => x.episodeNumber === 7));
  assert.ok(candidates.every((x) => x.provider === "anitusk"));
  assert.ok(candidates.every((x) => x.quality === "720p"));
  assert.ok(candidates.every((x) => x.headers.Referer === "https://origin.example/"));
});

test("Anitusk inspects VidNest pages but emits only directly visible media", async () => {
  const calls = [];
  const getStreams = loadProvider(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u.startsWith("https://vidnest.fun/animepahe/16498/2/")) {
      const lang = u.endsWith("/dub") ? "dub" : "sub";
      return response('<script>var video = "' + "https://media.example/vidnest-" + lang + '.m3u8";</script>');
    }
    if (u.startsWith("https://media.example/vidnest-")) {
      return response("#EXTM3U\n#EXTINF:6,\nsegment.ts\n");
    }
    if (u.startsWith("https://megaplay.buzz/")) return response("not found", 404);
    if (u.startsWith("https://miruro.anifake.com/")) return response({ streams: [] });
    throw new Error("Unexpected URL " + u);
  });

  const candidates = await getStreams("16498", "anime", 1, 2, { preferredAudio: "sub" });

  assert.ok(candidates.some((x) => x.url === "https://media.example/vidnest-sub.m3u8"));
  assert.ok(candidates.some((x) => x.url === "https://media.example/vidnest-dub.m3u8"));
  assert.ok(candidates.every((x) => !x.url.startsWith("https://vidnest.fun/")));
  assert.ok(candidates.every((x) => x.anilistId === "16498" && x.episodeNumber === 2));
});

test("Anitusk fails closed when a protected VidNest embed exposes no direct media", async () => {
  const getStreams = loadProvider(async (url) => {
    const u = String(url);
    if (u.startsWith("https://vidnest.fun/")) return response("<html>protected player only</html>");
    if (u.startsWith("https://megaplay.buzz/")) return response("not found", 404);
    if (u.startsWith("https://miruro.anifake.com/")) return response({ streams: [] });
    throw new Error("Unexpected URL " + u);
  });

  const candidates = await getStreams("16498", "anime", 1, 3);
  assert.deepEqual(Array.from(candidates), []);
});
