// Tests for orchestrate.mjs. Run from the skill directory: node --test scripts/orchestrate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  MODEL_ALIASES, ROUTING_TABLE, TASK_KINDS, ROUTING_FLOORS, DECISIVE_TASK_KINDS, BUSINESS_LENSES, HUNT_PRECEDENCE,
  LADDER_STEPS, DEFAULT_CONFIG, SETUP_CALLS, computeReserve, minimumCap, normaliseAvailability, raiseEffort,
  fallbackFor, earmarkPrice, worstCaseCost, reserveFloor, budgetGate, routeTask, resolveTaskKind, huntTaskKindForLens,
  selfAssessmentTriggersEscalation, breakdownKeyFor, classifyAgentFailure, validateConfig, configCandidates,
  planningEstimate, runCli, isStrongLens, DEFAULT_CANDIDATE_RATE, DEFAULT_UNIT_GROWTH,
  VERIFY_BATCH_SIZE, VERIFY_SOURCE_BATCH_SIZE, CANDIDATE_VERIFY_KINDS, PHASE5_SEVERITIES, DEFAULT_MAX_POST_WAVE, mergeConfig,
} from './orchestrate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const SCRIPT = path.join(HERE, 'orchestrate.mjs');
const require = createRequire(import.meta.url);
const CASES = JSON.parse(fs.readFileSync(path.join(SKILL, 'test-fixtures', 'config-cases.json'), 'utf8'));

const ALL_AVAILABLE = { haiku: 'assume_available', sonnet: 'assume_available', opus: 'assume_available', fable: 'assume_available' };
const NO_FABLE = { ...DEFAULT_CONFIG.models, fable: 'unavailable' };
const NO_FABLE_NO_OPUS = { ...NO_FABLE, opus: 'unavailable' };

function cli(args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', input, timeout: 60000 });
}

test('computeReserve and minimumCap agree with the shared fixture', () => {
  for (const entry of CASES.reserve_cases) {
    assert.deepEqual(computeReserve(entry.profile, entry.cap, entry.fraction), entry.reserve, JSON.stringify(entry));
  }
  for (const entry of CASES.floor_reserve_cases) {
    assert.deepEqual(computeReserve(entry.profile, entry.cap, entry.fraction, entry.floor), entry.reserve, JSON.stringify(entry));
  }
  for (const entry of CASES.minimum_cap_cases) assert.equal(minimumCap(entry.profile, entry.fraction), entry.minimum);
  for (const entry of CASES.minimum_cap_with_setup_cases) {
    assert.equal(minimumCap(entry.profile, entry.fraction, entry.floor, entry.setup), entry.minimum, JSON.stringify(entry));
  }
});

test('the validators copy the same reserve arithmetic', () => {
  for (const file of ['validate-findings.cjs', 'validate-coverage-ledger.cjs', 'validate-orchestration.cjs']) {
    const v = require(path.join(SKILL, file));
    for (const entry of CASES.floor_reserve_cases) {
      assert.deepEqual(v.computeReserve(entry.profile, entry.cap, entry.fraction, entry.floor), entry.reserve, file);
    }
    for (const entry of CASES.minimum_cap_with_setup_cases) {
      assert.equal(v.minimumCap(entry.profile, entry.fraction, entry.floor, entry.setup), entry.minimum, file);
    }
  }
});

test('the reserve floor follows availability and dialogue rounds', () => {
  for (const entry of CASES.floor_cases) assert.equal(reserveFloor(entry.availability, entry.max_rounds).floor, entry.floor, entry.name);
  const parts = reserveFloor(DEFAULT_CONFIG.models, 2);
  assert.deepEqual([parts.consult, parts.escalation], [6, 5]);
  assert.deepEqual(reserveFloor(ALL_AVAILABLE, 2), { floor: 4, consult: 4, escalation: 1 });
  const nothing = { haiku: 'unavailable', sonnet: 'unavailable', opus: 'unavailable', fable: 'unavailable' };
  assert.equal(reserveFloor(nothing, 2).floor, 2, 'never below 2, even when nothing could be funded');
});

test('budgetGate: defaults hold the floor; small caps start only without it', () => {
  const quick = budgetGate({ profile: 'quick', cap: 15, fraction: 0.1, availability: DEFAULT_CONFIG.models });
  assert.equal(quick.reserve.total, 12);
  assert.equal(quick.reserve_floor, 6);
  assert.equal(quick.reserve_floor_met, true);
  assert.equal(quick.setup_calls, SETUP_CALLS);
  assert.equal(quick.hunters_left, 2);
  assert.equal(quick.minimum_cap_with_floor, 14);
  assert.equal(quick.minimum_cap_to_start, 10);
  const standard = budgetGate({ profile: 'standard', cap: 40, fraction: 0.1, availability: DEFAULT_CONFIG.models });
  assert.deepEqual([standard.reserve.total, standard.reserve.orchestration], [14, 6]);
  const deep = budgetGate({ profile: 'deep', cap: 90, fraction: 0.1, availability: DEFAULT_CONFIG.models });
  assert.deepEqual([deep.reserve.total, deep.reserve.orchestration], [17, 9]);
  const small = budgetGate({ profile: 'quick', cap: 12, fraction: 0.1, availability: DEFAULT_CONFIG.models });
  assert.equal(small.reserve_floor_met, false);
  assert.equal(small.can_start, true);
  assert.equal(small.reserve.orchestration, 2);
  const none = budgetGate({ profile: 'quick', cap: 9, fraction: 0.1, availability: DEFAULT_CONFIG.models });
  assert.equal(none.can_start, false);
  const allUp = budgetGate({ profile: 'standard', cap: 40, fraction: 0.1, availability: ALL_AVAILABLE });
  assert.deepEqual([allUp.reserve_floor, allUp.reserve.orchestration, allUp.reserve.total], [4, 4, 12]);
});

test('normaliseAvailability reads declarations, observations and pairs', () => {
  assert.deepEqual(normaliseAvailability(DEFAULT_CONFIG.models), { haiku: 'available', sonnet: 'untested', opus: 'untested', fable: 'untested' });
  assert.deepEqual(normaliseAvailability({ haiku: { declared: 'probe', observed: 'available' }, sonnet: 'substituted', opus: 'unknown', fable: { declared: 'unavailable', observed: 'untested' } }),
    { haiku: 'available', sonnet: 'unavailable', opus: 'available', fable: 'unavailable' });
  assert.equal(normaliseAvailability(undefined).fable, 'untested');
});

test('raiseEffort steps up and respects allow_max_effort', () => {
  assert.equal(raiseEffort('high'), 'xhigh');
  assert.equal(raiseEffort('xhigh'), 'xhigh');
  assert.equal(raiseEffort('xhigh', true), 'max');
  assert.equal(raiseEffort('low'), 'medium');
});

test('fallback ladders: fable, opus, sonnet and haiku', () => {
  assert.deepEqual(fallbackFor('fable', 'judge', ALL_AVAILABLE).mode, 'single');
  const noFable = fallbackFor('fable', 'verify_candidate_strong', NO_FABLE, { effort: 'high' });
  assert.deepEqual([noFable.used, noFable.effort, noFable.mode, noFable.worst_case, noFable.agents_needed], ['opus', 'xhigh', 'panel_2_agree', 5, 2]);
  assert.equal(fallbackFor('fable', 'judge', NO_FABLE).worst_case, 3, 'a judge panel skips the dialogue round');
  const noOpus = fallbackFor('fable', 'hunt_business', NO_FABLE_NO_OPUS);
  assert.deepEqual([noOpus.used, noOpus.effort, noOpus.mode, noOpus.scope, noOpus.worst_case], ['sonnet', 'high', 'panel_3_majority', 'narrowed', 3]);
  const nonDecisive = fallbackFor('fable', 'critic_wave', NO_FABLE);
  assert.deepEqual([nonDecisive.used, nonDecisive.mode], ['opus', 'single']);
  const nothing = fallbackFor('fable', 'judge', { ...NO_FABLE_NO_OPUS, sonnet: 'unavailable' });
  assert.deepEqual([nothing.mode, nothing.used, nothing.worst_case, nothing.stronger_model_needed_tier], ['none', null, 0, 'fable']);
  const sonnetGone = fallbackFor('sonnet', 'hunt_standard', { ...ALL_AVAILABLE, sonnet: 'unavailable' });
  assert.deepEqual([sonnetGone.used, sonnetGone.mode], ['opus', 'single']);
  const huntOnlyHaiku = fallbackFor('sonnet', 'hunt_standard', { haiku: 'available', sonnet: 'unavailable', opus: 'unavailable', fable: 'unavailable' });
  assert.equal(huntOnlyHaiku.mode, 'none', 'hunting never falls to haiku');
  const sweepOnlyHaiku = fallbackFor('sonnet', 'screenshot_sweep', { haiku: 'available', sonnet: 'unavailable', opus: 'unavailable', fable: 'unavailable' });
  assert.deepEqual([sweepOnlyHaiku.used, sweepOnlyHaiku.mode], ['haiku', 'single']);
  const haikuGone = fallbackFor('haiku', 'recon_routes', { ...ALL_AVAILABLE, haiku: 'unavailable' });
  assert.deepEqual([haikuGone.used, haikuGone.effort], ['sonnet', 'low']);
});

test('fixers never run as panels and stop at their minimum tier', () => {
  const business = fallbackFor('fable', 'fix_business', NO_FABLE);
  assert.deepEqual([business.used, business.mode], ['opus', 'single']);
  assert.equal(fallbackFor('fable', 'fix_business', NO_FABLE_NO_OPUS).mode, 'none');
  assert.equal(fallbackFor('opus', 'fix_business', NO_FABLE_NO_OPUS).mode, 'none');
  assert.equal(fallbackFor('sonnet', 'fix_logic', { haiku: 'available', sonnet: 'unavailable', opus: 'unavailable', fable: 'unavailable' }).mode, 'none');
});

test('LADDER_STEPS covers every alias and starts with the wanted model', () => {
  for (const alias of MODEL_ALIASES) assert.equal(LADDER_STEPS[alias][0].model, alias);
});

test('earmark pricing: an untested alias costs the larger of its two prices', () => {
  assert.equal(earmarkPrice('fable', 'judge', DEFAULT_CONFIG.models), 3);
  assert.equal(earmarkPrice('fable', 'judge', { ...DEFAULT_CONFIG.models, fable: 'available' }), 1);
  assert.equal(earmarkPrice('fable', 'hunt_business', DEFAULT_CONFIG.models), 5);
  assert.equal(worstCaseCost({ kind: 'judge' }, { availability: DEFAULT_CONFIG.models, pricing: 'plan' }), 1, 'the plan prices untested as available');
  assert.equal(worstCaseCost({ kind: 'consult', max_rounds: 2 }, { availability: ALL_AVAILABLE }), 4);
  assert.equal(worstCaseCost({ kind: 'consult', max_rounds: 3 }, { availability: NO_FABLE }), 8);
  assert.equal(worstCaseCost({ kind: 'escalation', task_kind: 'hunt_business' }, { availability: NO_FABLE }), 5);
  assert.equal(worstCaseCost({ kind: 'escalation', task_kind: 'critic_wave' }, { availability: { ...ALL_AVAILABLE, opus: 'unavailable' } }), 0,
    'a single step not above the original tier is no escalation');
  assert.equal(worstCaseCost({ kind: 'panel_2_agree', task_kind: 'judge' }), 3);
  assert.equal(worstCaseCost({ kind: 'panel_2_agree', task_kind: 'verify_record_strong' }), 5);
  assert.throws(() => worstCaseCost({ kind: 'mystery' }));
});

test('routeTask upgrades by severity, lens and proposal, and raises consult peers', () => {
  assert.equal(routeTask({ task: 'verify_candidate', severity: 'high', availability: ALL_AVAILABLE }).task_kind, 'verify_candidate_strong');
  assert.equal(routeTask({ task: 'verify_candidate', lens: BUSINESS_LENSES[3], availability: ALL_AVAILABLE }).task_kind, 'verify_candidate_strong');
  assert.equal(routeTask({ task: 'verify_candidate', proposal: 'needs_validation', availability: ALL_AVAILABLE }).task_kind, 'verify_candidate_strong');
  assert.equal(routeTask({ task: 'verify_record', severity: 'medium', availability: ALL_AVAILABLE }).task_kind, 'verify_record');
  assert.equal(routeTask({ task: 'fix_reverify', lens: 'PERFORMANCE.md#Layout shift', availability: ALL_AVAILABLE }).task_kind, 'fix_reverify_strong');
  assert.equal(routeTask({ task: 'hunt_standard', lens: 'PERFORMANCE.md#Fonts', availability: ALL_AVAILABLE }).task_kind, 'hunt_performance');
  assert.equal(routeTask({ task: 'consult_peer', requesterTier: 'opus', availability: ALL_AVAILABLE }).model, 'opus');
  assert.equal(routeTask({ task: 'consult_peer', requesterTier: 'haiku', availability: ALL_AVAILABLE }).model, 'sonnet');
  const routed = routeTask({ task: 'verify_candidate_strong', availability: NO_FABLE, config: { routing_overrides: { verify_candidate_strong: { model: 'fable' } } } });
  assert.deepEqual([routed.model, routed.used_model, routed.mode, routed.fallback.mode], ['fable', 'opus', 'panel_2_agree', 'panel_2_agree']);
  assert.equal(routeTask({ task: 'judge', availability: ALL_AVAILABLE, config: { routing_overrides: { judge: { effort: 'max' } } } }).effort, 'xhigh');
  assert.equal(routeTask({ task: 'judge', availability: ALL_AVAILABLE, routingMode: 'single_model' }).pass_model, false);
  const perm = routeTask({ task: 'permission_check', availability: ALL_AVAILABLE });
  assert.deepEqual([perm.model, perm.effort, perm.escalation_target], ['haiku', 'low', 'none']);
  assert.throws(() => routeTask({ task: 'nonsense' }));
});

test('hunt precedence and lens helpers', () => {
  assert.deepEqual([...HUNT_PRECEDENCE], ['hunt_business', 'hunt_performance', 'hunt_judgement', 'hunt_standard']);
  assert.equal(huntTaskKindForLens('FUNCTIONAL-FLOWS.md#Money, quantity and rounding'), 'hunt_business');
  assert.equal(huntTaskKindForLens('VISUAL-AND-THEMING.md#Unintended visual change'), 'hunt_judgement');
  assert.equal(huntTaskKindForLens('ACCESSIBILITY.md#Dialogs and overlays'), 'hunt_standard');
  assert.equal(resolveTaskKind('hunt_business', { lens: 'PERFORMANCE.md#Fonts' }), 'hunt_business', 'never downgrades');
  assert.ok(isStrongLens('PERFORMANCE.md#Fonts'));
  assert.ok(!isStrongLens('ACCESSIBILITY.md#Dialogs and overlays'));
});

test('routing table invariants: floors, decisive kinds, consult and judge rows', () => {
  for (const kind of TASK_KINDS) {
    const row = ROUTING_TABLE[kind];
    assert.ok(MODEL_ALIASES.includes(row.model), kind);
    assert.ok(row.escalation === 'none' || MODEL_ALIASES.includes(row.escalation), kind);
    if (row.escalation !== 'none') assert.ok(MODEL_ALIASES.indexOf(row.escalation) > MODEL_ALIASES.indexOf(row.model), `${kind} escalates upwards`);
    if (ROUTING_FLOORS[kind]) assert.ok(MODEL_ALIASES.indexOf(row.model) >= MODEL_ALIASES.indexOf(ROUTING_FLOORS[kind]), `${kind} meets its own floor`);
  }
  assert.deepEqual(ROUTING_TABLE.consult_peer, { model: 'sonnet', effort: 'medium', escalation: 'none' });
  assert.deepEqual(ROUTING_TABLE.judge, { model: 'fable', effort: 'high', escalation: 'none' });
  for (const kind of DECISIVE_TASK_KINDS) assert.ok(TASK_KINDS.includes(kind));
});

test('selfAssessmentTriggersEscalation', () => {
  assert.equal(selfAssessmentTriggersEscalation({ level: 'high', needs_stronger_model: false }), false);
  assert.equal(selfAssessmentTriggersEscalation({ level: 'medium', needs_stronger_model: true }), true);
  assert.equal(selfAssessmentTriggersEscalation({ level: 'unsure' }), true);
  assert.equal(selfAssessmentTriggersEscalation(null), true, 'a missing block is not a high rating');
});

test('breakdownKeyFor follows the table of ORCHESTRATION.md 8.2', () => {
  const inv = (fields) => ({ kind: 'launch', retry_of: null, fallback_ref: null, ...fields });
  const panels = { 'fb-01': { mode: 'panel_2_agree' }, 'fb-02': { mode: 'single' } };
  assert.equal(breakdownKeyFor(inv({ purpose: 'panel', fallback_ref: 'fb-01', phase: '3', task_kind: 'verify_candidate_strong' }), panels), 'panels');
  assert.equal(breakdownKeyFor(inv({ purpose: 'primary', fallback_ref: 'fb-02', phase: '3', task_kind: 'verify_candidate' }), panels), 'candidate_verifiers');
  assert.equal(breakdownKeyFor(inv({ purpose: 'primary', phase: '1', task_kind: 'permission_check' })), 'reconnaissance');
  assert.equal(breakdownKeyFor(inv({ purpose: 'replacement', phase: '1', task_kind: 'recon_routes' })), 'reconnaissance');
  assert.equal(breakdownKeyFor(inv({ purpose: 'primary', phase: '2', task_kind: 'screenshot_sweep' })), 'hunters');
  assert.equal(breakdownKeyFor(inv({ purpose: 'primary', phase: '2', task_kind: 'critic_final' })), 'critics');
  assert.equal(breakdownKeyFor(inv({ purpose: 'primary', phase: '5', task_kind: 'verify_record' })), 'record_verifiers');
  assert.equal(breakdownKeyFor(inv({ purpose: 'replacement', phase: '5', task_kind: 'verify_record_strong' })), 'replacement_verifiers');
  assert.equal(breakdownKeyFor(inv({ purpose: 'consult_resume', phase: '2', task_kind: 'hunt_business' })), 'consults');
  assert.equal(breakdownKeyFor(inv({ purpose: 'judge', phase: '2', task_kind: 'judge' })), 'judges');
  assert.equal(breakdownKeyFor(inv({ purpose: 'primary', phase: '4', task_kind: 'hunt_standard' })), null);
  assert.equal(breakdownKeyFor(inv({ purpose: 'fix', phase: 'F3', task_kind: 'fix_logic' }), {}, 'fix'), 'fixers');
  assert.equal(breakdownKeyFor(inv({ purpose: 'fix', kind: 'resume', phase: 'F3', task_kind: 'fix_logic' }), {}, 'fix'), 'fixer_continuations');
  assert.equal(breakdownKeyFor(inv({ purpose: 'fix', kind: 'resume', retry_of: 2, phase: 'F3', task_kind: 'fix_logic' }), {}, 'fix'), 'fixers');
  assert.equal(breakdownKeyFor(inv({ purpose: 'fix_reverify', phase: 'F5', task_kind: 'fix_reverify' }), {}, 'fix'), 'reverifiers');
});

test('classifyAgentFailure follows the documented order', () => {
  const cases = [
    ['Too many agents: concurrent subagent limit reached, do not retry immediately', 'concurrency_limit'],
    ['This request needs usage credits; the prompt went unanswered and nothing was sent', 'consent_dropped'],
    ["Agent terminated early due to an API error: You've hit your opus limit - resets 4pm", 'usage_limit_family'],
    ['Sonnet limit reached', 'usage_limit_family'],
    ["You've hit your weekly limit", 'usage_limit_shared'],
    ['Session limit reached; resets at 10:00', 'usage_limit_shared'],
    ['Model fable is not available with the current plan', 'plan_excludes_model'],
    ['claude_code_version_too_old', 'version_too_old'],
    ['There was an issue with the selected model; it may not exist or you may not have access', 'model_unavailable'],
    ['API Error: 529 Overloaded', 'overload'],
    ['Agent terminated early due to an API error: socket hang up', 'terminated'],
    ['something else entirely', 'other'],
  ];
  for (const [text, expected] of cases) assert.equal(classifyAgentFailure(text).failure_class, expected, text);
  const family = classifyAgentFailure("You've hit your opus limit · resets 3pm (Europe/Madrid)");
  assert.deepEqual(family, { failure_class: 'usage_limit_family', family: 'opus', reset_text: 'resets 3pm (Europe/Madrid)' });
  assert.equal(classifyAgentFailure(undefined).failure_class, 'other');
});

test('validateConfig: shared valid and invalid cases', () => {
  for (const entry of CASES.config_cases.valid) assert.deepEqual(validateConfig(entry.config).errors, [], entry.name);
  for (const entry of CASES.config_cases.invalid) {
    const { errors } = validateConfig(entry.config);
    assert.ok(errors.some((line) => line.startsWith(entry.error)), `${entry.name}: ${errors.join(' | ')}`);
  }
  const warned = validateConfig({ schema: 'ui-audit/config@1', profile: 'quick', agent_cap: { quick: 12, standard: 40, deep: 90 } });
  assert.deepEqual(warned.errors, []);
  assert.ok(warned.warnings.some((line) => line.includes('/agent_cap/quick')), 'a cap that cannot hold the floor is a warning');
  const inSkill = validateConfig({ schema: 'ui-audit/config@1', output_root: path.join(SKILL, 'runs') }, { skillDir: SKILL });
  assert.ok(inSkill.errors.some((line) => line.startsWith('/output_root')));
});

test('configCandidates: plugin data first, then the skill folder, then the output root', () => {
  const list = configCandidates({ env: { CLAUDE_PLUGIN_DATA: '/data/plugin' }, skillDir: '/skills/ui-audit', home: '/home/me' });
  assert.deepEqual(list.map((entry) => entry.split(path.sep).join('/')), [
    '/data/plugin/ui-audit.config.json', '/skills/ui-audit/ui-audit.config.json', '/home/me/ui-audit-skill/ui-audit.config.json',
  ]);
  assert.equal(configCandidates({ env: {}, skillDir: '/s', home: '/h' }).length, 2);
});

test('planningEstimate reproduces the worked example of ORCHESTRATION.md 1.6', () => {
  const groups = [
    { id: 'checkout', task_kind: 'hunt_standard', units: 8, runtime_units: 7 },
    { id: 'account', task_kind: 'hunt_standard', units: 6, runtime_units: 6 },
    { id: 'catalog', task_kind: 'hunt_standard', units: 6, runtime_units: 6 },
    { id: 'cart', task_kind: 'hunt_business', units: 6, runtime_units: 6 },
    { id: 'nav', task_kind: 'hunt_judgement', units: 5, runtime_units: 5 },
    { id: 'perf', task_kind: 'hunt_performance', units: 6, runtime_units: 6 },
  ];
  const estimate = planningEstimate({
    profile: 'standard', cap: 40, fraction: 0.1, max_parallel_agents: 4, max_parallel_browsers: 2,
    availability: ALL_AVAILABLE, groups,
  });
  assert.equal(estimate.units_expected, 37 + 12);
  assert.equal(estimate.hunters, 7);
  assert.equal(estimate.waves, 4);
  assert.equal(estimate.critics, 3, 'two post-wave critics, the standard limit, and cfinal');
  assert.equal(estimate.assumptions.expected_candidates, 19);
  assert.deepEqual(
    [estimate.assumptions.verification.strong, estimate.assumptions.verification.batched_source,
      estimate.assumptions.verification.batched_minor, estimate.assumptions.verification.single,
      estimate.assumptions.verification.phase5_records],
    [5, 3, 7, 4, 2],
  );
  assert.equal(estimate.verifiers, 5 + 1 + 2 + 4 + 2);
  assert.equal(estimate.orchestration_reserve, 4);
  assert.equal(estimate.setup_calls, 1);
  assert.equal(estimate.total_calls, 1 + 4 + 7 + 3 + 14 + 4);
  assert.equal(estimate.fits, true);
  assert.equal(estimate.panel_calls, 0);
  const byModelSum = Object.values(estimate.by_model).reduce((a, b) => a + b, 0);
  assert.equal(byModelSum + estimate.orchestration_reserve, estimate.total_calls);
});

test('planningEstimate prices panels when fable is declared unavailable, and suggests a way to fit', () => {
  const input = {
    profile: 'standard', cap: 40, fraction: 0.1, max_parallel_agents: 4, max_parallel_browsers: 2,
    availability: NO_FABLE,
    routing_overrides: {},
    groups: [
      { task_kind: 'hunt_business', units: 24 },
      { task_kind: 'hunt_standard', units: 24 },
      { task_kind: 'hunt_standard', units: 12 },
    ],
  };
  const estimate = planningEstimate(input);
  assert.ok(estimate.panel_calls === 0, 'opus-routed lines run on opus; only fable-routed lines become panels');
  const withOverride = planningEstimate({ ...input, routing_overrides: { verify_candidate_strong: { model: 'fable' } } });
  assert.ok(withOverride.panel_calls > 0);
  assert.ok(withOverride.total_calls > estimate.total_calls);
  assert.equal(withOverride.fits, false);
  assert.ok(typeof withOverride.suggestion === 'string' && withOverride.suggestion.length > 0);
  assert.ok(withOverride.options.cap.cap > 40);
  assert.ok(withOverride.uncovered_if_capped.units > 0);
});

test('planningEstimate: quick has one critic and no record verifiers; deep adds headroom; unroutable groups are uncovered', () => {
  const base = { cap: 90, fraction: 0.1, availability: ALL_AVAILABLE, groups: [{ task_kind: 'hunt_standard', units: 20 }] };
  const quick = planningEstimate({ ...base, profile: 'quick' });
  assert.equal(quick.critics, 1);
  assert.equal(quick.units_expected, 20, 'quick never grows: its final critic defers');
  // 8 candidates: 2 source-only (one source batch), 4 minor (one batch), 2 single; no Phase 5.
  assert.equal(quick.verifiers, 1 + 1 + 2, '20 runtime units at the default rate 0.4');
  const deep = planningEstimate({ ...base, profile: 'deep' });
  assert.equal(deep.units_expected, 30, 'deep expects the critics to add half the seeded units');
  assert.equal(deep.hunters, 3, 'two seeded hunters plus one for the expected growth');
  // 12 candidates: 2 source-only, 6 minor (two batches), 4 single, 2 Phase 5 records plus 1 headroom.
  assert.equal(deep.verifiers, 1 + 2 + 4 + 2 + 1);
  const noModels = planningEstimate({ ...base, profile: 'standard', availability: { haiku: 'available', sonnet: 'unavailable', opus: 'unavailable', fable: 'unavailable' } });
  assert.equal(noModels.hunters, 0);
  assert.equal(noModels.unrouted_groups.length, 1);
  assert.ok(noModels.uncovered_if_capped.units >= 20);
});

test('planningEstimate uses the measured defaults and says which assumptions it used', () => {
  const groups = [{ task_kind: 'hunt_standard', units: 24 }, { task_kind: 'hunt_standard', units: 6, runtime_units: 0 }];
  const base = { profile: 'standard', cap: 200, fraction: 0.1, availability: ALL_AVAILABLE, groups };
  const estimate = planningEstimate(base);
  assert.equal(DEFAULT_CANDIDATE_RATE, 0.4);
  assert.deepEqual({ ...DEFAULT_UNIT_GROWTH }, { quick: 0, standard: 0.3, deep: 0.5 });
  assert.equal(estimate.units_seeded, 30);
  assert.equal(estimate.units_expected, 30 + 9);
  assert.equal(estimate.hunters, 2 + 1 + 1, 'ceil(24/12) + ceil(6/12) seeded, plus one for the growth');
  // 24 runtime units plus ceil(24 x 0.3) = 8 expected from the critics, at 0.4.
  const { verification, ...rates } = estimate.assumptions;
  assert.deepEqual(rates, {
    candidate_rate: 0.4, candidate_rate_source: 'default', expected_candidates: 13,
    unit_growth: 0.3, unit_growth_source: 'default',
    max_post_wave_critics: 2, max_post_wave_critics_source: 'config',
  });
  assert.equal(verification.minor_share, 0.6);
  const measured = planningEstimate({ ...base, expected_candidate_rate: 0.1, expected_unit_growth: 0 });
  assert.equal(measured.units_expected, 30);
  assert.equal(measured.assumptions.candidate_rate_source, 'input');
  assert.equal(measured.assumptions.unit_growth_source, 'input');
  assert.equal(measured.assumptions.expected_candidates, 3);
  const given = planningEstimate({ ...base, expected_candidates: 7 });
  assert.equal(given.assumptions.candidate_rate_source, 'expected_candidates');
  assert.equal(given.assumptions.expected_candidates, 7);
  assert.throws(() => planningEstimate({ ...base, expected_unit_growth: -1 }), /expected_unit_growth/);
});

test('planningEstimate gives post-wave critics only up to the limit, then one cfinal', () => {
  const groups = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, task_kind: 'hunt_standard', units: 12 }));
  const base = { cap: 500, fraction: 0.1, max_parallel_agents: 2, availability: ALL_AVAILABLE, groups, expected_unit_growth: 0 };
  assert.deepEqual({ ...DEFAULT_MAX_POST_WAVE }, { standard: 2, deep: 3 });
  const standard = planningEstimate({ ...base, profile: 'standard' });
  assert.equal(standard.waves, 5);
  assert.equal(standard.critics, 3);
  assert.equal(standard.critic_calls, 3);
  const deep = planningEstimate({ ...base, profile: 'deep' });
  assert.equal(deep.critics, 4);
  const configured = planningEstimate({ ...base, profile: 'deep', config: { critics: { max_post_wave: { deep: 1 } } } });
  assert.equal(configured.critics, 2);
  assert.equal(configured.assumptions.max_post_wave_critics_source, 'config');
  const given = planningEstimate({ ...base, profile: 'standard', max_post_wave_critics: 9 });
  assert.equal(given.critics, 5 + 1, 'never more post-wave critics than waves');
  assert.equal(given.assumptions.max_post_wave_critics_source, 'input');
  const quick = planningEstimate({ ...base, profile: 'quick' });
  assert.equal(quick.critics, 1);
  assert.equal(quick.assumptions.max_post_wave_critics, 0);
  assert.throws(() => planningEstimate({ ...base, profile: 'standard', max_post_wave_critics: -1 }), /max_post_wave_critics/);
});

test('validateConfig: critics.max_post_wave per profile, one profile alone keeps the other default', () => {
  const ok = (critics) => validateConfig({ schema: 'ui-audit/config@1', critics }).errors;
  assert.deepEqual(ok({ max_post_wave: { standard: 1, deep: 10 } }), []);
  assert.deepEqual(ok({ max_post_wave: { deep: 4 } }), []);
  assert.deepEqual(mergeConfig({ critics: { max_post_wave: { deep: 4 } } }).critics.max_post_wave, { standard: 2, deep: 4 });
  assert.ok(ok({ max_post_wave: { quick: 1 } }).some((line) => line.startsWith('/critics/max_post_wave/quick')));
  assert.ok(ok({ max_post_wave: { standard: 0 } }).some((line) => line.startsWith('/critics/max_post_wave/standard')));
  assert.ok(ok({ max_post_wave: { deep: 11 } }).some((line) => line.startsWith('/critics/max_post_wave/deep')));
  assert.ok(ok({ max_post_wave: 2 }).some((line) => line.startsWith('/critics/max_post_wave')));
  assert.ok(ok({ max_post_wave: { deep: 3 }, other: 1 }).some((line) => line.startsWith('/critics/other')));
});

test('planningEstimate suggests spending less before it suggests a larger cap', () => {
  const groups = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, task_kind: 'hunt_standard', units: 12 }));
  const tight = planningEstimate({ profile: 'standard', cap: 40, fraction: 0.1, availability: ALL_AVAILABLE, groups });
  assert.equal(tight.fits, false);
  assert.ok(tight.options.narrow && tight.options.cap, 'every option is still computed');
  assert.match(tight.suggestion, /^Narrow the scope/);
  assert.ok(tight.options.narrow.groups_deferred < groups.length, 'narrowing always keeps at least one group');
  // One group that alone does not fit: no narrowing is possible, so a smaller profile comes next.
  const single = planningEstimate({ profile: 'standard', cap: 40, fraction: 0.1, availability: ALL_AVAILABLE, groups: [{ task_kind: 'hunt_standard', units: 72 }] });
  assert.equal(single.options.narrow, undefined);
  assert.match(single.suggestion, /^Switch to the quick profile/);
  const onlyCap = planningEstimate({ profile: 'quick', cap: 15, fraction: 0.1, availability: ALL_AVAILABLE, groups: [{ task_kind: 'hunt_standard', units: 72 }] });
  assert.match(onlyCap.suggestion, /^Only a larger cap fits: \d+, which is \d+ more calls than the cap of 15\.$/);
});

test('planningEstimate verifies in proportion: strong singly, minor and source-only in batches, Phase 5 only for high records', () => {
  const groups = [{ task_kind: 'hunt_standard', units: 100 }, { task_kind: 'hunt_business', units: 25 }];
  const base = { profile: 'standard', cap: 500, fraction: 0.1, availability: ALL_AVAILABLE, groups, expected_unit_growth: 0 };
  const estimate = planningEstimate(base);
  const v = estimate.assumptions.verification;
  assert.equal(estimate.assumptions.expected_candidates, 50);
  assert.equal(v.strong, 10, 'the business group is strong: ceil(25 x 0.4)');
  assert.equal(v.batched_source, 6, 'ceil(40 x 0.15)');
  assert.equal(v.batched_minor, 21, 'ceil(34 x 0.6)');
  assert.equal(v.single, 13);
  assert.equal(v.phase5_records, 5, 'ceil(50 x 0.1)');
  assert.equal(VERIFY_BATCH_SIZE, 5);
  assert.equal(VERIFY_SOURCE_BATCH_SIZE, 10);
  assert.equal(estimate.verifiers, 10 + 13 + Math.ceil(21 / 5) + 1 + 5);
  const measured = planningEstimate({ ...base, expected_source_share: 0, expected_minor_share: 0, expected_high_records: 0 });
  assert.equal(measured.verifiers, 50, 'with no batches and no high records every candidate gets one verifier');
  assert.throws(() => planningEstimate({ ...base, expected_minor_share: 1.5 }), /expected_minor_share/);
  for (const kind of CANDIDATE_VERIFY_KINDS) {
    assert.equal(breakdownKeyFor({ purpose: 'primary', phase: '3', task_kind: kind }), 'candidate_verifiers', kind);
  }
  assert.deepEqual([...PHASE5_SEVERITIES], ['high', 'blocker']);
});

test('CLI: budget, route, ladder, classify, estimate and check-config', () => {
  const budget = cli(['budget', '--profile', 'quick', '--cap', '15', '--fraction', '0.1']);
  assert.equal(budget.status, 0, budget.stderr);
  assert.equal(JSON.parse(budget.stdout).reserve.total, 12);
  const route = cli(['route', '--task', 'verify_candidate', '--severity', 'blocker']);
  assert.equal(JSON.parse(route.stdout).task_kind, 'verify_candidate_strong');
  const ladder = cli(['ladder', '--wanted', 'fable', '--task', 'judge']);
  assert.equal(JSON.parse(ladder.stdout).used, 'fable');
  const classify = cli(['classify'], 'API Error: 529 overloaded');
  assert.equal(JSON.parse(classify.stdout).failure_class, 'overload');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-orch-'));
  try {
    const input = path.join(dir, 'estimate-input.json');
    fs.writeFileSync(input, JSON.stringify({ profile: 'quick', cap: 15, groups: [{ task_kind: 'hunt_standard', units: 4 }], availability: ALL_AVAILABLE }));
    const estimate = cli(['estimate', '--input', input]);
    assert.equal(estimate.status, 0, estimate.stderr);
    assert.equal(JSON.parse(estimate.stdout).hunters, 1);
    const good = cli(['check-config', path.join(SKILL, 'ui-audit.config.example.json')]);
    assert.equal(good.status, 0, good.stdout);
    const badFile = path.join(dir, 'bad.json');
    fs.writeFileSync(badFile, JSON.stringify({ schema: 'ui-audit/config@1', profile: 'huge' }));
    const bad = cli(['check-config', badFile]);
    assert.equal(bad.status, 1);
    assert.ok(JSON.parse(bad.stdout).errors.some((line) => line.startsWith('/profile')));
    const envFile = cli(['check-config', path.join(dir, '.env')]);
    assert.equal(envFile.status, 1);
    assert.match(envFile.stderr, /environment file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const unknown = cli(['frobnicate']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /usage/);
  assert.throws(() => runCli(['route']), /needs --task/);
});
