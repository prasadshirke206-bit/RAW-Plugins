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


## Anime port parity and Kotlin-source removal gate

The JS anime providers are still being brought to behavior parity with their original Kotlin implementations. See [`docs/ANIME_PROVIDER_PARITY_AUDIT.md`](docs/ANIME_PROVIDER_PARITY_AUDIT.md) for the provider-by-provider gaps and the conditions required before any Kotlin source is removed. The Kotlin sources remain reference material until those gates pass.

## Current anime conversion scope

The anime catalogue contains 27 provider entries. Eighteen are enabled JavaScript ports; nine remain explicitly disabled until their native-only or security-sensitive dependencies have a supported RAW host integration.

| Provider | Implemented in QuickJS | Known host/runtime boundary |
|---|---|---|
| AllAnime | AniList lookup, GraphQL search/episode request, XOR source URL decoding, AES-GCM payload handling, internal clock endpoint, public HLS/MP4 links | AES-GCM requires QuickJS WebCrypto. External hosters requiring native extractor modules are only returned when the page exposes a direct media URL |
| Anikage | AniList title mapping, browse/detail/episode/server/source requests, Koto/Rai routes, proxy token resolution, HLS variants and subtitles | Hosts requiring the original Android loopback HLS relay are omitted |
| Anikoto | VRF search transform, AJAX episode/server flow, mapper results, MegaPlay AES-CBC source parsing, HLS variants and subtitles | Does not forge expiring CDN HMAC tokens or solve browser challenges; those streams need a host/native resolver |
| AniLight | AniList-backed API lookup, episode matching, public MegaPlay embed, AES-CBC source parsing, HLS variants and subtitles | Non-MegaPlay routes relying on WebView/Turnstile require a host-provided browser capability; QuickJS does not emulate that browser |
| Miruro | AniList episode matching, secure-pipe envelope and XOR/gzip response decoding, provider/subtype fallback, rotating proxy configuration, direct HLS relay URLs and source subtitle tracks | Uses ordinary HTTP requests and fails closed on WAF/Cloudflare denial. Android-only embed extractors and local HLS relay are not emulated |
| AniChan | AniList ID → episodes/servers API, direct HLS/MP4 and subtitle tracks | Non-direct embed resolvers are omitted |
| AniKura | Exact AniList title mapping → episode/stream API, HLS/MP4 and tracks | Kotlin trial gate is not copied into RAW |
| AniKuro | Exact AniList alias search → episode API → normalized provider sources | Only normalized direct media URLs are emitted |
| AnimeHeaven | Exact title search → episode gate key → direct MP4/HLS | Only media URLs directly visible after the public gate request are emitted |
| Ani.pm | AniList API → playback bootstrap → Settlar session → HLS + subtitles | Uses public session endpoints; no native local proxy is emulated |
| AnimeSaga | AniList GraphQL → encrypted episodes/stream JSON → direct HLS/MP4 | Android local proxy and hoster-specific extractors are omitted |
| Anitummy | AniList episode → Fast MegaPlay + VidNest direct-media discovery + Kiwi/Net/Ally sub/dub stream APIs → direct HLS/MP4 + captions | Dood/VidHide hoster extraction and native HLS integration remain incomplete; Cloudflare/session-denied routes fail closed |
| AnimeSalt | Exact AniList title → WordPress episode/server data → MegaPlay + AS-CDN/FirePlayer POST → HLS variants (mocked contract tests included) | Abyss, Dood, Filemoon, StreamTape, VidMoly and Universal extractor paths remain incomplete |
| FourAnimo | AniList title mapping → page token/AJAX episode list → M/R/ReCloud source endpoint | Only observed direct HLS playlists are returned |
| AniMoTVSlash | Exact title lookup → episode/mirror parsing → directly visible HLS | Specialized StreamWish/VidHide/Vidara extractors are not emulated |
| AniNeko | Exact title lookup → episode/server buttons → directly visible HLS/MP4 | Native loopback proxy and specialized hoster extractors are not emulated |
| AnimeStream | Exact title mapping → paginated season/episode API → locale, alternate-audio and hard-sub HLS playlists | Streams requiring the native encrypted-key proxy are omitted |
| Animostream | Exact title lookup → Blogger animeData season/server arrays → direct HLS/MP4 | Specialized hoster extractors are not emulated |

The original Kotlin source files under `anime/providers/` remain unchanged. The JavaScript files are separate runtime ports, not a claim that every Android-only capability can be reproduced inside QuickJS.

## Quality and subtitle truthfulness

The plugins parse observed HLS variant resolutions and provider subtitle tracks. Unknown resolution remains `Auto`; they do not manufacture quality tiers or subtitles. RAW must inspect the selected manifest and MPV tracks before exposing verified playback settings.

## Manifest

`manifest.json` is the repository catalogue consumed by RAW.

https://raw.githubusercontent.com/prasadshirke206-bit/RAW-Plugins/main/manifest.json

## Security and provenance

Treat provider code and returned URLs as untrusted. Enforce timeouts, cancellation, response-size limits, HTTPS host policy, request budgets and per-provider isolation. Never expose app secrets. Do not bypass CAPTCHA, authentication, DRM or other access controls.

Original Kotlin source is retained under its own upstream attribution and Apache-2.0 terms; see `THIRD_PARTY_NOTICES.md` and `licenses/`.


## Pending host integrations (disabled in the manifest)

The following nine sources are preserved in the Kotlin source tree but are not presented as enabled QuickJS providers:

- **AniLab** — requires Kyoto Player official-client request signing.
- **AnimePahe** — depends on Cloudflare/session handling and native HLS/Kwik extractors.
- **AnimeSogo** and **AnimeSuge** — depend on shared AnikotoTheme source not included in the uploaded source snapshot.
- **AniSnatch** — dynamic site-config request/response cipher and gzip binary framing are not yet ported and tested.
- **AniWave** — depends on a VRF/extractor chain and native HLS proxy.
- **AV1Encodes** — current flow includes verification/ad-check dependencies and native extractors.
- **ReAnime** — depends on the local FlixProxyServer.
- **Senshi** — depends on AES-GCM playlist handling and a native segment/key proxy.

These entries have enabled=false and fail closed. They are not fake or incomplete stream resolvers masquerading as working providers.