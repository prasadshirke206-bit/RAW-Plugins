/* AniWave — registered but deliberately disabled pending a supported RAW host capability.
 * Requires the upstream VRF/extractor chain and native HLS proxy; pending a host capability for those dependencies.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
