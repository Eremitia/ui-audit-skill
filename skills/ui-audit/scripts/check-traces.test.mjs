import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTraces, isEnvironmentFile, makeReader, runCli } from './check-traces.mjs';

const record = (trace, evidence = []) => ({ verdict: 'confirmed', fingerprint: 'a/b/c/d', trace, evidence });

test('checkTraces flags a missing file, a line past the end and an unsafe path, and skips run artifacts', () => {
  const files = { 'src/a.ts': 10 };
  const read = (file) => files[file] ?? null;
  const findings = [
    record(
      [{ kind: 'entrypoint', file: 'src/a.ts', line: 10 }, { kind: 'sink', file: 'src/a.ts', line: 11 }, { kind: 'sink', file: 'src/gone.ts', line: 1 }],
      [{ file: 'agents/v1-x/artifacts/own/shot.png', line: 1 }, { file: '../outside.ts', line: 1 }, { file: 'src/a.ts' },
        { file: 'node_modules/next/dist/x.js', line: 9 }],
    ),
  ];
  const result = checkTraces(findings, read);
  assert.equal(result.checked, 4);
  assert.deepEqual(result.skipped.map((s) => s.pointer), ['/0/evidence/3']);
  assert.deepEqual(result.problems.map((p) => [p.pointer, p.problem.split(' ')[0]]), [
    ['/0/trace/1', 'line'],
    ['/0/trace/2', 'file'],
    ['/0/evidence/1', 'not'],
  ]);
});

test('checkTraces never opens an environment file', () => {
  let opened = false;
  const result = checkTraces([record([{ kind: 'sink', file: 'config/.env.local', line: 1 }])], () => { opened = true; return 1; });
  assert.equal(opened, false);
  assert.match(result.problems[0].problem, /environment file/);
  for (const name of ['.env', 'a/.env.production', '.envrc', 'x/prod.env', '.dev.vars']) assert.ok(isEnvironmentFile(name), name);
  for (const name of ['src/env.ts', 'src/environment.tsx', 'docs/.envelope.md']) assert.ok(!isEnvironmentFile(name), name);
});

test('the reader reads the reviewed commit, not the working tree, and the CLI reports both outcomes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-traces-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git('init', '-q');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'one\ntwo\nthree\n');
    git('add', '.');
    git('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
    const ref = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'one\n');
    assert.equal(makeReader({ target: dir, ref })('src/a.ts'), 3);
    assert.equal(makeReader({ target: dir })('src/a.ts'), 1);

    const findingsPath = path.join(dir, 'findings.json');
    fs.writeFileSync(findingsPath, JSON.stringify([record([{ kind: 'sink', file: 'src/a.ts', line: 3 }])]));
    const pass = runCli(['--findings', findingsPath, '--target', dir, '--ref', ref]);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /^PASS: 1 source locations exist/);
    const fail = runCli(['--findings', findingsPath, '--target', dir]);
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /FAIL: 1 of 1/);
    assert.equal(runCli(['--findings', findingsPath]).status, 2);
    assert.equal(runCli(['--target', dir, '--findings', path.join(dir, '.env')]).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
