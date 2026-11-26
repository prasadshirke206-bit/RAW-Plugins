import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = path.join(root, "providers/anime/allanime.js");
const source = fs.readFileSync(filename, "utf8");

function loadDecoder() {
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => { throw new Error("network must not be used by decoder tests"); },
    setTimeout,
    clearTimeout,
    URL,
    Promise,
    Date,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error,
    Math,
    Uint8Array
  };
  vm.runInNewContext(source, sandbox, { filename, timeout: 3000 });
  return sandbox.aaDecryptSource;
}

function xorHex(value, mask, prefix) {
  let hex = "";
  for (let i = 0; i < value.length; i++) {
    hex += (value.charCodeAt(i) ^ mask).toString(16).padStart(2, "0");
  }
  return String(prefix || "") + hex;
}

const decode = loadDecoder();

test("AllAnime matches Kotlin's five explicitly prefixed XOR modes", () => {
  const modes = [
    ["--", 56],
    ["#-", 49],
    ["##", 48],
    ["-#", 59],
    ["#", 0]
  ];
  for (const [prefix, mask] of modes) {
    const path = "/apivtwo/clock?server=Default";
    assert.equal(decode(xorHex(path, mask, prefix)), path, "prefix " + prefix);
  }
});

test("AllAnime unprefixed source decoding tries the Kotlin XOR masks in order", () => {
  const value = "https://cdn.example/clock?token=1";
  for (const mask of [0, 48, 49, 56, 59]) {
    assert.equal(decode(xorHex(value, mask, "")), value, "mask " + mask);
  }
});

test("AllAnime preserves already-clear URLs and rejects malformed hex without corrupting it", () => {
  const plain = "https://cdn.example/video.m3u8";
  const malformed = "--not-hex";
  assert.equal(decode(plain), plain);
  assert.equal(decode(malformed), malformed);
});

test("AllAnime preserves relative internal API paths for Kotlin-compatible host routing", () => {
  const path = "/apivtwo/clock?token=abc";
  assert.equal(decode(xorHex(path, 56, "--")), path);
});
