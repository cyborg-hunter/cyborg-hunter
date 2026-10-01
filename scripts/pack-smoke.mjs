#!/usr/bin/env node
// Pack-install handoff smoke: does the *published artifact* still work?
//
// In-repo everything resolves through the workspace symlink, so `npm test`
// cannot see a tarball that is missing a dependency. This packs the root,
// installs the tarball into a throwaway project, and runs `cyborg-hunter
// report` over the demo fixtures the way a user would. Mirrors the gate in
// .github/workflows/pages.yml. Not part of `npm test` (it hits the network for
// the install); run it with `npm run test:pack-smoke`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const work = mkdtempSync(join(tmpdir(), 'ch-pack-smoke-'));
let ok = false;
try {
  console.log(`[pack-smoke] workspace ${work}`);
  const packed = run('npm', ['pack', '--pack-destination', work], ROOT).trim().split('\n').pop();
  const tarball = join(work, packed);
  console.log(`[pack-smoke] packed ${packed}`);

  run('npm', ['init', '-y'], work);
  run('npm', ['install', tarball, '--no-audit', '--no-fund'], work);
  console.log('[pack-smoke] installed');

  const bin = join(work, 'node_modules', '.bin', 'cyborg-hunter');
  const out = join(work, 'out');
  run('node', [bin, 'report', '--data', join(ROOT, 'tests', 'fixtures', 'demo'), '--output', out], work);

  const index = join(out, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`report produced no index.html (out/: ${existsSync(out) ? readdirSync(out).join(', ') : 'missing'})`);
  }
  console.log(`[pack-smoke] OK — ${index}`);
  ok = true;
} finally {
  if (ok) rmSync(work, { recursive: true, force: true });
  else console.error(`[pack-smoke] FAILED — workspace kept at ${work}`);
}
