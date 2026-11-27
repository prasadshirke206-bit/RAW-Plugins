/* AniSnatch — QuickJS playback port derived from AniSnatch.kt.
 * Ports the public site-config cipher, request payload framing, XOR+gzip response
 * decoding, AniList-title to site-ID resolution, episode/server lookup and visible
 * direct HLS/MP4 sources. RAW-native playlist/key rewriting remains out of scope.
 */
var NS_ID = "anisnatch";
var NS_BASE = "https://anisnatch.top";
var NS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var NS_AES_KEY = "i?LMTAx0Q6,:}50U";
var NS_AES_IV = "W0;27ToaUpl_P%'c";
var nsState = { alphabet: null, marker: null, token: null };

function nsContext() {
  return (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {};
}
function nsUtf8(value) {
  if (typeof TextEncoder === "undefined") throw new Error("AniSnatch requires TextEncoder");
  return new TextEncoder().encode(String(value));
}
function nsText(bytes) {
  if (typeof TextDecoder === "undefined") throw new Error("AniSnatch requires TextDecoder");
  return new TextDecoder("utf-8").decode(bytes);
}
function nsBase64(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] & 255);
  return btoa(binary);
}
function nsDecodeBase64(value) {
  var binary = atob(String(value || "").replace(/\s+/g, ""));
  var out = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function nsBase64UrlDecode(value) {
  var clean = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (clean.length % 4) clean += "=";
  return nsDecodeBase64(clean);
}
function nsHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] & 255).toString(16).padStart(2, "0");
  return out;
}
function nsBin2Hex(text) {
  var out = "";
  for (var i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}
function nsTimeout(promise, ms) {
  var timer;
  return Promise.race([
    promise,
    new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("AniSnatch timeout")); }, ms || 12000); })
  ]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}
async function nsFetch(url, options, ms) {
  var response = await nsTimeout(fetch(url, options || {}), ms || 12000);
  if (!response || !response.ok) throw new Error("AniSnatch HTTP " + (response ? response.status : "network"));
  return response;
}
async function nsEnsureConfig() {
  if (nsState.alphabet && nsState.marker) return true;
  var response = await nsFetch(NS_BASE + "/", { headers: { "User-Agent": NS_UA, "Referer": NS_BASE + "/" } }, 12000);
  var html = await response.text();
  var token = (html.match(/<meta\b[^>]*name=["']token["'][^>]*content=["']([^"']+)["']/i) || [,""])[1];
  var configToken = (html.match(/configToken\s*=\s*['"]([^'"]+)['"]/i) || [,""])[1];
  var version = (html.match(/version\s*=\s*['"]([^'"]+)['"]/i) || [,""])[1];
  var serverTime = (html.match(/serverTime\s*=\s*(\d+)/i) || [,""])[1];
  if (!token || !configToken || !version || !serverTime) throw new Error("AniSnatch dynamic crypto config is incomplete");
  var encoded = nsDecodeBase64(configToken);
  var xorKey = nsUtf8(token + version + serverTime);
  var plain = new Uint8Array(encoded.length);
  for (var i = 0; i < encoded.length; i++) plain[i] = (encoded[i] ^ xorKey[i % xorKey.length]) & 255;
  var config = JSON.parse(nsText(plain));
  if (typeof config.key !== "string" || !Array.isArray(config.mark) || !config.mark.length) {
    throw new Error("AniSnatch dynamic crypto config is invalid");
  }
  nsState.alphabet = config.key;
  nsState.marker = new Uint8Array(config.mark.map(function (n) { return Number(n) & 255; }));
  return true;
}
function nsSmcShift(input, encrypt, passes) {
  var alphabet = nsState.alphabet;
  if (!alphabet) throw new Error("AniSnatch SMC alphabet unavailable");
  var length = alphabet.length, result = String(input);
  for (var p = 0; p < passes; p++) {
    var out = "";
    for (var i = 0; i < result.length; i++) {
      var ch = result.charAt(i), pos = alphabet.indexOf(ch);
      if (pos < 0) out += ch;
      else {
        var shifted = encrypt ? (pos + 5) % length : (pos - 5 + length) % length;
        out += alphabet.charAt(shifted);
      }
    }
    result = out.split("").reverse().join("");
  }
  return result;
}
function nsStr2Enc(input) {
  var hex = nsBin2Hex(nsBase64(nsUtf8(input)));
  var firstPasses = (Date.now() % 10) + 1;
  var first = nsSmcShift(hex, true, firstPasses);
  var combined = first + "strSMCconvert" + firstPasses;
  for (var passes = 1; passes <= 10; passes++) {
    var candidate = nsSmcShift(combined, true, passes);
    if (candidate.indexOf("strSMCconv") < 0) return candidate;
  }
  return nsSmcShift(combined, true, 1);
}
function nsStr2Aci(token) {
  var total = 0;
  var text = String(token);
  for (var i = 0; i < text.length; i++) total += text.charCodeAt(i);
  return String(total);
}
function nsAccurateTime() {
  return Math.floor(Date.now() / 1000) + 60;
}
function nsBuildPayload(json) {
  var encoded = nsStr2Enc(json), chunks = [];
  for (var i = 0; i < encoded.length; i += 25) chunks.push({ index: i / 25, chunk: encoded.slice(i, i + 25) });
  for (var j = chunks.length - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var swap = chunks[j]; chunks[j] = chunks[k]; chunks[k] = swap;
  }
  var token = nsStr2Enc(String(nsAccurateTime() + 500));
  var authenticator = nsStr2Aci(token);
  return {
    body: JSON.stringify({
      data: chunks.map(function (x) { return x.chunk; }),
      key: chunks.map(function (x) { return x.index; }),
      token: token,
      authenticator: authenticator
    }),
    authenticator: authenticator
  };
}
function nsDecryptResponse(bytes, authenticator) {
  var marker = nsState.marker;
  if (!marker || !marker.length) return null;
  var markerIndex = -1;
  outer: for (var i = 0; i <= bytes.length - marker.length; i++) {
    for (var j = 0; j < marker.length; j++) if (bytes[i + j] !== marker[j]) continue outer;
    markerIndex = i; break;
  }
  if (markerIndex < 0) return null;
  var encrypted = bytes.slice(markerIndex + marker.length);
  var key = nsUtf8(authenticator);
  if (!key.length) return null;
  for (var k = 0; k < encrypted.length; k++) encrypted[k] ^= key[k % key.length];
  return nsGunzip(encrypted);
}
async function nsApiPost(endpoint, body, retry) {
  await nsEnsureConfig();
  var payload = nsBuildPayload(JSON.stringify(body || {}));
  var timestamp = nsAccurateTime();
  var response = await nsFetch(NS_BASE + "/" + endpoint + "/" + timestamp, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "*/*",
      "User-Agent": NS_UA,
      "Referer": NS_BASE + "/"
    },
    body: payload.body
  }, 15000);
  var buffer = new Uint8Array(await response.arrayBuffer());
  var decoded = nsDecryptResponse(buffer, payload.authenticator);
  if (!decoded) {
    if (!retry) {
      nsState.alphabet = null; nsState.marker = null;
      await nsEnsureConfig();
      return await nsApiPost(endpoint, body, true);
    }
    throw new Error("AniSnatch response marker or gzip payload did not validate");
  }
  var data = JSON.parse(nsText(decoded));
  var success = data && data.success !== false;
  var message = String(data && data.message || "");
  if (!success && /session expired/i.test(message) && !retry) {
    nsState.token = null;
    await nsEnsureSnatchToken(true);
    var nextBody = Object.assign({}, body || {});
    if (Object.prototype.hasOwnProperty.call(nextBody, "token")) nextBody.token = nsState.token || "";
    return await nsApiPost(endpoint, nextBody, true);
  }
  return data;
}
async function nsEnsureSnatchToken(force) {
  if (nsState.token && !force) return nsState.token;
  var data = await nsApiPost("api/init", { token: "" }, false);
  nsState.token = data && data.token ? String(data.token) : "";
  return nsState.token;
}
function nsNorm(value) {
  var text = String(value || "").toLowerCase();
  if (text.normalize) text = text.normalize("NFKC");
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}
async function nsGetAniListMeta(id, context) {
  var supplied = [].concat(context.title || [], context.titles || [], context.aliases || []);
  var titles = supplied.map(function (x) {
    return typeof x === "string" ? x : (x && (x.english || x.romaji || x.native)) || "";
  }).filter(Boolean);
  if (titles.length) return { id: String(id), titles: titles };
  var query = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native userPreferred } synonyms } }";
  var response = await nsFetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query: query, variables: { id: Number(id) } })
  }, 12000);
  var json = await response.json(), media = json && json.data && json.data.Media;
  if (!media || String(media.id) !== String(id)) throw new Error("AniList ID mismatch");
  return {
    id: String(media.id),
    titles: [media.title && media.title.english, media.title && media.title.romaji, media.title && media.title.native, media.title && media.title.userPreferred].concat(media.synonyms || []).filter(Boolean)
  };
}
async function nsFindAnime(meta) {
  var seen = {};
  for (var i = 0; i < Math.min(meta.titles.length, 5); i++) {
    var title = meta.titles[i];
    var data = await nsApiPost("api/search", { keyword: title, page: 1 }, false);
    var rows = data && data.data && data.data.anime;
    if (!Array.isArray(rows)) continue;
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j] || {};
      var candidates = [row.title_en, row.title, row.title_jp, row.title_native].filter(Boolean);
      if (!candidates.some(function (candidate) { return nsNorm(candidate) === nsNorm(title); })) continue;
      var id = String(row.id || "");
      if (id) seen[id] = row;
    }
    var ids = Object.keys(seen);
    if (ids.length > 1) throw new Error("AniSnatch exact-title search is ambiguous");
    if (ids.length === 1) return seen[ids[0]];
  }
  return null;
}
function nsBool(value) {
  if (typeof value === "boolean") return value;
  return Number(value || 0) > 0;
}
function nsQuality(height) {
  var h = Number(height || 0);
  if (h >= 2160) return "2160p";
  if (h >= 1440) return "1440p";
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  if (h >= 480) return "480p";
  if (h >= 360) return "360p";
  if (h >= 240) return "240p";
  if (h >= 144) return "144p";
  return "Auto";
}
function nsAbs(base, value) {
  try { return new URL(value, base).toString(); } catch (_) { return value; }
}
function nsCandidate(url, label, quality, type, language, headers, subtitles, id, episode) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return {
    name: "AniSnatch · " + label,
    title: label,
    url: url,
    quality: quality || "Auto",
    type: type || "m3u8",
    provider: NS_ID,
    language: language || "sub",
    headers: headers || {},
    subtitles: subtitles || [],
    anilistId: String(id),
    episodeNumber: Number(episode)
  };
}
async function nsHlsCandidates(url, label, language, headers, subtitles, id, episode) {
  var response = await nsFetch(url, { headers: headers }, 12000);
  var body = await response.text();
  if (body.indexOf("#EXTM3U") < 0) return [];
  if (body.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") >= 0) {
    var master = nsCandidate(url, label, "Auto", "m3u8", language, headers, subtitles, id, episode);
    return master ? [master] : [];
  }
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var height = (lines[i].match(/RESOLUTION=\d+x(\d+)/i) || [,""])[1];
    var next = "";
    for (var j = i + 1; j < lines.length; j++) {
      var item = lines[j].trim();
      if (item && item.charAt(0) !== "#") { next = item; break; }
    }
    if (!next) continue;
    var candidate = nsCandidate(nsAbs(url, next), label, nsQuality(height), "m3u8", language, headers, subtitles, id, episode);
    if (candidate) out.push(candidate);
  }
  if (!out.length) {
    var fallback = nsCandidate(url, label, "Auto", "m3u8", language, headers, subtitles, id, episode);
    if (fallback) out.push(fallback);
  }
  return out;
}
function nsReadSubtitles(html, base) {
  var match = String(html || "").match(/subtitles\s*:\s*(\[[\s\S]*?\])/i);
  if (!match) return [];
  try {
    var data = JSON.parse(match[1]);
    if (!Array.isArray(data)) return [];
    return data.map(function (item) {
      return item && item.file ? { url: nsAbs(base, item.file), label: item.label || "English" } : null;
    }).filter(Boolean);
  } catch (_) { return []; }
}
async function nsResolveVideoPage(source, audio, server, id, episode) {
  var videoPage = NS_BASE + "/video/" + String(source).replace(/^\/+/, "");
  var response = await nsFetch(videoPage, { headers: { "User-Agent": NS_UA, "Referer": NS_BASE + "/" } }, 12000);
  var html = await response.text(), targetUrl = videoPage, targetHtml = html;
  var iframe = (html.match(/<iframe\b[^>]*src=["']([^"']+)["']/i) || [,""])[1];
  var stream = (html.match(/streamURL\s*=\s*['"]([^'"]+)['"]/i) || [,""])[1];
  var embed = iframe || stream || "";
  if (embed) {
    targetUrl = nsAbs(videoPage, embed);
    var embedResponse = await nsFetch(targetUrl, { headers: { "User-Agent": NS_UA, "Referer": videoPage } }, 12000);
    targetHtml = await embedResponse.text();
  }
  var origin = "";
  try { var parsed = new URL(targetUrl); origin = parsed.origin; } catch (_) {}
  var headers = { "User-Agent": NS_UA, "Referer": targetUrl };
  if (origin) headers.Origin = origin;
  var subtitles = nsReadSubtitles(targetHtml, targetUrl), out = [];
  var srcsMatch = targetHtml.match(/srcs\s*:\s*(\[[\s\S]*?\])/i);
  if (srcsMatch) {
    try {
      var srcs = JSON.parse(srcsMatch[1]);
      if (Array.isArray(srcs)) for (var i = 0; i < srcs.length; i++) {
        var item = srcs[i] || {}, url = item.url, type = String(item.type || (/\.m3u8(?:$|[?#])/i.test(url || "") ? "hls" : /\.mpd(?:$|[?#])/i.test(url || "") ? "dash" : "mp4")).toLowerCase();
        if (!url) continue;
        url = nsAbs(targetUrl, url);
        var label = audio + " - " + server + " - " + (item.label || "HD");
        if (type === "hls") out.push.apply(out, await nsHlsCandidates(url, label, audio, headers, subtitles, id, episode));
        else {
          var candidate = nsCandidate(url, label, "Auto", type === "dash" ? "mpd" : "mp4", audio, headers, subtitles, id, episode);
          if (candidate) out.push(candidate);
        }
      }
    } catch (_) {}
  }
  if (!out.length) {
    var srcMatch = targetHtml.match(/src\s*:\s*(\{[\s\S]*?\})/i);
    if (srcMatch) {
      try {
        var obj = JSON.parse(srcMatch[1]), url = obj.url || "";
        if (!url && obj.enc) url = await nsDecryptEncPayload(obj.enc);
        var type = String(obj.type || (/\.mpd/i.test(url) ? "dash" : /\.mp4/i.test(url) ? "mp4" : "hls")).toLowerCase();
        if (url) {
          url = nsAbs(targetUrl, url);
          var label = audio + " - " + server;
          if (type === "hls") out.push.apply(out, await nsHlsCandidates(url, label, audio, headers, subtitles, id, episode));
          else {
            var candidate = nsCandidate(url, label, "Auto", type === "dash" ? "mpd" : "mp4", audio, headers, subtitles, id, episode);
            if (candidate) out.push(candidate);
          }
        }
      } catch (_) {}
    }
  }
  if (!out.length) {
    var direct = (targetHtml.match(/["'](https?:\/\/[^"'\\s]+\.m3u8(?:\?[^"'\\s]*)?)["']/i) || [,""])[1];
    if (direct) out.push.apply(out, await nsHlsCandidates(direct, audio + " - " + server, audio, headers, subtitles, id, episode));
  }
  return out;
}
async function nsDecryptEncPayload(encoded) {
  if (!encoded || typeof crypto === "undefined" || !crypto.subtle) return "";
  try {
    var raw = nsBase64UrlDecode(encoded), keyBytes = new Uint8Array(32), keySrc = nsUtf8(NS_AES_KEY), iv = nsUtf8(NS_AES_IV);
    keyBytes.set(keySrc.slice(0, 32));
    var key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, raw);
    var obj = JSON.parse(nsText(new Uint8Array(plain)));
    return obj && obj.file ? String(obj.file) : "";
  } catch (_) { return ""; }
}
async function nsResolveSource(source, audio, server, id, episode) {
  var value = String(source || "");
  var parts = value.split("/");
  if (parts[0].toLowerCase() === "vibeplayer" && parts[1]) {
    try {
      var playerUrl = nsText(nsBase64UrlDecode(parts[1]));
      var response = await nsFetch(playerUrl, { headers: { "User-Agent": NS_UA, "Referer": NS_BASE + "/" } }, 12000);
      var html = await response.text();
      var m3u8 = (html.match(/["']?(https?:\/\/[^"'\\s]+\.m3u8[^"'\\s]*)["']?/i) || [,""])[1];
      if (!m3u8) return [];
      var origin = "";
      try { origin = new URL(playerUrl).origin; } catch (_) {}
      var headers = { "User-Agent": NS_UA, "Referer": playerUrl };
      if (origin) headers.Origin = origin;
      return await nsHlsCandidates(m3u8, audio + " - " + server, audio, headers, [], id, episode);
    } catch (_) { return []; }
  }
  return await nsResolveVideoPage(value, audio, server, id, episode);
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    var context = Object.assign({}, nsContext(), extraArgs || {});
    if (mediaType !== "anime") return [];
    var id = String(anilistId || context.anilistId || context.aniListId || "");
    var ep = Number(episode || context.episodeNumber || 0);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(ep) || ep <= 0) return [];
    var meta = await nsGetAniListMeta(id, context);
    var match = await nsFindAnime(meta);
    if (!match || !match.id) return [];
    var animeId = Number(match.id);
    if (!Number.isSafeInteger(animeId) || animeId <= 0) return [];
    var details = await nsApiPost("api/anime", { id: animeId }, false);
    var data = details && details.data || {}, info = data.anime || {};
    var episodes = data.list;
    if (!Array.isArray(episodes) || !episodes.length) {
      var token = await nsEnsureSnatchToken(false);
      var loaded = await nsApiPost("api/loadEPs", { id: animeId, token: token || "" }, false);
      episodes = loaded && (loaded.episodes || loaded.list) || [];
    }
    var hasEpisode = Array.isArray(episodes) && episodes.some(function (item) {
      return item && Number(item.number) === ep;
    });
    var lastEpisode = Number(info.lastep || 0);
    if (!hasEpisode && lastEpisode < ep) return [];
    var sessionToken = await nsEnsureSnatchToken(false);
    var serverData = await nsApiPost("api/loadSVs", { id: animeId, ep: ep, token: sessionToken || "" }, false);
    var servers = serverData && serverData.server || {}, keys = Object.keys(servers), tasks = [];
    for (var i = 0; i < keys.length; i++) {
      var audio = keys[i].toLowerCase();
      if (audio !== "sub" && audio !== "dub" && audio !== "soft-sub") continue;
      var list = servers[keys[i]];
      if (!Array.isArray(list)) continue;
      for (var j = 0; j < list.length; j++) {
        var entry = list[j] || {};
        if (!entry.title || !entry.source) continue;
        tasks.push({ audio: audio, server: String(entry.title), source: String(entry.source) });
      }
    }
    var results = await Promise.all(tasks.map(async function (task) {
      try { return await nsResolveSource(task.source, task.audio, task.server, id, ep); }
      catch (error) { console.log("[AniSnatch] server " + task.server + " failed: " + String(error && error.message || error)); return []; }
    }));
    var out = [], seen = {};
    for (var r = 0; r < results.length; r++) for (var k = 0; k < results[r].length; k++) {
      var candidate = results[r][k];
      if (!candidate || !candidate.url || seen[candidate.url]) continue;
      seen[candidate.url] = true; out.push(candidate);
    }
    return out;
  } catch (error) {
    console.log("[AniSnatch] " + String(error && error.message || error));
    return [];
  }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = {
  getStreams: getStreams,
  internals: {
    nsSmcShift: nsSmcShift,
    nsStr2Enc: nsStr2Enc,
    nsStr2Aci: nsStr2Aci,
    nsBuildPayload: nsBuildPayload,
    nsDecryptResponse: nsDecryptResponse,
    nsEnsureConfig: nsEnsureConfig,
    nsGunzip: nsGunzip,
    nsAccurateTime: nsAccurateTime
  }
};

function nsInflateRaw(data, startOffset) {
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
function nsGunzip(data) {
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
  var inflated = nsInflateRaw(data, pos);
  return new Uint8Array(inflated.bytes);
}
