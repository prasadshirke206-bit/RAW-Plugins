/* AniChan — RAW QuickJS port of native API episode/server flow.
 * Direct HLS/MP4 URLs are supported. Embed pages are accepted only when a
 * direct media URL is visible; Android UniversalExtractor is not emulated.
 */
var AC_ID="anichan", AC_BASE="https://anichan.net";
function acCtx(){return (globalThis&&globalThis.__CALL_ARGS__)||{};}
async function acFetch(url,opt,ms){var c;var r=await Promise.race([fetch(url,opt||{}),new Promise(function(_,rej){c=setTimeout(function(){rej(new Error("AniChan timeout"));},ms||10000);})]).finally(function(){clearTimeout(c);});if(!r||!r.ok)throw new Error("AniChan HTTP "+(r?r.status:"network"));return r;}
async function acJson(url,opt){return (await acFetch(url,opt)).json();}
function acAbs(base,u){try{return new URL(u,base).toString();}catch(_){return u;}}
function acQ(h){var n=Number(h||0);return n>=2160?"2160p":n>=1440?"1440p":n>=1080?"1080p":n>=720?"720p":n>=480?"480p":n>=360?"360p":n>=240?"240p":n>=144?"144p":"Auto";}
function acCandidate(url,label,quality,kind,lang,headers,subs,id,ep){if(!url||!/^https:\/\//i.test(url))return null;return{name:label,title:label,url:url,quality:quality||"Auto",type:kind||"m3u8",provider:AC_ID,language:lang||undefined,headers:headers||{"Referer":AC_BASE+"/"},subtitles:subs||[],anilistId:String(id),episodeNumber:Number(ep)};}
function acSubTracks(arr){return (arr||[]).map(function(s){var u=s&&(s.ass||s.url);if(!u)return null;return{url:acAbs(AC_BASE,u),lang:s.lang||s.label||"Subtitle"};}).filter(Boolean);}
async function acHls(url,label,lang,headers,subs,id,ep){
 var body="";try{body=await(await acFetch(url,{headers:headers},9000)).text();}catch(_){}
 if(body.indexOf("#EXTM3U")<0){var c=acCandidate(url,label,"Auto","m3u8",lang,headers,subs,id,ep);return c?[c]:[];}
 var lines=body.split(/\r?\n/),out=[];
 for(var i=0;i<lines.length;i++){if(lines[i].indexOf("#EXT-X-STREAM-INF:")!==0)continue;var h=(lines[i].match(/RESOLUTION=\d+x(\d+)/i)||[])[1];var next="";for(var j=i+1;j<lines.length;j++){var v=lines[j].trim();if(v&&v[0]!=="#"){next=v;break;}}if(next){var c=acCandidate(acAbs(url,next),label,acQ(h),"m3u8",lang,headers,subs,id,ep);if(c)out.push(c);}}
 if(!out.length){var c0=acCandidate(url,label,"Auto","m3u8",lang,headers,subs,id,ep);if(c0)out.push(c0);}return out;
}
async function getStreams(anilistId,mediaType,season,episode,extra){
 try{
  var ctx=Object.assign({},acCtx(),extra||{}),id=String(anilistId||ctx.anilistId||""),ep=Number(episode||ctx.episodeNumber||0);
  if(mediaType!=="anime"||!/^[1-9]\d*$/.test(id)||!Number.isFinite(ep)||ep<=0)return[];
  if(ctx.anilistId&&String(ctx.anilistId)!==id)return[];
  var epInfo=await acJson(AC_BASE+"/api/watch/episodes?anilistId="+encodeURIComponent(id),{headers:{"Accept":"application/json"}});
  var count=Number(epInfo.episodes||0);if(!count||ep>count)return[];
  var langs=["sub","dub"],out=[];
  var preferred=String(ctx.preferredAudio||"sub").toLowerCase();langs.sort(function(a,b){return (a===preferred?-1:0)-(b===preferred?-1:0);});
  for(var l=0;l<langs.length;l++){
   var kind=langs[l];if(kind==="dub"&&epInfo.dubAvailable!==true)continue;
   var data=await acJson(AC_BASE+"/api/watch/servers?anilistId="+encodeURIComponent(id)+"&ep="+encodeURIComponent(ep)+"&category="+kind,{headers:{"Accept":"application/json"}});
   var servers=data.servers||[];
   for(var i=0;i<servers.length;i++){
    var s=servers[i]||{},subs=acSubTracks(s.subtitles),label=String(s.label||s.name||"AniChan")+" ["+kind.toUpperCase()+"]";
    var stream=s.stream?acAbs(AC_BASE,s.stream):"";
    if(stream&&String(s.type||"hls").toLowerCase()==="hls")out=out.concat(await acHls(stream,label, "hls",{"Referer":AC_BASE+"/"},subs,id,ep));
    else if(stream&&/\.(mp4|mkv)(?:$|\?)/i.test(stream)){var c=acCandidate(stream,label,"Auto",/\.mkv/i.test(stream)?"mkv":"mp4",kind,{"Referer":AC_BASE+"/"},subs,id,ep);if(c)out.push(c);}
    // Embed URLs are not passed to MPV. Only expose a direct media URL discoverable in public HTML.
    else if(s.embed){
      var embedUrl=acAbs(AC_BASE,s.embed);
      try{
        var html=await(await acFetch(embedUrl,{headers:{"Referer":AC_BASE+"/"}},8000)).text();
        var m=html.match(/https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?/i);
        if(m)out=out.concat(await acHls(m[0],label,kind,{"Referer":embedUrl},subs,id,ep));
      }catch(_){}
      if(!out.length){
        var pending=acCandidate(embedUrl,label,"Auto","embed",kind,{"Referer":AC_BASE+"/"},subs,id,ep);
        if(pending)out.push(pending);
      }
    }
   }
   if(out.length)break;
  }
  var seen={};return out.filter(function(c){if(!c||seen[c.url])return false;seen[c.url]=1;return true;});
 }catch(e){console.log("[AniChan] "+String(e&&e.message||e));return[];}
}
if(typeof globalThis!=="undefined")globalThis.getStreams=getStreams;
if(typeof module!=="undefined"&&module.exports)module.exports={getStreams:getStreams};
