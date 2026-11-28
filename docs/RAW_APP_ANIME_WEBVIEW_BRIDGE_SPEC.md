# RAW App: Anime Native WebView Stream Resolver

**Status:** Implemented in the RAW Android native host; real-device MPV acceptance remains pending  
**Scope:** Anime provider embeds that require a real Android WebView to reveal media requests  
**Reference implementation:** `extractors/universal-extractor/.../UniversalExtractor.kt`

## Why this belongs in the Android host

A QuickJS provider can fetch pages and parse public responses, but it cannot reproduce Android WebView behavior: DOM execution, browser-managed page state, media playback activation, and `WebViewClient.shouldInterceptRequest`. UniversalExtractor depends on all of these. Returning the embed page itself as a stream is not an acceptable substitute.

This capability is also reusable beyond Animostream. The current Kotlin sources call UniversalExtractor from Animostream, AnimeSalt, AniChan, Miruro and Anikage flows. Implement it once in RAW's Android playback host, then expose it to anime QuickJS providers through a narrow, versioned bridge.

The bridge is not a CAPTCHA, Turnstile, DRM, login, or paywall bypass. A page that requires user verification must be surfaced for normal user interaction or fail closed.

## Proposed QuickJS ABI

Expose one optional asynchronous host function:

```js
globalThis.RAW_HOST.resolveAnimeEmbed({
  capability: "raw.anime.webview-stream",
  version: 1,
  provider: "animostream",
  anilistId: "16498",
  episodeNumber: 12,
  embedUrl: "https://embed.example/watch/abc",
  pageUrl: "https://source.example/episode/12",
  headers: {
    "User-Agent": "the provider's observed browser user-agent",
    "Referer": "https://source.example/"
  },
  timeoutMs: 15000
});
```

The bridge must be optional. A provider checks for it and returns no candidate when it is unavailable; it must not return the unresolved embed URL as a fallback.

### Request validation

The Android host, not the plugin, is the trust boundary. Before creating a WebView it must:

1. Validate `capability` and the exact supported `version`.
2. Validate the active AniList ID and positive episode number against the playback request. Ignore identity values supplied only by the plugin.
3. Require an HTTPS embed URL and apply RAW's embed-host/network policy.
4. Bind `pageUrl` and Referer to the source selected for the same anime episode. Reject a mismatched or unrelated referer.
5. Accept only a small, documented header allowlist (for example User-Agent, Referer, Accept and Accept-Language). Do not allow plugins to inject Cookie, Authorization, proxy, or arbitrary transport headers.
6. Enforce a maximum timeout (15 seconds by default) and an explicit request cancellation handle.

## Response contract

Return a structured result rather than a bare string:

```json
{
  "capability": "raw.anime.webview-stream",
  "version": 1,
  "status": "resolved",
  "anilistId": "16498",
  "episodeNumber": 12,
  "streams": [
    {
      "url": "http://127.0.0.1:42000/raw-anime/session-id?u=encoded-upstream-url",
      "protocol": "hls",
      "headers": {},
      "discoveredBy": "webview-request-interception"
    }
  ],
  "subtitles": []
}
```

Supported statuses:

| Status | Meaning | Provider behavior |
|---|---|---|
| `resolved` | A valid media request was observed and classified | Convert verified stream records into ordinary RAW candidates |
| `not_found` | No supported media request was observed before the deadline | Return no candidate |
| `needs_user_action` | The page requires a normal user interaction or verification | Surface the browser/session handoff; do not retry with evasion |
| `blocked` | The URL, host, redirect, or requested behavior violates host policy | Return no candidate and log a diagnostic |
| `timeout` | The deadline elapsed | Return no candidate |
| `cancelled` | The playback request was superseded or cancelled | Stop the WebView and discard all results |
| `error` | An unexpected WebView or parser error occurred | Return no candidate and retain a diagnostic |

Every returned stream must retain the active AniList ID and episode association in host-owned state. The host must validate the identity again immediately before MPV handoff.

## Android implementation requirements

### WebView lifecycle

- Create, configure, interact with, stop and destroy the WebView on the Android main thread.
- Use an isolated, short-lived WebView instance per resolution request. Do not reuse cookies or storage across unrelated providers or anime identities.
- Enable only the WebView features required by the provider's player (JavaScript and DOM storage where observed). Use the provider's observed User-Agent and preserve the source Referer.
- Set mixed-content behavior deliberately per host policy; do not globally permit insecure content without a specific requirement.
- Disable downloads, external intents, file access, content access, popups and unknown custom schemes unless a separately reviewed capability requires them.
- Cancel network loads and destroy the WebView on timeout, playback change, screen exit or coroutine cancellation. A late callback must never publish a stale candidate.

### Media request interception

Use a request matcher equivalent to the original UniversalExtractor patterns:

- HLS: `.m3u8`
- DASH: `.mpd`
- Progressive media: `.mp4`, `videoplayback`, `googlevideo`, `googleusercontent`, `action=stream`
- Segment indicators such as `.ts`, `.m4s`, `/hls/` and `/stream/` are useful evidence, but a segment alone is not a master stream candidate.

Capture the request URL and the request's relevant headers from `shouldInterceptRequest`. Prefer a master manifest over a media segment if both are observed. Do not report analytics, poster, thumbnail, ad, JavaScript, CSS or image URLs as streams.

### Playback activation

The upstream Kotlin implementation attempts normal player activation after page load. RAW should keep this narrowly scoped:

1. Wait for page completion.
2. Attempt known player APIs such as `jwplayer().play()` and `video.play()`.
3. When needed, interact only with known player play controls inside the player container.
4. Do not click arbitrary page buttons, purchase/subscribe controls, login buttons, consent prompts, or verification widgets automatically.
5. If a user gesture or challenge is required, return `needs_user_action` and allow a normal user-mediated browser interaction.

The bridge must not evaluate plugin-supplied JavaScript. The playback activation shim is fixed host code, reviewed and versioned with the app.

### Parsing and candidate creation

After intercepting a URL:

- HLS: parse the master manifest natively, preserve audio-group mappings and subtitle renditions, and emit only observed qualities/tracks.
- DASH: rewrite non-DRM MPDs natively. The relay handles inherited `BaseURL`, `SegmentURL`, `Initialization`/`RepresentationIndex` references, and `SegmentTemplate` media/initialization/index/bitstream-switching URLs. Template substitutions are handled by session-scoped native routes for `$Number# RAW App: Anime Native WebView Stream Resolver

**Status:** Implemented in the RAW Android native host; real-device MPV acceptance remains pending  
**Scope:** Anime provider embeds that require a real Android WebView to reveal media requests  
**Reference implementation:** `extractors/universal-extractor/.../UniversalExtractor.kt`

## Why this belongs in the Android host

A QuickJS provider can fetch pages and parse public responses, but it cannot reproduce Android WebView behavior: DOM execution, browser-managed page state, media playback activation, and `WebViewClient.shouldInterceptRequest`. UniversalExtractor depends on all of these. Returning the embed page itself as a stream is not an acceptable substitute.

This capability is also reusable beyond Animostream. The current Kotlin sources call UniversalExtractor from Animostream, AnimeSalt, AniChan, Miruro and Anikage flows. Implement it once in RAW's Android playback host, then expose it to anime QuickJS providers through a narrow, versioned bridge.

The bridge is not a CAPTCHA, Turnstile, DRM, login, or paywall bypass. A page that requires user verification must be surfaced for normal user interaction or fail closed.

## Proposed QuickJS ABI

Expose one optional asynchronous host function:

```js
globalThis.RAW_HOST.resolveAnimeEmbed({
  capability: "raw.anime.webview-stream",
  version: 1,
  provider: "animostream",
  anilistId: "16498",
  episodeNumber: 12,
  embedUrl: "https://embed.example/watch/abc",
  pageUrl: "https://source.example/episode/12",
  headers: {
    "User-Agent": "the provider's observed browser user-agent",
    "Referer": "https://source.example/"
  },
  timeoutMs: 15000
});
```

The bridge must be optional. A provider checks for it and returns no candidate when it is unavailable; it must not return the unresolved embed URL as a fallback.

### Request validation

The Android host, not the plugin, is the trust boundary. Before creating a WebView it must:

1. Validate `capability` and the exact supported `version`.
2. Validate the active AniList ID and positive episode number against the playback request. Ignore identity values supplied only by the plugin.
3. Require an HTTPS embed URL and apply RAW's embed-host/network policy.
4. Bind `pageUrl` and Referer to the source selected for the same anime episode. Reject a mismatched or unrelated referer.
5. Accept only a small, documented header allowlist (for example User-Agent, Referer, Accept and Accept-Language). Do not allow plugins to inject Cookie, Authorization, proxy, or arbitrary transport headers.
6. Enforce a maximum timeout (15 seconds by default) and an explicit request cancellation handle.

## Response contract

Return a structured result rather than a bare string:

```json
{
  "capability": "raw.anime.webview-stream",
  "version": 1,
  "status": "resolved",
  "anilistId": "16498",
  "episodeNumber": 12,
  "streams": [
    {
      "url": "http://127.0.0.1:42000/raw-anime/session-id?u=encoded-upstream-url",
      "protocol": "hls",
      "headers": {},
      "discoveredBy": "webview-request-interception"
    }
  ],
  "subtitles": []
}
```

Supported statuses:

| Status | Meaning | Provider behavior |
|---|---|---|
| `resolved` | A valid media request was observed and classified | Convert verified stream records into ordinary RAW candidates |
| `not_found` | No supported media request was observed before the deadline | Return no candidate |
| `needs_user_action` | The page requires a normal user interaction or verification | Surface the browser/session handoff; do not retry with evasion |
| `blocked` | The URL, host, redirect, or requested behavior violates host policy | Return no candidate and log a diagnostic |
| `timeout` | The deadline elapsed | Return no candidate |
| `cancelled` | The playback request was superseded or cancelled | Stop the WebView and discard all results |
| `error` | An unexpected WebView or parser error occurred | Return no candidate and retain a diagnostic |

Every returned stream must retain the active AniList ID and episode association in host-owned state. The host must validate the identity again immediately before MPV handoff.

## Android implementation requirements

### WebView lifecycle

- Create, configure, interact with, stop and destroy the WebView on the Android main thread.
- Use an isolated, short-lived WebView instance per resolution request. Do not reuse cookies or storage across unrelated providers or anime identities.
- Enable only the WebView features required by the provider's player (JavaScript and DOM storage where observed). Use the provider's observed User-Agent and preserve the source Referer.
- Set mixed-content behavior deliberately per host policy; do not globally permit insecure content without a specific requirement.
- Disable downloads, external intents, file access, content access, popups and unknown custom schemes unless a separately reviewed capability requires them.
- Cancel network loads and destroy the WebView on timeout, playback change, screen exit or coroutine cancellation. A late callback must never publish a stale candidate.

### Media request interception

Use a request matcher equivalent to the original UniversalExtractor patterns:

- HLS: `.m3u8`
- DASH: `.mpd`
- Progressive media: `.mp4`, `videoplayback`, `googlevideo`, `googleusercontent`, `action=stream`
- Segment indicators such as `.ts`, `.m4s`, `/hls/` and `/stream/` are useful evidence, but a segment alone is not a master stream candidate.

Capture the request URL and the request's relevant headers from `shouldInterceptRequest`. Prefer a master manifest over a media segment if both are observed. Do not report analytics, poster, thumbnail, ad, JavaScript, CSS or image URLs as streams.

### Playback activation

The upstream Kotlin implementation attempts normal player activation after page load. RAW should keep this narrowly scoped:

1. Wait for page completion.
2. Attempt known player APIs such as `jwplayer().play()` and `video.play()`.
3. When needed, interact only with known player play controls inside the player container.
4. Do not click arbitrary page buttons, purchase/subscribe controls, login buttons, consent prompts, or verification widgets automatically.
5. If a user gesture or challenge is required, return `needs_user_action` and allow a normal user-mediated browser interaction.

The bridge must not evaluate plugin-supplied JavaScript. The playback activation shim is fixed host code, reviewed and versioned with the app.

### Parsing and candidate creation

After intercepting a URL:

- HLS: parse the master manifest natively, preserve audio-group mappings and subtitle renditions, and emit only observed qualities/tracks.
, formatted `$Number%0Nd# RAW App: Anime Native WebView Stream Resolver

**Status:** Implemented in the RAW Android native host; real-device MPV acceptance remains pending  
**Scope:** Anime provider embeds that require a real Android WebView to reveal media requests  
**Reference implementation:** `extractors/universal-extractor/.../UniversalExtractor.kt`

## Why this belongs in the Android host

A QuickJS provider can fetch pages and parse public responses, but it cannot reproduce Android WebView behavior: DOM execution, browser-managed page state, media playback activation, and `WebViewClient.shouldInterceptRequest`. UniversalExtractor depends on all of these. Returning the embed page itself as a stream is not an acceptable substitute.

This capability is also reusable beyond Animostream. The current Kotlin sources call UniversalExtractor from Animostream, AnimeSalt, AniChan, Miruro and Anikage flows. Implement it once in RAW's Android playback host, then expose it to anime QuickJS providers through a narrow, versioned bridge.

The bridge is not a CAPTCHA, Turnstile, DRM, login, or paywall bypass. A page that requires user verification must be surfaced for normal user interaction or fail closed.

## Proposed QuickJS ABI

Expose one optional asynchronous host function:

```js
globalThis.RAW_HOST.resolveAnimeEmbed({
  capability: "raw.anime.webview-stream",
  version: 1,
  provider: "animostream",
  anilistId: "16498",
  episodeNumber: 12,
  embedUrl: "https://embed.example/watch/abc",
  pageUrl: "https://source.example/episode/12",
  headers: {
    "User-Agent": "the provider's observed browser user-agent",
    "Referer": "https://source.example/"
  },
  timeoutMs: 15000
});
```

The bridge must be optional. A provider checks for it and returns no candidate when it is unavailable; it must not return the unresolved embed URL as a fallback.

### Request validation

The Android host, not the plugin, is the trust boundary. Before creating a WebView it must:

1. Validate `capability` and the exact supported `version`.
2. Validate the active AniList ID and positive episode number against the playback request. Ignore identity values supplied only by the plugin.
3. Require an HTTPS embed URL and apply RAW's embed-host/network policy.
4. Bind `pageUrl` and Referer to the source selected for the same anime episode. Reject a mismatched or unrelated referer.
5. Accept only a small, documented header allowlist (for example User-Agent, Referer, Accept and Accept-Language). Do not allow plugins to inject Cookie, Authorization, proxy, or arbitrary transport headers.
6. Enforce a maximum timeout (15 seconds by default) and an explicit request cancellation handle.

## Response contract

Return a structured result rather than a bare string:

```json
{
  "capability": "raw.anime.webview-stream",
  "version": 1,
  "status": "resolved",
  "anilistId": "16498",
  "episodeNumber": 12,
  "streams": [
    {
      "url": "http://127.0.0.1:42000/raw-anime/session-id?u=encoded-upstream-url",
      "protocol": "hls",
      "headers": {},
      "discoveredBy": "webview-request-interception"
    }
  ],
  "subtitles": []
}
```

Supported statuses:

| Status | Meaning | Provider behavior |
|---|---|---|
| `resolved` | A valid media request was observed and classified | Convert verified stream records into ordinary RAW candidates |
| `not_found` | No supported media request was observed before the deadline | Return no candidate |
| `needs_user_action` | The page requires a normal user interaction or verification | Surface the browser/session handoff; do not retry with evasion |
| `blocked` | The URL, host, redirect, or requested behavior violates host policy | Return no candidate and log a diagnostic |
| `timeout` | The deadline elapsed | Return no candidate |
| `cancelled` | The playback request was superseded or cancelled | Stop the WebView and discard all results |
| `error` | An unexpected WebView or parser error occurred | Return no candidate and retain a diagnostic |

Every returned stream must retain the active AniList ID and episode association in host-owned state. The host must validate the identity again immediately before MPV handoff.

## Android implementation requirements

### WebView lifecycle

- Create, configure, interact with, stop and destroy the WebView on the Android main thread.
- Use an isolated, short-lived WebView instance per resolution request. Do not reuse cookies or storage across unrelated providers or anime identities.
- Enable only the WebView features required by the provider's player (JavaScript and DOM storage where observed). Use the provider's observed User-Agent and preserve the source Referer.
- Set mixed-content behavior deliberately per host policy; do not globally permit insecure content without a specific requirement.
- Disable downloads, external intents, file access, content access, popups and unknown custom schemes unless a separately reviewed capability requires them.
- Cancel network loads and destroy the WebView on timeout, playback change, screen exit or coroutine cancellation. A late callback must never publish a stale candidate.

### Media request interception

Use a request matcher equivalent to the original UniversalExtractor patterns:

- HLS: `.m3u8`
- DASH: `.mpd`
- Progressive media: `.mp4`, `videoplayback`, `googlevideo`, `googleusercontent`, `action=stream`
- Segment indicators such as `.ts`, `.m4s`, `/hls/` and `/stream/` are useful evidence, but a segment alone is not a master stream candidate.

Capture the request URL and the request's relevant headers from `shouldInterceptRequest`. Prefer a master manifest over a media segment if both are observed. Do not report analytics, poster, thumbnail, ad, JavaScript, CSS or image URLs as streams.

### Playback activation

The upstream Kotlin implementation attempts normal player activation after page load. RAW should keep this narrowly scoped:

1. Wait for page completion.
2. Attempt known player APIs such as `jwplayer().play()` and `video.play()`.
3. When needed, interact only with known player play controls inside the player container.
4. Do not click arbitrary page buttons, purchase/subscribe controls, login buttons, consent prompts, or verification widgets automatically.
5. If a user gesture or challenge is required, return `needs_user_action` and allow a normal user-mediated browser interaction.

The bridge must not evaluate plugin-supplied JavaScript. The playback activation shim is fixed host code, reviewed and versioned with the app.

### Parsing and candidate creation

After intercepting a URL:

- HLS: parse the master manifest natively, preserve audio-group mappings and subtitle renditions, and emit only observed qualities/tracks.
, `$Time# RAW App: Anime Native WebView Stream Resolver

**Status:** Implemented in the RAW Android native host; real-device MPV acceptance remains pending  
**Scope:** Anime provider embeds that require a real Android WebView to reveal media requests  
**Reference implementation:** `extractors/universal-extractor/.../UniversalExtractor.kt`

## Why this belongs in the Android host

A QuickJS provider can fetch pages and parse public responses, but it cannot reproduce Android WebView behavior: DOM execution, browser-managed page state, media playback activation, and `WebViewClient.shouldInterceptRequest`. UniversalExtractor depends on all of these. Returning the embed page itself as a stream is not an acceptable substitute.

This capability is also reusable beyond Animostream. The current Kotlin sources call UniversalExtractor from Animostream, AnimeSalt, AniChan, Miruro and Anikage flows. Implement it once in RAW's Android playback host, then expose it to anime QuickJS providers through a narrow, versioned bridge.

The bridge is not a CAPTCHA, Turnstile, DRM, login, or paywall bypass. A page that requires user verification must be surfaced for normal user interaction or fail closed.

## Proposed QuickJS ABI

Expose one optional asynchronous host function:

```js
globalThis.RAW_HOST.resolveAnimeEmbed({
  capability: "raw.anime.webview-stream",
  version: 1,
  provider: "animostream",
  anilistId: "16498",
  episodeNumber: 12,
  embedUrl: "https://embed.example/watch/abc",
  pageUrl: "https://source.example/episode/12",
  headers: {
    "User-Agent": "the provider's observed browser user-agent",
    "Referer": "https://source.example/"
  },
  timeoutMs: 15000
});
```

The bridge must be optional. A provider checks for it and returns no candidate when it is unavailable; it must not return the unresolved embed URL as a fallback.

### Request validation

The Android host, not the plugin, is the trust boundary. Before creating a WebView it must:

1. Validate `capability` and the exact supported `version`.
2. Validate the active AniList ID and positive episode number against the playback request. Ignore identity values supplied only by the plugin.
3. Require an HTTPS embed URL and apply RAW's embed-host/network policy.
4. Bind `pageUrl` and Referer to the source selected for the same anime episode. Reject a mismatched or unrelated referer.
5. Accept only a small, documented header allowlist (for example User-Agent, Referer, Accept and Accept-Language). Do not allow plugins to inject Cookie, Authorization, proxy, or arbitrary transport headers.
6. Enforce a maximum timeout (15 seconds by default) and an explicit request cancellation handle.

## Response contract

Return a structured result rather than a bare string:

```json
{
  "capability": "raw.anime.webview-stream",
  "version": 1,
  "status": "resolved",
  "anilistId": "16498",
  "episodeNumber": 12,
  "streams": [
    {
      "url": "http://127.0.0.1:42000/raw-anime/session-id?u=encoded-upstream-url",
      "protocol": "hls",
      "headers": {},
      "discoveredBy": "webview-request-interception"
    }
  ],
  "subtitles": []
}
```

Supported statuses:

| Status | Meaning | Provider behavior |
|---|---|---|
| `resolved` | A valid media request was observed and classified | Convert verified stream records into ordinary RAW candidates |
| `not_found` | No supported media request was observed before the deadline | Return no candidate |
| `needs_user_action` | The page requires a normal user interaction or verification | Surface the browser/session handoff; do not retry with evasion |
| `blocked` | The URL, host, redirect, or requested behavior violates host policy | Return no candidate and log a diagnostic |
| `timeout` | The deadline elapsed | Return no candidate |
| `cancelled` | The playback request was superseded or cancelled | Stop the WebView and discard all results |
| `error` | An unexpected WebView or parser error occurred | Return no candidate and retain a diagnostic |

Every returned stream must retain the active AniList ID and episode association in host-owned state. The host must validate the identity again immediately before MPV handoff.

## Android implementation requirements

### WebView lifecycle

- Create, configure, interact with, stop and destroy the WebView on the Android main thread.
- Use an isolated, short-lived WebView instance per resolution request. Do not reuse cookies or storage across unrelated providers or anime identities.
- Enable only the WebView features required by the provider's player (JavaScript and DOM storage where observed). Use the provider's observed User-Agent and preserve the source Referer.
- Set mixed-content behavior deliberately per host policy; do not globally permit insecure content without a specific requirement.
- Disable downloads, external intents, file access, content access, popups and unknown custom schemes unless a separately reviewed capability requires them.
- Cancel network loads and destroy the WebView on timeout, playback change, screen exit or coroutine cancellation. A late callback must never publish a stale candidate.

### Media request interception

Use a request matcher equivalent to the original UniversalExtractor patterns:

- HLS: `.m3u8`
- DASH: `.mpd`
- Progressive media: `.mp4`, `videoplayback`, `googlevideo`, `googleusercontent`, `action=stream`
- Segment indicators such as `.ts`, `.m4s`, `/hls/` and `/stream/` are useful evidence, but a segment alone is not a master stream candidate.

Capture the request URL and the request's relevant headers from `shouldInterceptRequest`. Prefer a master manifest over a media segment if both are observed. Do not report analytics, poster, thumbnail, ad, JavaScript, CSS or image URLs as streams.

### Playback activation

The upstream Kotlin implementation attempts normal player activation after page load. RAW should keep this narrowly scoped:

1. Wait for page completion.
2. Attempt known player APIs such as `jwplayer().play()` and `video.play()`.
3. When needed, interact only with known player play controls inside the player container.
4. Do not click arbitrary page buttons, purchase/subscribe controls, login buttons, consent prompts, or verification widgets automatically.
5. If a user gesture or challenge is required, return `needs_user_action` and allow a normal user-mediated browser interaction.

The bridge must not evaluate plugin-supplied JavaScript. The playback activation shim is fixed host code, reviewed and versioned with the app.

### Parsing and candidate creation

After intercepting a URL:

- HLS: parse the master manifest natively, preserve audio-group mappings and subtitle renditions, and emit only observed qualities/tracks.
, `$RepresentationID# RAW App: Anime Native WebView Stream Resolver

**Status:** Implemented in the RAW Android native host; real-device MPV acceptance remains pending  
**Scope:** Anime provider embeds that require a real Android WebView to reveal media requests  
**Reference implementation:** `extractors/universal-extractor/.../UniversalExtractor.kt`

## Why this belongs in the Android host

A QuickJS provider can fetch pages and parse public responses, but it cannot reproduce Android WebView behavior: DOM execution, browser-managed page state, media playback activation, and `WebViewClient.shouldInterceptRequest`. UniversalExtractor depends on all of these. Returning the embed page itself as a stream is not an acceptable substitute.

This capability is also reusable beyond Animostream. The current Kotlin sources call UniversalExtractor from Animostream, AnimeSalt, AniChan, Miruro and Anikage flows. Implement it once in RAW's Android playback host, then expose it to anime QuickJS providers through a narrow, versioned bridge.

The bridge is not a CAPTCHA, Turnstile, DRM, login, or paywall bypass. A page that requires user verification must be surfaced for normal user interaction or fail closed.

## Proposed QuickJS ABI

Expose one optional asynchronous host function:

```js
globalThis.RAW_HOST.resolveAnimeEmbed({
  capability: "raw.anime.webview-stream",
  version: 1,
  provider: "animostream",
  anilistId: "16498",
  episodeNumber: 12,
  embedUrl: "https://embed.example/watch/abc",
  pageUrl: "https://source.example/episode/12",
  headers: {
    "User-Agent": "the provider's observed browser user-agent",
    "Referer": "https://source.example/"
  },
  timeoutMs: 15000
});
```

The bridge must be optional. A provider checks for it and returns no candidate when it is unavailable; it must not return the unresolved embed URL as a fallback.

### Request validation

The Android host, not the plugin, is the trust boundary. Before creating a WebView it must:

1. Validate `capability` and the exact supported `version`.
2. Validate the active AniList ID and positive episode number against the playback request. Ignore identity values supplied only by the plugin.
3. Require an HTTPS embed URL and apply RAW's embed-host/network policy.
4. Bind `pageUrl` and Referer to the source selected for the same anime episode. Reject a mismatched or unrelated referer.
5. Accept only a small, documented header allowlist (for example User-Agent, Referer, Accept and Accept-Language). Do not allow plugins to inject Cookie, Authorization, proxy, or arbitrary transport headers.
6. Enforce a maximum timeout (15 seconds by default) and an explicit request cancellation handle.

## Response contract

Return a structured result rather than a bare string:

```json
{
  "capability": "raw.anime.webview-stream",
  "version": 1,
  "status": "resolved",
  "anilistId": "16498",
  "episodeNumber": 12,
  "streams": [
    {
      "url": "http://127.0.0.1:42000/raw-anime/session-id?u=encoded-upstream-url",
      "protocol": "hls",
      "headers": {},
      "discoveredBy": "webview-request-interception"
    }
  ],
  "subtitles": []
}
```

Supported statuses:

| Status | Meaning | Provider behavior |
|---|---|---|
| `resolved` | A valid media request was observed and classified | Convert verified stream records into ordinary RAW candidates |
| `not_found` | No supported media request was observed before the deadline | Return no candidate |
| `needs_user_action` | The page requires a normal user interaction or verification | Surface the browser/session handoff; do not retry with evasion |
| `blocked` | The URL, host, redirect, or requested behavior violates host policy | Return no candidate and log a diagnostic |
| `timeout` | The deadline elapsed | Return no candidate |
| `cancelled` | The playback request was superseded or cancelled | Stop the WebView and discard all results |
| `error` | An unexpected WebView or parser error occurred | Return no candidate and retain a diagnostic |

Every returned stream must retain the active AniList ID and episode association in host-owned state. The host must validate the identity again immediately before MPV handoff.

## Android implementation requirements

### WebView lifecycle

- Create, configure, interact with, stop and destroy the WebView on the Android main thread.
- Use an isolated, short-lived WebView instance per resolution request. Do not reuse cookies or storage across unrelated providers or anime identities.
- Enable only the WebView features required by the provider's player (JavaScript and DOM storage where observed). Use the provider's observed User-Agent and preserve the source Referer.
- Set mixed-content behavior deliberately per host policy; do not globally permit insecure content without a specific requirement.
- Disable downloads, external intents, file access, content access, popups and unknown custom schemes unless a separately reviewed capability requires them.
- Cancel network loads and destroy the WebView on timeout, playback change, screen exit or coroutine cancellation. A late callback must never publish a stale candidate.

### Media request interception

Use a request matcher equivalent to the original UniversalExtractor patterns:

- HLS: `.m3u8`
- DASH: `.mpd`
- Progressive media: `.mp4`, `videoplayback`, `googlevideo`, `googleusercontent`, `action=stream`
- Segment indicators such as `.ts`, `.m4s`, `/hls/` and `/stream/` are useful evidence, but a segment alone is not a master stream candidate.

Capture the request URL and the request's relevant headers from `shouldInterceptRequest`. Prefer a master manifest over a media segment if both are observed. Do not report analytics, poster, thumbnail, ad, JavaScript, CSS or image URLs as streams.

### Playback activation

The upstream Kotlin implementation attempts normal player activation after page load. RAW should keep this narrowly scoped:

1. Wait for page completion.
2. Attempt known player APIs such as `jwplayer().play()` and `video.play()`.
3. When needed, interact only with known player play controls inside the player container.
4. Do not click arbitrary page buttons, purchase/subscribe controls, login buttons, consent prompts, or verification widgets automatically.
5. If a user gesture or challenge is required, return `needs_user_action` and allow a normal user-mediated browser interaction.

The bridge must not evaluate plugin-supplied JavaScript. The playback activation shim is fixed host code, reviewed and versioned with the app.

### Parsing and candidate creation

After intercepting a URL:

- HLS: parse the master manifest natively, preserve audio-group mappings and subtitle renditions, and emit only observed qualities/tracks.
, `$Bandwidth# RAW App: Anime Native WebView Stream Resolver

**Status:** Implemented in the RAW Android native host; real-device MPV acceptance remains pending  
**Scope:** Anime provider embeds that require a real Android WebView to reveal media requests  
**Reference implementation:** `extractors/universal-extractor/.../UniversalExtractor.kt`

## Why this belongs in the Android host

A QuickJS provider can fetch pages and parse public responses, but it cannot reproduce Android WebView behavior: DOM execution, browser-managed page state, media playback activation, and `WebViewClient.shouldInterceptRequest`. UniversalExtractor depends on all of these. Returning the embed page itself as a stream is not an acceptable substitute.

This capability is also reusable beyond Animostream. The current Kotlin sources call UniversalExtractor from Animostream, AnimeSalt, AniChan, Miruro and Anikage flows. Implement it once in RAW's Android playback host, then expose it to anime QuickJS providers through a narrow, versioned bridge.

The bridge is not a CAPTCHA, Turnstile, DRM, login, or paywall bypass. A page that requires user verification must be surfaced for normal user interaction or fail closed.

## Proposed QuickJS ABI

Expose one optional asynchronous host function:

```js
globalThis.RAW_HOST.resolveAnimeEmbed({
  capability: "raw.anime.webview-stream",
  version: 1,
  provider: "animostream",
  anilistId: "16498",
  episodeNumber: 12,
  embedUrl: "https://embed.example/watch/abc",
  pageUrl: "https://source.example/episode/12",
  headers: {
    "User-Agent": "the provider's observed browser user-agent",
    "Referer": "https://source.example/"
  },
  timeoutMs: 15000
});
```

The bridge must be optional. A provider checks for it and returns no candidate when it is unavailable; it must not return the unresolved embed URL as a fallback.

### Request validation

The Android host, not the plugin, is the trust boundary. Before creating a WebView it must:

1. Validate `capability` and the exact supported `version`.
2. Validate the active AniList ID and positive episode number against the playback request. Ignore identity values supplied only by the plugin.
3. Require an HTTPS embed URL and apply RAW's embed-host/network policy.
4. Bind `pageUrl` and Referer to the source selected for the same anime episode. Reject a mismatched or unrelated referer.
5. Accept only a small, documented header allowlist (for example User-Agent, Referer, Accept and Accept-Language). Do not allow plugins to inject Cookie, Authorization, proxy, or arbitrary transport headers.
6. Enforce a maximum timeout (15 seconds by default) and an explicit request cancellation handle.

## Response contract

Return a structured result rather than a bare string:

```json
{
  "capability": "raw.anime.webview-stream",
  "version": 1,
  "status": "resolved",
  "anilistId": "16498",
  "episodeNumber": 12,
  "streams": [
    {
      "url": "http://127.0.0.1:42000/raw-anime/session-id?u=encoded-upstream-url",
      "protocol": "hls",
      "headers": {},
      "discoveredBy": "webview-request-interception"
    }
  ],
  "subtitles": []
}
```

Supported statuses:

| Status | Meaning | Provider behavior |
|---|---|---|
| `resolved` | A valid media request was observed and classified | Convert verified stream records into ordinary RAW candidates |
| `not_found` | No supported media request was observed before the deadline | Return no candidate |
| `needs_user_action` | The page requires a normal user interaction or verification | Surface the browser/session handoff; do not retry with evasion |
| `blocked` | The URL, host, redirect, or requested behavior violates host policy | Return no candidate and log a diagnostic |
| `timeout` | The deadline elapsed | Return no candidate |
| `cancelled` | The playback request was superseded or cancelled | Stop the WebView and discard all results |
| `error` | An unexpected WebView or parser error occurred | Return no candidate and retain a diagnostic |

Every returned stream must retain the active AniList ID and episode association in host-owned state. The host must validate the identity again immediately before MPV handoff.

## Android implementation requirements

### WebView lifecycle

- Create, configure, interact with, stop and destroy the WebView on the Android main thread.
- Use an isolated, short-lived WebView instance per resolution request. Do not reuse cookies or storage across unrelated providers or anime identities.
- Enable only the WebView features required by the provider's player (JavaScript and DOM storage where observed). Use the provider's observed User-Agent and preserve the source Referer.
- Set mixed-content behavior deliberately per host policy; do not globally permit insecure content without a specific requirement.
- Disable downloads, external intents, file access, content access, popups and unknown custom schemes unless a separately reviewed capability requires them.
- Cancel network loads and destroy the WebView on timeout, playback change, screen exit or coroutine cancellation. A late callback must never publish a stale candidate.

### Media request interception

Use a request matcher equivalent to the original UniversalExtractor patterns:

- HLS: `.m3u8`
- DASH: `.mpd`
- Progressive media: `.mp4`, `videoplayback`, `googlevideo`, `googleusercontent`, `action=stream`
- Segment indicators such as `.ts`, `.m4s`, `/hls/` and `/stream/` are useful evidence, but a segment alone is not a master stream candidate.

Capture the request URL and the request's relevant headers from `shouldInterceptRequest`. Prefer a master manifest over a media segment if both are observed. Do not report analytics, poster, thumbnail, ad, JavaScript, CSS or image URLs as streams.

### Playback activation

The upstream Kotlin implementation attempts normal player activation after page load. RAW should keep this narrowly scoped:

1. Wait for page completion.
2. Attempt known player APIs such as `jwplayer().play()` and `video.play()`.
3. When needed, interact only with known player play controls inside the player container.
4. Do not click arbitrary page buttons, purchase/subscribe controls, login buttons, consent prompts, or verification widgets automatically.
5. If a user gesture or challenge is required, return `needs_user_action` and allow a normal user-mediated browser interaction.

The bridge must not evaluate plugin-supplied JavaScript. The playback activation shim is fixed host code, reviewed and versioned with the app.

### Parsing and candidate creation

After intercepting a URL:

- HLS: parse the master manifest natively, preserve audio-group mappings and subtitle renditions, and emit only observed qualities/tracks.
 and `$SubNumber# RAW App: Anime Native WebView Stream Resolver

**Status:** Implemented in the RAW Android native host; real-device MPV acceptance remains pending  
**Scope:** Anime provider embeds that require a real Android WebView to reveal media requests  
**Reference implementation:** `extractors/universal-extractor/.../UniversalExtractor.kt`

## Why this belongs in the Android host

A QuickJS provider can fetch pages and parse public responses, but it cannot reproduce Android WebView behavior: DOM execution, browser-managed page state, media playback activation, and `WebViewClient.shouldInterceptRequest`. UniversalExtractor depends on all of these. Returning the embed page itself as a stream is not an acceptable substitute.

This capability is also reusable beyond Animostream. The current Kotlin sources call UniversalExtractor from Animostream, AnimeSalt, AniChan, Miruro and Anikage flows. Implement it once in RAW's Android playback host, then expose it to anime QuickJS providers through a narrow, versioned bridge.

The bridge is not a CAPTCHA, Turnstile, DRM, login, or paywall bypass. A page that requires user verification must be surfaced for normal user interaction or fail closed.

## Proposed QuickJS ABI

Expose one optional asynchronous host function:

```js
globalThis.RAW_HOST.resolveAnimeEmbed({
  capability: "raw.anime.webview-stream",
  version: 1,
  provider: "animostream",
  anilistId: "16498",
  episodeNumber: 12,
  embedUrl: "https://embed.example/watch/abc",
  pageUrl: "https://source.example/episode/12",
  headers: {
    "User-Agent": "the provider's observed browser user-agent",
    "Referer": "https://source.example/"
  },
  timeoutMs: 15000
});
```

The bridge must be optional. A provider checks for it and returns no candidate when it is unavailable; it must not return the unresolved embed URL as a fallback.

### Request validation

The Android host, not the plugin, is the trust boundary. Before creating a WebView it must:

1. Validate `capability` and the exact supported `version`.
2. Validate the active AniList ID and positive episode number against the playback request. Ignore identity values supplied only by the plugin.
3. Require an HTTPS embed URL and apply RAW's embed-host/network policy.
4. Bind `pageUrl` and Referer to the source selected for the same anime episode. Reject a mismatched or unrelated referer.
5. Accept only a small, documented header allowlist (for example User-Agent, Referer, Accept and Accept-Language). Do not allow plugins to inject Cookie, Authorization, proxy, or arbitrary transport headers.
6. Enforce a maximum timeout (15 seconds by default) and an explicit request cancellation handle.

## Response contract

Return a structured result rather than a bare string:

```json
{
  "capability": "raw.anime.webview-stream",
  "version": 1,
  "status": "resolved",
  "anilistId": "16498",
  "episodeNumber": 12,
  "streams": [
    {
      "url": "http://127.0.0.1:42000/raw-anime/session-id?u=encoded-upstream-url",
      "protocol": "hls",
      "headers": {},
      "discoveredBy": "webview-request-interception"
    }
  ],
  "subtitles": []
}
```

Supported statuses:

| Status | Meaning | Provider behavior |
|---|---|---|
| `resolved` | A valid media request was observed and classified | Convert verified stream records into ordinary RAW candidates |
| `not_found` | No supported media request was observed before the deadline | Return no candidate |
| `needs_user_action` | The page requires a normal user interaction or verification | Surface the browser/session handoff; do not retry with evasion |
| `blocked` | The URL, host, redirect, or requested behavior violates host policy | Return no candidate and log a diagnostic |
| `timeout` | The deadline elapsed | Return no candidate |
| `cancelled` | The playback request was superseded or cancelled | Stop the WebView and discard all results |
| `error` | An unexpected WebView or parser error occurred | Return no candidate and retain a diagnostic |

Every returned stream must retain the active AniList ID and episode association in host-owned state. The host must validate the identity again immediately before MPV handoff.

## Android implementation requirements

### WebView lifecycle

- Create, configure, interact with, stop and destroy the WebView on the Android main thread.
- Use an isolated, short-lived WebView instance per resolution request. Do not reuse cookies or storage across unrelated providers or anime identities.
- Enable only the WebView features required by the provider's player (JavaScript and DOM storage where observed). Use the provider's observed User-Agent and preserve the source Referer.
- Set mixed-content behavior deliberately per host policy; do not globally permit insecure content without a specific requirement.
- Disable downloads, external intents, file access, content access, popups and unknown custom schemes unless a separately reviewed capability requires them.
- Cancel network loads and destroy the WebView on timeout, playback change, screen exit or coroutine cancellation. A late callback must never publish a stale candidate.

### Media request interception

Use a request matcher equivalent to the original UniversalExtractor patterns:

- HLS: `.m3u8`
- DASH: `.mpd`
- Progressive media: `.mp4`, `videoplayback`, `googlevideo`, `googleusercontent`, `action=stream`
- Segment indicators such as `.ts`, `.m4s`, `/hls/` and `/stream/` are useful evidence, but a segment alone is not a master stream candidate.

Capture the request URL and the request's relevant headers from `shouldInterceptRequest`. Prefer a master manifest over a media segment if both are observed. Do not report analytics, poster, thumbnail, ad, JavaScript, CSS or image URLs as streams.

### Playback activation

The upstream Kotlin implementation attempts normal player activation after page load. RAW should keep this narrowly scoped:

1. Wait for page completion.
2. Attempt known player APIs such as `jwplayer().play()` and `video.play()`.
3. When needed, interact only with known player play controls inside the player container.
4. Do not click arbitrary page buttons, purchase/subscribe controls, login buttons, consent prompts, or verification widgets automatically.
5. If a user gesture or challenge is required, return `needs_user_action` and allow a normal user-mediated browser interaction.

The bridge must not evaluate plugin-supplied JavaScript. The playback activation shim is fixed host code, reviewed and versioned with the app.

### Parsing and candidate creation

After intercepting a URL:

- HLS: parse the master manifest natively, preserve audio-group mappings and subtitle renditions, and emit only observed qualities/tracks.
. DASH template routes are pinned to the original upstream host. Multi-`BaseURL` alternatives and `ContentProtection` MPDs fail closed rather than choosing a CDN or attempting DRM playback.
- MP4/progressive: preserve the observed request headers and referer.
- TeraBox-style `M3U8_AUTO_360`: the legacy Kotlin code tries 1080/720/480/360 path variants. The host may probe those known variants, but it must emit only playlists that actually resolve and contain the expected manifest structure.
- Apply the same candidate identity, HTTPS, host-policy and media-binding checks as every other anime provider.

The native resolver returns raw observed media records; the existing RAW playback pipeline remains responsible for final source ranking, manifest inspection, audio/subtitle selection, MPV handoff and failover.

## Security and privacy boundary

- Do not bypass CAPTCHA, Turnstile, bot checks, account authentication, DRM, signed-in content restrictions or paywalls.
- Do not synthesize cookies, challenge tokens, browser fingerprints or service credentials.
- Do not expose WebView cookies, local storage, JavaScript bridges or Android application secrets to QuickJS.
- Block redirects to non-HTTPS destinations and hosts outside the configured policy. Apply private-network/IP-literal restrictions to prevent embed pages from reaching local services.
- Do not persist WebView history, cache, cookies or browsing state after extraction unless a separate, user-visible session feature is explicitly designed.
- Keep provider name, embed URL, final media URL and rejection reason in internal diagnostics only; do not expose server/provider selection to the user.
- Keep each captured cookie in native memory keyed by its exact upstream host; never return cookies to QuickJS or forward a cookie to a different host.

## Provider integration pattern

Once the host exposes the ABI, a provider can use a thin adapter:

```js
async function resolveUniversalEmbed(embedUrl, context) {
  const host = globalThis.RAW_HOST;
  if (!host || typeof host.resolveAnimeEmbed !== "function") return [];

  const result = await host.resolveAnimeEmbed({
    capability: "raw.anime.webview-stream",
    version: 1,
    provider: "animostream",
    anilistId: String(context.anilistId),
    episodeNumber: Number(context.episodeNumber),
    embedUrl,
    pageUrl: context.pageUrl,
    headers: context.headers || {},
    timeoutMs: 15000
  });

  if (!result || result.status !== "resolved") return [];
  if (String(result.anilistId) !== String(context.anilistId)) return [];
  if (Number(result.episodeNumber) !== Number(context.episodeNumber)) return [];

  return (result.streams || []).map((stream) => ({
    url: stream.url,
    headers: stream.headers || {},
    provider: "animostream",
    anilistId: String(context.anilistId),
    episodeNumber: Number(context.episodeNumber),
    type: stream.protocol === "hls" ? "m3u8" :
      stream.protocol === "dash" ? "mpd" : "mp4"
  }));
}
```

The host must still validate every returned URL and identity. The plugin-side checks are defensive, not authoritative.

## Acceptance tests

Before marking this capability implemented, test at least:

1. A fixture page that requests HLS and yields an HLS master candidate.
2. A page that requests DASH and yields a DASH candidate.
3. A progressive MP4 request with the correct Referer/User-Agent preserved.
4. A page that emits only `.ts`/`.m4s` segments and no master manifest; no segment may be mislabeled as a complete stream.
5. A delayed player activation that resolves only after the player starts.
6. A page with multiple candidate requests; deterministic ranking must prefer a valid master manifest over unrelated media.
7. An HTTPS-to-HTTP redirect; it must be rejected.
8. A challenge/login-required page; it must return `needs_user_action` or fail closed, with no evasion attempt.
9. Timeout, user cancellation and playback supersession; no late result may be emitted.
10. Wrong AniList ID or episode association; the host must discard the result.
11. Audio groups and subtitles in HLS, plus DASH audio/subtitle representations.
12. Real-device MPV startup, seeking, subtitle selection and sustained playback.

The RAW Android project now contains this native bridge and a loopback relay for observed HLS, non-DRM DASH and progressive media. Animostream, AnimeSalt, AniChan, Anikage and Miruro have QuickJS adapters for the shared resolver contract. Repository contract tests cover the adapter ABI and identity binding; Android unit tests cover the native media transforms and DASH rewriting. A successful device build, live embed extraction and MPV playback test are still required before these providers can be marked verified or their Kotlin originals removed.
