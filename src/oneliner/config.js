// src/oneliner/config.js
// The one-liner's configuration, from two places: the ch.js tag's data-*
// attributes (`dataset`) and window.CyborgHunterConfig (`globalConfig`).
// A tag attribute wins over the same key in CyborgHunterConfig.
//
// readConfig({ dataset, globalConfig }) → {
//   preset,                                  'standard' unless set
//   participantIdAttr,                       data-participant-id, or null
//   guards: { honeypot, friction },          data-guards: comma list of
//                                            honeypot | friction | none;
//                                            default honeypot on, friction off
//   replay: null | { tier: 'trace'|'dom' },  data-replay: "" | trace → trace, dom → dom
//   replaySrc,                               data-replay-src, or null
//   debug,                                   data-debug present (and not "false")
//   monitor                                  every other CyborgHunterConfig key,
//                                            passed to init() as is (init's own
//                                            validateConfig warns on typos);
//                                            CyborgHunterConfig.participantId
//                                            rides here for the id resolver
// }
// autoMonitor and excludeTrialTypes are dropped with a warning: the one-liner
// monitors every trial.

export const DATA_KEYS = ['preset', 'participantId', 'guards', 'replay', 'replaySrc', 'debug'];

var ONE_LINER_KEYS = ['preset', 'guards', 'replay', 'replaySrc', 'debug'];
var REMOVED_KEYS = ['autoMonitor', 'excludeTrialTypes'];
var GUARD_NAMES = ['honeypot', 'friction'];

function has(obj, key) {
  return !!obj && obj[key] !== undefined && obj[key] !== null;
}

// A bare attribute (data-debug) is the empty string, which is "on".
function flag(v) {
  if (typeof v === 'string') return v.trim().toLowerCase() !== 'false';
  return !!v;
}

function parseGuards(v) {
  var out = { honeypot: false, friction: false };
  var names = Array.isArray(v) ? v : String(v).split(',');
  names.forEach(function (raw) {
    var name = String(raw).trim().toLowerCase();
    if (name === '' || name === 'none') return;
    if (GUARD_NAMES.indexOf(name) === -1) {
      console.warn('[cyborg-hunter] data-guards: unknown guard "' + name + '" ignored (use honeypot, friction or none)');
      return;
    }
    out[name] = true;
  });
  return out;
}

function parseReplay(v) {
  if (v === false) return null;
  if (v === true) return { tier: 'trace' };
  var tier = String(v).trim().toLowerCase();
  if (tier === '' || tier === 'trace') return { tier: 'trace' };
  if (tier === 'dom') return { tier: 'dom' };
  console.warn('[cyborg-hunter] data-replay: unknown tier "' + v + '"; recording the trace tier (use trace or dom)');
  return { tier: 'trace' };
}

export function readConfig(opts) {
  var dataset = (opts && opts.dataset) || {};
  var globalConfig = (opts && opts.globalConfig) || {};

  // The tag attribute when present, else the CyborgHunterConfig value.
  function pick(key) {
    if (has(dataset, key)) return dataset[key];
    if (has(globalConfig, key)) return globalConfig[key];
    return undefined;
  }

  var monitor = {};
  Object.keys(globalConfig).forEach(function (key) {
    if (ONE_LINER_KEYS.indexOf(key) !== -1) return;
    if (REMOVED_KEYS.indexOf(key) !== -1) {
      console.warn('[cyborg-hunter] CyborgHunterConfig.' + key + ' is ignored: the one-line setup monitors every trial');
      return;
    }
    monitor[key] = globalConfig[key];
  });

  var guards = pick('guards');
  var replay = pick('replay');
  var debug = pick('debug');
  return {
    preset: pick('preset') || 'standard',
    participantIdAttr: has(dataset, 'participantId') ? dataset.participantId : null,
    guards: guards === undefined ? { honeypot: true, friction: false } : parseGuards(guards),
    replay: replay === undefined ? null : parseReplay(replay),
    replaySrc: pick('replaySrc') || null,
    debug: debug === undefined ? false : flag(debug),
    monitor: monitor
  };
}
