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


  function utf8Bytes(value) {
    var text = String(value == null ? "" : value);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    var encoded = unescape(encodeURIComponent(text));
    var out = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i) & 255;
    return out;
  }

  function bytesToLatin1(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] & 255);
    return out;
  }

  function bytesToUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") {
      try { return new TextDecoder("utf-8").decode(bytes); } catch (_) {}
    }
    var binary = bytesToLatin1(bytes);
    try {
      return decodeURIComponent(binary.split("").map(function (ch) {
        return "%" + ("0" + ch.charCodeAt(0).toString(16)).slice(-2);
      }).join(""));
    } catch (_) {
      return binary;
    }
  }

  function decodeBase64Bytes(value) {
    var input = String(value || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (input.length % 4) input += "=";
    if (typeof atob === "function") {
      var binary = atob(input);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 255;
      return bytes;
    }
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = [];
    var buffer = 0;
    var bits = 0;
    for (var j = 0; j < input.length; j++) {
      var ch = input.charAt(j);
      if (ch === "=") break;
      var valueAt = alphabet.indexOf(ch);
      if (valueAt < 0) continue;
      buffer = (buffer << 6) | valueAt;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        result.push((buffer >> bits) & 255);
      }
    }
    return new Uint8Array(result);
  }

  function encodeBase64NoPadding(bytes) {
    var binary = bytesToLatin1(bytes);
    var encoded;
    if (typeof btoa === "function") encoded = btoa(binary);
    else {
      var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      encoded = "";
      for (var i = 0; i < bytes.length; i += 3) {
        var a = bytes[i] & 255;
        var hasB = i + 1 < bytes.length;
        var hasC = i + 2 < bytes.length;
        var b = hasB ? bytes[i + 1] & 255 : 0;
        var c = hasC ? bytes[i + 2] & 255 : 0;
        encoded += alphabet.charAt(a >> 2);
        encoded += alphabet.charAt(((a & 3) << 4) | (b >> 4));
        encoded += hasB ? alphabet.charAt(((b & 15) << 2) | (c >> 6)) : "=";
        encoded += hasC ? alphabet.charAt(c & 63) : "=";
      }
    }
    return encoded.replace(/=+$/g, "");
  }

  function md5Bytes(input) {
    var data = Array.prototype.slice.call(input);
    var bitLength = input.length * 8;
    data.push(128);
    while (data.length % 64 !== 56) data.push(0);
    var low = bitLength >>> 0;
    var high = Math.floor(bitLength / 4294967296) >>> 0;
    for (var n = 0; n < 4; n++) data.push((low >>> (n * 8)) & 255);
    for (var m = 0; m < 4; m++) data.push((high >>> (m * 8)) & 255);

    var shifts = [
      7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
      5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
      4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
      6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21
    ];
    var constants = [];
    for (var c = 0; c < 64; c++) constants[c] = Math.floor(Math.abs(Math.sin(c + 1)) * 4294967296) >>> 0;

    var a0 = 0x67452301;
    var b0 = 0xefcdab89;
    var c0 = 0x98badcfe;
    var d0 = 0x10325476;

    for (var offset = 0; offset < data.length; offset += 64) {
      var words = new Uint32Array(16);
      for (var w = 0; w < 16; w++) {
        var p = offset + w * 4;
        words[w] = (data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) | (data[p + 3] << 24)) >>> 0;
      }
      var a = a0, b = b0, c2 = c0, d = d0;
      for (var i = 0; i < 64; i++) {
        var f, g;
        if (i < 16) {
          f = (b & c2) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c2);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c2 ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c2 ^ (b | ~d);
          g = (7 * i) % 16;
        }
        var sum = (a + f + constants[i] + words[g]) >>> 0;
        var shift = shifts[i];
        var rotated = ((sum << shift) | (sum >>> (32 - shift))) >>> 0;
        var previousD = d;
        d = c2;
        c2 = b;
        b = (b + rotated) >>> 0;
        a = previousD;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c2) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    var digest = new Uint8Array(16);
    var state = [a0, b0, c0, d0];
    for (var s = 0; s < 4; s++) {
      for (var j2 = 0; j2 < 4; j2++) digest[s * 4 + j2] = (state[s] >>> (j2 * 8)) & 255;
    }
    return digest;
  }

  function abyssKey(seed) {
    var cleaned = String(seed);
    var firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) cleaned = cleaned.substring(0, firstDot) + cleaned.substring(firstDot + 1);
    cleaned = cleaned.replace(/:/g, "").replace(/-/g, "");
    var allDigits = cleaned.length > 0 && /^[0-9]+$/.test(cleaned);
    var source;
    if (allDigits) {
      source = new Uint8Array(String(seed).length);
      for (var i = 0; i < String(seed).length; i++) {
        var ch = String(seed).charAt(i);
        source[i] = /^[0-9]$/.test(ch) ? Number(ch) : String(seed).charCodeAt(i) & 255;
      }
    } else {
      source = utf8Bytes(seed);
    }
    var hash = md5Bytes(source);
    var hex = "";
    for (var j = 0; j < hash.length; j++) hex += ("0" + hash[j].toString(16)).slice(-2);
    return utf8Bytes(hex);
  }

  async function abyssAesCtrTransform(dataBytes, keySeed) {
    try {
      if (!root.crypto || !root.crypto.subtle) return null;
      var keyBytes = abyssKey(keySeed);
      var iv = keyBytes.slice(0, 16);
      var key = await root.crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, ["decrypt"]);
      var plain = await root.crypto.subtle.decrypt(
        { name: "AES-CTR", counter: iv, length: 128 },
        key,
        dataBytes
      );
      return new Uint8Array(plain);
    } catch (_) {
      return null;
    }
  }

  function decodeEscapedBinary(escaped) {
    var out = "";
    var i = 0;
    var map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "\\": "\\", "\"": "\"", "/": "/" };
    while (i < escaped.length) {
      var ch = escaped.charAt(i);
      if (ch === "\\" && i + 1 < escaped.length) {
        var next = escaped.charAt(i + 1);
        if (next === "u" && i + 5 < escaped.length) {
          var hex = escaped.substring(i + 2, i + 6);
          if (/^[0-9a-f]{4}$/i.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
        }
        if (Object.prototype.hasOwnProperty.call(map, next)) {
          out += map[next];
          i += 2;
          continue;
        }
      }
      out += ch;
      i++;
    }
    return out;
  }

  function extractAbyssDatas(html) {
    var match = /(?:const|var)\s+datas\s*=\s*"([^"]+)"/.exec(String(html || ""));
    if (!match) return null;
    var raw;
    try { raw = bytesToLatin1(decodeBase64Bytes(match[1].trim())); }
    catch (_) { return null; }
    try {
      if (raw.trim().charAt(0) === "{") return JSON.parse(raw);
    } catch (_) {}

    var payload = {};
    var slug = /"slug"\s*:\s*"([^"]+)"/.exec(raw);
    var md5Id = /"md5_id"\s*:\s*"?([0-9]+)"?/.exec(raw);
    var userId = /"user_id"\s*:\s*"?([0-9]+)"?/.exec(raw);
    var download = /"isDownload"\s*:\s*(true|false)/.exec(raw);
    if (slug) payload.slug = slug[1];
    if (md5Id) payload.md5_id = md5Id[1];
    if (userId) payload.user_id = userId[1];
    if (download) payload.isDownload = download[1] === "true";

    var media = /"media"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(raw);
    if (media) payload.media = decodeEscapedBinary(media[1]);
    else {
      var marker = raw.indexOf("\"media\":\"");
      var config = raw.indexOf("\",\"config\"", marker);
      if (marker >= 0 && config > marker) {
        payload.media = decodeEscapedBinary(raw.substring(marker + 9, config));
      }
    }
    return payload;
  }

  async function decryptAbyssMedia(encryptedText, userId, slug, md5Id) {
    if (!encryptedText || !userId || !slug || !md5Id) return null;
    var raw = new Uint8Array(String(encryptedText).length);
    for (var i = 0; i < raw.length; i++) raw[i] = String(encryptedText).charCodeAt(i) & 255;
    var result = await abyssAesCtrTransform(raw, String(userId) + ":" + String(slug) + ":" + String(md5Id));
    if (!result) return null;
    try {
      var parsed = JSON.parse(bytesToUtf8(result));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function abyssSubtitles(mediaPayload, datas) {
    var list =
      (mediaPayload && (Array.isArray(mediaPayload.subtitles) ? mediaPayload.subtitles :
        Array.isArray(mediaPayload.tracks) ? mediaPayload.tracks : null)) ||
      (datas && Array.isArray(datas.subtitles) ? datas.subtitles : null) ||
      (datas && datas.config && Array.isArray(datas.config.subtitles) ? datas.config.subtitles : null) ||
      [];
    var result = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== "object") continue;
      var src = item.src || item.file || item.url || "";
      if (!src) continue;
      result.push({ url: String(src), lang: String(item.label || item.title || "Sub") });
    }
    return result;
  }

  async function abyssPlaylist(url, label, options, headers, subtitles) {
    if (!url) return [];
    try {
      var parsed = await hlsCandidates(url, options, label, headers, subtitles);
      if (parsed.length) {
        for (var i = 0; i < parsed.length; i++) {
          parsed[i].name = label + " (" + parsed[i].quality + ")";
          parsed[i].title = parsed[i].name;
        }
        return parsed;
      }
    } catch (_) {}
    var fallbackTitle = label === "Abyss" ? "Abyss - Auto" : label + " (Auto)";
    var fallback = candidate(
      options, url, fallbackTitle, "Auto", "m3u8", headers, subtitles
    );
    return fallback ? [fallback] : [];
  }

  function abyssLegacyDecode(encoded) {
    var charset = "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";
    var out = [];
    for (var offset = 0; offset < encoded.length; offset += 4) {
      var chunk = encoded.substring(offset, offset + 4);
      while (chunk.length < 4) chunk += "=";
      var c = [];
      for (var i = 0; i < 4; i++) {
        var index = charset.indexOf(chunk.charAt(i));
        c[i] = index < 0 ? 64 : index;
      }
      out.push((c[0] << 2) | (c[1] >>> 4));
      if (c[2] !== 64) out.push(((c[1] & 15) << 4) | (c[2] >>> 2));
      if (c[3] !== 64) out.push(((c[2] & 3) << 6) | c[3]);
    }
    return bytesToUtf8(new Uint8Array(out));
  }

  function abyssLegacyUrl(html) {
    var source = String(html || "");
    var encoded = /[\w$]+='([A-Za-z0-9+/=RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW]{30,})_'/.exec(source);
    if (encoded) {
      try {
        var parsed = JSON.parse(abyssLegacyDecode(encoded[1]));
        if (parsed && parsed.domain && parsed.id) {
          return "https://" + String(parsed.domain).replace(/^\/+|\/+$/g, "") + "/" + String(parsed.id);
        }
      } catch (_) {}
    }
    var domain = /['"]domain['"]\s*:\s*['"]([^'"]+)['"]/.exec(source);
    var id = /['"]id['"]\s*:\s*['"]([^'"]+)['"]/.exec(source);
    if (domain && id) {
      return "https://" + domain[1].replace(/^\/+|\/+$/g, "") + "/" + id[1];
    }
    return "";
  }

  async function abyssSoraToken(pathValue, sizeValue) {
    var transformed = await abyssAesCtrTransform(utf8Bytes(pathValue), String(sizeValue));
    if (!transformed) return "";
    var first = encodeBase64NoPadding(transformed);
    return encodeBase64NoPadding(utf8Bytes(first));
  }

  async function abyssMediaCandidates(mediaPayload, datas, options, referer) {
    var output = [];
    var headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": referer
    };
    var subtitles = abyssSubtitles(mediaPayload, datas);
    var hls = mediaPayload && mediaPayload.hls;
    if (hls && typeof hls === "object") {
      var hlsLabel = String(hls.label || "");
      var hlsUrl = "";
      var hlsKeys = ["file", "url", "master", "src", "source"];
      for (var i = 0; i < hlsKeys.length; i++) {
        var value = hls[hlsKeys[i]];
        if (typeof value === "string" && value) { hlsUrl = value.replace(/\\\//g, "/"); break; }
      }
      if (hlsUrl) {
        var label = hlsLabel ? "Abyss - " + hlsLabel : "Abyss";
        output = output.concat(await abyssPlaylist(hlsUrl, label, options, headers, subtitles));
      } else if (Array.isArray(hls.sources)) {
        for (var j = 0; j < hls.sources.length; j++) {
          var item = hls.sources[j];
          if (!item || typeof item !== "object") continue;
          var playlist = item.file || item.url || item.src || "";
          if (!playlist) continue;
          playlist = String(playlist).replace(/\\\//g, "/");
          var sourceLabel = String(item.label || "Video");
          output = output.concat(await abyssPlaylist(playlist, "Abyss - " + sourceLabel, options, headers, subtitles));
        }
      }
      var hlsId = String(hls.id || "");
      if (!output.length && hlsId) {
        var fallbackUrl = "https://abyssplayer.com/#hls/" + hlsId + "/master.m3u8";
        var fallback = candidate(options, fallbackUrl, "Abyss - Auto", "Auto", "m3u8", headers, subtitles);
        if (fallback) output.push(fallback);
      }
    }

    var mp4 = mediaPayload && mediaPayload.mp4;
    if (mp4 && typeof mp4 === "object" && Array.isArray(mp4.sources)) {
      var sources = mp4.sources.filter(function (item) { return item && typeof item === "object"; });
      sources.sort(function (a, b) { return Number(b.size || 0) - Number(a.size || 0); });
      var domains = Array.isArray(mp4.domains) ? mp4.domains : [];
      for (var k = 0; k < sources.length; k++) {
        var source = sources[k];
        var sourceLabel = String(source.label || "Video");
        var size = String(source.size || "");
        var resId = String(source.res_id || "");
        var sub = String(source.sub || "");
        var direct = String(source.file || "");
        if (direct) {
          var directUrl = direct.replace(/\\\//g, "/") + "?ext=.mp4";
          var directCandidate = candidate(options, directUrl, "Abyss - " + sourceLabel + " (MP4)", sourceLabel, "mp4", headers, subtitles);
          if (directCandidate) output.push(directCandidate);
          continue;
        }
        var urlValue = String(source.url || "");
        var pathValue = String(source.path || "");
        if (urlValue && pathValue && urlValue.indexOf("sssrr.org") < 0) {
          var combined = urlValue.replace(/\\\//g, "/").replace(/\/+$/g, "") + "/" + pathValue.replace(/\\\//g, "/").replace(/^\/+/g, "");
          var combinedCandidate = candidate(options, combined, "Abyss - " + sourceLabel + " (MP4)", sourceLabel, "mp4", headers, subtitles);
          if (combinedCandidate) output.push(combinedCandidate);
          continue;
        }
        if (size && resId && sub && domains.length) {
          var domain = "";
          for (var d = 0; d < domains.length; d++) {
            var domainValue = String(domains[d] || "");
            if (domainValue && domainValue.indexOf(sub) >= 0) { domain = domainValue; break; }
          }
          if (domain) {
            var soraPath = "/mp4/" + String(datas.md5_id || "") + "/" + resId + "/" + size + "?v=" + String(datas.slug || "");
            var token = await abyssSoraToken(soraPath, size);
            if (token) {
              var normalizedDomain = /^https?:\/\//i.test(domain) ? domain : "https://" + domain;
              var soraUrl = normalizedDomain.replace(/\/+$/g, "") + "/sora/" + size + "/" + token;
              var soraCandidate = candidate(options, soraUrl, "Abyss - " + sourceLabel + " (Sora)", sourceLabel, "mp4", headers, subtitles);
              if (soraCandidate) output.push(soraCandidate);
            }
          }
        }
      }
    }
    return output;
  }

  async function abyss(url, options) {
    options = options || {};
    if (!validRequest(options) || !/^https?:\/\//i.test(String(url || ""))) return [];
    try {
      var original = new URL(String(url));
      var host = original.hostname.toLowerCase();
      var isAlias = /(^|\.)short\.icu$|(^|\.)embedplayabyss\.top$|(^|\.)abysscdn\.com$|(^|\.)abyssplayer\.com$/.test(host);
      var targetUrl = String(url);
      if (isAlias || host === "abyss.to" || host === "player.abyssplayer.com") {
        var id = original.searchParams.get("v") || "";
        if (!id) {
          var embed = /\/embed\/([^/?#]+)/i.exec(original.pathname);
          if (embed) id = embed[1];
          else id = original.pathname.split("/").filter(Boolean).pop() || "";
        }
        if (/^[A-Za-z0-9_-]+$/.test(id)) targetUrl = "https://abyssplayer.com/?v=" + encodeURIComponent(id);
      }
      var baseReferer = String(options.referer || (new URL(targetUrl)).origin + "/");
      var pageHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": baseReferer,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      };
      var pageResponse = await request(targetUrl, pageHeaders, 12000);
      var finalUrl = pageResponse.url || targetUrl;
      var html = await pageResponse.text();
      var datas = extractAbyssDatas(html);
      if (datas) {
        var slug = String(datas.slug || "");
        var md5Id = String(datas.md5_id || "");
        var userId = String(datas.user_id || "");
        var media = datas.media;
        var mediaPayload = null;
        if (media && typeof media === "object" && !Array.isArray(media)) mediaPayload = media;
        else if (typeof media === "string") mediaPayload = await decryptAbyssMedia(media, userId, slug, md5Id);
        if (mediaPayload) {
          var videos = await abyssMediaCandidates(mediaPayload, datas, options, finalUrl);
          if (videos.length) return videos;
        }
      }

      var legacyUrl = abyssLegacyUrl(html);
      if (legacyUrl) {
        var legacyType = /\.m3u8(?:$|\?)/i.test(legacyUrl) ? "m3u8" : "mp4";
        var legacy = candidate(options, legacyUrl, "Abyss - Video", "Auto", legacyType, { Referer: finalUrl }, []);
        if (legacy) return [legacy];
      }
      return [];
    } catch (error) {
      if (options.log) options.log("[Abyss] " + String(error && error.message || error));
      return [];
    }
  }

  root.RAWAnimeExtractors = {
    abyss: abyss,
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
 if(!episodes.length)return[];var out=[],seen={};for(var i=0;i<episodes[0].servers.length;i++){var s=episodes[0].servers[i]||{},u=String(s.url||"");if(!u||seen[u]||/videasy\.net/i.test(u))continue;seen[u]=1;var lang=String(s.lang||"sub").toLowerCase(),name=String(s.name||"AnimeSalt "+lang);if(/megaplay\.buzz/i.test(u)){out=out.concat(await azMega(azAbs(u,page),name,id,ep));continue;}if(/vidmoly/i.test(u)){var shared=globalThis&&globalThis.RAWAnimeExtractors;if(shared){out=out.concat(await shared.vidmoly(azAbs(u,page),{provider:AZ_ID,anilistId:id,episodeNumber:ep,language:lang,labelPrefix:name,log:function(m){console.log(m);}}));}continue;}if(/abyssplayer\.com|abyss\.to|short\.icu|embedplayabyss|abysscdn\.com/i.test(u)){var abyssShared=globalThis&&globalThis.RAWAnimeExtractors;if(abyssShared){out=out.concat(await abyssShared.abyss(azAbs(u,page),{provider:AZ_ID,anilistId:id,episodeNumber:ep,language:lang,labelPrefix:name,referer:azAbs(u,page),log:function(m){console.log(m);}}));}continue;}if(/as-cdn|firevideoplayer\.com|\/video\/[a-f0-9]{16,}/i.test(u)){out=out.concat(await azFirePlayer(azAbs(u,page),name,id,ep,lang));continue;}if(/^https:\/\//i.test(u)){var htm="";try{htm=await(await azFetch(u,{headers:{"Referer":page}})).text();}catch(_){}var direct=(htm.match(/https?:\/\/[^"'\\s]+\.m3u8(?:\?[^"'\\s]*)?/i)||[])[0];if(direct)out.push({name:name,title:name,url:direct,quality:"Auto",type:"m3u8",provider:AZ_ID,language:lang,headers:{"Referer":u},subtitles:[],anilistId:id,episodeNumber:ep});else if(/\.(?:m3u8|mp4|mkv)(?:$|\?)/i.test(u))out.push({name:name,title:name,url:u,quality:"Auto",type:/mp4/i.test(u)?"mp4":/mkv/i.test(u)?"mkv":"m3u8",provider:AZ_ID,language:lang,headers:{"Referer":page},subtitles:[],anilistId:id,episodeNumber:ep});}}
 return out;}catch(e){console.log("[AnimeSalt] "+String(e&&e.message||e));return[];}}
if(typeof globalThis!=="undefined")globalThis.getStreams=getStreams;
if(typeof module!=="undefined"&&module.exports)module.exports={getStreams:getStreams};
