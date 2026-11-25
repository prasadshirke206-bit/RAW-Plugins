import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/animeheaven.js");
const source = fs.readFileSync(filename, "utf8");

const key = "0123456789abcdef0123456789abcdef";
const expectedUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  };
}

function loadProvider(fetchImpl) {
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
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
    Error
  };
  vm.runInNewContext(source, sandbox, { filename, timeout: 3000 });
  return sandbox.module.exports.getStreams;
}

test("AnimeHeaven mirrors the Kotlin gate request and direct-source ordering", async () => {
  const calls = [];
  const animeUrl = "https://animeheaven.me/anime.php?id=777";
  const gateHtml = [
    "<video>",
    '<source src="https://ca.animeheaven.me/video.mp4?bad&error=1">',
    '<source src="https://ca.animeheaven.me/video.mp4?good&token=2">',
    '<source src="https://ax.animeheaven.me/video.mp4?decoy">',
    "</video>"
  ].join("");

  const getStreams = loadProvider(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === animeUrl) {
      return response(
        '<div data-id="777"></div>' +
        '<a href="/gate.php" id="' + key + '">Episode 1</a>'
      );
    }
    if (String(url) === "https://animeheaven.me/gate.php") {
      return response(gateHtml);
    }
    throw new Error("Unexpected request: " + url);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, {
    title: "Sample anime",
    providerMappings: { animeheaven: { url: animeUrl } }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Cookie, "key=" + key);
  assert.equal(
    calls[1].options.headers.Referer,
    "https://animeheaven.me/anime.php?777"
  );
  assert.equal(calls[1].options.credentials, "omit");

  assert.equal(candidates.length, 2);
  assert.equal(
    candidates[0].url,
    "https://ca.animeheaven.me/video.mp4?good&token=2"
  );
  assert.equal(
    candidates[1].url,
    "https://ca.animeheaven.me/video.mp4?bad&error=1"
  );
  assert.ok(candidates.every((item) => item.anilistId === "16498"));
  assert.ok(candidates.every((item) => item.episodeNumber === 1));
  assert.ok(candidates.every((item) => item.provider === "animeheaven"));
  assert.ok(candidates.every((item) => item.type === "mp4"));
  assert.ok(candidates.every((item) => item.headers.Referer === "https://animeheaven.me/"));
  assert.ok(candidates.every((item) => item.headers.Origin === "https://animeheaven.me"));
  assert.ok(candidates.every((item) => item.headers["User-Agent"] === expectedUserAgent));
  assert.ok(candidates.every((item) => !item.url.includes("ax.animeheaven.me")));
});

test("AnimeHeaven does not resolve a different episode's gate key", async () => {
  let gateRequests = 0;
  const animeUrl = "https://animeheaven.me/anime.php?id=777";
  const getStreams = loadProvider(async (url) => {
    if (String(url) === animeUrl) {
      return response(
        '<div data-id="777"></div>' +
        '<a href="/gate.php" id="' + key + '">Episode 2</a>'
      );
    }
    if (String(url) === "https://animeheaven.me/gate.php") {
      gateRequests += 1;
      return response("<video></video>");
    }
    throw new Error("Unexpected request: " + url);
  });

  const candidates = await getStreams("16498", "anime", 1, 1, {
    title: "Sample anime",
    providerMappings: { animeheaven: { url: animeUrl } }
  });
  assert.deepEqual(Array.from(candidates), []);
  assert.equal(gateRequests, 0);
});
