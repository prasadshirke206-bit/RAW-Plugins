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

The manifest registers ten movie/TV provider scripts plus the disabled starter template. All ten imported provider entries are **disabled** by default. Registration does not mean a provider is production-ready: each must pass provenance/permission review, QuickJS runtime tests, candidate-schema validation, exact media-identity checks, and real Android MPV playback tests before it is enabled.

Anime is intentionally excluded from this catalogue and remains on RAW's separate AniNexus pipeline.

The provider metadata retains upstream attribution. A public repository URL is not, by itself, a reuse licence; confirm redistribution and modification rights before publishing these scripts for public installation.

## Security and provenance

Plugins are untrusted code. The Android runtime must enforce timeouts, cancellation, response-size limits, allowed URL schemes/hosts, request budgets and per-plugin isolation. Never expose app secrets, OAuth credentials, Supabase keys or signing material to provider scripts.

Do not bypass CAPTCHA, authentication, DRM or other access controls. Each production provider must have documented provenance and permission/compatible licensing before publication.
