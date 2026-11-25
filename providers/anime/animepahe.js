/* AnimePahe — registered but deliberately disabled pending a supported RAW host capability.
 * Current implementation depends on Cloudflare/session handling and native HLS/Kwik extractors; pending legitimate browser/session host support.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
