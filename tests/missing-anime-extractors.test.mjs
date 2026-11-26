import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedPath = path.join(root, "providers/anime/shared/extractors.js");
const sharedSource = fs.readFileSync(sharedPath, "utf8");

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

function loadExtractors(fetchImpl) {
  const logs = [];
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
  const context = vm.createContext(sandbox);
  vm.runInContext(sharedSource, context, { filename: sharedPath, timeout: 5000 });
  return { extractors: context.RAWAnimeExtractors, logs };
}

function options(provider = "allanime", language = "sub") {
  return {
    provider,
    anilistId: "16498",
    episodeNumber: 3,
    language,
    labelPrefix: "AllAnime fixture",
    pageHeaders: { Referer: "https://allmanga.to/" },
    log() {}
  };
}

async function encryptCbc(text, keyBytes, ivBytes) {
  const key = await webcrypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-CBC", iv: ivBytes },
    key,
    new TextEncoder().encode(text)
  );
  return Buffer.from(new Uint8Array(encrypted)).toString("base64");
}

test("GogoStream follows the Kotlin class-digit AES request and source decryption flow", async () => {
  const iv = new TextEncoder().encode("1111111111111111");
  const secretKey = new TextEncoder().encode("2222222222222222");
  const decryptionKey = new TextEncoder().encode("3333333333333333");
  const encryptedParams = await encryptCbc("id=x&token=fixture&expires=7", secretKey, iv);
  const encryptedSources = await encryptCbc(
    JSON.stringify({ source: [{ file: "https://cdn.example/gogo/720.mp4", label: "720p", type: "mp4" }] }),
    decryptionKey,
    iv
  );
  const calls = [];
  const { extractors } = loadExtractors(async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value === "https://gogo.example/playerlink.php?id=episode42&token=site-token") {
      return response(
        '<div class="wrapper container-1111111111111111"></div>' +
        '<body class="container-2222222222222222"></body>' +
        '<div class="videocontent videocontent-3333333333333333"></div>' +
        '<script data-value="' + encryptedParams + '"></script>',
        { url: value }
      );
    }
    if (value.includes("/encrypt-ajax.php?")) return response({ data: encryptedSources });
    throw new Error("Unexpected GogoStream request: " + value);
  });

  const diagnostics = [];
  const settings = options();
  settings.log = (message) => diagnostics.push(message);
  const candidates = await extractors.gogostream(
    "https://gogo.example/playerlink.php?id=episode42&token=site-token",
    settings
  );
  assert.equal(candidates.length, 1, diagnostics.join("\\n"));
  assert.equal(candidates[0].url, "https://cdn.example/gogo/720.mp4");
  assert.equal(candidates[0].quality, "720p");
  assert.equal(candidates[0].type, "mp4");
  assert.match(candidates[0].title, /Gogostream/);
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 3);
  const ajax = calls.find((call) => call.url.includes("/encrypt-ajax.php?"));
  assert.ok(ajax);
  assert.match(ajax.url, /alias=episode42/);
  assert.match(ajax.url, /token=fixture/);
  assert.equal(ajax.init.headers["X-Requested-With"], "XMLHttpRequest");
});

test("OK.ru maps Kotlin quality names and returns actual video URLs", async () => {
  const calls = [];
  const { extractors } = loadExtractors(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === "https://ok.ru/video/123") {
      return response(
        '<div data-options=' +
        "'" + JSON.stringify({ videos: [
          { name: "mobile", url: "https://cdn.example/okru/mobile.mp4" },
          { name: "full", url: "https://cdn.example/okru/full.mp4" }
        ] }).replace(/'/g, "&#39;") + "'" +
        '></div>',
        { url: String(url) }
      );
    }
    throw new Error("Unexpected OK.ru request: " + url);
  });

  const candidates = await extractors.okru("https://ok.ru/video/123", options());
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, "https://cdn.example/okru/full.mp4");
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(candidates[1].quality, "144p");
  assert.ok(candidates.every((item) => item.type === "mp4"));
  assert.ok(candidates.every((item) => item.anilistId === "16498"));
  assert.equal(calls.length, 1);
});

test("OK.ru resolves its ondemandHls source through the shared playlist parser", async () => {
  const { extractors } = loadExtractors(async (url) => {
    const value = String(url);
    if (value === "https://ok.ru/video/hls") {
      return response('<div data-options=' + "'" +
        JSON.stringify({ ondemandHls: "https://cdn.example/okru/master.m3u8" }) +
        "'" + '></div>', { url: value });
    }
    if (value === "https://cdn.example/okru/master.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720\n720.m3u8");
    }
    throw new Error("Unexpected OK.ru request: " + value);
  });

  const candidates = await extractors.okru("https://ok.ru/video/hls", options());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://cdn.example/okru/720.m3u8");
  assert.equal(candidates[0].quality, "720p");
  assert.equal(candidates[0].type, "m3u8");
});

test("Mp4Upload unpacks a visible player source and preserves Kotlin quality metadata", async () => {
  const calls = [];
  const { extractors } = loadExtractors(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === "https://www.mp4upload.com/embed-fixture") {
      return response(
        '<script>var player = {}; player.src("https://cdn.example/mp4upload/video.mp4"); ' +
        'var meta = " HEIGHT=1080 ";</script>',
        { url: String(url) }
      );
    }
    throw new Error("Unexpected Mp4Upload request: " + url);
  });

  const candidates = await extractors.mp4upload("https://www.mp4upload.com/embed-fixture", options());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://cdn.example/mp4upload/video.mp4");
  assert.equal(candidates[0].quality, "1080p");
  assert.match(candidates[0].title, /Mp4Upload - 1080p/);
  assert.equal(calls[0].init.headers.Referer, "https://mp4upload.com/");
});

test("Streamlare follows the Kotlin HLS POST contract and emits verified variants", async () => {
  const calls = [];
  const { extractors } = loadExtractors(async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value === "https://slwatch.co/api/video/stream/get") {
      return response({ type: "hls", file: "https://cdn.example/streamlare/master.m3u8" }, { url: value });
    }
    if (value === "https://cdn.example/streamlare/master.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080.m3u8");
    }
    throw new Error("Unexpected Streamlare request: " + value);
  });

  const candidates = await extractors.streamlare("https://streamlare.com/e/abc123", options());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://cdn.example/streamlare/1080.m3u8");
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { id: "abc123" });
});

test("Streamlare direct sources POST the file API and use the final redirect URL", async () => {
  const calls = [];
  const { extractors } = loadExtractors(async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value === "https://slwatch.co/api/video/stream/get") {
      return response('{"type":"mp4","label":"1080p","file":"https://api.slwatch.co/resolve/xyz"}', { url: value });
    }
    if (value === "https://api.slwatch.co/resolve/xyz") {
      return response("", { url: "https://cdn.example/streamlare/final.mp4" });
    }
    throw new Error("Unexpected Streamlare request: " + value);
  });

  const candidates = await extractors.streamlare("https://streamlare.com/e/direct123", options());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://cdn.example/streamlare/final.mp4");
  assert.equal(candidates[0].type, "mp4");
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(calls[1].init.method, "POST");
});


test("VidHide follows the Kotlin packed-player extraction and keeps caption tracks", async () => {
  const calls = [];
  const { extractors } = loadExtractors(async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value === "https://vidhide.example/e/fixture") {
      const unpacked = 'var sources = ["https://media.example/vidhide/master.m3u8"]; var tracks = [{file:"https://media.example/subs/en.vtt",kind:"captions",label:"English"}];';
      const packed = "<script>eval(function(p,a,c,k,e,d){return p;}('" + unpacked +
        "',10,1,'unused'.split('|'),0,{}))</script>";
      return response(packed, { url: value });
    }
    if (value === "https://media.example/vidhide/master.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080/index.m3u8");
    }
    throw new Error("Unexpected VidHide request " + value);
  });

  const candidates = await extractors.vidhide("https://vidhide.example/e/fixture", options("anineko"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://media.example/vidhide/1080/index.m3u8");
  assert.equal(candidates[0].quality, "1080p");
  assert.equal(candidates[0].type, "m3u8");
  assert.equal(candidates[0].provider, "anineko");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 3);
  assert.ok(candidates[0].subtitles.some((track) =>
    track.url === "https://media.example/subs/en.vtt" && track.lang === "English"
  ));
  assert.equal(calls.length, 2);
});

test("Vidara follows the Kotlin Android API contract and parses HLS variants", async () => {
  const calls = [];
  const { extractors } = loadExtractors(async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value === "https://vidara.to/api/stream") {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { filecode: "abc123", device: "android" });
      assert.equal(init.headers.Origin, "https://vidara.to");
      assert.equal(init.headers.Referer, "https://vidara.to/");
      return response({ streaming_url: "https://media.example/vidara/master.m3u8" });
    }
    if (value === "https://media.example/vidara/master.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720\n720/index.m3u8");
    }
    throw new Error("Unexpected Vidara request " + value);
  });

  const candidates = await extractors.vidara("https://vidara.to/e/abc123", options("animotvslash"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://media.example/vidara/720/index.m3u8");
  assert.equal(candidates[0].quality, "720p");
  assert.equal(candidates[0].provider, "animotvslash");
  assert.equal(candidates[0].anilistId, "16498");
  assert.equal(candidates[0].episodeNumber, 3);
  assert.equal(calls.length, 2);
});

test("shared VidHide and Vidara extractors reject incomplete anime identity without networking", async () => {
  let requests = 0;
  const { extractors } = loadExtractors(async () => {
    requests += 1;
    throw new Error("Network must not be called");
  });
  assert.deepEqual(Array.from(await extractors.vidhide("https://vidhide.example/e/id", {
    provider: "anineko",
    anilistId: "0",
    episodeNumber: 1
  })), []);
  assert.deepEqual(Array.from(await extractors.vidara("https://vidara.to/e/id", {
    provider: "animotvslash",
    anilistId: "16498",
    episodeNumber: 0
  })), []);
  assert.equal(requests, 0);
});
