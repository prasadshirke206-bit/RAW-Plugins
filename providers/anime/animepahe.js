/* AnimePahe — QuickJS playback port based on AnimePahe.kt and KwikExtractor.kt.
 * Supports exact AniList → AnimePahe API/search/session mapping, paginated episode
 * lookup, resolution buttons, standard Kwik unpack/token POST/302 stream extraction,
 * direct HLS/MP4 sources and RAW's native AES-128 HLS key/segment proxy.
 *
 * Security boundary: AnimePahe/Kwik Cloudflare clearance is never solved, fabricated,
 * copied from another site, or bypassed automatically. A standard request is attempted
 * once; a 403/419 fails closed and should be completed by the user in a legitimate
 * browser session. Cookies/User-Agent supplied by the user-owned host session may be
 * passed through context by the app. No synthetic clearance is generated here.
 */
var ANIMEPAHE_ID = "animepahe";
var ANIMEPAHE_BASES = ["https://animepahe.ru", "https://animepahe.org"];
var ANIMEPAHE_DEFAULT = "https://animepahe.ru";
var ANIMEPAHE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var K_CANDIDATE_RE = /\("([\w]+)",\s*(\d+),\s*"([\w]+)",\s*(\d+),\s*(\d+),\s*\d+\)/;
var K_ACTION_RE = /action="([^"]+)"/i;
var K_VALUE_RE = /name="_token"[^>]*value="([^"]+)"/i;

function apContext(extra) {
  return Object.assign({}, (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {}, extra || {});
}
function apBase(context) {
  var value = String(context.preferredDomain || context.domain || ANIMEPAHE_DEFAULT).replace(/\/+$/, "");
  return ANIMEPAHE_BASES.indexOf(value) >= 0 ? value : ANIMEPAHE_DEFAULT;
}
function apNorm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}
function apAliases(context) {
  return [].concat(context.title || [], context.titles || [], context.aliases || []).map(function (item) {
    if (typeof item === "string") return item;
    return item && (item.english || item.romaji || item.native || item.title) || "";
  }).filter(Boolean).map(String);
}
function apHeaders(base, referer, context) {
  var headers = {
    "User-Agent": String(context.sessionUserAgent || context.userAgent || ANIMEPAHE_UA),
    "Accept": "application/json, text/plain, */*",
    "Referer": referer || base + "/",
    "Origin": base
  };
  if (context.sessionCookie) headers.Cookie = String(context.sessionCookie);
  return headers;
}
async function apFetch(url, headers, method, body, redirect) {
  var init = { headers: headers || {} };
  if (method) init.method = method;
  if (body !== undefined) init.body = body;
  if (redirect) init.redirect = redirect;
  var response = await fetch(url, init);
  if (!response) throw new Error("AnimePahe empty response");
  if (!response.ok && response.status !== 302) {
    if (response.status === 403 || response.status === 419 || response.status === 503) {
      throw new Error("AnimePahe/Kwik verification required (HTTP " + response.status + "); complete verification in the browser");
    }
    throw new Error("AnimePahe HTTP " + response.status);
  }
  return response;
}
async function apJson(url, headers) { return await (await apFetch(url, headers)).json(); }
async function apText(url, headers, method, body, redirect) { return await (await apFetch(url, headers, method, body, redirect)).text(); }
async function apAniList(id, context) {
  var titles = apAliases(context);
  if (titles.length) return { id: String(id), titles: titles };
  var query = "query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native userPreferred } synonyms } }";
  var response = await apJson("https://graphql.anilist.co", {
    "Content-Type": "application/json",
    "Accept": "application/json"
  }, "POST", JSON.stringify({ query: query, variables: { id: Number(id) } }));
  var media = response && response.data && response.data.Media;
  if (!media || String(media.id) !== String(id)) throw new Error("AnimePahe AniList mapping mismatch");
  return { id: String(media.id), titles: [media.title && media.title.english,media.title && media.title.romaji,media.title && media.title.native,media.title && media.title.userPreferred].concat(media.synonyms||[]).filter(Boolean) };
}
function apSearchNormalize(value) {
  return String(value || "").replace(/[^A-Za-z0-9\s]/g," ").replace(/\s+/g," ").trim();
}
async function apSearchId(base, meta, context) {
  var titles = meta.titles.slice(0, 12);
  for (var i=0;i<titles.length;i++) {
    var query=apSearchNormalize(titles[i]);
    if (!query) continue;
    var url=base+"/api/?m=search&q="+encodeURIComponent(query+" "+Math.floor(Date.now()/1000))+"&page=1";
    var data=await apJson(url,apHeaders(base,base+"/",context));
    var rows=data&&data.data&&data.data.length?data.data:(data&&data.items)||[];
    var hits=rows.filter(function(row){
      var title=apNorm(row.title||row.name);
      var requested=apNorm(titles[i]);
      return row&&row.id!=null&&row.session&&title&&(title.indexOf(requested)>=0||requested.indexOf(title)>=0);
    });
    var unique=hits.filter(function(row,index,all){return all.findIndex(function(other){return String(other.id)===String(row.id)&&String(other.session)===String(row.session);})===index;});
    if(unique.length>1) throw new Error("AnimePahe search title maps to multiple sessions");
    if(unique.length===1) return {animeId:String(unique[0].id),session:String(unique[0].session),title:unique[0].title||titles[i]};
  }
  return null;
}
async function apEpisodePages(base,session,context) {
  var all=[],page=1;
  while(page<=50){
    var url=base+"/api?m=release&id="+encodeURIComponent(session)+"&sort=episode_asc&page="+page;
    var data=await apJson(url,apHeaders(base,base+"/anime/"+session,context));
    var rows=data&&(data.data||data.items)||[];
    all.push.apply(all,rows);
    var current=Number(data&&data.current_page||page),last=Number(data&&data.last_page||current);
    if(current>=last||!rows.length) break;
    page=current+1;
  }
  return all;
}
function apFindEpisode(rows,ep) {
  var hits=rows.filter(function(row){
    var num=Number(row&&row.episode);
    return Number.isFinite(num)&&Math.abs(num-ep)<0.0001;
  });
  return hits.length===1?hits[0]:null;
}
function apUnpackKwik(source) {
  var match=String(source||"").match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\((['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/);
  if(!match) {
    var generic=String(source||"").match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(([\s\S]*?)\)\s*\)/);
    if(!generic) throw new Error("Kwik packed script not found");
  }
  // The canonical Kwik packer is handled with a small, bounded P.A.C.K.E.R decoder.
  var packed=String(source||"").match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([^']*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)/);
  if(!packed) {
    var packedDouble=String(source||"").match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\("([^"]*)",(\d+),(\d+),"([^"]*)"\.split\("\|"\)/);
    if(!packedDouble) throw new Error("Kwik packer arguments were not recognised");
    packed=packedDouble;
  }
  var payload=packed[1], radix=Number(packed[2]), count=Number(packed[3]), words=packed[4].split("|");
  if(!(radix>=2&&radix<=62&&count<=20000)) throw new Error("Kwik packer bounds invalid");
  function encodeNumber(number,base){
    var chars="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if(number===0)return "0";
    var output="";
    while(number>0){output=chars.charAt(number%base)+output;number=Math.floor(number/base);}
    return output;
  }
  for(var i=count-1;i>=0;i--){
    if(words[i]){
      var token=encodeNumber(i,radix);
      payload=payload.replace(new RegExp("\\\\b"+token+"\\\\b","g"),words[i]);
    }
  }
  return payload;
}
function apDecryptKwik(encoded,key,v1,v2) {
  var map={};
  for(var i=0;i<key.length;i++) map[key.charAt(i)]=i;
  var result="",cursor=0,toFind=key.charAt(v2);
  while(cursor<encoded.length){
    var next=encoded.indexOf(toFind,cursor);
    if(next<0)break;
    var digits="";
    for(var j=cursor;j<next;j++) digits+=Object.prototype.hasOwnProperty.call(map,encoded.charAt(j))?map[encoded.charAt(j)]:-1;
    cursor=next+1;
    var parsed=parseInt(digits,v2);
    if(!Number.isFinite(parsed))break;
    result+=String.fromCharCode(parsed-v1);
  }
  return result;
}
function apFindKwikPage(packed) {
  var unpacked=apUnpackKwik(packed);
  var uri=(unpacked.match(/action="([^"]+)"/i)||[,""])[1];
  var token=(unpacked.match(/name="_token"[^>]*value="([^"]+)"/i)||unpacked.match(/value="([^"]+)"/i)||[,""])[1];
  if(!uri||!token) throw new Error("Kwik form action/token missing after unpack");
  return {uri:uri,token:token};
}
async function apKwikUrl(kwikUrl,context,base) {
  var kwikHeaders={
    "User-Agent":String(context.kwikUserAgent||context.sessionUserAgent||context.userAgent||ANIMEPAHE_UA),
    "Origin":"https://kwik.cx",
    "Referer":"https://kwik.cx/",
    "Accept":"text/html,application/xhtml+xml,*/*"
  };
  if(context.kwikCookie) kwikHeaders.Cookie=String(context.kwikCookie);
  var html=await apText(kwikUrl,kwikHeaders);
  if(!html.includes("eval(function(")) throw new Error("Kwik requires a user-completed Cloudflare browser session");
  var params=(html.match(/\("([\w]+)",\s*\d+,\s*"([\w]+)",\s*(\d+),\s*(\d+),\s*\d+\)/)||[]);
  if(!params[0]) throw new Error("Kwik decrypt parameters not found");
  var unpacked=apUnpackKwik(html);
  var formUrl=(unpacked.match(/action="([^"]+)"/i)||[,""])[1];
  var token=(unpacked.match(/name="_token"[^>]*value="([^"]+)"/i)||unpacked.match(/value="([^"]+)"/i)||[,""])[1];
  if(!formUrl||!token) throw new Error("Kwik form is incomplete");
  var absolute=awResolve(base,formUrl);
  var body="_token="+encodeURIComponent(token);
  var postHeaders=Object.assign({},kwikHeaders,{"Content-Type":"application/x-www-form-urlencoded","Referer":kwikUrl});
  var response=await fetch(absolute,{method:"POST",headers:postHeaders,body:body,redirect:"manual"});
  if(response.status===403||response.status===419||response.status===503) throw new Error("Kwik Cloudflare verification required; open the Kwik page in a browser and complete verification");
  if(response.status!==302) throw new Error("Kwik expected a 302 stream redirect, got "+response.status);
  var location=response.headers&&response.headers.get?response.headers.get("location"):"";
  if(!location) throw new Error("Kwik stream redirect has no Location header");
  return awResolve(kwikUrl,location);
}
function apHlsProxy(url,headers,options) {
  if(typeof globalThis.__raw_create_media_proxy!=="function") throw new Error("RAW native HLS proxy unavailable");
  return String(globalThis.__raw_create_media_proxy(url,JSON.stringify(headers||{}),JSON.stringify(options||{})));
}
async function apResolveKwik(kwikUrl,quality,context,base) {
  var streamUrl=await apKwikUrl(kwikUrl,context,base);
  var referer=kwikUrl;
  if(/\.m3u8(?:$|[?#])/i.test(streamUrl)){
    var headers={"User-Agent":String(context.kwikUserAgent||context.sessionUserAgent||context.userAgent||ANIMEPAHE_UA),"Referer":referer,"Origin":"https://kwik.cx"};
    var local=apHlsProxy(streamUrl,headers,{
      rewriteManifests:true,
      forceSegmentContentType:true,
      aes128HlsKeyRelay:true,
      aes128HlsDecryptSegments:true,
      sessionTtlMillis:7200000
    });
    return {name:quality+" (HLS)",title:quality+" (HLS)",url:local,type:"m3u8",quality:quality,provider:ANIMEPAHE_ID,headers:headers,subtitles:[]};
  }
  return {name:quality,title:quality,url:streamUrl,type:/\.mp4(?:$|[?#])/i.test(streamUrl)?"mp4":"auto",quality:quality,provider:ANIMEPAHE_ID,headers:{"User-Agent":ANIMEPAHE_UA,"Referer":referer},subtitles:[]};
}
async function getStreams(anilistId,mediaType,season,episode,extraArgs) {
  try{
    if(mediaType!=="anime")return [];
    var id=String(anilistId||""),ep=Number(episode||(extraArgs&&extraArgs.episodeNumber));
    if(!/^[1-9]\d*$/.test(id)||!Number.isFinite(ep)||ep<=0)return [];
    var context=apContext(extraArgs),base=apBase(context),meta=await apAniList(id,context);
    var mapping=await apSearchId(base,meta,context);
    if(!mapping)return [];
    var episodes=await apEpisodePages(base,mapping.session,context);
    var episodeRow=apFindEpisode(episodes,ep);
    if(!episodeRow)return [];
    var session=String(episodeRow.session||"");
    if(!session)return [];
    var pageUrl=base+"/play/"+mapping.session+"/"+session+"?anime_id="+encodeURIComponent(mapping.animeId);
    var html=await apText(pageUrl,apHeaders(base,base+"/"));
    var buttons=html.match(/<button\b[^>]*data-src=["'][^"']+["'][^>]*>[\s\S]*?<\/button>/gi)||[];
    var downloadLinks=html.match(/<div\b[^>]*id=["']pickDownload["'][^>]*>[\s\S]*?<\/div>/i)||[""];
    var links=downloadLinks[0].match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/gi)||[];
    var candidates=[];
    for(var i=0;i<buttons.length;i++){
      var tag=(buttons[i].match(/^<button\b[^>]*>/i)||[""])[0];
      var kwik=apAttr(tag,"data-src");
      if(!kwik)continue;
      var label=apHtmlText(buttons[i]), quality=label.replace(/\b(?:eng|kor|chi)\b/ig,"").replace(/\s+/g," ").trim();
      var download=links[i]?apAttr(links[i],"href"):"";
      if(!/^https?:\/\//i.test(kwik))kwik=awResolve(base,kwik);
      if(!/^https?:\/\//i.test(kwik))continue;
      // The Kotlin source uses the Kwik extractor for both HLS and MP4. With a
      // user-completed browser cookie supplied, the same 302 endpoint is resolved.
      try{
        var resolved=await apResolveKwik(kwik,quality,context,base);
        resolved.anilistId=id;resolved.episodeNumber=ep;
        candidates.push(resolved);
      }catch(error){
        console.log("[AnimePahe] "+quality+" unavailable: "+String(error&&error.message||error));
      }
    }
    return candidates;
  }catch(error){
    console.log("[AnimePahe] resolve failed: "+String(error&&error.message||error));
    return [];
  }
}
function apAttr(tag,name){
  var match=String(tag||"").match(new RegExp(name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i"));
  return match?match[1]||match[2]||match[3]||"":"";
}
function apHtmlText(html){return String(html||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();}
if(typeof globalThis!=="undefined")globalThis.getStreams=getStreams;
if(typeof module!=="undefined"&&module.exports)module.exports={getStreams:getStreams,__test:{normalize:apNorm,kwikDecrypt:apDecryptKwik,unpack:apUnpackKwik}};
