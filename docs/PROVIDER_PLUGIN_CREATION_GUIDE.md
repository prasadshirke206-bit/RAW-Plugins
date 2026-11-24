# RAW Provider Plugin Creation Guide

## Runtime

- Engine: QuickJS, ES2020-compatible.
- API version: 1.
- Entrypoint: `getStreams`.
- Request context: `globalThis.__CALL_ARGS__`.
- Return value: an array of stream candidates.

Do not assume Node.js APIs exist. Use only the host-provided QuickJS APIs and networking bridge. Provider files must fail closed when input identity or a stream cannot be resolved.

## Movie and TV contract

```js
getStreams(tmdbId, mediaType, season, episode)
```

Identity is TMDB. The existing movie/TV scripts and call contract remain unchanged.

## Anime contract

```js
getStreams(anilistId, "anime", season, episode)
```

Identity is AniList. Do not pass a TMDB ID in the first argument.

The host context may contain:
- `anilistId` — canonical AniList identity;
- `title`, `titles`, `aliases` — validated AniList title aliases;
- `year`, `seasonYear`, `format`, `totalEpisodes`;
- `episodeNumber`;
- `preferredAudio`;
- `providerMappings` — host-validated provider-specific IDs.

A provider must prefer a validated provider mapping. If it performs title-based lookup, it must require one unique exact title-alias match. Ambiguous matches return no streams.

Every anime candidate must include:
- `anilistId` — exact canonical AniList ID used for the call;
- `episodeNumber` — exact requested episode number.

The RAW host must independently enforce equality with the active playback identity. Never rely only on a provider's own assertion.

## Stream candidate

Required fields: `name`, `title`, `url`, `quality`, `type`, `provider`.

Optional fields: `language`, `headers`, `subtitles`, `anilistId`, `episodeNumber`.

See `schemas/stream-candidate.schema.json`.

## Quality and track truthfulness

Canonical quality tiers: 2160p, 1440p, 1080p, 720p, 480p, 360p, 240p and 144p.

Only emit a resolution parsed from a provider response or manifest. Unknown resolution must remain `Auto`. Never fabricate audio languages or subtitles. RAW must verify manifests and MPV tracks before presenting selectable playback settings.

## WebCrypto and network requirements

The current anime conversions use the host's `fetch` bridge. AllAnime encrypted episode responses require `crypto.subtle` AES-GCM; Anikoto and AniLight MegaPlay payloads require AES-CBC support. A host without WebCrypto must report a clear capability failure rather than silently claiming the provider has no streams.

## Security

- Enforce HTTPS, host policy, request timeouts, cancellation and response-size limits.
- Reject localhost, private-network, `file:`, `content:` and cleartext HTTP targets by default.
- Do not expose OAuth, Supabase, API or signing secrets to plugins.
- Do not bypass CAPTCHA, DRM, authentication or access controls.
- Do not allow plugins to override canonical media identity.

## Release checklist

1. Manifest schema and provider file paths validate.
2. Movie/TV provider entries and scripts remain unchanged.
3. Anime scripts pass QuickJS syntax and no-network contract tests.
4. Every candidate carries the exact AniList ID and episode number.
5. Returned URL and headers pass host policy.
6. No invented quality, language or subtitle claims.
7. Cancellation and stale-session tests pass.
8. MPV opens the source with required headers.
9. First-frame startup and sustained playback pass on a real Android device.

A provider returning a URL is not evidence of successful playback.
