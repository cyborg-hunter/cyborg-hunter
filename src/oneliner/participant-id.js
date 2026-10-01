// src/oneliner/participant-id.js
// Which participant the session belongs to, in order of precedence:
//   1. a URL parameter, the first name in `params` present in the query
//      string (recruitment platforms append the worker's ID to the study URL);
//   2. the ch.js tag's data-participant-id attribute;
//   3. window.CyborgHunterConfig.participantId;
//   4. a random id, which boot.js warns about: those rows cannot be linked
//      back to the platform's records.
// Values are trimmed; an empty or blank value counts as missing.
//
// resolveParticipantId({ search, attr, configId, params, random }) → { id, source }
//   search:  location.search ('?a=1&b=2')
//   params:  ordered URL parameter names; the caller supplies the list
//   random:  () => string, called only when nothing else is found
//   source:  'url:<param>' | 'attribute' | 'config' | 'random'
//            (boot.js adds 'session': a random id kept from an earlier page)

// The URL parameter names boot.js reads by default, in order of precedence.
export const DEFAULT_PARAMS = [];

function clean(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  return s === '' ? null : s;
}

export function resolveParticipantId(opts) {
  var query = new URLSearchParams(opts.search || '');
  var params = opts.params || [];
  for (var i = 0; i < params.length; i++) {
    var fromUrl = clean(query.get(params[i]));
    if (fromUrl) return { id: fromUrl, source: 'url:' + params[i] };
  }
  var attr = clean(opts.attr);
  if (attr) return { id: attr, source: 'attribute' };
  var configId = clean(opts.configId);
  if (configId) return { id: configId, source: 'config' };
  return { id: opts.random(), source: 'random' };
}

// 'ch-' + 12 lowercase hex characters (48 random bits) from the given
// Web Crypto object (window.crypto in the browser).
export function randomParticipantId(crypto) {
  var bytes = crypto.getRandomValues(new Uint8Array(6));
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return 'ch-' + hex;
}
