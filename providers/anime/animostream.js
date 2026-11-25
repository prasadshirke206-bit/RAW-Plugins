/* AniMoStream / Animostream — Blogger post with animeData server arrays.
 * Uses public HLS/direct-file URLs exposed in the post or accessible embed HTML.
 * Unsupported hoster-specific extractors are not imitated.
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
var AM_ID="animostream",AM_BASE="https://www.animostream.xyz";
function amCtx(){return(globalThis&&globalThis.__CALL_ARGS__)||{};}
async function amFetch(u,o){var t;var r=await Promise.race([fetch(u,o||{}),new Promise(function(_,j){t=setTimeout(function(){j(new Error("timeout"));},10000);})]).finally(function(){clearTimeout(t);});if(!r||!r.ok)throw new Error("HTTP "+(r?r.status:"network"));return r;}
function amNorm(s){return String(s||"").toLowerCase().normalize?String(s||"").toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g," ").trim():String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function amAbs(u,b){try{return new URL(u,b||AM_BASE).toString();}catch(_){return u;}}
async function amMeta(id,c){var a=[].concat(c.title||[],c.titles||[],c.aliases||[]).map(function(x){return typeof x==="string"?x:x&&(x.english||x.romaji||x.native)||"";}).filter(Boolean);if(a.length)return{id:String(id),titles:a};var q="query($id:Int){Media(id:$id,type:ANIME){id title{english romaji native userPreferred} synonyms}}";var r=await(await amFetch("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q,variables:{id:Number(id)}})})).json();var m=r&&r.data&&r.data.Media;if(!m||String(m.id)!==String(id))throw new Error("AniList mismatch");return{id:String(m.id),titles:[m.title&&m.title.userPreferred,m.title&&m.title.english,m.title&&m.title.romaji,m.title&&m.title.native].concat(m.synonyms||[]).filter(Boolean)};}
async function amFind(meta,c){var map=c.providerMappings&&c.providerMappings.animostream;if(map){var v=typeof map==="object"?(map.url||map.slug):map;if(v)return amAbs(String(v));}for(var i=0;i<Math.min(4,meta.titles.length);i++){var html=await(await amFetch(AM_BASE+"/search?q="+encodeURIComponent(meta.titles[i]))).text(),rx=/<article\b[^>]*>[\s\S]*?<\/article>/gi,m,h=[];while((m=rx.exec(html))!==null){var a=(m[0].match(/<a\b[^>]*href=["']([^"']+)["']/i)||[])[1],t=(m[0].match(/<h[1-3]\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-3]>/i)||[])[1]||m[0];t=t.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();if(a&&meta.titles.some(function(x){return amNorm(x)===amNorm(t);}))h.push(amAbs(a));}h=Array.from(new Set(h));if(h.length===1)return h[0];if(h.length>1)return"";}return"";}
function amParseData(html){var m=html.match(/var\s+animeData\s*=\s*(\{[\s\S]*?\});\s*(?:var|let|const|\n)/);if(!m)return null;try{return JSON.parse(m[1]);}catch(_){return null;}}
function amQ(h){var n=Number(h||0);return n>=2160?"2160p":n>=1440?"1440p":n>=1080?"1080p":n>=720?"720p":n>=480?"480p":n>=360?"360p":n>=240?"240p":n>=144?"144p":"Auto";}
async function amDirect(u,label,id,ep,referer){if(!u||!/^https:\/\//i.test(u))return[];var body="";try{body=await(await amFetch(u,{headers:{"Referer":referer||AM_BASE+"/"}})).text();}catch(_){}if(body.indexOf("#EXTM3U")<0){if(/\.(?:mp4|mkv)(?:$|\?)/i.test(u))return[{name:label,title:label,url:u,quality:"Auto",type:/mkv/i.test(u)?"mkv":"mp4",provider:AM_ID,language:"multi",headers:{"Referer":referer||AM_BASE+"/"},subtitles:[],anilistId:id,episodeNumber:ep}];return[];}var lines=body.split(/\r?\n/),out=[];for(var i=0;i<lines.length;i++)if(lines[i].indexOf("#EXT-X-STREAM-INF:")===0){var h=(lines[i].match(/RESOLUTION=\d+x(\d+)/i)||[])[1],v="";for(var j=i+1;j<lines.length;j++)if(lines[j].trim()&&lines[j].trim()[0]!=="#"){v=lines[j].trim();break;}if(v){var abs=amAbs(v,u),q=amQ(h);out.push({name:label+" "+q,title:label+" "+q,url:abs,quality:q,type:"m3u8",provider:AM_ID,language:"multi",headers:{"Referer":referer||AM_BASE+"/"},subtitles:[],anilistId:id,episodeNumber:ep});}}return out.length?out:[{name:label,title:label,url:u,quality:"Auto",type:"m3u8",provider:AM_ID,language:"multi",headers:{"Referer":referer||AM_BASE+"/"},subtitles:[],anilistId:id,episodeNumber:ep}];}
async function amResolve(raw,label,id,ep,ref){var u=String(raw||"");if(!u)return[];var ext=globalThis&&globalThis.RAWAnimeExtractors;if(ext){var sharedOpts={provider:AM_ID,anilistId:id,episodeNumber:ep,language:"multi",labelPrefix:label,log:function(m){console.log(m);}};if(/streamtape/i.test(u))return await ext.streamtape(u,Object.assign({},sharedOpts,{pageHeaders:{}}));if(/dood/i.test(u))return await ext.dood(u,Object.assign({},sharedOpts,{pageHeaders:{}}));if(/vidmoly/i.test(u))return await ext.vidmoly(u,sharedOpts);}if(/^https:\/\//i.test(u)&&/\.(?:m3u8|mp4|mkv)(?:$|\?)/i.test(u))return amDirect(u,label,id,ep,ref);var html="";try{html=await(await amFetch(amAbs(u),{headers:{"Referer":ref||AM_BASE+"/"}})).text();}catch(_){return[];}var direct=(html.match(/https?:\/\/[^"'\\s]+\.m3u8(?:\?[^"'\\s]*)?/i)||[])[0]||(html.match(/https?:\/\/[^"'\\s]+\.(?:mp4|mkv)(?:\?[^"'\\s]*)?/i)||[])[0];if(!direct)return[];return amDirect(direct,label,id,ep,amAbs(u));}
async function getStreams(anilistId,mediaType,season,episode,extra){try{var c=Object.assign({},amCtx(),extra||{}),id=String(anilistId||c.anilistId||""),ep=Number(episode||c.episodeNumber||0),sn=Number(season||c.season||1);if(mediaType!=="anime"||!/^[1-9]\d*$/.test(id)||!Number.isFinite(ep)||ep<=0)return[];var meta=await amMeta(id,c),page=await amFind(meta,c);if(!page)return[];var html=await(await amFetch(page)).text(),data=amParseData(html),out=[];if(data){var sKey="s"+(sn>0?sn:1),seasonData=data[sKey]||data["S"+(sn>0?sn:1)];if(seasonData){var list=seasonData.episodes||[],idx=list.findIndex(function(v){return Math.abs(Number(v)-ep)<0.0001;});if(idx<0&&ep<=list.length)idx=ep-1;if(idx>=0){var keys=Object.keys(seasonData).filter(function(k){return k!=="episodes";});for(var i=0;i<keys.length;i++){var value=seasonData[keys[i]],u=Array.isArray(value)?String(value[idx]||""):String(value||"");if(!u)continue;var lang=/dub/i.test(keys[i])?"dub":"sub";out=out.concat(await amResolve(u,keys[i]+" "+lang.toUpperCase(),id,ep,page));}}}}
 if(!out.length){var vars=/<script\b[^>]*>[\s\S]*?<\/script>/gi,m,linkRx=/var\s+(\w+Link)\s*=\s*["']([^"']+)["']/g,html2=html,x;while((x=linkRx.exec(html2))!==null){var u=x[2];if(u)out=out.concat(await amResolve(u,x[1],id,ep,page));}}
 var seen={};return out.filter(function(x){if(seen[x.url])return false;seen[x.url]=1;return true;});}catch(e){console.log("[Animostream] "+String(e&&e.message||e));return[];}}
if(typeof globalThis!=="undefined")globalThis.getStreams=getStreams;
if(typeof module!=="undefined"&&module.exports)module.exports={getStreams:getStreams};
