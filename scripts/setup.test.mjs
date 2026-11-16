#!/usr/bin/env node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { status, pinnedVersion } from './setup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fakeSkill(installed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uia-setup-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { 'playwright-core': '1.63.0' } }));
  if (installed) {
    fs.mkdirSync(path.join(dir, 'node_modules', 'playwright-core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'playwright-core', 'package.json'), JSON.stringify({ version: installed }));
  }
  return dir;
}

test('the pin comes from the skill package.json', () => {
  assert.match(pinnedVersion(), /^\d+\.\d+\.\d+$/);
});

test('ready only when the installed version equals the pin', () => {
  const missing = fakeSkill(null);
  const other = fakeSkill('1.50.0');
  const same = fakeSkill('1.63.0');
  assert.equal(status(missing).ready, false);
  assert.equal(status(missing).installed, null);
  assert.equal(status(other).ready, false);
  assert.equal(status(same).ready, true);
  for (const d of [missing, other, same]) fs.rmSync(d, { recursive: true, force: true });
});

test('the command refuses unknown arguments', () => {
  const run = spawnSync(process.execPath, [path.join(HERE, 'setup.mjs'), '--force'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
});
