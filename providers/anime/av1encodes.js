/* AV1Encodes — registered but deliberately disabled pending a supported RAW host capability.
 * Current provider flow includes site verification/ad-check gates and native extractor dependencies; pending a legitimate session handoff.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
