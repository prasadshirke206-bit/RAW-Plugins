# RAW QuickJS Anime Providers

Each script is an independent QuickJS provider referenced by the root `manifest.json`.

## Contract

```js
getStreams(anilistId, "anime", season, episode)
```

The full host-supplied request context is available at `globalThis.__CALL_ARGS__`. Context may include the canonical title aliases, year, selected audio preference and validated provider-specific ID mappings.

Returned candidates must:

- include `name`, `title`, `url`, `quality`, `type` and `provider`;
- include the exact `anilistId` and `episodeNumber`;
- use HTTPS URLs;
- use only actually observed resolution and subtitle information;
- return an empty array when identity mapping or playback resolution is ambiguous or fails.

The app must compare `anilistId` and `episodeNumber` against the active playback request before offering a candidate to MPV. It must not trust plugin-supplied metadata alone.

## Providers

- `allanime.js` — AllAnime GraphQL and internal player path.
- `anikage.js` — Anikage API and Koto/Rai source path.
- `anikoto.js` — Anikoto multisource AJAX, mapper and MegaPlay path.
- `anilight.js` — AniLight API and public MegaPlay path.
- `miruro.js` — Miruro AniList episode mapping, secure-pipe response decoding, source/subtype fallback, Miruro HLS relay URL construction and observed subtitle tracks. Browser-fingerprint spoofing and Android-only embed extractors are intentionally not ported.

See `docs/RAW_APP_ANIME_RUNTIME_INTEGRATION.md` for the host requirements and known limitations.
