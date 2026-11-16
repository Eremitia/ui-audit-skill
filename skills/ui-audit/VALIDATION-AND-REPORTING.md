# Validation, Findings and Reports

This file covers Phases 3 to 6 of a full audit: the defect model, independent candidate validation, `findings.json`, final record verification, the reports and the terminal states. Read it together with [SKILL.md](SKILL.md) (execution safety, roles, IDs), [ORCHESTRATION.md](ORCHESTRATION.md) (budget, model routing, self-assessment, escalation, consults, judges, fallback ladders, pause and resume), [HUNTING.md](HUNTING.md) (the candidate gate and the "Evidence handling" block), [RECONNAISSANCE.md](RECONNAISSANCE.md) (ledger units, checks, state table), [RUN-METADATA.md](RUN-METADATA.md) (metadata, reasons list) and [SOURCES.md](SOURCES.md) (the rule ids that the companion files cite, such as WCAG-24). The machine contract is [report-schema.json](report-schema.json). The checkers are [validate-findings.cjs](validate-findings.cjs), [validate-coverage-ledger.cjs](validate-coverage-ledger.cjs) and [validate-orchestration.cjs](validate-orchestration.cjs). Fix mode, which starts from a finished run, is described in [FIX-MODE.md](FIX-MODE.md).

Nothing here relaxes the execution safety rules in [SKILL.md](SKILL.md). A verifier that cannot meet one does not execute; it records the missing control as a blocker. No verifier, peer or judge ever opens an environment file (`.env`, `.env.*`, `.env-*`, `.env_*`, `.envrc`, `*.env`, `.dev.vars`), and every prompt says so.

Every delegated call in these phases is an agent invocation: it is appended to `agent-log.json` before the call, counts against the cap, and is routed by task kind (ORCHESTRATION.md §2 and §8). The parent never launches a call that would take `spent` past the cap in force without the owner's explicit run-time answer.

---

## 1. The defect model

### 1.1 What a record must state

A finding is a user-observable deviation from an expectation written down before the audit. Every candidate and record names all of the following, or it is not ready for validation.

| Element | Record field | What it pins down |
|---|---|---|
| Persona | `persona.role`, `persona.label` | Which kind of user meets the defect. Use a role declared in `run-metadata.json` `personas[]`. |
| Surface | `surface.route`, `surface.component`, `surface.state` | Route pattern, responsible component if any, and screen state (`checkout dialog open`, `empty list`). Route `static` only for repository-wide items. |
| Context | `context` | Viewport, theme, input modality, network, data state and optional keys. `any` means the key does not change the outcome; never use it to hide an untested key. |
| Steps | `execution.steps` (confirmed) or the trace (other verdicts) | The smallest sequence that reaches the deviation. |
| Expectation | `expectation.source_kind`, `.ref`, `.statement` | What should have happened, and where that is written. |
| Observation | `execution.observed_result` | What actually happened, stated as fact. |
| Evidence | `evidence[]`, `trace[]`, `execution.artifacts[]` | Source locations as file:line, plus owned artifact paths: screenshot, capture JSON, AX tree, console log, test output, scan output or visual diff image. |
| Impact | `severity.impact.reason` | The consequence for the user: a task blocked, a figure wrong, data lost, time wasted, content unreadable. |

### 1.2 Expectation sources

`expectation.source_kind` is exactly one of the values below. `expectation.ref` must use one of the ledger ref namespaces from [RECONNAISSANCE.md](RECONNAISSANCE.md).

| `source_kind` | Valid ref | Notes |
|---|---|---|
| `repo_rule` | `PR-<NN>` taken from a repository document, or a repo path with an anchor into a rules document (for example the UI section of the contributing guide) | A `PR-` row needs `confirmed_by_owner: yes`, or it must quote a repository file directly. |
| `owner_preference` | `PR-<NN>` whose source is `memory:<file>#<heading>` | Only rows the owner confirmed in Phase 1. A `memory:` ref on its own never backs a record. |
| `business_rule` | A repo path with an anchor into code or a product document, such as `src/lib/cart/totals.ts#applyDiscount` or a numbered section of the product README | The rule must be visible in that location. A rule inferred from how the code happens to behave does not count. |
| `standard` | `WCAG22#<sc>`, `HTML#<section>`, or `RULE:<rule-id>` for a normative row of [SOURCES.md](SOURCES.md) | Use AA level unless the criterion is level A. `WCAG22#<sc>` stays the preferred ref for a WCAG criterion. AAA criteria and WCAG 3 draft text never back a record on their own. |
| `budget` | A companion block ref such as `PERFORMANCE.md#Layout shift`, a repository budget path, or `RULE:<rule-id>` (for example `RULE:VITALS-02`) | Use only thresholds written in the companion, the repository or the rule index. Thresholds the skill chose itself are labelled as such in the reports. |
| `sibling_screen` | `sibling:<repo-path>` | Subject to the caps in §1.3. |
| `platform_contract` | A repo path to framework or browser documentation readable locally (for example docs shipped inside a package under `node_modules/`), `HTML#<section>`, or `RULE:<rule-id>` for a tool-fact or framework row | Documented framework or browser behaviour. Advisory platform guidance (touch sizes from vendor design guides) is not a contract; see §1.3 item 6. |
| `approved_baseline` | `baseline:<baseline-id>#<capture-key>`, for example `baseline:run-3#checkout/m390.light` | Only a baseline the owner approved at run time. Used only with the lens `VISUAL-AND-THEMING.md#Unintended visual change`. Capped at `low` unless a figure or a task outcome differs (§1.3 item 6). |

The validator enforces the pairing in both directions: an `approved_baseline` record must use a `baseline:` ref, and a `baseline:` ref must use `approved_baseline`. When `SOURCES.md` sits next to the validator, every `RULE:<id>` must name a row of its rule index.

When two sources apply, cite the stronger and name the other in the description.

### 1.3 Anti-taste conditions

Three parties enforce these rules: the hunter's candidate gate, every verifier, and Phase 5.

1. **Taste is never a finding.** "Looks dated", "could be cleaner", "I would use a card here", an undocumented best practice, and a score with no threshold all go to `improvements`, never into `findings.json`.
2. **A documented intentional decision is never a defect.** If architecture.md or project-rules.md records the behaviour as deliberate, the candidate is `rejected`, or it is dropped before validation.
3. **A `sibling_screen` expectation is valid only when both of these hold:**
   - the sibling is shown to be canonical: documented as the pattern, or built on the shared primitive that the deviating screen bypasses;
   - the record names the consequence for the user.

   The severity cap is `low` unless a figure or a task outcome differs between the two screens. The validator checks the mechanical part: a `sibling_screen` record above `low` must carry at least one `execution.measurements` entry, or at least one `conditions[]` entry of kind `data_state`, `app_configuration`, `user_role` or `concurrency` (an evidenced figure or task-outcome difference). A viewport, theme or network condition alone does not lift the cap. The verifier checks the rest.
4. **A `judgement-against-quote` rule** (including **Generic or template look** in [VISUAL-AND-THEMING.md](VISUAL-AND-THEMING.md)):
   - needs the `PR-` row's concrete pass criterion;
   - needs a Phase 3 verifier who reaches the same judgement independently, from the criterion and the artifacts alone. The parent removes the hunter's reasoning from the verifier's input;
   - is capped at `low` or `polish` unless the criterion is measurable, such as a count, a token or a size.

   Example (Brasero): "sin etiquetas en mayúsculas sobre cada título" is measurable. Uppercase eyebrow labels above more than one block title on one screen can be counted, so a `medium` is possible. "No debe parecer hecha por una IA" has no criterion. It cannot back a unit until the owner confirms a measurable reading.
5. **The consequence must be statable.** If nobody can say in one sentence what the user loses, use the lower severity, or `rejected` when there is no consequence.
6. **Baselines and advisory guidance stay in their lane.**
   - A change against an **unapproved** baseline is a lead for COVERAGE.md "Visual changes since baseline", never a candidate. A change against an approved baseline is a candidate only when the capture environments match (same env key), the change is not explained by an intended source edit of that surface, and it carries a user consequence (lost content, overlap, unreadable text, broken layout, wrong figure). An environment mismatch means "not comparable"; it is never a regression and never a `needs_validation` [rule: E2E-18, TOOLS-40].
   - An `approved_baseline` record is capped at `low` unless a figure or a task outcome differs. The validator checks it like the sibling cap: above `low`, the record needs a measurement whose metric is not `visual_diff_ratio` or `visual_diff_pixels`, or a condition of kind `data_state`, `app_configuration`, `user_role` or `concurrency`. A confirmed `Unintended visual change` record always carries at least one `visual_diff_ratio` or `visual_diff_pixels` measurement.
   - Advisory guidance (vendor touch-target sizes, AAA criteria, UX heuristics without a measured consequence) is an improvement unless a confirmed `PR-` row adopts it.
7. **Heuristic judgement needs two minds.** A rule that can only be applied by judgement (error-message tone and helpfulness, minimalism, help in context) may leave `needs_validation` only when two independent agents reached the same conclusion from the same criterion and artifacts, or when a judge ruled on their disagreement (§2.10) [rule: UX-11, UX-41, UX-42]. One agent's opinion, however confident, stays an improvement or a `needs_validation` lead.

### 1.4 Verdicts

| Verdict | Meaning | Must carry | Must not carry |
|---|---|---|---|
| `confirmed` | Reproduced locally, inside the safety boundary, in the stated context, against the stated expectation, with promoted evidence. The hunter reproduced it first, and a verifier then reproduced it independently. | `root_cause`, `conditions`, `execution`, `remediation`, `severity`, `confidence` | `claimed_root_cause`, `blockers`, `validation_plan`, `reason`, `stronger_model_needed` |
| `needs_validation` | The trace is credible, but one decisive fact cannot be established locally, or the available model tiers could not settle a decisive question. Examples: a real device, iOS Safari, Firefox or WebKit, real screen-reader output, the real on-screen keyboard, real network or production data volume, the real server clock crossing a boundary, a deployment header, a third-party unfurl; or a verification whose fallback ladder ended without a decision. | `claimed_root_cause`, `blockers`, `validation_plan`; optional `stronger_model_needed` | `severity`, `execution`, `remediation`, `reason`, `root_cause`, `confidence` |
| `rejected` | Refuted by source or by reproduction, or the expectation was misread, or there is no user impact, or the deviation is a fixture artifact. | `claimed_root_cause`, `reason` | `severity`, `execution`, `remediation`, `blockers`, `validation_plan`, `root_cause`, `confidence`, `stronger_model_needed` |

Rules for choosing a verdict:

- `needs_validation` is not a holding pen for ideas. If source disproves the claim, the verdict is `rejected`. If no decisive external fact or unsettled decisive question is named, the candidate does not survive the gate.
- Keep a `rejected` record only to explain a disagreement with a prior run or to record a verifier's refutation, so a later run does not repeat the claim on unchanged source.
- **`stronger_model_needed`** is `{tier: "opus"|"fable", reason}`. It is set only when the item ran out of model tiers: a fallback ladder ended in mode `none`, a panel split, a judge reported `low` or `unsure`, the escalation limit was reached, or the escalation was not funded (ORCHESTRATION.md §6). `reason` says what was decisive and why the tier that ran did not settle it. At least one `blockers[]` entry names the tier (the validator checks that the tier name appears), and `validation_plan.owner` says which model would settle it, for example "re-run this verification with fable available". A record with this field is never described as a defect.

### 1.5 Severity, reach and confidence

Only `confirmed` records carry `severity` and `confidence`.

**Impact** (`severity.impact.score`) and **overall** (`severity.overall`) take these values, ranked from 4 down to 0.

| Rank | Value | Use when the evidence shows |
|---|---|---|
| 4 | `blocker` | A persona cannot complete a core task in a supported context. Or the UI shows or produces wrong money, stock or records. Or user input or data is lost with no recovery. Or the main public entry point is unusable. Example (Brasero): QR ordering impossible at 390 px; expected cash that includes booking money. |
| 3 | `high` | The core task completes only through a non-obvious workaround. Also: a figure differs between two screens; a WCAG level-A failure on a core path; content or controls unreachable at a supported viewport; a theme unreadable on a core screen; LCP above 4.0 s or INP above 500 ms on the primary entry under the mobile profile, reproduced in the verifier's own median [rule: VITALS-02, VITALS-03]. |
| 2 | `medium` | A secondary task is broken, or a core task is degraded but recoverable. Also: an AA failure off the core path or with an equivalent alternative; a missing designed state on a reachable path; a metric in "needs improvement" on a core route; a confirmed written UI rule visibly broken. |
| 1 | `low` | A user-visible inconsistency with no effect on any task. Also: a minor budget miss; a code-structure convention violation with no user effect; an unintended visual change with no differing figure or task outcome. |
| 0 | `polish` | A refinement backed by a written rule or a standard, with negligible user effect. |

**Reach** (`severity.reach.score`):

- `all_users`: everyone who uses the surface in its default context.
- `core_persona`: a whole persona, or a whole supported viewport class, theme or assistive-technology group.
- `segment`: one data state, configuration or engine. Also a result that holds only across the VM forwarding hop.
- `narrow`: a rare combination or a timing window.

**Combining impact and reach.** The validator rejects any record that breaks one of these three rules:

1. `rank(overall) <= rank(impact)`. Reach never raises severity.
2. `rank(overall) >= rank(impact) - 2`. Reach never lowers severity by more than two steps.
3. If reach is `narrow` and impact is not `polish`, then `rank(overall) <= rank(impact) - 1`.

Within those bounds, `all_users` and `core_persona` normally keep overall equal to impact and `segment` lowers it one step; justify the choice in `severity.reach.reason`.

Additional caps (§1.3) apply after this rule: `sibling_screen` and `approved_baseline` without a differing figure or outcome, and unmeasurable `judgement-against-quote`.

**Performance boundary.** TTFB and LCP measured through a VM forwarding hop (an app in a local VM reached through the VM's loopback forwarding) include virtualisation overhead, and every lab number depends on the host it ran on.

- A `high` based on LCP above 4.0 s requires the verifier's own median of the profile's cold runs (3 in `quick`, 5 in `standard` and `deep`) to reproduce it [rule: VITALS-16].
- A slow TTFB alone, measured only across the forwarding hop, is `needs_validation` with the hop named as its blocker (a `needs_validation` record carries no reach or severity) [rule: VITALS-08]. It can become `confirmed` only when it also appears without the hop (`browser-in-vm`, its legacy name `browser-in-wsl`, `container-loopback` with the browser on the same side, or `host-only`).
- Every performance record is read against `sandbox.host_facts` (CPU, memory, VM limits, the probe's host benchmark) [rule: VITALS-15]. A number is a lab number; it never says the page "passes" or "fails Core Web Vitals", which is a field assessment [rule: VITALS-01, VITALS-18].

**Confidence** is `low`, `medium` or `high`, with a reason.

`high` means deterministic reproduction in every variant run plus a trace that explains it; `medium`, reliable reproduction with part of the cause inferred; `low`, intermittent reproduction. When the intermittency itself is the open question, prefer `needs_validation`. An intermittent result counts as reproduced only when it fails in at least two of three fresh-context reruns, and its flakiness class is recorded in the check [rule: E2E-15, E2E-16].

Confidence describes the evidence. It is a different field from an agent's `self_assessment`, which describes how settled the agent's own analysis is and decides escalation (ORCHESTRATION.md §3). A verifier may return `confidence: "high"` only with `self_assessment.level` `high` or `medium`.

### 1.6 Fingerprints and grouping

- Pattern `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$`, ASCII, at most 200 characters.
- Shape `<domain>/<lens-slug>/<surface-slug>/<defect-slug>`, in transliterated English: `checkout/double-submit/checkout-dialog/order-created-twice`, never words with accents or other non-ASCII letters copied from a translated UI.
- Never include a line number, wave, agent, model, severity or verdict; keep it unchanged through every verdict, escalation, dialogue, fallback and later run.
- One root cause is one record, even when it appears on several screens or contexts. Put the strongest reproduction in the main fields, and each other occurrence in `also_affects[]` as `{route, context_summary}`.
- A genuinely different root cause gets a new fingerprint and goes through Phase 3 on its own.

### 1.7 Deliberation on a record

`deliberation[]` (optional, on every verdict) lists each consult, judge, escalation and fallback panel that shaped the record, written by the parent in Phase 4 from `agent-log.json`. Each entry is `{id, kind, outcome, summary}`:

- `id`: `dlg-NN` (consult or judge), `esc-NN` (escalation) or `fb-NN` (fallback panel), as in the agent log; unique within the record.
- `kind`: `consult`, `judge`, `escalation` or `fallback_panel`.
- `outcome`: for consults and judges, the dialogue outcome (`agreed`, `judged_requester`, `judged_peer`, `judged_neither`, `cancelled_budget`, `cancelled_pause`); for escalations, `escalation_resolved`, `escalation_unresolved` or `escalation_not_funded`; for panels, `panel_agreed`, `panel_judged`, `panel_majority`, `panel_split` or `panel_not_funded`.
- `summary`: at most 1,200 characters in `report_language`, taken from the dialogue's `summary` or written by the parent from the log entry. It says who asked what, what each side held, and what decided it.

Only items that touched this fingerprint or one of the units that produced it are listed. A `cancelled_budget` consult is listed too, because the reader should know a question was asked and not funded. `validate-orchestration.cjs --findings` checks that every id exists in the log with a compatible kind.

---

## 2. Phase 3: Candidate validation (role `general`)

### 2.1 What gets validated

Phase 3 starts after one of two things: the termination rule in [HUNTING.md](HUNTING.md) is met (a clean post-wave critic and then a clean `cfinal`), or an early stop has been recorded.

The parent assembles the queue from these sources:

- every unique hunter candidate, deduplicated by fingerprint and then by root cause;
- every carried `prior_confirmed_same_source` record, seeded as a `planned` unit in Phase 1;
- carried `needs_validation` records whose trace must be rechecked before they are carried forward. A carried record with `stronger_model_needed` is re-queued routed to the tier it asked for when that tier is now `available` or `untested`; otherwise it is carried as it is and REPORT.md section 4 says so.

Order the queue by fingerprint (plain JS string comparison); under budget pressure this order decides who is validated (§2.8).

**Root-cause grouping comes first.** Before any verifier is assigned, run `node <skill-dir>/scripts/group-candidates.mjs --candidates <out>/candidates.json`. It groups candidates whose trace sinks are the same file and line (`same_sink`) or the same file within a few lines (`near_sink`). For each group, read the members' root causes: when they name one cause, merge them now under the first fingerprint (its record is the one verified; every other member's surface becomes an `also_affects` entry, its units point to the kept fingerprint, and its hunters join the kept fingerprint's `hunters` list), and record the merge in bookkeeping. When the causes differ, keep them apart. Hunters working on neighbouring surfaces often report one shared-component defect several times (a top bar that overflows on every page, a hook that misses its first interval); verifying each copy spends the validation reserve on the same reproduction. A merge found only after verification (§2.7 step 4) is still allowed, but it means this step missed it.

### 2.2 Routing, assignment and disjointness

**Routing.** Each queued fingerprint gets a task kind before anything else (ORCHESTRATION.md §2):

- `verify_candidate_strong` (opus, high; escalation target fable) when the proposed severity is `high` or `blocker`, or the lens is strong (in `BUSINESS_LENSES` or starting with `PERFORMANCE.md#`), or the proposal is a `needs_validation`;
- `verify_candidate` (sonnet, high; escalation target opus) otherwise, except for the two batch kinds below.

**Batches.** Candidates that do not need a strong or a single verifier share one:

- `verify_source_batch` (sonnet, medium; escalation target opus): up to 10 candidates, of any surface, whose checks are all `source` checks and whose decision needs no browser, test or count (structure, test presence, token and icon rules read from the code, typically [PROJECT-CONVENTIONS.md](PROJECT-CONVENTIONS.md) lenses). It works under the non-mutating contract, gets no tenant and runs no probe.
- `verify_batch` (sonnet, medium; escalation target opus): up to 5 candidates whose proposed severity is `low` or `polish`, whose lens is not strong, that share one surface (route) and one lens file. At most one of them may mutate data, so the batch fits one fresh spare tenant.
- Never batched: a proposed `medium` or higher, a strong lens, a `needs_validation` proposal, a performance fingerprint, a carried prior record.

The batch sizes are `VERIFY_BATCH_SIZE` and `VERIFY_SOURCE_BATCH_SIZE` in `scripts/orchestrate.mjs`. A batch verifier decides, reproduces and cites evidence for each candidate separately; batching shares the session, never the proof.

The parent asks `node <skill-dir>/scripts/orchestrate.mjs route --task <kind> --severity <s> --lens <ref>` (with the run's availability file) and uses what it returns. When the route resolves to a fallback (the wanted tier is unavailable), the verification runs as the panel or single call of §2.9.

**Assignment.** For each queued fingerprint the parent does the following, in order:

1. Choose a fresh ID `v<N>-<slug>` that matches the agent ID rules in [SKILL.md](SKILL.md). Panel members take `v<N>-<slug>-a`, `-b`, `-c`; an escalated verifier takes a new `v<N>` number.
2. The ID must appear in no list of this fingerprint (of any fingerprint of the batch) in `fingerprint-agents.json` (`hunters`, `candidate_verifiers`, `record_verifiers`, `replacement_verifiers`, `consultants`, `judges`), nor in the `by_unit` `consultants` or `judges` lists of any unit that produced the fingerprint. Disjointness is per fingerprint.
3. Append the ID to `candidate_verifiers` of every fingerprint it verifies before launch. When its decision is applied and it closed the record (§4.1: every record in `quick`; otherwise every record except a `confirmed` high or blocker one), also append it to `record_verifiers`. That is the only allowed double listing.
4. Create `agents/<id>/prompt.md`, `agents/<id>/scratch/{in,out}/` and `agents/<id>/artifacts/`.
5. Give the verifier somewhere to reproduce:
   - If the candidate mutates data (a submit, a stock change, any write), assign a spare tenant from `fixtures/tenants.json` that no agent has used before. Record `agent_id` against it.
   - If no fresh spare is left, use a fresh browser context in a spare tenant that only non-mutating agents have used, and record that substitution.
   - A verifier never reuses the hunter's tenant for mutating steps. The hunter's mutations would contaminate the reproduction.
   - Each panel member gets its own spare tenant, under the same rules; panel members never share mutating data.
6. Hand over sessions only by path (`fixtures/sessions/<tenant_id>/<role>.json`) and accounts only by key, for the probe's `--sessions` and `--accounts`. The verifier never logs in through the form unless the unit tests login itself (dedicated tenant and wave).
7. Append the invocation to `agent-log.json` (`phase: "3"`, `purpose: "primary"`, the task kind, `model_requested`, `model_passed`, `effort_requested`) before the call, and complete it after.
8. A verifier of a performance fingerprint (including every panel member and every escalated verifier) runs alone: no other agent drives a browser or touches the app while it runs ([HUNTING.md](HUNTING.md), dedicated waves).

### 2.3 Verifier inputs

The prompt contains exactly these items, and nothing else:

1. The candidate record (every field of its proposed branch). For a `judgement-against-quote` candidate, the parent first removes the hunter's reasoning:
   - in `description`, `root_cause`/`claimed_root_cause` and `execution.observed_result`, keep only the observable facts and the artifact paths;
   - drop any sentence that argues why the criterion fails.
2. The linked ledger checks and the owned artifact paths they cite.
3. The architecture facts the path needs: routes, roles, tenant, base URL, topology with proofs, build mode, driver, and `sandbox.host_facts` for a performance claim.
4. The `PR-` row (verbatim, with its pass criterion and `confirmed_by_owner`), if the expectation is a project rule; the [SOURCES.md](SOURCES.md) rule-index row, if the expectation is a `RULE:` ref; the baseline manifest item and the `visual/diff-summary.json` entry, if the expectation is a `baseline:` ref.
5. The `Validation rules` block of every companion whose class is the candidate's `lens`, copied verbatim from that companion.
6. The fenced "Evidence handling" block from [HUNTING.md](HUNTING.md), copied verbatim.
7. The execution safety rules from [SKILL.md](SKILL.md), including the non-mutating contract and the environment-file ban.
8. The three verdict branches of [report-schema.json](report-schema.json) (confirmed, needs_validation, rejected), pasted unchanged.
9. Prior records with the same fingerprint, from earlier runs.
10. Its own paths and contracts: scratch, `scratch/in`, `scratch/out`, the artifacts prefix `agents/<own-id>/artifacts/`, the probe command, `count_command` usage if granted, `report_language`, and the return contract below.
11. The self-assessment block from [ORCHESTRATION.md](ORCHESTRATION.md) §3, copied verbatim.
12. The consult rules from [ORCHESTRATION.md](ORCHESTRATION.md) §4: when to ask, the consult shape, at most two consults, `lens_needed` different from the candidate's own lens file.

A batch verifier receives items 1, 2, 4, 5 and 9 once per candidate, and the rest once. It never receives another verifier's decision on any fingerprint, the parent's opinion of the candidate, or the model tier of any other agent. Panel members never see each other's results before they decide (§2.9).

### 2.4 Verifier prompt

Place this block after the inputs, unchanged except for the bracketed values:

```text
This candidate is another agent's claim. Attempt to disprove it first; only then
reproduce it on your own.

You work only against the loopback app at [base_url], in tenant [tenant_id], with
the sessions and account keys listed above. You never open a non-loopback URL,
never follow an outbound link, never run seed or reset, never edit the target
repository, never open an environment file (.env, .env.*, .envrc, *.env,
.dev.vars), and never start another agent. Write only inside your scratch
directory; cite evidence by its future owned path
agents/[agent_id]/artifacts/<promote_to>.

1. Re-read every trace and evidence location. Each file:line must exist and say
   what the record says it says. Open the expectation source and confirm that its
   exact wording supports the stated expectation; quote it if the record
   paraphrased it.
2. Build the strongest case that this is not a defect. Look for: a decision the
   repository documents as intentional; another path that gives the user the same
   result; a fixture artifact (data no real user would have); a development-build
   artifact; latency that exists only across the VM forwarding hop; a variant the
   hunter ran that does not match the stated context; for a visual change, an
   intended source edit of that surface or a capture environment that differs
   from the baseline's. Write down what you found.
3. Reproduce independently, in the stated context and in every variant the
   record claims. Use your own probe config and your own captures; do not reuse
   the hunter's artifacts as proof. Wait on visible conditions with a deadline,
   never on fixed sleeps. If a result is intermittent, rerun it in a fresh
   context three times; it counts as reproduced only when two of three fail, and
   you record its flakiness class. For a performance claim: production build,
   one discarded warm-up request, [perf_runs] cold runs with the cache disabled,
   report the median (worst run for CLS and INP), and record the topology. For a
   double-submit or figure claim, verify the outcome with the read-only count
   command, not with the button's appearance. Stop at the smallest interaction
   that settles the question.
4. Check that severity, reach, confidence and the proposed fix match only what
   you reproduced, and that every cap applies: sibling_screen, approved
   baseline, judgement against a quoted rule, narrow reach, the VM boundary.
   Lower anything the evidence does not carry.
5. For a needs_validation candidate, decide whether the blocker truly cannot be
   answered here. If local Chromium, the AX tree, emulated media or seeded
   boundaries can answer it, answer it and decide confirmed or rejected. If the
   source refutes the trace, reject it.
6. Keep the fingerprint exactly as given. If you find a different root cause,
   say so in your record's description and leave the fingerprint unchanged; the
   parent will open a new candidate.
7. If the decision depends on a question that belongs to another lens and you
   cannot settle it yourself, ask it as a consult instead of guessing.
8. Report your self-assessment honestly, using the definitions above. Say
   "unsure" when you could not settle the decisive question; that is a useful
   answer, not a failure.
9. Close the record you are about to return: apply the closing checklist given
   below (confirmed or needs_validation) and correct the record before you
   return it. Skip this step only when your decided severity is high or blocker;
   a separate agent will check that record.

Shape rules the validators enforce, so a decided record is not discarded:
- A browser or test check's variant is the linked unit's own context, keys in
  the order role, vp, theme, input, net, data, session, motion, zoom, tz,
  locale, browser, with declared viewports only. A run in another context
  (the other role, another width, another data state) is not a check of the
  unit: describe it in the record's evidence instead.
- A source check has variant null. Every check has a non-empty reviewed_paths
  list of repository-relative paths.
- A measurement in execution.measurements fails its own pass_if; a value that
  passes is context and goes in the description.
- Write your result file as UTF-8.

Write every prose field in [report_language]. Keep JSON keys, enum values and the
fingerprint in ASCII English.

Return exactly one JSON object and nothing else:
{"decision": "confirmed|needs_validation|rejected",
 "record": { ...one record matching the schema branch named by decision... },
 "checks": [ ...seven-key check objects, each with agent_id = [agent_id]... ],
 "artifacts": [ {"path": "out/...", "promote_to": "...", "bytes": 0, "purpose": "..."} ],
 "consults": [ ...at most two consult requests, or an empty array... ],
 "self_assessment": {"level": "high|medium|low|unsure", "reason": "...", "needs_stronger_model": false},
 "model_self_report": "<the model id or name you believe you run on, or null>"}
```

`[perf_runs]` is 3 in `quick` and 5 in `standard` and `deep`. The closing checklist the prompt names is §4.2 for a `confirmed` decision and §4.3 for a `needs_validation` one, pasted after the block.

**Batch prompt.** A batch verifier gets the same block once, with these lines added before "Write every prose field": "You verify [n] candidates, listed above. Treat each one as a separate claim: steps 1 to 9 apply to each, each needs its own reproduction and its own evidence, and nothing you saw for one candidate counts as proof for another. If a candidate turns out to be medium or worse, decide it anyway; the parent will hand it to a single verifier." It returns one JSON object `{"results": [ ...one seven-key object per candidate, in the order given, each with model_self_report null... ], "model_self_report": "..."}`.

### 2.5 Parent checks on the verifier result

The parent accepts a result only when every one of these holds:

1. It is a single JSON object with exactly the seven keys `decision`, `record`, `checks`, `artifacts`, `consults`, `self_assessment` and `model_self_report`, and nothing before or after it.
2. `record.verdict === decision`.
3. `record.fingerprint` equals the queued fingerprint, byte for byte.
4. `validateFindings([record], schema)` passes on the matching branch.
5. Every `checks[]` item has the seven keys from [RECONNAISSANCE.md](RECONNAISSANCE.md), and its `agent_id` equals the verifier's ID. A `browser` or `test` check carries a `variant` that fits the unit's context. For a `matrix:` unit, the variant includes `vp` and `theme`.
6. Every `artifacts[]` entry passes the promotion steps in "Evidence handling". Every artifact path cited in `checks[]` or `record.execution.artifacts` was actually promoted under `agents/<verifier-id>/artifacts/`. A cited path that was not promoted makes the result unacceptable when it was decisive. Otherwise the parent removes the citation.
7. A `confirmed` decision cites at least one artifact of the verifier's own. Hunter artifacts may also appear in `evidence`, but they cannot be the only proof of reproduction.
8. `consults` is an array of at most two entries, each in the shape of ORCHESTRATION.md §4, with `lens_needed` different from the record's lens file and `evidence` limited to the verifier's own promoted artifacts or `repo-relative-path:line`. `self_assessment` has a valid `level`, a visible `reason` and a boolean `needs_stronger_model`.
9. For panel members and tie-breakers (§2.9) the same seven keys apply, but `consults` must be empty; a panel result with a consult is malformed.
10. For a batch, `results` has exactly one entry per candidate, in order, and each entry passes checks 1 to 8 on its own. An entry that fails is discarded alone; the others stand. An entry whose decided severity is `medium` or higher is not applied: the fingerprint is re-queued to its own single verifier, routed by that severity, and paid from the validation reserve. An entry from a source batch that needed a browser to decide is re-queued the same way.

The parent records `model_self_report` in the invocation and compares its family with the requested alias (ORCHESTRATION.md §6). A result whose self-reported family is below the requested tier is kept only as a lead: the decision is discarded, the requested alias is treated as unavailable, and the fingerprint is re-routed.

If a result fails any of these checks, the parent discards it whole and does not repair it. It then re-runs the candidate with another fresh verifier if a free reserve call exists (paid from the orchestration reserve, never from the validation reserve; that new ID is also added to `candidate_verifiers`). In `agent-log.json` the discarded call keeps its row with `outcome: "malformed"`, and the fresh verifier is a new row with `purpose: "primary"`, its own agent ID and `retry_of: null`: `retry_of` names only a repeat of the same agent after a failed call (ORCHESTRATION.md §6), and the validator requires such a repeat to copy the agent ID and purpose. A format slip that is not a fact (a result file in another text encoding, a check variant with its keys out of order) is not a discard: the parent re-encodes or reorders it, keeps the original next to it, and notes it in bookkeeping. An unusable result twice for the same fingerprint is the `malformed_twice` escalation trigger. Otherwise the candidate stays a ledger candidate, the reasons list gets `validation_budget_exhausted`, and the candidate never enters `findings.json`.

### 2.6 Decision rules

- **Self-assessment first.** A decision whose `self_assessment.level` is `low` or `unsure`, or with `needs_stronger_model: true`, is not applied. The parent escalates it before anything else (§2.9): a fresh verifier on the routing table's escalation target re-runs the same Phase 3 prompt, and the earlier decision is discarded, never merged. Its consults are not opened either; the escalated verifier may ask its own.
- **Consults before decisions.** A result with a `blocking: true` consult is held until the dialogue ends (§2.10); the decision that is applied is the requester's current disposition after the dialogue, or the judge's effect. A non-blocking consult does not hold the decision; its outcome is recorded and can only lower a severity or move the record toward `needs_validation` or `rejected`.
- **Promote to `confirmed`** only when the verifier has its own reproduction in the stated context, with promoted evidence and an observed result that contradicts the expectation. A hunter's `confirmed` proposal that the verifier could not reproduce is never kept as `confirmed`.
- **Demote to `needs_validation`** when the decisive fact needs a real device, engine, clock, network or data volume, or an assistive technology. Name that fact exactly in `blockers`. Write at least one plan that is non-destructive and runs on loopback or a device:
  - `local`: a bounded loopback check that would settle it if a missing capability were granted (a Linux Chromium inside the VM for `browser-in-vm`, an owner-approved download);
  - `device`: what to do on which real device or engine, and what result to look for;
  - `owner`: a fact only the owner can observe or decide, or the stronger model that would settle it; never a request to test production with audit traffic.
- **Demote to `needs_validation` with `stronger_model_needed`** when the fallback ladder ended without a decision (§2.9). The `claimed_root_cause` is the hunter's or the strongest verifier's, the blocker names the missing tier, and the plan says which tier would settle it.
- **Reject** when source or reproduction refutes the claim, the expectation was misread, there is no user impact, or the deviation is caused by the fixture. `reason` states which of these applies and points to the evidence.

### 2.7 Merging into the ledger and bookkeeping

For each accepted result, the parent:

1. Promotes the listed artifacts, following "Evidence handling".
2. Appends the verifier's checks to the linked unit or units, and keeps `reviewed_paths` equal to the union of check paths. A verifier check whose `variant` does not fit the unit (another role, a viewport outside the unit's matrix or the declared list, another data state) is not added to the unit: it stays in the record's evidence, and the unit's `improvements` notes that it was moved and why. Neighbouring-context reproductions are common and useful for reach; they just are not checks of that unit. The unit's `agent_id` (its owner) does not change. Checks from panel members, tie-breakers, escalated verifiers and consult peers are appended the same way, each with its own `agent_id`.
   - Exception: a carried `prior_confirmed_same_source` unit is still `planned` with no owner. Its verifier becomes the owner. The unit moves to `candidate` with the carried fingerprint in `result_fingerprints`, and the verifier's checks are its first checks.
3. Leaves the unit `candidate` whatever the decision; the verdict lives in `findings.json`.
4. Keeps one record per fingerprint. If two candidates turn out to share a root cause, merge them under the older fingerprint and move the other surface into `also_affects`. Record the merge in bookkeeping (`improvements` or a `coverage_note`).
5. If the verifier named a different root cause, opens a new candidate with a new fingerprint and queues it for its own Phase 3 run.
6. Updates `fingerprint-agents.json` (every verifier, panel member, tie-breaker, consult peer and judge in its list) and `agent-log.json` (outcome, `model_self_report`, `model_observed`, escalations, dialogues and fallbacks).
7. Runs `validate-coverage-ledger.cjs --metadata` and `validate-orchestration.cjs --kind agent-log --metadata` again.

### 2.8 Budget during Phase 3

Phase 3 spends the validation reserve set at the strict gate, plus whatever the release rule frees (ORCHESTRATION.md §1).

- **What pays for what.** Primary verifiers come from the validation reserve. Retries, escalations, consult peers and resumes, judges, and fallback panels discovered mid-run come from the orchestration reserve, and each starts only after its whole worst case is earmarked there. Panels caused by unavailability known at planning time were priced into the verifier line of the planning estimate.
- **Release.** After the final critic is clean (or hunting stopped early), any orchestration reserve above `max(2, worstCaseCost('judge'))` that is not earmarked is released to Phase 3 and Phase 5 verifiers. The rest stays for judges until Phase 5 ends.
- If the validation reserve runs out, stop hunting and validate in fingerprint order.
- Every candidate left over stays in the ledger as `candidate`, with `unresolved` containing `validation_budget_exhausted`. It never appears in `findings.json` under any verdict.
- A candidate whose only usable route has no available model (a `sonnet` route with sonnet, opus and fable all unavailable) also stays a ledger candidate, with `model_unavailable: <alias>`.
- The run then cannot finish `complete`.
- Never take extra budget silently. The parent checks `spent + 1 <= cap` before every call. Going past the cap needs the owner's explicit answer at run time, recorded as a `cap_overrides[]` entry in `agent-log.json` and mirrored in `run-metadata.json` `budget_note`. When the validation reserve runs out, the recommended option is to validate in fingerprint order with what is left and end `incomplete`; raising the cap is offered second, with the exact number of extra calls.

### 2.9 Escalation and fallback panels for verifications

The ladders themselves are in [ORCHESTRATION.md](ORCHESTRATION.md) §6 and in `fallbackFor()` of `scripts/orchestrate.mjs`; this section says how many verifiers each step launches and how their decisions combine. Every launch below is one invocation; every resume is one more.

| Wanted tier for this verification | Situation | Verifiers launched | Decision rule | Worst case |
|---|---|---|---|---|
| any | wanted tier available | 1 on the wanted tier, mode `single` | its own decision, after §2.5 and §2.6 | 1 |
| `fable` (a strong verification escalated, or a carried record that asked for fable) | no fable | 2 independent opus verifiers, effort one step higher (`high` to `xhigh`), mode `panel_2_agree` | both reach the same decision: done (`panel_agreed`). Otherwise each is resumed once with the other's result and asked to keep or change its decision; agreement then: done. Still split: a third opus verifier at `xhigh` decides alone (`panel_judged`) | 5 |
| `fable` or `opus` | no fable and no opus (or no opus for an `opus`-wanted strong verification) | 3 independent sonnet verifiers at `high`, mode `panel_3_majority`, on the narrowed scope | at least two matching confident decisions (`panel_majority`); otherwise `panel_split` | 3 |
| `opus` or `fable`, non-decisive kind (`verify_candidate` escalated) | wanted tier missing | 1 on the next available tier of the ladder, mode `single` | its own decision | 1 |
| `sonnet` | no sonnet | 1 opus at the same effort, `single`; with no opus, 1 fable, `single` | its own decision | 1 |
| any | nothing usable left, the panel split, or the panel cannot be funded | none | the item goes to mode `none`: `needs_validation` with `stronger_model_needed` (tier = the tier the item wanted), or a ledger candidate with `model_unavailable` when there is no claim worth carrying | 0 |

Rules that apply to every panel:

- **Agreement.** Two decisions agree when the `decision` values match and, for `confirmed`, the fingerprints and `severity.overall` match. When the decisions match but the severities differ, the members are treated as split on severity: the panel continues to its next step on that single question, and if it still splits, the parent applies the lower severity and says so in the deliberation summary. A member whose `self_assessment` is `low` or `unsure`, or sets `needs_stronger_model`, abstains; a `panel_2_agree` with one abstention, or a `panel_3_majority` without two confident matching votes, is `panel_split`.
- **Which record is kept.** The parent keeps the record of an agreeing member (the one with the lower `severity.overall` when they differ only in wording), merges the checks and promoted artifacts of every member into the ledger, and lists the panel in the record's `deliberation[]`. A `confirmed` panel decision satisfies the independent-reproduction rule only when at least one agreeing member cites an artifact of its own.
- **Tie-break call.** The third opus verifier of a `panel_2_agree` receives the Phase 3 inputs plus both members' results (decisions, records, checks, artifact paths); it does not receive the parent's view. It may re-capture under the non-mutating contract and returns the same seven-key contract with an empty `consults`. Its decision must be one of the two members' decisions; its record keeps that member's facts and may only lower severity or confidence. It is logged with `purpose: "judge"` and the panel's `fallback_ref`, takes the ID `v<N>-<slug>-c`, and is listed in `candidate_verifiers`.
- **Narrowed scope.** A `panel_3_majority` decides one question only: the single claim on which the verdict depends (for a matrix unit, the `(vp, theme)` pair named in the candidate; for a figure, the one figure named). All three members receive that same question. Every other claim, pair or figure of the candidate is written to the unit's `unresolved` as `variant not run: narrowed by fallback fb-NN`, and the record's `also_affects` lists only what the panel decided.
- **Never nested.** Panel members, tie-breakers and judges are never escalated and never open a consult. Their low or unsure output sends the item to mode `none`.
- **Records.** Each panel is a `fallbacks[]` entry in `agent-log.json` with `wanted`, `used`, `mode`, `effort`, `reason`, `funded_from` (`planned` or `orchestration_reserve`), `worst_case`, `agents`, `invocations`, `outcome` and `narrowed_to`. Each escalation is an `escalations[]` entry with `to_model_wanted`, `to_model_used` and `fallback_ref` when the two differ.
- **Single-model hosts.** When `orchestration.routing_mode` is `single_model`, there is no tier escalation and no panel. A low or unsure decision gets one same-model second opinion when the orchestration reserve can fund it (logged as an escalation with `mode: "second_opinion"`); the two must agree, otherwise, or when unfunded, the fingerprint becomes `needs_validation` with `stronger_model_needed` (tier = the routing table's escalation target when it is `opus` or `fable`, else `opus`).
- **Limit.** At most `escalation.max_steps_per_item` escalations per fingerprint (default 2). The top available tier is decided only after the target's ladder has been tried: a panel on the same tier as the low verifier is a valid step ([ORCHESTRATION.md](ORCHESTRATION.md) §3.3 item 1). The item stops when the limit is reached, when that ladder ends in `none` or in a `single` call not above the original tier, or when the step cannot be funded: `needs_validation` with `stronger_model_needed`, and the escalation entry's outcome says why (`still_unsure` or `not_funded`).

### 2.10 Consults and judges during validation

A Phase 3 or Phase 5 verifier may ask up to two consults (shape and funding in ORCHESTRATION.md §4). The parent runs the exchange; this section says how its outcome reaches the record.

- **Funding.** The consult starts only when the orchestration reserve holds its whole worst case, judge share included; a non-blocking consult is also declined when it would leave less than one judge's worst case. A declined consult is recorded `cancelled_budget` with zero invocations, the verifier's decision stands, and COVERAGE.md "Agents, models and budget" lists it.
- **Peer.** A fresh `q<N>-<slug>` agent of the lens named in `lens_needed`, on `max(requester tier, sonnet)`, under the non-mutating contract. It must appear in no list of the fingerprint concerned. After the dialogue it is added to that fingerprint's `consultants`, so it can never verify that fingerprint.
- **Rounds.** At most `dialogue.max_rounds` (default 2). The dialogue ends `agreed` as soon as the peer supports the requester's position or the requester accepts the peer's view; otherwise it goes to a judge after the last round.
- **Judge.** A fresh `j<N>-<slug>` agent, task kind `judge` (fable, high), never earlier involved with the fingerprint or its units; added to `judges` afterwards. It receives the question, both final positions, all evidence and checks, the expectation source verbatim, the anti-taste rules (§1.3), the verdict rules (§1.4) and the schema branches. When fable is unavailable the judge runs on its ladder: two opus judges that must agree, and a third opus judge at `xhigh` when they split (no dialogue between judges); with no opus, three sonnet judges by majority; with nothing, the item goes to mode `none`.
- **Applying the outcome** to the verifier's decision (the requester's current disposition is its original decision, replaced by the `disposition` of each later reply):

| Outcome | Candidate or record |
|---|---|
| `agreed` (peer supports the requester, or the requester accepted the peer) | proceeds per the current disposition |
| `judged_requester` | proceeds per the current disposition |
| `judged_peer` | the judge's `effect`: `keep`, `drop_to_improvements`, `reject`, `needs_validation`, `lower_severity` |
| `judged_neither`, or a low or unsure judge | `needs_validation`; a blocker cites the `dlg-NN` id, and `stronger_model_needed` is set when the judge already ran on its strongest available tier |
| `cancelled_budget` | proceeds per the original decision; COVERAGE.md "Agents, models and budget" lists the declined question |
| `cancelled_pause` | the fingerprint returns to its verification queue on resume |

- **Records.** Each exchange is a `dialogues[]` entry in `agent-log.json`: id, what it was about, requester, `lens_needed`, `blocking`, peer, judge, judge route mode, rounds with each side's stance and a one-line summary, outcome, `agreed_by`, the earmarked worst case, invocations, and a `summary` of at most 1,200 characters in `report_language`. Phase 4 copies it into the record's `deliberation[]`.

---

## 3. Phase 4: Write and validate findings.json

### 3.1 Writing

1. Read [report-schema.json](report-schema.json) immediately before writing, not from memory.
2. Write `<out>/findings.json` as a top-level array of every decided record, sorted by `fingerprint` in plain JS string order. Never add wrapper keys such as `proposed_verdict`, `self_assessment`, hunter bookkeeping, unit IDs, agent IDs or model names. Every object has `additionalProperties: false`.
3. Every prose field is in `report_language`. Fingerprints, enums and keys are ASCII English.
4. No record contains a cookie, token, password, session file content, account login or environment value. Steps refer to accounts by `account_key` only.
5. Write `deliberation[]` for each record from `agent-log.json` (§1.7), and `stronger_model_needed` where §2.6 or §2.9 set it.

Contract per verdict, in addition to the shared fields (`fingerprint`, `title`, `description`, `lens`, `persona`, `surface`, `context`, `expectation`, `trace`, `evidence`, optional `deliberation`):

- **`confirmed`**
  - `root_cause`.
  - `conditions[]`, at least one, using the condition `kind` enum. Every non-`any` key in `context` that matters should have a matching condition.
  - `execution` with:
    - `method`, `build_mode`, `topology` (`nat-forward`, `netns-bridge`, `browser-in-vm`, the legacy `browser-in-wsl`, `container-loopback`, `host-only`, or `none` for scans);
    - `user_perspective`, `inputs`, `steps`;
    - `expected_result` and `observed_result`;
    - optional `measurements[]` (metrics now include `visual_diff_ratio`, `visual_diff_pixels`, `font_size_px` and `feedback_ms`);
    - `artifacts[]` of owned paths.
  - `remediation` with the smallest source-level `strategy`, a `regression_check` (a unit test next to the source, a probe config, or a scan), and optional `code_changes[]` with safe repo-relative `file_name`. Fix mode reads `regression_check` as the red test it adds first when the project asks for that ([FIX-MODE.md](FIX-MODE.md)), so write it as something that fails today and passes after the fix.
  - `severity` and `confidence`.
  - Optional `also_affects`.
- **`needs_validation`**: `claimed_root_cause`, `blockers[]` and `validation_plan` with at least one of `local`, `device` or `owner`; optional `stronger_model_needed` (with a blocker naming the tier) and `also_affects`.
- **`rejected`**: `claimed_root_cause` and `reason`.

Measurement and execution rules that the validator enforces:

- `pass_if` states the passing condition `value <pass_if> threshold`. A record exists because the measurement failed, so every measurement with a non-null `threshold` must fail its own condition. Example: LCP 4,600 ms with threshold 2,500 and `pass_if: "<="` is valid, because `4600 <= 2500` is false. A record whose value meets its own threshold is an error.
- A `PERFORMANCE.md#` lens needs `method: browser`, `build_mode: production`, a `topology` other than `none`, and at least one measurement with `runs >= 3`.
- `method: scan` needs `build_mode: none` and `topology: none`. A record confirmed from source alone (a missing file, a route segment without an error boundary, a lint rule switched off) uses `method: scan` with both set to `none`: the ledger's check method `source` has no counterpart in the findings schema, and the scan output that proved it (a listing or a search result) is the promoted artifact.
- `method: browser` needs a real `build_mode` (`production` or `development`) and a real `topology`; neither may be `none`.
- The lens `VISUAL-AND-THEMING.md#Unintended visual change` on a `confirmed` record needs at least one `visual_diff_ratio` or `visual_diff_pixels` measurement, and a `baseline:` expectation (§1.2).
- The `approved_baseline` cap and the `sibling_screen` cap (§1.3).
- `RULE:` refs name existing rule-index rows; `deliberation[].id` is unique within a record; `stronger_model_needed` comes with a blocker naming its tier.

Measurement rules that verifiers check (the validator does not):

- `aggregation` is `median` for timings and `max` for worst-run CLS or INP.
- `runs` matches the profile's lab protocol (3 in `quick`, 5 in `standard` and `deep`) for performance claims.

Trace rules: positive integer lines and safe repository-relative files. A one-entry trace is `entrypoint` or `sink`; a longer one runs `entrypoint`, then only `propagation`, then `sink`. For a UI defect the entrypoint is usually the route or action handler, and the sink the render, figure computation or write that produces the observed result.

### 3.2 Running the validators

From any directory, with absolute paths:

```sh
node <skill-dir>/scripts/check-traces.mjs --findings <out>/findings.json --target <abs-target> --ref <source_ref.commit>
node <skill-dir>/validate-findings.cjs <out>/findings.json --run-dir <out>
node <skill-dir>/validate-coverage-ledger.cjs <out>/coverage-ledger.json --metadata <out>/run-metadata.json --run-dir <out>
node <skill-dir>/validate-orchestration.cjs <out>/agent-log.json --kind agent-log --metadata <out>/run-metadata.json --findings <out>/findings.json --ledger <out>/coverage-ledger.json --fingerprints <out>/fingerprint-agents.json
```

`--run-dir` makes the first two also check that every cited artifact (`execution.artifacts`, check `artifact`) is a regular file the parent promoted under `<out>/agents/<id>/artifacts/`, reached without a link.

`check-traces.mjs` reads the reviewed commit with `git show` (never the working tree when `--ref` is given), never opens an environment file, lists locations inside `node_modules/` without checking them, and prints `PASS: N source locations exist` or the problems as JSON and `FAIL`.

Output and exit codes (the same for the three validators):

- **0**: prints `PASS: N findings valid`, `PASS: N coverage units valid` or `PASS: agent log valid (N invocations)`.
- **1**: prints one `ERROR: <json-pointer>: <message>` line per problem, then `FAIL: N validation error(s)`. Output is capped at 100 errors.
- **2**: usage error, such as a missing argument, an unknown flag, or a path that names an environment file (the validators refuse to open one).

What the orchestration validator proves: invocation numbering, agent ID shapes that fit their task kinds, the cap never exceeded without a preceding override, retries and resumes that point at real earlier calls, every dialogue, escalation and fallback consistent with its invocations and worst case, no open item or unfinished call once the run is paused or finished, the agent log's counts equal to `agents_breakdown` in the metadata, every `deliberation[]` id present in the log with a matching outcome, every unit it names present in the ledger, disjointness across all six lists of `fingerprint-agents.json` (including the copies of `by_unit` consultants and judges; with `--findings`, a Phase 3 verifier may also be the record verifier of any fingerprint whose record is not `high` or `blocker`), and, with `--findings`, that every `confirmed` record had at least one candidate verifier who was not its hunter.

Fix every error at its cause, then run all three validators again until all print `PASS`. Do not edit the validators or the schema to make a run pass. When a file the parent wrote fails on format only, the parent may launch a `schema_repair` agent (haiku, low) that proposes a format-only patch; the parent reviews and applies it itself, and the call counts against the orchestration reserve.

A pass proves format and consistency only, not truth; Phases 3 and 5 establish truth.

---

## 4. Phase 5: Final record verification (role `research`)

### 4.1 Assignment

Outside `quick`, Phase 5 launches one fresh agent `p<N>-<slug>` for each `confirmed` record of severity `high` or `blocker` in `findings.json`. These agents run in parallel, within `max_parallel_agents` and `max_parallel_browsers`; a performance record's verifier runs alone. Every other record, `needs_validation` included, was closed by its Phase 3 verifier (step 9 of the §2.4 prompt), and `rejected` records get no closing. Before Phase 5, the parent runs `scripts/check-traces.mjs` on `findings.json` against the reviewed source ref: a file or line that does not exist is corrected by the parent when the same code is found at another line (non-material, §4.5), otherwise the record goes back to a fresh Phase 3 verifier. In `deep`, 10 % of the Phase 5 count is held as replacement headroom.

On the first real deep run of this skill, 98 Phase 5 agents changed one record materially; seven of their corrections were line numbers, which `check-traces.mjs` now finds without an agent.

- **Routing.** `verify_record_strong` (opus, medium; escalation target fable). `verify_record` is kept only so that logs of skill 2.1 and earlier still validate. A `needs_validation` record gets no Phase 5 agent: its Phase 3 verifier closed it with §4.3, and a carried one with `stronger_model_needed` is re-queued in Phase 3 (§2.1).
- Before launch, the ID must appear in no list of `fingerprint-agents.json` for that fingerprint, nor in the `by_unit` consultant or judge lists of its units. The parent appends it to `record_verifiers`. Panel members take `p<N>-<slug>-a`, `-b`, `-c` and are listed there too.
- The agent works under the non-mutating contract in [SKILL.md](SKILL.md):
  - saved sessions only, handed over by path;
  - GET navigation only;
  - no form submission;
  - no `upload`, no submitting `click`, no `back`/`forward` step that would resubmit, no `evaluate` with side effects;
  - no database command;
  - no environment file opened, no other agent started.
- It may re-capture with the probe, using a saved session in a spare tenant.
- The role is `research`: it maps to the host's general-purpose agent type with the non-mutating contract written into its prompt word for word (ORCHESTRATION.md §9). Record the mapping in bookkeeping.
- Its checks carry its own `p…` ID. Artifacts it captures go through normal promotion.
- A Phase 5 agent that only reads source adds only `source` checks (`variant: null`, `artifact: null`).

Its inputs are the record as it stands in `findings.json` (including `deliberation[]`), the linked checks and artifacts, the expectation source, the companion Validation rules, the "Evidence handling" block, the three schema branches, the self-assessment block and consult rules of ORCHESTRATION.md §3 and §4, and `report_language`. It does not receive the hunter's or the Phase 3 verifier's reasoning beyond what the record itself states, nor the tier that verified it.

### 4.2 Checklist for a `confirmed` record

1. **Paths and lines.** Every trace and evidence location exists at the stated line and does what the record says.
2. **Expectation.** The source exists, and its exact wording supports the stated expectation. A `PR-` row is confirmed by the owner, or quotes a repository file. A `RULE:` ref names a normative or tool-fact row, never an advisory one. A `baseline:` ref names an approved baseline whose env key matches the current capture. The anti-taste caps (§1.3) are respected.
3. **Reproduction against the artifacts.** The steps, context, variants run and observed result agree with the promoted artifacts: capture JSON values, screenshots (viewport-only for fixed-bar or `dvh` claims), AX tree, count output, diff images. For a matrix unit, the variants the record claims are the ones that were run. A non-mutating re-capture that contradicts the record is grounds for `replace`.
4. **Persona and impact.** The persona can reach this surface in this context, and the user consequence is real and stated.
5. **Severity.** Impact, reach and overall follow §1.5, including the impact × reach rule, the caps, and the VM boundary for performance.
6. **Fix.** The remediation addresses the root cause at source, respects the repository's own structure rules, and has a regression check that would fail today and pass after the fix.

### 4.3 Checklist for a `needs_validation` record

1. The trace supports the claimed root cause and nothing broader.
2. Every blocker is decisive and cannot be answered locally (local Chromium, the AX tree, emulated media, seeded boundaries) or, for `stronger_model_needed`, by the tier this agent runs on.
3. The record names the context and the exact result to look for.
4. The plan is exact and non-destructive. It never sends audit traffic to a deployment or uses real accounts.
5. The fingerprint matches the prior and current records for the same root cause.

### 4.4 Return contract

Exactly one JSON object, with nothing before or after it:

```json
{"decision": "verified", "fingerprint": "…",
 "consults": [], "self_assessment": {"level": "high", "reason": "…", "needs_stronger_model": false},
 "model_self_report": null}
```

or

```json
{"decision": "replace", "reason": "…", "record": {}, "checks": [], "artifacts": [],
 "consults": [], "self_assessment": {"level": "high", "reason": "…", "needs_stronger_model": false},
 "model_self_report": null}
```

A replacement `record` matches one of the three schema branches and keeps the fingerprint. The parent applies the same structural checks as in §2.5 (with the key sets above). A malformed or prose-wrapped result is discarded and re-run with a fresh `p…` agent when a free reserve call exists (a retry from the orchestration reserve).

A Phase 5 result with a low or unsure self-assessment, or `needs_stronger_model: true`, is escalated to the routing table's target before it is applied (§2.9 counts and ladders apply unchanged). A Phase 5 consult follows §2.10; its outcome decides between `verified` and `replace` the same way it decides a Phase 3 decision.

### 4.5 Material replacement

A replacement is **material** if it does any of the following:

- strengthens the verdict (any move toward `confirmed`);
- changes the root cause;
- changes the steps, context, observed result, impact, reach or severity;
- adds or removes `stronger_model_needed`.

Typo fixes, file:line corrections that point to the same code, clearer wording and translation fixes are **non-material**. The parent applies them directly.

For a material replacement:

1. Pick a fresh `general` verifier `v<N>-<slug>` that appears in no list for this fingerprint. Append it to `replacement_verifiers`. Route it like a Phase 3 verifier of the replacement's severity and lens (§2.2).
2. Give it the replacement record, plus the same input set as §2.3. Do not give it the original record's reasoning or the Phase 5 agent's argument beyond the replacement's own fields. It runs the Phase 3 prompt (§2.4) against the replacement.
3. If it reproduces the replacement, apply the replacement.
4. If it returns something else, the record is disputed. Repeat with yet another fresh verifier while the budget and the disjointness rule allow, or open a judge on the dispute when the orchestration reserve holds a judge's worst case (§2.10; the Phase 5 agent and the replacement verifier are the two sides).
5. If no independent verifier or judge can be funded or found:
   - remove the record from `findings.json`;
   - keep its unit as a `candidate` whose `unresolved` names the dispute;
   - set `run_status: "incomplete"` with `incomplete_reason: "phase5_dispute: <fingerprint and one-line summary>"`.

After every applied replacement, rerun the three validators. A replacement that reveals a new root cause gets a new fingerprint and goes back through Phase 3. It does not enter `findings.json` directly.

### 4.6 The quick profile

In `quick`, Phases 3 and 5 merge for every record, `high` and `blocker` included: the Phase 3 verifier (single or batched) closes every record it decides, by step 9 of the §2.4 prompt. Its ID sits in both `candidate_verifiers` and `record_verifiers` for that fingerprint. The agent log records it as a Phase 3 invocation. Every other rule still applies: an independent reproduction for `confirmed`, the caps, self-assessment and escalation, the ladders, and the validators. In `standard` and `deep` the same merge applies to every record except a `confirmed` `high` or `blocker` one, whose Phase 5 agent is always a different, fresh agent.

---

## 5. Phase 6: Reports

### 5.1 Ground rules

- Write reports only after Phase 5 has finished for every record kept in `findings.json`. No report is written while the run is `paused`.
- Derive every statement from these sources only: `findings.json`, the ledger, `run-metadata.json`, `agent-log.json`, `fingerprint-agents.json`, `visual/diff-summary.json` when it exists, and the bookkeeping (`improvements`, `positive_patterns`, critic files). Prose never changes a verdict, a severity, a blocker, a reach or a count.
- Everything is written in `report_language`. Headings are translated, and the section order below is fixed. Fingerprints, coverage IDs, agent IDs, model aliases, enum values, viewport IDs and file names stay in ASCII English inside the translated text.
- Artifacts are linked by relative paths from the output directory, such as `agents/v2-checkout/artifacts/probe/m390.dark.view.png`. Never link to `scratch/`, `storage/` or `profile/`.
- No report contains a cookie, token, password, session content, dummy login or environment value. Refer to accounts by `account_key`.
- Rejected records are not findings. Mention a rejected fingerprint only to explain a disagreement with a prior run or a coverage decision.
- A clean run may have zero findings. Say so, state the limits, and do not invent low-severity items to fill the page.
- **Words the reports never use as a verdict.** No page "passes Core Web Vitals" (that is a field assessment; every number here is a lab number and is labelled "lab") [rule: VITALS-01, VITALS-18]. No page or app is "accessible", "WCAG compliant" or "conformant": automated and agent checks cover part of the criteria and never support a conformance claim [rule: TOOLS-07]. Say instead which criteria were checked, how, and what failed.
- Thresholds the skill chose itself (for example the 0.1 % visual diff budget or the three-rerun flakiness rule) are labelled "skill threshold" where they decide something, with their SOURCES.md section 5 entry.
- `needs_validation` items, including those that need a stronger model, are never counted or described as defects.

Example (es): "Alcance de la corrida", "Estado de calidad", "Hallazgos confirmados", "Detalle de cada hallazgo", "Por validar", "Mejoras y buenas prácticas", "Cobertura", "Agentes, modelos y presupuesto", "Cambios visuales desde la línea base".

### 5.2 REPORT.md

Five sections, in this order, and between 150 and 250 lines. It is what the owner reads first: what was covered, what to fix first, and where the rest is. Everything else lives in the three companion files.

1. **Scope.** One paragraph: profile and scope, the cap and the invocations spent, the source commit, and what was left uncovered and why (units deferred, with their reason codes in one sentence; candidates left unvalidated; engines not covered). A partial, scoped, quick or `incomplete` run says so in its first sentence, with the `incomplete_reason` or the number of units `deferred` with `critic_wave_limit`. When the parent could not ask the owner, list the `unasked_questions` and the safe answer that applied to each. When roles ran inline (no delegation tool), say that hunter and verifier were the same model session, so no verification was independent. When `reserve_floor_met` is false, say that consults and decisive escalations were disabled by the cap from the start. The full run statement is in COVERAGE.md.
2. **Quality posture.** One short paragraph: where the application is strong and where confirmed defects cluster. Then **what to fix first**: the three to five most important confirmed findings, one line each (severity, title, why it comes first), each linked to its section in FINDINGS-DETAIL.md.
3. **Confirmed findings.** A table of `blocker`, `high` and `medium` records: severity, title, screen (route and state), a one-line observed result, and a link to `FINDINGS-DETAIL.md#<fingerprint>`. Sort by severity, then fingerprint. Then `low` and `polish` records in a compact table grouped by screen: screen, then each record's severity, title and link, one line each.
4. **Needs validation.** Title, blocker, plan, and a column "needs a stronger model" (yes with the tier, or no). No severity column. Never call these confirmed defects. Records carried from a prior run with `stronger_model_needed` and not re-run say so.
5. **Where the rest is.** Links, each with one line on what it holds: FINDINGS-DETAIL.md (every confirmed record in full, then improvements and positive patterns), NEEDS-VALIDATION.md (the plans that would settle each lead) and COVERAGE.md (the run statement, coverage, agents, models and budget, and visual changes).

A section repeats nothing another file already holds: a reader who wants the reproduction follows the link.

### 5.3 FINDINGS-DETAIL.md

One section for each `confirmed` record, of any severity, headed by its fingerprint so REPORT.md can link to it. Sort by severity, then fingerprint. Each section gives:

- the screen, persona and context;
- local reproduction steps, with account keys only, and the probe config path or test command used;
- the expected result with its source quoted (or the rule-index statement for a `RULE:` ref), against the observed result;
- the ordered trace and the evidence (file:line with description);
- the fixtures and tenant used, and the data state;
- each measurement as value, threshold, `pass_if`, runs, aggregation and profile, plus the topology and the host facts for performance;
- links to the artifacts, the decisive one first, including diff images for visual changes;
- conditions;
- the severity rationale (impact, reach and any cap applied);
- remediation: the smallest source fix, with `code_changes` when present, and the regression test or probe config that would guard it;
- **verified by:** the agent IDs and the model tiers observed for the Phase 3 decision and the Phase 5 check (from the agent log), and whether a panel, an escalation or a judge took part;
- **deliberation:** each `deliberation[]` summary quoted in full, under its id.

`low` and `polish` sections may be short: steps, expected against observed, the artifact and the fix.

The file ends with **Improvements and positive patterns**: concrete, non-finding notes, kept apart from the findings. Include `PR-` rows that lacked a concrete pass criterion as improvement topics, and advisory guidance no `PR-` row adopted. Add a **probe reliability** paragraph: intermittent results by flakiness class (product-race, probe-wait, order-dependency, data-dependency, environment, external, time, unknown), and which of them became candidates.

### 5.4 NEEDS-VALIDATION.md

One section for every `needs_validation` record, plus every candidate left unvalidated or disputed (clearly marked as such, without a verdict). Each section gives the claimed root cause, the trace and evidence, the exact blockers, and the `local`, `device` and `owner` plans that apply. These are leads without severity. The plans never ask anyone to aim audit traffic at a deployment.

Records with `stronger_model_needed` form their own group at the top of the file, under a heading such as "Needs a stronger model": the tier needed, the reason, the deliberation summaries that led there (panel split, judge unsure, escalation limit or budget), and the one action that would settle it (re-run the verification when that tier is available, for example by resuming the run or starting a run scoped to these fingerprints).

### 5.5 COVERAGE.md

Four parts, in this order. It holds what REPORT.md only summarises.

1. **Run statement.** Cover:
   - profile, scope and exclusions (always the skill directories and the output directory);
   - the cap, invocations spent (the setup call included), and the reserves used (reconnaissance, critics, validation, orchestration), with the planning estimate it was compared against; any owner cap override, with the owner's words; the uncovered-by-cap totals in one sentence (units deferred for budget, candidates left unvalidated, consults declined, escalations and panels not funded); when `reserve_floor_met` is false, the sentence that the owner kept a cap below the reserve floor, so consults and decisive escalations were disabled by the cap from the start, with the floor and the reserve in figures;
   - when the parent could not ask the owner, the list of `unasked_questions` and the safe answer that applied to each; when roles ran inline (no delegation tool), the sentence that hunter and verifier were the same model session, so no verification was independent;
   - the models observed (which tiers ran, which were unavailable or substituted, and whether routing was per call or forced to a single model);
   - the owner's plan note, verbatim, when one was given, with the sentence that it was recorded and did not decide routing;
   - the source ref (commit, branch, dirty note);
   - the detected framework, package manager and serve command, and the build mode;
   - the topology, its two proofs and the bind proof, with the phrase "local only" and the VM networking mode when a VM was used;
   - the driver and browser version, and every engine not covered (Firefox, WebKit, iOS Safari, real screen readers, the real on-screen keyboard);
   - viewports, matrices, themes and network profiles;
   - personas, and which `PR-` rows the owner confirmed (unconfirmed memory rows backed nothing);
   - prior-run use: carried records, same-source re-verifications, changed-source revalidations, and the visual baseline used if any;
   - deferred and out-of-scope units, with their reason codes;
   - what "all cases" means: the cases are the ledger's units, closed by a clean final critic, not literal exhaustiveness;
   - the run's resumes, when it was paused (when, why, and that the budget was not reset).

2. **Coverage.** Cover:
   - unit counts by status;
   - counts by lens × context;
   - matrix completeness (pairs run against pairs declared), including pairs left out by a narrowed fallback panel;
   - important exclusions and `blocked` reasons;
   - the result of the final critic (`cfinal` clean, or why it did not run).
   Then the ledger rendered as tables: grouped by domain, then by lens; one row per unit, with the surface, expectation ref, context, task kind, variants actually run (from check `variant`s), status, owner, linked fingerprints and unresolved entries. Then matrix completeness per `matrix:` unit (pairs run and missing, with pairs left out by a narrowed panel marked as such), and the `deferred`, `blocked` and `out_of_scope` units with their reason codes, the budget, model and limit codes (`agent_cap_reached`, `critic_wave_limit`, `model_unavailable`, `usage_limit_reached`, `escalation_budget_exhausted`, `needs_stronger_model`, `dialogue_unresolved`, `visual_baseline_unavailable`) grouped first.
3. **Agents, models and budget.** Built from `agent-log.json` and `run-metadata.json` only:
   - **Budget.** Cap, spent, unspent; reserves planned at the strict gate against reserves used, per reserve; the orchestration reserve released to verifiers; every `cap_overrides[]` entry with the owner's words. A statement that the cap was never exceeded silently, or the exact override that allowed it.
   - **Agent minutes by phase.** For each phase, the invocations and the minutes of agent time summed from `started_at` and `finished_at` of its invocations (an invocation with no `finished_at` is counted as unknown, not as zero). It is the measure of real work: it shows whether the calls went where the work was. The cap still counts calls.
   - **Invocations by tier, task kind and purpose.** A table with one row per task kind that ran: tier requested, tier observed, effort, invocations, and how many were primary, replacement, retry, escalation, consult, judge, panel or schema repair. Calls refused for the host's concurrency limit are listed separately and marked "not counted".
   - **Escalations.** Each `esc-NN`: what it was about, from which tier to which tier wanted and used, the trigger, the outcome.
   - **Dialogues.** Each `dlg-NN`: what it was about (fingerprint or coverage ID), requester and peer lenses, rounds held against `max_rounds`, outcome (`agreed` by whom, judged for whom, neither, or cancelled), the judge's tier and route mode, and one line of its summary.
   - **Fallbacks.** Each `fb-NN`: task kind, wanted tier, used tier and effort, mode, why (the failure class or the declared unavailability), whether it was planned or discovered mid-run, agents and invocations, outcome, and the single question it was narrowed to when it was a three-member panel.
   - **Model availability.** For each of `haiku`, `sonnet`, `opus` and `fable`: declared in the config, observed at run time (`available`, `unavailable`, `substituted`, `unknown`, `untested`), the first evidence, and any reset on resume. Substitutions are listed with the requested and the self-reported model; self-reports that named no model are counted. The effort parameter's support, and any host override that forced a model or an effort.
   - **Needs a stronger model.** Every record and unit that ended in mode `none`, with the tier it needs.
   - **Reserve floor.** The floor at the gate and whether the cap held it; when it did not, every consult and escalation the run declined because of it.
   - **What the cap left uncovered.** From the ledger and the agent log's `uncovered_by_cap`: units `deferred` with `agent_cap_reached`, `budget_cannot_reserve_critics_and_validation`, `critic_budget_exhausted`, `validation_budget_exhausted` or `escalation_budget_exhausted`; consults declined (`cancelled_budget`); escalations and panels not funded; candidates left unvalidated. Each with its reference and reason code, and one sentence on what a larger cap or another run would add.
4. **Visual changes since baseline.**
   - **No comparable approved baseline:** one sentence saying so (no baseline, only unapproved ones, or none whose env keys match), and the outcome of the offer to promote this run's sweep (§5.6).
   - **With a baseline:** its id, source commit, approval state and date; the comparator self-test result; the options used (threshold, anti-aliasing handling, diff budget) labelled as skill thresholds where they are; counts by status (`unchanged`, `within_budget`, `changed`, `size_mismatch`, `env_mismatch`, `missing_baseline`, `missing_current`, `unstable`); a table of `changed` and `size_mismatch` items with capture key, diff ratio and pixels, region count, a link to the diff image, and what became of the item (a confirmed fingerprint, `covered` because an intended source edit explains it, or an improvement); `env_mismatch` items listed as "not comparable", never as regressions; `unstable` captures; items whose current capture failed (`currentFailed`), listed as "not the state the key names"; items whose masked area exceeded the warning level, marked low value. `within_budget` items whose differing pixels form one or two compact regions (a heading recoloured, a label respaced) are listed too, as leads: a small budget hides a real local change as easily as noise, so a reviewer looks at their diff images before calling them noise.
   - **Unapproved baseline:** the same table, headed as leads, with the sentence that an unapproved baseline backs no finding.
   - The outcome of the promote and approve offer, with the owner's words when they approved.

### 5.6 The baseline offer

After the reports are written, and only when this run made a visual sweep, the parent offers once, in `report_language`: to promote this run's sweep as the repository's new baseline, and whether to approve it as an expectation source for later runs. Only an explicit yes runs `ui-diff.mjs --promote` (with `--baseline-root <output_root>/<repo>/baselines` as an absolute path, a leading `~` expanded first), and only a further explicit yes runs `--approve` with the owner's words written verbatim to a file under `<out>/tools/` and passed with `--approved-text-file`. `--promote` leaves out every capture whose steps failed (reported as `capture_failed` in its `skipped` list) and keeps unstable ones flagged with `viewStable: false`. Promotion and approval are parent-run scripts, not agent invocations. The answer goes to `run-metadata.json` `visual_baseline` and COVERAGE.md "Visual changes since baseline"; if the reports were already written, the parent updates §9 only.

### 5.7 Fix-mode results

Fix mode ([FIX-MODE.md](FIX-MODE.md)) runs only on the owner's explicit request, against a run whose `findings.json` passes its validator. It never rewrites `findings.json`, the ledger or any audit report. Its own outputs are `fix/fix-log.json`, `fix/agent-log.json` (its own cap and reserves, under the same never-exceeded rule), `fix/<fix-id>/PR.md` and `FIXES.md`, validated with:

```sh
node <skill-dir>/validate-orchestration.cjs <out>/fix/fix-log.json --kind fix-log --findings <out>/findings.json --agent-log <out>/fix/agent-log.json
```

`FIXES.md` (layout in FIX-MODE.md §9) follows the ground rules of §5.1: every statement comes from the two fix logs and the re-verification artifacts. For each fix it reports the fingerprints closed, branch, class and the model tier that wrote it, the checks run in the sandbox with their exit codes, the re-verification result (`fixed`, `not_fixed`, `regressed`, `inconclusive`) with its tier and the visual diff of the affected routes, and the PR state. It also reports the fix budget (cap, spent, escalations, panels), what was not fixed and why, and the exact commands the owner can run to push and open the PRs. Nothing is pushed and no PR is opened without the owner's approval at gate A3; commit messages follow the target project's rules, including its rule on attribution trailers.

---

## 6. Run states

A run is `in_progress` while it works, may be `paused`, and ends in exactly one of two terminal states.

**Paused (not terminal).** The parent pauses when a shared usage limit is hit, when the owner stops the run, or when every tier needed for the remaining decisive work is unavailable (ORCHESTRATION.md §7). It stops launching; waits for running agents and consumes their results; closes every open dialogue, escalation and fallback panel as `cancelled_pause`; returns their items and every `in_progress` unit without an accepted result to `planned` (attempts archived with `reassignment_reason: "paused: <pause_reason>"`; candidates and records back to their verification queue); releases their earmarks; validates the ledger and `agent-log.json`; sets `run_status: "paused"` with `pause_reason` (`usage_limit_reached`, `user_interrupted` or `model_unavailable`); writes any raw reset text into `budget_note`; and tells the owner in `report_language` how to resume. No report is written while paused.

**Resume.** When the owner says to continue the run at `<out>`, in this or a new session, the parent re-reads the metadata, the ledger, `agent-log.json` and `fingerprint-agents.json`, runs all three validators, re-runs the topology proofs and the probe target guard, appends a `resumes[]` entry, sets `run_status: "in_progress"`, and continues spending from `agents_spent` against the same cap; a resume never resets the budget. Usage-limit families become `untested` again; units deferred or blocked for `model_unavailable`, `usage_limit_reached` or `agent_cap_reached` are re-planned when their cause is gone; items closed `cancelled_pause` are re-queued with fresh agents and new ids. The ledger is the source of truth; agent transcripts are never relied on [rule: CLAUDE-24]. A session that cannot resume (state files invalid) ends `incomplete` with the pause reason.

**Finishing from pause.** When the owner says to finish with what there is, the parent runs Phases 4 to 6 on the decided records only and ends `incomplete` with the `pause_reason` as `incomplete_reason`.

**(a) Complete.** Every artifact is written: `findings.json`, the ledger, `agent-log.json`, `fingerprint-agents.json`, REPORT.md, FINDINGS-DETAIL.md, NEEDS-VALIDATION.md, COVERAGE.md, architecture.md and project-rules.md. All three validators pass, the ledger one with `--metadata` and the orchestration one with every cross-check flag. `run_status` is `complete`. This requires all of the following:

- every ledger candidate has an independent decision;
- every kept record was closed: by its Phase 3 verifier, or, for a `confirmed` high or blocker record outside `quick`, by a Phase 5 agent; and `check-traces.mjs` passed;
- no material replacement is unresolved;
- the final critic ran clean (or, in `quick`, its additions were deferred with `quick_profile_final_critic`);
- no unit is `deferred` or `blocked` for `agent_cap_reached`, `model_unavailable`, `usage_limit_reached` or `escalation_budget_exhausted`.

A complete run may still hold `needs_validation` records with `stronger_model_needed`, and units `blocked` with `needs_stronger_model` or `dialogue_unresolved`: they are decisions about what could be settled here: REPORT.md section 4 and COVERAGE.md "Agents, models and budget" list them.

**(b) Incomplete.** `run_status` is `incomplete`, and `incomplete_reason` starts with a code from the reasons list in [RUN-METADATA.md](RUN-METADATA.md), such as:

- `validation_budget_exhausted`;
- `agent_cap_reached`;
- `model_unavailable`;
- `usage_limit_reached`;
- `phase5_dispute: …`;
- `runtime_unavailable`;
- `user_interrupted`;
- `promotion_failed: …`.

The same reason appears in the first lines of REPORT.md. All three validators still pass on whatever was written.

Rules for reaching a terminal state:

- **Never abandon a phase midway.** When the budget runs out, apply the spending rules in [ORCHESTRATION.md](ORCHESTRATION.md) §1 and [RUN-METADATA.md](RUN-METADATA.md) §11 and finish the remaining phases with what is funded. Unvalidated candidates stay in the ledger, findings.json holds only decided records, and the reports disclose the gap.
- **When the user interrupts** and does not want to resume later, the parent pauses as above and then finishes from pause: `incomplete` with `incomplete_reason: "user_interrupted"`, and `finished_at` set. If the owner wants to resume later, the run stays `paused`.
- **The audit never edits the target.** Audit and guidance modes write nothing to the target repository. Fixes go through fix mode, only on the owner's explicit request, inside separate worktrees and branches that follow the project's own git rules ([FIX-MODE.md](FIX-MODE.md)). Tooling proposals, such as adding a browser-test dependency, are follow-ups for the repository's normal branch flow. Example (Brasero): a short branch from `dev`, a pull request to `dev`, then `main` with the owner's approval.
- Finally the parent tells the owner, in `report_language`: the output directory, the terminal state, the confirmed count by severity, the number of items that need a stronger model, and the invocations spent against the cap (for example "34 of 40 agents").
