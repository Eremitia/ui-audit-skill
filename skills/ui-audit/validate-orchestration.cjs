#!/usr/bin/env node
"use strict";

/*
 * validate-orchestration.cjs - checks the orchestration records of a ui-audit
 * run: agent-log.json (every invocation, the running count against the cap in
 * force, agent ID shapes, the breakdown mapping, escalations, dialogues,
 * fallbacks, model availability and what the cap left uncovered), the fix
 * session's fix-log.json (git rules, branches, commit messages, checks,
 * re-verification and approvals), and ui-audit.config.json.
 *
 *   node validate-orchestration.cjs <agent-log.json> --kind agent-log [--metadata <run-metadata.json>]
 *        [--findings <findings.json>] [--ledger <coverage-ledger.json>] [--fingerprints <fingerprint-agents.json>]
 *   node validate-orchestration.cjs <fix-log.json> --kind fix-log [--findings <findings.json>] [--agent-log <fix/agent-log.json>]
 *   node validate-orchestration.cjs <ui-audit.config.json> --kind config
 *
 * Exit 0: "PASS: ...". Exit 1: one "ERROR: <pointer>: <message>" line per
 * problem, then "FAIL: N validation error(s)". Exit 2: usage error, or a path
 * that names an environment file (refused without being opened).
 *
 * Plain Node (22.12 or later), no dependencies. The arithmetic and the routing
 * table come from scripts/orchestrate.mjs.
 */

// ==== BEGIN SHARED HELPERS ====
// This block is byte-identical in validate-findings.cjs,
// validate-coverage-ledger.cjs and validate-orchestration.cjs. Tests compare
// the copies; edit all of them or none.

const SHARED_LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  nestingDepth: 64,
  validationErrors: 100,
});

const DIAGNOSTIC_MAX_CHARS = 256;
const QUOTED_VALUE_MAX_CHARS = 80;

// At least one character that a reader can actually see.
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
// Characters that make text unsafe to compare or display as an identifier.
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
// Characters never allowed anywhere in a relative path (includes "\" and ":").
const PATH_FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}<>:"|?*\\]/u;
// Device names Windows resolves regardless of directory or extension.
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/iu;
// Characters escaped as \uXXXX before any diagnostic reaches a terminal.
const UNSAFE_DIAGNOSTIC_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

const ALLOWED_ARTIFACT_EXTENSIONS = Object.freeze([
  ".png", ".jpg", ".jpeg", ".webp", ".json", ".txt", ".log", ".html", ".har", ".zip",
]);
const NEVER_PROMOTED_SEGMENTS = Object.freeze(["storage", "profile"]);

const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const FINGERPRINT_MAX_CHARS = 200;

// Model aliases in tier order (low to high), effort levels and the
// self-assessment scale every delegated result carries.
const MODEL_ALIASES = Object.freeze(["haiku", "sonnet", "opus", "fable"]);
const EFFORT_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
const SELF_ASSESSMENT_LEVELS = Object.freeze(["high", "medium", "low", "unsure"]);

// Expectation namespaces that point at a SOURCES.md rule or at an approved
// visual baseline capture.
const RULE_REF = /^RULE:[A-Z][A-Z0-9]*-[0-9]{2,3}$/;
const BASELINE_REF = /^baseline:[a-z0-9][a-z0-9_-]{0,63}#[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,31}\.(light|dark|system)$/;

// A path segment that names an environment file. No validator opens one.
const ENVIRONMENT_FILE_PATTERNS = Object.freeze([
  /^\.env($|[.\-_])/i,
  /^\.envrc$/i,
  /\.env$/i,
  /^\.dev\.vars$/i,
]);

// Agent budget reserves per profile (the orchestration share is computed).
const PROFILE_RESERVES = Object.freeze({
  quick: Object.freeze({ reconnaissance: 4, critics: 1, validation: 1 }),
  standard: Object.freeze({ reconnaissance: 4, critics: 2, validation: 2 }),
  deep: Object.freeze({ reconnaissance: 4, critics: 2, validation: 2 }),
});
const AGENT_CAP_MAX = 500;
const RESERVE_FRACTION_MIN = 0.05;
const RESERVE_FRACTION_MAX = 0.3;

// The fixed defect classes of the skill, by file. The order here is the order
// of the lens enum in report-schema.json.
const BLOCK_CATALOG = Object.freeze({
  "LENSES.md": Object.freeze([
    "Functional flows",
    "Business rules as displayed",
    "Forms and validation",
    "Loading, empty and error states",
    "Navigation and routing",
    "Data consistency across screens",
    "Roles in the interface",
    "Wildcard",
    "Obvious things",
  ]),
  "FUNCTIONAL-FLOWS.md": Object.freeze([
    "Entity lifecycle transitions",
    "Multi-step flows and drafts",
    "Double submit and idempotent actions",
    "Concurrent sessions and stale views",
    "Live updates and polling correctness",
    "Displayed business rules",
    "Figure consistency across screens",
    "Money, quantity and rounding",
    "Time, dates and time zones",
    "Locale and number formatting",
    "Exports match the screen",
    "Form validation and boundary values",
    "Search, filter, sort and pagination",
    "Uploads and generated files",
    "Role-gated actions",
    "Destructive actions, confirmation and undo",
  ]),
  "RESPONSIVE-AND-LAYOUT.md": Object.freeze([
    "Horizontal overflow and clipping",
    "Breakpoint pivots",
    "Reflow, zoom and text spacing",
    "Orientation and safe areas",
    "Long and unbroken content",
    "Growing lists and internal scroll",
    "Overlap and stacking",
    "Target size and spacing",
    "Dialogs and on-screen keyboard",
    "Hover versus touch media",
  ]),
  "PERFORMANCE.md": Object.freeze([
    "Largest paint and render-blocking",
    "Layout shift",
    "JavaScript weight and client boundaries",
    "Images and media",
    "Fonts",
    "Server and data waterfalls",
    "Interaction latency and long tasks",
    "Re-render and DOM churn",
    "Polling and background work",
    "Large lists and DOM size",
    "Long-session stability",
    "Back/forward cache",
  ]),
  "ACCESSIBILITY.md": Object.freeze([
    "Text and non-text contrast",
    "Text alternatives and names",
    "Color as the only signal",
    "Structure and semantics",
    "Forced colors and contrast preference",
    "Keyboard operation and focus order",
    "Focus visibility and obscuring",
    "Dialogs and overlays",
    "Motion and timing",
    "Pointer gestures and cancellation",
    "Form labels, errors and help",
    "Status messages and live regions",
    "Custom widget roles and states",
    "Accessible authentication",
    "Consistent navigation and help",
  ]),
  "VISUAL-AND-THEMING.md": Object.freeze([
    "Theme parity",
    "Theme initialization and flash",
    "Native controls and color scheme",
    "Per-tenant brand colors",
    "Token discipline",
    "Component consistency",
    "Icon family and imagery",
    "Generic or template look",
    "Public page metadata and share preview",
    "Unintended visual change",
  ]),
  "RESILIENCE-AND-STATES.md": Object.freeze([
    "Loading states",
    "Empty states",
    "Error states and boundaries",
    "Not found and forbidden",
    "Hydration mismatches",
    "Offline and flaky network",
    "Slow responses and pending feedback",
    "Failed mutations",
    "Session expiry and re-entry",
    "Stale tabs and deploys",
    "Back, forward and refresh",
    "Hidden tab and resume",
    "Alerts, sounds and notifications",
  ]),
  "PROJECT-CONVENTIONS.md": Object.freeze([
    "Documented UI rules",
    "Owner preferences on record",
    "Code structure conventions",
    "Navigation and configuration drift",
    "Test presence conventions",
  ]),
});
// Blocks every companion file carries besides its classes. They can be
// selected for a prompt but never name a lens.
const COMPANION_META_BLOCKS = Object.freeze(["Core discipline", "Universal moves", "Validation rules"]);
const ORDINARY_LENS_FILE = "LENSES.md";

const CLASS_BLOCK_REFS = Object.freeze(
  Object.entries(BLOCK_CATALOG).flatMap(([file, names]) => names.map((name) => `${file}#${name}`)),
);
const BLOCK_REFS = Object.freeze(
  Object.entries(BLOCK_CATALOG).flatMap(([file, names]) => [
    ...names.map((name) => `${file}#${name}`),
    ...(file === ORDINARY_LENS_FILE ? [] : COMPANION_META_BLOCKS.map((name) => `${file}#${name}`)),
  ]),
);
const BLOCK_REF_SET = new Set(BLOCK_REFS);
const CLASS_BLOCK_REF_SET = new Set(CLASS_BLOCK_REFS);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function isWellFormedText(value) {
  return typeof value === "string" && value.isWellFormed();
}

function hasVisibleContent(value) {
  return isWellFormedText(value) && VISIBLE_CONTENT.test(value);
}

function codePointCount(value) {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

function isSafeRelativePath(value) {
  if (!isWellFormedText(value) || value.length === 0 || value.trim() !== value) return false;
  if (PATH_FORBIDDEN_CHARACTER.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("~")) return false;
  for (const segment of value.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
    if (segment.endsWith(" ") || segment.endsWith(".")) return false;
    if (WINDOWS_RESERVED_COMPONENT.test(segment)) return false;
  }
  return true;
}

function isSafeAgentId(value) {
  return typeof value === "string" && AGENT_ID.test(value) && !WINDOWS_RESERVED_COMPONENT.test(value);
}

// agents/<id>/artifacts/<rest>; when ownerId is given the <id> must equal it.
function isOwnedArtifactPath(value, ownerId) {
  if (!isSafeRelativePath(value)) return false;
  const segments = value.split("/");
  if (segments.length < 4 || segments[0] !== "agents" || segments[2] !== "artifacts") return false;
  if (!isSafeAgentId(segments[1])) return false;
  if (ownerId !== undefined && segments[1] !== ownerId) return false;
  const rest = segments.slice(3);
  if (rest.some((segment) => NEVER_PROMOTED_SEGMENTS.includes(segment.toLowerCase()))) return false;
  const name = rest[rest.length - 1].toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 && ALLOWED_ARTIFACT_EXTENSIONS.includes(name.slice(dot));
}

function isFingerprint(value) {
  return typeof value === "string" && value.length <= FINGERPRINT_MAX_CHARS && FINGERPRINT.test(value);
}

function isCleanAnchor(value) {
  return hasVisibleContent(value) && value.trim() === value && !INVISIBLE_OR_CONTROL.test(value);
}

// The expectation namespaces of the coverage ledger and of findings.json.
function isExpectationRef(value) {
  if (!isCleanAnchor(value)) return false;
  if (/^PR-[0-9]{2,3}$/.test(value)) return true;
  if (/^WCAG22#[1-4]\.[1-9][0-9]?\.[1-9][0-9]?$/.test(value)) return true;
  if (BLOCK_REF_SET.has(value)) return true;
  if (value.startsWith("RULE:")) return RULE_REF.test(value);
  if (value.startsWith("baseline:")) return BASELINE_REF.test(value);
  let match = /^HTML#(.+)$/su.exec(value);
  if (match) return isCleanAnchor(match[1]);
  match = /^memory:([^#/]+)#(.+)$/su.exec(value);
  if (match) return isSafeRelativePath(match[1]) && isCleanAnchor(match[2]);
  if (value.startsWith("memory:") || value.startsWith("HTML#") || value.startsWith("WCAG22#") || value.startsWith("PR-")) {
    return false;
  }
  match = /^sibling:(.+)$/su.exec(value);
  if (match) return isSafeRelativePath(match[1]);
  const hash = value.indexOf("#");
  if (hash <= 0) return false;
  const file = value.slice(0, hash);
  const anchor = value.slice(hash + 1);
  // A bare skill file name must be an exact block ref, never a free anchor.
  if (hasOwn(BLOCK_CATALOG, file)) return false;
  // A repository document or source file: the last segment carries an extension.
  if (!/\.[A-Za-z0-9]+$/.test(file.slice(file.lastIndexOf("/") + 1))) return false;
  return isSafeRelativePath(file) && isCleanAnchor(anchor);
}

// True when any segment of the path (either separator) is an environment file.
function isForbiddenPath(value) {
  if (typeof value !== "string") return false;
  return value.split(/[\\/]+/).some((segment) =>
    segment !== "" && ENVIRONMENT_FILE_PATTERNS.some((pattern) => pattern.test(segment)));
}

// The orchestration reserve is max(2, ceil(cap * fraction), floor), where the
// floor (ORCHESTRATION.md 1.2) is the larger worst case of one consult and one
// decisive escalation; called without it, the floor is 2. The product is
// rounded to nine decimals first so that, for example, 30 * 0.1 gives 3 and
// not 4 through binary floating point.
function computeReserve(profile, cap, fraction, floor = 2) {
  if (!hasOwn(PROFILE_RESERVES, profile) || !Number.isInteger(cap) || cap < 0 ||
      typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 ||
      !Number.isInteger(floor) || floor < 0) {
    return null;
  }
  const fixed = PROFILE_RESERVES[profile];
  const orchestration = Math.max(2, Math.ceil(Math.round(cap * fraction * 1e9) / 1e9), floor);
  return {
    reconnaissance: fixed.reconnaissance,
    critics: fixed.critics,
    validation: fixed.validation,
    orchestration,
    total: fixed.reconnaissance + fixed.critics + fixed.validation + orchestration,
  };
}

// The smallest cap whose reserves, plus `setup` calls made before the gate
// (the agent permission check), still leave room for one hunter, or null when
// no cap up to AGENT_CAP_MAX does (or the inputs are not valid).
function minimumCap(profile, fraction, floor = 2, setup = 0) {
  if (computeReserve(profile, 0, fraction, floor) === null || !Number.isInteger(setup) || setup < 0) return null;
  for (let cap = 1; cap <= AGENT_CAP_MAX; cap += 1) {
    if (computeReserve(profile, cap, fraction, floor).total + setup + 1 <= cap) return cap;
  }
  return null;
}

// Whether <runDir>/<relative> exists as a regular file reached without a
// symbolic link or junction on any segment. Never opens the file.
function artifactExistsUnder(runDir, relative) {
  const fs = require("node:fs");
  const path = require("node:path");
  if (typeof runDir !== "string" || !isSafeRelativePath(relative) || isForbiddenPath(relative)) return false;
  let current = path.resolve(runDir);
  let stat;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    try {
      stat = fs.lstatSync(current);
    } catch {
      return false;
    }
    if (stat.isSymbolicLink()) return false;
  }
  return stat !== undefined && stat.isFile();
}

function escapeDiagnostic(text) {
  return String(text).replace(UNSAFE_DIAGNOSTIC_CHARACTER, (character) => {
    const code = character.codePointAt(0);
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

function clipDiagnostic(text) {
  if (text.length <= DIAGNOSTIC_MAX_CHARS) return text;
  let clipped = text.slice(0, DIAGNOSTIC_MAX_CHARS - 3);
  const last = clipped.charCodeAt(clipped.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) clipped = clipped.slice(0, -1);
  return `${clipped}...`;
}

// Renders a value for a message without echoing large or hostile input.
function quote(value) {
  if (typeof value === "string") {
    const shown = value.length > QUOTED_VALUE_MAX_CHARS ? `${value.slice(0, QUOTED_VALUE_MAX_CHARS)}...` : value;
    return JSON.stringify(shown);
  }
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "<non-finite number>";
  return Array.isArray(value) ? "<array>" : `<${typeof value}>`;
}

function pointerJoin(base, key) {
  return `${base}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

// Collects diagnostics, keeping at most `cap` lines but counting all of them.
function createCollector(cap = SHARED_LIMITS.validationErrors) {
  const lines = [];
  let total = 0;
  return {
    lines,
    get total() {
      return total;
    },
    add(pointer, message) {
      total += 1;
      if (lines.length < cap) lines.push(clipDiagnostic(escapeDiagnostic(`${pointer}: ${message}`)));
    },
    absorb(other) {
      for (const line of other.lines) {
        if (lines.length < cap) lines.push(line);
      }
      total += other.total;
    },
  };
}

function finishErrors(collector) {
  const result = collector.lines.slice();
  Object.defineProperty(result, "total", { value: collector.total, enumerable: false });
  return result;
}

class SafeReadError extends Error {}

// Reads a UTF-8 text file without following links and without trusting its
// size. Throws SafeReadError with a message that never echoes file content.
function safeReadText(filePath, maxBytes = SHARED_LIMITS.inputBytes) {
  const fs = require("node:fs");
  const flags = fs.constants;
  let fd;
  let before;
  if (typeof flags.O_NOFOLLOW === "number" && typeof flags.O_NONBLOCK === "number") {
    try {
      fd = fs.openSync(filePath, flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK);
    } catch (error) {
      if (error && error.code === "ELOOP") throw new SafeReadError("refusing to read through a symbolic link");
      throw new SafeReadError(`cannot open input (${(error && error.code) || "unknown error"})`);
    }
    before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) {
      fs.closeSync(fd);
      throw new SafeReadError("input is not a regular file");
    }
  } else if (process.platform === "win32") {
    let link;
    try {
      link = fs.lstatSync(filePath, { bigint: true });
    } catch (error) {
      throw new SafeReadError(`cannot open input (${(error && error.code) || "unknown error"})`);
    }
    if (link.isSymbolicLink()) throw new SafeReadError("refusing to read through a symbolic link or junction");
    if (!link.isFile()) throw new SafeReadError("input is not a regular file");
    try {
      fd = fs.openSync(filePath, "r");
    } catch (error) {
      throw new SafeReadError(`cannot open input (${(error && error.code) || "unknown error"})`);
    }
    before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.dev !== link.dev || before.ino !== link.ino) {
      fs.closeSync(fd);
      throw new SafeReadError("input was replaced while it was being opened");
    }
  } else {
    throw new SafeReadError("this platform cannot open a file without following links; refusing to read");
  }

  const chunks = [];
  let bytes = 0;
  try {
    if (before.size > BigInt(maxBytes)) throw new SafeReadError(`input exceeds the ${maxBytes} byte limit`);
    const chunk = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      bytes += read;
      if (bytes > maxBytes) throw new SafeReadError(`input exceeds the ${maxBytes} byte limit`);
      chunks.push(Buffer.from(chunk.subarray(0, read)));
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.size !== BigInt(bytes)) {
      throw new SafeReadError("input changed while it was being read");
    }
  } finally {
    fs.closeSync(fd);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes));
  } catch {
    throw new SafeReadError("input is not valid UTF-8");
  }
}

// Scans JSON text before parsing so that hostile nesting or sheer item counts
// are refused without building the document. Malformed text is left for
// JSON.parse to reject.
function structuralPreflight(text, limits) {
  const stack = [];
  let values = 0;
  let previous = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === "\\") index += 1;
      else if (character === '"') {
        inString = false;
        previous = '"';
      }
      continue;
    }
    if (character === " " || character === "\t" || character === "\n" || character === "\r") continue;
    const top = stack[stack.length - 1];
    const keyStart = top !== undefined && top.kind === "object" && (previous === "{" || previous === ",");
    const valueStart = !keyStart && (previous === "" || previous === ":" ||
      (top !== undefined && top.kind === "array" && (previous === "[" || previous === ",")));
    if (keyStart && character === '"') {
      top.count += 1;
      if (top.count > limits.objectFields) return `an object has more than ${limits.objectFields} fields`;
    } else if (valueStart && character !== "]" && character !== "}") {
      values += 1;
      if (values > limits.totalValues) return `input has more than ${limits.totalValues} values`;
      if (top !== undefined && top.kind === "array") {
        top.count += 1;
        const max = stack.length === 1 ? limits.rootItems : limits.nestedItems;
        if (top.count > max) return `an array has more than ${max} items`;
      }
    }
    if (character === '"') inString = true;
    else if (character === "[" || character === "{") {
      stack.push({ kind: character === "[" ? "array" : "object", count: 0 });
      if (stack.length > limits.nestingDepth) return `input exceeds the ${limits.nestingDepth}-level nesting limit`;
    } else if (character === "]" || character === "}") {
      stack.pop();
    }
    if (character !== '"') previous = character;
  }
  return null;
}

// The same limits, applied to an already parsed value (API callers), plus a
// refusal of shared or cyclic references.
function dataLimitViolation(root, limits) {
  const seen = new WeakSet();
  const stack = [{ value: root, pointer: "", depth: 1 }];
  let values = 0;
  while (stack.length > 0) {
    const { value, pointer, depth } = stack.pop();
    values += 1;
    if (values > limits.totalValues) return { pointer, message: `input has more than ${limits.totalValues} values` };
    if (value === null || typeof value !== "object") continue;
    if (depth > limits.nestingDepth) return { pointer, message: `exceeds the ${limits.nestingDepth}-level nesting limit` };
    if (seen.has(value)) return { pointer, message: "repeated or cyclic object reference" };
    seen.add(value);
    if (Array.isArray(value)) {
      const max = depth === 1 ? limits.rootItems : limits.nestedItems;
      if (value.length > max) return { pointer, message: `array has more than ${max} items` };
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], pointer: pointerJoin(pointer, index), depth: depth + 1 });
      }
    } else {
      const keys = Object.keys(value);
      if (keys.length > limits.objectFields) return { pointer, message: `object has more than ${limits.objectFields} fields` };
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[keys[index]], pointer: pointerJoin(pointer, keys[index]), depth: depth + 1 });
      }
    }
  }
  return null;
}

function readJsonDocument(filePath, limits) {
  const text = safeReadText(filePath, limits.inputBytes);
  const refusal = structuralPreflight(text, limits);
  if (refusal) throw new SafeReadError(refusal);
  try {
    return JSON.parse(text);
  } catch {
    throw new SafeReadError("input is not valid JSON");
  }
}

function emitResult(collector, passMessage) {
  const out = [];
  if (collector.total === 0) {
    out.push(passMessage);
  } else {
    for (const line of collector.lines) out.push(`ERROR: ${line}`);
    const capped = collector.total > SHARED_LIMITS.validationErrors
      ? `; output capped at ${SHARED_LIMITS.validationErrors}`
      : "";
    out.push(`FAIL: ${collector.total} validation error(s)${capped}`);
  }
  process.stdout.write(`${out.join("\n")}\n`);
  process.exitCode = collector.total === 0 ? 0 : 1;
}

function parseCli(argv, allowedFlags) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--")) {
      if (!allowedFlags.includes(argument)) return { error: `unknown option ${quote(argument)}` };
      if (hasOwn(options, argument)) return { error: `option ${argument} given twice` };
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) return { error: `option ${argument} needs a path` };
      options[argument] = next;
      index += 1;
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1) return { error: "expected exactly one input file" };
  return { input: positional[0], options };
}
// ==== END SHARED HELPERS ====

// ==== agent-log.json, fix-log.json and config validation ====

// Routing table, ladders, floors and the breakdown mapping come from the one
// implementation in scripts/orchestrate.mjs (loaded with require(esm), Node 22.12+).
const orchestrate = require("./scripts/orchestrate.mjs");

const ORCHESTRATION_LIMITS = Object.freeze({
  ...SHARED_LIMITS,
  rootItems: 10000,
  nestedItems: 5000,
  objectFields: 1000,
  totalValues: 500000,
});
const LIMITS = ORCHESTRATION_LIMITS;

const AGENT_LOG_SCHEMA = "ui-audit/agent-log@1";
const FIX_LOG_SCHEMA = "ui-audit/fix-log@1";
const CONFIG_SCHEMA = orchestrate.CONFIG_SCHEMA;
const AGENT_LOG_KEYS = Object.freeze([
  "schema", "scope", "run_id", "fix_run_id", "profile", "cap", "reserve", "invocations", "escalations", "dialogues",
  "fallbacks", "model_availability", "cap_overrides", "spent", "uncovered_by_cap",
]);
const INVOCATION_KEYS = Object.freeze([
  "seq", "agent_id", "host_agent_id", "kind", "task_kind", "role", "phase", "wave", "purpose", "parent_ref", "fallback_ref",
  "retry_of", "model_requested", "model_passed", "effort_requested", "effort_applied", "model_self_report", "model_observed",
  "outcome", "failure_class", "counts_against_cap", "started_at", "finished_at",
]);
const AUDIT_PURPOSES = Object.freeze(["primary", "replacement", "escalation", "consult_peer", "consult_resume", "judge", "panel", "schema_repair"]);
const FIX_PURPOSES = Object.freeze(["fix", "fix_reverify", "escalation", "panel", "consult_resume", "judge", "schema_repair"]);
const OUTCOMES = Object.freeze(["ok", "malformed", "failed", "refused_concurrency", "refused_resume", "substituted"]);
const FAILURE_CLASSES = orchestrate.FAILURE_CLASSES;
const AUDIT_PHASES = Object.freeze(["1", "2", "3", "4", "5", "6"]);
const FIX_PHASES = Object.freeze(["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"]);
const AUDIT_RESERVE_KEYS = Object.freeze(["reconnaissance", "critics", "validation", "orchestration"]);
const FIX_RESERVE_KEYS = Object.freeze(["reverifiers", "orchestration"]);
const FIX_RESERVE_OPTIONAL = Object.freeze(["fixer_continuations"]);
const AUDIT_BREAKDOWN_KEYS = Object.freeze([
  "reconnaissance", "hunters", "critics", "candidate_verifiers", "record_verifiers", "replacement_verifiers",
  "consults", "judges", "escalations", "panels", "schema_repairs",
]);
const FIX_BREAKDOWN_KEYS = Object.freeze(["fixers", "reverifiers", "escalations", "panels", "schema_repairs"]);
const FIX_BREAKDOWN_OPTIONAL = Object.freeze(["fixer_continuations"]);
const ESCALATION_KEYS = Object.freeze([
  "id", "about", "mode", "from_agent", "from_model", "to_model_wanted", "to_model_used", "fallback_ref", "trigger",
  "new_agents", "funded_from", "worst_case", "reserve_before", "outcome",
]);
const ESCALATION_OUTCOMES = Object.freeze(["open", "resolved", "still_unsure", "not_funded", "cancelled_pause"]);
const ESCALATION_TRIGGERS = Object.freeze(["self_assessment_low", "self_assessment_unsure", "needs_stronger_model", "malformed_twice"]);
const ABOUT_KINDS = Object.freeze(["unit", "candidate", "record", "sweep", "critic", "recon", "fix"]);
const DIALOGUE_KEYS = Object.freeze([
  "id", "about", "requested_by", "lens_needed", "blocking", "peer", "judge", "judge_route_mode", "judge_fallback_ref",
  "max_rounds", "worst_case", "reserve_before", "rounds", "outcome", "agreed_by", "judge_effect", "summary", "invocations",
]);
const DIALOGUE_OUTCOMES = Object.freeze([
  "open", "agreed", "judged_requester", "judged_peer", "judged_neither", "cancelled_budget", "cancelled_pause",
]);
const JUDGE_EFFECTS = Object.freeze(["keep", "drop_to_improvements", "reject", "needs_validation", "lower_severity", "mark_covered", "mark_blocked"]);
const ROUTE_MODES = Object.freeze(["single", "panel_2_agree", "panel_3_majority", "none"]);
const FALLBACK_KEYS = Object.freeze([
  "id", "task_kind", "wanted", "used", "effort", "mode", "reason", "funded_from", "worst_case", "reserve_before", "agents",
  "invocations", "outcome", "narrowed_to", "about",
]);
const FALLBACK_OUTCOMES = Object.freeze(["open", "single_ok", "agreed", "judged", "majority", "split", "not_funded", "cancelled_pause"]);
const FALLBACK_REASONS = Object.freeze([...FAILURE_CLASSES, "declared_unavailable", "substituted", "usage_limit_family"]);
const FUNDED_FROM = Object.freeze(["planned", "orchestration_reserve"]);
const AVAILABILITY_KEYS = Object.freeze(["declared", "observed", "first_evidence_seq", "resets"]);
const MODEL_DECLARED = Object.freeze(["assume_available", "probe", "unavailable"]);
const MODEL_OBSERVED = Object.freeze(["untested", "available", "unavailable", "substituted", "unknown"]);
const UNCOVERED_KINDS = Object.freeze(["unit", "candidate", "record", "consult", "escalation", "panel", "fix"]);
const CAP_OVERRIDE_KEYS = Object.freeze(["effective_from_seq", "old_cap", "new_cap", "at", "approved_text"]);
const ITEM_ID = Object.freeze({ dialogue: /^dlg-[0-9]{2,4}$/, escalation: /^esc-[0-9]{2,4}$/, fallback: /^fb-[0-9]{2,4}$/ });
const SUMMARY_MAX_CHARS = 1200;

// Agent ID shapes (SKILL.md "Write isolation and agent IDs") and the task
// kinds each shape may carry.
const SLUG = "[a-z0-9][a-z0-9_-]*";
const AGENT_ID_SHAPES = Object.freeze([
  { re: /^w0-perm$/, kinds: ["permission_check"] },
  { re: /^r1a(-e[1-9][0-9]*)?$/, kinds: ["recon_product"] },
  { re: /^r1b(-e[1-9][0-9]*)?$/, kinds: ["recon_routes"] },
  { re: /^r1c(-e[1-9][0-9]*)?$/, kinds: ["recon_design_rules"] },
  { re: /^r1d(-e[1-9][0-9]*)?$/, kinds: ["recon_runtime"] },
  { re: new RegExp(`^r1x-${SLUG}$`), kinds: ["recon_focused"] },
  { re: /^l[1-9][0-9]*$/, kinds: ["ledger_draft"] },
  { re: new RegExp(`^h[1-9][0-9]*(e[1-9][0-9]*)?-${SLUG}$`), kinds: ["hunt_standard", "hunt_business", "hunt_performance", "hunt_judgement"] },
  { re: /^c[1-9][0-9]*(e[1-9][0-9]*)?$/, kinds: ["critic_wave"] },
  { re: /^cfinal$/, kinds: ["critic_final"] },
  { re: new RegExp(`^v[1-9][0-9]*-${SLUG}$`), kinds: ["verify_candidate", "verify_candidate_strong", "verify_batch", "verify_source_batch"] },
  { re: new RegExp(`^p[1-9][0-9]*-${SLUG}$`), kinds: ["verify_record", "verify_record_strong"] },
  { re: new RegExp(`^q[1-9][0-9]*-${SLUG}$`), kinds: ["consult_peer"] },
  { re: new RegExp(`^j[1-9][0-9]*-${SLUG}$`), kinds: ["judge"] },
  { re: /^s[1-9][0-9]*$/, kinds: ["schema_repair"] },
  { re: /^w[1-9][0-9]*(e[1-9][0-9]*)?-sweep$/, kinds: ["screenshot_sweep"] },
  { re: new RegExp(`^x[1-9][0-9]*(e[1-9][0-9]*)?-${SLUG}$`), kinds: ["fix_mechanical", "fix_logic", "fix_business"] },
  { re: new RegExp(`^y[1-9][0-9]*-${SLUG}$`), kinds: ["fix_reverify", "fix_reverify_strong"] },
]);

function agentIdShape(id) {
  return AGENT_ID_SHAPES.find((shape) => shape.re.test(id)) || null;
}

const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isIntegerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isPositiveInteger = (value) => Number.isInteger(value) && value >= 1;
const isNullableString = (value) => value === null || typeof value === "string";

function checkExactKeys(object, keys, pointer, collector, optional = []) {
  for (const key of keys) if (!hasOwn(object, key)) collector.add(pointer, `missing field ${quote(key)}`);
  for (const key of Object.keys(object)) {
    if (!keys.includes(key) && !optional.includes(key)) collector.add(pointerJoin(pointer, key), "is not an allowed field");
  }
}

function checkAbout(about, pointer, collector) {
  if (!isPlainObject(about) || Object.keys(about).length !== 2 || !ABOUT_KINDS.includes(about.kind) || !hasVisibleContent(about.ref)) {
    collector.add(pointer, `must be {kind, ref} with kind one of ${ABOUT_KINDS.join(", ")}`);
    return false;
  }
  return true;
}

// ---- agent log ----

function capTimeline(log, collector) {
  const overrides = Array.isArray(log.cap_overrides) ? log.cap_overrides : [];
  const steps = [];
  overrides.forEach((entry, index) => {
    const at = pointerJoin("/cap_overrides", index);
    if (!isPlainObject(entry)) {
      collector.add(at, `must be {${CAP_OVERRIDE_KEYS.join(", ")}}`);
      return;
    }
    checkExactKeys(entry, CAP_OVERRIDE_KEYS, at, collector);
    if (!isPositiveInteger(entry.effective_from_seq)) collector.add(pointerJoin(at, "effective_from_seq"), "must be a positive integer");
    if (!isPositiveInteger(entry.old_cap) || !isPositiveInteger(entry.new_cap) || entry.new_cap <= entry.old_cap) {
      collector.add(at, "old_cap and new_cap must be positive integers with new_cap above old_cap");
    }
    if (!hasVisibleContent(entry.approved_text)) collector.add(pointerJoin(at, "approved_text"), "must quote the owner's words");
    if (!hasVisibleContent(entry.at)) collector.add(pointerJoin(at, "at"), "must be an ISO-8601 time");
    steps.push(entry);
  });
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index].old_cap !== steps[index - 1].new_cap || !(steps[index].effective_from_seq > steps[index - 1].effective_from_seq)) {
      collector.add(pointerJoin("/cap_overrides", index), "overrides must chain: each old_cap is the previous new_cap, in seq order");
    }
  }
  if (steps.length > 0 && Number.isInteger(log.cap) && steps[steps.length - 1].new_cap !== log.cap) {
    collector.add("/cap", "must equal the new_cap of the last cap override");
  }
  const initial = steps.length > 0 ? steps[0].old_cap : log.cap;
  return (seq) => {
    let cap = initial;
    for (const step of steps) if (seq >= step.effective_from_seq) cap = step.new_cap;
    return cap;
  };
}

function checkInvocation(inv, index, ctx, collector) {
  const at = pointerJoin("/invocations", index);
  if (!isPlainObject(inv)) {
    collector.add(at, "must be an invocation object");
    return;
  }
  checkExactKeys(inv, INVOCATION_KEYS, at, collector);
  if (inv.seq !== index + 1) collector.add(pointerJoin(at, "seq"), `must be ${index + 1}: seq starts at 1 and has no gaps`);
  if (!isSafeAgentId(inv.agent_id)) {
    collector.add(pointerJoin(at, "agent_id"), "must be a safe agent ID");
  } else {
    const shape = agentIdShape(inv.agent_id);
    if (shape === null) collector.add(pointerJoin(at, "agent_id"), `${quote(inv.agent_id)} matches no agent ID shape of SKILL.md`);
    else if (typeof inv.task_kind === "string" && !shape.kinds.includes(inv.task_kind)) {
      collector.add(pointerJoin(at, "task_kind"), `${quote(inv.task_kind)} does not fit agent ID ${quote(inv.agent_id)} (${shape.kinds.join(", ")})`);
    }
  }
  if (!isNullableString(inv.host_agent_id)) collector.add(pointerJoin(at, "host_agent_id"), "must be a string or null");
  if (inv.kind !== "launch" && inv.kind !== "resume") collector.add(pointerJoin(at, "kind"), 'must be "launch" or "resume"');
  if (inv.kind === "resume" && !ctx.launched.has(inv.agent_id)) {
    collector.add(pointerJoin(at, "kind"), `a resume needs an earlier launch of ${quote(inv.agent_id)}`);
  }
  if (inv.kind === "launch" && inv.outcome !== "refused_concurrency") ctx.launched.add(inv.agent_id);
  if (!hasOwn(orchestrate.ROUTING_TABLE, inv.task_kind)) collector.add(pointerJoin(at, "task_kind"), "is not a task kind of the routing table");
  if (inv.role !== "general" && inv.role !== "research") collector.add(pointerJoin(at, "role"), 'must be "general" or "research"');
  const phases = ctx.scope === "fix" ? FIX_PHASES : AUDIT_PHASES;
  if (!phases.includes(inv.phase)) collector.add(pointerJoin(at, "phase"), `must be one of ${phases.join(", ")}`);
  if (inv.wave !== null && !isPositiveInteger(inv.wave)) collector.add(pointerJoin(at, "wave"), "must be a positive integer or null");
  const purposes = ctx.scope === "fix" ? FIX_PURPOSES : AUDIT_PURPOSES;
  if (!purposes.includes(inv.purpose)) collector.add(pointerJoin(at, "purpose"), `must be one of ${purposes.join(", ")}`);
  if (inv.parent_ref !== null && !(typeof inv.parent_ref === "string" && (ITEM_ID.dialogue.test(inv.parent_ref) || ITEM_ID.escalation.test(inv.parent_ref)))) {
    collector.add(pointerJoin(at, "parent_ref"), "must be null, a dlg-NN or an esc-NN id");
  } else if (inv.parent_ref !== null && !ctx.itemIds.has(inv.parent_ref)) {
    collector.add(pointerJoin(at, "parent_ref"), `${quote(inv.parent_ref)} is not a dialogue or escalation of this log`);
  }
  if (inv.fallback_ref !== null && !(typeof inv.fallback_ref === "string" && ITEM_ID.fallback.test(inv.fallback_ref))) {
    collector.add(pointerJoin(at, "fallback_ref"), "must be null or an fb-NN id");
  } else if (inv.fallback_ref !== null && !ctx.fallbacks.has(inv.fallback_ref)) {
    collector.add(pointerJoin(at, "fallback_ref"), `${quote(inv.fallback_ref)} is not a fallback of this log`);
  }
  if (inv.purpose === "escalation" && !(typeof inv.parent_ref === "string" && ITEM_ID.escalation.test(inv.parent_ref))) {
    collector.add(pointerJoin(at, "parent_ref"), "an escalation call names its esc-NN");
  }
  if ((inv.purpose === "consult_peer") && !(typeof inv.parent_ref === "string" && ITEM_ID.dialogue.test(inv.parent_ref))) {
    collector.add(pointerJoin(at, "parent_ref"), "a consult peer call names its dlg-NN");
  }
  if (inv.purpose === "panel" && inv.fallback_ref === null) collector.add(pointerJoin(at, "fallback_ref"), "a panel member names its fb-NN");
  if (inv.purpose === "judge" && inv.parent_ref === null && inv.fallback_ref === null) {
    collector.add(pointerJoin(at, "parent_ref"), "a judge names the dialogue it decides or the panel it breaks a tie for");
  }
  if (inv.retry_of !== null) {
    const original = Number.isInteger(inv.retry_of) && inv.retry_of >= 1 && inv.retry_of < inv.seq ? ctx.bySeq.get(inv.retry_of) : undefined;
    if (original === undefined) collector.add(pointerJoin(at, "retry_of"), "must be the seq of an earlier invocation");
    else {
      for (const key of ["agent_id", "task_kind", "phase", "purpose", "parent_ref"]) {
        if (original[key] !== inv[key]) collector.add(pointerJoin(at, "retry_of"), `a retry copies ${key} from the call it retries`);
      }
    }
  }
  if (!MODEL_ALIASES.includes(inv.model_requested)) collector.add(pointerJoin(at, "model_requested"), `must be one of ${MODEL_ALIASES.join(", ")}`);
  if (inv.model_passed !== null && inv.model_passed !== inv.model_requested) {
    collector.add(pointerJoin(at, "model_passed"), "must be null (single-model mode) or equal model_requested");
  }
  if (inv.effort_requested !== null && !EFFORT_LEVELS.includes(inv.effort_requested)) {
    collector.add(pointerJoin(at, "effort_requested"), `must be null or one of ${EFFORT_LEVELS.join(", ")}`);
  }
  if (inv.effort_applied !== null && typeof inv.effort_applied !== "boolean") collector.add(pointerJoin(at, "effort_applied"), "must be a boolean or null");
  if (!isNullableString(inv.model_self_report)) collector.add(pointerJoin(at, "model_self_report"), "must be a string or null");
  if (inv.model_observed !== null && !(MODEL_ALIASES.includes(inv.model_observed) || inv.model_observed === "unknown")) {
    collector.add(pointerJoin(at, "model_observed"), "must be null, unknown or a model alias");
  }
  if (inv.outcome === null) {
    ctx.openInvocations += 1;
  } else if (!OUTCOMES.includes(inv.outcome)) {
    collector.add(pointerJoin(at, "outcome"), `must be null or one of ${OUTCOMES.join(", ")}`);
  }
  if (inv.failure_class !== null && !FAILURE_CLASSES.includes(inv.failure_class)) {
    collector.add(pointerJoin(at, "failure_class"), `must be null or one of ${FAILURE_CLASSES.join(", ")}`);
  }
  if (inv.outcome === "ok" && inv.failure_class !== null) collector.add(pointerJoin(at, "failure_class"), "an ok call has no failure class");
  if (inv.outcome === "failed" && inv.failure_class === null) collector.add(pointerJoin(at, "failure_class"), "a failed call needs its failure class");
  if (inv.outcome === "refused_concurrency" && inv.failure_class !== "concurrency_limit") {
    collector.add(pointerJoin(at, "failure_class"), 'a refused_concurrency call has failure_class "concurrency_limit"');
  }
  const refused = inv.outcome === "refused_concurrency" || inv.outcome === "refused_resume";
  if (typeof inv.counts_against_cap !== "boolean") collector.add(pointerJoin(at, "counts_against_cap"), "must be a boolean");
  else if (inv.counts_against_cap === refused) {
    collector.add(pointerJoin(at, "counts_against_cap"), refused
      ? "a call the host refused never started and does not count"
      : "every call that started counts against the cap");
  }
  if (inv.outcome === "refused_resume" && inv.kind !== "resume") collector.add(pointerJoin(at, "outcome"), "refused_resume applies to a resume");
  if (!hasVisibleContent(inv.started_at)) collector.add(pointerJoin(at, "started_at"), "must be an ISO-8601 time");
  if (inv.finished_at !== null && !hasVisibleContent(inv.finished_at)) collector.add(pointerJoin(at, "finished_at"), "must be null or an ISO-8601 time");
  if (inv.outcome !== null && inv.finished_at === null) collector.add(pointerJoin(at, "finished_at"), "a completed call has finished_at");
  if (inv.counts_against_cap === true) {
    ctx.spent += 1;
    const cap = ctx.capAt(inv.seq);
    if (Number.isInteger(cap) && ctx.spent > cap) {
      collector.add(at, `call ${ctx.spent} passes the cap in force (${cap}) without an owner override`);
    }
    const key = orchestrate.breakdownKeyFor(inv, ctx.fallbackObjects, ctx.scope);
    if (key === null) collector.add(at, "fits no agents_breakdown key (ORCHESTRATION.md 8.2): fix the log");
    else ctx.breakdown[key] = (ctx.breakdown[key] || 0) + 1;
  }
}

function checkEscalations(log, ctx, collector) {
  if (!Array.isArray(log.escalations)) {
    collector.add("/escalations", "must be an array");
    return;
  }
  log.escalations.forEach((entry, index) => {
    const at = pointerJoin("/escalations", index);
    if (!isPlainObject(entry)) {
      collector.add(at, "must be an escalation object");
      return;
    }
    checkExactKeys(entry, ESCALATION_KEYS, at, collector);
    checkAbout(entry.about, pointerJoin(at, "about"), collector);
    if (entry.mode !== "tier" && entry.mode !== "second_opinion") collector.add(pointerJoin(at, "mode"), 'must be "tier" or "second_opinion"');
    if (!ctx.agentIds.has(entry.from_agent)) collector.add(pointerJoin(at, "from_agent"), "must be an agent of this log");
    for (const key of ["from_model", "to_model_wanted"]) {
      if (!MODEL_ALIASES.includes(entry[key])) collector.add(pointerJoin(at, key), `must be one of ${MODEL_ALIASES.join(", ")}`);
    }
    if (entry.to_model_used !== null && !MODEL_ALIASES.includes(entry.to_model_used)) {
      collector.add(pointerJoin(at, "to_model_used"), "must be null or a model alias");
    }
    if (entry.mode === "tier" && MODEL_ALIASES.includes(entry.from_model) && MODEL_ALIASES.includes(entry.to_model_wanted) &&
        !orchestrate.tierAbove(entry.to_model_wanted, entry.from_model)) {
      collector.add(pointerJoin(at, "to_model_wanted"), "a tier escalation wants a tier above from_model");
    }
    if (entry.mode === "second_opinion" && entry.to_model_wanted !== entry.from_model) {
      collector.add(pointerJoin(at, "to_model_wanted"), "a second opinion stays on the same model");
    }
    if (entry.to_model_used !== entry.to_model_wanted && entry.fallback_ref === null) {
      collector.add(pointerJoin(at, "fallback_ref"), "is required when to_model_used differs from to_model_wanted");
    }
    if (entry.fallback_ref !== null && !ctx.fallbacks.has(entry.fallback_ref)) {
      collector.add(pointerJoin(at, "fallback_ref"), "must name a fallback of this log");
    }
    if (!ESCALATION_TRIGGERS.includes(entry.trigger)) collector.add(pointerJoin(at, "trigger"), `must be one of ${ESCALATION_TRIGGERS.join(", ")}`);
    if (!Array.isArray(entry.new_agents)) collector.add(pointerJoin(at, "new_agents"), "must be an array");
    else {
      entry.new_agents.forEach((agent, position) => {
        if (!ctx.agentIds.has(agent)) collector.add(pointerJoin(pointerJoin(at, "new_agents"), position), "must be an agent of this log");
      });
    }
    if (!FUNDED_FROM.includes(entry.funded_from)) collector.add(pointerJoin(at, "funded_from"), `must be one of ${FUNDED_FROM.join(", ")}`);
    if (!isNonNegativeInteger(entry.worst_case)) collector.add(pointerJoin(at, "worst_case"), "must be a non-negative integer");
    if (entry.reserve_before !== null && !isNonNegativeInteger(entry.reserve_before)) collector.add(pointerJoin(at, "reserve_before"), "must be a non-negative integer or null");
    if (!ESCALATION_OUTCOMES.includes(entry.outcome)) collector.add(pointerJoin(at, "outcome"), `must be one of ${ESCALATION_OUTCOMES.join(", ")}`);
    if (entry.outcome === "open") ctx.openItems.push(`${at} (${quote(entry.id)})`);
    if (entry.outcome === "not_funded" && Array.isArray(entry.new_agents) && entry.new_agents.length > 0) {
      collector.add(pointerJoin(at, "new_agents"), "a not_funded escalation launched nothing");
    }
    const used = ctx.byParent.get(entry.id) || 0;
    if (entry.outcome === "not_funded" && used > 0) collector.add(at, "a not_funded escalation has no invocations");
    if (isNonNegativeInteger(entry.worst_case) && used > entry.worst_case) {
      collector.add(pointerJoin(at, "worst_case"), `${used} invocations name this escalation, more than its worst case`);
    }
  });
}

function checkDialogues(log, ctx, collector) {
  if (!Array.isArray(log.dialogues)) {
    collector.add("/dialogues", "must be an array");
    return;
  }
  if (ctx.scope === "fix" && log.dialogues.length > 0) collector.add("/dialogues", "fix mode opens no dialogues");
  log.dialogues.forEach((entry, index) => {
    const at = pointerJoin("/dialogues", index);
    if (!isPlainObject(entry)) {
      collector.add(at, "must be a dialogue object");
      return;
    }
    checkExactKeys(entry, DIALOGUE_KEYS, at, collector);
    checkAbout(entry.about, pointerJoin(at, "about"), collector);
    if (!ctx.agentIds.has(entry.requested_by)) collector.add(pointerJoin(at, "requested_by"), "must be an agent of this log");
    if (typeof entry.lens_needed !== "string" || !/^[A-Z][A-Z-]*\.md(#.+)?$/.test(entry.lens_needed)) {
      collector.add(pointerJoin(at, "lens_needed"), "must be a companion file or a block ref");
    }
    if (typeof entry.blocking !== "boolean") collector.add(pointerJoin(at, "blocking"), "must be a boolean");
    if (!isIntegerIn(entry.max_rounds, 1, 3)) collector.add(pointerJoin(at, "max_rounds"), "must be an integer from 1 to 3");
    if (!isNonNegativeInteger(entry.worst_case)) collector.add(pointerJoin(at, "worst_case"), "must be a non-negative integer");
    if (entry.reserve_before !== null && !isNonNegativeInteger(entry.reserve_before)) collector.add(pointerJoin(at, "reserve_before"), "must be a non-negative integer or null");
    if (!DIALOGUE_OUTCOMES.includes(entry.outcome)) collector.add(pointerJoin(at, "outcome"), `must be one of ${DIALOGUE_OUTCOMES.join(", ")}`);
    if (entry.outcome === "open") ctx.openItems.push(`${at} (${quote(entry.id)})`);
    if (entry.judge_route_mode !== null && !ROUTE_MODES.includes(entry.judge_route_mode)) {
      collector.add(pointerJoin(at, "judge_route_mode"), `must be null or one of ${ROUTE_MODES.join(", ")}`);
    }
    if (entry.judge_route_mode === "none" && entry.outcome !== "judged_neither") {
      collector.add(pointerJoin(at, "judge_route_mode"), '"none" closes the dialogue as judged_neither');
    }
    if (entry.judge_fallback_ref !== null && !ctx.fallbacks.has(entry.judge_fallback_ref)) {
      collector.add(pointerJoin(at, "judge_fallback_ref"), "must name a fallback of this log");
    }
    if (entry.peer !== null && !ctx.agentIds.has(entry.peer)) collector.add(pointerJoin(at, "peer"), "must be null or an agent of this log");
    if (entry.judge !== null && !ctx.agentIds.has(entry.judge)) collector.add(pointerJoin(at, "judge"), "must be null or an agent of this log");
    if (!Array.isArray(entry.rounds)) collector.add(pointerJoin(at, "rounds"), "must be an array");
    else if (isIntegerIn(entry.max_rounds, 1, 3) && entry.rounds.length > entry.max_rounds) {
      collector.add(pointerJoin(at, "rounds"), "has more rounds than max_rounds");
    }
    if (entry.outcome === "agreed" && entry.agreed_by !== "peer" && entry.agreed_by !== "requester") {
      collector.add(pointerJoin(at, "agreed_by"), 'an agreed dialogue says who agreed: "peer" or "requester"');
    }
    if (entry.outcome !== "agreed" && entry.agreed_by !== null) collector.add(pointerJoin(at, "agreed_by"), "is null unless the dialogue agreed");
    if (entry.outcome === "judged_peer" && !JUDGE_EFFECTS.includes(entry.judge_effect)) {
      collector.add(pointerJoin(at, "judge_effect"), `a ruling for the peer has an effect: ${JUDGE_EFFECTS.join(", ")}`);
    }
    if (["judged_requester", "judged_peer"].includes(entry.outcome) && entry.judge === null) {
      collector.add(pointerJoin(at, "judge"), "a judged dialogue names its judge");
    }
    if (entry.outcome === "cancelled_budget") {
      if (entry.invocations !== 0) collector.add(pointerJoin(at, "invocations"), "a cancelled_budget consult spent nothing");
      if (Array.isArray(entry.rounds) && entry.rounds.length > 0) collector.add(pointerJoin(at, "rounds"), "a cancelled_budget consult has no rounds");
    }
    if (!hasVisibleContent(entry.summary) || codePointCount(entry.summary) > SUMMARY_MAX_CHARS) {
      collector.add(pointerJoin(at, "summary"), `must be visible text of at most ${SUMMARY_MAX_CHARS} characters`);
    }
    const used = ctx.byParent.get(entry.id) || 0;
    if (entry.invocations !== used) {
      collector.add(pointerJoin(at, "invocations"), `must equal the ${used} counted invocations that name ${quote(entry.id)}`);
    }
    if (isNonNegativeInteger(entry.worst_case) && used > entry.worst_case) {
      collector.add(pointerJoin(at, "worst_case"), "more invocations than the earmarked worst case");
    }
  });
}

function checkFallbacks(log, ctx, collector) {
  if (!Array.isArray(log.fallbacks)) {
    collector.add("/fallbacks", "must be an array");
    return;
  }
  log.fallbacks.forEach((entry, index) => {
    const at = pointerJoin("/fallbacks", index);
    if (!isPlainObject(entry)) {
      collector.add(at, "must be a fallback object");
      return;
    }
    checkExactKeys(entry, FALLBACK_KEYS, at, collector);
    if (!hasOwn(orchestrate.ROUTING_TABLE, entry.task_kind)) collector.add(pointerJoin(at, "task_kind"), "is not a task kind");
    if (!MODEL_ALIASES.includes(entry.wanted)) collector.add(pointerJoin(at, "wanted"), "must be a model alias");
    if (entry.used !== null && !MODEL_ALIASES.includes(entry.used)) collector.add(pointerJoin(at, "used"), "must be null or a model alias");
    if (entry.effort !== null && !EFFORT_LEVELS.includes(entry.effort)) collector.add(pointerJoin(at, "effort"), "must be null or an effort level");
    if (!ROUTE_MODES.includes(entry.mode)) collector.add(pointerJoin(at, "mode"), `must be one of ${ROUTE_MODES.join(", ")}`);
    if (entry.mode === "none" && entry.used !== null) collector.add(pointerJoin(at, "used"), 'mode "none" runs no model');
    if (!FALLBACK_REASONS.includes(entry.reason)) collector.add(pointerJoin(at, "reason"), `must be one of ${FALLBACK_REASONS.join(", ")}`);
    if (!FUNDED_FROM.includes(entry.funded_from)) collector.add(pointerJoin(at, "funded_from"), `must be one of ${FUNDED_FROM.join(", ")}`);
    if (!isNonNegativeInteger(entry.worst_case)) collector.add(pointerJoin(at, "worst_case"), "must be a non-negative integer");
    else if (ROUTE_MODES.includes(entry.mode) && entry.worst_case < orchestrate.panelWorstCase(entry.mode, entry.task_kind) && entry.outcome !== "not_funded") {
      collector.add(pointerJoin(at, "worst_case"), `is below the worst case of mode ${entry.mode} (${orchestrate.panelWorstCase(entry.mode, entry.task_kind)})`);
    }
    if (entry.reserve_before !== null && !isNonNegativeInteger(entry.reserve_before)) collector.add(pointerJoin(at, "reserve_before"), "must be a non-negative integer or null");
    if (entry.funded_from === "orchestration_reserve" && entry.reserve_before === null) {
      collector.add(pointerJoin(at, "reserve_before"), "a reserve-funded fallback records the reserve before its earmark");
    }
    if (ctx.scope === "fix" && FIX_TASK_KINDS_FIXERS.includes(entry.task_kind) && entry.mode !== "single" && entry.mode !== "none") {
      collector.add(pointerJoin(at, "mode"), "fixers never run as panels");
    }
    if (!FALLBACK_OUTCOMES.includes(entry.outcome)) collector.add(pointerJoin(at, "outcome"), `must be one of ${FALLBACK_OUTCOMES.join(", ")}`);
    if (entry.outcome === "open") ctx.openItems.push(`${at} (${quote(entry.id)})`);
    const members = ctx.byFallback.get(entry.id) || { agents: new Set(), invocations: 0 };
    if (!Array.isArray(entry.agents)) collector.add(pointerJoin(at, "agents"), "must be an array");
    else {
      const listed = new Set(entry.agents);
      for (const agent of members.agents) if (!listed.has(agent)) collector.add(pointerJoin(at, "agents"), `misses ${quote(agent)}, which names this fallback`);
      for (const agent of listed) if (!members.agents.has(agent)) collector.add(pointerJoin(at, "agents"), `${quote(agent)} has no invocation naming this fallback`);
    }
    if (entry.invocations !== members.invocations) {
      collector.add(pointerJoin(at, "invocations"), `must equal the ${members.invocations} counted invocations that name ${quote(entry.id)}`);
    }
    if (entry.outcome === "not_funded" && members.invocations > 0) collector.add(at, "a not_funded fallback has no invocations");
    if (entry.narrowed_to !== null && !hasVisibleContent(entry.narrowed_to)) collector.add(pointerJoin(at, "narrowed_to"), "must be null or text");
    if (entry.about !== null) checkAbout(entry.about, pointerJoin(at, "about"), collector);
  });
}
const FIX_TASK_KINDS_FIXERS = orchestrate.FIXER_TASK_KINDS;

function checkAvailability(log, collector) {
  const value = log.model_availability;
  if (!isPlainObject(value)) {
    collector.add("/model_availability", `must be an object with ${MODEL_ALIASES.join(", ")}`);
    return;
  }
  checkExactKeys(value, MODEL_ALIASES, "/model_availability", collector);
  for (const alias of MODEL_ALIASES) {
    const entry = value[alias];
    const at = pointerJoin("/model_availability", alias);
    if (!isPlainObject(entry)) continue;
    checkExactKeys(entry, AVAILABILITY_KEYS, at, collector);
    if (!MODEL_DECLARED.includes(entry.declared)) collector.add(pointerJoin(at, "declared"), `must be one of ${MODEL_DECLARED.join(", ")}`);
    if (!MODEL_OBSERVED.includes(entry.observed)) collector.add(pointerJoin(at, "observed"), `must be one of ${MODEL_OBSERVED.join(", ")}`);
    if (entry.first_evidence_seq !== null && !isPositiveInteger(entry.first_evidence_seq)) {
      collector.add(pointerJoin(at, "first_evidence_seq"), "must be a positive integer or null");
    }
    if (!Array.isArray(entry.resets)) collector.add(pointerJoin(at, "resets"), "must be an array");
  }
}

function checkUncovered(log, collector) {
  if (!Array.isArray(log.uncovered_by_cap)) {
    collector.add("/uncovered_by_cap", "must be an array");
    return;
  }
  log.uncovered_by_cap.forEach((entry, index) => {
    const at = pointerJoin("/uncovered_by_cap", index);
    if (!isPlainObject(entry) || Object.keys(entry).length !== 3 || !UNCOVERED_KINDS.includes(entry.kind) ||
        !hasVisibleContent(entry.ref) || typeof entry.reason_code !== "string" || !/^[a-z][a-z0-9_]*(: .+)?$/s.test(entry.reason_code)) {
      collector.add(at, `must be {kind, ref, reason_code} with kind one of ${UNCOVERED_KINDS.join(", ")}`);
    }
  });
}

function runAgentLog(log, collector, options = {}) {
  if (!isPlainObject(log)) {
    collector.add("", "an agent log must be a JSON object");
    return null;
  }
  checkExactKeys(log, AGENT_LOG_KEYS, "", collector);
  if (log.schema !== AGENT_LOG_SCHEMA) collector.add("/schema", `must be ${quote(AGENT_LOG_SCHEMA)}`);
  const scope = log.scope === "fix" ? "fix" : "audit";
  if (log.scope !== "audit" && log.scope !== "fix") collector.add("/scope", 'must be "audit" or "fix"');
  if (!hasVisibleContent(log.run_id)) collector.add("/run_id", "must be the run id");
  if (scope === "audit" && log.fix_run_id !== null) collector.add("/fix_run_id", "must be null in an audit log");
  if (scope === "fix" && !(typeof log.fix_run_id === "string" && /^fix-[0-9]+$/.test(log.fix_run_id))) collector.add("/fix_run_id", "must be fix-<N> in a fix log");
  if (!orchestrate.PROFILES.includes(log.profile)) collector.add("/profile", `must be one of ${orchestrate.PROFILES.join(", ")}`);
  if (!isPositiveInteger(log.cap) || log.cap > AGENT_CAP_MAX) collector.add("/cap", `must be an integer from 1 to ${AGENT_CAP_MAX}`);
  const reserveKeys = scope === "fix" ? FIX_RESERVE_KEYS : AUDIT_RESERVE_KEYS;
  if (!isPlainObject(log.reserve)) collector.add("/reserve", `must be an object with ${reserveKeys.join(", ")}`);
  else {
    checkExactKeys(log.reserve, reserveKeys, "/reserve", collector, scope === "fix" ? [...FIX_RESERVE_OPTIONAL, "total"] : ["total"]);
    for (const [key, value] of Object.entries(log.reserve)) {
      if (!isNonNegativeInteger(value)) collector.add(pointerJoin("/reserve", key), "must be a non-negative integer");
    }
  }
  const ctx = {
    scope,
    launched: new Set(),
    agentIds: new Set(),
    bySeq: new Map(),
    byParent: new Map(),
    byFallback: new Map(),
    itemIds: new Set(),
    fallbacks: new Set(),
    fallbackObjects: {},
    breakdown: {},
    spent: 0,
    openInvocations: 0,
    openItems: [],
    capAt: capTimeline(log, collector),
  };
  const collectIds = (list, pattern, target, pointer) => {
    if (!Array.isArray(list)) return;
    list.forEach((entry, index) => {
      if (!isPlainObject(entry)) return;
      if (typeof entry.id !== "string" || !pattern.test(entry.id)) collector.add(pointerJoin(pointerJoin(pointer, index), "id"), `must match ${pattern}`);
      else if (target.has(entry.id) || ctx.itemIds.has(entry.id)) collector.add(pointerJoin(pointerJoin(pointer, index), "id"), "duplicate id");
      else target.add(entry.id);
    });
  };
  collectIds(log.dialogues, ITEM_ID.dialogue, ctx.itemIds, "/dialogues");
  collectIds(log.escalations, ITEM_ID.escalation, ctx.itemIds, "/escalations");
  collectIds(log.fallbacks, ITEM_ID.fallback, ctx.fallbacks, "/fallbacks");
  if (Array.isArray(log.fallbacks)) for (const entry of log.fallbacks) if (isPlainObject(entry) && typeof entry.id === "string") ctx.fallbackObjects[entry.id] = entry;
  if (!Array.isArray(log.invocations)) collector.add("/invocations", "must be an array");
  else {
    log.invocations.forEach((inv, index) => {
      checkInvocation(inv, index, ctx, collector);
      if (!isPlainObject(inv)) return;
      ctx.bySeq.set(inv.seq, inv);
      if (typeof inv.agent_id === "string") ctx.agentIds.add(inv.agent_id);
      if (inv.counts_against_cap === true) {
        if (typeof inv.parent_ref === "string") ctx.byParent.set(inv.parent_ref, (ctx.byParent.get(inv.parent_ref) || 0) + 1);
        if (typeof inv.fallback_ref === "string") {
          const entry = ctx.byFallback.get(inv.fallback_ref) || { agents: new Set(), invocations: 0 };
          entry.agents.add(inv.agent_id);
          entry.invocations += 1;
          ctx.byFallback.set(inv.fallback_ref, entry);
        }
      }
    });
  }
  checkEscalations(log, ctx, collector);
  checkDialogues(log, ctx, collector);
  checkFallbacks(log, ctx, collector);
  checkAvailability(log, collector);
  checkUncovered(log, collector);
  if (log.spent !== ctx.spent) collector.add("/spent", `must equal the ${ctx.spent} invocations that count against the cap`);
  const metadata = options.metadata;
  const runStatus = isPlainObject(metadata) ? metadata.run_status : options.runStatus;
  if (runStatus !== undefined && runStatus !== "in_progress") {
    if (ctx.openInvocations > 0) collector.add("/invocations", `${ctx.openInvocations} invocation(s) still have outcome null in a ${quote(runStatus)} run`);
    for (const item of ctx.openItems) collector.add(item, `is still open in a ${quote(runStatus)} run`);
  }
  if (isPlainObject(metadata) && scope === "audit") checkAgainstMetadata(log, ctx, metadata, collector);
  return ctx;
}

function checkAgainstMetadata(log, ctx, meta, collector) {
  const at = (path) => `metadata:${path}`;
  if (meta.run_id !== log.run_id) collector.add(at("/run_id"), "must equal the agent log's run_id");
  if (meta.profile !== log.profile) collector.add(at("/profile"), "must equal the agent log's profile");
  if (meta.budget !== log.cap) collector.add(at("/budget"), `must equal the agent log's cap (${quote(log.cap)})`);
  if (meta.agents_spent !== log.spent) collector.add(at("/agents_spent"), `must equal the agent log's spent (${quote(log.spent)})`);
  const o = isPlainObject(meta.orchestration) ? meta.orchestration : {};
  if (isPlainObject(o.reserve) && isPlainObject(log.reserve)) {
    for (const key of AUDIT_RESERVE_KEYS) {
      if (o.reserve[key] !== log.reserve[key]) collector.add(at(`/orchestration/reserve/${key}`), "must equal the agent log's reserve");
    }
  }
  const breakdown = isPlainObject(meta.agents_breakdown) ? meta.agents_breakdown : null;
  if (breakdown !== null) {
    for (const key of AUDIT_BREAKDOWN_KEYS) {
      const counted = ctx.breakdown[key] || 0;
      if (breakdown[key] !== counted) collector.add(at(`/agents_breakdown/${key}`), `must be ${counted}, the count of logged invocations mapped to it`);
    }
    if (Number.isInteger(log.cap) && breakdown.unspent !== log.cap - ctx.spent) {
      collector.add(at("/agents_breakdown/unspent"), `must be cap - spent = ${log.cap - ctx.spent}`);
    }
  }
  if (isPlainObject(o.models) && isPlainObject(log.model_availability)) {
    for (const alias of MODEL_ALIASES) {
      const a = o.models[alias];
      const b = log.model_availability[alias];
      if (!isPlainObject(a) || !isPlainObject(b)) continue;
      for (const key of ["declared", "observed", "first_evidence_seq"]) {
        if (a[key] !== b[key]) collector.add(at(`/orchestration/models/${alias}/${key}`), "must equal the agent log's model_availability");
      }
    }
  }
}

const DELIBERATION_TO_LOG = Object.freeze({
  consult: { list: "dialogues", outcomes: { agreed: ["agreed"], judged_requester: ["judged_requester"], judged_peer: ["judged_peer"], judged_neither: ["judged_neither"], cancelled_budget: ["cancelled_budget"], cancelled_pause: ["cancelled_pause"] } },
  judge: { list: "dialogues", outcomes: { judged_requester: ["judged_requester"], judged_peer: ["judged_peer"], judged_neither: ["judged_neither"], cancelled_pause: ["cancelled_pause"] } },
  escalation: { list: "escalations", outcomes: { escalation_resolved: ["resolved"], escalation_unresolved: ["still_unsure"], escalation_not_funded: ["not_funded"], cancelled_pause: ["cancelled_pause"] } },
  fallback_panel: { list: "fallbacks", outcomes: { panel_agreed: ["agreed", "single_ok"], panel_judged: ["judged"], panel_majority: ["majority"], panel_split: ["split"], panel_not_funded: ["not_funded"], cancelled_pause: ["cancelled_pause"] } },
});

function checkAgainstFindings(log, findings, collector) {
  if (!Array.isArray(findings)) {
    collector.add("findings:", "must be an array");
    return;
  }
  const byId = {};
  for (const list of ["dialogues", "escalations", "fallbacks"]) {
    if (!Array.isArray(log[list])) continue;
    for (const entry of log[list]) if (isPlainObject(entry) && typeof entry.id === "string") byId[entry.id] = { list, entry };
  }
  findings.forEach((record, index) => {
    if (!isPlainObject(record) || !Array.isArray(record.deliberation)) return;
    record.deliberation.forEach((item, position) => {
      const at = `findings:/${index}/deliberation/${position}`;
      if (!isPlainObject(item)) return;
      const rule = DELIBERATION_TO_LOG[item.kind];
      const found = byId[item.id];
      if (!rule) return;
      if (!found || found.list !== rule.list) {
        collector.add(at, `${quote(item.id)} is not a ${rule.list.slice(0, -1)} of the agent log`);
        return;
      }
      const allowed = rule.outcomes[item.outcome];
      if (allowed && !allowed.includes(found.entry.outcome)) {
        collector.add(at, `outcome ${quote(item.outcome)} does not match the log's ${quote(found.entry.outcome)}`);
      }
    });
  });
}

function checkAgainstLedger(log, ledger, collector) {
  if (!Array.isArray(ledger)) {
    collector.add("ledger:", "must be an array");
    return;
  }
  const ids = new Set(ledger.filter(isPlainObject).map((unit) => unit.coverage_id));
  const check = (about, pointer) => {
    if (isPlainObject(about) && about.kind === "unit" && !ids.has(about.ref)) collector.add(pointer, "names a unit that is not in the coverage ledger");
  };
  for (const list of ["escalations", "dialogues", "fallbacks"]) {
    if (!Array.isArray(log[list])) continue;
    log[list].forEach((entry, index) => { if (isPlainObject(entry)) check(entry.about, `/${list}/${index}/about`); });
  }
  if (Array.isArray(log.uncovered_by_cap)) {
    log.uncovered_by_cap.forEach((entry, index) => {
      if (isPlainObject(entry) && entry.kind === "unit") check({ kind: "unit", ref: entry.ref }, `/uncovered_by_cap/${index}/ref`);
    });
  }
}

const FINGERPRINT_LISTS = Object.freeze(["hunters", "candidate_verifiers", "record_verifiers", "replacement_verifiers", "consultants", "judges"]);

function checkFingerprintAgents(log, ctx, map, findings, collector) {
  if (!isPlainObject(map)) {
    collector.add("fingerprints:", "must be an object");
    return;
  }
  const quick = log.profile === "quick";
  // Outside quick, a Phase 3 verifier may also close the record (fill record_verifiers) unless the
  // record is high or blocker, which needs a separate Phase 5 agent (VALIDATION-AND-REPORTING.md 4.1).
  const severe = new Set();
  if (Array.isArray(findings)) {
    for (const record of findings) {
      const overall = isPlainObject(record) && isPlainObject(record.severity) ? record.severity.overall : null;
      if (overall === "high" || overall === "blocker") severe.add(record.fingerprint);
    }
  }
  const mergeAllowed = (fingerprint) => quick || (Array.isArray(findings) && !severe.has(fingerprint));
  const merged = new Set();
  for (const [key, entry] of Object.entries(map)) {
    if (key === "by_unit" || !isPlainObject(entry) || !mergeAllowed(key)) continue;
    const candidates = Array.isArray(entry.candidate_verifiers) ? entry.candidate_verifiers : [];
    const records = Array.isArray(entry.record_verifiers) ? entry.record_verifiers : [];
    for (const agent of candidates) if (records.includes(agent)) merged.add(agent);
  }
  const checkEntry = (entry, pointer, fingerprint) => {
    if (!isPlainObject(entry)) {
      collector.add(pointer, `must be {${FINGERPRINT_LISTS.join(", ")}}`);
      return;
    }
    const seen = new Map();
    for (const list of FINGERPRINT_LISTS) {
      const value = entry[list];
      if (!Array.isArray(value)) {
        collector.add(pointerJoin(pointer, list), "must be an array");
        continue;
      }
      value.forEach((agent, index) => {
        if (!ctx.agentIds.has(agent)) collector.add(pointerJoin(pointerJoin(pointer, list), index), `${quote(agent)} is not an agent of the log`);
        const earlier = seen.get(agent);
        const pair = earlier === "candidate_verifiers" && list === "record_verifiers";
        const mergedPair = pair && (fingerprint === null ? merged.has(agent) : mergeAllowed(fingerprint));
        if (earlier !== undefined && !mergedPair) {
          collector.add(pointerJoin(pointerJoin(pointer, list), index), `${quote(agent)} is also in ${earlier}: verification must be independent`);
        }
        if (earlier === undefined) seen.set(agent, list);
      });
    }
  };
  for (const [key, entry] of Object.entries(map)) {
    if (key === "by_unit") {
      if (!isPlainObject(entry)) collector.add("fingerprints:/by_unit", "must be an object");
      else for (const [unit, value] of Object.entries(entry)) checkEntry(value, `fingerprints:/by_unit/${unit}`, null);
      continue;
    }
    checkEntry(entry, `fingerprints:/${key}`, key);
  }
  if (!Array.isArray(findings)) return;
  findings.forEach((record, index) => {
    if (!isPlainObject(record) || record.verdict !== "confirmed") return;
    const entry = map[record.fingerprint];
    const verifiers = isPlainObject(entry) && Array.isArray(entry.candidate_verifiers) ? entry.candidate_verifiers : [];
    const hunters = isPlainObject(entry) && Array.isArray(entry.hunters) ? new Set(entry.hunters) : new Set();
    if (!verifiers.some((agent) => !hunters.has(agent))) {
      collector.add(`findings:/${index}`, "a confirmed record needs an independent candidate verifier in fingerprint-agents.json");
    }
  });
}

// ---- fix log ----

const FIX_LOG_KEYS = Object.freeze([
  "schema", "run_id", "fix_run_id", "status", "agent_log", "cap", "spent", "agents_breakdown", "approved_selection_at",
  "approved_selection_text", "hooks", "tracked_env_files", "permission_guard", "prep_network", "push_approval", "git_rules", "fixes",
]);
const FIX_SESSION_STATUSES = Object.freeze(["in_progress", "awaiting_approval", "complete", "incomplete"]);
const FIX_STATUSES = Object.freeze(["planned", "in_progress", "checks_failed", "reverify_failed", "ready", "pr_opened", "abandoned"]);
const FIX_CLASSES = Object.freeze({ mechanical: "fix_mechanical", logic: "fix_logic", business_rule: "fix_business" });
const HOOK_MODES = Object.freeze(["none", "host_with_consent", "sandbox_commit"]);
const PRE_PUSH_MODES = Object.freeze(["sandbox_equivalent", "owner_terminal"]);
const PR_STATES = Object.freeze(["none", "proposed", "approved", "opened", "declined"]);
const REVERIFY_RESULTS = Object.freeze(["fixed", "not_fixed", "regressed", "inconclusive"]);
const ATTRIBUTION_POLICIES = Object.freeze(["forbidden", "required", "unspecified"]);
const TEST_POLICIES = Object.freeze(["regression_test_first", "tests_required", "unspecified"]);
const SHA = /^[0-9a-f]{40}$/;
// Lines that attribute a commit or a pull request to a tool or an assistant.
const ATTRIBUTION_LINE = /^\s*(co-authored-by:|generated[ -]with\b|generated by\b|\u{1F916})/imu;

function checkFixLog(log, collector, options = {}) {
  if (!isPlainObject(log)) {
    collector.add("", "a fix log must be a JSON object");
    return;
  }
  checkExactKeys(log, FIX_LOG_KEYS, "", collector);
  if (log.schema !== FIX_LOG_SCHEMA) collector.add("/schema", `must be ${quote(FIX_LOG_SCHEMA)}`);
  if (!hasVisibleContent(log.run_id)) collector.add("/run_id", "must be the audit run id");
  if (!(typeof log.fix_run_id === "string" && /^fix-[0-9]+$/.test(log.fix_run_id))) collector.add("/fix_run_id", "must be fix-<N>");
  if (!FIX_SESSION_STATUSES.includes(log.status)) collector.add("/status", `must be one of ${FIX_SESSION_STATUSES.join(", ")}`);
  if (log.agent_log !== "fix/agent-log.json") collector.add("/agent_log", 'must be "fix/agent-log.json"');
  if (!isIntegerIn(log.cap, 4, 200)) collector.add("/cap", "must be an integer from 4 to 200");
  if (!isNonNegativeInteger(log.spent)) collector.add("/spent", "must be a non-negative integer");
  const breakdown = log.agents_breakdown;
  if (!isPlainObject(breakdown)) collector.add("/agents_breakdown", `must be an object with ${[...FIX_BREAKDOWN_KEYS, "unspent"].join(", ")}`);
  else {
    checkExactKeys(breakdown, [...FIX_BREAKDOWN_KEYS, "unspent"], "/agents_breakdown", collector, FIX_BREAKDOWN_OPTIONAL);
    const values = Object.values(breakdown);
    if (values.every(isNonNegativeInteger)) {
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== log.cap) collector.add("/agents_breakdown", `sums to ${sum}; it must equal cap ${quote(log.cap)}`);
      if (log.cap - breakdown.unspent !== log.spent) collector.add("/agents_breakdown/unspent", "cap - unspent must equal spent");
    } else collector.add("/agents_breakdown", "every value must be a non-negative integer");
  }
  if (!isNullableString(log.approved_selection_at) || !isNullableString(log.approved_selection_text)) {
    collector.add("/approved_selection_at", "the A1 approval is a time and the owner's words, or null before gate A1");
  }
  if (log.status !== "in_progress" && !hasVisibleContent(log.approved_selection_text)) {
    collector.add("/approved_selection_text", "a fix session past F0 quotes the owner's A1 approval");
  }
  const hooks = log.hooks;
  if (!isPlainObject(hooks)) collector.add("/hooks", "must be {detected, mode, approved_text, pre_push?}");
  else {
    checkExactKeys(hooks, ["detected", "mode", "approved_text"], "/hooks", collector, ["pre_push"]);
    if (!Array.isArray(hooks.detected)) collector.add("/hooks/detected", "must be an array");
    if (!HOOK_MODES.includes(hooks.mode)) collector.add("/hooks/mode", `must be one of ${HOOK_MODES.join(", ")}`);
    if (Array.isArray(hooks.detected) && hooks.detected.length === 0 && hooks.mode !== "none") collector.add("/hooks/mode", 'with no hooks detected the mode is "none"');
    if (Array.isArray(hooks.detected) && hooks.detected.length > 0 && hooks.mode === "none") collector.add("/hooks/mode", "hooks exist: the owner picks host_with_consent or sandbox_commit");
    if (hooks.mode === "host_with_consent" && !hasVisibleContent(hooks.approved_text)) collector.add("/hooks/approved_text", "host_with_consent quotes the owner's consent");
    if (hasOwn(hooks, "pre_push") && typeof hooks.pre_push !== "boolean") collector.add("/hooks/pre_push", "must be a boolean");
  }
  if (!Array.isArray(log.tracked_env_files) || !log.tracked_env_files.every((name) => typeof name === "string")) {
    collector.add("/tracked_env_files", "must be an array of file names (never contents)");
  }
  const guard = log.permission_guard;
  if (!isPlainObject(guard) || typeof guard.offered !== "boolean" || typeof guard.accepted !== "boolean") {
    collector.add("/permission_guard", "must be {offered, accepted, file?, rules?, added_at?, removed_at?}");
  } else {
    checkExactKeys(guard, ["offered", "accepted"], "/permission_guard", collector, ["file", "rules", "added_at", "removed_at"]);
    if (hasOwn(guard, "rules") && !(Array.isArray(guard.rules) && guard.rules.every((rule) => typeof rule === "string"))) {
      collector.add("/permission_guard/rules", "must be an array of rule strings");
    }
  }
  if (log.prep_network !== null && !(isPlainObject(log.prep_network) && Array.isArray(log.prep_network.hosts) && hasVisibleContent(log.prep_network.approved_at))) {
    collector.add("/prep_network", "must be null or {approved_at, hosts}");
  }
  const push = log.push_approval;
  if (push !== null) {
    if (!isPlainObject(push) || !hasVisibleContent(push.approved_at) || !hasVisibleContent(push.approved_text)) {
      collector.add("/push_approval", "must be null or carry approved_at and the owner's words in approved_text");
    } else if (hasOwn(push, "pre_push_mode") && push.pre_push_mode !== null && !PRE_PUSH_MODES.includes(push.pre_push_mode)) {
      collector.add("/push_approval/pre_push_mode", `must be one of ${PRE_PUSH_MODES.join(", ")}`);
    }
  }
  const rules = log.git_rules;
  let protectedBranches = [];
  let attribution = "forbidden";
  if (!isPlainObject(rules)) collector.add("/git_rules", "must be an object");
  else {
    if (!hasVisibleContent(rules.base_branch)) collector.add("/git_rules/base_branch", "must name the base branch");
    if (!Array.isArray(rules.protected_branches)) collector.add("/git_rules/protected_branches", "must be an array");
    else {
      protectedBranches = rules.protected_branches;
      if (!rules.protected_branches.includes(rules.base_branch)) collector.add("/git_rules/protected_branches", "must include base_branch");
    }
    if (!ATTRIBUTION_POLICIES.includes(rules.attribution_trailers)) collector.add("/git_rules/attribution_trailers", `must be one of ${ATTRIBUTION_POLICIES.join(", ")}`);
    else attribution = rules.attribution_trailers;
    if (!TEST_POLICIES.includes(rules.tests_with_fixes)) collector.add("/git_rules/tests_with_fixes", `must be one of ${TEST_POLICIES.join(", ")}`);
    if (!Array.isArray(rules.required_checks)) collector.add("/git_rules/required_checks", "must be an array");
    if (!Array.isArray(rules.sources) || rules.sources.length === 0) collector.add("/git_rules/sources", "must list where each rule came from");
    else {
      rules.sources.forEach((source, index) => {
        if (!isPlainObject(source) || !hasVisibleContent(source.rule) || !hasVisibleContent(source.file) ||
            !(source.line === null || isPositiveInteger(source.line)) || isForbiddenPath(source.file)) {
          collector.add(`/git_rules/sources/${index}`, "must be {rule, file, line} from a rule file (never an environment file)");
        }
      });
    }
  }
  const confirmed = new Set();
  const findingsGiven = Array.isArray(options.findings);
  if (findingsGiven) for (const record of options.findings) if (isPlainObject(record) && record.verdict === "confirmed") confirmed.add(record.fingerprint);
  const agentIds = options.agentCtx ? options.agentCtx.agentIds : null;
  if (!Array.isArray(log.fixes)) {
    collector.add("/fixes", "must be an array");
    return;
  }
  const seen = new Set();
  log.fixes.forEach((fix, index) => {
    const at = `/fixes/${index}`;
    if (!isPlainObject(fix)) {
      collector.add(at, "must be a fix object");
      return;
    }
    if (typeof fix.id !== "string" || !/^fix-[0-9]{2,4}$/.test(fix.id) || seen.has(fix.id)) collector.add(`${at}/id`, "must be a unique fix-NN id");
    seen.add(fix.id);
    if (!Array.isArray(fix.fingerprints) || fix.fingerprints.length === 0) collector.add(`${at}/fingerprints`, "must list the records it fixes");
    else if (findingsGiven) {
      fix.fingerprints.forEach((fingerprint, position) => {
        if (!confirmed.has(fingerprint)) collector.add(`${at}/fingerprints/${position}`, "fix mode fixes only confirmed records");
      });
    }
    if (!hasOwn(FIX_CLASSES, fix.class)) collector.add(`${at}/class`, `must be one of ${Object.keys(FIX_CLASSES).join(", ")}`);
    else if (fix.task_kind !== FIX_CLASSES[fix.class]) collector.add(`${at}/task_kind`, `class ${fix.class} routes as ${FIX_CLASSES[fix.class]}`);
    if (!MODEL_ALIASES.includes(fix.model)) collector.add(`${at}/model`, "must be a model alias");
    if (typeof fix.branch !== "string" || fix.branch.length === 0) collector.add(`${at}/branch`, "must name the fix branch");
    else if (protectedBranches.includes(fix.branch) || (isPlainObject(rules) && fix.branch === rules.base_branch)) {
      collector.add(`${at}/branch`, "a fix never commits to a protected or base branch");
    }
    if (isPlainObject(rules) && fix.base !== rules.base_branch) collector.add(`${at}/base`, "must be git_rules.base_branch");
    if (!(typeof fix.base_commit === "string" && SHA.test(fix.base_commit))) collector.add(`${at}/base_commit`, "must be a 40-hex commit");
    if (!Array.isArray(fix.commits)) collector.add(`${at}/commits`, "must be an array");
    else {
      fix.commits.forEach((commit, position) => {
        const cat = `${at}/commits/${position}`;
        if (!isPlainObject(commit) || !(typeof commit.sha === "string" && SHA.test(commit.sha)) || typeof commit.message !== "string" ||
            !["host", "sandbox"].includes(commit.made_in)) {
          collector.add(cat, "must be {sha (40-hex), message, made_in: host|sandbox}");
          return;
        }
        if (attribution !== "required" && ATTRIBUTION_LINE.test(commit.message)) {
          collector.add(`${cat}/message`, "carries an attribution line the project's rules do not allow");
        }
      });
    }
    const checks = Array.isArray(fix.checks) ? fix.checks : [];
    if (!Array.isArray(fix.checks)) collector.add(`${at}/checks`, "must be an array");
    checks.forEach((check, position) => {
      if (!isPlainObject(check) || !hasVisibleContent(check.name) || !hasVisibleContent(check.command) || !Number.isInteger(check.exit_code)) {
        collector.add(`${at}/checks/${position}`, "must be {name, command, exit_code, log}");
      }
    });
    if (!FIX_STATUSES.includes(fix.status)) collector.add(`${at}/status`, `must be one of ${FIX_STATUSES.join(", ")}`);
    const reverify = isPlainObject(fix.reverify) ? fix.reverify : null;
    if (reverify !== null) {
      if (reverify.agent === fix.fixer_agent) collector.add(`${at}/reverify/agent`, "the fixer never re-verifies its own fix");
      if (!REVERIFY_RESULTS.includes(reverify.result)) collector.add(`${at}/reverify/result`, `must be one of ${REVERIFY_RESULTS.join(", ")}`);
      if (agentIds && typeof reverify.agent === "string" && !agentIds.has(reverify.agent)) collector.add(`${at}/reverify/agent`, "is not an agent of the fix agent log");
    }
    if (agentIds && typeof fix.fixer_agent === "string" && !agentIds.has(fix.fixer_agent)) collector.add(`${at}/fixer_agent`, "is not an agent of the fix agent log");
    const containment = isPlainObject(fix.containment) ? fix.containment : null;
    if (fix.status === "ready" || fix.status === "pr_opened") {
      if (checks.length === 0 || checks.some((check) => !isPlainObject(check) || check.exit_code !== 0)) {
        collector.add(`${at}/status`, `${fix.status} needs every check at exit 0`);
      }
      if (reverify === null || reverify.result !== "fixed") collector.add(`${at}/status`, `${fix.status} needs a fixed re-verification`);
      if (containment === null || containment.checked !== true || containment.violation !== null) collector.add(`${at}/status`, `${fix.status} needs a clean containment check`);
    }
    const pr = isPlainObject(fix.pr) ? fix.pr : null;
    if (pr === null) collector.add(`${at}/pr`, "must be an object");
    else {
      if (!PR_STATES.includes(pr.state)) collector.add(`${at}/pr/state`, `must be one of ${PR_STATES.join(", ")}`);
      if (pr.state === "opened" || pr.state === "approved") {
        if (!hasVisibleContent(pr.approved_at) || !hasVisibleContent(pr.approved_text)) collector.add(`${at}/pr`, "an approved or opened PR quotes the owner's run-time approval");
        if (push === null) collector.add(`${at}/pr`, "an approved or opened PR needs push_approval");
      }
      if (fix.status === "pr_opened" && pr.state !== "opened") collector.add(`${at}/pr/state`, 'status pr_opened needs pr.state "opened"');
      if (typeof pr.body_path === "string" && pr.body_path.length > 0 && !isSafeRelativePath(pr.body_path)) collector.add(`${at}/pr/body_path`, "must be a safe relative path");
    }
    if (!Array.isArray(fix.notes)) collector.add(`${at}/notes`, "must be an array");
  });
  const agentCtx = options.agentCtx;
  if (agentCtx) {
    if (agentCtx.spent !== log.spent) collector.add("/spent", `must equal the fix agent log's spent (${agentCtx.spent})`);
    if (isPlainObject(breakdown)) {
      for (const key of [...FIX_BREAKDOWN_KEYS, ...FIX_BREAKDOWN_OPTIONAL]) {
        const counted = agentCtx.breakdown[key] || 0;
        const recorded = hasOwn(breakdown, key) ? breakdown[key] : 0;
        if (recorded !== counted) collector.add(`/agents_breakdown/${key}`, `must be ${counted}, the count in the fix agent log`);
      }
    }
    if (options.agentLog && options.agentLog.cap !== log.cap) collector.add("/cap", "must equal the fix agent log's cap");
  }
}

// ---- config ----

function checkConfig(config, collector, options = {}) {
  const result = orchestrate.validateConfig(config, { skillDir: options.skillDir ?? __dirname });
  for (const line of result.errors) {
    const split = line.indexOf(": ");
    collector.add(split > 0 ? line.slice(0, split) : "", split > 0 ? line.slice(split + 2) : line);
  }
  return result.warnings;
}

// ---- entry points ----

function runAgentLogValidation(log, options, collector) {
  const violation = dataLimitViolation(log, LIMITS);
  if (violation) {
    collector.add(violation.pointer, violation.message);
    return;
  }
  const ctx = runAgentLog(log, collector, options);
  if (ctx && options.findings !== undefined) checkAgainstFindings(log, options.findings, collector);
  if (ctx && options.ledger !== undefined) checkAgainstLedger(log, options.ledger, collector);
  if (ctx && options.fingerprints !== undefined) checkFingerprintAgents(log, ctx, options.fingerprints, options.findings, collector);
}

function runFixLogValidation(log, options, collector) {
  const violation = dataLimitViolation(log, LIMITS);
  if (violation) {
    collector.add(violation.pointer, violation.message);
    return;
  }
  let agentCtx = null;
  if (options.agentLog !== undefined) {
    const sub = createCollector();
    agentCtx = runAgentLog(options.agentLog, sub, { runStatus: log && log.status === "in_progress" ? "in_progress" : "finished" });
    for (const line of sub.lines) collector.add("agent-log", line);
    if (isPlainObject(options.agentLog) && options.agentLog.scope !== "fix") collector.add("agent-log:/scope", 'the fix agent log has scope "fix"');
  }
  checkFixLog(log, collector, { ...options, agentCtx });
}

function validateAgentLog(log, options = {}) {
  const collector = createCollector();
  runAgentLogValidation(log, options, collector);
  return finishErrors(collector);
}

function validateFixLog(log, options = {}) {
  const collector = createCollector();
  runFixLogValidation(log, options, collector);
  return finishErrors(collector);
}

function validateConfigFile(config, options = {}) {
  const collector = createCollector();
  checkConfig(config, collector, options);
  return finishErrors(collector);
}

const USAGE = "usage: node validate-orchestration.cjs <file> --kind agent-log|fix-log|config " +
  "[--metadata <run-metadata.json>] [--findings <findings.json>] [--ledger <coverage-ledger.json>] " +
  "[--fingerprints <fingerprint-agents.json>] [--agent-log <fix/agent-log.json>]";
const OPTION_FLAGS = Object.freeze(["--kind", "--metadata", "--findings", "--ledger", "--fingerprints", "--agent-log"]);

function main(argv) {
  const parsed = parseCli(argv, OPTION_FLAGS);
  if (parsed.error) {
    process.stderr.write(`${escapeDiagnostic(parsed.error)}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const kind = parsed.options["--kind"];
  if (!["agent-log", "fix-log", "config"].includes(kind)) {
    process.stderr.write(`--kind must be agent-log, fix-log or config\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const paths = [parsed.input, ...OPTION_FLAGS.filter((flag) => flag !== "--kind").map((flag) => parsed.options[flag])];
  const forbidden = paths.find((entry) => entry !== undefined && isForbiddenPath(entry));
  if (forbidden !== undefined) {
    process.stderr.write(`refusing to open an environment file: ${escapeDiagnostic(quote(forbidden))}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const collector = createCollector();
  const read = (file, label) => {
    try {
      return readJsonDocument(file, LIMITS);
    } catch (error) {
      collector.add(`${label}:`, error instanceof SafeReadError ? error.message : "could not be read");
      return undefined;
    }
  };
  const data = read(parsed.input, "input");
  const options = {};
  for (const [flag, key] of [["--metadata", "metadata"], ["--findings", "findings"], ["--ledger", "ledger"], ["--fingerprints", "fingerprints"], ["--agent-log", "agentLog"]]) {
    if (parsed.options[flag] !== undefined) options[key] = read(parsed.options[flag], key);
  }
  let warnings = [];
  if (collector.total === 0) {
    if (kind === "agent-log") runAgentLogValidation(data, options, collector);
    else if (kind === "fix-log") runFixLogValidation(data, options, collector);
    else warnings = checkConfig(data, collector);
  }
  for (const warning of warnings) process.stdout.write(`WARNING: ${escapeDiagnostic(warning)}\n`);
  const what = kind === "agent-log" ? `agent log valid (${Array.isArray(data?.invocations) ? data.invocations.length : 0} invocations)`
    : kind === "fix-log" ? `fix log valid (${Array.isArray(data?.fixes) ? data.fixes.length : 0} fixes)` : "config valid";
  emitResult(collector, `PASS: ${what}`);
}

module.exports = {
  AGENT_ID_SHAPES,
  AGENT_LOG_SCHEMA,
  FIX_LOG_SCHEMA,
  INVOCATION_KEYS,
  LIMITS,
  agentIdShape,
  computeReserve,
  minimumCap,
  validateAgentLog,
  validateConfigFile,
  validateFixLog,
};

if (require.main === module) main(process.argv.slice(2));
