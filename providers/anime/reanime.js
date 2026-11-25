/* ReAnime — registered but deliberately disabled pending a supported RAW host capability.
 * Playback relies on the native FlixProxyServer to rewrite streams/keys; pending a RAW host-side proxy capability.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
