// src/shared/limits.js
// Bounds on what participant-supplied files may cost the researcher's
// machine. A `.json.gz` upload is participant data: a small file can expand
// to gigabytes (a "gzip bomb") and exhaust the memory of the CLI or of the
// analyzer's worker. A dom-tier recording is a few MB uncompressed and a
// large participant file tens of MB, so 256 MiB is far above any real file.
export const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

export function tooLargeMessage(limit) {
  return 'decompressed size exceeds ' + Math.round(limit / (1024 * 1024)) +
    ' MB; not read (a file this large is not a Cyborg Hunter file, or it is a gzip bomb)';
}
