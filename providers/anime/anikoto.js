/*
 * Anikoto — RAW QuickJS anime provider ported from the original Kotlin source
 * and AnikotoTheme multisource contract, including episode VRF and MegaPlay
 * AES-CBC/HMAC stream signing. Browser-only session challenges remain native-host work.
 */
var ANIKOTO_ID = "anikoto";
var ANIKOTO_MIRRORS = ["https://anikototv.bz", "https://anikototv.to", "https://anikoto.cz", "https://anikoto.me", "https://anikoto.net", "https://anikototv.se", "https://anikototv.com"];
var ANIKOTO_MAPPER = "https://mapper.nekostream.site/api";
var ANIKOTO_MEGA_KEY = "i?LMTAx0Q6,:}50U";
var ANIKOTO_MEGA_IV = "W0;27ToaUpl_P%'c";
var ANIKOTO_MEGA_TOKEN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
var ANIKOTO_HEADERS = { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Accept": "text/html,application/json,application/xhtml+xml,*/*", "Referer": ANIKOTO_MIRRORS[0] + "/" };
function koContext() { return (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {}; }
function koTimeout(p, ms) { var timer; return Promise.race([p, new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("Anikoto timeout")); }, ms || 10000); })]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; }); }
async function koFetch(url, options, ms) { var res = await koTimeout(fetch(url, options || {}), ms || 10000); if (!res || !res.ok) throw new Error("Anikoto HTTP " + (res ? res.status : "network")); return res; }
async function koJson(url, options, ms) { return await (await koFetch(url, options, ms)).json(); }
function koNorm(s) { var x = String(s || "").toLowerCase(); if (x.normalize) x = x.normalize("NFKC"); return x.replace(/[^a-z0-9]+/g, " ").trim(); }
function koText(html) { return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(); }
function koAttr(tag, name) {
  var re = new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  var m = String(tag || "").match(re);
  return m ? (m[1] || m[2] || m[3] || "") : "";
}
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
function koStandardBase64(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] & 255);
  return btoa(binary);
}
function koAnikotoVrf(input) {
  // AnikotoTheme's default getVrf uses AnikotoRC4.encodeVrf:
  // RC4("simple-hash", animeId) -> standard Base64 -> URL encoding.
  var encrypted = koRc4(koUtf8(String(input)), koUtf8("simple-hash"));
  return encodeURIComponent(koStandardBase64(encrypted));
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
function koMapperDisplayName(key) {
  var normalized = String(key || "").toLowerCase();
  if (normalized === "gogoanime") return "Vidstream";
  if (normalized === "anivibe") return "Vibe-Stream";
  if (normalized === "animepahe") return "Kiwi-Stream";
  return String(key || "");
}
function koCandidate(url, title, quality, type, lang, headers, subtitles) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return { name: "Anikoto | " + title, title: title, url: url, quality: quality || "Auto", type: type || "m3u8", provider: ANIKOTO_ID, language: lang || undefined, headers: headers || ANIKOTO_HEADERS, subtitles: subtitles || [] };
}
function koQuality(h) { var n = Number(h || 0); if (n >= 2160) return "2160p"; if (n >= 1440) return "1440p"; if (n >= 1080) return "1080p"; if (n >= 720) return "720p"; if (n >= 480) return "480p"; if (n >= 360) return "360p"; if (n >= 240) return "240p"; if (n >= 144) return "144p"; return "Auto"; }
function koB64Bytes(value) { var encoded = String(value || "").replace(/-/g, "+").replace(/_/g, "/"); while (encoded.length % 4) encoded += "="; var raw = atob(encoded); var bytes = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return bytes; }
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
function koBase64UrlNoPad(bytes) {
  return koBase64Url(bytes).replace(/=+$/g, "");
}
async function koSignMegaPlayUrl(fileUrl, wasDecrypted) {
  if (!wasDecrypted || /[?&]token=/i.test(fileUrl)) return fileUrl;
  var match = String(fileUrl).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
  if (!match) return fileUrl;
  try {
    var pathKey = match[1].toLowerCase() + "/" + match[2].toLowerCase();
    var expiry = Math.floor(Date.now() / 1000) + 90;
    var payload = String(expiry) + "|" + pathKey;
    var key = await crypto.subtle.importKey(
      "raw",
      koUtf8(ANIKOTO_MEGA_TOKEN_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    var signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, koUtf8(payload)));
    var token = koBase64UrlNoPad(koUtf8(payload)) + "." + koBase64UrlNoPad(signatureBytes);
    var parsed = new URL(fileUrl);
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch (error) {
    console.log("[Anikoto] MegaPlay signed URL generation failed: " + String(error && error.message || error));
    return fileUrl;
  }
}
function koMegaSourceFile(data) {
  var sources = data && data.sources;
  if (typeof sources === "string" && sources.trim()) return sources.trim();
  if (Array.isArray(sources)) {
    for (var i = 0; i < sources.length; i++) {
      var item = sources[i];
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item.file === "string" && item.file.trim()) return item.file.trim();
    }
  }
  if (sources && typeof sources.file === "string" && sources.file.trim()) return sources.file.trim();
  return "";
}
async function koMegaPlay(embedUrl, label, lang, siteBase) {
  var base = String(siteBase || ANIKOTO_MIRRORS[0]).replace(/\/+$/, "");
  var pageHeaders = Object.assign({}, ANIKOTO_HEADERS, {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": base + "/"
  });
  var html = await (await koFetch(embedUrl, { headers: pageHeaders }, 10000)).text();
  var id = (html.match(/data-id=["']([^"']+)["']/i) || html.match(/File\s+(\d+)/i) || [, ""])[1];
  if (!id) return [];
  var embed = new URL(embedUrl);
  var getSources = new URL(embed.origin + "/stream/getSources");
  getSources.searchParams.set("id", id);
  getSources.searchParams.set("st", "other");
  var sParam = embed.searchParams.get("s");
  if (sParam) getSources.searchParams.set("s", sParam);
  var apiHeaders = Object.assign({}, ANIKOTO_HEADERS, {
    "Accept": "application/json,*/*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": embedUrl
  });
  var data = await koJson(getSources.toString(), { headers: apiHeaders }, 10000);
  var sourceFile = koMegaSourceFile(data);
  var wasDecrypted = false;
  if (data && data.enc) {
    var decrypted = await koDecryptMega(data.enc);
    if (decrypted) {
      sourceFile = decrypted;
      wasDecrypted = true;
    }
  }
  if (!sourceFile || !/^https:\/\//i.test(sourceFile)) return [];
  sourceFile = await koSignMegaPlayUrl(sourceFile, wasDecrypted);
  if (!/^https:\/\//i.test(sourceFile)) return [];

  var tracks = (data && data.tracks || []).filter(function (track) {
    return track && track.file && String(track.label || "").trim() &&
      String(track.kind || "").toLowerCase() !== "thumbnails" && /^https:\/\//i.test(track.file);
  }).slice().sort(function (left, right) {
    var leftAss = /\.ass(?:$|[?#])/i.test(left.file);
    var rightAss = /\.ass(?:$|[?#])/i.test(right.file);
    return (rightAss ? 1 : 0) - (leftAss ? 1 : 0);
  }).filter(function (track, index, all) {
    var trackLabel = String(track.label || "").toLowerCase();
    return all.findIndex(function (other) { return String(other.label || "").toLowerCase() === trackLabel; }) === index;
  }).map(function (track) {
    return { url: track.file, lang: track.label };
  });

  var thumbnailsVtt = (data && data.tracks || []).filter(function (track) {
    return track && String(track.kind || "").toLowerCase() === "thumbnails" && track.file;
  }).map(function (track) { return track.file; })[0] || "";
  var timestamps = [];
  if (data && data.intro && (Number(data.intro.start) !== 0 || Number(data.intro.end) !== 0)) {
    timestamps.push({ start: Number(data.intro.start), end: Number(data.intro.end), name: "Intro", type: "opening" });
  }
  if (data && data.outro && (Number(data.outro.start) !== 0 || Number(data.outro.end) !== 0)) {
    timestamps.push({ start: Number(data.outro.start), end: Number(data.outro.end), name: "Outro", type: "ending" });
  }

  var host = embed.host || "megaplay.buzz";
  var videoHeaders = Object.assign({}, ANIKOTO_HEADERS, {
    "Referer": "https://" + host + "/",
    "Origin": "https://" + host
  });
  var videos = await koHls(sourceFile, label + " - " + lang, lang, videoHeaders, tracks);
  return videos.map(function (video) {
    video.internalData = thumbnailsVtt;
    video.timestamps = timestamps.length ? timestamps : (video.timestamps || []);
    return video;
  });
}
async function koResolveEmbed(embed, label, lang, siteBase) {
  if (!embed || !/^https:\/\//i.test(embed)) return [];
  var referer = String(siteBase || ANIKOTO_MIRRORS[0]).replace(/\/+$/, "") + "/";
  if (/\.m3u8(?:$|[?#])/i.test(embed)) return await koHls(embed, label, lang, { Referer: referer }, []);
  if (/\.(?:mp4|mpd)(?:$|[?#])/i.test(embed)) {
    var ext = (embed.match(/\.(mp4|mpd)/i) || [, "mp4"])[1].toLowerCase();
    var direct = koCandidate(embed, label, "Auto", ext, lang, { Referer: referer }, []);
    return direct ? [direct] : [];
  }
  if (/\/stream\//i.test(embed) || /megaplay\.buzz|vidtube\.site/i.test(embed)) {
    try { return await koMegaPlay(embed, label, lang, siteBase); } catch (error) {
      console.log("[Anikoto] MegaPlay extraction failed: " + String(error && error.message || error));
      return [];
    }
  }
  try {
    var html = await (await koFetch(embed, { headers: { "Referer": referer } }, 8000)).text();
    var links = html.match(/https?:\/\/[^"'\\s<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\\s<>]*)?/gi) || [], out = [];
    for (var i = 0; i < links.length; i++) {
      var ext2 = (links[i].match(/\.(m3u8|mp4|mpd)/i) || [, "mp4"])[1].toLowerCase();
      if (ext2 === "m3u8") out = out.concat(await koHls(links[i], label, lang, { Referer: referer }, []));
      else { var candidate = koCandidate(links[i], label, "Auto", ext2, lang, { Referer: referer }, []); if (candidate) out.push(candidate); }
    }
    if (out.length) return out;
    // Keep unresolved browser links as embed candidates for RAW's Android bridge.
    var browserCandidate = koCandidate(embed, label + " - Browser", "Auto", "embed", lang, { Referer: referer }, []);
    return browserCandidate ? [browserCandidate] : [];
  } catch (_) {
    var fallbackCandidate = koCandidate(embed, label + " - Browser", "Auto", "embed", lang, { Referer: referer }, []);
    return fallbackCandidate ? [fallbackCandidate] : [];
  }
}
async function koTrySearch(base, title) {
  var url = base + "/filter?keyword=" + encodeURIComponent(title) + "&page=1";
  var html = await (await koFetch(url, { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": base + "/" }) }, 6000)).text();
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
    console.log("[Anikoto] resolve start AniList=" + id + " episode=" + ep + " aliases=" + meta.titles.length);
    if (mapped) { var mv = typeof mapped === "object" ? mapped.url || mapped.slug || "" : String(mapped); if (mv) animeUrl = /^https?:\/\//i.test(mv) ? mv : ANIKOTO_MIRRORS[0] + (mv.charAt(0) === "/" ? "" : "/") + mv; }
    var baseUsed = ANIKOTO_MIRRORS[0];
    if (!animeUrl) {
      // Probe mirrors in parallel for each canonical AniList alias. The old nested
      // loop could spend 10s per mirror and routinely outlive the player request.
      for (var t = 0; t < Math.min(meta.titles.length, 3) && !animeUrl; t++) {
        var mirrorResults = await Promise.all(ANIKOTO_MIRRORS.map(async function (base) {
          try {
            var found = await koTrySearch(base, meta.titles[t]);
            return found ? { base: base, url: found } : null;
          } catch (_) { return null; }
        }));
        var validResults = mirrorResults.filter(Boolean);
        var pathKeys = validResults.map(function (r) {
          return r.url.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "").toLowerCase();
        }).filter(function (value, index, all) { return all.indexOf(value) === index; });
        // Mirror copies of the same exact title share a watch path. Refuse
        // ambiguous cross-site matches rather than binding the wrong anime.
        if (pathKeys.length === 1 && validResults.length) {
          animeUrl = validResults[0].url;
          baseUsed = validResults[0].base;
        }
      }
    }
    if (!animeUrl) { console.log("[Anikoto] no unique exact-title watch page for AniList=" + id); return []; }
    console.log("[Anikoto] matched watch page=" + animeUrl);
    var slug = animeUrl.replace(/\/+$/, "").split("/").pop();
    var detailHtml = await (await koFetch(animeUrl, { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": baseUsed + "/" }) }, 10000)).text();
    var siteId = (detailHtml.match(/data-id=["']([^"']+)["']/i) || detailHtml.match(/data-tip=["']([^"']+)["']/i) || [,""])[1];
    if (!siteId) { console.log("[Anikoto] matched page contains no media data-id"); return []; }
    var epResponse = await koJson(baseUsed + "/ajax/episode/list/" + encodeURIComponent(siteId) + "?vrf=" + koAnikotoVrf(siteId), {
      headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": animeUrl, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" })
    }, 10000);
    var epHtml = epResponse && epResponse.result || "", tags = epHtml.match(/<a\b[^>]*data-num=["'][^"']+["'][^>]*>/gi) || [], epTag = null;
    for (var e = 0; e < tags.length; e++) if (String(koAttr(tags[e], "data-num")) === String(ep)) { epTag = tags[e]; break; }
    if (!epTag) { console.log("[Anikoto] episode " + ep + " is absent from the matched catalogue"); return []; }
    var ids = koAttr(epTag, "data-ids"), malId = koAttr(epTag, "data-mal") || meta.idMal, mapperSlug = koAttr(epTag, "data-slug"), timestamp = koAttr(epTag, "data-timestamp");
    if (!ids) { console.log("[Anikoto] episode " + ep + " has no server IDs"); return []; }
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
    console.log("[Anikoto] matched episode " + ep + " servers=" + servers.length);
    var preferred = String(context.preferredAudio || "sub").toLowerCase();
    servers.sort(function (a, b) { return (a.type === preferred ? -1 : 0) - (b.type === preferred ? -1 : 0); });
    // Resolve independent server embeds concurrently; one slow mirror no longer
    // serially delays every other source for this episode.
    var serverTasks = servers.map(async function (server) {
      try {
        var embed = server.id;
        if (!/^https?:\/\//i.test(embed)) {
          var sr = await koJson(baseUsed + "/ajax/server?get=" + encodeURIComponent(server.id), {
            headers: Object.assign({}, ANIKOTO_HEADERS, {
              "Referer": animeUrl,
              "X-Requested-With": "XMLHttpRequest",
              "Accept": "application/json,*/*"
            })
          }, 6000);
          embed = sr && sr.result && sr.result.url || "";
        }
        if (!embed) return [];
        return await koResolveEmbed(embed, "Episode " + ep + " - " + server.name, server.type, baseUsed);
      } catch (error) {
        console.log("[Anikoto] server failed: " + String(error && error.message || error));
        return [];
      }
    });
    var serverResults = await Promise.all(serverTasks);
    var out = [];
    for (var srIndex = 0; srIndex < serverResults.length; srIndex++) {
      for (var candidateIndex = 0; candidateIndex < serverResults[srIndex].length; candidateIndex++) {
        out.push(serverResults[srIndex][candidateIndex]);
      }
    }
    // Mapper results are supplementary. Only direct public URLs are resolved.
    if (malId && mapperSlug && timestamp) {
      try {
        var mapper = await koJson(ANIKOTO_MAPPER + "/mal/" + encodeURIComponent(malId) + "/" + encodeURIComponent(mapperSlug) + "/" + encodeURIComponent(timestamp), { headers: Object.assign({}, ANIKOTO_HEADERS, { "Referer": baseUsed + "/", "Origin": baseUsed }) }, 8000);
        var keys = Object.keys(mapper || {});
        for (var x = 0; x < keys.length; x++) {
          if (keys[x].toLowerCase() === "status") continue;
          var data = mapper[keys[x]] || {};
          ["sub", "dub"].forEach(function (kind) { var u = data[kind] && data[kind].url; if (u && /^https:\/\//i.test(u)) out.push({ _embed: u, _label: "Episode " + ep + " - " + koMapperDisplayName(keys[x]), _lang: kind }); });
        }
      } catch (_) {}
    }
    var final = [], seen = {};
    for (var k = 0; k < out.length; k++) {
      var item = out[k];
      if (item && item._embed) { var more = await koResolveEmbed(item._embed, item._label, item._lang, baseUsed); for (var z = 0; z < more.length; z++) out.push(more[z]); continue; }
      if (!item || !item.url || seen[item.url]) continue;
      seen[item.url] = true; final.push(item);
    }
    console.log("[Anikoto] resolved " + final.length + " candidate(s) for AniList=" + id + " episode=" + ep);
    return final.map(function (c) { c.anilistId = id; c.episodeNumber = ep; return c; });
  } catch (e) { console.log("[Anikoto] " + String(e && e.message || e)); return []; }
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams, anikotoVrf: koAnikotoVrf, sogoVrf: koVrfEncrypt, searchAnime: koTrySearch };
