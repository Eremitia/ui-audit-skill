"use strict";

// Tests for validate-orchestration.cjs. Run from the skill directory:
// node --test validate-orchestration.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "validate-orchestration.cjs");
const v = require(SCRIPT);
const EXAMPLES = path.join(__dirname, "examples");
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, "test-fixtures", "config-cases.json"), "utf8"));

const read = (file) => JSON.parse(fs.readFileSync(path.join(EXAMPLES, file), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const LOG = read("run-1/agent-log.json");
const META = read("run-1/run-metadata.json");
const FINDINGS = read("run-1/findings.json");
const LEDGER = read("run-1/coverage-ledger.json");
const FIX_LOG = read("run-1/fix/fix-log.json");
const FIX_AGENT_LOG = read("run-1/fix/agent-log.json");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ui-audit-orchestration-"));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
function tmpFile(name, content) {
  const file = path.join(tmpRoot, name);
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}
function cli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 60000 });
}
const has = (errors, text) => errors.some((line) => line.includes(text));
const agentErrors = (log, options = {}) => [...v.validateAgentLog(log, options)];
const fixErrors = (log, options = {}) => [...v.validateFixLog(log, options)];

test("the shipped examples pass every orchestration check", () => {
  assert.deepEqual(agentErrors(LOG, { metadata: META, findings: FINDINGS, ledger: LEDGER }), []);
  assert.deepEqual(fixErrors(FIX_LOG, { findings: FINDINGS, agentLog: FIX_AGENT_LOG }), []);
  assert.deepEqual(agentErrors(FIX_AGENT_LOG), []);
  assert.deepEqual([...v.validateConfigFile(read("ui-audit.config.json"))], []);
});

test("npm run validate:example commands pass from the CLI", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const commands = pkg.scripts["validate:example"].split("&&").map((part) => part.trim().split(/\s+/));
  assert.ok(commands.length >= 5);
  for (const [node, ...args] of commands) {
    assert.equal(node, "node");
    const result = spawnSync(process.execPath, args, { cwd: __dirname, encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /^(WARNING: .*\n)*PASS: /);
  }
});

test("the shared helper block is byte-identical to the other validators", () => {
  const block = (file) => {
    const text = fs.readFileSync(path.join(__dirname, file), "utf8");
    return text.slice(text.indexOf("// ==== BEGIN SHARED HELPERS ===="), text.indexOf("// ==== END SHARED HELPERS ===="));
  };
  assert.equal(block("validate-orchestration.cjs"), block("validate-findings.cjs"));
  assert.equal(block("validate-orchestration.cjs"), block("validate-coverage-ledger.cjs"));
});

test("running count: a call past the cap in force fails unless an override covers it", () => {
  const log = clone(LOG);
  log.cap = 20;
  const errors = agentErrors(log);
  assert.ok(has(errors, "passes the cap in force (20)"), errors.join("\n"));
  log.cap = 40;
  log.cap_overrides = [{ effective_from_seq: 20, old_cap: 20, new_cap: 40, at: "2026-10-16T12:00:00Z", approved_text: "Go to 40." }];
  assert.ok(!has(agentErrors(log), "passes the cap in force"));
  log.cap_overrides[0].approved_text = " ";
  assert.ok(has(agentErrors(log), "must quote the owner's words"));
});

test("invocation shape: seq, agent ID shapes, task kinds, resumes and refusals", () => {
  const gap = clone(LOG);
  gap.invocations[3].seq = 99;
  assert.ok(has(agentErrors(gap), "seq starts at 1 and has no gaps"));
  const shape = clone(LOG);
  shape.invocations[1].agent_id = "recon-a";
  assert.ok(has(agentErrors(shape), "matches no agent ID shape"));
  const mismatch = clone(LOG);
  mismatch.invocations[1].task_kind = "hunt_standard";
  assert.ok(has(agentErrors(mismatch), "does not fit agent ID"));
  const resume = clone(LOG);
  resume.invocations[8].agent_id = "h9-ghost";
  assert.ok(has(agentErrors(resume), "a resume needs an earlier launch"));
  const refused = clone(LOG);
  const index = refused.invocations.findIndex((inv) => inv.outcome === "refused_concurrency");
  refused.invocations[index].counts_against_cap = true;
  assert.ok(has(agentErrors(refused), "does not count"));
  const failed = clone(LOG);
  failed.invocations[0].outcome = "failed";
  assert.ok(has(agentErrors(failed), "a failed call needs its failure class"));
  const passed = clone(LOG);
  passed.invocations[0].model_passed = "opus";
  assert.ok(has(agentErrors(passed), "must be null (single-model mode) or equal model_requested"));
  const extra = clone(LOG);
  extra.invocations[0].note = "hello";
  assert.ok(has(agentErrors(extra), "is not an allowed field"));
});

test("every agent ID shape of SKILL.md is recognised", () => {
  const good = ["w0-perm", "r1a", "r1b-e1", "r1x-admin", "l1", "h3-orders", "h2e1-cart", "c1", "c2e1", "cfinal",
    "v1-checkout", "v1-checkout-a", "p2-cart-c", "q1-a11y", "j1-cart", "j1-cart-b", "s1", "w1-sweep", "w1e1-sweep",
    "x1-checkout", "x1e1-checkout", "y1-checkout", "y1-checkout-b"];
  for (const id of good) assert.ok(v.agentIdShape(id), id);
  for (const id of ["r1e", "h-orders", "cfinal-superseded-1", "fixtures", "z1-x", "V1-x"]) assert.equal(v.agentIdShape(id), null, id);
});

test("retries copy the call they retry", () => {
  const log = clone(LOG);
  const retry = log.invocations.find((inv) => inv.retry_of !== null);
  retry.phase = "3";
  assert.ok(has(agentErrors(log), "a retry copies phase"));
  retry.phase = "2";
  retry.retry_of = retry.seq;
  assert.ok(has(agentErrors(log), "must be the seq of an earlier invocation"));
});

test("metadata cross-checks: spent, breakdown, reserve and models", () => {
  const meta = clone(META);
  meta.agents_breakdown.hunters += 1;
  meta.agents_breakdown.unspent -= 1;
  meta.agents_spent += 1;
  const errors = agentErrors(LOG, { metadata: meta });
  assert.ok(has(errors, "agents_breakdown/hunters"), errors.join("\n"));
  assert.ok(has(errors, "agents_spent"));
  const reserve = clone(META);
  reserve.orchestration.reserve.orchestration = 6;
  assert.ok(has(agentErrors(LOG, { metadata: reserve }), "reserve/orchestration"));
  const models = clone(META);
  models.orchestration.models.opus.first_evidence_seq = 9;
  assert.ok(has(agentErrors(LOG, { metadata: models }), "models/opus/first_evidence_seq"));
});

test("open invocations and open items are allowed only while the run is in progress", () => {
  const log = clone(LOG);
  log.invocations[log.invocations.length - 1].outcome = null;
  log.invocations[log.invocations.length - 1].finished_at = null;
  log.escalations[0].outcome = "open";
  const complete = agentErrors(log, { metadata: META });
  assert.ok(has(complete, "still have outcome null"), complete.join("\n"));
  assert.ok(has(complete, "is still open"));
  const meta = clone(META);
  meta.run_status = "in_progress";
  const running = agentErrors(log, { metadata: meta });
  assert.ok(!has(running, "still have outcome null"));
  assert.ok(!has(running, "is still open"));
});

test("dialogues: invocation counts, judged outcomes and cancelled consults", () => {
  const count = clone(LOG);
  count.dialogues[0].invocations = 4;
  assert.ok(has(agentErrors(count), "counted invocations that name"));
  const agreed = clone(LOG);
  agreed.dialogues[0].outcome = "agreed";
  assert.ok(has(agentErrors(agreed), "says who agreed"));
  const cancelled = clone(LOG);
  cancelled.dialogues.push({ ...clone(LOG.dialogues[0]), id: "dlg-02", outcome: "cancelled_budget", rounds: [], invocations: 0, judge: null, judge_route_mode: null, judge_fallback_ref: null });
  assert.deepEqual(agentErrors(cancelled).filter((line) => line.includes("/dialogues/1")), []);
  const none = clone(LOG);
  none.dialogues[0].judge_route_mode = "none";
  none.dialogues[0].outcome = "judged_requester";
  assert.ok(has(agentErrors(none), '"none" closes the dialogue as judged_neither'));
  const summary = clone(LOG);
  summary.dialogues[0].summary = "x".repeat(1201);
  assert.ok(has(agentErrors(summary), "at most 1200 characters"));
});

test("escalations: sweep items, tier direction, fallback refs and unfunded items", () => {
  assert.equal(LOG.escalations[0].about.kind, "sweep");
  const down = clone(LOG);
  down.escalations[0].to_model_wanted = "haiku";
  down.escalations[0].to_model_used = "haiku";
  assert.ok(has(agentErrors(down), "wants a tier above from_model"));
  const missing = clone(LOG);
  missing.escalations[1].fallback_ref = null;
  assert.ok(has(agentErrors(missing), "is required when to_model_used differs"));
  const trigger = clone(LOG);
  trigger.escalations[0].trigger = "felt_like_it";
  assert.ok(has(agentErrors(trigger), "trigger"));
});

test("fallbacks: agent lists, invocation counts and worst cases", () => {
  const agents = clone(LOG);
  agents.fallbacks[0].agents = ["v1-checkout-a"];
  assert.ok(has(agentErrors(agents), "misses \"v1-checkout-b\""));
  const worst = clone(LOG);
  worst.fallbacks[0].worst_case = 2;
  assert.ok(has(agentErrors(worst), "is below the worst case of mode panel_2_agree"));
  const reason = clone(LOG);
  reason.fallbacks[0].reason = "because";
  assert.ok(has(agentErrors(reason), "/fallbacks/0/reason"));
  for (const allowed of ["usage_limit_family", "substituted", "overload", "declared_unavailable"]) {
    const log = clone(LOG);
    log.fallbacks[0].reason = allowed;
    assert.ok(!has(agentErrors(log), "/fallbacks/0/reason"), allowed);
  }
});

test("a log invocation that fits no breakdown key is invalid", () => {
  const log = clone(LOG);
  log.invocations[2].phase = "4";
  assert.ok(has(agentErrors(log), "fits no agents_breakdown key"));
});

test("findings cross-check: deliberation ids and outcomes must match the log", () => {
  const findings = clone(FINDINGS);
  const record = findings.find((item) => Array.isArray(item.deliberation) && item.deliberation.length > 0);
  assert.ok(record, "the example has a deliberation entry");
  record.deliberation[0].id = record.deliberation[0].id.replace(/[0-9]+$/, "77");
  assert.ok(has(agentErrors(LOG, { findings }), "of the agent log"));
});

test("ledger cross-check: unit refs must be ledger units", () => {
  const log = clone(LOG);
  log.uncovered_by_cap[0].ref = "no-such-unit";
  assert.ok(has(agentErrors(log, { ledger: LEDGER }), "not in the coverage ledger"));
});

test("fingerprint agents: independence of verification and known agents", () => {
  const confirmed = FINDINGS.find((item) => item.verdict === "confirmed");
  const map = {
    [confirmed.fingerprint]: { hunters: ["h1-checkout"], candidate_verifiers: ["v1-checkout-a", "v1-checkout-b"], record_verifiers: ["p1-checkout-a", "p1-checkout-b"], replacement_verifiers: [], consultants: [], judges: [] },
    by_unit: {},
  };
  assert.deepEqual(agentErrors(LOG, { findings: FINDINGS, fingerprints: map }), []);
  const lonely = clone(map);
  lonely[confirmed.fingerprint].candidate_verifiers = [];
  assert.ok(has(agentErrors(LOG, { findings: FINDINGS, fingerprints: lonely }), "needs an independent candidate verifier"));
  const twice = clone(map);
  twice[confirmed.fingerprint].record_verifiers = ["v1-checkout-a"];
  assert.ok(has(agentErrors(LOG, { findings: FINDINGS, fingerprints: twice }), "verification must be independent"));
  const ghost = clone(map);
  ghost[confirmed.fingerprint].judges = ["j7-ghost"];
  assert.ok(has(agentErrors(LOG, { findings: FINDINGS, fingerprints: ghost }), "is not an agent of the log"));
});

test("fingerprint agents: a Phase 3 verifier may close a record that is not high or blocker", () => {
  const confirmed = FINDINGS.find((item) => item.verdict === "confirmed");
  assert.equal(confirmed.severity.overall, "high", "the example record is high");
  const closed = {
    [confirmed.fingerprint]: { hunters: ["h1-checkout"], candidate_verifiers: ["v1-checkout-a"], record_verifiers: ["v1-checkout-a"], replacement_verifiers: [], consultants: [], judges: [] },
    by_unit: { u1: { hunters: ["h1-checkout"], candidate_verifiers: ["v1-checkout-a"], record_verifiers: ["v1-checkout-a"], replacement_verifiers: [], consultants: [], judges: [] } },
  };
  // A high record still needs a separate Phase 5 agent.
  assert.ok(has(agentErrors(LOG, { findings: FINDINGS, fingerprints: closed }), "verification must be independent"));
  // The same lists pass once the record is low: the verifier closed it in Phase 3.
  const findings = clone(FINDINGS);
  findings.find((item) => item.fingerprint === confirmed.fingerprint).severity.overall = "low";
  assert.deepEqual(agentErrors(LOG, { findings, fingerprints: closed }), []);
  // Without findings the validator cannot tell the severity, so it keeps the strict rule.
  assert.ok(has(agentErrors(LOG, { fingerprints: closed }), "verification must be independent"));
  // A verifier never closes a record it hunted.
  const hunted = clone(closed);
  hunted[confirmed.fingerprint].hunters = ["v1-checkout-a"];
  assert.ok(has(agentErrors(LOG, { findings, fingerprints: hunted }), "verification must be independent"));
});

test("fix log: commit attribution, protected branches, readiness, approvals and independence", () => {
  const attributed = clone(FIX_LOG);
  attributed.fixes[0].commits[0].message += "\n\nCo-Authored-By: Someone <someone@example.com>";
  assert.ok(has(fixErrors(attributed), "attribution line"));
  const generated = clone(FIX_LOG);
  generated.fixes[0].commits[0].message += "\n\nGenerated with a tool";
  assert.ok(has(fixErrors(generated), "attribution line"));
  const protectedBranch = clone(FIX_LOG);
  protectedBranch.fixes[0].branch = "develop";
  assert.ok(has(fixErrors(protectedBranch), "protected or base branch"));
  const red = clone(FIX_LOG);
  red.fixes[0].checks[1].exit_code = 1;
  assert.ok(has(fixErrors(red), "ready needs every check at exit 0"));
  const self = clone(FIX_LOG);
  self.fixes[0].reverify.agent = self.fixes[0].fixer_agent;
  assert.ok(has(fixErrors(self), "never re-verifies its own fix"));
  const opened = clone(FIX_LOG);
  opened.fixes[0].pr.state = "opened";
  opened.fixes[0].status = "pr_opened";
  assert.ok(has(fixErrors(opened), "quotes the owner's run-time approval"));
  assert.ok(has(fixErrors(opened), "needs push_approval"));
  const unconfirmed = clone(FIX_LOG);
  const nv = FINDINGS.find((item) => item.verdict !== "confirmed");
  unconfirmed.fixes[0].fingerprints = [nv.fingerprint];
  assert.ok(has(fixErrors(unconfirmed, { findings: FINDINGS }), "fixes only confirmed records"));
  const spent = clone(FIX_LOG);
  spent.spent = 2;
  spent.agents_breakdown.unspent = 28;
  assert.ok(has(fixErrors(spent, { agentLog: FIX_AGENT_LOG }), "must equal the fix agent log's spent"));
  const hooks = clone(FIX_LOG);
  hooks.hooks.detected = [".husky/"];
  assert.ok(has(fixErrors(hooks), "hooks exist"));
});

test("fix agent log: fixers never run as panels and fix logs open no dialogues", () => {
  const log = clone(FIX_AGENT_LOG);
  log.fallbacks.push({ id: "fb-01", task_kind: "fix_logic", wanted: "opus", used: "sonnet", effort: "high", mode: "panel_3_majority", reason: "model_unavailable", funded_from: "orchestration_reserve", worst_case: 3, reserve_before: 6, agents: [], invocations: 0, outcome: "not_funded", narrowed_to: null, about: null });
  assert.ok(has(agentErrors(log), "fixers never run as panels"));
  const dialogue = clone(FIX_AGENT_LOG);
  dialogue.dialogues.push(clone(LOG.dialogues[0]));
  assert.ok(has(agentErrors(dialogue), "fix mode opens no dialogues"));
});

test("config kind: the shared valid and invalid cases", () => {
  for (const entry of CASES.config_cases.valid) assert.deepEqual([...v.validateConfigFile(entry.config)], [], entry.name);
  for (const entry of CASES.config_cases.invalid) {
    const errors = [...v.validateConfigFile(entry.config)];
    assert.ok(errors.some((line) => line.startsWith(entry.error)), `${entry.name}: ${errors.join(" | ")}`);
  }
});

test("CLI: usage errors, environment files and failing input", () => {
  assert.equal(cli([path.join(EXAMPLES, "run-1/agent-log.json")]).status, 2, "--kind is required");
  assert.equal(cli([path.join(EXAMPLES, "run-1/agent-log.json"), "--kind", "receipt"]).status, 2);
  const env = cli([path.join(tmpRoot, ".env"), "--kind", "config"]);
  assert.equal(env.status, 2);
  assert.match(env.stderr, /environment file/);
  const broken = clone(LOG);
  broken.spent = 3;
  const result = cli([tmpFile("broken.json", broken), "--kind", "agent-log"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ERROR: \/spent: must equal/);
  assert.match(result.stdout, /FAIL: 1 validation error/);
  const notJson = cli([tmpFile("not-json.json", "{"), "--kind", "agent-log"]);
  assert.equal(notJson.status, 1);
  assert.match(notJson.stdout, /not valid JSON/);
});
