/*
 * AllAnime — RAW QuickJS anime provider
 * Ported from RAW-Plugins' original AllAnime Kotlin source.
 * Requires the QuickJS host fetch bridge and WebCrypto AES-GCM support for
 * encrypted episode payloads. No stream is fabricated if decryption fails.
 */
var ALLANIME_ID = "allanime";
var ALLANIME_SITE = "https://mkissa.to";
var ALLANIME_API = "https://api.mkissa.net/api";
var ALLANIME_IFRAME = "https://allanime.day";
var ALLANIME_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Origin": ALLANIME_SITE,
  "Referer": ALLANIME_SITE + "/"
};
var ALLANIME_XOR_KEYS = ["allanimenews", "1234567890123456789", "1234567890123456789012345", "s5feqxw21", "feqx1"];
var ALLANIME_XOR_MASKS = ALLANIME_XOR_KEYS.map(function (s) {
  var n = 0; for (var i = 0; i < s.length; i++) n ^= s.charCodeAt(i); return n;
});
var ALLANIME_INTERNAL_HOSTS = ["Default", "Ac", "Ak", "Kir", "Rab", "Luf-mp4", "Si-Hls", "S-mp4", "Ac-Hls", "Uv-mp4", "Pn-Hls"];
var ALLANIME_STREAM_HASH = "f4662f4b7510b26795dd53ef824a0bf1740fbbc5d1273fab18222ac831bca8d0";
function aaContext() { return (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {}; }
function aaTimeout(p, ms, label) {
  var timer;
  return Promise.race([p, new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error(label || "request timeout")); }, ms || 10000); })])
    .then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}
async function aaFetch(url, options, timeoutMs) {
  var response = await aaTimeout(fetch(url, options || {}), timeoutMs || 10000, "AllAnime request timed out");
  if (!response || !response.ok) throw new Error("AllAnime HTTP " + (response ? response.status : "network"));
  return response;
}
async function aaJson(url, options, timeoutMs) { return await (await aaFetch(url, options, timeoutMs)).json(); }
function aaB64Bytes(value) {
  var normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  normalized += "=".repeat((4 - normalized.length % 4) % 4);
  var raw = atob(normalized);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
var ALLANIME_KEY_CACHE = null;
var ALLANIME_KEY_CACHE_EXPIRES = 0;
function aaBase64(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function aaGetKeys() {
  if (ALLANIME_KEY_CACHE && Date.now() < ALLANIME_KEY_CACHE_EXPIRES) return ALLANIME_KEY_CACHE;
  if (typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") throw new Error("QuickJS WebCrypto AES-GCM is required");
  var page = await (await aaFetch(ALLANIME_SITE, { headers: ALLANIME_HEADERS }, 9000)).text();
  var epochMatch = page.match(/"epoch"\s*:\s*(\d+)/);
  var partBMatch = page.match(/"partB"\s*:\s*"([^"]+)"/);
  var appUrlMatch = page.match(/https?:\/\/[^"' \t\r\n]+\/entry\/app\.[A-Za-z0-9_.-]+\.js/i);
  if (!epochMatch || !partBMatch || !appUrlMatch) throw new Error("AllAnime epoch, partB or entry bundle was not found");
  var appUrl = appUrlMatch[0];
  var appBundle = await (await aaFetch(appUrl, { headers: ALLANIME_HEADERS }, 9000)).text();
  var cdnRoot = appUrl.split("/entry/")[0];
  var chunkRegex = /["']\.\.\/chunks\/([^"']+\.js)["']/g;
  var chunkNames = [], chunkMatch;
  while ((chunkMatch = chunkRegex.exec(appBundle)) !== null && chunkNames.length < 5) {
    if (chunkNames.indexOf(chunkMatch[1]) < 0) chunkNames.push(chunkMatch[1]);
  }
  if (!chunkNames.length) throw new Error("AllAnime entry bundle did not expose key chunks");
  var maskHex = "";
  for (var i = 0; i < chunkNames.length && !maskHex; i++) {
    try {
      var chunk = await (await aaFetch(cdnRoot + "/chunks/" + chunkNames[i], { headers: ALLANIME_HEADERS }, 8000)).text();
      var maskMatch = chunk.match(/[0-9a-f]{64}/i);
      if (maskMatch) maskHex = maskMatch[0];
    } catch (_) {}
  }
  if (!maskHex) throw new Error("AllAnime key mask was not found in its entry chunks");
  var partB = aaB64Bytes(partBMatch[1]);
  if (partB.length !== 32) throw new Error("AllAnime partB must decode to 32 bytes");
  var mask = new Uint8Array(32), key = new Uint8Array(32);
  for (var j = 0; j < 32; j++) mask[j] = parseInt(maskHex.slice(j * 2, j * 2 + 2), 16);
  for (var k = 0; k < 32; k++) key[k] = mask[k] ^ partB[k];
  ALLANIME_KEY_CACHE = { key: key, epoch: epochMatch[1] };
  ALLANIME_KEY_CACHE_EXPIRES = Date.now() + 180000;
  return ALLANIME_KEY_CACHE;
}
async function aaBuildRequestToken(keys) {
  var timestamp = Math.floor(Date.now() / 300000) * 300000;
  var payload = '{"v":1,"ts":' + timestamp + ',"epoch":' + keys.epoch + ',"qh":"' + ALLANIME_STREAM_HASH + '"}';
  var ivHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keys.epoch + ":" + ALLANIME_STREAM_HASH + ":" + timestamp));
  var iv = new Uint8Array(ivHash).slice(0, 12);
  var key = await crypto.subtle.importKey("raw", keys.key, { name: "AES-GCM" }, false, ["encrypt"]);
  var sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, key, new TextEncoder().encode(payload)));
  var token = new Uint8Array(1 + iv.length + sealed.length);
  token[0] = 1; token.set(iv, 1); token.set(sealed, 1 + iv.length);
  return aaBase64(token);
}
async function aaDecryptPayload(payload) {
  if (!payload) return "";
  var keys = await aaGetKeys(), blob = aaB64Bytes(payload);
  if (blob.length < 29 || blob[0] !== 1) throw new Error("AllAnime encrypted payload has invalid version or length");
  var key = await crypto.subtle.importKey("raw", keys.key, { name: "AES-GCM" }, false, ["decrypt"]);
  var plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(1, 13), tagLength: 128 }, key, blob.slice(13));
  return new TextDecoder().decode(plaintext);
}
function aaDecodeSourceURL(value) {
  var raw = String(value || "");
  if (raw.indexOf("--") === 0) raw = raw.slice(2);
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(raw)) return String(value || "");
  var substitutions = {
    "79":"A","7a":"B","7b":"C","7c":"D","7d":"E","7e":"F","7f":"G",
    "70":"H","71":"I","72":"J","73":"K","74":"L","75":"M","76":"N","77":"O",
    "68":"P","69":"Q","6a":"R","6b":"S","6c":"T","6d":"U","6e":"V","6f":"W",
    "60":"X","61":"Y","62":"Z","59":"a","5a":"b","5b":"c","5c":"d","5d":"e","5e":"f","5f":"g",
    "50":"h","51":"i","52":"j","53":"k","54":"l","55":"m","56":"n","57":"o","48":"p","49":"q","4a":"r","4b":"s","4c":"t","4d":"u","4e":"v","4f":"w",
    "40":"x","41":"y","42":"z","08":"0","09":"1","0a":"2","0b":"3","0c":"4","0d":"5","0e":"6","0f":"7","00":"8","01":"9",
    "15":"-","16":".","67":"_","46":"~","02":":","17":"/","07":"?","1b":"#","63":"[","65":"]","78":"@","19":"!","1c":"$","1e":"&",
    "10":"(","11":")","12":"*","13":"+","14":",","03":";","05":"=","1d":"%"
  };
  var decoded = "";
  for (var i = 0; i < raw.length; i += 2) {
    var pair = raw.slice(i, i + 2).toLowerCase();
    decoded += Object.prototype.hasOwnProperty.call(substitutions, pair) ? substitutions[pair] : pair;
  }
  decoded = decoded.replace(/\/clock\b/g, "/clock.json");
  if (decoded.charAt(0) === "/") return "https://allanime.day" + decoded;
  return decoded;
}
function aaDecryptSource(value) { return aaDecodeSourceURL(value); }

function aaNormalizeTitle(value) {
  var s = String(value || "");
  if (s.normalize) s = s.normalize("NFKC");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
async function aaAniListMeta(id, context) {
  var supplied = [].concat(context.title || [], context.titles || [], context.aliases || []);
  if (supplied.length) return { id: String(id), titles: supplied.map(function (x) { return typeof x === "string" ? x : (x && (x.english || x.romaji || x.native)) || ""; }).filter(Boolean), episodes: Number(context.totalEpisodes || context.episodes || 0), year: Number(context.year || context.seasonYear || 0), format: String(context.format || "") };
  var query = "query ($id: Int) { Media(id: $id, type: ANIME) { id idMal episodes format seasonYear title { romaji english native userPreferred } synonyms } }";
  var data = await aaJson("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ query: query, variables: { id: Number(id) } }) }, 12000);
  var media = data && data.data && data.data.Media;
  if (!media || String(media.id) !== String(id)) throw new Error("AniList identity lookup did not return requested anime");
  return { id: String(media.id), titles: [media.title && media.title.english, media.title && media.title.romaji, media.title && media.title.native, media.title && media.title.userPreferred].concat(media.synonyms || []).filter(Boolean), episodes: media.episodes || 0, year: media.seasonYear || 0, format: media.format || "" };
}
function aaIdentityMatch(items, meta) {
  var aliases = {};
  (meta.titles || []).forEach(function (t) { aliases[aaNormalizeTitle(t)] = true; });
  var matches = (items || []).filter(function (item) {
    return [item.name, item.englishName, item.nativeName].some(function (n) { return !!aliases[aaNormalizeTitle(n)]; });
  });
  return matches.length === 1 ? matches[0] : null;
}
async function aaGraphql(body) {
  return await aaJson(ALLANIME_API, { method: "POST", headers: Object.assign({}, ALLANIME_HEADERS, { "Content-Type": "application/json", "Accept": "*/*" }), body: JSON.stringify(body) }, 12000);
}
async function aaFindShow(meta, context) {
  var mapped = context.providerMappings && context.providerMappings.allanime;
  if (mapped) {
    var mappedId = typeof mapped === "object" ? mapped.id : mapped;
    if (mappedId) return { _id: String(mappedId), name: meta.titles[0] || "AniList anime" };
  }
  var query = "query ($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType, $countryOrigin: VaildCountryOriginEnumType) { shows(search: $search, limit: $limit, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) { edges { _id name englishName nativeName thumbnail slugTime } } }";
  for (var i = 0; i < meta.titles.length; i++) {
    var result = await aaGraphql({ variables: { search: { query: meta.titles[i], allowAdult: false, allowUnknown: false }, limit: 26, page: 1, translationType: "sub", countryOrigin: "ALL" }, query: query });
    var edges = result && result.data && result.data.shows && result.data.shows.edges || [];
    var match = aaIdentityMatch(edges, meta);
    if (match) return match;
  }
  return null;
}
function aaResolve(base, path) { try { return new URL(path, base).toString(); } catch (_) { return path; } }
function aaQuality(height) {
  var n = Number(height || 0);
  if (n >= 2160) return "2160p"; if (n >= 1440) return "1440p"; if (n >= 1080) return "1080p";
  if (n >= 720) return "720p"; if (n >= 480) return "480p"; if (n >= 360) return "360p"; if (n >= 240) return "240p"; if (n >= 144) return "144p";
  return "Auto";
}
function aaCandidate(url, title, quality, type, lang, headers, subtitles) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return { name: "AllAnime | " + title, title: title, url: url, quality: quality || "Auto", type: type || "m3u8", provider: ALLANIME_ID, language: lang || undefined, headers: headers || ALLANIME_HEADERS, subtitles: subtitles || [] };
}
async function aaHls(url, title, lang, headers, subtitles) {
  var body = await (await aaFetch(url, { headers: headers }, 10000)).text();
  if (body.indexOf("#EXTM3U") < 0) return [];
  if (body.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") >= 0) {
    var master = aaCandidate(url, title, "Auto", "m3u8", lang, headers, subtitles);
    return master ? [master] : [];
  }
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var height = (lines[i].match(/RESOLUTION=\d+x(\d+)/i) || [,""])[1], uri = "";
    for (var j = i + 1; j < lines.length; j++) { var line = lines[j].trim(); if (line && line.charAt(0) !== "#") { uri = line; break; } }
    if (!uri) continue;
    var candidate = aaCandidate(aaResolve(url, uri), title, aaQuality(height), "m3u8", lang, headers, subtitles);
    if (candidate) out.push(candidate);
  }
  if (!out.length) { var c = aaCandidate(url, title, "Auto", "m3u8", lang, headers, subtitles); if (c) out.push(c); }
  return out;
}
async function aaDirectOrEmbed(url, label, lang, iframeEndpoint, subtitles) {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  var clean = url.replace(/^\/\//, "https://");
  if (/\.m3u8(?:$|[?#])/i.test(clean)) { try { return await aaHls(clean, label, lang, ALLANIME_HEADERS, subtitles); } catch (_) { return []; } }
  if (/\.(mp4|mkv|mpd)(?:$|[?#])/i.test(clean)) {
    var ext = (clean.match(/\.(mp4|mkv|mpd)(?:$|[?#])/i) || [,"mp4"])[1].toLowerCase();
    var c = aaCandidate(clean, label, "Auto", ext, lang, ALLANIME_HEADERS, subtitles); return c ? [c] : [];
  }
  try {
    var html = await (await aaFetch(clean, { headers: Object.assign({}, ALLANIME_HEADERS, { "Referer": iframeEndpoint + "/" }) }, 8500)).text();
    var urls = html.match(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\\\s<>]*)?/gi) || [], out = [];
    for (var i = 0; i < urls.length; i++) {
      var found = urls[i].replace(/\\\//g, "/").replace(/&amp;/g, "&");
      var kind = (found.match(/\.(m3u8|mp4|mpd)/i) || [,"mp4"])[1].toLowerCase();
      if (kind === "m3u8") out = out.concat(await aaHls(found, label, lang, ALLANIME_HEADERS, subtitles));
      else { var c2 = aaCandidate(found, label, "Auto", kind, lang, ALLANIME_HEADERS, subtitles); if (c2) out.push(c2); }
    }
    return out;
  } catch (_) { return []; }
}
async function aaInternal(rawPath, serverName, lang, iframeEndpoint) {
  try {
    var endpoint = iframeEndpoint.replace(/\/+$/, "");
    var data = await aaJson(endpoint + rawPath.replace("/clock?", "/clock.json?"), { headers: Object.assign({}, ALLANIME_HEADERS, { "Referer": endpoint + "/" }) }, 10000);
    var links = data && data.links || [], out = [];
    for (var i = 0; i < links.length; i++) {
      var link = links[i] || {};
      var subs = (link.subtitles || []).map(function (s) { return s && s.src && /^https:\/\//i.test(s.src) ? { url: s.src, lang: s.label || s.lang || "Unknown" } : null; }).filter(Boolean);
      if (link.mp4 && link.link) { var mp4 = aaCandidate(link.link, serverName, aaQuality(link.resolution), "mp4", lang, ALLANIME_HEADERS, subs); if (mp4) out.push(mp4); }
      else if (link.hls && link.link) out = out.concat(await aaHls(link.link, serverName, lang, ALLANIME_HEADERS, subs));
    }
    return out;
  } catch (_) { return []; }
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    var context = Object.assign({}, aaContext(), extraArgs || {});
    if (mediaType !== "anime") return [];
    var id = String(anilistId || context.anilistId || context.aniListId || "");
    var ep = Number(episode || context.episodeNumber || context.episode || 0);
    if (!/^\d+$/.test(id) || Number(id) <= 0 || !Number.isFinite(ep) || ep <= 0) return [];
    var meta = await aaAniListMeta(id, context);
    var show = await aaFindShow(meta, context);
    if (!show || !show._id) return [];
    var detail = await aaGraphql({ variables: { _id: String(show._id) }, query: "query ($_id: String!) { show(_id: $_id) { _id availableEpisodesDetail } }" });
    var available = detail && detail.data && detail.data.show && detail.data.show.availableEpisodesDetail || {};
    var audioOrder = String(context.preferredAudio || "sub").toLowerCase() === "dub" ? ["dub", "sub"] : ["sub", "dub"];
    var languages = audioOrder.filter(function (lang) { return (available[lang] || []).some(function (n) { return String(n) === String(ep); }); });
    if (!languages.length) return [];
    var iframeEndpoint = ALLANIME_IFRAME;
    try { var ver = await aaJson(ALLANIME_SITE + "/getVersion", { headers: ALLANIME_HEADERS }, 5000); if (ver && ver.episodeIframeHead) iframeEndpoint = ver.episodeIframeHead; } catch (_) {}
    var keys = await aaGetKeys();
    var aaReqToken = await aaBuildRequestToken(keys);
    var out = [];
    for (var a = 0; a < languages.length; a++) {
      var lang = languages[a], variables = { showId: String(show._id), episodeString: String(ep), translationType: lang };
      var extensions = { persistedQuery: { version: 1, sha256Hash: ALLANIME_STREAM_HASH }, aaReq: aaReqToken };
      var url = ALLANIME_API + "?variables=" + encodeURIComponent(JSON.stringify(variables)) + "&extensions=" + encodeURIComponent(JSON.stringify(extensions));
      var payload = await aaJson(url, { headers: Object.assign({}, ALLANIME_HEADERS, { "Origin": ALLANIME_SITE, "Referer": ALLANIME_SITE + "/" }) }, 12000);
      var sources = payload && payload.data && payload.data.episode && payload.data.episode.sourceUrls;
      var encrypted = payload && payload.data && payload.data.tobeparsed;
      if (!sources && encrypted) {
        var decrypted = JSON.parse(await aaDecryptPayload(encrypted));
        sources = decrypted && decrypted.episode && decrypted.episode.sourceUrls;
        if (!sources && decrypted && decrypted.data && decrypted.data.episode) sources = decrypted.data.episode.sourceUrls;
      }
      if (!Array.isArray(sources)) continue;
      for (var s = 0; s < sources.length; s++) {
        var item = sources[s] || {}, sourceUrl = aaDecryptSource(item.sourceUrl), name = String(item.sourceName || "AllAnime");
        if (!sourceUrl) continue;
        if (sourceUrl.indexOf("/apivtwo/") === 0 && ALLANIME_INTERNAL_HOSTS.some(function (h) { return name.toLowerCase().indexOf(h.toLowerCase()) >= 0; })) {
          out = out.concat(await aaInternal(sourceUrl, name + " (" + lang + ")", lang, iframeEndpoint));
        } else if (/^https?:\/\//i.test(sourceUrl)) {
          out = out.concat(await aaDirectOrEmbed(sourceUrl, name + " (" + lang + ")", lang, iframeEndpoint, []));
        }
      }
    }
    var seen = {};
    return out.filter(function (c) { if (!c || !c.url || seen[c.url]) return false; seen[c.url] = true; return true; }).map(function (c) { c.anilistId = id; c.episodeNumber = ep; return c; });
  } catch (e) { console.log("[AllAnime] " + String(e && e.message || e)); return []; }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
