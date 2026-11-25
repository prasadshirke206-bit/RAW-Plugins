import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/miruro.js");
const source = fs.readFileSync(filename, "utf8");

function loadProvider(fetchImpl = async () => { throw new Error("unexpected network request"); }) {
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    atob,
    btoa,
    Date,
    Math,
    JSON,
    Promise,
    Object,
    Number,
    String,
    RegExp,
    Error
  };
  vm.runInNewContext(source, sandbox, { filename, timeout: 3000 });
  return sandbox;
}

test("Miruro script parses and exposes getStreams", () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename }));
  const sandbox = loadProvider();
  assert.equal(typeof sandbox.module.exports.getStreams, "function");
});

test("Miruro gzip decoder supports a normal gzip response", () => {
  const sandbox = loadProvider();
  const expected = "Miruro pipe response decoder regression test. ".repeat(80);
  const zipped = gzipSync(Buffer.from(expected, "utf8"), { mtime: 0 });
  const input = vm.runInNewContext("new Uint8Array([" + Array.from(zipped).join(",") + "])", sandbox);
  const decoded = sandbox.module.exports.__test.gunzip(input);
  assert.equal(Buffer.from(decoded).toString("utf8"), expected);
});

test("Miruro XOR and gzip pipe decoder matches the source wire format", () => {
  const sandbox = loadProvider();
  const expected = JSON.stringify({ providers: { kiwi: { episodes: { sub: [{ id: "ep-1", number: 1 }] } } } });
  const key = Buffer.from("71951034f8fbcf53d89db52ceb3dc22c", "hex");
  const zipped = gzipSync(Buffer.from(expected, "utf8"), { mtime: 0 });
  const encrypted = Buffer.from(zipped);
  for (let i = 0; i < encrypted.length; i++) encrypted[i] ^= key[i % key.length];
  const body = encrypted.toString("base64url");
  assert.equal(sandbox.module.exports.__test.decodePipeBody(body, "2", key.toString("hex")), expected);
});

test("Miruro pipe envelope contains the expected endpoint contract", () => {
  const sandbox = loadProvider();
  const encoded = sandbox.module.exports.__test.encodeEnvelope({
    path: "episodes", method: "GET", query: { anilistId: 16498 },
    body: null, version: "0.2.0", timestamp: 123
  });
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(parsed.path, "episodes");
  assert.equal(parsed.method, "GET");
  assert.deepEqual(parsed.query, { anilistId: 16498 });
  assert.equal(parsed.body, null);
  assert.equal(parsed.version, "0.2.0");
});

test("Miruro rejects wrong media types and invalid AniList/episode arguments without networking", async () => {
  const sandbox = loadProvider();
  const getStreams = sandbox.module.exports.getStreams;
  assert.deepEqual(Array.from(await getStreams("16498", "movie", 1, 1, {})), []);
  assert.deepEqual(Array.from(await getStreams("not-an-id", "anime", 1, 1, {})), []);
  assert.deepEqual(Array.from(await getStreams("16498", "anime", 1, 0, {})), []);
});
