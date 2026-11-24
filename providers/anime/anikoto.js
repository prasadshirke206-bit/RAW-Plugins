/*
 * Anikoto — RAW QuickJS anime provider ported from the original Kotlin source
 * and AnikotoTheme multisource contract. It does not forge short-lived signed
 * CDN tokens or emulate a browser verification challenge.
 */
var ANIKOTO_ID = "anikoto";
var ANIKOTO_MIRRORS = ["https://anikototv.bz", "https://anikototv.to", "https://anikoto.cz", "https://anikoto.me", "https://anikoto.net", "https://anikototv.se", "https://anikototv.com"];
var ANIKOTO_MAPPER = "https://mapper.nekostream.site/api";
var ANIKOTO_MEGA_KEY = "i?LMTAx0Q6,:}50U";
var ANIKOTO_MEGA_IV = "W0;27ToaUpl_P%'c";
var ANIKOTO_HEADERS = { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Accept": "text/html,application/json,application/xhtml+xml,*/*", "Referer": ANIKOTO_MIRRORS[0] + "/" };
function koContext() { return (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {}; }
function koTimeout(p, ms) { var timer; return Promise.race([p, new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("Anikoto timeout")); }, ms || 10000); })]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; }); }
async function koFetch(url, options, ms) { var res = await koTimeout(fetch(url, options || {}), ms || 10000); if (!res || !res.ok) throw new Error("Anikoto HTTP " + (res ? res.status : "network")); return res; }
async function koJson(url, options, ms) { return await (await koFetch(url, options, ms)).json(); }
function koNorm(s) { var x = String(s || "").toLowerCase(); if (x.normalize) x = x.normalize("NFKC"); return x.replace(/[^a-z0-9]+/g, " ").trim(); }
function koText(html) { return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(); }
function koAttr(tag, name) { var re = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\\"([^\\"]*)\\"|'([^']*)'|([^\\s>]+))", "i"); var m = String(tag || "").match(re); return m ? (m[1] || m[2] || m[3] || "") : ""; }
async function koAniList(id, context) {
  var supplied = [].concat(context.title || [], context.titles || [], context.aliases || []);
  if (supplied.length) return { id: String(id), idMal: context.idMal || context.malId || 0, titles: supplied.map(function (x) { return typeof x === "string" ? x : (x && (x.english || x.romaji || x.native)) || ""; }).filter(Boolean) };
  var q = "query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { english romaji native userPreferred } synonyms } }";
  var res = await koJson("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ query: q, variables: { id: Number(id) } }) }, 12000);
  var m = res && res.data && res.data.Media; if (!m || String(m.id) !== String(id)) throw new Error("AniList ID mismatch");
  return { id: String(m.id), idMal: m.idMal || 0, titles: [m.title && m.title.english, m.title && m.title.romaji, m.title && m.title.native, m.title && m.title.userPreferred].concat(m.synonyms || []).filter(Boolean) };
}
function koBase64Url(bytes) {
  if (typeof btoa !== "function") throw new Error("Anikoto VRF requires QuickJS btoa");
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}
function koUtf8(value) {
  if (typeof TextEncoder === "undefined") throw new Error("Anikoto VRF requires TextEncoder");
  return new TextEncoder().encode(String(value));
}
function koRc4(input, key) {
  var s = new Uint8Array(256), out = new Uint8Array(input.length);
  for (var i = 0; i < 256; i++) s[i] = i;
  var j = 0;
  for (var k = 0; k < 256; k++) {
    j = (j + s[k] + key[k % key.length]) & 255;
    var t = s[k]; s[k] = s[j]; s[j] = t;
  }
  var i2 = 0; j = 0;
  for (var n = 0; n < input.length; n++) {
    i2 = (i2 + 1) & 255;
    j = (j + s[i2]) & 255;
    var swap = s[i2]; s[i2] = s[j]; s[j] = swap;
    out[n] = input[n] ^ s[(s[i2] + s[j]) & 255];
  }
  return out;
}
function koVrfEncrypt(input) {
  var order = [
    ["exchange", ["AP6GeR8H0lwUz1", "UAz8Gwl10P6ReH"]],
    ["rc4", ["ItFKjuWokn4ZpB"]],
    ["rc4", ["fOyt97QWFB3"]],
    ["exchange", ["1majSlPQd2M5", "da1l2jSmP5QM"]],
    ["exchange", ["CPYvHj09Au3", "0jHA9CPYu3v"]],
    ["reverse", []],
    ["rc4", ["736y1uTJpBLUX"]],
    ["base64", []]
  ];
  var vrf = String(input);
  for (var i = 0; i < order.length; i++) {
    var op = order[i][0], keys = order[i][1];
    if (op === "exchange") {
      var chars = Array.from(vrf), from = keys[0], to = keys[1];
      vrf = chars.map(function (ch) { var index = from.indexOf(ch); return index < 0 ? ch : to.charAt(index); }).join("");
    } else if (op === "rc4") {
      vrf = koBase64Url(koRc4(koUtf8(vrf), koUtf8(keys[0])));
    } else if (op === "reverse") {
      vrf = Array.from(vrf).reverse().join("");
    } else if (op === "base64") {
      vrf = koBase64Url(koUtf8(vrf));
    }
  }
  return encodeURIComponent(vrf);
}
function koExactTitle(text, meta) { var n = koNorm(text); return (meta.titles || []).some(function (x) { return n && n === koNorm(x); }); }
function koAbs(base, value) { try { return new URL(value, base).toString(); } catch (_) { return value; } }
function koCandidate(url, title, quality, type, lang, headers, subtitles) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return { name: "Anikoto | " + title, title: title, url: url, quality: quality || "Auto", type: type || "m3u8", provider: ANIKOTO_ID, language: lang || undefined, headers: headers || ANIKOTO_HEADERS, subtitles: subtitles || [] };
}
function koQuality(h) { var n = Number(h || 0); if (n >= 2160) return "2160p"; if (n >= 1440) return "1440p"; if (n >= 1080) return "1080p"; if (n >= 720) return "720p"; if (n >= 480) return "480p"; if (n >= 360) return "360p"; if (n >= 240) return "240p"; if (n >= 144) return "144p"; return "Auto"; }
function koB64Bytes(value) { var raw = atob(String(value || "").replace(/-/g, "+").replace(/_/g, "/")); var bytes = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return bytes; }
async function koDecryptMega(enc) {
  if (!enc || typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") return "";
  try {
    var keyBytes = new Uint8Array(32); keyBytes.set(new TextEncoder().encode(ANIKOTO_MEGA_KEY));
    var key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: new TextEncoder().encode(ANIKOTO_MEGA_IV) }, key, koB64Bytes(enc));
    var parsed = JSON.parse(new TextDecoder().decode(plain)); return parsed && parsed.file || "";
  } catch (_) { return ""; }
}
async function koHls(url, title, lang, headers, subtitles) {
  var body = await (await koFetch(url, { headers: headers }, 10000)).text();
  if (body.indexOf("#EXTM3U") < 0) return [];
  if (body.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") >= 0) { var master = koCandidate(url, title, "Auto", "m3u8", lang, headers, subtitles); return master ? [master] : []; }
  var lines = body.split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var h = (lines[i].match(/RESOLUTION=\d+x(\d+)/i) || [,""])[1], next = "";
    for (var j = i + 1; j < lines.length; j++) { var line = lines[j].trim(); if (line && line.charAt(0) !== "#") { next = line; break; } }
    if (!next) continue;
    var c = koCandidate(koAbs(url, next), title, koQuality(h), "m3u8", lang, headers, subtitles); if (c) out.push(c);
  }
  if (!out.length) { var plain = koCandidate(url, title, "Auto", "m3u8", lang, headers, subtitles); if (plain) out.push(plain); }
  return out;
}
async function koMegaPlay(embedUrl, label, lang) {
  var headers = Object.assign({}, ANIKOTO_HEADERS, { "Referer": embedUrl });
  var html = await (await koFetch(embedUrl, { headers: headers }, 10000)).text();
  var id = (html.match(/data-id=["']([^"']+)["']/i) || html.match(/File\s+(\d+)/i) || [,""])[1];
  if (!id) return [];
  var host = (embedUrl.match(/^https?:\/\/([^/]+)/i) || [,"megaplay.buzz"])[1];
  var data = await koJson("https://" + host + "/stream/getSources?id=" + encodeURIComponent(id) + "&st=other",
    { headers: Object.assign({}, headers, { "Accept": "application/json,*/*", "X-Requested-With": "XMLHttpRequest" }) }, 10000);
  var file = data && data.sources && data.sources.file;
  if (data && data.enc) file = await koDecryptMega(data.enc) || file;
  if (!file || !/^https:\/\//i.test(file)) return [];
  var subs = (data.tracks || []).map(function (t) { return t && t.file && String(t.kind || "").toLowerCase() !== "thumbnails" && /^https:\/\//i.test(t.file) ? { url: t.file, lang: t.label || "Unknown" } : null; }).filter(Boolean);
  return await koHls(file, label + " - " + lang, lang, headers, subs);
}
async function koResolveEmbed(embed, label, lang) {
  if (!embed || !/^https:\/\//i.test(embed)) return [];
  if (/\.m3u8(?:$|[?#])/i.test(embed)) return await koHls(embed, label, lang, ANIKOTO_HEADERS, []);
  if (/\.(?:mp4|mpd)(?:$|[?#])/i.test(embed)) { var ext = (embed.match(/\.(mp4|mpd)/i) || [,"mp4"])[1].toLowerCase(); var d = koCandidate(embed, label, "Auto", ext, lang, ANIKOTO_HEADERS, []); return d ? [d] : []; }
  if (/\/stream\//i.test(embed) || /megaplay\.buzz|vidtube\.site/i.test(embed)) { try { return await koMegaPlay(embed, label, lang); } catch (_) { return []; } }
  try {
    var html = await (await koFetch(embed, { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": ANIKOTO_MIRRORS[0] + "/" }) }, 8000)).text();
    var links = html.match(/https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\\\s<>]*)?/gi) || [], out = [];
    for (var i = 0; i < links.length; i++) { var ext2 = (links[i].match(/\.(m3u8|mp4|mpd)/i) || [,"mp4"])[1].toLowerCase(); if (ext2 === "m3u8") out = out.concat(await koHls(links[i], label, lang, ANIKOTO_HEADERS, [])); else { var c = koCandidate(links[i], label, "Auto", ext2, lang, ANIKOTO_HEADERS, []); if (c) out.push(c); } }
    return out;
  } catch (_) { return []; }
}
async function koTrySearch(base, title) {
  var url = base + "/filter?keyword=" + encodeURIComponent(title) + "&page=1&vrf=" + koVrfEncrypt(title);
  var html = await (await koFetch(url, { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": base + "/" }) }, 10000)).text();
  var anchors = html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || [], matches = [];
  for (var i = 0; i < anchors.length; i++) { var tag = anchors[i].match(/^<a\b[^>]*>/i), href = tag ? koAttr(tag[0], "href") : "", text = koText(anchors[i]); if (href && /\/watch\//i.test(href) && koExactTitle(text, { titles: [title] })) matches.push(koAbs(base, href).split("?")[0]); }
  matches = matches.filter(function (x, i) { return matches.indexOf(x) === i; });
  return matches.length === 1 ? matches[0] : "";
}
async function getStreams(anilistId, mediaType, season, episode, extraArgs) {
  try {
    var context = Object.assign({}, koContext(), extraArgs || {});
    if (mediaType !== "anime") return [];
    var id = String(anilistId || context.anilistId || context.aniListId || ""), ep = Number(episode || context.episodeNumber || context.episode || 0);
    if (!/^\d+$/.test(id) || Number(id) <= 0 || !Number.isFinite(ep) || ep <= 0) return [];
    var meta = await koAniList(id, context), mapped = context.providerMappings && context.providerMappings.anikoto, animeUrl = "";
    if (mapped) { var mv = typeof mapped === "object" ? mapped.url || mapped.slug || "" : String(mapped); if (mv) animeUrl = /^https?:\/\//i.test(mv) ? mv : ANIKOTO_MIRRORS[0] + (mv.charAt(0) === "/" ? "" : "/") + mv; }
    var baseUsed = ANIKOTO_MIRRORS[0];
    if (!animeUrl) {
      for (var b = 0; b < ANIKOTO_MIRRORS.length && !animeUrl; b++) {
        for (var t = 0; t < meta.titles.length && !animeUrl; t++) { try { animeUrl = await koTrySearch(ANIKOTO_MIRRORS[b], meta.titles[t]); if (animeUrl) baseUsed = ANIKOTO_MIRRORS[b]; } catch (_) {} }
      }
    }
    if (!animeUrl) return [];
    var slug = animeUrl.replace(/\/+$/, "").split("/").pop();
    var detailHtml = await (await koFetch(animeUrl, { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": baseUsed + "/" }) }, 10000)).text();
    var siteId = (detailHtml.match(/data-id=["']([^"']+)["']/i) || detailHtml.match(/data-tip=["']([^"']+)["']/i) || [,""])[1];
    if (!siteId) return [];
    var epResponse = await koJson(baseUsed + "/ajax/episode/list/" + encodeURIComponent(siteId) + "?vrf=", {
      headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": animeUrl, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" })
    }, 10000);
    var epHtml = epResponse && epResponse.result || "", tags = epHtml.match(/<a\b[^>]*data-num=["'][^"']+["'][^>]*>/gi) || [], epTag = null;
    for (var e = 0; e < tags.length; e++) if (String(koAttr(tags[e], "data-num")) === String(ep)) { epTag = tags[e]; break; }
    if (!epTag) return [];
    var ids = koAttr(epTag, "data-ids"), malId = koAttr(epTag, "data-mal") || meta.idMal, mapperSlug = koAttr(epTag, "data-slug"), timestamp = koAttr(epTag, "data-timestamp");
    if (!ids) return [];
    var serverResult = await koJson(baseUsed + "/ajax/server/list?servers=" + encodeURIComponent(ids), {
      headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": animeUrl, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" })
    }, 10000);
    var serverHtml = serverResult && serverResult.result || "", groups = serverHtml.match(/<div\b[^>]*class=["'][^"']*\btype\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi) || [], servers = [];
    for (var g = 0; g < groups.length; g++) {
      var gt = groups[g].match(/^<div\b[^>]*>/i), typeName = (gt && (koAttr(gt[0], "data-type") || koText(gt[0]))) || "Sub";
      typeName = /dub|a-dub/i.test(typeName) ? "dub" : "sub";
      var lis = groups[g].match(/<li\b[^>]*data-link-id=["'][^"']+["'][^>]*>[\s\S]*?<\/li>/gi) || [];
      for (var l = 0; l < lis.length; l++) { var lt = lis[l].match(/^<li\b[^>]*>/i), serverId = lt ? koAttr(lt[0], "data-link-id") : ""; if (serverId) servers.push({ id: serverId, name: koText(lis[l]) || serverId, type: typeName }); }
    }
    var preferred = String(context.preferredAudio || "sub").toLowerCase();
    servers.sort(function (a, b) { return (a.type === preferred ? -1 : 0) - (b.type === preferred ? -1 : 0); });
    var out = [];
    for (var s = 0; s < servers.length; s++) {
      var server = servers[s], embed = server.id;
      if (!/^https?:\/\//i.test(embed)) {
        try { var sr = await koJson(baseUsed + "/ajax/server?get=" + encodeURIComponent(server.id), { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": animeUrl, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json,*/*" }) }, 8000); embed = sr && sr.result && sr.result.url || ""; } catch (_) { continue; }
      }
      if (embed) out = out.concat(await koResolveEmbed(embed, "Episode " + ep + " - " + server.name, server.type));
    }
    // Mapper results are supplementary. Only direct public URLs are resolved.
    if (malId && mapperSlug && timestamp) {
      try {
        var mapper = await koJson(ANIKOTO_MAPPER + "/mal/" + encodeURIComponent(malId) + "/" + encodeURIComponent(mapperSlug) + "/" + encodeURIComponent(timestamp), { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": baseUsed + "/", "Origin": baseUsed }) }, 8000);
        var keys = Object.keys(mapper || {});
        for (var x = 0; x < keys.length; x++) {
          if (keys[x].toLowerCase() === "status") continue;
          var data = mapper[keys[x]] || {};
          ["sub", "dub"].forEach(function (kind) { var u = data[kind] && data[kind].url; if (u && /^https:\/\//i.test(u)) out.push({ _embed: u, _label: "Episode " + ep + " - " + keys[x], _lang: kind }); });
        }
      } catch (_) {}
    }
    var final = [], seen = {};
    for (var k = 0; k < out.length; k++) {
      var item = out[k];
      if (item && item._embed) { var more = await koResolveEmbed(item._embed, item._label, item._lang); for (var z = 0; z < more.length; z++) out.push(more[z]); continue; }
      if (!item || !item.url || seen[item.url]) continue;
      seen[item.url] = true; final.push(item);
    }
    return final.map(function (c) { c.anilistId = id; c.episodeNumber = ep; return c; });
  } catch (e) { console.log("[Anikoto] " + String(e && e.message || e)); return []; }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
