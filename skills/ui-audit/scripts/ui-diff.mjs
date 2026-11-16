#!/usr/bin/env node
// ui-diff.mjs: screenshot comparison between two ui-audit runs.
//
// Compares the viewport screenshots of a probe run with an owner-approved baseline from an
// earlier run, promotes a run's screenshots to a new baseline, and records the owner's
// approval of a baseline. Plain Node 24, no dependency: PNG files are decoded and encoded
// here with the built-in zlib and a local CRC-32 table, so the result does not depend on a
// browser's colour management or canvas read-back.
//
// The per-pixel test is the published YIQ colour distance (Kotsarenko and Ramos) with an
// anti-aliasing detector after Vysniauskas, the method popularised by pixelmatch. This file
// is an independent implementation written from the published description.
//
// Safety: reads only .png and .json files under the directories it is given, refuses
// symbolic links, paths that leave those directories and any environment file (.env,
// .env.*, *.env, .envrc, .dev.vars); writes only under --out (compare) or the baseline root
// (promote, approve), with exclusive creates; makes no network call.
// See ../RUN-METADATA.md and ../VISUAL-AND-THEMING.md for how the parent uses it.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const TOOL_VERSION = '1.0.0';
export const SUMMARY_SCHEMA = 'ui-audit/diff-summary@1';
export const MANIFEST_SCHEMA = 'ui-audit/baseline@1';
export const EXIT = Object.freeze({ OK: 0, USAGE: 1, REFUSED: 2, UNREADABLE: 3, CHANGED: 4 });
export const MAX_YIQ_DELTA = 35215;
export const STATUSES = Object.freeze(['unchanged', 'within_budget', 'changed', 'size_mismatch', 'env_mismatch', 'missing_baseline', 'missing_current', 'unstable']);
export const DEFAULT_OPTIONS = Object.freeze({
  threshold: 0.2, includeAA: false, maxDiffPixels: null, maxDiffPixelRatio: 0.001, maskWarnPct: 30,
});

const MAX_PNG_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 50000000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_REGIONS = 20;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASELINE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROUTE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KEY_RE = /^([a-z0-9][a-z0-9_-]{0,63})\/([a-z0-9][a-z0-9_-]{0,31})\.(light|dark|system)$/;
const STEM_RE = /^([a-z0-9][a-z0-9_-]{0,63})\/([a-z0-9][a-z0-9_-]{0,31})\.(light|dark|system)(?:\.r([1-9]\d?))?$/;
const CAPTURE_FILE_RE = /^([a-z0-9][a-z0-9_-]{0,31})\.(light|dark|system)(?:\.r([1-9]\d?))?\.json$/;
const ENV_KEY_RE = /^[0-9a-f]{64}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const COMMIT_RE = /^[0-9a-f]{7,64}$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_APPROVED_TEXT = 2000;

/** An error that carries the exit code the CLI should use. */
export class DiffError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refused = (message) => new DiffError(EXIT.REFUSED, message);
const unreadable = (message) => new DiffError(EXIT.UNREADABLE, message);
const usage = (message) => new DiffError(EXIT.USAGE, message);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Environment files are never opened
// ---------------------------------------------------------------------------

const ENV_FILE_PATTERNS = Object.freeze([/^\.env($|[.\-_])/i, /^\.envrc$/i, /\.env$/i, /^\.dev\.vars$/i]);

/** True when any segment of the path is an environment file; such a path is never read. */
export function isForbiddenPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  return p.split(/[\\/]+/).some((seg) => seg.length > 0 && ENV_FILE_PATTERNS.some((re) => re.test(seg)));
}

// ---------------------------------------------------------------------------
// CRC-32 and PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO 3309, the one PNG uses) of a byte buffer, as an unsigned 32-bit integer. */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decodes an 8-bit, non-interlaced PNG of colour type 0, 2, 3, 4 or 6 into RGBA
 * ({width, height, data}, row-major). Every chunk CRC is checked.
 */
export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length > MAX_PNG_BYTES) throw new Error('PNG larger than 64 MiB');
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('bad signature');
  let pos = 8;
  let header = null;
  let palette = null;
  let trns = null;
  const idat = [];
  let ended = false;
  while (pos < buf.length) {
    if (pos + 12 > buf.length) throw new Error('truncated');
    const len = buf.readUInt32BE(pos);
    if (len > 0x7fffffff || pos + 12 + len > buf.length) throw new Error('truncated');
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) throw new Error('bad CRC');
    pos += 12 + len;
    if (!header && type !== 'IHDR') throw new Error('IHDR must be the first chunk');
    if (type === 'IHDR') {
      if (header) throw new Error('duplicate IHDR');
      if (len !== 13) throw new Error('bad IHDR length');
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9],
        compression: data[10], filter: data[11], interlace: data[12],
      };
      if (header.width === 0 || header.height === 0) throw new Error('empty image');
      if (header.bitDepth !== 8) throw new Error('unsupported bit depth');
      if (!(header.colorType in CHANNELS)) throw new Error('unsupported colour type');
      if (header.compression !== 0 || header.filter !== 0) throw new Error('unsupported compression or filter method');
      if (header.interlace !== 0) throw new Error('interlaced PNG not supported');
      if (header.width * header.height > MAX_PIXELS) throw new Error('image larger than 50,000,000 pixels');
    } else if (type === 'PLTE') {
      if (len % 3 !== 0 || len === 0 || len > 768) throw new Error('bad PLTE length');
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!header || !ended || idat.length === 0) throw new Error('truncated');
  const { width, height, colorType } = header;
  if (colorType === 3 && !palette) throw new Error('palette image without PLTE');
  const bpp = CHANNELS[colorType];
  const stride = width * bpp;
  const expected = height * (stride + 1);
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch (e) {
    if (/unexpected end|incomplete|truncated/i.test(String(e && e.message))) throw new Error('truncated');
    throw new Error('corrupt image data');
  }
  if (raw.length < expected) throw new Error('truncated');
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    const up = out - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? pixels[out + i - bpp] : 0;
      const b = y > 0 ? pixels[up + i] : 0;
      const c = y > 0 && i >= bpp ? pixels[up + i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error('bad filter type');
      }
      pixels[out + i] = v & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  const n = width * height;
  if (colorType === 6) {
    data.set(pixels);
  } else if (colorType === 2) {
    const key = trns && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
    for (let p = 0; p < n; p++) {
      const r = pixels[p * 3];
      const g = pixels[p * 3 + 1];
      const b = pixels[p * 3 + 2];
      data[p * 4] = r; data[p * 4 + 1] = g; data[p * 4 + 2] = b;
      data[p * 4 + 3] = key && key[0] === r && key[1] === g && key[2] === b ? 0 : 255;
    }
  } else if (colorType === 0) {
    const key = trns && trns.length >= 2 ? trns.readUInt16BE(0) : null;
    for (let p = 0; p < n; p++) {
      const g = pixels[p];
      data[p * 4] = g; data[p * 4 + 1] = g; data[p * 4 + 2] = g;
      data[p * 4 + 3] = key === g ? 0 : 255;
    }
  } else if (colorType === 4) {
    for (let p = 0; p < n; p++) {
      const g = pixels[p * 2];
      data[p * 4] = g; data[p * 4 + 1] = g; data[p * 4 + 2] = g;
      data[p * 4 + 3] = pixels[p * 2 + 1];
    }
  } else {
    const entries = palette.length / 3;
    for (let p = 0; p < n; p++) {
      const idx = pixels[p];
      if (idx >= entries) throw new Error('palette index out of range');
      data[p * 4] = palette[idx * 3]; data[p * 4 + 1] = palette[idx * 3 + 1]; data[p * 4 + 2] = palette[idx * 3 + 2];
      data[p * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width, height, data };
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes RGBA pixels as an 8-bit colour type 6 PNG (filter 0 on every row, deflate level 6). */
export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('width and height must be positive integers');
  if (width * height > MAX_PIXELS) throw new Error('image larger than 50,000,000 pixels');
  if (!data || data.length !== width * height * 4) throw new Error('data must hold width*height*4 bytes');
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Pixel comparison
// ---------------------------------------------------------------------------

const toY = (r, g, b) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
const toI = (r, g, b) => r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
const toQ = (r, g, b) => r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
const onWhite = (c, a) => 255 + ((c - 255) * a) / 255;

/**
 * Perceptual difference of two RGBA pixels (channels and alpha 0..255): both are first
 * composited on white, then the weighted squared distance in YIQ is returned (0..35215).
 */
export function yiqDelta(r1, g1, b1, a1, r2, g2, b2, a2) {
  if (r1 === r2 && g1 === g2 && b1 === b2 && a1 === a2) return 0;
  if (a1 < 255) { r1 = onWhite(r1, a1); g1 = onWhite(g1, a1); b1 = onWhite(b1, a1); }
  if (a2 < 255) { r2 = onWhite(r2, a2); g2 = onWhite(g2, a2); b2 = onWhite(b2, a2); }
  const dy = toY(r1, g1, b1) - toY(r2, g2, b2);
  const di = toI(r1, g1, b1) - toI(r2, g2, b2);
  const dq = toQ(r1, g1, b1) - toQ(r2, g2, b2);
  return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
}

function lumaAt(d, o) {
  const a = d[o + 3];
  if (a === 255) return toY(d[o], d[o + 1], d[o + 2]);
  return toY(onWhite(d[o], a), onWhite(d[o + 1], a), onWhite(d[o + 2], a));
}

function samePixel(d, o1, o2) {
  return d[o1] === d[o2] && d[o1 + 1] === d[o2 + 1] && d[o1 + 2] === d[o2 + 2] && d[o1 + 3] === d[o2 + 3];
}

/** True when at least 3 of the 8 neighbours of (x, y) have exactly the same RGBA value. */
function inFlatArea(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
  const { width, height, data } = img;
  const o = (y * width + x) * 4;
  let same = 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
      if (nx === x && ny === y) continue;
      if (samePixel(data, o, (ny * width + nx) * 4) && ++same >= 3) return true;
    }
  }
  return false;
}

/**
 * Anti-aliasing test for pixel (x, y) of img: among its 3x3 neighbours at most two share its
 * brightness, some are darker and some brighter, and the darkest or the brightest neighbour
 * sits in a flat area (>= 3 identical neighbours) in both img and other.
 */
export function isAntialiased(img, x, y, other) {
  const { width, height, data } = img;
  const o = (y * width + x) * 4;
  const centre = lumaAt(data, o);
  let equal = 0;
  let darkest = 0;
  let brightest = 0;
  let dx = -1; let dy = -1; let bx = -1; let by = -1;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
      if (nx === x && ny === y) continue;
      const delta = lumaAt(data, (ny * width + nx) * 4) - centre;
      if (delta === 0) {
        equal += 1;
        if (equal > 2) return false;
      } else if (delta < darkest) {
        darkest = delta; dx = nx; dy = ny;
      } else if (delta > brightest) {
        brightest = delta; bx = nx; by = ny;
      }
    }
  }
  if (darkest === 0 || brightest === 0) return false;
  return (inFlatArea(img, dx, dy) && inFlatArea(other, dx, dy)) || (inFlatArea(img, bx, by) && inFlatArea(other, bx, by));
}

function padImage(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * width * 4);
  return { width, height, data };
}

function runsOf(flags, from, to, gap) {
  const out = [];
  let start = -1;
  let last = -1;
  for (let i = from; i < to; i++) {
    if (!flags[i]) continue;
    if (start >= 0 && i - last - 1 <= gap) { last = i; continue; }
    if (start >= 0) out.push([start, last]);
    start = i;
    last = i;
  }
  if (start >= 0) out.push([start, last]);
  return out;
}

/** Bounding boxes of differing areas by row/column projection (two passes), largest 20 kept. */
export function diffRegions(mask, width, height, limit = MAX_REGIONS) {
  const rowHas = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (mask[y * width + x]) { rowHas[y] = 1; break; }
  }
  const boxes = [];
  for (const [y0, y1] of runsOf(rowHas, 0, height, 2)) {
    const colHas = new Uint8Array(width);
    for (let y = y0; y <= y1; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) colHas[x] = 1;
    for (const [x0, x1] of runsOf(colHas, 0, width, 2)) {
      const inner = new Uint8Array(height);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask[y * width + x]) { inner[y] = 1; break; }
      for (const [ry0, ry1] of runsOf(inner, y0, y1 + 1, 2)) boxes.push({ x: x0, y: ry0, w: x1 - x0 + 1, h: ry1 - ry0 + 1 });
    }
  }
  return boxes.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, limit).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Compares two RGBA images. A pixel differs when its YIQ delta exceeds 35215 * threshold^2;
 * unless includeAA is set, a differing pixel that is anti-aliased in either image is counted
 * as aaPixels instead. Different sizes are compared on the padded union (transparent fill)
 * and flagged sizeMismatch. The diff image shows unchanged pixels as faded grey, anti-aliased
 * ones yellow and differing ones red.
 */
export function comparePixels(a, b, { threshold = 0.2, includeAA = false, diffImage = true } = {}) {
  if (!(threshold >= 0 && threshold <= 1)) throw new Error('threshold must be between 0 and 1');
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const sizeMismatch = a.width !== b.width || a.height !== b.height;
  const A = padImage(a, width, height);
  const B = padImage(b, width, height);
  const total = width * height;
  const out = diffImage ? new Uint8Array(total * 4) : null;
  const paintGrey = (o) => {
    const v = Math.round(255 + (lumaAt(A.data, o) - 255) * 0.1);
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
  };
  const identical = !sizeMismatch && Buffer.from(A.data.buffer, A.data.byteOffset, A.data.length).equals(Buffer.from(B.data.buffer, B.data.byteOffset, B.data.length));
  if (identical) {
    if (out) for (let p = 0; p < total; p++) paintGrey(p * 4);
    return { width, height, diffPixels: 0, aaPixels: 0, ratio: 0, sizeMismatch: false, regions: [], diff: out ? { width, height, data: out } : null };
  }
  const limit = MAX_YIQ_DELTA * threshold * threshold;
  const mask = new Uint8Array(total);
  let diffPixels = 0;
  let aaPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const o = p * 4;
      const ad = A.data;
      const bd = B.data;
      const delta = yiqDelta(ad[o], ad[o + 1], ad[o + 2], ad[o + 3], bd[o], bd[o + 1], bd[o + 2], bd[o + 3]);
      if (delta > limit) {
        if (!includeAA && (isAntialiased(A, x, y, B) || isAntialiased(B, x, y, A))) {
          aaPixels += 1;
          if (out) { out[o] = 255; out[o + 1] = 255; out[o + 2] = 0; out[o + 3] = 255; }
        } else {
          diffPixels += 1;
          mask[p] = 1;
          if (out) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255; }
        }
      } else if (out) paintGrey(o);
    }
  }
  return {
    width, height, diffPixels, aaPixels, ratio: total ? diffPixels / total : 0, sizeMismatch,
    regions: diffPixels ? diffRegions(mask, width, height) : [], diff: out ? { width, height, data: out } : null,
  };
}

/**
 * Image-level budget: the smaller of maxDiffPixels and width*height*maxDiffPixelRatio when
 * both are set, the one that is set, else 0. A size mismatch is never within budget.
 */
export function withinBudget(result, { maxDiffPixels = null, maxDiffPixelRatio = null } = {}) {
  if (!result || result.sizeMismatch) return false;
  const limits = [];
  if (maxDiffPixels !== null && maxDiffPixels !== undefined) limits.push(maxDiffPixels);
  if (maxDiffPixelRatio !== null && maxDiffPixelRatio !== undefined) limits.push(result.width * result.height * maxDiffPixelRatio);
  const budget = limits.length ? Math.min(...limits) : 0;
  return result.diffPixels <= budget;
}

/** "<routeId>/<viewportId>.<theme>" from a probe capture stem (the .r<k> repeat suffix is dropped); null when malformed. */
export function captureKey(stem) {
  const m = typeof stem === 'string' ? STEM_RE.exec(stem) : null;
  if (!m || WINDOWS_DEVICE.test(m[1]) || WINDOWS_DEVICE.test(m[2])) return null;
  return `${m[1]}/${m[2]}.${m[3]}`;
}

/** The env key a probe capture recorded (env.envKey), or null when absent or malformed. */
export function envKeyOf(captureJson) {
  const key = isPlainObject(captureJson) && isPlainObject(captureJson.env) ? captureJson.env.envKey : null;
  return typeof key === 'string' && ENV_KEY_RE.test(key) ? key : null;
}

/**
 * Proves the comparator on known data before any real comparison: CRC of a reference string,
 * PNG round trip of a 4x4 image, a self-comparison (0 differing pixels) and a one-pixel change
 * (exactly 1 differing pixel).
 */
export function selfTest() {
  try {
    if (crc32(Buffer.from('123456789', 'latin1')) !== 0xcbf43926) return { ok: false, detail: 'CRC-32 reference value mismatch' };
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height * 4).fill(255);
    data.set([0, 0, 255, 255], (3 * width + 3) * 4);
    data.set([10, 200, 30, 128], (0 * width + 3) * 4);
    data.set([90, 90, 90, 255], (3 * width + 0) * 4);
    const decoded = decodePng(encodePng({ width, height, data }));
    if (decoded.width !== width || decoded.height !== height || !Buffer.from(decoded.data).equals(Buffer.from(data))) return { ok: false, detail: 'PNG round trip changed the pixels' };
    const same = comparePixels(decoded, { width, height, data }, { diffImage: true });
    if (same.diffPixels !== 0 || same.aaPixels !== 0) return { ok: false, detail: `self-comparison found ${same.diffPixels} differing pixels` };
    const changed = new Uint8Array(data);
    changed.set([0, 0, 0, 255], 0);
    const one = comparePixels(decoded, { width, height, data: changed }, { diffImage: true });
    if (one.diffPixels !== 1) return { ok: false, detail: `one-pixel change gave ${one.diffPixels} differing pixels` };
    if (yiqDelta(1, 2, 3, 255, 1, 2, 3, 255) !== 0) return { ok: false, detail: 'yiqDelta of equal pixels is not 0' };
    return { ok: true, detail: 'crc32, png round trip, self-comparison 0, one-pixel change 1' };
  } catch (e) {
    return { ok: false, detail: `self-test threw: ${e && e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Files: confined reads, exclusive writes
// ---------------------------------------------------------------------------

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** An existing, absolute, plain (non-symlink) directory, or a refusal. */
function plainDir(dir, label) {
  if (typeof dir !== 'string' || dir.length === 0 || dir.includes('\0') || !path.isAbsolute(dir)) throw refused(`${label} must be an absolute path`);
  const resolved = path.resolve(dir);
  if (isForbiddenPath(resolved)) throw refused(`${label} names an environment file`);
  const st = lstatOrNull(resolved);
  if (!st) throw usage(`${label} does not exist: ${resolved}`);
  if (st.isSymbolicLink()) throw refused(`${label} is a symbolic link`);
  if (!st.isDirectory()) throw usage(`${label} is not a directory`);
  return resolved;
}

/**
 * Resolves rel under base: never outside base, never through a symbolic link, never an
 * environment file, only .png or .json. Returns {abs, exists}.
 */
function confined(base, rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0') || path.isAbsolute(rel)) throw refused(`unsafe relative path: ${String(rel).slice(0, 120)}`);
  if (!/\.(?:png|json)$/i.test(rel)) throw refused(`only .png and .json files are read: ${rel.slice(0, 120)}`);
  const abs = path.resolve(base, rel);
  if (!isInside(base, abs)) throw refused(`path leaves its directory: ${rel.slice(0, 120)}`);
  if (isForbiddenPath(path.relative(base, abs))) throw refused('refused to read an environment file');
  let current = base;
  for (const part of path.relative(base, abs).split(path.sep)) {
    current = path.join(current, part);
    const st = lstatOrNull(current);
    if (!st) return { abs, exists: false };
    if (st.isSymbolicLink()) throw refused(`symbolic link refused: ${path.relative(base, current)}`);
  }
  return { abs, exists: true };
}

function readConfined(base, rel, maxBytes) {
  const { abs, exists } = confined(base, rel);
  if (!exists) return null;
  const st = fs.lstatSync(abs);
  if (!st.isFile()) throw refused(`not a regular file: ${rel}`);
  if (st.size > maxBytes) throw unreadable(`${rel} is larger than ${maxBytes} bytes`);
  return fs.readFileSync(abs);
}

function readJsonConfined(base, rel) {
  const buf = readConfined(base, rel, MAX_JSON_BYTES);
  if (buf === null) return null;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { throw unreadable(`${rel} is not valid UTF-8`); }
  try { return JSON.parse(text); } catch { throw unreadable(`${rel} is not valid JSON`); }
}

function decodeConfined(base, rel) {
  const buf = readConfined(base, rel, MAX_PNG_BYTES);
  if (buf === null) return null;
  try { return decodePng(buf); } catch (e) { throw unreadable(`${rel}: ${e.message}`); }
}

function gitAncestor(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (lstatOrNull(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

/** Creates the directories of rel under base one by one, refusing anything that is not a plain directory. */
function ensureDirUnder(base, relDir) {
  let current = base;
  for (const part of relDir.split(/[\\/]+/).filter(Boolean)) {
    current = path.join(current, part);
    const st = lstatOrNull(current);
    if (!st) fs.mkdirSync(current);
    else if (st.isSymbolicLink() || !st.isDirectory()) throw refused(`${current} is not a plain directory`);
  }
}

function writeExclusiveUnder(base, rel, data) {
  const abs = path.resolve(base, rel);
  if (!isInside(base, abs) || isForbiddenPath(rel)) throw refused(`refused write: ${rel}`);
  ensureDirUnder(base, path.dirname(rel));
  try { fs.writeFileSync(abs, data, { flag: 'wx' }); } catch (e) {
    if (e && e.code === 'EEXIST') throw refused(`refused to overwrite ${rel}`);
    throw e;
  }
}

/** Prepares --out: absolute, absent or an empty plain directory, outside git unless allowed. */
function prepareOutDir(outDir, allowInsideGit) {
  if (typeof outDir !== 'string' || outDir.length === 0 || outDir.includes('\0') || !path.isAbsolute(outDir)) throw refused('--out must be an absolute path');
  const resolved = path.resolve(outDir);
  if (path.dirname(resolved) === resolved) throw refused('--out must not be a filesystem root');
  if (isForbiddenPath(resolved)) throw refused('--out names an environment file');
  const st = lstatOrNull(resolved);
  if (st) {
    if (st.isSymbolicLink() || !st.isDirectory()) throw refused('--out exists and is not a plain directory');
    if (fs.readdirSync(resolved).length > 0) throw refused('--out already has content; use a new directory');
  }
  if (!allowInsideGit) {
    const repo = gitAncestor(st ? resolved : path.dirname(resolved));
    if (repo) throw refused(`--out is inside a git working tree (${repo}); pass --allow-inside-git only if that directory is ignored`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Runs and baselines
// ---------------------------------------------------------------------------

function maskedAreaOf(capture) {
  const masks = isPlainObject(capture) && Array.isArray(capture.masks) ? capture.masks : [];
  const sum = masks.reduce((s, m) => s + (isPlainObject(m) && Number.isFinite(m.areaPct) ? Math.max(0, m.areaPct) : 0), 0);
  return Math.min(100, Math.round(sum * 100) / 100);
}

/**
 * The view screenshots of a probe out directory, one per key: captures/<routeId>/<viewport>.<theme>[.r<k>].json
 * with its .view.png next to it. With repeated captures the lowest repeat index (r1) is used.
 */
export function listRunCaptures(runDir) {
  const base = plainDir(runDir, 'probe out directory');
  const capturesDir = path.join(base, 'captures');
  const st = lstatOrNull(capturesDir);
  const found = new Map();
  if (!st) return found;
  if (st.isSymbolicLink() || !st.isDirectory()) throw refused('captures/ is not a plain directory');
  for (const routeId of fs.readdirSync(capturesDir).sort()) {
    if (!ROUTE_ID_RE.test(routeId) || WINDOWS_DEVICE.test(routeId)) continue;
    const routeDir = path.join(capturesDir, routeId);
    const rst = lstatOrNull(routeDir);
    if (!rst || rst.isSymbolicLink() || !rst.isDirectory()) continue;
    for (const name of fs.readdirSync(routeDir).sort()) {
      const m = CAPTURE_FILE_RE.exec(name);
      if (!m || isForbiddenPath(name)) continue;
      const repeat = m[3] ? Number(m[3]) : 0;
      const stem = `${routeId}/${name.slice(0, -'.json'.length)}`;
      const key = captureKey(stem);
      if (!key) continue;
      const previous = found.get(key);
      if (previous && previous.repeat <= repeat) continue;
      found.set(key, { key, stem, repeat, json: `captures/${stem}.json`, view: `captures/${stem}.view.png` });
    }
  }
  // The probe's summary.json, when present, says which captures failed (a step failed or the
  // capture threw); the capture's own steps[] say the same for a run without a summary.
  const failedFiles = new Set();
  const summary = lstatOrNull(path.join(base, 'summary.json')) ? readJsonConfined(base, 'summary.json') : null;
  if (isPlainObject(summary) && Array.isArray(summary.captures)) {
    for (const c of summary.captures) if (isPlainObject(c) && c.ok === false && typeof c.file === 'string') failedFiles.add(c.file);
  }
  for (const entry of found.values()) {
    entry.capture = readJsonConfined(base, entry.json);
    const steps = isPlainObject(entry.capture) && Array.isArray(entry.capture.steps) ? entry.capture.steps : [];
    entry.failed = failedFiles.has(entry.json) || steps.some((st) => isPlainObject(st) && st.ok === false);
    const v = confined(base, entry.view);
    entry.viewExists = v.exists && entry.capture && entry.capture.screenshots ? entry.capture.screenshots.view !== null : v.exists;
  }
  return found;
}

function readManifest(baselineDir) {
  const manifest = readJsonConfined(baselineDir, 'manifest.json');
  if (manifest === null) throw usage(`no manifest.json in ${baselineDir}`);
  if (!isPlainObject(manifest) || manifest.schema !== MANIFEST_SCHEMA || !Array.isArray(manifest.items)) throw unreadable(`manifest.json is not a ${MANIFEST_SCHEMA} manifest`);
  const items = new Map();
  for (const item of manifest.items) {
    if (!isPlainObject(item) || typeof item.key !== 'string' || !KEY_RE.test(item.key)) throw unreadable('manifest.json has an item with a malformed key');
    if (item.file !== `captures/${item.key}.view.png`) throw unreadable(`manifest.json item ${item.key} has an unexpected file path`);
    items.set(item.key, item);
  }
  return { manifest, items };
}

function normaliseOptions(options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) };
  if (!(typeof o.threshold === 'number' && o.threshold >= 0 && o.threshold <= 1)) throw usage('threshold must be a number from 0 to 1');
  if (o.maxDiffPixelRatio !== null && !(typeof o.maxDiffPixelRatio === 'number' && o.maxDiffPixelRatio >= 0 && o.maxDiffPixelRatio <= 1)) throw usage('maxDiffPixelRatio must be a number from 0 to 1');
  if (o.maxDiffPixels !== null && !(Number.isInteger(o.maxDiffPixels) && o.maxDiffPixels >= 0)) throw usage('maxDiffPixels must be a non-negative integer');
  if (!(typeof o.maskWarnPct === 'number' && o.maskWarnPct >= 0 && o.maskWarnPct <= 100)) throw usage('maskWarnPct must be a number from 0 to 100');
  o.includeAA = !!o.includeAA;
  o.diffImages = o.diffImages !== false;
  if (o.only !== undefined && o.only !== null) {
    if (!Array.isArray(o.only) || o.only.some((k) => typeof k !== 'string' || !KEY_RE.test(k))) throw usage('only must list keys like home/m390.light');
  } else o.only = null;
  return o;
}

/**
 * Compares a probe run with a baseline and writes <out>/diff-summary.json (and diff images
 * under <out>/diffs/). Nothing is written when the comparator self-test fails or an input PNG
 * cannot be decoded.
 */
export function compareRuns({ baselineDir, currentDir, outDir, options = {} }) {
  const opts = normaliseOptions(options);
  const check = selfTest();
  if (!check.ok) throw unreadable(`comparator self-test failed: ${check.detail}`);
  const base = plainDir(baselineDir, '--baseline');
  const current = plainDir(currentDir, '--current');
  const out = prepareOutDir(outDir, !!opts.allowInsideGit);
  const { manifest, items: baselineItems } = readManifest(base);
  const run = listRunCaptures(current);
  let keys = [...new Set([...baselineItems.keys(), ...run.keys()])].sort();
  if (opts.only) keys = keys.filter((k) => opts.only.includes(k));
  const results = [];
  const images = [];
  for (const key of keys) {
    const b = baselineItems.get(key) || null;
    const c = run.get(key) || null;
    const baselineEnvKey = b && typeof b.envKey === 'string' && ENV_KEY_RE.test(b.envKey) ? b.envKey : null;
    const currentEnvKey = c ? envKeyOf(c.capture) : null;
    const maskedAreaPct = Math.max(c ? maskedAreaOf(c.capture) : 0, b && Number.isFinite(b.maskedAreaPct) ? b.maskedAreaPct : 0);
    const item = {
      key, status: null, width: null, height: null, diffPixels: null, aaPixels: null, ratio: null, regions: [], diffImage: null,
      baselineEnvKey, currentEnvKey, maskedAreaPct, lowValue: maskedAreaPct > opts.maskWarnPct,
      currentFailed: !!(c && c.failed),
    };
    results.push(item);
    const baselineFile = b ? confined(base, b.file) : null;
    if (!c || !c.viewExists) { item.status = 'missing_current'; continue; }
    if (!b || !baselineFile.exists) { item.status = 'missing_baseline'; continue; }
    // Different rendering environments are never compared: their pixels may differ for
    // reasons no code change caused (fonts, browser version, DPR, flags).
    if (!baselineEnvKey || !currentEnvKey || baselineEnvKey !== currentEnvKey) { item.status = 'env_mismatch'; continue; }
    const imgB = decodeConfined(base, b.file);
    const imgC = decodeConfined(current, c.view);
    const r = comparePixels(imgB, imgC, { threshold: opts.threshold, includeAA: opts.includeAA, diffImage: opts.diffImages });
    Object.assign(item, { width: r.width, height: r.height, diffPixels: r.diffPixels, aaPixels: r.aaPixels, ratio: Math.round(r.ratio * 1e6) / 1e6, regions: r.regions });
    const unstable = (c.capture && c.capture.screenshots && c.capture.screenshots.viewStable === false) || b.viewStable === false;
    if (unstable) item.status = 'unstable';
    else if (r.sizeMismatch) item.status = 'size_mismatch';
    else if (r.diffPixels === 0) item.status = 'unchanged';
    else if (withinBudget(r, opts)) item.status = 'within_budget';
    else item.status = 'changed';
    if (opts.diffImages && r.diff && (r.diffPixels > 0 || r.sizeMismatch)) {
      item.diffImage = `diffs/${key}.diff.png`;
      images.push([item.diffImage, encodePng(r.diff)]);
    }
  }
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const item of results) counts[item.status] += 1;
  const summary = {
    schema: SUMMARY_SCHEMA, toolVersion: TOOL_VERSION,
    baseline: { id: manifest.id ?? null, dir: base, approved: manifest.approved_by_owner === true, approved_at: manifest.approved_at ?? null },
    current: { dir: current },
    options: { threshold: opts.threshold, includeAA: opts.includeAA, maxDiffPixels: opts.maxDiffPixels, maxDiffPixelRatio: opts.maxDiffPixelRatio, maskWarnPct: opts.maskWarnPct },
    selfTest: 'passed',
    items: results,
    counts,
  };
  fs.mkdirSync(out, { recursive: true });
  for (const [rel, png] of images) writeExclusiveUnder(out, rel, png);
  writeExclusiveUnder(out, 'diff-summary.json', `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

/** Attaches where a manifest lives (and what was skipped) without changing its JSON form. */
function withLocation(manifest, dir, skipped = []) {
  Object.defineProperties(manifest, { dir: { value: dir, enumerable: false }, skipped: { value: skipped, enumerable: false } });
  return manifest;
}

/**
 * Copies a probe run's view screenshots into <baselineRoot>/<baselineId>/ with a manifest and
 * returns the manifest (non-enumerable extras: dir, and skipped [{key, reason}] for captures
 * without a view screenshot or whose steps failed).
 * The new baseline is unapproved; only approveBaseline (after the owner's yes) approves it.
 */
export function promoteBaseline({ fromDir, baselineRoot, baselineId, repo, sourceCommit, allowInsideGit = false, now = () => new Date() }) {
  if (typeof baselineId !== 'string' || !BASELINE_ID_RE.test(baselineId) || WINDOWS_DEVICE.test(baselineId)) throw usage('--baseline-id must match ^[a-z0-9][a-z0-9_-]{0,63}$');
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw usage('--repo must be a short name of letters, digits, dot, dash or underscore');
  if (typeof sourceCommit !== 'string' || !COMMIT_RE.test(sourceCommit)) throw usage('--source-commit must be a lowercase hex commit id (7 to 64 characters)');
  const from = plainDir(fromDir, '--from');
  if (typeof baselineRoot !== 'string' || !path.isAbsolute(baselineRoot) || baselineRoot.includes('\0')) throw refused('--baseline-root must be an absolute path');
  const root = path.resolve(baselineRoot);
  if (isForbiddenPath(root)) throw refused('--baseline-root names an environment file');
  const rootStat = lstatOrNull(root);
  if (rootStat && (rootStat.isSymbolicLink() || !rootStat.isDirectory())) throw refused('--baseline-root is not a plain directory');
  if (!allowInsideGit) {
    const repoDir = gitAncestor(rootStat ? root : path.dirname(root));
    if (repoDir) throw refused(`--baseline-root is inside a git working tree (${repoDir}); pass --allow-inside-git only if that directory is ignored`);
  }
  const dest = path.join(root, baselineId);
  if (lstatOrNull(dest)) throw refused(`baseline ${baselineId} already exists; choose a new id`);
  const run = listRunCaptures(from);
  const items = [];
  const copies = [];
  const skipped = [];
  for (const [key, c] of [...run.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!c.viewExists) { skipped.push({ key, reason: 'no_view_screenshot' }); continue; }
    // A capture whose steps failed does not show the state its key names, so it never becomes
    // a baseline item; an unstable one is kept and flagged with viewStable false.
    if (c.failed) { skipped.push({ key, reason: 'capture_failed' }); continue; }
    const img = decodeConfined(from, c.view);
    const file = `captures/${key}.view.png`;
    copies.push([file, readConfined(from, c.view, MAX_PNG_BYTES)]);
    items.push({
      key, file, envKey: envKeyOf(c.capture), width: img.width, height: img.height,
      viewStable: !!(c.capture && c.capture.screenshots && c.capture.screenshots.viewStable === true),
      maskedAreaPct: maskedAreaOf(c.capture),
    });
  }
  if (items.length === 0) throw usage('the probe run has no view screenshots to promote');
  const manifest = {
    schema: MANIFEST_SCHEMA, id: baselineId, repo, created_at: now().toISOString(), source_run: from, source_commit: sourceCommit,
    approved_by_owner: false, approved_at: null, approved_text: null, items,
  };
  fs.mkdirSync(root, { recursive: true });
  try { fs.mkdirSync(dest); } catch (e) {
    if (e && e.code === 'EEXIST') throw refused(`baseline ${baselineId} already exists; choose a new id`);
    throw e;
  }
  for (const [rel, data] of copies) writeExclusiveUnder(dest, rel, data);
  writeExclusiveUnder(dest, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return withLocation(manifest, dest, skipped);
}

/** Text of the owner's approval: trimmed of one trailing newline, 1..2000 characters, no NUL. */
export function checkApprovedText(text) {
  if (typeof text !== 'string') return { ok: false, text: null, reason: 'approved text must be a string' };
  const t = text.replace(/\r?\n$/, '');
  const length = [...t].length;
  if (length < 1 || length > MAX_APPROVED_TEXT) return { ok: false, text: null, reason: `approved text must have 1 to ${MAX_APPROVED_TEXT} characters` };
  if (t.includes('\0')) return { ok: false, text: null, reason: 'approved text must not contain NUL' };
  return { ok: true, text: t, reason: null };
}

/** Reads --approved-text-file: absolute, a regular file (no symlink), not an environment file, valid UTF-8. */
export function readApprovedTextFile(file) {
  if (typeof file !== 'string' || file.length === 0 || file.includes('\0') || !path.isAbsolute(file)) throw refused('--approved-text-file must be an absolute path');
  if (isForbiddenPath(file)) throw refused('--approved-text-file names an environment file');
  const st = lstatOrNull(file);
  if (!st) throw refused('--approved-text-file does not exist');
  if (st.isSymbolicLink() || !st.isFile()) throw refused('--approved-text-file must be a regular file (no symbolic link)');
  if (st.size > MAX_APPROVED_TEXT * 4 + 2) throw refused(`--approved-text-file is longer than ${MAX_APPROVED_TEXT} characters`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)); } catch { throw refused('--approved-text-file is not valid UTF-8'); }
  const checked = checkApprovedText(text);
  if (!checked.ok) throw refused(`--approved-text-file: ${checked.reason}`);
  return checked.text;
}

/** Marks a baseline approved with the owner's own words and returns the manifest. An approved baseline is never re-approved. */
export function approveBaseline({ baselineRoot, baselineId, approvedText, now = () => new Date() }) {
  if (typeof baselineId !== 'string' || !BASELINE_ID_RE.test(baselineId)) throw usage('--baseline-id must match ^[a-z0-9][a-z0-9_-]{0,63}$');
  const checked = checkApprovedText(approvedText);
  if (!checked.ok) throw refused(checked.reason);
  const root = plainDir(baselineRoot, '--baseline-root');
  const dirInfo = confined(root, `${baselineId}/manifest.json`);
  if (!dirInfo.exists) throw usage(`baseline ${baselineId} has no manifest.json`);
  const dir = path.join(root, baselineId);
  const { manifest } = readManifest(dir);
  if (manifest.approved_by_owner === true) throw refused(`baseline ${baselineId} is already approved`);
  manifest.approved_by_owner = true;
  manifest.approved_at = now().toISOString();
  manifest.approved_text = checked.text;
  const tmp = `manifest.json.approve-${process.pid}-${Date.now()}.json`;
  writeExclusiveUnder(dir, tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(path.join(dir, tmp), path.join(dir, 'manifest.json'));
  return withLocation(manifest, dir);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `ui-diff.mjs: screenshot comparison between ui-audit runs (no network, no dependency)

Usage:
  node scripts/ui-diff.mjs --baseline <baseline-dir> --current <probe-out-dir> --out <abs-dir>
       [--threshold 0.2] [--include-aa] [--max-diff-pixel-ratio 0.001] [--max-diff-pixels <n>]
       [--mask-warn-pct 30] [--only <key,key>] [--no-diff-images] [--allow-inside-git]
  node scripts/ui-diff.mjs --promote --from <probe-out-dir> --baseline-root <dir> --baseline-id <id>
       --repo <name> --source-commit <sha> [--allow-inside-git]
  node scripts/ui-diff.mjs --approve --baseline-root <dir> --baseline-id <id>
       (--approved-text-file <abs path> | --approved-text <text>)
  node scripts/ui-diff.mjs --self-test
  node scripts/ui-diff.mjs --help

Compare: every key "<routeId>/<viewportId>.<theme>" of the baseline and of the probe run gets a
status: unchanged, within_budget, changed, size_mismatch, env_mismatch (different rendering
environment, never compared), missing_baseline, missing_current or unstable (a screenshot that
never settled). A pixel differs when its YIQ distance exceeds 35215 * threshold^2;
anti-aliased pixels are counted apart unless --include-aa. The image budget is the smaller of
--max-diff-pixels and width*height*--max-diff-pixel-ratio. Items whose masks cover more than
--mask-warn-pct percent of the viewport are flagged lowValue. Writes <out>/diff-summary.json
and red/yellow/grey diff images under <out>/diffs/.

Promote copies the run's view screenshots into <baseline-root>/<id>/ with manifest.json; the
new baseline is unapproved. Approve records the owner's words (use --approved-text-file so
quotes and accents never pass through a shell); only an approved baseline backs an expectation.

Exit codes: 0 compared and nothing over budget (or promote, approve, self-test succeeded),
            1 usage error, 2 refused (unsafe path, existing output or baseline id, symlink,
            output inside git without --allow-inside-git, environment-file name),
            3 self-test failed or an input PNG is unreadable or unsupported,
            4 at least one item changed or size_mismatch.`;

const VALUE_FLAGS = {
  '--baseline': 'baseline', '--current': 'current', '--out': 'out', '--threshold': 'threshold',
  '--max-diff-pixel-ratio': 'maxDiffPixelRatio', '--max-diff-pixels': 'maxDiffPixels', '--mask-warn-pct': 'maskWarnPct',
  '--only': 'only', '--from': 'from', '--baseline-root': 'baselineRoot', '--baseline-id': 'baselineId', '--repo': 'repo',
  '--source-commit': 'sourceCommit', '--approved-text-file': 'approvedTextFile', '--approved-text': 'approvedText',
};
const BOOL_FLAGS = {
  '--include-aa': 'includeAA', '--no-diff-images': 'noDiffImages', '--allow-inside-git': 'allowInsideGit',
  '--promote': 'promote', '--approve': 'approve', '--self-test': 'selfTest', '--help': 'help', '-h': 'help',
};
const MODE_FLAGS = {
  compare: ['baseline', 'current', 'out', 'threshold', 'maxDiffPixelRatio', 'maxDiffPixels', 'maskWarnPct', 'only', 'includeAA', 'noDiffImages', 'allowInsideGit'],
  promote: ['from', 'baselineRoot', 'baselineId', 'repo', 'sourceCommit', 'allowInsideGit'],
  approve: ['baselineRoot', 'baselineId', 'approvedTextFile', 'approvedText'],
  selfTest: [],
  help: [],
};

const printable = (v, max = 200) => {
  const s = String(v).replace(/[\u0000-\u001f\u007f-\u009f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return s.length > max ? `${s.slice(0, max)}...` : s;
};

function parseNumber(flag, value, { integer = false, min, max }) {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
    throw usage(`${flag} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
  }
  return n;
}

/** Parses the command line into {mode, options}; throws a DiffError(1) on a usage error. */
export function parseArgs(argv) {
  const o = {};
  const list = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < list.length; i++) {
    let flag = list[i];
    let value;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 2) { value = flag.slice(eq + 1); flag = flag.slice(0, eq); }
    if (Object.prototype.hasOwnProperty.call(BOOL_FLAGS, flag)) {
      if (value !== undefined) throw usage(`${flag} takes no value`);
      o[BOOL_FLAGS[flag]] = true;
    } else if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, flag)) {
      if (value === undefined) {
        value = list[i + 1];
        if (value === undefined || (value.startsWith('--') && flag !== '--approved-text')) throw usage(`${flag} needs a value`);
        i += 1;
      }
      const key = VALUE_FLAGS[flag];
      if (o[key] !== undefined) throw usage(`${flag} given more than once`);
      o[key] = value;
    } else {
      throw usage(`unknown argument: ${printable(flag, 80)}`);
    }
  }
  if (o.help) return { mode: 'help', options: o };
  const modes = ['promote', 'approve', 'selfTest'].filter((m) => o[m]);
  if (modes.length > 1) throw usage('use only one of --promote, --approve, --self-test');
  const mode = modes[0] || 'compare';
  for (const k of Object.keys(o)) {
    if (k === mode) continue;
    if (!MODE_FLAGS[mode].includes(k)) throw usage(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} does not apply to ${mode === 'selfTest' ? '--self-test' : mode === 'compare' ? 'a comparison' : `--${mode}`}`);
  }
  const need = (keys) => { for (const k of keys) if (o[k] === undefined) throw usage(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`); };
  if (mode === 'compare') {
    need(['baseline', 'current', 'out']);
    if (o.threshold !== undefined) o.threshold = parseNumber('--threshold', o.threshold, { min: 0, max: 1 });
    if (o.maxDiffPixelRatio !== undefined) o.maxDiffPixelRatio = parseNumber('--max-diff-pixel-ratio', o.maxDiffPixelRatio, { min: 0, max: 1 });
    if (o.maxDiffPixels !== undefined) o.maxDiffPixels = parseNumber('--max-diff-pixels', o.maxDiffPixels, { integer: true, min: 0, max: MAX_PIXELS });
    if (o.maskWarnPct !== undefined) o.maskWarnPct = parseNumber('--mask-warn-pct', o.maskWarnPct, { min: 0, max: 100 });
    if (o.only !== undefined) {
      const keys = o.only.split(',').map((s) => s.trim());
      if (keys.some((k) => !KEY_RE.test(k))) throw usage('--only takes keys like home/m390.light,cart/d1440.dark');
      o.only = [...new Set(keys)];
    }
  } else if (mode === 'promote') {
    need(['from', 'baselineRoot', 'baselineId', 'repo', 'sourceCommit']);
  } else if (mode === 'approve') {
    need(['baselineRoot', 'baselineId']);
    if ((o.approvedTextFile === undefined) === (o.approvedText === undefined)) throw usage('give exactly one of --approved-text-file and --approved-text');
  }
  return { mode, options: o };
}

export function main(argv, { stdout = (s) => process.stdout.write(`${s}\n`), stderr = (s) => process.stderr.write(`${s}\n`) } = {}) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (e) {
    stderr(`ERROR: ${printable(e.message, 300)}`);
    stderr('Run with --help for usage.');
    return e instanceof DiffError ? e.code : EXIT.USAGE;
  }
  const { mode, options: o } = parsed;
  try {
    if (mode === 'help') { stdout(HELP); return EXIT.OK; }
    if (mode === 'selfTest') {
      const r = selfTest();
      stdout(JSON.stringify(r));
      return r.ok ? EXIT.OK : EXIT.UNREADABLE;
    }
    if (mode === 'promote') {
      const r = promoteBaseline({ fromDir: o.from, baselineRoot: o.baselineRoot, baselineId: o.baselineId, repo: o.repo, sourceCommit: o.sourceCommit, allowInsideGit: !!o.allowInsideGit });
      stdout(JSON.stringify({ promoted: r.id, dir: r.dir, items: r.items.length, skipped: r.skipped, approved: false }));
      return EXIT.OK;
    }
    if (mode === 'approve') {
      const text = o.approvedTextFile !== undefined ? readApprovedTextFile(o.approvedTextFile) : o.approvedText;
      const r = approveBaseline({ baselineRoot: o.baselineRoot, baselineId: o.baselineId, approvedText: text });
      stdout(JSON.stringify({ approved: r.id, dir: r.dir, approved_at: r.approved_at }));
      return EXIT.OK;
    }
    const summary = compareRuns({
      baselineDir: o.baseline, currentDir: o.current, outDir: o.out,
      options: {
        threshold: o.threshold, includeAA: !!o.includeAA, maxDiffPixelRatio: o.maxDiffPixelRatio, maxDiffPixels: o.maxDiffPixels,
        maskWarnPct: o.maskWarnPct, only: o.only, diffImages: !o.noDiffImages, allowInsideGit: !!o.allowInsideGit,
      },
    });
    const over = summary.counts.changed + summary.counts.size_mismatch;
    const parts = STATUSES.filter((s) => summary.counts[s] > 0).map((s) => `${s} ${summary.counts[s]}`);
    stdout(`${over ? 'CHANGED' : 'OK'}: ${summary.items.length} item(s)${parts.length ? ` (${parts.join(', ')})` : ''}; see ${path.join(path.resolve(o.out), 'diff-summary.json')}`);
    return over ? EXIT.CHANGED : EXIT.OK;
  } catch (e) {
    const code = e instanceof DiffError ? e.code : EXIT.UNREADABLE;
    const label = code === EXIT.REFUSED ? 'REFUSED' : code === EXIT.USAGE ? 'ERROR' : 'UNREADABLE';
    stderr(`${label}: ${printable(e && e.message ? e.message : e, 400)}`);
    return code;
  }
}

const invokedDirectly = (() => {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
