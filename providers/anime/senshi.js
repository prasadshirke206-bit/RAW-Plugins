/* Senshi — RAW QuickJS port based on the original Senshi.kt.
 * The source-specific __oct.open(remoteId) WebView flow and EM3U8v1 AES-GCM
 * playlist decryption are provided by RAW's native Android host and loopback
 * HLS proxy. No challenge, login, or CAPTCHA interaction is automated.
 */
var SENSHI_ID = "senshi";
var SENSHI_BASE = "https://senshi.to";
var SENSHI_SOURCES = "https://s.vidcloud.se/_v1/sources";
var SENSHI_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var SENSHI_GCM_KEY_B64 = "buJyEyftRpu22Tq5t6g4BFGQtbqF2c6jseF4Bfe0rvY=";
var SENSHI_GCM_PREFIX = "EM3U8v1:";

function snContext(extra) {
  var nativeArgs = (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {};
  return Object.assign({}, nativeArgs, extra || {});
}
function snNorm(value) {
  var text = String(value || "").toLowerCase();
  if (text.normalize) text = text.normalize("NFKC");
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}
function snAliases(context) {
  var values = [].concat(context.title || [], context.titles || [], context.aliases || []);
  return values.map(function (value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    return value.english || value.romaji || value.native || value.title || "";
  }).filter(Boolean).map(String).filter(function (value, index, all) {
    return all.findIndex(function (other) { return snNorm(other) === snNorm(value); }) === index;
  }).slice(0, 24);
}
function snHeaders(referer) {
  return {
    "User-Agent": SENSHI_UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": SENSHI_BASE,
    "Referer": referer || SENSHI_BASE + "/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  };
}
async function snFetch(url, init, timeoutMs) {
  var response = await fetch(url, init || {});
  if (!response || !response.ok) throw new Error("Senshi HTTP " + (response ? response.status : "network"));
  return response;
}
async function snJson(url, init) {
  return await (await snFetch(url, init, 12000)).json();
}
async function snAniListMeta(id, context) {
  var titles = snAliases(context);
  if (titles.length) return { id: String(id), titles: titles };
  var query = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native userPreferred } synonyms } }";
  var data = await snJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query: query, variables: { id: Number(id) } })
  });
  var media = data && data.data && data.data.Media;
  if (!media || String(media.id) !== String(id)) throw new Error("Senshi AniList ID mismatch");
  var metaTitles = [
    media.title && media.title.english,
    media.title && media.title.romaji,
    media.title && media.title.native,
    media.title && media.title.userPreferred
  ].concat(media.synonyms || []).filter(Boolean);
  return { id: String(media.id), titles: metaTitles };
}
async function snPostFilter(title) {
  return await snJson(SENSHI_BASE + "/anime/filter", {
    method: "POST",
    headers: Object.assign({}, snHeaders(SENSHI_BASE + "/"), { "Content-Type": "application/json" }),
    body: JSON.stringify({ page: 1, limit: 24, searchTerm: title, sortBy: "score_desc" })
  });
}
async function snFindAnime(meta) {
  var matches = {};
  for (var i = 0; i < Math.min(meta.titles.length, 8); i++) {
    var title = meta.titles[i];
    if (!title || !snNorm(title)) continue;
    var response = await snPostFilter(title);
    var rows = response && response.data;
    if (!Array.isArray(rows)) continue;
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j] || {};
      var publicId = String(row.public_id || "");
      if (!publicId) continue;
      var titles = [row.title_english, row.title].filter(Boolean);
      if (!titles.some(function (candidate) { return snNorm(candidate) === snNorm(title); })) continue;
      matches[publicId] = row;
    }
    var ids = Object.keys(matches);
    if (ids.length > 1) throw new Error("Senshi exact-title mapping is ambiguous");
    if (ids.length === 1) return matches[ids[0]];
  }
  return null;
}
function snFixUrl(value) {
  var url = String(value || "").trim();
  if (!url) return "";
  if (url.indexOf("//") === 0) url = "https:" + url;
  else if (url.charAt(0) === "/") url = SENSHI_BASE + url;
  else if (!/^https?:\/\//i.test(url)) url = SENSHI_BASE + "/" + url.replace(/^\/+/, "");
  return url
    .replace("https://img.anicdn.se", "https://cdn1.anidap.biz")
    .replace("http://img.anicdn.se", "https://cdn1.anidap.biz");
}
function snNumber(value) {
  var number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}
function snEpisodeMatches(row, episode) {
  var number = snNumber(row && (row.ep_id != null ? row.ep_id : row.episode_number));
  return Number.isFinite(number) && Math.abs(number - episode) < 0.0001;
}
async function snGetNativeSources(remoteId) {
  if (typeof globalThis.__raw_senshi_resolve === "function") {
    try {
      var result = await globalThis.__raw_senshi_resolve(SENSHI_BASE, remoteId, SENSHI_UA, 25);
      if (typeof result === "string" && result.trim()) {
        var parsed = JSON.parse(result);
        if (Array.isArray(parsed)) return parsed;
      } else if (Array.isArray(result)) {
        return result;
      }
    } catch (error) {
      console.log("[Senshi] native __oct resolver unavailable: " + String(error && error.message || error));
    }
  }
  // Same public source endpoint used by the original Kotlin implementation
  // when the native vendor runtime does not return a result.
  var fallback = await snJson(SENSHI_SOURCES + "?id=" + encodeURIComponent(String(remoteId)), {
    headers: {
      "User-Agent": SENSHI_UA,
      "Accept": "application/json, text/plain, */*",
      "Origin": SENSHI_BASE,
      "Referer": SENSHI_BASE + "/"
    }
  });
  return Array.isArray(fallback) ? fallback : [];
}
function snSourceForAudio(entry, audioBadge) {
  var source = entry && entry.source;
  if (Array.isArray(source)) {
    var preferred = audioBadge.toLowerCase() === "dub" ? "dub" : "sub";
    return source.find(function (item) { return String(item && item.label || "").toLowerCase() === preferred; }) || source[0] || null;
  }
  return source && typeof source === "object" ? source : null;
}
function snProxy(url, headers, options) {
  if (typeof globalThis.__raw_create_media_proxy !== "function") {
    throw new Error("RAW native HLS media bridge is unavailable");
  }
  return String(globalThis.__raw_create_media_proxy(url, JSON.stringify(headers), JSON.stringify(options)));
}
async function snResolveRemote(remoteId, audioBadge, anilistId, episode, preferredQuality) {
  var sources = await snGetNativeSources(remoteId);
  if (!Array.isArray(sources)) return [];
  var out = [];
  var streamHeaders = {
    "User-Agent": SENSHI_UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Origin": SENSHI_BASE,
    "Referer": SENSHI_BASE + "/"
  };
  for (var i = 0; i < sources.length; i++) {
    var entry = sources[i] || {};
    var selected = snSourceForAudio(entry, audioBadge);
    if (!selected) continue;
    var masterUrl = snFixUrl(selected.src || selected.file || "");
    if (!/^https:\/\//i.test(masterUrl)) continue;
    var subtitles = [];
    var tracks = Array.isArray(entry.tracks) ? entry.tracks : [];
    for (var t = 0; t < tracks.length; t++) {
      var track = tracks[t] || {};
      var label = String(track.label || "").trim();
      if (!label || label.toLowerCase() === "chapter") continue;
      var trackUrl = snFixUrl(track.vtt_url || track.url || "");
      if (!/^https:\/\//i.test(trackUrl)) continue;
      try {
        var subtitleProxy = snProxy(trackUrl, streamHeaders, {
          rewriteManifests: false,
          sessionTtlMillis: 7200000
        });
        subtitles.push({ url: subtitleProxy, lang: label, format: "vtt" });
      } catch (error) {
        console.log("[Senshi] subtitle proxy failed: " + String(error && error.message || error));
      }
    }
    try {
      var playlistProxy = snProxy(masterUrl, streamHeaders, {
        rewriteManifests: true,
        aesGcmHlsKeyBase64: SENSHI_GCM_KEY_B64,
        aesGcmEnvelopePrefix: SENSHI_GCM_PREFIX,
        forceSegmentContentType: true,
        sessionTtlMillis: 7200000
      });
      var declared = String(selected.quality || "Auto").trim() || "Auto";
      var candidate = {
        title: "Senshi " + declared + " [" + audioBadge + "]",
        name: "Senshi " + declared,
        url: playlistProxy,
        type: "m3u8",
        quality: "Auto",
        provider: SENSHI_ID,
        headers: streamHeaders,
        subtitles: subtitles,
        anilistId: String(anilistId),
        episodeNumber: Number(episode)
      };
      if (preferredQuality === "auto" || declared.toLowerCase().indexOf(preferredQuality) >= 0) {
        out.unshift(candidate);
      } else {
        out.push(candidate);
      }
    } catch (error) {
      console.log("[Senshi] playlist proxy failed: " + String(error && error.message || error));
    }
  }
  return out;
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    if (mediaType !== "anime") return [];
    var id = String(anilistId || "");
    var ep = snNumber(episode || (extraArgs && extraArgs.episodeNumber));
    if (!/^[1-9]\d*$/.test(id) || !Number.isFinite(ep) || ep <= 0) return [];
    var context = snContext(extraArgs);
    var meta = await snAniListMeta(id, context);
    var match = await snFindAnime(meta);
    if (!match || !match.public_id) return [];

    var detail = await snJson(SENSHI_BASE + "/anime/" + encodeURIComponent(String(match.public_id)), {
      headers: snHeaders(SENSHI_BASE + "/anime/" + encodeURIComponent(String(match.public_id)))
    });
    var numericId = String(detail && detail.id || "");
    if (!/^[1-9]\d*$/.test(numericId)) return [];

    var episodes = await snJson(SENSHI_BASE + "/episodes/" + encodeURIComponent(numericId), {
      headers: snHeaders(SENSHI_BASE + "/anime/" + numericId)
    });
    if (!Array.isArray(episodes) || !episodes.some(function (row) { return snEpisodeMatches(row, ep); })) {
      console.log("[Senshi] exact episode " + ep + " is not listed for AniList " + id);
      return [];
    }

    var s = Number(season || context.season || 1);
    if (!Number.isFinite(s) || s < 1) s = 1;
    var episodeId = s <= 1 ? Math.trunc(ep) : (Math.trunc(s) - 1) * 100 + Math.trunc(ep);
    var embeds = await snJson(SENSHI_BASE + "/episode-embeds/" + encodeURIComponent(numericId) + "/" + episodeId, {
      headers: snHeaders(SENSHI_BASE + "/anime/" + numericId)
    });
    if (!Array.isArray(embeds)) return [];

    var candidates = [];
    for (var i = 0; i < embeds.length; i++) {
      var embed = embeds[i] || {};
      var remoteId = Number(embed.remote_source_id);
      if (!Number.isSafeInteger(remoteId) || remoteId <= 0) continue;
      var audioBadge = String(embed.status || "HardSub").toLowerCase() === "dub" ? "Dub" : "Sub";
      var resolved = await snResolveRemote(remoteId, audioBadge, id, ep, String(context.preferredQuality || "auto").toLowerCase());
      candidates.push.apply(candidates, resolved);
    }
    return candidates;
  } catch (error) {
    console.log("[Senshi] resolve failed: " + String(error && error.message || error));
    return [];
  }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams,
    __test: {
      normalizeTitle: snNorm,
      fixUrl: snFixUrl,
      episodeMatches: snEpisodeMatches,
      sourceForAudio: snSourceForAudio,
      keyBase64: SENSHI_GCM_KEY_B64
    }
  };
}
