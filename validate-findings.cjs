#!/usr/bin/env node
"use strict";

/*
 * validate-findings.cjs - checks a ui-audit findings.json against
 * report-schema.json, then applies the record rules that a schema cannot say
 * (trace order, severity arithmetic, the performance evidence bar, owned
 * artifact paths, the sibling and baseline severity caps, expectation
 * namespaces, deliberation ids, stronger-model blockers, sorting).
 *
 *   node validate-findings.cjs <findings.json> [--schema <report-schema.json>]
 *
 * When SOURCES.md sits next to this file, every RULE:<id> expectation ref
 * must name a rule of its index. Paths that name an environment file are
 * refused (exit 2) without being opened.
 *
 * Exit 0: "PASS: N findings valid". Exit 1: one "ERROR: <json-pointer>: <message>"
 * line per problem (pointers into the schema start with "schema:"), then
 * "FAIL: N validation error(s)". Exit 2: usage error on stderr.
 *
 * Plain Node 24, no dependencies. Passing proves format only, never that a
 * finding is true.
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

// ==== findings.json validation ====

const FINDINGS_LIMITS = Object.freeze({
  ...SHARED_LIMITS,
  rootItems: 1000,
  nestedItems: 1000,
  objectFields: Number.POSITIVE_INFINITY,
  totalValues: Number.POSITIVE_INFINITY,
  canonicalKeyBytes: 1024 * 1024,
  uniquenessSetBytes: 5 * 1024 * 1024,
});
const LIMITS = FINDINGS_LIMITS;
const SCHEMA_LIMITS = Object.freeze({ ...FINDINGS_LIMITS, rootItems: 1000, nestedItems: 1000 });

const SCHEMA_KEYWORDS = new Set([
  "$comment", "$schema", "additionalProperties", "const", "description", "enum", "items", "maximum",
  "minimum", "minItems", "maxLength", "minLength", "oneOf", "pattern", "properties", "required", "type",
  "uniqueItems", "visibleContent",
]);
const JSON_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);

const SEVERITY_RANK = Object.freeze({ polish: 0, low: 1, medium: 2, high: 3, blocker: 4 });
const FORBIDDEN_BY_VERDICT = Object.freeze({
  confirmed: Object.freeze(["claimed_root_cause", "blockers", "validation_plan", "reason"]),
  needs_validation: Object.freeze(["severity", "execution", "remediation", "reason", "root_cause", "confidence"]),
  rejected: Object.freeze([
    "severity", "execution", "remediation", "blockers", "validation_plan", "root_cause", "confidence",
  ]),
});
const PASS_IF = Object.freeze({
  "<=": (value, threshold) => value <= threshold,
  ">=": (value, threshold) => value >= threshold,
  "<": (value, threshold) => value < threshold,
  ">": (value, threshold) => value > threshold,
  "=": (value, threshold) => value === threshold,
});

// Condition kinds that can evidence a differing figure or task outcome for the
// mechanical sibling_screen cap (rule 7).
const SIBLING_OUTCOME_CONDITION_KINDS = new Set(["data_state", "app_configuration", "user_role", "concurrency"]);

const VISUAL_DIFF_METRICS = new Set(["visual_diff_ratio", "visual_diff_pixels"]);
const UNINTENDED_VISUAL_CHANGE_LENS = "VISUAL-AND-THEMING.md#Unintended visual change";
// Source kinds that may point at a SOURCES.md rule with RULE:<id>.
const RULE_REF_SOURCE_KINDS = new Set(["budget", "standard", "platform_contract"]);

// Which id prefix and outcomes each deliberation kind may carry. A pause can
// close any open item; only a consult can be declined for budget.
const DELIBERATION_RULES = Object.freeze({
  consult: Object.freeze({
    prefix: "dlg-",
    outcomes: Object.freeze(["agreed", "judged_requester", "judged_peer", "judged_neither", "cancelled_budget", "cancelled_pause"]),
  }),
  judge: Object.freeze({
    prefix: "dlg-",
    outcomes: Object.freeze(["judged_requester", "judged_peer", "judged_neither", "cancelled_pause"]),
  }),
  escalation: Object.freeze({
    prefix: "esc-",
    outcomes: Object.freeze(["escalation_resolved", "escalation_unresolved", "escalation_not_funded", "cancelled_pause"]),
  }),
  fallback_panel: Object.freeze({
    prefix: "fb-",
    outcomes: Object.freeze(["panel_agreed", "panel_judged", "panel_majority", "panel_split", "panel_not_funded", "cancelled_pause"]),
  }),
});

// Rule ids of the SOURCES.md index: table rows that start with "| ID |".
const SOURCES_RULE_ROW = /^\| ([A-Z][A-Z0-9]*-\d{2,3}) \|/;
const SOURCES_MAX_BYTES = 2 * 1024 * 1024;

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "non-finite";
  return typeof value;
}

function matchesType(value, type) {
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return jsonType(value) === type;
}

function deepEqual(left, right) {
  if (left === right) return true;
  const type = jsonType(left);
  if (type !== jsonType(right)) return false;
  if (type === "array") return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  if (type === "object") {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

// A canonical, order-independent text form used for uniqueItems and enum
// checks. Throws when the key would exceed its byte budget.
function canonicalKey(value, budget = FINDINGS_LIMITS.canonicalKeyBytes) {
  const parts = [];
  let size = 0;
  const push = (text) => {
    size += Buffer.byteLength(text);
    if (size > budget) throw new RangeError(`canonical form exceeds ${budget} bytes`);
    parts.push(text);
  };
  const visit = (item) => {
    const type = jsonType(item);
    if (type === "array") {
      push("[");
      item.forEach((entry, index) => {
        if (index > 0) push(",");
        visit(entry);
      });
      push("]");
    } else if (type === "object") {
      push("{");
      Object.keys(item).sort().forEach((key, index) => {
        if (index > 0) push(",");
        push(`${JSON.stringify(key)}:`);
        visit(item[key]);
      });
      push("}");
    } else if (type === "number") {
      push(Object.is(item, -0) ? "0" : String(item));
    } else {
      push(JSON.stringify(item) ?? `<${type}>`);
    }
  };
  visit(value);
  return parts.join("");
}

// ---- schema checking ----

function checkSchemaNode(node, pointer, collector, depth) {
  if (depth > SHARED_LIMITS.nestingDepth) {
    collector.add(pointer, "schema nesting is too deep");
    return;
  }
  if (!isPlainObject(node)) {
    collector.add(pointer, "a schema must be an object");
    return;
  }
  for (const key of Object.keys(node)) {
    if (!SCHEMA_KEYWORDS.has(key)) collector.add(pointer, `unsupported keyword ${quote(key)}`);
  }
  for (const key of ["$comment", "$schema", "description"]) {
    if (hasOwn(node, key) && typeof node[key] !== "string") collector.add(pointerJoin(pointer, key), "must be a string");
  }
  if (hasOwn(node, "type")) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    const valid = types.length > 0 && types.every((type) => JSON_TYPES.has(type)) && new Set(types).size === types.length;
    if (!valid) collector.add(pointerJoin(pointer, "type"), `bad type ${quote(node.type)}`);
  }
  if (hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") {
    collector.add(pointerJoin(pointer, "additionalProperties"), "only true or false is supported");
  }
  for (const key of ["uniqueItems", "visibleContent"]) {
    if (hasOwn(node, key) && typeof node[key] !== "boolean") collector.add(pointerJoin(pointer, key), "must be a boolean");
  }
  for (const key of ["minItems", "minLength", "maxLength"]) {
    if (hasOwn(node, key) && !(Number.isInteger(node[key]) && node[key] >= 0)) {
      collector.add(pointerJoin(pointer, key), "must be a non-negative integer");
    }
  }
  for (const key of ["minimum", "maximum"]) {
    if (hasOwn(node, key) && !(typeof node[key] === "number" && Number.isFinite(node[key]))) {
      collector.add(pointerJoin(pointer, key), "must be a finite number");
    }
  }
  if (hasOwn(node, "pattern")) {
    let ok = typeof node.pattern === "string";
    if (ok) {
      try {
        new RegExp(node.pattern, "u");
      } catch {
        ok = false;
      }
    }
    if (!ok) collector.add(pointerJoin(pointer, "pattern"), "invalid pattern");
  }
  if (hasOwn(node, "enum")) {
    if (!Array.isArray(node.enum) || node.enum.length === 0) {
      collector.add(pointerJoin(pointer, "enum"), "must be a non-empty array");
    } else {
      const keys = new Set(node.enum.map((entry) => canonicalKey(entry)));
      if (keys.size !== node.enum.length) collector.add(pointerJoin(pointer, "enum"), "entries must be unique");
    }
  }
  let propertyNames = null;
  if (hasOwn(node, "properties")) {
    if (!isPlainObject(node.properties)) {
      collector.add(pointerJoin(pointer, "properties"), "must be an object");
    } else {
      propertyNames = new Set(Object.keys(node.properties));
      for (const key of propertyNames) {
        checkSchemaNode(node.properties[key], pointerJoin(pointerJoin(pointer, "properties"), key), collector, depth + 1);
      }
    }
  }
  if (hasOwn(node, "required")) {
    const required = node.required;
    if (!Array.isArray(required) || !required.every((key) => typeof key === "string") || new Set(required).size !== required.length) {
      collector.add(pointerJoin(pointer, "required"), "must be an array of unique strings");
    } else {
      for (const key of required) {
        if (propertyNames === null || !propertyNames.has(key)) {
          collector.add(pointerJoin(pointer, "required"), `required key ${quote(key)} is not declared in properties`);
        }
      }
    }
  }
  if (hasOwn(node, "items")) checkSchemaNode(node.items, pointerJoin(pointer, "items"), collector, depth + 1);
  if (hasOwn(node, "oneOf")) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) {
      collector.add(pointerJoin(pointer, "oneOf"), "must be a non-empty array of schemas");
    } else {
      node.oneOf.forEach((branch, index) => checkSchemaNode(branch, pointerJoin(pointerJoin(pointer, "oneOf"), index), collector, depth + 1));
    }
  }
}

function collectSchemaErrors(schema, collector) {
  const before = collector.total;
  try {
    checkSchemaNode(schema, "schema:", collector, 1);
  } catch (error) {
    collector.add("schema:", error instanceof RangeError ? error.message : "schema could not be checked");
  }
  return collector.total === before;
}

function validateSchema(schema) {
  const collector = createCollector();
  collectSchemaErrors(schema, collector);
  return finishErrors(collector);
}

// ---- data against schema ----

function makeContext() {
  return { patterns: new Map(), uniquenessBytes: 0 };
}

function compiledPattern(context, source) {
  let regex = context.patterns.get(source);
  if (!regex) {
    regex = new RegExp(source, "u");
    context.patterns.set(source, regex);
  }
  return regex;
}

function validateAgainst(value, schema, pointer, collector, context) {
  if (hasOwn(schema, "type")) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      collector.add(pointer, `expected ${types.join(" or ")}, found ${jsonType(value)}`);
      return;
    }
  }
  if (hasOwn(schema, "const") && !deepEqual(value, schema.const)) {
    collector.add(pointer, `must equal ${quote(schema.const)}`);
  }
  if (hasOwn(schema, "enum") && !schema.enum.some((entry) => deepEqual(value, entry))) {
    collector.add(pointer, `value ${quote(value)} is not one of the allowed values`);
  }
  if (typeof value === "string") {
    const length = codePointCount(value);
    if (hasOwn(schema, "minLength") && length < schema.minLength) collector.add(pointer, `shorter than ${schema.minLength} characters`);
    if (hasOwn(schema, "maxLength") && length > schema.maxLength) collector.add(pointer, `longer than ${schema.maxLength} characters`);
    if (hasOwn(schema, "pattern") && !compiledPattern(context, schema.pattern).test(value)) {
      collector.add(pointer, `does not match the required pattern`);
    }
    if (schema.visibleContent === true && !hasVisibleContent(value)) {
      collector.add(pointer, "must contain visible text and valid Unicode");
    }
  }
  if (typeof value === "number") {
    if (hasOwn(schema, "minimum") && value < schema.minimum) collector.add(pointer, `must be at least ${schema.minimum}`);
    if (hasOwn(schema, "maximum") && value > schema.maximum) collector.add(pointer, `must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (hasOwn(schema, "minItems") && value.length < schema.minItems) collector.add(pointer, `needs at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems === true) checkUnique(value, pointer, collector, context);
    if (hasOwn(schema, "items")) {
      value.forEach((item, index) => validateAgainst(item, schema.items, pointerJoin(pointer, index), collector, context));
    }
  }
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const key of schema.required || []) {
      if (!hasOwn(value, key)) collector.add(pointer, `missing required field ${quote(key)}`);
    }
    for (const key of Object.keys(value)) {
      if (hasOwn(properties, key)) {
        validateAgainst(value[key], properties[key], pointerJoin(pointer, key), collector, context);
      } else if (schema.additionalProperties === false) {
        collector.add(pointerJoin(pointer, key), "field is not allowed here");
      }
    }
  }
  if (hasOwn(schema, "oneOf")) validateOneOf(value, schema.oneOf, pointer, collector, context);
}

function checkUnique(items, pointer, collector, context) {
  const seen = new Map();
  for (let index = 0; index < items.length; index += 1) {
    let key;
    try {
      key = canonicalKey(items[index]);
    } catch (error) {
      collector.add(pointerJoin(pointer, index), error.message);
      return;
    }
    context.uniquenessBytes += Buffer.byteLength(key);
    if (context.uniquenessBytes > FINDINGS_LIMITS.uniquenessSetBytes) {
      collector.add(pointer, `uniqueness checks exceed ${FINDINGS_LIMITS.uniquenessSetBytes} bytes`);
      return;
    }
    if (seen.has(key)) {
      collector.add(pointerJoin(pointer, index), `duplicates item ${seen.get(key)}`);
    } else {
      seen.set(key, index);
    }
  }
}

function verdictConst(branch) {
  return isPlainObject(branch) && isPlainObject(branch.properties) && isPlainObject(branch.properties.verdict) &&
    hasOwn(branch.properties.verdict, "const")
    ? branch.properties.verdict.const
    : undefined;
}

function validateOneOf(value, branches, pointer, collector, context) {
  if (!isPlainObject(value) && branches.every((branch) => verdictConst(branch) !== undefined)) {
    collector.add(pointer, `expected a record object, found ${jsonType(value)}`);
    return;
  }
  const results = branches.map((branch) => {
    const scratch = createCollector();
    validateAgainst(value, branch, pointer, scratch, context);
    return scratch;
  });
  const passing = results.filter((scratch) => scratch.total === 0).length;
  if (passing === 1) return;
  if (passing > 1) {
    collector.add(pointer, "matches more than one allowed shape");
    return;
  }
  const verdict = isPlainObject(value) ? value.verdict : undefined;
  const index = branches.findIndex((branch) => verdictConst(branch) !== undefined && deepEqual(verdictConst(branch), verdict));
  if (index === -1) {
    collector.add(pointer, `unknown verdict ${quote(verdict)}`);
  } else {
    collector.absorb(results[index]);
  }
}

// ---- record semantics ----

function rank(score) {
  return hasOwn(SEVERITY_RANK, score) ? SEVERITY_RANK[score] : undefined;
}

function checkRoute(value, pointer, collector) {
  if (typeof value === "string" && value !== "static" && !value.startsWith("/")) {
    collector.add(pointer, 'route must start with "/" or be "static"');
  }
}

function checkTrace(trace, pointer, collector) {
  if (!Array.isArray(trace)) return;
  trace.forEach((step, index) => {
    if (isPlainObject(step) && typeof step.file === "string" && !isSafeRelativePath(step.file)) {
      collector.add(pointerJoin(pointerJoin(pointer, index), "file"), "must be a safe repository-relative path");
    }
  });
  const kinds = trace.map((step) => (isPlainObject(step) ? step.kind : undefined));
  if (kinds.length === 1) {
    if (kinds[0] !== "entrypoint" && kinds[0] !== "sink") {
      collector.add(pointer, "a one-step trace must be an entrypoint or a sink");
    }
  } else if (kinds.length > 1) {
    const ordered = kinds[0] === "entrypoint" && kinds[kinds.length - 1] === "sink" &&
      kinds.slice(1, -1).every((kind) => kind === "propagation");
    if (!ordered) collector.add(pointer, "a trace must run entrypoint, propagation..., sink");
  }
}

function checkExpectationNamespaces(item, pointer, collector, ruleIds) {
  if (!isPlainObject(item.expectation)) return;
  const { ref, source_kind: kind } = item.expectation;
  const refPointer = pointerJoin(pointerJoin(pointer, "expectation"), "ref");
  if (typeof ref !== "string") return;
  if (!isExpectationRef(ref)) {
    collector.add(refPointer, "is not in a recognised expectation namespace");
    return;
  }
  const isBaseline = ref.startsWith("baseline:");
  if (kind === "approved_baseline" && !isBaseline) {
    collector.add(refPointer, 'source_kind "approved_baseline" needs a baseline:<baseline-id>#<capture-key> ref');
  }
  if (isBaseline && typeof kind === "string" && kind !== "approved_baseline") {
    collector.add(refPointer, 'a baseline: ref needs source_kind "approved_baseline"');
  }
  if (ref.startsWith("RULE:")) {
    if (typeof kind === "string" && !RULE_REF_SOURCE_KINDS.has(kind)) {
      collector.add(refPointer, "a RULE: ref is allowed only for source_kind budget, standard or platform_contract");
    }
    if (ruleIds !== undefined && !ruleIds.has(ref.slice("RULE:".length))) {
      collector.add(refPointer, `rule ${quote(ref.slice("RULE:".length))} is not in the SOURCES.md rule index`);
    }
  }
}

function checkDeliberation(list, pointer, collector) {
  if (!Array.isArray(list)) return;
  const seen = new Map();
  list.forEach((entry, index) => {
    if (!isPlainObject(entry) || typeof entry.id !== "string") return;
    const at = pointerJoin(pointer, index);
    if (seen.has(entry.id)) collector.add(pointerJoin(at, "id"), `duplicates the deliberation id of item ${seen.get(entry.id)}`);
    else seen.set(entry.id, index);
    const rule = hasOwn(DELIBERATION_RULES, entry.kind) ? DELIBERATION_RULES[entry.kind] : null;
    if (rule === null) return;
    if (!entry.id.startsWith(rule.prefix)) {
      collector.add(pointerJoin(at, "id"), `a ${entry.kind} entry needs an id that starts with ${rule.prefix}`);
    }
    if (typeof entry.outcome === "string" && !rule.outcomes.includes(entry.outcome)) {
      collector.add(pointerJoin(at, "outcome"), `outcome ${quote(entry.outcome)} does not belong to a ${entry.kind} entry`);
    }
  });
}

function checkStrongerModelNeeded(item, pointer, collector) {
  const needed = item.stronger_model_needed;
  if (!isPlainObject(needed) || typeof needed.tier !== "string" || !MODEL_ALIASES.includes(needed.tier)) return;
  const blockers = Array.isArray(item.blockers) ? item.blockers : [];
  const named = blockers.some((line) => typeof line === "string" && line.toLowerCase().includes(needed.tier));
  if (!named) {
    collector.add(pointerJoin(pointer, "blockers"), `stronger_model_needed names ${needed.tier}; a blockers entry must name that tier`);
  }
}

function checkFindingSemantics(item, pointer, collector, options = {}) {
  const verdict = item.verdict;
  const at = (key) => pointerJoin(pointer, key);

  checkExpectationNamespaces(item, pointer, collector, options.ruleIds);
  checkDeliberation(item.deliberation, at("deliberation"), collector);
  if (verdict === "needs_validation") checkStrongerModelNeeded(item, pointer, collector);
  if (isPlainObject(item.surface)) checkRoute(item.surface.route, pointerJoin(at("surface"), "route"), collector);
  if (Array.isArray(item.also_affects)) {
    item.also_affects.forEach((entry, index) => {
      if (isPlainObject(entry)) checkRoute(entry.route, pointerJoin(pointerJoin(at("also_affects"), index), "route"), collector);
    });
  }
  checkTrace(item.trace, at("trace"), collector);
  if (Array.isArray(item.evidence)) {
    item.evidence.forEach((entry, index) => {
      if (isPlainObject(entry) && typeof entry.file === "string" && !isSafeRelativePath(entry.file)) {
        collector.add(pointerJoin(pointerJoin(at("evidence"), index), "file"), "must be a safe relative path");
      }
    });
  }
  if (verdict !== "confirmed") {
    if (verdict === "needs_validation" && isPlainObject(item.validation_plan)) {
      const keys = ["local", "device", "owner"].filter((key) => hasVisibleContent(item.validation_plan[key]));
      if (keys.length === 0) collector.add(at("validation_plan"), "needs at least one of local, device or owner");
    }
    return;
  }

  const execution = isPlainObject(item.execution) ? item.execution : {};
  const remediation = isPlainObject(item.remediation) ? item.remediation : {};
  if (Array.isArray(remediation.code_changes)) {
    remediation.code_changes.forEach((change, index) => {
      if (isPlainObject(change) && typeof change.file_name === "string" && !isSafeRelativePath(change.file_name)) {
        collector.add(pointerJoin(pointerJoin(pointerJoin(at("remediation"), "code_changes"), index), "file_name"), "must be a safe relative path");
      }
    });
  }
  if (Array.isArray(execution.artifacts)) {
    execution.artifacts.forEach((artifact, index) => {
      if (typeof artifact === "string" && !isOwnedArtifactPath(artifact)) {
        collector.add(pointerJoin(pointerJoin(at("execution"), "artifacts"), index),
          "must be an owned artifact path agents/<id>/artifacts/<file> with an allowed extension");
      }
    });
  }

  const severity = isPlainObject(item.severity) ? item.severity : {};
  const impact = rank(isPlainObject(severity.impact) ? severity.impact.score : undefined);
  const overall = rank(severity.overall);
  const reach = isPlainObject(severity.reach) ? severity.reach.score : undefined;
  if (impact !== undefined && overall !== undefined) {
    if (overall > impact) collector.add(pointerJoin(at("severity"), "overall"), "cannot be above the impact score");
    if (overall < impact - 2) collector.add(pointerJoin(at("severity"), "overall"), "cannot be more than two levels below the impact score");
    if (reach === "narrow" && impact > 0 && overall > impact - 1) {
      collector.add(pointerJoin(at("severity"), "overall"), "narrow reach must lower the overall score by at least one level");
    }
  }

  const method = execution.method;
  if (method === "scan" && (execution.build_mode !== "none" || execution.topology !== "none")) {
    collector.add(at("execution"), 'method "scan" requires build_mode "none" and topology "none"');
  }
  if (method === "browser" && (execution.build_mode === "none" || execution.topology === "none")) {
    collector.add(at("execution"), 'method "browser" needs a real build_mode and topology');
  }
  const measurements = Array.isArray(execution.measurements) ? execution.measurements : [];
  if (typeof item.lens === "string" && item.lens.startsWith("PERFORMANCE.md#")) {
    const ok = method === "browser" && execution.build_mode === "production" &&
      typeof execution.topology === "string" && execution.topology !== "none" &&
      measurements.some((entry) => isPlainObject(entry) && Number.isInteger(entry.runs) && entry.runs >= 3);
    if (!ok) {
      collector.add(at("execution"),
        "a performance finding needs method browser, a production build, a recorded topology and a measurement with runs >= 3");
    }
  }
  measurements.forEach((entry, index) => {
    if (!isPlainObject(entry) || entry.threshold === null || typeof entry.threshold !== "number") return;
    const test = PASS_IF[entry.pass_if];
    if (test && typeof entry.value === "number" && test(entry.value, entry.threshold)) {
      collector.add(pointerJoin(pointerJoin(at("execution"), "measurements"), index),
        `value ${entry.value} meets its own passing condition ${entry.pass_if} ${entry.threshold}; it is not a failure`);
    }
  });
  const conditions = Array.isArray(item.conditions) ? item.conditions : [];
  const outcomeCondition = conditions.some((entry) =>
    isPlainObject(entry) && SIBLING_OUTCOME_CONDITION_KINDS.has(entry.kind));
  const sourceKind = isPlainObject(item.expectation) ? item.expectation.source_kind : undefined;
  if (sourceKind === "sibling_screen" && overall !== undefined && overall > SEVERITY_RANK.low) {
    // conditions[] has minItems 1 on this branch, so "any condition" would never bite.
    // Only an evidenced figure (a measurement) or a condition kind that can change a
    // figure or a task outcome lifts the low cap.
    if (!outcomeCondition && measurements.length === 0) {
      collector.add(pointerJoin(at("severity"), "overall"),
        "a sibling_screen expectation above low needs an execution.measurements entry or a conditions[] entry of kind " +
        "data_state, app_configuration, user_role or concurrency showing a differing figure or task outcome");
    }
  }
  if (sourceKind === "approved_baseline" && overall !== undefined && overall > SEVERITY_RANK.low) {
    // A pixel difference alone never lifts the cap: the differing figure or
    // task outcome must be measured or named as a condition.
    const otherMeasurement = measurements.some((entry) => isPlainObject(entry) && !VISUAL_DIFF_METRICS.has(entry.metric));
    if (!outcomeCondition && !otherMeasurement) {
      collector.add(pointerJoin(at("severity"), "overall"),
        "an approved_baseline expectation above low needs a measurement other than visual_diff_ratio or visual_diff_pixels, " +
        "or a conditions[] entry of kind data_state, app_configuration, user_role or concurrency");
    }
  }
  if (item.lens === UNINTENDED_VISUAL_CHANGE_LENS &&
      !measurements.some((entry) => isPlainObject(entry) && VISUAL_DIFF_METRICS.has(entry.metric))) {
    collector.add(pointerJoin(at("execution"), "measurements"),
      "a confirmed unintended visual change needs a visual_diff_ratio or visual_diff_pixels measurement");
  }
}

// ---- promoted evidence on disk (--run-dir) ----

// Every execution.artifacts path must name a file the parent promoted into
// <run-dir>/agents/<id>/artifacts/, reached without links.
function checkPromotedArtifacts(data, runDir, collector) {
  data.forEach((item, index) => {
    if (!isPlainObject(item) || !isPlainObject(item.execution) || !Array.isArray(item.execution.artifacts)) return;
    item.execution.artifacts.forEach((artifact, position) => {
      if (typeof artifact !== "string" || !isOwnedArtifactPath(artifact)) return;
      if (!artifactExistsUnder(runDir, artifact)) {
        collector.add(`/${index}/execution/artifacts/${position}`, `${quote(artifact)} was not promoted: no regular file at that path under --run-dir`);
      }
    });
  });
}

// ---- entry points ----

function loadDefaultSchema() {
  return readJsonDocument(require("node:path").join(__dirname, "report-schema.json"), SCHEMA_LIMITS);
}

// Rule ids from the index rows of a SOURCES.md text.
function parseRuleIds(text) {
  const ids = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const match = SOURCES_RULE_ROW.exec(line);
    if (match) ids.add(match[1]);
  }
  return ids;
}

// Reads SOURCES.md next to this validator. Returns undefined when the file
// does not exist (existence of RULE: ids is then not checked).
function loadRuleIds(filePath = require("node:path").join(__dirname, "SOURCES.md")) {
  try {
    require("node:fs").lstatSync(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
  }
  return parseRuleIds(safeReadText(filePath, SOURCES_MAX_BYTES));
}

function normaliseOptions(options) {
  const out = {};
  if (isPlainObject(options) && options.ruleIds !== undefined && options.ruleIds !== null) {
    out.ruleIds = options.ruleIds instanceof Set ? options.ruleIds : new Set(Array.from(options.ruleIds));
  }
  return out;
}

function runFindings(data, schema, collector, options = {}) {
  if (!collectSchemaErrors(schema, collector)) return;
  if (!Array.isArray(data)) {
    collector.add("", "findings.json must be a top-level array");
    return;
  }
  const violation = dataLimitViolation(data, FINDINGS_LIMITS);
  if (violation) {
    collector.add(violation.pointer, violation.message);
    return;
  }
  const context = makeContext();
  const rootRest = { ...schema };
  delete rootRest.items;
  validateAgainst(data, rootRest, "", collector, context);
  const itemSchema = isPlainObject(schema.items) ? schema.items : {};
  const fingerprints = [];
  data.forEach((item, index) => {
    const pointer = pointerJoin("", index);
    let shaped = item;
    if (isPlainObject(item) && hasOwn(FORBIDDEN_BY_VERDICT, item.verdict)) {
      shaped = { ...item };
      for (const key of FORBIDDEN_BY_VERDICT[item.verdict]) {
        if (hasOwn(item, key)) {
          collector.add(pointerJoin(pointer, key), `field is forbidden for verdict ${quote(item.verdict)}`);
          delete shaped[key];
        }
      }
    }
    validateAgainst(shaped, itemSchema, pointer, collector, context);
    if (isPlainObject(item)) {
      checkFindingSemantics(item, pointer, collector, options);
      fingerprints.push({ index, value: item.fingerprint });
    }
  });
  const firstSeen = new Map();
  let previous = null;
  for (const { index, value } of fingerprints) {
    if (typeof value !== "string") continue;
    const pointer = pointerJoin(pointerJoin("", index), "fingerprint");
    if (firstSeen.has(value)) {
      collector.add(pointer, `duplicates the fingerprint of item ${firstSeen.get(value)}`);
    } else {
      firstSeen.set(value, index);
    }
    if (previous !== null && value < previous) collector.add(pointer, "items must be sorted by fingerprint");
    previous = value;
  }
}

// options.ruleIds: a Set or array of SOURCES.md rule ids; when undefined the
// existence of RULE: ids is not checked.
function validateFindings(data, schema, options) {
  const collector = createCollector();
  let resolved = schema;
  if (resolved === undefined) {
    try {
      resolved = loadDefaultSchema();
    } catch (error) {
      collector.add("schema:", error instanceof SafeReadError ? error.message : "schema could not be read");
      return finishErrors(collector);
    }
  }
  runFindings(data, resolved, collector, normaliseOptions(options));
  return finishErrors(collector);
}

const USAGE = "usage: node validate-findings.cjs <findings.json> [--schema <report-schema.json>] [--run-dir <run directory>]";

function main(argv) {
  const parsed = parseCli(argv, ["--schema", "--run-dir"]);
  if (parsed.error) {
    process.stderr.write(`${escapeDiagnostic(parsed.error)}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const path = require("node:path");
  const forbidden = [parsed.input, parsed.options["--schema"]].find((entry) => isForbiddenPath(entry));
  if (forbidden !== undefined) {
    process.stderr.write(`refusing to open an environment file: ${escapeDiagnostic(quote(forbidden))}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const collector = createCollector();
  const schemaPath = parsed.options["--schema"] ?? path.join(__dirname, "report-schema.json");
  let ruleIds;
  try {
    ruleIds = loadRuleIds();
  } catch (error) {
    collector.add("SOURCES.md:", error instanceof SafeReadError ? error.message : "SOURCES.md could not be read");
  }
  let schema;
  try {
    schema = readJsonDocument(schemaPath, SCHEMA_LIMITS);
  } catch (error) {
    collector.add("schema:", error instanceof SafeReadError ? error.message : "schema could not be read");
  }
  let data;
  if (schema !== undefined) {
    try {
      data = readJsonDocument(parsed.input, FINDINGS_LIMITS);
    } catch (error) {
      collector.add("", error instanceof SafeReadError ? error.message : "input could not be read");
    }
  }
  if (schema !== undefined && collector.total === 0) runFindings(data, schema, collector, { ruleIds });
  if (parsed.options["--run-dir"] !== undefined && Array.isArray(data)) {
    checkPromotedArtifacts(data, parsed.options["--run-dir"], collector);
  }
  const count = Array.isArray(data) ? data.length : 0;
  emitResult(collector, `PASS: ${count} findings valid`);
}

module.exports = {
  ALLOWED_ARTIFACT_EXTENSIONS,
  artifactExistsUnder,
  checkPromotedArtifacts,
  AGENT_ID,
  BLOCK_CATALOG,
  BLOCK_REFS,
  CLASS_BLOCK_REFS,
  COMPANION_META_BLOCKS,
  DELIBERATION_RULES,
  EFFORT_LEVELS,
  FINGERPRINT,
  FORBIDDEN_BY_VERDICT,
  LIMITS,
  MODEL_ALIASES,
  SELF_ASSESSMENT_LEVELS,
  SEVERITY_RANK,
  SHARED_LIMITS,
  canonicalKey,
  codePointCount,
  computeReserve,
  escapeDiagnostic,
  hasVisibleContent,
  isExpectationRef,
  isFingerprint,
  isForbiddenPath,
  isOwnedArtifactPath,
  isSafeAgentId,
  isSafeRelativePath,
  loadRuleIds,
  minimumCap,
  parseRuleIds,
  safeReadText,
  structuralPreflight,
  validateFindings,
  validateSchema,
};

if (require.main === module) main(process.argv.slice(2));
