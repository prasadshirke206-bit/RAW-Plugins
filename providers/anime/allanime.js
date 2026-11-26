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
  if (typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") {
    throw new Error("QuickJS WebCrypto AES-GCM is required");
  }

  var page = await (await aaFetch(ALLANIME_SITE, {
    headers: Object.assign({}, ALLANIME_HEADERS, { "Accept": "text/html,application/xhtml+xml" })
  }, 8000)).text();

  // Current MKissa publishes the crypto bootstrap object and its app entry bundle
  // under Svelte's /all/mk/_app/immutable path. Keep the older inline fields as
  // a fallback because edge caches can serve slightly different HTML snapshots.
  var configText = (page.match(/window\.__aaCrypto\s*=\s*(\{[^<;]+\})/) || [,""])[1];
  var config = {};
  if (configText) {
    try { config = JSON.parse(configText); } catch (_) { config = {}; }
  }
  var epochInline = (page.match(/"epoch"\s*:\s*(\d+)/) || [,""])[1];
  var partBInline = (page.match(/"partB"\s*:\s*"([^"]+)"/) || [,""])[1];
  var epochValue = config && config.epoch != null ? config.epoch : epochInline;
  var partBValue = config && typeof config.partB === "string" ? config.partB : partBInline;
  var appUrl = (page.match(/https:\/\/cdn\.(?:mkissa\.net|allanime\.day)\/all\/mk\/_app\/immutable\/entry\/app\.[^"' <>\r\n]+\.js/i) || [,""])[0];

  if (!epochValue || !partBValue || !appUrl) {
    throw new Error("AllAnime crypto bootstrap incomplete: epoch=" + !!epochValue +
      " partB=" + !!partBValue + " appBundle=" + !!appUrl);
  }

  var appBundle = await (await aaFetch(appUrl, {
    headers: Object.assign({}, ALLANIME_HEADERS, { "Accept": "text/javascript,*/*;q=0.8" })
  }, 8000)).text();

  var chunkMatches = appBundle.match(/\.\.\/chunks\/[^"',\]\s]+\.js/g) || [];
  var chunkPaths = chunkMatches.filter(function (value, index, all) {
    return all.indexOf(value) === index;
  }).slice(0, 8);
  if (!chunkPaths.length) throw new Error("AllAnime app entry exposed no crypto chunks");

  // Probe the small entry chunk set concurrently: sequential bundle downloads
  // previously consumed most of the provider's resolution budget.
  var chunkBodies = await Promise.all(chunkPaths.map(async function (chunkPath) {
    try {
      var chunkUrl = new URL(chunkPath, appUrl).toString();
      return await (await aaFetch(chunkUrl, {
        headers: Object.assign({}, ALLANIME_HEADERS, { "Accept": "text/javascript,*/*;q=0.8" })
      }, 6500)).text();
    } catch (_) {
      return "";
    }
  }));

  var maskHex = "";
  for (var i = 0; i < chunkBodies.length && !maskHex; i++) {
    var maskMatch = chunkBodies[i].match(/[0-9a-f]{64}/i);
    if (maskMatch) maskHex = maskMatch[0];
  }
  if (!maskHex) throw new Error("AllAnime dynamic key mask was not found in entry chunks");

  var partB = aaB64Bytes(partBValue);
  if (partB.length !== 32) throw new Error("AllAnime partB must decode to 32 bytes");
  var mask = new Uint8Array(32), key = new Uint8Array(32);
  for (var j = 0; j < 32; j++) mask[j] = parseInt(maskHex.slice(j * 2, j * 2 + 2), 16);
  for (var k = 0; k < 32; k++) key[k] = mask[k] ^ partB[k];

  ALLANIME_KEY_CACHE = { key: key, epoch: String(epochValue) };
  ALLANIME_KEY_CACHE_EXPIRES = Date.now() + 180000;
  console.log("[AllAnime] dynamic crypto bootstrap ready; epoch=" + epochValue);
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
  var original = String(value || "");
  var payload = original;
  var keyType = null;

  // Match Kotlin String.decryptSource(): --=key 3, #-=key 2,
  // ##=key 1, -=#key 4, #=key 0.
  if (payload.indexOf("--") === 0) { payload = payload.slice(2); keyType = 3; }
  else if (payload.indexOf("#-") === 0) { payload = payload.slice(2); keyType = 2; }
  else if (payload.indexOf("##") === 0) { payload = payload.slice(2); keyType = 1; }
  else if (payload.indexOf("-#") === 0) { payload = payload.slice(2); keyType = 4; }
  else if (payload.indexOf("#") === 0) { payload = payload.slice(1); keyType = 0; }

  // Kotlin parses hex in two-character chunks; an odd final nibble is valid.
  if (!/^[0-9a-fA-F]+$/.test(payload)) return original;
  var bytes = [];
  for (var i = 0; i < payload.length; i += 2) {
    var parsed = parseInt(payload.slice(i, i + 2), 16);
    if (!Number.isFinite(parsed)) return original;
    bytes.push(parsed);
  }

  function decode(mask) {
    var output = "";
    for (var j = 0; j < bytes.length; j++) output += String.fromCharCode((bytes[j] ^ mask) & 0xFF);
    return output;
  }

  var decoded = "";
  if (keyType === null) {
    // Unprefixed values try all Kotlin masks and are accepted only when they
    // produce a recognizable clock path or absolute URL.
    for (var m = 0; m < ALLANIME_XOR_MASKS.length; m++) {
      var candidate = decode(ALLANIME_XOR_MASKS[m]);
      if (candidate.indexOf("/clock") >= 0 || candidate.indexOf("http") >= 0) {
        decoded = candidate;
        break;
      }
    }
    if (!decoded) return original;
  } else {
    decoded = decode(ALLANIME_XOR_MASKS[keyType]);
  }

  // Preserve relative /apivtwo paths for the same internal-host routing used
  // by the Kotlin implementation. aaInternal() normalizes /clock? itself.
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
  var titles = (meta.titles || []).filter(Boolean).slice(0, 4);
  var searches = await Promise.all(titles.map(async function (title) {
    try {
      var result = await aaGraphql({
        variables: { search: { query: title, allowAdult: false, allowUnknown: false }, limit: 26, page: 1, translationType: "sub", countryOrigin: "ALL" },
        query: query
      });
      return result && result.data && result.data.shows && result.data.shows.edges || [];
    } catch (error) {
      console.log("[AllAnime] title search failed for alias: " + String(error && error.message || error));
      return [];
    }
  }));
  var matches = [];
  searches.forEach(function (edges) {
    var match = aaIdentityMatch(edges, meta);
    if (match && match._id && !matches.some(function (item) { return String(item._id) === String(match._id); })) matches.push(match);
  });
  return matches.length === 1 ? matches[0] : null;
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
    console.log("[AllAnime] resolve start AniList=" + id + " episode=" + ep + " aliases=" + meta.titles.length);
    var show = await aaFindShow(meta, context);
    if (!show || !show._id) {
      console.log("[AllAnime] no unique exact-title catalogue mapping for AniList=" + id);
      return [];
    }
    var detail = await aaGraphql({ variables: { _id: String(show._id) }, query: "query ($_id: String!) { show(_id: $_id) { _id availableEpisodesDetail } }" });
    var available = detail && detail.data && detail.data.show && detail.data.show.availableEpisodesDetail || {};
    var audioOrder = String(context.preferredAudio || "sub").toLowerCase() === "dub" ? ["dub", "sub"] : ["sub", "dub"];
    var languages = audioOrder.filter(function (lang) { return (available[lang] || []).some(function (n) { return String(n) === String(ep); }); });
    if (!languages.length) {
      console.log("[AllAnime] episode " + ep + " is not listed by translation type for mapped show " + show._id);
      return [];
    }
    var iframeEndpoint = ALLANIME_IFRAME;
    try { var ver = await aaJson(ALLANIME_SITE + "/getVersion", { headers: ALLANIME_HEADERS }, 5000); if (ver && ver.episodeIframeHead) iframeEndpoint = ver.episodeIframeHead; } catch (_) {}
    var keys = await aaGetKeys();
    var aaReqToken = await aaBuildRequestToken(keys);
    var languagePayloads = await Promise.all(languages.map(async function (lang) {
      var variables = { showId: String(show._id), episodeString: String(ep), translationType: lang };
      var extensions = { persistedQuery: { version: 1, sha256Hash: ALLANIME_STREAM_HASH }, aaReq: aaReqToken };
      var url = ALLANIME_API + "?variables=" + encodeURIComponent(JSON.stringify(variables)) + "&extensions=" + encodeURIComponent(JSON.stringify(extensions));
      try {
        return { lang: lang, payload: await aaJson(url, {
          headers: Object.assign({}, ALLANIME_HEADERS, { "Origin": ALLANIME_SITE, "Referer": ALLANIME_SITE + "/" })
        }, 10000) };
      } catch (error) {
        console.log("[AllAnime] " + lang + " episode request failed: " + String(error && error.message || error));
        return { lang: lang, payload: null };
      }
    }));
    var out = [];
    for (var a = 0; a < languagePayloads.length; a++) {
      var lang = languagePayloads[a].lang, payload = languagePayloads[a].payload;
      if (!payload) continue;
      var sources = payload && payload.data && payload.data.episode && payload.data.episode.sourceUrls;
      var encrypted = payload && payload.data && payload.data.tobeparsed;
      if (!sources && encrypted) {
        try {
          var decrypted = JSON.parse(await aaDecryptPayload(encrypted));
          sources = decrypted && decrypted.episode && decrypted.episode.sourceUrls;
          if (!sources && decrypted && decrypted.data && decrypted.data.episode) sources = decrypted.data.episode.sourceUrls;
        } catch (error) {
          console.log("[AllAnime] " + lang + " encrypted source payload failed: " + String(error && error.message || error));
          continue;
        }
      }
      if (!Array.isArray(sources)) {
        console.log("[AllAnime] " + lang + " episode response contained no source list");
        continue;
      }
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
    console.log("[AllAnime] resolved " + out.length + " direct candidate(s) for AniList=" + id + " episode=" + ep);
    var seen = {};
    return out.filter(function (c) { if (!c || !c.url || seen[c.url]) return false; seen[c.url] = true; return true; }).map(function (c) { c.anilistId = id; c.episodeNumber = ep; return c; });
  } catch (e) { console.log("[AllAnime] " + String(e && e.message || e)); return []; }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
