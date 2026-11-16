// Tests for ui-probe.mjs. Run from the skill directory: node --test scripts/ui-probe.test.mjs
// No browser is launched unless UI_AUDIT_SMOKE_EXECUTABLE points at a Chromium executable.
// The smoke tests also cover masks, stable screenshots, the env block, back/forward steps
// and an axe run against a stand-in axe-core file (never a real download).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  parseArgs, validateConfig, isLoopbackHost, isLoopbackUrl, resolveRouteUrl, isSafeId, captureStem,
  srgbToLinear, relativeLuminance, compositeRgba, contrastRatio, isLargeText, requiredContrast,
  clsFromShifts, totalBlockingTime, headingSkips, findBadText, summarizeResources, buildPlan,
  chromiumArgs, parseDevToolsUrl, isOutDirAllowed, resolveDriverModule, findInlineSecrets,
  resolveAccountRef, isFocusObscured, flakySchedule, heapTrend, checkStorageState, pageScript,
  defaultDriverPath, driverSearchDirs, SKILL_DRIVER_PATH, browserEnv, CONFIG_SCHEMA, targetGuard, measuredStateChanges,
  ACCEPTED_CONFIG_SCHEMAS, isForbiddenPath, validateAxePath, envKeyFor, canonicalJson, browserMajor, launchArgsHash,
  captureEnv, benchmarkSummary, TOOL_VERSION, CAPTURE_SCHEMA, SUMMARY_SCHEMA, PLAN_SCHEMA,
  inpStatus, isScrolled, PAGE_FUNCTIONS_FOR_TESTS,
} from './ui-probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(HERE, 'ui-probe.mjs');
const ch = (code) => String.fromCharCode(code);

function baseConfig(overrides = {}) {
  return {
    schema: CONFIG_SCHEMA,
    baseUrl: 'http://127.0.0.1:3100',
    target: 'disposable',
    readyMarker: { path: '/login', selector: 'h1', text: 'Audit Ready' },
    themes: ['light', 'dark'],
    viewports: [
      { id: 'm390', width: 390, height: 844, dpr: 3, mobile: true, touch: true },
      { id: 'd1440', width: 1440, height: 900, dpr: 1, mobile: false, touch: false },
    ],
    routes: [
      { id: 'menu', path: '/m/audit-h1', storageState: { session: 'audit-h1/customer' }, steps: [] },
      { id: 'login', path: '/login' },
    ],
    ...overrides,
  };
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [PROBE, ...args], { encoding: 'utf8', timeout: 60000, ...options });
}

// --- loopback rules ---------------------------------------------------------

test('isLoopbackHost accepts localhost, 127/8 and ::1', () => {
  for (const h of ['localhost', '127.0.0.1', '127.0.0.5', '127.255.255.255', '[::1]', '::1']) assert.equal(isLoopbackHost(h), true, h);
});

test('isLoopbackHost rejects wildcard, lookalikes and other hosts', () => {
  for (const h of ['0.0.0.0', 'localhost.evil.com', 'evil-localhost', '127.0.0.1.nip.io', '10.0.0.1', '128.0.0.1', '127.0.0.256', '127.00.0.1', 'localhost.', '', 'LOCALHOST', '[::ffff:7f00:1]', null]) {
    assert.equal(isLoopbackHost(h), false, String(h));
  }
});

test('isLoopbackUrl accepts http(s) loopback origins', () => {
  for (const u of ['http://127.0.0.1:3100', 'https://localhost/', 'http://[::1]:3000/x', 'http://127.0.0.5:8080/a?b=1']) assert.equal(isLoopbackUrl(u), true, u);
});

test('isLoopbackUrl rejects userinfo, other schemes, wildcard and lookalike hosts', () => {
  for (const u of [
    'http://user@127.0.0.1', 'http://user:pw@localhost:3000', 'http://@127.0.0.1/', 'ftp://127.0.0.1/', 'file:///etc/passwd',
    'http://0.0.0.0:3000', 'http://localhost.evil.com', 'https://example.com', 'ws://127.0.0.1', 'javascript:alert(1)',
    'http://127.0.0.1/a b', `http://127.0.0.1/${ch(0x2028)}`, 'not a url',
  ]) assert.equal(isLoopbackUrl(u), false, u);
});

test('resolveRouteUrl keeps paths on the base origin', () => {
  assert.equal(resolveRouteUrl('http://127.0.0.1:3100', '/m/audit-h1?dia=2026-10-11'), 'http://127.0.0.1:3100/m/audit-h1?dia=2026-10-11');
  for (const p of ['//evil.com/x', '/\\evil.com', 'm/audit', 'http://127.0.0.1:3100/x', '', '/a b', `/a${ch(0x200b)}`]) {
    assert.equal(resolveRouteUrl('http://127.0.0.1:3100', p), null, p);
  }
  assert.equal(resolveRouteUrl('https://example.com', '/x'), null);
});

// --- identifiers ------------------------------------------------------------

test('isSafeId enforces lowercase ids and refuses Windows device names', () => {
  for (const id of ['menu', 'h1-menu', 'a_b', '0']) assert.equal(isSafeId(id), true, id);
  for (const id of ['Menu', '-x', '', 'con', 'NUL', 'com1', 'lpt9.txt', 'a/b', 'a.b', 'x'.repeat(65)]) assert.equal(isSafeId(id), false, id);
});

test('captureStem adds the repeat suffix only when repeat > 1', () => {
  assert.equal(captureStem('menu', 'm390', 'dark'), 'menu/m390.dark');
  assert.equal(captureStem('menu', 'm390', 'light', 2, 3), 'menu/m390.light.r2');
  assert.throws(() => captureStem('Menu', 'm390', 'light'));
  assert.throws(() => captureStem('menu', '../x', 'light'));
  assert.throws(() => captureStem('menu', 'm390', 'sepia'));
  assert.throws(() => captureStem('menu', 'm390', 'light', 4, 3));
});

// --- colour math ------------------------------------------------------------

test('srgbToLinear handles both sides of the 0.04045 threshold', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(255), 1);
  assert.ok(Math.abs(srgbToLinear(10) - 10 / 255 / 12.92) < 1e-12);
  assert.ok(Math.abs(srgbToLinear(128) - 0.2158605) < 1e-6);
});

test('contrastRatio matches known WCAG values', () => {
  assert.ok(Math.abs(contrastRatio([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
  const grey = contrastRatio([0x77, 0x77, 0x77], [255, 255, 255]);
  assert.ok(Math.abs(grey - 4.48) < 0.01, String(grey));
  assert.equal(contrastRatio([10, 20, 30], [10, 20, 30]), 1);
  assert.ok(Math.abs(contrastRatio([255, 255, 255], [0x77, 0x77, 0x77]) - grey) < 1e-12);
  assert.ok(Math.abs(relativeLuminance([255, 255, 255]) - 1) < 1e-12);
});

test('compositeRgba and translucent foregrounds', () => {
  const half = compositeRgba([0, 0, 0, 0.5], [255, 255, 255, 1]);
  assert.deepEqual(half.map((v) => Math.round(v * 10) / 10), [127.5, 127.5, 127.5, 1]);
  assert.deepEqual(compositeRgba([0, 0, 0, 0], [0, 0, 0, 0]), [0, 0, 0, 0]);
  const viaAlpha = contrastRatio([0, 0, 0, 0.5], [255, 255, 255, 1]);
  assert.ok(Math.abs(viaAlpha - contrastRatio(half, [255, 255, 255])) < 1e-9);
  const translucentBg = contrastRatio([0, 0, 0], [0, 0, 0, 0]);
  assert.ok(Math.abs(translucentBg - 21) < 1e-9, 'a transparent background is placed on white');
});

test('large-text boundaries and required contrast', () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(23.9, 400), false);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.65, 700), false);
  assert.equal(isLargeText(18.66, 600), false);
  assert.equal(requiredContrast(16, 400), 4.5);
  assert.equal(requiredContrast(19, 700), 3);
  assert.equal(requiredContrast(30, 300), 3);
});

test('large-text weight keywords are normalised like CSS', () => {
  assert.equal(isLargeText(18.66, 'bold'), true);
  assert.equal(isLargeText(18.66, 'BOLDER'), true);
  assert.equal(isLargeText(18.66, 'normal'), false);
  assert.equal(isLargeText(18.66, 'lighter'), false);
  assert.equal(isLargeText(18.66, '700'), true);
  assert.equal(isLargeText(18.66, '600'), false);
  assert.equal(isLargeText(18.66, 'garbage'), false);
  assert.equal(isLargeText(18.66, undefined), false);
  assert.equal(requiredContrast(19, 'bold'), 3);
  assert.equal(requiredContrast(19, 'normal'), 4.5);
});

// --- vitals helpers ---------------------------------------------------------

test('clsFromShifts uses session windows and keeps the largest', () => {
  const r = clsFromShifts([
    { startTime: 0, value: 0.05 }, { startTime: 500, value: 0.05 },
    { startTime: 3000, value: 0.2 },
    { startTime: 3100, value: 0.5, hadRecentInput: true },
  ]);
  assert.ok(Math.abs(r.value - 0.2) < 1e-12);
  assert.equal(r.windowStart, 3000);
});

test('clsFromShifts closes a window after 5 s even with small gaps', () => {
  const shifts = Array.from({ length: 12 }, (_, i) => ({ startTime: i * 900, value: 0.01 }));
  const r = clsFromShifts(shifts);
  assert.ok(Math.abs(r.value - 0.06) < 1e-9, String(r.value));
  assert.equal(clsFromShifts([]).value, 0);
  assert.equal(clsFromShifts(null).windowStart, null);
});

test('totalBlockingTime sums the part of each task over 50 ms', () => {
  assert.equal(totalBlockingTime([30, 50, 51, 120, 250]), 1 + 70 + 200);
  assert.equal(totalBlockingTime([]), 0);
  assert.equal(totalBlockingTime([Number.NaN, 'x', 80]), 30);
});

test('headingSkips reports jumps and accepts numbers or objects', () => {
  assert.deepEqual(headingSkips([1, 2, 3, 2, 3]), []);
  assert.deepEqual(headingSkips([{ level: 1, text: 'Menu' }, { level: 3, text: 'Bebidas' }]), [{ from: 1, to: 3, text: 'Bebidas' }]);
  assert.deepEqual(headingSkips([2]), [{ from: 0, to: 2, text: '' }]);
  assert.deepEqual(headingSkips([1, 9, 2]), []);
});

test('findBadText matches whole-word leaks only', () => {
  const hits = findBadText('Total: $ NaN · Cliente undefined · null · Invalid Date · [object Object]');
  assert.deepEqual(hits.map((h) => h.pattern), ['NaN', 'undefined', 'null', 'Invalid Date', '[object Object]']);
  assert.deepEqual(findBadText('nullable undefinedness NaNa annulled Nullish'), []);
  assert.deepEqual(findBadText(`nullé ${ch(0xf1)}null`), []);
  assert.ok(hits[0].excerpt.includes('NaN'));
  assert.deepEqual(findBadText(''), []);
});

test('summarizeResources classifies scripts, images and fonts', () => {
  const s = summarizeResources([
    { name: 'http://127.0.0.1:3100/_next/static/chunks/a.js', initiatorType: 'script', transferSize: 1000, decodedBodySize: 3000 },
    { name: 'http://127.0.0.1:3100/_next/static/chunks/b.js?v=1', initiatorType: 'link', transferSize: 5000, decodedBodySize: 9000 },
    { name: 'http://127.0.0.1:3100/_next/image?url=%2Fx.jpg&w=640&q=75', initiatorType: 'img', transferSize: 20000, decodedBodySize: 20000 },
    { name: 'http://127.0.0.1:3100/_next/static/media/rubik.woff2', initiatorType: 'css', transferSize: 30000, decodedBodySize: 30000 },
    { name: 'http://127.0.0.1:3100/api/x', initiatorType: 'fetch', transferSize: 10, decodedBodySize: 10 },
  ]);
  assert.equal(s.scriptCount, 2);
  assert.equal(s.scriptTransferBytes, 6000);
  assert.equal(s.scriptDecodedBytes, 12000);
  assert.equal(s.largestScript.transferBytes, 5000);
  assert.equal(s.imageTransferBytes, 20000);
  assert.equal(s.fontCount, 1);
  assert.equal(summarizeResources([]).largestScript, null);
});

// --- config and plan --------------------------------------------------------

test('validateConfig accepts a complete config and fills defaults', () => {
  const dir = tempDir('uiprobe-cfg-');
  const { config, errors } = validateConfig(baseConfig({
    theme: { media: true, storage: { key: 'theme', light: 'light', dark: 'dark' } },
    network: 'slow4g', cpuThrottle: 4, timezone: 'America/Bogota', locale: 'es-CO',
    clock: { now: '2026-10-11T23:58:00-05:00' },
    checks: { focusWalk: true, zoom: 200, axTree: true, heap: true },
    routes: [{
      id: 'menu', path: '/m/audit-h1', storageState: { session: 'audit-h1/customer' },
      waitFor: { selector: 'main', timeoutMs: 10000 },
      steps: [
        { action: 'click', selector: 'button[type=submit]' },
        { action: 'fill', selector: '#nombre', value: 'Ana Pérez' },
        { action: 'fill', selector: '#correo', valueFrom: 'account:audit-h1-owner.login' },
        { action: 'press', key: 'Shift+Tab' },
        { action: 'setNetwork', profile: 'flaky' },
        { action: 'newTab' },
        { action: 'goto', path: '/m/audit-h1', tab: 1 },
        { action: 'evaluate', expression: 'document.title' },
        { action: 'screenshot', name: 'after-submit' },
        { action: 'upload', selector: 'input[type=file]', file: 'files/photo.jpg' },
      ],
      saveStorage: 'customer.json',
    }],
  }), { configDir: dir });
  assert.deepEqual(errors, []);
  assert.equal(config.baseUrl, 'http://127.0.0.1:3100');
  assert.equal(config.repeat, 1);
  assert.equal(config.settleMs, 800);
  assert.equal(config.checks.contrast, true);
  assert.equal(config.checks.zoom, 200);
  assert.equal(config.networkProfiles.flaky.cycleMs, 4000);
  assert.equal(config.usesAccounts, true);
  assert.equal(config.usesSessions, true);
  assert.equal(config.routes[0].steps.at(-1).fileAbs, path.join(dir, 'files', 'photo.jpg'));
});

test('validateConfig refuses non-loopback base URLs and route paths', () => {
  const r1 = validateConfig(baseConfig({ baseUrl: 'https://app.example.com' }));
  assert.equal(r1.config, null);
  assert.ok(r1.errors.some((e) => e.pointer === '/baseUrl' && e.refusal));
  const r2 = validateConfig(baseConfig({ baseUrl: 'http://0.0.0.0:3100' }));
  assert.ok(r2.errors.some((e) => e.pointer === '/baseUrl' && e.refusal));
  const r3 = validateConfig(baseConfig({ routes: [{ id: 'x', path: '//evil.com/' }] }));
  assert.ok(r3.errors.some((e) => e.pointer === '/routes/0/path' && e.refusal));
  const r4 = validateConfig(baseConfig({ routes: [{ id: 'x', path: '/', steps: [{ action: 'goto', path: 'https://wa.me/57300' }] }] }));
  assert.ok(r4.errors.some((e) => e.pointer === '/routes/0/steps/0/path' && e.refusal));
});

test('validateConfig reports unknown keys, bad ranges and duplicates', () => {
  const { errors } = validateConfig(baseConfig({
    extra: 1,
    repeat: 9,
    cpuThrottle: 0.5,
    viewports: [{ id: 'm390', width: 100, height: 844 }, { id: 'm390', width: 390, height: 844 }, { id: 'Bad', width: 390, height: 844 }],
    checks: { zoom: 300, nope: true },
    routes: [{ id: 'a', path: '/' }, { id: 'a', path: '/x' }],
  }));
  const pointers = errors.map((e) => e.pointer);
  for (const p of ['/extra', '/repeat', '/cpuThrottle', '/viewports/0/width', '/viewports/1/id', '/viewports/2/id', '/checks/zoom', '/checks/nope', '/routes/1/id']) {
    assert.ok(pointers.includes(p), `missing ${p} in ${pointers.join(', ')}`);
  }
  assert.ok(errors.every((e) => !e.refusal));
  assert.ok(validateConfig(null).errors.length === 1);
  assert.ok(validateConfig(baseConfig({ schema: 'ui-audit/probe-config@1' })).errors.some((e) => e.pointer === '/schema'));
});

test('validateConfig requires a target and limits running-app-get-only to plain GETs', () => {
  const { target, ...noTarget } = baseConfig();
  assert.equal(target, 'disposable');
  const missing = validateConfig(noTarget);
  assert.ok(missing.errors.some((e) => e.pointer === '/target' && e.refusal));
  const bad = validateConfig(baseConfig({ target: 'production' }));
  assert.ok(bad.errors.some((e) => e.pointer === '/target' && !e.refusal));
  const getOnly = validateConfig(baseConfig({
    target: 'running-app-get-only', readyMarker: null, warmup: true,
    routes: [
      { id: 'menu', path: '/m/x', storageState: { session: 'audit-h1/customer' }, steps: [{ action: 'wait', ms: 10 }], saveStorage: 'a.json' },
      { id: 'login', path: '/login', steps: [] },
    ],
  }));
  const pointers = getOnly.errors.filter((e) => e.refusal).map((e) => e.pointer).sort();
  assert.deepEqual(pointers, ['/routes/0/saveStorage', '/routes/0/steps', '/routes/0/storageState']);
  const plain = validateConfig(baseConfig({ target: 'running-app-get-only', readyMarker: null, warmup: true, routes: [{ id: 'login', path: '/login', steps: [] }] }));
  assert.deepEqual(plain.errors, []);
  assert.equal(plain.config.warmup, false, 'no warm-up request against an app the owner runs');
  assert.equal(targetGuard(plain.config), null);
});

test('validateConfig checks readyMarker and targetGuard demands a proof for disposable targets', () => {
  const ok = validateConfig(baseConfig());
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.readyMarker, { path: '/login', selector: 'h1', text: 'Audit Ready', timeoutMs: 10000 });
  assert.equal(targetGuard(ok.config), null);
  const remote = validateConfig(baseConfig({ readyMarker: { path: '//evil.com/', selector: 'h1' } }));
  assert.ok(remote.errors.some((e) => e.pointer === '/readyMarker/path' && e.refusal));
  const extra = validateConfig(baseConfig({ readyMarker: { path: '/', selector: 'h1', nope: 1 } }));
  assert.ok(extra.errors.some((e) => e.pointer === '/readyMarker/nope'));
  const bare = validateConfig(baseConfig({ readyMarker: null }));
  assert.deepEqual(bare.errors, []);
  assert.match(targetGuard(bare.config), /readyMarker|expect-header/);
  assert.equal(targetGuard(bare.config, { expectHeader: { name: 'x-ui-audit-run', value: 'run-1' } }), null);
  assert.ok(targetGuard(null));
});

test('validateConfig refuses evaluate expressions that read cookies or storage', () => {
  for (const expression of ['document.cookie', 'document . cookie.length', 'JSON.stringify(localStorage)', 'sessionStorage.getItem("t")', 'indexedDB.databases()', 'cookieStore.getAll()']) {
    const { errors } = validateConfig(baseConfig({ routes: [{ id: 'a', path: '/', steps: [{ action: 'evaluate', expression }] }] }));
    assert.ok(errors.some((e) => e.pointer === '/routes/0/steps/0/expression' && e.refusal), expression);
  }
  const fine = validateConfig(baseConfig({ routes: [{ id: 'a', path: '/', steps: [{ action: 'evaluate', expression: 'if (navigator.language !== "es-CO") throw new Error("lang")' }] }] }));
  assert.deepEqual(fine.errors, []);
});

test('validateConfig refuses upload files outside the config directory', () => {
  const dir = tempDir('uiprobe-up-');
  for (const file of ['../secret.jpg', 'a/../../x.png', path.join(dir, 'abs.png'), 'C:/x.png']) {
    const { errors } = validateConfig(baseConfig({ routes: [{ id: 'up', path: '/', steps: [{ action: 'upload', selector: 'input', file }] }] }), { configDir: dir });
    assert.ok(errors.some((e) => e.pointer === '/routes/0/steps/0/file' && e.refusal), file);
  }
});

test('validateConfig checks step shapes', () => {
  const steps = [
    { action: 'teleport' },
    { action: 'click', selector: 'a', tab: 1 },
    { action: 'wait', ms: 20000 },
    { action: 'evaluate', expression: '  ' },
    { action: 'fill', selector: '#a', value: 'x', valueFrom: 'account:k.login' },
    { action: 'fill', selector: '#a', valueFrom: 'k.login' },
    { action: 'press', key: 'Hyper+Q' },
    { action: 'screenshot', name: 'Shot' },
    { action: 'scroll' },
    { action: 'emulateMedia' },
    { action: 'setNetwork', profile: '5g' },
  ];
  const { errors } = validateConfig(baseConfig({ routes: [{ id: 'r', path: '/', steps }] }));
  const pointers = new Set(errors.map((e) => e.pointer));
  for (const p of ['/routes/0/steps/0/action', '/routes/0/steps/1/tab', '/routes/0/steps/2/ms', '/routes/0/steps/3/expression', '/routes/0/steps/4',
    '/routes/0/steps/5/valueFrom', '/routes/0/steps/6/key', '/routes/0/steps/7/name', '/routes/0/steps/8', '/routes/0/steps/9', '/routes/0/steps/10/profile']) {
    assert.ok(pointers.has(p), `missing ${p}`);
  }
});

test('validateConfig rejects bad storage state, saveStorage and clock values', () => {
  const { errors } = validateConfig(baseConfig({
    clock: { now: 'tomorrow' },
    timezone: 'Bogota time',
    locale: 'es_CO',
    routes: [
      { id: 'a', path: '/', storageState: { session: 'Audit/Owner' } },
      { id: 'b', path: '/', storageState: { cookies: [] } },
      { id: 'c', path: '/', saveStorage: '../x.json' },
      { id: 'd', path: '/', saveStorage: 'con.json' },
    ],
  }));
  const pointers = new Set(errors.map((e) => e.pointer));
  for (const p of ['/clock/now', '/timezone', '/locale', '/routes/0/storageState/session', '/routes/1/storageState/cookies', '/routes/2/saveStorage', '/routes/3/saveStorage']) {
    assert.ok(pointers.has(p), `missing ${p}`);
  }
});

test('buildPlan expands routes x viewports x themes x repeats and applies filters', () => {
  const { config } = validateConfig(baseConfig({ repeat: 2 }));
  const all = buildPlan(config, {});
  assert.deepEqual(all.errors, []);
  assert.equal(all.captures.length, 2 * 2 * 2 * 2);
  assert.equal(all.captures[0].stem, 'menu/m390.light.r1');
  assert.equal(all.captures[0].files.json, 'captures/menu/m390.light.r1.json');
  assert.equal(all.captures[0].url, 'http://127.0.0.1:3100/m/audit-h1');
  const narrowed = buildPlan(config, { only: ['login'], viewport: ['d1440'], theme: ['dark'] });
  assert.equal(narrowed.captures.length, 2);
  assert.ok(narrowed.captures.every((c) => c.routeId === 'login' && c.viewportId === 'd1440' && c.theme === 'dark'));
  const bad = buildPlan(config, { only: ['nope'], viewport: ['m320'] });
  assert.equal(bad.captures.length, 0);
  assert.equal(bad.errors.length, 2);
});

// --- secrets, accounts, storage --------------------------------------------

test('findInlineSecrets flags credential keys and literal password fills', () => {
  const found = findInlineSecrets({
    a: { password: 'dummy-123' },
    routes: [{ steps: [{ action: 'fill', selector: 'input[type=password]', value: 'x' }, { action: 'fill', selector: '#pw', valueFrom: 'account:k.password' }] }],
    nested: [{ token: 'abc' }, { Cookie: 'sid=1' }, { secret: ['x'] }],
    notSecrets: [{ sessionToken: 'abc' }, { tokenUrl: 'x' }, { cookies: [{ name: 'x' }] }],
    fine: { password: '', tokenCount: 3 },
  });
  assert.deepEqual(found.sort(), ['/a/password', '/nested/0/token', '/nested/1/Cookie', '/nested/2/secret', '/routes/0/steps/0/value'].sort());
  assert.deepEqual(findInlineSecrets(baseConfig()), []);
});

test('resolveAccountRef resolves fields without exposing other accounts', () => {
  const accounts = [{ account_key: 'audit-h1-owner', tenant_id: 'audit-h1', role: 'owner', login: 'owner+audit-h1@example.invalid', password: 'dummy-pass' }];
  assert.deepEqual(resolveAccountRef('account:audit-h1-owner.login', accounts), { value: 'owner+audit-h1@example.invalid', error: null });
  assert.equal(resolveAccountRef('account:audit-h1-owner.password', accounts).value, 'dummy-pass');
  assert.match(resolveAccountRef('account:missing.login', accounts).error, /unknown account_key/);
  assert.match(resolveAccountRef('account:audit-h1-owner.pin', accounts).error, /no string field/);
  assert.match(resolveAccountRef('audit-h1-owner.login', accounts).error, /malformed/);
  assert.match(resolveAccountRef('account:audit-h1-owner.login', null).error, /--accounts/);
});

test('checkStorageState accepts loopback cookies and origins only', () => {
  assert.deepEqual(checkStorageState({ cookies: [{ name: 's', value: 'v', domain: '127.0.0.1' }, { name: 't', value: 'v', domain: '.localhost' }], origins: [{ origin: 'http://127.0.0.1:3100', localStorage: [] }] }), []);
  const errs = checkStorageState({ cookies: [{ name: 's', value: 'v', domain: '.example.com' }], origins: [{ origin: 'https://example.com' }] });
  assert.equal(errs.length, 2);
  assert.ok(checkStorageState('x').length === 1);
});

// --- browser launch helpers -------------------------------------------------

test('chromiumArgs blocks non-loopback traffic and never removes the loopback bypass', () => {
  const dir = path.resolve(os.tmpdir(), 'uiprobe-profile');
  const args = chromiumArgs({ userDataDir: dir, headless: true });
  assert.ok(args.includes('--proxy-server=http://127.0.0.1:9'));
  assert.ok(args.includes('--proxy-bypass-list=localhost;127.0.0.1;[::1]'));
  assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]'));
  assert.ok(args.includes('--disable-quic'));
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes(`--user-data-dir=${dir}`));
  assert.ok(args.includes('--remote-debugging-port=0'));
  assert.ok(!args.some((a) => a.includes('<-loopback>')));
  assert.ok(!chromiumArgs({ userDataDir: dir, headless: false }).includes('--headless=new'));
  assert.throws(() => chromiumArgs({ userDataDir: 'relative/profile' }));
});

test('parseDevToolsUrl accepts only loopback endpoints', () => {
  assert.equal(parseDevToolsUrl('DevTools listening on ws://127.0.0.1:53211/devtools/browser/abc-123'), 'ws://127.0.0.1:53211/devtools/browser/abc-123');
  assert.equal(parseDevToolsUrl('DevTools listening on ws://10.1.2.3:9222/devtools/browser/x'), null);
  assert.equal(parseDevToolsUrl('[1016/120000.000:ERROR:gpu_init.cc] something'), null);
  assert.equal(parseDevToolsUrl(undefined), null);
});

test('isOutDirAllowed refuses relative paths, previous runs and git trees', () => {
  const root = path.resolve(os.tmpdir(), 'uiprobe-fake');
  const out = path.join(root, 'agents', 'h1-menu', 'scratch', 'out', 'probe');
  const fakeFs = (present, listing = []) => ({ exists: (p) => present.includes(p), readdir: () => listing });
  assert.equal(isOutDirAllowed('scratch/out', fakeFs([])).ok, false);
  assert.deepEqual(isOutDirAllowed(out, fakeFs([])), { ok: true, reason: null });
  assert.match(isOutDirAllowed(out, fakeFs([out], ['summary.json'])).reason, /summary\.json/);
  assert.equal(isOutDirAllowed(out, fakeFs([out], ['captures'])).ok, true);
  const gitTree = fakeFs([path.join(root, '.git')]);
  assert.match(isOutDirAllowed(out, gitTree).reason, /git/);
  assert.equal(isOutDirAllowed(out, { ...gitTree, allowInsideGit: true }).ok, true);
  assert.equal(isOutDirAllowed(path.parse(root).root, fakeFs([])).ok, false);
});

test('resolveDriverModule tries each base directory and never its own location', () => {
  const calls = [];
  const resolve = (name, dir) => {
    calls.push([name, dir]);
    if (dir === '/tools') return `/tools/node_modules/${name}/index.js`;
    throw new Error('not found');
  };
  assert.deepEqual(resolveDriverModule('playwright-core', [null, '/work', '/tools'], { resolve }), { name: 'playwright-core', dir: '/tools', resolved: '/tools/node_modules/playwright-core/index.js' });
  assert.deepEqual(calls, [['playwright-core', '/work'], ['playwright-core', '/tools']]);
  assert.equal(resolveDriverModule('playwright', ['/work'], { resolve }), null);
  assert.equal(resolveDriverModule('playwright', [], { resolve }), null);
});

test('resolveDriverModule rejects a resolution that escaped its base directory', () => {
  const base = path.resolve(os.tmpdir(), 'uiprobe-tools', 'node_modules');
  const resolve = (name) => path.resolve(os.tmpdir(), 'node_modules', name, 'index.js');
  assert.equal(resolveDriverModule('playwright', [base], { resolve }), null);
  assert.equal(resolveDriverModule('playwright', ['relative/dir'], { resolve: () => 'relative/dir/x.js' }), null);
});

test('driverSearchDirs uses only the explicit or default driver path, never the working directory', () => {
  const home = path.resolve(os.tmpdir(), 'uiprobe-home');
  const cwd = path.resolve(os.tmpdir(), 'uiprobe-target-repo');
  const fallback = path.join(home, 'ui-audit-skill', 'tools', 'node_modules');
  assert.equal(defaultDriverPath(home), fallback);
  assert.deepEqual(driverSearchDirs(null, { homedir: home, cwd }), [SKILL_DRIVER_PATH, fallback]);
  assert.deepEqual(driverSearchDirs('', { homedir: home, cwd }), [SKILL_DRIVER_PATH, fallback]);
  assert.equal(SKILL_DRIVER_PATH, path.join(path.dirname(HERE), 'node_modules'));
  const explicit = path.resolve(os.tmpdir(), 'uiprobe-approved', 'node_modules');
  assert.deepEqual(driverSearchDirs(explicit, { homedir: home, cwd }), [explicit]);
  for (const dirs of [driverSearchDirs(null, { homedir: home, cwd }), driverSearchDirs(explicit, { homedir: home, cwd })]) {
    assert.ok(!dirs.includes(cwd));
  }
  // A target that ships playwright as a devDependency is never picked up.
  const resolve = (name, dir) => {
    if (dir === cwd) return path.join(cwd, 'node_modules', name, 'index.js');
    throw new Error('not found');
  };
  assert.equal(resolveDriverModule('playwright', driverSearchDirs(null, { homedir: home, cwd }), { resolve }), null);
});

test('the real resolver never loads playwright from a working directory that ships it', () => {
  const target = tempDir('uiprobe-cwd-');
  const pkg = path.join(target, 'node_modules', 'playwright');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(pkg, 'index.js'), 'module.exports = {};');
  assert.ok(resolveDriverModule('playwright', [target]), 'sanity: the fake package is resolvable when its directory is named');
  assert.equal(resolveDriverModule('playwright', driverSearchDirs(null, { homedir: path.join(target, 'h'), cwd: target, skillDir: path.join(target, 'skill', 'node_modules') })), null);
  assert.equal(resolveDriverModule('playwright', driverSearchDirs('approved', { homedir: path.join(target, 'h'), cwd: target })), null);
});

test('browserEnv passes only allowlisted variables and points home, tmp and caches into scratch', () => {
  const scratch = path.resolve(os.tmpdir(), 'uiprobe-env', 'profile');
  const baseEnv = {
    Path: 'C:\\Windows\\system32', SystemRoot: 'C:\\Windows', windir: 'C:\\Windows',
    DATABASE_URL: 'postgres://secret', GITHUB_TOKEN: 'ghp_x', USERPROFILE: 'D:\\Profiles\\real', HOME: '/srv/real-home',
    LOCALAPPDATA: 'D:\\Profiles\\real\\AppData\\Local', TEMP: 'D:\\Profiles\\real\\Temp', NODE_OPTIONS: '--require x',
  };
  const { env, dirs } = browserEnv({ baseEnv, scratchDir: scratch, platform: 'win32' });
  assert.equal(env.PATH, 'C:\\Windows\\system32');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.windir, 'C:\\Windows');
  for (const k of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(env[k], path.join(scratch, 'tmp'));
  for (const k of ['HOME', 'USERPROFILE']) assert.equal(env[k], path.join(scratch, 'home'));
  assert.equal(env.LOCALAPPDATA, path.join(scratch, 'localappdata'));
  for (const k of ['DATABASE_URL', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'Path']) assert.ok(!(k in env), k);
  for (const value of Object.values(env)) {
    assert.ok(!value.includes('real') && !value.includes('secret'), value);
  }
  for (const d of dirs) assert.ok(path.relative(scratch, d) && !path.relative(scratch, d).startsWith('..'));
  const posix = browserEnv({ baseEnv: { PATH: '/usr/bin', SystemRoot: 'x', AWS_SECRET_ACCESS_KEY: 'y' }, scratchDir: scratch, platform: 'linux' }).env;
  assert.equal(posix.PATH, '/usr/bin');
  assert.ok(!('SystemRoot' in posix) && !('AWS_SECRET_ACCESS_KEY' in posix));
  assert.throws(() => browserEnv({ baseEnv, scratchDir: 'relative' }));
});

test('resolveDriverModule with the real resolver finds nothing in an empty directory', () => {
  const dir = tempDir('uiprobe-drv-');
  assert.equal(resolveDriverModule('playwright-core', [dir]), null);
});

// --- geometry, schedules, trends -------------------------------------------

test('isFocusObscured needs full coverage by the union of covers', () => {
  const focus = { x: 0, y: 100, width: 100, height: 40 };
  assert.equal(isFocusObscured(focus, [{ x: 0, y: 90, width: 400, height: 60 }]), true);
  assert.equal(isFocusObscured(focus, [{ x: 0, y: 90, width: 60, height: 60 }, { x: 50, y: 95, width: 60, height: 60 }]), true);
  assert.equal(isFocusObscured(focus, [{ x: 0, y: 120, width: 400, height: 60 }]), false);
  assert.equal(isFocusObscured(focus, [{ x: 0, y: 90, width: 60, height: 60 }, { x: 70, y: 90, width: 60, height: 60 }]), false);
  assert.equal(isFocusObscured({ x: 0, y: 0, width: 0, height: 10 }, [{ x: 0, y: 0, width: 50, height: 50 }]), false);
  assert.equal(isFocusObscured(focus, []), false);
});

test('flakySchedule is online first, then offline, per cycle', () => {
  const p = { cycleMs: 4000, offlineMs: 1500 };
  assert.deepEqual(flakySchedule(p, 0), { offline: false, msUntilChange: 2500 });
  assert.deepEqual(flakySchedule(p, 2600), { offline: true, msUntilChange: 1400 });
  assert.deepEqual(flakySchedule(p, 4000), { offline: false, msUntilChange: 2500 });
  assert.deepEqual(flakySchedule(p, 7999), { offline: true, msUntilChange: 1 });
  assert.throws(() => flakySchedule({ cycleMs: 1000, offlineMs: 1000 }, 0));
});

test('measuredStateChanges lists every way the measured state left the declared context', () => {
  const media = { colorScheme: 'light', reducedMotion: false, forcedColors: null, prefersContrast: null, hover: null };
  const same = { initialUrl: 'http://localhost:3100/panel', url: 'http://localhost:3100/panel', initialMedia: media, media: { ...media },
    initialNetwork: 'slow4g', network: 'slow4g', initialMetrics: { width: 390, height: 844 }, metrics: { width: 390, height: 844 },
    steps: [{ action: 'scroll', y: 400 }, { action: 'screenshot', name: 'x' }] };
  assert.deepEqual(measuredStateChanges(same), []);
  const moved = { ...same, url: 'http://localhost:3100/login', media: { ...media, colorScheme: 'dark' }, network: 'offline',
    metrics: { width: 844, height: 390 }, steps: [{ action: 'clearCookies' }, { action: 'click', selector: 'button' }] };
  assert.deepEqual(measuredStateChanges(moved), ['url', 'media.colorScheme', 'network', 'viewport', 'cookies', 'interaction']);
  assert.deepEqual(measuredStateChanges(), []);
});

test('heapTrend detects monotonic growth', () => {
  const growing = Array.from({ length: 10 }, (_, i) => ({ atMs: i * 6000, jsHeapUsedBytes: 1e6 + i * 1000, domNodes: 500 + i }));
  const t = heapTrend(growing);
  assert.equal(t.samples, 10);
  assert.equal(t.sufficient, true);
  assert.equal(t.heapMonotonic, true);
  assert.equal(t.domMonotonic, true);
  assert.equal(t.heapGrowthBytes, 9000);
  assert.ok(Math.abs(t.heapSlopeBytesPerMin - 10000) < 1e-6);
  const flat = heapTrend([{ atMs: 0, jsHeapUsedBytes: 5, domNodes: 10 }, { atMs: 1, jsHeapUsedBytes: 7, domNodes: 9 }, { atMs: 2, jsHeapUsedBytes: 6, domNodes: 10 }]);
  assert.equal(flat.heapMonotonic, false);
  assert.equal(flat.domMonotonic, false);
  assert.equal(heapTrend([]).heapSlopeBytesPerMin, null);
});

// --- page scripts -----------------------------------------------------------

// A fake page: a mobile layout viewport 900 px wide whose 390 px visual viewport is panned, as
// Chromium does for a page that overflows horizontally under mobile emulation.
function fakePage({ rect, visual, hitIsTarget = true, cover = null }) {
  const target = { tagName: 'BUTTON', id: 'open', localName: 'button', classList: [], getAttribute: () => null, scrollIntoView() {}, getBoundingClientRect: () => rect, contains: (n) => n === target, parentElement: null, nodeType: 1 };
  const other = cover || { tagName: 'DIV', id: 'overlay', localName: 'div', classList: [], getAttribute: () => null, parentElement: null, nodeType: 1, contains: () => false };
  const document = { querySelector: () => target, elementFromPoint: () => (hitIsTarget ? target : other), documentElement: { appendChild() {} }, createElement: () => ({ setAttribute() {}, style: {}, scrollIntoView() {}, remove() {} }) };
  const window = { innerWidth: 900, innerHeight: 1948, scrollX: 0, scrollY: 0, visualViewport: visual, scrollTo() {} };
  return { document, window, CSS: { escape: (s) => s } };
}

test('__elementCenter converts layout coordinates to the panned visual viewport and hit-tests', () => {
  const rect = { left: 760, top: 1300, width: 100, height: 40 };
  const ctx = fakePage({ rect, visual: { offsetLeft: 615, offsetTop: 898, scale: 1, width: 390, height: 844 } });
  const pt = vm.runInNewContext(pageScript(PAGE_FUNCTIONS_FOR_TESTS.__elementCenter, '#open'), ctx);
  assert.equal(pt.x, 810 - 615);
  assert.equal(pt.y, 1320 - 898);
  assert.equal(pt.hit, true);
  assert.equal(pt.inView, true);
  const zoomed = vm.runInNewContext(pageScript(PAGE_FUNCTIONS_FOR_TESTS.__elementCenter, '#open'), fakePage({ rect, visual: { offsetLeft: 600, offsetTop: 900, scale: 2, width: 195, height: 422 } }));
  assert.deepEqual([zoomed.x, zoomed.y], [(810 - 600) * 2, (1320 - 900) * 2]);
  const covered = vm.runInNewContext(pageScript(PAGE_FUNCTIONS_FOR_TESTS.__elementCenter, '#open'), fakePage({ rect, visual: { offsetLeft: 615, offsetTop: 898, scale: 1, width: 390, height: 844 }, hitIsTarget: false }));
  assert.equal(covered.hit, false);
  assert.ok(covered.covering && covered.covering.includes('overlay'), JSON.stringify(covered));
  const offscreen = vm.runInNewContext(pageScript(PAGE_FUNCTIONS_FOR_TESTS.__elementCenter, '#open'), fakePage({ rect, visual: { offsetLeft: 0, offsetTop: 0, scale: 1, width: 390, height: 844 } }));
  assert.equal(offscreen.inView, false, 'the unshifted layout point would land outside the visual viewport');
});

test('isScrolled ignores sub-pixel rests; measuredStateChanges reports a kept scroll', () => {
  assert.equal(isScrolled({ x: 0, y: 0, visualLeft: 1, visualTop: 0 }), false);
  assert.equal(isScrolled({ x: 0, y: 0, visualLeft: 263, visualTop: 0 }), true);
  assert.equal(isScrolled(null), false);
  assert.deepEqual(measuredStateChanges({ steps: [{ action: 'scroll', y: 400 }], scroll: { x: 0, y: 400, visualLeft: 0, visualTop: 0 } }), ['scroll']);
  assert.deepEqual(measuredStateChanges({ steps: [{ action: 'click', selector: 'b' }], scroll: { x: 0, y: 0, visualLeft: 0, visualTop: 0 } }), ['interaction']);
});

test('inpStatus tells no interaction from interactions below the 16 ms threshold', () => {
  assert.deepEqual(inpStatus({ interactions: [40, 24], interactionCount: 2 }, []), { inpStatus: 'measured', interactionCount: 2 });
  assert.deepEqual(inpStatus({ interactions: [], interactionCount: 1 }, [{ action: 'click' }]), { inpStatus: 'below_threshold', interactionCount: 1 });
  assert.deepEqual(inpStatus({ interactions: [], interactionCount: null }, [{ action: 'press', key: 'Tab' }]), { inpStatus: 'below_threshold', interactionCount: 1 });
  assert.deepEqual(inpStatus({ interactions: [], interactionCount: 0 }, [{ action: 'scroll', y: 10 }]), { inpStatus: 'no_interaction', interactionCount: 0 });
});

test('pageScript serialises helpers that work outside the module', () => {
  const src = pageScript(function probe(arg) { return { ratio: contrastRatio([0, 0, 0], [255, 255, 255]), bad: findBadText(arg).length, skips: headingSkips([1, 3]).length }; }, 'x undefined y');
  const result = vm.runInNewContext(src, {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ratio: 21, bad: 1, skips: 1 });
});

// --- argument parsing and CLI ----------------------------------------------

test('parseArgs reads flags, lists and booleans', () => {
  const { options, errors } = parseArgs(['--config', 'c.json', '--out=/tmp/x', '--only', 'menu,login', '--theme', 'dark', '--plan', '--driver', 'cdp']);
  assert.deepEqual(errors, []);
  assert.equal(options.config, 'c.json');
  assert.equal(options.out, '/tmp/x');
  assert.deepEqual(options.only, ['menu', 'login']);
  assert.deepEqual(options.theme, ['dark']);
  assert.equal(options.plan, true);
  assert.equal(options.driver, 'cdp');
});

test('parseArgs reports usage errors', () => {
  assert.ok(parseArgs([]).errors.some((e) => /--config/.test(e)));
  assert.ok(parseArgs(['--config', 'c.json']).errors.some((e) => /--out/.test(e)));
  assert.ok(parseArgs(['--config', 'c', '--out', '/x', '--bogus']).errors.some((e) => /unknown/.test(e)));
  assert.ok(parseArgs(['--config']).errors.some((e) => /needs a value/.test(e)));
  assert.ok(parseArgs(['--config', 'a', '--config', 'b', '--plan']).errors.some((e) => /more than once/.test(e)));
  assert.ok(parseArgs(['--config', 'a', '--plan', '--driver', 'selenium']).errors.some((e) => /--driver/.test(e)));
  assert.ok(parseArgs(['--config', 'a', '--plan', '--only', 'a,,b']).errors.some((e) => /empty/.test(e)));
  assert.ok(parseArgs(['--config', 'a', '--plan', '--theme', 'sepia']).errors.some((e) => /--theme/.test(e)));
  for (const bad of ['novalue', '=x', 'x=', 'bad name=x', `x=a${ch(10)}b`]) {
    assert.ok(parseArgs(['--config', 'a', '--plan', '--expect-header', bad]).errors.some((e) => /--expect-header/.test(e)), bad);
  }
  assert.deepEqual(parseArgs(['--config', 'a', '--plan', '--expect-header=X-UI-Audit-Run=run-1=b']).options.expectHeader, { name: 'x-ui-audit-run', value: 'run-1=b' });
  assert.deepEqual(parseArgs(['--help']).errors, []);
});

test('importing the module does not run the CLI', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./ui-probe.mjs', import.meta.url).href)}); console.log('imported');`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'imported');
});

test('CLI: --help exits 0 and missing arguments exit 1', () => {
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Exit codes/);
  const bad = runCli([]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--config is required/);
});

test('CLI: --plan prints the plan without writing anything', () => {
  const dir = tempDir('uiprobe-plan-');
  const cfg = path.join(dir, 'probe.json');
  fs.writeFileSync(cfg, JSON.stringify(baseConfig()));
  const out = path.join(dir, 'never-created');
  const r = runCli(['--config', cfg, '--plan', '--out', out, '--viewport', 'm390']);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.schema, 'ui-audit/probe-plan@3');
  assert.equal(plan.captures.length, 4);
  assert.equal(fs.existsSync(out), false);
});

test('CLI: --plan lists the v3 options (stable shots, emulation, benchmark, axe, masks)', () => {
  const dir = tempDir('uiprobe-plan3-');
  const cfg = path.join(dir, 'probe.json');
  fs.writeFileSync(cfg, JSON.stringify(baseConfig({
    repeat: 2, stableShots: { maxAttempts: 5, intervalMs: 0 }, emulation: { safeAreaInsets: { top: 47, bottom: 34, left: 0, right: 0 } },
    checks: { axe: true },
    routes: [{ id: 'home', path: '/', mask: ['.clock', '#ad'] }, { id: 'login', path: '/login' }],
  })));
  const r = runCli(['--config', cfg, '--plan']);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.toolVersion, '3.0.0');
  assert.deepEqual(plan.stableShots, { maxAttempts: 5, intervalMs: 0 });
  assert.deepEqual(plan.emulation, { safeAreaInsets: { top: 47, bottom: 34, left: 0, right: 0 }, smallViewportHeightDifference: null, virtualKeyboardHeight: null });
  assert.equal(plan.benchmark, true, 'vitals on and repeat 2 turn the benchmark on');
  assert.equal(plan.checks.axe, true);
  assert.equal(plan.axe.enabled, true);
  assert.equal(plan.axe.path, null);
  assert.match(plan.axe.reason, /--axe/);
  assert.deepEqual(plan.captures.find((c) => c.routeId === 'home').mask, ['.clock', '#ad']);
  assert.deepEqual(plan.captures.find((c) => c.routeId === 'login').mask, []);
  const axeDir = path.join(dir, 'node_modules', 'axe-core');
  fs.mkdirSync(axeDir, { recursive: true });
  fs.writeFileSync(path.join(axeDir, 'axe.min.js'), 'window.axe = {};');
  const withAxe = JSON.parse(runCli(['--config', cfg, '--plan', '--axe', path.join(axeDir, 'axe.min.js')]).stdout);
  assert.deepEqual(withAxe.axe, { enabled: true, path: path.join(axeDir, 'axe.min.js'), usable: true, reason: null });
  const badAxe = JSON.parse(runCli(['--config', cfg, '--plan', '--axe', path.join(dir, 'axe.min.js')]).stdout);
  assert.equal(badAxe.axe.usable, false);
  assert.match(badAxe.axe.reason, /axe-core folder/);
});

test('probe-config.example.json is valid @3, generic, secret-free and plans cleanly', () => {
  const file = path.join(HERE, 'probe-config.example.json');
  const text = fs.readFileSync(file, 'utf8');
  const raw = JSON.parse(text);
  assert.equal(raw.schema, 'ui-audit/probe-config@3');
  assert.ok(!text.toLowerCase().includes(['mi', 'cancha'].join('')), 'the example uses the fictional demo-store app');
  assert.match(raw.$comment, /demo-store/);
  assert.deepEqual(findInlineSecrets(raw), []);
  const { config, errors } = validateConfig(raw, { configDir: HERE });
  assert.deepEqual(errors, []);
  assert.equal(config.baseUrl, 'http://127.0.0.1:4173');
  assert.equal(config.timezone, 'America/New_York');
  assert.equal(config.locale, 'en-US');
  assert.deepEqual(config.viewports.map((v) => v.id), ['m320', 'd1440']);
  assert.deepEqual(config.themes, ['light', 'dark']);
  assert.equal(config.theme.media, true);
  assert.ok(config.theme.storage && config.theme.storage.key);
  assert.equal(config.network, 'slow4g');
  assert.equal(config.cpuThrottle, 4);
  assert.equal(config.warmup, true);
  assert.equal(config.repeat, 3);
  assert.equal(config.benchmark, true);
  assert.deepEqual(config.stableShots, { maxAttempts: 3, intervalMs: 150 });
  assert.deepEqual(config.emulation, { safeAreaInsets: null, smallViewportHeightDifference: null, virtualKeyboardHeight: null });
  assert.ok(config.clock.now);
  for (const k of ['overflow', 'contrast', 'tapTargets', 'vitals', 'structure', 'resources', 'focusWalk', 'axe']) assert.equal(config.checks[k], true, k);
  assert.equal(config.checks.zoom, 200);
  assert.ok(config.usesSessions && config.usesAccounts);
  assert.deepEqual(config.routes.find((r) => r.id === 'home').mask, ['[data-testid=promo-countdown]', '.hero-carousel']);
  // The read-only routes use a saved session and only non-mutating steps. Context-changing steps
  // live in their own route, because checks are taken on the state the last step leaves.
  const readOnly = config.routes.filter((r) => r.storageState && r.storageState.session === 'audit-store/customer');
  assert.deepEqual(readOnly.map((r) => r.id), ['cart-customer', 'cart-customer-stress']);
  const readOnlyActions = new Set(['waitFor', 'wait', 'screenshot', 'evaluate', 'emulateMedia', 'setNetwork', 'newTab', 'clearCookies', 'goto', 'scroll', 'back', 'forward']);
  for (const r of readOnly) {
    assert.equal(r.saveStorage, null);
    for (const s of r.steps) assert.ok(readOnlyActions.has(s.action), s.action);
  }
  const contextChanging = new Set(['emulateMedia', 'setNetwork', 'clearCookies', 'goto', 'rotate', 'back', 'forward']);
  assert.ok(readOnly[0].steps.every((s) => !contextChanging.has(s.action)), 'cart-customer keeps its declared context');
  for (const a of ['waitFor', 'screenshot', 'evaluate']) assert.ok(readOnly[0].steps.some((s) => s.action === a), a);
  for (const a of ['emulateMedia', 'setNetwork', 'newTab', 'clearCookies', 'back', 'forward']) assert.ok(readOnly[1].steps.some((s) => s.action === a), a);
  // The fixtures-only route is the only one that types credentials or saves storage.
  const fixturesOnly = config.routes.filter((r) => r.saveStorage || r.steps.some((s) => s.valueFrom));
  assert.equal(fixturesOnly.length, 1);
  assert.ok(fixturesOnly[0].saveStorage);
  assert.ok(fixturesOnly[0].steps.some((s) => s.valueFrom === 'account:audit-store-customer.password'));
  const plan = buildPlan(config, {});
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.captures.length, config.routes.length * config.viewports.length * config.themes.length * config.repeat);
  const r = runCli(['--config', file, '--plan']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).captures.length, plan.captures.length);
});

test('CLI: refusals exit 2 (non-loopback, inline secret, relative --out, previous run)', () => {
  const dir = tempDir('uiprobe-ref-');
  const write = (name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
  const remote = write('remote.json', baseConfig({ baseUrl: 'https://app.example.com' }));
  assert.equal(runCli(['--config', remote, '--plan']).status, 2);
  const secret = write('secret.json', { ...baseConfig(), routes: [{ id: 'l', path: '/login', steps: [{ action: 'fill', selector: '#password', value: 'hunter2' }] }] });
  const rs = runCli(['--config', secret, '--plan']);
  assert.equal(rs.status, 2);
  assert.ok(!rs.stderr.includes('hunter2'));
  const ok = write('ok.json', baseConfig());
  assert.equal(runCli(['--config', ok, '--out', 'relative/out']).status, 2);
  const used = path.join(dir, 'used');
  fs.mkdirSync(used);
  fs.writeFileSync(path.join(used, 'summary.json'), '{}');
  const rp = runCli(['--config', ok, '--out', used]);
  assert.equal(rp.status, 2);
  assert.match(rp.stderr, /summary\.json/);
});

test('CLI: config errors exit 1 and quote no control characters', () => {
  const dir = tempDir('uiprobe-err-');
  const p = path.join(dir, 'bad.json');
  fs.writeFileSync(p, JSON.stringify({ ...baseConfig(), [`x${ch(7)}y`]: 1 }));
  const r = runCli(['--config', p, '--plan']);
  assert.equal(r.status, 1);
  assert.ok(!r.stderr.includes(ch(7)));
  fs.writeFileSync(p, '{not json');
  assert.equal(runCli(['--config', p, '--plan']).status, 1);
});

test('CLI: an unknown key that merely contains "token" is a config error (exit 1), not a refusal', () => {
  const dir = tempDir('uiprobe-tok-');
  const p = path.join(dir, 'probe.json');
  fs.writeFileSync(p, JSON.stringify({ ...baseConfig(), tokenUrl: 'x' }));
  const r = runCli(['--config', p, '--plan']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /tokenUrl: unknown key/);
  fs.writeFileSync(p, JSON.stringify({ ...baseConfig(), token: 'x' }));
  assert.equal(runCli(['--config', p, '--plan']).status, 2);
});

test('CLI: target guard refusals exit 2 before anything is written', async () => {
  const dir = tempDir('uiprobe-guard-');
  const write = (name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
  const { target, ...rest } = baseConfig();
  assert.equal(target, 'disposable');
  const noTarget = write('none.json', rest);
  assert.equal(runCli(['--config', noTarget, '--plan']).status, 2);
  const noProof = write('noproof.json', baseConfig({ readyMarker: null }));
  const r1 = runCli(['--config', noProof, '--plan']);
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /readyMarker|expect-header/);
  const steps = write('getonly.json', baseConfig({ target: 'running-app-get-only', readyMarker: null, routes: [{ id: 'l', path: '/login', steps: [{ action: 'click', selector: 'button' }] }] }));
  assert.equal(runCli(['--config', steps, '--plan']).status, 2);
  // --expect-header is checked with one GET before the browser starts or --out is created.
  let hits = 0;
  const server = http.createServer((req, res) => { hits += 1; res.writeHead(200, { 'x-ui-audit-run': 'other' }); res.end('ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const cfg = write('hdr.json', baseConfig({ baseUrl: `http://127.0.0.1:${server.address().port}`, readyMarker: null, routes: [{ id: 'login', path: '/login' }] }));
    const out = path.join(dir, 'out');
    const child = spawn(process.execPath, [PROBE, '--config', cfg, '--out', out, '--driver', 'cdp', '--executable', path.join(dir, 'no-browser.exe'), '--expect-header', 'x-ui-audit-run=run-1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise((r) => child.on('exit', r));
    assert.equal(code, 2, stderr);
    assert.match(stderr, /not the disposable build/);
    assert.equal(hits, 1);
    assert.equal(fs.existsSync(out), false);
  } finally {
    server.close();
  }
});

test('CLI: an explicitly requested driver that is not installed exits 3', () => {
  const dir = tempDir('uiprobe-drv3-');
  const cfg = path.join(dir, 'probe.json');
  fs.writeFileSync(cfg, JSON.stringify(baseConfig({ warmup: false, routes: [{ id: 'login', path: '/login' }] })));
  const out = path.join(dir, 'out');
  const r = runCli(['--config', cfg, '--out', out, '--driver', 'playwright-core', '--driver-path', dir], { cwd: dir });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /not installed/);
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
  assert.equal(summary.exit, 3);
  assert.deepEqual(summary.captures, []);
});

// --- v3: versions, environment files, config keys -------------------------

test('versions: tool 3.0.0, every schema @3, configs @2 and @3 accepted', () => {
  assert.equal(TOOL_VERSION, '3.0.0');
  assert.equal(CONFIG_SCHEMA, 'ui-audit/probe-config@3');
  for (const s of [CAPTURE_SCHEMA, SUMMARY_SCHEMA, PLAN_SCHEMA]) assert.match(s, /@3$/);
  assert.deepEqual([...ACCEPTED_CONFIG_SCHEMAS], ['ui-audit/probe-config@2', 'ui-audit/probe-config@3']);
  for (const schema of ACCEPTED_CONFIG_SCHEMAS) {
    const { errors, config } = validateConfig(baseConfig({ schema, stableShots: { maxAttempts: 2, intervalMs: 0 }, checks: { axe: true }, benchmark: false }));
    assert.deepEqual(errors, [], schema);
    assert.equal(config.checks.axe, true);
  }
  assert.ok(validateConfig(baseConfig({ schema: 'ui-audit/probe-config@4' })).errors.some((e) => e.pointer === '/schema'));
});

test('isForbiddenPath matches every environment-file name and nothing else', () => {
  for (const p of ['.env', '.env.local', '.env.example', '.env-local', '.env_prod', '.envrc', 'production.env', 'app.env', '.dev.vars',
    'app/.env', 'C:\\repo\\web\\.env.production', '/srv/app/.ENV', 'config/.env.d/x.json']) {
    assert.equal(isForbiddenPath(p), true, p);
  }
  for (const p of ['environment.ts', 'envelope.svg', '.envoy.yaml', 'dotenv.md', 'src/env/index.ts', 'env', '', null, 'probe.json']) {
    assert.equal(isForbiddenPath(p), false, String(p));
  }
});

test('validateConfig: defaults for stableShots, emulation and benchmark', () => {
  const one = validateConfig(baseConfig()).config;
  assert.deepEqual(one.stableShots, { maxAttempts: 3, intervalMs: 150 });
  assert.deepEqual(one.emulation, { safeAreaInsets: null, smallViewportHeightDifference: null, virtualKeyboardHeight: null });
  assert.equal(one.checks.axe, false);
  assert.equal(one.benchmark, false, 'repeat 1: no benchmark by default');
  assert.equal(validateConfig(baseConfig({ repeat: 3 })).config.benchmark, true);
  assert.equal(validateConfig(baseConfig({ repeat: 3, checks: { vitals: false } })).config.benchmark, false);
  assert.equal(validateConfig(baseConfig({ repeat: 1, benchmark: true })).config.benchmark, true);
  assert.deepEqual(one.routes[1].mask, []);
  const full = validateConfig(baseConfig({ emulation: { safeAreaInsets: { top: 47, bottom: 34, left: 0, right: 0 }, smallViewportHeightDifference: 56, virtualKeyboardHeight: 300 } })).config;
  assert.deepEqual(full.emulation, { safeAreaInsets: { top: 47, bottom: 34, left: 0, right: 0 }, smallViewportHeightDifference: 56, virtualKeyboardHeight: 300 });
});

test('validateConfig rejects bad stableShots, mask, emulation and benchmark shapes', () => {
  const cases = [
    [{ stableShots: { maxAttempts: 0 } }, '/stableShots/maxAttempts'],
    [{ stableShots: { maxAttempts: 11 } }, '/stableShots/maxAttempts'],
    [{ stableShots: { intervalMs: 2001 } }, '/stableShots/intervalMs'],
    [{ stableShots: { intervalMs: 1.5 } }, '/stableShots/intervalMs'],
    [{ stableShots: { tries: 2 } }, '/stableShots/tries'],
    [{ stableShots: 3 }, '/stableShots'],
    [{ routes: [{ id: 'a', path: '/', mask: [] }] }, '/routes/0/mask'],
    [{ routes: [{ id: 'a', path: '/', mask: '.clock' }] }, '/routes/0/mask'],
    [{ routes: [{ id: 'a', path: '/', mask: Array.from({ length: 21 }, (_, i) => `.m${i}`) }] }, '/routes/0/mask'],
    [{ routes: [{ id: 'a', path: '/', mask: ['x'.repeat(501)] }] }, '/routes/0/mask/0'],
    [{ routes: [{ id: 'a', path: '/', mask: [`.a${ch(10)}`] }] }, '/routes/0/mask/0'],
    [{ routes: [{ id: 'a', path: '/', mask: [''] }] }, '/routes/0/mask/0'],
    [{ emulation: 'phone' }, '/emulation'],
    [{ emulation: { notch: true } }, '/emulation/notch'],
    [{ emulation: { safeAreaInsets: { top: 201, bottom: 0, left: 0, right: 0 } } }, '/emulation/safeAreaInsets/top'],
    [{ emulation: { safeAreaInsets: { top: 10, bottom: 0, left: 0 } } }, '/emulation/safeAreaInsets/right'],
    [{ emulation: { safeAreaInsets: { top: 1, bottom: 0, left: 0, right: 0, middle: 3 } } }, '/emulation/safeAreaInsets/middle'],
    [{ emulation: { safeAreaInsets: [0, 0, 0, 0] } }, '/emulation/safeAreaInsets'],
    [{ emulation: { smallViewportHeightDifference: 401 } }, '/emulation/smallViewportHeightDifference'],
    [{ emulation: { virtualKeyboardHeight: -1 } }, '/emulation/virtualKeyboardHeight'],
    [{ emulation: { virtualKeyboardHeight: 1201 } }, '/emulation/virtualKeyboardHeight'],
    [{ benchmark: 'yes' }, '/benchmark'],
    [{ checks: { axe: 'on' } }, '/checks/axe'],
  ];
  for (const [overrides, pointer] of cases) {
    const { errors, config } = validateConfig(baseConfig(overrides));
    assert.equal(config, null, pointer);
    assert.ok(errors.some((e) => e.pointer === pointer && !e.refusal), `${pointer}: ${JSON.stringify(errors)}`);
  }
});

test('validateConfig accepts back and forward steps and refuses them under running-app-get-only', () => {
  const ok = validateConfig(baseConfig({ routes: [{ id: 'a', path: '/', steps: [{ action: 'goto', path: '/b' }, { action: 'back' }, { action: 'forward' }, { action: 'newTab' }, { action: 'goto', path: '/c', tab: 1 }, { action: 'back', tab: 1 }] }] }));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.routes[0].steps.map((s) => s.action), ['goto', 'back', 'forward', 'newTab', 'goto', 'back']);
  assert.equal(ok.config.routes[0].steps[5].tab, 1);
  const extra = validateConfig(baseConfig({ routes: [{ id: 'a', path: '/', steps: [{ action: 'back', steps: 2 }] }] }));
  assert.ok(extra.errors.some((e) => e.pointer === '/routes/0/steps/0/steps'));
  const getOnly = validateConfig(baseConfig({ target: 'running-app-get-only', readyMarker: null, routes: [{ id: 'a', path: '/', steps: [{ action: 'back' }] }, { id: 'b', path: '/b', steps: [{ action: 'forward' }] }] }));
  assert.deepEqual(getOnly.errors.filter((e) => e.refusal).map((e) => e.pointer).sort(), ['/routes/0/steps', '/routes/1/steps']);
});

test('validateConfig refuses environment files as upload or storage-state paths', () => {
  const dir = tempDir('uiprobe-envf-');
  for (const file of ['.env', 'files/.env.local', 'fixtures/production.env', '.dev.vars']) {
    const { errors } = validateConfig(baseConfig({ routes: [{ id: 'up', path: '/', steps: [{ action: 'upload', selector: 'input', file }] }] }), { configDir: dir });
    assert.ok(errors.some((e) => e.pointer === '/routes/0/steps/0/file' && e.refusal), file);
  }
  const ss = validateConfig(baseConfig({ routes: [{ id: 'a', path: '/', storageState: 'state/.env.json' }] }));
  assert.ok(ss.errors.some((e) => e.pointer === '/routes/0/storageState' && e.refusal));
});

test('measuredStateChanges reports history navigation', () => {
  assert.deepEqual(measuredStateChanges({ steps: [{ action: 'back' }] }), ['history']);
  assert.deepEqual(measuredStateChanges({ initialUrl: 'http://127.0.0.1/a', url: 'http://127.0.0.1/b', steps: [{ action: 'forward' }, { action: 'click' }] }), ['url', 'history', 'interaction']);
});

// --- v3: axe path, env key, benchmark --------------------------------------

test('validateAxePath accepts the project axe-core build and refuses everything else', () => {
  const dir = tempDir('uiprobe-axe-');
  const axeDir = path.join(dir, 'node_modules', 'axe-core');
  fs.mkdirSync(axeDir, { recursive: true });
  const min = path.join(axeDir, 'axe.min.js');
  fs.writeFileSync(min, '/* axe */');
  assert.deepEqual(validateAxePath(min), { ok: true, path: min, reason: null });
  const nested = path.join(axeDir, 'dist');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'axe.js'), '/* axe */');
  assert.equal(validateAxePath(path.join(nested, 'axe.js')).ok, true, 'one level below axe-core is allowed');
  const refuse = (p, re) => { const r = validateAxePath(p); assert.equal(r.ok, false, String(p)); assert.match(r.reason, re, String(p)); };
  refuse('node_modules/axe-core/axe.min.js', /absolute/);
  refuse(null, /needs a path/);
  fs.writeFileSync(path.join(axeDir, 'axe.core.js'), '');
  refuse(path.join(axeDir, 'axe.core.js'), /named axe\.min\.js or axe\.js/);
  const wrongParent = path.join(dir, 'vendor');
  fs.mkdirSync(wrongParent);
  fs.writeFileSync(path.join(wrongParent, 'axe.min.js'), '');
  refuse(path.join(wrongParent, 'axe.min.js'), /axe-core folder/);
  refuse(path.join(axeDir, 'deep', 'er', 'axe.min.js'), /axe-core folder/);
  const big = path.join(dir, 'big', 'axe-core');
  fs.mkdirSync(big, { recursive: true });
  fs.writeFileSync(path.join(big, 'axe.min.js'), Buffer.alloc(3 * 1024 * 1024 + 1));
  refuse(path.join(big, 'axe.min.js'), /larger than/);
  const asDir = path.join(dir, 'd', 'axe-core', 'axe.js');
  fs.mkdirSync(asDir, { recursive: true });
  refuse(asDir, /not a regular file/);
  refuse(path.join(dir, 'missing', 'axe-core', 'axe.min.js'), /does not exist/);
  refuse(path.join(dir, '.env', 'axe-core', 'axe.min.js'), /environment-file/);
  refuse(path.join(dir, 'x.env', 'axe-core', 'axe.min.js'), /environment-file/);
});

test('validateAxePath follows a symlink only to a regular file', (t) => {
  const dir = tempDir('uiprobe-axelink-');
  const axeDir = path.join(dir, 'axe-core');
  fs.mkdirSync(axeDir);
  const real = path.join(dir, 'real-axe.js');
  fs.writeFileSync(real, '/* axe */');
  const link = path.join(axeDir, 'axe.min.js');
  try { fs.symlinkSync(real, link, 'file'); } catch { t.skip('symbolic links cannot be created here'); return; }
  const r = validateAxePath(link);
  assert.equal(r.ok, true);
  assert.equal(fs.realpathSync(r.path), fs.realpathSync(real));
  const dirTarget = path.join(dir, 'a-dir');
  fs.mkdirSync(dirTarget);
  const link2 = path.join(axeDir, 'axe.js');
  try { fs.symlinkSync(dirTarget, link2, 'dir'); } catch { return; }
  assert.equal(validateAxePath(link2).ok, false);
});

test('validateAxePath with an injected fs refuses a symlink to a directory or an environment file', () => {
  const fakeLink = { isSymbolicLink: () => true, isFile: () => false, size: 0 };
  const fakeDir = { isSymbolicLink: () => false, isFile: () => false, size: 0 };
  const p = path.resolve(os.tmpdir(), 'node_modules', 'axe-core', 'axe.min.js');
  const r = validateAxePath(p, { lstat: () => fakeLink, stat: () => fakeDir, realpath: () => path.resolve(os.tmpdir(), 'elsewhere') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a regular file/);
  const toEnv = validateAxePath(p, { lstat: () => fakeLink, stat: () => fakeDir, realpath: () => path.resolve(os.tmpdir(), '.env') });
  assert.match(toEnv.reason, /environment file/);
});

const ENV = {
  platform: 'linux', driver: 'cdp', browserVersion: 'HeadlessChrome/131.0.6778.33', headless: true,
  viewport: { id: 'm390', width: 390, height: 844, dpr: 3, mobile: true, touch: true },
  theme: 'light', colorScheme: 'light', reducedMotion: false, forcedColors: null, locale: 'en-US', timezone: 'UTC',
  launchArgsHash: 'a'.repeat(64), fontsReady: true, fontFaceErrors: [],
};

test('envKeyFor is stable across key order and ignores fonts and minor versions', () => {
  const key = envKeyFor(ENV);
  assert.match(key, /^[0-9a-f]{64}$/);
  const reordered = Object.fromEntries(Object.entries(ENV).reverse());
  reordered.viewport = { touch: true, mobile: true, dpr: 3, height: 844, width: 390, id: 'm390' };
  assert.equal(envKeyFor(reordered), key);
  assert.equal(envKeyFor({ ...ENV, fontsReady: false, fontFaceErrors: ['Inter'], envKey: 'x' }), key);
  assert.equal(envKeyFor({ ...ENV, browserVersion: 'HeadlessChrome/131.0.9999.1' }), key);
  assert.equal(envKeyFor({ ...ENV, browserVersion: '131.0.6778.33' }), key, 'only the major version counts');
});

test('envKeyFor changes with dpr, theme, locale, major version and launch flags', () => {
  const key = envKeyFor(ENV);
  const variants = [
    { ...ENV, viewport: { ...ENV.viewport, dpr: 2 } },
    { ...ENV, theme: 'dark' },
    { ...ENV, colorScheme: 'dark' },
    { ...ENV, locale: 'es-CO' },
    { ...ENV, locale: null },
    { ...ENV, browserVersion: 'HeadlessChrome/132.0.1.1' },
    { ...ENV, platform: 'win32' },
    { ...ENV, headless: false },
    { ...ENV, launchArgsHash: 'b'.repeat(64) },
  ];
  const keys = variants.map(envKeyFor);
  for (const k of keys) assert.notEqual(k, key);
  assert.equal(new Set(keys).size, keys.length);
  assert.throws(() => envKeyFor(null));
});

test('canonicalJson, browserMajor and launchArgsHash', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
  assert.equal(browserMajor('HeadlessChrome/131.0.6778.33'), '131');
  assert.equal(browserMajor('Edg/155.0.4283.45'), '155');
  assert.equal(browserMajor('131.0'), '131');
  assert.equal(browserMajor(null), null);
  const h = launchArgsHash({ headless: true });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, launchArgsHash({ headless: true }), 'independent of the per-run profile directory');
  assert.notEqual(h, launchArgsHash({ headless: false }));
});

test('captureEnv describes the measured state and carries a matching envKey', () => {
  const { config } = validateConfig(baseConfig({ locale: 'en-US', timezone: 'UTC' }));
  const block = captureEnv({
    env: { platform: 'linux', driverName: 'playwright-core', browserVersion: '131.0.1.2', launchArgsHash: 'c'.repeat(64) },
    config, item: { theme: 'system' }, viewport: config.viewports[0],
    metrics: { width: 844, height: 390, dpr: 3, mobile: true }, media: { colorScheme: 'dark', reducedMotion: true, forcedColors: 'active' },
    fonts: { ready: false, errors: ['Brand Sans'] },
  });
  assert.deepEqual(Object.keys(block), ['platform', 'driver', 'browserVersion', 'headless', 'viewport', 'theme', 'colorScheme', 'reducedMotion', 'forcedColors', 'locale', 'timezone', 'launchArgsHash', 'fontsReady', 'fontFaceErrors', 'envKey']);
  assert.deepEqual(block.viewport, { id: 'm390', width: 844, height: 390, dpr: 3, mobile: true, touch: true });
  assert.equal(block.theme, 'system');
  assert.equal(block.colorScheme, 'dark');
  assert.equal(block.forcedColors, 'active');
  assert.equal(block.fontsReady, false);
  assert.deepEqual(block.fontFaceErrors, ['Brand Sans']);
  assert.equal(block.envKey, envKeyFor(block));
});

test('benchmarkSummary keeps valid runs and takes their median', () => {
  assert.deepEqual(benchmarkSummary([30, 10, 20], 4), { runsMs: [30, 10, 20], medianMs: 20, cpuThrottle: 4 });
  assert.deepEqual(benchmarkSummary([10, 20, -1, Number.NaN], 1), { runsMs: [10, 20], medianMs: 15, cpuThrottle: 1 });
  assert.equal(benchmarkSummary([], 1).medianMs, null);
  assert.equal(benchmarkSummary(null, 2).medianMs, null);
});

test('CLI: environment files given as --config or --accounts are refused before any read', () => {
  const dir = tempDir('uiprobe-envcli-');
  for (const name of ['.env', '.env.probe.json', 'probe.env', '.dev.vars']) {
    const r = runCli(['--config', path.join(dir, name), '--plan']);
    assert.equal(r.status, 2, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /environment file/);
  }
  const cfg = path.join(dir, 'probe.json');
  fs.writeFileSync(cfg, JSON.stringify(baseConfig()));
  const acc = runCli(['--config', cfg, '--out', path.join(dir, 'out'), '--accounts', path.join(dir, '.env.accounts')]);
  assert.equal(acc.status, 2, acc.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'out')), false);
});

test('CLI: --axe needs a value and appears in --help', () => {
  assert.ok(parseArgs(['--config', 'a', '--plan', '--axe']).errors.some((e) => /--axe needs a value/.test(e)));
  assert.equal(parseArgs(['--config', 'a', '--plan', '--axe', '/x/axe-core/axe.min.js']).options.axe, '/x/axe-core/axe.min.js');
  const help = runCli(['--help']);
  for (const word of ['--axe', 'stableShots', 'mask', 'envKey', 'back', 'benchmark', 'emulation']) assert.match(help.stdout, new RegExp(word), word);
});

// --- opt-in smoke test ------------------------------------------------------

const SMOKE_EXE = process.env.UI_AUDIT_SMOKE_EXECUTABLE;
const SMOKE_SKIP = SMOKE_EXE ? false : 'set UI_AUDIT_SMOKE_EXECUTABLE to a Chromium executable to run';
const SKILL_HAS_PLAYWRIGHT = Boolean(resolveDriverModule('playwright-core', [SKILL_DRIVER_PATH]));

test('smoke: one capture through the CDP driver against a local page', { skip: SMOKE_SKIP }, () => smoke('cdp'));

test('smoke: one capture through the skill\'s own playwright-core', {
  skip: SMOKE_SKIP || (SKILL_HAS_PLAYWRIGHT ? false : 'run npm install in the skill folder to get its pinned playwright-core'),
}, () => smoke('playwright-core'));

async function smoke(driver) {
  const dir = tempDir('uiprobe-smoke-');
  const page = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="ui-audit-ready" content="smoke-run"><title>Prueba</title></head>'
    + '<body><main><h1>Menú de prueba</h1><p>Contenido visible.</p><p id="clock" style="width:200px;height:40px">' + Date.now() + '</p><img alt="externa" src="http://example.invalid/blocked.png" width="10" height="10"><button>Pedir</button><a href="/?next=1">siguiente</a></main>'
    + '<script>try { new WebSocket("ws://example.invalid/socket"); } catch (e) {}</script></body></html>';
  fs.writeFileSync(path.join(dir, 'index.html'), page);
  const acceptLanguages = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/?')) {
      acceptLanguages.push(req.headers['accept-language'] || null);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-ui-audit-run': 'smoke' });
      res.end(fs.readFileSync(path.join(dir, 'index.html')));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const run = async (name, marker, extra = [], overrides = {}) => {
    const cfg = path.join(dir, name + '.json');
    fs.writeFileSync(cfg, JSON.stringify({
      schema: CONFIG_SCHEMA, baseUrl: 'http://127.0.0.1:' + port, target: 'disposable', readyMarker: marker,
      themes: ['light'], network: 'fast', settleMs: 300, locale: 'es-CO', timezone: 'America/Bogota',
      viewports: [{ id: 'm390', width: 390, height: 844, dpr: 1, mobile: true, touch: true }],
      checks: { axe: true },
      routes: [{ id: 'home', path: '/', mask: ['#clock'], steps: [
        { action: 'evaluate', expression: 'if (navigator.language !== "es-CO") throw new Error("navigator.language is " + navigator.language)' },
        { action: 'evaluate', expression: '(1234.5).toLocaleString()' },
      ] }],
      ...overrides,
    }));
    const out = path.join(dir, name);
    const child = spawn(process.execPath, [PROBE, '--config', cfg, '--out', out, '--driver', driver, '--executable', SMOKE_EXE, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise((r) => child.on('exit', r));
    return { code, stderr, out };
  };
  try {
    const { code, stderr, out } = await run('out', { path: '/', selector: 'meta[name=ui-audit-ready]', text: 'smoke-run' }, ['--expect-header', 'x-ui-audit-run=smoke']);
    assert.equal(code, 0, stderr);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.captures.length, 1);
    assert.ok(summary.captures[0].flags.blockedRequests >= 2, JSON.stringify(summary.captures[0].flags));
    const capture = JSON.parse(fs.readFileSync(path.join(out, summary.captures[0].file), 'utf8'));
    assert.notEqual(capture.vitals.fcpMs, null);
    assert.ok(capture.blockedRequests.some((b) => b.url.includes('example.invalid/blocked.png')), JSON.stringify(capture.blockedRequests));
    assert.ok(capture.blockedRequests.some((b) => b.url.startsWith('ws://example.invalid') && b.errorText === 'websocket-non-loopback'), JSON.stringify(capture.blockedRequests));
    assert.equal(capture.route.status, 200);
    assert.ok(fs.existsSync(path.join(out, capture.screenshots.view)));
    assert.ok(fs.existsSync(path.join(out, capture.screenshots.full)));
    assert.deepEqual(capture.probeErrors, []);
    assert.ok(capture.measuredState && Array.isArray(capture.measuredState.changes), JSON.stringify(capture.measuredState));
    // Locale: navigator.language and Accept-Language follow the config, not the host.
    assert.equal(capture.steps[0].ok, true, JSON.stringify(capture.steps[0]));
    // The last request is the capture's navigation (earlier ones: header check, warm-up, ready marker).
    assert.ok(String(acceptLanguages.at(-1)).startsWith('es-CO'), JSON.stringify(acceptLanguages));
    // An evaluate step records its expression, never its value.
    for (const step of capture.steps) assert.deepEqual(Object.keys(step).sort(), ['action', 'error', 'expression', 'ok']);
    // v3: the env block names the rendering environment; the view screenshot settled; the mask
    // covered the clock in the screenshots; no --axe means a recorded gap, not an error.
    assert.equal(capture.env.driver, driver);
    assert.equal(capture.env.platform, process.platform);
    assert.equal(capture.env.locale, 'es-CO');
    assert.equal(capture.env.viewport.width, 390);
    assert.equal(capture.env.fontsReady, true);
    assert.equal(capture.env.envKey, envKeyFor(capture.env));
    assert.equal(capture.screenshots.viewStable, true, JSON.stringify(capture.screenshots));
    assert.ok(capture.screenshots.viewAttempts >= 2 && capture.screenshots.viewAttempts <= 3);
    assert.equal(capture.masks.length, 1);
    assert.equal(capture.masks[0].selector, '#clock');
    assert.equal(capture.masks[0].count, 1);
    assert.ok(capture.masks[0].areaPct > 0, JSON.stringify(capture.masks));
    assert.equal(capture.axe.available, false);
    assert.match(capture.axe.reason, /--axe/);
    assert.deepEqual(capture.emulationApplied, { safeAreaInsets: 'off', smallViewportHeightDifference: 'off', virtualKeyboardHeight: 'off' });
    assert.equal(summary.hostBenchmark, null, 'repeat 1: no benchmark unless asked');
    // A readyMarker the page does not show is a refusal: no capture runs.
    const miss = await run('miss', { path: '/', selector: 'meta[name=ui-audit-ready]', text: 'another-run', timeoutMs: 500 });
    assert.equal(miss.code, 2, miss.stderr);
    assert.match(miss.stderr, /readyMarker/);
    const missSummary = JSON.parse(fs.readFileSync(path.join(miss.out, 'summary.json'), 'utf8'));
    assert.equal(missSummary.exit, 2);
    assert.deepEqual(missSummary.captures, []);
    assert.equal(summary.driver, driver);
    // A stand-in axe-core build (never a real download), history steps, emulation and the benchmark.
    const axeDir = path.join(dir, 'node_modules', 'axe-core');
    fs.mkdirSync(axeDir, { recursive: true });
    fs.writeFileSync(path.join(axeDir, 'axe.min.js'), 'window.axe = { version: "0.0.0-stand-in", run: async (ctx, opts) => ({ '
      + 'violations: [{ id: "target-size", impact: "serious", help: "Targets need room", nodes: [{ target: ["main > button"], failureSummary: "Fix: make it larger", html: "<button>secret</button>" }] }], '
      + 'incomplete: [{ id: "color-contrast", impact: null, help: "Check contrast", nodes: [] }], passes: [{ id: "document-title", nodes: [] }], '
      + 'inapplicable: [{ id: String(opts.runOnly.values.length), nodes: [] }] }) };');
    const more = await run('more', { path: '/', selector: 'meta[name=ui-audit-ready]', text: 'smoke-run' }, ['--axe', path.join(axeDir, 'axe.min.js')], {
      benchmark: true, stableShots: { maxAttempts: 4, intervalMs: 50 },
      emulation: { safeAreaInsets: { top: 47, bottom: 34, left: 0, right: 0 }, smallViewportHeightDifference: 56, virtualKeyboardHeight: 300 },
      routes: [{ id: 'hist', path: '/', steps: [{ action: 'goto', path: '/?next=1' }, { action: 'back' }, { action: 'forward' }] }],
    });
    assert.equal(more.code, 0, more.stderr);
    const moreSummary = JSON.parse(fs.readFileSync(path.join(more.out, 'summary.json'), 'utf8'));
    assert.equal(moreSummary.hostBenchmark.runsMs.length, 3, JSON.stringify(moreSummary.hostBenchmark));
    assert.ok(moreSummary.hostBenchmark.medianMs > 0);
    const hist = JSON.parse(fs.readFileSync(path.join(more.out, moreSummary.captures[0].file), 'utf8'));
    assert.deepEqual(hist.probeErrors, []);
    const [, back, forward] = hist.steps;
    for (const st of [back, forward]) {
      assert.equal(st.ok, true, JSON.stringify(st));
      assert.equal(st.navigated, true);
      assert.ok(typeof st.persisted === 'boolean', JSON.stringify(st));
      assert.ok(st.notRestoredReasons === null || Array.isArray(st.notRestoredReasons));
    }
    assert.ok(hist.measuredState.changes.includes('history'));
    for (const k of ['safeAreaInsets', 'smallViewportHeightDifference', 'virtualKeyboardHeight']) assert.ok(['applied', 'unsupported'].includes(hist.emulationApplied[k]), k);
    assert.equal(hist.axe.available, true);
    assert.equal(hist.axe.error, null, JSON.stringify(hist.axe));
    assert.equal(hist.axe.version, '0.0.0-stand-in');
    assert.equal(hist.axe.targetSizeRan, true);
    assert.deepEqual(hist.axe.counts, { violations: 1, incomplete: 1, passes: 1, inapplicable: 1 });
    assert.deepEqual(hist.axe.violations[0], { id: 'target-size', impact: 'serious', help: 'Targets need room', nodes: [{ target: 'main > button', summary: 'Fix: make it larger' }] });
    assert.ok(!JSON.stringify(hist.axe).includes('secret'), 'element HTML is never copied');
  } finally {
    server.close();
  }
}

test('smoke: a tap on an overflowing mobile page hits its target, the view is reset and settles', { skip: SMOKE_SKIP }, async () => {
  const dir = tempDir('uiprobe-overflow-');
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="ui-audit-ready" content="overflow-run"><title>Orders</title>'
    + '<style>body{margin:0;font-family:sans-serif}.wide-banner{width:900px;height:1400px;background:#eee;position:relative}#open{position:absolute;left:760px;top:1200px;width:100px;height:40px}</style></head>'
    + '<body><h1>Orders</h1><div class="wide-banner"><button id="open" onclick="document.getElementById(\'d\').showModal()">Open</button></div>'
    + '<dialog id="d"><p>Details</p><button onclick="this.closest(\'dialog\').close()">Close</button></dialog></body></html>';
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const drivers = ['cdp', ...(SKILL_HAS_PLAYWRIGHT ? ['playwright-core'] : [])];
    for (const driver of drivers) {
      const cfg = path.join(dir, `${driver}.json`);
      fs.writeFileSync(cfg, JSON.stringify({
        schema: CONFIG_SCHEMA, baseUrl: `http://127.0.0.1:${server.address().port}`, target: 'disposable',
        readyMarker: { path: '/', selector: 'meta[name=ui-audit-ready]', text: 'overflow-run' },
        themes: ['light'], network: 'fast', settleMs: 300,
        viewports: [{ id: 'm390', width: 390, height: 844, dpr: 3, mobile: true, touch: true }],
        routes: [
          { id: 'orders', path: '/' },
          { id: 'orders-dialog', path: '/', steps: [{ action: 'click', selector: '#open' }, { action: 'waitFor', selector: 'dialog[open]', timeoutMs: 5000 }] },
        ],
      }));
      const out = path.join(dir, `out-${driver}`);
      const child = spawn(process.execPath, [PROBE, '--config', cfg, '--out', out, '--driver', driver, '--executable', SMOKE_EXE], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      const code = await new Promise((r) => child.on('exit', r));
      assert.equal(code, 0, `${driver}: ${stderr}`);
      const read = (rel) => JSON.parse(fs.readFileSync(path.join(out, rel), 'utf8'));
      const plain = read('captures/orders/m390.light.json');
      assert.equal(plain.screenshots.viewStable, true, `${driver} ${JSON.stringify(plain.screenshots)}`);
      assert.equal(plain.screenshots.viewAttempts, 2, `${driver}: overlay scrollbars no longer fade between shots`);
      assert.equal(plain.screenshots.scrollbarsHidden, true);
      const dialog = read('captures/orders-dialog/m390.light.json');
      assert.deepEqual(dialog.steps.map((st) => st.ok), [true, true], `${driver} ${JSON.stringify(dialog.steps)}`);
      assert.equal(dialog.measuredState.scrollReset, true, JSON.stringify(dialog.measuredState));
      assert.ok(isScrolled(dialog.measuredState.scrollAfterSteps), 'the tap panned the visual viewport');
      assert.equal(isScrolled(dialog.measuredState.scroll), false, JSON.stringify(dialog.measuredState.scroll));
      assert.deepEqual(dialog.measuredState.changes, ['interaction']);
      assert.equal(dialog.screenshots.viewStable, true);
      assert.ok(dialog.vitals.beforeSteps && dialog.vitals.beforeSteps.fcpMs !== null, JSON.stringify(dialog.vitals));
      assert.notEqual(dialog.vitals.lcpMs, null, 'LCP survives the step');
      assert.ok(['measured', 'below_threshold'].includes(dialog.vitals.inpStatus), JSON.stringify(dialog.vitals));
      assert.ok(dialog.vitals.interactionCount >= 1);
    }
  } finally {
    server.close();
  }
});
