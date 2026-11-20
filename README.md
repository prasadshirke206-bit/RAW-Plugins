# RAW Plugins

Official repository for independently versioned streaming-provider plugins for the RAW Android app.

**Initial scope:** Movies and TV series. Anime remains on RAW's existing AniNexus pipeline. Plugins return stream candidates; RAW validates them and hands the selected source to its existing libmpv/MPV playback engine.

## Manifest URL

https://raw.githubusercontent.com/prasadshirke206-bit/RAW-Plugins/main/manifest.json

## Layout

```text
RAW-Plugins/
├── manifest.json
├── schemas/
│   ├── manifest.schema.json
│   └── stream-candidate.schema.json
├── providers/
│   ├── README.md
│   ├── bingr.js
│   ├── movy.js
│   ├── 4khdhub.js
│   ├── hdhub4u.js
│   ├── bollyflix.js
│   ├── cinevood.js
│   ├── freekz.js
│   ├── net77.js
│   ├── uhdmovies.js
│   ├── vegamovies.js
│   └── provider-template.js
├── docs/
│   └── PROVIDER_PLUGIN_CREATION_GUIDE.md
├── tests/
│   └── manifest.test.mjs
└── package.json
```

## Provider lifecycle

1. RAW fetches and validates the repository manifest.
2. A provider is downloaded and checked against its manifest identity and version.
3. RAW executes it in a QuickJS sandbox.
4. The host calls `getStreams(tmdbId, mediaType, season, episode)` and injects full request context through `globalThis.__CALL_ARGS__`.
5. The plugin returns stream candidates.
6. RAW validates media identity, URL/host policy, headers and metadata before sending a selected candidate to MPV.

A returned URL is not proof of successful playback. RAW must verify MPV startup and inspect actual video, audio and subtitle tracks.

## Catalogue status

The manifest registers ten movie/TV provider scripts plus the disabled starter template. The ten imported providers are enabled for RAW's plugin runtime. Enabling a script makes it eligible for execution; it does **not** certify that every source, audio track, subtitle or rendition will resolve successfully on every network or device.

RAW executes each manifest entry as an individual provider so health, progress, failure tracking and failover retain the provider ID. Anime is intentionally excluded from this catalogue and remains on RAW's separate AniNexus pipeline.

RAW validates the media identity and stream metadata before sending a candidate to its existing MPV player. Actual Android MPV validation is still required before describing any provider as production-verified.

The provider scripts retain their upstream attribution. Confirm the rights and licence needed to redistribute and modify each upstream script before public distribution.

## Security and provenance

Plugins are untrusted code. The Android runtime must enforce timeouts, cancellation, response-size limits, allowed URL schemes/hosts, request budgets and per-plugin isolation. Never expose app secrets, OAuth credentials, Supabase keys or signing material to provider scripts.

Do not bypass CAPTCHA, authentication, DRM or other access controls. Each production provider must have documented provenance and permission/compatible licensing before publication.
