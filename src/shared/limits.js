// src/shared/limits.js
// Bounds on what participant-supplied files may cost the researcher's
// machine. A `.json.gz` upload is participant data: a small file can expand
// to gigabytes (a "gzip bomb") and exhaust the memory of the CLI or of the
// analyzer's worker. A dom-tier recording is a few MB uncompressed and a
// large participant file tens of MB, so 256 MiB is far above any real file.
// The same bound applies to a file as stored: an uncompressed upload that
// size would be read and parsed whole, at several times its size in memory.
export const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

export function tooLargeMessage(limit) {
  return 'decompressed size exceeds ' + Math.round(limit / (1024 * 1024)) +
    ' MB; not read (a file this large is not a Cyborg Hunter file, or it is a gzip bomb)';
}

// A lazy reader's bytes ({ size, read() }, ingest-core.js), or an Error
// thrown before anything is read when the file is larger than `limit`. A
// size that cannot be had (the Node shell's lazy stat failing) leaves the
// verdict to read(), which then reports its own failure.
export async function readWithinLimit(reader, limit = MAX_DECOMPRESSED_BYTES) {
  let size = null;
  try { size = reader.size; } catch { /* read() below reports it */ }
  if (typeof size === 'number' && size > limit) {
    throw new Error('file is larger than ' + Math.round(limit / (1024 * 1024)) +
      ' MB; not read (a file this large is not a Cyborg Hunter file)');
  }
  return reader.read();
}
