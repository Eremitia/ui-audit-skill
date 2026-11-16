---
name: ui-audit
description: Audit, QA and optionally fix how a web app works and looks, with coordinated subagents on a local disposable copy. Use when asked to audit, QA, test or review a web UI or UX end to end - functional flows and on-screen business rules, forms, loading, empty and error states, responsive layout and zoom, performance and Core Web Vitals, accessibility (WCAG 2.2 AA), light and dark themes, visual changes between runs, resilience, or the repository's own UI rules - or to fix confirmed findings on branches and propose pull requests. Typical requests include audit the UI, QA the whole app, test every case, fix the UI findings, audita la UI, revisa la interfaz, prueba todos los casos, corrige la UI. Modes - guidance (the default), full audit (reports, a budgeted set of agents with per-task model routing) and fix mode (explicit request only; never pushes, merges or opens a pull request without the owner's approval). Works with Next.js, Vite, Remix, React Router, Nuxt, SvelteKit, Astro, Angular and static sites.
license: MIT
---

# UI Audit

Find failures a real user would observe, each measured against an expectation someone wrote down before the audit. Hand the owner a reproduction they can repeat locally, the evidence, a priority and the smallest source fix, and, when asked, the fix itself on a branch ready for review. A deviation without a persona, a context, an expectation source and a user consequence is not a finding, however ugly it looks.

Scope: flows and state machines, business rules on screen, forms and lists, uploads and generated files, screen states, navigation, cross-screen figures, live updates, locale formatting, responsive layout, performance, accessibility (WCAG 2.2 AA), themes, visual changes since an approved baseline, public page metadata, resilience, and the repository's own written UI rules. `scripts/detect-project.mjs` identifies the framework and how to build and serve it. The worked example throughout the docs is Brasero, a fictional Next.js restaurant ordering and booking app with a Spanish UI, COP currency and the America/Bogota time zone.

## Operating modes

Loading this skill authorises nothing by itself.

- **Guidance mode** (the default). Answer from the relevant sections. You may read source, run focused delegated checks that report back, and run `scripts/ui-probe.mjs` with its output outside the repository, against only (a) an app in the disposable environment of Execution safety, or (b) with the owner's explicit OK for that check, unauthenticated GET-only pages of a local app already running, with no `steps`, `storageState` or `saveStorage` in the config. Guidance mode never creates a run directory, ledger, config or report, and never asks the setup question.
- **Full audit mode** runs only on an explicit request: audit or QA the whole app, a full, complete or end-to-end UI review, "test every case", or a request for report artifacts. It runs all six phases within its profile's cap and writes every artifact below. For "test every case", recommend `standard` over the whole app (`deep` only for one named area or when asked) and show the planning estimate before any hunter launches.
- **Fix mode** runs only on an explicit request ("fix", "corregir", "arreglar", "fix the findings") and only against a run whose `findings.json` passes the validator and holds at least one `confirmed` record. It never fixes `needs_validation` or `rejected` records, edits only inside worktrees it creates, and never pushes, opens a pull request or merges without the owner's run-time approval. Everything is in [FIX-MODE.md](FIX-MODE.md), with its own cap (`fix.agent_cap`, default 30) and log.

If a request fits more than one mode, ask one focused question in the user's language before creating any file. Every mode obeys every rule under Execution safety.

## Terminology

- **The parent** coordinates the run, is the only writer of shared files and the only one who asks the owner anything.
- **A `research` agent** reads source and run artifacts and may run probe captures only under the non-mutating contract. **A `general` agent** also drives browser sessions and mutates fixture data inside its own tenant only. In Claude Code both map to `subagent_type: "general-purpose"` with the matching contract in the prompt; never use Explore or Plan for work that may be resumed [rule: CLAUDE-16, CLAUDE-19]. The full binding is in [ORCHESTRATION.md](ORCHESTRATION.md) §9.
- **Invocation**: every delegation call, new or resumed, retries included; only a call the host refused before it started does not count. Invocations are what the cap counts.
- **Task kind**: the routing key of an invocation (`recon_routes`, `hunt_business`, `judge`, `fix_logic`…); [ORCHESTRATION.md](ORCHESTRATION.md) §2 maps each to a tier, an effort and an escalation target.
- **Tier**: one of `haiku`, `sonnet`, `opus`, `fable`, low to high. No other model value appears in the skill.
- **Consult**: a structured question one agent puts in its result for a peer of another lens. **Judge**: a fresh strong-tier agent that decides a consult the two sides could not settle. **Panel**: two or three lower-tier agents standing in for an unavailable stronger one.
- **Unit**: one row of `coverage-ledger.json` (surface × expectation × domain × lens × context). **Tenant**: an isolated slice of disposable data one mutating agent owns (in Brasero, a restaurant slug such as `audit-h3`). **Context**: the canonical string that pins viewport, theme, role, input, network, data state and so on, for example `matrix:core;role=customer;data=typical`; grammar in [RECONNAISSANCE.md](RECONNAISSANCE.md).

**Non-mutating contract** (every `research` agent, consult peer and judge, and all of Phase 5). The agent uses only a saved session state it was given and never logs in; never submits a form; navigates with GET only; uses no writing probe step (`click` on a submitting control, `fill` then submit, `upload`, `evaluate` with side effects); and never runs a database command. When the host's read-only agent type cannot run commands, the parent starts a `general` agent, pastes this contract into its prompt word for word, and records the substitution.

## Execution safety (every mode)

1. **Loopback only.** The app listens on `127.0.0.1`, `::1` or `localhost`, and browsers navigate only to loopback URLs. Every launch blocks other traffic twice: a dead proxy (`--proxy-server=http://127.0.0.1:9`, `--proxy-bypass-list=localhost;127.0.0.1;[::1]`, never `<-loopback>`) and `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]`, plus `--disable-quic` (under Playwright, the `proxy` option with the same args). No pausing interception (`Fetch.enable`, `page.route`). Blocked requests are logged as observations. Never open the deployed site, a production URL or a third-party service, and never follow outbound links (chat deep links, payment gateways, `tel:`, `mailto:`). The only actions that send data off loopback are an owner-approved install or download from named hosts ([RUN-METADATA.md](RUN-METADATA.md) §2, the preparation step, fix gate A2) and, in fix mode, the pushes and pull requests approved at gate A3.
2. **Disposable data only.** A database and storage directory created for this run, seeded with dummy fixtures and accounts; never the owner's dev database, a production dump or a real account.
3. **No real side effects.** No real payment, message, push notification, email, SMS, external upload or paid quota.
4. **No source edits outside fix worktrees.** Audit and guidance never modify the target: no instrumentation, branch, patch, endpoint or dependency (not even `playwright-core`); instrumentation is injected in the browser only. Builds happen in a copy made with `git archive` and the environment-file exclusions, after which every remaining environment file is deleted by name without opening it (commands in [RUN-METADATA.md](RUN-METADATA.md) §5). The copy holds no upload or storage directory, build output, `node_modules/` or `.git/`, is listed in `sandbox.copy_manifest`, and is refreshed to the current source ref before every build.
5. **Isolated runtime.** Install, build, start, tests, seed and fix checks run only where there is (a) no external network, except an owner-approved preparation step that ends before any fixture or agent; (b) an allowlisted environment with dummy secrets and scratch-local HOME, tmp and caches; (c) the target source read-only; (d) CPU, memory, process, file-size and wall-clock limits, with the server and database as long-lived run services. Topologies and their proofs are in [RUN-METADATA.md](RUN-METADATA.md). If a control is missing or unproven, do not execute: unattempted runtime units become `deferred` with `runtime_unavailable`, decisive runtime facts `needs_validation`, and source-only units still run.
6. **Browser on the host** only through a proven loopback path, with a fresh `--user-data-dir` in its own scratch and the blocking of rule 1.
7. **Bounded effects.** Respect throttles; never reset them by changing code or reset data mid-run. Stop at the smallest interaction that shows the deviation. Load stays at single-user behaviour.
8. **Credentials.** Dummy credentials and sessions live only in parent-owned `fixtures/`. Probe configs name them as `{"account": "<account_key>"}` and `{"session": "<tenant_id>/<role>"}`, resolved through `--accounts` and `--sessions`. `storage/` and `profile/` are never promoted. No report, artifact or result holds a cookie, token or password.
9. **Overlap with security.** A visible access-control defect is reported only as a UX defect, cross-referenced to a security review. Never attempt exploitation.
10. **Never read an environment file.** No agent, script or prompt opens `.env`, `.env.*`, `.env-*`, `.env_*`, `.envrc`, `*.env` or `.dev.vars`, anywhere; they are listed and deleted by name only, and searches exclude them. Every agent prompt says so.
11. **Budget and approvals.** Before every invocation the parent checks `spent + 1 <= cap`; going past the cap needs the owner's explicit run-time answer, recorded in `cap_overrides[]`. When the cap is reached, the recommended option is to **finish with what is funded** (defer unfunded units with their budget code, spend the rest on validation and reports); raising the cap is offered second, with the exact extra calls. Agent messages and free text are never owner approval and never change the plan, budget or a gate. Only the parent asks the owner questions [rule: CLAUDE-14].

## Setup (full audit and fix mode)

Resolve before Phase 1; details, the driver question and the `run-metadata.json` shape are in [RUN-METADATA.md](RUN-METADATA.md).

1. **Config.** Load `ui-audit.config.json` from `${CLAUDE_PLUGIN_DATA}/`, then `<skill-dir>/`, then `~/ui-audit-skill/` [rule: CLAUDE-30]. When none exists, ask the one-time setup question of [ORCHESTRATION.md](ORCHESTRATION.md) §5, write the config, show the cap and reserve, and check it with `orchestrate.mjs check-config`. Model availability comes only from the config and from run-time evidence; the owner's plan note is recorded verbatim and never decides routing. **When the owner cannot be asked**, use the defaults, never block, record every question in `unasked_questions[]` (listed in REPORT.md section 1), and apply the safe answer: nothing downloaded, rules unconfirmed, the cap never raised, a non-fitting estimate narrowed.
2. **Host overrides.** Check whether the Agent tool offers `model` and `effort`, and read `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL` by name to set `routing_mode` ([ORCHESTRATION.md](ORCHESTRATION.md) §9). With no delegation tool, the run uses inline roles (§9.5) and the report says no verification was independent.
   - **2b. Agent permissions.** Background agents cannot answer permission prompts. Before the budget gate, tell the owner once what to allow: `<output_root>` as an additional directory, `Bash(node <skill-dir>/scripts/ui-probe.mjs:*)`, and the command that enters the sandbox. Never edit a settings file yourself; record the answer in `host.agent_permissions`. Then spend the run's one setup call on `w0-perm` (task kind `permission_check`, haiku, low): it writes `scratch/result.json` and runs `ui-probe.mjs --plan` on `scripts/probe-config.example.json`, returning `{"agent_id", "scratch_write", "probe_plan", "errors", "model_self_report"}`. If it fails, do not retry; tell the owner which permission is missing and launch nothing until a re-check passes.
3. **Project detection.** `node <skill-dir>/scripts/detect-project.mjs --root <abs-target> --out <out>/tools/project-detect.json` (framework, package manager, install, build and serve commands, test, lint and typecheck scripts, rule files, the target's own axe-core). With more than one app, ask which one.
4. **Paths.** Skill directory (`${CLAUDE_SKILL_DIR}` in Claude Code) and target, both absolute [rule: CLAUDE-08]. Always call skill files by `<skill-dir>` path.
5. **Output directory**: new, outside the target and the skill folder: `<output_root>/<repo>/run-<N>` (default `~/ui-audit-skill`). Run outputs never live in the skill folder or a plugin cache [rule: CLAUDE-30, CLAUDE-35].
6. Source ref `{commit, branch, dirty, dirty_note}` and `report_language` (BCP 47; `auto` means the owner's language).
7. **Driver.** On first use run `node <skill-dir>/scripts/setup.mjs`. If it reports `ready: false`, the pinned `playwright-core` is missing (a fresh clone or `npx skills` copy): with the owner's yes, run `setup.mjs --install`, which runs `npm ci --ignore-scripts` in the skill folder (one download from the npm registry; it fetches no browser). Until then the probe's `--driver auto` falls back to its built-in CDP driver, which needs no install. Both drive a local Chromium-family build. Never install anything into the target. No executable and no driver means `browser.driver: "none"` and a source-only run that ends `incomplete`.
8. **Runtime topology** with the ready, egress and bind proofs: `nat-forward`, `netns-bridge`, `browser-in-vm`, `container-loopback` or `host-only` ([RUN-METADATA.md](RUN-METADATA.md)).
9. **`base_url`** is `http://localhost:<port>` or `http://127.0.0.1:<port>` as the browser sees it, never a VM or LAN address: `Secure` and `__Host-` cookies work only on loopback names. After session capture, check the expected cookies are in each saved state, session cookies included.
10. Variant axes, personas, fixtures with spare tenants, the clock policy, the visual baseline, and the profile, scope, cap, reserve and planning estimate.

**Preparation step with network.** Install and build usually need the network (registry, postinstall binaries, build-time fonts), and performance units need a production build, so the step is offered rather than skipped. With the owner's explicit yes (`sandbox.prep_network{approved_at, hosts}`), install and build run once, before any fixture or agent, in the build copy with dummy environment values, telemetry off and egress only to the named hosts; then the network is closed and the egress probe re-run. A no records `build_fetch_required` (or `owner_declined_download`) and the run is source-only.

Chromium is the only local engine. Firefox, WebKit, iOS Safari, a real on-screen keyboard and real screen-reader output are never reproduced: units seeded for that gap are `deferred` with `engine_unavailable`, and claims about them are `needs_validation`.

**Language.** These files are English. Every prose artifact of a run is in `report_language`: the four reports, FIXES.md, architecture.md, project-rules.md, fix plans, PR texts (unless the project names a PR language) and the prose fields of every result. JSON keys, enum values, fingerprints, IDs, file names and code stay English ASCII.

**Excluded surface, always**: `.claude/**`, `.agents/**`, any other agent-skill directory and the run's output directory.

## Profiles, budget and routing (summary)

The budget counts invocations. Defaults, all configurable in `ui-audit.config.json`:

| Key | quick | standard | deep |
|---|---|---|---|
| Agent cap | 15 | 40 | 90 |
| Reconnaissance reserve | 4 | 4 | 4 |
| Critic reserve at start | 1 | 2 | 2 |
| Validation reserve minimum | 1 | 2 | 2 |
| Orchestration reserve | max(2, ceil(cap × 0.10), floor) | same | same |
| Reserve floor (default config) | 6 | 6 | 6 |
| Reserved with the default cap | 12 | 14 | 17 |
| Setup call before the gate (`w0-perm`) | 1 | 1 | 1 |
| Smallest cap that holds the floor | 14 | 16 | 16 |
| Smallest cap that can start (floor not held) | 10 | 12 | 12 |
| Performance lab protocol | warm-up + 3 cold runs | warm-up + 5 cold runs | warm-up + 5 cold runs |
| Phases 3 and 5 | merged | merged, except a separate Phase 5 agent for high and blocker records | as standard, with 10 % replacement headroom on Phase 5 |

`reserveFloor`, `computeReserve`, `minimumCap` and `budgetGate` in `scripts/orchestrate.mjs` are normative (`orchestrate.mjs budget --profile <p> [--cap <n>]`). The floor is the larger worst case of one consult and one decisive escalation; a cap between the two minimums starts only after the owner hears that consults and escalations are disabled ([ORCHESTRATION.md](ORCHESTRATION.md) §1.2).

- **`quick`**: one hunter wave and one final critic, whose additions become `deferred` with `quick_profile_final_critic`; runtime contexts on `matrix:quick`; every verifier closes its own record.
- **`standard`** (default): layout, theme and accessibility units on `matrix:core`; performance at `vp=m390;net=slow4g` and `vp=d1440;net=fast`; at most 2 post-wave critics that add work, then one `cfinal`; later additions `deferred` with `critic_wave_limit`.
- **`deep`** (one named area, or on request): per-domain and per-role units, `matrix:full` plus `matrix:pivot`, at most 3 post-wave critics, the full context splits (keyboard, AX tree, reduced motion, zoom, slow and flaky networks, sessions, data states, a far time zone), and a second pass on same-source `covered` units.
- **Scoped run** (paths, routes, lenses or a diff): only in-scope units are assigned, the rest are `out_of_scope`, and the report says the run is partial.

**Reserve rule.** Before any agent, the setup call, reconnaissance, critics, validation, the orchestration reserve (with its floor) and at least one hunter must fit; otherwise launch nothing and offer a narrower scope, another profile or a higher cap, in that order. Before every wave, re-reserve its critic, `cfinal`, validation and the orchestration reserve; hunters fill the remainder. After seeding, run `orchestrate.mjs estimate --input <file>`, show the estimate to the owner, and never hunt on an estimate that does not fit without their answer. Details: [ORCHESTRATION.md](ORCHESTRATION.md) §1.

**Model routing.** [ORCHESTRATION.md](ORCHESTRATION.md) §2 (mirrored by `orchestrate.mjs route`) gives each task kind its tier and effort: the cheapest tier for mechanical work, the middle tier for most hunting, wave critics and ordinary verification, the strong tier for business rules, cross-screen figures, performance, the final critic and high-severity verification, and the strongest for judges. A `low` or `unsure` self-assessment, or a request for a stronger model, is re-run on the escalation target (§3). Missing tiers follow the fallback ladders (§6); a usage limit pauses the run (§7). On hosts that force one model, a low result gets one same-model second opinion instead.

**Profiles never lower the evidence bar**: the candidate gate, the safety rules, `needs_validation` discipline, schema validation, independent reproduction for `confirmed`, production builds for performance and the anti-taste caps always apply.

## Write isolation and agent IDs

Only the parent writes `run-metadata.json`, `architecture.md`, `project-rules.md`, `coverage-ledger.json`, `findings.json`, `fingerprint-agents.json`, `agent-log.json`, the reports, `FIXES.md`, the critic files, and everything under `fixtures/`, `tools/`, `sandbox/`, `visual/`, `fix/` and `worktrees/`. Each agent gets `<out>/agents/<agent-id>/` with the parent's `prompt.md`, its own `scratch/` (`in/`, `out/`, `result.json`; the only place it writes) and the parent-owned `artifacts/`.

Agent IDs match `^[a-z0-9][a-z0-9_-]{0,63}$`, are never a Windows device name, and follow these shapes: `w0-perm`; `r1a`–`r1d`, `r1x-<slug>` and `<recon-id>-e<k>` for reconnaissance; `l1` for the ledger draft; `h<N>-<slug>` and `h<N>e<k>-<slug>` for hunters; `c<W>`, `c<W>e<k>` and `cfinal` for critics; `v<N>-<slug>` for Phase 3 verifiers (batches included) and `p<N>-<slug>` for Phase 5, with `-a|b|c` for panel members; `q<N>-<slug>`, `j<N>-<slug>` and `j<N>-<slug>-a|b|c` for consult peers and judges of `dlg-N`; `s<N>` for schema repairs; `w1-sweep` and `w1e<k>-sweep`; `x<N>-<slug>`, `x<N>e<k>-<slug>` and `y<N>-<slug>(-a|b|c)` for fixers and fix re-verifiers; `fixtures` for the parent's own fixture work. Launch each agent with `name` set to its ID unless agent teams are active ([ORCHESTRATION.md](ORCHESTRATION.md) §9).

**Disjointness.** `fingerprint-agents.json` maps each fingerprint (and, under `by_unit`, each unit) to `hunters`, `candidate_verifiers`, `record_verifiers`, `replacement_verifiers`, `consultants` and `judges`. No agent appears in two lists of one fingerprint, except a `v…` agent that closed the record it verified. Check it before every verification, consult, judge and fix re-verification.

**Sessions.** A saved session file is used by exactly one mutating agent; units that switch person or role get their own tenant session.

## Evidence promotion (summary)

The parent promotes evidence with `node <skill-dir>/scripts/promote.mjs --run-dir <out> --agent <id>`; agents never copy into `artifacts/` and the parent never copies by hand. An agent lists each file in its result's `artifacts[]` with a scratch-relative `path` that starts with `out/`, a `promote_to`, `bytes` and a `purpose`, and cites it by its future owned path `agents/<own-id>/artifacts/<promote_to>`. The script accepts only safe relative paths and the allowed extensions, refuses storage and profile paths, inline credentials and sensitive HAR headers, copies regular files no-follow and exclusively within the size limits, and never globs or extracts. The full procedure is the fenced "Evidence handling" block of [HUNTING.md](HUNTING.md). A decisive file that fails promotion makes the unit `blocked` or the record `needs_validation` (`promotion_failed`), and the validators run with `--run-dir` fail any cited path that was not promoted.

## Defect model (summary)

The full model, verdicts, severity table and caps are in [VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md); every threshold is listed with its source in [SOURCES.md](SOURCES.md).

Every candidate states persona and role, surface, context, steps, the expected result with its expectation source, the observed result, and evidence: an owned artifact path plus a source trace as file:line. Expectation sources: `repo_rule`, `owner_preference` (a confirmed project-rules.md row), `business_rule`, `standard`, `budget`, `sibling_screen`, `platform_contract`, `approved_baseline`. Taste is never enough. `approved_baseline` and `sibling_screen` are capped at `low` unless a figure or task outcome differs; an unapproved baseline produces leads only; a `judgement-against-quote` rule needs its concrete pass criterion and a verifier who reaches the same judgement blind.

Verdicts: `confirmed` (reproduced locally in the stated context by the hunter and independently by a verifier, with promoted evidence); `needs_validation` (a credible trace whose decisive fact cannot be settled locally, or that no available tier could decide, with exact blockers, a plan and never a severity); `rejected` (refuted, misread, no user impact or a fixture artifact).

Severity, for `confirmed` only: **blocker** (a persona cannot finish a core task in a supported context; wrong money, stock or records; input lost; the main entry unusable), **high** (a non-obvious workaround on a core task; a figure that differs between screens; a WCAG A failure on a core path; content unreachable; LCP > 4.0 s or INP > 500 ms on the primary entry, mobile profile, verifier's median), **medium** (a broken secondary task, an AA failure off the core path, a missing designed state, a "needs improvement" metric on a core route, a confirmed written UI rule visibly broken), **low** (a visible inconsistency with no task effect), **polish** (a refinement backed by a written rule with negligible effect). Reach is `all_users|core_persona|segment|narrow`; overall ≤ impact, ≥ impact − 2, and ≤ impact − 1 with `narrow` reach. Fingerprints are ASCII, at most 200 characters, `<domain>/<lens-slug>/<surface-slug>/<defect-slug>`, stable across states. One root cause on several screens is one record, with the rest in `also_affects`.

## Full audit workflow (phase index)

The parent logs every invocation in `agent-log.json` before the call and completes it after.

1. **Reconnaissance** ([RECONNAISSANCE.md](RECONNAISSANCE.md)): setup, then four `research` agents (product and business rules; routes and states; design system and repository rules; run capability and hazards). The parent writes architecture.md and project-rules.md, has the owner confirm the rules, builds fixtures and tenants, captures sessions, finds the baseline, seeds and validates the ledger, and shows the planning estimate.
2. **Hunting waves** ([HUNTING.md](HUNTING.md), [LENSES.md](LENSES.md) and the selected companions: [FUNCTIONAL-FLOWS.md](FUNCTIONAL-FLOWS.md), [RESPONSIVE-AND-LAYOUT.md](RESPONSIVE-AND-LAYOUT.md), [PERFORMANCE.md](PERFORMANCE.md), [ACCESSIBILITY.md](ACCESSIBILITY.md), [VISUAL-AND-THEMING.md](VISUAL-AND-THEMING.md), [RESILIENCE-AND-STATES.md](RESILIENCE-AND-STATES.md), [PROJECT-CONVENTIONS.md](PROJECT-CONVENTIONS.md)): groups of one task kind and up to 12 units, one structured JSON result each with a self-assessment and optional consults. Wave 1 includes the visual sweep (`scripts/ui-diff.mjs`). Order: ordinary waves, server-zone, performance (one runtime agent at a time), throttle and login, escalation, then `cfinal`.
3. **Candidate validation** ([VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md)): first group candidates by root cause with `scripts/group-candidates.mjs` and merge the ones that share it; then each unique candidate goes to a fresh `general` verifier in a fresh spare tenant, routed by severity and lens, who tries to refute it and reproduces it independently. Proposed `low`/`polish` candidates of one surface share a `verify_batch` (up to 5), source-only ones a `verify_source_batch` (up to 10). Outside `quick`, every record except a confirmed `high` or `blocker` is closed by its Phase 3 verifier.
4. **findings.json**: every decided record sorted by fingerprint, with `deliberation[]` from the agent log, after rereading [report-schema.json](report-schema.json); then fix every error from:
   ```
   node <skill-dir>/validate-findings.cjs <out>/findings.json --run-dir <out>
   node <skill-dir>/validate-coverage-ledger.cjs <out>/coverage-ledger.json --metadata <out>/run-metadata.json --run-dir <out>
   node <skill-dir>/validate-orchestration.cjs <out>/agent-log.json --kind agent-log --metadata <out>/run-metadata.json --findings <out>/findings.json --ledger <out>/coverage-ledger.json --fingerprints <out>/fingerprint-agents.json
   node <skill-dir>/scripts/check-traces.mjs --findings <out>/findings.json --target <abs-target> --ref <source_ref.commit>
   ```
   Passing proves format and consistency, never the finding.
5. **Final record verification**: one fresh agent per `confirmed` `high` or `blocker` record (outside `quick`), non-mutating, routed `verify_record_strong`.
6. **Reports** in `report_language`: REPORT.md (five sections, 150 to 250 lines: scope, quality posture with what to fix first, confirmed findings, needs validation, links), FINDINGS-DETAIL.md (every confirmed record in full, then improvements and positive patterns), NEEDS-VALIDATION.md, and COVERAGE.md (run statement, coverage, agents, models and budget with agent minutes by phase, visual changes). Then offer once to promote this run's sweep as the new baseline and, separately, to approve it. A clean run may have zero findings.

"Test every case" means the ledger's units closed by a clean final critic, not literal exhaustiveness; COVERAGE.md says so.

**Fix mode phases** ([FIX-MODE.md](FIX-MODE.md)): F0 gate and approval A1, F1 plan by root cause, F2 worktrees from the project's base branch, F3 fixers, F4 the project's checks in the sandbox, F5 re-verification with the probe and a visual diff, F6 pull request proposals and gate A3, F7 FIXES.md.

**Tools.** `scripts/ui-probe.mjs` records facts and agents judge them; it refuses non-loopback URLs, writes only under `--out`, and `--plan` checks a config without a browser ([scripts/probe-config.example.json](scripts/probe-config.example.json) is a full example). `ui-diff.mjs` compares captures with a baseline; `orchestrate.mjs` routes, prices and classifies failures; `detect-project.mjs`, `static-serve.mjs`, `promote.mjs`, `group-candidates.mjs` and `setup.mjs` do what their names say. `npm test` in `<skill-dir>` runs every test.

**Progress updates.** After each phase, wave, critic, validation batch and fix step, tell the owner in `report_language` what finished, the unit counts, candidates (never called findings until verified), invocations against the cap, any escalation or fallback, and what comes next. It costs no invocation.

**Run states.** `paused` (a usage limit, the owner, or no tier left) stops launching, closes open items as `cancelled_pause`, returns unfinished units to `planned` and says how to resume; resuming never resets the budget ([ORCHESTRATION.md](ORCHESTRATION.md) §7). The two terminal states are `complete` (every artifact written, all validators passing) and `incomplete` with a reasons-list code disclosed first in REPORT.md. Never abandon a phase midway; when the budget runs out, finish the remaining phases with what is funded.

## Anti-patterns

1. Taste or redesign ideas presented as defects, including "looks generic" without a concrete pass criterion.
2. A score or metric with no threshold or no user consequence.
3. Claiming a lens or matrix is covered after one viewport, theme or role.
4. Measuring performance on a dev server, with a warm cache, or without recording the VM hop.
5. Touching production, the owner's dev data, real accounts or third-party services.
6. Guessing iOS, Firefox, WebKit, real-device or screen-reader behaviour instead of recording `needs_validation`.
7. Flagging a decision the repository documents as intentional.
8. Generic best-practice advice with no reproduction.
9. Mid-poll, mid-animation or full-page screenshots offered as evidence of a fixed-bar or `dvh` defect.
10. Sharing a tenant or session between mutating agents, logging in through the form for every agent, or seeding or resetting mid-run.
11. Prose-only results, or prose and JSON that disagree.
12. A severity on a `needs_validation` record.
13. Writing reports before verification, or verifying the same root cause twice instead of merging first.
14. Reports in English when the user wrote in another language, or non-ASCII fingerprints.
15. Editing the target's source, or adding a dependency to it, during an audit.
16. Passwords, cookies or session files in scratch configs, artifacts or reports.
17. Downloading a driver, browser, font or package without the owner's explicit yes.
18. Spending past the cap, or launching agents without reserving critics, validation and the orchestration reserve.
19. Assuming a model is available from the owner's plan, or trusting a result whose self-reported model is lower than requested for decisive work.
20. Pushing, opening a pull request or merging without run-time approval; committing to a protected branch; adding attribution trailers a project forbids; letting a fixer run project code on the host.
21. Opening or reading an environment file, anywhere, for any reason.
22. Calling a lab number "passes Core Web Vitals", or an automated accessibility pass "WCAG compliant".
23. Treating a change against an unapproved baseline as a defect.
