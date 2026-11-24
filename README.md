# RAW Plugins

Official repository of independently versioned JavaScript provider plugins for the RAW Android app.

## Repository layout

```text
RAW-Plugins/
├── providers/
│   ├── movie-tv/       # Existing QuickJS movie and TV providers
│   └── anime/          # QuickJS anime providers
│       ├── allanime.js
│       ├── anikage.js
│       ├── anikoto.js
│       └── anilight.js
├── anime/
│   └── providers/      # Original Kotlin source references; not edited by JS ports
├── extractors/         # Original reusable native Kotlin extractor sources
├── libraries/          # Original shared native Kotlin helpers
├── schemas/
├── docs/
└── tests/
```

## Runtime contracts

The existing movie/TV contract remains unchanged:

- Entrypoint: `getStreams(tmdbId, mediaType, season, episode)`
- Identity: TMDB
- Context: `globalThis.__CALL_ARGS__`

Anime has a separate contract:

- Entrypoint: `getStreams(anilistId, "anime", season, episode)`
- Identity: AniList
- Context: `globalThis.__CALL_ARGS__`
- Every emitted anime candidate carries `anilistId` and `episodeNumber`.

The same QuickJS engine and fetch bridge are used. The host must route anime through the anime argument contract and must validate candidate identity against the exact selected AniList title and episode. Do not pass a TMDB ID to an anime provider.

## Current anime conversion scope

The four JavaScript entrypoints are behavioural ports of the original provider sources:

| Provider | Implemented in QuickJS | Known host/runtime boundary |
|---|---|---|
| AllAnime | AniList lookup, GraphQL search/episode request, XOR source URL decoding, AES-GCM payload handling, internal clock endpoint, public HLS/MP4 links | AES-GCM requires QuickJS WebCrypto. External hosters requiring native extractor modules are only returned when the page exposes a direct media URL |
| Anikage | AniList title mapping, browse/detail/episode/server/source requests, Koto/Rai routes, proxy token resolution, HLS variants and subtitles | Hosts requiring the original Android loopback HLS relay are omitted |
| Anikoto | VRF search transform, AJAX episode/server flow, mapper results, MegaPlay AES-CBC source parsing, HLS variants and subtitles | Does not forge expiring CDN HMAC tokens or solve browser challenges; those streams need a host/native resolver |
| AniLight | AniList-backed API lookup, episode matching, public MegaPlay embed, AES-CBC source parsing, HLS variants and subtitles | Non-MegaPlay routes relying on WebView/Turnstile require a host-provided browser capability; QuickJS does not emulate that browser |

The original Kotlin source files under `anime/providers/` remain unchanged. The JavaScript files are separate runtime ports, not a claim that every Android-only capability can be reproduced inside QuickJS.

## Quality and subtitle truthfulness

The plugins parse observed HLS variant resolutions and provider subtitle tracks. Unknown resolution remains `Auto`; they do not manufacture quality tiers or subtitles. RAW must inspect the selected manifest and MPV tracks before exposing verified playback settings.

## Manifest

`manifest.json` is the repository catalogue consumed by RAW.

https://raw.githubusercontent.com/prasadshirke206-bit/RAW-Plugins/main/manifest.json

## Security and provenance

Treat provider code and returned URLs as untrusted. Enforce timeouts, cancellation, response-size limits, HTTPS host policy, request budgets and per-provider isolation. Never expose app secrets. Do not bypass CAPTCHA, authentication, DRM or other access controls.

Original Kotlin source is retained under its own upstream attribution and Apache-2.0 terms; see `THIRD_PARTY_NOTICES.md` and `licenses/`.
