/* Senshi — registered but deliberately disabled pending a supported RAW host capability.
 * Playback requires AES-GCM playlist handling plus a native stream proxy for segment/key requests; pending host support.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
