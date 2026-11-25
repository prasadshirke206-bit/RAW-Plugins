/* AniLab — registered but deliberately disabled pending a supported RAW host capability.
 * Playback depends on Kyoto Player's official app request signature; pending a legitimate host-owned integration.
 * This fail-closed entrypoint must not be enabled as a placeholder resolver.
 */
async function getStreams(anilistId, mediaType, season, episode) {
  return [];
}
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
