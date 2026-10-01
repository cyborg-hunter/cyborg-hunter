// The error catalogue: every loud console.error the one-line setup prints
// names the problem, its cause, the fix and a doc link, in that order, so a
// researcher reading the console never has to guess what to change.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { DOCS, formatError, loudError, MESSAGES } from '../../src/oneliner/errors.js';

const FORMAT = /^\[cyborg-hunter\] .+: .+\. Fix: .+\. https:\/\/.+docs\/.+\.md#/;

// Each message with sample arguments, the fix text it must carry and its link.
const CASES = {
  doubleLoad: {
    args: ['ch.js', 'cyborg-hunter.min.js'],
    fix: 'load only one of ch.js and cyborg-hunter.min.js (the one-liner already contains the monitor)',
    link: DOCS + 'advanced-integration.md#double-load'
  },
  notHookable: {
    args: [],
    fix: 'move the ch.js <script> above your experiment code (and below jspsych.js)',
    link: DOCS + 'quickstart.md#placement'
  },
  loadedAboveJsPsych: {
    args: [],
    fix: 'move the ch.js <script> below jspsych.js and above your experiment code',
    link: DOCS + 'quickstart.md#placement'
  },
  randomId: {
    args: ['ch-0123456789ab'],
    fix: 'add data-participant-id="..." to the ch.js tag or pass the ID in the URL',
    link: DOCS + 'quickstart.md#participant-id'
  },
  manualInitOnOneLiner: {
    args: [],
    fix: 'remove the init()/startTrial()/endTrial() code, or switch to cyborg-hunter.min.js for manual mode',
    link: DOCS + 'advanced-integration.md#manual-mode'
  },
  unknownPreset: {
    args: ['stric'],
    fix: 'use permissive, standard or strict',
    link: DOCS + 'quickstart.md#configuration'
  },
  coreLoadedTwice: {
    args: [],
    fix: 'keep one <script> tag',
    link: DOCS + 'advanced-integration.md#double-load'
  },
  bootFailed: {
    args: ['boom'],
    fix: 'open an issue with this message and your <script> tag',
    link: DOCS + 'known-issues.md#one-line-setup'
  },
  guardFailed: {
    args: ['honeypot', 'boom'],
    fix: 'open an issue with this message and your <script> tag',
    link: DOCS + 'known-issues.md#one-line-setup'
  }
};

describe('error catalogue', () => {
  it('formatError joins problem, cause, fix and link in the catalogue format', () => {
    assert.strictEqual(formatError('P', 'c', 'f', 'https://x/docs/a.md#b'),
      '[cyborg-hunter] P: c. Fix: f. https://x/docs/a.md#b');
  });

  it('every message is covered by this test', () => {
    assert.deepStrictEqual(Object.keys(MESSAGES).sort(), Object.keys(CASES).sort());
  });

  for (const [name, c] of Object.entries(CASES)) {
    it(name + ': problem · cause · fix · link', () => {
      const msg = MESSAGES[name](...c.args);
      assert.match(msg, FORMAT);
      assert.ok(msg.includes('. Fix: ' + c.fix + '. '), 'fix text: ' + msg);
      assert.ok(msg.endsWith(' ' + c.link), 'link: ' + msg);
    });
  }

  it('the double-load message names both scripts in load order', () => {
    assert.ok(MESSAGES.doubleLoad('ch.js', 'cyborg-hunter.min.js')
      .includes(': cyborg-hunter.min.js was loaded after ch.js. Fix:'));
  });

  it('the random-id message carries the generated id', () => {
    assert.ok(MESSAGES.randomId('ch-0123456789ab').includes('using ch-0123456789ab. Fix:'));
  });

  it('loudError prints the formatted message through console.error', () => {
    const orig = console.error;
    const seen = [];
    console.error = (m) => seen.push(m);
    try { loudError('P', 'c', 'f', 'https://x/docs/a.md#b'); } finally { console.error = orig; }
    assert.deepStrictEqual(seen, ['[cyborg-hunter] P: c. Fix: f. https://x/docs/a.md#b']);
  });
});

// The existing bundles cannot import errors.js (the guard files are plain
// IIFEs), so their double-load messages are written out; build.js imports the
// catalogue. Either way the console text must be in the catalogue format.
describe('loud errors in the existing bundles', () => {
  const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  const LITERAL = /console\.error\(\s*'(\[cyborg-hunter\][^']*)'/g;
  const CALL = /MESSAGES\.(\w+)\(/g;

  for (const file of ['build.js', 'src/jspsych/extension-guard-honeypot.js', 'src/jspsych/extension-guard-friction.js']) {
    it(file + ': every [cyborg-hunter] console.error is in the catalogue format', () => {
      const src = read(file);
      const literals = [...src.matchAll(LITERAL)].map((m) => m[1]);
      const calls = [...src.matchAll(CALL)].map((m) => m[1]);
      assert.ok(literals.length + calls.length > 0, file + ' has no double-load message');
      for (const lit of literals) assert.match(lit, /^\[cyborg-hunter\] .+: .+\. Fix: .+\. https:\/\/.+\.md#/);
      for (const name of calls) assert.strictEqual(typeof MESSAGES[name], 'function', 'MESSAGES.' + name);
    });
  }

  it('build.js takes the min.js double-load messages from the catalogue', () => {
    const src = read('build.js');
    assert.match(src, /import \{ MESSAGES \} from '\.\/src\/oneliner\/errors\.js'/);
    assert.match(src, /MESSAGES\.doubleLoad\('ch\.js', 'cyborg-hunter\.min\.js'\)/);
    assert.match(src, /MESSAGES\.coreLoadedTwice\(\)/);
  });

  // "loaded after ch.js" is only true when the sentinel is ch.js's own; a
  // second copy of min.js gets the neutral loaded-twice message instead.
  it('build.js: the min.js footer branches on which bundle set the sentinel', () => {
    const src = read('build.js');
    assert.match(src, /window\.__cyborgHunterLoaded==="ch\.js"\)\{console\.error\(' \+\s*JSON\.stringify\(MESSAGES\.doubleLoad\(/);
    assert.match(src, /\}else if\(window\.__cyborgHunterLoaded\)\{console\.error\(' \+\s*JSON\.stringify\(MESSAGES\.coreLoadedTwice\(\)\)/);
  });

  it('the core-loaded-twice message does not claim a load order', () => {
    const msg = MESSAGES.coreLoadedTwice();
    assert.ok(msg.startsWith('[cyborg-hunter] cyborg-hunter.min.js is loaded twice: '), msg);
    assert.ok(!msg.includes('after'), msg);
  });
});
