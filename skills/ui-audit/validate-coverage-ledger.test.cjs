"use strict";

// Tests for validate-coverage-ledger.cjs.
// Run from the skill directory: node --test validate-coverage-ledger.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "validate-coverage-ledger.cjs");
const FINDINGS_SCRIPT = path.join(__dirname, "validate-findings.cjs");
const v = require(SCRIPT);

const ch = (code) => String.fromCodePoint(code);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ui-audit-ledger-"));
let fileCounter = 0;
function tmpFile(content, name) {
  const file = path.join(tmpRoot, name || `input-${fileCounter++}.json`);
  fs.writeFileSync(file, typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  return file;
}
function cli(args, nodeArgs = []) {
  return spawnSync(process.execPath, [...nodeArgs, SCRIPT, ...args], { encoding: "utf8", timeout: 60000 });
}
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// ---- fixture builders ----

function metadata(overrides = {}) {
  return {
    schema: "ui-audit/run-metadata@2",
    run_id: "run-1",
    profile: "standard",
    viewports: [
      { id: "m320", width: 320, height: 568, dpr: 2, mobile: true, touch: true },
      { id: "m390", width: 390, height: 844, dpr: 3, mobile: true, touch: true },
      { id: "t768", width: 768, height: 1024, dpr: 2, mobile: true, touch: true },
      { id: "d1440", width: 1440, height: 900, dpr: 1, mobile: false, touch: false },
      { id: "p767", width: 767, height: 900, dpr: 1, mobile: false, touch: false },
    ],
    themes: ["light", "dark", "system"],
    matrices: {
      core: { viewports: ["m320", "m390", "t768", "d1440"], themes: ["light", "dark"] },
      quick: { viewports: ["m390", "d1440"], themes: ["light", "dark"] },
    },
    personas: [{ role: "customer", label: "Customer" }, { role: "owner", label: "Owner" }, { role: "employee", label: "Employee" }],
    clock: { timezone: "America/Bogota", client_time: "init-script-shift", server_time: "seeded-boundaries" },
    network_profiles: { fast: null, slow4g: {}, slow3g: {}, offline: { offline: true }, flaky: {} },
    fixtures: { data_states: ["empty", "one", "typical", "heavy", "longtext"] },
    run_status: "in_progress",
    incomplete_reason: null,
    ...overrides,
  };
}

const RESPONSIVE_BLOCKS = [
  "RESPONSIVE-AND-LAYOUT.md#Core discipline",
  "RESPONSIVE-AND-LAYOUT.md#Horizontal overflow and clipping",
  "RESPONSIVE-AND-LAYOUT.md#Universal moves",
  "RESPONSIVE-AND-LAYOUT.md#Validation rules",
];

function refs(overrides = {}) {
  return {
    surface: "src/app/(shop)/shop/[slug]/page.tsx#/shop/[slug]",
    expectation: "CLAUDE.md#Interface",
    domain: "src/components/menu",
    lens: "RESPONSIVE-AND-LAYOUT.md#Horizontal overflow and clipping",
    context: "matrix:core;role=customer;data=typical",
    ...overrides,
  };
}

function unit(overrides = {}) {
  const { canonical_refs: refOverrides, ...rest } = overrides;
  const canonical = refs(refOverrides);
  return {
    coverage_id: v.deriveCoverageId(canonical),
    canonical_refs: canonical,
    surface: "Shop page /shop/[slug]",
    expectation: "No horizontal overflow (CLAUDE.md)",
    domain: "menu",
    lens: "Horizontal overflow and clipping",
    context: canonical.context,
    starting_paths: ["src/views/menu/MenuView.tsx"],
    ordinary_lens_block: null,
    selected_companion_blocks: RESPONSIVE_BLOCKS.slice(),
    excluded_blocks: [],
    prior_status: "new",
    attempts: [],
    wave: 1,
    status: "planned",
    agent_id: null,
    reviewed_paths: [],
    checks: [],
    result_fingerprints: [],
    unresolved: [],
    ...rest,
  };
}

function check(overrides = {}) {
  return {
    agent_id: "h1-menu",
    reviewed_paths: ["src/views/menu/MenuView.tsx"],
    expectation: "documentElement.scrollWidth <= clientWidth",
    method: "browser",
    variant: "vp=m320;theme=light",
    result: "scrollWidth 320, clientWidth 320",
    artifact: "agents/h1-menu/artifacts/probe/m320.light.json",
    ...overrides,
  };
}

function matrixChecks(agent = "h1-menu", skip = []) {
  const out = [];
  for (const vp of ["m320", "m390", "t768", "d1440"]) {
    for (const theme of ["light", "dark"]) {
      if (skip.includes(`vp=${vp};theme=${theme}`)) continue;
      out.push(check({ agent_id: agent, variant: `vp=${vp};theme=${theme}`, artifact: `agents/${agent}/artifacts/probe/${vp}.${theme}.json` }));
    }
  }
  return out;
}

function coveredUnit(overrides = {}) {
  return unit({
    status: "covered",
    agent_id: "h1-menu",
    reviewed_paths: ["src/views/menu/MenuView.tsx"],
    checks: matrixChecks(),
    ...overrides,
  });
}

const errorsOf = (data, meta) => v.validateLedger(data, meta);
const hasError = (errors, fragment) => errors.some((line) => line.includes(fragment));
const sortUnits = (units) => units.slice().sort((a, b) => (a.coverage_id < b.coverage_id ? -1 : a.coverage_id > b.coverage_id ? 1 : 0));

// ---- acceptance ----

test("a planned unit and a covered matrix unit pass with metadata", () => {
  assert.deepEqual([...errorsOf([unit()], metadata())], []);
  assert.deepEqual([...errorsOf([coveredUnit()], metadata())], []);
});

test("a static source-only covered unit passes", () => {
  const u = unit({
    canonical_refs: { context: "static", lens: "PROJECT-CONVENTIONS.md#Code structure conventions", expectation: "PR-03", domain: "src" },
    selected_companion_blocks: [
      "PROJECT-CONVENTIONS.md#Code structure conventions", "PROJECT-CONVENTIONS.md#Core discipline",
      "PROJECT-CONVENTIONS.md#Universal moves", "PROJECT-CONVENTIONS.md#Validation rules",
    ],
    status: "covered",
    agent_id: "h4-structure",
    reviewed_paths: ["src/components/menu/Cart.tsx", "src/styles/menu/cart.styles.ts"],
    checks: [
      check({ agent_id: "h4-structure", method: "source", variant: null, artifact: null, reviewed_paths: ["src/components/menu/Cart.tsx"] }),
      check({ agent_id: "h4-structure", method: "scan", variant: null, artifact: "agents/h4-structure/artifacts/scan/tailwind-in-jsx.txt", reviewed_paths: ["src/styles/menu/cart.styles.ts"] }),
    ],
  });
  assert.deepEqual([...errorsOf([u], metadata())], []);
});

test("missing unit fields are reported", () => {
  const u = unit();
  delete u.attempts;
  delete u.unresolved;
  const errors = errorsOf([u]);
  assert.ok(hasError(errors, 'missing unit field "attempts"'));
  assert.ok(hasError(errors, 'missing unit field "unresolved"'));
});

test("unknown bookkeeping fields are ignored", () => {
  assert.deepEqual([...errorsOf([unit({ tenant: "audit-h1", improvements: ["x"], whatever: 1 })])], []);
});

// ---- canonical refs ----

test("canonical_refs must have exactly the five keys", () => {
  const extra = unit();
  extra.canonical_refs = { ...extra.canonical_refs, wave: "1" };
  assert.ok(hasError(errorsOf([extra]), "/0/canonical_refs/wave"));
  const missing = unit();
  delete missing.canonical_refs.domain;
  assert.ok(hasError(errorsOf([missing]), 'missing ref "domain"'));
});

test("ref text rules: NFC, controls, whitespace, length", () => {
  const cases = [
    ["surface", "src/app/page.tsx#mene" + ch(0x301), "NFC"],
    ["surface", "src/app/page.tsx#a" + ch(0x200b), "control or invisible"],
    ["domain", " src/menu", "whitespace"],
    ["domain", "src/menu" + ch(0x2028), "control or invisible"],
    ["surface", "s".repeat(1025), "longer than 1024"],
    ["domain", ch(0x200b), "no visible content"],
  ];
  for (const [key, value, fragment] of cases) {
    const u = unit();
    u.canonical_refs[key] = value;
    assert.ok(hasError(errorsOf([u]), fragment), `${key}=${JSON.stringify(value)}`);
  }
});

test("expectation refs must match a namespace", () => {
  for (const expectation of ["PR-07", "WCAG22#2.5.8", "HTML#the-dialog-element", "memory:feedback_no_counts_in_headings.md#No numbers beside block titles",
    "sibling:src/app/admin/orders/page.tsx", "PERFORMANCE.md#Layout shift", "src/lib/orders/cart.ts#fitToStock"]) {
    assert.deepEqual([...errorsOf([unit({ canonical_refs: { expectation } })])], [], expectation);
  }
  for (const expectation of ["best practice", "CLAUDE.md", "WCAG21#1.4.3", "PR-1", "WCAG#1.4.3", "Makefile#x", "memory:x.md", "sibling:../x", "LENSES.md#Not a lens"]) {
    assert.ok(hasError(errorsOf([unit({ canonical_refs: { expectation } })]), "expectation namespace"), expectation);
  }
});

test("lens refs must be lens or class refs, never meta blocks", () => {
  assert.ok(hasError(errorsOf([unit({ canonical_refs: { lens: "RESPONSIVE-AND-LAYOUT.md#Core discipline" } })]), "names a prompt block"));
  assert.ok(hasError(errorsOf([unit({ canonical_refs: { lens: "RESPONSIVE-AND-LAYOUT.md#horizontal overflow and clipping" } })]), "not a known lens"));
  assert.deepEqual([...errorsOf([unit({ canonical_refs: { lens: "LENSES.md#Obvious things" } })])], []);
});

// ---- context grammar ----

test("valid contexts parse", () => {
  const valid = [
    "static",
    "matrix:core",
    "matrix:core;role=customer;data=typical",
    "role=owner;vp=m390;net=slow4g;data=heavy",
    "role=owner;session=twousers",
    "role=customer;vp=m390;theme=dark;input=keyboard;net=flaky;data=stale;session=expired;motion=reduced;zoom=400;tz=Asia/Tokyo;locale=es-CO;browser=webkit",
    "locale=es",
    "tz=America/Argentina/Buenos_Aires",
  ];
  for (const context of valid) assert.ok(v.parseContext(context).ok, context);
  const parsed = v.parseContext("matrix:core;role=customer");
  assert.equal(parsed.matrix, "core");
  assert.deepEqual(parsed.values, { role: "customer" });
});

test("invalid contexts are refused", () => {
  const invalid = [
    "", "matrix:", "matrix:Core", "matrix:core;", "matrix:core;vp=m390", "matrix:core;theme=dark", "vp=m390;role=owner",
    "role=owner;role=employee", "theme=any", "role=any", "foo=bar", "zoom=150", "locale=es_CO", "locale=ES", "session=threeusers",
    "role=owner;", "static;role=owner", "role", "=owner", "tz=America/", "browser=safari", "net=4g", "data=huge",
  ];
  for (const context of invalid) assert.ok(!v.parseContext(context).ok, JSON.stringify(context));
  assert.ok(hasError(errorsOf([unit({ canonical_refs: { context: "matrix:core;vp=m390" } })]), "supplied by the matrix"));
});

test("the context label must equal the canonical context", () => {
  assert.ok(hasError(errorsOf([unit({ context: "matrix:core" })]), "must equal canonical_refs.context"));
});

// ---- coverage ids ----

test("coverage_id derivation percent-encodes UTF-8 with uppercase hex", () => {
  const id = v.deriveCoverageId({ surface: "a b", expectation: "PR-01", domain: "src/x", lens: "LENSES.md#Wildcard", context: "static" });
  assert.equal(id, "a%20b::PR-01::src%2Fx::LENSES.md%23Wildcard::static");
  assert.equal(v.deriveCoverageId({ surface: "ñ~(", expectation: "e", domain: "d", lens: "l", context: "c" }), "%C3%B1~%28::e::d::l::c");
});

test("a coverage_id that does not match its refs fails", () => {
  const u = unit();
  u.coverage_id += "x";
  assert.ok(hasError(errorsOf([u]), "does not match the id derived"));
});

test("duplicate ids, identity collisions and aliasing are distinguished", () => {
  assert.ok(hasError(errorsOf([unit(), unit()]), "duplicate coverage_id"));
  assert.ok(hasError(errorsOf([unit(), unit({ surface: "Another label" })]), "canonical identity collision"));
  const a = unit();
  const b = unit({ canonical_refs: { domain: "src/views/menu" } });
  assert.ok(hasError(errorsOf(sortUnits([a, b])), "aliases unit"));
  const c = unit({ canonical_refs: { domain: "src/views/menu" }, domain: "menu views" });
  assert.deepEqual([...errorsOf(sortUnits([a, c]))], []);
});

test("units must be sorted by coverage_id in code-unit order", () => {
  const a = unit();
  const b = unit({ canonical_refs: { context: "static" }, context: "static" });
  b.context = "static";
  const sorted = sortUnits([a, b]);
  assert.deepEqual([...errorsOf(sorted)], []);
  assert.ok(hasError(errorsOf(sorted.slice().reverse()), "sorted by coverage_id"));
});

// ---- state table ----

test("state table: every status against the evidence it allows", () => {
  const evidence = { reviewed_paths: ["src/views/menu/MenuView.tsx"], checks: matrixChecks() };
  const cases = [
    ["planned", {}, true],
    ["planned", { agent_id: "h1-menu" }, false],
    ["not_applicable", { unresolved: ["This screen has no file upload."] }, true],
    ["not_applicable", {}, false],
    ["out_of_scope", { unresolved: ["outside the diff"] }, true],
    ["deferred", { unresolved: ["validation_budget_exhausted"] }, true],
    ["deferred", { unresolved: ["no budget left"] }, false],
    ["in_progress", { agent_id: "h1-menu" }, true],
    ["in_progress", { agent_id: "h1-menu", ...evidence }, false],
    ["in_progress", {}, false],
    ["blocked", { agent_id: "h1-menu", ...evidence, unresolved: ["engine_unavailable: WebKit"] }, true],
    ["blocked", { agent_id: "h1-menu", ...evidence }, false],
    ["covered", { agent_id: "h1-menu", ...evidence }, true],
    ["covered", { agent_id: "h1-menu", ...evidence, unresolved: ["x"] }, false],
    ["covered", { agent_id: "h1-menu", ...evidence, result_fingerprints: ["menu/x/y/z"] }, false],
    ["covered", { agent_id: "h1-menu" }, false],
    ["candidate", { agent_id: "h1-menu", ...evidence, result_fingerprints: ["menu/x/y/z"] }, true],
    ["candidate", { agent_id: "h1-menu", ...evidence, result_fingerprints: ["menu/x/y/z"], unresolved: ["x"] }, true],
    ["candidate", { agent_id: "h1-menu", ...evidence }, false],
  ];
  for (const [status, fields, ok] of cases) {
    const errors = errorsOf([unit({ status, ...fields })], metadata());
    assert.equal(errors.length === 0, ok, `${status} ${JSON.stringify(Object.keys(fields))}: ${errors}`);
  }
});

test("deferred reason codes: exact code or code plus text", () => {
  assert.ok(v.hasReasonCode("runtime_unavailable"));
  assert.ok(v.hasReasonCode("runtime_unavailable: the VM does not start"));
  for (const bad of ["runtime_unavailable:", "runtime_unavailable:x", "Runtime_unavailable", "no runtime", "runtime_unavailable:  " + ch(0x200b)]) {
    assert.ok(!v.hasReasonCode(bad), bad);
  }
});

test("enums, wave and agent id", () => {
  assert.ok(hasError(errorsOf([unit({ prior_status: "old" })]), "/0/prior_status"));
  assert.ok(hasError(errorsOf([unit({ status: "done" })]), "/0/status"));
  assert.ok(hasError(errorsOf([unit({ wave: 0 })]), "/0/wave"));
  assert.ok(hasError(errorsOf([unit({ status: "in_progress", agent_id: "con" })]), "/0/agent_id"));
  assert.ok(hasError(errorsOf([unit({ status: "in_progress", agent_id: "H1-Menu" })]), "/0/agent_id"));
});

// ---- checks ----

test("checks have exactly seven keys", () => {
  const extra = coveredUnit({ checks: matrixChecks().map((c, i) => (i === 0 ? { ...c, verdict: "ok" } : c)) });
  assert.ok(hasError(errorsOf([extra]), "/0/checks/0/verdict"));
  const short = matrixChecks();
  delete short[0].result;
  assert.ok(hasError(errorsOf([coveredUnit({ checks: short })]), 'missing check field "result"'));
});

test("variant is null exactly for source and scan checks", () => {
  const base = { status: "covered", agent_id: "h1-menu", reviewed_paths: ["src/views/menu/MenuView.tsx"] };
  const staticUnit = (c) => unit({ canonical_refs: { context: "static" }, ...base, checks: [c] });
  assert.ok(hasError(errorsOf([staticUnit(check({ method: "source", variant: "vp=m320", artifact: null }))]), "must be null for method"));
  assert.ok(hasError(errorsOf([staticUnit(check({ method: "scan", variant: "vp=m320" }))]), "must be null for method"));
  assert.ok(hasError(errorsOf([staticUnit(check({ variant: null }))]), "need a canonical key=value variant"));
  assert.ok(hasError(errorsOf([staticUnit(check({ method: "test", variant: "matrix:core" }))]), "need a canonical key=value variant"));
  assert.ok(hasError(errorsOf([staticUnit(check({ variant: "theme=dark;vp=m320" }))]), "canonical order"));
});

test("variants may not contradict the unit context and must name vp and theme on matrix units", () => {
  const contradict = matrixChecks();
  contradict[0] = { ...contradict[0], variant: "role=owner;vp=m320;theme=light" };
  assert.ok(hasError(errorsOf([coveredUnit({ checks: contradict })]), "contradicts the unit context role=customer"));
  const same = matrixChecks();
  same[0] = { ...same[0], variant: "role=customer;vp=m320;theme=light" };
  assert.deepEqual([...errorsOf([coveredUnit({ checks: same })], metadata())], []);
  const noTheme = matrixChecks();
  noTheme.push(check({ variant: "vp=m390", artifact: "agents/h1-menu/artifacts/extra.png" }));
  assert.ok(hasError(errorsOf([coveredUnit({ checks: noTheme })]), "must name vp and theme"));
});

test("artifact is null exactly for source checks and owned by the check's agent", () => {
  const base = { canonical_refs: { context: "static" }, status: "covered", agent_id: "h1-menu", reviewed_paths: ["src/views/menu/MenuView.tsx"] };
  const one = (c) => errorsOf([unit({ ...base, checks: [c] })]);
  assert.ok(hasError(one(check({ method: "source", variant: null, artifact: "agents/h1-menu/artifacts/a.txt" })), "must be null for a source check"));
  assert.ok(hasError(one(check({ method: "scan", variant: null, artifact: null })), "owned artifact path"));
  assert.ok(hasError(one(check({ artifact: "agents/h2-other/artifacts/a.png" })), "owned artifact path"));
  assert.ok(hasError(one(check({ artifact: "agents/h1-menu/artifacts/storage/state.json" })), "owned artifact path"));
  assert.ok(hasError(one(check({ artifact: "agents/h1-menu/artifacts/a.exe" })), "owned artifact path"));
  assert.ok(hasError(one(check({ artifact: "agents/h1-menu/artifacts/" })), "owned artifact path"));
});

test("check text is visible, trimmed and at most 4096 characters", () => {
  const base = { canonical_refs: { context: "static" }, status: "covered", agent_id: "h1-menu", reviewed_paths: ["src/views/menu/MenuView.tsx"] };
  const one = (c) => errorsOf([unit({ ...base, checks: [c] })]);
  assert.ok(hasError(one(check({ result: " padded" })), "must be trimmed"));
  assert.ok(hasError(one(check({ expectation: "x".repeat(4097) })), "longer than 4096"));
  assert.ok(hasError(one(check({ result: ch(0x200b) })), "visible text"));
  assert.deepEqual([...one(check({ expectation: ch(0x1f3df).repeat(4096) }))], []);
});

test("unit reviewed_paths equals the union of its checks' paths", () => {
  const extra = coveredUnit({ reviewed_paths: ["src/views/menu/MenuView.tsx", "src/other.ts"] });
  assert.ok(hasError(errorsOf([extra]), "is not reviewed by any check"));
  const checks = matrixChecks();
  checks[0] = { ...checks[0], reviewed_paths: ["src/views/menu/MenuView.tsx", "src/hooks/menu/useCart.ts"] };
  assert.ok(hasError(errorsOf([coveredUnit({ checks })]), "missing from reviewed_paths"));
  assert.ok(hasError(errorsOf([unit({ starting_paths: ["../escape.ts"] })]), "/0/starting_paths/0"));
  assert.ok(hasError(errorsOf([unit({ starting_paths: [] })]), "must not be empty"));
});

test("result fingerprints and unresolved entries", () => {
  const evidence = { status: "candidate", agent_id: "h1-menu", reviewed_paths: ["src/views/menu/MenuView.tsx"], checks: matrixChecks() };
  assert.ok(hasError(errorsOf([unit({ ...evidence, result_fingerprints: ["café/x"] })]), "not a valid fingerprint"));
  assert.ok(hasError(errorsOf([unit({ ...evidence, result_fingerprints: ["a/b", "a/b"] })]), "duplicate fingerprint"));
  assert.ok(hasError(errorsOf([unit({ ...evidence, result_fingerprints: ["a/b"], unresolved: ["x", "x"] })]), "duplicate entry"));
});

// ---- block lists ----

test("block selection rules", () => {
  assert.ok(hasError(errorsOf([unit({ ordinary_lens_block: "PERFORMANCE.md#Fonts" })]), "LENSES.md block ref"));
  assert.deepEqual([...errorsOf([unit({ ordinary_lens_block: "LENSES.md#Wildcard" })])], []);
  assert.ok(hasError(errorsOf([unit({ selected_companion_blocks: ["RESPONSIVE-AND-LAYOUT.md#Breakpoint pivots"] })]), "also requires RESPONSIVE-AND-LAYOUT.md#Core discipline"));
  assert.ok(hasError(errorsOf([unit({ selected_companion_blocks: [...RESPONSIVE_BLOCKS, RESPONSIVE_BLOCKS[0]] })]), "duplicate block"));
  assert.ok(hasError(errorsOf([unit({ selected_companion_blocks: ["RESPONSIVE.md#Core discipline"] })]), "not a known block ref"));
  const overlap = { block: RESPONSIVE_BLOCKS[1], reason: "x" };
  assert.ok(hasError(errorsOf([unit({ excluded_blocks: [overlap] })]), "both selected and excluded"));
  const fonts = { block: "PERFORMANCE.md#Fonts", reason: "No fonts on this screen." };
  assert.deepEqual([...errorsOf([unit({ excluded_blocks: [fonts] })])], []);
  assert.ok(hasError(errorsOf([unit({ excluded_blocks: [fonts, { ...fonts }] })]), "duplicate excluded block"));
  assert.ok(hasError(errorsOf([unit({ excluded_blocks: [{ block: "PERFORMANCE.md#Fonts", reason: " " }] })]), "/reason"));
  assert.ok(hasError(errorsOf([unit({ excluded_blocks: [{ block: "PERFORMANCE.md#Fonts" }] })]), "exactly {block, reason}"));
});

// ---- attempts ----

function reassigned(overrides = {}) {
  return coveredUnit({
    wave: 2,
    agent_id: "h7-menu",
    checks: matrixChecks("h7-menu"),
    attempts: [{
      wave: 1,
      status: "covered",
      agent_id: "h1-menu",
      reviewed_paths: ["src/views/menu/MenuView.tsx"],
      checks: matrixChecks("h1-menu"),
      result_fingerprints: [],
      unresolved: [],
      reassignment_reason: "Critic c1 found captures taken mid-probe.",
    }],
    ...overrides,
  });
}

test("a reassigned unit with an archived attempt passes", () => {
  assert.deepEqual([...errorsOf([reassigned()], metadata())], []);
});

test("attempt waves strictly increase and stay below the live wave", () => {
  const u = reassigned({ wave: 1 });
  assert.ok(hasError(errorsOf([u]), "before the live wave"));
  const two = reassigned({ wave: 3 });
  two.attempts.push({ ...structuredClone(two.attempts[0]), wave: 1, agent_id: "h4-menu", checks: matrixChecks("h4-menu") });
  assert.ok(hasError(errorsOf([two]), "strictly increase"));
});

test("attempt owners are fresh", () => {
  const sameLive = reassigned({ agent_id: "h1-menu", checks: matrixChecks("h1-menu").map((c) => ({ ...c, artifact: c.artifact.replace("probe", "probe2") })) });
  assert.ok(hasError(errorsOf([sameLive]), "live owner must differ"));
  const repeated = reassigned({ wave: 3 });
  repeated.attempts.push({ ...structuredClone(repeated.attempts[0]), wave: 2, checks: matrixChecks("h1-menu").map((c) => ({ ...c, artifact: c.artifact.replace("probe", "p2") })) });
  assert.ok(hasError(errorsOf([repeated]), "different owner"));
});

test("an archived owner's checks never reappear and artifacts are never reused", () => {
  const reappear = reassigned();
  reappear.checks.push(check({ variant: "vp=m390;theme=light", artifact: "agents/h1-menu/artifacts/new/m390.png" }));
  assert.ok(hasError(errorsOf([reappear]), "archived owner \"h1-menu\" has checks again"));
  const reused = reassigned();
  reused.checks[0] = { ...reused.checks[0], agent_id: "h1-menu", artifact: reused.attempts[0].checks[0].artifact };
  assert.ok(hasError(errorsOf([reused]), "is reused by attempt 0 and live checks"));
});

test("attempt shape: status, keys and reassignment reason", () => {
  const badStatus = reassigned();
  badStatus.attempts[0].status = "planned";
  assert.ok(hasError(errorsOf([badStatus]), "must be covered, candidate or blocked"));
  const extraKey = reassigned();
  extraKey.attempts[0].verdict = "x";
  assert.ok(hasError(errorsOf([extraKey]), "is not an attempt field"));
  const noReason = reassigned();
  noReason.attempts[0].reassignment_reason = "";
  assert.ok(hasError(errorsOf([noReason]), "reassignment_reason"));
  const emptyEvidence = reassigned();
  emptyEvidence.attempts[0].checks = [];
  emptyEvidence.attempts[0].reviewed_paths = [];
  assert.ok(hasError(errorsOf([emptyEvidence]), 'status "covered" needs checks'));
});

// ---- metadata ----

test("--metadata: matrix, viewport, role, time zone, network and data must be declared", () => {
  const meta = metadata();
  const cases = [
    ["matrix:pivot;role=customer", "matrix \"pivot\" is not declared"],
    ["role=customer;vp=m999", "viewport \"m999\" is not declared"],
    ["role=cashier", "role \"cashier\" is not a persona"],
    ["role=owner;tz=Europe/Madrid", "neither the run time zone"],
    ["role=owner;net=slow3g", null],
    ["role=owner;data=stale", null],
    ["role=owner;tz=Asia/Tokyo", null],
    ["role=owner;tz=America/Bogota", null],
  ];
  for (const [context, fragment] of cases) {
    const errors = errorsOf([unit({ canonical_refs: { context } })], meta);
    if (fragment) assert.ok(hasError(errors, fragment), `${context}: ${errors}`);
    else assert.deepEqual([...errors], [], context);
  }
  const noFlaky = metadata({ network_profiles: { fast: null } });
  assert.ok(hasError(errorsOf([unit({ canonical_refs: { context: "role=owner;net=flaky" } })], noFlaky), "not a network profile"));
  const fewStates = metadata({ fixtures: { data_states: ["typical"] } });
  assert.ok(hasError(errorsOf([unit({ canonical_refs: { context: "role=owner;data=heavy" } })], fewStates), "not a fixture state"));
});

test("--metadata: variant viewports must be declared", () => {
  const checks = matrixChecks();
  checks.push(check({ variant: "vp=m414;theme=dark", artifact: "agents/h1-menu/artifacts/m414.png" }));
  assert.ok(hasError(errorsOf([coveredUnit({ checks })], metadata()), "viewport \"m414\" is not declared"));
});

test("--metadata: matrix-unit variant viewports must belong to the unit's matrix", () => {
  const checks = matrixChecks();
  checks.push(check({ variant: "vp=p767;theme=light", artifact: "agents/h1-menu/artifacts/p767.png" }));
  const errors = errorsOf([coveredUnit({ checks })], metadata());
  assert.ok(hasError(errors, "variant vp=p767 is outside matrix core"), String(errors));
  assert.ok(!hasError(errors, "is not declared"));
  assert.deepEqual([...errorsOf([coveredUnit({ checks })])], [], "matrix membership needs metadata");
});

test("matrix-unit variant themes must belong to the unit's matrix", () => {
  const lightOnly = metadata({ matrices: { core: { viewports: ["m320", "m390", "t768", "d1440"], themes: ["light"] } } });
  const darkExtra = matrixChecks();
  const errors = errorsOf([coveredUnit({ checks: darkExtra })], lightOnly);
  assert.ok(hasError(errors, "variant theme=dark is outside matrix core"), String(errors));
  const system = matrixChecks();
  system.push(check({ variant: "vp=m390;theme=system", artifact: "agents/h1-menu/artifacts/m390.system.png" }));
  assert.ok(hasError(errorsOf([coveredUnit({ checks: system })]), "variant theme=system is outside matrix core"), "rejected without metadata");
  assert.ok(hasError(errorsOf([coveredUnit({ checks: system })], metadata()), "variant theme=system is outside matrix core"));
});

test("matrix completeness for covered and candidate units", () => {
  const missing = ["vp=t768;theme=dark"];
  const covered = coveredUnit({ checks: matrixChecks("h1-menu", missing) });
  assert.ok(hasError(errorsOf([covered], metadata()), "no browser check for vp=t768;theme=dark"));
  assert.deepEqual([...errorsOf([covered])], [], "completeness needs metadata");
  const candidate = (unresolved) => coveredUnit({ status: "candidate", checks: matrixChecks("h1-menu", missing), result_fingerprints: ["menu/overflow/m/long-name"], unresolved });
  assert.ok(hasError(errorsOf([candidate([])], metadata()), "variant not run: vp=t768;theme=dark"));
  assert.deepEqual([...errorsOf([candidate(["variant not run: vp=t768;theme=dark"])], metadata())], []);
  const viaTest = matrixChecks("h1-menu", missing);
  viaTest.push(check({ method: "test", variant: "vp=t768;theme=dark", artifact: "agents/h1-menu/artifacts/t768.dark.txt" }));
  assert.ok(hasError(errorsOf([coveredUnit({ checks: viaTest })], metadata()), "no browser check"));
});

test("quick profile coarsens every domain", () => {
  const meta = metadata({ profile: "quick" });
  assert.ok(hasError(errorsOf([unit({ canonical_refs: { context: "matrix:quick" } })], meta), "single domain profile/quick/all-in-scope-domains"));
  const fine = unit({ canonical_refs: { context: "matrix:quick", domain: "profile/quick/all-in-scope-domains" } });
  assert.deepEqual([...errorsOf([fine], meta)], []);
});

test("metadata incomplete_reason must start with a reasons-list code", () => {
  assert.ok(hasError(errorsOf([], metadata({ incomplete_reason: "ran out of time" })), "metadata:/incomplete_reason"));
  assert.deepEqual([...errorsOf([], metadata({ incomplete_reason: "user_interrupted: the owner stopped the run" }))], []);
});

test("metadata shape: reserved viewports, pivots and matrix themes", () => {
  const wrongReserved = metadata();
  wrongReserved.viewports[1] = { ...wrongReserved.viewports[1], width: 375 };
  assert.ok(hasError(errorsOf([], wrongReserved), "reserved viewport m390 must be 390x844"));
  const wrongPivot = metadata();
  wrongPivot.viewports[4] = { ...wrongPivot.viewports[4], width: 768 };
  assert.ok(hasError(errorsOf([], wrongPivot), "pivot viewport p767 must be 767 px wide"));
  const systemMatrix = metadata({ matrices: { core: { viewports: ["m390"], themes: ["system"] } } });
  assert.ok(hasError(errorsOf([], systemMatrix), "not allowed in a matrix"));
  const unknownVp = metadata({ matrices: { core: { viewports: ["m999"], themes: ["light"] } } });
  assert.ok(hasError(errorsOf([], unknownVp), "names unknown viewport"));
  const tall = metadata();
  tall.viewports.push({ id: "x1", width: 500, height: 3841, dpr: 1 });
  assert.ok(hasError(errorsOf([], tall), "200 to 3840"));
  assert.ok(hasError(errorsOf([], []), "metadata:: run-metadata.json must be an object"));
});

// ---- limits and CLI ----

test("structural preflight limits: units, nested items, fields, values, depth", () => {
  const limits = v.LIMITS;
  assert.match(v.structuralPreflight(`[${Array(10001).fill("{}").join(",")}]`, limits), /more than 10000 items/);
  assert.equal(v.structuralPreflight(`[${Array(10000).fill("{}").join(",")}]`, limits), null);
  assert.match(v.structuralPreflight(`[{"a":[${Array(1001).fill(0).join(",")}]}]`, limits), /more than 1000 items/);
  const fields = Array.from({ length: 1001 }, (_, i) => `"k${i}":0`).join(",");
  assert.match(v.structuralPreflight(`[{${fields}}]`, limits), /more than 1000 fields/);
  const row = `[${Array(50).fill(0).join(",")}]`;
  assert.match(v.structuralPreflight(`[${Array(10000).fill(row).join(",")}]`, limits), /more than 500000 values/);
  assert.match(v.structuralPreflight("[".repeat(65) + "]".repeat(65), limits), /nesting/);
});

test("CLI: pass, fail and usage exits", () => {
  const ledger = tmpFile([unit()]);
  const meta = tmpFile(metadata());
  const pass = cli([ledger, "--metadata", meta]);
  assert.equal(pass.status, 0, pass.stdout);
  assert.equal(pass.stdout.trim(), "PASS: 1 coverage units valid");
  const fail = cli([tmpFile([unit({ status: "done" })])]);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /^ERROR: \/0\/status: /m);
  assert.match(fail.stdout, /^FAIL: 1 validation error\(s\)$/m);
  assert.equal(cli([]).status, 2);
  assert.equal(cli([ledger, "--schema", meta]).status, 2);
  assert.equal(cli([ledger, "--metadata"]).status, 2);
  assert.equal(cli([ledger, "--metadata", meta, "--metadata", meta]).status, 2);
});

test("CLI: unreadable metadata and byte limit", () => {
  const ledger = tmpFile([unit()]);
  const missing = cli([ledger, "--metadata", path.join(tmpRoot, "absent.json")]);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /ERROR: metadata:: cannot open input/);
  const big = cli([tmpFile("[" + " ".repeat(5 * 1024 * 1024) + "]")]);
  assert.match(big.stdout, /byte limit/);
  const bom = cli([tmpFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("[]")]))]);
  assert.match(bom.stdout, /not valid JSON/);
});

test("error output is capped at 100 lines with 1000 malformed units", () => {
  const result = cli([tmpFile(Array(1000).fill({ coverage_id: 1 }))]);
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 101);
  assert.match(lines[100], /^FAIL: \d+ validation error\(s\); output capped at 100$/);
});

test("hostile ledger under a 128 MB heap does not crash", () => {
  const long = "x".repeat(2000);
  const hostile = [];
  while (JSON.stringify(hostile).length < 4.5 * 1024 * 1024) {
    hostile.push({ coverage_id: long, canonical_refs: { surface: long, expectation: long, domain: long, lens: long, context: long },
      checks: Array(20).fill({ agent_id: long }), attempts: Array(5).fill({ wave: long }) });
  }
  const result = cli([tmpFile(hostile)], ["--max-old-space-size=128"]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trim().split("\n");
  assert.ok(lines.length <= 101);
  assert.ok(lines.every((line) => line.length <= 7 + 256));
});

test("control characters in CLI output are escaped", () => {
  const u = coveredUnit();
  u.checks[0]["k" + ch(0x1b) + "[2J" + ch(0x202e)] = 1;
  const result = cli([tmpFile([u])]);
  assert.equal(result.status, 1);
  assert.ok(![...result.stdout].some((c) => [0x1b, 0x202e].includes(c.codePointAt(0))));
  assert.ok(result.stdout.includes("\\u001b"));
  assert.ok(result.stdout.includes("\\u202e"));
});

test("safeReadText refuses links (skipped only if links cannot be made)", (t) => {
  const target = tmpFile("[]", "target.json");
  const link = path.join(tmpRoot, "ledger-link.json");
  try {
    fs.symlinkSync(target, link);
  } catch (error) {
    if (error.code === "EPERM" || error.code === "ENOTSUP") return t.skip(`cannot create symlinks here (${error.code})`);
    throw error;
  }
  assert.match(cli([link]).stdout, /symbolic link/);
});

test("API refuses cyclic references", () => {
  const u = unit();
  u.tenant = u;
  assert.ok(hasError(errorsOf([u]), "repeated or cyclic"));
});

// ---- shared helpers ----

function sharedBlock(file) {
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("// ==== BEGIN SHARED HELPERS ====");
  const end = text.indexOf("// ==== END SHARED HELPERS ====");
  assert.ok(start >= 0 && end > start, `${file} has no shared helper block`);
  return text.slice(start, end);
}

test("shared helpers are byte-identical and present in every validator", () => {
  const block = sharedBlock(SCRIPT);
  assert.equal(block, sharedBlock(FINDINGS_SCRIPT));
  const orchestration = path.join(__dirname, "validate-orchestration.cjs");
  if (fs.existsSync(orchestration)) assert.equal(block, sharedBlock(orchestration));
  for (const name of ["isForbiddenPath", "computeReserve", "minimumCap"]) assert.ok(block.includes(`\nfunction ${name}(`), name);
  for (const name of ["VISIBLE_CONTENT", "PATH_FORBIDDEN_CHARACTER", "WINDOWS_RESERVED_COMPONENT", "UNSAFE_DIAGNOSTIC_CHARACTER",
    "ALLOWED_ARTIFACT_EXTENSIONS", "AGENT_ID", "BLOCK_REFS", "SHARED_LIMITS"]) {
    assert.match(block, new RegExp(`\\nconst ${name} = `), name);
  }
  assert.match(block, /\nfunction isSafeRelativePath\(/);
  assert.match(block, /\nfunction isOwnedArtifactPath\(/);
  const findings = require(FINDINGS_SCRIPT);
  for (const key of ["inputBytes", "nestingDepth", "validationErrors"]) assert.equal(v.LIMITS[key], findings.LIMITS[key]);
});

test("the report schema lens enum equals the class subset of the ledger's BLOCK_REFS", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "report-schema.json"), "utf8"));
  const classes = v.BLOCK_REFS.filter((ref) => !v.COMPANION_META_BLOCKS.some((meta) => ref.endsWith(`#${meta}`)));
  for (const branch of schema.items.oneOf) assert.deepEqual(branch.properties.lens.enum, classes);
});

test("Windows reserved names and storage/profile segments in paths", () => {
  for (const p of ["aux.json", "src/COM3/x", "lpt" + ch(0xb2) + ".txt", "src/conout$"]) assert.ok(!v.isSafeRelativePath(p), p);
  assert.ok(!v.isOwnedArtifactPath("agents/h1/artifacts/Storage/x.json"));
  assert.ok(!v.isOwnedArtifactPath("agents/h1/artifacts/a/profile/x.png"));
  assert.ok(v.isOwnedArtifactPath("agents/h1/artifacts/profiles/x.png"));
});

test("the run-metadata.json example in RUN-METADATA.md passes the metadata checks", () => {
  const doc = fs.readFileSync(path.join(__dirname, "RUN-METADATA.md"), "utf8");
  const block = /## 8\. run-metadata\.json[\s\S]*?```json\r?\n([\s\S]*?)```/.exec(doc);
  assert.ok(block, "the run-metadata.json example block is missing");
  const metadata = JSON.parse(block[1]);
  assert.deepEqual(errorsOf([], metadata), []);
});

// ---- v2: reason codes ----

test("critic_wave_limit defers what a critic proposes past the limit, bare or with text", () => {
  assert.ok(v.REASON_CODES.includes("critic_wave_limit"));
  for (const reason of ["critic_wave_limit", "critic_wave_limit: proposed by c3 after two critics had added work"]) {
    assert.ok(v.hasReasonCode(reason), reason);
    assert.deepEqual([...errorsOf([unit({ status: "deferred", unresolved: [reason] })], metadata())], [], reason);
  }
  assert.ok(!v.hasReasonCode("critic_wave_limit:"));
});

const V2_REASON_CODES = ["agent_cap_reached", "model_unavailable", "usage_limit_reached", "escalation_budget_exhausted",
  "needs_stronger_model", "dialogue_unresolved", "visual_baseline_unavailable"];

test("the seven v2 reason codes are appended in order and accepted bare or with text", () => {
  assert.deepEqual(v.REASON_CODES.slice(-7), V2_REASON_CODES);
  for (const code of V2_REASON_CODES) {
    assert.ok(v.hasReasonCode(code), code);
    assert.ok(v.hasReasonCode(`${code}: the cap of 40 was spent before this unit`), code);
    assert.ok(!v.hasReasonCode(`${code}:`), `${code}:`);
    assert.deepEqual([...errorsOf([unit({ status: "deferred", unresolved: [code] })], metadata())], [], code);
    assert.deepEqual([...errorsOf([unit({ status: "deferred", unresolved: [`${code}: text`] })], metadata())], [], code);
  }
  const blocked = unit({ status: "blocked", agent_id: "h1-menu", reviewed_paths: ["src/views/menu/MenuView.tsx"], checks: matrixChecks(),
    unresolved: ["needs_stronger_model: opus could not tell whether the two totals share one rule"] });
  assert.deepEqual([...errorsOf([blocked], metadata())], []);
});

// ---- v2: run-metadata@3 ----

function metadata3(overrides = {}) {
  return metadata({
    schema: "ui-audit/run-metadata@3",
    budget: 40,
    agents_spent: 30,
    agents_breakdown: {
      reconnaissance: 4, hunters: 12, critics: 3, candidate_verifiers: 4, record_verifiers: 2, replacement_verifiers: 0,
      consults: 3, judges: 0, escalations: 1, panels: 1, schema_repairs: 0, unspent: 10,
    },
    run_status: "in_progress",
    pause_reason: null,
    resumes: [],
    sandbox: {
      topology: "container-loopback",
      max_parallel_browsers: 2,
      host_facts: { cpu: "8-core x86-64", total_memory: "16 GiB", free_memory_at_perf_wave: null, vm_limits: null, cpu_benchmark_ms: null },
    },
    orchestration: {
      agent_cap: 40,
      reserve_cap: 40,
      reserve: { reconnaissance: 4, critics: 2, validation: 2, orchestration: 4 },
      orchestration_reserve_fraction: 0.1,
      max_parallel_agents: 4,
      dialogue_max_rounds: 2,
      escalation_max_steps: 2,
      allow_max_effort: false,
      allow_fable_usage_credits: false,
      effort_supported: true,
      effort_forced: null,
      routing_mode: "per_call",
      forced_model: null,
      named_agents: true,
      config_source: "config_file",
      config_path: "~/.claude/skills/ui-audit/ui-audit.config.json",
      cap_source: "profile_default",
      models: {
        haiku: { declared: "assume_available", observed: "available", first_evidence_seq: 3 },
        sonnet: { declared: "probe", observed: "available", first_evidence_seq: 1 },
        opus: { declared: "probe", observed: "available", first_evidence_seq: 9 },
        fable: { declared: "unavailable", observed: "untested", first_evidence_seq: null },
      },
    },
    ...overrides,
  });
}

// Applies a change to a deep copy of the @3 fixture and returns the errors.
function metaErrors(change) {
  const meta = structuredClone(metadata3());
  change(meta);
  return errorsOf([], meta);
}

test("run-metadata@2 keeps the v1 checks and @3 passes its fixture", () => {
  assert.deepEqual([...errorsOf([unit()], metadata())], []);
  assert.deepEqual([...errorsOf([unit()], metadata3())], []);
  assert.deepEqual([...errorsOf([coveredUnit()], metadata3())], []);
});

test("metadata schema must be @2 or @3", () => {
  assert.ok(hasError(errorsOf([], metadata({ schema: "ui-audit/run-metadata@1" })), "metadata:/schema"));
  const missing = metadata();
  delete missing.schema;
  assert.ok(hasError(errorsOf([], missing), "metadata:/schema"));
});

test("@3 paused, complete and other statuses with their pause_reason", () => {
  const paused = (reason) => metaErrors((m) => { m.run_status = "paused"; m.pause_reason = reason; });
  assert.deepEqual([...paused("usage_limit_reached: weekly limit, resets Monday")], []);
  assert.deepEqual([...paused("user_interrupted")], []);
  assert.deepEqual([...paused("model_unavailable: no opus")], []);
  assert.ok(hasError(paused(null), "a paused run needs a pause_reason"), "paused without pause_reason");
  assert.ok(hasError(paused("agent_cap_reached"), "a paused run needs a pause_reason"), "not a pause code");
  assert.ok(hasError(metaErrors((m) => { m.run_status = "complete"; m.pause_reason = "user_interrupted"; }), "must be null when run_status is \"complete\""));
  assert.ok(hasError(metaErrors((m) => { delete m.pause_reason; }), "metadata:/pause_reason"));
  assert.ok(hasError(metaErrors((m) => { m.run_status = "done"; }), "metadata:/run_status"));
  assert.deepEqual([...metaErrors((m) => { m.run_status = "incomplete"; m.incomplete_reason = "agent_cap_reached: 6 units left"; })], []);
});

test("@3 agent cap: equal to budget, at least minimumCap, at most 500", () => {
  assert.ok(hasError(metaErrors((m) => { m.orchestration.agent_cap = 41; }), "must equal budget"), "cap mismatch");
  const below = metaErrors((m) => {
    m.budget = 10; m.orchestration.agent_cap = 10; m.orchestration.reserve_cap = 10;
    m.agents_spent = 0; m.agents_breakdown = { ...m.agents_breakdown, hunters: 0, critics: 0, reconnaissance: 0, candidate_verifiers: 0, record_verifiers: 0, consults: 0, escalations: 0, panels: 0, unspent: 10 };
  });
  assert.ok(hasError(below, "minimumCap(standard, 0.1) = 11"), `standard below 11: ${below}`);
  const quick = metaErrors((m) => {
    m.profile = "quick"; m.matrices = { core: m.matrices.core };
    m.budget = 8; m.orchestration.agent_cap = 8; m.orchestration.reserve_cap = 8;
    m.orchestration.reserve = { reconnaissance: 4, critics: 1, validation: 1, orchestration: 2 };
    m.agents_spent = 0; m.agents_breakdown = { ...m.agents_breakdown, hunters: 0, critics: 0, reconnaissance: 0, candidate_verifiers: 0, record_verifiers: 0, consults: 0, escalations: 0, panels: 0, unspent: 8 };
  });
  assert.ok(hasError(quick, "minimumCap(quick, 0.1) = 9"), `quick below 9: ${quick}`);
  const deepOk = metaErrors((m) => {
    m.profile = "deep"; m.budget = 11; m.orchestration.agent_cap = 11; m.orchestration.reserve_cap = 11;
    m.orchestration.reserve = { reconnaissance: 4, critics: 2, validation: 2, orchestration: 2 };
    m.agents_spent = 0; m.agents_breakdown = { ...m.agents_breakdown, hunters: 0, critics: 0, reconnaissance: 0, candidate_verifiers: 0, record_verifiers: 0, consults: 0, escalations: 0, panels: 0, unspent: 11 };
  });
  assert.deepEqual([...deepOk], [], "deep at its minimum of 11");
  assert.ok(hasError(metaErrors((m) => { m.orchestration.agent_cap = 501; m.budget = 501; }), "metadata:/orchestration/agent_cap"));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.agent_cap = "40"; }), "metadata:/orchestration/agent_cap"));
});

test("@3 reserve: equal to computeReserve at reserve_cap, room for a hunter, reserve_cap within agent_cap", () => {
  assert.ok(hasError(metaErrors((m) => { m.orchestration.reserve.orchestration = 3; }), "must equal computeReserve(standard, 40, 0.1)"));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.reserve.critics = 1; }), "must equal computeReserve"));
  const noHunter = metaErrors((m) => {
    m.orchestration.reserve_cap = 10;
    m.orchestration.reserve = { reconnaissance: 4, critics: 2, validation: 2, orchestration: 2 };
  });
  assert.ok(hasError(noHunter, "leave no hunter under reserve_cap 10"), String(noHunter));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.reserve_cap = 41; }), "cannot be above agent_cap"));
  const raised = metaErrors((m) => {
    m.budget = 50; m.orchestration.agent_cap = 50; m.orchestration.cap_source = "owner_at_run";
    m.agents_breakdown.unspent = 20;
  });
  assert.deepEqual([...raised], [], "an owner override raises agent_cap above the gate's reserve_cap");
  assert.deepEqual([...metaErrors((m) => { m.orchestration.reserve.total = 12; })], [], "an optional total equal to the sum");
  assert.ok(hasError(metaErrors((m) => { m.orchestration.reserve.total = 11; }), "/reserve/total"));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.reserve.hunters = 1; }), "is not a reserve key"));
  assert.ok(hasError(metaErrors((m) => { delete m.orchestration.reserve_cap; }), "metadata:/orchestration/reserve_cap"));
  const fraction = metaErrors((m) => {
    m.orchestration.orchestration_reserve_fraction = 0.3;
    m.orchestration.reserve = { reconnaissance: 4, critics: 2, validation: 2, orchestration: 12 };
  });
  assert.deepEqual([...fraction], [], "the reserve follows the configured fraction");
});

test("@3 orchestration scalar fields", () => {
  const cases = [
    [(m) => { m.orchestration.orchestration_reserve_fraction = 0.04; }, "/orchestration_reserve_fraction"],
    [(m) => { m.orchestration.orchestration_reserve_fraction = 0.31; }, "/orchestration_reserve_fraction"],
    [(m) => { m.orchestration.max_parallel_agents = 0; }, "/max_parallel_agents"],
    [(m) => { m.orchestration.max_parallel_agents = 21; }, "/max_parallel_agents"],
    [(m) => { m.orchestration.dialogue_max_rounds = 4; }, "/dialogue_max_rounds"],
    [(m) => { m.orchestration.escalation_max_steps = -1; }, "/escalation_max_steps"],
    [(m) => { delete m.orchestration.allow_max_effort; }, "/allow_max_effort"],
    [(m) => { m.orchestration.allow_fable_usage_credits = "no"; }, "/allow_fable_usage_credits"],
    [(m) => { m.orchestration.named_agents = null; }, "/named_agents"],
    [(m) => { m.orchestration.effort_supported = "yes"; }, "/effort_supported"],
    [(m) => { m.orchestration.effort_forced = "extreme"; }, "/effort_forced"],
    [(m) => { m.orchestration.routing_mode = "auto"; }, "/routing_mode"],
    [(m) => { m.orchestration.forced_model = "opus"; }, 'a forced model requires routing_mode "single_model"'],
    [(m) => { m.orchestration.routing_mode = "single_model"; m.orchestration.forced_model = " "; }, "/forced_model"],
    [(m) => { m.orchestration.config_path = null; }, 'config_source "config_file" needs the config path'],
    [(m) => { m.orchestration.config_path = "/opt/ui-audit.config.json"; }, "/config_path"],
    [(m) => { m.orchestration.config_source = "defaults"; }, 'must be null when config_source is "defaults"'],
    [(m) => { m.orchestration.config_source = "env"; }, "/config_source"],
    [(m) => { m.orchestration.cap_source = "guess"; }, "/cap_source"],
    [(m) => { m.orchestration = []; }, "metadata:/orchestration: must be an object"],
  ];
  for (const [change, fragment] of cases) {
    const errors = metaErrors(change);
    assert.ok(hasError(errors, fragment), `${change}: ${errors}`);
  }
  const fine = [
    (m) => { m.orchestration.effort_supported = null; },
    (m) => { m.orchestration.effort_forced = "absent"; m.orchestration.effort_supported = false; },
    (m) => { m.orchestration.effort_forced = "high"; },
    (m) => { m.orchestration.routing_mode = "single_model"; },
    (m) => { m.orchestration.routing_mode = "single_model"; m.orchestration.forced_model = "sonnet"; },
    (m) => { m.orchestration.config_source = "defaults"; m.orchestration.config_path = null; },
    (m) => { m.orchestration.config_source = "setup_question"; m.orchestration.config_path = "${CLAUDE_PLUGIN_DATA}/ui-audit.config.json"; },
    (m) => { m.orchestration.allow_max_effort = true; },
  ];
  for (const change of fine) assert.deepEqual([...metaErrors(change)], [], String(change));
});

test("@3 models: exactly the four aliases with declared, observed and first_evidence_seq", () => {
  assert.ok(hasError(metaErrors((m) => { m.orchestration.models.gpt = { declared: "probe", observed: "untested", first_evidence_seq: null }; }), "unknown model alias"));
  assert.ok(hasError(metaErrors((m) => { delete m.orchestration.models.fable; }), 'missing model alias "fable"'));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.models.opus.observed = "maybe"; }), "/models/opus/observed"));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.models.opus.declared = "available"; }), "/models/opus/declared"));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.models.opus.first_evidence_seq = 0; }), "/models/opus/first_evidence_seq"));
  assert.ok(hasError(metaErrors((m) => { m.orchestration.models.opus.resets = []; }), "is not a model availability field"));
  assert.ok(hasError(metaErrors((m) => { delete m.orchestration.models.opus.observed; }), 'missing field "observed"'));
  for (const observed of ["untested", "available", "unavailable", "substituted", "unknown"]) {
    assert.deepEqual([...metaErrors((m) => { m.orchestration.models.opus.observed = observed; })], [], observed);
  }
});

test("@3 agents_breakdown sums to budget and budget - unspent equals agents_spent", () => {
  assert.ok(hasError(metaErrors((m) => { m.agents_breakdown.hunters += 1; }), "sums to 41; it must equal budget 40"));
  assert.ok(hasError(metaErrors((m) => { m.agents_spent = 29; }), "budget - unspent must equal agents_spent"));
  assert.ok(hasError(metaErrors((m) => { delete m.agents_breakdown.judges; }), "/agents_breakdown/judges"));
  assert.ok(hasError(metaErrors((m) => { m.agents_breakdown.fixers = 0; }), "is not a breakdown key"));
  assert.ok(hasError(metaErrors((m) => { m.agents_breakdown.panels = -1; m.agents_breakdown.unspent = 12; }), "/agents_breakdown/panels"));
  assert.deepEqual(v.BREAKDOWN_KEYS.slice(), ["reconnaissance", "hunters", "critics", "candidate_verifiers", "record_verifiers",
    "replacement_verifiers", "consults", "judges", "escalations", "panels", "schema_repairs", "unspent"]);
});

test("@3 sandbox: browsers 1..8, topology list, host facts", () => {
  assert.ok(hasError(metaErrors((m) => { m.sandbox.max_parallel_browsers = 0; }), "/sandbox/max_parallel_browsers"));
  assert.ok(hasError(metaErrors((m) => { m.sandbox.max_parallel_browsers = 9; }), "/sandbox/max_parallel_browsers"));
  assert.deepEqual([...metaErrors((m) => { m.sandbox.max_parallel_browsers = 8; })], []);
  assert.ok(hasError(metaErrors((m) => { m.sandbox.topology = "none"; }), "/sandbox/topology"));
  assert.ok(hasError(metaErrors((m) => { m.sandbox.topology = "docker"; }), "/sandbox/topology"));
  for (const topology of ["nat-forward", "netns-bridge", "browser-in-vm", "browser-in-wsl", "container-loopback", "host-only"]) {
    assert.deepEqual([...metaErrors((m) => { m.sandbox.topology = topology; })], [], topology);
  }
  assert.ok(hasError(metaErrors((m) => { delete m.sandbox.host_facts.vm_limits; }), 'missing field "vm_limits"'));
  assert.ok(hasError(metaErrors((m) => { m.sandbox.host_facts.wsl_limits = null; }), "is not a host fact"));
  assert.ok(hasError(metaErrors((m) => { m.sandbox.host_facts.cpu = 8; }), "/host_facts/cpu"));
  assert.ok(hasError(metaErrors((m) => { m.sandbox.host_facts.cpu_benchmark_ms = "fast"; }), "/host_facts/cpu_benchmark_ms"));
  assert.deepEqual([...metaErrors((m) => { m.sandbox.host_facts.cpu_benchmark_ms = 412.5; })], []);
  assert.ok(hasError(metaErrors((m) => { delete m.sandbox; }), "metadata:/sandbox"));
});

test("@3 resumes record each resume from a pause", () => {
  const entry = { at: "2026-10-16T09:30:00Z", from_status: "paused", pause_reason: "usage_limit_reached", note: "Resumed after the weekly reset." };
  assert.deepEqual([...metaErrors((m) => { m.resumes = [entry]; })], []);
  assert.ok(hasError(metaErrors((m) => { m.resumes = [{ ...entry, from_status: "incomplete" }]; }), 'must be "paused"'));
  assert.ok(hasError(metaErrors((m) => { m.resumes = [{ ...entry, pause_reason: "budget" }]; }), "/resumes/0/pause_reason"));
  assert.ok(hasError(metaErrors((m) => { m.resumes = [{ ...entry, by: "owner" }]; }), "is not a resume field"));
  assert.ok(hasError(metaErrors((m) => { m.resumes = [{ ...entry, at: "" }]; }), "/resumes/0/at"));
  assert.ok(hasError(metaErrors((m) => { delete m.resumes; }), "metadata:/resumes"));
});

// ---- v2: expectation namespaces and the baseline lens ----

const BASELINE_LENS = "VISUAL-AND-THEMING.md#Unintended visual change";
const VISUAL_BLOCKS = ["VISUAL-AND-THEMING.md#Core discipline", BASELINE_LENS, "VISUAL-AND-THEMING.md#Universal moves", "VISUAL-AND-THEMING.md#Validation rules"];

test("RULE: and baseline: expectation refs in ledger units", () => {
  for (const expectation of ["RULE:VITALS-02", "RULE:WCAG-24"]) {
    assert.deepEqual([...errorsOf([unit({ canonical_refs: { expectation } })])], [], expectation);
  }
  for (const expectation of ["RULE:vitals-02", "RULE:VITALS-2", "baseline:run-3#home", "baseline:run-3#home/m390.dim"]) {
    assert.ok(hasError(errorsOf([unit({ canonical_refs: { expectation } })]), "expectation namespace"), expectation);
  }
});

test("a baseline: expectation and the unintended visual change lens require each other", () => {
  const baselineUnit = unit({
    canonical_refs: { expectation: "baseline:run-3#home/m390.light", lens: BASELINE_LENS, context: "role=customer;vp=m390;theme=light" },
    selected_companion_blocks: VISUAL_BLOCKS,
  });
  assert.deepEqual([...errorsOf([baselineUnit], metadata3())], []);
  const wrongLens = unit({ canonical_refs: { expectation: "baseline:run-3#home/m390.light" } });
  assert.ok(hasError(errorsOf([wrongLens]), `a baseline: expectation needs the lens ${BASELINE_LENS}`));
  const wrongExpectation = unit({ canonical_refs: { lens: BASELINE_LENS }, selected_companion_blocks: VISUAL_BLOCKS });
  assert.ok(hasError(errorsOf([wrongExpectation]), `the lens ${BASELINE_LENS} needs a baseline: expectation`));
});

test("the five new classes are valid lenses", () => {
  for (const lens of ["FUNCTIONAL-FLOWS.md#Destructive actions, confirmation and undo", "PERFORMANCE.md#Back/forward cache",
    "ACCESSIBILITY.md#Pointer gestures and cancellation", "ACCESSIBILITY.md#Consistent navigation and help"]) {
    const file = lens.slice(0, lens.indexOf("#"));
    const blocks = [`${file}#Core discipline`, lens, `${file}#Universal moves`, `${file}#Validation rules`];
    assert.deepEqual([...errorsOf([unit({ canonical_refs: { lens }, selected_companion_blocks: blocks })])], [], lens);
  }
});

// ---- v2: environment files and shared helpers ----

test("CLI refuses an environment file as ledger or metadata with exit 2, without opening it", () => {
  for (const name of [".env", ".env.example", "app.env", ".envrc", ".dev.vars"]) {
    const input = cli([path.join(tmpRoot, "absent", name)]);
    assert.equal(input.status, 2, name);
    assert.match(input.stderr, /refusing to open an environment file/);
    const meta = cli([tmpFile([]), "--metadata", path.join(tmpRoot, "absent", name)]);
    assert.equal(meta.status, 2, name);
  }
  assert.equal(cli([tmpFile([], "environment.json")]).status, 0);
});

test("the shared helpers agree across validators", () => {
  const findings = require(FINDINGS_SCRIPT);
  for (const name of [".env", ".env.local", ".env.example", ".env-local", ".env_prod", ".envrc", "production.env", "app.env", ".dev.vars"]) {
    assert.ok(v.isForbiddenPath(name) && findings.isForbiddenPath(name), name);
  }
  for (const name of ["environment.ts", "envelope.svg", ".envoy.yaml", "dotenv.md"]) {
    assert.ok(!v.isForbiddenPath(name) && !findings.isForbiddenPath(name), name);
  }
  assert.deepEqual(v.MODEL_ALIASES, findings.MODEL_ALIASES);
  assert.deepEqual(v.EFFORT_LEVELS, findings.EFFORT_LEVELS);
  assert.deepEqual(v.SELF_ASSESSMENT_LEVELS, findings.SELF_ASSESSMENT_LEVELS);
  for (const profile of ["quick", "standard", "deep"]) {
    for (const fraction of [0.05, 0.1, 0.17, 0.3]) {
      assert.equal(v.minimumCap(profile, fraction), findings.minimumCap(profile, fraction));
      for (const cap of [9, 11, 13, 15, 30, 40, 90, 500]) assert.deepEqual(v.computeReserve(profile, cap, fraction), findings.computeReserve(profile, cap, fraction));
    }
  }
});
