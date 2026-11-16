// Tests for promote.mjs. Run from the skill directory: node --test scripts/promote.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { promoteArtifacts, checkEntryPaths, findInlineCredential, harHasSensitiveHeader, ALLOWED_EXTENSIONS } from './promote.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'promote.mjs');
const require = createRequire(import.meta.url);

function runDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-promote-'));
  const scratch = path.join(root, 'agents', 'h1-orders', 'scratch');
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(scratch, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
  return root;
}

test('the extension allowlist matches the validators', () => {
  const v = require(path.join(HERE, '..', 'validate-findings.cjs'));
  assert.deepEqual([...ALLOWED_EXTENSIONS], [...v.ALLOWED_ARTIFACT_EXTENSIONS]);
});

test('checkEntryPaths enforces safe paths, allowed extensions and forbidden segments', () => {
  assert.equal(checkEntryPaths({ path: 'out/probe/a.png', promote_to: 'probe/a.png' }), null);
  const bad = [
    [{ path: '../x.png', promote_to: 'x.png' }, /under out/],
    [{ path: 'out/a.png', promote_to: '/abs.png' }, /promote_to/],
    [{ path: 'out/a.png', promote_to: 'a\\b.png' }, /promote_to/],
    [{ path: 'out/a.exe', promote_to: 'a.exe' }, /extension/],
    [{ path: 'out/a.png', promote_to: 'a.json' }, /keep the extension/],
    [{ path: 'out/storage/state.json', promote_to: 'state.json' }, /storage and profile/],
    [{ path: 'out/a.json', promote_to: 'Profile/a.json' }, /storage and profile/],
    [{ path: 'out/.env.json', promote_to: 'env.json' }, /environment/],
    [{ path: 'out/a.png', promote_to: 'con.png' }, /promote_to/],
    [{ path: 'out/a.png', promote_to: 'a.png', bytes: -1 }, /bytes/],
  ];
  for (const [entry, reason] of bad) assert.match(checkEntryPaths(entry), reason, JSON.stringify(entry));
});

test('findInlineCredential and harHasSensitiveHeader', () => {
  assert.equal(findInlineCredential({ steps: [{ fill: '#pin', value: { account: 'staff' } }] }), null);
  assert.equal(findInlineCredential({ steps: [{ password: 'hunter2' }] }), 'password');
  assert.equal(findInlineCredential({ cookies: [{ name: 'sid', value: 'abc' }] }), 'cookies');
  assert.equal(findInlineCredential({ metrics: { tokenCount: 3, design_tokens: ['--c'] } }), null);
  assert.equal(harHasSensitiveHeader({ log: { entries: [{ request: { headers: [{ name: 'Accept', value: '*/*' }] }, response: { headers: [] } }] } }), false);
  assert.equal(harHasSensitiveHeader({ log: { entries: [{ request: { headers: [{ name: 'Cookie', value: 'sid=1' }] } }] } }), true);
  assert.equal(harHasSensitiveHeader({ log: { entries: [{ response: { headers: [], cookies: [{ name: 'a', value: 'b' }] } }] } }), true);
});

test('promotes listed files exclusively and drops everything unsafe with a reason', (t) => {
  const root = runDir({
    'out/probe/orders.m390.light.png': Buffer.from([137, 80, 78, 71]),
    'out/probe/orders.m390.light.json': { route: 'orders', ok: true },
    'out/net.har': { log: { entries: [{ request: { headers: [{ name: 'Authorization', value: 'Bearer x' }] } }] } },
    'out/config.json': { steps: [{ password: 'secret-value' }] },
    'out/big.txt': 'x'.repeat(2048),
    'out/sized.txt': 'abc',
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = [
    { path: 'out/probe/orders.m390.light.png', promote_to: 'probe/orders.m390.light.png', bytes: 4, purpose: 'screenshot' },
    { path: 'out/probe/orders.m390.light.json', promote_to: 'probe/orders.m390.light.json' },
    { path: 'out/net.har', promote_to: 'net.har' },
    { path: 'out/config.json', promote_to: 'config.json' },
    { path: 'out/big.txt', promote_to: 'big.txt' },
    { path: 'out/sized.txt', promote_to: 'sized.txt', bytes: 99 },
    { path: 'out/missing.png', promote_to: 'missing.png' },
    { path: 'out/probe/orders.m390.light.png', promote_to: 'probe/orders.m390.light.png' },
  ];
  const report = promoteArtifacts({ runDir: root, agentId: 'h1-orders', entries, maxFileBytes: 1024 });
  assert.deepEqual(report.promoted.map((entry) => entry.owned_path), [
    'agents/h1-orders/artifacts/probe/orders.m390.light.png',
    'agents/h1-orders/artifacts/probe/orders.m390.light.json',
  ]);
  const reasons = Object.fromEntries(report.dropped.map((entry) => [entry.path + '>' + entry.promote_to, entry.reason]));
  assert.match(reasons['out/net.har>net.har'], /cookie, set-cookie or authorization/);
  assert.match(reasons['out/config.json>config.json'], /inline credential/);
  assert.match(reasons['out/big.txt>big.txt'], /larger than 1024/);
  assert.match(reasons['out/sized.txt>sized.txt'], /differs from the reported bytes/);
  assert.match(reasons['out/missing.png>missing.png'], /does not exist/);
  assert.equal(report.dropped.filter((entry) => /same path/.test(entry.reason)).length, 1);
  const again = promoteArtifacts({ runDir: root, agentId: 'h1-orders', entries: entries.slice(0, 1) });
  assert.match(again.dropped[0].reason, /never overwrites/);
});

test('the per-agent byte budget counts what is already promoted', (t) => {
  const root = runDir({ 'out/a.txt': 'a'.repeat(600), 'out/b.txt': 'b'.repeat(600) });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const report = promoteArtifacts({
    runDir: root, agentId: 'h1-orders', maxAgentBytes: 1000,
    entries: [{ path: 'out/a.txt', promote_to: 'a.txt' }, { path: 'out/b.txt', promote_to: 'b.txt' }],
  });
  assert.equal(report.promoted.length, 1);
  assert.match(report.dropped[0].reason, /would pass 1000 bytes/);
});

test('links in the scratch path are refused', (t) => {
  const root = runDir({ 'out/real.txt': 'real' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scratch = path.join(root, 'agents', 'h1-orders', 'scratch');
  try {
    fs.symlinkSync(path.join(scratch, 'out', 'real.txt'), path.join(scratch, 'out', 'link.txt'));
  } catch {
    t.skip('symbolic links are not available here');
    return;
  }
  const report = promoteArtifacts({ runDir: root, agentId: 'h1-orders', entries: [{ path: 'out/link.txt', promote_to: 'link.txt' }] });
  assert.match(report.dropped[0].reason, /symbolic link/);
});

test('CLI: reads scratch/result.json, prints the report, exits 1 when something was dropped', (t) => {
  const root = runDir({
    'out/a.png': Buffer.from([1, 2, 3]),
    'result.json': { artifacts: [{ path: 'out/a.png', promote_to: 'a.png' }, { path: 'out/x.exe', promote_to: 'x.exe' }] },
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [SCRIPT, '--run-dir', root, '--agent', 'h1-orders'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.promoted.length, 1);
  assert.ok(fs.existsSync(path.join(root, 'agents', 'h1-orders', 'artifacts', 'a.png')));
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--run-dir', 'relative', '--agent', 'h1-orders'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--run-dir', root, '--agent', 'CON'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--run-dir', root, '--agent', 'h1-orders', '--result', '.env'], { encoding: 'utf8' }).status, 2);
});

test('validators with --run-dir accept promoted evidence and flag missing files', (t) => {
  const root = runDir({ 'out/a.png': Buffer.from([1]) });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  promoteArtifacts({ runDir: root, agentId: 'h1-orders', entries: [{ path: 'out/a.png', promote_to: 'probe/a.png' }] });
  const findings = require(path.join(HERE, '..', 'validate-findings.cjs'));
  const ledger = require(path.join(HERE, '..', 'validate-coverage-ledger.cjs'));
  assert.equal(findings.artifactExistsUnder(root, 'agents/h1-orders/artifacts/probe/a.png'), true);
  assert.equal(findings.artifactExistsUnder(root, 'agents/h1-orders/artifacts/probe/zzz-missing.json'), false);
  assert.equal(findings.artifactExistsUnder(root, 'agents/h1-orders/artifacts'), false, 'a folder is not evidence');
  assert.equal(ledger.artifactExistsUnder(root, '../escape.png'), false);
});
