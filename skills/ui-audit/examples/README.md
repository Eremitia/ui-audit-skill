# Example run: demo-store, run-1

`demo-store` is a fictional Vite and React storefront with a catalog, a cart drawer, a checkout and a small
admin area, used by two personas: `customer` and `admin`. This folder holds what ui-audit would leave behind
after a standard-profile audit of it with a cap of 40 agents, followed by fix mode on the one confirmed
finding. The files are small on purpose (six ledger units, two findings), but every one of them is complete
and passes the validators, so they double as a reference for the file formats.

| File | What it is |
|---|---|
| [ui-audit.config.json](ui-audit.config.json) | The config the setup question wrote, then edited by the owner |
| [run-1/run-metadata.json](run-1/run-metadata.json) | Setup, topology proofs, cap, reserves, planning estimate, models declared and observed |
| [run-1/coverage-ledger.json](run-1/coverage-ledger.json) | The six units and their final states |
| [run-1/findings.json](run-1/findings.json) | One confirmed record and one needs_validation record |
| [run-1/agent-log.json](run-1/agent-log.json) | Every invocation, escalation, dialogue and fallback of the audit |
| [run-1/COVERAGE.excerpt.md](run-1/COVERAGE.excerpt.md) | Parts 1, 3 and 4 of COVERAGE.md: run statement, agents, models and budget, visual changes |
| [run-1/fix/fix-log.json](run-1/fix/fix-log.json) | Fix mode: the git rules read, the fix, its checks and re-verification |
| [run-1/fix/agent-log.json](run-1/fix/agent-log.json) | Fix mode's own agent log, with its own cap of 30 |

In a real run these files live in `~/ui-audit-skill/demo-store/run-1/`, together with the agents' folders,
screenshots and the other reports. Paths inside them (`agents/...`, `fix/...`) are relative to that folder;
the artifacts they name are not shipped here.

## Validate it

From the skill folder:

```sh
node validate-findings.cjs examples/run-1/findings.json
node validate-coverage-ledger.cjs examples/run-1/coverage-ledger.json --metadata examples/run-1/run-metadata.json
node validate-orchestration.cjs examples/run-1/agent-log.json --kind agent-log --metadata examples/run-1/run-metadata.json --findings examples/run-1/findings.json --ledger examples/run-1/coverage-ledger.json
node validate-orchestration.cjs examples/run-1/fix/fix-log.json --kind fix-log --findings examples/run-1/findings.json --agent-log examples/run-1/fix/agent-log.json
node validate-orchestration.cjs examples/ui-audit.config.json --kind config
```

or all of them at once with `npm run validate:example`. The repository test (`npm test`) runs the same checks.

## What happened in the run

**Setup question.** No config existed, so before the first agent the skill asked once what the owner is on,
which profile to use by default and whether a model that needs usage credits may be used. The owner answered
"API key, team budget", standard, and no; the skill wrote those answers and left every other key at its
default. After the question wrote the file, the owner edited it before the strict gate: fable declared
unavailable, routing_overrides for verify_candidate_strong and verify_record_strong, and
orchestration_reserve_fraction 0.17. The skill validated it with check-config. The override that sends strong
verifications to a tier the same file declares unavailable is deliberate here, to show the fallback ladder at
work; it is not a recommended setting. In a real config, leave `fable` on `probe` and let a run-time refusal
trigger the fallback. With the reserve fraction at 0.17, the strict gate held 4 calls for reconnaissance, 2
for critics, 2 for validation and 7 for orchestration out of 40, plus the one-call permission check
(`w0-perm`, haiku) made before it. The orchestration share, 7, is above the reserve floor of 6 (with fable
unavailable a consult costs up to 6 calls and a decisive escalation up to 5), so `reserve_floor_met` is true. The plan note is quoted in the report and
changed nothing.

**Planning.** After reconnaissance (four agents: sonnet for product, design rules and runtime, haiku for the
route inventory) and seeding six units, the estimate priced 43 calls, the permission check included. Every strong verification line was
priced at 5 calls instead of 1, because its wanted tier, fable, is unavailable and the fallback ladder
replaces it with two opus agents that must agree (worst case: two launches, a dialogue round, a deciding
agent). The estimate did not fit, so the skill offered a cap of 43, or deferring the admin orders group, which
brings the worst case to 41. The owner kept the cap at 40 and deferred that group, so the unit is `deferred`
with `agent_cap_reached`; the last worst-case call stayed unfunded, and the cap still held.

**Routing.** Each invocation took its tier from the routing table: the visual sweep on haiku, ordinary
hunting and wave critics on sonnet, the cart's business-rule hunter, the performance hunter and the final
critic on opus. The sweep reported low confidence because an auto-playing carousel kept three captures from
settling, so it was escalated to sonnet (`esc-01`), which masked the carousel and finished. One checkout
hunter call failed with an overload error and was retried once from the orchestration reserve; one
catalog launch was refused for the host's concurrency limit, which does not count.

**One consult.** The cart hunter (`h2-cart`, opus) found that the drawer shows 41.97 where checkout shows
41.96 for the same cart, and asked a consult (`dlg-01`) of the resilience lens: is the drawer showing stale
state? The peer (`q1-cart-state`) showed it is not stale: the drawer rounds the promotion per line and
checkout per order. The hunter kept its position for a second round; the peer still disagreed. The judge
route wants fable, so the judgement fell to two independent opus judges (`fb-02`), who both ruled that
neither side showed which rounding the store intends. The record is `needs_validation` with
`stronger_model_needed: fable` and a plan for the owner to state the rule.

**One fallback.** The checkout double-submit candidate needed a strong verification, routed to fable. The
ladder ran two opus verifiers at xhigh effort (`fb-01`, planned because fable was declared unavailable);
both reproduced two orders from two quick taps under a slow network and agreed, so the record is
`confirmed` with severity high. Phase 5 re-checked both records the same way (`fb-04`, `fb-05`).

**What the cap left.** Besides the deferred admin unit, the performance hunter asked for a stronger model to
attribute a slow postcode input. Its escalation to fable would have needed an opus panel of up to 5 calls,
and the orchestration reserve was empty by then, so `esc-02` was not funded and the unit is `blocked` with
`needs_stronger_model`. In total 27 of 40 calls were spent; the report explains both gaps.

**Fix mode.** The owner then asked to fix the checkout finding only. The skill read the project's rules
(branch from `develop`, commits as `type(scope): summary`, no attribution trailers, failing test first),
created a worktree on `fix/checkout-double-submit`, and a sonnet fixer wrote the failing test, stopped, and was
resumed to write the fix (the continuation reserved for failing-test-first rules).
Typecheck, lint and tests passed in the sandbox, and an opus re-verifier reproduced the original steps
against a production build of the fix: one order. The pull request is proposed and waits for the owner's
approval; nothing was pushed.
