#!/usr/bin/env node
// Budget, routing, fallback and failure-classification arithmetic for the
// ui-audit parent session. ORCHESTRATION.md explains the rules; this module is
// the single place the numbers come from. Plain Node, no dependencies, no
// network, no file writes (the CLI prints JSON to stdout).
//
// Commands:
//   budget       --profile <p> --cap <n> [--fraction <f>] [--config <file>] [--availability <file>] [--setup-calls <n>]
//   estimate     --input <file>
//   route        --task <kind> [--severity <s>] [--lens <ref>] [--proposal needs_validation]
//                [--requester-tier <alias>] [--config <file>] [--availability <file>] [--routing-mode per_call|single_model]
//   ladder       --wanted <alias> --task <kind> [--effort <e>] [--config <file>] [--availability <file>]
//   classify     (error text on stdin, or --text <text>)
//   check-config <file>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_ALIASES = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);
export const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const PROFILES = Object.freeze(['quick', 'standard', 'deep']);
export const SEVERITIES = Object.freeze(['polish', 'low', 'medium', 'high', 'blocker']);
export const CONFIG_SCHEMA = 'ui-audit/config@1';

export const PROFILE_RESERVES = Object.freeze({
  quick: Object.freeze({ reconnaissance: 4, critics: 1, validation: 1 }),
  standard: Object.freeze({ reconnaissance: 4, critics: 2, validation: 2 }),
  deep: Object.freeze({ reconnaissance: 4, critics: 2, validation: 2 }),
});
export const DEFAULT_CAPS = Object.freeze({ quick: 15, standard: 40, deep: 90 });
export const AGENT_CAP_MAX = 500;
export const RESERVE_FRACTION_MIN = 0.05;
export const RESERVE_FRACTION_MAX = 0.3;
export const BASE_RESERVE_FLOOR = 2;
// The one-call agent permission check (w0-perm) that runs before the gate.
export const SETUP_CALLS = 1;
export const HUNTER_GROUP_UNITS = 12;
// Measured on a first deep run of a mid-size app: 99 candidates from 243 units, about 0.41.
export const DEFAULT_CANDIDATE_RATE = 0.4;
// Share of seeded units the coverage critics add during a run. That run seeded 153
// units and the critics added 85 (+56 %); quick never adds units (its critic defers).
export const DEFAULT_UNIT_GROWTH = Object.freeze({ quick: 0, standard: 0.3, deep: 0.5 });
// Proportional verification (VALIDATION-AND-REPORTING.md 2.1): low and polish candidates of one
// surface share a verifier, source-only candidates share a read-only verifier, and only high and
// blocker records get a Phase 5 agent of their own.
export const VERIFY_BATCH_SIZE = 5;
export const VERIFY_SOURCE_BATCH_SIZE = 10;
// Planning shares, measured on the same run: 63 of 85 confirmed records were low or polish,
// about a sixth of the candidates needed no browser, and none was high or blocker.
export const DEFAULT_MINOR_SHARE = 0.6;
export const DEFAULT_SOURCE_SHARE = 0.15;
export const DEFAULT_HIGH_RECORD_SHARE = 0.1;
// Severities whose record gets its own Phase 5 verifier outside quick.
export const PHASE5_SEVERITIES = Object.freeze(['high', 'blocker']);
// Post-wave critics that may still add work (HUNTING.md "Loop and termination"). On the first deep run
// the critics added 85 units over 13 passes, 43 of them in the first: later passes cost more than they
// found. Past the limit a critic's additions are deferred with critic_wave_limit.
export const DEFAULT_MAX_POST_WAVE = Object.freeze({ standard: 2, deep: 3 });
export const MAX_POST_WAVE_LIMIT = 10;

// The routing table. It must stay identical to ORCHESTRATION.md section 2.2
// (skill-docs.test.mjs compares them row by row).
export const ROUTING_TABLE = Object.freeze({
  permission_check: Object.freeze({ model: 'haiku', effort: 'low', escalation: 'none' }),
  recon_routes: Object.freeze({ model: 'haiku', effort: 'medium', escalation: 'sonnet' }),
  recon_runtime: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  recon_product: Object.freeze({ model: 'sonnet', effort: 'high', escalation: 'opus' }),
  recon_design_rules: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  recon_focused: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  ledger_draft: Object.freeze({ model: 'haiku', effort: 'low', escalation: 'sonnet' }),
  screenshot_sweep: Object.freeze({ model: 'haiku', effort: 'low', escalation: 'sonnet' }),
  hunt_standard: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  hunt_business: Object.freeze({ model: 'opus', effort: 'high', escalation: 'fable' }),
  hunt_performance: Object.freeze({ model: 'opus', effort: 'medium', escalation: 'fable' }),
  hunt_judgement: Object.freeze({ model: 'sonnet', effort: 'high', escalation: 'opus' }),
  critic_wave: Object.freeze({ model: 'sonnet', effort: 'high', escalation: 'opus' }),
  critic_final: Object.freeze({ model: 'opus', effort: 'high', escalation: 'fable' }),
  verify_candidate: Object.freeze({ model: 'sonnet', effort: 'high', escalation: 'opus' }),
  verify_candidate_strong: Object.freeze({ model: 'opus', effort: 'high', escalation: 'fable' }),
  verify_batch: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  verify_source_batch: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  verify_record: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  verify_record_strong: Object.freeze({ model: 'opus', effort: 'medium', escalation: 'fable' }),
  consult_peer: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'none' }),
  judge: Object.freeze({ model: 'fable', effort: 'high', escalation: 'none' }),
  schema_repair: Object.freeze({ model: 'haiku', effort: 'low', escalation: 'sonnet' }),
  fix_mechanical: Object.freeze({ model: 'haiku', effort: 'medium', escalation: 'sonnet' }),
  fix_logic: Object.freeze({ model: 'sonnet', effort: 'high', escalation: 'opus' }),
  fix_business: Object.freeze({ model: 'opus', effort: 'high', escalation: 'fable' }),
  fix_reverify: Object.freeze({ model: 'sonnet', effort: 'medium', escalation: 'opus' }),
  fix_reverify_strong: Object.freeze({ model: 'opus', effort: 'medium', escalation: 'fable' }),
});
export const TASK_KINDS = Object.freeze(Object.keys(ROUTING_TABLE));

// Overrides may never route these kinds below the given tier.
export const ROUTING_FLOORS = Object.freeze({
  judge: 'opus',
  critic_final: 'opus',
  verify_candidate_strong: 'opus',
  verify_record_strong: 'opus',
  hunt_business: 'opus',
  hunt_performance: 'opus',
  fix_business: 'opus',
  fix_reverify_strong: 'opus',
  hunt_standard: 'sonnet',
  hunt_judgement: 'sonnet',
  verify_candidate: 'sonnet',
  verify_batch: 'sonnet',
  verify_source_batch: 'sonnet',
  verify_record: 'sonnet',
});

export const DECISIVE_TASK_KINDS = Object.freeze([
  'verify_candidate_strong', 'verify_record_strong', 'critic_final', 'judge',
  'hunt_business', 'hunt_performance', 'fix_business', 'fix_reverify_strong',
]);
export const FIXER_TASK_KINDS = Object.freeze(['fix_mechanical', 'fix_logic', 'fix_business']);
export const MECHANICAL_TASK_KINDS = Object.freeze(
  TASK_KINDS.filter((kind) => ROUTING_TABLE[kind].model === 'haiku'),
);
export const HUNT_PRECEDENCE = Object.freeze(['hunt_business', 'hunt_performance', 'hunt_judgement', 'hunt_standard']);

export const BUSINESS_LENSES = Object.freeze([
  'LENSES.md#Business rules as displayed',
  'LENSES.md#Data consistency across screens',
  'FUNCTIONAL-FLOWS.md#Displayed business rules',
  'FUNCTIONAL-FLOWS.md#Figure consistency across screens',
  'FUNCTIONAL-FLOWS.md#Money, quantity and rounding',
  'FUNCTIONAL-FLOWS.md#Time, dates and time zones',
  'FUNCTIONAL-FLOWS.md#Exports match the screen',
]);
export const JUDGEMENT_LENSES = Object.freeze([
  'VISUAL-AND-THEMING.md#Generic or template look',
  'VISUAL-AND-THEMING.md#Unintended visual change',
]);

// The fallback ladders of ORCHESTRATION.md section 6.2, as data.
export const LADDER_STEPS = Object.freeze({
  fable: Object.freeze([
    Object.freeze({ model: 'fable', effort: 'same', decisive_mode: 'single', other_mode: 'single' }),
    Object.freeze({ model: 'opus', effort: 'raise', decisive_mode: 'panel_2_agree', other_mode: 'single' }),
    Object.freeze({ model: 'sonnet', effort: 'high', decisive_mode: 'panel_3_majority', other_mode: 'single' }),
  ]),
  opus: Object.freeze([
    Object.freeze({ model: 'opus', effort: 'same', decisive_mode: 'single', other_mode: 'single' }),
    Object.freeze({ model: 'sonnet', effort: 'high', decisive_mode: 'panel_3_majority', other_mode: 'single' }),
  ]),
  sonnet: Object.freeze([
    Object.freeze({ model: 'sonnet', effort: 'same', decisive_mode: 'single', other_mode: 'single' }),
    Object.freeze({ model: 'opus', effort: 'same', decisive_mode: 'single', other_mode: 'single' }),
    Object.freeze({ model: 'fable', effort: 'same', decisive_mode: 'single', other_mode: 'single' }),
  ]),
  haiku: Object.freeze([
    Object.freeze({ model: 'haiku', effort: 'same', decisive_mode: 'single', other_mode: 'single' }),
    Object.freeze({ model: 'sonnet', effort: 'low', decisive_mode: 'single', other_mode: 'single' }),
    Object.freeze({ model: 'opus', effort: 'low', decisive_mode: 'single', other_mode: 'single' }),
    Object.freeze({ model: 'fable', effort: 'low', decisive_mode: 'single', other_mode: 'single' }),
  ]),
});

export const FAILURE_CLASSES = Object.freeze([
  'concurrency_limit', 'consent_dropped', 'usage_limit_family', 'usage_limit_shared', 'plan_excludes_model',
  'version_too_old', 'model_unavailable', 'overload', 'terminated', 'other',
]);

export const DEFAULT_CONFIG = Object.freeze({
  schema: CONFIG_SCHEMA,
  owner_plan_note: null,
  profile: 'standard',
  agent_cap: { quick: 15, standard: 40, deep: 90 },
  orchestration_reserve_fraction: 0.1,
  max_parallel_agents: 4,
  models: { haiku: 'assume_available', sonnet: 'probe', opus: 'probe', fable: 'probe' },
  allow_fable_usage_credits: false,
  allow_max_effort: false,
  routing_overrides: {},
  dialogue: { max_rounds: 2 },
  escalation: { max_steps_per_item: 2 },
  critics: { max_post_wave: { ...DEFAULT_MAX_POST_WAVE } },
  report_language: 'auto',
  output_root: '~/ui-audit-skill',
  visual_regression: {
    enabled: true, threshold: 0.2, include_aa: false, max_diff_pixel_ratio: 0.001, max_diff_pixels: null, mask_warn_pct: 30,
  },
  fix: { agent_cap: 30, max_parallel_fixers: 2 },
  asked_at: null,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const tierIndex = (alias) => MODEL_ALIASES.indexOf(alias);

export function tierAbove(a, b) {
  return tierIndex(a) > tierIndex(b);
}

export function isStrongLens(lens) {
  return typeof lens === 'string' && (BUSINESS_LENSES.includes(lens) || lens.startsWith('PERFORMANCE.md#'));
}

// ---- budget ----

// Same arithmetic as the copies in the validators' shared helper block.
export function computeReserve(profile, cap, fraction, floor = BASE_RESERVE_FLOOR) {
  if (!hasOwn(PROFILE_RESERVES, profile) || !Number.isInteger(cap) || cap < 0 ||
      typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 ||
      !Number.isInteger(floor) || floor < 0) {
    return null;
  }
  const fixed = PROFILE_RESERVES[profile];
  const orchestration = Math.max(BASE_RESERVE_FLOOR, Math.ceil(Math.round(cap * fraction * 1e9) / 1e9), floor);
  return {
    reconnaissance: fixed.reconnaissance,
    critics: fixed.critics,
    validation: fixed.validation,
    orchestration,
    total: fixed.reconnaissance + fixed.critics + fixed.validation + orchestration,
  };
}

export function minimumCap(profile, fraction, floor = BASE_RESERVE_FLOOR, setup = 0) {
  if (computeReserve(profile, 0, fraction, floor) === null || !Number.isInteger(setup) || setup < 0) return null;
  for (let cap = 1; cap <= AGENT_CAP_MAX; cap += 1) {
    if (computeReserve(profile, cap, fraction, floor).total + setup + 1 <= cap) return cap;
  }
  return null;
}

// ---- availability ----

// Normalises any availability input to {alias: "available"|"untested"|"unavailable"}.
// Accepted per alias: a config declaration (assume_available, probe, unavailable),
// an observed value (untested, available, unavailable, substituted, unknown), or
// {declared, observed}.
export function normaliseAvailability(input) {
  const out = {};
  for (const alias of MODEL_ALIASES) {
    let declared = null;
    let observed = null;
    const value = isPlainObject(input) ? input[alias] : undefined;
    if (isPlainObject(value)) {
      declared = value.declared ?? null;
      observed = value.observed ?? null;
    } else if (typeof value === 'string') {
      if (['assume_available', 'probe'].includes(value)) declared = value;
      else observed = value;
    }
    let state;
    if (observed === 'unavailable' || observed === 'substituted' || declared === 'unavailable') state = 'unavailable';
    else if (observed === 'available' || observed === 'unknown') state = 'available';
    else if (declared === 'assume_available') state = 'available';
    else if (declared === 'probe' || observed === 'untested') state = 'untested';
    else state = 'untested';
    if (declared === 'unavailable' && observed === 'available') state = 'available';
    out[alias] = state;
  }
  return out;
}

export function raiseEffort(effort, allowMaxEffort = false) {
  const index = EFFORT_LEVELS.indexOf(effort);
  if (index < 0) return 'high';
  if (effort === 'xhigh') return allowMaxEffort ? 'max' : 'xhigh';
  if (effort === 'max') return allowMaxEffort ? 'max' : 'xhigh';
  return EFFORT_LEVELS[index + 1];
}

export function panelWorstCase(mode, taskKind) {
  if (mode === 'single') return 1;
  if (mode === 'panel_3_majority') return 3;
  if (mode === 'panel_2_agree') return taskKind === 'judge' ? 3 : 5;
  return 0;
}

const AGENTS_FOR_MODE = Object.freeze({ single: 1, panel_2_agree: 2, panel_3_majority: 3, none: 0 });

// Walks the ladder of `wanted` under the given availability. Untested aliases
// count as usable here; earmark pricing is done by worstCaseCost.
export function fallbackFor(wanted, taskKind, availability, options = {}) {
  if (!MODEL_ALIASES.includes(wanted)) throw new Error(`unknown model alias ${JSON.stringify(wanted)}`);
  const view = normaliseAvailability(availability);
  const usable = (alias) => view[alias] !== 'unavailable';
  const effort = EFFORT_LEVELS.includes(options.effort) ? options.effort
    : (ROUTING_TABLE[taskKind] ? ROUTING_TABLE[taskKind].effort : 'medium');
  const fixer = FIXER_TASK_KINDS.includes(taskKind);
  const decisive = DECISIVE_TASK_KINDS.includes(taskKind) && !fixer;
  const steps = LADDER_STEPS[wanted];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!usable(step.model)) continue;
    // A fixer business fix never runs below opus; a logic fix never below sonnet.
    if (taskKind === 'fix_business' && tierIndex(step.model) < tierIndex('opus')) break;
    if (taskKind === 'fix_logic' && tierIndex(step.model) < tierIndex('sonnet')) break;
    const mode = decisive ? step.decisive_mode : step.other_mode;
    let usedEffort = effort;
    if (step.effort === 'raise') usedEffort = raiseEffort(effort, options.allowMaxEffort === true);
    else if (step.effort !== 'same') usedEffort = step.effort;
    if (usedEffort === 'max' && options.allowMaxEffort !== true) usedEffort = 'xhigh';
    return {
      wanted,
      used: step.model,
      effort: usedEffort,
      mode,
      agents_needed: AGENTS_FOR_MODE[mode],
      worst_case: panelWorstCase(mode, taskKind),
      scope: mode === 'panel_3_majority' ? 'narrowed' : 'full',
      step: index,
      stronger_model_needed_tier: null,
    };
  }
  // Mechanical work may still run on haiku when nothing at or above the wanted tier answers.
  if (MECHANICAL_TASK_KINDS.includes(taskKind) && wanted !== 'haiku' && usable('haiku')) {
    return {
      wanted, used: 'haiku', effort, mode: 'single', agents_needed: 1, worst_case: 1, scope: 'full', step: steps.length,
      stronger_model_needed_tier: null,
    };
  }
  return {
    wanted,
    used: null,
    effort: null,
    mode: 'none',
    agents_needed: 0,
    worst_case: 0,
    scope: 'none',
    step: steps.length,
    stronger_model_needed_tier: wanted === 'fable' || wanted === 'opus' ? wanted : 'opus',
  };
}

// The earmark price of a route: an alias nobody has used yet (untested) is
// priced at the larger of its available price and the price of its ladder.
export function earmarkPrice(wanted, taskKind, availability, options = {}) {
  const view = normaliseAvailability(availability);
  const direct = fallbackFor(wanted, taskKind, view, options);
  if (direct.mode === 'none' || view[direct.used] !== 'untested') return direct.worst_case;
  const without = { ...view, [direct.used]: 'unavailable' };
  return Math.max(direct.worst_case, earmarkPrice(wanted, taskKind, without, options));
}

// Worst cases of ORCHESTRATION.md section 1.3 rule 5.
//   {kind: "single"|"panel_2_agree"|"panel_3_majority"|"none", task_kind}
//   {kind: "escalation", task_kind, from_model?}  (target from the routing table)
//   {kind: "consult", max_rounds?}
//   {kind: "judge"}
// options: {availability, pricing: "earmark"|"plan"}
export function worstCaseCost(item, options = {}) {
  const availability = options.availability ?? {};
  const earmark = options.pricing !== 'plan';
  const price = (wanted, taskKind) => (earmark
    ? earmarkPrice(wanted, taskKind, availability, options)
    : fallbackFor(wanted, taskKind, availability, options).worst_case);
  switch (item.kind) {
    case 'single':
    case 'panel_2_agree':
    case 'panel_3_majority':
    case 'none':
      return panelWorstCase(item.kind, item.task_kind);
    case 'judge':
      return price(ROUTING_TABLE.judge.model, 'judge');
    case 'consult': {
      const rounds = Number.isInteger(item.max_rounds) ? item.max_rounds : 2;
      const judge = price(ROUTING_TABLE.judge.model, 'judge');
      if (judge === 0) return 0;
      return 1 + 2 * (rounds - 1) + judge;
    }
    case 'escalation': {
      const row = ROUTING_TABLE[item.task_kind];
      if (!row || row.escalation === 'none') return 0;
      const route = fallbackFor(row.escalation, item.task_kind, availability, options);
      const from = item.from_model ?? row.model;
      // A ladder that ends in none, or in a single call not above the original
      // tier, is no escalation at all (ORCHESTRATION.md 3.3 item 6): cost 0.
      if (route.mode === 'none' || (route.mode === 'single' && !tierAbove(route.used, from))) return 0;
      return price(row.escalation, item.task_kind);
    }
    default:
      throw new Error(`unknown worst-case item ${JSON.stringify(item.kind)}`);
  }
}

// floor = max(worst case of one consult, worst case of one decisive escalation).
export function reserveFloor(availability = {}, maxRounds = 2, options = {}) {
  const opts = { ...options, availability, pricing: 'earmark' };
  const consult = worstCaseCost({ kind: 'consult', max_rounds: maxRounds }, opts);
  let escalation = 0;
  for (const kind of DECISIVE_TASK_KINDS) {
    if (FIXER_TASK_KINDS.includes(kind) || kind.startsWith('fix_')) continue;
    escalation = Math.max(escalation, worstCaseCost({ kind: 'escalation', task_kind: kind }, opts));
  }
  return { floor: Math.max(BASE_RESERVE_FLOOR, consult, escalation), consult, escalation };
}

// Everything the strict gate needs, in one object.
export function budgetGate({ profile, cap, fraction = 0.1, availability = {}, maxRounds = 2, setupCalls = SETUP_CALLS } = {}) {
  const floorInfo = reserveFloor(availability, maxRounds);
  const withFloor = computeReserve(profile, cap, fraction, floorInfo.floor);
  const withoutFloor = computeReserve(profile, cap, fraction);
  if (withFloor === null || withoutFloor === null) return null;
  const fitsWithFloor = withFloor.total + setupCalls + 1 <= cap;
  const fitsWithoutFloor = withoutFloor.total + setupCalls + 1 <= cap;
  const reserve = fitsWithFloor ? withFloor : withoutFloor;
  let smallestFraction = null;
  if (!fitsWithFloor && fitsWithoutFloor) {
    for (let f = Math.round(fraction * 100); f <= 100; f += 1) {
      const candidate = f / 100;
      if (Math.ceil(Math.round(cap * candidate * 1e9) / 1e9) >= floorInfo.floor) {
        smallestFraction = candidate;
        break;
      }
    }
  }
  return {
    profile,
    cap,
    fraction,
    setup_calls: setupCalls,
    reserve_floor: floorInfo.floor,
    floor_parts: { consult: floorInfo.consult, escalation: floorInfo.escalation },
    reserve,
    reserve_floor_met: fitsWithFloor,
    can_start: fitsWithoutFloor,
    hunters_left: Math.max(0, cap - reserve.total - setupCalls),
    minimum_cap_with_floor: minimumCap(profile, fraction, floorInfo.floor, setupCalls),
    minimum_cap_to_start: minimumCap(profile, fraction, BASE_RESERVE_FLOOR, setupCalls),
    fraction_that_holds_floor: smallestFraction !== null && smallestFraction <= RESERVE_FRACTION_MAX ? smallestFraction : null,
  };
}

// ---- routing ----

export function huntTaskKindForLens(lens, { judgement = false } = {}) {
  if (BUSINESS_LENSES.includes(lens)) return 'hunt_business';
  if (typeof lens === 'string' && lens.startsWith('PERFORMANCE.md#')) return 'hunt_performance';
  if (judgement || JUDGEMENT_LENSES.includes(lens)) return 'hunt_judgement';
  return 'hunt_standard';
}

export function resolveTaskKind(task, { severity = null, lens = null, proposal = null } = {}) {
  const severe = severity === 'high' || severity === 'blocker';
  const strong = isStrongLens(lens);
  if (task === 'verify_candidate' && (severe || strong || proposal === 'needs_validation')) return 'verify_candidate_strong';
  if (task === 'verify_record' && (severe || strong)) return 'verify_record_strong';
  if (task === 'fix_reverify' && (severe || strong)) return 'fix_reverify_strong';
  if (task.startsWith('hunt_') && lens) {
    const fromLens = huntTaskKindForLens(lens, { judgement: task === 'hunt_judgement' });
    return HUNT_PRECEDENCE.indexOf(fromLens) < HUNT_PRECEDENCE.indexOf(task) ? fromLens : task;
  }
  return task;
}

export function routeTask({
  task, severity = null, lens = null, proposal = null, requesterTier = null, config = {}, availability = null,
  routingMode = 'per_call',
} = {}) {
  if (!hasOwn(ROUTING_TABLE, task)) throw new Error(`unknown task kind ${JSON.stringify(task)}`);
  const taskKind = resolveTaskKind(task, { severity, lens, proposal });
  const row = ROUTING_TABLE[taskKind];
  let model = row.model;
  let effort = row.effort;
  if (taskKind === 'consult_peer' && MODEL_ALIASES.includes(requesterTier) && tierAbove(requesterTier, model)) {
    model = requesterTier;
  }
  const override = isPlainObject(config.routing_overrides) ? config.routing_overrides[taskKind] : undefined;
  if (isPlainObject(override)) {
    if (MODEL_ALIASES.includes(override.model)) model = override.model;
    if (EFFORT_LEVELS.includes(override.effort)) effort = override.effort;
  }
  const allowMaxEffort = config.allow_max_effort === true;
  if (effort === 'max' && !allowMaxEffort) effort = 'xhigh';
  const view = normaliseAvailability(availability ?? config.models ?? DEFAULT_CONFIG.models);
  const route = fallbackFor(model, taskKind, view, { effort, allowMaxEffort });
  const usesFallback = route.mode !== 'single' || route.used !== model || route.effort !== effort;
  return {
    task_kind: taskKind,
    model,
    effort,
    escalation_target: row.escalation,
    decisive: DECISIVE_TASK_KINDS.includes(taskKind),
    pass_model: routingMode !== 'single_model',
    pass_effort: routingMode !== 'single_model',
    availability: view,
    used_model: route.used,
    used_effort: route.effort,
    mode: route.mode,
    worst_case: route.worst_case,
    earmark_price: earmarkPrice(model, taskKind, view, { effort, allowMaxEffort }),
    fallback: usesFallback ? route : null,
  };
}

export function selfAssessmentTriggersEscalation(selfAssessment) {
  if (!isPlainObject(selfAssessment)) return true;
  return selfAssessment.level === 'low' || selfAssessment.level === 'unsure' || selfAssessment.needs_stronger_model === true;
}

// ---- accounting ----

export const CANDIDATE_VERIFY_KINDS = Object.freeze(['verify_candidate', 'verify_candidate_strong', 'verify_batch', 'verify_source_batch']);

const AUDIT_PHASE_KINDS = Object.freeze([
  { phases: ['1'], kinds: (k) => k.startsWith('recon_') || k === 'ledger_draft' || k === 'permission_check', key: 'reconnaissance' },
  { phases: ['2'], kinds: (k) => k.startsWith('hunt_') || k === 'screenshot_sweep', key: 'hunters' },
  { phases: ['2'], kinds: (k) => k === 'critic_wave' || k === 'critic_final', key: 'critics' },
  { phases: ['3'], kinds: (k) => CANDIDATE_VERIFY_KINDS.includes(k), key: 'candidate_verifiers' },
]);

// The agents_breakdown key of one counted invocation (ORCHESTRATION.md 8.2),
// or null when the invocation fits no row (an invalid log).
export function breakdownKeyFor(invocation, fallbacksById = {}, scope = 'audit') {
  const fallback = invocation.fallback_ref ? fallbacksById[invocation.fallback_ref] : undefined;
  if (fallback && (fallback.mode === 'panel_2_agree' || fallback.mode === 'panel_3_majority')) return 'panels';
  if (scope === 'fix') {
    if (invocation.purpose === 'escalation') return 'escalations';
    if (invocation.purpose === 'schema_repair') return 'schema_repairs';
    if (invocation.purpose === 'fix') {
      return invocation.kind === 'resume' && invocation.retry_of === null ? 'fixer_continuations' : 'fixers';
    }
    if (invocation.purpose === 'fix_reverify') return 'reverifiers';
    return null;
  }
  if (invocation.purpose === 'consult_peer' || invocation.purpose === 'consult_resume') return 'consults';
  if (invocation.purpose === 'judge') return 'judges';
  if (invocation.purpose === 'escalation') return 'escalations';
  if (invocation.purpose === 'schema_repair') return 'schema_repairs';
  if (invocation.purpose !== 'primary' && invocation.purpose !== 'replacement') return null;
  const kind = String(invocation.task_kind);
  for (const row of AUDIT_PHASE_KINDS) {
    if (row.phases.includes(invocation.phase) && row.kinds(kind)) return row.key;
  }
  if (invocation.phase === '5' && (kind === 'verify_record' || kind === 'verify_record_strong')) {
    return invocation.purpose === 'primary' ? 'record_verifiers' : 'replacement_verifiers';
  }
  return null;
}

// ---- failure classification ----

const ALIAS_PATTERN = MODEL_ALIASES.join('|');
const FAILURE_RULES = Object.freeze([
  { failure_class: 'concurrency_limit', test: (t) => /concurrent subagent limit/i.test(t) },
  { failure_class: 'consent_dropped', test: (t) => /usage credits/i.test(t) && /(nothing was sent|went unanswered)/i.test(t) },
  {
    failure_class: 'usage_limit_family',
    test: (t) => new RegExp(`hit your (${ALIAS_PATTERN}) limit|\\b(${ALIAS_PATTERN}) limit reached`, 'i').test(t),
  },
  { failure_class: 'usage_limit_shared', test: (t) => /hit your (session|weekly) limit|(session|weekly) limit reached/i.test(t) },
  { failure_class: 'plan_excludes_model', test: (t) => /is not available with the/i.test(t) },
  { failure_class: 'version_too_old', test: (t) => /does not support this model|claude_code_version_too_old/i.test(t) },
  {
    failure_class: 'model_unavailable',
    test: (t) => /issue with the selected model|may not exist or you may not have access|model_not_found|restricted by your organization/i.test(t),
  },
  { failure_class: 'overload', test: (t) => /\b529\b|overloaded|experiencing high load/i.test(t) },
  { failure_class: 'terminated', test: (t) => /terminated early due to an api error/i.test(t) },
]);

export function classifyAgentFailure(text) {
  const value = typeof text === 'string' ? text : '';
  const rule = FAILURE_RULES.find((entry) => entry.test(value));
  const failureClass = rule ? rule.failure_class : 'other';
  let family = null;
  const familyMatch = new RegExp(`hit your (${ALIAS_PATTERN}) limit|\\b(${ALIAS_PATTERN}) limit reached`, 'i').exec(value);
  if (familyMatch) family = (familyMatch[1] || familyMatch[2]).toLowerCase();
  else {
    const mention = new RegExp(`\\b(${ALIAS_PATTERN})\\b`, 'i').exec(value);
    if (mention && failureClass !== 'other' && failureClass !== 'concurrency_limit') family = mention[1].toLowerCase();
  }
  const resetMatch = /\bresets?\b[^\r\n]*/i.exec(value);
  return { failure_class: failureClass, family, reset_text: resetMatch ? resetMatch[0].trim() : null };
}

// ---- config ----

const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));
const VISUAL_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG.visual_regression));
const REPORT_LANGUAGE = /^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const isIntegerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isNumberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function mergeConfig(config) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!isPlainObject(config)) return merged;
  for (const [key, value] of Object.entries(config)) {
    if (isPlainObject(value) && isPlainObject(merged[key]) && key !== 'routing_overrides') {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  // One profile's limit may be given alone; the other keeps its default.
  if (isPlainObject(config.critics) && isPlainObject(config.critics.max_post_wave)) {
    merged.critics.max_post_wave = { ...DEFAULT_MAX_POST_WAVE, ...config.critics.max_post_wave };
  }
  return merged;
}

// Returns {errors, warnings}. Missing keys take their defaults; unknown keys are errors.
export function validateConfig(config, { skillDir = null, home = os.homedir() } = {}) {
  const errors = [];
  const warnings = [];
  const add = (pointer, message) => errors.push(`${pointer}: ${message}`);
  if (!isPlainObject(config)) return { errors: ['/: must be a JSON object'], warnings };
  for (const key of Object.keys(config)) if (!CONFIG_KEYS.includes(key)) add(`/${key}`, 'is not a config key');
  if (config.schema !== CONFIG_SCHEMA) add('/schema', `must be ${JSON.stringify(CONFIG_SCHEMA)}`);
  const c = mergeConfig(config);
  if (c.owner_plan_note !== null && !(typeof c.owner_plan_note === 'string' && [...c.owner_plan_note].length <= 200)) {
    add('/owner_plan_note', 'must be null or text of at most 200 characters');
  }
  if (!PROFILES.includes(c.profile)) add('/profile', `must be one of ${PROFILES.join(', ')}`);
  const fractionOk = isNumberIn(c.orchestration_reserve_fraction, RESERVE_FRACTION_MIN, RESERVE_FRACTION_MAX);
  if (!fractionOk) add('/orchestration_reserve_fraction', `must be a number from ${RESERVE_FRACTION_MIN} to ${RESERVE_FRACTION_MAX}`);
  if (!isIntegerIn(c.max_parallel_agents, 1, 20)) add('/max_parallel_agents', 'must be an integer from 1 to 20');
  const rounds = isIntegerIn(c.dialogue?.max_rounds, 1, 3) ? c.dialogue.max_rounds : null;
  if (!isPlainObject(c.dialogue) || rounds === null) add('/dialogue/max_rounds', 'must be an integer from 1 to 3');
  if (isPlainObject(c.dialogue)) for (const key of Object.keys(c.dialogue)) if (key !== 'max_rounds') add(`/dialogue/${key}`, 'is not a dialogue key');
  if (!isPlainObject(c.escalation) || !isIntegerIn(c.escalation.max_steps_per_item, 0, 3)) add('/escalation/max_steps_per_item', 'must be an integer from 0 to 3');
  if (isPlainObject(c.escalation)) for (const key of Object.keys(c.escalation)) if (key !== 'max_steps_per_item') add(`/escalation/${key}`, 'is not an escalation key');
  if (!isPlainObject(c.critics) || !isPlainObject(c.critics.max_post_wave)) add('/critics/max_post_wave', 'must be an object with standard and deep');
  else {
    for (const key of Object.keys(c.critics)) if (key !== 'max_post_wave') add(`/critics/${key}`, 'is not a critics key');
    for (const [profile, value] of Object.entries(c.critics.max_post_wave)) {
      const at = `/critics/max_post_wave/${profile}`;
      if (!hasOwn(DEFAULT_MAX_POST_WAVE, profile)) add(at, 'is not a profile with post-wave critics (quick has none)');
      else if (!isIntegerIn(value, 1, MAX_POST_WAVE_LIMIT)) add(at, `must be an integer from 1 to ${MAX_POST_WAVE_LIMIT}`);
    }
  }
  if (!isPlainObject(c.models)) add('/models', 'must be an object');
  else {
    for (const [alias, value] of Object.entries(c.models)) {
      if (!MODEL_ALIASES.includes(alias)) add(`/models/${alias}`, `unknown model alias; only ${MODEL_ALIASES.join(', ')}`);
      else if (!['assume_available', 'probe', 'unavailable'].includes(value)) add(`/models/${alias}`, 'must be assume_available, probe or unavailable');
    }
  }
  for (const key of ['allow_fable_usage_credits', 'allow_max_effort']) if (typeof c[key] !== 'boolean') add(`/${key}`, 'must be a boolean');
  if (!isPlainObject(c.routing_overrides)) add('/routing_overrides', 'must be an object');
  else {
    for (const [kind, override] of Object.entries(c.routing_overrides)) {
      const at = `/routing_overrides/${kind}`;
      if (!hasOwn(ROUTING_TABLE, kind)) { add(at, 'unknown task kind'); continue; }
      if (!isPlainObject(override) || Object.keys(override).length === 0) { add(at, 'must be {model?, effort?}'); continue; }
      for (const key of Object.keys(override)) if (key !== 'model' && key !== 'effort') add(`${at}/${key}`, 'is not an override key');
      if (hasOwn(override, 'model')) {
        if (!MODEL_ALIASES.includes(override.model)) add(`${at}/model`, `must be one of ${MODEL_ALIASES.join(', ')}`);
        else if (hasOwn(ROUTING_FLOORS, kind) && tierIndex(override.model) < tierIndex(ROUTING_FLOORS[kind])) {
          add(`${at}/model`, `breaks the routing floor: ${kind} never runs below ${ROUTING_FLOORS[kind]}`);
        }
        if (isPlainObject(c.models) && c.models[override.model] === 'unavailable') {
          warnings.push(`${at}/model: routes to ${override.model}, which this config declares unavailable; the fallback ladder will apply`);
        }
      }
      if (hasOwn(override, 'effort')) {
        if (!EFFORT_LEVELS.includes(override.effort)) add(`${at}/effort`, `must be one of ${EFFORT_LEVELS.join(', ')}`);
        else if (override.effort === 'max' && c.allow_max_effort !== true) warnings.push(`${at}/effort: max is used only with allow_max_effort; xhigh applies`);
      }
    }
  }
  if (!isPlainObject(c.agent_cap)) add('/agent_cap', 'must be an object with quick, standard and deep');
  else {
    for (const key of Object.keys(c.agent_cap)) if (!PROFILES.includes(key)) add(`/agent_cap/${key}`, 'is not a profile');
    for (const profile of PROFILES) {
      const value = c.agent_cap[profile];
      const minimum = fractionOk ? minimumCap(profile, c.orchestration_reserve_fraction, BASE_RESERVE_FLOOR, SETUP_CALLS) : 1;
      if (!isIntegerIn(value, minimum ?? 1, AGENT_CAP_MAX)) {
        add(`/agent_cap/${profile}`, `must be an integer from ${minimum} (smallest cap that can start) to ${AGENT_CAP_MAX}`);
      } else if (fractionOk && rounds !== null) {
        const floor = reserveFloor(isPlainObject(c.models) ? c.models : {}, rounds).floor;
        const holding = minimumCap(profile, c.orchestration_reserve_fraction, floor, SETUP_CALLS);
        if (holding !== null && value < holding) {
          warnings.push(`/agent_cap/${profile}: ${value} can start, but holds the reserve floor of ${floor} only from ${holding}; consults and escalations would be disabled`);
        }
      }
    }
  }
  if (typeof c.report_language !== 'string' || !REPORT_LANGUAGE.test(c.report_language)) add('/report_language', 'must be "auto" or a BCP 47 tag such as es or pt-BR');
  if (typeof c.output_root !== 'string' || c.output_root.length === 0 || c.output_root.includes('\0')) add('/output_root', 'must be a path');
  else if (skillDir) {
    const resolved = path.resolve(c.output_root.startsWith('~') ? path.join(home, c.output_root.slice(1)) : c.output_root);
    const rel = path.relative(path.resolve(skillDir), resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) add('/output_root', 'must resolve outside the skill folder');
  }
  const v = c.visual_regression;
  if (!isPlainObject(v)) add('/visual_regression', 'must be an object');
  else {
    for (const key of Object.keys(v)) if (!VISUAL_KEYS.includes(key)) add(`/visual_regression/${key}`, 'is not a visual_regression key');
    if (typeof v.enabled !== 'boolean') add('/visual_regression/enabled', 'must be a boolean');
    if (!isNumberIn(v.threshold, 0, 1)) add('/visual_regression/threshold', 'must be a number from 0 to 1');
    if (typeof v.include_aa !== 'boolean') add('/visual_regression/include_aa', 'must be a boolean');
    if (!isNumberIn(v.max_diff_pixel_ratio, 0, 1)) add('/visual_regression/max_diff_pixel_ratio', 'must be a number from 0 to 1');
    if (v.max_diff_pixels !== null && !(Number.isInteger(v.max_diff_pixels) && v.max_diff_pixels >= 0)) add('/visual_regression/max_diff_pixels', 'must be a non-negative integer or null');
    if (!isNumberIn(v.mask_warn_pct, 0, 100)) add('/visual_regression/mask_warn_pct', 'must be a number from 0 to 100');
  }
  if (!isPlainObject(c.fix)) add('/fix', 'must be an object');
  else {
    for (const key of Object.keys(c.fix)) if (!['agent_cap', 'max_parallel_fixers'].includes(key)) add(`/fix/${key}`, 'is not a fix key');
    if (!isIntegerIn(c.fix.agent_cap, 4, 200)) add('/fix/agent_cap', 'must be an integer from 4 to 200');
    if (!isIntegerIn(c.fix.max_parallel_fixers, 1, 8)) add('/fix/max_parallel_fixers', 'must be an integer from 1 to 8');
  }
  if (c.asked_at !== null && !(typeof c.asked_at === 'string' && ISO_TIME.test(c.asked_at))) add('/asked_at', 'must be null or an ISO-8601 timestamp');
  return { errors, warnings };
}

// Where to look for ui-audit.config.json, first existing file wins.
export function configCandidates({ env = process.env, skillDir = SKILL_DIR, home = os.homedir() } = {}) {
  const list = [];
  if (env.CLAUDE_PLUGIN_DATA) list.push(path.join(env.CLAUDE_PLUGIN_DATA, 'ui-audit.config.json'));
  list.push(path.join(skillDir, 'ui-audit.config.json'));
  list.push(path.join(home, 'ui-audit-skill', 'ui-audit.config.json'));
  return list;
}

// ---- planning estimate ----

const DEDICATED_WAVES = Object.freeze(['server_zone', 'performance', 'throttle_login']);
const RECON_LINES = Object.freeze(['recon_product', 'recon_routes', 'recon_design_rules', 'recon_runtime']);

function priceLine(taskKind, ctx, extra = {}) {
  const route = routeTask({ task: taskKind, config: ctx.config, availability: ctx.availability, ...extra });
  return route;
}

export function planningEstimate(input) {
  if (!isPlainObject(input)) throw new Error('estimate input must be an object');
  const config = mergeConfig(isPlainObject(input.config) ? input.config : {});
  const profile = input.profile ?? config.profile;
  if (!PROFILES.includes(profile)) throw new Error(`profile must be one of ${PROFILES.join(', ')}`);
  const cap = Number.isInteger(input.cap) ? input.cap : config.agent_cap[profile];
  const fraction = typeof input.fraction === 'number' ? input.fraction : config.orchestration_reserve_fraction;
  const maxRounds = Number.isInteger(input.max_rounds) ? input.max_rounds : config.dialogue.max_rounds;
  const mpa = Number.isInteger(input.max_parallel_agents) ? input.max_parallel_agents : config.max_parallel_agents;
  const mpb = Number.isInteger(input.max_parallel_browsers) ? input.max_parallel_browsers : mpa;
  const availability = normaliseAvailability(input.availability ?? config.models);
  const routeConfig = {
    routing_overrides: isPlainObject(input.routing_overrides) ? input.routing_overrides : config.routing_overrides,
    allow_max_effort: config.allow_max_effort,
  };
  const ctx = { config: routeConfig, availability };
  const groups = Array.isArray(input.groups) ? input.groups : [];
  const setupCalls = Number.isInteger(input.setup_calls) ? input.setup_calls : SETUP_CALLS;
  const extraRecon = Number.isInteger(input.extra_recon) ? input.extra_recon : 0;

  const byModel = Object.fromEntries(MODEL_ALIASES.map((alias) => [alias, 0]));
  let panelCalls = 0;
  const unrouted = [];
  const charge = (route, count = 1) => {
    if (route.mode === 'none') return 0;
    const cost = route.worst_case * count;
    byModel[route.used_model] += cost;
    panelCalls += (route.worst_case - 1) * count;
    return cost;
  };

  let setupCost = 0;
  for (let i = 0; i < setupCalls; i += 1) setupCost += charge(priceLine('permission_check', ctx));
  let reconCalls = 0;
  for (const kind of RECON_LINES) reconCalls += charge(priceLine(kind, ctx));
  for (let i = 0; i < extraRecon; i += 1) reconCalls += charge(priceLine('recon_focused', ctx));

  let hunters = 0;
  let hunterCalls = 0;
  let ordinaryHunters = 0;
  let units = 0;
  let runtimeUnits = 0;
  let strongRuntimeUnits = 0;
  const dedicated = new Set();
  groups.forEach((group, index) => {
    if (!isPlainObject(group) || !hasOwn(ROUTING_TABLE, group.task_kind) || !Number.isInteger(group.units) || group.units < 0) {
      throw new Error(`groups[${index}] needs task_kind and an integer units`);
    }
    const count = Math.ceil(group.units / HUNTER_GROUP_UNITS);
    const route = priceLine(group.task_kind, ctx, { lens: group.lens ?? null });
    units += group.units;
    const runtime = Number.isInteger(group.runtime_units) ? group.runtime_units : group.units;
    runtimeUnits += runtime;
    if (route.task_kind === 'hunt_business' || route.task_kind === 'hunt_performance' || isStrongLens(group.lens)) strongRuntimeUnits += runtime;
    if (route.mode === 'none') {
      unrouted.push({ group: group.id ?? index, units: group.units, reason_code: `model_unavailable: ${route.model}` });
      return;
    }
    hunters += count;
    hunterCalls += charge(route, count);
    const wave = group.wave ?? (route.task_kind === 'hunt_performance' ? 'performance' : 'ordinary');
    if (DEDICATED_WAVES.includes(wave)) dedicated.add(wave);
    else ordinaryHunters += count;
  });
  // Units the critics are expected to add, hunted as ordinary hunt_standard groups.
  const growthSource = typeof input.expected_unit_growth === 'number' ? 'input' : 'default';
  const growth = growthSource === 'input' ? input.expected_unit_growth : DEFAULT_UNIT_GROWTH[profile];
  if (!(growth >= 0)) throw new Error('expected_unit_growth must be a number >= 0');
  const growthUnits = Math.ceil(units * growth);
  const growthRuntimeUnits = Math.ceil(runtimeUnits * growth);
  if (growthUnits > 0) {
    const route = priceLine('hunt_standard', ctx);
    if (route.mode !== 'none') {
      const count = Math.ceil(growthUnits / HUNTER_GROUP_UNITS);
      hunters += count;
      hunterCalls += charge(route, count);
      ordinaryHunters += count;
    }
  }
  const slots = Math.max(1, Math.min(mpa, mpb));
  const waves = Math.ceil(ordinaryHunters / slots) + dedicated.size;

  // Post-wave critics that may add work; past them the waves run with no critic between them.
  const limitSource = Number.isInteger(input.max_post_wave_critics) ? 'input' : 'config';
  const maxPostWave = profile === 'quick' ? 0
    : limitSource === 'input' ? input.max_post_wave_critics
      : (config.critics?.max_post_wave?.[profile] ?? DEFAULT_MAX_POST_WAVE[profile]);
  if (!(Number.isInteger(maxPostWave) && maxPostWave >= 0)) throw new Error('max_post_wave_critics must be an integer >= 0');
  let critics;
  let criticCalls = 0;
  if (profile === 'quick') {
    critics = 1;
    criticCalls += charge(priceLine('critic_final', ctx));
  } else {
    const postWave = Math.min(waves, maxPostWave);
    critics = postWave + 1;
    criticCalls += charge(priceLine('critic_wave', ctx), postWave);
    criticCalls += charge(priceLine('critic_final', ctx));
  }

  const rateSource = typeof input.expected_candidate_rate === 'number' ? 'input' : 'default';
  const rate = rateSource === 'input' ? input.expected_candidate_rate : DEFAULT_CANDIDATE_RATE;
  const candidatesGiven = Number.isInteger(input.expected_candidates);
  const candidates = candidatesGiven ? input.expected_candidates : Math.ceil((runtimeUnits + growthRuntimeUnits) * rate);
  const strongCandidates = Math.min(candidates, Number.isInteger(input.expected_strong_candidates)
    ? input.expected_strong_candidates : Math.ceil(strongRuntimeUnits * rate));
  const share = (key, fallback) => {
    const value = typeof input[key] === 'number' ? input[key] : fallback;
    if (!(value >= 0 && value <= 1)) throw new Error(`${key} must be a number from 0 to 1`);
    return value;
  };
  const sourceShare = share('expected_source_share', DEFAULT_SOURCE_SHARE);
  const minorShare = share('expected_minor_share', DEFAULT_MINOR_SHARE);
  const highShare = share('expected_high_share', DEFAULT_HIGH_RECORD_SHARE);
  const ordinaryCandidates = candidates - strongCandidates;
  const sourceCandidates = Math.ceil(ordinaryCandidates * sourceShare);
  const minorCandidates = Math.ceil((ordinaryCandidates - sourceCandidates) * minorShare);
  const singleCandidates = ordinaryCandidates - sourceCandidates - minorCandidates;
  // Only high and blocker records get a Phase 5 agent; every other record is closed by its Phase 3
  // verifier in the same session. quick has no Phase 5 agent at all.
  const records = profile === 'quick' ? 0 : Math.min(candidates, Number.isInteger(input.expected_high_records)
    ? input.expected_high_records : Math.ceil(candidates * highShare));
  let verifiers = 0;
  let verifierCalls = 0;
  const addVerifiers = (kind, count) => {
    if (count <= 0) return;
    const route = priceLine(kind, ctx);
    verifiers += count;
    verifierCalls += charge(route, count);
  };
  addVerifiers('verify_candidate_strong', strongCandidates);
  addVerifiers('verify_candidate', singleCandidates);
  addVerifiers('verify_batch', Math.ceil(minorCandidates / VERIFY_BATCH_SIZE));
  addVerifiers('verify_source_batch', Math.ceil(sourceCandidates / VERIFY_SOURCE_BATCH_SIZE));
  addVerifiers('verify_record_strong', records);
  if (profile === 'deep') addVerifiers('verify_record_strong', Math.ceil(records * 0.1));

  const floor = reserveFloor(availability, maxRounds).floor;
  const reserve = computeReserve(profile, cap, fraction, floor);
  const orchestrationReserve = reserve ? reserve.orchestration : floor;
  const totalCalls = setupCost + reconCalls + hunterCalls + criticCalls + verifierCalls + orchestrationReserve;
  const fits = Number.isInteger(cap) && totalCalls <= cap;

  const result = {
    units,
    units_seeded: units,
    units_expected: units + growthUnits,
    hunters,
    hunter_calls: hunterCalls,
    waves,
    critics,
    critic_calls: criticCalls,
    verifiers,
    verifier_calls: verifierCalls,
    setup_calls: setupCost,
    recon_calls: reconCalls,
    orchestration_reserve: orchestrationReserve,
    reserve_floor: floor,
    total_calls: totalCalls,
    cap,
    fits,
    availability,
    by_model: byModel,
    panel_calls: panelCalls,
    uncovered_if_capped: { units: unrouted.reduce((sum, entry) => sum + entry.units, 0), candidates: 0 },
    unrouted_groups: unrouted,
    assumptions: {
      candidate_rate: rate,
      candidate_rate_source: candidatesGiven ? 'expected_candidates' : rateSource,
      expected_candidates: candidates,
      unit_growth: growth,
      unit_growth_source: growthSource,
      max_post_wave_critics: maxPostWave,
      max_post_wave_critics_source: profile === 'quick' ? 'quick' : limitSource,
      verification: {
        strong: strongCandidates,
        single: singleCandidates,
        batched_minor: minorCandidates,
        batched_source: sourceCandidates,
        phase5_records: records,
        minor_share: minorShare,
        source_share: sourceShare,
        high_share: highShare,
      },
    },
  };
  if (!fits && input._nested !== true) {
    const options = {};
    const smaller = profile === 'deep' ? 'standard' : profile === 'standard' ? 'quick' : null;
    if (smaller) {
      const alt = planningEstimate({ ...input, profile: smaller, cap, _nested: true });
      if (alt.fits) options.profile = { profile: smaller, total_calls: alt.total_calls };
    }
    for (let candidateCap = cap + 1; candidateCap <= AGENT_CAP_MAX; candidateCap += 1) {
      const alt = planningEstimate({ ...input, profile, cap: candidateCap, _nested: true });
      if (alt.fits) { options.cap = { cap: candidateCap, total_calls: alt.total_calls }; break; }
    }
    // Narrow scope: drop groups from the end of the list (lowest priority last) until it fits.
    let dropped = 0;
    let droppedUnits = 0;
    for (let keep = groups.length - 1; keep >= 1; keep -= 1) {
      const alt = planningEstimate({ ...input, groups: groups.slice(0, keep), _nested: true });
      dropped = groups.length - keep;
      droppedUnits = groups.slice(keep).reduce((sum, group) => sum + (group.units || 0), 0);
      if (alt.fits) { options.narrow = { groups_deferred: dropped, units_deferred: droppedUnits, total_calls: alt.total_calls }; break; }
    }
    result.options = options;
    // Order matters: spend less first. Raising the cap is the last resort, never the recommendation.
    if (options.narrow) result.suggestion = `Narrow the scope: defer the last ${options.narrow.groups_deferred} group(s) (${options.narrow.units_deferred} units) to a later run and reach ${options.narrow.total_calls} calls.`;
    else if (options.profile) result.suggestion = `Switch to the ${options.profile.profile} profile: about ${options.profile.total_calls} calls for a cap of ${cap}.`;
    else if (options.cap) result.suggestion = `Only a larger cap fits: ${options.cap.cap}, which is ${options.cap.cap - cap} more calls than the cap of ${cap}.`;
    else result.suggestion = 'No narrower scope, profile or cap up to the limits fits; ask the owner how to proceed.';
    result.uncovered_if_capped = {
      units: result.uncovered_if_capped.units + (options.narrow ? options.narrow.units_deferred : units),
      candidates: 0,
    };
  }
  return result;
}

// ---- CLI ----

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(HERE, '..');

function isEnvironmentFile(file) {
  return String(file).split(/[\\/]+/).some((segment) => /^\.env($|[.\-_])/i.test(segment) || /^\.envrc$/i.test(segment) ||
    /\.env$/i.test(segment) || /^\.dev\.vars$/i.test(segment));
}

function readJson(file) {
  if (isEnvironmentFile(file)) throw new Error('refusing to read an environment file');
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
  if (stat.size > 5 * 1024 * 1024) throw new Error(`${file} is larger than 5 MiB`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`option ${arg} needs a value`);
      flags[arg.slice(2)] = next;
      i += 1;
    } else positional.push(arg);
  }
  return { command, flags, positional };
}

function loadConfigFlag(flags) {
  return flags.config ? mergeConfig(readJson(flags.config)) : mergeConfig({});
}

function loadAvailability(flags, config) {
  return flags.availability ? readJson(flags.availability) : config.models;
}

const USAGE = `usage: orchestrate.mjs <command> [options]
  budget       --profile <p> --cap <n> [--fraction <f>] [--config <file>] [--availability <file>] [--setup-calls <n>]
  estimate     --input <file>
  route        --task <kind> [--severity <s>] [--lens <ref>] [--proposal needs_validation] [--requester-tier <alias>]
               [--config <file>] [--availability <file>] [--routing-mode per_call|single_model]
  ladder       --wanted <alias> --task <kind> [--effort <e>] [--config <file>] [--availability <file>]
  classify     [--text <text>]  (otherwise reads the error text from stdin)
  check-config <file>`;

export function runCli(argv, { stdin = '' } = {}) {
  const { command, flags, positional } = parseCliArgs(argv);
  switch (command) {
    case 'budget': {
      const config = loadConfigFlag(flags);
      const profile = flags.profile ?? config.profile;
      const cap = flags.cap !== undefined ? Number(flags.cap) : config.agent_cap[profile];
      const fraction = flags.fraction !== undefined ? Number(flags.fraction) : config.orchestration_reserve_fraction;
      const setupCalls = flags['setup-calls'] !== undefined ? Number(flags['setup-calls']) : SETUP_CALLS;
      const result = budgetGate({
        profile, cap, fraction, availability: loadAvailability(flags, config), maxRounds: config.dialogue.max_rounds, setupCalls,
      });
      if (result === null) throw new Error('invalid profile, cap or fraction');
      return { code: 0, output: result };
    }
    case 'estimate': {
      if (!flags.input) throw new Error('estimate needs --input <file>');
      return { code: 0, output: planningEstimate(readJson(flags.input)) };
    }
    case 'route': {
      if (!flags.task) throw new Error('route needs --task <kind>');
      const config = loadConfigFlag(flags);
      return {
        code: 0,
        output: routeTask({
          task: flags.task,
          severity: flags.severity ?? null,
          lens: flags.lens ?? null,
          proposal: flags.proposal ?? null,
          requesterTier: flags['requester-tier'] ?? null,
          config,
          availability: loadAvailability(flags, config),
          routingMode: flags['routing-mode'] ?? 'per_call',
        }),
      };
    }
    case 'ladder': {
      if (!flags.wanted || !flags.task) throw new Error('ladder needs --wanted <alias> and --task <kind>');
      const config = loadConfigFlag(flags);
      return {
        code: 0,
        output: fallbackFor(flags.wanted, flags.task, loadAvailability(flags, config), {
          effort: flags.effort, allowMaxEffort: config.allow_max_effort === true,
        }),
      };
    }
    case 'classify':
      return { code: 0, output: classifyAgentFailure(flags.text ?? stdin) };
    case 'check-config': {
      const file = positional[0];
      if (!file) throw new Error('check-config needs a file');
      const result = validateConfig(readJson(file), { skillDir: SKILL_DIR });
      return { code: result.errors.length === 0 ? 0 : 1, output: { ok: result.errors.length === 0, ...result } };
    }
    default:
      return { code: command === '--help' || command === 'help' ? 0 : 1, output: null, usage: USAGE };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let stdin = '';
  if (argv[0] === 'classify' && !argv.includes('--text')) {
    stdin = fs.readFileSync(0, 'utf8');
  }
  try {
    const result = runCli(argv, { stdin });
    if (result.usage) {
      (result.code === 0 ? process.stdout : process.stderr).write(`${result.usage}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
    }
    process.exitCode = result.code;
  } catch (error) {
    process.stderr.write(`orchestrate: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
