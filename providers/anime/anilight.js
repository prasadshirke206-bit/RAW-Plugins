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
function alB64Bytes(value) { var raw = atob(String(value || "").replace(/-/g, "+").replace(/_/g, "/")); var bytes = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return bytes; }
async function alDecryptMega(enc) {
  if (!enc || typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") return "";
  try {
    var keyBytes = new Uint8Array(32); keyBytes.set(new TextEncoder().encode(ANILIGHT_MEGA_KEY));
    var key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: new TextEncoder().encode(ANILIGHT_MEGA_IV) }, key, alB64Bytes(enc));
    var data = JSON.parse(new TextDecoder().decode(plain)); return data && data.file || "";
  } catch (_) { return ""; }
}
async function alHls(url, label, lang, headers, subtitles) {
  var body = await (await alFetch(url, { headers: headers }, 10000)).text();
  if (body.indexOf("#EXTM3U") < 0) return [];
  if (body.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") >= 0) { var master = alCandidate(url, label, "Auto", "m3u8", lang, headers, subtitles); return master ? [master] : []; }
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var h = (lines[i].match(/RESOLUTION=\d+x(\d+)/i) || [,""])[1], next = "";
    for (var j = i + 1; j < lines.length; j++) { var line = lines[j].trim(); if (line && line.charAt(0) !== "#") { next = line; break; } }
    if (!next) continue;
    var c = alCandidate(alAbs(url, next), label, alQuality(h), "m3u8", lang, headers, subtitles); if (c) out.push(c);
  }
  if (!out.length) { var c0 = alCandidate(url, label, "Auto", "m3u8", lang, headers, subtitles); if (c0) out.push(c0); }
  return out;
}
async function alMegaPlay(embedUrl, lang, label) {
  var headers = Object.assign({}, ANILIGHT_HEADERS, { "Referer": embedUrl });
  var html = await (await alFetch(embedUrl, { headers: headers }, 10000)).text();
  var m = html.match(/data-id=["']([^"']+)["']/i) || html.match(/data-id=(\d+)/i);
  if (!m) return [];
  var mediaId = m[1], host = (embedUrl.match(/^https?:\/\/([^/]+)/i) || [,"megaplay.buzz"])[1];
  var sources = await alJson("https://" + host + "/stream/getSources?id=" + encodeURIComponent(mediaId) + "&id=" + encodeURIComponent(mediaId),
    { headers: Object.assign({}, headers, { "Accept": "application/json,*/*" }) }, 10000);
  var file = sources && sources.sources && sources.sources.file;
  if (sources && sources.enc) file = await alDecryptMega(sources.enc) || file;
  if (!file || !/^https:\/\//i.test(file)) return [];
  var tracks = (sources.tracks || []).map(function (t) { if (!t || !t.file || String(t.kind || "").toLowerCase() === "thumbnails" || !/^https:\/\//i.test(t.file)) return null; return { url: t.file, lang: t.label || "Unknown" }; }).filter(Boolean);
  return await alHls(file, label + (lang === "dub" ? " [Dub]" : " [Sub]"), lang, headers, tracks);
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
      for (var i = 0; i < meta.titles.length && !match; i++) {
        var list = await alJson(ANILIGHT_API + "/filter?page=1&search=" + encodeURIComponent(meta.titles[i]) + "&sort=POPULARITY_DESC", { headers: ANILIGHT_HEADERS }, 10000);
        match = alExactItem(list && list.media || [], meta);
      }
    }
    if (!match || !match.slug) return [];
    var watch = await alJson(ANILIGHT_API + "/watch/" + encodeURIComponent(match.slug), { headers: ANILIGHT_HEADERS }, 10000);
    var episodes = watch && watch.episodes || [], epItem = episodes.find(function (x) { return Number(x.number) === ep; });
    if (!epItem) return [];
    var preference = String(context.preferredAudio || "sub").toLowerCase(), types = preference === "dub" ? ["dub", "sub"] : ["sub", "dub"], out = [];
    for (var t = 0; t < types.length; t++) {
      var lang = types[t], embed = epItem.embed_url && epItem.embed_url[lang];
      if (embed) { try { out = out.concat(await alMegaPlay(embed, lang, "Episode " + ep)); } catch (_) {} }
    }
    var seen = {}; return out.filter(function (c) { if (!c || !c.url || seen[c.url]) return false; seen[c.url] = true; return true; }).map(function (c) { c.anilistId = id; c.episodeNumber = ep; return c; });
  } catch (e) { console.log("[AniLight] " + String(e && e.message || e)); return []; }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
