# RAW Provider Plugin Creation Guide

## Runtime contract

- Engine: QuickJS, ES2020-compatible.
- API version: 1.
- Entrypoint: `getStreams(tmdbId, mediaType, season, episode)`.
- Full request context: `globalThis.__CALL_ARGS__`.
- Initial media types: `movie` and `tv`.
- Return value: an array of stream candidates.

The host calls the function with four arguments. Do not expect a fifth metadata argument. Use the injected context for title, year, IMDb ID and other supplied metadata.

## Request identity

Reject empty TMDB IDs and unsupported media types. For TV, require positive season and episode values. Never silently switch to another media item based on fuzzy title matching.

## Stream candidate

Required fields: `name`, `title`, `url`, `quality`, `type`, `provider`.

Optional fields: `language`, `headers`, `subtitles`.

See `schemas/stream-candidate.schema.json`. Every returned field is an untrusted provider claim until validated by RAW.

## Quality and track truthfulness

Canonical tiers: 2160p, 1440p, 1080p, 720p, 480p, 360p, 240p and 144p.

Never promote unknown quality to 1080p. Never infer English or Hindi from assumptions. Never fabricate subtitles. RAW must inspect manifests and MPV's actual track list before presenting verified quality, audio or subtitle options.

## QuickJS compatibility

Do not assume Node.js APIs exist. Avoid `Buffer`, `process`, `fs`, `path`, Node crypto modules and `AbortSignal.timeout()` unless RAW's runtime explicitly documents them. Use only the host networking bridge documented by RAW.

## Security

- Enforce HTTPS, host policy, request timeouts, cancellation and response-size limits.
- Reject localhost, private-network, `file:`, `content:` and cleartext HTTP targets by default.
- Do not expose OAuth, Supabase, API or signing secrets to plugins.
- Do not bypass CAPTCHA, DRM, authentication or access controls.
- Keep plugin storage isolated and permission-gated if it is supported.

## Release checklist

1. Manifest schema passes.
2. Provider ID and file path match the manifest.
3. QuickJS tests pass without Node globals.
4. Movie/TV identity is verified by the host.
5. URL and headers pass host policy.
6. No invented quality, language or subtitle claims.
7. Cancellation and stale-session tests pass.
8. MPV opens the source with required headers.
9. First-frame startup and sustained playback pass on a real device.

A provider returning a URL is not evidence of successful playback.
