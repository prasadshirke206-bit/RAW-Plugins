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
- `miruro.js` — Miruro pipe API, exact episode/subtype/provider mapping, XOR+gzip response decoding, direct HLS relay URLs and source subtitles.
- `anichan.js` — AniChan episodes/servers API and direct HLS/MP4.
- `anikura.js` — AniKura title match and stream API.
- `anikuro.js` — AniKuro discovery, episode and normalized source APIs.
- `animeheaven.js` — AnimeHeaven episode gate and direct media.
- `anipm.js` — Ani.pm playback-bootstrap and Settlar media session.
- `animesaga.js` — AnimeSaga encrypted JSON and direct media paths.
- `anitusk.js` — Anitummy Fast MegaPlay route and AES-CBC payload.
- `animesalt.js` — AnimeSalt WordPress episode data, public MegaPlay/FirePlayer routes and shared Abyss AES-CTR HLS/MP4/Sora extraction.
- `fouranimo.js` — Zanix/FourAnimo tokenized episode API and cloud HLS sources.
- `animotvslash.js` — AniMoTVSlash mirror parsing and directly visible HLS.
- `anineko.js` — AniNeko server buttons and directly visible HLS/MP4.
- `animestream.js` — AnimeStream REST catalogue/episode APIs and locale HLS.
- `animostream.js` — Animostream Blogger animeData, shared Abyss/Dood/StreamTape/VidMoly/Filemoon P.A.C.K.E.R. extraction and direct HLS/MP4.
- `anilab.js`, `animepahe.js`, `animesogo.js`, `animesuge.js`, `anisnatch.js`, `aniwave.js`, `av1encodes.js`, `reanime.js`, `senshi.js` — disabled fail-closed entries pending the host integrations documented in the runtime guide.

See `docs/RAW_APP_ANIME_RUNTIME_INTEGRATION.md` for the host requirements and known limitations.

## Enabled vs. disabled

The manifest registers 27 anime sources in total. Eighteen entries are enabled (the five earlier ports plus thirteen new direct-flow ports). Nine entries remain disabled because the current upstream code depends on native Android/local proxy components, official-client request signing, unavailable shared source code, or verification/session capabilities that QuickJS does not provide. Disabled scripts return an empty array; RAW must honor the `enabled: false` manifest flag.