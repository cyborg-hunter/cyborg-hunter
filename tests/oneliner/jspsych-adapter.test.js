// The jsPsych host adapter: wraps initJsPsych, adds ch.js's extensions to the
// initJsPsych list (deduped by name), walks the timeline at run() and adds the
// per-trial entries to every trial object, and chains the experiment's
// on_finish to write the final segment. Pure: a stub stands in for jsPsych
// (the jsPsych 7.3.1 behaviour each test relies on is cited next to it).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { dedupeExtensions, isChType, injectExtensions, detectManualMode, installJsPsychAdapter } from '../../src/oneliner/adapters/jspsych.js';
import { OneLinerExtension } from '../../src/oneliner/adapters/jspsych-extension.js';
import { MESSAGES } from '../../src/oneliner/errors.js';

class Mouse { static info = { name: 'mouse-tracking' }; }
class OldCh { static info = { name: 'cyborg-hunter' }; }
const CH = { type: OneLinerExtension };
const names = (list) => list.map((e) => e.type.info.name);

let errors, warns, infos, orig;
beforeEach(() => {
  errors = []; warns = []; infos = [];
  orig = { error: console.error, warn: console.warn, info: console.info };
  console.error = (m) => errors.push(String(m));
  console.warn = (m) => warns.push(String(m));
  console.info = (m) => infos.push(String(m));
});
afterEach(() => {
  console.error = orig.error; console.warn = orig.warn; console.info = orig.info;
  OneLinerExtension.ctx = null;
});

describe('injectExtensions: dedupe rules (a) and (b)', () => {
  it('(a) a trial already listing a CH-type entry gets no second entry', () => {
    const t = { type: 'html', extensions: [{ type: OldCh, params: { trialId: 'x' } }] };
    const r = injectExtensions([t], [CH]);
    assert.equal(t.extensions.length, 1); assert.equal(r.skippedOwnEntry, 1);
    assert.equal(t.extensions[0].params.trialId, 'x', 'the researcher entry and its params are kept');
  });

  it('(b) a trial object referenced twice is injected once (WeakSet)', () => {
    const shared = { type: 'html' };
    const r = injectExtensions([shared, { timeline: [shared] }], [CH]);
    assert.equal(shared.extensions.length, 1); assert.equal(r.sharedObjects, 1); assert.equal(r.trials, 1);
  });

  it('keeps a researcher trial\'s own extensions (mouse-tracking) and appends ours', () => {
    const t = { type: 'kb', extensions: [{ type: Mouse }] };
    injectExtensions([t], [CH, { type: Mouse }]);
    assert.deepStrictEqual(names(t.extensions), ['mouse-tracking', 'cyborg-hunter']);
  });

  it('a non-array extensions value on a trial is left untouched, with a warning', () => {
    const fn = () => [];
    const t = { type: 'kb', extensions: fn };
    const r = injectExtensions([t], [CH]);
    assert.strictEqual(t.extensions, fn);
    assert.equal(r.trials, 0);
    assert.equal(warns.length, 1);
  });

  it('reports the friction entry trial', () => {
    assert.equal(injectExtensions([{ type: 'btn', data: { trial_type_label: 'guard_friction_entry' } }], [CH]).entryTrialFound, true);
    assert.equal(injectExtensions([{ type: 'btn' }], [CH]).entryTrialFound, false);
  });
});

// jsPsych 7.3.1 TimelineNode (:2160-2199): a node with `timeline` copies its
// own keys, minus the timeline-only ones, onto each child with a shallow
// Object.assign; a node without `timeline` is a trial. So only trial objects
// are touched, never wrapped (a wrapper node would shift internal_node_id).
describe('injectExtensions: timeline shapes (D17)', () => {
  it('recurses into nested timelines, timeline_variables, conditional and loop nodes without wrapping', () => {
    const inner = { type: 'kb' };
    const tl = [{ timeline: [{ timeline: [inner] }], timeline_variables: [{ a: 1 }], conditional_function: () => true, loop_function: () => false }];
    injectExtensions(tl, [CH]);
    assert.equal(tl.length, 1, 'no wrapper node'); assert.ok(!('extensions' in tl[0]), 'nodes with a timeline are not touched');
    assert.deepStrictEqual(inner.extensions, [CH]);
  });

  it('timeline_variables + repetitions: the one template trial is injected once', () => {
    const t = { type: 'kb', stimulus: () => 'x' };
    const block = { timeline: [t], timeline_variables: [{ s: 1 }, { s: 2 }, { s: 3 }], repetitions: 3, randomize_order: true };
    const r = injectExtensions([block], [CH]);
    assert.deepStrictEqual(t.extensions, [CH]);
    assert.equal(r.trials, 1);
    assert.deepStrictEqual(Object.keys(block).sort(), ['randomize_order', 'repetitions', 'timeline', 'timeline_variables']);
  });

  it('a conditional node: its trials are injected, the node and its function untouched', () => {
    const cond = () => true;
    const q = { type: 'survey' };
    const node = { timeline: [q], conditional_function: cond };
    injectExtensions([node], [CH]);
    assert.deepStrictEqual(q.extensions, [CH]);
    assert.strictEqual(node.conditional_function, cond);
    assert.ok(!('extensions' in node));
  });

  it('a loop node: its trials are injected, the node and its function untouched', () => {
    const loop = () => false;
    const b = { type: 'btn' };
    const node = { timeline: [b], loop_function: loop };
    injectExtensions([node], [CH]);
    assert.deepStrictEqual(b.extensions, [CH]);
    assert.strictEqual(node.loop_function, loop);
    assert.ok(!('extensions' in node));
  });

  // A child that sets its own `extensions` replaces the parent's outright, so
  // the inherited entries are copied into the child's new list.
  it('a trial inheriting a parent node\'s extensions keeps them', () => {
    const parentExt = [{ type: Mouse }];
    const leaf = { type: 'kb' };
    const node = { timeline: [leaf], extensions: parentExt };
    injectExtensions([node], [CH]);
    assert.deepStrictEqual(names(leaf.extensions), ['mouse-tracking', 'cyborg-hunter']);
    assert.strictEqual(node.extensions, parentExt);
    assert.equal(parentExt.length, 1, 'the parent\'s list is not mutated');
  });

  it('shorthand: children of a node with `type` inherit it and are instrumented', () => {
    const a = { stimulus: 'a' }, b = { stimulus: 'b' };
    const r = injectExtensions([{ type: 'kb', timeline: [a, b] }], [CH]);
    assert.deepStrictEqual(a.extensions, [CH]);
    assert.deepStrictEqual(b.extensions, [CH]);
    assert.equal(r.trials, 2);
  });

  it('a child inheriting a CH entry from its parent counts as (a) and gets no list of its own', () => {
    const leaf = { type: 'kb' };
    const r = injectExtensions([{ timeline: [leaf], extensions: [{ type: OldCh }] }], [CH]);
    assert.ok(!('extensions' in leaf));
    assert.equal(r.skippedOwnEntry, 1);
  });

  it('an object with neither type nor timeline (nor an inherited type) is not a trial', () => {
    const odd = { stimulus: 'x' };
    const r = injectExtensions([odd, null, 3], [CH]);
    assert.ok(!('extensions' in odd));
    assert.equal(r.trials, 0);
  });
});

describe('dedupeExtensions (rule c) and manual mode (D19)', () => {
  it('keeps the first entry per name', () => {
    const out = dedupeExtensions([{ type: OldCh, params: { a: 1 } }, { type: OldCh, params: { a: 2 } }, { type: Mouse }]);
    assert.equal(out.length, 2); assert.equal(out[0].params.a, 1);
  });

  it('tolerates malformed entries (kept as-is)', () => {
    const bad = { params: {} };
    const out = dedupeExtensions([bad, null, { type: Mouse }]);
    assert.deepStrictEqual(out, [bad, null, { type: Mouse }]);
  });

  it('isChType matches by info.name', () => {
    assert.equal(isChType(OldCh), true);
    assert.equal(isChType(OneLinerExtension), true);
    assert.equal(isChType(Mouse), false);
    assert.equal(isChType(undefined), false);
  });

  it('an entry of a CH-named class that is not ours means manual mode; our own class does not', () => {
    assert.equal(detectManualMode({ extensions: [{ type: OldCh }] }), true);
    assert.equal(detectManualMode({ extensions: [{ type: OneLinerExtension }] }), false);
    assert.equal(detectManualMode({}), false);
  });
});

describe('installJsPsychAdapter', () => {
  function fakeWin() {
    const calls = [];
    const win = {
      jsPsychGuardHoneypot: { info: { name: 'guard-honeypot' } },
      jsPsychGuardFriction: { info: { name: 'guard-friction' } },
      initJsPsych: (opts) => {
        calls.push(['init', opts]);
        const inst = {
          opts,
          data: { addProperties: (p) => calls.push(['addProperties', p]), addDataToLastTrial: (d) => calls.push(['last', d, inst]) },
          run: (tl) => { calls.push(['run', tl]); return Promise.resolve('ran'); },
          // jsPsych 7.3.1 simulate() calls this.run() (:2700-2706); run is an
          // own bound property (autoBind, :2648), so the wrapper is reached.
          simulate: (tl) => inst.run(tl)
        };
        return inst;
      }
    };
    return { win, calls };
  }
  function ctx() {
    return {
      participantId: 'P1', config: { guards: { honeypot: true, friction: false }, replay: null, debug: false },
      monitor: { destroy: () => {} },
      segmenter: { finish: () => ({ segment: { segmentIndex: 9, counters: { pasteCount: 1, copyCount: 0, dropCount: 0 }, score: { softScore: 2, anyHardTriggered: false } } }), abandon: () => {}, state: () => ({ open: true }) },
      jspsych: {}
    };
  }

  it('injects our extensions deduped, adds participantId once, chains on_finish and wraps run', async () => {
    const { win, calls } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const userFinish = () => 'user';
    const j = win.initJsPsych({ extensions: [{ type: Mouse }], on_finish: userFinish });
    assert.deepStrictEqual(names(j.opts.extensions), ['mouse-tracking', 'cyborg-hunter', 'guard-honeypot']);
    const props = calls.filter((x) => x[0] === 'addProperties');
    assert.equal(props.length, 1);
    assert.equal(props[0][1].participantId, 'P1'); assert.ok(props[0][1].cyborgHunterVersion);
    assert.strictEqual(OneLinerExtension.ctx, c);
    const trial = { type: 'kb' };
    assert.equal(await j.run([trial]), 'ran');
    assert.ok(trial.extensions.some((e) => e.type === OneLinerExtension)); assert.equal(c.jspsych.instrumented, 1);
    assert.equal(c.jspsych.invoked, true);
    const ret = j.opts.on_finish({});   // the chained hook: ours first, then the researcher's, value preserved
    assert.equal(ret, 'user');
    assert.ok(calls.some((x) => x[0] === 'last' && x[1].integritySegmentFinal && x[1].integritySegmentFinal.segmentIndex === 9));
    assert.ok(calls.some((x) => x[0] === 'addProperties' && x[1].integritySoftScoreFinal === 2 && x[1].integrityPasteCountFinal === 1
      && x[1].integrityAnyHardTriggeredFinal === false && x[1].integrityCopyCountFinal === 0 && x[1].integrityDropCountFinal === 0));
    assert.deepStrictEqual(errors, []);
  });

  it('(c) a researcher-listed copy of our class or a guard is deduped by name', () => {
    const { win } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({ extensions: [{ type: OneLinerExtension, params: { mine: 1 } }, { type: win.jsPsychGuardHoneypot }] });
    assert.deepStrictEqual(names(j.opts.extensions), ['cyborg-hunter', 'guard-honeypot']);
    assert.equal(j.opts.extensions[0].params.mine, 1, 'the first entry per name wins');
    assert.equal(c.host, undefined, 'our own class is not manual mode');
  });

  it('simulate() goes through the wrapped run()', async () => {
    const { win } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({});
    const t = { type: 'kb' };
    await j.simulate([t]);
    assert.deepStrictEqual(names(t.extensions), ['cyborg-hunter', 'guard-honeypot']);
  });

  it('honours a promise returned by the researcher\'s on_finish', () => {
    const { win } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const p = Promise.resolve('saved');
    const j = win.initJsPsych({ on_finish: () => p });
    assert.strictEqual(j.opts.on_finish({}), p);
  });

  it('without a researcher on_finish the chained hook still writes the final segment', () => {
    const { win, calls } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych();
    assert.strictEqual(j.opts.on_finish({}), undefined);
    assert.ok(calls.some((x) => x[0] === 'last' && x[1].integritySegmentFinal));
  });

  it('the final hook runs once: friction stops, then the honeypot attaches, then the monitor is destroyed', () => {
    const { win, calls } = fakeWin(); const c = ctx();
    const order = [];
    c.config.guards.friction = true;
    win.GuardFriction = { stop: (tok) => order.push('friction.stop:' + tok) };
    win.GuardHoneypot = { attachToJsPsychData: () => order.push('honeypot.attach') };
    Object.defineProperty(win, '_guardFrictionToken', { value: 'tok', enumerable: false, configurable: true });
    c.monitor.destroy = () => order.push('destroy');
    c.segmenter.finish = () => { order.push('finish'); return { segment: { segmentIndex: 1, counters: { pasteCount: 0, copyCount: 0, dropCount: 0 }, score: { softScore: 0, anyHardTriggered: false } } }; };
    installJsPsychAdapter({ win, ctx: c });
    let user = 0;
    const j = win.initJsPsych({ on_finish: () => { user++; } });
    j.opts.on_finish({});
    j.opts.on_finish({});
    assert.deepStrictEqual(order, ['finish', 'friction.stop:tok', 'honeypot.attach', 'destroy']);
    assert.equal(calls.filter((x) => x[0] === 'last').length, 1);
    assert.equal(user, 2, 'the researcher\'s hook is always called');
  });

  it('a failing final step writes cyborgHunterError and still calls the researcher\'s hook', () => {
    const { win, calls } = fakeWin(); const c = ctx();
    c.segmenter.finish = () => ({ error: 'segment write failed' });
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({ on_finish: () => 'user' });
    assert.equal(j.opts.on_finish({}), 'user');
    assert.ok(calls.some((x) => x[0] === 'addProperties' && x[1].cyborgHunterError === 'segment write failed'));
    assert.ok(!calls.some((x) => x[0] === 'last'));
  });

  it('a thrown final step is logged from the catalogue and still calls the researcher\'s hook', () => {
    const { win, calls } = fakeWin(); const c = ctx();
    c.segmenter.finish = () => { throw new Error('boom'); };
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({ on_finish: () => 'user' });
    assert.equal(j.opts.on_finish({}), 'user');
    assert.ok(calls.some((x) => x[0] === 'addProperties' && x[1].cyborgHunterError === 'boom'));
    assert.deepStrictEqual(errors, [MESSAGES.sessionEndFailed('boom')]);
  });

  it('manual mode: injects nothing, abandons the boot monitor, logs info', () => {
    const { win } = fakeWin(); const c = ctx(); let abandoned = 0, destroyed = 0;
    c.segmenter.abandon = () => { abandoned++; };
    c.monitor.destroy = () => { destroyed++; };
    installJsPsychAdapter({ win, ctx: c });
    const userFinish = () => {};
    const j = win.initJsPsych({ extensions: [{ type: OldCh }], on_finish: userFinish });
    assert.equal(j.opts.extensions.length, 1); assert.equal(abandoned, 1); assert.equal(destroyed, 1); assert.equal(c.host, 'manual');
    assert.strictEqual(j.opts.on_finish, userFinish, 'manual mode leaves on_finish alone');
    const t = { type: 'kb' };
    j.run([t]);
    assert.ok(!('extensions' in t), 'manual mode leaves the timeline alone');
    assert.equal(infos.length, 1);
    assert.deepStrictEqual(errors, []);
  });

  it('manual mode with a monitor whose destroy throws still hands over quietly', () => {
    const { win } = fakeWin(); const c = ctx();
    c.monitor.destroy = () => { throw new Error('already destroyed'); };
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({ extensions: [{ type: OldCh }] });
    assert.equal(j.opts.extensions.length, 1);
    assert.deepStrictEqual(errors, []);
  });

  it('friction: observeOnly unless the timeline contains the entry trial', async () => {
    const { win } = fakeWin(); const c = ctx(); c.config.guards.friction = true;
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({});
    const fr = j.opts.extensions.find((e) => e.type.info.name === 'guard-friction');
    assert.equal(fr.params.observeOnly, true);
    await j.run([{ type: 'btn', data: { trial_type_label: 'guard_friction_entry' } }]);
    assert.equal(fr.params.observeOnly, false);
  });

  it('friction without an entry trial stays observe-only; friction off injects no friction entry', async () => {
    const { win } = fakeWin(); const c = ctx(); c.config.guards.friction = true;
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({});
    await j.run([{ type: 'kb' }]);
    assert.equal(j.opts.extensions.find((e) => e.type.info.name === 'guard-friction').params.observeOnly, true);

    const w2 = fakeWin(); const c2 = ctx(); c2.config.guards = { honeypot: false, friction: false };
    installJsPsychAdapter({ win: w2.win, ctx: c2 });
    assert.deepStrictEqual(names(w2.win.initJsPsych({}).opts.extensions), ['cyborg-hunter']);
  });

  // GuardFriction.createEntryTrial() starts friction itself (a timer in its
  // on_finish), so friction can be running although data-guards never enabled
  // it and no friction extension was injected.
  it('the final hook stops friction whenever a friction token exists, even with friction not enabled', () => {
    const { win } = fakeWin(); const c = ctx();
    const stopped = [];
    win.GuardFriction = { stop: (tok) => stopped.push(tok) };
    Object.defineProperty(win, '_guardFrictionToken', { value: 'tok', enumerable: false, configurable: true });
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({});
    assert.ok(!names(j.opts.extensions).includes('guard-friction'));
    j.opts.on_finish({});
    assert.deepStrictEqual(stopped, ['tok']);
  });

  it('an entry trial in the timeline with friction not enabled is warned about at run()', async () => {
    const { win } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({});
    await j.run([{ type: 'btn', data: { trial_type_label: 'guard_friction_entry' } }]);
    assert.deepStrictEqual(warns, [MESSAGES.frictionEntryWithoutFriction()]);
  });

  it('no entry-trial warning when friction is enabled, or listed in initJsPsych by the researcher', async () => {
    const entry = () => [{ type: 'btn', data: { trial_type_label: 'guard_friction_entry' } }];
    const a = fakeWin(); const ca = ctx(); ca.config.guards.friction = true;
    installJsPsychAdapter({ win: a.win, ctx: ca });
    await a.win.initJsPsych({}).run(entry());
    const b = fakeWin(); const cb = ctx();
    installJsPsychAdapter({ win: b.win, ctx: cb });
    await b.win.initJsPsych({ extensions: [{ type: b.win.jsPsychGuardFriction }] }).run(entry());
    assert.deepStrictEqual(warns, []);
  });

  // ch.js assumes one jsPsych instance per page (one session, one segmenter).
  it('a second initJsPsych is warned about; each instance\'s final hook writes to that instance', () => {
    const { win, calls } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const first = win.initJsPsych({});
    assert.deepStrictEqual(warns, []);
    const second = win.initJsPsych({});
    assert.deepStrictEqual(warns, [MESSAGES.secondJsPsychInstance()]);
    first.opts.on_finish({});
    const last = calls.filter((x) => x[0] === 'last');
    assert.equal(last.length, 1);
    assert.strictEqual(last[0][2], first, 'the final segment goes to the instance that finished, not the latest one');
    assert.notStrictEqual(first, second);
  });

  it('a timeline walk that throws is logged and jsPsych still runs', async () => {
    const { win, calls } = fakeWin(); const c = ctx();
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({});
    const evil = { type: 'kb' };
    Object.defineProperty(evil, 'extensions', { get() { throw new Error('nope'); } });
    assert.equal(await j.run([evil]), 'ran');
    assert.ok(calls.some((x) => x[0] === 'run'));
    assert.deepStrictEqual(errors, [MESSAGES.instrumentFailed('nope')]);
  });

  it('a hook failure is logged and initJsPsych still returns jsPsych', () => {
    const { win, calls } = fakeWin(); const c = ctx();
    c.config = null;   // forces a failure inside the hook
    installJsPsychAdapter({ win, ctx: c });
    const j = win.initJsPsych({ extensions: [{ type: Mouse }] });
    assert.ok(j && j.opts);
    assert.equal(calls.filter((x) => x[0] === 'init').length, 1);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].startsWith('[cyborg-hunter] '), errors[0]);
    assert.ok(errors[0].endsWith('known-issues.md#one-line-setup'), errors[0]);
  });

  it('restore() puts the original initJsPsych back', () => {
    const { win } = fakeWin(); const c = ctx();
    const original = win.initJsPsych;
    const h = installJsPsychAdapter({ win, ctx: c });
    assert.notStrictEqual(win.initJsPsych, original);
    h.restore();
    assert.strictEqual(win.initJsPsych, original);
  });
});
