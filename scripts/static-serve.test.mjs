// Tests for static-serve.mjs. Run from the skill directory: node --test scripts/static-serve.test.mjs
// Every server here binds 127.0.0.1 on a free port; nothing leaves loopback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createStaticServer, requestSegments, resolveFile, parseHeaderOption, parseArgs, isLoopbackHost } from './static-serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'static-serve.mjs');

function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-static-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Home</title><h1>Home</h1>');
  fs.mkdirSync(path.join(root, 'about'));
  fs.writeFileSync(path.join(root, 'about', 'index.html'), '<h1>About</h1>');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log("app");'.repeat(50));
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=never-served');
  fs.writeFileSync(path.join(root, '.hidden'), 'hidden');
  fs.mkdirSync(path.join(root, '.well-known'));
  fs.writeFileSync(path.join(root, '.well-known', 'security.txt'), 'Contact: none');
  return root;
}

function request(port, pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(options, fn) {
  const server = createStaticServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('requestSegments refuses traversal, encoded separators, dotfiles and environment files', () => {
  assert.deepEqual(requestSegments('/'), []);
  assert.deepEqual(requestSegments('/a/b.html?x=1#y'), ['a', 'b.html']);
  assert.deepEqual(requestSegments('/.well-known/security.txt'), ['.well-known', 'security.txt']);
  for (const bad of ['/../secret', '/a/%2e%2e/b', '/a%2fb', '/a%5cb', '/.env', '/.env.local', '/dir/prod.env', '/.git/config', '/a/.hidden', '/x%00', 'relative', '/C:/x', '/%E0%A4%A']) {
    assert.equal(requestSegments(bad), null, bad);
  }
});

test('resolveFile maps directories to index.html and never follows links', (t) => {
  const root = site();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(path.basename(resolveFile(root, []).file), 'index.html');
  assert.equal(resolveFile(root, ['about']).file, path.join(root, 'about', 'index.html'));
  assert.equal(resolveFile(root, ['missing.html']), null);
  try {
    fs.symlinkSync(path.join(root, 'app.js'), path.join(root, 'link.js'));
  } catch {
    t.skip('symbolic links are not available here');
    return;
  }
  assert.equal(resolveFile(root, ['link.js']), null);
});

test('serves files with types, gzip, etags, HEAD and the guard header', async (t) => {
  const root = site();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await withServer({ root, headers: [['X-Audit-Build', 'disposable-1']] }, async (port) => {
    const home = await request(port, '/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /text\/html/);
    assert.equal(home.headers['x-audit-build'], 'disposable-1');
    assert.match(home.body.toString(), /<h1>Home<\/h1>/);
    const js = await request(port, '/app.js', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(js.headers['content-encoding'], 'gzip');
    assert.match(zlib.gunzipSync(js.body).toString(), /console\.log/);
    const again = await request(port, '/app.js', { headers: { 'if-none-match': js.headers.etag } });
    assert.equal(again.status, 304);
    const head = await request(port, '/about/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal((await request(port, '/.well-known/security.txt')).status, 200);
  });
});

test('refuses writes, environment files, dotfiles and unknown paths; SPA fallback only for routes', async (t) => {
  const root = site();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await withServer({ root }, async (port) => {
    assert.equal((await request(port, '/', { method: 'POST' })).status, 405);
    const env = await request(port, '/.env');
    assert.equal(env.status, 404);
    assert.ok(!env.body.toString().includes('never-served'));
    assert.equal((await request(port, '/.hidden')).status, 404);
    assert.equal((await request(port, '/orders/42')).status, 404);
  });
  await withServer({ root, spa: true }, async (port) => {
    const route = await request(port, '/orders/42');
    assert.equal(route.status, 200);
    assert.match(route.body.toString(), /Home/);
    assert.equal((await request(port, '/missing.js')).status, 404, 'a missing asset is not rewritten');
  });
  fs.writeFileSync(path.join(root, '404.html'), '<h1>Gone</h1>');
  await withServer({ root }, async (port) => {
    const missing = await request(port, '/nope');
    assert.equal(missing.status, 404);
    assert.match(missing.body.toString(), /Gone/);
  });
});

test('parseHeaderOption and parseArgs validate input; non-loopback hosts are refused', () => {
  assert.deepEqual(parseHeaderOption('X-Audit-Build=run-4'), ['X-Audit-Build', 'run-4']);
  for (const bad of ['NoEquals', '=x', 'Set-Cookie=a', 'Content-Type=text/plain', 'X-Bad=\u0001', 'Bad Name=x']) assert.equal(parseHeaderOption(bad), null, bad);
  assert.ok(isLoopbackHost('127.0.0.5'));
  assert.ok(!isLoopbackHost('0.0.0.0'));
  assert.ok(!isLoopbackHost('192.168.1.2'));
  assert.equal(parseArgs(['--root', '.', '--port', '8080', '--host', '0.0.0.0']).refused, true);
  assert.match(parseArgs(['--root', '.']).error, /required/);
  assert.match(parseArgs(['--root', '.', '--port', '99999']).error, /port/);
  assert.equal(parseArgs(['--root', '.', '--port', '0', '--spa', '--header', 'X-A=b']).options.spa, true);
});

test('CLI: listens on loopback, prints the URL, and refuses a wildcard host with exit 2', async (t) => {
  const root = site();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const refused = spawnSync(process.execPath, [SCRIPT, '--root', root, '--port', '0', '--host', '0.0.0.0'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  const child = spawn(process.execPath, [SCRIPT, '--root', root, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const line = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('\n')) resolve(out);
    });
    child.on('exit', (code) => reject(new Error(`exited ${code}`)));
    setTimeout(() => reject(new Error('no output')), 10000);
  });
  const match = /listening on http:\/\/127\.0\.0\.1:(\d+)\//.exec(line);
  assert.ok(match, line);
  assert.equal((await request(Number(match[1]), '/')).status, 200);
});
