#!/usr/bin/env node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { groupCandidates, sinkOf, DEFAULT_NEAR } from './group-candidates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const record = (fingerprint, file, line) => ({
  fingerprint,
  title: fingerprint,
  trace: [{ kind: 'entrypoint', file: 'src/app/page.tsx', line: 1 }, { kind: 'sink', file, line }],
});

test('the sink is the step marked sink, else the last step', () => {
  assert.deepEqual(sinkOf(record('a/b/c/d', 'src/x.ts', 9)), { file: 'src/x.ts', line: 9 });
  assert.deepEqual(sinkOf({ trace: [{ kind: 'entrypoint', file: 'src\\y.ts', line: 3 }] }), { file: 'src/y.ts', line: 3 });
  assert.equal(sinkOf({ trace: [] }), null);
});

test('candidates with the same sink form one group kept under the first fingerprint', () => {
  const out = groupCandidates([
    record('panel/layout/topbar/b', 'src/styles/shell.ts', 42),
    record('panel/layout/topbar/a', 'src/styles/shell.ts', 42),
    record('menu/cart/cap/c', 'src/lib/cart.ts', 10),
  ]);
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].keep, 'panel/layout/topbar/a');
  assert.equal(out.groups[0].reason, 'same_sink');
  assert.deepEqual(out.groups[0].members.map((m) => m.fingerprint), ['panel/layout/topbar/a', 'panel/layout/topbar/b']);
  assert.equal(out.singles, 1);
});

test('sinks a few lines apart in one file group as near_sink, chained transitively', () => {
  const out = groupCandidates([
    record('x/a/a/a', 'src/hooks/useLive.ts', 57),
    record('x/b/b/b', 'src/hooks/useLive.ts', 59),
    record('x/c/c/c', 'src/hooks/useLive.ts', 66),
    record('x/d/d/d', 'src/hooks/useLive.ts', 200),
  ]);
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].reason, 'near_sink');
  assert.equal(out.groups[0].members.length, 3);
  assert.equal(out.singles, 1);
});

test('the near window is configurable and 0 means the same line only', () => {
  const recs = [record('a/a/a/a', 'src/f.ts', 10), record('b/b/b/b', 'src/f.ts', 12)];
  assert.equal(groupCandidates(recs, 0).groups.length, 0);
  assert.equal(groupCandidates(recs, DEFAULT_NEAR).groups.length, 1);
});

test('records without a sink are listed, never grouped', () => {
  const out = groupCandidates([{ fingerprint: 'a/a/a/a', trace: [] }, record('b/b/b/b', 'src/f.ts', 1)]);
  assert.deepEqual(out.without_sink, ['a/a/a/a']);
  assert.equal(out.groups.length, 0);
});

test('the command reads an object of {record} entries and refuses bad arguments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uia-group-'));
  const file = path.join(dir, 'candidates.json');
  fs.writeFileSync(file, JSON.stringify({ a: { record: record('a/a/a/a', 'src/f.ts', 5) }, b: { record: record('b/b/b/b', 'src/f.ts', 5) } }));
  const ok = spawnSync(process.execPath, [path.join(HERE, 'group-candidates.mjs'), '--candidates', file], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).groups.length, 1);
  const bad = spawnSync(process.execPath, [path.join(HERE, 'group-candidates.mjs'), '--near', 'x'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
