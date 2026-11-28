/*
 * AniLight — RAW QuickJS anime provider ported from the original Kotlin source.
 * Uses its AniList-backed API and the episode's public MegaPlay embed.
 * Non-MegaPlay routes requiring a WebView/Turnstile session are not emulated
 * or bypassed by this QuickJS plugin.
 */
var ANILIGHT_ID = "anilight";
var ANILIGHT_SITE = "https://anilight.live";
var ANILIGHT_API = "https://api.anilight.live/api";
var ANILIGHT_MEGA_KEY = "i?LMTAx0Q6,:}50U";
var ANILIGHT_MEGA_IV = "W0;27ToaUpl_P%'c";
var ANILIGHT_HEADERS = { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Accept": "application/json, text/plain, */*", "Referer": ANILIGHT_SITE + "/", "Origin": ANILIGHT_SITE };
function alContext() { return (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {}; }
function alTimeout(p, ms) { var timer; return Promise.race([p, new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("AniLight timeout")); }, ms || 10000); })]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; }); }
async function alFetch(url, options, ms) { var res = await alTimeout(fetch(url, options || {}), ms || 10000); if (!res || !res.ok) throw new Error("AniLight HTTP " + (res ? res.status : "network")); return res; }
async function alJson(url, options, ms) { return await (await alFetch(url, options, ms)).json(); }
function alNorm(s) { var x = String(s || "").toLowerCase(); if (x.normalize) x = x.normalize("NFKC"); return x.replace(/[^a-z0-9]+/g, " ").trim(); }
async function alAniList(id, context) {
  var aliases = [].concat(context.title || [], context.titles || [], context.aliases || []);
  if (aliases.length) return { id: String(id), titles: aliases.map(function (x) { return typeof x === "string" ? x : (x && (x.english || x.romaji || x.native)) || ""; }).filter(Boolean) };
  var q = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native userPreferred } synonyms } }";
  var res = await alJson("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ query: q, variables: { id: Number(id) } }) }, 12000);
  var m = res && res.data && res.data.Media; if (!m || String(m.id) !== String(id)) throw new Error("AniList ID mismatch");
  return { id: String(m.id), titles: [m.title && m.title.english, m.title && m.title.romaji, m.title && m.title.native, m.title && m.title.userPreferred].concat(m.synonyms || []).filter(Boolean) };
}
function alExactItem(items, meta) {
  var names = {}; (meta.titles || []).forEach(function (x) { names[alNorm(x)] = true; });
  var matches = (items || []).filter(function (item) { var t = item && item.title || {}; return String(item && item.anilistId || "") === String(meta.id) || [t.english, t.romaji, t.native].some(function (x) { return !!names[alNorm(x)]; }); });
  var ids = matches.filter(function (x) { return String(x.anilistId || "") === String(meta.id); });
  if (ids.length === 1) return ids[0]; if (ids.length > 1) return null; return matches.length === 1 ? matches[0] : null;
}
function alCandidate(url, label, quality, type, lang, headers, subtitles) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return { name: "AniLight | " + label, title: label, url: url, quality: quality || "Auto", type: type || "m3u8", provider: ANILIGHT_ID, language: lang || undefined, headers: headers || ANILIGHT_HEADERS, subtitles: subtitles || [] };
}
function alQuality(h) { var n = Number(h || 0); if (n >= 2160) return "2160p"; if (n >= 1440) return "1440p"; if (n >= 1080) return "1080p"; if (n >= 720) return "720p"; if (n >= 480) return "480p"; if (n >= 360) return "360p"; if (n >= 240) return "240p"; if (n >= 144) return "144p"; return "Auto"; }
function alAbs(base, value) { try { return new URL(value, base).toString(); } catch (_) { return value; } }
var ANILIGHT_MEGA_BASE = "https://megaplay.buzz";
var ANILIGHT_MEGA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
function alB64Bytes(value) {
  var normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  normalized += "=".repeat((4 - normalized.length % 4) % 4);
  var raw = atob(normalized), bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
function alMegaKeyBytes(value) {
  var bytes = new Uint8Array(32);
  var encoded = new TextEncoder().encode(String(value || ""));
  bytes.set(encoded.slice(0, 32));
  return bytes;
}
async function alDecryptMegaOnce(enc, keyMaterial, ivMaterial) {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined" || typeof TextDecoder === "undefined") return "";
    var key = await crypto.subtle.importKey("raw", alMegaKeyBytes(keyMaterial), { name: "AES-CBC" }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: new TextEncoder().encode(String(ivMaterial || "")) },
      key,
      alB64Bytes(enc)
    );
    var data = JSON.parse(new TextDecoder().decode(plain));
    return data && typeof data.file === "string" ? data.file : "";
  } catch (_) {
    return "";
  }
}
async function alRefreshMegaKeyMaterial() {
  try {
    var js = await (await alFetch(ANILIGHT_MEGA_BASE + "/lib/newclient.min.js", {
      headers: {
        "User-Agent": ANILIGHT_MEGA_UA,
        "Referer": ANILIGHT_SITE + "/"
      }
    }, 10000)).text();
    var keyMatch = js.match(/\[\s*["']trustAesKey["']\s*,\s*["']TRUST_AES_KEY["']\s*\]\s*,\s*(?:"([^"]*)"|'([^']*)')/);
    var ivMatch = js.match(/\[\s*["']trustAesIv["']\s*,\s*["']TRUST_AES_IV["']\s*\]\s*,\s*(?:"([^"]*)"|'([^']*)')/);
    if (keyMatch) ANILIGHT_MEGA_KEY = keyMatch[1] || keyMatch[2] || ANILIGHT_MEGA_KEY;
    if (ivMatch) {
      var nextIv = ivMatch[1] || ivMatch[2] || "";
      if (new TextEncoder().encode(nextIv).length === 16) ANILIGHT_MEGA_IV = nextIv;
    }
  } catch (error) {
    console.log("[AniLight] MegaPlay key refresh failed: " + String(error && error.message || error));
  }
}
async function alDecryptMega(enc) {
  if (!enc) return "";
  var file = await alDecryptMegaOnce(enc, ANILIGHT_MEGA_KEY, ANILIGHT_MEGA_IV);
  if (file) return file;
  await alRefreshMegaKeyMaterial();
  return await alDecryptMegaOnce(enc, ANILIGHT_MEGA_KEY, ANILIGHT_MEGA_IV);
}
async function alHls(url, audioBadge, lang, headers, subtitles) {
  var body = "";
  try { body = await (await alFetch(url, { headers: headers }, 10000)).text(); }
  catch (error) { console.log("[AniLight] MegaPlay playlist inspection failed: " + String(error && error.message || error)); }
  if (body.indexOf("#EXTM3U") < 0) {
    var fallback = alCandidate(url, "Auto " + audioBadge, "Auto", "m3u8", lang, headers, subtitles);
    return fallback ? [fallback] : [];
  }
  if (body.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") >= 0) {
    var master = alCandidate(url, "Auto " + audioBadge, "Auto", "m3u8", lang, headers, subtitles);
    return master ? [master] : [];
  }
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var h = (lines[i].match(/RESOLUTION=\d+x(\d+)/i) || [, ""])[1], next = "";
    for (var j = i + 1; j < lines.length; j++) { var line = lines[j].trim(); if (line && line.charAt(0) !== "#") { next = line; break; } }
    if (!next) continue;
    var q = alQuality(h);
    var c = alCandidate(alAbs(url, next), q + " " + audioBadge, q, "m3u8", lang, headers, subtitles);
    if (c) out.push(c);
  }
  if (!out.length) { var c0 = alCandidate(url, "Auto " + audioBadge, "Auto", "m3u8", lang, headers, subtitles); if (c0) out.push(c0); }
  return out;
}
async function alMegaPlay(embedUrl, lang, label) {
  var pageHeaders = {
    "User-Agent": ANILIGHT_MEGA_UA,
    "Referer": ANILIGHT_SITE + "/"
  };
  var embedHeaders = {
    "User-Agent": ANILIGHT_MEGA_UA,
    "Referer": ANILIGHT_MEGA_BASE + "/"
  };
  var html = await (await alFetch(embedUrl, { headers: pageHeaders }, 10000)).text();
  var match = html.match(/data-id=["']([^"']+)["']/i) || html.match(/data-id=([^\s>]+)/i);
  if (!match) return [];
  var mediaId = match[1];
  var sources = await alJson(
    ANILIGHT_MEGA_BASE + "/stream/getSources?id=" + encodeURIComponent(mediaId) + "&id=" + encodeURIComponent(mediaId),
    { headers: embedHeaders },
    10000
  );
  var file = sources && sources.sources && sources.sources.file;
  if (!file && sources && sources.enc) file = await alDecryptMega(sources.enc);
  if (!file || !/^https:\/\//i.test(file)) return [];
  var tracks = (sources.tracks || []).map(function (track) {
    if (!track || !track.file || String(track.kind || "").toLowerCase() === "thumbnails" || !/^https:\/\//i.test(track.file)) return null;
    return { url: track.file, lang: track.label || "English" };
  }).filter(Boolean);
  var audioBadge = lang === "dub" ? "[Dub]" : (tracks.length ? "[Soft Sub]" : "[Sub]");
  return await alHls(file, audioBadge, lang, embedHeaders, tracks);
}
async function alNativeWatchPlayer(watchUrl, lang, label, id, ep, providerId) {
  try {
    var host = typeof globalThis !== "undefined" ? globalThis.RAW_HOST : null;
    if (!host || typeof host.resolveAnimeEmbed !== "function") return [];
    var resolved = await host.resolveAnimeEmbed({
      provider: ANILIGHT_ID,
      providerServer: String(providerId || "").toLowerCase(),
      proxyProfile: ["l", "raye"].indexOf(String(providerId || "").toLowerCase()) >= 0 ? "anilight-interleaved-ts" : "",
      anilistId: String(id),
      episodeNumber: Number(ep),
      embedUrl: watchUrl,
      pageUrl: ANILIGHT_SITE + "/",
      headers: ANILIGHT_HEADERS,
      timeoutMs: 3500
    });
    if (!resolved || resolved.status !== "resolved" ||
        String(resolved.anilistId) !== String(id) ||
        Number(resolved.episodeNumber) !== Number(ep)) return [];
    var subtitles = Array.isArray(resolved.subtitles) ? resolved.subtitles : [];
    var streams = Array.isArray(resolved.streams) ? resolved.streams : [];
    return streams.map(function (stream) {
      if (!stream || !stream.url) return null;
      var protocol = String(stream.protocol || "").toLowerCase();
      var type = protocol === "hls" ? "m3u8" : (protocol === "dash" ? "mpd" : "mp4");
      var url = String(stream.url);
      // Local URLs are accepted only when returned by RAW's native bridge;
      // the Android candidate policy independently verifies relay ownership.
      if (!/^https:\/\//i.test(url) && !/^http:\/\/127\.0\.0\.1:\d+\/hls\/[a-f0-9]+/i.test(url)) return null;
      return {
        name: "AniLight | " + label,
        title: label,
        url: url,
        quality: "Auto",
        type: type,
        provider: ANILIGHT_ID,
        language: lang,
        headers: stream.headers || {},
        subtitles: subtitles,
        anilistId: String(id),
        episodeNumber: Number(ep)
      };
    }).filter(Boolean);
  } catch (error) {
    console.log("[AniLight] RAW native WebView resolver failed: " + String(error && error.message || error));
    return [];
  }
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    var context = Object.assign({}, alContext(), extraArgs || {});
    if (mediaType !== "anime") return [];
    var id = String(anilistId || context.anilistId || context.aniListId || ""), ep = Number(episode || context.episodeNumber || context.episode || 0);
    if (!/^\d+$/.test(id) || Number(id) <= 0 || !Number.isFinite(ep) || ep <= 0) return [];
    var meta = await alAniList(id, context), mapped = context.providerMappings && context.providerMappings.anilight, match = null;
    if (mapped) { var slug = typeof mapped === "object" ? mapped.slug || mapped.id : mapped; if (slug) match = { slug: String(slug), anilistId: id }; }
    if (!match) {
      // Search the best AniList aliases concurrently rather than serially.
      var titleResults = await Promise.all(meta.titles.slice(0, 4).map(async function (title) {
        try {
          var list = await alJson(ANILIGHT_API + "/filter?page=1&search=" + encodeURIComponent(title) + "&sort=POPULARITY_DESC",
            { headers: ANILIGHT_HEADERS }, 6500);
          return alExactItem(list && list.media || [], meta);
        } catch (error) {
          console.log("[AniLight] title search failed: " + String(error && error.message || error));
          return null;
        }
      }));
      var uniqueMatches = titleResults.filter(Boolean).filter(function (item, index, all) {
        var slug = String(item.slug || item.id || "");
        return all.findIndex(function (other) { return String(other.slug || other.id || "") === slug; }) === index;
      });
      if (uniqueMatches.length === 1) match = uniqueMatches[0];
    }
    if (!match || !match.slug) return [];
    var watch = await alJson(ANILIGHT_API + "/watch/" + encodeURIComponent(match.slug), { headers: ANILIGHT_HEADERS }, 10000);
    var episodes = watch && watch.episodes || [], epItem = episodes.find(function (x) { return Number(x.number) === ep; });
    if (!epItem) return [];
    var preference = String(context.preferredAudio || "sub").toLowerCase(), types = preference === "dub" ? ["dub", "sub"] : ["sub", "dub"], out = [];
    var audioResults = await Promise.all(types.map(async function (lang) {
      var embed = epItem.embed_url && epItem.embed_url[lang];
      if (!embed) return [];
      try { return await alMegaPlay(embed, lang, "Episode " + ep); }
      catch (error) {
        console.log("[AniLight] " + lang + " MegaPlay source failed: " + String(error && error.message || error));
        return [];
      }
    }));
    audioResults.forEach(function (items) { out = out.concat(items || []); });

    // Kotlin's non-MegaPlay path reads serversNew and opens the provider's own
    // watch player (?server=<id>&lang=<sub|dub>) in WebViewStreamResolver.
    // RAW implements that same browser-session capture natively; no Turnstile or
    // Cloudflare token is synthesized or bypassed by this plugin.
    if (!out.length) {
      var roster = null;
      try {
        roster = await alJson(
          ANILIGHT_API + "/watch/" + encodeURIComponent(match.slug) + "/serversNew",
          { headers: ANILIGHT_HEADERS },
          6000
        );
      } catch (rosterError) {
        console.log("[AniLight] serversNew unavailable; using original Kotlin fallback roster");
      }
      var episodeKey = String(epItem.number == null ? ep : epItem.number);
      var episodeRoster = roster && roster[episodeKey];
      if (!episodeRoster && roster) {
        var rosterKeys = Object.keys(roster);
        for (var rk = 0; rk < rosterKeys.length; rk++) {
          if (Number(rosterKeys[rk]) === Number(episodeKey)) {
            episodeRoster = roster[rosterKeys[rk]];
            break;
          }
        }
      }
      var fallbackRoster = {
        sub: ["l", "mello", "misa", "raye"],
        hardsub: ["light", "near", "ryu"],
        dub: ["l", "light", "misa", "near", "ryu"]
      };
      if (!episodeRoster || !Object.keys(episodeRoster).length) episodeRoster = fallbackRoster;
      var providerMap = {};
      function addProviders(list, audioType) {
        (Array.isArray(list) ? list : []).forEach(function (providerId) {
          var key = String(providerId || "").toLowerCase();
          if (!key || key.indexOf("yuki") >= 0 || key.indexOf("vee") >= 0) return;
          if (!providerMap[key]) providerMap[key] = [];
          if (providerMap[key].indexOf(audioType) < 0) providerMap[key].push(audioType);
        });
      }
      addProviders(episodeRoster.sub, "sub");
      addProviders(episodeRoster.hardsub, "sub");
      addProviders(episodeRoster.dub, "dub");
      var providerIds = Object.keys(providerMap);
      var nativeAttempts = 0;
      var nativeDeadline = Date.now() + 4500;
      for (var pi = 0; pi < providerIds.length && nativeAttempts < 2 && !out.length; pi++) {
        var providerId = providerIds[pi];
        var providerTypes = providerMap[providerId];
        var orderedTypes = types.filter(function (kind) {
          return providerTypes.indexOf(kind) >= 0;
        });
        for (var ti = 0; ti < orderedTypes.length && nativeAttempts < 2 && !out.length; ti++) {
          var lang = orderedTypes[ti] === "dub" ? "dub" : "sub";
          var remaining = nativeDeadline - Date.now();
          if (remaining < 700) break;
          nativeAttempts++;
          var watchUrl = ANILIGHT_SITE + "/watch/" + encodeURIComponent(match.slug) +
            "?ep=" + encodeURIComponent(episodeKey) +
            "&server=" + encodeURIComponent(providerId) +
            "&lang=" + lang;
          var browserStreams = await alNativeWatchPlayer(
            watchUrl,
            lang,
            "Episode " + ep + " · " + providerId + (lang === "dub" ? " [Dub]" : " [Sub]"),
            id,
            ep,
            providerId
          );
          if (browserStreams.length) out = out.concat(browserStreams);
        }
      }
    }
    var seen = {}; return out.filter(function (c) { if (!c || !c.url || seen[c.url]) return false; seen[c.url] = true; return true; }).map(function (c) { c.anilistId = id; c.episodeNumber = ep; return c; });
  } catch (e) { console.log("[AniLight] " + String(e && e.message || e)); return []; }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
