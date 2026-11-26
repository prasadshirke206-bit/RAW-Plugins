# Anime provider Kotlin → QuickJS parity audit

**Audit baseline:** `main` at `7d3e77d0ac2edb64cab9425742e21b4ef13f751d`  
**Scope:** stream-resolution behavior only. RAW owns AniList metadata and invokes `getStreams(anilistId, "anime", season, episode)`; provider browsing, detail pages, extension settings screens, and extension-specific catalogue UI are not required to be reproduced in a stream plugin.

## Migration gate

**Do not delete Kotlin anime sources yet.** Static source comparison shows that the current JavaScript ports are not all behavior-equivalent. The Kotlin tree is still the only reference for several hoster extractors and local proxy implementations.

A provider is eligible for Kotlin-source removal only when all of the following are true:

1. Every stream-resolution branch in the Kotlin source is either ported to JavaScript or deliberately replaced by a documented RAW-native host capability.
2. Request parameters, episode mapping, audio variants, subtitles, headers, cookies, quality parsing, fallback order, and error handling have regression fixtures.
3. No unresolved embed page is emitted as a playable URL.
4. The RAW host validates every candidate against the exact AniList ID and episode.
5. Device testing confirms HLS startup, sustained playback, subtitles, headers, seeking, and fallback on real media.
6. Any Android-only relay/browser capability required by the provider has a tested implementation in RAW itself.

No provider is marked fully verified by this audit. This is a static comparison; it is not a claim of live endpoint or MPV playback validation.

**Follow-up update (November 25, 2026):** PR #9 adds the shared Kotlin-compatible Abyss AES-CTR extractor to AnimeSalt and AniMoStream, including HLS/MP4/Sora, subtitle and legacy fallback handling. Its mocked QuickJS contract tests pass; both providers remain `PORTED_WITH_GAPS` until real-device playback is checked.

## Enabled providers

| Provider | Status | Kotlin behavior not fully represented by JS |
|---|---|---|
| AllAnime | PORTED_WITH_GAPS | Kotlin supports internal clock endpoints and dedicated GogoStream, Dood, OK.ru, Mp4Upload, Streamlare, Filemoon, and StreamWish extractors. JS handles GraphQL, encrypted episode payloads, XOR source decoding, and direct/internal flows, but does not reproduce the full hoster extractor set. |
| Anikage | PORTED_WITH_GAPS | JS now discovers Kotlin's live `PUBLIC_PROXY_URL`, preserves caption filtering and `.vtt` proxy URLs, applies `embedOptions` label precedence, and resolves the supported MegaPlay/VibePlayer direct-HLS branches. Kotlin's loopback relay for `vivibebe.site`, `echovideo.to`, and `krussdomi.com`, plus UniversalExtractor routes, still require RAW-native HLS/WebView host capabilities. Added mocked fixtures; real-device playback remains unverified. |
| Anikoto | PORTED_WITH_GAPS | JS ports title search/VRF, episode/server AJAX, mapper fallback, MegaPlay AES-CBC parsing, and HLS/subtitles. The native shared AnikotoTheme flow includes additional embed-specific handling and short-lived CDN HMAC token construction not reproduced by JS. The checked-in Kotlin class is only a thin subclass of the shared source. |
| AniLight | PORTED_WITH_GAPS | JS supports the public API and MegaPlay AES-CBC/HLS/subtitle route. Kotlin also has a WebView resolver for streams behind a browser/Turnstile session and an HLS relay for special CDN/audio renditions. |
| Miruro | PORTED_WITH_GAPS | JS ports the secure-pipe request/response decoding, provider/subtype mapping, proxy URL generation, and direct HLS/subtitle records. Kotlin additionally warms the base/watch-page session, manages cookies/config/mirrors, handles browser/WAF behavior, and uses native embed extractors and local HLS integration. |
| AniChan | PORTED_WITH_GAPS | JS ports the AniList-ID → episode/server API flow and direct HLS/MP4/subtitle handling. Kotlin also resolves supported embed URLs through UniversalExtractor and uses PlaylistUtils/M3U8 integration; the embed path requires the proposed Android WebView bridge. |
| AniKura | PORTED_WITH_GAPS | JS ports title mapping, episode lookup, stream API calls, and track parsing. Kotlin uses PlaylistUtils/M3U8 integration and has provider-side server/expiry preferences; the RAW port intentionally omits the extension's five-day demo gate, but playlist fallback behavior still needs parity fixtures. |
| AniKuro | PORTED_WITH_GAPS | Both use the same 12 normalized source endpoints. The Kotlin extension exposes all hosters and applies preferred/excluded server and audio-type settings; JS currently probes sequentially and stops after the first provider produces candidates. This is an intentional automation adaptation only if RAW's resolver contract confirms it. |
| AnimeHeaven | CLOSE_PENDING_DEVICE_TEST | The JS port reproduces the gate-key cookie request and the three direct-media discovery fallbacks (video source, download link, token reconstruction), while excluding the decoy host. It still needs comparison fixtures for cookie isolation, URL ordering, and request headers, plus device validation. |
| Ani.pm | PORTED_WITH_GAPS | JS reproduces playback bootstrap → Settlar session → embed session, key-proof header, subtitle extraction, and HLS parsing. Kotlin additionally sends videos and subtitle tracks through its local proxy; encrypted-key/playlist behavior must be proven equivalent or implemented natively. |
| AnimeSaga | PORTED_WITH_GAPS | JS preserves AniList mapping and encrypted response parsing, but Kotlin has Dood/VidHide extraction, multiple provider-specific embed branches, and a loopback proxy that rewrites playlist/segment URLs. Direct-only JS candidates do not replace those paths. |
| Anitummy (Anitusk) | PORTED_WITH_GAPS | JS now attempts Fast/MegaPlay, VidNest direct-media discovery, and both sub/dub on Kiwi (AnimePahe), Net (AnimeDao), and Ally (AllManga) API routes. Direct HLS/MP4 and visible captions are emitted. Protected Dood/VidHide/vidnest extractor branches and native HLS integration are still not equivalent; Cloudflare/session-denied routes fail closed. |
| AnimeSalt | PORTED_WITH_GAPS | JS handles episode/server-page parsing, public MegaPlay decryption, the Kotlin AS-CDN/FirePlayer POST → HLS flow, and the shared Abyss AES-CTR extractor (HLS/MP4/Sora and subtitles). Dood, Filemoon, StreamTape and Universal hoster paths plus local playlist rewriting remain incomplete; Universal needs the proposed Android WebView bridge. |
| FourAnimo / Zanix | PORTED_WITH_GAPS | JS handles page token, AJAX episode lookup, and the public M/R/ReCloud embed flow. Kotlin additionally rewrites playlists and segments through FourAnimoHlsServer, including special segment handling and referer forwarding. |
| AniMoTVSlash | PORTED_WITH_GAPS | JS parses the WordPress episode/iframe flow and extracts direct HLS. Kotlin also has Filemoon, StreamWish, VidHide, and Vidara extractors, as well as additional iframe routes. |
| AniNeko | PORTED_WITH_GAPS | JS parses server-video buttons and returns directly visible media. Kotlin also supports Dood/VidHide extraction and a loopback proxy for playlists and segments. |
| AnimeStream | PORTED_WITH_GAPS | JS follows Kotlin's season pagination, retains main/alternate-audio/hard-sub playlist routes, preserves audio-group masters, and inspects nested HLS playlists. It fails closed when a playlist requires an external encrypted-key URI. Kotlin's local proxy rewrites playlist/segment/key URLs and decrypts keys with a media-ID-derived AES key; that native capability remains unported. |
| Animostream | PORTED_WITH_GAPS | JS parses Blogger animeData/server arrays and routes supported hosters through shared extractors. UniversalExtractor remains a native WebView bridge gap; EmbedSeek, StreamWish and Filemoon parity is tracked in their separate follow-on ports until those changes are merged and device-verified. |

## Disabled providers

These nine entries must remain disabled and their Kotlin source must remain available until the missing flow has a legitimate, tested QuickJS or RAW-native implementation.

| Provider | Status | Blocking Kotlin behavior |
|---|---|---|
| AniLab | BLOCKED | Kyoto Player official-client request signing. Do not synthesize or impersonate the official signature. |
| AnimePahe | BLOCKED | Cloudflare/session flow, native HLS server, Kwik extractor, and supporting session logic. |
| AnimeSogo | BLOCKED | Inherits shared AnikotoTheme logic; the exact shared source is not present in this source snapshot. |
| AnimeSuge | BLOCKED | Inherits shared AnikotoTheme and episode metadata logic; the exact shared source is not present in this source snapshot. |
| AniSnatch | BLOCKED | Dynamic site-config-derived request/response cipher and gzip framing are not yet ported with fixtures. |
| AniWave | BLOCKED | VRF/extractor chain and native HLS proxy. |
| AV1Encodes | BLOCKED | Site verification/ad-check flow and native extractor dependencies. |
| ReAnime | BLOCKED | Native FlixProxyServer rewrites stream and key URLs. |
| Senshi | BLOCKED | AES-GCM playlist handling and native segment/key proxy. |

## Kotlin source inventory

The repository contains **27 original anime provider classes** and **76 Kotlin files** across the two anime source trees (`anime/providers/` and `src/eu/kanade/tachiyomi/animeextension/`). These include DTOs, filters, extractor classes, browser resolvers, and loopback proxy helpers—not just the top-level provider classes.

Do not mass-delete every `.kt` file in the repository. The root also contains shared extractor/library Kotlin sources used by the original extension sources. Remove anime Kotlin source only after its corresponding parity gate passes, and do not delete unrelated movie/TV or shared source code as part of an anime-only migration.

## Required next implementation work

1. Port the missing direct-host extractor branches where they can be implemented and tested safely in QuickJS.
2. Add fixtures for every Kotlin API response shape and every supported stream type/audio/subtitle path.
3. Specify RAW-native interfaces for loopback HLS/key proxy and browser/session handoff. These cannot be implemented by an ordinary QuickJS provider script alone.
4. Add device-level playback results per provider and episode before moving a provider to `VERIFIED`.
5. Delete only the Kotlin files whose code has been replaced and whose dependencies are no longer referenced.

## Safety and resolver constraints

- Never return an embed page as an HLS/MP4 candidate.
- Do not bypass CAPTCHA, Turnstile, account authentication, DRM, or other access controls. A browser challenge requires a normal user-mediated browser/session handoff.
- Never invent quality, audio, or subtitle options. Emit only values observed from the provider response or media manifest.
- Preserve exact `anilistId` and `episodeNumber` on every emitted candidate, and validate both in the RAW host.
- Keep provider/source identity internal; RAW's resolver remains automatic and provider-transparent.


## Native WebView integration proposal

The Android-host ABI and acceptance criteria for UniversalExtractor are now documented in [RAW_APP_ANIME_WEBVIEW_BRIDGE_SPEC.md](RAW_APP_ANIME_WEBVIEW_BRIDGE_SPEC.md). It is explicitly a proposal until the RAW Android application implements and device-tests the bridge. No provider is promoted to `VERIFIED` based on this specification alone.
