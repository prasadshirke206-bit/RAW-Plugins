/* AnimeSogo — registered but deliberately disabled pending a supported RAW host capability.
 * Kotlin source delegates to the shared AnikotoTheme runtime, which is not included in this repository snapshot; port is pending the exact shared implementation.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
