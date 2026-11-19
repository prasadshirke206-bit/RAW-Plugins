/*
 * RAW Provider Template
 *
 * Disabled starter file. It intentionally returns no streams.
 * Replace the discovery section with a reviewed provider implementation
 * before enabling this entry in manifest.json.
 *
 * Runtime: QuickJS / ES2020
 * Entrypoint: getStreams(tmdbId, mediaType, season, episode)
 */
(function (root) {
  "use strict";

  function readRequest(tmdbId, mediaType, season, episode) {
    var injected =
      (typeof globalThis !== "undefined" && globalThis.__CALL_ARGS__) || {};

    return {
      tmdbId: String(tmdbId || injected.tmdbId || ""),
      mediaType: String(mediaType || injected.mediaType || ""),
      season: Number(season || injected.season || 0),
      episode: Number(episode || injected.episode || 0),
      title: String(injected.title || injected.name || ""),
      year: String(injected.year || "")
    };
  }

  function isValidRequest(request) {
    if (!request.tmdbId) return false;
    if (request.mediaType !== "movie" && request.mediaType !== "tv") return false;
    if (request.mediaType === "tv") {
      return request.season > 0 && request.episode > 0;
    }
    return true;
  }

  async function getStreams(tmdbId, mediaType, season, episode) {
    var request = readRequest(tmdbId, mediaType, season, episode);
    if (!isValidRequest(request)) return [];

    // Intentionally no network calls and no fabricated candidates.
    return [];
  }

  root.getStreams = getStreams;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
