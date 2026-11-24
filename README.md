# RAW Plugins

Official repository of independently versioned provider scripts and native source modules for the RAW Android app.

## Repository layout

```text
RAW-Plugins/
├── providers/
│   ├── movie-tv/       # QuickJS movie and TV provider scripts
│   └── anime/          # Future QuickJS anime provider scripts
├── anime/
│   └── providers/
│       ├── allanime/   # AllAnime upstream Kotlin source
│       ├── anikage/    # Anikage upstream Kotlin source
│       ├── anikoto/    # Anikoto upstream Kotlin source
│       └── anilight/   # AniLight upstream Kotlin source
├── extractors/         # Reusable native Kotlin hoster extractors
├── libraries/          # Shared native helpers, scrapers and runtime support
├── schemas/
├── docs/
└── tests/
```

## Runtime boundary

The Kotlin source under `anime/providers/`, `extractors/` and `libraries/` is native Android source material. It is **not** automatically executable by RAW's QuickJS plugin runtime. A provider using these modules must be integrated into a compatible Android runtime/host adapter before it can be enabled in RAW.

The existing `providers/movie-tv/` JavaScript providers use the repository's QuickJS contract and are listed in the root `manifest.json`. Anime QuickJS plugins will have a separate AniList/episode-aware contract; the native Kotlin anime sources remain organized separately until that adapter exists.

RAW validates candidate media identity and stream metadata before handing a selected candidate to its existing MPV player. A returned URL alone does not prove successful playback.

## Manifest URL

https://raw.githubusercontent.com/prasadshirke206-bit/RAW-Plugins/main/manifest.json

## Security and provenance

Treat provider code as untrusted. Enforce timeouts, cancellation, response-size limits, host allowlists, request budgets and per-provider isolation. Never expose app secrets or signing material. Do not bypass CAPTCHA, authentication, DRM or other access controls. Verify upstream attribution and redistribution licences before publishing source code.
