# Anime provider Kotlin → QuickJS parity audit

**Audit baseline:** `main` at `16f87f7fabdb31332bb6fa1142cd61a373aad960`  
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

**Follow-up update (November 26, 2026, parity phase 1):** Anikage's JS port now covers live `PUBLIC_PROXY_URL` discovery, supported MegaPlay/VibePlayer direct-HLS routes, `embedOptions` label precedence, Kotlin subtitle filtering/token handling, and empty-`subTypes` defaults. AllAnime's JS source decoder now mirrors all five Kotlin prefix modes and unprefixed XOR probing. AniLight's JS MegaPlay flow now matches the Kotlin endpoint/query/referer, track filtering, and dynamic AES key/IV refresh. Mocked parity fixtures were added for these paths. The draft PR remains subject to a fresh CI run and real-device playback verification; native WebView and local relay gaps remain open.

**Follow-up update (November 26, 2026, parity phase 2):** The shared QuickJS runtime now includes EmbedSeek and StreamWish, plus GogoStream, OK.ru, Mp4Upload and Streamlare extractors derived from their Kotlin contracts. Its generic P.A.C.K.E.R. helper is retained without the Filemoon PoW/CAPTCHA extractor. Animostream and AllAnime bundle the shared runtime and the Synchrony deobfuscator required by StreamWish; AnimeSalt and AllAnime bundles are kept synchronized. AllAnime's internal clock resolver now covers MP4, HLS, adaptive iframe HLS/DASH and DASH video/audio rendition records. Anikoto now reproduces the Kotlin episode VRF and MegaPlay AES-CBC/HMAC-SHA256 90-second token, optional `s` query, ASS-first subtitle handling and intro/outro metadata. New mocked fixtures cover these branches. These remain `PORTED_WITH_GAPS` until all host-specific branches and real-device playback have been verified; Android WebView/loopback relay requirements remain native RAW work.
The branch CI run for commit `5401673698523b5714ce80c342274d3d0f3d51aa` passes `npm test` (68/68 tests, including generated-bundle drift validation and manifest enablement checks). This is mocked contract validation only, not live-provider or MPV playback verification.

## Enabled providers

| Provider | Status | Kotlin behavior not fully represented by JS |
|---|---|---|
| AllAnime | PORTED_WITH_GAPS | JS now mirrors all Kotlin XOR prefix modes and preserves internal `/apivtwo/` routing. It handles internal MP4, HLS, Crunchyroll-style adaptive HLS/DASH, DASH video/audio renditions, and mapped GogoStream, Dood, OK.ru, Mp4Upload, Streamlare and StreamWish hosts with mocked fixtures. Filemoon remains intentionally unsupported because the available Kotlin path requires a PoW/CAPTCHA challenge flow. Live endpoint and device playback verification remain outstanding. |
| Anikage | PORTED_WITH_GAPS | JS now discovers Kotlin's live `PUBLIC_PROXY_URL`, preserves caption filtering and `.vtt` proxy URLs, applies `embedOptions` label precedence, and resolves the supported MegaPlay/VibePlayer direct-HLS branches. Kotlin's loopback relay for `vivibebe.site`, `echovideo.to`, and `krussdomi.com`, plus UniversalExtractor routes, still require RAW-native HLS/WebView host capabilities. Added mocked fixtures; real-device playback remains unverified. |
| Anikoto | PORTED_WITH_GAPS | JS now signs the episode-list request with the Kotlin VRF, forwards the optional MegaPlay `s` parameter, decrypts the AES-CBC source and reproduces the 90-second HMAC-SHA256 CDN token. It also preserves Kotlin's referers, ASS-over-VTT subtitle preference, thumbnail metadata, intro/outro timestamps and mapper server display names. The checked-in Kotlin class is a thin subclass of the upstream shared `AnikotoTheme`; remaining work is device playback plus any host/type preference branches not represented in the plugin contract. |
| AniLight | PORTED_WITH_GAPS | JS now follows Kotlin's duplicated `id` MegaPlay source query, fixed MegaPlay referers, arbitrary `data-id`, non-thumbnail track handling, `[Sub]`/`[Soft Sub]`/`[Dub]` labels, and AES-CBC key/IV refresh from `newclient.min.js`; mocked fixtures were added. Kotlin's WebView/Turnstile server resolver and native HLS relay for special CDN/audio renditions remain RAW-host capability gaps. |
| Miruro | PORTED_WITH_GAPS | JS ports the secure-pipe request/response decoding, provider/subtype mapping, proxy URL generation, and direct HLS/subtitle records. Kotlin additionally warms the base/watch-page session, manages cookies/config/mirrors, handles browser/WAF behavior, and uses native embed extractors and local HLS integration. |
| AniChan | PORTED_WITH_GAPS | JS ports the AniList-ID → episode/server API flow and direct HLS/MP4/subtitle handling. Kotlin also resolves supported embed URLs through UniversalExtractor and uses PlaylistUtils/M3U8 integration; the embed path requires the proposed Android WebView bridge. |
| AniKura | PORTED_WITH_GAPS | JS ports title mapping, episode lookup, stream API calls, and track parsing. Kotlin uses PlaylistUtils/M3U8 integration and has provider-side server/expiry preferences; the RAW port intentionally omits the extension's five-day demo gate, but playlist fallback behavior still needs parity fixtures. |
| AniKuro | PORTED_WITH_GAPS | Both use the same 12 normalized source endpoints. The Kotlin extension exposes all hosters and applies preferred/excluded server and audio-type settings; JS currently probes sequentially and stops after the first provider produces candidates. This is an intentional automation adaptation only if RAW's resolver contract confirms it. |
| AnimeSuge | PORTED_WITH_GAPS | JS now ports the Kotlin RC4 → Base64URL → cyclic byte-shift → Base64URL → ROT13 VRF, exact-title search, site ID and `data-ids` episode selection, server lookup, and observed direct HLS/MegaPlay resolution with mocked fixtures. The full AnikotoTheme extractor set, native playlist/key proxy, metadata preferences and real-device playback are not yet verified. |
| AnimeHeaven | CLOSE_PENDING_DEVICE_TEST | The JS port reproduces the gate-key cookie request and the three direct-media discovery fallbacks (video source, download link, token reconstruction), while excluding the decoy host. It still needs comparison fixtures for cookie isolation, URL ordering, and request headers, plus device validation. |
| Ani.pm | PORTED_WITH_GAPS | JS reproduces playback bootstrap → Settlar session → embed session, key-proof header, subtitle extraction, and HLS parsing. Kotlin additionally sends videos and subtitle tracks through its local proxy; encrypted-key/playlist behavior must be proven equivalent or implemented natively. |
| AnimeSaga | PORTED_WITH_GAPS | JS preserves AniList mapping and encrypted response parsing, but Kotlin has Dood/VidHide extraction, multiple provider-specific embed branches, and a loopback proxy that rewrites playlist/segment URLs. Direct-only JS candidates do not replace those paths. |
| Anitummy (Anitusk) | PORTED_WITH_GAPS | JS now attempts Fast/MegaPlay, VidNest direct-media discovery, and both sub/dub on Kiwi (AnimePahe), Net (AnimeDao), and Ally (AllManga) API routes. Direct HLS/MP4 and visible captions are emitted. Protected Dood/VidHide/vidnest extractor branches and native HLS integration are still not equivalent; Cloudflare/session-denied routes fail closed. |
| AnimeSalt | PORTED_WITH_GAPS | JS handles episode/server-page parsing, public MegaPlay decryption, the Kotlin AS-CDN/FirePlayer POST → HLS flow, and shared Abyss AES-CTR plus VidMoly extraction (with mocked fixtures). Dood, StreamTape, Filemoon and Universal hoster paths plus local playlist rewriting remain incomplete; Universal needs the proposed Android WebView bridge. |
| FourAnimo / Zanix | PORTED_WITH_GAPS | JS handles page token, AJAX episode lookup, and the public M/R/ReCloud embed flow. Kotlin additionally rewrites playlists and segments through FourAnimoHlsServer, including special segment handling and referer forwarding. |
| AniMoTVSlash | PORTED_WITH_GAPS | JS parses the WordPress episode/iframe flow and extracts direct HLS. Kotlin also has Filemoon, StreamWish, VidHide, and Vidara extractors, as well as additional iframe routes. |
| AniNeko | PORTED_WITH_GAPS | JS parses server-video buttons and returns directly visible media. Kotlin also supports Dood/VidHide extraction and a loopback proxy for playlists and segments. |
| AnimeStream | PORTED_WITH_GAPS | JS follows Kotlin's season pagination, retains main/alternate-audio/hard-sub playlist routes, preserves audio-group masters, and inspects nested HLS playlists. It fails closed when a playlist requires an external encrypted-key URI. Kotlin's local proxy rewrites playlist/segment/key URLs and decrypts keys with a media-ID-derived AES key; that native capability remains unported. |
| Animostream | PORTED_WITH_GAPS | JS parses Blogger animeData/server arrays and now routes EmbedSeek and StreamWish through the shared QuickJS runtime, alongside Abyss, Dood, StreamTape and VidMoly. UniversalExtractor remains a native WebView bridge gap. Filemoon is intentionally not bundled because its available flow requires automated challenge/PoW verification. Real-device playback remains unverified. |

## Disabled providers

These eight entries remain catalogue-enabled by user decision but are still implementation-blocked. Their Kotlin source must remain available until each missing flow has a legitimate, tested QuickJS or RAW-native implementation.

| Provider | Status | Blocking Kotlin behavior |
|---|---|---|
| AniLab | BLOCKED | Kyoto Player official-client request signing. Do not synthesize or impersonate the official signature. |
| AnimePahe | BLOCKED | Cloudflare/session flow, native HLS server, Kwik extractor, and supporting session logic. |
| AnimeSogo | BLOCKED | Inherits shared AnikotoTheme logic; the exact shared source is not present in this source snapshot. |
| AniSnatch | BLOCKED | Dynamic site-config-derived request/response cipher and gzip framing are not yet ported with fixtures. |
| AniWave | BLOCKED | VRF/extractor chain and native HLS proxy. |
| AV1Encodes | BLOCKED | Site verification/ad-check flow and native extractor dependencies. |
| ReAnime | BLOCKED | Native FlixProxyServer rewrites stream and key URLs. |
| Senshi | BLOCKED | AES-GCM playlist handling and native segment/key proxy. |

## Kotlin source inventory

The repository contains **27 original anime provider classes** and **76 Kotlin files** across the two anime source trees (`anime/providers/` and `src/eu/kanade/tachiyomi/animeextension/`). These include DTOs, filters, extractor classes, browser resolvers, and loopback proxy helpers—not just the top-level provider classes.

Do not mass-delete every `.kt` file in the repository. The root also contains shared extractor/library Kotlin sources used by the original extension sources. Remove anime Kotlin source only after its corresponding parity gate passes, and do not delete unrelated movie/TV or shared source code as part of an anime-only migration.

## Shared QuickJS extractor coverage update

The shared runtime at providers/anime/shared/extractors.js now contains reusable implementations for StreamWish, EmbedSeek, GogoStream, OK.ru, Mp4Upload, Streamlare, Abyss, Dood, StreamTape, VidMoly, VidHide and Vidara. These implementations are JavaScript runtime ports; the Kotlin source modules under extractors/ remain native reference implementations and are not imported directly by QuickJS.

| Enabled provider | Shared hoster extractors routed from its JS provider |
|---|---|
| AllAnime | GogoStream, Dood, OK.ru, Mp4Upload, Streamlare, StreamWish |
| AniMoStream | StreamWish, EmbedSeek, StreamTape, Dood, VidMoly, Abyss |
| AnimeSalt | VidMoly, Abyss, Dood, StreamTape |
| AniMoTVSlash | StreamWish, VidHide, Vidara, Abyss |
| AniNeko | VidHide, Dood |
| AnimeSaga | VidHide, Dood |
| Anitummy | VidHide, Dood, StreamWish, Vidara |

The shared source is now generated into standalone bundles for AllAnime, AniMoStream, AnimeSalt, AniMoTVSlash, AniNeko, AnimeSaga and Anitummy. The bundle generator and synchronization test both enumerate the same target files so a helper change cannot silently leave one of those bundles stale. Providers not listed here currently use direct/API routes or still have provider-specific hoster work outstanding; this does not imply that every provider requires the same hosters.

### Native libraries and host-only capabilities

| Native module/source | Role | QuickJS/RAW decision |
|---|---|---|
| libraries/synchrony | StreamWish script deobfuscation | The original asset is JavaScript and is bundled for the providers that need it |
| libraries/unpacker | P.A.C.K.E.R. and related player-script unpacking | Shared JS has a compatible unpacker subset; retain Kotlin until every consumer has parity tests |
| libraries/cryptoaes | AES helpers used by native extensions | Port only the exact provider-required algorithm to JS/WebCrypto with fixtures; do not assume API compatibility |
| libraries/m3u8server | Local playlist, segment and key proxy/rewrite integration | Requires a RAW-native Android bridge; ordinary QuickJS fetch cannot replace a loopback media proxy |
| extractors/universal-extractor | WebView-based browser/player execution and media URL detection | Requires the documented Android WebView bridge; do not fake it in JS |
| extractors/dood-extractor, vidhide-extractor, vidara-extractor, streamwish-extractor, streamtape-extractor, vidmoly-extractor | Reusable host-specific extraction | Reuse the JS implementation where routed; native versions remain parity references |

The new VidHide port follows the visible packed-player script, HLS URL and caption-track path. The Vidara port follows its public /api/stream JSON POST and the distinct upns.pro hex/reverse/JSON response path. Both emit candidates only with the caller-supplied AniList ID and episode number and parse qualities from the returned HLS playlist. Their fixture tests validate the request shapes and candidate identity; they do not prove that current third-party endpoints are live or that MPV playback succeeds on a device.

The shared HLS parser discovers observed variants and subtitle references, but it is not a general replacement for the native local proxy. Providers whose original Kotlin implementations rewrite relative playlist, segment, or encryption-key URLs must stay marked as having native playback gaps until RAW implements and tests that bridge. UniversalExtractor/WebView flows, browser-mediated user verification and encrypted-key proxy paths are similarly distinct from ordinary direct hoster extraction.

Do not enable a provider merely because a shared extractor now exists. Its provider must still map the exact AniList title and episode, return real observed candidates, preserve headers/tracks, pass regression fixtures and undergo real Android/MPV playback validation.

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
