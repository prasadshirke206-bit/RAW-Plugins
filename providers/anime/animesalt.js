/* AnimeSalt — Wordpress anime pages + episode server data + public MegaPlay.
 * Exact AniList title alias matching is required; unsupported embeds are dropped.
 */

/* BEGIN RAW SHARED EXTRACTORS — GENERATED; DO NOT EDIT */
/* RAW shared anime hoster extractors.
 * Source of truth for standalone provider bundles. Keep this runtime-neutral:
 * only fetch, URL, timers, and standard JS primitives are used.
 */
(function (root) {
  "use strict";

  var VM_BASE = "https://vidmoly.biz";

  function validRequest(options) {
    var id = String(options && options.anilistId || "");
    var episode = Number(options && options.episodeNumber || 0);
    return /^[1-9]\d*$/.test(id) && Number.isFinite(episode) && episode > 0;
  }

  function absolute(url, base) {
    try { return new URL(String(url || ""), base).toString(); }
    catch (_) { return ""; }
  }

  function candidate(options, url, label, quality, type, headers, subtitles) {
    if (!validRequest(options) || !url || !/^https:\/\//i.test(url)) return null;
    return {
      name: label,
      title: label,
      url: url,
      quality: quality || "Auto",
      type: type || "mp4",
      provider: String(options.provider || ""),
      language: String(options.language || "multi"),
      headers: headers || {},
      subtitles: subtitles || [],
      anilistId: String(options.anilistId),
      episodeNumber: Number(options.episodeNumber)
    };
  }

  async function request(url, headers, timeoutMs) {
    var timer;
    var response = await Promise.race([
      fetch(url, { headers: headers || {} }),
      new Promise(function (_, reject) {
        timer = setTimeout(function () { reject(new Error("extractor request timeout")); }, timeoutMs || 10000);
      })
    ]).finally(function () { clearTimeout(timer); });
    if (!response || !response.ok) throw new Error("extractor HTTP " + (response ? response.status : "network"));
    return response;
  }

  function decodeTitle(html) {
    var raw = (String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1];
    return raw.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
  }

  function randomToken(length) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var value = "";
    for (var i = 0; i < (length || 10); i++) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return value;
  }

  async function dood(url, options) {
    options = options || {};
    if (!validRequest(options) || !/^https?:\/\//i.test(String(url || ""))) return [];
    try {
      var pageResponse = await request(url, options.pageHeaders || {}, 10000);
      var pageUrl = pageResponse.url || url;
      var html = await pageResponse.text();
      if (html.indexOf("'/pass_md5/") < 0 && html.indexOf('"/pass_md5/') < 0) return [];

      var passPath = (html.match(/\/pass_md5\/[^'"\s<>]+/i) || [])[0];
      if (!passPath) return [];
      var pageOrigin = new URL(pageUrl).origin;
      var passUrl = pageOrigin + passPath;
      var token = passUrl.substring(passUrl.lastIndexOf("/") + 1);
      var passResponse = await request(passUrl, { Referer: pageUrl }, 10000);
      var start = String(await passResponse.text() || "").trim();
      if (!/^https:\/\//i.test(start)) return [];

      var expiry = Date.now();
      var videoUrl = start + randomToken(10) + "?token=" + token + "&expiry=" + expiry;
      if (!/^https:\/\//i.test(videoUrl)) return [];

      var quality = (decodeTitle(html).match(/\b\d{3,4}p\b/i) || [])[0] || "";
      var serverLabel = "Doodstream" + (quality ? " " + quality : " mirror");
      var label = options.labelPrefix ? String(options.labelPrefix) + " - " + serverLabel : serverLabel;
      var headers = { "User-Agent": "Aniyomi", "Referer": pageOrigin + "/" };
      var item = candidate(options, videoUrl, label, quality || "Auto", "mp4", headers, options.subtitles || []);
      return item ? [item] : [];
    } catch (error) {
      if (options.log) options.log("[Dood] " + String(error && error.message || error));
      return [];
    }
  }

  async function streamtape(url, options) {
    options = options || {};
    if (!validRequest(options) || !/^https?:\/\//i.test(String(url || ""))) return [];
    try {
      var input = new URL(url);
      var pathParts = input.pathname.split("/").filter(Boolean);
      var id = pathParts.length > 1 ? pathParts[1] : "";
      if (!id) return [];

      // Matches the Kotlin StreamTapeExtractor's canonical /e/{id} URL.
      var embedUrl = "https://streamtape.com/e/" + encodeURIComponent(id);
      var response = await request(embedUrl, options.pageHeaders || {}, 10000);
      var html = await response.text();
      var marker = "document.getElementById('robotlink')";
      var scriptAt = html.indexOf(marker);
      if (scriptAt < 0) return [];
      var scriptEnd = html.indexOf("</script>", scriptAt);
      var script = html.slice(scriptAt, scriptEnd < 0 ? html.length : scriptEnd);
      var assignment = marker + ".innerHTML = '";
      var assignAt = script.indexOf(assignment);
      if (assignAt < 0) return [];
      var afterStart = script.slice(assignAt + assignment.length);
      var first = afterStart.split("'")[0];
      var suffixMarker = "+ ('xcd";
      var suffixAt = script.indexOf(suffixMarker, assignAt);
      if (suffixAt < 0) return [];
      var suffix = script.slice(suffixAt + suffixMarker.length).split("'")[0];
      var videoUrl = "https:" + first + suffix;
      if (!/^https:\/\//i.test(videoUrl)) return [];

      var label = String(options.labelPrefix || "Streamtape");
      var item = candidate(options, videoUrl, label, "Auto", "mp4", options.videoHeaders || {}, options.subtitles || []);
      return item ? [item] : [];
    } catch (error) {
      if (options.log) options.log("[StreamTape] " + String(error && error.message || error));
      return [];
    }
  }

  function parseAttributes(line) {
    var attrs = {};
    var re = /([A-Z0-9-]+)=("(?:[^"]*)"|[^,]*)/gi;
    var match;
    while ((match = re.exec(line)) !== null) {
      attrs[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
    }
    return attrs;
  }

  function quality(height) {
    var value = Number(height || 0);
    if (value >= 2160) return "2160p";
    if (value >= 1440) return "1440p";
    if (value >= 1080) return "1080p";
    if (value >= 720) return "720p";
    if (value >= 480) return "480p";
    if (value >= 360) return "360p";
    if (value >= 240) return "240p";
    if (value >= 144) return "144p";
    return "Auto";
  }

  async function hlsCandidates(masterUrl, options, labelPrefix, headers, externalSubtitles) {
    var response = await request(masterUrl, headers, 10000);
    var body = await response.text();
    if (body.indexOf("#EXTM3U") < 0) return [];

    var subtitles = (externalSubtitles || []).slice();
    var lines = body.split(/\r?\n/);
    var hasAudioGroup = false;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (/^#EXT-X-MEDIA:/i.test(trimmed)) {
        var attrs = parseAttributes(trimmed);
        if (String(attrs.TYPE || "").toUpperCase() === "AUDIO") hasAudioGroup = true;
        if (String(attrs.TYPE || "").toUpperCase() === "SUBTITLES" && attrs.URI) {
          var subUrl = absolute(attrs.URI, masterUrl);
          if (subUrl && /^https:\/\//i.test(subUrl) && !subtitles.some(function (s) { return s.url === subUrl; })) {
            subtitles.push({ url: subUrl, lang: attrs.LANGUAGE || attrs.NAME || "Subtitle" });
          }
        }
      }
    }

    var out = [];
    if (!hasAudioGroup) {
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var height = (lines[j].match(/RESOLUTION=\d+x(\d+)/i) || [,""])[1];
        var child = "";
        for (var k = j + 1; k < lines.length; k++) {
          var next = lines[k].trim();
          if (next && next.charAt(0) !== "#") { child = next; break; }
        }
        if (!child) continue;
        var variantUrl = absolute(child, masterUrl);
        var q = quality(height);
        var label = labelPrefix ? labelPrefix + " " + q : "VidMoly - " + q;
        var item = candidate(options, variantUrl, label, q, "m3u8", headers, subtitles);
        if (item) out.push(item);
      }
    }

    // When the master declares separate audio groups, keep the master URL intact.
    // Stripping variants would sever the AUDIO group mapping used by the Kotlin player.
    if (!out.length) {
      var masterLabel = labelPrefix ? labelPrefix + " Auto" : "VidMoly - Auto";
      var master = candidate(options, masterUrl, masterLabel, "Auto", "m3u8", headers, subtitles);
      if (master) out.push(master);
    }
    return out;
  }

  async function vidmoly(url, options) {
    options = options || {};
    if (!validRequest(options) || !/^https?:\/\//i.test(String(url || ""))) return [];
    try {
      var input = new URL(url);
      var fixedUrl;
      if (String(url).toLowerCase().indexOf(VM_BASE) === 0) {
        fixedUrl = url;
      } else {
        fixedUrl = VM_BASE + "/" + input.pathname.replace(/^\/+/, "") + input.search;
      }
      var headers = { Origin: VM_BASE, Referer: VM_BASE + "/" };
      var pageResponse = await request(fixedUrl, headers, 10000);
      var html = await pageResponse.text();
      var scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [html];
      var found = [];
      for (var i = 0; i < scripts.length; i++) {
        if (!/sources/i.test(scripts[i])) continue;
        var block = (scripts[i].match(/sources\s*:\s*(.+?]),/is) || [,""])[1];
        if (!block) continue;
        var fileRe = /file\s*:\s*["'](.+?)["']/gi;
        var match;
        while ((match = fileRe.exec(block)) !== null) {
          var playlist = absolute(match[1], fixedUrl);
          if (/^https:\/\//i.test(playlist) && !found.includes(playlist)) found.push(playlist);
        }
      }

      var out = [];
      for (var j = 0; j < found.length; j++) {
        var prefix = String(options.labelPrefix || "");
        out = out.concat(await hlsCandidates(found[j], options, prefix, headers, options.subtitles || []));
      }
      return out;
    } catch (error) {
      if (options.log) options.log("[VidMoly] " + String(error && error.message || error));
      return [];
    }
  }

  root.RAWAnimeExtractors = {
    dood: dood,
    streamtape: streamtape,
    vidmoly: vidmoly,
    hlsCandidates: hlsCandidates
  };
})(globalThis);
/* END RAW SHARED EXTRACTORS */
var AZ_ID="animesalt",AZ_BASE="https://animesalt.me",AZ_MEGA="https://megaplay.buzz";
function azCtx(){return(globalThis&&globalThis.__CALL_ARGS__)||{};}
async function azFetch(u,o){var t;var r=await Promise.race([fetch(u,o||{}),new Promise(function(_,j){t=setTimeout(function(){j(new Error("timeout"));},10000);})]).finally(function(){clearTimeout(t);});if(!r||!r.ok)throw new Error("HTTP "+(r?r.status:"network"));return r;}
function azNorm(s){return String(s||"").toLowerCase().normalize?String(s||"").toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g," ").trim():String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function azAbs(u,b){try{return new URL(u,b||AZ_BASE).toString();}catch(_){return u;}}
async function azMeta(id,c){var a=[].concat(c.title||[],c.titles||[],c.aliases||[]).map(function(x){return typeof x==="string"?x:x&&(x.english||x.romaji||x.native)||"";}).filter(Boolean);if(a.length)return{id:String(id),titles:a};var q="query($id:Int){Media(id:$id,type:ANIME){id title{english romaji native userPreferred} synonyms}}";var r=await(await azFetch("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q,variables:{id:Number(id)}})})).json();var m=r&&r.data&&r.data.Media;if(!m||String(m.id)!==String(id))throw new Error("AniList mismatch");return{id:String(m.id),titles:[m.title&&m.title.userPreferred,m.title&&m.title.english,m.title&&m.title.romaji,m.title&&m.title.native].concat(m.synonyms||[]).filter(Boolean)};}
async function azFind(meta,c){var map=c.providerMappings&&c.providerMappings.animesalt;if(map){var u=typeof map==="object"?(map.url||map.slug):map;if(u)return azAbs(String(u));}for(var i=0;i<Math.min(4,meta.titles.length);i++){var html=await(await azFetch(AZ_BASE+"/?s="+encodeURIComponent(meta.titles[i]))).text();var rx=/<article\b[^>]*>[\s\S]*?<\/article>/gi,m,hits=[];while((m=rx.exec(html))!==null){var block=m[0],link=block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i),text=(block.match(/(?:class=["'][^"']*(?:entry-title|card-details)[^"']*["'][^>]*>)([\s\S]*?)<\//i)||[])[1]||block.replace(/<[^>]+>/g," ");text=text.replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();if(link&&meta.titles.some(function(t){return azNorm(t)===azNorm(text);}))hits.push(azAbs(link[1]));}hits=Array.from(new Set(hits));if(hits.length===1)return hits[0];if(hits.length>1)return"";}return"";}
function azB64(v){var raw=atob(String(v||"").replace(/\s/g,""));return raw;}
function azH(h){var n=Number(h||0);return n>=2160?"2160p":n>=1440?"1440p":n>=1080?"1080p":n>=720?"720p":n>=480?"480p":n>=360?"360p":n>=240?"240p":n>=144?"144p":"Auto";}
async function azMega(url,label,id,ep){var html=await(await azFetch(url,{headers:{"Referer":AZ_BASE+"/"}})).text();var sid=(html.match(/<title>\s*File\s+(\d+)/i)||html.match(/data-id=["'](\d+)["']/i)||[])[1];if(!sid)return[];var data=await(await azFetch(AZ_MEGA+"/stream/getSources?id="+sid+"&id="+sid,{headers:{"Referer":url,"X-Requested-With":"XMLHttpRequest"}})).json();var file=data&&data.sources&&data.sources.file;if(data&&data.enc&&typeof crypto!=="undefined"&&crypto.subtle){try{var keyBytes=new Uint8Array(32);keyBytes.set(new TextEncoder().encode("i?LMTAx0Q6,:}50U"));var iv=new TextEncoder().encode("W0;27ToaUpl_P%'c");var raw=atob(String(data.enc).replace(/-/g,"+").replace(/_/g,"/"));var bytes=new Uint8Array(raw.length);for(var x=0;x<raw.length;x++)bytes[x]=raw.charCodeAt(x);var key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-CBC"},false,["decrypt"]);var plain=await crypto.subtle.decrypt({name:"AES-CBC",iv:iv},key,bytes);file=JSON.parse(new TextDecoder().decode(plain)).file||file;}catch(_){}}
 if(!file||!/^https:\/\//i.test(file))return[];var subs=(data.tracks||[]).filter(function(t){return t&&t.file&&t.kind!=="thumbnails"&&/^https:\/\//i.test(t.file);}).map(function(t){return{url:t.file,lang:t.label||"Subtitle"};});var body="";try{body=await(await azFetch(file,{headers:{"Referer":AZ_MEGA+"/"}})).text();}catch(_){}var headers={"Referer":AZ_MEGA+"/"},out=[];if(body.indexOf("#EXTM3U")<0)body="";if(body){var lines=body.split(/\r?\n/);for(var i=0;i<lines.length;i++)if(lines[i].indexOf("#EXT-X-STREAM-INF:")===0){var h=(lines[i].match(/RESOLUTION=\d+x(\d+)/i)||[])[1],line="";for(var j=i+1;j<lines.length;j++){if(lines[j].trim()&&lines[j].trim()[0]!=="#"){line=lines[j].trim();break;}}if(line){var u=azAbs(line,file),q=azH(h);out.push({name:label+" "+q,title:label+" "+q,url:u,quality:q,type:"m3u8",provider:AZ_ID,language:"sub",headers:headers,subtitles:subs,anilistId:id,episodeNumber:ep});}}}if(!out.length)out.push({name:label,title:label,url:file,quality:"Auto",type:"m3u8",provider:AZ_ID,language:"sub",headers:headers,subtitles:subs,anilistId:id,episodeNumber:ep});return out;}
async function azPlaylist(url,label,id,ep,lang,subs,headers){if(!url||!/^https:\/\//i.test(url))return[];var body;try{body=await(await azFetch(url,{headers:headers||{"Referer":AZ_BASE+"/"}})).text();}catch(e){console.log("[AnimeSalt] playlist fetch failed: "+String(e&&e.message||e));return[];}if(body.indexOf("#EXTM3U")<0)return[];var lines=body.split(/\r?\n/),out=[];for(var i=0;i<lines.length;i++){if(lines[i].indexOf("#EXT-X-STREAM-INF:")!==0)continue;var h=(lines[i].match(/RESOLUTION=\d+x(\d+)/i)||[])[1],next="";for(var j=i+1;j<lines.length;j++){var v=lines[j].trim();if(v&&v.charAt(0)!=="#"){next=v;break;}}if(next){var q=azH(h),u=azAbs(next,url);out.push({name:label+" "+q,title:label+" "+q,url:u,quality:q,type:"m3u8",provider:AZ_ID,language:lang,headers:headers||{"Referer":AZ_BASE+"/"},subtitles:subs||[],anilistId:id,episodeNumber:ep});}}if(!out.length)out.push({name:label,title:label,url:url,quality:"Auto",type:"m3u8",provider:AZ_ID,language:lang,headers:headers||{"Referer":AZ_BASE+"/"},subtitles:subs||[],anilistId:id,episodeNumber:ep});return out;}
async function azFirePlayer(url,label,id,ep,lang){var parsed;try{parsed=new URL(url);}catch(_){return[];}var match=/\/video\/([a-f0-9]{16,})/i.exec(parsed.pathname);if(!match)return[];var videoId=match[1],origin=parsed.protocol+"//"+parsed.host,postUrl=origin+"/player/index.php?data="+encodeURIComponent(videoId)+"&do=getVideo",form="hash="+encodeURIComponent(videoId)+"&r="+encodeURIComponent(AZ_BASE+"/");var response;try{response=await azFetch(postUrl,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","Referer":url,"Origin":origin,"X-Requested-With":"XMLHttpRequest"},body:form});}catch(e){console.log("[AnimeSalt] FirePlayer request failed: "+String(e&&e.message||e));return[];}var data;try{data=await response.json();}catch(_){return[];}var playlist=data&&(data.videoSource||data.securedLink);if(typeof playlist!=="string"||!/^https:\/\//i.test(playlist))return[];var headers={"Referer":origin+"/","Origin":origin};return await azPlaylist(playlist,label,id,ep,lang,[],headers);}
async function getStreams(anilistId,mediaType,season,episode,extra){try{var c=Object.assign({},azCtx(),extra||{}),id=String(anilistId||c.anilistId||""),ep=Number(episode||c.episodeNumber||0);if(mediaType!=="anime"||!/^[1-9]\d*$/.test(id)||!Number.isFinite(ep)||ep<=0)return[];var meta=await azMeta(id,c),page=await azFind(meta,c);if(!page)return[];var html=await(await azFetch(page)).text(),episodes=[],tiles=/<(?:div|article|li)\b[^>]*class=["'][^"']*\bep-tile\b[^"']*["'][^>]*>[\s\S]*?<\/(?:div|article|li)>/gi,m;while((m=tiles.exec(html))!==null){var block=m[0],onclick=((block.match(/onclick=(["'])([\s\S]*?)\1/i)||[])[2]||"").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,"&"),slug=(block.match(/data-slug=["']([^"']+)["']/i)||[])[1]||"",match=/triggerEpisode\s*\(\s*(\[[\s\S]*?\])\s*,\s*["']([^"']*)['"]\s*,\s*["']([^"']*)['"]/.exec(onclick),num=Number((match&&match[2]||block.replace(/<[^>]+>/g," ")).match(/(\d+(?:\.\d+)?)/)?.[1]||slug.match(/(\d+)/)?.[1]);if(num===ep){var data=[];if(match)try{data=JSON.parse(match[1]);}catch(_){}episodes.push({num:num,servers:data});}}
 if(!episodes.length)return[];var out=[],seen={};for(var i=0;i<episodes[0].servers.length;i++){var s=episodes[0].servers[i]||{},u=String(s.url||"");if(!u||seen[u]||/videasy\.net/i.test(u))continue;seen[u]=1;var lang=String(s.lang||"sub").toLowerCase(),name=String(s.name||"AnimeSalt "+lang);if(/megaplay\.buzz/i.test(u)){out=out.concat(await azMega(azAbs(u,page),name,id,ep));continue;}if(/vidmoly/i.test(u)){var shared=globalThis&&globalThis.RAWAnimeExtractors;if(shared){out=out.concat(await shared.vidmoly(azAbs(u,page),{provider:AZ_ID,anilistId:id,episodeNumber:ep,language:lang,labelPrefix:name,log:function(m){console.log(m);}}));}continue;}if(/as-cdn|firevideoplayer\.com|\/video\/[a-f0-9]{16,}/i.test(u)){out=out.concat(await azFirePlayer(azAbs(u,page),name,id,ep,lang));continue;}if(/^https:\/\//i.test(u)){var htm="";try{htm=await(await azFetch(u,{headers:{"Referer":page}})).text();}catch(_){}var direct=(htm.match(/https?:\/\/[^"'\\s]+\.m3u8(?:\?[^"'\\s]*)?/i)||[])[0];if(direct)out.push({name:name,title:name,url:direct,quality:"Auto",type:"m3u8",provider:AZ_ID,language:lang,headers:{"Referer":u},subtitles:[],anilistId:id,episodeNumber:ep});else if(/\.(?:m3u8|mp4|mkv)(?:$|\?)/i.test(u))out.push({name:name,title:name,url:u,quality:"Auto",type:/mp4/i.test(u)?"mp4":/mkv/i.test(u)?"mkv":"m3u8",provider:AZ_ID,language:lang,headers:{"Referer":page},subtitles:[],anilistId:id,episodeNumber:ep});}}
 return out;}catch(e){console.log("[AnimeSalt] "+String(e&&e.message||e));return[];}}
if(typeof globalThis!=="undefined")globalThis.getStreams=getStreams;
if(typeof module!=="undefined"&&module.exports)module.exports={getStreams:getStreams};
