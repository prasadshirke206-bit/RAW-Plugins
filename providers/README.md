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

Eight imported movie/TV provider entries are enabled in the current manifest and are loaded as individual providers by RAW. HDHub4u and NetMirror/Net77 remain disabled because their current scripts contain challenge-bypass behavior. Do not enable them until those paths have been removed or replaced with permitted source discovery.

Enabling a script only makes it eligible for execution; each returned candidate still passes the host's media-identity and stream validation gates. Actual Android MPV playback must be verified independently.

The template is disabled and deliberately returns no streams. It is not a playable provider.
