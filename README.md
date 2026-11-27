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

NetMirror (Net77) remains in the movie/TV catalogue but is disabled until RAW can hand off a legitimate, user-completed verification session. Its synthetic reCAPTCHA response path is not used.


## Anime port parity and Kotlin-source removal gate

The JS anime providers are still being brought to behavior parity with their original Kotlin implementations. See [`docs/ANIME_PROVIDER_PARITY_AUDIT.md`](docs/ANIME_PROVIDER_PARITY_AUDIT.md) for the provider-by-provider gaps and the conditions required before any Kotlin source is removed. The Kotlin sources remain reference material until those gates pass.

## Current anime conversion scope

The anime catalogue contains 27 provider entries, and all 27 are enabled in the manifest as requested. Twenty currently have non-placeholder QuickJS stream implementations at different parity stages; seven entries are catalogue-enabled but their JavaScript entrypoints still fail closed until the missing implementation or required RAW-native host capability is completed. Catalogue enablement does not imply playback readiness.

| Provider | Implemented in QuickJS | Known host/runtime boundary |
|---|---|---|
| AllAnime | AniList GraphQL resolution, all Kotlin XOR source modes, AES-GCM episode decoding, and `/apivtwo/clock.json` MP4, HLS, adaptive iframe HLS/DASH and DASH audio/video rendition parsing; mapped GogoStream, Dood, OK.ru, Mp4Upload, Streamlare and StreamWish extraction | Requires QuickJS WebCrypto. Filemoon is intentionally unsupported because the available route requires an automated challenge/PoW flow; native browser-only routes remain outside the plugin runtime |
| Anikage | AniList title mapping, browse/detail/episode/server/source requests, Koto/Rai routes, proxy token resolution, HLS variants and subtitles | Hosts requiring the original Android loopback HLS relay are omitted |
| Anikoto | Kotlin-compatible VRF episode-list signing, mirror/title matching, server and mapper fallback, MegaPlay AES-CBC source decryption, 90-second HMAC-SHA256 CDN token generation, ASS-first subtitle selection and intro/outro metadata | Browser verification/challenge-dependent routes remain unsupported; real endpoint and device playback verification are still outstanding |
| AnimeSuge | Kotlin-compatible RC4 → Base64URL → cyclic byte-shift → Base64URL → ROT13 VRF, exact-title search, `data-ids` episode lookup, server API lookup and direct HLS/MegaPlay paths | Shared AnikotoTheme extractor coverage, native playlist/key proxy, full metadata behavior and Android/MPV playback remain incomplete |
| AnimeSogo | Kotlin `encodeAnimeSogoVrf` sequence, exact AniList title search, `data-ids` episode lookup, Sogo-specific server selectors, and visible direct HLS/MP4/MegaPlay sources | Native playlist/key proxy, full shared AnikotoTheme extractor coverage and Android/MPV playback remain incomplete |
| AniSnatch | Dynamic site-config SMC request encoder, shuffled/chunked API payloads, marker/XOR/gzip response decoding, AniList title mapping, exact episode/server lookup and visible direct HLS/MP4 sources | Kotlin playlist/segment/key rewriting, full hoster extractor parity, settings preferences and Android/MPV playback remain incomplete |
| AniLight | AniList-backed API lookup, episode matching, public MegaPlay embed, AES-CBC source parsing, HLS variants and subtitles | Non-MegaPlay routes relying on WebView/Turnstile require a host-provided browser capability; QuickJS does not emulate that browser |
| Miruro | AniList episode matching, secure-pipe envelope and XOR/gzip response decoding, provider/subtype fallback, rotating proxy configuration, direct HLS relay URLs and source subtitle tracks | Uses ordinary HTTP requests and fails closed on WAF/Cloudflare denial. Android-only embed extractors and local HLS relay are not emulated |
| AniChan | AniList ID → episodes/servers API, direct HLS/MP4 and subtitle tracks | Non-direct embed resolvers are omitted |
| AniKura | Exact AniList title mapping → episode/stream API, HLS/MP4 and tracks | Kotlin trial gate is not copied into RAW |
| AniKuro | Exact AniList alias search → episode API → normalized provider sources | Only normalized direct media URLs are emitted |
| AnimeHeaven | Exact title search → episode gate key → direct MP4/HLS | Only media URLs directly visible after the public gate request are emitted |
| Ani.pm | AniList API → playback bootstrap → Settlar session → HLS + subtitles | Uses public session endpoints; no native local proxy is emulated |
| AnimeSaga | AniList GraphQL → encrypted episodes/stream JSON → direct HLS/MP4 plus shared Dood and VidHide hoster extraction | Android local proxy still requires a RAW-native bridge |
| Anitummy | AniList episode → Fast MegaPlay + VidNest + Kiwi/Net/Ally sub/dub APIs, plus shared Dood, VidHide, StreamWish and Vidara extraction where embed URLs match | Native M3U8 playlist/segment integration remains a host gap; Cloudflare/session-denied routes fail closed |
| AnimeSalt | AniList title mapping, WordPress episode/server parsing, MegaPlay AES-CBC, AS-CDN/FirePlayer POST-to-HLS, and shared Abyss, VidMoly, Dood and StreamTape extraction | Filemoon and UniversalExtractor routes remain unsupported; native playlist-proxy capabilities remain RAW host work |
| FourAnimo | AniList title mapping → page token/AJAX episode list → M/R/ReCloud source endpoint | Only observed direct HLS playlists are returned |
| AniMoTVSlash | Exact title lookup → episode/mirror parsing → shared StreamWish, VidHide, Vidara and Abyss extraction plus direct media | Filemoon challenge path is intentionally unsupported; native HLS validation remains |
| AniNeko | Exact title lookup → episode/server buttons → shared Dood and VidHide extraction plus direct HLS/MP4 | Native loopback proxy and playlist/segment rewriting remain RAW host work |
| AnimeStream | Exact title mapping → paginated season/episode API → locale, alternate-audio and hard-sub HLS playlists | Streams requiring the native encrypted-key proxy are omitted |
| Animostream | AniList title matching, Blogger animeData season/server parsing, direct HLS/MP4, and shared Abyss, Dood, StreamTape, VidMoly, EmbedSeek and StreamWish extraction | UniversalExtractor and native playlist-proxy branches remain RAW host work; Filemoon challenge/PoW flow is intentionally unsupported |

The original Kotlin source files under `anime/providers/` remain unchanged. The JavaScript files are separate runtime ports, not a claim that every Android-only capability can be reproduced inside QuickJS.

## Shared anime extractor coverage

The reusable QuickJS layer lives in providers/anime/shared/extractors.js. It now includes StreamWish, EmbedSeek, GogoStream, OK.ru, Mp4Upload, Streamlare, Abyss, Dood, StreamTape, VidMoly, VidHide and Vidara. The generated standalone bundles and sync checks cover AllAnime, AniMoStream, AnimeSalt, AniMoTVSlash, AniNeko, AnimeSaga and Anitummy.

| Provider | Extractors reused |
|---|---|
| AllAnime | GogoStream, Dood, OK.ru, Mp4Upload, Streamlare, StreamWish |
| AniMoStream | StreamWish, EmbedSeek, StreamTape, Dood, VidMoly, Abyss |
| AnimeSalt | VidMoly, Abyss, Dood, StreamTape |
| AniMoTVSlash | StreamWish, VidHide, Vidara, Abyss |
| AniNeko | VidHide, Dood |
| AnimeSaga | VidHide, Dood |
| Anitummy | VidHide, Dood, StreamWish, Vidara |

The Kotlin modules in extractors/ and libraries/ remain native source references; QuickJS cannot import them as Kotlin. In particular, libraries/m3u8server and UniversalExtractor are host capabilities, not ordinary JS extractors: playlist/segment/key rewriting needs a RAW-native media proxy, while UniversalExtractor needs the Android WebView bridge. The Synchrony library is JavaScript and is bundled for the providers that use it; the P.A.C.K.E.R. JavaScript helper is a targeted compatibility port, not proof that every Kotlin unpacker consumer is migrated.

New VidHide and Vidara JS ports have mocked request/response fixtures. These tests confirm extraction contracts, AniList candidate identity and HLS variant parsing, but not live endpoint availability or real Android/MPV playback. Retain Kotlin references until all provider parity, native bridge and device playback gates pass.

## Quality and subtitle truthfulness

The plugins parse observed HLS variant resolutions and provider subtitle tracks. Unknown resolution remains `Auto`; they do not manufacture quality tiers or subtitles. RAW must inspect the selected manifest and MPV tracks before exposing verified playback settings.

## Manifest

`manifest.json` is the repository catalogue consumed by RAW.

https://raw.githubusercontent.com/prasadshirke206-bit/RAW-Plugins/main/manifest.json

## Security and provenance

Treat provider code and returned URLs as untrusted. Enforce timeouts, cancellation, response-size limits, HTTPS host policy, request budgets and per-provider isolation. Never expose app secrets. Do not bypass CAPTCHA, authentication, DRM or other access controls.

Original Kotlin source is retained under its own upstream attribution and Apache-2.0 terms; see `THIRD_PARTY_NOTICES.md` and `licenses/`.


## Pending implementations (catalogue-enabled, resolver fail-closed)

The following six sources are enabled in the manifest catalogue but still have placeholder JavaScript entrypoints that return no streams. Their Kotlin originals are retained as references until a legitimate QuickJS or RAW-native implementation is complete:

- **AniLab** — requires Kyoto Player official-client request signing.
- **AnimePahe** — depends on Cloudflare/session handling and native HLS/Kwik extractors.


- **AniWave** — depends on a VRF/extractor chain and native HLS proxy.
- **AV1Encodes** — current flow includes verification/ad-check dependencies and native extractors.
- **ReAnime** — depends on the local FlixProxyServer.
- **Senshi** — depends on AES-GCM playlist handling and a native segment/key proxy.

These entries currently have enabled=true for catalogue visibility, but their `getStreams` functions fail closed. They must not be described as playable until provider-specific tests and device validation pass.