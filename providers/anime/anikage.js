/*
 * Anikage — RAW QuickJS anime provider ported from the original Kotlin source.
 * Preserves browse/detail/episode/server/source flow, server ordering, proxy
 * token semantics, HLS qualities and subtitles. It skips known hosts which
 * require the native local HLS relay because QuickJS cannot provide that relay.
 */
var ANIKAGE_ID = "anikage";
var ANIKAGE_SITE = "https://anikage.cc";
var ANIKAGE_API = "https://anikage.cc/api/media";
var ANIKAGE_PROXY = "https://og.bakayaro.live";
var ANIKAGE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": ANIKAGE_SITE + "/"
};
function akContext() { return (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {}; }
function akTimeout(p, ms) {
  var timer;
  return Promise.race([p, new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("Anikage timeout")); }, ms || 10000); })])
    .then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}
async function akFetch(url, options, timeout) { var res = await akTimeout(fetch(url, options || {}), timeout || 10000); if (!res || !res.ok) throw new Error("Anikage HTTP " + (res ? res.status : "network")); return res; }
async function akJson(url, options, timeout) { return await (await akFetch(url, options, timeout)).json(); }
function akNorm(s) { var x = String(s || "").toLowerCase(); if (x.normalize) x = x.normalize("NFKC"); return x.replace(/[^a-z0-9]+/g, " ").trim(); }
async function akMeta(id, context) {
  var supplied = [].concat(context.title || [], context.titles || [], context.aliases || []);
  if (supplied.length) return { id: String(id), titles: supplied.map(function (x) { return typeof x === "string" ? x : (x && (x.english || x.romaji || x.native)) || ""; }).filter(Boolean), idMal: context.idMal || context.malId || 0 };
  var q = "query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { english romaji native userPreferred } synonyms } }";
  var res = await akJson("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ query: q, variables: { id: Number(id) } }) }, 12000);
  var m = res && res.data && res.data.Media; if (!m || String(m.id) !== String(id)) throw new Error("AniList ID mismatch");
  return { id: String(m.id), idMal: m.idMal || 0, titles: [m.title && m.title.english, m.title && m.title.romaji, m.title && m.title.native, m.title && m.title.userPreferred].concat(m.synonyms || []).filter(Boolean) };
}
function akMatch(items, meta) {
  var aliases = {}; (meta.titles || []).forEach(function (t) { aliases[akNorm(t)] = true; });
  var matches = (items || []).filter(function (item) { var t = item && item.title || {}; return [t.english, t.romaji, t.native, t.userPreferred].some(function (x) { return !!aliases[akNorm(x)]; }); });
  return matches.length === 1 ? matches[0] : null;
}
function akCandidate(url, name, quality, type, lang, subtitles, headers) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return { name: "Anikage | " + name, title: name, url: url, quality: quality || "Auto", type: type || "m3u8", provider: ANIKAGE_ID, language: lang || undefined, headers: headers || ANIKAGE_HEADERS, subtitles: subtitles || [] };
}
function akQuality(h) { var n = Number(h || 0); if (n >= 2160) return "2160p"; if (n >= 1440) return "1440p"; if (n >= 1080) return "1080p"; if (n >= 720) return "720p"; if (n >= 480) return "480p"; if (n >= 360) return "360p"; if (n >= 240) return "240p"; if (n >= 144) return "144p"; return "Auto"; }
function akAbs(base, value) { try { return new URL(value, base).toString(); } catch (_) { return value; } }
function akResolveProxy(value, isM3u8) {
  if (!value) return "";
  var v = String(value).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^\/(stream|m3u8|hls)\//i.test(v)) return ANIKAGE_PROXY + v;
  if (/^(stream|m3u8|hls)\//i.test(v)) return ANIKAGE_PROXY + "/" + v;
  return ANIKAGE_PROXY + "/" + (isM3u8 ? "m3u8/" : "stream/") + v.replace(/^\/+/, "");
}
async function akHls(url, label, lang, subtitles, headers) {
  var body = await (await akFetch(url, { headers: headers }, 10000)).text();
  if (body.indexOf("#EXTM3U") < 0) return [];
  if (body.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") >= 0) { var master = akCandidate(url, label, "Auto", "m3u8", lang, subtitles, headers); return master ? [master] : []; }
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var h = (lines[i].match(/RESOLUTION=\d+x(\d+)/i) || [,""])[1], uri = "";
    for (var j = i + 1; j < lines.length; j++) { var line = lines[j].trim(); if (line && line.charAt(0) !== "#") { uri = line; break; } }
    if (!uri) continue;
    var c = akCandidate(akAbs(url, uri), label, akQuality(h), "m3u8", lang, subtitles, headers); if (c) out.push(c);
  }
  if (!out.length) { var c0 = akCandidate(url, label, "Auto", "m3u8", lang, subtitles, headers); if (c0) out.push(c0); }
  return out;
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    var context = Object.assign({}, akContext(), extraArgs || {});
    if (mediaType !== "anime") return [];
    var id = String(anilistId || context.anilistId || context.aniListId || ""), ep = Number(episode || context.episodeNumber || context.episode || 0);
    if (!/^\d+$/.test(id) || Number(id) <= 0 || !Number.isFinite(ep) || ep <= 0) return [];
    var meta = await akMeta(id, context), mapped = context.providerMappings && context.providerMappings.anikage, slug = "";
    if (mapped) slug = String(typeof mapped === "object" ? mapped.slug || mapped.id || "" : mapped);
    if (!slug) {
      for (var i = 0; i < meta.titles.length && !slug; i++) {
        var page = await akJson(ANIKAGE_API + "/anime/browse?q=" + encodeURIComponent(meta.titles[i]) + "&sort=popularity&page=1&limit=25&adult=false", { headers: ANIKAGE_HEADERS }, 10000);
        var item = akMatch(page && page.data || [], meta); if (item && item.slug) slug = String(item.slug);
      }
    }
    if (!slug) return [];
    var episodes = await akJson(ANIKAGE_API + "/anime/" + encodeURIComponent(slug) + "/episodes", { headers: ANIKAGE_HEADERS }, 10000);
    if (!Array.isArray(episodes)) return [];
    var epItem = episodes.find(function (x) { return Number(x.number) === ep; }); if (!epItem) return [];
    var epNum = String(epItem.number);
    var serverData = await akJson(ANIKAGE_API + "/anime/" + encodeURIComponent(slug) + "/episodes/" + encodeURIComponent(epNum) + "/servers", { headers: ANIKAGE_HEADERS }, 10000);
    var servers = serverData && serverData.servers || []; if (!servers.length) return [];
    var preferredAudio = String(context.preferredAudio || "sub").toLowerCase();
    var audioOrder = preferredAudio === "dub" ? ["dub", "sub"] : ["sub", "dub"];
    var availableTypes = {};
    servers.forEach(function (s) { (s.subTypes || ["sub", "dub"]).forEach(function (x) { availableTypes[String(x).toLowerCase()] = true; }); });
    var types = audioOrder.filter(function (x) { return availableTypes[x]; });
    var out = [], seen = {};
    for (var si = 0; si < servers.length; si++) {
      var server = servers[si]; if (!server || !server.id) continue;
      var typesForServer = (server.subTypes || types).map(function (x) { return String(x).toLowerCase(); });
      for (var li = 0; li < types.length; li++) {
        var lang = types[li]; if (typesForServer.indexOf(lang) < 0) continue;
        var sourceUrl = ANIKAGE_API + "/anime/" + encodeURIComponent(slug) + "/episodes/" + encodeURIComponent(epNum) +
          "/sources?provider=" + encodeURIComponent(server.id) + "&lang=" + encodeURIComponent(lang) + "&server=" + encodeURIComponent(server.id);
        var data;
        try { data = await akJson(sourceUrl, { headers: ANIKAGE_HEADERS }, 10000); } catch (_) { continue; }
        var subtitles = (data.subtitles || []).map(function (s) {
          var raw = s && (s.file || s.url); if (!raw) return null;
          var u = akResolveProxy(raw, false); return /^https:\/\//i.test(u) ? { url: u, lang: s.label || "Unknown" } : null;
        }).filter(Boolean);
        (data.sources || []).forEach(function (src) {
          if (!src || !src.url) return;
          var isM3u8 = src.isM3U8 !== false, full = akResolveProxy(src.url, isM3u8);
          var host = (full.match(/^https?:\/\/([^/]+)/i) || [,""])[1].toLowerCase();
          if (["vivibebe.site", "echovideo.to", "krussdomi.com"].some(function (h) { return host === h || host.endsWith("." + h); })) return;
          var label = String(server.id).toUpperCase() + " - " + lang.toUpperCase() + " - " + (src.quality || "Auto");
          if (isM3u8) { if (!seen[full]) { seen[full] = true; out.push({ _url: full, _label: label, _lang: lang, _subs: subtitles, _headers: Object.assign({}, ANIKAGE_HEADERS, { "Referer": ANIKAGE_SITE + "/" }) }); } }
          else { var direct = akCandidate(full, label, src.quality || "Auto", "mp4", lang, subtitles, ANIKAGE_HEADERS); if (direct) out.push(direct); }
        });
      }
    }
    var final = [];
    for (var k = 0; k < out.length; k++) {
      if (out[k]._url) { try { final = final.concat(await akHls(out[k]._url, out[k]._label, out[k]._lang, out[k]._subs, out[k]._headers)); } catch (_) {} }
      else final.push(out[k]);
    }
    var dedup = {};
    return final.filter(function (c) { if (!c || !c.url || dedup[c.url]) return false; dedup[c.url] = true; return true; }).map(function (c) { c.anilistId = id; c.episodeNumber = ep; return c; });
  } catch (e) { console.log("[Anikage] " + String(e && e.message || e)); return []; }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
