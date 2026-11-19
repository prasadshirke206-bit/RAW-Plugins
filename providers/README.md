# Provider catalogue

Each provider is a standalone JavaScript file referenced by `manifest.json`.

Provider files must:

- expose a global `getStreams(tmdbId, mediaType, season, episode)` entrypoint;
- read full request context from `globalThis.__CALL_ARGS__`;
- support only media types declared in its manifest entry;
- return candidates conforming to `../schemas/stream-candidate.schema.json`;
- use only the host-documented QuickJS APIs and networking bridge;
- avoid fabricated quality, language and subtitle claims;
- stop work when the host cancels the playback request.

The template is disabled and deliberately returns no streams. It is not a playable provider.
