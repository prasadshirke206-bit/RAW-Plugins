/*
 * Miruro — RAW QuickJS anime provider.
 *
 * Native-source behaviour ported from the Miruro Kotlin extension:
 * AniList identity -> secure pipe episodes -> selected provider/subtype
 * -> sources -> Miruro HLS relay URL + observed subtitle tracks.
 *
 * Deliberate host boundary:
 * This script sends ordinary HTTP requests. It does not impersonate a
 * browser, farm cookies, spoof client fingerprints, or solve Cloudflare
 * challenges. When the site requires browser verification, resolution fails
 * closed and RAW must hand the user to a legitimate browser/session flow.
 *
 * Android-only Universal/MegaCloud/RapidCloud embed extractors and the
 * local M3U8 relay are not emulated here. Only direct HLS source records are
 * returned; unresolved embed pages are never passed to MPV as media URLs.
 */
var MIRURO_ID = "miruro";

async function rawResolveUniversalEmbed(provider, embedUrl, label, language, anilistId, episodeNumber, pageUrl, headers, fallbackSubtitles) {
  var host = typeof globalThis !== "undefined" ? globalThis.RAW_HOST : null;
  if (!host || typeof host.resolveAnimeEmbed !== "function") { console.log("[" + provider + "] UniversalExtractor route requires a RAW host capability"); return []; }
  var id = String(anilistId || ""), ep = Number(episodeNumber || 0);
  if (!/^[1-9]\d*$/.test(id) || !Number.isFinite(ep) || ep <= 0 ||
      !/^https:\/\//i.test(String(embedUrl || "")) || !/^https:\/\//i.test(String(pageUrl || ""))) return [];
  var safeHeaders = {};
  var allowed = ["user-agent", "accept", "accept-language", "origin"];
  Object.keys(headers || {}).forEach(function (key) {
    if (allowed.indexOf(String(key).toLowerCase()) >= 0) safeHeaders[key] = String(headers[key]);
  });
  try {
    var result = await host.resolveAnimeEmbed({
      capability: "raw.anime.webview-stream", version: 1, provider: provider,
      anilistId: id, episodeNumber: ep, embedUrl: String(embedUrl), pageUrl: String(pageUrl),
      headers: safeHeaders, timeoutMs: 15000
    });
    if (!result || result.status !== "resolved" || String(result.anilistId) !== id ||
        Number(result.episodeNumber) !== ep || !Array.isArray(result.streams)) return [];
    var subtitles = (Array.isArray(result.subtitles) ? result.subtitles : []).concat(
      Array.isArray(fallbackSubtitles) ? fallbackSubtitles : []
    ).filter(function (item) {
      return item && /^http:\/\/127\.0\.0\.1:\d+\/raw-anime\/[a-f0-9]+\?/i.test(String(item.url || ""));
    });
    return result.streams.map(function (stream) {
      var url = String(stream && stream.url || "");
      var protocol = String(stream && stream.protocol || "").toLowerCase();
      if (!/^http:\/\/127\.0\.0\.1:\d+\/raw-anime\/[a-f0-9]+\?/i.test(url) ||
          (protocol !== "hls" && protocol !== "mp4")) return null;
      var title = String(label || provider || "Anime stream");
      return { name:title, title:title, url:url, quality:"Auto",
        type:protocol === "hls" ? "m3u8" : "mp4", provider:provider,
        language:language || "multi", headers:{}, subtitles:subtitles,
        anilistId:id, episodeNumber:ep };
    }).filter(Boolean);
  } catch (error) {
    console.log("[" + provider + "] native WebView resolution failed: " + String(error && error.message || error));
    return [];
  }
}

var MIRURO_MIRRORS = [
  "https://www.miruro.tv",
  "https://www.miruro.to",
  "https://www.miruro.bz",
  "https://www.miruro.ru"
];
var MIRURO_DEFAULTS = {
  proxyA: "https://s1.watami.win/",
  proxyB: "https://s1.piltover.li/",
  refererOrigin: "https://strm.cx",
  pipeKey: "71951034f8fbcf53d89db52ceb3dc22c",
  proxyKey: "a54d389c18527d9fd3e7f0643e27edbe"
};
var MIRURO_DEFAULT_PROVIDER_ORDER = [
  "kiwi", "bee", "bonk", "ally", "moo", "hop", "pewe",
  "nun", "bun", "twin", "cog"
];
var MIRURO_HEADERS = { "Accept": "application/json, text/plain, */*" };
var MIRURO_ENV_CACHE = {};

function mrContext() {
  return (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {};
}
function mrTimeout(promise, ms) {
  var timer;
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error("Miruro request timed out")); }, ms || 10000);
    })
  ]).then(function (value) {
    clearTimeout(timer);
    return value;
  }, function (error) {
    clearTimeout(timer);
    throw error;
  });
}
async function mrFetch(url, options, ms) {
  var response = await mrTimeout(fetch(url, options || {}), ms || 10000);
  if (!response) throw new Error("Miruro network request failed");
  if (!response.ok) {
    var hint = response.status === 403 ? " (site denied this non-browser request; browser verification may be required)" :
      response.status === 429 ? " (upstream rate limit)" : "";
    throw new Error("Miruro HTTP " + response.status + hint);
  }
  return response;
}
function mrHexBytes(hex) {
  var clean = String(hex || "").replace(/[^0-9a-f]/gi, "");
  if (!clean || clean.length % 2) return new Uint8Array(0);
  var out = new Uint8Array(clean.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function mrBase64Url(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function mrDecodeBase64Url(value) {
  var clean = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (clean.length % 4) clean += "=";
  var binary = atob(clean), out = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* Small dependency-free gzip/DEFLATE decoder for Miruro's XOR-wrapped pipe. */
function mrInflateRaw(data, startOffset) {
  var pos = startOffset || 0, bit = 0, output = [];
  function readBits(count) {
    var value = 0;
    for (var i = 0; i < count; i++) {
      if (pos >= data.length) throw new Error("Truncated DEFLATE stream");
      value |= ((data[pos] >> bit) & 1) << i;
      bit++;
      if (bit === 8) { bit = 0; pos++; }
    }
    return value;
  }
  function alignByte() { if (bit !== 0) { bit = 0; pos++; } }
  function reverseBits(value, count) {
    var result = 0;
    for (var i = 0; i < count; i++) { result = (result << 1) | (value & 1); value >>>= 1; }
    return result;
  }
  function buildTree(lengths) {
    var counts = new Array(16).fill(0), next = new Array(16).fill(0), maps = new Array(16), max = 0;
    for (var i = 0; i < lengths.length; i++) {
      var len = lengths[i] || 0;
      if (len > 15) throw new Error("Invalid DEFLATE Huffman length");
      if (len) { counts[len]++; if (len > max) max = len; }
    }
    var code = 0;
    for (var bits = 1; bits <= 15; bits++) {
      code = (code + counts[bits - 1]) << 1;
      next[bits] = code;
      maps[bits] = Object.create(null);
    }
    for (var symbol = 0; symbol < lengths.length; symbol++) {
      var length = lengths[symbol] || 0;
      if (!length) continue;
      maps[length][next[length]++] = symbol;
    }
    if (!max) throw new Error("Empty DEFLATE Huffman tree");
    return { maps: maps, max: max };
  }
  function decodeSymbol(tree) {
    var code = 0;
    for (var len = 1; len <= tree.max; len++) {
      code = (code << 1) | readBits(1);
      var symbol = tree.maps[len] && tree.maps[len][code];
      if (symbol !== undefined) return symbol;
    }
    throw new Error("Invalid DEFLATE Huffman code");
  }
  var lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var finalBlock = 0;
  while (!finalBlock) {
    finalBlock = readBits(1);
    var blockType = readBits(2);
    if (blockType === 0) {
      alignByte();
      if (pos + 4 > data.length) throw new Error("Truncated stored DEFLATE block");
      var storedLength = data[pos] | (data[pos + 1] << 8);
      var storedCheck = data[pos + 2] | (data[pos + 3] << 8);
      pos += 4;
      if (((storedLength ^ 0xffff) & 0xffff) !== storedCheck || pos + storedLength > data.length) {
        throw new Error("Invalid stored DEFLATE block");
      }
      for (var si = 0; si < storedLength; si++) output.push(data[pos++]);
      continue;
    }
    if (blockType === 3) throw new Error("Reserved DEFLATE block type");
    var literalTree, distanceTree;
    if (blockType === 1) {
      var fixedLiteral = new Array(288), fixedDistance = new Array(32);
      for (var fl = 0; fl <= 287; fl++) fixedLiteral[fl] = fl <= 143 ? 8 : fl <= 255 ? 9 : fl <= 279 ? 7 : 8;
      for (var fd = 0; fd < 32; fd++) fixedDistance[fd] = 5;
      literalTree = buildTree(fixedLiteral);
      distanceTree = buildTree(fixedDistance);
    } else {
      var literalCount = readBits(5) + 257;
      var distanceCount = readBits(5) + 1;
      var codeCount = readBits(4) + 4;
      var codeOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      var codeLengths = new Array(19).fill(0);
      for (var ci = 0; ci < codeCount; ci++) codeLengths[codeOrder[ci]] = readBits(3);
      var codeTree = buildTree(codeLengths), allLengths = [];
      while (allLengths.length < literalCount + distanceCount) {
        var codeSymbol = decodeSymbol(codeTree);
        if (codeSymbol <= 15) allLengths.push(codeSymbol);
        else if (codeSymbol === 16) {
          if (!allLengths.length) throw new Error("Invalid DEFLATE repeat code");
          var repeatPrevious = readBits(2) + 3, previous = allLengths[allLengths.length - 1];
          for (var rp = 0; rp < repeatPrevious; rp++) allLengths.push(previous);
        } else if (codeSymbol === 17) {
          var repeatZero = readBits(3) + 3;
          for (var rz = 0; rz < repeatZero; rz++) allLengths.push(0);
        } else if (codeSymbol === 18) {
          var repeatLongZero = readBits(7) + 11;
          for (var rl = 0; rl < repeatLongZero; rl++) allLengths.push(0);
        } else throw new Error("Invalid DEFLATE code-length symbol");
        if (allLengths.length > literalCount + distanceCount) throw new Error("DEFLATE code-length overflow");
      }
      literalTree = buildTree(allLengths.slice(0, literalCount));
      distanceTree = buildTree(allLengths.slice(literalCount));
    }
    for (;;) {
      var symbolValue = decodeSymbol(literalTree);
      if (symbolValue < 256) {
        output.push(symbolValue);
      } else if (symbolValue === 256) {
        break;
      } else {
        var lengthIndex = symbolValue - 257;
        if (lengthIndex < 0 || lengthIndex >= lengthBase.length) throw new Error("Invalid DEFLATE length");
        var copyLength = lengthBase[lengthIndex] + readBits(lengthExtra[lengthIndex]);
        var distanceSymbol = decodeSymbol(distanceTree);
        if (distanceSymbol >= distBase.length) throw new Error("Invalid DEFLATE distance");
        var copyDistance = distBase[distanceSymbol] + readBits(distExtra[distanceSymbol]);
        if (copyDistance <= 0 || copyDistance > output.length) throw new Error("Invalid DEFLATE back-reference");
        for (var cp = 0; cp < copyLength; cp++) output.push(output[output.length - copyDistance]);
      }
      if (output.length > 32 * 1024 * 1024) throw new Error("Miruro response exceeds decompression limit");
    }
  }
  return { bytes: output, nextOffset: pos };
}
function mrGunzip(data) {
  if (!(data instanceof Uint8Array) || data.length < 18 || data[0] !== 31 || data[1] !== 139 || data[2] !== 8) {
    throw new Error("Invalid gzip payload");
  }
  var flags = data[3], pos = 10;
  if (flags & 4) {
    if (pos + 2 > data.length) throw new Error("Truncated gzip extra field");
    var extraLength = data[pos] | (data[pos + 1] << 8);
    pos += 2 + extraLength;
  }
  if (flags & 8) { while (pos < data.length && data[pos++] !== 0) {} }
  if (flags & 16) { while (pos < data.length && data[pos++] !== 0) {} }
  if (flags & 2) pos += 2;
  if (pos >= data.length - 8) throw new Error("Invalid gzip body offset");
  var inflated = mrInflateRaw(data, pos);
  return new Uint8Array(inflated.bytes);
}
function mrDecodePipeBody(body, obfuscated, pipeKey) {
  if (String(obfuscated || "1") !== "2") return String(body || "");
  var bytes = mrDecodeBase64Url(String(body || "").trim()), key = mrHexBytes(pipeKey);
  if (!key.length) throw new Error("Miruro pipe decryption key unavailable");
  for (var i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return new TextDecoder("utf-8").decode(mrGunzip(bytes));
}
function mrEncodeEnvelope(payload) {
  return mrBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}
function mrPipeUrl(base, path, query) {
  var envelope = {
    path: path,
    method: "GET",
    query: query || {},
    body: null,
    version: "0.2.0",
    timestamp: Date.now()
  };
  return base.replace(/\/+$/, "") + "/api/secure/pipe?e=" + encodeURIComponent(mrEncodeEnvelope(envelope));
}
function mrValidMirror(value) {
  var candidate = String(value || "").replace(/\/+$/, "");
  return MIRURO_MIRRORS.indexOf(candidate) >= 0 ? candidate : MIRURO_MIRRORS[0];
}
async function mrLoadEnv(base) {
  if (MIRURO_ENV_CACHE[base]) return MIRURO_ENV_CACHE[base];
  var env = Object.assign({}, MIRURO_DEFAULTS);
  try {
    var text = await (await mrFetch(base + "/env2.js", { headers: { "Accept": "*/*" } }, 8000)).text();
    var match = text.match(/window\.env\s*=\s*JSON\.parse\("([\s\S]*?)"\)/);
    if (match) {
      var parsed = JSON.parse("\"" + match[1] + "\"");
      var value = JSON.parse(parsed);
      if (value.VITE_PROXY_A) env.proxyA = String(value.VITE_PROXY_A).replace(/\/?$/, "/");
      if (value.VITE_PROXY_B) env.proxyB = String(value.VITE_PROXY_B).replace(/\/?$/, "/");
      if (value.VITE_REFERER_ORIGIN) env.refererOrigin = String(value.VITE_REFERER_ORIGIN).replace(/\/+$/, "");
      if (value.VITE_PIPE_OBF_KEY) env.pipeKey = String(value.VITE_PIPE_OBF_KEY);
      if (value.VITE_PROXY_OBF_KEY) env.proxyKey = String(value.VITE_PROXY_OBF_KEY);
    }
  } catch (error) {
    console.log("[Miruro] env2.js refresh unavailable; using last-known defaults: " + String(error && error.message || error));
  }
  env.pipeKey = String(env.pipeKey || MIRURO_DEFAULTS.pipeKey);
  env.proxyKey = String(env.proxyKey || MIRURO_DEFAULTS.proxyKey);
  MIRURO_ENV_CACHE[base] = env;
  return env;
}
async function mrPipe(base, path, query, env) {
  var response = await mrFetch(mrPipeUrl(base, path, query), { method: "GET", headers: MIRURO_HEADERS }, 12000);
  var body = await response.text();
  return mrDecodePipeBody(body, response.headers && response.headers.get ? response.headers.get("x-obfuscated") : "1", env.pipeKey);
}
async function mrAniListMeta(id, context) {
  var provided = [].concat(context.title || [], context.titles || [], context.aliases || []);
  var titles = provided.map(function (item) {
    return typeof item === "string" ? item :
      item && (item.userPreferred || item.english || item.romaji || item.native) || "";
  }).filter(Boolean);
  if (titles.length) return { id: String(id), titles: titles };
  var query = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native userPreferred } synonyms } }";
  var response = await (await mrFetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query: query, variables: { id: Number(id) } })
  }, 10000)).json();
  var media = response && response.data && response.data.Media;
  if (!media || String(media.id) !== String(id)) throw new Error("AniList returned a mismatched media ID");
  return {
    id: String(media.id),
    titles: [media.title && media.title.userPreferred, media.title && media.title.english,
      media.title && media.title.romaji, media.title && media.title.native]
      .concat(media.synonyms || []).filter(Boolean)
  };
}
function mrExactEpisode(providers, order, ep) {
  var keys = order.concat(Object.keys(providers || {}).filter(function (key) { return order.indexOf(key) < 0; }));
  for (var i = 0; i < keys.length; i++) {
    var provider = providers && providers[keys[i]], episodes = provider && provider.episodes;
    if (!episodes || typeof episodes !== "object") continue;
    var subtypeKeys = Object.keys(episodes);
    var episodeTypes = {};
    subtypeKeys.forEach(function (subtype) {
      var list = Array.isArray(episodes[subtype]) ? episodes[subtype] : [];
      var match = list.find(function (item) { return item && Math.abs(Number(item.number) - ep) < 0.0001 && item.id; });
      if (match) episodeTypes[subtype] = String(match.id);
    });
    if (Object.keys(episodeTypes).length) {
      var fallbacks = {};
      keys.forEach(function (fallbackKey) {
        if (fallbackKey === keys[i]) return;
        var fallbackEpisodes = providers[fallbackKey] && providers[fallbackKey].episodes;
        if (!fallbackEpisodes) return;
        var mapped = {};
        Object.keys(fallbackEpisodes).forEach(function (subtype) {
          var list = Array.isArray(fallbackEpisodes[subtype]) ? fallbackEpisodes[subtype] : [];
          var match = list.find(function (item) { return item && Math.abs(Number(item.number) - ep) < 0.0001 && item.id; });
          if (match) mapped[subtype] = String(match.id);
        });
        if (Object.keys(mapped).length) fallbacks[fallbackKey] = mapped;
      });
      return { provider: keys[i], subTypes: episodeTypes, fallbackProviders: fallbacks };
    }
  }
  return null;
}
function mrSubtypeOrder(subTypes, preferred) {
  var available = Object.keys(subTypes || {});
  var want = String(preferred || "sub").toLowerCase();
  if (available.indexOf(want) >= 0) return [want].concat(available.filter(function (item) { return item !== want; }));
  return available;
}
function mrParseSources(payload) {
  if (!payload || typeof payload !== "object") return { streams: [], subtitles: [] };
  if (Array.isArray(payload.streams)) return payload;
  var keys = Object.keys(payload);
  for (var i = 0; i < keys.length; i++) {
    var value = payload[keys[i]];
    if (value && typeof value === "object" && Array.isArray(value.streams)) return value;
  }
  return { streams: [], subtitles: [] };
}
function mrQuality(stream) {
  var height = Number(stream && stream.resolution && stream.resolution.height || 0);
  var raw = String(stream && stream.quality || "");
  var match = raw.match(/(\d{3,4})\s*p?/i);
  if (!height && match) height = Number(match[1]);
  if (!height) return "Auto";
  if (height >= 2160) return "2160p";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  if (height >= 240) return "240p";
  if (height >= 144) return "144p";
  return "Auto";
}
function mrFnv1aParity(value) {
  var bytes = new TextEncoder().encode(String(value || ""));
  var hash = 0x811c9dc5;
  for (var i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  return hash & 1;
}
function mrXorBase64Url(value, keyHex) {
  var bytes = new TextEncoder().encode(String(value || "")), key = mrHexBytes(keyHex);
  if (!key.length) return "";
  for (var i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  return mrBase64Url(bytes);
}
function mrProxyUrl(streamUrl, referer, episodeId, anilistId, env) {
  if (!env.proxyKey) return streamUrl;
  var base = mrFnv1aParity(String(episodeId) + "|" + String(anilistId)) === 0 ? env.proxyA : env.proxyB;
  if (!/^https:\/\//i.test(base || "")) return streamUrl;
  var encodedStream = mrXorBase64Url(streamUrl, env.proxyKey);
  var encodedReferer = mrXorBase64Url(referer, env.proxyKey);
  if (!encodedStream || !encodedReferer) return streamUrl;
  return base + encodedStream + "~" + encodedReferer + "/pl.m3u8";
}
function mrSubtitles(payload) {
  return (Array.isArray(payload && payload.subtitles) ? payload.subtitles : []).map(function (item) {
    if (!item || !/^https:\/\//i.test(String(item.url || ""))) return null;
    var label = String(item.label || item.language || "").trim();
    if (!label) return null;
    var result = { url: item.url, lang: label };
    if (item.format) result.format = String(item.format);
    return result;
  }).filter(Boolean);
}
async function mrCandidates(payload, subtype, episodeId, anilistId, env, base, episodeNumber) {
  var source = mrParseSources(payload), subtitles = mrSubtitles(source), output = [];
  var list = Array.isArray(source.streams) ? source.streams : [];
  for (var i = 0; i < list.length; i++) {
    var stream = list[i] || {};
    if (stream.isActive === false || !/^https:\/\//i.test(String(stream.url || ""))) continue;
    var streamType = String(stream.type || "").toLowerCase();
    var language = String(subtype || "sub").toLowerCase();
    if (streamType === "embed") {
      var embedLabel = "Episode stream";
      var embedQuality = mrQuality(stream);
      if (embedQuality !== "Auto") embedLabel += " · " + embedQuality;
      embedLabel += " · " + (language === "dub" ? "Dub" : language === "ssub" ? "Soft Sub" : "Sub");
      if (stream.codec) embedLabel += " · " + String(stream.codec);
      if (stream.audio) embedLabel += " · " + String(stream.audio);
      if (stream.fansub) embedLabel += " · " + String(stream.fansub);
      var native = await rawResolveUniversalEmbed(MIRURO_ID, stream.url, embedLabel, language,
        anilistId, episodeNumber, base.replace(/\/+$/, "") + "/",
        { "Accept": "text/html,application/xhtml+xml,*/*" }, subtitles);
      output.push.apply(output, native);
      continue;
    }
    if (streamType !== "hls") continue;
    var sourceReferer = String(stream.referer || "").trim() || env.refererOrigin || MIRURO_DEFAULTS.refererOrigin;
    var url = mrProxyUrl(stream.url, sourceReferer, episodeId, anilistId, env);
    if (!/^https:\/\//i.test(url)) continue;
    var quality = mrQuality(stream);
    var label = "Episode stream";
    if (quality !== "Auto") label += " · " + quality;
    label += " · " + (language === "dub" ? "Dub" : language === "ssub" ? "Soft Sub" : "Sub");
    if (stream.codec) label += " · " + String(stream.codec);
    if (stream.audio) label += " · " + String(stream.audio);
    if (stream.fansub) label += " · " + String(stream.fansub);
    output.push({
      name: label,
      title: label,
      url: url,
      quality: quality,
      type: "m3u8",
      provider: MIRURO_ID,
      language: language,
      headers: {
        "Referer": base.replace(/\/+$/, "") + "/",
        "Origin": base.replace(/\/+$/, "")
      },
      subtitles: subtitles,
      anilistId: String(anilistId),
      episodeNumber: Number(episodeNumber)
    });
  }
  return output;
}
async function mrResolveSources(base, env, episode, anilistId, preferredAudio) {
  var result = [], seen = Object.create(null);
  var primaryProvider = episode.provider, primaryTypes = mrSubtypeOrder(episode.subTypes, preferredAudio);
  async function requestSet(provider, subtypeMap, subtypeList, includeEpisodeEnvelope) {
    var types = mrSubtypeOrder(subtypeMap, preferredAudio);
    if (subtypeList && subtypeList.length) types = types.filter(function (item) { return subtypeList.indexOf(item) >= 0; });
    for (var i = 0; i < types.length; i++) {
      var subtype = types[i], episodeId = subtypeMap[subtype];
      if (!episodeId) continue;
      var query = { episodeId: String(episodeId), provider: String(provider), category: String(subtype) };
      if (includeEpisodeEnvelope && i === 0) query._ep = JSON.stringify({
        episodeId: episode.subTypes[primaryTypes[0]],
        provider: primaryProvider,
        defaultSubType: primaryTypes[0],
        subTypes: episode.subTypes,
        fallbackProviders: episode.fallbackProviders,
        anilistId: String(anilistId)
      });
      try {
        var json = await mrPipe(base, "sources", query, env);
        var candidates = await mrCandidates(json, subtype, episodeId, anilistId, env, base, Number(mrContext().episodeNumber || mrContext().episode || 0));
        for (var c = 0; c < candidates.length; c++) {
          if (!seen[candidates[c].url]) { seen[candidates[c].url] = true; result.push(candidates[c]); }
        }
      } catch (error) {
        console.log("[Miruro] sources request failed for " + provider + "/" + subtype + ": " + String(error && error.message || error));
        if (String(error && error.message || error).indexOf("HTTP 403") >= 0 ||
            String(error && error.message || error).indexOf("HTTP 429") >= 0) throw error;
      }
    }
  }
  await requestSet(primaryProvider, episode.subTypes, primaryTypes, true);
  if (result.length) return result;
  var fallbackKeys = Object.keys(episode.fallbackProviders || {});
  for (var f = 0; f < fallbackKeys.length && !result.length; f++) {
    var fallback = fallbackKeys[f];
    await requestSet(fallback, episode.fallbackProviders[fallback], null, false);
  }
  return result;
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    var context = Object.assign({}, mrContext(), extraArgs || {});
    if (mediaType !== "anime") return [];
    var id = String(anilistId || context.anilistId || context.aniListId || "");
    var ep = Number(episode || context.episodeNumber || context.episode || 0);
    if (!/^\d+$/.test(id) || Number(id) <= 0 || !Number.isFinite(ep) || ep <= 0) return [];
    if (context.anilistId && String(context.anilistId) !== id) return [];
    await mrAniListMeta(id, context);
    var base = mrValidMirror(context.miruroMirror || MIRURO_MIRRORS[0]);
    var env = await mrLoadEnv(base);
    var config = null, providerOrder = MIRURO_DEFAULT_PROVIDER_ORDER.slice();
    try {
      config = JSON.parse(await mrPipe(base, "config", {}, env));
      if (config && Array.isArray(config.providerOrder) && config.providerOrder.length) {
        var streaming = config.streaming || {};
        providerOrder = config.providerOrder.filter(function (key) {
          var item = streaming[key];
          return !item || (item.visible !== false && item.relationship !== "embed");
        });
      }
    } catch (configError) {
      console.log("[Miruro] config unavailable; using source default order: " + String(configError && configError.message || configError));
    }
    var episodesJson = JSON.parse(await mrPipe(base, "episodes", { anilistId: Number(id) }, env));
    var providers = episodesJson && episodesJson.providers;
    if (!providers || typeof providers !== "object") return [];
    var mapped = mrExactEpisode(providers, providerOrder, ep);
    if (!mapped) {
      console.log("[Miruro] no exact episode " + ep + " exists for AniList " + id);
      return [];
    }
    var preferred = String(context.preferredAudio || "sub").toLowerCase();
    if (preferred !== "dub" && preferred !== "ssub") preferred = "sub";
    var candidates = await mrResolveSources(base, env, mapped, id, preferred);
    // Identity fields are stamped from the invocation, never from upstream payload.
    return candidates.map(function (candidate) {
      candidate.anilistId = id;
      candidate.episodeNumber = ep;
      return candidate;
    });
  } catch (error) {
    console.log("[Miruro] resolution failed: " + String(error && error.message || error));
    return [];
  }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams,
    __test: {
      gunzip: mrGunzip,
      decodePipeBody: mrDecodePipeBody,
      encodeEnvelope: mrEncodeEnvelope,
      pipeUrl: mrPipeUrl
    }
  };
}
