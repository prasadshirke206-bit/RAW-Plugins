/* Re:ANIME — RAW QuickJS port derived from ReAnime.kt and FlixProxyServer.kt.
 * Mirrors AniList ID mapping, exact episode/server discovery, FlixCloud embed JSON5
 * parsing and enc-dec token/stream requests. RAW's native HLS proxy wraps the
 * FlixCloud manifest, inherits CDN tokens, strips PNG/WebP wrappers and applies
 * the provider's repeating XOR mask. No site verification is bypassed.
 */
var REANIME_ID = "rean ime".replace(" ", "");
var REANIME_BASES = ["https://reanime.to", "https://reanime.cz"];
var REANIME_DEFAULT_BASE = "https://reanime.to";
var REANIME_FLIX = "https://flixcloud.cc";
var REANIME_DEC = "https://enc-dec.app/api";
var REANIME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var REANIME_FALLBACK_MASK = [157, 42, 241, 71, 179, 142, 92, 112, 166, 25, 228, 59, 216, 98, 15, 197];

function raContext(extra) {
  return Object.assign(
    {},
    (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {},
    extra || {}
  );
}
function raNorm(value) {
  var text = String(value || "").toLowerCase();
  if (text.normalize) text = text.normalize("NFKC");
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}
function raAliases(context) {
  var values = [].concat(context.title || [], context.titles || [], context.aliases || [], context.synonyms || []);
  return values.map(function (value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    return value.english || value.romaji || value.native || value.title || "";
  }).filter(Boolean).map(String).filter(function (value, index, all) {
    return all.findIndex(function (other) { return raNorm(other) === raNorm(value); }) === index;
  }).slice(0, 32);
}
function raBase(context) {
  var preferred = String(context.preferredDomain || context.domain || REANIME_DEFAULT_BASE).replace(/\/+$/, "");
  return REANIME_BASES.indexOf(preferred) >= 0 ? preferred : REANIME_DEFAULT_BASE;
}
function raApiHeaders(base, referer) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": referer || base + "/home",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  };
}
function raFlixHeaders() {
  return {
    "User-Agent": REANIME_UA,
    "Accept": "*/*",
    "Origin": REANIME_FLIX,
    "Referer": REANIME_FLIX + "/"
  };
}
async function raFetch(url, init) {
  var response = await fetch(url, init || {});
  if (!response || !response.ok) throw new Error("ReAnime HTTP " + (response ? response.status : "network"));
  return response;
}
async function raJson(url, init) {
  return await (await raFetch(url, init)).json();
}
function raExactTitle(row, target) {
  var title = row && row.title || {};
  return [
    title.english, title.romaji, title.native,
    row && row.name, row && row.english_title
  ].filter(Boolean).some(function (value) { return raNorm(value) === raNorm(target); });
}
async function raAniListMeta(id, context) {
  var titles = raAliases(context);
  if (titles.length) return { id: String(id), titles: titles };
  var query = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native userPreferred } synonyms } }";
  var response = await raJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query: query, variables: { id: Number(id) } })
  });
  var media = response && response.data && response.data.Media;
  if (!media || String(media.id) !== String(id)) throw new Error("ReAnime AniList ID mismatch");
  return {
    id: String(media.id),
    titles: [
      media.title && media.title.english,
      media.title && media.title.romaji,
      media.title && media.title.native,
      media.title && media.title.userPreferred
    ].concat(media.synonyms || []).filter(Boolean)
  };
}
async function raSearch(base, meta) {
  for (var t = 0; t < Math.min(meta.titles.length, 12); t++) {
    var query = meta.titles[t];
    if (!query || !raNorm(query)) continue;
    for (var page = 1; page <= 3; page++) {
      var url = base + "/api/v1/search?limit=36&offset=" + ((page - 1) * 36) + "&q=" + encodeURIComponent(query);
      var data = await raJson(url, { headers: raApiHeaders(base, base + "/search") });
      var rows = data && data.results;
      if (!Array.isArray(rows)) break;
      var matches = rows.filter(function (row) { return raExactTitle(row, query) && row.anime_id; });
      var ids = matches.map(function (row) { return String(row.anime_id); }).filter(function (v, i, all) { return all.indexOf(v) === i; });
      if (ids.length > 1) throw new Error("ReAnime exact title maps to multiple site IDs");
      if (ids.length === 1) return matches.find(function (row) { return String(row.anime_id) === ids[0]; });
      if ((Number(data.offset || 0) + Number(data.limit || 0)) >= Number(data.total || 0)) break;
    }
  }
  return null;
}
function raEpisodeNumber(row) {
  var number = Number(row && row.episode_number);
  return Number.isFinite(number) ? number : NaN;
}
function raExactEpisode(rows, episode) {
  if (!Array.isArray(rows)) return null;
  var matches = rows.filter(function (row) {
    var number = raEpisodeNumber(row);
    return Number.isFinite(number) && Math.abs(number - episode) < 0.0001;
  });
  return matches.length === 1 ? matches[0] : null;
}
function raJson5ToJson(source) {
  return String(source)
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/:\s*undefined\b/g, ":null");
}
function raFindEmbedData(html) {
  var match = String(html || "").match(/type:\s*"data",\s*data:\s*(\{[\s\S]*?\}),?\s*uses:/);
  if (!match) throw new Error("ReAnime FlixCloud embed data is missing");
  var json = raJson5ToJson(match[1]);
  var data = JSON.parse(json);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid ReAnime embed data");
  return data;
}
function raMaskToBase64(mask) {
  var binary = "";
  for (var i = 0; i < mask.length; i++) binary += String.fromCharCode(mask[i] & 255);
  return btoa(binary);
}
async function raXorMask(embedHtml, dataLink) {
  var scriptPath = (String(embedHtml || "").match(/href=["']([^"']*hls\.js[^"']*)["']/i) || [,""])[1];
  if (scriptPath) {
    var scriptUrl = /^https?:\/\//i.test(scriptPath) ? scriptPath : REANIME_FLIX + (scriptPath.charAt(0) === "/" ? "" : "/") + scriptPath;
    try {
      var script = await (await raFetch(scriptUrl, { headers: raFlixHeaders() })).text();
      var found = script.match(/for\s*\(\s*var\s+f\s*=\s*\[(\d{1,3}(?:\s*,\s*\d{1,3}){15})\]/);
      if (found) {
        var mask = found[1].split(",").map(function (value) { return Number(value.trim()); });
        if (mask.length === 16 && mask.every(function (value) { return Number.isInteger(value) && value >= 0 && value <= 255; })) return mask;
      }
    } catch (error) {
      console.log("[ReAnime] dynamic XOR mask fetch failed: " + String(error && error.message || error));
    }
  }
  return REANIME_FALLBACK_MASK.slice();
}
function raMediaProxy(url, headers, options) {
  if (typeof globalThis.__raw_create_media_proxy !== "function") throw new Error("RAW native media proxy is unavailable");
  return String(globalThis.__raw_create_media_proxy(url, JSON.stringify(headers || {}), JSON.stringify(options || {})));
}
function raSubtitles(embedData) {
  var rows = Array.isArray(embedData && embedData.subtitles) ? embedData.subtitles : [];
  return rows.map(function (track) {
    var url = String(track && track.url || "").trim();
    var language = String(track && track.language || "Unknown").trim();
    if (!/^https:\/\//i.test(url)) return null;
    return { url: url, lang: language || "Unknown", format: "vtt" };
  }).filter(Boolean);
}
async function raResolveServer(server, base, anilistId, episode, context) {
  var dataLink = String(server && server.dataLink || "").trim();
  if (!/^https:\/\//i.test(dataLink)) return null;
  var embedHtml = await (await raFetch(dataLink, { headers: raFlixHeaders() })).text();
  var xorMask = await raXorMask(embedHtml, dataLink);
  var embedData = raFindEmbedData(embedHtml);
  var subtitles = raSubtitles(embedData);
  // Kotlin removes subtitle and chapter metadata before submitting FlixCloud's
  // token request; preserve the source JSON fields and change only those keys.
  var tokenData = Object.assign({}, embedData);
  delete tokenData.subtitles;
  delete tokenData.intro_chapter;
  delete tokenData.outro_chapter;

  var tokenResponse = await raJson(REANIME_DEC + "/dec-flixcloud?type=token", {
    method: "POST",
    headers: { "Accept": "*/*", "Content-Type": "application/json" },
    body: JSON.stringify({ data: tokenData })
  });
  if (!tokenResponse || Number(tokenResponse.status) !== 200 || !tokenResponse.result || !tokenResponse.result.token) return null;

  var token = String(tokenResponse.result.token);
  var encryptedStream = await raJson(REANIME_FLIX + "/api/m3u8/" + encodeURIComponent(token), {
    headers: raFlixHeaders()
  });
  if (!encryptedStream || typeof encryptedStream !== "object") return null;

  var streamResponse = await raJson(REANIME_DEC + "/dec-flixcloud?type=stream", {
    method: "POST",
    headers: { "Accept": "*/*", "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        context: tokenResponse.result.context || {},
        stream_response: encryptedStream
      }
    })
  });
  if (!streamResponse || Number(streamResponse.status) !== 200 || !streamResponse.result) return null;
  var streamUrl = String(streamResponse.result.stream || "");
  var wPayload = streamResponse.result.context && streamResponse.result.context.w_payload;
  if (!/^https:\/\//i.test(streamUrl) || !wPayload) return null;

  var proxyHeaders = raFlixHeaders();
  var manifestProxy = raMediaProxy(streamUrl, proxyHeaders, {
    rewriteManifests: true,
    stripMode: "png-webp",
    xorMaskBase64: raMaskToBase64(xorMask),
    xorOnlyWhenStripped: true,
    manifestWrapperEndpoint: REANIME_DEC + "/parse-flixcloud",
    manifestWrapperPayload: String(wPayload),
    manifestWrapperHeaders: {
      "Origin": "https://enc-dec.app",
      "Referer": "https://enc-dec.app/"
    },
    inheritQueryParameters: ["token"],
    forceSegmentContentType: true,
    sessionTtlMillis: 7200000
  });

  var subtitleTracks = [];
  for (var i = 0; i < subtitles.length; i++) {
    try {
      subtitleTracks.push({
        url: raMediaProxy(subtitles[i].url, {
          "User-Agent": REANIME_UA,
          "Accept": "*/*",
          "Origin": REANIME_FLIX,
          "Referer": REANIME_FLIX + "/"
        }, { rewriteManifests: false, sessionTtlMillis: 7200000 }),
        lang: subtitles[i].lang,
        format: "vtt"
      });
    } catch (error) {
      console.log("[ReAnime] subtitle proxy failed: " + String(error && error.message || error));
    }
  }
  var serverName = String(server.serverName || "Server");
  return {
    title: "ReAnime - " + serverName,
    name: "ReAnime " + serverName,
    url: manifestProxy,
    type: "m3u8",
    quality: "Auto",
    provider: REANIME_ID,
    headers: {},
    subtitles: subtitleTracks,
    anilistId: String(anilistId),
    episodeNumber: Number(episode)
  };
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    if (mediaType !== "anime") return [];
    var id = String(anilistId || "");
    var ep = Number(episode || (extraArgs && extraArgs.episodeNumber));
    if (!/^[1-9]\d*$/.test(id) || !Number.isFinite(ep) || ep <= 0) return [];
    var context = raContext(extraArgs);
    var base = raBase(context);
    var meta = await raAniListMeta(id, context);
    var mapped = await raSearch(base, meta);
    if (!mapped || !mapped.anime_id) return [];
    var slug = String(mapped.anime_id);

    var detail = await raJson(base + "/api/v1/anime/" + encodeURIComponent(slug), {
      headers: raApiHeaders(base, base + "/anime/" + encodeURIComponent(slug))
    });
    if (String(detail && detail.anilist_id || "") !== id) {
      console.log("[ReAnime] site metadata AniList ID did not match the selected title");
      return [];
    }

    var episodeResponse = await raJson(base + "/api/v1/anime/" + encodeURIComponent(slug) + "/episodes?limit=2000", {
      headers: raApiHeaders(base, base + "/anime/" + encodeURIComponent(slug))
    });
    var episode = raExactEpisode(episodeResponse && episodeResponse.data, ep);
    if (!episode) {
      console.log("[ReAnime] exact episode " + ep + " is absent from the site episode list");
      return [];
    }
    var episodeId = String(episode.episodeId || ("ep-" + Math.trunc(ep)));
    var episodeNumber = episodeId.replace(/^ep-/, "");
    if (!/^\d+(?:\.\d+)?$/.test(episodeNumber)) return [];

    var serverResponse = await raJson(base + "/api/flix/" + encodeURIComponent(id) + "/" + encodeURIComponent(episodeNumber), {
      headers: raApiHeaders(base, base + "/watch/" + slug + "?ep=" + encodeURIComponent(episodeNumber))
    });
    if (!serverResponse || serverResponse.success !== true || !Array.isArray(serverResponse.servers)) return [];

    var servers = serverResponse.servers.filter(function (server) { return server && server.dataLink; });
    var preferredServer = String(context.preferredServer || "HD-1").toLowerCase();
    servers.sort(function (left, right) {
      return Number(String(right.serverName || "").toLowerCase().indexOf(preferredServer) >= 0) -
        Number(String(left.serverName || "").toLowerCase().indexOf(preferredServer) >= 0);
    });
    var unique = {};
    servers = servers.filter(function (server) {
      var key = String(server.dataLink);
      if (unique[key]) return false;
      unique[key] = true;
      return true;
    }).slice(0, 8);

    var resolved = await Promise.all(servers.map(async function (server) {
      try { return await raResolveServer(server, base, id, ep, context); }
      catch (error) {
        console.log("[ReAnime] server " + String(server.serverName || "Server") + " failed: " + String(error && error.message || error));
        return null;
      }
    }));
    return resolved.filter(Boolean);
  } catch (error) {
    console.log("[ReAnime] resolve failed: " + String(error && error.message || error));
    return [];
  }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams,
    __test: {
      normalizeTitle: raNorm,
      json5ToJson: raJson5ToJson,
      findEmbedData: raFindEmbedData,
      maskToBase64: raMaskToBase64,
      fallbackMask: REANIME_FALLBACK_MASK.slice()
    }
  };
}
