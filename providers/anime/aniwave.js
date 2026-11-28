/* AniWave (Unoriginal) — QuickJS playback port based on AniWave.kt/AniWaveExtractor.kt.
 * Preserves the provider-specific eight-stage VRF, episode/server APIs, hoster
 * discovery, mapper links, iframe/player recursion, MegaPlay API fallback order,
 * AES-CBC encrypted source decoding, and MewCDN fragment/host-map route.
 * The RAW native media proxy strips the source's image/junk segment wrappers and
 * rewrites all HLS child/key/audio URIs. Provider preferences/discovered-host
 * toggles are partially represented by invocation context; no browser challenge
 * or verification automation is performed.
 */
var ANIWAVE_ID = "aniwave";
var ANIWAVE_DOMAINS = ["https://animewave.to", "https://aniwave.cz", "https://aniwaves.ru"];
var ANIWAVE_MAPPER = "https://mapper.nekostream.site/api";
var ANIWAVE_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
var AW_MEGA_KEY = "i?LMTAx0Q6,:}50U";
var AW_MEGA_IV = "W0;27ToaUpl_P%'c";
var AW_DEFAULT_HOSTERS = ["HD-1", "Vidstream-2", "VidPlay", "VidCloud-1", "Kiwi-Stream", "VidPlay-1"];
var AW_EXCHANGE_1 = ["AP6GeR8H0lwUz1", "UAz8Gwl10P6ReH"];
var AW_EXCHANGE_2 = ["1majSlPQd2M5", "da1l2jSmP5QM"];
var AW_EXCHANGE_3 = ["CPYvHj09Au3", "0jHA9CPYu3v"];
var AW_ORDER = [
  ["exchange", AW_EXCHANGE_1],
  ["rc4", "ItFKjuWokn4ZpB"],
  ["rc4", "fOyt97QWFB3"],
  ["exchange", AW_EXCHANGE_2],
  ["exchange", AW_EXCHANGE_3],
  ["reverse", null],
  ["rc4", "736y1uTJpBLUX"],
  ["base64", null]
];

function awContext(extra) {
  return Object.assign({}, (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {}, extra || {});
}
function awBase(context) {
  var requested = String(context.preferredDomain || context.domain || ANIWAVE_DOMAINS[0]).replace(/\/+$/, "");
  return ANIWAVE_DOMAINS.indexOf(requested) >= 0 ? requested : ANIWAVE_DOMAINS[0];
}
function awHeaders(base, referer) {
  return {
    "User-Agent": ANIWAVE_UA,
    "Accept": "text/html,application/json,application/xhtml+xml,*/*",
    "Referer": referer || base + "/",
    "X-Requested-With": "XMLHttpRequest"
  };
}
async function awFetch(url, headers, method, body) {
  var init = { headers: headers || {} };
  if (method) init.method = method;
  if (body !== undefined) init.body = body;
  var response = await fetch(url, init);
  if (!response || !response.ok) throw new Error("AniWave HTTP " + (response ? response.status : "network"));
  return response;
}
async function awText(url, headers, method, body) {
  return await (await awFetch(url, headers, method, body)).text();
}
async function awJson(url, headers, method, body) {
  var response = await awFetch(url, headers, method, body);
  return await response.json();
}
function awBase64Url(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] & 255);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}
function awBytes(text) {
  var out = new Uint8Array(String(text).length);
  for (var i = 0; i < out.length; i++) out[i] = String(text).charCodeAt(i) & 255;
  return out;
}
function awRc4(key, input) {
  var s = new Uint8Array(256);
  for (var i = 0; i < 256; i++) s[i] = i;
  var j = 0;
  for (var k = 0; k < 256; k++) {
    j = (j + s[k] + key.charCodeAt(k % key.length)) & 255;
    var tmp = s[k]; s[k] = s[j]; s[j] = tmp;
  }
  var output = new Uint8Array(input.length), i2 = 0, j2 = 0;
  for (var n = 0; n < input.length; n++) {
    i2 = (i2 + 1) & 255;
    j2 = (j2 + s[i2]) & 255;
    var swap = s[i2]; s[i2] = s[j2]; s[j2] = swap;
    output[n] = input.charCodeAt(n) ^ s[(s[i2] + s[j2]) & 255];
  }
  return awBase64Url(output);
}
function awExchange(input, keys) {
  var from = keys[0], to = keys[1], out = "";
  for (var i = 0; i < input.length; i++) {
    var index = from.indexOf(input.charAt(i));
    out += index >= 0 ? to.charAt(index) : input.charAt(i);
  }
  return out;
}
function awRot(input) { return String(input).split("").reverse().join(""); }
function awVrf(input) {
  var value = String(input);
  for (var i = 0; i < AW_ORDER.length; i++) {
    var stage = AW_ORDER[i];
    if (stage[0] === "exchange") value = awExchange(value, stage[1]);
    else if (stage[0] === "rc4") value = awRc4(stage[1], value);
    else if (stage[0] === "reverse") value = awRot(value);
    else if (stage[0] === "base64") value = btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_");
  }
  return encodeURIComponent(value);
}
function awNorm(value) {
  var text = String(value || "").toLowerCase();
  if (text.normalize) text = text.normalize("NFKC");
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}
function awAliases(context) {
  return [].concat(context.title || [], context.titles || [], context.aliases || []).map(function (value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    return value.english || value.romaji || value.native || value.title || "";
  }).filter(Boolean).map(String).filter(function (value, index, all) {
    return all.findIndex(function (other) { return awNorm(other) === awNorm(value); }) === index;
  }).slice(0, 24);
}
async function awAniList(id, context) {
  var titles = awAliases(context);
  if (titles.length) return { id: String(id), titles: titles };
  var query = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native userPreferred } synonyms } }";
  var res = await awJson("https://graphql.anilist.co", {
    "Content-Type": "application/json",
    "Accept": "application/json"
  }, "POST", JSON.stringify({ query: query, variables: { id: Number(id) } }));
  var media = res && res.data && res.data.Media;
  if (!media || String(media.id) !== String(id)) throw new Error("AniWave AniList ID mismatch");
  return {
    id: String(media.id),
    titles: [media.title && media.title.english, media.title && media.title.romaji, media.title && media.title.native, media.title && media.title.userPreferred].concat(media.synonyms || []).filter(Boolean)
  };
}
async function awFindWatchPage(base, meta) {
  for (var t = 0; t < Math.min(meta.titles.length, 8); t++) {
    var title = meta.titles[t];
    var url = base + "/filter?keyword=" + encodeURIComponent(title) + "&page=1&vrf=" + awVrf(title);
    var html = await awText(url, awHeaders(base, base + "/"));
    var anchors = html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || [];
    var matches = [];
    for (var i = 0; i < anchors.length; i++) {
      var open = (anchors[i].match(/^<a\b[^>]*>/i) || [""])[0];
      var href = awAttr(open, "href");
      var text = awHtmlText(anchors[i]);
      if (!href || !/\/watch\//i.test(href) || awNorm(text) !== awNorm(title)) continue;
      matches.push(awResolve(base, href).split("?")[0]);
    }
    matches = matches.filter(function (value, index, all) { return all.indexOf(value) === index; });
    if (matches.length > 1) throw new Error("AniWave search title is ambiguous");
    if (matches.length === 1) return matches[0];
  }
  return "";
}
function awAttr(tag, name) {
  var match = String(tag || "").match(new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  return match ? match[1] || match[2] || match[3] || "" : "";
}
function awHtmlText(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function awResolve(base, value) {
  try { return new URL(value, base).toString(); } catch (_) { return value; }
}
function awType(labelText, dataType) {
  var label = String(labelText || "").trim().toLowerCase(), type = String(dataType || "").trim().toLowerCase();
  if (["sub","h-sub","hsub","dub","a-dub","adub","s-sub"].indexOf(label) >= 0) return label;
  if (type) return type;
  return label || "unknown";
}
function awServerData(html, context) {
  var source = String(html || ""), types = [], token = /<div\b[^>]*>|<\/div>/gi, match;
  while ((match = token.exec(source)) !== null) {
    if (!/^<div\b/i.test(match[0]) || !/\bclass\s*=\s*["'][^"']*\btype\b[^"']*["']/i.test(match[0])) continue;
    var start = match.index, depth = 1, scan = /<div\b[^>]*>|<\/div>/gi;
    scan.lastIndex = token.lastIndex;
    var nested;
    while (depth > 0 && (nested = scan.exec(source)) !== null) {
      if (/^<\/div/i.test(nested[0])) depth--;
      else depth++;
    }
    if (depth === 0) {
      types.push(source.slice(start, scan.lastIndex));
      token.lastIndex = scan.lastIndex;
    } else {
      break;
    }
  }
  var hostAllow = Array.isArray(context.hostToggle) ? context.hostToggle.map(String) : null;
  var typeAllow = Array.isArray(context.typeToggle) ? context.typeToggle.map(String) : null;
  var servers = [];
  for (var i = 0; i < types.length; i++) {
    var header = (types[i].match(/^<div\b[^>]*>/i) || [""])[0];
    var label = awType(awHtmlText((types[i].match(/<label\b[^>]*>([\s\S]*?)<\/label>/i) || [,""])[1]), awAttr(header, "data-type"));
    if (typeAllow && !typeAllow.some(function (v) { return v.toLowerCase() === label.toLowerCase(); })) continue;
    var lis = types[i].match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    for (var j = 0; j < lis.length; j++) {
      var tag = (lis[j].match(/^<li\b[^>]*>/i) || [""])[0];
      if (/\bclass=["'][^"']*download-icon/i.test(tag)) continue;
      var id = awAttr(tag, "data-link-id"), name = awHtmlText(lis[j]);
      if (!id || !name) continue;
      if (hostAllow && !hostAllow.some(function (v) { return v.toLowerCase() === name.toLowerCase(); })) continue;
      servers.push({ type: label, serverId: id, serverName: name });
    }
  }
  return servers;
}
function awMapperName(key) {
  if (/^gogoanime$/i.test(key)) return "Vidstream";
  if (/^anivibe$/i.test(key)) return "Vibe-Stream";
  if (/^animepahe$/i.test(key)) return "Kiwi-Stream";
  if (/^kiwi-stream/i.test(key)) return "Kiwi-Stream";
  return String(key).replace(/^./, function (ch) { return ch.toUpperCase(); });
}
async function awMapperServers(episodeUrl, context) {
  var malId = (episodeUrl.match(/[?&]mal=([^&]+)/) || [,""])[1];
  var slug = (episodeUrl.match(/[?&]slug=([^&]+)/) || [,""])[1];
  var ts = (episodeUrl.match(/[?&]ts=([^&]+)/) || [,""])[1];
  if (!malId || !slug || !ts) return [];
  var mapperUrl = ANIWAVE_MAPPER + "/mal/" + encodeURIComponent(malId) + "/" + encodeURIComponent(slug) + "/" + encodeURIComponent(ts);
  try {
    var data = await awJson(mapperUrl, { "Accept": "application/json,*/*", "Referer": context.baseUrl || ANIWAVE_DOMAINS[0] + "/", "Origin": context.baseUrl || ANIWAVE_DOMAINS[0] });
    var result = [];
    Object.keys(data || {}).forEach(function (key) {
      if (key.toLowerCase() === "status") return;
      var name = awMapperName(key), server = data[key] || {};
      [["sub","H-Sub"],["dub","A-Dub"]].forEach(function (pair) {
        var link = server[pair[0]] && server[pair[0]].url;
        if (link) result.push({ type: pair[1], serverId: link, serverName: name });
      });
    });
    return result;
  } catch (_) { return []; }
}
async function awServerEmbed(base, serverId, epUrl) {
  if (/^https?:\/\//i.test(serverId)) return serverId;
  var url = base + "/ajax/server?get=" + encodeURIComponent(serverId);
  var data = await awJson(url, awHeaders(base, awResolve(base, epUrl)));
  return data && data.result && data.result.url || "";
}
function awParseServerTypes(html, context) { return awServerData(html, context); }
async function awEpisodeServerList(base, episodeIds, epUrl) {
  var headers = awHeaders(base, awResolve(base, epUrl));
  var url = base + "/ajax/server/list?servers=" + encodeURIComponent(episodeIds);
  return await awText(url, headers);
}
async function awGetSources(apiHost, dataId, streamType, embedUrl, pageHeaders) {
  var urlParts = [];
  try { var parsed = new URL(embedUrl); var s = parsed.searchParams.get("s"); if (s) urlParts.push(s); } catch (_) {}
  urlParts.push("tcdn","bcdn","");
  urlParts = urlParts.filter(function (v,index,all) { return all.indexOf(v)===index; }).slice(0,4);
  var lastError = null;
  for (var i = 0; i < urlParts.length; i++) {
    var sVal = urlParts[i], suffix = sVal ? "&s=" + encodeURIComponent(sVal) : "";
    var endpoints = [
      ["getSources",false],
      ["getSourcesNew",true]
    ];
    for (var j = 0; j < endpoints.length; j++) {
      var endpoint = endpoints[j][0];
      var url = "https://" + apiHost + "/stream/" + endpoint + "?id=" + encodeURIComponent(dataId) + "&id=" + encodeURIComponent(dataId) + "&type=" + encodeURIComponent(streamType) + "&type=" + encodeURIComponent(streamType) + suffix;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          var json = await awJson(url, pageHeaders);
          var sources = awSourcesValue(json);
          var enc = String(json && json.enc || "");
          if ((sources && /^https?:\/\//i.test(sources)) || enc) return { data: json, usedNew: endpoints[j][1] };
          lastError = new Error("AniWave API returned no source");
        } catch (error) { lastError = error; }
        if (attempt === 0) await new Promise(function (resolve) { setTimeout(resolve, 700); });
      }
    }
  }
  throw lastError || new Error("AniWave source API failed");
}
function awSourcesValue(data) {
  var sources = data && data.sources;
  if (typeof sources === "string") return sources;
  if (sources && typeof sources === "object") {
    if (sources.file) return String(sources.file);
    if (Array.isArray(sources) && sources.length) {
      var first = sources[0];
      return typeof first === "string" ? first : String(first && first.file || "");
    }
  }
  return "";
}
function awDecryptEnc(enc) {
  if (!enc || typeof crypto === "undefined" || !crypto.subtle) return "";
  try {
    var rawText = atob(String(enc).replace(/-/g,"+").replace(/_/g,"/"));
    var raw = new Uint8Array(rawText.length);
    for (var i = 0; i < raw.length; i++) raw[i] = rawText.charCodeAt(i);
    var key = new Uint8Array(32), keySrc = new TextEncoder().encode(AW_MEGA_KEY);
    key.set(keySrc.slice(0,32));
    var iv = new TextEncoder().encode(AW_MEGA_IV);
    return crypto.subtle.importKey("raw", key, {name:"AES-CBC"}, false, ["decrypt"]).then(function(k){
      return crypto.subtle.decrypt({name:"AES-CBC",iv:iv},k,raw);
    }).then(function(buf){
      var data=JSON.parse(new TextDecoder().decode(buf));
      return String(data.file||"");
    }).catch(function(){ return ""; });
  } catch (_) { return Promise.resolve(""); }
}
function awMime(url, declared) {
  var value = String(declared || "").toLowerCase();
  if (value === "hls" || /\.m3u8(?:$|[?#])/i.test(url)) return "m3u8";
  if (value === "dash" || /\.mpd(?:$|[?#])/i.test(url)) return "mpd";
  if (/\.mp4(?:$|[?#])/i.test(url)) return "mp4";
  return "m3u8";
}
function awQuality(height) {
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
function awProxy(url, headers, options) {
  if (typeof globalThis.__raw_create_media_proxy !== "function") throw new Error("RAW AniWave media proxy is unavailable");
  return String(globalThis.__raw_create_media_proxy(url, JSON.stringify(headers || {}), JSON.stringify(options || {})));
}
async function awResolvePlayer(embedUrl, server, base, context, depth) {
  if (!embedUrl || depth > 4) return [];
  if (/mewcdn\.online\/player\/plyr\.php/i.test(embedUrl)) return await awResolveMewcdn(embedUrl, server, base, context);
  if (/\.m3u8(?:$|[?#])/i.test(embedUrl) && !embedUrl.includes("/stream/")) return await awDirect(embedUrl,server,base + "/",context);
  var html = await awText(embedUrl, awHeaders(base, base + "/"));
  var dataId = (html.match(/data-id="([^"]+)"/i) || [,""])[1];
  if (dataId) return await awResolveMegaSources(embedUrl, dataId, server, base, context);
  var iframe = (html.match(/<iframe[^>]+src=["']([^"']+)["']/i) || [,""])[1];
  if (iframe) return await awResolvePlayer(awResolve(embedUrl,iframe),server,base,context,depth+1);
  var direct = (html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i) || [,""])[1];
  if (direct) {
    var host = new URL(embedUrl).host;
    return await awDirect(direct,server,"https://" + host + "/",context);
  }
  var source = (html.match(/<source[^>]+src=["']([^"']+\.m3u8[^"']*)["']/i) || [,""])[1];
  if (source) {
    var resolved = awResolve(embedUrl,source);
    var host2 = new URL(embedUrl).host;
    return await awDirect(resolved,server,"https://" + host2 + "/",context);
  }
  var jsUrl = (html.match(/(?:var|let|const)\s+\w+\s*=\s*["']([^"']*(?:\.m3u8|\/stream\/)[^"']*)["']/i) || html.match(/(?:file|source|url|src)\s*[:=]\s*["']([^"']*(?:\.m3u8|\/stream\/)[^"']*)["']/i) || [,""])[1];
  if (jsUrl) {
    var resolvedUrl=awResolve(embedUrl,jsUrl);
    if (/\.m3u8|\/stream\//i.test(resolvedUrl)) return await awDirect(resolvedUrl,server,"https://" + new URL(embedUrl).host + "/",context);
  }
  return [];
}
async function awResolveMegaSources(embedUrl,dataId,server,base,context) {
  var host = new URL(embedUrl).host;
  var streamType = new URL(embedUrl).pathname.split("/").pop();
  if (streamType !== "sub" && streamType !== "dub") streamType = "";
  var headers = {
    "User-Agent":ANIWAVE_UA,
    "Accept":"*/*",
    "X-Requested-With":"XMLHttpRequest",
    "Referer":embedUrl,
    "Origin":"https://" + host
  };
  var result = await awGetSources(host,dataId,streamType,embedUrl,headers);
  var data=result.data||{};
  var master = awSourcesValue(data);
  if (!/^https?:\/\//i.test(master)) master=await awDecryptEnc(data.enc);
  if (!/^https?:\/\//i.test(master)) return [];
  var subtitles=(Array.isArray(data.tracks)?data.tracks:[]).filter(function(x){return x&&String(x.kind).toLowerCase()==="captions";}).map(function(x){return {url:x.file,lang:x.label||"Unknown",format:"vtt"};});
  var candidate=await awProxyCandidate(master,server,"https://"+host+"/",context,subtitles,{
    stripMode:"png-webp",
    proxyRequired:result.usedNew || /megaplay\.buzz/i.test(host)
  });
  return candidate?[candidate]:[];
}
async function awDirect(url,server,referer,context,subtitles) {
  var ext=awMime(url);
  return await awProxyCandidate(url,server,referer,context,subtitles||[],{stripMode:"image-to-ts",proxyRequired:false,type:ext});
}
async function awProxyCandidate(url,server,referer,context,subtitles,options) {
  var type=options.type||"m3u8";
  var headers={"User-Agent":ANIWAVE_UA,"Referer":referer,"Origin":referer.replace(/\/$/,"")};
  var proxyUrl=url;
  var requiresNativeProxy=options.proxyRequired===true || options.stripMode==="png-webp" || options.stripMode==="image-to-ts";
  if (type==="m3u8" || requiresNativeProxy) {
    proxyUrl=awProxy(url,headers,{
      rewriteManifests:type==="m3u8",
      stripMode:requiresNativeProxy ? (options.stripMode || "image-to-ts") : "none",
      xorOnlyWhenStripped:true,
      forceSegmentContentType:requiresNativeProxy,
      sessionTtlMillis:7200000
    });
  }
  var name=String(server.serverName||"AniWave").trim();
  var title="AniWave " + name + (server.type ? " - "+server.type : "");
  return {
    name:title,title:title,url:proxyUrl,type:type,quality:"Auto",provider:ANIWAVE_ID,
    headers:headers,subtitles:subtitles||[],anilistId:String(context.anilistId),episodeNumber:Number(context.episodeNumber)
  };
}
async function awResolveMewcdn(embedUrl,server,base,context) {
  var fragment=String(embedUrl).split("#")[1]||"";
  if (!fragment) return [];
  var decoded="";
  try { decoded=decodeURIComponent(escape(atob(fragment))); } catch (_) { try{decoded=atob(fragment);}catch(__){} }
  if (!/^https?:\/\//i.test(decoded)) return [];
  var html=await awText(embedUrl,awHeaders(base,base+"/"));
  var map=(html.match(/var HOST_MAP\s*=\s*\{([^}]+)\}/i)||[,""])[1];
  if(map){
    var entries=/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g,match;
    while((match=entries.exec(map))!==null) if(decoded.indexOf(match[1])>=0){decoded=decoded.replace(match[1],match[2]);break;}
  }
  return await awDirect(decoded,server,"https://mewcdn.online/",context);
}
async function awGetEmbedServer(base,serverId,epUrl) {
  if (/^https?:\/\//i.test(serverId)) return serverId;
  var result=await awJson(base+"/ajax/server?get="+encodeURIComponent(serverId),awHeaders(base,awResolve(base,epUrl)));
  return result&&result.result&&result.result.url||"";
}
async function awMapperUrl(context,episodeUrl) { return await awMapperServers(episodeUrl,context); }
async function awEpisodeServers(base,ids,epUrl,context) {
  var html=await awEpisodeServerList(base,ids,epUrl);
  var servers=awParseServerTypes(html,context);
  var mapper=await awMapperUrl(context,epUrl);
  return servers.concat(mapper);
}
async function getStreams(anilistId,mediaType,season,episode,extraArgs) {
  try {
    if(mediaType!=="anime") return [];
    var id=String(anilistId||""), ep=Number(episode||(extraArgs&&extraArgs.episodeNumber));
    if(!/^[1-9]\d*$/.test(id)||!Number.isFinite(ep)||ep<=0) return [];
    var context=awContext(extraArgs);
    context.anilistId=id; context.episodeNumber=ep; context.season=Number(season||context.season||1);
    var base=awBase(context);
    var meta=await awAniList(id,context);
    var watch=String(context.watchUrl||"");
    if (watch && !/^https?:\/\//i.test(watch)) watch=awResolve(base,watch);
    if (!watch) watch=await awFindWatchPage(base,meta);
    if (!watch) return [];
    var page=await awText(watch,awHeaders(base,base+"/"));
    var resolvedUrl=watch;
    var titleHtml=page;
    var animeId=(page.match(/data-id=["']([^"']+)["']/i)||page.match(/data-tip=["']([^"']+)["']/i)||[,""])[1]||"";
    if (!animeId) return [];
    var epData=await awJson(base+"/ajax/episode/list/"+encodeURIComponent(animeId),awHeaders(base,watch));
    var epHtml=epData&&epData.result||"";
    var tags=epHtml.match(/<a\b[^>]*data-num=["'][^"']+["'][^>]*>/gi)||[];
    var selected=null;
    for(var e=0;e<tags.length;e++) if(Number(awAttr(tags[e],"data-num"))===ep){selected=tags[e];break;}
    if(!selected) return [];
    var ids=awAttr(selected,"data-ids");
    var malId=awAttr(selected,"data-mal");
    var slug=awAttr(selected,"data-slug");
    var ts=awAttr(selected,"data-timestamp");
    var epUrlPart=(watch.replace(/^https?:\/\/[^/]+/i,"").replace(/\/+$/,""))+"/ep-"+ep;
    if(malId) epUrlPart += (epUrlPart.indexOf("?") >= 0 ? "&" : "?") + "mal=" + encodeURIComponent(malId);
    if(slug) epUrlPart += (epUrlPart.indexOf("?") >= 0 ? "&" : "?") + "slug=" + encodeURIComponent(slug);
    if(ts) epUrlPart += (epUrlPart.indexOf("?") >= 0 ? "&" : "?") + "ts=" + encodeURIComponent(ts);
    var serverList=await awEpisodeServers(base,ids,epUrlPart,context);
    var preferred=String(context.preferredServer||"");
    serverList.sort(function(a,b){return Number(String(b.serverName).toLowerCase()===preferred.toLowerCase())-Number(String(a.serverName).toLowerCase()===preferred.toLowerCase());});
    var unique={}; serverList=serverList.filter(function(s){var k=s.type+"|"+s.serverId;if(unique[k])return false;unique[k]=true;return true;}).slice(0,30);
    var resolved=await Promise.all(serverList.map(async function(server){
      try{
        var embed=await awGetEmbedServer(base,server.serverId,epUrlPart);
        return await awResolvePlayer(embed,server,base,context,0);
      }catch(error){console.log("[AniWave] "+server.serverName+" failed: "+String(error&&error.message||error));return [];}
    }));
    var finalCandidates=resolved.reduce(function(all,items){return all.concat(items||[]);},[]);
    // Mirror AniWave's sortHosterVideos contract: preferred audio type first,
    // preferred quality next, then the exact canonical resolution order.
    var preferredType=String(context.preferredType||"").toLowerCase();
    var preferredQuality=String(context.preferredQuality||"").toLowerCase();
    var qualityOrder=["2160p","1440p","1080p","720p","480p","360p","240p","144p"];
    finalCandidates.sort(function(left,right){
      var leftType=preferredType && String(left.title||"").toLowerCase().indexOf(preferredType)>=0?1:0;
      var rightType=preferredType && String(right.title||"").toLowerCase().indexOf(preferredType)>=0?1:0;
      if(leftType!==rightType) return rightType-leftType;
      var leftPreferred=preferredQuality && String(left.title||"").toLowerCase().indexOf(preferredQuality)>=0?1:0;
      var rightPreferred=preferredQuality && String(right.title||"").toLowerCase().indexOf(preferredQuality)>=0?1:0;
      if(leftPreferred!==rightPreferred) return rightPreferred-leftPreferred;
      var lq=qualityOrder.findIndex(function(q){return String(left.title||"").toLowerCase().indexOf(q)>=0;});
      var rq=qualityOrder.findIndex(function(q){return String(right.title||"").toLowerCase().indexOf(q)>=0;});
      return (lq<0?qualityOrder.length:lq)-(rq<0?qualityOrder.length:rq);
    });
    return finalCandidates;
  }catch(error){console.log("[AniWave] resolve failed: "+String(error&&error.message||error));return [];}
}
if(typeof globalThis!=="undefined") globalThis.getStreams=getStreams;
if(typeof module!=="undefined"&&module.exports) module.exports={
 getStreams:getStreams,
 __test:{vrf:awVrf,exchange:awExchange,rc4:awRc4,parseServerList:awParseServerTypes,quality:awQuality}
};
