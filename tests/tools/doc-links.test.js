// Every documentation link the package ships must land somewhere: the
// relative .md links in README.md and docs/*.md, and the docs URLs inside
// the one-line setup's console messages (src/oneliner/errors.js), the
// guard bundles' double-load errors and the CLI's ingest warnings. A link's file must exist under docs/
// (or the repo root) and its #anchor must be a heading of that file, slugged
// the way GitHub slugs headings. Local working notes outside docs/ are
// not checked.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// GitHub's heading slug: inline code markers and link syntax dropped,
// lowercased, every character other than a letter, digit, space, hyphen or
// underscore removed, spaces turned into hyphens; a repeated slug gets -1, -2...
function slug(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

// The anchors of a markdown file: its ATX headings outside fenced code.
function anchors(markdown) {
  const out = new Set();
  const counts = Object.create(null);
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = counts[base] || 0;
    counts[base] = n + 1;
    out.add(n === 0 ? base : base + '-' + n);
  }
  return out;
}

// Relative links to .md files (with or without an anchor) and same-file
// anchors, outside fenced code. External URLs are not checked here.
function markdownLinks(markdown) {
  const out = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target)) continue;
      if (target.startsWith('#') || /\.md(#|$)/.test(target)) out.push(target);
    }
  }
  return out;
}

const cache = new Map();
function anchorsOf(file) {
  if (!cache.has(file)) cache.set(file, anchors(read(file)));
  return cache.get(file);
}

// null when `target` (relative to `fromFile`) resolves, else what is wrong.
function problem(fromFile, target) {
  const [path, anchor] = target.split('#');
  const file = path === '' ? fromFile : normalize(join(dirname(fromFile), path));
  if (relative(ROOT, join(ROOT, file)).startsWith('..') || !existsSync(join(ROOT, file))) return 'no file ' + file;
  if (anchor !== undefined && !anchorsOf(file).has(anchor)) return 'no heading for #' + anchor + ' in ' + file;
  return null;
}

const DOC_FILES = ['README.md'].concat(
  readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f)
);

// The console messages' links, as docs/<file>#<anchor> paths.
function messageLinks() {
  const links = [];
  for (const m of read('src/oneliner/errors.js').matchAll(/DOCS \+ '([^']+)'/g)) {
    links.push({ from: 'src/oneliner/errors.js', target: 'docs/' + m[1] });
  }
  // The CLI's warnings name a docs page as plain text (docs/<file>.md#<anchor>).
  for (const m of read('src/cli/ingest-core.js').matchAll(/(docs\/[A-Za-z0-9_-]+\.md#[A-Za-z0-9_-]+)/g)) {
    links.push({ from: 'src/cli/ingest-core.js', target: m[1] });
  }
  for (const f of ['src/jspsych/extension-guard-friction.js', 'src/jspsych/extension-guard-honeypot.js', 'build.js']) {
    for (const m of read(f).matchAll(/github\.com\/cyborg-hunter\/cyborg-hunter\/blob\/main\/(docs\/[^\s'"`)]+)/g)) {
      links.push({ from: f, target: m[1] });
    }
  }
  return links;
}

describe('documentation links', () => {
  it('slugs headings the way GitHub does', () => {
    assert.strictEqual(slug('3. Call `finalize()` before saving'), '3-call-finalize-before-saving');
    assert.strictEqual(slug('Standalone (non-jsPsych) usage'), 'standalone-non-jspsych-usage');
    assert.strictEqual(slug('Configuration beyond data-*'), 'configuration-beyond-data-');
    assert.deepStrictEqual([...anchors('# A\n```\n# not a heading\n```\n## A\n')], ['a', 'a-1']);
  });

  for (const file of DOC_FILES) {
    it(file + ': every relative .md link and #anchor resolves', () => {
      const bad = markdownLinks(read(file))
        .map((t) => ({ t, p: problem(file, t) }))
        .filter((x) => x.p)
        .map((x) => x.t + ' (' + x.p + ')');
      assert.deepStrictEqual(bad, []);
    });
  }

  it('the docs links in console messages resolve (errors.js, guard bundles, CLI ingest)', () => {
    const links = messageLinks();
    assert.ok(links.length >= 20, 'found only ' + links.length + ' message links');
    const bad = links
      .map((l) => ({ l, p: problem('README.md', l.target) }))
      .filter((x) => x.p)
      .map((x) => x.l.from + ': ' + x.l.target + ' (' + x.p + ')');
    assert.deepStrictEqual(bad, []);
  });
});

// docs/qualtrics.md quotes two scripts the Qualtrics harness runs
// (tests/e2e/oneliner/fixtures/qualtrics-harness.html): the replay recipe
// and the final-page line. The doc must show exactly what the e2e suite tests.
describe('docs/qualtrics.md scripts match the Qualtrics harness', () => {
  const doc = read('docs/qualtrics.md');
  const harness = read('tests/e2e/oneliner/fixtures/qualtrics-harness.html');
  const blocks = [...doc.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1].trim());

  it('the replay recipe', () => {
    const recipe = /<script type="text\/plain" id="qx-replay-recipe">([\s\S]*?)<\/script>/.exec(harness);
    assert.ok(recipe, 'no recipe block in the harness');
    assert.ok(blocks.includes(recipe[1].trim()), 'docs/qualtrics.md does not quote the harness recipe');
  });

  it('the final-page line', () => {
    const line = /\(0, eval\)\('(Qualtrics\.SurveyEngine\.addOnPageSubmit\([^']*)'\)/.exec(harness);
    assert.ok(line, 'no final-page line in the harness');
    assert.ok(blocks.includes(line[1].trim()), 'docs/qualtrics.md does not quote the harness final-page line');
  });
});

// The tag a researcher copies in Setup carries the survey's ID as well as the
// response's, so a survey whose address hides its ID still gets a session of
// its own.
describe('docs/qualtrics.md install snippet', () => {
  it('pipes the survey ID into data-qualtrics-survey-id', () => {
    const tags = [...read('docs/qualtrics.md').matchAll(/```html\n([\s\S]*?)```/g)]
      .map((m) => m[1].trim())
      .filter((b) => b.includes('dist/ch-qualtrics.js'));
    assert.strictEqual(tags.length, 1, 'expected one ch-qualtrics.js tag in an html block');
    assert.ok(tags[0].includes('data-qualtrics-survey-id="${e://Field/SurveyID}"'), tags[0]);
  });
});

// The one-line file is the integration a reader meets first: the overview
// pages show the ch.js tag before they mention the jsPsych extension, which
// belongs to manual mode and per-trial params.
describe('the one-line setup comes before the jsPsych extension', () => {
  for (const file of ['README.md', 'docs/using-cyborg-hunter.md']) {
    it(file + ' shows dist/ch.js before any jsPsychCyborgHunter', () => {
      const text = read(file);
      const tag = text.indexOf('dist/ch.js');
      const extension = text.indexOf('jsPsychCyborgHunter');
      assert.ok(tag >= 0, 'no dist/ch.js in ' + file);
      assert.ok(extension === -1 || tag < extension, 'jsPsychCyborgHunter appears before dist/ch.js in ' + file);
    });
  }
});

// With the one-line setup the monitor's options go in
// window.CyborgHunterConfig, and CyborgHunter.init() logs an error and
// records nothing, so the pages that show how to set options show the
// CyborgHunterConfig form before manual mode's init() call.
describe('monitor options: CyborgHunterConfig comes before CyborgHunter.init()', () => {
  for (const file of ['docs/configuration.md', 'docs/signals-reference.md']) {
    it(file + ' shows window.CyborgHunterConfig before any CyborgHunter.init(', () => {
      const text = read(file);
      const config = text.indexOf('window.CyborgHunterConfig');
      const init = text.indexOf('CyborgHunter.init(');
      assert.ok(config >= 0, 'no window.CyborgHunterConfig in ' + file);
      assert.ok(init === -1 || config < init, 'CyborgHunter.init( appears before window.CyborgHunterConfig in ' + file);
    });
  }
});

// The entry trial's text is an option of the call that builds it: the
// quickstart shows it on the one-line file's call, the friction section on
// the guard extension's.
describe('the friction entry trial\'s message option is documented', () => {
  it('docs/quickstart.md passes a message to CyborgHunter.frictionEntryTrial()', () => {
    assert.match(read('docs/quickstart.md'), /CyborgHunter\.frictionEntryTrial\(\{\s*message:/);
  });

  it('docs/advanced-integration.md passes a message to the guard extension\'s entry trial', () => {
    assert.match(read('docs/advanced-integration.md'), /jsPsychGuardFriction\.entryTrial\(\{\s*message:/);
  });
});

// The cursor section's numbers are on the report page and their meaning is
// in the docs: the output tree, the columns table, the weights table, the
// signals page and the section the report links to (#cursor-dynamics).
describe('the cursor section is documented', () => {
  it('docs/cli-reference.md lists cursor-limits.json and the cursor columns', () => {
    const text = read('docs/cli-reference.md');
    assert.ok(text.includes('cursor-limits.json'), 'no cursor-limits.json');
    assert.ok(text.includes('cursorCenteredClicks'), 'no cursorCenteredClicks');
  });

  it('docs/configuration.md has the pointer checks weight', () => {
    assert.ok(read('docs/configuration.md').includes('pointer checks'));
  });

  it('docs/signals-reference.md gives the mouse sampling as mouseThrottleMs, not 20Hz', () => {
    assert.ok(!read('docs/signals-reference.md').includes('20Hz'));
  });

  it('docs/interpreting-signals.md has the Cursor dynamics section', () => {
    assert.ok(read('docs/interpreting-signals.md').includes('## Cursor dynamics'));
  });
});
