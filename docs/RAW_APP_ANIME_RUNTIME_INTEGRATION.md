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
    "anilight": { "slug": "provider-specific-slug" }
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
