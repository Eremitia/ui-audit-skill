// Tests for ui-diff.mjs. Run from the skill directory: node --test scripts/ui-diff.test.mjs
// Every PNG is generated in a temporary directory; the repository holds no image files.
// The smoke test at the end runs only when UI_AUDIT_SMOKE_EXECUTABLE points at a Chromium
// executable: it takes real screenshots with ui-probe.mjs and compares them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  crc32, decodePng, encodePng, yiqDelta, isAntialiased, comparePixels, withinBudget, captureKey, envKeyOf,
  compareRuns, promoteBaseline, approveBaseline, selfTest, isForbiddenPath, diffRegions, listRunCaptures,
  checkApprovedText, readApprovedTextFile, parseArgs, DiffError, EXIT, STATUSES, MAX_YIQ_DELTA, TOOL_VERSION,
} from './ui-diff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIFF = path.join(HERE, 'ui-diff.mjs');
const PROBE = path.join(HERE, 'ui-probe.mjs');
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [DIFF, ...args], { encoding: 'utf8', timeout: 60000, ...options });
}

function image(width, height, rgba = [255, 255, 255, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set(rgba, p * 4);
  return { width, height, data };
}

function setPixel(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

function fillRect(img, x0, y0, w, h, rgba) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPixel(img, x, y, rgba);
}

function pixel(img, x, y) {
  const o = (y * img.width + x) * 4;
  return [...img.data.subarray(o, o + 4)];
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function predictor(filter, a, b, c) {
  switch (filter) {
    case 0: return 0;
    case 1: return a;
    case 2: return b;
    case 3: return (a + b) >> 1;
    default: {
      const p = a + b - c;
      const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
  }
}

/** A PNG of any colour type from raw samples, each row filtered with `filter` (or per row from an array). */
function rawPng({ width, height, colorType, samples, filter = 0, bitDepth = 8, interlace = 0, palette = null, trns = null, extraChunks = [] }) {
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = Array.isArray(filter) ? filter[y % filter.length] : filter;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = samples[y * stride + i];
      const a = i >= bpp ? samples[y * stride + i - bpp] : 0;
      const b = y > 0 ? samples[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= bpp ? samples[(y - 1) * stride + i - bpp] : 0;
      raw[y * (stride + 1) + 1 + i] = (x - predictor(f, a, b, c)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[12] = interlace;
  const parts = [SIGNATURE, chunk('IHDR', ihdr)];
  if (palette) parts.push(chunk('PLTE', Buffer.from(palette)));
  if (trns) parts.push(chunk('tRNS', Buffer.from(trns)));
  for (const c of extraChunks) parts.push(c);
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** A fake probe out directory: captures/<stem>.json and .view.png for each item. */
function fakeRun(dir, items) {
  for (const it of items) {
    const json = path.join(dir, 'captures', `${it.stem}.json`);
    fs.mkdirSync(path.dirname(json), { recursive: true });
    const capture = {
      schema: 'ui-audit/probe-capture@3',
      env: it.envKey === null ? null : { envKey: it.envKey ?? KEY_A },
      screenshots: { view: it.noView ? null : `captures/${it.stem}.view.png`, viewStable: it.viewStable ?? true, viewAttempts: 2, full: null, steps: [] },
      masks: it.masks ?? [],
      ...(it.steps ? { steps: it.steps } : {}),
    };
    fs.writeFileSync(json, JSON.stringify(capture));
    if (!it.noView) fs.writeFileSync(path.join(dir, 'captures', `${it.stem}.view.png`), encodePng(it.image));
  }
  return dir;
}

// --- CRC and PNG ------------------------------------------------------------

test('crc32 matches the reference values', () => {
  assert.equal(crc32(Buffer.from('123456789', 'latin1')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(crc32(Buffer.from('IEND', 'latin1')), 0xae426082);
});

test('encodePng and decodePng round-trip RGBA pixels exactly', () => {
  for (const [w, h] of [[1, 1], [3, 2], [17, 9], [64, 33]]) {
    const img = image(w, h);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 37 + w * 11 + h) & 0xff;
    const png = encodePng(img);
    assert.ok(png.subarray(0, 8).equals(SIGNATURE));
    const back = decodePng(png);
    assert.equal(back.width, w);
    assert.equal(back.height, h);
    assert.ok(Buffer.from(back.data).equals(Buffer.from(img.data)), `${w}x${h}`);
  }
  assert.throws(() => encodePng({ width: 2, height: 2, data: new Uint8Array(15) }), /width\*height\*4/);
  assert.throws(() => encodePng({ width: 0, height: 2, data: new Uint8Array(0) }), /positive/);
});

test('decodePng reads every colour type with every filter type', () => {
  const width = 5;
  const height = 4;
  const filters = [0, 1, 2, 3, 4];
  for (const filter of [...filters, filters]) {
    // Grey.
    const grey = Array.from({ length: width * height }, (_, i) => (i * 29) & 0xff);
    const g = decodePng(rawPng({ width, height, colorType: 0, samples: grey, filter }));
    assert.deepEqual(pixel(g, 2, 1), [grey[7], grey[7], grey[7], 255]);
    // RGB.
    const rgb = Array.from({ length: width * height * 3 }, (_, i) => (i * 53 + 7) & 0xff);
    const c = decodePng(rawPng({ width, height, colorType: 2, samples: rgb, filter }));
    assert.deepEqual(pixel(c, 4, 3), [rgb[57], rgb[58], rgb[59], 255]);
    // Grey + alpha.
    const ga = Array.from({ length: width * height * 2 }, (_, i) => (i * 17 + 3) & 0xff);
    const gaImg = decodePng(rawPng({ width, height, colorType: 4, samples: ga, filter }));
    assert.deepEqual(pixel(gaImg, 1, 2), [ga[22], ga[22], ga[22], ga[23]]);
    // RGBA.
    const rgba = Array.from({ length: width * height * 4 }, (_, i) => (i * 101 + 1) & 0xff);
    const r = decodePng(rawPng({ width, height, colorType: 6, samples: rgba, filter }));
    assert.deepEqual(pixel(r, 3, 2), rgba.slice(52, 56));
    // Palette with tRNS.
    const idx = Array.from({ length: width * height }, (_, i) => i % 3);
    const p = decodePng(rawPng({ width, height, colorType: 3, samples: idx, filter, palette: [255, 0, 0, 0, 255, 0, 0, 0, 255], trns: [128] }));
    assert.deepEqual(pixel(p, 0, 0), [255, 0, 0, 128]);
    assert.deepEqual(pixel(p, 1, 0), [0, 255, 0, 255]);
    assert.deepEqual(pixel(p, 2, 0), [0, 0, 255, 255]);
  }
});

test('decodePng applies tRNS colour keys for grey and RGB images and skips unknown chunks', () => {
  const grey = decodePng(rawPng({ width: 2, height: 1, colorType: 0, samples: [7, 9], trns: [0, 7] }));
  assert.deepEqual(pixel(grey, 0, 0), [7, 7, 7, 0]);
  assert.deepEqual(pixel(grey, 1, 0), [9, 9, 9, 255]);
  const rgb = decodePng(rawPng({ width: 2, height: 1, colorType: 2, samples: [1, 2, 3, 1, 2, 4], trns: [0, 1, 0, 2, 0, 3] }));
  assert.deepEqual(pixel(rgb, 0, 0), [1, 2, 3, 0]);
  assert.deepEqual(pixel(rgb, 1, 0), [1, 2, 4, 255]);
  const withText = decodePng(rawPng({ width: 1, height: 1, colorType: 0, samples: [5], extraChunks: [chunk('tEXt', Buffer.from('Comment\0hello', 'latin1'))] }));
  assert.deepEqual(pixel(withText, 0, 0), [5, 5, 5, 255]);
});

test('decodePng rejects malformed and unsupported files with named errors', () => {
  const good = rawPng({ width: 2, height: 2, colorType: 6, samples: new Array(16).fill(9) });
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /bad signature/);
  const badCrc = Buffer.from(good);
  badCrc[20] ^= 0xff;
  assert.throws(() => decodePng(badCrc), /bad CRC/);
  assert.throws(() => decodePng(good.subarray(0, good.length - 6)), /truncated/);
  const noEnd = good.subarray(0, good.length - 12);
  assert.throws(() => decodePng(noEnd), /truncated/);
  assert.throws(() => decodePng(rawPng({ width: 1, height: 1, colorType: 0, samples: [0, 0], bitDepth: 16 })), /unsupported bit depth/);
  assert.throws(() => decodePng(rawPng({ width: 1, height: 1, colorType: 0, samples: [0], bitDepth: 4 })), /unsupported bit depth/);
  assert.throws(() => decodePng(rawPng({ width: 1, height: 1, colorType: 0, samples: [0], interlace: 1 })), /interlaced PNG not supported/);
  assert.throws(() => decodePng(rawPng({ width: 1, height: 1, colorType: 3, samples: [0] })), /PLTE/);
  assert.throws(() => decodePng(rawPng({ width: 1, height: 1, colorType: 3, samples: [5], palette: [0, 0, 0] })), /palette index/);
  // An IHDR that announces more than 50,000,000 pixels is refused before any inflate.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10000, 0);
  ihdr.writeUInt32BE(10000, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  assert.throws(() => decodePng(Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))])), /50,000,000/);
  // Too little image data.
  const short = Buffer.concat([SIGNATURE, chunk('IHDR', (() => { const h = Buffer.alloc(13); h.writeUInt32BE(4, 0); h.writeUInt32BE(4, 4); h[8] = 8; h[9] = 6; return h; })()),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(10))), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(short), /truncated/);
});

// --- pixel maths ------------------------------------------------------------

test('yiqDelta is 0 for equal pixels, symmetric, bounded and blends alpha on white', () => {
  assert.equal(yiqDelta(10, 20, 30, 255, 10, 20, 30, 255), 0);
  const bw = yiqDelta(0, 0, 0, 255, 255, 255, 255, 255);
  assert.ok(bw > 32000 && bw <= MAX_YIQ_DELTA, String(bw));
  assert.equal(yiqDelta(255, 0, 0, 255, 0, 255, 255, 255), yiqDelta(0, 255, 255, 255, 255, 0, 0, 255));
  let max = 0;
  for (const c1 of [0, 255]) for (const c2 of [0, 255]) for (const c3 of [0, 255]) for (const d1 of [0, 255]) for (const d2 of [0, 255]) for (const d3 of [0, 255]) {
    max = Math.max(max, yiqDelta(c1, c2, c3, 255, d1, d2, d3, 255));
  }
  assert.ok(max <= MAX_YIQ_DELTA + 1e-6 && max > 35000, String(max));
  assert.equal(yiqDelta(0, 0, 0, 0, 255, 255, 255, 255), 0, 'a fully transparent pixel is white');
  assert.ok(Math.abs(yiqDelta(0, 0, 0, 128, 128, 128, 128, 255)) < 2);
});

test('isAntialiased finds an edge pixel between two flat areas and nothing in flat or noisy areas', () => {
  const img = image(6, 5, [0, 0, 0, 255]);
  fillRect(img, 3, 0, 3, 5, [255, 255, 255, 255]);
  for (let y = 0; y < 5; y++) setPixel(img, 2, y, [128, 128, 128, 255]);
  assert.equal(isAntialiased(img, 2, 2, img), true);
  assert.equal(isAntialiased(img, 0, 2, img), false, 'flat black area');
  assert.equal(isAntialiased(img, 4, 2, img), false, 'flat white area');
  const noisy = image(5, 5);
  for (let i = 0; i < noisy.data.length; i += 4) noisy.data.set([(i * 47) & 0xff, (i * 13) & 0xff, (i * 7) & 0xff, 255], i);
  assert.equal(isAntialiased(noisy, 2, 2, noisy), false, 'no flat area near the darkest or brightest neighbour');
});

test('comparePixels counts differences above the threshold and paints the diff image', () => {
  const a = image(8, 6);
  const same = comparePixels(a, image(8, 6));
  assert.equal(same.diffPixels, 0);
  assert.equal(same.ratio, 0);
  assert.deepEqual(pixel(same.diff, 0, 0), [255, 255, 255, 255]);
  const b = image(8, 6);
  setPixel(b, 1, 1, [250, 250, 250, 255]);
  assert.equal(comparePixels(a, b).diffPixels, 0, 'a faint change stays under t = 0.2');
  assert.equal(comparePixels(a, b, { threshold: 0 }).diffPixels, 1);
  fillRect(b, 4, 2, 2, 2, [200, 0, 0, 255]);
  const r = comparePixels(a, b);
  assert.equal(r.diffPixels, 4);
  assert.equal(r.aaPixels, 0);
  assert.equal(r.sizeMismatch, false);
  assert.ok(Math.abs(r.ratio - 4 / 48) < 1e-12);
  assert.deepEqual(r.regions, [{ x: 4, y: 2, w: 2, h: 2 }]);
  assert.deepEqual(pixel(r.diff, 4, 2), [255, 0, 0, 255]);
  const grey = pixel(r.diff, 0, 0);
  assert.equal(grey[0], grey[1]);
  assert.ok(grey[0] >= 230, 'unchanged pixels are faded toward white');
  assert.equal(comparePixels(a, b, { diffImage: false }).diff, null);
  assert.throws(() => comparePixels(a, b, { threshold: 1.5 }), /threshold/);
});

test('comparePixels counts anti-aliased pixels apart unless includeAA', () => {
  const a = image(7, 5, [0, 0, 0, 255]);
  fillRect(a, 4, 0, 3, 5, [255, 255, 255, 255]);
  const b = image(7, 5, [0, 0, 0, 255]);
  fillRect(b, 4, 0, 3, 5, [255, 255, 255, 255]);
  setPixel(b, 3, 2, [128, 128, 128, 255]);
  for (const y of [1, 3]) setPixel(b, 3, y, [128, 128, 128, 255]);
  const r = comparePixels(a, b);
  assert.ok(r.aaPixels >= 1, JSON.stringify({ aa: r.aaPixels, diff: r.diffPixels }));
  assert.deepEqual(pixel(r.diff, 3, 2), [255, 255, 0, 255]);
  const strict = comparePixels(a, b, { includeAA: true });
  assert.equal(strict.aaPixels, 0);
  assert.equal(strict.diffPixels, r.diffPixels + r.aaPixels);
});

test('comparePixels compares different sizes on the padded union', () => {
  const r = comparePixels(image(4, 4, [0, 0, 0, 255]), image(4, 6, [0, 0, 0, 255]));
  assert.equal(r.sizeMismatch, true);
  assert.equal(r.width, 4);
  assert.equal(r.height, 6);
  assert.equal(r.diffPixels, 8, 'the missing rows are transparent, which is white against black');
  assert.deepEqual(r.regions, [{ x: 0, y: 4, w: 4, h: 2 }]);
});

test('diffRegions separates distant areas and keeps at most 20 boxes', () => {
  const w = 20;
  const h = 10;
  const mask = new Uint8Array(w * h);
  const mark = (x0, y0, ww, hh) => { for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) mask[y * w + x] = 1; };
  mark(1, 1, 2, 2);
  mark(15, 1, 3, 2);
  mark(1, 7, 4, 2);
  assert.deepEqual(diffRegions(mask, w, h), [{ x: 1, y: 1, w: 2, h: 2 }, { x: 15, y: 1, w: 3, h: 2 }, { x: 1, y: 7, w: 4, h: 2 }]);
  const many = new Uint8Array(100 * 100);
  for (let i = 0; i < 25; i++) for (let j = 0; j < 2; j++) many[(4 * (i % 25)) * 100 + j * 50 + (i % 2)] = 1;
  assert.ok(diffRegions(many, 100, 100).length <= 20);
  assert.deepEqual(diffRegions(new Uint8Array(4), 2, 2), []);
});

test('withinBudget applies the smaller limit, defaults to zero and never passes a size mismatch', () => {
  const r = { width: 100, height: 100, diffPixels: 10, sizeMismatch: false };
  assert.equal(withinBudget(r, {}), false);
  assert.equal(withinBudget({ ...r, diffPixels: 0 }, {}), true);
  assert.equal(withinBudget(r, { maxDiffPixels: 10 }), true);
  assert.equal(withinBudget(r, { maxDiffPixels: 9 }), false);
  assert.equal(withinBudget(r, { maxDiffPixelRatio: 0.0009 }), false);
  assert.equal(withinBudget(r, { maxDiffPixelRatio: 0.001 }), true, 'budget 10 pixels, 10 differ');
  assert.equal(withinBudget(r, { maxDiffPixels: 50, maxDiffPixelRatio: 0.0005 }), false, 'the smaller limit wins');
  assert.equal(withinBudget(r, { maxDiffPixels: 5, maxDiffPixelRatio: 0.5 }), false);
  assert.equal(withinBudget(r, { maxDiffPixels: 100, maxDiffPixelRatio: 0.5 }), true);
  assert.equal(withinBudget({ ...r, diffPixels: 0, sizeMismatch: true }, { maxDiffPixels: 1000 }), false);
});

test('captureKey drops the repeat suffix and refuses malformed stems', () => {
  assert.equal(captureKey('home/m390.light'), 'home/m390.light');
  assert.equal(captureKey('home/m390.dark.r1'), 'home/m390.dark');
  assert.equal(captureKey('cart-x/d1440.system.r3'), 'cart-x/d1440.system');
  for (const bad of ['home/m390', 'Home/m390.light', '../x/m390.light', 'home/m390.sepia', 'home/m390.light.r0', 'con/m390.light', 'home/m390.light.view', null, '']) {
    assert.equal(captureKey(bad), null, String(bad));
  }
});

test('envKeyOf reads env.envKey only when it is a sha256 hex string', () => {
  assert.equal(envKeyOf({ env: { envKey: KEY_A } }), KEY_A);
  for (const bad of [null, {}, { env: null }, { env: { envKey: 'x' } }, { env: { envKey: KEY_A.toUpperCase() } }]) assert.equal(envKeyOf(bad), null);
});

test('selfTest passes and the tool version is 1.0.0', () => {
  assert.deepEqual(selfTest().ok, true);
  assert.equal(TOOL_VERSION, '1.0.0');
  assert.equal(STATUSES.length, 8);
});

test('isForbiddenPath matches every environment-file name and nothing else', () => {
  for (const p of ['.env', '.env.local', '.env.example', '.env-local', '.env_prod', '.envrc', 'production.env', 'app.env', '.dev.vars', 'a/b/.env', 'C:\\x\\.env.test']) {
    assert.equal(isForbiddenPath(p), true, p);
  }
  for (const p of ['environment.ts', 'envelope.svg', '.envoy.yaml', 'dotenv.md', 'env/x.png', '', null]) assert.equal(isForbiddenPath(p), false, String(p));
});

// --- runs, baselines, CLI -----------------------------------------------------

function baselineFixture() {
  const root = tempDir('uidiff-');
  const white = image(20, 10);
  const run1 = fakeRun(path.join(root, 'run1'), [
    { stem: 'home/m390.light', image: white },
    { stem: 'home/m390.dark', image: image(20, 10, [20, 20, 20, 255]) },
    { stem: 'cart/m390.light', image: white },
    { stem: 'cart/d1440.light', image: white },
    { stem: 'menu/m390.light', image: white },
    { stem: 'promo/m390.light', image: white, masks: [{ selector: '.ad', count: 1, areaPct: 25 }, { selector: '.clock', count: 1, areaPct: 10 }] },
    { stem: 'gone/m390.light', image: white },
    { stem: 'wobbly/m390.light', image: white },
  ]);
  const promoted = promoteBaseline({ fromDir: run1, baselineRoot: path.join(root, 'baselines'), baselineId: 'run-1', repo: 'demo-store', sourceCommit: 'abc1234' });
  const oneDot = image(20, 10);
  setPixel(oneDot, 3, 3, [0, 0, 0, 255]);
  const block = image(20, 10);
  fillRect(block, 10, 2, 5, 4, [0, 0, 200, 255]);
  const run2 = fakeRun(path.join(root, 'run2'), [
    { stem: 'home/m390.light.r1', image: white },
    { stem: 'home/m390.light.r2', image: block },
    { stem: 'home/m390.dark.r1', image: image(20, 10, [20, 20, 20, 255]), envKey: KEY_B },
    { stem: 'cart/m390.light.r1', image: oneDot },
    { stem: 'cart/d1440.light.r1', image: image(20, 12) },
    { stem: 'menu/m390.light.r1', image: block },
    { stem: 'promo/m390.light.r1', image: white, masks: [{ selector: '.ad', count: 1, areaPct: 25 }, { selector: '.clock', count: 1, areaPct: 10 }] },
    { stem: 'fresh/m390.light.r1', image: white },
    { stem: 'wobbly/m390.light.r1', image: block, viewStable: false },
  ]);
  return { root, run1, run2, baselineDir: promoted.dir, promoted };
}

test('promoteBaseline writes an unapproved manifest and the view screenshots', () => {
  const { root, baselineDir, promoted } = baselineFixture();
  const m = promoted;
  assert.equal(promoted.dir, baselineDir);
  assert.deepEqual(promoted.skipped, []);
  assert.ok(!Object.keys(promoted).includes('dir'), 'the location is not part of the manifest JSON');
  assert.equal(m.schema, 'ui-audit/baseline@1');
  assert.equal(m.id, 'run-1');
  assert.equal(m.repo, 'demo-store');
  assert.equal(m.source_commit, 'abc1234');
  assert.equal(m.source_run, path.join(root, 'run1'));
  assert.equal(m.approved_by_owner, false);
  assert.equal(m.approved_at, null);
  assert.equal(m.approved_text, null);
  assert.deepEqual(m.items.map((i) => i.key), ['cart/d1440.light', 'cart/m390.light', 'gone/m390.light', 'home/m390.dark', 'home/m390.light', 'menu/m390.light', 'promo/m390.light', 'wobbly/m390.light']);
  assert.deepEqual(m.items[0], { key: 'cart/d1440.light', file: 'captures/cart/d1440.light.view.png', envKey: KEY_A, width: 20, height: 10, viewStable: true, maskedAreaPct: 0 });
  assert.equal(m.items.find((i) => i.key === 'promo/m390.light').maskedAreaPct, 35);
  for (const item of m.items) assert.equal(decodePng(fs.readFileSync(path.join(baselineDir, item.file))).width, 20);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(baselineDir, 'manifest.json'), 'utf8')), m);
});

test('compareRuns gives every status, a sorted summary and diff images', () => {
  const { root, run2, baselineDir } = baselineFixture();
  const out = path.join(root, 'visual');
  const s = compareRuns({ baselineDir, currentDir: run2, outDir: out, options: { maskWarnPct: 30 } });
  assert.equal(s.schema, 'ui-audit/diff-summary@1');
  assert.equal(s.toolVersion, '1.0.0');
  assert.equal(s.selfTest, 'passed');
  assert.deepEqual(s.baseline, { id: 'run-1', dir: baselineDir, approved: false, approved_at: null });
  assert.deepEqual(s.options, { threshold: 0.2, includeAA: false, maxDiffPixels: null, maxDiffPixelRatio: 0.001, maskWarnPct: 30 });
  const by = Object.fromEntries(s.items.map((i) => [i.key, i]));
  assert.deepEqual(s.items.map((i) => i.key), [...s.items.map((i) => i.key)].sort());
  assert.equal(by['home/m390.light'].status, 'unchanged', 'the r1 repeat is the one compared');
  assert.equal(by['home/m390.dark'].status, 'env_mismatch');
  assert.equal(by['home/m390.dark'].diffPixels, null, 'different environments are never compared');
  assert.equal(by['cart/m390.light'].status, 'changed', 'budget 0.001 of 200 pixels is 0.2 pixel');
  assert.equal(by['cart/m390.light'].diffPixels, 1);
  assert.equal(by['cart/d1440.light'].status, 'size_mismatch');
  assert.equal(by['menu/m390.light'].status, 'changed');
  assert.deepEqual(by['menu/m390.light'].regions, [{ x: 10, y: 2, w: 5, h: 4 }]);
  assert.equal(by['menu/m390.light'].diffImage, 'diffs/menu/m390.light.diff.png');
  assert.equal(by['promo/m390.light'].status, 'unchanged');
  assert.equal(by['promo/m390.light'].maskedAreaPct, 35);
  assert.equal(by['promo/m390.light'].lowValue, true);
  assert.equal(by['home/m390.light'].lowValue, false);
  assert.equal(by['fresh/m390.light'].status, 'missing_baseline');
  assert.equal(by['gone/m390.light'].status, 'missing_current');
  assert.equal(by['wobbly/m390.light'].status, 'unstable');
  assert.equal(by['home/m390.light'].diffImage, null, 'no diff image when nothing differs');
  assert.deepEqual(s.counts, { unchanged: 2, within_budget: 0, changed: 2, size_mismatch: 1, env_mismatch: 1, missing_baseline: 1, missing_current: 1, unstable: 1 });
  const diff = decodePng(fs.readFileSync(path.join(out, 'diffs', 'menu', 'm390.light.diff.png')));
  assert.deepEqual(pixel(diff, 10, 2), [255, 0, 0, 255]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'diff-summary.json'), 'utf8')), s);
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: out }), (e) => e instanceof DiffError && e.code === EXIT.REFUSED);
});

test('compareRuns: budgets, --only and no diff images', () => {
  const { root, run2, baselineDir } = baselineFixture();
  const s = compareRuns({ baselineDir, currentDir: run2, outDir: path.join(root, 'v1'), options: { maxDiffPixels: 1, maxDiffPixelRatio: null, only: ['cart/m390.light', 'menu/m390.light'], diffImages: false } });
  assert.deepEqual(s.items.map((i) => [i.key, i.status, i.diffImage]), [['cart/m390.light', 'within_budget', null], ['menu/m390.light', 'changed', null]]);
  assert.equal(fs.existsSync(path.join(root, 'v1', 'diffs')), false);
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: path.join(root, 'v2'), options: { threshold: 2 } }), /threshold/);
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: path.join(root, 'v3'), options: { only: ['nope'] } }), /only/);
});

test('compareRuns writes nothing when an input PNG is unreadable', () => {
  const { root, run2, baselineDir } = baselineFixture();
  fs.writeFileSync(path.join(run2, 'captures', 'menu', 'm390.light.r1.view.png'), Buffer.from('broken'));
  const out = path.join(root, 'bad');
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: out }), (e) => e.code === EXIT.UNREADABLE && /bad signature/.test(e.message));
  assert.equal(fs.existsSync(path.join(out, 'diff-summary.json')), false);
  assert.equal(fs.existsSync(path.join(out, 'diffs')), false);
});

test('compareRuns refuses relative, non-empty and git-tracked output directories', () => {
  const { root, run2, baselineDir } = baselineFixture();
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: 'relative/out' }), (e) => e.code === EXIT.REFUSED);
  const full = path.join(root, 'full');
  fs.mkdirSync(full);
  fs.writeFileSync(path.join(full, 'note.json'), '{}');
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: full }), /already has content/);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: path.join(repo, 'visual') }), /git working tree/);
  const allowed = compareRuns({ baselineDir, currentDir: run2, outDir: path.join(repo, 'visual'), options: { allowInsideGit: true } });
  assert.equal(allowed.items.length, 9);
  assert.throws(() => compareRuns({ baselineDir, currentDir: run2, outDir: path.join(root, '.env.out') }), /environment file/);
});

test('listRunCaptures skips files whose names are not capture stems and refuses symlinks', (t) => {
  const dir = tempDir('uidiff-list-');
  fakeRun(dir, [{ stem: 'home/m390.light', image: image(2, 2) }]);
  fs.writeFileSync(path.join(dir, 'captures', 'home', 'notes.json'), '{}');
  fs.writeFileSync(path.join(dir, 'captures', 'home', '.env.json'), '{}');
  fs.mkdirSync(path.join(dir, 'captures', 'Bad'));
  const found = listRunCaptures(dir);
  assert.deepEqual([...found.keys()], ['home/m390.light']);
  assert.equal(found.get('home/m390.light').viewExists, true);
  const target = path.join(dir, 'elsewhere.json');
  fs.writeFileSync(target, '{}');
  try { fs.symlinkSync(target, path.join(dir, 'captures', 'home', 'm390.dark.json'), 'file'); } catch { t.skip('symbolic links cannot be created here'); return; }
  assert.throws(() => listRunCaptures(dir), /symbolic link/);
});

test('promoteBaseline refuses bad ids, an existing id, unsafe roots and empty runs', () => {
  const { root, run1 } = baselineFixture();
  const base = { fromDir: run1, baselineRoot: path.join(root, 'baselines'), repo: 'demo-store', sourceCommit: 'abc1234' };
  assert.throws(() => promoteBaseline({ ...base, baselineId: 'run-1' }), (e) => e.code === EXIT.REFUSED && /already exists/.test(e.message));
  assert.throws(() => promoteBaseline({ ...base, baselineId: 'Run 2' }), (e) => e.code === EXIT.USAGE);
  assert.throws(() => promoteBaseline({ ...base, baselineId: 'run-2', sourceCommit: 'HEAD' }), (e) => e.code === EXIT.USAGE);
  assert.throws(() => promoteBaseline({ ...base, baselineId: 'run-2', repo: '../x' }), (e) => e.code === EXIT.USAGE);
  assert.throws(() => promoteBaseline({ ...base, baselineId: 'run-2', baselineRoot: 'baselines' }), (e) => e.code === EXIT.REFUSED);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  assert.throws(() => promoteBaseline({ ...base, baselineId: 'run-2', baselineRoot: path.join(repo, 'baselines') }), /git working tree/);
  assert.equal(promoteBaseline({ ...base, baselineId: 'run-2', baselineRoot: path.join(repo, 'baselines'), allowInsideGit: true }).items.length, 8);
  const empty = fakeRun(path.join(root, 'empty'), [{ stem: 'home/m390.light', image: image(2, 2), noView: true }]);
  assert.throws(() => promoteBaseline({ ...base, fromDir: empty, baselineId: 'run-3' }), /no view screenshots/);
});

test('approveBaseline records the owner words once', () => {
  const { root } = baselineFixture();
  const baselineRoot = path.join(root, 'baselines');
  const r = approveBaseline({ baselineRoot, baselineId: 'run-1', approvedText: 'Yes, keep it as the new baseline.\n', now: () => new Date('2026-10-16T12:00:00Z') });
  assert.equal(r.approved_by_owner, true);
  assert.equal(r.approved_at, '2026-10-16T12:00:00.000Z');
  assert.equal(r.approved_text, 'Yes, keep it as the new baseline.');
  assert.equal(r.dir, path.join(baselineRoot, 'run-1'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(baselineRoot, 'run-1', 'manifest.json'), 'utf8'));
  assert.equal(onDisk.approved_by_owner, true);
  assert.deepEqual(fs.readdirSync(path.join(baselineRoot, 'run-1')).sort(), ['captures', 'manifest.json']);
  assert.throws(() => approveBaseline({ baselineRoot, baselineId: 'run-1', approvedText: 'again' }), /already approved/);
  assert.throws(() => approveBaseline({ baselineRoot, baselineId: 'nope', approvedText: 'yes' }), (e) => e.code === EXIT.USAGE);
});

test('checkApprovedText and readApprovedTextFile enforce length, encoding and safe paths', () => {
  assert.deepEqual(checkApprovedText('ok\r\n'), { ok: true, text: 'ok', reason: null });
  assert.equal(checkApprovedText('two\n\n').text, 'two\n');
  assert.equal(checkApprovedText('').ok, false);
  assert.equal(checkApprovedText('\n').ok, false);
  assert.equal(checkApprovedText('x'.repeat(2000)).ok, true);
  assert.equal(checkApprovedText('x'.repeat(2001)).ok, false);
  assert.equal(checkApprovedText('\u00e9'.repeat(2000)).ok, true, 'characters, not bytes');
  const dir = tempDir('uidiff-text-');
  const good = path.join(dir, 'approve.txt');
  fs.writeFileSync(good, 'S\u00ed, "tal cual" \u2014 ok\n', 'utf8');
  assert.equal(readApprovedTextFile(good), 'S\u00ed, "tal cual" \u2014 ok');
  const refusedWith = (fn, re) => assert.throws(fn, (e) => e.code === EXIT.REFUSED && re.test(e.message));
  refusedWith(() => readApprovedTextFile('approve.txt'), /absolute/);
  refusedWith(() => readApprovedTextFile(path.join(dir, 'missing.txt')), /does not exist/);
  refusedWith(() => readApprovedTextFile(path.join(dir, '.env')), /environment file/);
  refusedWith(() => readApprovedTextFile(dir), /regular file/);
  const latin1 = path.join(dir, 'latin1.txt');
  fs.writeFileSync(latin1, Buffer.from([0x53, 0xed, 0x0a]));
  refusedWith(() => readApprovedTextFile(latin1), /UTF-8/);
  const long = path.join(dir, 'long.txt');
  fs.writeFileSync(long, 'x'.repeat(2001));
  refusedWith(() => readApprovedTextFile(long), /2000/);
  const empty = path.join(dir, 'empty.txt');
  fs.writeFileSync(empty, '');
  refusedWith(() => readApprovedTextFile(empty), /1 to 2000/);
});

test('parseArgs: modes, required flags and flags that do not apply', () => {
  assert.equal(parseArgs(['--help']).mode, 'help');
  assert.equal(parseArgs(['--self-test']).mode, 'selfTest');
  const c = parseArgs(['--baseline', '/b', '--current', '/c', '--out=/o', '--threshold', '0.1', '--only', 'home/m390.light', '--include-aa']);
  assert.equal(c.mode, 'compare');
  assert.equal(c.options.threshold, 0.1);
  assert.deepEqual(c.options.only, ['home/m390.light']);
  const usageError = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e instanceof DiffError && e.code === EXIT.USAGE && re.test(e.message), argv.join(' '));
  usageError(['--baseline', '/b', '--current', '/c'], /--out is required/);
  usageError(['--baseline', '/b', '--current', '/c', '--out', '/o', '--threshold', 'x'], /--threshold/);
  usageError(['--baseline', '/b', '--current', '/c', '--out', '/o', '--threshold', '1.5'], /--threshold/);
  usageError(['--baseline', '/b', '--current', '/c', '--out', '/o', '--max-diff-pixels', '1.5'], /--max-diff-pixels/);
  usageError(['--baseline', '/b', '--current', '/c', '--out', '/o', '--only', 'home'], /--only/);
  usageError(['--promote', '--approve'], /only one/);
  usageError(['--promote', '--from', '/f', '--baseline-root', '/r', '--baseline-id', 'x', '--repo', 'r'], /--source-commit is required/);
  usageError(['--approve', '--baseline-root', '/r', '--baseline-id', 'x'], /exactly one/);
  usageError(['--approve', '--baseline-root', '/r', '--baseline-id', 'x', '--approved-text', 'a', '--approved-text-file', '/t'], /exactly one/);
  usageError(['--self-test', '--out', '/o'], /does not apply/);
  usageError(['--promote', '--from', '/f', '--baseline-root', '/r', '--baseline-id', 'x', '--repo', 'r', '--source-commit', 'abc1234', '--threshold', '0.1'], /does not apply/);
  usageError(['--bogus'], /unknown argument/);
  usageError(['--out', '/a', '--out', '/b'], /more than once/);
  usageError(['--include-aa=yes'], /takes no value/);
  assert.equal(parseArgs(['--approve', '--baseline-root', '/r', '--baseline-id', 'x', '--approved-text', '--yes--']).options.approvedText, '--yes--');
});

test('CLI: exit codes 0, 1, 2, 3 and 4', () => {
  const { root, run2, baselineDir } = baselineFixture();
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Exit codes/);
  const self = runCli(['--self-test']);
  assert.equal(self.status, 0, self.stderr);
  assert.equal(JSON.parse(self.stdout).ok, true);
  assert.equal(runCli([]).status, 1);
  assert.equal(runCli(['--baseline', baselineDir, '--current', run2, '--out', 'relative']).status, 2);
  const changed = runCli(['--baseline', baselineDir, '--current', run2, '--out', path.join(root, 'cli-out')]);
  assert.equal(changed.status, 4, changed.stderr);
  assert.match(changed.stdout, /^CHANGED: 9 item\(s\)/);
  const calm = runCli(['--baseline', baselineDir, '--current', run2, '--out', path.join(root, 'cli-calm'), '--only', 'home/m390.light,promo/m390.light']);
  assert.equal(calm.status, 0, calm.stderr);
  assert.match(calm.stdout, /^OK: 2 item\(s\) \(unchanged 2\)/);
  assert.equal(runCli(['--baseline', baselineDir, '--current', run2, '--out', path.join(root, 'cli-out')]).status, 2, 'existing output');
  fs.writeFileSync(path.join(run2, 'captures', 'cart', 'm390.light.r1.view.png'), Buffer.from('nope'));
  const broken = runCli(['--baseline', baselineDir, '--current', run2, '--out', path.join(root, 'cli-broken')]);
  assert.equal(broken.status, 3, broken.stderr);
  assert.match(broken.stderr, /^UNREADABLE: /);
  assert.equal(fs.existsSync(path.join(root, 'cli-broken', 'diff-summary.json')), false);
  const missing = runCli(['--baseline', path.join(root, 'nope'), '--current', run2, '--out', path.join(root, 'cli-x')]);
  assert.equal(missing.status, 1, missing.stderr);
});

test('CLI: promote and approve through files, refusals included', () => {
  const { root, run1 } = baselineFixture();
  const baselineRoot = path.join(root, 'cli-baselines');
  const promote = runCli(['--promote', '--from', run1, '--baseline-root', baselineRoot, '--baseline-id', 'run-7', '--repo', 'demo-store', '--source-commit', '0123abcd']);
  assert.equal(promote.status, 0, promote.stderr);
  assert.deepEqual(JSON.parse(promote.stdout), { promoted: 'run-7', dir: path.join(baselineRoot, 'run-7'), items: 8, skipped: [], approved: false });
  assert.equal(runCli(['--promote', '--from', run1, '--baseline-root', baselineRoot, '--baseline-id', 'run-7', '--repo', 'demo-store', '--source-commit', '0123abcd']).status, 2);
  const text = path.join(root, 'owner-words.txt');
  fs.writeFileSync(text, 'Yes. Approve run-7 as the baseline.\n');
  const bad = runCli(['--approve', '--baseline-root', baselineRoot, '--baseline-id', 'run-7', '--approved-text-file', 'owner-words.txt'], { cwd: root });
  assert.equal(bad.status, 2, 'relative text file');
  const approve = runCli(['--approve', '--baseline-root', baselineRoot, '--baseline-id', 'run-7', '--approved-text-file', text]);
  assert.equal(approve.status, 0, approve.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(baselineRoot, 'run-7', 'manifest.json'), 'utf8'));
  assert.equal(manifest.approved_text, 'Yes. Approve run-7 as the baseline.');
  assert.equal(runCli(['--approve', '--baseline-root', baselineRoot, '--baseline-id', 'run-7', '--approved-text', 'again']).status, 2);
  assert.equal(runCli(['--approve', '--baseline-root', baselineRoot, '--baseline-id', 'run-7']).status, 1);
  assert.equal(runCli(['--approve', '--baseline-root', baselineRoot, '--baseline-id', 'run-7', '--approved-text', 'x'.repeat(2001)]).status, 2);
});

test('importing the module does not run the CLI', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./ui-diff.mjs', import.meta.url).href)}); console.log('imported');`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'imported');
});

// --- opt-in smoke test --------------------------------------------------------

const SMOKE_EXE = process.env.UI_AUDIT_SMOKE_EXECUTABLE;

test('smoke: real probe screenshots compare unchanged, then changed after an edit', { skip: SMOKE_EXE ? false : 'set UI_AUDIT_SMOKE_EXECUTABLE to a Chromium executable to run' }, async () => {
  const dir = tempDir('uidiff-smoke-');
  let variant = 'a';
  const page = () => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="ui-audit-ready" content="diff-smoke"><title>Diff smoke</title><style>body{margin:0;padding:16px;font:16px sans-serif}'
    + `.box{width:120px;height:60px;background:${variant === 'a' ? '#0066cc' : '#cc0000'}}#clock{width:220px;height:30px;overflow:hidden;white-space:nowrap}</style></head>`
    + `<body><main><h1>Store</h1><p id="clock">${Date.now()} ${Math.random()}</p><div class="box"></div><input value="caret"></main></body></html>`;
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page()); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cfg = path.join(dir, 'probe.json');
  fs.writeFileSync(cfg, JSON.stringify({
    schema: 'ui-audit/probe-config@3', baseUrl: `http://127.0.0.1:${server.address().port}`, target: 'disposable',
    readyMarker: { path: '/', selector: 'meta[name=ui-audit-ready]', text: 'diff-smoke' }, themes: ['light'], network: 'fast',
    settleMs: 200, warmup: false, checks: { vitals: false, contrast: false, tapTargets: false, structure: false },
    viewports: [{ id: 'm390', width: 390, height: 600, dpr: 1, mobile: true, touch: true }],
    routes: [{ id: 'home', path: '/', mask: ['#clock'] }],
  }));
  const probe = async (name) => {
    const out = path.join(dir, name);
    const child = spawn(process.execPath, [PROBE, '--config', cfg, '--out', out, '--driver', 'cdp', '--executable', SMOKE_EXE], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise((r) => child.on('exit', r));
    assert.equal(code, 0, stderr);
    return out;
  };
  try {
    const first = await probe('run1');
    const second = await probe('run2');
    variant = 'b';
    const third = await probe('run3');
    const baselineRoot = path.join(dir, 'baselines');
    const promoted = promoteBaseline({ fromDir: first, baselineRoot, baselineId: 'run-1', repo: 'diff-smoke', sourceCommit: 'abcdef1' });
    assert.equal(promoted.items[0].viewStable, true);
    assert.ok(promoted.items[0].maskedAreaPct > 0);
    approveBaseline({ baselineRoot, baselineId: 'run-1', approvedText: 'yes' });
    const same = compareRuns({ baselineDir: promoted.dir, currentDir: second, outDir: path.join(dir, 'same') });
    assert.equal(same.items[0].status, 'unchanged', JSON.stringify(same.items[0]));
    assert.equal(same.baseline.approved, true);
    const edited = compareRuns({ baselineDir: promoted.dir, currentDir: third, outDir: path.join(dir, 'edited') });
    const item = edited.items[0];
    assert.equal(item.status, 'changed', JSON.stringify(item));
    assert.equal(item.diffPixels, 120 * 60);
    assert.deepEqual(item.regions.length, 1);
    assert.equal(item.regions[0].w, 120);
    assert.equal(item.regions[0].h, 60);
    assert.ok(fs.existsSync(path.join(dir, 'edited', item.diffImage)));
  } finally {
    server.close();
  }
});

test('promoteBaseline skips captures whose steps failed and keeps unstable ones flagged; compare marks failed captures', () => {
  const root = tempDir('uidiff-failed-');
  const white = image(20, 10);
  const run = fakeRun(path.join(root, 'run'), [
    { stem: 'orders/m390.light', image: white },
    { stem: 'orders-dialog/m390.light', image: white, steps: [{ action: 'click', ok: true, error: null }, { action: 'waitFor', ok: false, error: 'selector not visible within 5000 ms: dialog[open]' }] },
    { stem: 'orders-dialog/d1440.light', image: white, steps: [{ action: 'click', ok: true, error: null }] },
    { stem: 'wobbly/m390.light', image: white, viewStable: false },
    { stem: 'listed/m390.light', image: white },
  ]);
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ captures: [{ file: 'captures/listed/m390.light.json', ok: false }] }));
  const promoted = promoteBaseline({ fromDir: run, baselineRoot: path.join(root, 'baselines'), baselineId: 'run-1', repo: 'demo-store', sourceCommit: 'abc1234' });
  assert.deepEqual(promoted.items.map((i) => i.key), ['orders-dialog/d1440.light', 'orders/m390.light', 'wobbly/m390.light']);
  assert.deepEqual(promoted.skipped, [
    { key: 'listed/m390.light', reason: 'capture_failed' },
    { key: 'orders-dialog/m390.light', reason: 'capture_failed' },
  ]);
  assert.equal(promoted.items.find((i) => i.key === 'wobbly/m390.light').viewStable, false);
  const summary = compareRuns({ baselineDir: promoted.dir, currentDir: run, outDir: path.join(root, 'diff') });
  assert.equal(summary.items.find((i) => i.key === 'orders-dialog/m390.light').currentFailed, true);
  assert.equal(summary.items.find((i) => i.key === 'orders/m390.light').currentFailed, false);
});
