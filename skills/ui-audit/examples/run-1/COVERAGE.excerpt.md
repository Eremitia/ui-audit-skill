# UI audit coverage: demo-store, run-1 (excerpt)

This excerpt shows parts 1, 3 and 4 of the COVERAGE.md that the example run would produce: the run statement,
the agents, models and budget, and the visual changes. Part 2, the coverage tables, is left out. Every number below comes from the JSON files next to this one: `run-metadata.json`,
`coverage-ledger.json`, `findings.json` and `agent-log.json`.

## 1. Run statement

A full standard-profile audit of demo-store, complete, with one unit deferred because of the agent cap and
one unit blocked because it needs a stronger model than this run had.

- **Scope.** Full repository, excluding `.claude/**`, `.agents/**` and the run's output directory.
- **Budget.** Cap 40 (from the config written at setup), 27 invocations spent, 13 unspent. The planning estimate priced
  43 calls, more than the cap, because strong verification is routed to the fable tier, which is declared
  unavailable, so each strong verification was priced as a two-member opus panel (worst case 5 calls). The
  owner answered: "Keep 40 and skip the admin orders screen this time." What the cap left uncovered: 1 unit
  deferred (`agent_cap_reached`), 1 escalation not funded (`escalation_budget_exhausted`), 0 consults
  declined, 0 candidates left unvalidated.
- **Models.** Routing was per call. haiku, sonnet and opus ran and reported their own family every time;
  fable was declared unavailable in the config and never called. No substitution was seen.
- **Plan note.** The owner wrote "API key, team budget". It was recorded as given and did not decide routing,
  availability or the cap.
- **Source.** Commit `4f1c2a9e7b6d`, branch `develop`, clean working tree.
- **Project.** Vite with React, pnpm, served with `pnpm run preview --port 4173 --strictPort --host 127.0.0.1`
  from a production build.
- **Runtime.** Local only: a rootless container with no network except port 4173 published to `127.0.0.1`.
  Ready probe 200, egress probe blocked, bind probe "127.0.0.1:4173 only".
- **Browser.** CDP driver, local Chromium 155, headless. Not covered: Firefox, WebKit, iOS Safari, real
  screen readers, the real on-screen keyboard.
- **Variants.** Viewports m320, m390, t768 and d1440; matrix `core` in light and dark; network profiles fast,
  slow4g, slow3g, offline and flaky.
- **Personas.** Customer and store admin. The owner confirmed project rules PR-01 (no horizontal overflow)
  and PR-02 (filters and pagination keep the result set consistent).
- **Prior runs.** None; this is the first run for demo-store and no visual baseline existed.
- **Deferred and blocked.** The admin orders unit is deferred (`agent_cap_reached`). The checkout
  interaction-latency unit is blocked (`needs_stronger_model`, `escalation_budget_exhausted`).
- **"All cases"** means the six units of the coverage ledger, closed by a clean final critic, not every
  possible case.

## 3. Agents, models and budget

### Budget

| | Planned at the gate | Used |
|---|---|---|
| Permission check (before the gate) | 1 | 1 (w0-perm) |
| Reconnaissance | 4 | 4 |
| Critics | 2 at start, re-reserved per wave | 4 (c1, c2, c3, cfinal) |
| Validation | 2 at start, re-reserved per wave | 6 (three opus panels of 2) |
| Orchestration (fraction 0.17, floor 6 held) | 7 | 7: 1 retry, 5 for consult dlg-01, 1 for escalation esc-01 |
| Hunters | the remainder | 6 (five hunters and one retry) |
| **Total** | cap 40 | **27 spent, 13 unspent** |

Nothing was released from the orchestration reserve to verifiers, because no free call was left after the
final critic. The cap was never exceeded and no override was needed.

### Invocations by tier, task kind and purpose

| Task kind | Tier requested | Tier observed | Effort | Invocations | How |
|---|---|---|---|---|---|
| permission_check | haiku | haiku | low | 1 | primary (w0-perm, before the gate) |
| recon_product | sonnet | sonnet | high | 1 | primary |
| recon_routes | haiku | haiku | medium | 1 | primary |
| recon_design_rules | sonnet | sonnet | medium | 1 | primary |
| recon_runtime | sonnet | sonnet | medium | 1 | primary |
| screenshot_sweep | haiku, then sonnet | haiku, sonnet | low | 2 | 1 primary, 1 escalation |
| hunt_business | opus | opus | high | 2 | 1 primary, 1 consult reply |
| hunt_standard | sonnet | sonnet | medium | 3 | 2 primary, 1 retry |
| hunt_performance | opus | opus | medium | 1 | primary |
| consult_peer | opus | opus | medium | 2 | consult (launch and one resume) |
| judge | opus, fable wanted | opus | xhigh | 2 | panel |
| critic_wave | sonnet | sonnet | high | 3 | primary |
| critic_final | opus | opus | high | 1 | primary |
| verify_candidate_strong | opus, fable wanted | opus | xhigh | 2 | panel |
| verify_record_strong | opus, fable wanted | opus | high | 4 | panel |

Not counted: one launch of `h3-catalog` was refused because of the host's concurrency limit and relaunched
when another agent finished.

### Escalations

- **esc-01**, the visual sweep: `w1-sweep` on haiku reported low confidence (three captures never settled
  because of an auto-playing carousel). Re-run on sonnet as `w1e1-sweep` with the carousel masked.
  Outcome: resolved.
- **esc-02**, the checkout interaction-latency unit: `h4-perf` on opus asked for a stronger model to tell
  which of two scripts causes the slow postcode input. The target tier, fable, is unavailable, so the ladder
  needed an opus panel with a worst case of 5 calls; the orchestration reserve had no free call. Outcome: not
  funded; the unit is blocked.

### Dialogues

- **dlg-01**, about `cart/figure-consistency/cart-drawer/total-differs-from-checkout`. Requester `h2-cart`
  (functional flows), peer `q1-cart-state` (resilience and states). Two rounds of two: the peer showed the
  one-cent difference comes from per-line versus per-order rounding, not stale state; the hunter kept that
  two totals for one cart is a defect. The judge route wanted fable, so two opus judges ruled independently
  (panel fb-02); both ruled neither. Outcome: judged_neither; the record is needs_validation.

### Fallbacks

| Id | Task kind | Wanted, used | Effort | Mode | Why | Planned or mid-run | Agents and calls | Outcome |
|---|---|---|---|---|---|---|---|---|
| fb-01 | verify_candidate_strong | fable, opus | xhigh | two must agree | declared unavailable | planned | 2 agents, 2 calls | agreed: confirmed |
| fb-02 | judge | fable, opus | xhigh | two must agree | declared unavailable | mid-run (dlg-01) | 2 agents, 2 calls | agreed: neither |
| fb-03 | hunt_performance | fable, opus | high | two must agree | declared unavailable | mid-run (esc-02) | none | not funded |
| fb-04 | verify_record_strong | fable, opus | high | two must agree | declared unavailable | planned | 2 agents, 2 calls | agreed: confirmed |
| fb-05 | verify_record_strong | fable, opus | high | two must agree | declared unavailable | planned | 2 agents, 2 calls | agreed: needs validation |

### Model availability

| Tier | Declared | Observed | First evidence |
|---|---|---|---|
| haiku | assume available | available | invocation 1 (w0-perm) |
| sonnet | probe | available | invocation 2 (r1a) |
| opus | probe | available | invocation 7 (h2-cart) |
| fable | unavailable | unavailable | declared in the config; never called |

The host accepted the `effort` parameter on every call. No host setting forced a model or an effort.

### Needs a stronger model

- `cart/figure-consistency/cart-drawer/total-differs-from-checkout` (needs_validation): needs fable.
- The checkout interaction-latency unit (blocked): needs fable.

### What the cap left uncovered

- The admin orders unit (`agent_cap_reached`). A cap of 43, or a scoped follow-up run on `/admin/orders`,
  would cover it.
- Escalation esc-02 (`escalation_budget_exhausted`). A larger orchestration reserve would have funded the
  opus panel; access to fable would have settled it with one call.

## 4. Visual changes since baseline

No baseline existed for demo-store, so nothing was compared and no unit was seeded from a visual change. The
sweep captured 4 routes at the `core` matrix (32 captures), with the home carousel masked; after the
escalation every capture was stable. Asked whether to keep this sweep as the first baseline and whether to
approve it, the owner answered: "Yes, keep it and approve it." The baseline `run-1` is promoted and
approved, so the next run can compare against it.
