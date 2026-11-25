/* AniSnatch — registered but deliberately disabled pending a supported RAW host capability.
 * Uses a site-config-derived custom request/response cipher and gzip binary framing; pending a fully tested QuickJS implementation.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
