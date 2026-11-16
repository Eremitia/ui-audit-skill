#!/usr/bin/env node
"use strict";

/*
 * validate-coverage-ledger.cjs - checks a ui-audit coverage-ledger.json: unit
 * shape, canonical refs and the context grammar, coverage_id derivation, the
 * status state table, check objects and their variants, attempt archives,
 * document order and identity, and (with --metadata) every value the run
 * metadata must declare, including matrix completeness. Metadata written as
 * ui-audit/run-metadata@3 is also checked for run status and pause reason,
 * the orchestration block (agent cap, reserves, routing, models), the agent
 * breakdown, the sandbox facts and the resume history; @2 files from earlier
 * runs keep the v1 checks only.
 *
 *   node validate-coverage-ledger.cjs <coverage-ledger.json> [--metadata <run-metadata.json>]
 *
 * Exit 0: "PASS: N coverage units valid". Exit 1: one "ERROR: <json-pointer>: <message>"
 * line per problem (pointers into run-metadata.json start with "metadata:"),
 * then "FAIL: N validation error(s)". Exit 2: usage error on stderr, or a
 * path that names an environment file (refused without being opened).
 *
 * Plain Node 24, no dependencies. An invalid ledger drives no assignment.
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

// ==== coverage-ledger.json validation ====

const LEDGER_LIMITS = Object.freeze({
  ...SHARED_LIMITS,
  rootItems: 10000,
  nestedItems: 1000,
  objectFields: 1000,
  totalValues: 500000,
});
const METADATA_LIMITS = Object.freeze({ ...LEDGER_LIMITS, rootItems: 1000 });
const LIMITS = LEDGER_LIMITS;

const REASON_CODES = Object.freeze([
  "budget_cannot_fund_reconnaissance_and_reserves",
  "budget_cannot_reserve_critics_and_validation",
  "validation_budget_exhausted",
  "critic_budget_exhausted",
  "critic_wave_limit",
  "quick_profile_final_critic",
  "runtime_unavailable",
  "engine_unavailable",
  "build_fetch_required",
  "owner_declined_download",
  "promotion_failed",
  "throttle_shared",
  "user_interrupted",
  "phase5_dispute",
  "agent_cap_reached",
  "model_unavailable",
  "usage_limit_reached",
  "escalation_budget_exhausted",
  "needs_stronger_model",
  "dialogue_unresolved",
  "visual_baseline_unavailable",
]);
// Reasons a run may be paused for (run_status "paused" and resumes[]).
const PAUSE_REASON_CODES = Object.freeze(["usage_limit_reached", "user_interrupted", "model_unavailable"]);
const METADATA_SCHEMAS = Object.freeze(["ui-audit/run-metadata@2", "ui-audit/run-metadata@3"]);
const METADATA_SCHEMA_V3 = "ui-audit/run-metadata@3";
const RUN_STATUSES = Object.freeze(["in_progress", "paused", "complete", "incomplete"]);
const TOPOLOGIES = Object.freeze(["nat-forward", "netns-bridge", "browser-in-vm", "browser-in-wsl", "container-loopback", "host-only"]);
const BREAKDOWN_KEYS = Object.freeze([
  "reconnaissance", "hunters", "critics", "candidate_verifiers", "record_verifiers", "replacement_verifiers",
  "consults", "judges", "escalations", "panels", "schema_repairs", "unspent",
]);
const RESERVE_KEYS = Object.freeze(["reconnaissance", "critics", "validation", "orchestration"]);
const MODEL_DECLARED = Object.freeze(["assume_available", "probe", "unavailable"]);
const MODEL_OBSERVED = Object.freeze(["untested", "available", "unavailable", "substituted", "unknown"]);
const MODEL_ENTRY_KEYS = Object.freeze(["declared", "observed", "first_evidence_seq"]);
const HOST_FACT_TEXT_KEYS = Object.freeze(["cpu", "total_memory", "free_memory_at_perf_wave", "vm_limits"]);
const HOST_FACT_KEYS = Object.freeze([...HOST_FACT_TEXT_KEYS, "cpu_benchmark_ms"]);
const RESUME_KEYS = Object.freeze(["at", "from_status", "pause_reason", "note"]);
const CONFIG_SOURCES = Object.freeze(["config_file", "setup_question", "defaults"]);
const CAP_SOURCES = Object.freeze(["profile_default", "config", "owner_at_run"]);
const ROUTING_MODES = Object.freeze(["per_call", "single_model"]);
const DELEGATION_MODES = Object.freeze(["agent_tool", "inline"]);
const RESUME_FROM_STATUSES = Object.freeze(["paused", "in_progress"]);
const HOST_KEYS = Object.freeze(["os", "claude_code_version", "node_version", "agent_permissions"]);
const UNASKED_QUESTION_MAX_CHARS = 500;
const FORCED_MODEL_MAX_CHARS = 100;
const UNINTENDED_VISUAL_CHANGE_LENS = "VISUAL-AND-THEMING.md#Unintended visual change";
const PRIOR_STATUSES = Object.freeze([
  "new",
  "prior_confirmed_same_source",
  "prior_confirmed_changed_source",
  "prior_needs_validation",
  "prior_deferred",
  "prior_blocked",
  "prior_out_of_scope",
  "prior_covered_same_source",
  "prior_covered_changed_source",
  "prior_rejected_claim_changed",
  "none",
]);
const UNIT_STATUSES = Object.freeze([
  "planned", "not_applicable", "out_of_scope", "deferred", "in_progress", "blocked", "covered", "candidate",
]);
const ATTEMPT_STATUSES = Object.freeze(["covered", "candidate", "blocked"]);
const CHECK_METHODS = Object.freeze(["source", "browser", "test", "scan"]);
const CHECK_KEYS = Object.freeze(["agent_id", "reviewed_paths", "expectation", "method", "variant", "result", "artifact"]);
const ATTEMPT_KEYS = Object.freeze([
  "wave", "status", "agent_id", "reviewed_paths", "checks", "result_fingerprints", "unresolved", "reassignment_reason",
]);
const REF_KEYS = Object.freeze(["surface", "expectation", "domain", "lens", "context"]);
const UNIT_FIELDS = Object.freeze([
  "coverage_id", "canonical_refs", "surface", "expectation", "domain", "lens", "context", "starting_paths",
  "ordinary_lens_block", "selected_companion_blocks", "excluded_blocks", "prior_status", "attempts", "wave",
  "status", "agent_id", "reviewed_paths", "checks", "result_fingerprints", "unresolved",
]);

// Context grammar: keys in this order, each at most once.
const CONTEXT_KEYS = Object.freeze([
  "role", "vp", "theme", "input", "net", "data", "session", "motion", "zoom", "tz", "locale", "browser",
]);
const CONTEXT_VALUE_RULES = Object.freeze({
  role: /^[a-z][a-z0-9_-]{0,31}$/,
  vp: /^[a-z0-9][a-z0-9_-]{0,31}$/,
  theme: ["light", "dark", "system"],
  input: ["pointer", "touch", "keyboard", "screenreader"],
  net: ["fast", "slow4g", "slow3g", "offline", "flaky"],
  data: ["empty", "one", "typical", "heavy", "longtext", "stale"],
  session: ["fresh", "expired", "reopened", "twotabs", "twousers"],
  motion: ["full", "reduced"],
  zoom: ["100", "200", "400"],
  tz: /^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/,
  locale: /^[a-z]{2,3}(-[A-Z]{2})?$/,
  browser: ["chromium", "firefox", "webkit"],
});
const MATRIX_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const MATRIX_KEYS_SUPPLIED = Object.freeze(["vp", "theme"]);
const FIXTURE_DATA_STATES = Object.freeze(["empty", "one", "typical", "heavy", "longtext"]);
const QUICK_DOMAIN = "profile/quick/all-in-scope-domains";
const CROSS_TIMEZONE_PROBE = "Asia/Tokyo";
const REF_MAX_CHARS = 1024;
const CHECK_TEXT_MAX_CHARS = 4096;
const PERSONA_ROLE = /^[a-z][a-z0-9_-]{0,31}$/;
const VIEWPORT_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
// Reserved viewport IDs and their fixed geometry: width, height, dpr, mobile.
const STANDARD_VIEWPORTS = Object.freeze({
  m320: [320, 568, 2, true],
  m360: [360, 800, 3, true],
  m390: [390, 844, 3, true],
  m414: [414, 896, 3, true],
  l844: [844, 390, 3, true],
  t768: [768, 1024, 2, true],
  d1024: [1024, 768, 1, false],
  d1280: [1280, 800, 1, false],
  d1440: [1440, 900, 1, false],
  d1920: [1920, 1080, 1, false],
  r320: [320, 256, 1, false],
});

function startsWithCode(text, codes) {
  if (typeof text !== "string") return false;
  return codes.some((code) => text === code ||
    (text.startsWith(`${code}: `) && hasVisibleContent(text.slice(code.length + 2))));
}

function hasReasonCode(text) {
  return startsWithCode(text, REASON_CODES);
}

function isPauseReason(text) {
  return startsWithCode(text, PAUSE_REASON_CODES);
}

// ---- context grammar ----

function parseKvList(text, forbiddenKeys = []) {
  if (typeof text !== "string" || text === "") return { ok: false, error: "empty key=value list" };
  const values = {};
  let lastOrder = -1;
  for (const part of text.split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) return { ok: false, error: `${quote(part)} is not key=value` };
    const key = part.slice(0, equals);
    const value = part.slice(equals + 1);
    const order = CONTEXT_KEYS.indexOf(key);
    if (order === -1) return { ok: false, error: `unknown context key ${quote(key)}` };
    if (forbiddenKeys.includes(key)) return { ok: false, error: `key ${quote(key)} is supplied by the matrix and may not appear` };
    if (hasOwn(values, key)) return { ok: false, error: `key ${quote(key)} appears twice` };
    if (order < lastOrder) return { ok: false, error: `key ${quote(key)} is out of canonical order (${CONTEXT_KEYS.join(", ")})` };
    if (value === "any") return { ok: false, error: `key ${quote(key)} uses "any"; omit the key instead` };
    const rule = CONTEXT_VALUE_RULES[key];
    const valid = Array.isArray(rule) ? rule.includes(value) : rule.test(value);
    if (!valid) return { ok: false, error: `value ${quote(value)} is not valid for ${key}` };
    values[key] = value;
    lastOrder = order;
  }
  return { ok: true, values };
}

// Parses a canonical context string: "static", "matrix:NAME[;kvlist]" or a kvlist.
function parseContext(text) {
  if (typeof text !== "string") return { ok: false, error: "context must be a string" };
  if (text === "static") return { ok: true, kind: "static", matrix: null, values: {} };
  if (text.startsWith("matrix:")) {
    const semicolon = text.indexOf(";");
    const name = semicolon === -1 ? text.slice(7) : text.slice(7, semicolon);
    if (!MATRIX_NAME.test(name)) return { ok: false, error: `matrix name ${quote(name)} is not valid` };
    if (semicolon === -1) return { ok: true, kind: "matrix", matrix: name, values: {} };
    const rest = parseKvList(text.slice(semicolon + 1), MATRIX_KEYS_SUPPLIED);
    if (!rest.ok) return rest;
    return { ok: true, kind: "matrix", matrix: name, values: rest.values };
  }
  const list = parseKvList(text);
  if (!list.ok) return list;
  return { ok: true, kind: "kv", matrix: null, values: list.values };
}

// ---- coverage IDs ----

function percentEncode(text) {
  let out = "";
  for (const byte of Buffer.from(text, "utf8")) {
    const character = String.fromCharCode(byte);
    out += /[A-Za-z0-9\-._~]/.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function deriveCoverageId(refs) {
  return REF_KEYS.map((key) => percentEncode(String(refs[key]))).join("::");
}

// ---- metadata ----

function emptyFacts() {
  return {
    profile: null,
    viewports: new Set(),
    matrices: new Map(),
    roles: new Set(),
    timezone: null,
    networks: new Set(),
    dataStates: new Set(),
  };
}

function readMetadataFacts(meta, collector) {
  const at = (path) => `metadata:${path}`;
  const facts = emptyFacts();
  if (!isPlainObject(meta)) {
    collector.add(at(""), "run-metadata.json must be an object");
    return facts;
  }
  if (["quick", "standard", "deep"].includes(meta.profile)) facts.profile = meta.profile;
  else collector.add(at("/profile"), "must be quick, standard or deep");

  if (!Array.isArray(meta.viewports)) {
    collector.add(at("/viewports"), "must be an array");
  } else {
    meta.viewports.forEach((viewport, index) => {
      const pointer = pointerJoin("/viewports", index);
      if (!isPlainObject(viewport) || typeof viewport.id !== "string" || !VIEWPORT_ID.test(viewport.id)) {
        collector.add(at(pointer), "needs an id matching ^[a-z0-9][a-z0-9_-]{0,31}$");
        return;
      }
      const { id, width, height, dpr } = viewport;
      if (facts.viewports.has(id)) collector.add(at(pointer), `viewport id ${quote(id)} is declared twice`);
      facts.viewports.add(id);
      const inRange = (value) => Number.isInteger(value) && value >= 200 && value <= 3840;
      if (!inRange(width) || !inRange(height)) collector.add(at(pointer), "width and height must be integers from 200 to 3840");
      if (!(typeof dpr === "number" && dpr >= 1 && dpr <= 4)) collector.add(at(pointer), "dpr must be a number from 1 to 4");
      if (hasOwn(STANDARD_VIEWPORTS, id)) {
        const [w, h, d, mobile] = STANDARD_VIEWPORTS[id];
        if (width !== w || height !== h || dpr !== d || (hasOwn(viewport, "mobile") && viewport.mobile !== mobile)) {
          collector.add(at(pointer), `reserved viewport ${id} must be ${w}x${h} at dpr ${d}`);
        }
      }
      const pivot = /^p([0-9]+)$/.exec(id);
      if (pivot && Number(pivot[1]) !== width) collector.add(at(pointer), `pivot viewport ${id} must be ${pivot[1]} px wide`);
    });
  }

  if (!isPlainObject(meta.matrices)) {
    collector.add(at("/matrices"), "must be an object");
  } else {
    for (const [name, matrix] of Object.entries(meta.matrices)) {
      const pointer = pointerJoin("/matrices", name);
      if (!MATRIX_NAME.test(name)) collector.add(at(pointer), "matrix name is not valid");
      if (!isPlainObject(matrix) || !Array.isArray(matrix.viewports) || !Array.isArray(matrix.themes) ||
          matrix.viewports.length === 0 || matrix.themes.length === 0) {
        collector.add(at(pointer), "needs non-empty viewports and themes arrays");
        continue;
      }
      const viewports = [...new Set(matrix.viewports)];
      const themes = [...new Set(matrix.themes)];
      for (const id of viewports) {
        if (!facts.viewports.has(id)) collector.add(at(pointer), `names unknown viewport ${quote(id)}`);
      }
      for (const theme of themes) {
        if (theme !== "light" && theme !== "dark") collector.add(at(pointer), `theme ${quote(theme)} is not allowed in a matrix (light or dark only)`);
      }
      facts.matrices.set(name, { viewports, themes });
    }
  }

  if (!Array.isArray(meta.personas)) {
    collector.add(at("/personas"), "must be an array");
  } else {
    meta.personas.forEach((persona, index) => {
      if (isPlainObject(persona) && typeof persona.role === "string" && PERSONA_ROLE.test(persona.role)) facts.roles.add(persona.role);
      else collector.add(at(pointerJoin("/personas", index)), "needs a role matching ^[a-z][a-z0-9_-]{0,31}$");
    });
  }

  if (isPlainObject(meta.clock) && typeof meta.clock.timezone === "string" && meta.clock.timezone !== "") {
    facts.timezone = meta.clock.timezone;
  } else {
    collector.add(at("/clock/timezone"), "must be a time zone name");
  }

  if (isPlainObject(meta.network_profiles)) {
    for (const key of Object.keys(meta.network_profiles)) facts.networks.add(key);
  } else {
    collector.add(at("/network_profiles"), "must be an object");
  }

  if (isPlainObject(meta.fixtures) && Array.isArray(meta.fixtures.data_states)) {
    meta.fixtures.data_states.forEach((state, index) => {
      if (FIXTURE_DATA_STATES.includes(state)) facts.dataStates.add(state);
      else collector.add(at(pointerJoin("/fixtures/data_states", index)), `${quote(state)} is not a fixture data state`);
    });
  } else {
    collector.add(at("/fixtures/data_states"), "must be an array");
  }

  if (hasOwn(meta, "incomplete_reason") && meta.incomplete_reason !== null && !hasReasonCode(meta.incomplete_reason)) {
    collector.add(at("/incomplete_reason"), "must start with a reasons-list code");
  }
  if (!METADATA_SCHEMAS.includes(meta.schema)) {
    collector.add(at("/schema"), `must be ${METADATA_SCHEMAS.join(" or ")}`);
  } else if (meta.schema === METADATA_SCHEMA_V3) {
    checkMetadataV3(meta, facts.profile, collector);
  }
  return facts;
}

// ---- run-metadata@3: run status, orchestration, budget, sandbox, resumes ----

const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isIntegerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function checkRunStatus(meta, collector) {
  const at = (path) => `metadata:${path}`;
  if (!RUN_STATUSES.includes(meta.run_status)) {
    collector.add(at("/run_status"), `must be one of ${RUN_STATUSES.join(", ")}`);
    return;
  }
  if (meta.run_status === "paused") {
    if (!isPauseReason(meta.pause_reason)) {
      collector.add(at("/pause_reason"), `a paused run needs a pause_reason that starts with ${PAUSE_REASON_CODES.join(", ")}`);
    }
  } else if (meta.pause_reason !== null) {
    collector.add(at("/pause_reason"), `must be null when run_status is ${quote(meta.run_status)}`);
  }
}

function checkModels(models, collector) {
  const at = (path) => `metadata:/orchestration/models${path}`;
  if (!isPlainObject(models)) {
    collector.add(at(""), `must be an object with exactly ${MODEL_ALIASES.join(", ")}`);
    return;
  }
  for (const alias of MODEL_ALIASES) if (!hasOwn(models, alias)) collector.add(at(""), `missing model alias ${quote(alias)}`);
  for (const [alias, entry] of Object.entries(models)) {
    const pointer = pointerJoin("", alias);
    if (!MODEL_ALIASES.includes(alias)) {
      collector.add(at(pointer), `unknown model alias; only ${MODEL_ALIASES.join(", ")} are allowed`);
      continue;
    }
    if (!isPlainObject(entry)) {
      collector.add(at(pointer), "must be {declared, observed, first_evidence_seq}");
      continue;
    }
    for (const key of MODEL_ENTRY_KEYS) if (!hasOwn(entry, key)) collector.add(at(pointer), `missing field ${quote(key)}`);
    for (const key of Object.keys(entry)) {
      if (!MODEL_ENTRY_KEYS.includes(key)) collector.add(at(pointerJoin(pointer, key)), "is not a model availability field");
    }
    if (hasOwn(entry, "declared") && !MODEL_DECLARED.includes(entry.declared)) {
      collector.add(at(pointerJoin(pointer, "declared")), `must be one of ${MODEL_DECLARED.join(", ")}`);
    }
    if (hasOwn(entry, "observed") && !MODEL_OBSERVED.includes(entry.observed)) {
      collector.add(at(pointerJoin(pointer, "observed")), `must be one of ${MODEL_OBSERVED.join(", ")}`);
    }
    if (hasOwn(entry, "first_evidence_seq") && entry.first_evidence_seq !== null &&
        !(Number.isInteger(entry.first_evidence_seq) && entry.first_evidence_seq >= 1)) {
      collector.add(at(pointerJoin(pointer, "first_evidence_seq")), "must be an integer >= 1 or null");
    }
  }
}

function checkReserve(orchestration, profile, fraction, collector) {
  const at = (path) => `metadata:/orchestration${path}`;
  const reserve = orchestration.reserve;
  const reserveCap = orchestration.reserve_cap;
  if (!isPlainObject(reserve)) {
    collector.add(at("/reserve"), `must be an object with integer ${RESERVE_KEYS.join(", ")}`);
    return;
  }
  let shapeOk = true;
  for (const key of RESERVE_KEYS) {
    if (!isNonNegativeInteger(reserve[key])) {
      collector.add(at(pointerJoin("/reserve", key)), "must be a non-negative integer");
      shapeOk = false;
    }
  }
  for (const key of Object.keys(reserve)) {
    if (!RESERVE_KEYS.includes(key) && key !== "total") {
      collector.add(at(pointerJoin("/reserve", key)), "is not a reserve key");
      shapeOk = false;
    }
  }
  if (!Number.isInteger(reserveCap) || reserveCap < 1) {
    collector.add(at("/reserve_cap"), "must be the integer cap in force at the strict gate");
    return;
  }
  if (Number.isInteger(orchestration.agent_cap) && reserveCap > orchestration.agent_cap) {
    collector.add(at("/reserve_cap"), "cannot be above agent_cap");
  }
  if (!shapeOk) return;
  const sum = RESERVE_KEYS.reduce((total, key) => total + reserve[key], 0);
  if (hasOwn(reserve, "total") && reserve.total !== sum) {
    collector.add(at("/reserve/total"), `must equal the sum of the reserves (${sum})`);
  }
  const setup = hasOwn(orchestration, "setup_calls") && isIntegerIn(orchestration.setup_calls, 0, 2) ? orchestration.setup_calls : 0;
  if (hasOwn(orchestration, "setup_calls") && !isIntegerIn(orchestration.setup_calls, 0, 2)) {
    collector.add(at("/setup_calls"), "must be an integer from 0 to 2 (the agent permission check made before the gate)");
  }
  if (sum + setup + 1 > reserveCap) {
    collector.add(at("/reserve"), `reserves of ${sum} plus ${setup} setup call(s) leave no hunter under reserve_cap ${reserveCap}`);
  }
  // The reserve floor of ORCHESTRATION.md 1.2. When the gate recorded it, the
  // orchestration reserve holds it (reserve_floor_met true) or the owner kept
  // a cap too small for it (false), and the reserve is the floor-less one.
  const hasFloor = hasOwn(orchestration, "reserve_floor");
  const floorOk = hasFloor && Number.isInteger(orchestration.reserve_floor) && orchestration.reserve_floor >= 2;
  if (hasFloor && !floorOk) collector.add(at("/reserve_floor"), "must be an integer >= 2");
  if (hasOwn(orchestration, "reserve_floor_met") && typeof orchestration.reserve_floor_met !== "boolean") {
    collector.add(at("/reserve_floor_met"), "must be a boolean");
  }
  if (hasFloor !== hasOwn(orchestration, "reserve_floor_met")) {
    collector.add(at(""), "reserve_floor and reserve_floor_met are recorded together");
  }
  const met = orchestration.reserve_floor_met !== false;
  const floor = floorOk && met ? orchestration.reserve_floor : 2;
  const expected = profile === null || fraction === null ? null : computeReserve(profile, reserveCap, fraction, floor);
  if (expected !== null) {
    const differs = RESERVE_KEYS.filter((key) => reserve[key] !== expected[key]);
    if (differs.length > 0) {
      collector.add(at("/reserve"), `must equal computeReserve(${profile}, ${reserveCap}, ${fraction}${floor === 2 ? "" : `, ${floor}`}): ` +
        RESERVE_KEYS.map((key) => `${key} ${expected[key]}`).join(", "));
    }
  }
  if (floorOk && orchestration.reserve_floor_met === false && profile !== null && fraction !== null) {
    const withFloor = computeReserve(profile, reserveCap, fraction, orchestration.reserve_floor);
    if (withFloor !== null && withFloor.total + setup + 1 <= reserveCap) {
      collector.add(at("/reserve_floor_met"), `must be true: reserve_cap ${reserveCap} holds the floor of ${orchestration.reserve_floor}`);
    }
  }
}

function checkOrchestration(meta, profile, collector) {
  const at = (path) => `metadata:/orchestration${path}`;
  const o = meta.orchestration;
  if (!isPlainObject(o)) {
    collector.add(at(""), "must be an object");
    return;
  }
  const fraction = typeof o.orchestration_reserve_fraction === "number" &&
    o.orchestration_reserve_fraction >= RESERVE_FRACTION_MIN && o.orchestration_reserve_fraction <= RESERVE_FRACTION_MAX
    ? o.orchestration_reserve_fraction
    : null;
  if (fraction === null) {
    collector.add(at("/orchestration_reserve_fraction"), `must be a number from ${RESERVE_FRACTION_MIN} to ${RESERVE_FRACTION_MAX}`);
  }
  const minimum = profile === null || fraction === null ? null : minimumCap(profile, fraction);
  if (!Number.isInteger(o.agent_cap) || o.agent_cap > AGENT_CAP_MAX || o.agent_cap < (minimum ?? 1)) {
    collector.add(at("/agent_cap"), minimum === null
      ? `must be an integer up to ${AGENT_CAP_MAX}`
      : `must be an integer from minimumCap(${profile}, ${fraction}) = ${minimum} to ${AGENT_CAP_MAX}`);
  }
  if (Number.isInteger(o.agent_cap) && o.agent_cap !== meta.budget) {
    collector.add(at("/agent_cap"), `must equal budget (${quote(meta.budget)})`);
  }
  checkReserve(o, profile, fraction, collector);
  if (!isIntegerIn(o.max_parallel_agents, 1, 20)) collector.add(at("/max_parallel_agents"), "must be an integer from 1 to 20");
  if (!isIntegerIn(o.dialogue_max_rounds, 1, 3)) collector.add(at("/dialogue_max_rounds"), "must be an integer from 1 to 3");
  if (!isIntegerIn(o.escalation_max_steps, 0, 3)) collector.add(at("/escalation_max_steps"), "must be an integer from 0 to 3");
  for (const key of ["allow_max_effort", "allow_fable_usage_credits", "named_agents"]) {
    if (typeof o[key] !== "boolean") collector.add(at(`/${key}`), "must be a boolean");
  }
  if (o.effort_supported !== null && typeof o.effort_supported !== "boolean") {
    collector.add(at("/effort_supported"), "must be a boolean or null");
  }
  if (hasOwn(o, "resume_supported") && o.resume_supported !== null && typeof o.resume_supported !== "boolean") {
    collector.add(at("/resume_supported"), "must be a boolean or null");
  }
  if (hasOwn(o, "delegation") && !DELEGATION_MODES.includes(o.delegation)) {
    collector.add(at("/delegation"), `must be one of ${DELEGATION_MODES.join(", ")}`);
  }
  if (o.delegation === "inline" && o.routing_mode !== "single_model") {
    collector.add(at("/routing_mode"), 'delegation "inline" runs every role in the parent: routing_mode must be "single_model"');
  }
  if (o.effort_forced !== null && !(EFFORT_LEVELS.includes(o.effort_forced) || o.effort_forced === "absent")) {
    collector.add(at("/effort_forced"), `must be null, "absent" or one of ${EFFORT_LEVELS.join(", ")}`);
  }
  if (!ROUTING_MODES.includes(o.routing_mode)) {
    collector.add(at("/routing_mode"), `must be ${ROUTING_MODES.join(" or ")}`);
  }
  if (o.forced_model !== null) {
    if (!isCleanAnchor(o.forced_model) || codePointCount(o.forced_model) > FORCED_MODEL_MAX_CHARS) {
      collector.add(at("/forced_model"), `must be null or a model alias or name of at most ${FORCED_MODEL_MAX_CHARS} characters`);
    } else if (o.routing_mode !== "single_model") {
      collector.add(at("/forced_model"), 'a forced model requires routing_mode "single_model"');
    }
  }
  if (!CONFIG_SOURCES.includes(o.config_source)) {
    collector.add(at("/config_source"), `must be one of ${CONFIG_SOURCES.join(", ")}`);
  }
  const path = o.config_path;
  if (path === null) {
    if (o.config_source === "config_file" || o.config_source === "setup_question") {
      collector.add(at("/config_path"), `config_source ${quote(o.config_source)} needs the config path`);
    }
  } else if (!(isCleanAnchor(path) && (path.startsWith("~") || path.startsWith("${CLAUDE_PLUGIN_DATA}")))) {
    collector.add(at("/config_path"), 'must be null or a path that starts with "~" or "${CLAUDE_PLUGIN_DATA}"');
  } else if (o.config_source === "defaults") {
    collector.add(at("/config_path"), 'must be null when config_source is "defaults"');
  }
  if (!CAP_SOURCES.includes(o.cap_source)) collector.add(at("/cap_source"), `must be one of ${CAP_SOURCES.join(", ")}`);
  checkModels(o.models, collector);
}

function checkBreakdown(meta, collector) {
  const at = (path) => `metadata:${path}`;
  if (!Number.isInteger(meta.budget) || meta.budget < 1) collector.add(at("/budget"), "must be a positive integer");
  if (!isNonNegativeInteger(meta.agents_spent)) collector.add(at("/agents_spent"), "must be a non-negative integer");
  const breakdown = meta.agents_breakdown;
  if (!isPlainObject(breakdown)) {
    collector.add(at("/agents_breakdown"), `must be an object with ${BREAKDOWN_KEYS.join(", ")}`);
    return;
  }
  let ok = true;
  for (const key of BREAKDOWN_KEYS) {
    if (!isNonNegativeInteger(breakdown[key])) {
      collector.add(at(pointerJoin("/agents_breakdown", key)), "must be a non-negative integer");
      ok = false;
    }
  }
  for (const key of Object.keys(breakdown)) {
    if (!BREAKDOWN_KEYS.includes(key)) {
      collector.add(at(pointerJoin("/agents_breakdown", key)), "is not a breakdown key");
      ok = false;
    }
  }
  if (!ok || !Number.isInteger(meta.budget)) return;
  const sum = BREAKDOWN_KEYS.reduce((total, key) => total + breakdown[key], 0);
  if (sum !== meta.budget) collector.add(at("/agents_breakdown"), `sums to ${sum}; it must equal budget ${meta.budget}`);
  if (Number.isInteger(meta.agents_spent) && meta.budget - breakdown.unspent !== meta.agents_spent) {
    collector.add(at("/agents_breakdown/unspent"), `budget - unspent must equal agents_spent (${meta.agents_spent})`);
  }
}

function checkSandbox(meta, collector) {
  const at = (path) => `metadata:/sandbox${path}`;
  const sandbox = meta.sandbox;
  if (!isPlainObject(sandbox)) {
    collector.add(at(""), "must be an object");
    return;
  }
  if (!isIntegerIn(sandbox.max_parallel_browsers, 1, 8)) collector.add(at("/max_parallel_browsers"), "must be an integer from 1 to 8");
  if (!TOPOLOGIES.includes(sandbox.topology)) collector.add(at("/topology"), `must be one of ${TOPOLOGIES.join(", ")}`);
  const facts = sandbox.host_facts;
  if (!isPlainObject(facts)) {
    collector.add(at("/host_facts"), `must be an object with ${HOST_FACT_KEYS.join(", ")}`);
    return;
  }
  for (const key of HOST_FACT_KEYS) if (!hasOwn(facts, key)) collector.add(at("/host_facts"), `missing field ${quote(key)}`);
  for (const key of Object.keys(facts)) {
    if (!HOST_FACT_KEYS.includes(key)) collector.add(at(pointerJoin("/host_facts", key)), "is not a host fact");
  }
  for (const key of HOST_FACT_TEXT_KEYS) {
    if (hasOwn(facts, key) && facts[key] !== null && !hasVisibleContent(facts[key])) {
      collector.add(at(pointerJoin("/host_facts", key)), "must be a string or null");
    }
  }
  const benchmark = facts.cpu_benchmark_ms;
  if (hasOwn(facts, "cpu_benchmark_ms") && benchmark !== null && !(typeof benchmark === "number" && Number.isFinite(benchmark) && benchmark >= 0)) {
    collector.add(at("/host_facts/cpu_benchmark_ms"), "must be a non-negative number or null");
  }
}

function checkResumes(meta, collector) {
  const at = (path) => `metadata:/resumes${path}`;
  if (!Array.isArray(meta.resumes)) {
    collector.add(at(""), "must be an array");
    return;
  }
  meta.resumes.forEach((entry, index) => {
    const pointer = pointerJoin("", index);
    if (!isPlainObject(entry)) {
      collector.add(at(pointer), "must be {at, from_status, pause_reason, note}");
      return;
    }
    for (const key of RESUME_KEYS) if (!hasOwn(entry, key)) collector.add(at(pointer), `missing field ${quote(key)}`);
    for (const key of Object.keys(entry)) {
      if (!RESUME_KEYS.includes(key)) collector.add(at(pointerJoin(pointer, key)), "is not a resume field");
    }
    if (hasOwn(entry, "at") && !hasVisibleContent(entry.at)) collector.add(at(pointerJoin(pointer, "at")), "must be an ISO-8601 time");
    if (hasOwn(entry, "from_status") && !RESUME_FROM_STATUSES.includes(entry.from_status)) {
      collector.add(at(pointerJoin(pointer, "from_status")), 'must be "paused", or "in_progress" for a run recovered after a crash');
    }
    if (hasOwn(entry, "pause_reason") && !isPauseReason(entry.pause_reason)) {
      collector.add(at(pointerJoin(pointer, "pause_reason")), `must start with ${PAUSE_REASON_CODES.join(", ")}`);
    }
    if (hasOwn(entry, "note") && entry.note !== null && typeof entry.note !== "string") {
      collector.add(at(pointerJoin(pointer, "note")), "must be a string or null");
    }
  });
}

function checkHostAndQuestions(meta, collector) {
  const at = (path) => `metadata:${path}`;
  if (isPlainObject(meta.host)) {
    for (const key of Object.keys(meta.host)) {
      if (!HOST_KEYS.includes(key)) collector.add(at(pointerJoin("/host", key)), "is not a host field");
    }
    if (hasOwn(meta.host, "agent_permissions") && meta.host.agent_permissions !== null &&
        !(typeof meta.host.agent_permissions === "string" && codePointCount(meta.host.agent_permissions) <= 2000)) {
      collector.add(at("/host/agent_permissions"), "must be null or the owner's answer as text of at most 2000 characters");
    }
  } else if (hasOwn(meta, "host")) {
    collector.add(at("/host"), "must be an object");
  }
  if (hasOwn(meta, "unasked_questions")) {
    if (!Array.isArray(meta.unasked_questions)) {
      collector.add(at("/unasked_questions"), "must be an array of the questions the parent could not ask");
    } else {
      meta.unasked_questions.forEach((entry, index) => {
        if (!hasVisibleContent(entry) || codePointCount(entry) > UNASKED_QUESTION_MAX_CHARS) {
          collector.add(at(pointerJoin("/unasked_questions", index)), `must be visible text of at most ${UNASKED_QUESTION_MAX_CHARS} characters`);
        }
      });
    }
  }
}

function checkMetadataV3(meta, profile, collector) {
  checkHostAndQuestions(meta, collector);
  checkRunStatus(meta, collector);
  checkOrchestration(meta, profile, collector);
  checkBreakdown(meta, collector);
  checkSandbox(meta, collector);
  checkResumes(meta, collector);
}

// Checks context values that metadata must declare.
function checkContextAgainstMetadata(values, matrix, pointer, collector, facts) {
  if (matrix !== null && !facts.matrices.has(matrix)) collector.add(pointer, `matrix ${quote(matrix)} is not declared in run-metadata.json`);
  if (hasOwn(values, "vp") && !facts.viewports.has(values.vp)) collector.add(pointer, `viewport ${quote(values.vp)} is not declared in run-metadata.json`);
  if (hasOwn(values, "role") && !facts.roles.has(values.role)) collector.add(pointer, `role ${quote(values.role)} is not a persona in run-metadata.json`);
  if (hasOwn(values, "tz") && values.tz !== facts.timezone && values.tz !== CROSS_TIMEZONE_PROBE) {
    collector.add(pointer, `time zone ${quote(values.tz)} is neither the run time zone nor ${CROSS_TIMEZONE_PROBE}`);
  }
  if (hasOwn(values, "net") && !facts.networks.has(values.net)) collector.add(pointer, `network ${quote(values.net)} is not a network profile in run-metadata.json`);
  if (hasOwn(values, "data") && values.data !== "stale" && !facts.dataStates.has(values.data)) {
    collector.add(pointer, `data state ${quote(values.data)} is not a fixture state in run-metadata.json`);
  }
}

// ---- unit pieces ----

function checkRefText(value, pointer, collector) {
  if (typeof value !== "string") {
    collector.add(pointer, "must be a string");
    return false;
  }
  const problems = [];
  if (!value.isWellFormed()) problems.push("contains invalid Unicode");
  else {
    if (value.normalize("NFC") !== value) problems.push("is not NFC-normalised");
    if (!hasVisibleContent(value)) problems.push("has no visible content");
    if (INVISIBLE_OR_CONTROL.test(value)) problems.push("contains control or invisible characters");
    if (value.trim() !== value) problems.push("has leading or trailing whitespace");
    if (codePointCount(value) > REF_MAX_CHARS) problems.push(`is longer than ${REF_MAX_CHARS} characters`);
  }
  for (const problem of problems) collector.add(pointer, problem);
  return problems.length === 0;
}

function checkCanonicalRefs(refs, pointer, collector, facts) {
  if (!isPlainObject(refs)) {
    collector.add(pointer, "canonical_refs must be an object");
    return null;
  }
  let ok = true;
  for (const key of REF_KEYS) {
    if (!hasOwn(refs, key)) {
      collector.add(pointer, `missing ref ${quote(key)}`);
      ok = false;
    }
  }
  for (const key of Object.keys(refs)) {
    if (!REF_KEYS.includes(key)) {
      collector.add(pointerJoin(pointer, key), "canonical_refs takes exactly surface, expectation, domain, lens and context");
      ok = false;
    }
  }
  if (!ok) return null;
  for (const key of REF_KEYS) ok = checkRefText(refs[key], pointerJoin(pointer, key), collector) && ok;
  if (!ok) return null;
  if (!isExpectationRef(refs.expectation)) {
    collector.add(pointerJoin(pointer, "expectation"), "is not in a recognised expectation namespace");
    ok = false;
  }
  if (!CLASS_BLOCK_REF_SET.has(refs.lens)) {
    collector.add(pointerJoin(pointer, "lens"), BLOCK_REF_SET.has(refs.lens)
      ? "names a prompt block, not a lens or defect class"
      : "is not a known lens or defect class block ref");
    ok = false;
  }
  if (ok) {
    const baseline = refs.expectation.startsWith("baseline:");
    if (baseline && refs.lens !== UNINTENDED_VISUAL_CHANGE_LENS) {
      collector.add(pointerJoin(pointer, "lens"), `a baseline: expectation needs the lens ${UNINTENDED_VISUAL_CHANGE_LENS}`);
      ok = false;
    } else if (!baseline && refs.lens === UNINTENDED_VISUAL_CHANGE_LENS) {
      collector.add(pointerJoin(pointer, "expectation"), `the lens ${UNINTENDED_VISUAL_CHANGE_LENS} needs a baseline: expectation`);
      ok = false;
    }
  }
  const context = parseContext(refs.context);
  if (!context.ok) {
    collector.add(pointerJoin(pointer, "context"), context.error);
    return null;
  }
  if (facts) checkContextAgainstMetadata(context.values, context.matrix, pointerJoin(pointer, "context"), collector, facts);
  return ok ? context : null;
}

function checkPathList(list, pointer, collector, { nonEmpty }) {
  if (!Array.isArray(list)) {
    collector.add(pointer, "must be an array");
    return [];
  }
  if (nonEmpty && list.length === 0) collector.add(pointer, "must not be empty");
  const seen = new Set();
  list.forEach((entry, index) => {
    if (!isSafeRelativePath(entry)) collector.add(pointerJoin(pointer, index), "must be a safe relative path");
    else if (seen.has(entry)) collector.add(pointerJoin(pointer, index), "duplicate path");
    seen.add(entry);
  });
  return list.filter((entry) => typeof entry === "string");
}

function checkLimitedText(value, pointer, collector) {
  if (!hasVisibleContent(value)) collector.add(pointer, "must contain visible text");
  else {
    if (value.trim() !== value) collector.add(pointer, "must be trimmed");
    if (codePointCount(value) > CHECK_TEXT_MAX_CHARS) collector.add(pointer, `is longer than ${CHECK_TEXT_MAX_CHARS} characters`);
  }
}

function checkCheck(check, pointer, collector, unitContext, facts) {
  if (!isPlainObject(check)) {
    collector.add(pointer, "a check must be an object");
    return null;
  }
  for (const key of CHECK_KEYS) if (!hasOwn(check, key)) collector.add(pointer, `missing check field ${quote(key)}`);
  for (const key of Object.keys(check)) {
    if (!CHECK_KEYS.includes(key)) collector.add(pointerJoin(pointer, key), "a check has exactly seven fields");
  }
  const agentOk = isSafeAgentId(check.agent_id);
  if (!agentOk) collector.add(pointerJoin(pointer, "agent_id"), "must be a safe agent id");
  const paths = checkPathList(check.reviewed_paths, pointerJoin(pointer, "reviewed_paths"), collector, { nonEmpty: true });
  checkLimitedText(check.expectation, pointerJoin(pointer, "expectation"), collector);
  checkLimitedText(check.result, pointerJoin(pointer, "result"), collector);
  const method = check.method;
  if (!CHECK_METHODS.includes(method)) collector.add(pointerJoin(pointer, "method"), "must be source, browser, test or scan");
  let variant = null;
  const runtime = method === "browser" || method === "test";
  if (!runtime) {
    if (check.variant !== null) collector.add(pointerJoin(pointer, "variant"), `must be null for method ${quote(method)}`);
  } else {
    const parsed = parseKvList(check.variant);
    if (!parsed.ok) {
      collector.add(pointerJoin(pointer, "variant"), `browser and test checks need a canonical key=value variant: ${parsed.error}`);
    } else {
      variant = parsed.values;
      if (unitContext) {
        for (const [key, value] of Object.entries(variant)) {
          if (hasOwn(unitContext.values, key) && unitContext.values[key] !== value) {
            collector.add(pointerJoin(pointer, "variant"), `${key}=${value} contradicts the unit context ${key}=${unitContext.values[key]}`);
          }
        }
        if (unitContext.kind === "matrix") {
          if (!hasOwn(variant, "vp") || !hasOwn(variant, "theme")) {
            collector.add(pointerJoin(pointer, "variant"), "a check on a matrix unit must name vp and theme");
          }
          // A matrix never contains theme=system, so this holds even without metadata.
          if (variant.theme === "system") {
            collector.add(pointerJoin(pointer, "variant"), `variant theme=system is outside matrix ${unitContext.matrix} (matrices hold light and dark only)`);
          }
          const matrix = facts ? facts.matrices.get(unitContext.matrix) : undefined;
          if (matrix) {
            if (hasOwn(variant, "vp") && !matrix.viewports.includes(variant.vp)) {
              collector.add(pointerJoin(pointer, "variant"), `variant vp=${variant.vp} is outside matrix ${unitContext.matrix}`);
            }
            if (hasOwn(variant, "theme") && variant.theme !== "system" && !matrix.themes.includes(variant.theme)) {
              collector.add(pointerJoin(pointer, "variant"), `variant theme=${variant.theme} is outside matrix ${unitContext.matrix}`);
            }
          }
        }
      }
      if (facts) checkContextAgainstMetadata(variant, null, pointerJoin(pointer, "variant"), collector, facts);
    }
  }
  if (method === "source") {
    if (check.artifact !== null) collector.add(pointerJoin(pointer, "artifact"), "must be null for a source check");
  } else if (CHECK_METHODS.includes(method)) {
    if (!agentOk || !isOwnedArtifactPath(check.artifact, check.agent_id)) {
      collector.add(pointerJoin(pointer, "artifact"),
        "must be an owned artifact path agents/<check agent_id>/artifacts/<file> with an allowed extension");
    }
  }
  return {
    agentId: agentOk ? check.agent_id : null,
    paths,
    method,
    variant,
    artifact: typeof check.artifact === "string" ? check.artifact : null,
  };
}

function checkChecks(list, pointer, collector, unitContext, facts) {
  if (!Array.isArray(list)) {
    collector.add(pointer, "must be an array");
    return [];
  }
  return list.map((check, index) => checkCheck(check, pointerJoin(pointer, index), collector, unitContext, facts)).filter(Boolean);
}

function checkPathUnion(paths, checks, pointer, collector) {
  const own = new Set(paths);
  const union = new Set(checks.flatMap((check) => check.paths));
  for (const entry of own) if (!union.has(entry)) collector.add(pointer, `${quote(entry)} is not reviewed by any check`);
  for (const entry of union) if (!own.has(entry)) collector.add(pointer, `check path ${quote(entry)} is missing from reviewed_paths`);
}

function checkFingerprintList(list, pointer, collector) {
  if (!Array.isArray(list)) {
    collector.add(pointer, "must be an array");
    return;
  }
  const seen = new Set();
  list.forEach((entry, index) => {
    if (!isFingerprint(entry)) collector.add(pointerJoin(pointer, index), "is not a valid fingerprint");
    else if (seen.has(entry)) collector.add(pointerJoin(pointer, index), "duplicate fingerprint");
    seen.add(entry);
  });
}

function checkUnresolvedList(list, pointer, collector) {
  if (!Array.isArray(list)) {
    collector.add(pointer, "must be an array");
    return;
  }
  const seen = new Set();
  list.forEach((entry, index) => {
    if (!hasVisibleContent(entry)) collector.add(pointerJoin(pointer, index), "must contain visible text");
    else if (seen.has(entry)) collector.add(pointerJoin(pointer, index), "duplicate entry");
    seen.add(entry);
  });
}

const STATE_RULES = Object.freeze({
  planned: { owner: false, evidence: "empty", fingerprints: "empty", unresolved: "empty" },
  not_applicable: { owner: false, evidence: "empty", fingerprints: "empty", unresolved: "nonempty" },
  out_of_scope: { owner: false, evidence: "empty", fingerprints: "empty", unresolved: "nonempty" },
  deferred: { owner: false, evidence: "empty", fingerprints: "empty", unresolved: "nonempty", reasonCode: true },
  in_progress: { owner: true, evidence: "empty", fingerprints: "empty", unresolved: "empty" },
  blocked: { owner: true, evidence: "nonempty", fingerprints: "empty", unresolved: "nonempty" },
  covered: { owner: true, evidence: "nonempty", fingerprints: "empty", unresolved: "empty" },
  candidate: { owner: true, evidence: "nonempty", fingerprints: "nonempty", unresolved: "any" },
});

function checkStateTable(status, record, pointer, collector) {
  const rule = STATE_RULES[status];
  if (!rule) return;
  const size = (value) => (Array.isArray(value) ? value.length : 0);
  const label = `status ${quote(status)}`;
  if (rule.owner && record.agent_id === null) collector.add(pointerJoin(pointer, "agent_id"), `${label} needs an owning agent`);
  if (!rule.owner && record.agent_id !== null) collector.add(pointerJoin(pointer, "agent_id"), `${label} must have agent_id null`);
  const evidence = [["reviewed_paths", size(record.reviewed_paths)], ["checks", size(record.checks)]];
  for (const [key, count] of evidence) {
    if (rule.evidence === "empty" && count > 0) collector.add(pointerJoin(pointer, key), `${label} must have no ${key}`);
    if (rule.evidence === "nonempty" && count === 0) collector.add(pointerJoin(pointer, key), `${label} needs ${key}`);
  }
  const fingerprints = size(record.result_fingerprints);
  if (rule.fingerprints === "empty" && fingerprints > 0) collector.add(pointerJoin(pointer, "result_fingerprints"), `${label} must have no result_fingerprints`);
  if (rule.fingerprints === "nonempty" && fingerprints === 0) collector.add(pointerJoin(pointer, "result_fingerprints"), `${label} needs result_fingerprints`);
  const unresolved = size(record.unresolved);
  if (rule.unresolved === "empty" && unresolved > 0) collector.add(pointerJoin(pointer, "unresolved"), `${label} must have nothing unresolved`);
  if (rule.unresolved === "nonempty" && unresolved === 0) collector.add(pointerJoin(pointer, "unresolved"), `${label} must say what is unresolved`);
  if (rule.reasonCode && Array.isArray(record.unresolved) && !record.unresolved.some(hasReasonCode)) {
    collector.add(pointerJoin(pointer, "unresolved"), "a deferred unit needs an entry that starts with a reasons-list code");
  }
}

function checkBlockLists(unit, pointer, collector) {
  if (unit.ordinary_lens_block !== null &&
      !(typeof unit.ordinary_lens_block === "string" && BLOCK_REF_SET.has(unit.ordinary_lens_block) &&
        unit.ordinary_lens_block.startsWith(`${ORDINARY_LENS_FILE}#`))) {
    collector.add(pointerJoin(pointer, "ordinary_lens_block"), "must be null or a LENSES.md block ref");
  }
  const selected = new Set();
  if (!Array.isArray(unit.selected_companion_blocks)) {
    collector.add(pointerJoin(pointer, "selected_companion_blocks"), "must be an array");
  } else {
    unit.selected_companion_blocks.forEach((block, index) => {
      const at = pointerJoin(pointerJoin(pointer, "selected_companion_blocks"), index);
      if (!BLOCK_REF_SET.has(block)) collector.add(at, "is not a known block ref");
      else if (selected.has(block)) collector.add(at, "duplicate block");
      selected.add(block);
    });
    const companions = new Set([...selected]
      .filter((block) => typeof block === "string" && CLASS_BLOCK_REF_SET.has(block) && !block.startsWith(`${ORDINARY_LENS_FILE}#`))
      .map((block) => block.slice(0, block.indexOf("#"))));
    for (const file of companions) {
      for (const meta of COMPANION_META_BLOCKS) {
        if (!selected.has(`${file}#${meta}`)) {
          collector.add(pointerJoin(pointer, "selected_companion_blocks"), `selecting a ${file} class also requires ${file}#${meta}`);
        }
      }
    }
  }
  if (!Array.isArray(unit.excluded_blocks)) {
    collector.add(pointerJoin(pointer, "excluded_blocks"), "must be an array");
    return;
  }
  const excluded = new Set();
  unit.excluded_blocks.forEach((entry, index) => {
    const at = pointerJoin(pointerJoin(pointer, "excluded_blocks"), index);
    if (!isPlainObject(entry) || Object.keys(entry).length !== 2 || !hasOwn(entry, "block") || !hasOwn(entry, "reason")) {
      collector.add(at, "must be exactly {block, reason}");
      return;
    }
    if (!BLOCK_REF_SET.has(entry.block)) collector.add(at, "block is not a known block ref");
    else if (excluded.has(entry.block)) collector.add(at, "duplicate excluded block");
    else if (selected.has(entry.block)) collector.add(at, "block is both selected and excluded");
    excluded.add(entry.block);
    if (!hasVisibleContent(entry.reason)) collector.add(pointerJoin(at, "reason"), "must contain visible text");
  });
}

function checkAttempts(unit, pointer, collector, unitContext, facts, liveChecks) {
  const attempts = unit.attempts;
  if (!Array.isArray(attempts)) {
    collector.add(pointer, "must be an array");
    return;
  }
  const owners = [];
  const artifactGroups = new Map();
  const groupChecks = [];
  let previousWave = 0;
  attempts.forEach((attempt, index) => {
    const at = pointerJoin(pointer, index);
    if (!isPlainObject(attempt)) {
      collector.add(at, "an attempt must be an object");
      groupChecks.push([]);
      owners.push(null);
      return;
    }
    for (const key of ATTEMPT_KEYS) if (!hasOwn(attempt, key)) collector.add(at, `missing attempt field ${quote(key)}`);
    for (const key of Object.keys(attempt)) {
      if (!ATTEMPT_KEYS.includes(key)) collector.add(pointerJoin(at, key), "is not an attempt field");
    }
    if (!Number.isInteger(attempt.wave) || attempt.wave < 1) {
      collector.add(pointerJoin(at, "wave"), "must be an integer >= 1");
    } else {
      if (attempt.wave <= previousWave) collector.add(pointerJoin(at, "wave"), "attempt waves must strictly increase");
      if (Number.isInteger(unit.wave) && attempt.wave >= unit.wave) collector.add(pointerJoin(at, "wave"), "an archived attempt must come before the live wave");
      previousWave = attempt.wave;
    }
    if (!ATTEMPT_STATUSES.includes(attempt.status)) collector.add(pointerJoin(at, "status"), "must be covered, candidate or blocked");
    const owner = isSafeAgentId(attempt.agent_id) ? attempt.agent_id : null;
    if (owner === null) collector.add(pointerJoin(at, "agent_id"), "must be a safe agent id");
    else if (owners.includes(owner)) collector.add(pointerJoin(at, "agent_id"), "each attempt needs a different owner");
    else if (owner === unit.agent_id) collector.add(pointerJoin(at, "agent_id"), "the live owner must differ from every archived owner");
    owners.push(owner);
    const paths = checkPathList(attempt.reviewed_paths, pointerJoin(at, "reviewed_paths"), collector, { nonEmpty: false });
    const checks = checkChecks(attempt.checks, pointerJoin(at, "checks"), collector, unitContext, facts);
    checkPathUnion(paths, checks, pointerJoin(at, "reviewed_paths"), collector);
    checkFingerprintList(attempt.result_fingerprints, pointerJoin(at, "result_fingerprints"), collector);
    checkUnresolvedList(attempt.unresolved, pointerJoin(at, "unresolved"), collector);
    if (!hasVisibleContent(attempt.reassignment_reason)) collector.add(pointerJoin(at, "reassignment_reason"), "must contain visible text");
    checkStateTable(attempt.status, { ...attempt, agent_id: owner ?? (attempt.agent_id ?? null) }, at, collector);
    groupChecks.push(checks);
  });
  const groups = [...groupChecks.map((checks, index) => ({ label: `attempt ${index}`, index, checks })),
    { label: "live checks", index: attempts.length, checks: liveChecks }];
  for (const group of groups) {
    for (const check of group.checks) {
      if (check.artifact === null) continue;
      const earlier = artifactGroups.get(check.artifact);
      if (earlier !== undefined && earlier !== group.label) {
        collector.add(pointer, `artifact ${quote(check.artifact)} is reused by ${earlier} and ${group.label}`);
      }
      if (earlier === undefined) artifactGroups.set(check.artifact, group.label);
    }
  }
  owners.forEach((owner, index) => {
    if (owner === null) return;
    for (const group of groups.slice(index + 1)) {
      if (group.checks.some((check) => check.agentId === owner)) {
        collector.add(pointerJoin(pointer, index), `archived owner ${quote(owner)} has checks again in ${group.label}`);
      }
    }
  });
}

function checkMatrixCompleteness(unit, context, liveChecks, pointer, collector, facts) {
  const matrix = facts.matrices.get(context.matrix);
  if (!matrix || (unit.status !== "covered" && unit.status !== "candidate")) return;
  const ran = new Set(liveChecks
    .filter((check) => check.method === "browser" && check.variant && hasOwn(check.variant, "vp") && hasOwn(check.variant, "theme"))
    .map((check) => `vp=${check.variant.vp};theme=${check.variant.theme}`));
  const missing = [];
  for (const vp of matrix.viewports) for (const theme of matrix.themes) {
    const pair = `vp=${vp};theme=${theme}`;
    if (!ran.has(pair)) missing.push(pair);
  }
  if (missing.length === 0) return;
  if (unit.status === "covered") {
    collector.add(pointerJoin(pointer, "checks"), `covered matrix:${context.matrix} unit has no browser check for ${missing.join(", ")}`);
    return;
  }
  const unresolved = Array.isArray(unit.unresolved) ? unit.unresolved : [];
  for (const pair of missing) {
    if (!unresolved.includes(`variant not run: ${pair}`)) {
      collector.add(pointerJoin(pointer, "unresolved"), `candidate matrix unit must run ${pair} or list "variant not run: ${pair}"`);
    }
  }
}

function checkUnit(unit, pointer, collector, facts) {
  if (!isPlainObject(unit)) {
    collector.add(pointer, "a coverage unit must be an object");
    return null;
  }
  const missing = UNIT_FIELDS.filter((key) => !hasOwn(unit, key));
  for (const key of missing) collector.add(pointer, `missing unit field ${quote(key)}`);
  if (missing.length > 0) return null;

  const context = checkCanonicalRefs(unit.canonical_refs, pointerJoin(pointer, "canonical_refs"), collector, facts);
  for (const key of REF_KEYS) {
    if (!hasVisibleContent(unit[key])) collector.add(pointerJoin(pointer, key), "label must contain visible text");
  }
  if (isPlainObject(unit.canonical_refs) && unit.context !== unit.canonical_refs.context) {
    collector.add(pointerJoin(pointer, "context"), "must equal canonical_refs.context");
  }
  let idOk = typeof unit.coverage_id === "string";
  if (!idOk) collector.add(pointerJoin(pointer, "coverage_id"), "must be a string");
  else if (context) {
    const expected = deriveCoverageId(unit.canonical_refs);
    if (expected !== unit.coverage_id) {
      collector.add(pointerJoin(pointer, "coverage_id"), "does not match the id derived from canonical_refs");
      idOk = false;
    }
  }

  checkPathList(unit.starting_paths, pointerJoin(pointer, "starting_paths"), collector, { nonEmpty: true });
  checkBlockLists(unit, pointer, collector);
  if (!PRIOR_STATUSES.includes(unit.prior_status)) collector.add(pointerJoin(pointer, "prior_status"), "is not a known prior_status");
  if (!UNIT_STATUSES.includes(unit.status)) collector.add(pointerJoin(pointer, "status"), "is not a known status");
  if (!Number.isInteger(unit.wave) || unit.wave < 1) collector.add(pointerJoin(pointer, "wave"), "must be an integer >= 1");
  if (unit.agent_id !== null && !isSafeAgentId(unit.agent_id)) collector.add(pointerJoin(pointer, "agent_id"), "must be null or a safe agent id");

  const paths = checkPathList(unit.reviewed_paths, pointerJoin(pointer, "reviewed_paths"), collector, { nonEmpty: false });
  const liveChecks = checkChecks(unit.checks, pointerJoin(pointer, "checks"), collector, context, facts);
  checkPathUnion(paths, liveChecks, pointerJoin(pointer, "reviewed_paths"), collector);
  checkFingerprintList(unit.result_fingerprints, pointerJoin(pointer, "result_fingerprints"), collector);
  checkUnresolvedList(unit.unresolved, pointerJoin(pointer, "unresolved"), collector);
  checkStateTable(unit.status, unit, pointer, collector);
  checkAttempts(unit, pointerJoin(pointer, "attempts"), collector, context, facts, liveChecks);

  if (facts && context) {
    if (context.kind === "matrix") checkMatrixCompleteness(unit, context, liveChecks, pointer, collector, facts);
    if (facts.profile === "quick" && unit.canonical_refs.domain !== QUICK_DOMAIN) {
      collector.add(pointerJoin(pointerJoin(pointer, "canonical_refs"), "domain"), `a quick run uses the single domain ${QUICK_DOMAIN}`);
    }
  }

  return {
    id: idOk ? unit.coverage_id : null,
    identity: JSON.stringify([REF_KEYS.map((key) => unit.canonical_refs?.[key]), REF_KEYS.map((key) => unit[key])]),
    tuple: JSON.stringify(REF_KEYS.map((key) => unit[key])),
  };
}

// ---- entry points ----

function runLedger(data, metadata, collector) {
  let facts = null;
  if (metadata !== undefined) {
    const violation = dataLimitViolation(metadata, METADATA_LIMITS);
    if (violation) {
      collector.add(`metadata:${violation.pointer}`, violation.message);
      return;
    }
    facts = readMetadataFacts(metadata, collector);
  }
  if (!Array.isArray(data)) {
    collector.add("", "coverage-ledger.json must be a top-level array of units");
    return;
  }
  const violation = dataLimitViolation(data, LEDGER_LIMITS);
  if (violation) {
    collector.add(violation.pointer, violation.message);
    return;
  }
  const byId = new Map();
  const byTuple = new Map();
  let previousId = null;
  data.forEach((unit, index) => {
    const pointer = pointerJoin("", index);
    const info = checkUnit(unit, pointer, collector, facts);
    if (!info) return;
    if (typeof unit.coverage_id === "string") {
      if (previousId !== null && unit.coverage_id < previousId) {
        collector.add(pointerJoin(pointer, "coverage_id"), "units must be sorted by coverage_id");
      }
      previousId = unit.coverage_id;
    }
    if (info.id === null) return;
    const earlier = byId.get(info.id);
    if (earlier) {
      collector.add(pointerJoin(pointer, "coverage_id"), earlier.identity === info.identity
        ? `duplicate coverage_id (also unit ${earlier.index})`
        : `canonical identity collision with unit ${earlier.index}: same id, different semantic fields`);
    } else {
      byId.set(info.id, { index, identity: info.identity });
    }
    const alias = byTuple.get(info.tuple);
    if (alias && alias.id !== info.id) {
      collector.add(pointerJoin(pointer, "coverage_id"), `aliases unit ${alias.index}: the same labels under a different coverage_id`);
    } else if (!alias) {
      byTuple.set(info.tuple, { index, id: info.id });
    }
  });
}

// Every check artifact (live and archived) must name a file the parent
// promoted into <run-dir>/agents/<id>/artifacts/, reached without links.
function checkPromotedCheckArtifacts(data, runDir, collector) {
  const visit = (checks, pointer) => {
    if (!Array.isArray(checks)) return;
    checks.forEach((check, index) => {
      if (!isPlainObject(check) || typeof check.artifact !== "string" || !isOwnedArtifactPath(check.artifact)) return;
      if (!artifactExistsUnder(runDir, check.artifact)) {
        collector.add(pointerJoin(pointerJoin(pointer, index), "artifact"),
          `${quote(check.artifact)} was not promoted: no regular file at that path under --run-dir`);
      }
    });
  };
  data.forEach((unit, index) => {
    if (!isPlainObject(unit)) return;
    visit(unit.checks, `/${index}/checks`);
    if (Array.isArray(unit.attempts)) {
      unit.attempts.forEach((attempt, position) => {
        if (isPlainObject(attempt)) visit(attempt.checks, `/${index}/attempts/${position}/checks`);
      });
    }
  });
}

function validateLedger(data, metadata) {
  const collector = createCollector();
  runLedger(data, metadata === null ? undefined : metadata, collector);
  return finishErrors(collector);
}

const USAGE = "usage: node validate-coverage-ledger.cjs <coverage-ledger.json> [--metadata <run-metadata.json>] [--run-dir <run directory>]";

function main(argv) {
  const parsed = parseCli(argv, ["--metadata", "--run-dir"]);
  if (parsed.error) {
    process.stderr.write(`${escapeDiagnostic(parsed.error)}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const forbidden = [parsed.input, parsed.options["--metadata"]].find((entry) => isForbiddenPath(entry));
  if (forbidden !== undefined) {
    process.stderr.write(`refusing to open an environment file: ${escapeDiagnostic(quote(forbidden))}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const collector = createCollector();
  let data;
  let metadata;
  let readable = true;
  try {
    data = readJsonDocument(parsed.input, LEDGER_LIMITS);
  } catch (error) {
    readable = false;
    collector.add("", error instanceof SafeReadError ? error.message : "input could not be read");
  }
  if (parsed.options["--metadata"] !== undefined) {
    try {
      metadata = readJsonDocument(parsed.options["--metadata"], METADATA_LIMITS);
    } catch (error) {
      readable = false;
      collector.add("metadata:", error instanceof SafeReadError ? error.message : "metadata could not be read");
    }
  }
  if (readable) runLedger(data, metadata, collector);
  if (readable && parsed.options["--run-dir"] !== undefined && Array.isArray(data)) {
    checkPromotedCheckArtifacts(data, parsed.options["--run-dir"], collector);
  }
  const count = Array.isArray(data) ? data.length : 0;
  emitResult(collector, `PASS: ${count} coverage units valid`);
}

module.exports = {
  artifactExistsUnder,
  checkPromotedCheckArtifacts,
  ALLOWED_ARTIFACT_EXTENSIONS,
  AGENT_ID,
  BLOCK_CATALOG,
  BLOCK_REFS,
  CLASS_BLOCK_REFS,
  COMPANION_META_BLOCKS,
  BREAKDOWN_KEYS,
  CONTEXT_KEYS,
  EFFORT_LEVELS,
  LIMITS,
  MODEL_ALIASES,
  PAUSE_REASON_CODES,
  REASON_CODES,
  SELF_ASSESSMENT_LEVELS,
  SHARED_LIMITS,
  STANDARD_VIEWPORTS,
  TOPOLOGIES,
  computeReserve,
  deriveCoverageId,
  escapeDiagnostic,
  hasReasonCode,
  hasVisibleContent,
  isExpectationRef,
  isFingerprint,
  isForbiddenPath,
  isOwnedArtifactPath,
  minimumCap,
  isSafeAgentId,
  isSafeRelativePath,
  parseContext,
  parseKvList,
  safeReadText,
  structuralPreflight,
  validateLedger,
};

if (require.main === module) main(process.argv.slice(2));
