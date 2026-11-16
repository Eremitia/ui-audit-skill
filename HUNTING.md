# Hunting

### Phase 2: Coverage-led hunting waves

Phase 2 turns `planned` units of `coverage-ledger.json` into evidence through `general` hunters, parent consolidation and coverage critics. Nothing here starts until Phase 1 is finished: `run-metadata.json` written, the topology proofs recorded, fixtures and sessions captured, the ledger seeded and passing `validate-coverage-ledger.cjs --metadata`, `agent-log.json` started, and the planning estimate (with its `by_model` line and the reserves) shown to the owner (see [RECONNAISSANCE.md](RECONNAISSANCE.md), [RUN-METADATA.md](RUN-METADATA.md) and [ORCHESTRATION.md](ORCHESTRATION.md)).

An invalid ledger or an invalid agent log drives no assignment. If either validator fails at any point in this phase, fix the file before launching anything else.

Model choice, effort, budget reserves, escalation, consults and fallback ladders are defined once, in ORCHESTRATION.md. This file applies them to hunters and coverage critics; where the two seem to differ, ORCHESTRATION.md and `scripts/orchestrate.mjs` win.

## Assignment

### Grouping units into hunters

A hunter receives a group of units that it can settle with one reading of the code and one set of browser sessions. Group by these rules, in this order:

0. **One task kind.** Before grouping, the parent gives every `planned` unit a task kind from its lens, stored in the unit's bookkeeping field `task_kind` (the validators ignore it). The precedence is fixed: `hunt_business` > `hunt_performance` > `hunt_judgement` > `hunt_standard` (`HUNT_PRECEDENCE` in `scripts/orchestrate.mjs`; the routing table is ORCHESTRATION.md §2). A group carries exactly one task kind; groups never mix kinds, even on the same surface.
   - `hunt_business`: the unit's lens is one of `BUSINESS_LENSES`: `LENSES.md#Business rules as displayed`, `LENSES.md#Data consistency across screens`, `FUNCTIONAL-FLOWS.md#Displayed business rules`, `FUNCTIONAL-FLOWS.md#Figure consistency across screens`, `FUNCTIONAL-FLOWS.md#Money, quantity and rounding`, `FUNCTIONAL-FLOWS.md#Time, dates and time zones`, `FUNCTIONAL-FLOWS.md#Exports match the screen`.
   - `hunt_performance`: the unit's lens is any class of PERFORMANCE.md.
   - `hunt_judgement`: the unit cites a `judgement-against-quote` PR- row, or its lens is `VISUAL-AND-THEMING.md#Generic or template look` or `VISUAL-AND-THEMING.md#Unintended visual change`.
   - `hunt_standard`: everything else.
1. **One domain.** Every unit in a group has the same `canonical_refs.domain`. In `quick`, every domain is `profile/quick/all-in-scope-domains`, so group by surface instead.
2. **One surface or its neighbour.** Units share a route, or sit on routes the same persona reaches in one flow. Example (Brasero): `/mesa/[slug]` and `/mesa/[slug]/reservas` may share a hunter; `/mesa/[slug]` and `/admin/balance` may not.
3. **One tenant.** A tenant is the isolated slice of disposable data a hunter may mutate (a business, workspace, organisation or account, whatever the app partitions by). A hunter mutates data only in the tenant assigned to it. Units that need different tenants (for example a `data=empty` unit and a `data=heavy` unit whose fixtures live in different tenants) go to different hunters, unless one tenant was prepared with both states.
4. **At most 12 units.** A matrix unit counts as one unit, but its variants are real work; a hunter carrying several `matrix:full` units should carry fewer units overall.
5. **Throttle and login units are separate.** Any unit whose context or surface exercises login, logout, PIN or one-time-code entry, lockout or a rate limit goes to the dedicated `audit-login` tenant and runs in the throttle and login wave, with no other runtime agent active. Throttles keyed by IP are shared by every agent on the loopback address and cannot be reset mid-run.
6. **Dedicated waves.**
   - (a) **Performance wave.** Every unit whose lens is a PERFORMANCE.md class belongs to it. Its hunters run one at a time, each alone, with no other hunter, verifier, consult peer, judge, sweep or fixture agent driving a browser or touching the app (details below).
   - (b) Every verifier of a performance fingerprint (Phase 3, Phase 5, replacement, panel member) also runs alone, under the same condition.
   - (c) The server-zone wave: units that need the server restarted under the business time zone (see `FUNCTIONAL-FLOWS.md#Time, dates and time zones`).
   - (d) The throttle and login wave runs last among the hunting waves (rule 5).
   - (e) In every other wave, browser-driving agents at once never exceed `metadata.sandbox.max_parallel_browsers`, and all agents at once never exceed `orchestration.max_parallel_agents` (default 4, never above the host's 20).
   - **Order:** ordinary waves, server-zone wave, performance wave (escalated performance units take sequential slots appended to its end), throttle and login wave, escalation wave (no critic of its own; see "Self-assessment and escalation"), then `cfinal`.
   - Before the performance wave the parent records `sandbox.host_facts.free_memory_at_perf_wave` and `sandbox.host_facts.cpu_benchmark_ms` (below).
7. **The visual sweep.** When config `visual_regression.enabled` is true, the sweep runs in wave 1. With an approved comparable baseline (the baseline lookup is part of Phase 1, see RECONNAISSANCE.md), its changed items seed units. With an unapproved one, they are leads in COVERAGE.md "Visual changes since baseline". With none, the sweep only produces the captures for the Phase 6 promote offer, and the gap is recorded as `visual_baseline_unavailable`. The parent runs the probe itself with `tools/visual-sweep.json` (a parent-run script, not an agent invocation), unless a swept route needs a login or a fixture step; only then does one `screenshot_sweep` agent, `w1-sweep` (routed to `haiku`), run it and return its probe out directory as artifacts. Either way the sweep counts as browser-driving against the wave's `max_parallel_browsers`. When a comparable baseline exists, the parent then runs `scripts/ui-diff.mjs` into `<out>/visual/`; for an approved baseline, every `changed` item seeds or re-prioritises a `hunt_judgement` unit with lens `VISUAL-AND-THEMING.md#Unintended visual change`, expectation `baseline:<id>#<key>` and `prior_status: "new"`, queued for the next ordinary wave. Changes against an unapproved baseline seed nothing; they are listed in COVERAGE.md "Visual changes since baseline" as leads.

Never merge unrelated surfaces to save invocations. A unit the budget cannot reach is `deferred` with a reasons-list code, never silently unassigned.

### Model per hunter

The group's task kind decides the model and effort. The parent never picks a model by hand: it calls

```text
node <skill-dir>/scripts/orchestrate.mjs route --task <task_kind> --lens "<unit lens>" \
  --config <config path> --availability <out>/tools/availability.json
```

and passes the returned alias and effort to the Agent call. `tools/availability.json` is the parent's current view of each alias (`untested`, `available`, `unavailable`, `substituted`, `unknown`), rewritten from `run-metadata.json` `orchestration.models` whenever an observation changes it. With every tier available, the routing table gives hunters:

| Hunter group | task_kind | model | effort | escalation target |
|---|---|---|---|---|
| everything not listed below | hunt_standard | sonnet | medium | opus |
| business rules and figures shown on several screens | hunt_business | opus | high | fable |
| performance root causes | hunt_performance | opus | medium | fable |
| quoted-rule judgement, template look, unintended visual change | hunt_judgement | sonnet | high | opus |
| capture-only visual sweep (only when it needs logins or fixtures) | screenshot_sweep | haiku | low | sonnet |
| coverage critic after a wave | critic_wave | sonnet | high | opus |
| final-clean critic | critic_final | opus | high | fable |

This table is a reading aid; ORCHESTRATION.md §2 and `ROUTING_TABLE` are normative. Haiku never hunts (a routing floor). When a tier is declared or observed unavailable, `route` returns the fallback (ORCHESTRATION.md §6) and the group is priced at that fallback's worst case. In single-model mode (the host forces one model) the parent passes no `model`, still logs the routed tier as `model_requested`, and uses a same-model second opinion instead of escalation.

### Priority order

When the budget or the profile limits how many hunters a wave can hold, take groups in this order:

1. The public, unauthenticated or primary entry. Example (Brasero): the QR menu at `/mesa/[slug]` and its checkout.
2. Units about money, stock and records figures, and every `hunt_business` group.
3. Core tasks per persona, as listed in `architecture.md`.
4. Prior gaps, revalidations (`prior_confirmed_same_source`, `prior_needs_validation`, changed source).
5. Breadth lenses: everything else.
6. Ties break by `coverage_id`, compared as plain JS strings, so two runs with the same ledger assign identically.

Record the ordering decision in `run-metadata.json` `coverage_note` when it deferred anything.

### Before launch

For every hunter in the wave, the parent:

1. picks a safe agent ID `h<N>-<slug>` (lowercase, matching `^[a-z0-9][a-z0-9_-]{0,63}$`, never a Windows device name), routes the group (task kind, model, effort) with `orchestrate.mjs route`, checks `spent + 1 <= cap`, and appends the invocation to `agent-log.json` before the call (`kind: "launch"`, `role: "general"`, `phase: "2"`, the wave number, `purpose: "primary"`, `model_requested`, `model_passed`, `effort_requested`; ORCHESTRATION.md §8). The call itself follows ORCHESTRATION.md §9 (general-purpose subagent, `name` = the agent ID unless agent teams are active);
2. sets each assigned unit to `in_progress` with that `agent_id`, leaving its evidence fields empty, and revalidates the ledger;
3. creates `agents/<agent-id>/` with `scratch/in/`, `scratch/out/` and the parent-owned `artifacts/`;
4. assigns a tenant and records it in `fixtures/tenants.json` (`agent_id` of the tenant row) and in the unit's `tenant` bookkeeping field;
5. writes `prompt.md` with the contract below;
6. re-reserves the wave's critic, `cfinal` (until a clean one ran), the validation reserve and the orchestration reserve, as "Budget inside Phase 2" describes. If they do not fit, it shrinks the wave or defers its units.

Hunters run in parallel within a wave, inside the concurrency limits of rule 6. Their results come back through the delegation tool; in an interactive session the calls run in the background and the parent waits for each notification. A hunter never writes a shared file, the target repository, another agent's directory, or its own `artifacts/`, and never starts another agent.

## Required hunter prompt

Every hunter prompt has these nine parts, in this order. Copy blocks verbatim; never send a block name in place of its text.

1. **Role preamble**, three sentences: "Your job is to find reproducible, user-observable deviations from stated expectations in the coverage units assigned below. For every unit and every candidate, state honestly how settled it is, using the self-assessment scale at the end of this prompt; a candid low or unsure rating is useful, a confident guess is not. Reply with a single JSON object shaped as described in the result contract below, and nothing else."
2. **`architecture.md`**, verbatim.
3. **The assignment.**
   - Each coverage ID with its five `canonical_refs`.
   - For a `matrix:` unit, the concrete (vp, theme) pairs to run, resolved from `metadata.matrices`, with each viewport's width, height, dpr, mobile and touch.
   - Each unit's `starting_paths`, `ordinary_lens_block`, `selected_companion_blocks` and `excluded_blocks`.
   - The tenant ID, slug and data state.
   - The session paths (`fixtures/sessions/<tenant_id>/<role>.json`) and account keys. Never the passwords.
   - The base URL and the build mode.
   - For an `Unintended visual change` unit: the baseline id, the capture key, the diff summary entry, `manifest.source_commit` and the current commit.
4. **The selected blocks, verbatim.** The ordinary lens text from [LENSES.md](LENSES.md). For each selected companion: its `Core discipline`, the chosen class paragraphs, `Universal moves` and `Validation rules`. Then every project-rules.md row the units cite, with its quote, source, check method, pass criterion and `confirmed_by_owner`. When a unit cites `RULE:<id>`, the matching row of the [SOURCES.md](SOURCES.md) rule index.
5. **Excluded blocks**, each with the reason recorded in the ledger.
6. The fenced **Core hunting method**, then the fenced **Evidence handling** block, both below.
7. The fenced **Candidate gate**, below.
8. **Exclusions and etiquette.**
   - Carried same-source exclusions: fingerprint, title and root cause only. No steps, no artifacts, no prior reasoning.
   - Coverage IDs owned by peers in this wave. The hunter must not work on them.
   - The shared-state etiquette section below, verbatim.
   - The non-mutating contract, verbatim, when the assigned role is `research`.
9. **Paths and contracts.**
   - Absolute paths of `scratch/`, `scratch/in/`, `scratch/out/`, and the artifacts prefix `agents/<agent-id>/artifacts/`.
   - The agent's own ID.
   - The probe command, filled in, plus one example config written for the first unit (see "Probe usage" below). When `tools/project-detect.json` names an axe-core file, the command carries `--axe <that absolute path>`.
   - The `count_command` grant, if the parent gives one for this tenant: the exact command line from "Row counts" below, filled in with this tenant's slug and the allowed table keys.
   - Artifact limits: 15 MiB per file, 300 MiB per agent; allowed extensions `.png .jpg .jpeg .webp .json .txt .log .html .har .zip`; never-promote list: anything under a `storage` or `profile` segment, any config with an inline credential, any `.har` carrying `cookie`, `set-cookie` or `authorization` values.
   - `report_language` (for example `es`), and the rule that fingerprints and every JSON key, enum value and ID stay ASCII English.
   - The **Self-assessment** block from ORCHESTRATION.md §3, verbatim, and the duty to fill `self_assessment` in every `units[]` and `candidates[]` entry and `model_self_report` at the top level (the model id or name the agent believes it runs on, or null).
   - The fenced **Consults** block, below.
   - The structured hunter result contract, below.
   - The three verdict branches of `report-schema.json` (confirmed, needs_validation, rejected), pasted unchanged. Hunters propose only the first two; the third is there so they recognise what verifiers will do with weak claims.

A hunter that meets a surface or context with no unit returns it under `uncovered`. It does not quietly widen its own scope.

#### Core hunting method — part of every hunter prompt

```text
## How to hunt

You are looking for failures a real user would notice, measured against an
expectation someone wrote down. Work on a disposable local copy of the app only.
Never open a deployed site, a production URL, a third-party service, or an
outbound link (messaging deep links, payment pages, tel:, mailto:). Use only
the dummy accounts and saved sessions given to you, inside your own tenant.

SOURCE FIRST, THEN THE BROWSER. Read the route, the components it renders, the
server code that feeds them, and the rule the unit cites before opening a page.
Know which states the code can produce (loading, empty, error, forbidden,
closed, stale) and which ones it never designed. Then reproduce in the exact
context of the unit. For a matrix unit, run every (vp, theme) pair you were
given; if you cannot, list each missing pair in `unresolved` as
`variant not run: vp=<id>;theme=<t>`.

FRAME EVERY CLAIM IN SIX PARTS:
1. Persona and role: who is using the screen, logged in how.
2. Context: viewport, theme, input, network, data state, session, clock.
3. Steps: the smallest sequence that reaches the state.
4. Expectation source: the exact rule, standard, budget or canonical sibling,
   quoted or referenced by its ref.
5. Observation: what the screen, the data or the measurement actually showed,
   with a captured artifact.
6. Smallest fix in source, plus the regression check that would catch it.
Stop working on a claim as soon as the expectation is settled either way, and
record the outcome as a check.

GO DOWN THE SAD PATHS the interface actually allows:
- lists: empty, one item, many, huge;
- text: long and unbroken strings, accents and other non-ASCII letters, emoji,
  right-to-left text where the app supports it, HTML-looking input;
- numbers: zero, negative, maximum, over maximum, decimals where integers are
  expected, pasted thousands separators;
- search and filters: no results, special characters, filters plus pagination;
- uploads: oversized and wrong-type local dummy files;
- requests: slow, failed, offline and flaky in the middle of a flow
  (probe steps setNetwork offline|flaky|slow3g);
- repeated input: double click and Enter twice on create, pay and confirm, then
  count the resulting rows and movements;
- navigation: back, forward and refresh in the middle of a flow (probe steps
  back and forward);
- session: expired (probe step clearCookies), two tabs (newTab), two users of
  the same tenant at once;
- device: rotation, every assigned width, reduced motion, forced colors,
  hover none, 200 % and 400 % zoom, keyboard only (focusWalk), the AX tree;
- time: a client clock at the boundary (clock.now), a far-away time zone in
  the browser, server boundaries through the seeded records;
- long sessions: on screens meant to stay open all day, at least 10 poll
  cycles with heap sampling.

WAIT ON CONDITIONS, NOT TIME. Never treat a fixed sleep as "the page is
ready", and never treat "the network went quiet" as ready either. Poll for a
visible condition (an element in the right state, a URL, a text, fonts
loaded) with an explicit deadline, and act only on a control that is visible,
stable, enabled and not covered. A click that only works when forced means
something covers or moves the control: that is evidence, not an obstacle.
Start each flow from a fresh browser context, so no flow depends on another.

CAPTURE CLEANLY. Wait out or freeze polling and animation before a visual
capture, freeze or mask clock-driven content, and keep the probe's stable
screenshots on. Use the viewport-only screenshot, not the full-page one, for
anything about fixed bars, sticky headers or dvh/svh heights. Keep the
console, failed-request and blocked-request lists of every capture. Compare
two captures only when their recorded environment (envKey) is the same.

INTERMITTENT RESULTS. When a step fails only sometimes, rerun the unit alone
in a fresh context three times. Two or three failures out of three is
reproducible. Otherwise classify the failure as one of product-race,
probe-wait, order-dependency, data-dependency, environment, external, time or
unknown, and write the class and the rerun count into that check's result.
Only a product-race (the app itself moves, covers or double-applies something)
or a reproducible failure may become a candidate; every other class is a
probe-reliability note, never dropped silently.

MEASURE AGAINST A THRESHOLD. Each number you report carries its threshold and
its passing condition (pass_if), the number of runs and the aggregation.
Performance needs a production build, a warm-up request, the cold runs your
profile sets (three in quick, five in standard and deep) with the cache
disabled, the median (worst run for CLS and INP), and the topology. A lab
number is a lab number: never call it a field or Core Web Vitals result. A
number with no threshold and no user consequence is not a finding.

FOLLOW STRONG ROOT CAUSES SIDEWAYS. When a high or blocker candidate comes from
a shared component, rule or helper, look for the same cause on the other
surfaces and contexts you own. Report it once, with the other places in
also_affects. Do not open peer-owned units; return a new place with no unit
under `uncovered`.

KNOW WHAT YOU CANNOT SEE LOCALLY. Firefox, WebKit, iOS Safari, a real device,
the real on-screen keyboard, real screen-reader speech, real network or
production data volumes, the real server clock crossing a boundary, deployment
headers and third-party unfurls are out of local reach. If one of them decides
the claim, propose needs_validation with the exact blocker and a plan.

ASK, DON'T GUESS. When the decisive question of a unit or candidate belongs to
another lens (for example a contrast question inside a flow unit, or a
business rule inside a layout unit), raise a consult as the Consults block
describes instead of guessing. Still give your best current disposition.

RATE YOURSELF HONESTLY. Fill self_assessment for every unit and candidate. Say
low or unsure when you are; set needs_stronger_model when deeper reasoning,
not more data, would settle it. The parent re-runs such work on a stronger
model; it never penalises an honest rating.

NEVER: edit the target source, add a dependency to it, run seed or reset, log
in through the form, press logout, change global or business settings, open
any environment file (.env, .env.*, .env-*, .env_*, .envrc, *.env,
.dev.vars), start another agent, or continue past the smallest interaction
that shows the deviation.
```

The method's waiting, isolation and intermittency rules follow established end-to-end practice: no fixed sleeps or network-idle readiness, polled conditions with a deadline, actionability before a click, user-facing locators, URL predicates after navigation, one fresh context per flow [rule: E2E-01, E2E-02, E2E-03, E2E-04, E2E-05, E2E-06, E2E-07]; a pinned rendering environment and a frozen or masked clock for captures [rule: E2E-09, E2E-10]; the dominant causes of flaky UI checks, the definition of flaky and the three-rerun classification [rule: E2E-14, E2E-15, E2E-16]. The three reruns and the class list are thresholds this skill chose (SOURCES.md §5). Rich traces are kept only for failing or flaky units and stay local [rule: E2E-17].

#### Evidence handling — include in every hunter prompt

```text
## Evidence handling (for reference — the parent performs these steps)

You write files only under scratch/out/. You never copy anything into
artifacts/ yourself. To keep a file as evidence, list it in your result's
`artifacts` array with:
  path        scratch-relative, starting with out/ (for example
              out/run-1/captures/m390.light.png, never run-1/... or an
              absolute path); any other path is refused and its evidence lost
  promote_to  the relative path it should get under your artifacts/ directory
  bytes       its size
  purpose     one line on what it proves

Cite it everywhere (checks, execution.artifacts) by its future owned path:
  agents/<your-agent-id>/artifacts/<promote_to>

After you return, the parent:
1. Accepts only safe relative paths: not absolute, no empty, "." or ".."
   segment, no backslash, no colon.
2. Accepts only .png .jpg .jpeg .webp .json .txt .log .html .har .zip.
3. Refuses anything with a storage or profile path segment, any probe config
   that holds an inline credential, and any .har whose headers carry cookie,
   set-cookie or authorization values.
4. Requires a regular file, not a symlink, with link count 1, at most 15 MiB,
   and at most 300 MiB for all of your files together.
5. Opens it without following links where the OS allows; on Windows it checks
   lstat, opens, then fstat and compares identity. It checks size and mtime
   before and after copying and drops the file on any change.
6. Copies it to agents/<your-agent-id>/artifacts/<promote_to>, creating
   directories and the file exclusively. It never overwrites.
7. Never globs, never walks your scratch, never extracts an archive.
8. Drops a file that fails any step. If it was decisive, your unit becomes
   blocked or your record becomes needs_validation, naming the blocker.
9. Rejects every cited path it did not actually promote.

So: declare every file you cite, cite only files you declare, keep sessions
and secrets out of everything you declare.
```

#### Candidate gate — include in every hunter prompt

```text
## Candidate gate

1. A candidate has a complete trace (entrypoint ... sink, as file:line) and
   evidence, and names its expectation source exactly: the PR- row, the
   repository file and heading, WCAG22#<sc>, RULE:<rule-id>, the budget
   block, the sibling: path, or baseline:<id>#<key>.
2. Propose confirmed only after reproducing it yourself, in the stated
   context, with at least one cited owned artifact and an observed result that
   contradicts the expectation.
3. Do not make the effect worse, or the reach wider, than what you reproduced.
   One viewport is not "all phones"; one theme is not "both themes".
4. If a decisive fact is outside local reach (engine, device, real clock, real
   network, real screen reader), propose needs_validation with exact blockers
   and a plan, and no severity.
5. Taste, an undocumented "best practice", a score with no user consequence, a
   decision the repository documents as intentional, or a rule row with no
   concrete pass criterion is not a finding. Put it in `improvements`. A claim
   the source disproves is dropped, not sent as needs_validation.
6. A sibling_screen expectation needs the canonical sibling (documented, or
   built on the shared primitive) and a named user consequence; it stays at low
   unless a figure or a task outcome differs. A judgement-against-quote rule
   needs its row's pass criterion and stays at low or polish unless that
   criterion is measurable.
7. One fingerprint per root cause, ASCII, shaped
   <domain>/<lens-slug>/<surface-slug>/<defect-slug>, with no line number,
   wave, agent, severity or verdict, kept identical in every state.
8. If nothing survives, return an empty `candidates` array.
9. Advisory guidance is an improvement, not a finding: platform touch sizes
   (44 pt, 48 dp, 1 cm), WCAG AAA criteria, and usability heuristics without a
   measured user consequence. It becomes a finding only when a confirmed PR-
   row adopts it.
10. An unapproved visual baseline never backs a candidate. A change against an
   approved baseline needs a comparable environment, no intended source change
   that explains it, and a user consequence of its own.
11. An intermittent failure becomes a candidate only when it reproduced in two
   of three fresh reruns or was classified product-race.
```

Items 9 and 10 apply the standing of the standards in SOURCES.md §4: AAA criteria and platform guidance are advisory [rule: WCAG-02, TOUCH-03, TOUCH-04, TOUCH-06, TOUCH-07]; a visual difference with no consequence is not a defect.

#### Consults — include in every hunter prompt

```text
## Consults

You may ask for a second opinion from another lens, at most twice per result,
in the top-level `consults` array (empty array when you ask nothing):

{"about": {"kind": "unit|candidate", "ref": "<coverage_id or fingerprint>"},
 "question": "<one precise question, report_language, at most 1000 chars>",
 "my_position": "<what you believe now and why, at most 1500 chars>",
 "evidence": ["agents/<your-id>/artifacts/<file>", "src/path/file.tsx:42"],
 "lens_needed": "<a companion file such as ACCESSIBILITY.md, or LENSES.md#<Lens>>",
 "blocking": true}

Ask only when:
- the question decides the unit's disposition or the candidate's verdict or
  severity, and
- it belongs to a lens other than your own unit's lens file, and
- you could not settle it yourself with the code and the probe.
Do not ask about taste, about something outside your units, or to get more
time. Evidence entries are artifacts you declared or repository-relative
path:line references. blocking: true means your disposition depends on the
answer. Always return your best current disposition anyway; the parent may
decline a consult for budget, and then your disposition stands as written.
The parent may later resume you with the peer's answer; reply then in the
requester-reply shape it gives you, never with new consults.
```

## Shared-state etiquette

Include this text verbatim in part 8 of every hunter prompt:

```text
## Shared state

- Stay in your tenant. Use only your tenant's slug, sessions and account keys.
  Never open another tenant's pages, even read-only.
- Never touch anything global: business-wide switches, people, PINs, roles,
  opening hours, prices or categories, unless your unit is about exactly that
  and the tenant is yours.
- Never run seed, reset, migrations or any database command other than the
  count command you were given.
- Never submit the login form and never press logout, unless your unit tests
  that and you are in the dedicated login tenant. Use the saved session state.
  To simulate expiry, use the probe step clearCookies.
- Do not reuse a session file across tenants and do not write a new one;
  saveStorage is for the parent's fixtures agent only.
- Record every data change you make (orders sent, shifts opened, stock moved)
  in `fixture_effects`, so later agents know the tenant's state.
- Respect throttles. If you hit a rate limit, stop, record it as a check, and
  mark the unit blocked with throttle_shared; never wait it out in a loop.
```

Example (Brasero): only one shift can be open per restaurant, so a hunter that closes the shift in `audit-h3` must say so in `fixture_effects`, and no other agent uses `audit-h3`.

## Probe usage

The prompt gives the hunter a filled-in command. It always writes into a fresh subdirectory of the hunter's own `scratch/out/`:

```text
node <skill-dir>/scripts/ui-probe.mjs \
  --config <scratch>/in/menu-core.json \
  --out <scratch>/out/menu-core-1 \
  --accounts <out>/fixtures/accounts.json \
  --sessions <out>/fixtures/sessions \
  --driver <browser.driver of run-metadata.json: cdp or playwright-core> \
  --axe <absolute path from tools/project-detect.json, only when present>
```

The driver is the one recorded in `browser.driver` at setup, passed explicitly so every agent of the run measures with the same one (the probe's own default, `auto`, takes the skill's `playwright-core` whenever it is installed).

Rules for hunters:

- Run `--plan` first on every new config and fix any error it reports.
- Refer to sessions as `{"session": "<tenant_id>/<role>"}` and to credentials as `valueFrom: "account:<account_key>.<field>"`. A config with an inline `password`, `token` or `cookie` is refused by the probe and must never be declared as an artifact.
- One `--out` directory per run. The probe refuses a directory that already holds `summary.json`.
- Use `--only`, `--viewport` and `--theme` to rerun a single variant, rather than editing a config that earlier evidence cites. A rerun for the intermittency rule uses a new `--out` each time.
- The view and full screenshots and every enabled check are taken after the route's last step, on the state the steps left. `measuredState.changes` (and the summary flag `measuredStateChanged`) lists how that state differs from the declared context: `url`, `media.*`, `network`, `viewport`, `cookies`, `interaction`. Cite end-of-capture measurements as evidence for the declared context only when that list is empty or the difference is the point of the check; otherwise put context-changing steps (`emulateMedia`, `setNetwork`, `rotate`, `clearCookies`, `goto`, `back`, `forward`) in a route of their own and read them from step screenshots.
- **Stable screenshots.** `stableShots` (on by default: up to 3 attempts, 150 ms apart) retakes the viewport screenshot until two consecutive captures match. `screenshots.viewStable: false` means the screen kept moving; a visual claim from that capture needs a rerun with the moving part frozen or masked, or it stays a lead (and the movement itself may be a product-race).
- **Masks.** `routes[].mask` lists up to 20 selectors for regions that change legitimately (clocks, live counters, rotating content). Masks paint over the screenshots only and never affect checks. Each capture records `masks[].areaPct`; a mask over 30 % of the viewport (a threshold this skill chose) leaves too little to compare, so say so in the check.
- **Environment.** Every capture carries an `env` block and an `envKey`. Two captures, or a capture and a baseline item, are comparable only when their `envKey` values are equal [rule: E2E-09]; otherwise the result is "not comparable", never a regression.
- **axe-core.** With `checks.axe: true` and a valid `--axe`, the capture lists axe `violations` and `incomplete` per rule. A violation is a lead to explain in the user's terms; an `incomplete` entry is a manual check you still owe, never a pass and never a finding by itself [rule: TOOLS-01]. Without a valid `--axe`, the capture says `axe.available: false`: record it as a coverage gap in the check, not as an error.
- **Back and forward.** Use the `back` and `forward` steps for history navigation, not keyboard shortcuts. Each records whether the page came from the back/forward cache (`persisted`) and, when the browser reports them, `notRestoredReasons`.
- **Experimental emulation.** `emulation.safeAreaInsets`, `emulation.smallViewportHeightDifference` and `emulation.virtualKeyboardHeight` let Chromium show notch, collapsing-toolbar and on-screen-keyboard layouts. The capture records each as `applied`, `off` or `unsupported`; an `unsupported` key means this browser could not show that defect, which is a blocker, never a pass.
- **Host benchmark.** With `checks.vitals` and `repeat > 1`, the probe runs a short fixed CPU loop first and records `summary.hostBenchmark`. Quote its median with every performance number.
- The probe records facts. The hunter decides what they mean. A non-empty `overflow.offenders`, `contrast.failures`, `tapTargets.under24` or `axe.violations` is a lead to explain, not a finding.
- `evaluate` steps are read-only. A capture that depends on an expression that changed state is not evidence. The probe records the expression and whether it threw, never the value it returned, so write it as an assertion (`if (...) throw new Error("...")`). It refuses (exit 2) an expression that touches `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB` or `cookieStore`.
- Every config declares `target`. The probe uses it to tell the disposable app from one the owner happens to run on the same loopback port:
  - `"disposable"`: the sandboxed build of the run. The config also carries a `readyMarker` (`{"path", "selector", "text"}`) that only the disposable environment shows, or the command carries `--expect-header <name>=<value>` for a header the parent's loopback forwarder (or `scripts/static-serve.mjs --header`) adds. The probe checks it before the first capture: the header with one GET before the browser starts, the marker in a fresh GET-only context. If the proof is missing or does not match, it stops with exit 2 and runs no step. Example (Brasero): the fixtures create a restaurant named `Audit Ready` (slug `audit-ready`) that exists only in the disposable database, and the marker is `{"path": "/mesa/audit-ready", "selector": "h1", "text": "Audit Ready"}`.
  - `"running-app-get-only"`: guidance mode (b) only, with the owner's OK for that check. The probe refuses (exit 2) any route with `steps` (including `back` and `forward`), `storageState` or `saveStorage`, and sends no warm-up request.
- `locale` sets ICU formatting, `navigator.language` and the `Accept-Language` header together, so server-rendered and client-rendered formatting can be compared under the same locale.
- Blocked traffic in `blockedRequests` includes WebSockets opened towards a non-loopback host (`errorText: "websocket-non-loopback"`). A dependency on an external socket may itself be a finding.
- Exit code 4 means partial. Read `summary.json`, keep what completed, and rerun or report the rest as unresolved.

**Row counts.** Double-submit and money checks judge outcomes, so they need a row count. The `count_command` is the only way an agent gets one; no agent ever runs a database client, an ORM command or a migration tool.

What the parent builds, once, before the first wave, for the target's own database engine (recorded as `app.database.count_command` in `run-metadata.json`, see [RUN-METADATA.md](RUN-METADATA.md)):

- A read-only count tool under `<out>/tools/` (the parent-only reference copy) with a runnable copy next to the disposable build, owned by an account the audit user cannot write as.
- It takes exactly two arguments, `<tenant_slug> <table_key>`, and refuses anything else (wrong argument count, a slug outside `^[a-z0-9][a-z0-9-]{0,62}$`, a `table_key` not in its allowlist). The allowlist maps each key to one fixed table or collection name inside the tool; the key is never interpolated into a query.
- It runs one parameterised count scoped to the tenant, with the slug bound as a parameter, never concatenated. A table whose rows reach the tenant only through a parent row gets a fixed join in the tool, written the same way.
- It connects to the disposable database only, as a dedicated role or user with read access and nothing else: no write, no schema change, no ownership. The connection settings live in the tool, never in a prompt, and never come from an environment file.
- It prints one integer and nothing else, and exits non-zero on any error.

Example (Brasero):
```bash
# PostgreSQL inside WSL2. Tool: /opt/audit/runs/<run>/tools/db-count.sh, owned by root.
# Statement: SELECT count(*) FROM <fixed table> WHERE restaurante_id = (SELECT id FROM restaurante WHERE slug = $1)
# Role: a login role holding pg_read_all_data and no other grant. Allowed keys: pedidos, pedido_items,
# movimientos_inventario, movimientos_caja, cuentas, reservas.
# Called from Windows Git Bash (MSYS_NO_PATHCONV=1 stops the shell rewriting the Linux path):
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu-24.04 -u audit -- /opt/audit/runs/run-1/tools/db-count.sh audit-h3 pedidos > <scratch>/out/count-before.txt
```

The grant is part 9 of the prompt: the parent writes the exact command line, filled in with the agent's own tenant slug and the table keys its units need, and the agent uses no other slug or key. The hunter runs it before and after the interaction, saves both outputs under `scratch/out/` (`count-before.txt`, `count-after.txt`, one pair per table key), and records a `test` check whose `variant` gives the concrete context and whose artifact is the promoted after-count. If it is not granted, the hunter settles the count from the UI where a canonical list shows it (for example a movements list). Otherwise it marks the unit `blocked` and names the missing count.

## Structured hunter result

Your reply is one JSON object and nothing more. It has nine top-level keys:

```json
{
  "units": [{"coverage_id": "…", "disposition": "covered|candidate|blocked", "reviewed_paths": [], "checks": [], "candidate_fingerprints": [], "unresolved": [],
             "self_assessment": {"level": "high|medium|low|unsure", "reason": "…", "needs_stronger_model": false}}],
  "candidates": [{"proposed_verdict": "confirmed|needs_validation",
                  "self_assessment": {"level": "high|medium|low|unsure", "reason": "…", "needs_stronger_model": false},
                  "...": "every field of that schema branch except 'verdict'"}],
  "artifacts": [{"path": "out/…", "promote_to": "probe/summary.json", "bytes": 1234, "purpose": "…"}],
  "improvements": ["concrete non-finding note"],
  "positive_patterns": ["…"],
  "uncovered": [{"canonical_refs": {"surface": "", "expectation": "", "domain": "", "lens": "", "context": ""}, "surface": "", "expectation": "", "domain": "", "lens": "", "context": "", "starting_paths": [], "selected_companion_blocks": [], "excluded_blocks": [{"block": "", "reason": ""}], "reason": ""}],
  "fixture_effects": ["data mutated in my tenant"],
  "consults": [],
  "model_self_report": "the model id or name you believe you run on, or null"
}
```

**Units.**

- Every assigned coverage ID appears exactly once. No other ID appears.
- `covered`: nonempty `reviewed_paths` and `checks`, empty `unresolved`, empty `candidate_fingerprints`. A covered matrix unit has `browser` checks whose variants together cover every (vp, theme) pair.
- `candidate`: nonempty `reviewed_paths` and `checks`, and at least one fingerprint that also appears in `candidates`. It is the only disposition with fingerprints. A missing matrix pair is listed in `unresolved` as `variant not run: vp=<id>;theme=<t>`.
- `blocked`: nonempty `reviewed_paths`, `checks` and `unresolved`, and no fingerprint. Use it when the work was started but a fact could not be settled: a missing variant, a throttle, a failed promotion, a runtime that went away. Start an `unresolved` entry with a reasons-list code where one fits, for example `throttle_shared: login lockout reached after 5 attempts`.
- `reviewed_paths` equals the union of the checks' `reviewed_paths`, exactly.
- `self_assessment` is required on every entry. `level` is one of `high`, `medium`, `low`, `unsure`, with the meanings of the Self-assessment block; `reason` is visible text in `report_language`; `needs_stronger_model` is a boolean.

**Checks.** Each check has exactly these seven keys:

| Key | Rule |
|---|---|
| `agent_id` | The hunter's own ID. |
| `reviewed_paths` | Nonempty, unique, safe repository-relative paths. |
| `expectation` | What was checked, trimmed, at most 4096 characters, in `report_language`. |
| `method` | `source`, `browser`, `test` or `scan`. |
| `variant` | `null` for `source` and `scan`. For `browser` and `test`, a canonical kvlist fragment (keys in the order role, vp, theme, input, net, data, session, motion, zoom, tz, locale, browser; no `matrix:`) that does not contradict the unit context. For a matrix unit it contains `vp` and `theme`. |
| `result` | What the check established, trimmed, at most 4096 characters, in `report_language`. For an intermittent result it names the class and the rerun count (for example "intermittent, probe-wait, 1 of 3 reruns failed"). |
| `artifact` | `null` for `source`. For `browser`, `test` and `scan`, one owned path `agents/<agent_id>/artifacts/<rest>` with an allowed extension, declared in `artifacts`. |

A check for the unit `matrix:core;role=customer;data=typical` on the public menu, in a run whose `report_language` is `es`. Example (Brasero):
```json
{"agent_id": "h1-menu", "reviewed_paths": ["src/components/menu/MenuOrdering.tsx"],
 "expectation": "Sin desplazamiento horizontal de página a 320 px (PR-04, CLAUDE.md#Interfaz).",
 "method": "browser", "variant": "vp=m320;theme=dark",
 "result": "scrollWidth 352 > clientWidth 320; el desbordamiento viene de la fila de precios.",
 "artifact": "agents/h1-menu/artifacts/menu/m320.dark.view.png"}
```

Prose fields are in `report_language`; keys, enums, IDs and paths are ASCII.

**Candidates.** Each entry is a schema-shaped record with `proposed_verdict` instead of `verdict`, plus `self_assessment`.

- `proposed_verdict: "confirmed"`: every field the `confirmed` branch requires, other than `verdict`. `execution.method` is the method actually used. `execution.topology` and `build_mode` are the ones in force. `execution.artifacts` lists owned paths declared in `artifacts`. Each measurement's own threshold must fail under its `pass_if`. Severity follows the impact × reach rule and the caps in [VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md).
- `proposed_verdict: "needs_validation"`: every field that branch requires, other than `verdict`. Nonempty `blockers` and a `validation_plan` with at least one of `local`, `device`, `owner`. No severity, execution, remediation or confidence.
- One record per root cause. Other screens or contexts with the same cause go into `also_affects`.

**Artifacts.** Every cited owned path has exactly one entry here. `path` starts with `out/`. `promote_to` is a safe relative path that is unique within the agent.

**Improvements and positive patterns** feed the end of FINDINGS-DETAIL.md and never become findings. Probe-reliability notes (intermittent classes other than product-race) go into `improvements`, prefixed `probe reliability:`, so the report can list them.

**Uncovered.** A complete unit proposal with full `canonical_refs`, built under the same rules as a seeded unit, plus a reason. The parent derives the ID; the hunter never writes one.

**Consults.** At most two entries, each with exactly the six keys of the Consults block; `about.kind` is `unit` or `candidate` and `about.ref` names one of this hunter's units or fingerprints; `lens_needed` differs from the unit's own lens file.

**`model_self_report`.** A string naming the model the agent believes it runs on, or null. It is evidence, not proof.

## Parent consolidation and ledger update

The parent processes each result on its own, as soon as it arrives.

1. **Complete the log, parse and shape.** Complete the invocation in `agent-log.json` (`outcome`, `failure_class`, `model_self_report`, `model_observed`, `finished_at`). A call that failed or was refused goes through `orchestrate.mjs classify` and follows ORCHESTRATION.md §6 (retry, ladder, pause). A result must be exactly one JSON object with the nine top-level keys. A result that does not parse, misses or duplicates an assigned ID, or carries more than two consults or a malformed consult, is malformed: its units go back to `planned` with `agent_id: null` and empty evidence, and the parent records why in bookkeeping. The second malformed result for the same unit under the same task kind is the `malformed_twice` escalation trigger. **Substitution:** when the family named in `model_self_report` is below the requested tier, the result is kept only as a lead: its units go back to `planned` for re-routing and the requested alias is treated as unavailable (ORCHESTRATION.md §6). A higher or equal family is accepted and logged as observed.
2. **Reject per unit** any of:
   - an unknown or peer-owned coverage ID;
   - an unsafe agent ID in a check, or one that is not the hunter's;
   - a `source` check with an artifact, or a `browser`/`test`/`scan` check without one;
   - a variant outside the unit's context, or a matrix variant without `vp` and `theme`;
   - a disposition that breaks the state table;
   - a missing or malformed `self_assessment`;
   - a cited artifact path the parent did not promote.

   A rejected unit goes back to `planned`. The rest of the result still counts.
3. **Apply self-assessment.** Every unit whose `self_assessment` triggers (`level` low or unsure, or `needs_stronger_model: true`) goes to escalation, as "Self-assessment and escalation" below describes. The candidates that only such units reference are held until the escalation closes. A candidate's own `self_assessment` never triggers an escalation by itself (Phase 3 is its independent check).
4. **Promote** the declared artifacts with `node <skill-dir>/scripts/promote.mjs --run-dir <out> --agent <id>`, which applies the Evidence handling steps file by file and reports every dropped file with its reason. Do this before accepting any check that cites them; a check that cites a dropped file is rejected under step 2.
5. **Validate candidates.** For each candidate, map `proposed_verdict` to `verdict`, remove `proposed_verdict` and `self_assessment` (kept in bookkeeping, never shown to verifiers), and run `validateFindings([record], schema, {ruleIds})` with the current `report-schema.json` and the rule ids of SOURCES.md. Check that the expectation `ref` exists (a `PR-` row that is in project-rules.md and, for `owner_preference`, confirmed by the owner; a `RULE:` id in the rule index; a `baseline:` ref only with an approved baseline). A candidate that fails is not repaired by the parent. It goes into the unit's `improvements` with the reason, or the unit is re-queued if the defect looks real but the record is unusable.
6. **Write the ledger.** For each accepted unit that is not held (by an escalation or a blocking consult): set `status` from the disposition, copy `reviewed_paths`, `checks`, `result_fingerprints` (from `candidate_fingerprints`) and `unresolved`. Store `improvements`, `positive_patterns`, `fixture_effects` and the unit's `self_assessment` in bookkeeping fields. The owner stays the hunter.
7. **Deduplicate candidates** across all hunters of the wave: first by fingerprint, then by root cause. Keep one record per root cause, with the strongest reproduction in the main fields and the others in `also_affects`. Point every affected unit's `result_fingerprints` at the kept fingerprint.
8. **Queue consults.** Each entry of `consults` becomes a dialogue candidate under ORCHESTRATION.md §4. It opens only when the orchestration reserve holds its whole worst case, earmarked before the peer starts; otherwise it is recorded `cancelled_budget` and the requester's disposition stands. While a blocking consult is open, the unit stays `in_progress` with the hunter as owner and its candidates are held. A non-blocking consult does not hold the unit; its outcome amends the ledger or the candidate afterwards.
9. **Update `fingerprint-agents.json`**: add the hunter under `hunters` for each fingerprint it proposed or confirmed as a variant. Add consult peers and judges to `consultants` and `judges`, by fingerprint, or under `by_unit.<coverage_id>` when the consult was about a unit; whenever a unit produces a fingerprint, copy that unit's `by_unit` lists onto the fingerprint, so no peer or judge of a unit ever verifies what it produced.
10. **Update `fixtures/tenants.json`** with the hunter's reported effects, and retire a tenant from further mutating work when its state no longer matches what later units need.
11. **Turn `uncovered` into units.** Derive the `coverage_id` from the returned `canonical_refs`, never from labels. Reject proposals outside scope or with malformed refs, and deduplicate against existing units. A collision fails loudly; it is never merged. New units are `planned` with `prior_status: new`, or `out_of_scope` in a scoped run.
12. **Revalidate** with both validators. Nothing else is assigned until they pass:

```text
node <skill-dir>/validate-coverage-ledger.cjs <out>/coverage-ledger.json --metadata <out>/run-metadata.json --run-dir <out>
node <skill-dir>/validate-orchestration.cjs <out>/agent-log.json --kind agent-log --metadata <out>/run-metadata.json --ledger <out>/coverage-ledger.json --fingerprints <out>/fingerprint-agents.json
```

A `consults` key in a result whose contract forbids it (peer, requester reply, judge, panel member, critic) makes that result malformed. Candidates are not reported anywhere yet. They wait for Phase 3.

## Self-assessment and escalation

The rule itself (trigger, targets, limits, records) is ORCHESTRATION.md §3; this is how it lands on hunter units.

- **Trigger.** A unit's `self_assessment.level` is `low` or `unsure`, or `needs_stronger_model` is true, or the same unit came back malformed twice under the same task kind.
- **Target.** The routing table's escalation target for the unit's task kind (`hunt_standard` and `hunt_judgement` to `opus`, `hunt_business` and `hunt_performance` to `fable`), not simply the next tier. When the target is unavailable, the fallback ladder decides (ORCHESTRATION.md §6).
- **Funding.** The escalation is paid from the orchestration reserve, with its whole worst case earmarked before launch (1 for a single call, more when the target resolves to a panel). It is logged as an `escalations[]` entry (`esc-NN`), and every call it makes carries `purpose: "escalation"` (or `panel`) and `parent_ref: "esc-NN"`.
- **Re-run.** The live attempt is archived into `attempts[]` with `reassignment_reason: "escalation esc-NN: <trigger>"`, `wave` increments, and the unit goes back to `planned` as a group of its own, task kind unchanged, model = target. The new hunter is `h<N>e<k>-<slug>` (k = 1, 2 for successive steps). It gets the same prompt as the first hunter plus the first hunter's self-assessment `reason` (the question that stayed open), but never its checks, artifacts or candidates.
- **Where it runs.** Escalated units join the escalation wave, after the throttle and login wave and before `cfinal`, under the ordinary concurrency limits. A unit escalated from the server-zone wave or the throttle and login wave keeps that wave's isolation inside the escalation wave. An escalated performance unit is the exception: it takes a new sequential slot at the end of the performance wave, still alone.
- **Held candidates.** When the escalated hunter returns, its result replaces the first one entirely; candidates held from the first result are discarded (the escalated hunter's own candidates are the ones that count).
- **Panels on hunters.** When a ladder resolves an escalation to a panel (two or three independent hunters on the same units), each panel member gets its own tenant prepared to the same data state. When the fixtures cannot provide that, the panel is not funded.
- **Limits.** At most `escalation.max_steps_per_item` steps per unit (default 2). The top available tier is decided only after the target's ladder has been tried: an opus `panel_2_agree` for an opus hunter without fable is a valid step (ORCHESTRATION.md §3.3 item 1). The unit stops when the limit is reached, when that ladder ends in `none` or in a `single` call not above the hunter's tier, or when the reserve cannot hold the worst case; it then becomes `blocked` with an `unresolved` entry `needs_stronger_model: <what stayed open>` or `escalation_budget_exhausted: <text>`. Its held candidates are not validated; the parent lists them in COVERAGE.md "Agents, models and budget" among the candidates left unvalidated.
- **Single-model mode.** No tier escalation. A triggered unit gets one same-model second opinion (`mode: "second_opinion"`) when the reserve can fund it; the two results must agree on disposition and fingerprints, otherwise the unit is `blocked` with `needs_stronger_model`.

## Consults raised in Phase 2

A consult is a short exchange between the requester and a peer from another lens, judged by a strong model when they still disagree. The protocol (peer and judge contracts, rounds, outcomes, records) is ORCHESTRATION.md §4. In Phase 2:

- The peer is `q<N>-<slug>`, routed `consult_peer` (the requester's tier, at least `sonnet`), under the non-mutating contract with a spare read-only fixture account or data set; the judge is `j<N>-<slug>`, routed `judge`. Neither may appear in any list of `fingerprint-agents.json` for the fingerprint concerned, nor in the `by_unit` lists of the unit concerned.
- The requester is resumed with the peer's answer (or, when resume is unavailable, a fresh agent of its tier gets its result and the dialogue so far). Requester replies use the requester-reply shape and never carry consults.
- A peer that drives a browser counts as browser-driving in the wave it overlaps. A consult raised by a performance hunter runs as its own sequential slot right after the requester's slot (peer, then any requester resume, then the judge), with nothing else driving a browser; it is priced and earmarked like any consult. No consult about a non-performance item runs during the performance wave; such consults wait until the wave ends and must close before `cfinal`.
- Outcomes apply per the outcome table of ORCHESTRATION.md §4: `agreed` and `judged_requester` keep the requester's current disposition; `judged_peer` applies the judge's `effect`; `judged_neither` leaves the unit `blocked` with `dialogue_unresolved: dlg-NN` (a candidate goes to Phase 3 as `needs_validation` citing the dialogue); `cancelled_budget` keeps the original disposition with an unresolved note `consult declined: dlg-NN`.
- Every dialogue opened in Phase 2 closes before `cfinal` launches, so the final critic reads a settled ledger.

## Coverage critics

### Post-wave critic

After each hunter wave except the escalation wave, the parent spends the reserved invocation on a fresh `research` critic `c<W>`, where W is the wave number, routed `critic_wave`. It runs under the non-mutating contract and needs no browser. It receives:

- `architecture.md` and `project-rules.md`;
- the full ledger, including each unit's block maps and bookkeeping;
- the current fingerprints and their states;
- the open and closed escalations and dialogues of the run, one line each;
- the prior-run gap summary from Phase 1;
- the Self-assessment block of ORCHESTRATION.md §3.

It returns exactly this object, which the parent saves as `critic-w<W>.json`:

```json
{"missing_units": [{"canonical_refs": {"surface": "", "expectation": "", "domain": "", "lens": "", "context": ""}, "surface": "", "expectation": "", "domain": "", "lens": "", "context": "", "starting_paths": [], "selected_companion_blocks": [], "excluded_blocks": [{"block": "", "reason": ""}], "reason": ""}], "reassign_ids": [], "resolved_prior_leads": [], "stop": false,
 "self_assessment": {"level": "high|medium|low|unsure", "reason": "", "needs_stronger_model": false}, "model_self_report": null}
```

A critic result never carries `consults`.

The critic looks for:

- routes, screens or states in `architecture.md` with no unit;
- a confirmed project-rules.md row with no unit;
- matrix units that are `covered` or `candidate` while missing variants;
- a gated screen that is not tested for one of the roles that can, or cannot, open it;
- units closed without paths, checks or artifacts that support the result;
- performance units measured on a development build, without a topology, with fewer cold runs than the profile's protocol, or while another runtime agent was active;
- `Unintended visual change` units without an approved baseline or with mismatched environment keys;
- intermittent results promoted to candidates without the three-rerun record;
- exclusions whose reason does not hold;
- prior gaps (`prior_needs_validation`, `prior_deferred`, `prior_blocked`, changed source) that nothing addresses;
- classes from the companion files that recon justified but that no unit uses.

It proposes coverage, never findings. `stop` is its own view: `true` only when it proposes nothing.

### Applying the critic's output

The parent:

1. Applies the critic's `self_assessment` first. A low or unsure critic, or one asking for a stronger model, is escalated before its output is applied: a fresh critic on the routing table's target tier (`opus` for `critic_wave`, `fable` for `critic_final`, or the ladder) gets the same inputs, and its output replaces the low one. An escalated wave critic is `c<W>e<k>`; the low output is kept as `critic-w<W>.low.json` in bookkeeping. An escalated final critic follows the `cfinal` archive procedure below (the low pass is archived, and a fresh `cfinal` runs).
2. Rejects proposals that are out of scope or malformed, and records the rejection.
3. Derives IDs from `canonical_refs`, deduplicates, gives each new unit its task kind, and fails on a collision.
4. Accepts a `reassign_ids` entry only if the unit exists with status `covered`, `candidate` or `blocked`. It archives the live attempt into `attempts[]` with the critic's `reassignment_reason`, increments `wave`, clears the live evidence, and sets the unit back to `planned` for a fresh owner. The new owner must differ from every archived owner. It never sees the archived owner's checks, and it may not reuse their artifact paths.
5. Marks each `resolved_prior_leads` fingerprint resolved, with the critic's reason, in bookkeeping.
6. Revalidates the ledger and the agent log.

### Loop and termination

**standard and deep.** At most `critics.max_post_wave` post-wave critics may add work (default 2 in `standard`, 3 in `deep`; [ORCHESTRATION.md](ORCHESTRATION.md) §5.2). After a post-wave critic:

- If it accepted work, or `planned` units remain, run another wave (subject to budget). That wave gets its own post-wave critic only while the limit has not been reached; once it has, the remaining waves run back to back with no critic between them.
- When the ordinary, dedicated and escalation waves are done, no `planned` units remain and no dialogue is open, use the invocation held back for it on a separate `cfinal` critic, routed `critic_final`, with the same inputs and the same output shape, saved as `critic-final.json`. `cfinal` must not have served as any earlier critic. It runs once.
- What a critic proposes after the limit was reached, and what `cfinal` proposes, is not hunted: each accepted `missing_units` entry enters the ledger as `deferred` with `critic_wave_limit`, and each legitimate `reassign_ids` unit is archived into `attempts[]` and becomes `deferred` with the same code, `agent_id: null` and empty evidence. Those units are the next run's first work.
- Coverage is complete only when `cfinal` is clean. When it is not, or when any unit is `deferred` with `critic_wave_limit`, the run's coverage is partial and the first sentence of REPORT.md section 1 says so, with the number of deferred units. Before the last wave the parent re-reserves `cfinal` (see "Budget inside Phase 2"); if it cannot, that wave does not launch and its units become `deferred` with `critic_budget_exhausted`.

**quick.** One hunting pass, then exactly one final critic. The ordinary wave and any dedicated or escalation wave the pass needs run back to back with no critic between them; the performance and login rules still apply. Every accepted `missing_units` entry enters the ledger as `deferred` with `quick_profile_final_critic`. Each legitimate `reassign_ids` unit is archived into `attempts[]`, its live `wave` is incremented, and its live state becomes `deferred` with the same reason, `agent_id: null` and empty evidence. No second pass runs.

**Every archive increments `wave`.** Whenever the parent moves a live attempt into `attempts[]`, for a reassignment, an escalation, a quick-profile deferral, a pause or an interrupted run, it sets the live `wave` to one more than the archived attempt's wave, whatever the new live status is (`planned` or `deferred`). The ledger validator requires every archived wave to be strictly below the live one.

**Scoped runs.** The critic may still notice gaps outside the scope. The parent logs each such gap as `out_of_scope`, keeps the critic's stated reason, and never schedules it.

**Early stop and pause.** If budget, time or the owner ends hunting early, every unit that has no result becomes `deferred` with a reasons-list code (`agent_cap_reached`, `critic_budget_exhausted`, `budget_cannot_reserve_critics_and_validation`, `user_interrupted`). A usage limit, or every tier needed for the remaining decisive work becoming unavailable, pauses the run instead (ORCHESTRATION.md §7): open dialogues, escalations and panels close as `cancelled_pause`, `in_progress` units go back to `planned`, and the ledger is the resume point. The gap is disclosed in REPORT.md. A wave cap or an agent cap is never evidence that coverage is complete.

## The performance wave

Performance numbers move with whatever else the host is doing, so the wave has its own rules [rule: VITALS-16]:

1. Before it starts, every other agent of Phase 2 has finished; nothing else drives a browser or touches the app.
2. The parent records `sandbox.host_facts.free_memory_at_perf_wave` (measured right then) and runs the probe itself once (a parent-run script, not an agent) with `benchmark: true` on one GET-only route of the disposable app, copying `summary.hostBenchmark.medianMs` into `sandbox.host_facts.cpu_benchmark_ms`.
3. Its hunters run one at a time, each alone. The lab protocol is the profile's: a warm-up request plus 3 cold runs in quick, plus 5 in standard and deep; median, and worst run for CLS and INP.
4. An escalated performance unit gets a new sequential slot at the end of the wave. A consult raised by a performance hunter runs as its own sequential slot right after the requester's slot (peer, then any requester resume, then the judge), with nothing else driving a browser; it is priced and earmarked like any consult. No consult about a non-performance item runs during the performance wave; such consults wait until the wave ends and must close before `cfinal`.
5. A performance record whose capture overlapped another runtime agent is re-measured inside the wave, or stays out of `findings.json`.
6. Every verifier of a performance fingerprint later runs alone too (rule 6b).

The wave contributes one wave, plus its open consult slots, to the planning estimate, and its post-wave critic runs after the last slot.

## Budget inside Phase 2

Every delegation counts: launches, resumes and retries alike; only calls the host refuses for its concurrency limit do not. The parent checks `spent + 1 <= cap` before every call and never goes past the cap without the owner's explicit answer at run time, recorded in `agent-log.json` `cap_overrides[]` (ORCHESTRATION.md §1). When the cap is reached mid-run, the option the parent presents first, as the recommended one, is to **finish with what is funded**: stop launching hunters, defer the unfunded units with their budget code for the next run, and spend what is left on validation and reports. Raising the cap is offered second, with the exact number of extra calls and what they would buy; it is never marked as recommended.

Before each wave, compare the free budget (`cap - spent`) with:

- the wave's post-wave critic (none for the escalation wave);
- the final-clean critic, until a clean `cfinal` ran (`quick` keeps only its single final critic). A wave launched because `cfinal` found work re-reserves a new `cfinal` as well as its own post-wave critic;
- the validation reserve: the verifier calls ORCHESTRATION.md §1.5 prices for the candidates in hand (one per strong or `medium` candidate, one per batch of up to 5 `low` or `polish` candidates of a surface, one per batch of up to 10 source-only candidates, and outside `quick` one Phase 5 agent per expected `high` or `blocker` record);
- the orchestration reserve: whatever of it is still free, plus every amount already earmarked for open consults, escalations and panels.

Hunters fill only the remainder. Each hunter group is priced at the worst case of its route: 1 for a single call, more when a tier known to be unavailable sends the group down a ladder. Shrink the wave to fit, taking groups in priority order; units the cap cannot fund become `deferred` with `agent_cap_reached`. If the reserves alone do not fit, launch no hunter, and defer the wave's units with `budget_cannot_reserve_critics_and_validation`. The escalation wave is paid from the amounts earmarked when each escalation opened, never from the hunter remainder. Units proposed by critics join the same ranked queue; they do not extend the budget.

The orchestration reserve spends in this priority order: judges, then retries of failed, malformed or overloaded calls, then consult peers and resumes, then escalations, then fallback panels discovered mid-run, then schema repairs. A retry is never paid from the critic or validation reserves.

If the surviving candidates outnumber the validation reserve, stop hunting and move to Phase 3. Candidates are validated in fingerprint order. The rest stay ledger candidates marked `validation_budget_exhausted` and never enter `findings.json`. Everything the cap left uncovered (deferred units with a budget code, declined consults, unfunded escalations and panels, unvalidated candidates) is listed in COVERAGE.md "Agents, models and budget".

## Hand-off to Phase 3

Phase 2 ends when the loop terminates: no unit is `planned` or `in_progress` unless an early stop deferred it, no dialogue or escalation of Phase 2 is open, each unique fingerprint has one consolidated candidate and an entry in `fingerprint-agents.json`, and the ledger and the agent log pass their validators. After a clean `cfinal` (or an early stop), any orchestration reserve above the judge's worst case that is not earmarked is released to the Phase 3 and Phase 5 verifiers (ORCHESTRATION.md §1). Validation continues in [VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md).
