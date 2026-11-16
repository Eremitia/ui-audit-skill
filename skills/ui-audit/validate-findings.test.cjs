"use strict";

// Tests for validate-findings.cjs and report-schema.json.
// Run from the skill directory: node --test validate-findings.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "validate-findings.cjs");
const LEDGER_SCRIPT = path.join(__dirname, "validate-coverage-ledger.cjs");
const ORCHESTRATION_SCRIPT = path.join(__dirname, "validate-orchestration.cjs");
const CONFIG_CASES = path.join(__dirname, "test-fixtures", "config-cases.json");
const SCHEMA_PATH = path.join(__dirname, "report-schema.json");
const v = require(SCRIPT);
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

const ch = (code) => String.fromCodePoint(code);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ui-audit-findings-"));
let fileCounter = 0;
function tmpFile(content, name) {
  const file = path.join(tmpRoot, name || `input-${fileCounter++}.json`);
  fs.writeFileSync(file, typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  return file;
}
function cli(args, extra = {}) {
  return spawnSync(process.execPath, [...(extra.nodeArgs || []), SCRIPT, ...args], { encoding: "utf8", timeout: 60000 });
}
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// ---- fixture builders ----

function base(overrides) {
  return {
    fingerprint: "checkout/double-submit/checkout-dialog/order-created-twice",
    title: "The order is sent twice on a double tap",
    description: "On a slow network, two quick taps on Confirm create two orders.",
    lens: "FUNCTIONAL-FLOWS.md#Double submit and idempotent actions",
    persona: { role: "customer", label: "Customer" },
    surface: { route: "/shop/[slug]", component: "CheckoutDialog", state: "confirmation dialog open" },
    context: {
      viewport: { id: "m390", width: 390, height: 844, dpr: 3 },
      theme: "light",
      input_modality: "touch",
      network: "slow4g",
      data_state: "typical",
    },
    expectation: {
      source_kind: "business_rule",
      ref: "src/lib/orders/cart.ts#fitToStock",
      statement: "One tap on Confirm creates exactly one order.",
    },
    trace: [
      { kind: "entrypoint", file: "src/components/checkout/CheckoutDialog.tsx", line: 40, scope: "onConfirm", description: "Sends without blocking a second send." },
      { kind: "sink", file: "src/lib/orders/submit.ts", line: 12, scope: "submitOrder", description: "Inserts the order." },
    ],
    evidence: [{ file: "agents/h1-checkout/artifacts/probe/m390.light.json", line: 1, description: "Two rows after a double tap." }],
    ...overrides,
  };
}

function confirmed(overrides = {}) {
  return base({
    verdict: "confirmed",
    root_cause: "The button is not disabled and the server does not deduplicate.",
    conditions: [{ kind: "network_condition", description: "slow4g makes the window visible." }],
    execution: {
      method: "browser",
      build_mode: "production",
      topology: "nat-forward",
      user_perspective: "The customer sees two orders and pays twice.",
      inputs: ["account audit-h1-customer", "agents/h1-checkout/scratch/in/checkout.json"],
      steps: ["Open /shop/audit-h1", "Add one item", "Tap Confirm twice within 50 ms"],
      expected_result: "One order.",
      observed_result: "Two orders and two stock movements.",
      artifacts: ["agents/h1-checkout/artifacts/probe/m390.light.view.png"],
    },
    remediation: { strategy: "Disable on submit and deduplicate by token.", regression_check: "Double-submit test with a row count." },
    severity: {
      impact: { score: "blocker", reason: "Wrong money and stock." },
      reach: { score: "all_users", reason: "Every customer on a slow network." },
      overall: "blocker",
    },
    confidence: { score: "high", reason: "Reproduced three times." },
    ...overrides,
  });
}

function needsValidation(overrides = {}) {
  return base({
    verdict: "needs_validation",
    fingerprint: "checkout/dialogs/checkout-dialog/ios-keyboard-covers-confirm",
    lens: "RESPONSIVE-AND-LAYOUT.md#Dialogs and on-screen keyboard",
    claimed_root_cause: "The dialog uses 100vh instead of visualViewport.",
    blockers: ["Needs the real iOS Safari keyboard."],
    validation_plan: { device: "Open the shop on an iPhone and focus the phone field." },
    ...overrides,
  });
}

function rejected(overrides = {}) {
  return base({
    verdict: "rejected",
    fingerprint: "admin/theme/orders/contrast-on-brand",
    lens: "ACCESSIBILITY.md#Text and non-text contrast",
    claimed_root_cause: "on-brand over brand does not reach 4.5:1.",
    reason: "The verifier measures 5.1:1; the earlier finding used a colour before compositing.",
    ...overrides,
  });
}

const errorsOf = (data) => v.validateFindings(data, schema);
const hasError = (errors, fragment) => errors.some((line) => line.includes(fragment));

// ---- schema and catalog ----

test("report-schema.json passes its own keyword check", () => {
  assert.deepEqual([...v.validateSchema(schema)], []);
});

test("lens enum equals the class subset of BLOCK_REFS, in order", () => {
  const classSubset = v.BLOCK_REFS.filter((ref) => !v.COMPANION_META_BLOCKS.some((meta) => ref.endsWith(`#${meta}`)));
  assert.deepEqual(classSubset, v.CLASS_BLOCK_REFS);
  for (const branch of schema.items.oneOf) assert.deepEqual(branch.properties.lens.enum, classSubset);
  assert.equal(classSubset.length, 90);
  assert.equal(v.BLOCK_REFS.length, 90 + 7 * 3);
});

test("meta blocks are block refs but never lenses", () => {
  assert.ok(v.BLOCK_REFS.includes("PERFORMANCE.md#Core discipline"));
  const errors = errorsOf([confirmed({ lens: "PERFORMANCE.md#Core discipline" })]);
  assert.ok(hasError(errors, "/0/lens"));
});

test("schema keyword rejection covers each unsupported construct", () => {
  const cases = [
    [{ type: "array", items: { $ref: "#/x" } }, "unsupported keyword"],
    [{ type: "object", additionalProperties: {} }, "only true or false"],
    [{ type: "strnig" }, "bad type"],
    [{ type: "string", pattern: "([" }, "invalid pattern"],
    [{ type: "object", properties: { a: {} }, required: ["b"] }, "not declared in properties"],
    [{ type: "array", items: { oneOf: [] } }, "non-empty array"],
    [{ type: "string", maxLength: -1 }, "non-negative integer"],
  ];
  for (const [bad, fragment] of cases) {
    const errors = v.validateSchema(bad);
    assert.ok(hasError(errors, fragment), `${JSON.stringify(bad)} -> ${errors}`);
    assert.ok(errors.every((line) => line.startsWith("schema:")));
  }
});

test("a broken schema stops validation of the data", () => {
  const errors = v.validateFindings([confirmed()], { type: "array", items: { format: "x" } });
  assert.equal(errors.length, 1);
  assert.ok(hasError(errors, "unsupported keyword"));
});

// ---- branch acceptance and forbidden fields ----

test("each verdict branch accepts its fixture", () => {
  const data = [confirmed(), needsValidation(), rejected()].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
  assert.deepEqual([...errorsOf(data)], []);
});

test("confirmed forbids claimed_root_cause, blockers, validation_plan and reason", () => {
  for (const key of v.FORBIDDEN_BY_VERDICT.confirmed) {
    const record = confirmed({ [key]: key === "validation_plan" ? { local: "x" } : key === "blockers" ? ["x"] : "x" });
    const errors = errorsOf([record]);
    assert.ok(hasError(errors, `/0/${key}: field is forbidden for verdict "confirmed"`), errors.join("\n"));
    assert.equal(errors.length, 1, errors.join("\n"));
  }
});

test("needs_validation forbids severity, execution, remediation, reason, root_cause and confidence", () => {
  const full = confirmed();
  for (const key of v.FORBIDDEN_BY_VERDICT.needs_validation) {
    const errors = errorsOf([needsValidation({ [key]: full[key] ?? "x" })]);
    assert.ok(hasError(errors, `/0/${key}: field is forbidden`), `${key}: ${errors}`);
  }
});

test("rejected forbids the confirmed and needs_validation extras", () => {
  const full = { ...confirmed(), ...needsValidation() };
  for (const key of v.FORBIDDEN_BY_VERDICT.rejected) {
    const errors = errorsOf([rejected({ [key]: full[key] ?? "x" })]);
    assert.ok(hasError(errors, `/0/${key}: field is forbidden`), `${key}: ${errors}`);
  }
});

test("an unknown verdict yields exactly one error", () => {
  const errors = errorsOf([{ ...confirmed(), verdict: "plausible" }]);
  assert.equal(errors.length, 1);
  assert.ok(hasError(errors, "unknown verdict"));
});

test("a missing required field is reported on the matching branch only", () => {
  const record = confirmed();
  delete record.remediation;
  const errors = errorsOf([record]);
  assert.deepEqual([...errors], ['/0: missing required field "remediation"']);
});

test("needs_validation needs at least one validation plan key", () => {
  const errors = errorsOf([needsValidation({ validation_plan: {} })]);
  assert.ok(hasError(errors, "needs at least one of local, device or owner"));
});

// ---- prose and Unicode ----

test("empty and invisible prose is rejected", () => {
  for (const title of ["", "   ", ch(0x200b) + ch(0x200d), ch(0xfeff), ch(0x2028) + ch(0x0007)]) {
    const errors = errorsOf([confirmed({ title })]);
    assert.ok(hasError(errors, "/0/title"), JSON.stringify(title));
  }
  const errors = errorsOf([confirmed({ remediation: { strategy: "\t\n", regression_check: "ok" } })]);
  assert.ok(hasError(errors, "/0/remediation/strategy"));
});

test("lone surrogates are not valid prose", () => {
  const errors = errorsOf([confirmed({ description: "text " + String.fromCharCode(0xd800) })]);
  assert.ok(hasError(errors, "/0/description"));
});

test("length limits count code points, not UTF-16 units", () => {
  const emoji = ch(0x1f3df);
  assert.deepEqual([...errorsOf([confirmed({ title: emoji.repeat(200) })])], []);
  assert.ok(hasError(errorsOf([confirmed({ title: emoji.repeat(201) })]), "longer than 200"));
});

test("control characters are escaped in CLI output", () => {
  const nasty = "x" + ch(0x1b) + "[31m" + ch(0x202e) + ch(0x2028);
  const result = cli([tmpFile([{ ...confirmed(), verdict: nasty }])]);
  assert.equal(result.status, 1);
  assert.ok(![...result.stdout].some((c) => [0x1b, 0x202e, 0x2028].includes(c.codePointAt(0))));
  for (const escaped of ["u001b", "u202e", "u2028"]) assert.ok(result.stdout.includes("\\" + escaped), escaped);
});

test("error keys with control characters are escaped too", () => {
  const record = confirmed({ ["bad" + ch(0x1b) + "key"]: 1 });
  const result = cli([tmpFile([record])]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("bad\\u001bkey"));
});

// ---- paths ----

test("safe relative path corpus", () => {
  const good = ["src/app/page.tsx", "src/app/(menu)/shop/[slug]/page.tsx", "a/b.c/d", "README.md", "con-tab/x", "com10.txt"];
  const bad = [
    "", " a", "a ", "/etc/passwd", "~/x", "C:/x", "C:\\x", "a\\b", "\\\\server\\share", "a//b", "./a", "a/./b", "a/../b",
    "..", "a/b.", "a/b ", "con", "CON.txt", "src/aux/x", "nul.json", "com1", "LPT9.log", "com" + ch(0xb9), "clock$",
    "conin$", "a<b", "a>b", "a|b", "a?b", "a*b", 'a"b', "a" + ch(0) + "b", "a" + ch(0x200b) + "b", "a" + ch(0x2028),
    String.fromCharCode(0xdc00),
  ];
  for (const entry of good) assert.ok(v.isSafeRelativePath(entry), entry);
  for (const entry of bad) assert.ok(!v.isSafeRelativePath(entry), JSON.stringify(entry));
});

test("owned artifact path corpus", () => {
  assert.ok(v.isOwnedArtifactPath("agents/h1-checkout/artifacts/probe/x.PNG"));
  assert.ok(v.isOwnedArtifactPath("agents/v2-cash/artifacts/a.har", "v2-cash"));
  const bad = [
    "agents/h1-checkout/artifacts/",
    "agents/h1-checkout/artifacts/x.exe",
    "agents/h1-checkout/artifacts/noext",
    "agents/H1/artifacts/x.png",
    "agents/con/artifacts/x.png",
    "agents/h1/scratch/out/x.png",
    "agents/h1/artifacts/storage/state.json",
    "agents/h1/artifacts/run/Profile/Default.json",
    "out/x.png",
    "agents/h1/artifacts/../x.png",
  ];
  for (const entry of bad) assert.ok(!v.isOwnedArtifactPath(entry), entry);
  assert.ok(!v.isOwnedArtifactPath("agents/h1/artifacts/x.png", "h2"));
});

test("confirmed execution artifacts must be owned paths", () => {
  const errors = errorsOf([confirmed({ execution: { ...confirmed().execution, artifacts: ["agents/h1-checkout/scratch/out/x.png"] } })]);
  assert.ok(hasError(errors, "/0/execution/artifacts/0"));
});

test("trace, evidence and code_changes files must be safe", () => {
  const record = confirmed({
    evidence: [{ file: "C:/data/x.png", line: 1, description: "x" }],
    remediation: { strategy: "x", regression_check: "y", code_changes: [{ file_name: "../outside.ts", fixed_code: "x" }] },
  });
  record.trace[0].file = "/abs/path.ts";
  const errors = errorsOf([record]);
  assert.ok(hasError(errors, "/0/trace/0/file"));
  assert.ok(hasError(errors, "/0/evidence/0/file"));
  assert.ok(hasError(errors, "/0/remediation/code_changes/0/file_name"));
});

// ---- trace shape ----

test("trace order rules", () => {
  const step = (kind) => ({ kind, file: "src/a.ts", line: 1, scope: "s", description: kind });
  const ok = [[step("sink")], [step("entrypoint")], [step("entrypoint"), step("propagation"), step("propagation"), step("sink")]];
  const bad = [[step("propagation")], [step("sink"), step("entrypoint")], [step("entrypoint"), step("sink"), step("sink")]];
  for (const trace of ok) assert.deepEqual([...errorsOf([confirmed({ trace: trace.map((s, i) => ({ ...s, line: i + 1 })) })])], []);
  for (const trace of bad) {
    assert.ok(hasError(errorsOf([confirmed({ trace: trace.map((s, i) => ({ ...s, line: i + 1 })) })]), "/0/trace"));
  }
  assert.ok(hasError(errorsOf([confirmed({ trace: [{ ...step("sink"), line: 0 }] })]), "at least 1"));
  assert.ok(hasError(errorsOf([confirmed({ trace: [{ ...step("sink"), line: 1.5 }] })]), "expected integer"));
});

// ---- sorting and duplicates ----

test("fingerprints must be sorted and unique", () => {
  const a = confirmed({ fingerprint: "a/x" });
  const b = confirmed({ fingerprint: "b/x" });
  assert.deepEqual([...errorsOf([a, b])], []);
  assert.ok(hasError(errorsOf([b, a]), "sorted by fingerprint"));
  assert.ok(hasError(errorsOf([a, confirmed({ fingerprint: "a/x" })]), "duplicates the fingerprint"));
});

test("fingerprint pattern and length", () => {
  for (const fingerprint of ["menu/café/x", "-lead", "a b", "a".repeat(201), "orders:12/x\n"]) {
    assert.ok(hasError(errorsOf([confirmed({ fingerprint })]), "/0/fingerprint"), fingerprint);
  }
  assert.deepEqual([...errorsOf([confirmed({ fingerprint: "a".repeat(200) })])], []);
});

test("top level must be an array", () => {
  assert.ok(hasError(errorsOf({ findings: [] }), "top-level array"));
});

// ---- severity ----

test("impact x reach severity matrix", () => {
  const scores = ["polish", "low", "medium", "high", "blocker"];
  for (const reach of ["all_users", "core_persona", "segment", "narrow"]) {
    for (let impact = 0; impact < 5; impact += 1) {
      for (let overall = 0; overall < 5; overall += 1) {
        let allowed = overall <= impact && overall >= impact - 2;
        if (reach === "narrow" && impact > 0) allowed = allowed && overall <= impact - 1;
        const record = confirmed({
          severity: {
            impact: { score: scores[impact], reason: "r" },
            reach: { score: reach, reason: "r" },
            overall: scores[overall],
          },
        });
        const errors = errorsOf([record]);
        assert.equal(errors.length === 0, allowed, `${reach} ${scores[impact]} -> ${scores[overall]}: ${errors}`);
      }
    }
  }
});

// ---- execution rules ----

test("scan findings use build_mode none and topology none", () => {
  const scan = { ...confirmed().execution, method: "scan", build_mode: "production", topology: "none" };
  assert.ok(hasError(errorsOf([confirmed({ execution: scan })]), 'method "scan" requires'));
  const fine = { ...scan, build_mode: "none" };
  assert.deepEqual([...errorsOf([confirmed({ execution: fine })])], []);
});

test("browser findings name a build and a topology", () => {
  const execution = { ...confirmed().execution, topology: "none" };
  assert.ok(hasError(errorsOf([confirmed({ execution })]), 'method "browser" needs'));
});

function perfRecord(executionOverrides) {
  return confirmed({
    lens: "PERFORMANCE.md#Largest paint and render-blocking",
    severity: { impact: { score: "high", reason: "r" }, reach: { score: "all_users", reason: "r" }, overall: "high" },
    execution: {
      ...confirmed().execution,
      measurements: [{ metric: "lcp_ms", value: 5200, unit: "ms", threshold: 4000, pass_if: "<=", runs: 3, aggregation: "median", profile: "m390 slow4g cpu4x nat-forward" }],
      ...executionOverrides,
    },
  });
}

test("performance lens rule: browser, production, topology and runs >= 3", () => {
  assert.deepEqual([...errorsOf([perfRecord({})])], []);
  const bad = [
    { build_mode: "development" },
    { topology: "none" },
    { method: "test" },
    { measurements: [{ metric: "lcp_ms", value: 5200, unit: "ms", threshold: 4000, pass_if: "<=", runs: 1, aggregation: "single", profile: "p" }] },
    { measurements: [] },
  ];
  for (const overrides of bad) {
    assert.ok(hasError(errorsOf([perfRecord(overrides)]), "a performance finding needs"), JSON.stringify(overrides));
  }
});

test("a measurement that meets its own threshold is an error, in both directions", () => {
  const m = (value, threshold, passIf) => perfRecord({
    measurements: [{ metric: "contrast_ratio", value, unit: "ratio", threshold, pass_if: passIf, runs: 3, aggregation: "median", profile: "p" }],
  });
  assert.deepEqual([...errorsOf([m(3.2, 4.5, ">=")])], []);
  assert.ok(hasError(errorsOf([m(5.1, 4.5, ">=")]), "meets its own passing condition"));
  assert.deepEqual([...errorsOf([m(5200, 4000, "<=")])], []);
  assert.ok(hasError(errorsOf([m(2400, 4000, "<=")]), "meets its own passing condition"));
  assert.ok(hasError(errorsOf([m(10, 10, "=")]), "meets its own passing condition"));
  assert.deepEqual([...errorsOf([m(10, null, "<=")])], []);
});

test("measurement ranges: runs 1-20 and pass_if enum", () => {
  const record = perfRecord({ measurements: [{ metric: "lcp_ms", value: 5000, unit: "ms", threshold: 4000, pass_if: "<<", runs: 21, aggregation: "median", profile: "p" }] });
  const errors = errorsOf([record]);
  assert.ok(hasError(errors, "runs: must be at most 20"));
  assert.ok(hasError(errors, "pass_if"));
});

test("mechanical sibling cap: above low needs a measurement or an outcome condition", () => {
  const sibling = { source_kind: "sibling_screen", ref: "sibling:src/app/admin/orders/page.tsx", statement: "Orders shows the total without decimals." };
  const medium = { impact: { score: "medium", reason: "r" }, reach: { score: "all_users", reason: "r" }, overall: "medium" };
  // Schema-valid record: one network_condition, no measurements -> must FAIL.
  const networkOnly = errorsOf([confirmed({ expectation: sibling, severity: medium })]);
  assert.ok(hasError(networkOnly, "sibling_screen expectation above low"));
  assert.equal(networkOnly.filter((e) => e.includes("sibling_screen")).length, 1);
  // Same record with a failing measurement -> PASS.
  const withMeasurement = confirmed({
    expectation: sibling, severity: medium,
    execution: { ...confirmed().execution, measurements: [{ metric: "other", value: 2, unit: "decimals", threshold: 0, pass_if: "=", runs: 1, aggregation: "single", profile: "m390 fast" }] },
  });
  assert.deepEqual([...errorsOf([withMeasurement])], []);
  // Same record with an outcome-kind condition instead -> PASS, for each allowed kind.
  for (const kind of ["data_state", "app_configuration", "user_role", "concurrency"]) {
    const record = confirmed({ expectation: sibling, severity: medium, conditions: [{ kind: "network_condition", description: "slow4g" }, { kind, description: "The total differs." }] });
    assert.deepEqual([...errorsOf([record])], [], kind);
  }
  // Non-outcome kinds do not lift the cap.
  for (const kind of ["viewport", "theme", "network_condition", "timing_dependency"]) {
    const record = confirmed({ expectation: sibling, severity: medium, conditions: [{ kind, description: "d" }] });
    assert.ok(hasError(errorsOf([record]), "sibling_screen expectation above low"), kind);
  }
  const errors = errorsOf([confirmed({ expectation: sibling, severity: medium, conditions: [] })]);
  assert.ok(hasError(errors, "sibling_screen expectation above low"));
  const low = { impact: { score: "medium", reason: "r" }, reach: { score: "core_persona", reason: "r" }, overall: "low" };
  const lowErrors = errorsOf([confirmed({ expectation: sibling, severity: low, conditions: [] })]);
  assert.ok(!hasError(lowErrors, "sibling_screen"));
});

test("expectation refs must use a ledger namespace", () => {
  const good = ["PR-07", "WCAG22#1.4.10", "WCAG22#2.4.11", "HTML#the-dialog-element", "CLAUDE.md#Complete states",
    "memory:feedback_no_counts_in_headings.md#No numbers beside block titles", "sibling:src/app/admin/orders/page.tsx",
    "PERFORMANCE.md#Largest paint and render-blocking", "PERFORMANCE.md#Validation rules"];
  const bad = ["CLAUDE.md", "PR-7", "WCAG22#1.4", "memory:../x.md#h", "sibling:/abs", "PERFORMANCE.md#Made up", "https://example.com/#x",
    "#anchor", "HTML#", "x.md# padded"];
  for (const ref of good) assert.ok(v.isExpectationRef(ref), ref);
  for (const ref of bad) assert.ok(!v.isExpectationRef(ref), ref);
  const errors = errorsOf([confirmed({ expectation: { source_kind: "repo_rule", ref: "CLAUDE.md", statement: "x" } })]);
  assert.ok(hasError(errors, "/0/expectation/ref"));
});

test("routes start with a slash or are static", () => {
  assert.ok(hasError(errorsOf([confirmed({ surface: { route: "m/[slug]", component: null, state: "s" } })]), "/0/surface/route"));
  assert.deepEqual([...errorsOf([confirmed({ surface: { route: "static", component: null, state: "repo" } })])], []);
});

test("viewport ranges", () => {
  const vp = (overrides) => confirmed({ context: { ...confirmed().context, viewport: { id: "m390", width: 390, height: 844, dpr: 3, ...overrides } } });
  assert.deepEqual([...errorsOf([vp({ width: 200, height: 3840, dpr: 1 })])], []);
  for (const bad of [{ width: 199 }, { height: 3841 }, { width: 390.5 }, { dpr: 0.5 }, { dpr: 5 }, { id: "M390" }]) {
    assert.ok(hasError(errorsOf([vp(bad)]), "/0/context/viewport"), JSON.stringify(bad));
  }
  assert.deepEqual([...errorsOf([confirmed({ context: { ...confirmed().context, viewport: null } })])], []);
});

test("context enums match the ledger spellings", () => {
  const context = { ...confirmed().context, session: "twousers", motion: "reduced", zoom_percent: 200, browser: "chromium", timezone: "America/Bogota", locale: "es-CO" };
  assert.deepEqual([...errorsOf([confirmed({ context })])], []);
  assert.ok(hasError(errorsOf([confirmed({ context: { ...context, zoom_percent: 50 } })]), "zoom_percent"));
  assert.ok(hasError(errorsOf([confirmed({ context: { ...context, network: "3g" } })]), "/0/context/network"));
});

// ---- limits ----

test("API refuses cyclic and repeated references", () => {
  const record = confirmed();
  record.execution.self = record;
  assert.ok(hasError(errorsOf([record]), "repeated or cyclic"));
  const shared = { kind: "network_condition", description: "x" };
  assert.ok(hasError(errorsOf([confirmed({ conditions: [shared] }), confirmed({ fingerprint: "z/z", conditions: [shared] })]), "repeated or cyclic"));
});

test("structural preflight refuses depth and array size before parsing", () => {
  const limits = { ...v.LIMITS };
  assert.match(v.structuralPreflight("[".repeat(65) + "]".repeat(65), limits), /nesting/);
  assert.equal(v.structuralPreflight("[".repeat(64) + "]".repeat(64), limits), null);
  assert.match(v.structuralPreflight(`[${Array(1001).fill(1).join(",")}]`, limits), /more than 1000 items/);
  assert.equal(v.structuralPreflight(`[${Array(1000).fill('"a,[b"').join(",")}]`, limits), null);
});

test("CLI enforces byte, depth and array limits", () => {
  const big = tmpFile("[" + " ".repeat(5 * 1024 * 1024) + "]");
  const r1 = cli([big]);
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /exceeds the 5242880 byte limit/);
  const r2 = cli([tmpFile("[".repeat(100) + "]".repeat(100))]);
  assert.match(r2.stdout, /nesting limit/);
  const r3 = cli([tmpFile(`[${Array(1001).fill("{}").join(",")}]`)]);
  assert.match(r3.stdout, /more than 1000 items/);
});

test("error output is capped at 100 lines with 1000 malformed items", () => {
  const result = cli([tmpFile(Array(1000).fill({ verdict: "confirmed" }))]);
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 101);
  assert.ok(lines.slice(0, 100).every((line) => line.startsWith("ERROR: ")));
  assert.match(lines[100], /^FAIL: \d+ validation error\(s\); output capped at 100$/);
  assert.ok(Number(lines[100].match(/FAIL: (\d+)/)[1]) > 1000);
});

test("hostile input under a 128 MB heap does not crash", () => {
  const long = "x".repeat(4000);
  const hostile = [];
  while (JSON.stringify(hostile).length < 4.5 * 1024 * 1024 && hostile.length < 1000) {
    hostile.push({ verdict: "confirmed", fingerprint: long, title: long, trace: Array(100).fill({ kind: long }), [long]: long });
  }
  const result = cli([tmpFile(hostile)], { nodeArgs: ["--max-old-space-size=128"] });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trim().split("\n");
  assert.ok(lines.length <= 101);
  assert.ok(lines.every((line) => line.length <= 7 + 256));
});

// ---- input handling ----

test("CLI passes a valid file and prints the count", () => {
  const result = cli([tmpFile([confirmed(), needsValidation()].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1)))]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.stdout.trim(), "PASS: 2 findings valid");
});

test("CLI usage errors exit 2", () => {
  assert.equal(cli([]).status, 2);
  const unknown = cli([tmpFile([]), "--strict"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage: node validate-findings\.cjs/);
  assert.equal(cli([tmpFile([]), "--schema"]).status, 2);
  assert.equal(cli(["a.json", "b.json"]).status, 2);
});

test("--schema reads an alternative schema", () => {
  const strict = tmpFile({ type: "array", items: { type: "string" } }, "alt-schema.json");
  const result = cli([tmpFile([1]), "--schema", strict]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\/0: expected string/);
  const bad = cli([tmpFile([]), "--schema", tmpFile({ type: "array", if: {} })]);
  assert.match(bad.stdout, /ERROR: schema:: unsupported keyword "if"/);
});

test("BOM, invalid UTF-8 and parse errors are refused without echoing input", () => {
  const bom = cli([tmpFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("[]")]))]);
  assert.equal(bom.status, 1);
  assert.match(bom.stdout, /not valid JSON/);
  const utf = cli([tmpFile(Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]))]);
  assert.match(utf.stdout, /not valid UTF-8/);
  const secret = cli([tmpFile('[{"password": "hunter2-secret",]')]);
  assert.match(secret.stdout, /not valid JSON/);
  assert.ok(!secret.stdout.includes("hunter2"));
});

test("missing files and directories are refused", () => {
  assert.match(cli([path.join(tmpRoot, "nope.json")]).stdout, /cannot open input/);
  assert.match(cli([tmpRoot]).stdout, /not a regular file|cannot open input/);
});

test("safeReadText refuses a symbolic link (skipped only if links cannot be made)", (t) => {
  const target = tmpFile("[]", "link-target.json");
  const link = path.join(tmpRoot, "link.json");
  try {
    fs.symlinkSync(target, link);
  } catch (error) {
    if (error.code === "EPERM" || error.code === "ENOTSUP") return t.skip(`cannot create symlinks here (${error.code})`);
    throw error;
  }
  assert.throws(() => v.safeReadText(link), /symbolic link/);
  assert.match(cli([link]).stdout, /symbolic link/);
});

test("safeReadText refuses a junction or directory link", (t) => {
  const dir = path.join(tmpRoot, "junction-target");
  fs.mkdirSync(dir, { recursive: true });
  const link = path.join(tmpRoot, "junction-link");
  try {
    fs.symlinkSync(dir, link, "junction");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "ENOTSUP") return t.skip(`cannot create junctions here (${error.code})`);
    throw error;
  }
  assert.throws(() => v.safeReadText(link));
});

test("safeReadText refuses a FIFO (skipped only if one cannot be made)", (t) => {
  const fifo = path.join(tmpRoot, "fifo.json");
  const made = spawnSync("mkfifo", [fifo]);
  let isFifo = false;
  try {
    isFifo = made.status === 0 && fs.lstatSync(fifo).isFIFO();
  } catch {
    isFifo = false;
  }
  if (!isFifo) return t.skip("ENOTSUP: cannot create a FIFO on this system");
  assert.throws(() => v.safeReadText(fifo), /not a regular file/);
});

test("safeReadText reads a regular file and enforces its byte limit", () => {
  const file = tmpFile("[\"café\"]");
  assert.equal(v.safeReadText(file), "[\"café\"]");
  assert.throws(() => v.safeReadText(file, 4), /byte limit/);
});

// ---- shared helpers ----

function sharedBlock(file) {
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("// ==== BEGIN SHARED HELPERS ====");
  const end = text.indexOf("// ==== END SHARED HELPERS ====");
  assert.ok(start >= 0 && end > start, `${file} has no shared helper block`);
  return text.slice(start, end);
}

test("shared helpers are byte-identical in every validator", () => {
  const findingsBlock = sharedBlock(SCRIPT);
  assert.equal(findingsBlock, sharedBlock(LEDGER_SCRIPT));
  if (fs.existsSync(ORCHESTRATION_SCRIPT)) assert.equal(findingsBlock, sharedBlock(ORCHESTRATION_SCRIPT));
  for (const name of ["VISIBLE_CONTENT", "PATH_FORBIDDEN_CHARACTER", "WINDOWS_RESERVED_COMPONENT", "UNSAFE_DIAGNOSTIC_CHARACTER",
    "ALLOWED_ARTIFACT_EXTENSIONS", "AGENT_ID", "BLOCK_REFS", "SHARED_LIMITS", "MODEL_ALIASES", "EFFORT_LEVELS",
    "SELF_ASSESSMENT_LEVELS", "ENVIRONMENT_FILE_PATTERNS"]) {
    assert.match(findingsBlock, new RegExp(`\\nconst ${name} = `), name);
  }
  for (const name of ["isSafeRelativePath", "isOwnedArtifactPath", "isForbiddenPath", "computeReserve", "minimumCap"]) {
    assert.match(findingsBlock, new RegExp(`\\nfunction ${name}\\(`), name);
  }
  const ledger = require(LEDGER_SCRIPT);
  for (const key of ["inputBytes", "nestingDepth", "validationErrors"]) assert.equal(v.LIMITS[key], ledger.LIMITS[key], key);
  assert.deepEqual(v.BLOCK_REFS, ledger.BLOCK_REFS);
});

test("agent ids are lowercase and never device names", () => {
  for (const id of ["h1-checkout", "v12-cash_close", "cfinal", "c3", "p1-x", "fixtures", "r1x-themes"]) assert.ok(v.isSafeAgentId(id), id);
  for (const id of ["H1", "-x", "", "con", "nul", "com1", "lpt9", "a".repeat(65), "h1.menu", "h1 menu"]) assert.ok(!v.isSafeAgentId(id), id);
});

// ---- v2: environment files, shared constants and reserves ----

const ENV_NAMES = [".env", ".env.local", ".env.example", ".env-local", ".env_prod", ".envrc", "production.env", "app.env", ".dev.vars"];
const NOT_ENV_NAMES = ["environment.ts", "envelope.svg", ".envoy.yaml", "dotenv.md", "src/env/config.ts", "envs/x.json"];

test("isForbiddenPath flags environment files in any segment", () => {
  for (const name of ENV_NAMES) {
    assert.ok(v.isForbiddenPath(name), name);
    assert.ok(v.isForbiddenPath(`app/${name}`), `app/${name}`);
    assert.ok(v.isForbiddenPath(`app\\${name}`), `app\\${name}`);
    assert.ok(v.isForbiddenPath(`${name}/inner.json`), `${name}/inner.json`);
  }
  for (const name of NOT_ENV_NAMES) assert.ok(!v.isForbiddenPath(name), name);
  assert.ok(!v.isForbiddenPath(undefined));
});

test("CLI refuses an environment file as input or schema with exit 2, without opening it", () => {
  for (const name of [".env", ".env.local", "production.env", ".dev.vars"]) {
    // The file does not exist: a refusal proves the name was checked before any open.
    const input = cli([path.join(tmpRoot, "nested", name)]);
    assert.equal(input.status, 2, name);
    assert.match(input.stderr, /refusing to open an environment file/);
    assert.equal(input.stdout, "");
    const schemaFlag = cli([tmpFile([]), "--schema", path.join(tmpRoot, name)]);
    assert.equal(schemaFlag.status, 2, name);
  }
});

test("model, effort and self-assessment constants", () => {
  assert.deepEqual([...v.MODEL_ALIASES], ["haiku", "sonnet", "opus", "fable"]);
  assert.deepEqual([...v.EFFORT_LEVELS], ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual([...v.SELF_ASSESSMENT_LEVELS], ["high", "medium", "low", "unsure"]);
});

test("computeReserve and minimumCap give the profile defaults", () => {
  const reserve = (profile, cap, fraction = 0.1) => v.computeReserve(profile, cap, fraction);
  assert.deepEqual(reserve("quick", 15), { reconnaissance: 4, critics: 1, validation: 1, orchestration: 2, total: 8 });
  assert.deepEqual(reserve("standard", 40), { reconnaissance: 4, critics: 2, validation: 2, orchestration: 4, total: 12 });
  assert.deepEqual(reserve("deep", 90), { reconnaissance: 4, critics: 2, validation: 2, orchestration: 9, total: 17 });
  assert.equal(reserve("standard", 30).orchestration, 3, "30 * 0.1 must not round up to 4");
  assert.equal(reserve("standard", 13, 0.3).orchestration, 4);
  assert.equal(reserve("standard", 5).orchestration, 2, "the orchestration reserve is at least 2");
  assert.equal(v.minimumCap("quick", 0.1), 9);
  assert.equal(v.minimumCap("standard", 0.1), 11);
  assert.equal(v.minimumCap("deep", 0.1), 11);
  assert.equal(v.minimumCap("standard", 0.3), 13);
  assert.equal(v.computeReserve("huge", 40, 0.1), null);
  assert.equal(v.computeReserve("standard", 40.5, 0.1), null);
  assert.equal(v.minimumCap("standard", Number.NaN), null);
});

test("the shared reserve fixture agrees with computeReserve and minimumCap (skipped only while the fixture is absent)", (t) => {
  if (!fs.existsSync(CONFIG_CASES)) return t.skip("test-fixtures/config-cases.json is not present yet");
  const cases = JSON.parse(fs.readFileSync(CONFIG_CASES, "utf8"));
  assert.ok(Array.isArray(cases.reserve_cases) && cases.reserve_cases.length > 0);
  for (const entry of cases.reserve_cases) {
    assert.deepEqual(v.computeReserve(entry.profile, entry.cap, entry.fraction), entry.reserve, JSON.stringify(entry));
  }
  for (const entry of cases.minimum_cap_cases || []) {
    assert.equal(v.minimumCap(entry.profile, entry.fraction), entry.minimum, JSON.stringify(entry));
  }
});

// ---- v2: expectation namespaces RULE: and baseline: ----

test("RULE: and baseline: expectation ref corpus", () => {
  const good = ["RULE:VITALS-02", "RULE:WCAG-24", "RULE:E2E-101", "RULE:A1-10",
    "baseline:run-3#home/m390.light", "baseline:run_3#checkout-step-2/d1440.dark", "baseline:b#r/v.system"];
  const bad = ["RULE:", "RULE:vitals-02", "RULE:VITALS-2", "RULE:VITALS-1000", "RULE:VITALS_02", "RULE:VITALS-02 ", "RULE:1A-10",
    "baseline:", "baseline:run-3", "baseline:run-3#home", "baseline:Run-3#home/m390.light", "baseline:run-3#home/m390.sepia",
    "baseline:run-3#home/m390", "baseline:run-3#home/sub/m390.light", "baseline:run-3#/m390.light", "baseline:-x#home/m390.light",
    "baseline:" + "a".repeat(65) + "#home/m390.light"];
  for (const ref of good) assert.ok(v.isExpectationRef(ref), ref);
  for (const ref of bad) assert.ok(!v.isExpectationRef(ref), ref);
});

function baselineRecord(overrides = {}) {
  return confirmed({
    fingerprint: "home/visual-change/hero/banner-overlaps-search",
    lens: "VISUAL-AND-THEMING.md#Unintended visual change",
    expectation: { source_kind: "approved_baseline", ref: "baseline:run-3#home/m390.light", statement: "The home hero matches the approved capture." },
    severity: { impact: { score: "medium", reason: "r" }, reach: { score: "core_persona", reason: "r" }, overall: "low" },
    execution: {
      ...confirmed().execution,
      measurements: [{ metric: "visual_diff_ratio", value: 0.04, unit: "ratio", threshold: 0.001, pass_if: "<=", runs: 1, aggregation: "single", profile: "m390 light" }],
    },
    ...overrides,
  });
}

test("an approved_baseline record at low with a visual diff measurement passes", () => {
  assert.deepEqual([...errorsOf([baselineRecord()])], []);
});

test("approved_baseline cap: above low needs a non-diff measurement or an outcome condition", () => {
  const medium = { impact: { score: "medium", reason: "r" }, reach: { score: "all_users", reason: "r" }, overall: "medium" };
  const diffOnly = errorsOf([baselineRecord({ severity: medium })]);
  assert.ok(hasError(diffOnly, "approved_baseline expectation above low"), diffOnly.join("\n"));
  const pixels = baselineRecord({ severity: medium });
  pixels.execution.measurements.push({ metric: "visual_diff_pixels", value: 5400, unit: "px", threshold: 0, pass_if: "<=", runs: 1, aggregation: "single", profile: "m390 light" });
  assert.ok(hasError(errorsOf([pixels]), "approved_baseline expectation above low"), "two diff metrics still do not lift the cap");
  const overlap = baselineRecord({ severity: medium });
  overlap.execution.measurements.push({ metric: "overflow_px", value: 48, unit: "px", threshold: 0, pass_if: "<=", runs: 1, aggregation: "single", profile: "m390 light" });
  assert.deepEqual([...errorsOf([overlap])], []);
  for (const kind of ["data_state", "app_configuration", "user_role", "concurrency"]) {
    const record = baselineRecord({ severity: medium, conditions: [{ kind, description: "The search field is hidden for this state." }] });
    assert.deepEqual([...errorsOf([record])], [], kind);
  }
  const viewportOnly = baselineRecord({ severity: medium, conditions: [{ kind: "viewport", description: "m390 only." }] });
  assert.ok(hasError(errorsOf([viewportOnly]), "approved_baseline expectation above low"));
});

test("approved_baseline and the baseline: namespace go together", () => {
  const wrongRef = baselineRecord({ expectation: { source_kind: "approved_baseline", ref: "PR-04", statement: "s" } });
  assert.ok(hasError(errorsOf([wrongRef]), 'source_kind "approved_baseline" needs a baseline:'));
  const wrongKind = confirmed({ expectation: { source_kind: "repo_rule", ref: "baseline:run-3#home/m390.light", statement: "s" } });
  assert.ok(hasError(errorsOf([wrongKind]), 'a baseline: ref needs source_kind "approved_baseline"'));
  const nv = needsValidation({ expectation: { source_kind: "standard", ref: "baseline:run-3#home/m390.light", statement: "s" } });
  assert.ok(hasError(errorsOf([nv]), 'a baseline: ref needs source_kind "approved_baseline"'), "applies to every verdict");
});

test("a confirmed unintended visual change needs a visual diff measurement", () => {
  const none = baselineRecord();
  none.execution = { ...none.execution, measurements: [] };
  assert.ok(hasError(errorsOf([none]), "needs a visual_diff_ratio or visual_diff_pixels measurement"));
  const pixels = baselineRecord();
  pixels.execution.measurements = [{ metric: "visual_diff_pixels", value: 900, unit: "px", threshold: 0, pass_if: "<=", runs: 1, aggregation: "single", profile: "p" }];
  assert.deepEqual([...errorsOf([pixels])], []);
  const lead = needsValidation({ lens: "VISUAL-AND-THEMING.md#Unintended visual change" });
  assert.ok(!hasError(errorsOf([lead]), "visual_diff"), "the rule applies to confirmed records only");
});

// ---- v2: RULE: refs and SOURCES.md ----

test("RULE: refs are allowed only for budget, standard and platform_contract", () => {
  for (const kind of ["budget", "standard", "platform_contract"]) {
    assert.deepEqual([...errorsOf([confirmed({ expectation: { source_kind: kind, ref: "RULE:VITALS-02", statement: "s" } })])], [], kind);
  }
  for (const kind of ["repo_rule", "owner_preference", "business_rule", "sibling_screen", "approved_baseline"]) {
    const errors = errorsOf([confirmed({ expectation: { source_kind: kind, ref: "RULE:VITALS-02", statement: "s" } })]);
    assert.ok(hasError(errors, "a RULE: ref is allowed only"), kind);
  }
});

test("RULE: ids must exist when rule ids are given (Set or array), and are not checked otherwise", () => {
  const record = confirmed({ expectation: { source_kind: "budget", ref: "RULE:VITALS-02", statement: "s" } });
  assert.deepEqual([...v.validateFindings([record], schema)], []);
  assert.deepEqual([...v.validateFindings([record], schema, {})], []);
  assert.deepEqual([...v.validateFindings([record], schema, { ruleIds: new Set(["VITALS-02"]) })], []);
  assert.deepEqual([...v.validateFindings([record], schema, { ruleIds: ["VITALS-02", "WCAG-01"] })], []);
  const missing = v.validateFindings([record], schema, { ruleIds: new Set(["VITALS-03"]) });
  assert.ok(hasError(missing, 'rule "VITALS-02" is not in the SOURCES.md rule index'));
  const empty = v.validateFindings([record], schema, { ruleIds: [] });
  assert.ok(hasError(empty, "is not in the SOURCES.md rule index"), "an empty index still checks");
});

test("parseRuleIds reads only index rows", () => {
  const text = [
    "# Sources and rule index",
    "| id | rule | sources |",
    "|---|---|---|",
    "| WCAG-01 | Text contrast 4.5:1 | W3C-WCAG22 |",
    "| VITALS-102 | INP good at 200 ms | WEBDEV-INP |",
    "|VITALS-05| no spaces |",
    "| vitals-06 | lower case |",
    "Text that mentions | E2E-01 | inside a line.",
    "| E2E-1 | one digit |",
    "| E2E-25 | prefix with a digit |",
    "| 2E-03 | prefix starts with a digit |",
  ].join("\r\n");
  assert.deepEqual([...v.parseRuleIds(text)].sort(), ["E2E-25", "VITALS-102", "WCAG-01"]);
});

test("RULE: refs against the real SOURCES.md (skipped only while SOURCES.md is absent)", (t) => {
  const sources = path.join(__dirname, "SOURCES.md");
  if (!fs.existsSync(sources)) return t.skip("SOURCES.md is not present yet; it must exist at release");
  const ids = v.loadRuleIds(sources);
  assert.ok(ids instanceof Set && ids.size > 0, "SOURCES.md has rule index rows");
  const known = [...ids][0];
  const ok = confirmed({ expectation: { source_kind: "standard", ref: `RULE:${known}`, statement: "s" } });
  assert.deepEqual([...v.validateFindings([ok], schema, { ruleIds: ids })], []);
  const unknown = confirmed({ expectation: { source_kind: "standard", ref: "RULE:ZZZZ-999", statement: "s" } });
  assert.ok(hasError(v.validateFindings([unknown], schema, { ruleIds: ids }), "not in the SOURCES.md rule index"));
});

test("every rule row of the real SOURCES.md is indexed, including E2E ids", (t) => {
  const sources = path.join(__dirname, "SOURCES.md");
  if (!fs.existsSync(sources)) return t.skip("SOURCES.md is not present yet; it must exist at release");
  const rowCount = fs
    .readFileSync(sources, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^\| [A-Z][A-Z0-9]*-\d{2,3} \|/.test(line)).length;
  const ids = v.loadRuleIds(sources);
  assert.equal(ids.size, rowCount, "one id per rule row");
  const e2e = [...ids].filter((id) => id.startsWith("E2E-"));
  assert.ok(e2e.length > 0, "SOURCES.md has E2E rows and they are indexed");
  for (const id of e2e) {
    const record = confirmed({ expectation: { source_kind: "standard", ref: `RULE:${id}`, statement: "s" } });
    assert.deepEqual([...v.validateFindings([record], schema, { ruleIds: ids })], [], id);
  }
});

test("loadRuleIds returns undefined when the file is absent", () => {
  assert.equal(v.loadRuleIds(path.join(tmpRoot, "no-such-SOURCES.md")), undefined);
});

test("CLI checks RULE: ids against a SOURCES.md next to the validator", () => {
  const skill = path.join(tmpRoot, "skill-copy");
  fs.mkdirSync(skill, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(skill, "validate-findings.cjs"));
  fs.copyFileSync(SCHEMA_PATH, path.join(skill, "report-schema.json"));
  fs.writeFileSync(path.join(skill, "SOURCES.md"), "| id | rule |\n|---|---|\n| VITALS-02 | LCP good at 2.5 s |\n");
  const run = (ref) => spawnSync(process.execPath, [path.join(skill, "validate-findings.cjs"),
    tmpFile([confirmed({ expectation: { source_kind: "budget", ref, statement: "s" } })])], { encoding: "utf8", timeout: 60000 });
  const pass = run("RULE:VITALS-02");
  assert.equal(pass.status, 0, pass.stdout);
  const fail = run("RULE:VITALS-03");
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /ERROR: \/0\/expectation\/ref: rule "VITALS-03" is not in the SOURCES\.md rule index/);
});

// ---- v2: deliberation and stronger_model_needed ----

const DELIBERATION = [
  { id: "dlg-01", kind: "consult", outcome: "judged_neither", summary: "The requester and the peer disagreed on whether the totals differ; the judge could not decide." },
  { id: "fb-02", kind: "fallback_panel", outcome: "panel_agreed", summary: "Two opus judges agreed on ruling neither." },
  { id: "esc-0003", kind: "escalation", outcome: "escalation_resolved", summary: "Escalated from sonnet to opus; settled." },
];

test("deliberation entries are accepted on every verdict", () => {
  const copy = () => structuredClone(DELIBERATION);
  const data = [confirmed({ deliberation: copy() }), needsValidation({ deliberation: copy() }), rejected({ deliberation: copy() })]
    .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
  assert.deepEqual([...errorsOf(data)], []);
  assert.deepEqual([...errorsOf([confirmed({ deliberation: [] })])], []);
});

test("deliberation shape: id pattern, enums, summary and fields", () => {
  const one = (entry) => errorsOf([confirmed({ deliberation: [{ ...DELIBERATION[0], ...entry }] })]);
  for (const id of ["dlg-1", "dlg-12345", "DLG-01", "x-01", "dlg01", "dlg-01 "]) {
    assert.ok(hasError(one({ id }), "/0/deliberation/0/id"), id);
  }
  assert.ok(hasError(one({ kind: "vote" }), "/0/deliberation/0/kind"));
  assert.ok(hasError(one({ outcome: "won" }), "/0/deliberation/0/outcome"));
  assert.ok(hasError(one({ summary: " " }), "/0/deliberation/0/summary"));
  assert.ok(hasError(one({ summary: "x".repeat(1201) }), "longer than 1200"));
  assert.deepEqual([...one({ summary: "x".repeat(1200) })], []);
  assert.ok(hasError(one({ rounds: 2 }), "/0/deliberation/0/rounds: field is not allowed"));
  const noSummary = { ...DELIBERATION[0] };
  delete noSummary.summary;
  assert.ok(hasError(errorsOf([confirmed({ deliberation: [noSummary] })]), 'missing required field "summary"'));
});

test("deliberation ids are unique within a record and match their kind", () => {
  const duplicate = errorsOf([confirmed({ deliberation: [DELIBERATION[0], { ...DELIBERATION[0], summary: "Another summary." }] })]);
  assert.ok(hasError(duplicate, "/0/deliberation/1/id: duplicates the deliberation id of item 0"));
  const exact = errorsOf([confirmed({ deliberation: [DELIBERATION[0], { ...DELIBERATION[0] }] })]);
  assert.ok(hasError(exact, "/0/deliberation/1"));
  const prefix = errorsOf([confirmed({ deliberation: [{ ...DELIBERATION[1], id: "dlg-02" }] })]);
  assert.ok(hasError(prefix, "a fallback_panel entry needs an id that starts with fb-"));
  const outcome = errorsOf([confirmed({ deliberation: [{ ...DELIBERATION[2], outcome: "panel_agreed" }] })]);
  assert.ok(hasError(outcome, 'outcome "panel_agreed" does not belong to a escalation entry'));
  const judge = errorsOf([confirmed({ deliberation: [{ id: "dlg-04", kind: "judge", outcome: "agreed", summary: "s" }] })]);
  assert.ok(hasError(judge, "does not belong to a judge entry"));
  const paused = errorsOf([confirmed({ deliberation: [{ id: "fb-05", kind: "fallback_panel", outcome: "cancelled_pause", summary: "s" }] })]);
  assert.deepEqual([...paused], []);
  for (const [kind, start] of Object.entries({ consult: "dlg-", judge: "dlg-", escalation: "esc-", fallback_panel: "fb-" })) {
    assert.equal(v.DELIBERATION_RULES[kind].prefix, start);
    for (const entry of v.DELIBERATION_RULES[kind].outcomes) {
      assert.ok(schema.items.oneOf[0].properties.deliberation.items.properties.outcome.enum.includes(entry), entry);
    }
  }
});

test("stronger_model_needed: needs_validation only, tier enum, named in a blocker", () => {
  const needed = { tier: "fable", reason: "Deciding whether the two totals share one rule needs deeper reasoning than opus gave." };
  const ok = needsValidation({ stronger_model_needed: needed, blockers: ["Needs a Fable-tier verifier: the opus panel split."] });
  assert.deepEqual([...errorsOf([ok])], []);
  const unnamed = errorsOf([needsValidation({ stronger_model_needed: needed })]);
  assert.ok(hasError(unnamed, "/0/blockers: stronger_model_needed names fable"));
  const opus = needsValidation({ stronger_model_needed: { ...needed, tier: "opus" }, blockers: ["Needs an opus verifier."] });
  assert.deepEqual([...errorsOf([opus])], []);
  assert.ok(hasError(errorsOf([needsValidation({ stronger_model_needed: { ...needed, tier: "sonnet" }, blockers: ["sonnet"] })]), "/0/stronger_model_needed/tier"));
  assert.ok(hasError(errorsOf([needsValidation({ stronger_model_needed: { tier: "fable" }, blockers: ["fable"] })]), 'missing required field "reason"'));
  assert.ok(hasError(errorsOf([needsValidation({ stronger_model_needed: { ...needed, extra: 1 }, blockers: ["fable"] })]), "extra: field is not allowed"));
  assert.ok(hasError(errorsOf([confirmed({ stronger_model_needed: needed })]), "/0/stronger_model_needed: field is not allowed"));
  assert.ok(hasError(errorsOf([rejected({ stronger_model_needed: needed })]), "/0/stronger_model_needed: field is not allowed"));
});

// ---- v2: topology and metric enums ----

test("topologies: generic names and the legacy browser-in-wsl alias are accepted", () => {
  for (const topology of ["nat-forward", "netns-bridge", "browser-in-vm", "browser-in-wsl", "container-loopback", "host-only"]) {
    assert.deepEqual([...errorsOf([confirmed({ execution: { ...confirmed().execution, topology } })])], [], topology);
  }
  assert.ok(hasError(errorsOf([confirmed({ execution: { ...confirmed().execution, topology: "docker" } })]), "/0/execution/topology"));
});

test("new measurement metrics are accepted", () => {
  for (const metric of ["visual_diff_ratio", "visual_diff_pixels", "font_size_px", "feedback_ms"]) {
    const record = confirmed({
      execution: { ...confirmed().execution, measurements: [{ metric, value: 2, unit: "u", threshold: 1, pass_if: "<=", runs: 1, aggregation: "single", profile: "p" }] },
    });
    assert.deepEqual([...errorsOf([record])], [], metric);
  }
});

test("the five new classes are lenses in catalog order", () => {
  const lens = schema.items.oneOf[0].properties.lens.enum;
  const after = (previous, added) => assert.equal(lens.indexOf(added), lens.indexOf(previous) + 1, added);
  after("FUNCTIONAL-FLOWS.md#Role-gated actions", "FUNCTIONAL-FLOWS.md#Destructive actions, confirmation and undo");
  after("PERFORMANCE.md#Long-session stability", "PERFORMANCE.md#Back/forward cache");
  after("ACCESSIBILITY.md#Motion and timing", "ACCESSIBILITY.md#Pointer gestures and cancellation");
  after("ACCESSIBILITY.md#Accessible authentication", "ACCESSIBILITY.md#Consistent navigation and help");
  after("VISUAL-AND-THEMING.md#Public page metadata and share preview", "VISUAL-AND-THEMING.md#Unintended visual change");
  assert.ok(schema.items.oneOf[0].properties.expectation.properties.source_kind.enum.includes("approved_baseline"));
});
