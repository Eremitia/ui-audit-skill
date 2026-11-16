#### Defect lenses — choose and split based on Phase 1

These are the ordinary lenses: broad ways of looking at a surface that apply to almost any web application. Recon decides which ones a unit carries, and splits a lens per domain, per persona or per surface when one hunter could not settle it in one pass. A unit cites a lens by its exact block ref, for example `LENSES.md#Forms and validation`. Each lens below is self-contained: it has no `Core discipline`, `Universal moves` or `Validation rules` of its own, so the hunter prompt's Core hunting method and Candidate gate carry the method and the bar.

When a surface needs domain depth, select the companion file as well. A companion is selected only when recon found the surface its "When to use this file" section describes, not because a package is installed.

> **Functional flow surfaces** (entity lifecycles, multi-step flows, figures shown on several screens, money and time rules, exports, uploads, role-gated actions, destructive actions with their confirmation and undo): use [FUNCTIONAL-FLOWS.md](FUNCTIONAL-FLOWS.md).
>
> **Responsive and layout surfaces** (breakpoint pivots, fixed or sticky bars, dialogs on phones, long content, growing lists, touch targets, hover-only affordances): use [RESPONSIVE-AND-LAYOUT.md](RESPONSIVE-AND-LAYOUT.md).
>
> **Performance surfaces** (public or primary entry pages, large images and fonts, client bundles, server data waterfalls, polling screens, long lists, screens left open all day, back and forward restores from the back/forward cache): use [PERFORMANCE.md](PERFORMANCE.md).
>
> **Accessibility surfaces** (any interactive screen, custom widgets, dialogs, forms, status messages, login and PIN entry, motion, swipe, drag and multi-finger gestures, navigation and help repeated across pages): use [ACCESSIBILITY.md](ACCESSIBILITY.md).
>
> **Visual and theming surfaces** (light, dark and system themes, first-paint theme scripts, per-tenant brand colours, design tokens, icon families, public share metadata, and unintended visual change since an approved baseline): use [VISUAL-AND-THEMING.md](VISUAL-AND-THEMING.md).
>
> **Resilience and state surfaces** (loading, empty, error, not-found and forbidden states, offline and slow networks, failed mutations, session expiry, stale tabs, alerts and sounds): use [RESILIENCE-AND-STATES.md](RESILIENCE-AND-STATES.md).
>
> **Project convention surfaces** (written UI rules in `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, other agent-guide files, the README or agent memory, code-structure rules, navigation configuration, test-presence rules): use [PROJECT-CONVENTIONS.md](PROJECT-CONVENTIONS.md).

Thresholds and behaviours below carry rule ids in the form `[rule: UX-40]`. Each id resolves to a row of the rule index in [SOURCES.md](SOURCES.md), which gives the statement, the threshold, whether it is normative or advisory, and the sources behind it. A unit may cite such a row as its expectation with the ref `RULE:<id>`. Advisory rows (WCAG AAA, platform touch sizes, usability heuristics without a measured consequence) back only improvements unless a confirmed project-rules.md row adopts them.

Every lens obeys the same bar. A deviation needs a persona, a context, steps, an expectation with a named source, an observation that contradicts it, and a user consequence. Use `confirmed` only after local reproduction in the stated context. Use `needs_validation` when the decisive fact needs a real device, another engine, a real screen reader, the real clock or real data volumes. When the decisive question belongs to another lens, the hunter asks a consult rather than guessing (see [HUNTING.md](HUNTING.md)).

Two lenses route to a stronger model: `Business rules as displayed` and `Data consistency across screens` are business lenses (task kind `hunt_business`), so their units never share a hunter with units of other lenses (ORCHESTRATION.md §2).

**Functional flows** (subagent_type: `general`)
Walk each core task of each persona from its entry route to its end state, as `architecture.md` lists them, and check that the user can finish it and that the result is what the product promises.
- Map the states the task passes through (draft, sent, accepted, paid, cancelled, expired) and the action the UI offers in each. Try every offered action in every state, including the ones a stale page still shows after the state has moved on.
- Check that an illegal transition is refused with a clear message, and that both the actor's screen and the other persona's screen converge to the same state.
- Destructive or costly actions (delete, cancel, refund, close a period) offer undo, or a confirmation that names the object and the consequence; frequent low-cost actions do not nag [rule: UX-21, UX-27, UX-28]. The full checks are in `FUNCTIONAL-FLOWS.md#Destructive actions, confirmation and undo`.
- Interrupt the flow: refresh, go back, open the same entity in a second tab (`newTab`), let the session expire (`clearCookies`), go offline for one step (`setNetwork`). Record whether input survives, whether a retry duplicates anything, and whether the user can tell what happened.
- Partial failure: when step 2 of 3 fails, does step 1 stay half-applied with no indication?
- Expectation sources: the README or product spec, `business_rule` code, project-rules.md rows.

Example (Brasero): a customer at `/mesa/[slug]` adds the last unit of a product, a second customer context sends an order for the same unit first; the first customer must get the "quedan N" choice, not a silent failure, and the panel stock must match.

**Business rules as displayed** (subagent_type: `general`)
The UI is where a rule becomes visible to the user. Check that each rule recon found is shown the way the code enforces it, and enforced the way the screen says.
- For each rule, find where it is enforced (server function, database constraint) and where it is shown (disabled control, message, badge, total). A rule enforced but not shown leaves the user guessing; a rule shown but not enforced lies.
- Compare the wording and the numbers: a limit stated on screen must equal the limit in code, and a total must be computed by the same rule the server uses. A total cost shown before the user commits must equal what is charged [rule: UX-20].
- Closed and switched-off modes: what each persona sees when the feature is off, the business is closed, or the entity is inactive.
- Never judge whether a rule is a good idea. Judge whether the screen and the code agree, and whether the user can act correctly.

Example (Brasero): with no shift open, the menu must stay browsable while add and send are disabled and the "restaurante cerrado" notice is shown; regulars at `/mesa/[slug]/reservas` must never be asked for a deposit.

**Forms and validation** (subagent_type: `general`)
Every form on an assigned surface, field by field, with the boundary values the field accepts.
- Values: empty, whitespace only, minimum, minimum − 1, maximum, maximum + 1, zero, negative, decimals where integers are expected, pasted separators (`1.000`, `1,000`, `$ 1.000`), 255+ characters, accents and emoji, HTML-looking text (`<b>x</b>` must render as text).
- The message appears next to the field, in the UI language, says what to fix, and does not erase the other fields. Focus moves to the first error. The server refuses the same value too; confirm that from source, never by crafting requests the UI does not send [rule: WCAG-28, UX-08, UX-09, UX-11, UX-13].
- What is saved equals what was shown: trimming, rounding, capitalisation, time zone.
- Required markers, `autocomplete`, input types and `inputmode` match the data (phone, email, money) [rule: UX-15, UX-17]. In a locale whose decimal separator is a comma, a typed `1.500` is never silently read as one and a half [rule: UX-37].
- Double submit is judged by outcome: exactly one record, with a visible pending state on the control that was pressed [rule: UX-07]. Count rows with the granted count command.

Example (Brasero): the GuestForm name accepts 2–40 characters and the phone 7–15 digits; check both ends, a pasted phone with spaces, and that a rejected phone keeps the typed name.

**Loading, empty and error states** (subagent_type: `general`)
For each screen, enumerate the states its data can be in and look at each one.
- Loading: on first entry and on client navigation, something appears within about 100 ms (a skeleton, a spinner or the framework's loading boundary), and nothing jumps when data arrives. The 100 ms figure is a threshold this skill chose from the response-time bands; a wait past 1 s with no indicator is the measurable defect, and an indicator that flashes for well under a second on a fast path is a low-severity flicker [rule: UX-01, UX-02].
- False empty: a "no results" or empty state shown while the request is still pending tells the user something untrue. Delay the data request and check that the empty state never appears before the response [rule: UX-40].
- Empty: no data, no results after filtering, a feature never configured. An empty state tells the user what is missing and what to do next, and a filtered empty state offers to clear the filter [rule: UX-40]. A blank area, a table header with no rows, or a zero dressed up as data is a defect when a rule or a canonical sibling requires a designed state.
- Error: the data source fails, an action fails, the server returns an error. The user sees a message in the UI language, not a stack trace, a raw status code or a white screen, and can retry. Each framework has its own error and not-found conventions; RESILIENCE-AND-STATES.md lists them per detected framework.
- Partial data: a missing image, a missing price, a deleted related entity.
- Visible text never contains `undefined`, `NaN`, `null`, `Invalid Date` or `[object Object]` (probe `structure.badText`) [rule: UX-33].

Example (Brasero): `src/app` has no `error.tsx` or `not-found.tsx`; record what each persona actually sees when a page's data fails or a slug does not exist, against the `CLAUDE.md#Interfaz` complete-states rule.

**Navigation and routing** (subagent_type: `general`)
How users move between screens, per role and per viewport.
- Every navigation entry reaches a real screen; no entry leads to a placeholder the role cannot use, and no reachable screen lacks an entry where the design says it should have one.
- Deep links: open each route directly while logged out, as each role, with a nonexistent ID and with a malformed ID. Expect a login redirect that returns to the original URL, or a designed not-found or forbidden page.
- Filters, tabs, selected day and pagination live in the URL when the screen is shareable; refresh and back reproduce the view.
- The active item is marked, the page title changes per route [rule: WCAG-11], and back after a submit does not resubmit (probe `back` step).
- Navigation repeated across pages keeps the same relative order, the same function keeps the same name everywhere, and help offered on several pages sits in the same place [rule: WCAG-26, WCAG-27, UX-39].
- Phone navigation (tab bar, overflow menu) versus desktop navigation (sidebar, rail) expose the same destinations.
- A link to another tenant's data is reported only as a UX defect and cross-referenced to the security audit; never exploited.

Example (Brasero): on phones `splitForTabs` shows four tabs plus "Más"; check that Caja, which an employee needs on every shift, is reachable, and how many taps it takes, against the documented intent.

**Data consistency across screens** (subagent_type: `general`)
One figure, one rule. Pick a scenario, then record the same figure on every screen and export that shows it.
- Build the figure's map from recon: where it is computed, and every place it is displayed.
- Run one fixture scenario and read the figure on each screen, at the same moment, in the same tenant. They must agree exactly, in the currency's precision.
- Check arithmetic the user can do: lines sum to the subtotal, subtotal plus adjustments equals the total, the list count equals the number of rows.
- The same amount, date and time render identically wherever they appear: one currency formatter with an explicit currency, an explicit time zone for dates, one hour cycle per locale. Compare the parts of the formatted strings, after normalising the no-break spaces (U+00A0, U+202F) that locale formatters insert [rule: UX-34, UX-35, UX-36].
- Check that refresh and live updates converge: after a change, every screen shows the new value within one poll interval.
- Two formulas for the same figure in source are a structural lead; the defect is the user-visible disagreement.

Example (Brasero): after a partial tab payment, the tab total, Caja's shift tape, Inicio's sold figure, Balance and the Excel download must agree to the peso, and booking money must stay in its own block, never in the expected cash.

**Roles in the interface** (subagent_type: `general`)
A role × route × action grid for every persona `architecture.md` lists.
- Each role sees only the navigation it can use. A button that is visible but refused on click is a UX defect; a button hidden but still callable belongs to the security audit, cross-referenced only.
- A refused action ends in a clear, designed message, not a raw error, a redirect loop or a silent no-op.
- Switching person or role on the same device updates what is shown without a manual reload or a stale menu.
- Shared screens with role variants (dashboards) show each role the variant meant for it, with no figures leaking from the other variant.

Example (Brasero): an employee on `/admin/inventario` can restock but cannot create or edit articles; check that the edit controls are absent or clearly disabled, not present and failing.

**Wildcard** (subagent_type: `general`)
No category is assigned. Look for user-visible failures the other lenses would miss, inside the assigned units and with the same evidence bar.
- Which feature looks half-finished, experimental or left behind? Which screen is reachable but not in the navigation? A feature listed as deferred or out of scope is not half-finished; report only a reachable entry point that leads users into it.
- What happens when two features meet that were built separately: an offer plus out-of-stock items, a closed business plus a saved cart, a theme change while a dialog is open, a live refresh during typing?
- What does the code assume about the environment: the browser's time zone equals the business's, the screen is wide, the user never has two tabs, the clock never crosses midnight mid-session?
- Read the tests next to the components on the surface. Which states and inputs do they never exercise? Try those.
- Where does the UI say something the code does not guarantee (a "saved" toast before the save, a count that never refreshes)?

Follow an anomaly until you can state whether a user is affected. A comment explaining why something is fine is a claim to verify, not proof.

**Obvious things** (subagent_type: `general`)
Other hunters chase subtle failures. This one walks a literal checklist on every assigned surface, because everyone assumes someone else already looked. Check every item and record a result for each, even when it passes.

- Console errors and uncaught page errors (probe `console`, `pageErrors`).
- Hydration warnings in the console, on frameworks that render on the server and hydrate in the browser: zero on every audited route, theme and viewport [rule: FRAMEWORKS-39].
- Other framework warnings in the console, matched by their known message (key warnings, framework-specific insights and hydration codes of the detected framework); dev-only warnings are read only from a development run [rule: FRAMEWORKS-86].
- Broken links and 404s: every in-app link on the surface, plus failed requests (`failedRequests`).
- Missing alt text on informative images and missing labels on fields and icon-only buttons (`structure.imagesWithoutAlt`, `unlabeledFields`, `unnamedButtons`).
- Horizontal overflow at 320 px (`overflow` at `m320`) [rule: WCAG-05, TOUCH-11].
- 200 % zoom (`checks.zoom: 200`): no lost content or function [rule: WCAG-04, TOUCH-13].
- Visible focus on every stop of a keyboard walk (`focusWalk.visibleIndicator`) [rule: WCAG-17].
- Contrast in dark mode, not only light (`contrast` with `theme: dark`) [rule: WCAG-01].
- `undefined`, `NaN`, `null`, `Invalid Date` or `[object Object]` in visible text (`structure.badText`).
- Untranslated keys (`menu.title.empty`, `{{name}}`), text in another language than the UI, and raw enum or status literals (`PENDING`, `paid`) where the user's word belongs; `<html lang>` matches the UI language [rule: UX-33, UX-38].
- Leftover TODO, lorem ipsum or placeholder copy in visible text.
- Duplicated or missing page titles across routes (`structure.title`).
- A missing responsive viewport meta: the tag must exist and its content must include `width=device-width` (`structure.metaViewport`) [rule: TOUCH-09].
- A viewport meta that blocks zoom: `user-scalable=no` or a `maximum-scale` below 2 (`structure.metaViewport`) [rule: TOUCH-10].
- When the probe ran axe-core (`checks.axe` with `--axe`): every `violations` entry is a lead to explain in user terms, and every `incomplete` entry is a manual check still owed, never a pass and never a finding by itself. Without axe, say so; it is a coverage gap, not a clean result [rule: TOOLS-01].

A flag is not a finding — show the user consequence. Before proposing anything from this list, trace it: a console error that changes nothing the user sees is an improvement note; a missing label on the only field of the checkout is an accessibility finding. Escalate a confirmed item into the matching companion's class when one is selected, and keep one record per root cause.

Example (Brasero): a hydration warning on admin pages may come from the theme first-paint script; it is a finding only if the user sees a wrong theme or a layout jump, which VISUAL-AND-THEMING.md checks.
