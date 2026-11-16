#!/usr/bin/env node
// ui-probe.mjs: browser measurement harness for the ui-audit skill.
//
// The probe records facts about pages of an app that runs on loopback: screenshots,
// overflow, console and network failures, tap targets, contrast, vitals, structure,
// focus order, text spacing, zoom reflow, the accessibility tree, heap samples and,
// when the audited project ships axe-core, an axe run. Every capture records the
// environment it was taken in (env.envKey), so screenshots are only ever compared
// with screenshots from the same environment (see ui-diff.mjs).
// It never decides whether a fact is a defect; the agents and verifiers do that.
//
// Plain Node 24. `playwright` or `playwright-core` is used only when it is installed
// in a driver directory: --driver-path when given, otherwise the skill's own
// node_modules (the pinned playwright-core of the skill's package.json), then
// ~/ui-audit-skill/tools/node_modules. The working directory, which is usually the
// target repository, is never searched, so a devDependency of the target can never
// switch drivers. In every other case the built-in Chrome DevTools Protocol driver
// is used.
// The browser is launched with an allowlisted environment that points HOME, the
// temporary and the cache directories into --out; the ambient environment is
// never passed through.
// No environment file (.env, .env.*, *.env, .envrc, .dev.vars) is ever opened.
// See ../HUNTING.md and ../RUN-METADATA.md for how agents call it.

import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOOL_VERSION = '3.0.0';
export const CONFIG_SCHEMA = 'ui-audit/probe-config@3';
/** Config schemas validateConfig accepts; the v3-only keys are allowed under either. */
export const ACCEPTED_CONFIG_SCHEMAS = Object.freeze(['ui-audit/probe-config@2', 'ui-audit/probe-config@3']);
export const CAPTURE_SCHEMA = 'ui-audit/probe-capture@3';
export const SUMMARY_SCHEMA = 'ui-audit/probe-summary@3';
export const PLAN_SCHEMA = 'ui-audit/probe-plan@3';
export const EXIT = Object.freeze({ OK: 0, USAGE: 1, REFUSED: 2, UNAVAILABLE: 3, PARTIAL: 4 });

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VIEWPORT_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const TZ_RE = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/;
const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const STEP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const STORAGE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,58}\.json$/;
const ACCOUNT_REF_RE = /^account:([a-z0-9][a-z0-9_-]{0,63})\.([A-Za-z_][A-Za-z0-9_]{0,31})$/;
const SESSION_REF_RE = /^([a-z0-9][a-z0-9_-]{0,63})\/([a-z][a-z0-9_-]{0,31})$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const UNSAFE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]];
// Built from code points so the source stays ASCII and free of literal format characters.
const hexEscape = (n) => String.fromCharCode(92) + 'u' + n.toString(16).padStart(4, '0');
const UNSAFE_CLASS = `[${UNSAFE_RANGES.map(([a, b]) => (a === b ? hexEscape(a) : `${hexEscape(a)}-${hexEscape(b)}`)).join("")}]`;
const UNSAFE_TEXT = new RegExp(UNSAFE_CLASS, "g");
const UNSAFE_TEXT_TEST = new RegExp(UNSAFE_TEXT.source);
// Whole key names only: a key such as `tokenUrl` is not a credential and falls through to
// validateConfig's "unknown key" error (exit 1) instead of a refusal (exit 2).
const SECRET_KEY_RE = /^(?:password|passwd|token|cookie|secret)$/i;
// An evaluate expression may not read browser storage or cookies: whatever it reads could end
// up in an error message, a log line or evidence. Matched on the expression source text.
const EVALUATE_STORAGE_RE = /document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB|cookieStore/i;
const TARGETS = ['disposable', 'running-app-get-only'];
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const SECRET_SELECTOR_RE = /pass(?:word)?|contrase|secret|token/i;

const THEMES = ['light', 'dark', 'system'];
const PAGE_LOAD_PROFILES = ['fast', 'slow4g', 'slow3g'];
const STEP_NETWORK_PROFILES = ['fast', 'slow4g', 'slow3g', 'offline', 'flaky'];
const BLOCK_ERRORS = new Set([
  'net::ERR_PROXY_CONNECTION_FAILED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_TUNNEL_CONNECTION_FAILED',
]);
const MAX_LIST = 200;
const MAX_CAPTURES = 500;
const MAX_JSON_INPUT = 5 * 1024 * 1024;

export const NETWORK_PRESETS = Object.freeze({
  fast: { offline: false, latencyMs: 0, downBps: -1, upBps: -1 },
  slow4g: { offline: false, latencyMs: 150, downBps: 204800, upBps: 96000 },
  slow3g: { offline: false, latencyMs: 2000, downBps: 51200, upBps: 51200 },
  offline: { offline: true, latencyMs: 0, downBps: -1, upBps: -1 },
});

const DEFAULT_CHECKS = Object.freeze({
  overflow: true, console: true, network: true, tapTargets: true, contrast: true,
  vitals: true, structure: true, resources: true, focusWalk: false, textSpacing: false,
  zoom: null, axTree: false, heap: false, axe: false,
});
const DEFAULT_STABLE_SHOTS = Object.freeze({ maxAttempts: 3, intervalMs: 150 });
const EMULATION_KEYS = ['safeAreaInsets', 'smallViewportHeightDifference', 'virtualKeyboardHeight'];
const MAX_AXE_BYTES = 3 * 1024 * 1024;
const AXE_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------

function printable(value, max = 200) {
  const s = String(value).replace(UNSAFE_TEXT, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function clipText(value, max = 500) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pointerToken(key) {
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------
// Environment files are never opened
// ---------------------------------------------------------------------------

const ENV_FILE_PATTERNS = Object.freeze([/^\.env($|[.\-_])/i, /^\.envrc$/i, /\.env$/i, /^\.dev\.vars$/i]);

/**
 * True when any segment of the path is an environment file (.env, .env.local, .env-x, .env_x,
 * .envrc, production.env, .dev.vars, ...). Such a path is never read, listed into evidence or
 * handed to the browser.
 */
export function isForbiddenPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  return p.split(/[\\/]+/).some((seg) => seg.length > 0 && ENV_FILE_PATTERNS.some((re) => re.test(seg)));
}

// ---------------------------------------------------------------------------
// Loopback and identifier rules
// ---------------------------------------------------------------------------

/** True only for `localhost`, a dotted-decimal 127.x.x.x address, or IPv6 `::1`. */
export function isLoopbackHost(host) {
  if (typeof host !== 'string' || host.length === 0 || host.length > 255) return false;
  if (host === 'localhost' || host === '[::1]' || host === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  return m.slice(1).every((part) => (part === '0' || !part.startsWith('0')) && Number(part) <= 255);
}

/** An http(s) URL with a loopback host and no userinfo. */
export function isLoopbackUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return false;
  if (/[\s\\]/.test(url) || UNSAFE_TEXT.test(url)) { UNSAFE_TEXT.lastIndex = 0; return false; }
  UNSAFE_TEXT.lastIndex = 0;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '' || /@/.test(url.split(/[?#]/)[0].replace(/^[a-z]+:\/\//i, '').split('/')[0])) return false;
  return isLoopbackHost(u.hostname);
}

/** Resolves a route path against the base origin; null when it is not a same-origin absolute path. */
export function resolveRouteUrl(baseUrl, routePath) {
  if (!isLoopbackUrl(baseUrl)) return null;
  if (typeof routePath !== 'string' || routePath.length === 0 || routePath.length > 2048) return null;
  if (!routePath.startsWith('/') || routePath.startsWith('//') || /[\s\\]/.test(routePath)) return null;
  if (UNSAFE_TEXT_TEST.test(routePath)) return null;
  let base;
  let resolved;
  try {
    base = new URL(baseUrl);
    resolved = new URL(routePath, base.origin);
  } catch { return null; }
  if (resolved.origin !== base.origin || !isLoopbackUrl(resolved.href)) return null;
  return resolved.href;
}

/** Safe identifier for routes and capture stems (lowercase, no Windows device names). */
export function isSafeId(id) {
  return typeof id === 'string' && SAFE_ID.test(id) && !WINDOWS_DEVICE.test(id);
}

/**
 * Capture stem relative to `<out>/captures/`: `<routeId>/<viewportId>.<theme>[.r<k>]`.
 * `.r<k>` (1-based) appears only when repeat > 1.
 */
export function captureStem(routeId, viewportId, theme, repeatIndex = 1, repeat = 1) {
  if (!isSafeId(routeId)) throw new Error(`unsafe route id: ${printable(routeId)}`);
  if (typeof viewportId !== 'string' || !VIEWPORT_ID.test(viewportId) || WINDOWS_DEVICE.test(viewportId)) {
    throw new Error(`unsafe viewport id: ${printable(viewportId)}`);
  }
  if (!THEMES.includes(theme)) throw new Error(`unknown theme: ${printable(theme)}`);
  if (!Number.isInteger(repeat) || repeat < 1 || !Number.isInteger(repeatIndex) || repeatIndex < 1 || repeatIndex > repeat) {
    throw new Error('repeatIndex must be an integer between 1 and repeat');
  }
  return `${routeId}/${viewportId}.${theme}${repeat > 1 ? `.r${repeatIndex}` : ''}`;
}

// ---------------------------------------------------------------------------
// Pure measurement helpers. The first group is also injected into pages, so each
// function references only its own parameters, browser globals and the other
// functions of PAGE_HELPERS (see pageScript).
// ---------------------------------------------------------------------------

/** sRGB channel (0–255) to linear light (0–1). */
export function srgbToLinear(c) {
  const v = Math.min(255, Math.max(0, Number(c))) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of [r, g, b] with channels 0–255. */
export function relativeLuminance(rgb) {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

/** Source-over compositing of [r,g,b,a] (alpha 0–1) on top of another [r,g,b,a]. */
export function compositeRgba(top, bottom) {
  const ta = top.length > 3 ? top[3] : 1;
  const ba = bottom.length > 3 ? bottom[3] : 1;
  const a = ta + ba * (1 - ta);
  if (a <= 0) return [0, 0, 0, 0];
  const channel = (i) => (top[i] * ta + bottom[i] * ba * (1 - ta)) / a;
  return [channel(0), channel(1), channel(2), a];
}

/** WCAG contrast ratio. A translucent background is placed on white; a translucent foreground on the background. */
export function contrastRatio(fg, bg) {
  const back = bg.length > 3 && bg[3] < 1 ? compositeRgba(bg, [255, 255, 255, 1]) : bg;
  const front = fg.length > 3 && fg[3] < 1 ? compositeRgba(fg, back) : fg;
  const l1 = relativeLuminance(front);
  const l2 = relativeLuminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** WCAG large text: at least 24 px, or at least 18.66 px and bold (weight 700+). */
export function isLargeText(px, weight) {
  // Self-contained: this function is also serialised into the page (PAGE_HELPERS).
  const size = Number(px);
  const raw = typeof weight === 'string' ? weight.trim().toLowerCase() : weight;
  let w;
  if (raw === 'bold' || raw === 'bolder') w = 700;
  else if (raw === 'normal' || raw === 'lighter') w = 400;
  else if (typeof raw === 'number') w = raw;
  else w = parseInt(String(raw), 10);
  if (!Number.isFinite(w) || w <= 0) w = 400;
  return size >= 24 || (size >= 18.66 && w >= 700);
}

/** Minimum contrast for text of this size and weight (WCAG 1.4.3 AA). */
export function requiredContrast(px, weight) {
  return isLargeText(px, weight) ? 3 : 4.5;
}

/** Visible-text leaks such as `undefined` or `[object Object]`, matched as whole words. */
export function findBadText(text) {
  const out = [];
  if (typeof text !== 'string' || text.length === 0) return out;
  const re = /(^|[^\p{L}\p{N}_])(undefined|NaN|null|Invalid Date|\[object Object\])(?=$|[^\p{L}\p{N}_])/gu;
  let m;
  while ((m = re.exec(text)) !== null && out.length < 50) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    const excerpt = text.slice(Math.max(0, start - 30), Math.min(text.length, end + 30)).replace(/\s+/g, ' ').trim();
    out.push({ pattern: m[2], excerpt });
    if (re.lastIndex === m.index) re.lastIndex += 1;
  }
  return out;
}

/** Heading level jumps: a level more than one deeper than the previous heading (the document starts at 0). */
export function headingSkips(levels) {
  const skips = [];
  let prev = 0;
  for (const item of Array.isArray(levels) ? levels : []) {
    const level = typeof item === 'number' ? item : Number(item && item.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) continue;
    if (level > prev + 1) skips.push({ from: prev, to: level, text: typeof item === 'object' && item ? String(item.text ?? '') : '' });
    prev = level;
  }
  return skips;
}

/** True when the focus rectangle is entirely covered by the union of the cover rectangles ({x,y,width,height}). */
export function isFocusObscured(focusRect, coverRects) {
  if (!focusRect || !(focusRect.width > 0) || !(focusRect.height > 0)) return false;
  const fx1 = focusRect.x;
  const fy1 = focusRect.y;
  const fx2 = focusRect.x + focusRect.width;
  const fy2 = focusRect.y + focusRect.height;
  const covers = (Array.isArray(coverRects) ? coverRects : [])
    .filter((r) => r && r.width > 0 && r.height > 0)
    .map((r) => [Math.max(fx1, r.x), Math.max(fy1, r.y), Math.min(fx2, r.x + r.width), Math.min(fy2, r.y + r.height)])
    .filter((r) => r[2] > r[0] && r[3] > r[1]);
  if (covers.length === 0) return false;
  const xs = [...new Set([fx1, fx2, ...covers.flatMap((r) => [r[0], r[2]])])].sort((a, b) => a - b);
  const ys = [...new Set([fy1, fy2, ...covers.flatMap((r) => [r[1], r[3]])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (!covers.some((r) => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pure helpers used only in Node
// ---------------------------------------------------------------------------

/**
 * Cumulative Layout Shift with session windows: a shift joins the current window when it is
 * less than 1 s after the previous shift and less than 5 s after the window's first shift.
 * Shifts with recent input are excluded. Returns the largest window.
 */
export function clsFromShifts(entries) {
  const shifts = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && !e.hadRecentInput && Number.isFinite(e.startTime) && Number.isFinite(e.value))
    .sort((a, b) => a.startTime - b.startTime);
  let best = { value: 0, entries: [] };
  let current = [];
  let sum = 0;
  for (const e of shifts) {
    const last = current[current.length - 1];
    const first = current[0];
    if (last && e.startTime - last.startTime < 1000 && e.startTime - first.startTime < 5000) {
      current.push(e);
      sum += e.value;
    } else {
      current = [e];
      sum = e.value;
    }
    if (sum > best.value) best = { value: sum, entries: current.slice() };
  }
  return { value: best.value, windowStart: best.entries.length ? best.entries[0].startTime : null, windowEntries: best.entries };
}

/** Sum of (duration − 50 ms) over long tasks. */
export function totalBlockingTime(durations) {
  let total = 0;
  for (const d of Array.isArray(durations) ? durations : []) {
    if (Number.isFinite(d) && d > 50) total += d - 50;
  }
  return total;
}

function resourceKind(entry) {
  const url = String(entry && entry.name || '');
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch { /* keep raw */ }
  if (/\.(?:woff2?|ttf|otf|eot)$/i.test(pathname)) return 'font';
  if (entry.initiatorType === 'script' || /\.m?js$/i.test(pathname)) return 'script';
  if (entry.initiatorType === 'img' || entry.initiatorType === 'image' || /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i.test(pathname) || pathname.startsWith('/_next/image')) return 'image';
  return 'other';
}

/** Totals of script, image and font resources from Resource Timing entries. */
export function summarizeResources(entries) {
  const out = { scriptCount: 0, scriptTransferBytes: 0, scriptDecodedBytes: 0, largestScript: null, imageTransferBytes: 0, fontCount: 0 };
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.name !== 'string') continue;
    const kind = resourceKind(e);
    const transfer = Number.isFinite(e.transferSize) ? e.transferSize : 0;
    const decoded = Number.isFinite(e.decodedBodySize) ? e.decodedBodySize : 0;
    if (kind === 'script') {
      out.scriptCount += 1;
      out.scriptTransferBytes += transfer;
      out.scriptDecodedBytes += decoded;
      if (!out.largestScript || transfer > out.largestScript.transferBytes) out.largestScript = { url: clipText(e.name, 300), transferBytes: transfer };
    } else if (kind === 'image') {
      out.imageTransferBytes += transfer;
    } else if (kind === 'font') {
      out.fontCount += 1;
    }
  }
  return out;
}

/** Offline/online state of a flaky profile: online for (cycle − offline) ms, then offline for offline ms. */
export function flakySchedule(profile, elapsedMs) {
  const cycle = Number(profile && profile.cycleMs);
  const off = Number(profile && profile.offlineMs);
  if (!(cycle > 0) || !(off > 0) || off >= cycle) throw new Error('flaky profile needs 0 < offlineMs < cycleMs');
  const t = Math.max(0, Number(elapsedMs) || 0);
  const phase = t % cycle;
  const onlineFor = cycle - off;
  if (phase < onlineFor) return { offline: false, msUntilChange: onlineFor - phase };
  return { offline: true, msUntilChange: cycle - phase };
}

function slopePerMinute(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den === 0 ? null : (num / den) * 60000;
}

/** Trend of heap and DOM-node samples ({atMs, jsHeapUsedBytes, domNodes}). Monotonic = never decreases and ends higher. */
export function heapTrend(samples) {
  const list = (Array.isArray(samples) ? samples : []).filter((s) => s && Number.isFinite(s.atMs)).sort((a, b) => a.atMs - b.atMs);
  const series = (key) => list.filter((s) => Number.isFinite(s[key])).map((s) => [s.atMs, s[key]]);
  const monotonic = (pts) => pts.length >= 2 && pts.every((p, i) => i === 0 || p[1] >= pts[i - 1][1]) && pts[pts.length - 1][1] > pts[0][1];
  const growth = (pts) => (pts.length >= 2 ? pts[pts.length - 1][1] - pts[0][1] : null);
  const heap = series('jsHeapUsedBytes');
  const dom = series('domNodes');
  return {
    samples: list.length,
    sufficient: list.length >= 10,
    heapMonotonic: monotonic(heap),
    domMonotonic: monotonic(dom),
    heapGrowthBytes: growth(heap),
    domGrowth: growth(dom),
    heapSlopeBytesPerMin: slopePerMinute(heap),
    domSlopePerMin: slopePerMinute(dom),
  };
}

/**
 * End-of-capture checks and the view/full screenshots run after the last step, on whatever state
 * the steps left. This lists how that measured state differs from the capture's declared context,
 * so a reader never takes a dark, offline, rotated or logged-out measurement for the declared one.
 */
/** True when a scroll state is more than 1 px away from the origin (sub-pixel rests are ignored). */
export function isScrolled(scroll) {
  return !!scroll && [scroll.x, scroll.y, scroll.visualLeft, scroll.visualTop].some((v) => Number.isFinite(v) && Math.abs(v) > 1);
}

export function measuredStateChanges({ initialUrl, url, initialMedia, media, initialNetwork, network, initialMetrics, metrics, steps, scroll } = {}) {
  const changes = [];
  if (initialUrl && url && initialUrl !== url) changes.push('url');
  for (const k of ['colorScheme', 'reducedMotion', 'forcedColors', 'prefersContrast', 'hover']) {
    if (initialMedia && media && (initialMedia[k] ?? null) !== (media[k] ?? null)) changes.push(`media.${k}`);
  }
  if (initialNetwork && network && initialNetwork !== network) changes.push('network');
  if (initialMetrics && metrics && (initialMetrics.width !== metrics.width || initialMetrics.height !== metrics.height)) changes.push('viewport');
  const acted = new Set((Array.isArray(steps) ? steps : []).map((s) => s && s.action));
  if (acted.has('clearCookies')) changes.push('cookies');
  if (acted.has('back') || acted.has('forward')) changes.push('history');
  if (acted.has('click') || acted.has('fill') || acted.has('press') || acted.has('select') || acted.has('check') || acted.has('upload')) changes.push('interaction');
  // The page (or the visual viewport of a mobile page) is still scrolled when the checks and
  // screenshots run: a scroll step asked for it, or the reset to the origin did not hold.
  if (isScrolled(scroll)) changes.push('scroll');
  return changes;
}

const INTERACTION_ACTIONS = new Set(['click', 'press', 'check', 'select', 'fill']);

/**
 * Event Timing reports interactions of 16 ms or more only, so a null INP alone cannot tell "no
 * interaction" from "every interaction was fast". inpStatus says which: measured, below_threshold
 * (interactions happened, by the browser's count or the probe's own steps, but none reached 16 ms)
 * or no_interaction.
 */
export function inpStatus(raw, steps = []) {
  const measured = Array.isArray(raw && raw.interactions) ? raw.interactions.length : 0;
  const browserCount = raw && Number.isInteger(raw.interactionCount) ? raw.interactionCount : null;
  const stepCount = (Array.isArray(steps) ? steps : []).filter((st) => st && INTERACTION_ACTIONS.has(st.action)).length;
  const interactionCount = browserCount !== null ? browserCount : stepCount;
  let status = 'no_interaction';
  if (measured > 0) status = 'measured';
  else if (interactionCount > 0 || stepCount > 0) status = 'below_threshold';
  return { inpStatus: status, interactionCount };
}

/** Browser flags. Non-loopback traffic goes to a dead proxy; DNS for everything but loopback fails. */
export function chromiumArgs({ userDataDir, headless = true } = {}) {
  if (typeof userDataDir !== 'string' || !path.isAbsolute(userDataDir)) throw new Error('userDataDir must be an absolute path');
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-breakpad',
    '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
    '--password-store=basic',
    '--force-color-profile=srgb',
    '--mute-audio',
    '--disable-quic',
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]',
  ];
  if (headless) args.unshift('--headless=new');
  return args;
}

/** Extracts the browser WebSocket URL from a Chromium stderr line; only loopback endpoints are accepted. */
export function parseDevToolsUrl(line) {
  const m = /DevTools listening on (wss?:\/\/\S+)/.exec(String(line ?? ''));
  if (!m) return null;
  let u;
  try { u = new URL(m[1]); } catch { return null; }
  return isLoopbackHost(u.hostname) ? u.href : null;
}

/** JSON with object keys sorted at every level, so equal content always gives equal text. */
export function canonicalJson(value) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (isPlainObject(v)) {
      const out = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = norm(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

/** Major version of a browser version string ("HeadlessChrome/131.0.6778.33" or "131.0.6778.33" give "131"). */
export function browserMajor(version) {
  const m = /(\d+)(?:\.\d+)*/.exec(String(version ?? ''));
  return m ? m[1] : null;
}

/** sha256 of the browser flags without the per-run --user-data-dir entry, one flag per line. */
export function launchArgsHash({ headless = true } = {}) {
  const args = chromiumArgs({ userDataDir: path.resolve(os.tmpdir(), 'ui-probe-hash'), headless })
    .filter((a) => !a.startsWith('--user-data-dir='));
  return sha256(args.join('\n'));
}

/**
 * The key two screenshots must share before they may be compared: the capture env without
 * fontsReady, fontFaceErrors and envKey, with browserVersion cut to its major version, as
 * canonical JSON hashed with sha256. Key order in the input never matters.
 */
export function envKeyFor(env) {
  if (!isPlainObject(env)) throw new Error('envKeyFor needs the capture env object');
  const rest = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'fontsReady' || k === 'fontFaceErrors' || k === 'envKey') continue;
    rest[k] = v;
  }
  rest.browserVersion = browserMajor(env.browserVersion);
  return sha256(canonicalJson(rest));
}

/**
 * An axe-core build the audited project already installed: absolute, a regular file (a
 * symlink only when its real path is a regular file too), named axe.min.js or axe.js, in a
 * directory that is or sits inside a folder named axe-core, at most 3 MiB, and no
 * environment-file segment. The probe never downloads or bundles axe-core.
 */
export function validateAxePath(p, { lstat = fs.lstatSync, stat = fs.statSync, realpath = fs.realpathSync } = {}) {
  const no = (reason) => ({ ok: false, path: null, reason });
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) return no('--axe needs a path');
  if (!path.isAbsolute(p)) return no('--axe must be an absolute path');
  if (isForbiddenPath(p)) return no('--axe path has an environment-file segment');
  const base = path.basename(p);
  if (base !== 'axe.min.js' && base !== 'axe.js') return no('--axe file must be named axe.min.js or axe.js');
  const dir = path.dirname(p);
  if (path.basename(dir) !== 'axe-core' && path.basename(path.dirname(dir)) !== 'axe-core') return no('--axe file must sit in an axe-core folder (or one level below it)');
  let st;
  try { st = lstat(p); } catch { return no('--axe file does not exist'); }
  let real = p;
  if (st.isSymbolicLink()) {
    try { real = realpath(p); st = stat(real); } catch { return no('--axe symlink does not resolve'); }
    if (isForbiddenPath(real)) return no('--axe symlink resolves to an environment file');
  }
  if (!st.isFile()) return no('--axe path is not a regular file');
  if (st.size > MAX_AXE_BYTES) return no(`--axe file is larger than ${MAX_AXE_BYTES} bytes`);
  return { ok: true, path: real, reason: null };
}

/** Checks the --out directory: absolute, no previous summary.json, no `.git` ancestor unless allowed. */
export function isOutDirAllowed(dir, { allowInsideGit = false, exists = fs.existsSync, readdir = fs.readdirSync } = {}) {
  if (typeof dir !== 'string' || dir.length === 0 || !path.isAbsolute(dir)) return { ok: false, reason: '--out must be an absolute path' };
  if (dir.includes('\0')) return { ok: false, reason: '--out contains a NUL character' };
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) === resolved) return { ok: false, reason: '--out must not be a filesystem root' };
  if (exists(resolved)) {
    let entries;
    try { entries = readdir(resolved); } catch { return { ok: false, reason: '--out exists but cannot be listed (not a directory?)' }; }
    if (entries.includes('summary.json')) return { ok: false, reason: '--out already contains summary.json; use a new directory' };
  }
  if (!allowInsideGit) {
    for (let d = resolved; ; d = path.dirname(d)) {
      if (exists(path.join(d, '.git'))) return { ok: false, reason: `--out is inside a git working tree (${d}); pass --allow-inside-git only if the whole directory is ignored` };
      if (path.dirname(d) === d) break;
    }
  }
  return { ok: true, reason: null };
}

function defaultResolve(name, dir) {
  return createRequire(path.join(dir, 'noop.js')).resolve(name);
}

function isInsideDir(dir, file) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Finds `name` from the first base directory that resolves it. Never resolves from this
 * script's own location, and rejects a resolution that escaped the base directory (Node's
 * lookup also walks ancestor node_modules folders, which were not approved).
 */
export function resolveDriverModule(name, dirs, { resolve = defaultResolve } = {}) {
  for (const dir of Array.isArray(dirs) ? dirs : []) {
    if (typeof dir !== 'string' || dir.length === 0 || !path.isAbsolute(dir)) continue;
    try {
      const resolved = resolve(name, dir);
      if (typeof resolved === 'string' && resolved.length > 0 && isInsideDir(dir, resolved)) return { name, dir, resolved };
    } catch { /* try the next directory */ }
  }
  return null;
}

/** The skill's own node_modules, where its package.json installs the pinned playwright-core. */
export const SKILL_DRIVER_PATH = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'node_modules');

/** The shared tools directory, searched after the skill's own when --driver-path is absent. */
export function defaultDriverPath(homedir = os.homedir()) {
  return path.join(homedir, 'ui-audit-skill', 'tools', 'node_modules');
}

/**
 * Base directories searched for a Playwright package: the explicit --driver-path alone, or
 * the skill's own node_modules and then the shared tools directory. Never the working
 * directory and never the target repository.
 */
export function driverSearchDirs(driverPath, { homedir = os.homedir(), cwd = process.cwd(), skillDir = SKILL_DRIVER_PATH } = {}) {
  if (typeof driverPath === 'string' && driverPath.length > 0) return [path.resolve(cwd, driverPath)];
  return [skillDir, defaultDriverPath(homedir)].filter((dir) => path.resolve(dir) !== path.resolve(cwd));
}

/**
 * The environment handed to the browser process, built from an allowlist. Only what the OS
 * loader needs (SystemRoot, windir, PATH) comes from the ambient environment; HOME, the
 * profile and every temporary or cache directory point into the run's scratch. Secrets,
 * tokens and the user's real home never reach the browser.
 */
export function browserEnv({ baseEnv = process.env, scratchDir, platform = process.platform } = {}) {
  if (typeof scratchDir !== 'string' || !path.isAbsolute(scratchDir)) throw new Error('browserEnv needs an absolute scratchDir');
  const pick = (name) => {
    if (!baseEnv) return undefined;
    if (typeof baseEnv[name] === 'string') return baseEnv[name];
    if (platform !== 'win32') return undefined;
    const key = Object.keys(baseEnv).find((k) => k.toUpperCase() === name.toUpperCase());
    return key && typeof baseEnv[key] === 'string' ? baseEnv[key] : undefined;
  };
  const tmp = path.join(scratchDir, 'tmp');
  const home = path.join(scratchDir, 'home');
  const localAppData = path.join(scratchDir, 'localappdata');
  const env = {};
  const pathValue = pick('PATH');
  if (pathValue !== undefined) env.PATH = pathValue;
  if (platform === 'win32') {
    for (const name of ['SystemRoot', 'windir']) {
      const value = pick(name);
      if (value !== undefined) env[name] = value;
    }
  }
  Object.assign(env, {
    TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    HOME: home, USERPROFILE: home,
    LOCALAPPDATA: localAppData, APPDATA: path.join(home, 'appdata'),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
  });
  return { env, dirs: [tmp, home, localAppData] };
}

/** JSON pointers of inline secrets: keys like password/token/cookie with a string or array value, or a literal fill into a password field. */
export function findInlineSecrets(config) {
  const found = [];
  const walk = (value, pointer, depth) => {
    if (depth > 40 || found.length > 100) return;
    if (Array.isArray(value)) { value.forEach((item, i) => walk(item, `${pointer}/${i}`, depth + 1)); return; }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const p = `${pointer}/${pointerToken(key)}`;
      const inline = (typeof child === 'string' && child.length > 0) || (Array.isArray(child) && child.length > 0);
      if (SECRET_KEY_RE.test(key) && inline) found.push(p);
      else walk(child, p, depth + 1);
    }
    if (value.action === 'fill' && typeof value.value === 'string' && value.value.length > 0
      && typeof value.selector === 'string' && SECRET_SELECTOR_RE.test(value.selector)) {
      found.push(`${pointer}/value`);
    }
  };
  walk(config, '', 0);
  return found;
}

/** Resolves `account:<account_key>.<field>` against the accounts list. The value is never logged. */
export function resolveAccountRef(ref, accounts) {
  const m = typeof ref === 'string' ? ACCOUNT_REF_RE.exec(ref) : null;
  if (!m) return { value: null, error: 'malformed account reference (expected account:<account_key>.<field>)' };
  if (!Array.isArray(accounts)) return { value: null, error: 'no accounts loaded (pass --accounts)' };
  const account = accounts.find((a) => isPlainObject(a) && a.account_key === m[1]);
  if (!account) return { value: null, error: `unknown account_key "${m[1]}"` };
  const value = account[m[2]];
  if (typeof value !== 'string' || value.length === 0) return { value: null, error: `account "${m[1]}" has no string field "${m[2]}"` };
  return { value, error: null };
}

/** Errors for a Playwright-style storage state whose cookies or origins are not loopback. */
export function checkStorageState(state) {
  const errors = [];
  if (!isPlainObject(state)) return ['storage state must be an object {cookies, origins}'];
  const cookies = state.cookies ?? [];
  const origins = state.origins ?? [];
  if (!Array.isArray(cookies)) errors.push('cookies must be an array');
  else cookies.forEach((c, i) => {
    const domain = isPlainObject(c) && typeof c.domain === 'string' ? c.domain.replace(/^\./, '') : null;
    if (!domain || !isLoopbackHost(domain)) errors.push(`cookies[${i}] domain is not loopback`);
    if (!isPlainObject(c) || typeof c.name !== 'string' || typeof c.value !== 'string') errors.push(`cookies[${i}] needs string name and value`);
  });
  if (!Array.isArray(origins)) errors.push('origins must be an array');
  else origins.forEach((o, i) => {
    if (!isPlainObject(o) || !isLoopbackUrl(o.origin)) errors.push(`origins[${i}] origin is not a loopback URL`);
    else if (o.localStorage !== undefined && !Array.isArray(o.localStorage)) errors.push(`origins[${i}].localStorage must be an array`);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const VALUE_FLAGS = {
  '--config': 'config', '--out': 'out', '--driver': 'driver', '--executable': 'executable',
  '--driver-path': 'driverPath', '--accounts': 'accounts', '--sessions': 'sessions',
  '--only': 'only', '--viewport': 'viewport', '--theme': 'theme', '--expect-header': 'expectHeader',
  '--axe': 'axe',
};
const BOOL_FLAGS = { '--allow-inside-git': 'allowInsideGit', '--plan': 'plan', '--help': 'help', '-h': 'help' };
const LIST_OPTIONS = new Set(['only', 'viewport', 'theme']);
const DRIVERS = ['auto', 'playwright', 'playwright-core', 'cdp'];

export function parseArgs(argv) {
  const options = {
    config: null, out: null, driver: null, executable: null, driverPath: null, accounts: null, sessions: null,
    only: null, viewport: null, theme: null, expectHeader: null, axe: null, allowInsideGit: false, plan: false, help: false,
  };
  const errors = [];
  const seen = new Set();
  const list = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < list.length; i++) {
    let flag = list[i];
    let value;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 2) { value = flag.slice(eq + 1); flag = flag.slice(0, eq); }
    if (hasOwn(BOOL_FLAGS, flag)) {
      if (value !== undefined) { errors.push(`${flag} takes no value`); continue; }
      options[BOOL_FLAGS[flag]] = true;
    } else if (hasOwn(VALUE_FLAGS, flag)) {
      if (value === undefined) {
        value = list[i + 1];
        if (value === undefined || value.startsWith('--')) { errors.push(`${flag} needs a value`); continue; }
        i += 1;
      }
      if (value.length === 0) { errors.push(`${flag} needs a non-empty value`); continue; }
      const key = VALUE_FLAGS[flag];
      if (seen.has(key)) { errors.push(`${flag} given more than once`); continue; }
      seen.add(key);
      if (LIST_OPTIONS.has(key)) {
        const items = value.split(',').map((s) => s.trim());
        if (items.some((s) => s.length === 0)) { errors.push(`${flag} has an empty list item`); continue; }
        options[key] = [...new Set(items)];
      } else {
        options[key] = value;
      }
    } else {
      errors.push(`unknown argument: ${printable(flag, 80)}`);
    }
  }
  if (options.driver !== null && !DRIVERS.includes(options.driver)) errors.push(`--driver must be one of ${DRIVERS.join('|')}`);
  if (options.theme) for (const t of options.theme) if (!THEMES.includes(t)) errors.push(`--theme value "${printable(t, 40)}" is not one of ${THEMES.join('|')}`);
  if (typeof options.expectHeader === 'string') {
    const eq = options.expectHeader.indexOf('=');
    const name = eq > 0 ? options.expectHeader.slice(0, eq) : '';
    const value = eq > 0 ? options.expectHeader.slice(eq + 1) : '';
    if (!HEADER_NAME_RE.test(name) || value.length === 0 || value.length > 200 || UNSAFE_TEXT_TEST.test(value)) {
      errors.push('--expect-header must be <name>=<value> with a header token name and a non-empty printable value');
      options.expectHeader = null;
    } else options.expectHeader = { name: name.toLowerCase(), value };
  }
  if (!options.help) {
    if (!options.config) errors.push('--config is required');
    if (!options.out && !options.plan) errors.push('--out is required (except with --plan)');
  }
  return { options, errors };
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

const TOP_KEYS = new Set([
  '$comment', 'schema', 'baseUrl', 'driver', 'executable', 'headless', 'theme', 'themes', 'viewports', 'network',
  'networkProfiles', 'cpuThrottle', 'reducedMotion', 'media', 'timezone', 'locale', 'clock', 'repeat', 'warmup',
  'settleMs', 'navigationTimeoutMs', 'freezeAnimations', 'muteAudio', 'checks', 'maxContrastSamples',
  'maxFocusStops', 'routes', 'target', 'readyMarker', 'stableShots', 'emulation', 'benchmark',
]);

const KEY_NAMES = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space'];
const KEY_RE = new RegExp(`^(?:(?:Shift|Control|Alt|Meta)\\+){0,3}(?:${KEY_NAMES.join('|')}|[\\x21-\\x7e])$`);

const STEP_KEYS = {
  goto: { required: ['path'], optional: [] },
  click: { required: ['selector'], optional: [] },
  fill: { required: ['selector'], optional: ['value', 'valueFrom'] },
  press: { required: ['key'], optional: [] },
  select: { required: ['selector', 'value'], optional: [] },
  check: { required: ['selector', 'checked'], optional: [] },
  upload: { required: ['selector', 'file'], optional: [] },
  hover: { required: ['selector'], optional: [] },
  scroll: { required: [], optional: ['selector', 'y'] },
  waitFor: { required: ['selector'], optional: ['timeoutMs'] },
  wait: { required: ['ms'], optional: [] },
  setNetwork: { required: ['profile'], optional: [] },
  clearCookies: { required: [], optional: [] },
  newTab: { required: [], optional: [] },
  rotate: { required: [], optional: [] },
  emulateMedia: { required: [], optional: ['colorScheme', 'reducedMotion', 'forcedColors', 'prefersContrast'] },
  evaluate: { required: ['expression'], optional: [] },
  screenshot: { required: ['name'], optional: [] },
  back: { required: [], optional: [] },
  forward: { required: [], optional: [] },
};

function makeChecker(errors) {
  const err = (pointer, message, refusal = false) => errors.push({ pointer, message, refusal });
  return {
    err,
    keys(obj, pointer, allowed) {
      for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${pointer}/${pointerToken(k)}`, 'unknown key');
    },
    bool(v, p, def) {
      if (v === undefined) return def;
      if (typeof v !== 'boolean') { err(p, 'must be a boolean'); return def; }
      return v;
    },
    oneOf(v, p, values, def) {
      if (v === undefined) return def;
      if (!values.includes(v)) { err(p, `must be one of ${values.map((x) => (x === null ? 'null' : x)).join('|')}`); return def; }
      return v;
    },
    int(v, p, min, max, def) {
      if (v === undefined) return def;
      if (!Number.isInteger(v) || v < min || v > max) { err(p, `must be an integer from ${min} to ${max}`); return def; }
      return v;
    },
    num(v, p, min, max, def) {
      if (v === undefined) return def;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) { err(p, `must be a number from ${min} to ${max}`); return def; }
      return v;
    },
    text(v, p, max, { required = true } = {}) {
      if (v === undefined && !required) return undefined;
      if (typeof v !== 'string' || v.length === 0 || v.length > max) { err(p, `must be a non-empty string of at most ${max} characters`); return undefined; }
      if (/[\u0000-\u001f\u007f]/.test(v)) { err(p, 'must not contain control characters'); return undefined; }
      return v;
    },
  };
}

function validateViewport(v, p, c) {
  if (!isPlainObject(v)) { c.err(p, 'viewport must be an object'); return null; }
  c.keys(v, p, ['id', 'width', 'height', 'dpr', 'mobile', 'touch']);
  const out = {};
  if (typeof v.id !== 'string' || !VIEWPORT_ID.test(v.id) || WINDOWS_DEVICE.test(v.id)) c.err(`${p}/id`, 'must match ^[a-z0-9][a-z0-9_-]{0,31}$');
  else out.id = v.id;
  out.width = c.int(v.width, `${p}/width`, 200, 3840, undefined);
  out.height = c.int(v.height, `${p}/height`, 200, 3840, undefined);
  if (v.width === undefined) c.err(`${p}/width`, 'required');
  if (v.height === undefined) c.err(`${p}/height`, 'required');
  out.dpr = c.num(v.dpr, `${p}/dpr`, 1, 4, 1);
  out.mobile = c.bool(v.mobile, `${p}/mobile`, false);
  out.touch = c.bool(v.touch, `${p}/touch`, false);
  return out.id && out.width && out.height ? out : null;
}

function validateStep(step, p, c, ctx) {
  if (!isPlainObject(step)) { c.err(p, 'step must be an object'); return null; }
  const spec = STEP_KEYS[step.action];
  if (!spec) { c.err(`${p}/action`, `unknown action; use one of ${Object.keys(STEP_KEYS).join('|')}`); return null; }
  const allowed = ['action', ...spec.required, ...spec.optional, ...(step.action === 'newTab' ? [] : ['tab'])];
  c.keys(step, p, allowed);
  for (const k of spec.required) if (step[k] === undefined) c.err(`${p}/${k}`, 'required');
  const out = { action: step.action, tab: 0 };
  if (step.tab !== undefined) {
    out.tab = c.oneOf(step.tab, `${p}/tab`, [0, 1], 0);
    if (out.tab === 1 && !ctx.hasNewTab) c.err(`${p}/tab`, 'tab 1 exists only after a newTab step');
  }
  const selector = () => c.text(step.selector, `${p}/selector`, 500);
  switch (step.action) {
    case 'goto': {
      if (typeof step.path === 'string' && ctx.baseUrl && !resolveRouteUrl(ctx.baseUrl, step.path)) {
        c.err(`${p}/path`, 'refused: goto path must start with a single "/" and stay on the base origin', true);
      } else if (typeof step.path !== 'string') c.err(`${p}/path`, 'must be a string');
      out.path = step.path;
      break;
    }
    case 'click': case 'hover': out.selector = selector(); break;
    case 'fill': {
      out.selector = selector();
      const hasValue = step.value !== undefined;
      const hasFrom = step.valueFrom !== undefined;
      if (hasValue === hasFrom) c.err(p, 'fill needs exactly one of value or valueFrom');
      if (hasValue) {
        if (typeof step.value !== 'string' || step.value.length > 2000) c.err(`${p}/value`, 'must be a string of at most 2000 characters');
        else out.value = step.value;
      }
      if (hasFrom) {
        if (typeof step.valueFrom !== 'string' || !ACCOUNT_REF_RE.test(step.valueFrom)) c.err(`${p}/valueFrom`, 'must be account:<account_key>.<field>');
        else { out.valueFrom = step.valueFrom; ctx.usesAccounts = true; }
      }
      break;
    }
    case 'press':
      if (typeof step.key !== 'string' || !KEY_RE.test(step.key)) c.err(`${p}/key`, `must be a printable character or one of ${KEY_NAMES.join('|')}, optionally with Shift+/Control+/Alt+/Meta+`);
      out.key = step.key;
      break;
    case 'select':
      out.selector = selector();
      if (typeof step.value !== 'string' || step.value.length > 2000) c.err(`${p}/value`, 'must be a string');
      out.value = step.value;
      break;
    case 'check':
      out.selector = selector();
      if (typeof step.checked !== 'boolean') c.err(`${p}/checked`, 'must be a boolean');
      out.checked = step.checked;
      break;
    case 'upload': {
      out.selector = selector();
      const file = step.file;
      if (typeof file !== 'string' || file.length === 0 || file.length > 500 || file.includes('\0')) { c.err(`${p}/file`, 'must be a relative path string'); break; }
      if (isForbiddenPath(file)) { c.err(`${p}/file`, 'refused: upload file is an environment file', true); break; }
      if (path.isAbsolute(file) || path.win32.isAbsolute(file) || /^[A-Za-z]:/.test(file)) { c.err(`${p}/file`, 'refused: upload file must be relative to the config directory', true); break; }
      if (!ctx.configDir) { c.err(`${p}/file`, 'upload needs the config directory to resolve the file'); break; }
      const abs = path.resolve(ctx.configDir, file);
      const rel = path.relative(ctx.configDir, abs);
      if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || rel.startsWith('../') || path.isAbsolute(rel)) {
        c.err(`${p}/file`, 'refused: upload file escapes the config directory', true);
        break;
      }
      out.file = file;
      out.fileAbs = abs;
      break;
    }
    case 'scroll': {
      const hasSel = step.selector !== undefined;
      const hasY = step.y !== undefined;
      if (hasSel === hasY) c.err(p, 'scroll needs exactly one of selector or y');
      if (hasSel) out.selector = selector();
      if (hasY) out.y = c.int(step.y, `${p}/y`, 0, 1000000, 0);
      break;
    }
    case 'waitFor':
      out.selector = selector();
      out.timeoutMs = c.int(step.timeoutMs, `${p}/timeoutMs`, 100, 120000, 10000);
      break;
    case 'wait': out.ms = c.int(step.ms, `${p}/ms`, 0, 10000, 0); break;
    case 'setNetwork': out.profile = c.oneOf(step.profile, `${p}/profile`, STEP_NETWORK_PROFILES, 'fast'); break;
    case 'clearCookies': case 'rotate': case 'back': case 'forward': break;
    case 'newTab':
      if (ctx.hasNewTab) c.err(p, 'only one newTab per route');
      ctx.hasNewTab = true;
      break;
    case 'emulateMedia': {
      const keys = ['colorScheme', 'reducedMotion', 'forcedColors', 'prefersContrast'];
      if (!keys.some((k) => step[k] !== undefined)) c.err(p, 'emulateMedia needs at least one media feature');
      out.colorScheme = c.oneOf(step.colorScheme, `${p}/colorScheme`, ['light', 'dark'], undefined);
      out.reducedMotion = c.oneOf(step.reducedMotion, `${p}/reducedMotion`, [true, false], undefined);
      out.forcedColors = c.oneOf(step.forcedColors, `${p}/forcedColors`, ['active', 'none', null], undefined);
      out.prefersContrast = c.oneOf(step.prefersContrast, `${p}/prefersContrast`, ['more', 'less', 'no-preference', null], undefined);
      break;
    }
    case 'evaluate':
      if (typeof step.expression !== 'string' || step.expression.trim().length === 0 || step.expression.length > 4000) c.err(`${p}/expression`, 'must be a non-empty string of at most 4000 characters');
      else if (EVALUATE_STORAGE_RE.test(step.expression)) c.err(`${p}/expression`, 'refused: evaluate may not read cookies or browser storage (document.cookie, localStorage, sessionStorage, indexedDB, cookieStore)', true);
      out.expression = step.expression;
      break;
    case 'screenshot':
      if (typeof step.name !== 'string' || !STEP_NAME_RE.test(step.name) || WINDOWS_DEVICE.test(step.name)) c.err(`${p}/name`, 'must match ^[a-z0-9][a-z0-9_-]{0,31}$');
      else if (ctx.shotNames.has(step.name) || /^zoom\d+$/.test(step.name)) c.err(`${p}/name`, 'duplicate or reserved screenshot name');
      else ctx.shotNames.add(step.name);
      out.name = step.name;
      break;
    default: break;
  }
  return out;
}

function validateRoute(route, p, c, shared) {
  if (!isPlainObject(route)) { c.err(p, 'route must be an object'); return null; }
  c.keys(route, p, ['id', 'path', 'storageState', 'waitFor', 'steps', 'saveStorage', 'mask']);
  const out = { id: route.id, path: route.path, storageState: null, waitFor: null, steps: [], saveStorage: null, mask: [] };
  if (!isSafeId(route.id)) c.err(`${p}/id`, 'must match ^[a-z0-9][a-z0-9_-]{0,63}$ and not be a Windows device name');
  else if (shared.routeIds.has(route.id)) c.err(`${p}/id`, 'duplicate route id');
  else shared.routeIds.add(route.id);
  if (typeof route.path !== 'string') c.err(`${p}/path`, 'required string');
  else if (shared.baseUrl && !resolveRouteUrl(shared.baseUrl, route.path)) c.err(`${p}/path`, 'refused: path must start with a single "/" and stay on the base origin', true);
  const ss = route.storageState;
  if (ss === undefined || ss === null) out.storageState = null;
  else if (isPlainObject(ss)) {
    c.keys(ss, `${p}/storageState`, ['session']);
    if (typeof ss.session !== 'string' || !SESSION_REF_RE.test(ss.session)) c.err(`${p}/storageState/session`, 'must be "<tenant_id>/<role>"');
    else { out.storageState = { session: ss.session }; shared.usesSessions = true; }
  } else if (typeof ss === 'string') {
    if (isForbiddenPath(ss)) c.err(`${p}/storageState`, 'refused: storageState names an environment file', true);
    else if (c.text(ss, `${p}/storageState`, 1000) !== undefined) out.storageState = { path: ss };
  } else c.err(`${p}/storageState`, 'must be null, {"session": "<tenant_id>/<role>"} or a path string');
  if (route.waitFor !== undefined && route.waitFor !== null) {
    if (!isPlainObject(route.waitFor)) c.err(`${p}/waitFor`, 'must be null or {selector, timeoutMs}');
    else {
      c.keys(route.waitFor, `${p}/waitFor`, ['selector', 'timeoutMs']);
      out.waitFor = {
        selector: c.text(route.waitFor.selector, `${p}/waitFor/selector`, 500),
        timeoutMs: c.int(route.waitFor.timeoutMs, `${p}/waitFor/timeoutMs`, 100, 120000, 10000),
      };
    }
  }
  if (route.steps !== undefined) {
    if (!Array.isArray(route.steps) || route.steps.length > 200) c.err(`${p}/steps`, 'must be an array of at most 200 steps');
    else {
      const ctx = { baseUrl: shared.baseUrl, configDir: shared.configDir, hasNewTab: false, shotNames: new Set(), usesAccounts: false };
      out.steps = route.steps.map((s, i) => validateStep(s, `${p}/steps/${i}`, c, ctx)).filter(Boolean);
      if (ctx.usesAccounts) shared.usesAccounts = true;
    }
  }
  if (route.mask !== undefined) {
    // Selectors whose elements are covered by an opaque overlay in the screenshots only (dates,
    // counters, carousels, ads); the checks never see the overlay.
    if (!Array.isArray(route.mask) || route.mask.length < 1 || route.mask.length > 20) c.err(`${p}/mask`, 'must be an array of 1 to 20 selectors');
    else {
      route.mask.forEach((sel, i) => { const v = c.text(sel, `${p}/mask/${i}`, 500); if (v !== undefined) out.mask.push(v); });
    }
  }
  if (route.saveStorage !== undefined && route.saveStorage !== null) {
    if (typeof route.saveStorage !== 'string' || !STORAGE_FILE_RE.test(route.saveStorage) || WINDOWS_DEVICE.test(route.saveStorage)) {
      c.err(`${p}/saveStorage`, 'must be null or a file name like owner.json');
    } else if (shared.saveNames.has(route.saveStorage)) c.err(`${p}/saveStorage`, 'duplicate saveStorage name');
    else { shared.saveNames.add(route.saveStorage); out.saveStorage = route.saveStorage; }
  }
  return out;
}

/**
 * Validates and normalises a probe config. Errors are {pointer, message, refusal}; a refusal
 * means the config asks for something outside the safety boundary (exit 2 rather than 1).
 */
export function validateConfig(obj, { configDir } = {}) {
  const errors = [];
  const c = makeChecker(errors);
  if (!isPlainObject(obj)) { c.err('', 'config must be a JSON object'); return { config: null, errors }; }
  for (const k of Object.keys(obj)) if (!TOP_KEYS.has(k)) c.err(`/${pointerToken(k)}`, 'unknown key');
  if (!ACCEPTED_CONFIG_SCHEMAS.includes(obj.schema)) c.err('/schema', `must be one of ${ACCEPTED_CONFIG_SCHEMAS.map((x) => `"${x}"`).join(' or ')}`);
  const cfg = {};
  if (typeof obj.baseUrl !== 'string') c.err('/baseUrl', 'required string');
  else if (!isLoopbackUrl(obj.baseUrl)) c.err('/baseUrl', 'refused: baseUrl must be http(s) on localhost, 127.x.x.x or [::1], without userinfo', true);
  else {
    const u = new URL(obj.baseUrl);
    if (u.pathname !== '/' || u.search || u.hash) c.err('/baseUrl', 'must be an origin with no path, query or fragment');
    else cfg.baseUrl = u.origin;
  }
  cfg.driver = c.oneOf(obj.driver, '/driver', DRIVERS, 'auto');
  cfg.executable = obj.executable === undefined || obj.executable === null ? null : c.text(obj.executable, '/executable', 1000) ?? null;
  cfg.headless = c.bool(obj.headless, '/headless', true);

  cfg.theme = { media: true, storage: null };
  if (obj.theme !== undefined) {
    if (!isPlainObject(obj.theme)) c.err('/theme', 'must be an object');
    else {
      c.keys(obj.theme, '/theme', ['media', 'storage']);
      cfg.theme.media = c.bool(obj.theme.media, '/theme/media', true);
      const st = obj.theme.storage;
      if (st !== undefined && st !== null) {
        if (!isPlainObject(st)) c.err('/theme/storage', 'must be null or {key, light, dark}');
        else {
          c.keys(st, '/theme/storage', ['key', 'light', 'dark']);
          const key = c.text(st.key, '/theme/storage/key', 100);
          const light = c.text(st.light, '/theme/storage/light', 100);
          const dark = c.text(st.dark, '/theme/storage/dark', 100);
          if (key && light && dark) cfg.theme.storage = { key, light, dark };
        }
      }
    }
  }
  cfg.themes = ['light', 'dark'];
  if (obj.themes !== undefined) {
    if (!Array.isArray(obj.themes) || obj.themes.length === 0 || obj.themes.some((t) => !THEMES.includes(t)) || new Set(obj.themes).size !== obj.themes.length) {
      c.err('/themes', `must be a non-empty list of unique values from ${THEMES.join('|')}`);
    } else cfg.themes = obj.themes.slice();
  }
  cfg.viewports = [];
  if (!Array.isArray(obj.viewports) || obj.viewports.length === 0 || obj.viewports.length > 40) c.err('/viewports', 'must be a non-empty array (at most 40)');
  else {
    const ids = new Set();
    obj.viewports.forEach((v, i) => {
      const rawId = isPlainObject(v) ? v.id : undefined;
      if (typeof rawId === 'string' && ids.has(rawId)) { c.err(`/viewports/${i}/id`, 'duplicate viewport id'); return; }
      if (typeof rawId === 'string') ids.add(rawId);
      const vp = validateViewport(v, `/viewports/${i}`, c);
      if (vp) cfg.viewports.push(vp);
    });
  }
  cfg.network = c.oneOf(obj.network, '/network', PAGE_LOAD_PROFILES, 'fast');
  cfg.networkProfiles = {
    slow4g: { ...NETWORK_PRESETS.slow4g },
    slow3g: { ...NETWORK_PRESETS.slow3g },
    flaky: { base: 'slow4g', cycleMs: 4000, offlineMs: 1500 },
  };
  if (obj.networkProfiles !== undefined) {
    if (!isPlainObject(obj.networkProfiles)) c.err('/networkProfiles', 'must be an object');
    else {
      c.keys(obj.networkProfiles, '/networkProfiles', ['slow4g', 'slow3g', 'flaky']);
      for (const name of ['slow4g', 'slow3g']) {
        const np = obj.networkProfiles[name];
        if (np === undefined) continue;
        const p = `/networkProfiles/${name}`;
        if (!isPlainObject(np)) { c.err(p, 'must be {latencyMs, downBps, upBps}'); continue; }
        c.keys(np, p, ['latencyMs', 'downBps', 'upBps']);
        cfg.networkProfiles[name] = {
          offline: false,
          latencyMs: c.int(np.latencyMs, `${p}/latencyMs`, 0, 60000, cfg.networkProfiles[name].latencyMs),
          downBps: c.int(np.downBps, `${p}/downBps`, 1, 1e10, cfg.networkProfiles[name].downBps),
          upBps: c.int(np.upBps, `${p}/upBps`, 1, 1e10, cfg.networkProfiles[name].upBps),
        };
      }
      const fl = obj.networkProfiles.flaky;
      if (fl !== undefined) {
        if (!isPlainObject(fl)) c.err('/networkProfiles/flaky', 'must be {base, cycleMs, offlineMs}');
        else {
          c.keys(fl, '/networkProfiles/flaky', ['base', 'cycleMs', 'offlineMs']);
          const flaky = {
            base: c.oneOf(fl.base, '/networkProfiles/flaky/base', PAGE_LOAD_PROFILES, 'slow4g'),
            cycleMs: c.int(fl.cycleMs, '/networkProfiles/flaky/cycleMs', 500, 600000, 4000),
            offlineMs: c.int(fl.offlineMs, '/networkProfiles/flaky/offlineMs', 100, 600000, 1500),
          };
          if (flaky.offlineMs >= flaky.cycleMs) c.err('/networkProfiles/flaky/offlineMs', 'must be smaller than cycleMs');
          cfg.networkProfiles.flaky = flaky;
        }
      }
    }
  }
  cfg.cpuThrottle = c.num(obj.cpuThrottle, '/cpuThrottle', 1, 6, 1);
  cfg.reducedMotion = c.bool(obj.reducedMotion, '/reducedMotion', false);
  cfg.media = { forcedColors: null, prefersContrast: null, hover: null };
  if (obj.media !== undefined) {
    if (!isPlainObject(obj.media)) c.err('/media', 'must be an object');
    else {
      c.keys(obj.media, '/media', ['forcedColors', 'prefersContrast', 'hover']);
      cfg.media.forcedColors = c.oneOf(obj.media.forcedColors, '/media/forcedColors', ['active', 'none', null], null);
      cfg.media.prefersContrast = c.oneOf(obj.media.prefersContrast, '/media/prefersContrast', ['more', 'less', 'no-preference', null], null);
      cfg.media.hover = c.oneOf(obj.media.hover, '/media/hover', ['hover', 'none', null], null);
    }
  }
  cfg.timezone = null;
  if (obj.timezone !== undefined && obj.timezone !== null) {
    if (typeof obj.timezone !== 'string' || !TZ_RE.test(obj.timezone) || obj.timezone.length > 64) c.err('/timezone', 'must be an IANA zone such as America/New_York, or null');
    else cfg.timezone = obj.timezone;
  }
  cfg.locale = null;
  if (obj.locale !== undefined && obj.locale !== null) {
    if (typeof obj.locale !== 'string' || !LOCALE_RE.test(obj.locale)) c.err('/locale', 'must look like en-US, or null');
    else cfg.locale = obj.locale;
  }
  cfg.clock = { now: null };
  if (obj.clock !== undefined) {
    if (!isPlainObject(obj.clock)) c.err('/clock', 'must be {now}');
    else {
      c.keys(obj.clock, '/clock', ['now']);
      const now = obj.clock.now;
      if (now !== undefined && now !== null) {
        if (typeof now !== 'string' || !ISO_INSTANT_RE.test(now) || !Number.isFinite(Date.parse(now))) c.err('/clock/now', 'must be an ISO-8601 instant with an offset (e.g. 2026-10-11T23:58:00-05:00) or null');
        else cfg.clock.now = now;
      }
    }
  }
  cfg.repeat = c.int(obj.repeat, '/repeat', 1, 5, 1);
  cfg.warmup = c.bool(obj.warmup, '/warmup', true);
  cfg.settleMs = c.int(obj.settleMs, '/settleMs', 0, 60000, 800);
  cfg.navigationTimeoutMs = c.int(obj.navigationTimeoutMs, '/navigationTimeoutMs', 1000, 120000, 30000);
  cfg.freezeAnimations = c.bool(obj.freezeAnimations, '/freezeAnimations', true);
  cfg.muteAudio = c.bool(obj.muteAudio, '/muteAudio', true);
  cfg.checks = { ...DEFAULT_CHECKS };
  if (obj.checks !== undefined) {
    if (!isPlainObject(obj.checks)) c.err('/checks', 'must be an object');
    else {
      c.keys(obj.checks, '/checks', Object.keys(DEFAULT_CHECKS));
      for (const k of Object.keys(DEFAULT_CHECKS)) {
        if (k === 'zoom') cfg.checks.zoom = c.oneOf(obj.checks.zoom, '/checks/zoom', [null, 200, 400], null);
        else cfg.checks[k] = c.bool(obj.checks[k], `/checks/${k}`, DEFAULT_CHECKS[k]);
      }
    }
  }
  cfg.stableShots = { ...DEFAULT_STABLE_SHOTS };
  if (obj.stableShots !== undefined) {
    if (!isPlainObject(obj.stableShots)) c.err('/stableShots', 'must be {maxAttempts, intervalMs}');
    else {
      c.keys(obj.stableShots, '/stableShots', ['maxAttempts', 'intervalMs']);
      cfg.stableShots.maxAttempts = c.int(obj.stableShots.maxAttempts, '/stableShots/maxAttempts', 1, 10, DEFAULT_STABLE_SHOTS.maxAttempts);
      cfg.stableShots.intervalMs = c.int(obj.stableShots.intervalMs, '/stableShots/intervalMs', 0, 2000, DEFAULT_STABLE_SHOTS.intervalMs);
    }
  }
  cfg.emulation = { safeAreaInsets: null, smallViewportHeightDifference: null, virtualKeyboardHeight: null };
  if (obj.emulation !== undefined && obj.emulation !== null) {
    if (!isPlainObject(obj.emulation)) c.err('/emulation', 'must be an object');
    else {
      c.keys(obj.emulation, '/emulation', EMULATION_KEYS);
      const sa = obj.emulation.safeAreaInsets;
      if (sa !== undefined && sa !== null) {
        if (!isPlainObject(sa)) c.err('/emulation/safeAreaInsets', 'must be null or {top, bottom, left, right}');
        else {
          c.keys(sa, '/emulation/safeAreaInsets', ['top', 'bottom', 'left', 'right']);
          const insets = {};
          for (const side of ['top', 'bottom', 'left', 'right']) {
            if (sa[side] === undefined) c.err(`/emulation/safeAreaInsets/${side}`, 'required');
            insets[side] = c.int(sa[side], `/emulation/safeAreaInsets/${side}`, 0, 200, 0);
          }
          cfg.emulation.safeAreaInsets = insets;
        }
      }
      const svh = obj.emulation.smallViewportHeightDifference;
      if (svh !== undefined && svh !== null) cfg.emulation.smallViewportHeightDifference = c.int(svh, '/emulation/smallViewportHeightDifference', 0, 400, null);
      const kb = obj.emulation.virtualKeyboardHeight;
      if (kb !== undefined && kb !== null) cfg.emulation.virtualKeyboardHeight = c.int(kb, '/emulation/virtualKeyboardHeight', 0, 1200, null);
    }
  }
  cfg.maxContrastSamples = c.int(obj.maxContrastSamples, '/maxContrastSamples', 1, 5000, 400);
  cfg.maxFocusStops = c.int(obj.maxFocusStops, '/maxFocusStops', 1, 500, 80);
  const shared = { baseUrl: cfg.baseUrl, configDir, routeIds: new Set(), saveNames: new Set(), usesAccounts: false, usesSessions: false };
  cfg.routes = [];
  if (!Array.isArray(obj.routes) || obj.routes.length === 0 || obj.routes.length > 200) c.err('/routes', 'must be a non-empty array (at most 200)');
  else obj.routes.forEach((r, i) => { const route = validateRoute(r, `/routes/${i}`, c, shared); if (route) cfg.routes.push(route); });
  // Host CPU calibration: on by default when vitals are repeated, because only then are lab
  // numbers compared across runs or hosts.
  cfg.benchmark = c.bool(obj.benchmark, '/benchmark', cfg.checks.vitals && cfg.repeat > 1);
  cfg.usesAccounts = shared.usesAccounts;
  cfg.usesSessions = shared.usesSessions;
  // What the base URL is supposed to be. "disposable": the sandboxed build of §4, which must
  // prove itself with a readyMarker or --expect-header before any capture. "running-app-get-only":
  // an app the owner already runs (guidance mode (b), with the owner's OK): GET-only pages, no
  // steps, no session and no warm-up, because even a login or a page view can write state.
  cfg.target = null;
  if (obj.target === undefined || obj.target === null) c.err('/target', `refused: the config must declare target (${TARGETS.join('|')}) so a stray run cannot reach the owner's own app`, true);
  else cfg.target = c.oneOf(obj.target, '/target', TARGETS, null);
  cfg.readyMarker = null;
  if (obj.readyMarker !== undefined && obj.readyMarker !== null) {
    const rm = obj.readyMarker;
    if (!isPlainObject(rm)) c.err('/readyMarker', 'must be null or {path, selector, text?, timeoutMs?}');
    else {
      c.keys(rm, '/readyMarker', ['path', 'selector', 'text', 'timeoutMs']);
      const marker = {
        path: rm.path,
        selector: c.text(rm.selector, '/readyMarker/selector', 500),
        text: rm.text === undefined || rm.text === null ? null : c.text(rm.text, '/readyMarker/text', 200),
        timeoutMs: c.int(rm.timeoutMs, '/readyMarker/timeoutMs', 100, 60000, 10000),
      };
      if (typeof rm.path !== 'string') c.err('/readyMarker/path', 'required string');
      else if (cfg.baseUrl && !resolveRouteUrl(cfg.baseUrl, rm.path)) c.err('/readyMarker/path', 'refused: path must start with a single "/" and stay on the base origin', true);
      if (marker.selector !== undefined && marker.text !== undefined) cfg.readyMarker = marker;
    }
  }
  if (cfg.target === 'running-app-get-only') {
    cfg.warmup = false;
    if (Array.isArray(obj.routes)) obj.routes.forEach((r, i) => {
      if (!isPlainObject(r)) return;
      if (Array.isArray(r.steps) && r.steps.length > 0) c.err(`/routes/${i}/steps`, 'refused: target running-app-get-only allows no steps', true);
      if (r.storageState !== undefined && r.storageState !== null) c.err(`/routes/${i}/storageState`, 'refused: target running-app-get-only allows no storageState', true);
      if (r.saveStorage !== undefined && r.saveStorage !== null) c.err(`/routes/${i}/saveStorage`, 'refused: target running-app-get-only allows no saveStorage', true);
    });
  }
  return { config: errors.length ? null : cfg, errors };
}

/**
 * The run-time half of the target guard: a "disposable" target must name a proof that it is
 * the sandboxed build (a readyMarker in the config or --expect-header on the command line).
 * Returns a refusal message, or null when the run may proceed.
 */
export function targetGuard(config, { expectHeader = null } = {}) {
  if (!config || !TARGETS.includes(config.target)) return 'the config must declare target';
  if (config.target === 'disposable' && !config.readyMarker && !expectHeader) {
    return 'target "disposable" needs a readyMarker in the config or --expect-header <name>=<value>, so the probe can tell the sandboxed build from an app the owner is running';
  }
  return null;
}

/** Expands routes × viewports × themes × repeats, applying the --only/--viewport/--theme filters. */
export function buildPlan(config, filters = {}) {
  const errors = [];
  const captures = [];
  if (!config) return { captures, errors: ['no valid config'] };
  const pick = (all, wanted, label, key) => {
    if (!wanted || wanted.length === 0) return all;
    for (const w of wanted) if (!all.some((x) => (key ? x[key] : x) === w)) errors.push(`${label} "${printable(w, 60)}" is not in the config`);
    return all.filter((x) => wanted.includes(key ? x[key] : x));
  };
  const routes = pick(config.routes, filters.only, '--only route', 'id');
  const viewports = pick(config.viewports, filters.viewport, '--viewport', 'id');
  const themes = pick(config.themes, filters.theme, '--theme', null);
  const total = routes.length * viewports.length * themes.length * config.repeat;
  if (total > MAX_CAPTURES) errors.push(`plan has ${total} captures; the limit is ${MAX_CAPTURES}, narrow it with --only/--viewport/--theme`);
  if (errors.length) return { captures: [], errors };
  for (const route of routes) {
    for (const viewport of viewports) {
      for (const theme of themes) {
        for (let k = 1; k <= config.repeat; k++) {
          const stem = captureStem(route.id, viewport.id, theme, k, config.repeat);
          captures.push({
            routeId: route.id, path: route.path, url: resolveRouteUrl(config.baseUrl, route.path),
            viewportId: viewport.id, theme, repeatIndex: k, stem,
            files: { json: `captures/${stem}.json`, full: `captures/${stem}.full.png`, view: `captures/${stem}.view.png` },
          });
        }
      }
    }
  }
  return { captures, errors };
}

// ---------------------------------------------------------------------------
// In-page scripts. Each is a single function serialised into the page together
// with PAGE_HELPERS; none may reference anything else from this module.
// ---------------------------------------------------------------------------

function __describe(el) {
  if (!el || el.nodeType !== 1) return null;
  const parts = [];
  let node = el;
  for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
    let part = node.localName;
    if (node.id && /^[A-Za-z][\w-]{0,40}$/.test(node.id)) { parts.unshift(`${part}#${node.id}`); break; }
    const cls = typeof node.className === 'string'
      ? node.className.trim().split(/\s+/).filter((x) => x && x.length < 40 && !/[:[\]/()%.!@#]/.test(x)).slice(0, 2) : [];
    if (cls.length) part += `.${cls.join('.')}`;
    const parent = node.parentElement;
    if (parent) {
      const same = Array.prototype.filter.call(parent.children, (ch) => ch.localName === node.localName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
    if (!node || node.localName === 'body' || node.localName === 'html') break;
  }
  return parts.join(' > ').slice(0, 200);
}

function __visible(el) {
  if (!el || el.nodeType !== 1) return false;
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function __accName(el) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = clean(by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
    if (t) return t;
  }
  if (el.labels && el.labels.length) {
    const t = clean(Array.from(el.labels).map((l) => l.textContent).join(' '));
    if (t) return t;
  }
  if (el.localName === 'img') return clean(el.getAttribute('alt'));
  if (el.localName === 'input' && ['button', 'submit', 'reset'].includes(el.type)) return clean(el.value);
  const text = clean(el.innerText || el.textContent);
  if (text) return text;
  const img = el.querySelector && el.querySelector('img[alt]');
  if (img && clean(img.alt)) return clean(img.alt);
  const svgTitle = el.querySelector && el.querySelector('svg title');
  if (svgTitle && clean(svgTitle.textContent)) return clean(svgTitle.textContent);
  return clean(el.getAttribute('title')) || clean(el.getAttribute('placeholder'));
}

function __rgba(color) {
  let cx = window.__uiProbeCtx;
  if (!cx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    cx = window.__uiProbeCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  cx.clearRect(0, 0, 1, 1);
  cx.fillStyle = '#000';
  cx.fillStyle = color;
  cx.fillRect(0, 0, 1, 1);
  const d = cx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}

function __overflow(opts) {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const offenders = [];
  const clipped = [];
  const recorded = new Set();
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== de; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
    }
    return false;
  };
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of all) {
    if (offenders.length >= 100 && clipped.length >= 100) break;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const left = r.left + window.scrollX;
    const right = r.right + window.scrollX;
    if ((right > vw + 1 || left < -1) && !inScroller(el) && offenders.length < 100) {
      let covered = false;
      for (let p = el.parentElement; p; p = p.parentElement) if (recorded.has(p)) { covered = true; break; }
      if (!covered) { recorded.add(el); offenders.push({ selector: __describe(el), left: Math.round(left), right: Math.round(right) }); }
    }
    if (clipped.length < 100 && Array.prototype.some.call(el.childNodes, (n) => n.nodeType === 3 && n.nodeValue.trim())) {
      const clampedByDesign = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
      const hx = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const hy = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!clampedByDesign && hx && el.scrollWidth > el.clientWidth + 1) clipped.push({ selector: __describe(el), text });
      else if (!clampedByDesign && opts && opts.vertical && hy && el.scrollHeight > el.clientHeight + 1) clipped.push({ selector: __describe(el), text });
    }
  }
  return { scrollWidth: de.scrollWidth, clientWidth: vw, hasHorizontalScroll: de.scrollWidth > vw, offenders, clipped };
}

function __contrast(max) {
  const failures = [];
  const manual = [];
  let checked = 0;
  const seen = new Set();
  const rootCs = getComputedStyle(document.documentElement);
  const darkCanvas = /dark/.test(rootCs.colorScheme || '') && (!/light/.test(rootCs.colorScheme) || matchMedia('(prefers-color-scheme: dark)').matches);
  const canvasColor = darkCanvas ? [18, 18, 18, 1] : [255, 255, 255, 1];
  const fmt = (c) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Math.round(c[3] * 1000) / 1000})`;
  if (!document.body) return { checked, failures, manual };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && checked < max) {
    const t = walker.currentNode;
    if (!t.nodeValue || !t.nodeValue.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (['script', 'style', 'noscript', 'template', 'title', 'option'].includes(el.localName)) continue;
    if (!__visible(el)) continue;
    const selector = __describe(el);
    if (el.closest('button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]')) {
      if (manual.length < 100) manual.push({ selector, reason: 'disabled control: exempt from 1.4.3, listed for review' });
      continue;
    }
    checked += 1;
    const cs = getComputedStyle(el);
    const fg = __rgba(cs.color);
    let opacity = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const o = parseFloat(getComputedStyle(n).opacity);
      if (Number.isFinite(o)) opacity *= o;
    }
    fg[3] *= opacity;
    let bg = [0, 0, 0, 0];
    let reason = null;
    for (let n = el; n; n = n.parentElement) {
      const ns = getComputedStyle(n);
      if (ns.backgroundImage && ns.backgroundImage !== 'none') { reason = 'background image or gradient behind text'; break; }
      const layer = __rgba(ns.backgroundColor);
      if (layer[3] > 0) {
        bg = compositeRgba(bg, layer);
        if (bg[3] >= 0.999) break;
      }
    }
    if (reason) { if (manual.length < 100) manual.push({ selector, reason }); continue; }
    if (bg[3] < 0.999) bg = compositeRgba(bg, canvasColor);
    const ratio = contrastRatio(fg, bg);
    const px = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const required = requiredContrast(px, weight);
    if (ratio + 1e-9 < required && failures.length < 200) {
      failures.push({
        selector, text: t.nodeValue.replace(/\s+/g, ' ').trim().slice(0, 60),
        fg: fmt(fg[3] < 1 ? compositeRgba(fg, bg) : fg), bg: fmt(bg),
        ratio: Math.round(ratio * 100) / 100, required, fontSizePx: px, fontWeight: weight,
      });
    }
  }
  return { checked, failures, manual };
}

function __tapTargets(mobile) {
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])';
  const under24 = [];
  const under44 = [];
  let checked = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]')) continue;
    if (!__visible(el)) continue;
    let r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) continue;
    if (el.localName === 'a' && getComputedStyle(el).display === 'inline') {
      const parentText = el.parentElement ? (el.parentElement.innerText || '').trim() : '';
      const ownText = (el.innerText || '').trim();
      if (parentText.length > ownText.length + 10) continue;
    }
    if ((el.type === 'checkbox' || el.type === 'radio') && el.labels && el.labels[0]) {
      const lr = el.labels[0].getBoundingClientRect();
      if (lr.width * lr.height > r.width * r.height) r = lr;
    }
    checked += 1;
    const item = { selector: __describe(el), width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10, name: __accName(el).slice(0, 80) };
    if ((r.width < 24 || r.height < 24) && under24.length < 150) under24.push(item);
    if (mobile && (r.width < 44 || r.height < 44) && under44.length < 150) under44.push(item);
  }
  return { checked, under24, under44 };
}

function __structure() {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const meta = (s) => { const m = document.querySelector(s); return m ? m.getAttribute('content') : null; };
  const headings = q('h1,h2,h3,h4,h5,h6,[role=heading]').filter(__visible).map((h) => {
    const aria = parseInt(h.getAttribute('aria-level'), 10);
    const tag = /^h([1-6])$/.exec(h.localName);
    return { level: Number.isFinite(aria) ? aria : tag ? Number(tag[1]) : 2, text: (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
  });
  const unlabeledFields = q('input,select,textarea').filter((el) => {
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type)) return false;
    if (getComputedStyle(el).display === 'none') return false;
    return !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.getAttribute('title');
  }).slice(0, 100).map((el) => ({ selector: __describe(el), type: el.type || el.localName }));
  const imagesWithoutAlt = q('img').filter((img) => !img.hasAttribute('alt')).slice(0, 100)
    .map((img) => ({ selector: __describe(img), src: String(img.currentSrc || img.getAttribute('src') || '').slice(0, 200) }));
  const unnamedButtons = q('button,[role=button],input[type=button],input[type=submit]').filter((el) => __visible(el) && !__accName(el))
    .slice(0, 100).map((el) => ({ selector: __describe(el) }));
  const og = {};
  for (const m of q('meta[property^="og:"]')) og[m.getAttribute('property')] = (m.getAttribute('content') || '').slice(0, 300);
  const twitter = {};
  for (const m of q('meta[name^="twitter:"]')) twitter[m.getAttribute('name')] = (m.getAttribute('content') || '').slice(0, 300);
  const icons = q('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="mask-icon"]').slice(0, 20)
    .map((l) => ({ rel: l.getAttribute('rel'), href: l.href, sizes: l.getAttribute('sizes'), type: l.getAttribute('type') }));
  const manifest = document.querySelector('link[rel="manifest"]');
  return {
    title: document.title,
    lang: document.documentElement.getAttribute('lang'),
    metaViewport: meta('meta[name="viewport"]'),
    h1Count: headings.filter((h) => h.level === 1).length,
    headingSkips: headingSkips(headings),
    landmarks: {
      main: q('main,[role=main]').length,
      nav: q('nav,[role=navigation]').length,
      header: q('header,[role=banner]').length,
      footer: q('footer,[role=contentinfo]').length,
    },
    unlabeledFields,
    imagesWithoutAlt,
    unnamedButtons,
    badText: findBadText(document.body ? document.body.innerText : ''),
    head: {
      description: meta('meta[name="description"]'),
      og,
      twitter,
      icons,
      manifest: manifest ? manifest.href : null,
      themeColor: q('meta[name="theme-color"]').map((m) => ({ content: m.getAttribute('content'), media: m.getAttribute('media') })),
    },
  };
}

function __focusSignature(el) {
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}` : 'none';
  return `${outline}|${cs.boxShadow}|${cs.borderTopColor} ${cs.borderTopWidth} ${cs.borderBottomColor} ${cs.borderBottomWidth}`;
}

function __focusBaseline() {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  window.scrollTo(0, 0);
  // Move the sequential-focus starting point to the top of the document. The body gets a
  // temporary tabindex only when it has none, and it is removed straight away.
  const body = document.body;
  if (body) {
    const had = body.hasAttribute('tabindex');
    if (!had) body.setAttribute('tabindex', '-1');
    body.focus({ preventScroll: true });
    body.blur();
    if (!had) body.removeAttribute('tabindex');
  }
  const base = new WeakMap();
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable="true"],iframe';
  let tabbables = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]') || !__visible(el)) continue;
    tabbables += 1;
    base.set(el, __focusSignature(el));
  }
  window.__uiProbeFocusBase = base;
  window.__uiProbeFocusIds = new WeakMap();
  window.__uiProbeFocusNext = 0;
  return { tabbables };
}

function __focusStop() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { none: true };
  let id = window.__uiProbeFocusIds.get(el);
  const seen = id !== undefined;
  if (!seen) { id = window.__uiProbeFocusNext++; window.__uiProbeFocusIds.set(el, id); }
  const base = window.__uiProbeFocusBase.get(el);
  const visibleIndicator = base === undefined ? null : __focusSignature(el) !== base;
  const r = el.getBoundingClientRect();
  const covers = [];
  for (const c of document.querySelectorAll('body *')) {
    if (c === el || c.contains(el) || el.contains(c)) continue;
    const pos = getComputedStyle(c).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    if (!__visible(c)) continue;
    const cr = c.getBoundingClientRect();
    const ix = Math.max(r.left, cr.left);
    const iy = Math.max(r.top, cr.top);
    const ax = Math.min(r.right, cr.right);
    const ay = Math.min(r.bottom, cr.bottom);
    if (ax <= ix || ay <= iy) continue;
    const hit = document.elementFromPoint((ix + ax) / 2, (iy + ay) / 2);
    if (hit && (hit === c || c.contains(hit))) covers.push({ x: cr.left, y: cr.top, width: cr.width, height: cr.height });
  }
  const modal = document.querySelector('dialog:modal, [aria-modal="true"]');
  return {
    none: false, id, seen,
    selector: __describe(el),
    name: __accName(el).slice(0, 80),
    visibleIndicator,
    obscured: isFocusObscured({ x: r.left, y: r.top, width: r.width, height: r.height }, covers),
    inModal: !!(modal && modal.contains(el)),
  };
}

function __textSpacing(on) {
  const id = '__ui_probe_text_spacing';
  const existing = document.getElementById(id);
  if (!on) { if (existing) existing.remove(); return true; }
  if (existing) return true;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}';
  (document.head || document.documentElement).appendChild(st);
  return true;
}

function __freeze() {
  if (!document.getElementById('__ui_probe_freeze')) {
    const st = document.createElement('style');
    st.id = '__ui_probe_freeze';
    st.textContent = '*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-delay:0s!important;animation-play-state:paused!important;caret-color:transparent!important;scroll-behavior:auto!important}';
    (document.head || document.documentElement).appendChild(st);
  }
  for (const a of document.getAnimations ? document.getAnimations() : []) {
    try { a.finish(); } catch { try { a.pause(); } catch { /* ignore */ } }
  }
  return true;
}

function __caret(on) {
  const id = '__ui_probe_caret';
  const existing = document.getElementById(id);
  if (!on) { if (existing) existing.remove(); return true; }
  if (existing) return true;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = 'input,textarea,[contenteditable]{caret-color:transparent!important}';
  (document.head || document.documentElement).appendChild(st);
  return true;
}

async function __fontsState(timeoutMs) {
  if (!document.fonts) return { ready: true, errors: [] };
  let ready = false;
  let timer;
  await Promise.race([
    document.fonts.ready.then(() => { ready = true; }),
    new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  clearTimeout(timer);
  const errors = [];
  document.fonts.forEach((face) => {
    const family = String(face.family || '').replace(/^["']|["']$/g, '').slice(0, 100);
    if (face.status === 'error' && family && !errors.includes(family) && errors.length < 20) errors.push(family);
  });
  return { ready, errors };
}

function __masks(selectors) {
  // Opaque overlays over volatile regions, for the screenshots only. Two layers: one scrolls
  // with the document, one stays with the viewport for elements inside a fixed ancestor. Each
  // layer's own offset is measured after insertion, so a positioned <html> or <body> margin
  // cannot shift the boxes.
  for (const id of ['__ui_probe_masks', '__ui_probe_masks_fixed']) { const old = document.getElementById(id); if (old) old.remove(); }
  if (selectors === null) return [];
  const base = 'left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;'
    + 'z-index:2147483647!important;pointer-events:none!important;display:block!important;visibility:visible!important;opacity:1!important;transform:none!important;';
  const layer = document.createElement('div');
  layer.id = '__ui_probe_masks';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = `position:absolute!important;${base}`;
  const fixedLayer = document.createElement('div');
  fixedLayer.id = '__ui_probe_masks_fixed';
  fixedLayer.setAttribute('aria-hidden', 'true');
  fixedLayer.style.cssText = `position:fixed!important;${base}`;
  document.documentElement.appendChild(layer);
  document.documentElement.appendChild(fixedLayer);
  const origin = layer.getBoundingClientRect();
  const fixedOrigin = fixedLayer.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const results = [];
  for (const selector of selectors) {
    let els;
    try { els = Array.from(document.querySelectorAll(selector)); } catch { results.push({ selector, count: 0, areaPct: 0, invalid: true }); continue; }
    let count = 0;
    let area = 0;
    for (const el of els) {
      if (el === layer || el === fixedLayer || !__visible(el)) continue;
      const r = el.getBoundingClientRect();
      let fixed = false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') { fixed = true; break; }
      const o = fixed ? fixedOrigin : origin;
      const box = document.createElement('div');
      box.style.cssText = `position:absolute!important;left:${r.left - o.left}px!important;top:${r.top - o.top}px!important;width:${r.width}px!important;height:${r.height}px!important;`
        + 'background:#FF00FF!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;display:block!important;opacity:1!important;';
      (fixed ? fixedLayer : layer).appendChild(box);
      count += 1;
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      area += w * h;
    }
    results.push({ selector, count, areaPct: vw > 0 && vh > 0 ? Math.min(100, Math.round((area / (vw * vh)) * 10000) / 100) : 0 });
  }
  return results;
}

function __navState() {
  const nav = performance.getEntriesByType('navigation')[0];
  const nrr = nav && nav.notRestoredReasons ? nav.notRestoredReasons : null;
  let reasons = null;
  if (nrr) {
    reasons = [];
    const walk = (node, depth) => {
      if (!node || depth > 5) return;
      for (const r of node.reasons || []) {
        const text = typeof r === 'string' ? r : r && r.reason;
        if (text && reasons.length < 20) reasons.push(String(text).slice(0, 100));
      }
      for (const child of node.children || []) walk(child, depth + 1);
    };
    walk(nrr, 0);
  }
  return { persisted: typeof window.__uiProbePageshow === 'boolean' ? window.__uiProbePageshow : null, notRestoredReasons: reasons };
}

const PAGESHOW_SOURCE = `(() => { if (window !== window.top) return;
addEventListener('pageshow', (e) => { window.__uiProbePageshow = !!e.persisted; }); })();`;

// Fixed integer work (xorshift32), three runs, timed inside the page. Used only on about:blank.
const BENCHMARK_SOURCE = `(() => { const runs = []; for (let r = 0; r < 3; r++) { let x = 2463534242; const t0 = performance.now();
for (let i = 0; i < 5000000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; }
const t1 = performance.now(); runs.push(Math.round((t1 - t0) * 10) / 10); if (x === 0) runs.push(-1); } return runs; })()`;

/** Host benchmark record: the three run times, their median and the CPU slowdown the captures used. */
export function benchmarkSummary(runsMs, cpuThrottle) {
  const runs = (Array.isArray(runsMs) ? runsMs : []).filter((v) => Number.isFinite(v) && v >= 0);
  const sorted = [...runs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  return { runsMs: runs, medianMs, cpuThrottle };
}

/**
 * Centre of an element for Input.dispatch*Event. getBoundingClientRect is in layout-viewport
 * coordinates, while input events land in the visual viewport, which a mobile page that overflows
 * horizontally pans on its own (scrollIntoView moves it). The point is therefore shifted by the
 * visual viewport's offset and scaled by its scale. hit tells whether the element (or a descendant)
 * is what the browser finds at that point, so a covered or panned-away target fails the step
 * instead of tapping something else.
 */
function __elementCenter(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const vv = window.visualViewport;
  const offsetLeft = vv ? vv.offsetLeft : 0;
  const offsetTop = vv ? vv.offsetTop : 0;
  const scale = vv && vv.scale > 0 ? vv.scale : 1;
  const x = (cx - offsetLeft) * scale;
  const y = (cy - offsetTop) * scale;
  const width = vv ? vv.width * scale : window.innerWidth;
  const height = vv ? vv.height * scale : window.innerHeight;
  const found = document.elementFromPoint(cx, cy);
  const hit = !!found && (found === el || el.contains(found));
  return {
    x, y, hit, inView: x >= 0 && y >= 0 && x <= width && y <= height,
    covering: found && !hit ? __describe(found) : null,
    visualOffset: { left: offsetLeft, top: offsetTop, scale },
  };
}

function __scrollState() {
  const vv = window.visualViewport;
  return {
    x: Math.round(window.scrollX), y: Math.round(window.scrollY),
    visualLeft: vv ? Math.round(vv.offsetLeft) : 0, visualTop: vv ? Math.round(vv.offsetTop) : 0,
    scale: vv ? Math.round(vv.scale * 1000) / 1000 : 1,
  };
}

/**
 * Back to the origin. On a mobile page whose layout viewport grew to the content width,
 * window.scrollTo moves nothing while the visual viewport stays panned; only scrolling an element
 * at the document origin into view brings the visual viewport back, so a 1 px anchor is used.
 */
function __resetScroll() {
  window.scrollTo(0, 0);
  const vv = window.visualViewport;
  if (vv && (vv.offsetLeft !== 0 || vv.offsetTop !== 0)) {
    const anchor = document.createElement('div');
    anchor.setAttribute('aria-hidden', 'true');
    anchor.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;margin:0;padding:0;border:0;pointer-events:none;';
    document.documentElement.appendChild(anchor);
    anchor.scrollIntoView({ block: 'start', inline: 'start' });
    anchor.remove();
  }
  return true;
}

function __focusForFill(selector) {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (typeof el.select === 'function') el.select();
  else if (el.isContentEditable) document.execCommand('selectAll');
  return document.activeElement === el;
}

function __selectValue(arg) {
  const el = document.querySelector(arg.selector);
  if (!el || el.localName !== 'select') return 'not a <select>';
  if (!Array.from(el.options).some((o) => o.value === arg.value)) return 'no option with that value';
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(el, arg.value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function __isChecked(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  if (typeof el.checked === 'boolean') return el.checked;
  return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
}

function __scroll(arg) {
  if (arg.selector) {
    const el = document.querySelector(arg.selector);
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    return true;
  }
  window.scrollTo(0, arg.y);
  return true;
}

function __visibleSelector(selector) {
  const el = document.querySelector(selector);
  return !!el && __visible(el);
}

function __vitalsInit() {
  if (window !== window.top || window.__uiProbeVitals) return;
  const v = window.__uiProbeVitals = { lcpMs: null, lcpElement: null, shifts: [], interactions: {}, longTasks: [] };
  const observe = (type, fn, extra) => {
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) fn(e); })
        .observe(Object.assign({ type, buffered: true }, extra || {}));
    } catch { /* unsupported entry type */ }
  };
  observe('largest-contentful-paint', (e) => { v.lcpMs = e.startTime; v.lcpElement = e.element ? __describe(e.element) : (e.url || null); });
  observe('layout-shift', (e) => {
    if (v.shifts.length < 2000) {
      v.shifts.push({ startTime: e.startTime, value: e.value, hadRecentInput: e.hadRecentInput, sources: (e.sources || []).map((s) => (s.node && s.node.nodeType === 1 ? __describe(s.node) : null)).filter(Boolean).slice(0, 3) });
    }
  });
  observe('event', (e) => { if (e.interactionId) { const k = String(e.interactionId); v.interactions[k] = Math.max(v.interactions[k] || 0, e.duration); } }, { durationThreshold: 16 });
  observe('longtask', (e) => { if (v.longTasks.length < 2000) v.longTasks.push(e.duration); });
}

function __readVitals() {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const v = window.__uiProbeVitals || null;
  return {
    ttfb: nav ? nav.responseStart : null,
    fcp: fcp ? fcp.startTime : null,
    lcpMs: v ? v.lcpMs : null,
    lcpElement: v ? v.lcpElement : null,
    shifts: v ? v.shifts : [],
    interactions: v ? Object.values(v.interactions) : [],
    interactionCount: typeof performance.interactionCount === 'number' ? performance.interactionCount : null,
    longTasks: v ? v.longTasks : [],
    resources: performance.getEntriesByType('resource').slice(0, 1000).map((e) => ({ name: e.name, initiatorType: e.initiatorType, transferSize: e.transferSize, decodedBodySize: e.decodedBodySize })),
    domNodes: document.getElementsByTagName('*').length,
    href: location.href,
  };
}

const PAGE_HELPERS = [
  srgbToLinear, relativeLuminance, compositeRgba, contrastRatio, isLargeText, requiredContrast, findBadText,
  headingSkips, isFocusObscured, __describe, __visible, __accName, __rgba, __overflow, __focusSignature,
];
const PAGE_PRELUDE = PAGE_HELPERS.map((fn) => fn.toString()).join('\n');

/** Page functions exposed for unit tests (run them through pageScript in a fake page). */
export const PAGE_FUNCTIONS_FOR_TESTS = Object.freeze({ __elementCenter, __scrollState, __resetScroll });

/** Source text that runs `fn(arg)` in the page with the helper functions in scope. */
export function pageScript(fn, arg) {
  return `(() => {\n${PAGE_PRELUDE}\nreturn (${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)});\n})()`;
}

function clockInitSource(offsetMs) {
  return `(() => { if (window.__uiProbeClock !== undefined) return; const R = Date; const off = ${Number(offsetMs)};
function D(...a) { if (!new.target) return new R(R.now() + off).toString(); return a.length ? new R(...a) : new R(R.now() + off); }
D.prototype = R.prototype; D.now = () => R.now() + off; D.parse = R.parse; D.UTC = R.UTC;
Object.defineProperty(window, 'Date', { value: D, writable: true, configurable: true }); window.__uiProbeClock = off; })();`;
}

const AUDIO_MUTE_SOURCE = `(() => { const play = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function (...a) { try { this.muted = true; } catch (e) {} return play.apply(this, a); }; })();`;

function storageSeedSource(origin, items, removals) {
  return `(() => { if (location.origin !== ${JSON.stringify(origin)}) return; try {
for (const k of ${JSON.stringify(removals)}) localStorage.removeItem(k);
for (const [k, v] of ${JSON.stringify(items)}) localStorage.setItem(k, v); } catch (e) {} })();`;
}

// ---------------------------------------------------------------------------
// CDP plumbing
// ---------------------------------------------------------------------------

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }

  static connect(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (typeof WebSocket !== 'function') { reject(new Error('this Node has no global WebSocket; use Node 22 or newer')); return; }
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { reject(new Error('CDP WebSocket did not open in time')); try { ws.close(); } catch { /* ignore */ } }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new CdpConnection(ws)); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket error')); }, { once: true });
    });
  }

  onMessage(data) {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result || {});
      return;
    }
    if (!msg.method) return;
    const set = this.listeners.get(`${msg.sessionId || ''}|${msg.method}`);
    if (set) for (const fn of [...set]) { try { fn(msg.params || {}); } catch { /* listener errors are ignored */ } }
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timed out after ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(sessionId, method, fn) {
    const key = `${sessionId || ''}|${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(fn);
    return () => this.listeners.get(key)?.delete(fn);
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const liveChildren = new Set();
let exitHooksInstalled = false;

function killChild(child) {
  if (!child || child.exitCode !== null || child.killed) { liveChildren.delete(child); return; }
  try { child.kill(); } catch { /* already gone */ }
  liveChildren.delete(child);
}

function installExitHooks() {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.on('exit', () => { for (const c of [...liveChildren]) killChild(c); });
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    try { process.on(sig, () => { for (const c of [...liveChildren]) killChild(c); process.exit(code); }); } catch { /* signal unsupported */ }
  }
}

async function launchChromium({ executable, outDir, headless }) {
  installExitHooks();
  const profile = path.join(outDir, 'profile');
  const { env, dirs } = browserEnv({ scratchDir: profile });
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  const child = spawn(executable, [...chromiumArgs({ userDataDir: profile, headless }), 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'], env, windowsHide: true,
  });
  liveChildren.add(child);
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    let done = false;
    const finish = (fn, value) => { if (!done) { done = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => finish(reject, new Error('the browser did not announce a DevTools endpoint within 30 s')), 30000);
    child.stderr.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const url = parseDevToolsUrl(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (url) finish(resolve, url);
      }
      if (buffer.length > 65536) buffer = buffer.slice(-4096);
    });
    child.on('error', (e) => finish(reject, e));
    child.on('exit', (code) => finish(reject, new Error(`the browser exited before it was ready (code ${code})`)));
  });
  return { child, wsUrl };
}

async function createCdpDriver({ executable, outDir, headless }) {
  const { child, wsUrl } = await launchChromium({ executable, outDir, headless });
  let conn;
  try { conn = await CdpConnection.connect(wsUrl); } catch (e) { killChild(child); throw e; }
  const version = await conn.send('Browser.getVersion').catch(() => ({}));
  return {
    name: 'cdp',
    browserVersion: version.product || null,
    async newContext() {
      const { browserContextId } = await conn.send('Target.createBrowserContext', {});
      await conn.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId }).catch(() => {});
      return {
        async newPage() {
          const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
          const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
          return {
            session: { send: (m, p, t) => conn.send(m, p, sessionId, t), on: (e, f) => conn.on(sessionId, e, f) },
            close: async () => { await conn.send('Target.closeTarget', { targetId }).catch(() => {}); },
          };
        },
        clearCookies: () => conn.send('Storage.clearCookies', { browserContextId }),
        close: async () => { await conn.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {}); },
      };
    },
    async close() {
      await conn.send('Browser.close', {}, undefined, 5000).catch(() => {});
      conn.close();
      killChild(child);
    },
  };
}

async function createPlaywrightDriver({ mod, name, executable, outDir, headless }) {
  const chromium = mod.chromium || (mod.default && mod.default.chromium);
  if (!chromium || typeof chromium.connectOverCDP !== 'function') throw new Error(`${name} does not expose chromium.connectOverCDP`);
  // The browser is spawned here with chromiumArgs() (the same dead proxy, resolver rules and QUIC
  // flag as the CDP driver) and Playwright attaches over CDP, so its profile stays inside --out.
  const { child, wsUrl } = await launchChromium({ executable, outDir, headless });
  let browser;
  try { browser = await chromium.connectOverCDP(wsUrl); } catch (e) { killChild(child); throw e; }
  return {
    name,
    browserVersion: typeof browser.version === 'function' ? browser.version() : null,
    async newContext() {
      const context = await browser.newContext({ viewport: null, acceptDownloads: false });
      return {
        async newPage() {
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          return {
            session: {
              send: (m, p, t) => withTimeout(cdp.send(m, p), t || 30000, m),
              on: (e, f) => { cdp.on(e, f); return () => cdp.off(e, f); },
            },
            close: async () => { await page.close().catch(() => {}); },
          };
        },
        clearCookies: () => context.clearCookies(),
        close: async () => { await context.close().catch(() => {}); },
      };
    },
    async close() {
      await browser.close().catch(() => {});
      killChild(child);
    },
  };
}

function newestPlaywrightChromium() {
  const base = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null;
  if (!base || !fs.existsSync(base)) return null;
  const builds = fs.readdirSync(base)
    .map((n) => /^chromium-(\d+)$/.exec(n))
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const m of builds) {
    const exe = path.join(base, m[0], 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function findOnPath(names) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const n of names) for (const d of dirs) {
    const candidate = path.join(d, n);
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

function resolveExecutable(explicit, fromConfig, playwrightPath) {
  for (const candidate of [explicit, fromConfig]) {
    if (candidate) return fs.existsSync(candidate) ? { path: candidate, reason: 'given' } : { path: null, reason: `executable not found: ${candidate}` };
  }
  if (playwrightPath && fs.existsSync(playwrightPath)) return { path: playwrightPath, reason: 'playwright bundled browser' };
  if (process.platform === 'win32') {
    const pw = newestPlaywrightChromium();
    if (pw) return { path: pw, reason: 'newest local Playwright Chromium build' };
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      const chrome = path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (fs.existsSync(chrome)) return { path: chrome, reason: 'Google Chrome' };
    }
    for (const root of roots) {
      const edge = path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
      if (fs.existsSync(edge)) return { path: edge, reason: 'Microsoft Edge' };
    }
    return { path: null, reason: 'no Chromium, Chrome or Edge executable found' };
  }
  const found = findOnPath(['google-chrome', 'chromium', 'chromium-browser']);
  return found ? { path: found, reason: 'found on PATH' } : { path: null, reason: 'no google-chrome, chromium or chromium-browser on PATH' };
}

// ---------------------------------------------------------------------------
// Capture runtime
// ---------------------------------------------------------------------------

const KEY_DEFS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 }, Delete: { code: 'Delete', keyCode: 46 }, ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 }, ArrowLeft: { code: 'ArrowLeft', keyCode: 37 }, ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 }, End: { code: 'End', keyCode: 35 }, PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 }, Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};
const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

async function pressKey(s, combo) {
  const parts = combo.split('+');
  const keyName = parts.length > 1 && parts[parts.length - 1] === '' ? '+' : parts.pop();
  let modifiers = 0;
  for (const m of parts) if (MODIFIER_BITS[m]) modifiers |= MODIFIER_BITS[m];
  let def = KEY_DEFS[keyName];
  if (!def) {
    const ch = keyName;
    def = { key: ch, code: /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : '', keyCode: ch.toUpperCase().charCodeAt(0), text: ch };
  }
  const key = def.key ?? keyName;
  const text = modifiers & (1 | 2 | 4) ? undefined : def.text;
  const common = { key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers };
  await s.send('Input.dispatchKeyEvent', { ...common, type: text ? 'keyDown' : 'rawKeyDown', text, unmodifiedText: text });
  await s.send('Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
}

async function evaluate(s, expression, timeoutMs = 15000) {
  const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(clipText((d.exception && d.exception.description) || d.text || 'evaluation failed', 300));
  }
  return r.result ? r.result.value : undefined;
}

const runInPage = (s, fn, arg, timeoutMs) => evaluate(s, pageScript(fn, arg), timeoutMs);

function waitForEvent(s, method, timeoutMs, accept = () => true) {
  let off = () => {};
  let timer;
  const promise = new Promise((resolve, reject) => {
    off = s.on(method, (params) => {
      let ok = false;
      try { ok = accept(params); } catch { ok = false; }
      if (!ok) return;
      clearTimeout(timer); off(); resolve(params);
    });
    timer = setTimeout(() => { off(); reject(new Error(`${method} not received within ${timeoutMs} ms`)); }, timeoutMs);
  });
  return { promise, cancel: () => { clearTimeout(timer); off(); promise.catch(() => {}); } };
}

function remoteObjectText(o) {
  if (!o) return '';
  if (o.type === 'string') return o.value;
  if (o.value !== undefined) { try { return JSON.stringify(o.value); } catch { return String(o.value); } }
  return o.unserializableValue || o.description || o.type;
}

function isBlockedRequest(url, errorText) {
  if (BLOCK_ERRORS.has(errorText)) return true;
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && !isLoopbackHost(u.hostname)) return true;
  } catch { /* not a URL */ }
  return false;
}

function mediaFeatures(media) {
  const f = [
    { name: 'prefers-color-scheme', value: media.colorScheme },
    { name: 'prefers-reduced-motion', value: media.reducedMotion ? 'reduce' : 'no-preference' },
  ];
  if (media.forcedColors) f.push({ name: 'forced-colors', value: media.forcedColors });
  if (media.prefersContrast) f.push({ name: 'prefers-contrast', value: media.prefersContrast });
  if (media.hover === 'hover') f.push({ name: 'hover', value: 'hover' }, { name: 'any-hover', value: 'hover' }, { name: 'pointer', value: 'fine' }, { name: 'any-pointer', value: 'fine' });
  if (media.hover === 'none') f.push({ name: 'hover', value: 'none' }, { name: 'any-hover', value: 'none' }, { name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' });
  return f;
}

async function applyMetrics(s, m) {
  const landscape = m.width > m.height;
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: m.width, height: m.height, deviceScaleFactor: m.dpr, mobile: !!m.mobile,
    screenWidth: m.width, screenHeight: m.height,
    screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 },
  });
}

async function applyNetwork(cap, profileName) {
  stopFlaky(cap);
  const apply = async (cond) => {
    for (const page of cap.pages) {
      await page.session.send('Network.emulateNetworkConditions', {
        offline: !!cond.offline, latency: cond.latencyMs, downloadThroughput: cond.downBps, uploadThroughput: cond.upBps,
      }).catch((e) => cap.probeErrors.push(`network emulation: ${e.message}`));
    }
  };
  const lookup = (name) => cap.config.networkProfiles[name] || NETWORK_PRESETS[name];
  if (profileName !== 'flaky') { await apply(lookup(profileName)); return; }
  const flaky = cap.config.networkProfiles.flaky;
  const base = lookup(flaky.base);
  const started = Date.now();
  let offline = null;
  const tick = async () => {
    const state = flakySchedule(flaky, Date.now() - started);
    if (state.offline !== offline) {
      offline = state.offline;
      await apply(offline ? NETWORK_PRESETS.offline : base);
    }
  };
  await tick();
  cap.flakyTimer = setInterval(() => { tick().catch(() => {}); }, 100);
}

/**
 * Applies the experimental emulation overrides (safe-area insets, small-viewport height,
 * virtual keyboard rectangle) to one tab. A protocol error marks the key "unsupported" and
 * the capture continues; keys left null stay "off".
 */
async function applyEmulation(cap, page) {
  const em = cap.config.emulation;
  const s = page.session;
  const done = cap.emulationApplied;
  const attempt = async (key, method, params) => {
    if (em[key] === null) { done[key] = 'off'; return; }
    try {
      await s.send(method, params);
      if (done[key] !== 'unsupported') done[key] = 'applied';
    } catch (e) {
      done[key] = 'unsupported';
      cap.log(`emulation ${key} unsupported: ${clipText(e.message, 200)}`);
    }
  };
  const sa = em.safeAreaInsets;
  await attempt('safeAreaInsets', 'Emulation.setSafeAreaInsetsOverride', sa ? {
    insets: { top: sa.top, topMax: sa.top, bottom: sa.bottom, bottomMax: sa.bottom, left: sa.left, leftMax: sa.left, right: sa.right, rightMax: sa.right },
  } : null);
  await attempt('smallViewportHeightDifference', 'Emulation.setSmallViewportHeightDifferenceOverride', { difference: em.smallViewportHeightDifference });
  const kb = em.virtualKeyboardHeight;
  const { width, height } = cap.metrics;
  await attempt('virtualKeyboardHeight', 'Emulation.setVirtualKeyboardGeometryOverride', kb === null ? null : {
    keyboardRect: { x: 0, y: Math.max(0, height - kb), width, height: Math.min(kb, height) },
  });
}

function stopFlaky(cap) {
  if (cap.flakyTimer) { clearInterval(cap.flakyTimer); cap.flakyTimer = null; }
}

function attachCollectors(page, cap) {
  const s = page.session;
  const st = cap.state;
  const push = (list, item, key) => { if (list.length < MAX_LIST) list.push(item); else cap.truncated.add(key); };
  s.on('Runtime.consoleAPICalled', (p) => {
    const frame = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0];
    push(st.console, { type: p.type, text: clipText((p.args || []).map(remoteObjectText).join(' '), 500), url: frame ? clipText(frame.url, 300) : null, line: frame ? frame.lineNumber + 1 : null }, 'console');
  });
  s.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    if (e.level !== 'error' && e.level !== 'warning') return;
    push(st.console, { type: e.level, text: clipText(e.text, 500), url: e.url ? clipText(e.url, 300) : null, line: Number.isInteger(e.lineNumber) ? e.lineNumber + 1 : null }, 'console');
  });
  s.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    push(st.pageErrors, { message: clipText((d.exception && d.exception.description) || d.text || 'uncaught exception', 1000) }, 'pageErrors');
  });
  s.on('Network.requestWillBeSent', (p) => {
    if (st.requests.size < 5000) st.requests.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type });
  });
  s.on('Network.responseReceived', (p) => {
    const r = p.response || {};
    if (page === cap.pages[0] && p.type === 'Document' && p.frameId === cap.mainFrameId && st.mainResponse === null) {
      st.mainResponse = { status: r.status, url: r.url };
    }
    if (r.status >= 400) {
      const req = st.requests.get(p.requestId) || {};
      push(st.failedRequests, { url: clipText(r.url, 300), method: req.method || null, status: r.status, errorText: null, resourceType: p.type || null }, 'failedRequests');
    }
  });
  // A failed WebSocket handshake never reaches Network.loadingFailed, so any socket opened
  // towards a non-loopback host is logged here; the dead proxy makes it fail.
  s.on('Network.webSocketCreated', (p) => {
    const url = String(p.url || '');
    let host = null;
    try { host = new URL(url).hostname; } catch { host = null; }
    if (!host || !isLoopbackHost(host)) push(st.blockedRequests, { url: clipText(url, 300), errorText: 'websocket-non-loopback' }, 'blockedRequests');
  });
  s.on('Network.loadingFailed', (p) => {
    const req = st.requests.get(p.requestId) || {};
    const url = req.url || '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (isBlockedRequest(url, p.errorText)) push(st.blockedRequests, { url: clipText(url, 300), errorText: p.errorText }, 'blockedRequests');
    else if (!p.canceled) push(st.failedRequests, { url: clipText(url, 300), method: req.method || null, status: null, errorText: p.blockedReason ? `${p.errorText} (${p.blockedReason})` : p.errorText, resourceType: p.type || null }, 'failedRequests');
  });
}

async function addInit(s, source) {
  const r = await s.send('Page.addScriptToEvaluateOnNewDocument', { source });
  return r.identifier;
}

async function preparePage(page, cap) {
  const s = page.session;
  const cfg = cap.config;
  attachCollectors(page, cap);
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Log.enable').catch(() => {});
  await s.send('Network.enable');
  await s.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (cfg.checks.heap) await s.send('Performance.enable').catch(() => {});
  await applyMetrics(s, cap.metrics);
  await applyEmulation(cap, page);
  await s.send('Emulation.setTouchEmulationEnabled', cap.viewport.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await s.send('Emulation.setEmulatedMedia', { media: '', features: mediaFeatures(cap.media) });
  if (cfg.timezone) await s.send('Emulation.setTimezoneOverride', { timezoneId: cfg.timezone });
  if (cfg.locale) {
    await s.send('Emulation.setLocaleOverride', { locale: cfg.locale }).catch((e) => cap.probeErrors.push(`locale override: ${e.message}`));
    // setLocaleOverride changes only ICU formatting. navigator.language and the Accept-Language
    // header follow the user-agent override, which keeps the browser's own user agent string.
    try {
      const userAgent = await evaluate(s, 'navigator.userAgent');
      if (typeof userAgent !== 'string' || userAgent.length === 0) throw new Error('no user agent');
      await s.send('Network.setUserAgentOverride', { userAgent, acceptLanguage: cfg.locale });
    } catch (e) { cap.probeErrors.push(`accept-language override: ${clipText(e.message, 200)}`); }
  }
  await s.send('Emulation.setCPUThrottlingRate', { rate: cfg.cpuThrottle });
  if (cfg.checks.vitals || cfg.checks.resources) await addInit(s, pageScript(__vitalsInit));
  if (cap.clockOffsetMs !== null) await addInit(s, clockInitSource(cap.clockOffsetMs));
  if (cfg.muteAudio) await addInit(s, AUDIO_MUTE_SOURCE);
  if (cap.usesHistory) await addInit(s, PAGESHOW_SOURCE);
  // Seeded storage (session localStorage and the stored theme) is applied once, before the
  // first document of this tab, and removed after it loads so the app's own writes survive reloads.
  page.oneShot = [];
  if (cap.seed.items.length || cap.seed.removals.length) page.oneShot.push(await addInit(s, storageSeedSource(cap.baseOrigin, cap.seed.items, cap.seed.removals)));
  if (cap.seed.cookies.length) await s.send('Network.setCookies', { cookies: cap.seed.cookies });
}

async function navigate(cap, page, url) {
  if (!isLoopbackUrl(url)) throw new Error('refused: navigation target is not loopback');
  const s = page.session;
  const timeout = cap.config.navigationTimeoutMs;
  const load = waitForEvent(s, 'Page.loadEventFired', timeout);
  const res = await s.send('Page.navigate', { url }, timeout);
  if (res.errorText) { load.cancel(); throw new Error(`navigation failed: ${res.errorText}`); }
  if (!res.loaderId) { load.cancel(); return; }
  try { await load.promise; } catch (e) { cap.probeErrors.push(`load event: ${e.message}`); }
  if (page.oneShot && page.oneShot.length) {
    for (const identifier of page.oneShot) await s.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
    page.oneShot = [];
  }
}

async function waitForSelector(s, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await runInPage(s, __visibleSelector, selector).catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`selector not visible within ${timeoutMs} ms: ${clipText(selector, 120)}`);
    await sleep(100);
  }
}

/** The dispatch point of a selector, or an error naming why it cannot be tapped or clicked. */
async function targetPoint(s, selector) {
  const pt = await runInPage(s, __elementCenter, selector);
  if (!pt) throw new Error('element not found or has no size');
  if (!pt.inView) throw new Error('tap target not hit: its centre is outside the visual viewport');
  if (!pt.hit) throw new Error(`tap target not hit: ${pt.covering ? `covered by ${clipText(pt.covering, 120)}` : 'nothing at its centre'}`);
  return pt;
}

async function clickSelector(cap, page, selector) {
  const s = page.session;
  const pt = await targetPoint(s, selector);
  if (cap.viewport.touch) {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
  }
}

async function sampleHeap(cap) {
  if (!cap.config.checks.heap || cap.heapSamples.length >= 500) return;
  try {
    const { metrics } = await cap.pages[0].session.send('Performance.getMetrics');
    const get = (n) => (metrics.find((m) => m.name === n) || {}).value;
    cap.heapSamples.push({ atMs: Date.now() - cap.startMs, jsHeapUsedBytes: get('JSHeapUsedSize') ?? null, domNodes: get('Nodes') ?? null });
  } catch (e) { cap.probeErrors.push(`heap sample: ${e.message}`); }
}

function writeExclusive(cap, relPath, data) {
  const abs = path.resolve(cap.outDir, relPath);
  if (!abs.startsWith(cap.outDir + path.sep)) throw new Error('refused: write outside --out');
  ensureDir(cap.outDir, path.dirname(abs));
  fs.writeFileSync(abs, data, { flag: 'wx' });
  return relPath.split(path.sep).join('/');
}

function ensureDir(outDir, dir) {
  const rel = path.relative(outDir, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('refused: directory outside --out');
  let current = outDir;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const st = fs.lstatSync(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`refused: ${current} is not a plain directory`);
  }
}

async function screenshotBytes(cap, page, full) {
  const s = page.session;
  await s.send('Page.bringToFront').catch(() => {});
  let params = { format: 'png' };
  if (full) {
    const m = await s.send('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize || { width: cap.metrics.width, height: cap.metrics.height };
    const maxHeight = Math.floor(16384 / cap.metrics.dpr);
    params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.max(1, Math.ceil(size.width)), height: Math.max(1, Math.min(maxHeight, Math.ceil(size.height))), scale: 1 } };
  }
  const { data } = await s.send('Page.captureScreenshot', params, 60000);
  return Buffer.from(data, 'base64');
}

async function screenshot(cap, page, relPath, full) {
  return writeExclusive(cap, relPath, await screenshotBytes(cap, page, full));
}

/**
 * Viewport screenshots until two consecutive ones are byte-identical or maxAttempts is
 * reached; the last one is written. A single attempt can never be called stable.
 */
async function stableViewShot(cap, page, relPath) {
  const { maxAttempts, intervalMs } = cap.config.stableShots;
  let previous = null;
  let last = null;
  let attempts = 0;
  let stable = false;
  while (attempts < maxAttempts) {
    if (attempts > 0 && intervalMs > 0) await sleep(intervalMs);
    last = await screenshotBytes(cap, page, false);
    attempts += 1;
    if (previous && previous.equals(last)) { stable = true; break; }
    previous = last;
  }
  return { file: writeExclusive(cap, relPath, last), stable, attempts };
}

/** back/forward: one history entry through Page.navigateToHistoryEntry, then the bfcache facts. */
async function historyStep(cap, page, delta, record) {
  const s = page.session;
  const { currentIndex, entries } = await s.send('Page.getNavigationHistory');
  const target = Array.isArray(entries) ? entries[currentIndex + delta] : undefined;
  if (!target) throw new Error(`no ${delta < 0 ? 'previous' : 'next'} history entry`);
  if (target.url !== 'about:blank' && !isLoopbackUrl(target.url)) throw new Error('refused: the history entry is not a loopback URL');
  const timeout = cap.config.navigationTimeoutMs;
  await evaluate(s, 'delete window.__uiProbePageshow').catch(() => {});
  const navigated = waitForEvent(s, 'Page.frameNavigated', timeout, (p) => p.frame && !p.frame.parentId);
  await s.send('Page.navigateToHistoryEntry', { entryId: target.id });
  try { await navigated.promise; } catch (e) { cap.probeErrors.push(`history navigation: ${e.message}`); }
  record.navigated = true;
  const deadline = Date.now() + Math.min(timeout, 15000);
  while ((await evaluate(s, 'document.readyState').catch(() => null)) !== 'complete' && Date.now() < deadline) await sleep(50);
  // pageshow fires right after load, or on a bfcache restore; give it two seconds to arrive.
  let state = { persisted: null, notRestoredReasons: null };
  const shownBy = Date.now() + 2000;
  for (;;) {
    state = await runInPage(s, __navState).catch(() => state);
    if (state.persisted !== null || Date.now() > shownBy) break;
    await sleep(50);
  }
  record.persisted = state.persisted;
  record.notRestoredReasons = state.notRestoredReasons;
}

async function runStep(cap, step, index) {
  const record = { action: step.action, ok: true, error: null };
  if (step.action === 'evaluate') record.expression = step.expression;
  if (step.action === 'back' || step.action === 'forward') Object.assign(record, { navigated: false, persisted: null, notRestoredReasons: null });
  const page = cap.pages[step.tab || 0];
  try {
    if (!page) throw new Error('tab does not exist yet');
    const s = page.session;
    switch (step.action) {
      case 'goto': await navigate(cap, page, resolveRouteUrl(cap.config.baseUrl, step.path)); break;
      case 'click': await clickSelector(cap, page, step.selector); break;
      case 'fill': {
        let value = step.value;
        if (step.valueFrom) {
          const r = resolveAccountRef(step.valueFrom, cap.env.accounts);
          if (r.error) throw new Error(r.error);
          value = r.value;
        }
        if (!(await runInPage(s, __focusForFill, step.selector))) throw new Error('element not found or not focusable');
        if (value === '') await pressKey(s, 'Backspace');
        else await s.send('Input.insertText', { text: value });
        break;
      }
      case 'press': await pressKey(s, step.key); break;
      case 'select': {
        const r = await runInPage(s, __selectValue, { selector: step.selector, value: step.value });
        if (r !== true) throw new Error(String(r));
        break;
      }
      case 'check': {
        const current = await runInPage(s, __isChecked, step.selector);
        if (current === null) throw new Error('element not found');
        if (current !== step.checked) await clickSelector(cap, page, step.selector);
        break;
      }
      case 'upload': {
        const real = fs.realpathSync(step.fileAbs);
        const rel = path.relative(fs.realpathSync(cap.env.configDir), real);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(real).isFile()) throw new Error('refused: upload file is not a regular file inside the config directory');
        const { root } = await s.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await s.send('DOM.querySelector', { nodeId: root.nodeId, selector: step.selector });
        if (!nodeId) throw new Error('file input not found');
        await s.send('DOM.setFileInputFiles', { nodeId, files: [real] });
        break;
      }
      case 'hover': {
        const pt = await targetPoint(s, step.selector);
        await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
        break;
      }
      case 'scroll':
        if (!(await runInPage(s, __scroll, { selector: step.selector || null, y: step.y ?? 0 }))) throw new Error('element not found');
        break;
      case 'waitFor': await waitForSelector(s, step.selector, step.timeoutMs); break;
      case 'wait': await sleep(step.ms); break;
      case 'setNetwork': await applyNetwork(cap, step.profile); break;
      case 'clearCookies': await cap.context.clearCookies(); break;
      case 'newTab': {
        const p2 = await cap.context.newPage();
        cap.pages.push(p2);
        await preparePage(p2, cap);
        if (cap.networkName !== 'fast') await applyNetwork(cap, cap.networkName);
        break;
      }
      case 'rotate':
        cap.metrics = { ...cap.metrics, width: cap.metrics.height, height: cap.metrics.width };
        for (const p of cap.pages) { await applyMetrics(p.session, cap.metrics); await applyEmulation(cap, p); }
        break;
      case 'back': await historyStep(cap, page, -1, record); break;
      case 'forward': await historyStep(cap, page, 1, record); break;
      case 'emulateMedia':
        for (const k of ['colorScheme', 'reducedMotion', 'forcedColors', 'prefersContrast']) if (step[k] !== undefined) cap.media[k] = step[k];
        for (const p of cap.pages) await p.session.send('Emulation.setEmulatedMedia', { media: '', features: mediaFeatures(cap.media) });
        break;
      case 'evaluate':
        // Only the expression is recorded (capture shape steps[{action,ok,error,expression}]):
        // a returned value could carry page data into promotable evidence. Use the step as an
        // assertion: throw inside the expression to make the step fail with a message.
        await evaluate(s, step.expression);
        break;
      case 'screenshot':
        cap.screens.steps.push(await screenshot(cap, page, `captures/${cap.item.stem}.step-${step.name}.png`, false));
        break;
      default: throw new Error('unsupported action');
    }
    if (['click', 'fill', 'press', 'select', 'check', 'hover', 'upload'].includes(step.action)) await sleep(50);
  } catch (e) {
    record.ok = false;
    record.error = clipText(e.message, 300);
    cap.log(`step ${index} (${step.action}) failed: ${record.error}`);
  }
  await sampleHeap(cap);
  return record;
}

async function focusWalk(cap) {
  const s = cap.pages[0].session;
  const { tabbables } = await runInPage(s, __focusBaseline);
  const stops = [];
  let trapped = false;
  let truncated = true;
  let empty = 0;
  for (let i = 0; i < cap.config.maxFocusStops; i++) {
    await pressKey(s, 'Tab');
    await sleep(30);
    const st = await runInPage(s, __focusStop);
    if (st.none) { empty += 1; if (empty >= 3 || tabbables === 0) { truncated = false; break; } continue; }
    if (st.seen) {
      truncated = false;
      if (!st.inModal && st.id !== 0) trapped = true;
      break;
    }
    stops.push({ index: stops.length, selector: st.selector, name: st.name, visibleIndicator: st.visibleIndicator, obscured: st.obscured });
  }
  if (stops.length >= cap.config.maxFocusStops) truncated = true;
  return { stops, trapped, truncated };
}

async function saveStorageState(cap, name) {
  const s = cap.pages[0].session;
  const urls = [...new Set([`${cap.baseOrigin}/`, ...cap.visited])];
  const { cookies } = await s.send('Network.getCookies', { urls });
  const kept = (cookies || []).filter((c) => isLoopbackHost(String(c.domain).replace(/^\./, ''))).map((c) => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite || 'Lax',
  }));
  const local = await evaluate(s, `(() => { if (location.origin !== ${JSON.stringify(cap.baseOrigin)}) return []; const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.push({ name: k, value: localStorage.getItem(k) }); } return out; })()`).catch(() => []);
  const state = { cookies: kept, origins: [{ origin: cap.baseOrigin, localStorage: local || [] }] };
  writeExclusive(cap, path.join('storage', name), `${JSON.stringify(state, null, 2)}\n`);
}

function cookieParams(state) {
  return (state.cookies || []).map((c) => {
    const host = String(c.domain).replace(/^\./, '');
    const urlHost = host === '::1' ? '[::1]' : host;
    const param = { name: c.name, value: c.value, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly };
    if (String(c.domain).startsWith('.')) param.domain = c.domain;
    else param.url = `${c.secure ? 'https' : 'http'}://${urlHost}${param.path}`;
    if (['Strict', 'Lax', 'None'].includes(c.sameSite)) param.sameSite = c.sameSite;
    if (Number.isFinite(c.expires) && c.expires > 0) param.expires = c.expires;
    return param;
  });
}

function captureFlags(capture) {
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    overflow: !!(capture.overflow && (capture.overflow.hasHorizontalScroll || capture.overflow.offenders.length > 0)),
    consoleErrors: (capture.console || []).filter((c) => c.type === 'error' || c.type === 'assert').length,
    pageErrors: n(capture.pageErrors),
    failedRequests: n(capture.failedRequests),
    blockedRequests: n(capture.blockedRequests),
    contrastFailures: capture.contrast ? capture.contrast.failures.length : 0,
    under24: capture.tapTargets ? capture.tapTargets.under24.length : 0,
    badText: capture.structure ? capture.structure.badText.length : 0,
    focusObscured: !!(capture.focusWalk && capture.focusWalk.stops.some((st) => st.obscured)),
    focusTrapped: !!(capture.focusWalk && capture.focusWalk.trapped),
    measuredStateChanged: !!(capture.measuredState && capture.measuredState.changes.length > 0),
  };
}

/**
 * The environment block of a capture: everything that changes pixels without a code change.
 * Values describe the state the screenshots were taken in (after the steps), not the declared one.
 */
export function captureEnv({ env, config, item, viewport, metrics, media, fonts }) {
  const block = {
    platform: env.platform || process.platform,
    driver: env.driverName || null,
    browserVersion: env.browserVersion || null,
    headless: !!config.headless,
    viewport: { id: viewport.id, width: metrics.width, height: metrics.height, dpr: metrics.dpr, mobile: !!viewport.mobile, touch: !!viewport.touch },
    theme: item.theme,
    colorScheme: media.colorScheme,
    reducedMotion: !!media.reducedMotion,
    forcedColors: media.forcedColors ?? null,
    locale: config.locale ?? null,
    timezone: config.timezone ?? null,
    launchArgsHash: env.launchArgsHash || launchArgsHash({ headless: !!config.headless }),
    fontsReady: !!(fonts && fonts.ready),
    fontFaceErrors: fonts && Array.isArray(fonts.errors) ? fonts.errors : [],
  };
  block.envKey = envKeyFor(block);
  return block;
}

const AXE_RUN_OPTIONS = Object.freeze({
  runOnly: { type: 'tag', values: AXE_TAGS },
  rules: { 'target-size': { enabled: true } },
  resultTypes: ['violations', 'incomplete'],
});

function axeRunSource() {
  return `(async () => {
if (typeof window.axe === 'undefined' || typeof window.axe.run !== 'function') throw new Error('axe-core did not define window.axe');
const r = await window.axe.run(document, ${JSON.stringify(AXE_RUN_OPTIONS)});
const clip = (v, n) => { const t = String(v == null ? '' : v); return t.length > n ? t.slice(0, n) : t; };
const target = (n) => clip((n.target || []).map((t) => (Array.isArray(t) ? t.join(' >>> ') : String(t))).join(', '), 300);
const pick = (list) => (list || []).slice(0, 50).map((v) => ({ id: clip(v.id, 100), impact: v.impact || null, help: clip(v.help, 300),
  nodes: (v.nodes || []).slice(0, 20).map((n) => ({ target: target(n), summary: clip(n.failureSummary, 300) })) }));
const all = [].concat(r.violations || [], r.incomplete || [], r.passes || [], r.inapplicable || []);
return { version: window.axe.version || (r.testEngine && r.testEngine.version) || null,
  targetSizeRan: all.some((x) => x.id === 'target-size'),
  violations: pick(r.violations), incomplete: pick(r.incomplete),
  counts: { violations: (r.violations || []).length, incomplete: (r.incomplete || []).length, passes: (r.passes || []).length, inapplicable: (r.inapplicable || []).length } };
})()`;
}

/**
 * Runs the audited project's own axe-core build in the page after every other check. Without a
 * usable build the capture records a coverage gap, never an error. Node summaries come from
 * axe's failureSummary only, never from the element's HTML.
 */
async function runAxe(s, axe) {
  if (!axe || typeof axe.text !== 'string') return { available: false, reason: (axe && axe.reason) || 'no axe-core build given (--axe)' };
  const out = {
    available: true, version: null, error: null, targetSizeRan: false, violations: [], incomplete: [],
    counts: { violations: 0, incomplete: 0, passes: 0, inapplicable: 0 },
  };
  try {
    await evaluate(s, `${axe.text}\n;void 0;`, 30000);
    const r = await evaluate(s, axeRunSource(), 60000);
    Object.assign(out, { version: r.version, targetSizeRan: !!r.targetSizeRan, violations: r.violations, incomplete: r.incomplete, counts: r.counts });
  } catch (e) {
    out.error = clipText(e.message, 300);
    if (/content security policy|\bcsp\b|unsafe-eval|trusted ?types/i.test(e.message)) {
      out.cspNote = 'the page\'s Content Security Policy blocked axe-core; no bypass was applied, so this capture has no axe results';
    }
  }
  return out;
}

async function hostBenchmark(driver, cpuThrottle) {
  const context = await driver.newContext();
  try {
    const page = await context.newPage();
    const runs = await evaluate(page.session, BENCHMARK_SOURCE, 120000);
    return benchmarkSummary(runs, cpuThrottle);
  } finally {
    await context.close().catch(() => {});
  }
}

async function runCapture(driver, config, item, env) {
  const route = config.routes.find((r) => r.id === item.routeId);
  const viewport = config.viewports.find((v) => v.id === item.viewportId);
  const startedAt = new Date().toISOString();
  const cap = {
    config, env, item, viewport, outDir: env.outDir, log: env.log,
    baseOrigin: config.baseUrl, startMs: Date.now(), pages: [], context: null, visited: [],
    metrics: { width: viewport.width, height: viewport.height, dpr: viewport.dpr, mobile: viewport.mobile },
    media: {
      colorScheme: item.theme === 'system' ? 'dark' : item.theme,
      reducedMotion: config.reducedMotion, forcedColors: config.media.forcedColors,
      prefersContrast: config.media.prefersContrast, hover: config.media.hover,
    },
    clockOffsetMs: config.clock.now ? Date.parse(config.clock.now) - Date.now() : null,
    seed: { items: [], removals: [], cookies: [] },
    state: { console: [], pageErrors: [], failedRequests: [], blockedRequests: [], requests: new Map(), mainResponse: null },
    truncated: new Set(), probeErrors: [], heapSamples: [],
    screens: { full: null, view: null, viewStable: false, viewAttempts: 0, scrollbarsHidden: false, steps: [] },
    networkName: config.network, flakyTimer: null, mainFrameId: null,
    usesHistory: route.steps.some((st) => st.action === 'back' || st.action === 'forward'),
    emulationApplied: Object.fromEntries(EMULATION_KEYS.map((k) => [k, 'off'])),
  };
  if (!config.theme.media) cap.media.colorScheme = 'light';
  const initialMedia = { ...cap.media };
  if (route.storageState) {
    const state = env.storageStates.get(route.id);
    cap.seed.cookies = cookieParams(state);
    for (const o of state.origins || []) {
      if (o.origin === cap.baseOrigin) for (const kv of o.localStorage || []) cap.seed.items.push([String(kv.name), String(kv.value)]);
    }
  }
  if (config.theme.storage) {
    const { key } = config.theme.storage;
    cap.seed.items = cap.seed.items.filter(([k]) => k !== key);
    if (item.theme === 'system') cap.seed.removals.push(key);
    else cap.seed.items.push([key, config.theme.storage[item.theme]]);
  }
  const capture = {
    schema: CAPTURE_SCHEMA,
    route: { id: route.id, path: route.path, url: item.url, finalUrl: null, status: null },
    viewport: { id: viewport.id, width: viewport.width, height: viewport.height, dpr: viewport.dpr, mobile: viewport.mobile },
    theme: item.theme, network: config.network, media: initialMedia, clockNow: config.clock.now,
    repeatIndex: item.repeatIndex, startedAt, durationMs: null,
    env: null, screenshots: cap.screens, masks: [], emulationApplied: cap.emulationApplied, steps: [], measuredState: null,
    overflow: null, console: null, pageErrors: null, failedRequests: null, blockedRequests: null,
    tapTargets: null, contrast: null, vitals: null, structure: null,
    focusWalk: null, textSpacing: null, zoom: null, axTree: null, heap: null, resources: null, domNodes: null,
    axe: null, probeErrors: cap.probeErrors,
  };
  let ok = true;
  let error = null;
  try {
    cap.context = await driver.newContext();
    const page = await cap.context.newPage();
    cap.pages.push(page);
    await page.session.send('Page.enable');
    const tree = await page.session.send('Page.getFrameTree');
    cap.mainFrameId = tree.frameTree.frame.id;
    await preparePage(page, cap);
    await applyNetwork(cap, config.network);
    await navigate(cap, page, item.url);
    cap.visited.push(item.url);
    if (route.waitFor) {
      try { await waitForSelector(page.session, route.waitFor.selector, route.waitFor.timeoutMs); } catch (e) { cap.probeErrors.push(`waitFor: ${e.message}`); }
    } else {
      await sleep(config.settleMs);
    }
    const early = await evaluate(page.session, 'location.href').catch(() => null);
    capture.route.finalUrl = early;
    capture.route.status = cap.state.mainResponse ? cap.state.mainResponse.status : null;
    await sampleHeap(cap);
    // Vitals before the first step: input ends LCP recording and a step may navigate, so the
    // load metrics of the declared page are kept separately from the end-of-capture ones.
    let preStepVitals = null;
    if (route.steps.length > 0 && config.checks.vitals) {
      preStepVitals = await runInPage(page.session, __readVitals).catch((e) => { cap.probeErrors.push(`vitals before steps: ${clipText(e.message, 200)}`); return null; });
    }
    for (let i = 0; i < route.steps.length; i++) {
      const step = route.steps[i];
      capture.steps.push(await runStep(cap, step, i));
      if (step.action === 'goto') cap.visited.push(resolveRouteUrl(config.baseUrl, step.path));
    }
    stopFlaky(cap);
    const s = page.session;
    // A background tab may never produce a frame, so tab 0 is brought forward before captures.
    await s.send('Page.bringToFront').catch(() => {});
    const measuredUrl = await evaluate(s, 'location.href').catch(() => null);
    // A step that tapped an element may have panned the page or the visual viewport; screenshots
    // and checks are taken from the origin unless a scroll step asked for the position.
    const zero = { x: 0, y: 0, visualLeft: 0, visualTop: 0, scale: 1 };
    const scrollAfterSteps = route.steps.length > 0 ? await runInPage(s, __scrollState).catch(() => null) : zero;
    const keepScroll = route.steps.some((st) => st.action === 'scroll');
    let scrollReset = false;
    let scrollNow = scrollAfterSteps;
    if (!keepScroll && isScrolled(scrollAfterSteps)) {
      await runInPage(s, __resetScroll).catch((e) => cap.probeErrors.push(`scroll reset: ${clipText(e.message, 200)}`));
      await sleep(100);
      scrollNow = await runInPage(s, __scrollState).catch(() => scrollAfterSteps);
      scrollReset = true;
    }
    capture.measuredState = {
      url: measuredUrl, media: { ...cap.media }, network: cap.networkName,
      viewport: { width: cap.metrics.width, height: cap.metrics.height },
      scrollAfterSteps, scrollReset, scroll: scrollNow,
      changes: measuredStateChanges({
        initialUrl: early, url: measuredUrl, initialMedia, media: cap.media, initialNetwork: config.network,
        network: cap.networkName, initialMetrics: { width: viewport.width, height: viewport.height }, metrics: cap.metrics, steps: route.steps,
        scroll: scrollNow,
      }),
    };
    if (config.freezeAnimations) { await runInPage(s, __freeze).catch((e) => cap.probeErrors.push(`freeze: ${e.message}`)); await sleep(100); }
    // Screenshot preparation: web fonts settled, no caret, no hover, volatile regions masked.
    const fonts = await runInPage(s, __fontsState, 5000, 15000).catch((e) => { cap.probeErrors.push(`fonts: ${clipText(e.message, 200)}`); return { ready: false, errors: [] }; });
    await runInPage(s, __caret, true).catch((e) => cap.probeErrors.push(`caret: ${clipText(e.message, 200)}`));
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -1, y: -1 })
      .catch(() => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 }))
      .catch((e) => cap.probeErrors.push(`pointer park: ${clipText(e.message, 200)}`));
    if (route.mask.length) {
      const applied = await runInPage(s, __masks, route.mask).catch((e) => { cap.probeErrors.push(`masks: ${clipText(e.message, 200)}`); return []; });
      for (const m of applied) if (m.invalid) cap.probeErrors.push(`mask selector is not valid CSS: ${clipText(m.selector, 120)}`);
      capture.masks = applied.map((m) => ({ selector: m.selector, count: m.count, areaPct: m.areaPct }));
    }
    // Mobile viewports use overlay scrollbars that fade in and out after a load or a scroll, so
    // consecutive shots of an overflowing page never match. They are hidden for the screenshots
    // only (they take no layout space on mobile) and shown again before the checks.
    if (cap.metrics.mobile) {
      await s.send('Emulation.setScrollbarsHidden', { hidden: true })
        .then(() => { cap.screens.scrollbarsHidden = true; })
        .catch((e) => cap.probeErrors.push(`hide scrollbars: ${clipText(e.message, 200)}`));
    }
    const view = await stableViewShot(cap, page, `captures/${item.stem}.view.png`).catch((e) => { cap.probeErrors.push(`viewport screenshot: ${e.message}`); return null; });
    if (view) { cap.screens.view = view.file; cap.screens.viewStable = view.stable; cap.screens.viewAttempts = view.attempts; }
    cap.screens.full = await screenshot(cap, page, `captures/${item.stem}.full.png`, true).catch((e) => { cap.probeErrors.push(`full screenshot: ${e.message}`); return null; });
    if (cap.screens.scrollbarsHidden) await s.send('Emulation.setScrollbarsHidden', { hidden: false }).catch(() => {});
    if (route.mask.length) await runInPage(s, __masks, null).catch((e) => cap.probeErrors.push(`mask removal: ${clipText(e.message, 200)}`));
    await runInPage(s, __caret, false).catch(() => {});
    capture.env = captureEnv({ env, config, item, viewport, metrics: cap.metrics, media: cap.media, fonts });
    const guard = async (label, fn) => { try { return await fn(); } catch (e) { cap.probeErrors.push(`${label}: ${clipText(e.message, 300)}`); return null; } };
    const enabled = config.checks;
    if (enabled.overflow) capture.overflow = await guard('overflow', () => runInPage(s, __overflow, { vertical: false }));
    if (enabled.tapTargets) capture.tapTargets = await guard('tapTargets', () => runInPage(s, __tapTargets, !!viewport.mobile));
    if (enabled.contrast) capture.contrast = await guard('contrast', () => runInPage(s, __contrast, config.maxContrastSamples, 60000));
    if (enabled.structure) capture.structure = await guard('structure', () => runInPage(s, __structure));
    const raw = await guard('vitals', () => runInPage(s, __readVitals));
    if (raw) {
      capture.domNodes = raw.domNodes;
      if (enabled.vitals) {
        const cls = clsFromShifts(raw.shifts);
        const tasks = raw.longTasks.filter(Number.isFinite);
        const sameDocument = !route.steps.some((st) => ['goto', 'back', 'forward'].includes(st.action)) && measuredUrl === early;
        const lcpFromSteps = raw.lcpMs === null && !!preStepVitals && preStepVitals.lcpMs !== null && sameDocument;
        capture.vitals = {
          ttfbMs: raw.ttfb, fcpMs: raw.fcp,
          lcpMs: lcpFromSteps ? preStepVitals.lcpMs : raw.lcpMs,
          lcpElement: lcpFromSteps ? preStepVitals.lcpElement : raw.lcpElement,
          lcpSource: raw.lcpMs !== null ? 'end' : (lcpFromSteps ? 'before_steps' : null),
          beforeSteps: preStepVitals ? {
            url: preStepVitals.href, fcpMs: preStepVitals.fcp, lcpMs: preStepVitals.lcpMs, lcpElement: preStepVitals.lcpElement,
            cls: Math.round(clsFromShifts(preStepVitals.shifts).value * 10000) / 10000,
          } : null,
          cls: Math.round(cls.value * 10000) / 10000,
          clsSources: [...new Set(cls.windowEntries.flatMap((e) => e.sources || []))].slice(0, 10),
          inpMs: raw.interactions.length ? Math.max(...raw.interactions) : null,
          ...inpStatus(raw, route.steps),
          longTasks: { count: tasks.length, totalMs: Math.round(tasks.reduce((a, b) => a + b, 0)), maxMs: tasks.length ? Math.round(Math.max(...tasks)) : 0 },
          tbtMs: Math.round(totalBlockingTime(tasks)),
        };
      }
      if (enabled.resources) capture.resources = summarizeResources(raw.resources);
    }
    if (enabled.focusWalk) capture.focusWalk = await guard('focusWalk', () => focusWalk(cap));
    if (enabled.textSpacing) {
      capture.textSpacing = await guard('textSpacing', async () => {
        await runInPage(s, __textSpacing, true);
        await sleep(300);
        const after = await runInPage(s, __overflow, { vertical: true });
        await runInPage(s, __textSpacing, false);
        return { overflowAfter: { scrollWidth: after.scrollWidth, clientWidth: after.clientWidth, hasHorizontalScroll: after.hasHorizontalScroll, offenders: after.offenders }, clippedAfter: after.clipped };
      });
    }
    if (enabled.zoom) {
      capture.zoom = await guard('zoom', async () => {
        // Browser zoom shrinks the CSS viewport and raises the device pixel ratio by the same
        // factor; pinch scale is reset to 1 so the reflow is measured, not a magnified bitmap.
        const pct = enabled.zoom;
        const zoomed = { ...cap.metrics, width: Math.max(1, Math.floor((cap.metrics.width * 100) / pct)), height: Math.max(1, Math.floor((cap.metrics.height * 100) / pct)), dpr: (cap.metrics.dpr * pct) / 100 };
        await applyMetrics(s, zoomed);
        await s.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {});
        await sleep(Math.max(300, config.settleMs));
        const overflow = await runInPage(s, __overflow, { vertical: false });
        const saved = cap.metrics;
        cap.metrics = zoomed;
        cap.screens.steps.push(await screenshot(cap, page, `captures/${item.stem}.step-zoom${pct}.png`, false));
        cap.metrics = saved;
        await applyMetrics(s, saved);
        return { percent: pct, overflow };
      });
    }
    if (enabled.axTree) {
      capture.axTree = await guard('axTree', async () => {
        const { nodes } = await s.send('Accessibility.getFullAXTree', {}, 60000);
        const file = writeExclusive(cap, `captures/${item.stem}.ax.json`, JSON.stringify(nodes));
        const interactive = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox', 'listbox', 'option', 'menuitemcheckbox', 'menuitemradio']);
        const unnamed = nodes.filter((n) => !n.ignored && n.role && interactive.has(n.role.value) && !(n.name && String(n.name.value || '').trim()))
          .slice(0, 100).map((n) => ({ role: n.role.value, nodeId: n.nodeId, backendDOMNodeId: n.backendDOMNodeId ?? null }));
        return { file, nodes: nodes.length, unnamedInteractive: unnamed };
      });
    }
    if (enabled.heap) { await sampleHeap(cap); capture.heap = { samples: cap.heapSamples, trend: heapTrend(cap.heapSamples) }; }
    if (enabled.axe) capture.axe = await runAxe(s, env.axe);
    if (route.saveStorage && !env.savedStorage.has(route.id)) {
      // Only the first capture of the route saves its session state; later variants reuse nothing.
      env.savedStorage.add(route.id);
      await saveStorageState(cap, route.saveStorage).catch((e) => cap.probeErrors.push(`saveStorage: ${e.message}`));
    }
    if (capture.route.finalUrl === null || capture.route.status === null) cap.probeErrors.push('main document response was not observed');
  } catch (e) {
    ok = false;
    error = clipText(e.message, 300);
    cap.probeErrors.push(error);
  } finally {
    stopFlaky(cap);
    if (cap.context) await cap.context.close().catch(() => {});
  }
  if (config.checks.console) capture.console = cap.state.console;
  if (config.checks.network) { capture.failedRequests = cap.state.failedRequests; capture.blockedRequests = cap.state.blockedRequests; }
  capture.pageErrors = cap.state.pageErrors;
  for (const key of cap.truncated) cap.probeErrors.push(`${key} truncated at ${MAX_LIST} entries`);
  capture.durationMs = Date.now() - cap.startMs;
  if (capture.steps.some((st) => !st.ok)) ok = false;
  try {
    writeExclusive(cap, `captures/${item.stem}.json`, `${JSON.stringify(capture, null, 2)}\n`);
  } catch (e) {
    ok = false;
    error = error || `could not write capture: ${clipText(e.message, 200)}`;
  }
  return { file: `captures/${item.stem}.json`, routeId: item.routeId, viewportId: item.viewportId, theme: item.theme, repeatIndex: item.repeatIndex, ok, error: error || (ok ? null : 'one or more steps failed'), flags: captureFlags(capture) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `ui-probe.mjs: browser measurement harness for the ui-audit skill (loopback only)

Usage:
  node scripts/ui-probe.mjs --config <probe-config.json> --out <abs-dir>
       [--driver auto|playwright|playwright-core|cdp] [--executable <path>]
       [--driver-path <dir-with-node_modules>]
       [--accounts <accounts.json>] [--sessions <dir>]
       [--only <routeId,...>] [--viewport <id,...>] [--theme light|dark|system,...]
       [--expect-header <name>=<value>] [--axe <abs-path-to-axe.min.js>]
       [--allow-inside-git] [--plan] [--help]

  --plan            validate the config and print the capture plan as JSON; no browser, no writes
  --expect-header   a response header the sandboxed build is known to send (for example one added
                    by the parent's loopback forwarder); checked with one GET of baseUrl before
                    the browser starts. A mismatch or no answer is a refusal (exit 2).
  --driver-path     the only place playwright/playwright-core is loaded from. Without it: the
                    skill's own node_modules (its pinned playwright-core), then
                    ~/ui-audit-skill/tools/node_modules; the working directory is never
                    searched. Without a package there, auto uses the CDP driver.
  --accounts        dummy accounts for fill steps with valueFrom "account:<account_key>.<field>"
  --sessions        directory holding <tenant_id>/<role>.json storage states
  --axe             the audited project's own axe-core build (axe.min.js or axe.js inside an
                    axe-core folder, at most 3 MiB). Used only with "checks": {"axe": true};
                    without a usable path the capture records axe.available false (a coverage
                    gap). axe-core is never downloaded or bundled by the probe.

Screenshots: after the steps the page is brought back to the scroll origin (the visual
viewport included) unless a "scroll" step ran; measuredState records scrollAfterSteps,
scrollReset and scroll, and lists "scroll" in changes when the page stays scrolled. Then
(after freezeAnimations) the probe waits up to 5 s for web fonts, hides the text caret, parks
the pointer outside the viewport, hides overlay scrollbars on mobile viewports and covers each
route "mask" selector with an opaque #FF00FF box. It then takes viewport screenshots until two
in a row are identical ("stableShots": {"maxAttempts": 3, "intervalMs": 150} by default) and
records screenshots.viewStable, viewAttempts and scrollbarsHidden, then one full-page
screenshot. Masks, the caret style and the scrollbar override are removed before any check
runs.

Taps and clicks: the dispatch point is the element's centre in visual-viewport coordinates
(a mobile page that overflows sideways pans that viewport). The step fails with "tap target
not hit" when the browser finds another element at that point or the point is off screen.

Vitals: with steps, the load metrics are also read before the first step (vitals.beforeSteps);
lcpSource says whether lcpMs is the end-of-capture or the before-steps value. inpStatus is
measured, below_threshold (interactions happened but none reached the 16 ms Event Timing
threshold) or no_interaction, with interactionCount. Every capture carries an "env" block whose envKey
(sha256) names the rendering environment; ui-diff.mjs compares only equal keys.

Optional: "emulation" (safeAreaInsets, smallViewportHeightDifference, virtualKeyboardHeight;
experimental Chromium overrides, recorded as applied, unsupported or off), steps "back" and
"forward" (history navigation with bfcache facts: navigated, persisted, notRestoredReasons),
and "benchmark" (a fixed CPU loop on about:blank before the first capture, recorded in
summary.hostBenchmark; on by default when checks.vitals is on and repeat > 1).

Target guard: the config must declare "target".
  "disposable"            the sandboxed build of the audit. It must prove itself before any capture:
                          --expect-header, or "readyMarker": {"path", "selector", "text"?} that only the
                          disposable environment shows (for example a fixture-only business name).
                          The marker page is opened once, GET only, in a fresh context. Absent: exit 2.
  "running-app-get-only"  an app the owner already runs, with the owner's OK: no steps, no
                          storageState, no saveStorage (refused, exit 2) and no warm-up request.

Theme "system" stores no preference and emulates prefers-color-scheme: dark; add an
emulateMedia step to test the light system path.

Order inside a capture: navigate, run the route's steps, then take the view/full screenshots
and every enabled check on the state the steps left. measuredState records that state and
lists in "changes" how it differs from the declared context (url, media, network, viewport,
cookies, history, interaction). Put context-changing steps in their own route when the checks must
describe the declared context.

Exit codes: 0 all captures completed, 1 usage or config error, 2 refused,
            3 driver or browser unavailable, 4 partial (see summary.json)
Writes only inside --out: captures/, summary.json, probe.log, storage/ and profile/
(storage/ and profile/ are never promoted as evidence). No environment file (.env, .env.*,
*.env, .envrc, .dev.vars) is ever opened: such a --config, --accounts, storage state or
upload path is refused (exit 2).`;

function readJsonFile(file, maxBytes = MAX_JSON_INPUT) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error(`${file} is not a regular file`);
  if (st.size > maxBytes) throw new Error(`${file} is larger than ${maxBytes} bytes`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
  try { return JSON.parse(text); } catch { throw new Error(`${file} is not valid JSON`); }
}

function formatConfigError(e) {
  return `${e.refusal ? 'REFUSED' : 'ERROR'}: ${printable(e.pointer || '/', 200)}: ${printable(e.message, 300)}`;
}

/**
 * Opens readyMarker.path once in a fresh context (GET only, no storage, no steps) and looks for
 * an element matching readyMarker.selector whose text or content attribute includes readyMarker.text.
 */
async function checkReadyMarker(driver, config) {
  const marker = config.readyMarker;
  const url = resolveRouteUrl(config.baseUrl, marker.path);
  if (!url || !isLoopbackUrl(url)) return { ok: false, reason: 'marker path is not on the loopback base origin' };
  const context = await driver.newContext();
  try {
    const page = await context.newPage();
    await page.session.send('Page.enable');
    await page.session.send('Runtime.enable');
    await navigate({ config, probeErrors: [] }, page, url);
    const probe = `(() => { try { const el = document.querySelector(${JSON.stringify(marker.selector)}); if (!el) return null; return String(el.textContent || '') + ' ' + String(el.getAttribute('content') || ''); } catch (e) { return null; } })()`;
    const deadline = Date.now() + marker.timeoutMs;
    for (;;) {
      const text = await evaluate(page.session, probe).catch(() => null);
      if (typeof text === 'string' && (marker.text === null || text.includes(marker.text))) return { ok: true, reason: null };
      if (Date.now() > deadline) return { ok: false, reason: text === null ? 'selector not found' : 'text not found' };
      await sleep(200);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function loadDriver(requested, options, log) {
  if (requested === 'cdp') return { kind: 'cdp', mod: null, name: 'cdp' };
  // Only the explicit driver directory is searched; the working directory never is.
  const dirs = driverSearchDirs(options.driverPath);
  const names = requested === 'auto' ? ['playwright', 'playwright-core'] : [requested];
  for (const name of names) {
    const found = resolveDriverModule(name, dirs);
    if (!found) continue;
    try {
      const mod = await import(pathToFileURL(found.resolved).href);
      log(`driver ${name} resolved from ${found.dir}`);
      return { kind: 'playwright', mod, name };
    } catch (e) {
      if (requested !== 'auto') throw new Error(`could not load ${name}: ${e.message}`);
      log(`could not load ${name} (${e.message}); trying the next driver`);
    }
  }
  if (requested !== 'auto') throw new Error(`${requested} is not installed under ${dirs[0]}; install it there with the owner's approval (see RUN-METADATA.md), pass --driver-path, or use --driver cdp`);
  log(`no approved Playwright package under ${dirs[0]}; using the built-in CDP driver`);
  return { kind: 'cdp', mod: null, name: 'cdp' };
}

export async function main(argv) {
  const out = (s) => process.stdout.write(`${s}\n`);
  const errOut = (s) => process.stderr.write(`${s}\n`);
  const { options, errors } = parseArgs(argv);
  if (options.help) { out(HELP); return EXIT.OK; }
  if (errors.length) { for (const e of errors) errOut(`ERROR: ${e}`); errOut('Run with --help for usage.'); return EXIT.USAGE; }

  const configPath = path.resolve(options.config);
  for (const [flag, value] of [['--config', options.config], ['--accounts', options.accounts], ['--sessions', options.sessions]]) {
    if (value && isForbiddenPath(path.resolve(value))) { errOut(`REFUSED: ${flag} names an environment file; the probe never opens one`); return EXIT.REFUSED; }
  }
  let raw;
  try { raw = readJsonFile(configPath, 1024 * 1024); } catch (e) { errOut(`ERROR: ${printable(e.message, 300)}`); return EXIT.USAGE; }
  const secrets = findInlineSecrets(raw);
  if (secrets.length) {
    for (const p of secrets) errOut(`REFUSED: ${p}: inline credential in the probe config; use valueFrom "account:<key>.<field>" or a {"session": "<tenant_id>/<role>"} storage state`);
    return EXIT.REFUSED;
  }
  const configDir = path.dirname(configPath);
  const { config, errors: configErrors } = validateConfig(raw, { configDir });
  if (configErrors.length) {
    for (const e of configErrors.slice(0, 100)) errOut(formatConfigError(e));
    return configErrors.some((e) => e.refusal) ? EXIT.REFUSED : EXIT.USAGE;
  }
  const plan = buildPlan(config, { only: options.only, viewport: options.viewport, theme: options.theme });
  if (plan.errors.length) { for (const e of plan.errors) errOut(`ERROR: ${e}`); return EXIT.USAGE; }
  if (options.out && !path.isAbsolute(options.out)) { errOut('REFUSED: --out must be an absolute path'); return EXIT.REFUSED; }
  const guard = targetGuard(config, { expectHeader: options.expectHeader });
  if (guard) { errOut(`REFUSED: ${guard}`); return EXIT.REFUSED; }
  // axe-core comes only from the audited project's own install; a missing or unusable path is a
  // coverage gap recorded in every capture, not an error.
  const axeCheck = options.axe ? validateAxePath(options.axe) : null;
  let axeReason = null;
  if (config.checks.axe) {
    if (!options.axe) axeReason = 'checks.axe is on but no --axe path was given (the audited project has no axe-core install, or none was passed)';
    else if (!axeCheck.ok) axeReason = axeCheck.reason;
  }
  if (options.plan) {
    const masks = new Map(config.routes.map((r) => [r.id, r.mask]));
    out(JSON.stringify({
      schema: PLAN_SCHEMA, toolVersion: TOOL_VERSION, baseUrl: config.baseUrl, target: config.target,
      readyMarker: config.readyMarker ? { path: config.readyMarker.path } : null, expectHeader: options.expectHeader ? options.expectHeader.name : null,
      driver: options.driver || config.driver,
      network: config.network, repeat: config.repeat, checks: config.checks,
      stableShots: config.stableShots, emulation: config.emulation, benchmark: config.benchmark,
      axe: { enabled: config.checks.axe, path: options.axe || null, usable: axeCheck ? axeCheck.ok : null, reason: axeReason || (axeCheck && !axeCheck.ok ? axeCheck.reason : null) },
      captures: plan.captures.map((c) => ({ routeId: c.routeId, url: c.url, viewportId: c.viewportId, theme: c.theme, repeatIndex: c.repeatIndex, mask: masks.get(c.routeId) || [], files: c.files })),
    }, null, 2));
    return EXIT.OK;
  }

  const outDir = path.resolve(options.out);
  const allowed = isOutDirAllowed(outDir, { allowInsideGit: options.allowInsideGit });
  if (!allowed.ok) { errOut(`REFUSED: ${allowed.reason}`); return EXIT.REFUSED; }

  let accounts = null;
  if (options.accounts) {
    try { accounts = readJsonFile(path.resolve(options.accounts)); } catch (e) { errOut(`ERROR: --accounts: ${printable(e.message, 300)}`); return EXIT.USAGE; }
    if (!Array.isArray(accounts)) { errOut('ERROR: --accounts must hold a JSON array of {account_key, ...}'); return EXIT.USAGE; }
  }
  if (config.usesAccounts && !accounts) { errOut('ERROR: a fill step uses valueFrom but --accounts was not given'); return EXIT.USAGE; }
  const selectedRoutes = new Set(plan.captures.map((c) => c.routeId));
  const storageStates = new Map();
  for (const route of config.routes) {
    if (!route.storageState || !selectedRoutes.has(route.id)) continue;
    let file;
    if (route.storageState.session) {
      if (!options.sessions) { errOut(`ERROR: route ${route.id} uses a session reference but --sessions was not given`); return EXIT.USAGE; }
      const [tenant, role] = route.storageState.session.split('/');
      file = path.join(path.resolve(options.sessions), tenant, `${role}.json`);
    } else {
      file = path.resolve(configDir, route.storageState.path);
    }
    if (isForbiddenPath(file)) { errOut(`REFUSED: route ${route.id} storage state names an environment file`); return EXIT.REFUSED; }
    let state;
    try { state = readJsonFile(file); } catch (e) { errOut(`ERROR: route ${route.id} storage state: ${printable(e.message, 300)}`); return EXIT.USAGE; }
    const problems = checkStorageState(state);
    if (problems.length) { for (const p of problems) errOut(`REFUSED: route ${route.id} storage state: ${p}`); return EXIT.REFUSED; }
    storageStates.set(route.id, state);
  }

  // Header proof, before anything is written or a browser starts. One GET, no redirects followed.
  if (options.expectHeader) {
    const { name, value } = options.expectHeader;
    let seen = null;
    try {
      const res = await fetch(config.baseUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      await res.arrayBuffer().catch(() => {});
      seen = res.headers.get(name);
    } catch (e) {
      errOut(`REFUSED: --expect-header: ${config.baseUrl} did not answer (${printable(e.message, 200)}); is the disposable app running?`);
      return EXIT.REFUSED;
    }
    if (seen !== value) {
      errOut(`REFUSED: --expect-header: ${config.baseUrl} ${seen === null ? `sent no ${name} header` : `sent a different ${name} value`}; this is not the disposable build`);
      return EXIT.REFUSED;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const logFile = path.join(outDir, 'probe.log');
  const log = (line) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${printable(line, 1000)}\n`); } catch { /* logging is best effort */ } };
  const startedAt = new Date().toISOString();
  log(`ui-probe ${TOOL_VERSION} starting: ${plan.captures.length} capture(s) against ${config.baseUrl} (target ${config.target})`);
  if (options.expectHeader) log(`expect-header ${options.expectHeader.name} matched`);
  let axe = null;
  if (config.checks.axe) {
    if (axeReason) {
      axe = { text: null, reason: axeReason };
      log(`axe-core unavailable: ${axeReason}`);
    } else {
      try {
        axe = { text: fs.readFileSync(axeCheck.path, 'utf8'), reason: null };
        log(`axe-core loaded from ${axeCheck.path}`);
      } catch (e) {
        axe = { text: null, reason: `could not read the axe-core file: ${clipText(e.message, 200)}` };
        log(axe.reason);
      }
    }
  } else if (options.axe) log('--axe ignored: checks.axe is off');

  const summary = {
    schema: SUMMARY_SCHEMA, toolVersion: TOOL_VERSION, driver: null, browserVersion: null, baseUrl: config.baseUrl,
    topologyNote: `browser on ${process.platform} reached ${config.baseUrl}; the probe does not prove the topology, record it from run-metadata.json sandbox.proof`,
    startedAt, finishedAt: null, exit: null, hostBenchmark: null, captures: [],
  };
  const writeSummary = (code, note) => {
    summary.finishedAt = new Date().toISOString();
    summary.exit = code;
    if (note) summary.error = note;
    try { fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' }); } catch (e) { errOut(`ERROR: could not write summary.json: ${e.message}`); }
    return code;
  };

  let driverChoice;
  try { driverChoice = await loadDriver(options.driver || config.driver, options, log); } catch (e) {
    errOut(`UNAVAILABLE: ${printable(e.message, 300)}`); log(e.message); return writeSummary(EXIT.UNAVAILABLE, e.message);
  }
  let pwExecutable = null;
  if (driverChoice.kind === 'playwright') {
    const chromium = driverChoice.mod.chromium || (driverChoice.mod.default && driverChoice.mod.default.chromium);
    try { pwExecutable = chromium && chromium.executablePath(); } catch { pwExecutable = null; }
  }
  const exe = resolveExecutable(options.executable, config.executable, pwExecutable);
  if (!exe.path) { errOut(`UNAVAILABLE: ${exe.reason}`); log(exe.reason); return writeSummary(EXIT.UNAVAILABLE, exe.reason); }
  log(`browser executable: ${exe.path} (${exe.reason})`);

  if (config.warmup) {
    try {
      const res = await fetch(config.baseUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      await res.arrayBuffer().catch(() => {});
      log(`warm-up request answered ${res.status}`);
    } catch (e) { log(`warm-up request failed: ${e.message}`); }
  }

  let driver;
  try {
    driver = driverChoice.kind === 'playwright'
      ? await createPlaywrightDriver({ mod: driverChoice.mod, name: driverChoice.name, executable: exe.path, outDir, headless: config.headless })
      : await createCdpDriver({ executable: exe.path, outDir, headless: config.headless });
  } catch (e) {
    errOut(`UNAVAILABLE: could not start the browser: ${printable(e.message, 300)}`);
    log(`browser start failed: ${e.message}`);
    return writeSummary(EXIT.UNAVAILABLE, e.message);
  }
  summary.driver = driver.name;
  summary.browserVersion = driver.browserVersion;
  log(`driver ${driver.name}, browser ${driver.browserVersion}`);

  if (config.readyMarker) {
    const marker = await checkReadyMarker(driver, config).catch((e) => ({ ok: false, reason: clipText(e.message, 300) }));
    if (!marker.ok) {
      await driver.close().catch(() => {});
      const note = `readyMarker not found at ${config.readyMarker.path}: ${marker.reason}; this is not the disposable build`;
      errOut(`REFUSED: ${printable(note, 400)}`);
      log(note);
      return writeSummary(EXIT.REFUSED, note);
    }
    log(`readyMarker found at ${config.readyMarker.path}`);
  }

  if (config.benchmark) {
    try {
      summary.hostBenchmark = await hostBenchmark(driver, config.cpuThrottle);
      log(`host benchmark median ${summary.hostBenchmark.medianMs} ms`);
    } catch (e) {
      summary.hostBenchmark = { runsMs: [], medianMs: null, cpuThrottle: config.cpuThrottle, error: clipText(e.message, 300) };
      log(`host benchmark failed: ${e.message}`);
    }
  }

  const env = {
    outDir, configDir, accounts, storageStates, log, savedStorage: new Set(), axe,
    platform: process.platform, driverName: driver.name, browserVersion: driver.browserVersion,
    launchArgsHash: launchArgsHash({ headless: config.headless }),
  };
  try {
    for (const item of plan.captures) {
      log(`capture ${item.stem} -> ${item.url}`);
      const result = await runCapture(driver, config, item, env);
      summary.captures.push(result);
      log(`capture ${item.stem} ${result.ok ? 'ok' : `incomplete: ${result.error}`}`);
    }
  } finally {
    await driver.close().catch(() => {});
  }
  const allOk = summary.captures.length > 0 && summary.captures.every((c) => c.ok);
  const code = allOk ? EXIT.OK : EXIT.PARTIAL;
  out(`${allOk ? 'OK' : 'PARTIAL'}: ${summary.captures.filter((c) => c.ok).length}/${summary.captures.length} captures complete; see ${path.join(outDir, 'summary.json')}`);
  return writeSummary(code);
}

const invokedDirectly = (() => {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`ERROR: unexpected failure: ${printable(e && e.stack ? e.stack : e, 2000)}\n`);
    for (const c of [...liveChildren]) killChild(c);
    process.exitCode = EXIT.USAGE;
  });
}
