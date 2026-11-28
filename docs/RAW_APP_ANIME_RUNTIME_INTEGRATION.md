# RAW App: Anime QuickJS Runtime Integration

## Why a host update is required

The repository now defines two call contracts. Existing movie and TV plugins must continue to receive the TMDB contract without changes. Anime providers must receive the AniList contract. Do not route anime through the old movie/TV argument path and merely change the media type string.

## Invocation

Movie/TV (unchanged):

```kotlin
provider.call(
    tmdbId = request.tmdbId,
    mediaType = request.mediaType,
    season = request.season,
    episode = request.episode
)
```

Anime:

```kotlin
provider.call(
    anilistId = request.anilistId,
    mediaType = "anime",
    season = request.season,
    episode = request.episode
)
```

Populate `globalThis.__CALL_ARGS__` with the same anime identity and context. Recommended fields:

```json
{
  "anilistId": "16498",
  "title": "Attack on Titan",
  "titles": ["Attack on Titan", "Shingeki no Kyojin"],
  "year": 2013,
  "format": "TV",
  "totalEpisodes": 25,
  "episodeNumber": 1,
  "preferredAudio": "sub",
  "providerMappings": {
    "allanime": { "id": "provider-specific-id" },
    "anikage": { "slug": "provider-specific-slug" },
    "anikoto": { "url": "https://provider.example/watch/provider-slug" },
    "anilight": { "slug": "provider-specific-slug" },
    "miruro": { "mirror": "https://www.miruro.tv" },
    "anikura": { "url": "provider-specific-watch-url" },
    "anikuro": { "id": "provider-specific-id" },
    "animeheaven": { "url": "provider-specific-anime-url" },
    "animesalt": { "url": "provider-specific-anime-url" },
    "fouranimo": { "url": "provider-specific-anime-url" },
    "anineko": { "url": "provider-specific-anime-url" },
    "animotvslash": { "url": "provider-specific-anime-url" },
    "animostream": { "url": "provider-specific-post-url" },
    "animestream": { "contentId": "provider-specific-content-id" }
  }
}
```

Only include provider mappings that the app has obtained and validated for the selected AniList media item. Do not synthesize them from the current title string.

## Candidate validation

The schema permits the optional fields `anilistId` and `episodeNumber`. For anime, make both mandatory in the host validation path and enforce:

1. Candidate `anilistId` equals the active AniList ID.
2. Candidate `episodeNumber` equals the active episode number.
3. The URL is HTTPS and passes the provider host policy.
4. Required request headers are passed to MPV.
5. HLS/DASH manifests and actual MPV tracks are inspected before presenting quality, audio or subtitle choices.

A candidate with a mismatched identity must be discarded, not re-matched by title after resolution.

## Provider catalogue and UI

The provider catalogue must recognize `supportedTypes: ["anime"]` and register those plugins with the anime stream resolver. The existing per-provider enable/disable controls should apply to these entries. Do not expose a provider as selectable if the script cannot be loaded by the running QuickJS host.

## QuickJS capabilities

The scripts use the existing fetch bridge. They additionally use WebCrypto and standard byte/text codecs for some provider encryption routines:

- AllAnime: SHA-256 key derivation and AES-GCM decrypt.
- Anikoto: AES-CBC decrypt for the public MegaPlay source payload; VRF transformation for site search.
- AniLight: AES-CBC decrypt for the public MegaPlay source payload.

The runtime should feature-detect `crypto.subtle`, `TextEncoder`, `TextDecoder`, `atob` and `btoa`. Missing capabilities should produce a provider diagnostic. Do not pass native application secrets to JavaScript.

## Native-only upstream behaviour

Some original Kotlin source logic relies on Android facilities which do not exist in a QuickJS plugin:

- Anikage's loopback HLS relay for a small set of special CDN hosts.
- Anikoto's short-lived CDN HMAC token construction and certain embed-specific native handling.
- AniLight's WebView player resolver for routes behind the site's Turnstile/browser session.

The JS ports do not bypass CAPTCHA/Turnstile or manufacture CDN session tokens. The corresponding routes return no candidate unless a legitimate host capability is added. This is intentional: do not expose unresolved embed pages as playable URLs.

## Testing still required in the app

Repository tests can verify manifest, syntax and invocation contracts. They cannot prove MPV playback. Device verification must include exact anime/episode identity, headers, HLS startup, subtitles, sustained playback, cancellation and fallback behaviour for each provider.


## Miruro-specific runtime boundary

Miruro's JS port follows the original pipe contract for exact AniList episode matching, source/subtype lookup, XOR+gzip response decoding, dynamic stream-proxy configuration and subtitle parsing. It returns only observed direct HLS source records, routed through the configured Miruro stream relay.

The port deliberately does not reproduce the Kotlin extension's browser-fingerprint spoofing, cookie warm-up sequence, or Cloudflare/WAF workarounds. A 403/challenge response is a hard failure: RAW should offer a normal browser/session verification handoff rather than changing request fingerprints or trying to evade the challenge. The original Android Universal/MegaCloud/RapidCloud embed extractors and local M3U8 relay also remain native-only; embed pages are not treated as playable streams.

## Newly ported direct-flow providers

Thirteen additional provider entrypoints now use the AniList invocation contract: AniChan, AniKura, AniKuro, AnimeHeaven, Ani.pm, AnimeSaga, Anitummy, AnimeSalt, FourAnimo/Zanix, AniMoTVSlash, AniNeko, AnimeStream and Animostream. They use exact AniList ID plus episode binding and emit only observed direct HLS/MP4 media records. Anitummy now also attempts its public Kiwi/Net/Ally sub/dub JSON routes and visible VidNest media; extractor-only protected embeds remain unavailable. Their website title matching is allowed only when it produces a unique exact alias match; use validated `providerMappings` where the app already has a real provider ID or canonical page URL.

## Disabled providers and native integration blockers

Nine entries are present but disabled. RAW must respect their manifest flag and must not invoke or display them as active providers:

- **AniLab:** requires official Kyoto Player request signing; the JS provider does not impersonate the official app.
- **AnimePahe:** current Kotlin path includes Cloudflare/session handling and native HLS/Kwik extraction.
- **AnimeSogo / AnimeSuge:** their source classes inherit shared `AnikotoTheme` logic absent from the uploaded source snapshot.
- **AniSnatch:** its site-config-derived request and response cipher plus gzip framing still needs an exact tested QuickJS port.
- **AniWave:** depends on a VRF/extractor chain and native HLS proxy.
- **AV1Encodes:** depends on site verification/ad-check and native extractors.
- **ReAnime:** requires the Kotlin FlixProxyServer to rewrite stream and key URLs.
- **Senshi:** requires AES-GCM media parsing plus a native segment/key proxy.

A disabled provider must remain unavailable until its required capability is implemented and tested. Browser challenges must be completed by the user through a normal browser handoff; do not spoof fingerprints, synthesize challenge tokens, or evade CAPTCHA/verification.

## Native WebView stream resolver

The RAW Android project now exposes `RAW_HOST.resolveAnimeEmbed` for the UniversalExtractor paths in Animostream, AnimeSalt, AniChan, Anikage and Miruro. The host performs WebView resolution, keeps cookie state native-only and returns RAW-owned loopback media URLs bound to the active AniList ID and episode. The relay rewrites HLS and supported non-DRM DASH manifests and serves progressive media; see [RAW_APP_ANIME_WEBVIEW_BRIDGE_SPEC.md](RAW_APP_ANIME_WEBVIEW_BRIDGE_SPEC.md) for the contract and limitations.

The native source implementation and QuickJS adapters are present, but live provider extraction and MPV device playback remain acceptance gates. Never return an unresolved embed page as media or evaluate plugin-supplied JavaScript inside the WebView.
