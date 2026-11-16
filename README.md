# ui-audit

A skill for coding agents that audits how a web application **works and looks**, and, when you ask for it,
fixes what it confirmed. It coordinates a budgeted team of subagents against a local, disposable copy of
your app: they walk the real flows in a browser, measure every screen state at several viewports and in both
themes, check performance, accessibility and your project's own UI rules, try to refute each other's
candidates, and hand you a report in your language with a reproduction, evidence and the smallest fix for
every confirmed finding.

It is written for [Claude Code](https://code.claude.com/docs/en/skills) and follows the portable
[Agent Skills](https://agentskills.io/specification) format, so the instructions also work on other agent
hosts that can start subagents (without per-task model routing; see [Limits](#limits)).

- [What it checks](#what-it-checks)
- [How it works](#how-it-works)
- [Safety model](#safety-model)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [Usage](#usage)
- [Profiles and budget](#profiles-and-budget)
- [Fix mode](#fix-mode)
- [Example run](#example-run)
- [Outputs](#outputs)
- [Limits](#limits)
- [Development](#development)
- [License and credits](#license-and-credits)

## What it checks

Every finding is measured against an expectation someone wrote down before the audit started: a WCAG 2.2
criterion, a Core Web Vitals threshold, a business rule in your code, a rule in your `CLAUDE.md` or
`AGENTS.md`, a sibling screen that is clearly canonical, or a visual baseline you approved. Taste alone is
never a finding.

| Area | Examples of what is measured |
|---|---|
| Functional flows | entity lifecycles, multi-step flows and drafts, double submits, concurrent sessions and stale views, destructive actions with confirmation and undo, role-gated actions, uploads and exports |
| Business rules on screen | figures that must agree across screens, money and quantity rounding, time zones and dates, locale formatting |
| States and resilience | loading, empty and error states, not found, hydration mismatches, offline and slow networks, failed mutations, session expiry, back, forward and refresh, back/forward cache |
| Responsive layout | horizontal overflow, breakpoint pivots, reflow at 320 CSS px and zoom to 200 % and 400 %, safe areas, on-screen keyboard, target size, hover versus touch |
| Performance (lab) | LCP, INP, CLS, TTFB, FCP and TBT on a production build, JavaScript weight, images, fonts, waterfalls, long tasks, long-session memory |
| Accessibility | WCAG 2.2 Level A and AA: contrast, names, keyboard and focus, focus not obscured, dialogs, status messages, pointer gestures, consistent help, accessible authentication; axe-core results when your project already has it installed |
| Visual and theming | light and dark parity, theme flash, native controls, token discipline, component consistency, "template look" judged against a written criterion, unintended visual change since an approved baseline |
| Project conventions | the UI rules your repository writes down (CLAUDE.md, AGENTS.md, CONTRIBUTING, Cursor or Copilot rule files, lint configs) and owner preferences you confirm |

Thresholds and tool behaviour are research-backed and listed with their sources in [SOURCES.md](skills/ui-audit/SOURCES.md):
WCAG 2.2 (with WCAG 3 treated as an informative draft only), Core Web Vitals including INP, Lighthouse and
axe-core behaviour and limits, framework guidance for Next.js, React, Vite, Nuxt, SvelteKit, Astro, Angular
and React Router, end-to-end and visual-regression practice, Nielsen heuristics with form and checkout
research, and Apple, Material and WCAG touch-target guidance.

Supported targets: Next.js, Nuxt, SvelteKit, Astro, React Router (framework mode), Remix, Angular, Vite apps
(React, Vue, Svelte, Solid, Preact, Lit or vanilla) and plain static sites. `scripts/detect-project.mjs`
reads your `package.json`, lockfile and config file names to find the framework and the commands to build
and serve a production copy.

## How it works

The skill has three modes. **Guidance** (the default) answers questions and runs small focused checks.
**Full audit** runs only when you ask for it ("audit the UI", "QA the whole app", "test every case").
**Fix mode** runs only when you ask for it ("fix the findings", "corregir") and only on a validated audit run.

A full audit runs six phases:

1. **Reconnaissance.** Four research agents map the product (personas, core tasks, business rules,
   figures), the routes and screen states, the design system and written rules, and the local run
   capability. The parent builds disposable fixtures and sessions, seeds a **coverage ledger** (one unit per
   surface, expectation, domain, lens and context) and shows you a planning estimate.
2. **Hunting waves.** Hunter agents take groups of up to 12 units, each group with one task kind. They drive
   the browser probe, read source and return structured results. A fresh **coverage critic** reviews the
   ledger after every wave, and a final critic closes coverage.
3. **Candidate validation.** Every candidate goes to a fresh verifier who first tries to refute it and then
   reproduces it independently in its own data.
4. **findings.json.** The parent writes every decided record and runs the three schema validators.
5. **Final record verification.** One fresh agent re-checks each record without changing anything.
6. **Reports.** REPORT.md, FINDINGS-DETAIL.md, NEEDS-VALIDATION.md and COVERAGE.md in your language.

Around those phases the orchestration layer ([ORCHESTRATION.md](skills/ui-audit/ORCHESTRATION.md)) adds:

- **An agent budget.** Every agent invocation counts, retries and resumes included, against a cap: 40 for a
  standard run, 15 for quick, 90 for deep, all configurable. Reserves for reconnaissance, critics,
  validation and orchestration are held back before any hunter starts, and the cap is never exceeded
  without your explicit answer at run time. The report says what the cap left uncovered.
- **Model routing per task.** Each invocation has a task kind that maps to a model alias and an effort
  level, passed through the Agent tool's `model` and `effort` parameters [rule: CLAUDE-10, CLAUDE-13]:
  `haiku` for mechanical work (route inventory, ledger drafts, screenshot sweeps, schema repairs),
  `sonnet` for most hunting and ordinary verification, `opus` for business rules, cross-screen figures,
  performance root causes, the final critic and high-severity verification, and `fable` for judges. A
  result that reports low confidence or asks for a stronger model is re-run on the next tier the routing
  table names, paid from the budget.
- **Consults, dialogue and judges.** When a decisive question belongs to another lens, an agent puts a
  `consult` (question, position, evidence, lens needed) in its result. The parent runs a short exchange
  with a peer of that lens, at most `dialogue.max_rounds` rounds; if they still disagree, a strong-model
  judge decides. The summary and outcome go into the agent log and the report.
- **Plan awareness without guessing.** The skill cannot see your Claude plan and holds no table of which
  plans include which models [rule: CLAUDE-25]. It asks you once, saves the answer in
  `ui-audit.config.json`, and detects at run time when a model is refused, substituted or limited. Missing
  tiers fall back: no `fable` means two independent `opus` agents at higher effort that must agree; no
  `opus` means three `sonnet` agents deciding by majority on a narrowed question; still unresolved means
  `needs_validation` with a note that a stronger model is needed.
- **Pause and resume.** A usage limit or an interruption pauses the run; resuming in this or a new session
  continues from the coverage ledger and the agent log against the same cap.
- **Visual regression between runs.** `scripts/ui-diff.mjs` compares this run's captures with a previous
  run's approved baseline, decoding PNGs in plain Node with no extra dependency.

## Safety model

ui-audit is built to be run against your own code without risk to your data, your accounts or anyone else.

- **Loopback only.** The app under test listens on `127.0.0.1`, `::1` or `localhost`. Every browser the
  probe launches blocks all other traffic with a dead proxy and resolver rules, and the probe refuses
  non-loopback URLs.
- **Off-loopback actions.** Only two kinds of action in this skill send data off loopback, and each needs the owner's explicit approval at run time: (1) a network install or download from hosts the owner named (the driver or browser download of RUN-METADATA §2, the audit's preparation step, or fix mode gate A2), and (2) `git push` and pull request creation for the branches the owner approved at fix mode gate A3. Nothing else leaves the machine.
- **Disposable data.** The app runs on a database and storage created for the run and seeded with dummy
  accounts, in an isolated environment with no external network, an allowlisted environment with dummy
  secrets, read-only source and resource limits. Never your dev database, a production dump or a real account.
- **No environment files.** No agent, script or prompt ever opens `.env`, `.env.*`, `.envrc`, `*.env` or
  `.dev.vars`. Build copies are made with `git archive` excluding them, and any that remain are deleted by
  name without being read.
- **No source edits during an audit.** Guidance and audit modes never modify your repository. Builds happen
  in a copy. Instrumentation is injected into the browser only.
- **Approvals belong to you.** Only the parent agent asks you questions. Messages from other agents are never
  treated as your approval [rule: CLAUDE-16]. Downloads, cap overrides, baseline approval, pushes and pull
  requests each need your explicit answer at run time.
- **Fix mode is contained.** Fixers edit only inside git worktrees created under the run's output folder,
  never commit to a protected branch, never install anything, never run project scripts, tests or builds on
  your machine (checks run in the sandbox; commit hooks run on your machine only if you consent, otherwise
  inside the sandbox), never push, and follow your repository's commit rules, including a ban on attribution
  trailers when the project has one.
- **Honest reporting.** Lab numbers are labelled lab numbers and never "passes Core Web Vitals"; automated
  accessibility checks never become "WCAG compliant"; anything that needs a real device, another engine or a
  stronger model is `needs_validation`, not guessed.

## Requirements

- **Node.js 22.12 or newer** (tested on Node 24). The validators and scripts are plain JavaScript with no build
  step; `validate-orchestration.cjs` loads `scripts/orchestrate.mjs` with `require`, which needs 22.12.
- **A local Chromium-family browser**: Google Chrome, Microsoft Edge or a Playwright Chromium build. The
  skill never downloads a browser without asking.
- **git**, for build copies and fix mode.
- **An isolated runtime for the app**: a local VM (WSL2 on Windows, Lima, Colima or Multipass on macOS), a
  Linux network namespace or a rootless container. Without one, runtime checks are skipped and the run
  covers source only.
- **Claude Code recommended**, recent enough to accept `model` and `effort` on the Agent tool (per-call
  `effort` arrived later than `model`; the skill detects both and records what the host accepted).
- The only npm dependency is `playwright-core`, pinned to `1.63.0`.

## Install

Install the skill with the [Skills CLI](https://skills.sh):

```sh
npx skills add https://github.com/Eremitia/ui-audit-skill --skill ui-audit
```

Use `--global` for a user-level installation, available in every project. A personal copy at
`~/.claude/skills/ui-audit` takes precedence over a project copy with the same name [rule: CLAUDE-07]. The
installer sends anonymous telemetry unless `DISABLE_TELEMETRY=1` is set (in PowerShell,
`$env:DISABLE_TELEMETRY = "1"`) [rule: CLAUDE-34]. Run `npx skills --help` for agent-selection and
non-interactive options.

Or install it as a Claude Code plugin; the repository is its own marketplace [rule: CLAUDE-29, CLAUDE-31]:

```sh
claude plugin marketplace add Eremitia/ui-audit-skill
claude plugin install ui-audit@ui-audit-marketplace
```

or `/plugin marketplace add Eremitia/ui-audit-skill` inside a session; the skill is then invoked as
`/ui-audit:ui-audit`. Plugin versions follow the manifest `version`, so a new release reaches you when that
number changes [rule: CLAUDE-32].

The skill lives in [`skills/ui-audit/`](skills/ui-audit/), and its folder must stay named `ui-audit`,
because a skill's name equals its folder name [rule: CLAUDE-03]. On first use it checks for its one
dependency, the pinned `playwright-core`, with `node <skill-dir>/scripts/setup.mjs`, and with your yes
installs it into its own folder with `--install` (`npm ci --ignore-scripts`, one download from the npm
registry, no browser). Until then the probe uses its built-in CDP driver. Check the install by typing
`/ui-audit` in Claude Code [rule: CLAUDE-28]. The installer's lock file hashes every file in the skill folder
except `.git` and `node_modules`, which is one more reason run output never lives there [rule: CLAUDE-35].

## Configuration

`ui-audit.config.json` holds your answers to the one-time setup question and the run defaults. The first
existing file in this order wins:

1. `${CLAUDE_PLUGIN_DATA}/ui-audit.config.json`, when that variable is set (plugin installs; the data
   directory survives plugin updates, the plugin cache does not);
2. `<skill folder>/ui-audit.config.json` (git-ignored; project and personal installs);
3. `~/ui-audit-skill/ui-audit.config.json`.

When none exists and you ask for a full audit or fix mode, the skill asks once, in your language: what you
are on (a subscription, a team seat or the API; recorded only as a note, it never changes routing), which
profile to use by default, and whether a model that needs usage credits or extra consent may be used. It
writes the file and shows the resulting cap and reserve. You can edit the file at any time; start from
[ui-audit.config.example.json](skills/ui-audit/ui-audit.config.example.json).

| Key | Meaning | Default |
|---|---|---|
| `schema` | format version of the file | `ui-audit/config@1` |
| `owner_plan_note` | your own words about your plan; recorded and quoted, never interpreted | `null` |
| `profile` | `quick`, `standard` or `deep` | `standard` |
| `agent_cap` | cap per profile | `{"quick": 15, "standard": 40, "deep": 90}` |
| `orchestration_reserve_fraction` | share of the cap kept for judges, retries, consults, escalations and fallbacks | `0.10` |
| `max_parallel_agents` | agents running at once (the host allows at most 20) | `4` |
| `models` | per alias: `assume_available`, `probe` (the first real use decides) or `unavailable` | haiku assumed, the rest probed |
| `allow_fable_usage_credits` | may a credit-consent prompt be answered yes (foreground hosts only) | `false` |
| `allow_max_effort` | allow the `max` effort level | `false` |
| `routing_overrides` | per task kind `{model, effort}`; strong-model floors still apply | `{}` |
| `dialogue.max_rounds` | consult rounds before a judge | `2` |
| `escalation.max_steps_per_item` | tier escalations per item | `2` |
| `critics.max_post_wave` | post-wave critics that may add work, per profile | `{"standard": 2, "deep": 3}` |
| `report_language` | `auto` or a BCP 47 tag | `auto` |
| `output_root` | where runs and baselines go; outside the target and the skill folder | `~/ui-audit-skill` |
| `visual_regression` | on or off, diff threshold, anti-aliasing, budgets, mask warning | `enabled` true, `0.2`, anti-aliasing off, `0.001`, null, `30` |
| `fix` | fix-mode cap and parallel fixers | `{"agent_cap": 30, "max_parallel_fixers": 2}` |
| `asked_at` | when the setup question wrote the file | `null` |

Check a config with `node scripts/orchestrate.mjs check-config <file>` or
`node validate-orchestration.cjs <file> --kind config`.

## Usage

Talk to your agent in any language; the skill answers and reports in the language you use.

| You say | What happens |
|---|---|
| "Does the cart drawer overflow at 320 px?" | Guidance mode: a focused check, an answer in the conversation, no files. |
| "Audit the UI of this app" | Full audit, `standard` profile, cap 40. |
| "Test every case" | Full audit; the skill recommends `standard` over the whole app (`deep` for one area) and shows the estimate before hunting. |
| "Quick UI check before the demo" | Full audit with the `quick` profile (cap 15). |
| "Audit only /checkout and /cart" or "audit what changed since dev" | A scoped run; the rest of the ledger is `out_of_scope` and the report says the run is partial. |
| "Use 60 agents for this one" | The cap for this run becomes 60; the config file is unchanged unless you ask. |
| "Fix the confirmed findings of run-1" or "corrige la UI" | Fix mode on that run, with the approval gates below. |
| "Continue the ui-audit run at ~/ui-audit-skill/demo-store/run-1" | Resume a paused run from its ledger and agent log, same cap. |
| "Finish with what we have" (while paused) | Phases 4 to 6 on the decided records; the run ends `incomplete` and says why. |

## Profiles and budget

| | quick | standard | deep |
|---|---|---|---|
| Default agent cap | 15 | 40 | 90 |
| Reserved before hunting (default cap and config) | 12 | 14 | 17 |
| Setup call before the gate (permission check) | 1 | 1 | 1 |
| Smallest cap that keeps consults and escalations possible | 14 | 16 | 16 |
| Smallest cap that can start at all | 10 | 12 | 12 |
| Viewports and themes | phone and desktop, light and dark | phone, small phone, tablet and desktop, light and dark | every standard viewport plus breakpoint pivots |
| Performance lab protocol | warm-up + 3 cold runs | warm-up + 5 cold runs | warm-up + 5 cold runs |
| Verification | one verifier per candidate, minor ones in batches, closing its records | the same, plus a final check of high and blocker records | as standard, with replacement headroom |

The orchestration reserve never drops below a floor: the larger worst case of one consult and one decisive
escalation (6 calls with the default config, where `fable` has not been seen yet). A cap between the last two
rows can start only after you accept, in figures, that consults and escalations are disabled.
`node scripts/orchestrate.mjs budget --profile <p> --cap <n>` prints all of it.

Before hunting, `node scripts/orchestrate.mjs estimate` prices the plan per model tier and says whether it
fits, with the assumptions behind the figure. If it does not, it suggests narrowing the scope first, then a
smaller profile, and a larger cap only last; you choose. If the cap runs out mid-run, the recommended answer
is to finish with what is funded and leave the rest for the next run. Claude Code itself limits
only concurrency (20 running subagents) and nesting depth; the total is the skill's own rule
[rule: CLAUDE-15].

## Fix mode

Fix mode is "the only thing you need to leave everything excellent": it turns confirmed findings into
reviewed, tested branches without touching anything you have not approved.

1. **F0 gate.** You pick the findings (default: blockers and highs, then mediums, grouped by root cause),
   the fix cap (default 30, separate from the audit cap) and, if your repository has commit hooks, whether
   they run on your machine with your consent or inside the sandbox.
2. **F1 plan.** One fix per root cause, classified `mechanical`, `logic` or `business_rule` and routed to
   `haiku`, `sonnet` or `opus` respectively, with escalation when a fixer is unsure.
3. **F2 branches.** The skill reads your git rules from `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, PR
   templates and commit tooling: base branch, branch naming, protected branches, commit format and language,
   whether attribution trailers are forbidden, and the checks to run. It creates one worktree per fix under
   the run folder, from your base branch, never from the default branch by accident [rule: CLAUDE-17].
4. **F3 fixers.** Each fixer edits only its worktree, writes the regression test first when your rules ask
   for it, and commits in your format. It never installs, runs project code, pushes or changes dependencies.
5. **F4 checks.** Your typecheck, lint and tests run in the sandbox on a copy of the fix branch.
6. **F5 re-verification.** A fresh agent re-runs the original reproduction against a production build of the
   fix, plus a visual diff of the affected routes.
7. **F6 proposals and F7 FIXES.md.** Each passing fix gets a PR description. Nothing is pushed and no pull
   request is opened until you approve the exact branches at gate A3; then the skill runs only plain
   `git push <remote> refs/heads/<b>:refs/heads/<b>` for those branches and opens draft PRs to your PR target.
   It never merges. FIXES.md also lists the commands if you prefer to push yourself.

Details: [FIX-MODE.md](skills/ui-audit/FIX-MODE.md).

## Example run

[examples/](skills/ui-audit/examples/) holds a complete, validated example for a fictional Vite and React storefront,
`demo-store`, audited with the standard profile and a cap of 40:

- [examples/ui-audit.config.json](skills/ui-audit/examples/ui-audit.config.json): the config the setup question wrote,
  then edited by the owner (`fable` declared unavailable, a larger orchestration reserve);
- [examples/run-1/](skills/ui-audit/examples/run-1/): run metadata, the coverage ledger, two findings, the agent log with
  the permission check, model routing, two escalations, one consult that went to a judge panel, and the
  fallback panels;
- [examples/run-1/fix/](skills/ui-audit/examples/run-1/fix/): the fix log and fix agent log for the confirmed finding,
  ready for review and not pushed;
- [examples/run-1/COVERAGE.excerpt.md](skills/ui-audit/examples/run-1/COVERAGE.excerpt.md): the run statement, the
  agents, models and budget part and the visual changes part of COVERAGE.md.

[examples/README.md](skills/ui-audit/examples/README.md) walks through the run and gives the commands that validate every
file. In short, from the skill folder: `npm run validate:example`.

## Outputs

A full audit writes to `<output_root>/<repo>/run-<N>/`, outside your repository and outside the skill folder:

| Path | Content |
|---|---|
| `REPORT.md` | five sections, 150 to 250 lines: scope, quality posture and what to fix first, confirmed findings, needs validation, links |
| `FINDINGS-DETAIL.md` | every confirmed record in full, then improvements and positive patterns |
| `NEEDS-VALIDATION.md` | the plans that would settle each lead |
| `COVERAGE.md` | run statement, coverage per unit, agents, models and budget (with agent minutes by phase), visual changes |
| `findings.json` | decided records (schema: [report-schema.json](skills/ui-audit/report-schema.json)) |
| `coverage-ledger.json` | every unit and its state |
| `run-metadata.json` | setup, topology proofs, cap, reserves, models declared and observed |
| `agent-log.json`, `fingerprint-agents.json` | every invocation, escalation, dialogue and fallback; agent disjointness |
| `agents/<id>/` | each agent's prompt, scratch output and promoted artifacts (copied by `scripts/promote.mjs`) |
| `visual/` | the diff summary and diff images against the baseline |
| `fix/`, `worktrees/`, `FIXES.md` | fix mode only |

Baselines live in `<output_root>/<repo>/baselines/<baseline-id>/` and are written only when you say yes to
promoting a run's captures; only a baseline you approved can back a finding.

## Limits

- **Chromium only.** The probe drives Chromium over CDP. Firefox, WebKit, iOS Safari, a real on-screen
  keyboard and real screen-reader output are not reproduced; units that need them are `deferred` and credible
  claims are `needs_validation`. A Firefox or WebKit probe mode is not part of this version: the loopback
  guarantee relies on Chromium-only switches and the deep metrics are CDP-only.
- **No Lighthouse run.** Lighthouse is not a dependency. The probe measures lab metrics itself and labels
  any score it estimates; a Lighthouse report your project already produces can be read.
- **axe-core only when your project has it.** The skill never downloads or vendors axe-core. If your project
  already installed it (often through `eslint-plugin-jsx-a11y`), the probe loads that copy read-only;
  otherwise the probe's own checks run and the gap is reported.
- **Lab is not field.** Performance numbers come from a production build on your machine with emulated
  throttling. They are diagnostics, not Core Web Vitals results for real users.
- **Model substitution is detected by self-report only.** Claude Code may run another model when one is
  restricted and does not report it to the parent [rule: CLAUDE-21]; the skill compares each agent's own
  report of its model with the request and treats it as evidence, not proof.
- **Forced single-model hosts lose tier routing.** When the host forces one model (or has no `model`
  parameter), routing is logged but not applied, there is no escalation or fallback ladder, and low or unsure
  results get one same-model second opinion instead.
- **No delegation tool, no independence.** On a host that cannot start subagents (or when the parent is itself
  a subagent), the parent plays every role in turn ("inline roles"); the budget and logs still apply, but the
  report says that hunter and verifier were the same session. When nobody can answer questions, the skill
  uses safe defaults and lists every question it could not ask.
- **Heuristics are judgement.** UX heuristic findings need two independent agents or a judge, and need a
  measured consequence to become more than an improvement.
- **The budget is the skill's.** It counts invocations, not tokens; subagents still draw on your usage
  limits [rule: CLAUDE-26].

## Development

```sh
cd skills/ui-audit
npm ci                     # installs playwright-core 1.63.0 into the skill folder
npm test                   # every node --test file: validators, probe, diff, orchestration, detection, static server, promotion, docs
npm run validate:example   # the validators against examples/
```

- Tests use `node --test` and no extra dependency. The probe's browser smoke tests run only when
  `UI_AUDIT_SMOKE_EXECUTABLE` points at a local Chromium.
- `skill-docs.test.mjs` checks the repository itself: SKILL.md frontmatter (line 1 is `---`, only portable
  keys, description at most 1,024 characters) and size (under 500 lines) [rule: CLAUDE-01, CLAUDE-02,
  CLAUDE-04, CLAUDE-06], that every file `npm test` lists exists, that the plugin manifest, the marketplace
  entry and `package.json` carry the same name and version, rule citations against
  [SOURCES.md](skills/ui-audit/SOURCES.md), relative links, the routing table against `scripts/orchestrate.mjs`, the budget
  tables of SKILL.md, ORCHESTRATION.md, RUN-METADATA.md and this README against `budgetGate`, and the absence
  of environment files and attribution lines. `validate-orchestration.test.cjs` runs
  `npm run validate:example`.
- Before a release, `claude plugin validate ./` should pass (it needs the Claude Code CLI, so it is not a
  node test), and the `version` in `package.json` and `.claude-plugin/plugin.json` is bumped together.
- Wording in the skill files is original, apart from the adapted portions [NOTICE](skills/ui-audit/NOTICE) lists; thresholds cite rule ids from SOURCES.md, never raw links.

## Changes

- **2.5.2.** The plugin has an icon, a coverage grid with one confirmed unit, and the marketplace a
  description, so `claude plugin validate` passes with no warnings.
- **2.5.1.** The repository follows the layout of other published skills: the skill lives in
  `skills/ui-audit/`, and the repository root holds only this README, the license, the plugin manifests and
  CI. Install with `npx skills add` or as a plugin; the manifests name the skill folder, the homepage and the
  repository.
- **2.5.0.** Lessons from the second real run. Phase 3 starts by grouping candidates by root cause with
  `scripts/group-candidates.mjs` (same or nearby trace sink) and merging the ones that share it, so one
  shared-component defect reported by several hunters is verified once; the second run verified twelve such
  copies before merging them. The verifier prompt now states the shape rules the validators enforce (the
  unit's own context in every check variant, `null` for source checks, repository-relative paths, measurements
  that fail their own condition, UTF-8), and a check run in a neighbouring context stays in the record's
  evidence instead of the unit. The evidence block spells out that artifact paths start with `out/`. Tenants
  created after the seed go through the same setup and session check as seeded ones, and spares are sized for
  the mutating verifications actually queued. A fresh verifier that replaces a discarded result is logged as a
  new primary call. Headless tabs never hide, so hidden-tab checks simulate `visibilitychange` and say so.
  `scripts/setup.mjs` installs the pinned `playwright-core` on first use. SKILL.md is shorter, and every
  example now uses the fictional Brasero app.
- **2.4.0.** A short report. REPORT.md has five sections and aims at 150 to 250 lines: scope, quality
  posture with the three to five findings to fix first, a table of confirmed findings (`low` and `polish`
  grouped by screen), needs validation, and links. Each confirmed finding, of any severity, is in full in
  FINDINGS-DETAIL.md, which REPORT.md links to by fingerprint and which now ends with the improvements and
  positive patterns. The run statement, coverage, agents, models and budget, and visual changes move to
  COVERAGE.md, whose budget part adds agent minutes by phase. The first deep run's report was 1,324 lines,
  half of it repeating FINDINGS-DETAIL.md and counting agents.
- **2.3.0.** Better seeding and a limit on critics. Reconnaissance seeds every surface from a fixed
  checklist by kind (forms, lists, figures, roles, state changes, destructive actions, dialogs, routes
  with a parameter, sessions, contrast), drawn from the classes the coverage critics added most on the first
  deep run. At most `critics.max_post_wave` post-wave critics may add work (2 in standard, 3 in deep);
  later proposals and those of the single `cfinal` are `deferred` with `critic_wave_limit` and the run says
  its coverage is partial. On that run the critics took 13 passes for 85 units; the estimate for its input
  drops from 115 to 105 calls (14 critics to 4).
- **2.2.0.** Verification in proportion to severity. Proposed `low` and `polish` candidates of one surface
  share a verifier (up to 5), source-only candidates share a read-only one (up to 10), and every Phase 3
  verifier closes the record it decides with the Phase 5 checklist; a separate Phase 5 agent runs only for
  `confirmed` high and blocker records. `scripts/check-traces.mjs` checks every cited file and line against
  the reviewed commit without an agent. On the first real deep run, Phase 5 took 98 agents for one material
  change; the estimate for that run's input drops from 247 to 115 calls.
- **2.1.0.** The planning estimate is priced on measured figures: 40 % candidates per runtime unit
  (was 25 %) and the units the coverage critics add (0.3 in standard, 0.5 in deep), shown in
  `units_expected` and `assumptions`. On a 243-unit deep run the old estimate said 118 calls and the run
  spent 257; the new one says 247. When a plan does not fit, the suggestion is a narrower scope first, then a
  smaller profile, and a larger cap only last. When the cap runs out mid-run, the recommended answer is to
  finish with what is funded. "Test every case" now recommends `standard` over the whole app.

## License and credits

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Eremitia.

The multi-agent architecture (phased reconnaissance, a coverage ledger, hunters, coverage critics,
independent verification and schema validators) follows the design of Cloudflare's
[security-audit skill](https://github.com/cloudflare/security-audit-skill) (MIT). The wording was
written for this skill, except that the findings schema's field structure (trace, evidence, conditions,
execution, remediation, confidence), a few validator input-hygiene patterns and a few section-heading
conventions are adapted from security-audit-skill (MIT, Copyright (c) 2025-2026 Cloudflare, Inc.), whose MIT
notice is reproduced in NOTICE. The screenshot comparison reimplements the published YIQ colour
difference and anti-aliasing detection methods popularised by pixelmatch. Details and third-party notices are
in [NOTICE](skills/ui-audit/NOTICE).
