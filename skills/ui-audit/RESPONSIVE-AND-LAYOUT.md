# Responsive and Layout Audit

#### When to use this file

Select this file when recon found screens used at more than one width or with more than one input kind: breakpoints in utility classes, media or container queries, a shell that changes shape at a breakpoint (sidebar to tab bar, table to cards), fixed or sticky bars, dialogs and sheets, user text inside fixed-width boxes, lists that grow with data, a viewport meta tag, `safe-area-inset` or `viewport-fit`, `100vh`, hover-revealed controls, or any route reached from a phone (QR code, shared link, installed web app). A responsive framework in `package.json` is not enough; recon must name the screens and breakpoints.

Neighbours: contrast, focus and dialog semantics are in [ACCESSIBILITY.md](ACCESSIBILITY.md) (this file owns target size, reflow, zoom, text spacing and orientation, because those failures are geometric). Shift during loading is in [PERFORMANCE.md](PERFORMANCE.md); a layout that is wrong after it settles is here. Theme differences are in [VISUAL-AND-THEMING.md](VISUAL-AND-THEMING.md). Written layout rules are extracted by [PROJECT-CONVENTIONS.md](PROJECT-CONVENTIONS.md) and checked here when geometric. Missing states are in [RESILIENCE-AND-STATES.md](RESILIENCE-AND-STATES.md).

Standing of the rules in this file. WCAG 2.2 Level A and AA criteria (1.3.4, 1.4.4, 1.4.10, 1.4.12, 1.4.13, 2.4.11, 2.5.8) are pass/fail. Platform guidance (Apple 44 pt, Material 48 dp, web.dev 48 px, NN/g 1 cm), the AAA 44 px criterion and the 16 px input rule are advisory: they back a finding only through a confirmed `PR-` row and otherwise go to improvements. Values marked "skill-chosen" are test inputs this skill picked, not published numbers; reports label them as such. [SOURCES.md](SOURCES.md) holds each rule id's statement and source.

## Core discipline (goes into every prompt that uses this file)

```
- A layout finding is a geometric fact measured in a named viewport, theme and data state: an offender selector with coordinates, a clipped string, a covered control, a measured target size. A screenshot alone, or "looks cramped", is not a finding.
- Run the context you claim. A matrix unit is covered only when every (vp, theme) pair has a browser check; a pair not run goes into unresolved as "variant not run: vp=<id>;theme=<t>". The viewport matrix is a sample, not a list of supported devices: breakpoints come from the project's own CSS.
- Every threshold you apply carries a rule id in this file; use that number. Advisory and skill-chosen thresholds never produce a WCAG failure.
- Judge fixed bars, sheets and full-height panels from the viewport-only capture (.view.png), never from the full-page capture, which stretches the viewport and hides the defect.
- Measure the settled page: wait out or freeze polling, carousels and animations, and use the data state the context names (longtext and heavy are fixtures, not hand-typed one-offs).
- Desktop Chromium emulation does not show the real on-screen keyboard, iOS Safari viewport resizing or focus zoom, notches or real rotation. Without the probe's emulation keys, every mobile viewport unit resolves to the same height and insets are 0. Confirm only what emulated viewport, media features, touch and the emulation keys decide; send device-only facts to needs_validation with a device plan.
- Report your self-assessment honestly; ask a consult instead of guessing outside this lens.
```

## Viewport classes (subagent_type: `general`)

**Horizontal overflow and clipping**

Check that the page never scrolls sideways at a supported width and no text or control is cut off without a way to reach it. Pass criterion: `document.documentElement.scrollWidth <= clientWidth`, allowing 1 px for rounding [rule: TOUCH-11]. Content may exceed the viewport only inside a container meant to scroll (data table, agenda grid, carousel with a visible affordance). Text cut by `overflow: hidden` counts as lost information; ellipsis truncation passes only if the full value is reachable (title attribute, detail view, expanding row) [rule: TOUCH-11, WCAG-05].

Probe: `checks.overflow: true` across the unit's matrix. Read `overflow.hasHorizontalScroll`, `overflow.offenders[]` and `overflow.clipped[]`. Offenders usually share one root: report the outermost one outside an intentional scroll container, and find in source the rule that sets its width (a fixed `min-width`, an arbitrary width utility, a grid track without `minmax(0, …)`, a flex child missing `min-width: 0`, an unbroken string). Pair each offender with the `.view.png` of the same capture.

Threshold: any page-level horizontal scroll at a supported viewport fails. Impact is high when the offender is content or a control the task needs, low when it is a few pixels of decoration.

Automation cannot judge: whether a scroll container is intended, and text metrics in other engines. A one- or two-pixel margin in Chromium is `needs_validation` for Firefox and WebKit.

Example (Brasero): `matrix:core;role=owner;data=typical` on `/admin/reservas` with six terrace tables. The booking board may scroll inside its container, but the document must not scroll sideways at `m320`.

**Breakpoint pivots**

Check both sides of every breakpoint recon found, and the band between breakpoints: navigation missing on one side before its replacement appears, navigation duplicated at the pivot, a grid going to two columns before cards fit, sidebar plus content overflowing just above the pivot, per-role navigation that overflows only for the role with more sections. Breakpoints are tested at `breakpoint - 1` and `breakpoint` [rule: TOUCH-16]. Size and input are separate questions: a layout must not treat a narrow width as "touch" or a wide one as "mouse", since a 1024 px tablet has a coarse pointer and a narrow desktop window has a fine one [rule: TOUCH-24].

Probe: recon lists breakpoints in architecture.md from the project's CSS (utility prefixes and their configured values, `@media` and container queries, `matchMedia` calls). When the project keeps a CSS framework's defaults, the values are the framework's (Tailwind v4: 640, 768, 1024, 1280, 1536; Bootstrap 5.3: 576, 768, 992, 1200, 1400) [rule: TOUCH-16]. The parent declares `p<width-1>` and `p<width>` in `metadata.viewports`, and units use `matrix:pivot`. Compare each pair: navigation present exactly once, `overflow` clean, the main task control visible in `.view.png`. Where the shell keeps state across the pivot (a collapsed rail, an open drawer), also capture after a `rotate` step or in a wider pivot and check the state survives or resets as the source intends. `scan` for `max-width` media blocks that only enlarge hit areas: those belong under `(pointer: coarse)` [rule: TOUCH-24].

Threshold: a pivot that hides the only navigation or a core control is high; duplicated or misaligned navigation that blocks nothing is low or medium by task.

Automation cannot judge: whether a layout change at a pivot is the intended design; compare it with the source's intent before reporting.

Example (Brasero): the shell pivots at the `md` breakpoint (768 px). Run `p767` and `p768` for `owner` (nine sections) and `employee` (six), whose "Más" tabs differ, plus the collapsed rail (`html[data-sidebar=collapsed]`) at `p768`.

**Reflow, zoom and text spacing**

Check:

- WCAG 1.4.10 (AA): content that scrolls vertically is usable at 320 CSS px wide with no two-dimensional scrolling, and content that scrolls horizontally is usable at 256 CSS px tall. 320 px is a 1280 px window at 400 % zoom; 256 px is 1024 px at 400 %. Maps, diagrams, video, games, presentations, data tables and toolbars that must stay in view are exempt for the part that needs two dimensions; the headings, search and pagination around them still reflow, and so do the cells of a table [rule: WCAG-05, TOUCH-11, TOUCH-12].
- WCAG 1.4.4 (AA): text resized to 200 % loses no content or function, including the steps in between; captions and images of text are exempt [rule: WCAG-04, TOUCH-13].
- WCAG 1.4.12 (AA): no clipping, overlap or lost control when line height 1.5 times the font size, paragraph spacing 2 times, letter spacing 0.12 times and word spacing 0.16 times are applied together. These are values the content must tolerate, not targets for the design [rule: WCAG-06, TOUCH-14].
- Every HTML document carries a viewport meta whose `content` includes `width=device-width` [rule: TOUCH-09]. It never contains `user-scalable=no` or `user-scalable=0`, and never sets `maximum-scale` below 2; a value of at least 5 is recommended [rule: TOUCH-10].

Probe: capture `r320` (320×256) and `m320` and check in `.view.png` that a form can be filled and submitted with vertical scrolling only. Set `checks.zoom` to `200`, then `400` (contexts `zoom=200`, `zoom=400`) and read `zoom.overflow`. Set `checks.textSpacing: true` and read `textSpacing.overflowAfter` and `textSpacing.clippedAfter[]`. Read `structure.metaViewport` on every route and trace it to its source: in Next.js the `viewport` export of the root layout; in Nuxt the app head config; in SvelteKit `src/app.html`; in Astro the shared layout; in React Router or Remix the root route's meta; in Angular, Vite and plain static sites the `index.html`. When axe ran, `meta-viewport` (WCAG) and `meta-viewport-large` (best practice) give the same verdict independently [rule: TOUCH-10]. Font sizes set in `vw` or `vh` with no `rem` or `em` term, and a px root font size, defeat text-only resize: record them as a `scan` of the token and global CSS files, reported only with a measured consequence from the zoom or spacing capture [rule: WCAG-04]. In landscape phone captures (`l844`), sum the heights of visible fixed or sticky elements anchored to the top or bottom; above 50 % of `innerHeight` (skill-chosen) is a lead for an advisory improvement, or a failure when it hides content the task needs at `r320` [rule: TOUCH-12].

Threshold: blocked zoom, or a core form unusable at `r320` or 400 %, is an AA failure on a core path: medium at least, high when the task cannot finish. Clipping only after spacing injection is medium on a core path, low elsewhere. The meta viewport rules map to ACT test rules (zoom allowed, zoomed text not clipped), so these checks have a published test definition [rule: WCAG-42].

Automation cannot judge: real browser zoom and text-only zoom settings, and operating-system text scaling, which emulation only approximates. Text-only zoom beyond the 200 % capture, and results near the edge, are `needs_validation`.

Example (Brasero): the checkout dialog of `/mesa/[slug]` at `zoom=400;role=customer`; confirm and payment-method choice must stay reachable by vertical scrolling.

**Orientation and safe areas**

Check:

- WCAG 1.3.4 (AA): no screen is limited to portrait or landscape unless one orientation is essential; failure signals are `screen.orientation.lock(`, a rotation `transform` on `html` or `body` inside an orientation media query, a "rotate your device" message, and main content hidden in one orientation. Rotation keeps state and layout [rule: WCAG-08, TOUCH-15].
- With `viewport-fit=cover`, every element fixed or sticky to a screen edge (header, bottom bar, floating button, toast, banner) pads or offsets by the matching `env(safe-area-inset-*)`; without `viewport-fit=cover` the browser keeps content inside the safe area and no padding is needed [rule: TOUCH-17].
- A full-height container whose bottom edge holds a control (submit, checkout bar, chat input) uses `svh` or `dvh`, not `100vh` or a utility that compiles to it (`h-screen`, `min-h-screen`): on mobile, `vh` does not shrink when the browser toolbars show, so the bottom control can sit under them [rule: TOUCH-18].

Probe: capture `l844` and run a `rotate` step mid-flow with a `screenshot` step on each side; content must scroll, nothing clip, and an open dialog or half-filled form must survive. Inset and unit use is a `scan` for `viewport-fit`, `safe-area-inset`, `100vh`, `h-screen`, `min-h-screen`, `screen.orientation.lock`, each paired with the element it styles. List `position: fixed|sticky` elements touching `top: 0` or `bottom: 0` with a read-only `evaluate`. Then make the defect visible with the probe's emulation keys, which plain Chromium emulation cannot show: `emulation.safeAreaInsets` with `{top: 47, bottom: 34, left: 0, right: 0}` in portrait and `{top: 0, bottom: 34, left: 47, right: 47}` in landscape (skill-chosen values typical of a notched phone) [rule: TOUCH-17], and `emulation.smallViewportHeightDifference: 56` (skill-chosen) [rule: TOUCH-18]. With the inset override, no interactive element's rectangle and no text may enter an inset band; with the height difference, every control anchored to the bottom of a `100vh` or `100lvh` container must end at or above `100svh`. Read `emulationApplied.<key>` in the capture: `"unsupported"` means the browser rejected the experimental command, and the check is a coverage gap for that capture, not a pass. Judge from `.view.png` at `m390` and `m320`, never `.full.png`.

Threshold: a bottom bar covering the primary action at a supported phone width is high; a missing inset on a decorative edge is low. An orientation lock on a core screen without an essential reason is an AA failure; the matching ACT rule covers only locks made with CSS transforms [rule: WCAG-42].

Automation cannot judge: real notch geometry, real dynamic toolbars, real rotation and whether an orientation is essential. When the emulation keys were `"unsupported"` or the user consequence depends on a device, confirm the source fact by `scan` and record `needs_validation` naming device, browser, standalone or in-browser mode, screen and element.

Example (Brasero): the panel tab bar uses `env(safe-area-inset-bottom)` and `main` uses `pb-28`; at `m320` with the inset override, the last row of a long list must clear the tab bar in `.view.png`.

## Content stress classes (subagent_type: `general`)

**Long and unbroken content**

Run each surface with the `longtext` fixture state, which holds a 60-character word with no break opportunity, an 80-character name with spaces, accents, non-ASCII letters and emoji, the largest amount and quantity the domain allows, and HTML-looking text such as `<b>x</b>`. Text must wrap, or truncate with a reachable full value, and never push controls off-screen or overlap a neighbour; text clipped with no route to the full value is lost information [rule: TOUCH-11]. Formatted money must not break between symbol and digits. HTML-looking input renders as literal text.

Probe: the parent builds `longtext` in the agent's tenant. Capture with `checks.overflow: true` at `m320`, `m390` and the unit's matrix; read `overflow.clipped[]` and `structure.badText`. For money, confirm the formatter in source (`Intl.NumberFormat` options or the shared helper) and look in `.view.png` for an amount split across lines.

Threshold: a long value hiding a core control is medium on a core path; an amount that wraps into something a user could misread is high. A complete but ugly wrap is not a finding.

Automation cannot judge: emoji fallback and line breaking in other engines; claims limited to Firefox or WebKit are `needs_validation`.

Example (Brasero): a product named `Supercalifragilisticoespialidoso-sin-espacios` in the menu cart and a total of `$ 99.999.999` at `m320`; neither the cart bar nor the checkout dialog may overflow, and the amount stays on one line.

**Growing lists and internal scroll**

Check that a list that grows with data behaves as defined: the page scrolls normally, or the list scrolls inside a bounded container when a written rule says so. One long list must not stretch neighbouring columns or push later controls out of reach. On touch, a nested scroll area must not trap page scroll, and a horizontal scroller must show that it scrolls.

Probe: use the `heavy` fixture state (200+ items where the domain allows), then `one` and `empty` for contrast, across the unit's matrix. A read-only `evaluate` reports the container's computed `overflow-y`, its `max-height` or bounded height, `scrollHeight` against `clientHeight`, and the heights of neighbouring columns. `scroll` steps on the container and on the page show both are reachable; with `input=touch`, take a `screenshot` step after them. A scroll container that holds no focusable element must still be reachable by keyboard; when axe ran, `scrollable-region-focusable` flags it for [ACCESSIBILITY.md](ACCESSIBILITY.md).

Threshold: this class backs a finding only through a confirmed `PR-` row with a concrete criterion (a maximum height, a row count, "scrolls inside its container") or a reachability failure (a control after the list cannot be reached, page scroll trapped on touch). "The page gets long" alone is an improvement.

Automation cannot judge: iOS momentum and scroll chaining, which are `needs_validation`.

Example (Brasero): the owner's preference "toda lista que puede crecer … debe ser una columna que se desliza dentro de su contenedor con altura máxima" (about 6 rows) becomes a `PR-` row; check the expense list in `/admin/caja` with `data=heavy` against it, and that neighbouring columns still end at the same height.

**Overlap and stacking**

Check that no interactive element is covered by another layer at rest or during a flow: sticky headers, bottom bars, floating buttons, install prompts, toasts, banners, dialogs over sheets. The topmost layer must be the one the user is meant to use, and an open overlay must not bury its own close control. For keyboard focus, at least part of every focused element stays uncovered (WCAG 2.4.11) [rule: TOUCH-22, WCAG-18].

Probe: a read-only `evaluate` calls `document.elementFromPoint` at the centre and corners of each visible interactive element; it is covered when the result is neither the target nor a descendant. `checks.focusWalk: true` gives `focusWalk.stops[].obscured` for focused elements entirely covered by fixed or sticky layers; report keyboard-focus cases under [ACCESSIBILITY.md](ACCESSIBILITY.md) (WCAG 2.4.11), pointer and touch cases here. Run the focus walk at a phone width and at `d1280`, and again with the keyboard approximation of **Dialogs and on-screen keyboard** [rule: TOUCH-22]. Repeat with each optional floating element shown (run the flow that raises the banner, toast or cart bar, then capture).

Threshold: a covered primary action at a supported viewport is high; a covered secondary control, or a partial cover leaving a usable target area, is medium or low by task.

Automation cannot judge: browser-supplied overlays (the iOS toolbar, the Android gesture bar), which are `needs_validation`.

Example (Brasero): `InstallApp` and the order bar on `/mesa/[slug]` at `m320` with items in the cart; the install prompt must never cover "send order".

## Touch and input media classes (subagent_type: `general`)

**Target size and spacing**

Check WCAG 2.5.8 (AA): every pointer target can hold an axis-aligned 24×24 CSS px square, or is spaced so that a circle of 24 px diameter centred on its bounding box intersects no other target and no other undersized target's circle [rule: WCAG-24, TOUCH-01, TOUCH-02]. Before reporting, apply the exceptions: an equivalent control of compliant size on the same page, a target inside a sentence or limited by the line height of surrounding text, a size the browser sets and the author did not change, and an essential or legally required presentation. Targets hidden under a closed overlay are not tested; targets inside an open menu or dialog are. A slider or colour picker is one target. Zoom never excuses a small target, since CSS px do not change with zoom [rule: TOUCH-02].

The advisory ladder, reported as improvements unless a confirmed `PR-` row adopts a value (then the expectation is `repo_rule` and the measurement confirms it):

- 44×44 CSS px: WCAG 2.5.5 (AAA), with no spacing exception [rule: WCAG-25, TOUCH-03].
- Apple platforms: 44×44 pt default and 28×28 pt minimum on iOS and iPadOS, with about 12 pt around bezelled controls and about 24 pt around borderless ones; a pt is taken as a CSS px at `width=device-width`, which is an inference [rule: TOUCH-04, TOUCH-05].
- Android and Material: 48×48 dp with 8 dp between targets, the same 48 px and 8 px for the web per web.dev; precise pointers may use smaller targets [rule: TOUCH-06].
- NN/g: at least 1 cm physical; no CSS px equivalent, so it is cited only to explain the ladder and never measured [rule: TOUCH-07].
- Lighthouse's old 48 px tap-target audit was replaced by the axe `target-size` rule (24 px); do not cite the old audit as current [rule: TOUCH-08].

On mobile viewports, text inputs, selects and textareas render at a computed font size of at least 16 px, because smaller fields make iOS Safari zoom on focus; the fix is the font size, never disabling zoom. This rule is advisory: its source is developer reports, not Apple or WebKit [rule: TOUCH-20].

Probe: `checks.tapTargets: true` gives `tapTargets.under24[]` (raw box under 24 in either axis, before any exception) and, when `viewport.mobile` is true, `tapTargets.under44[]`. Before reporting an `under24` entry, apply the spacing exception by measuring the distance from its centre to every other target rectangle (under 12 px means the circle intersects) and the centre distance to other undersized targets (under 24 px), with a read-only `evaluate`, and record which exception cleared each borderline target. When axe ran with `axe.targetSizeRan: true`, its `target-size` result applies the spacing and largest-unobscured-area rules itself and serves as a second opinion; its incomplete items are manual checks [rule: TOOLS-06]. Run the size checks in a coarse-pointer context (`input=touch`, where `(pointer: coarse)` matches) [rule: TOUCH-24]. Measure the hit area including padding and pseudo-element expansion, not the glyph [rule: TOUCH-06]. Read input font sizes with a read-only `evaluate` of `getComputedStyle(el).fontSize` over `input, select, textarea, [contenteditable]`, excluding checkbox, radio, range and colour inputs, and record `font_size_px` with `pass_if: ">="` and threshold 16 [rule: TOUCH-20].

Threshold: a 2.5.8 failure on a core control is medium, high when a mis-tap changes money or records (adjacent "+" and "−", "accept" beside "cancel"). An input under 16 px is a measured fact whose consequence occurs only in iOS Safari: `needs_validation` with a device plan, unless a confirmed `PR-` row sets the minimum.

Automation cannot judge: the "equivalent" and "essential" exceptions, non-rectangular, rotated or clipped targets (the probe measures bounding rectangles), and iOS focus zoom. 2.5.8 is new in 2.2 and has no ACT test rule; the probe's geometry is the skill's own heuristic and the record says so [rule: WCAG-42].

Example (Brasero): `QuantityControl` on menu items and the `PinPad` keys on `/admin/turno` at `m320;input=touch`.

**Dialogs and on-screen keyboard**

Check that each dialog or sheet fits the smallest supported viewport (title, fields, primary and close actions reachable), scrolls inside itself when taller than the viewport while the page behind stays still, keeps a focused field and its primary action visible above the on-screen keyboard, and restores page scroll position on close [rule: TOUCH-19]. Since Chrome 108 on Android, as on iOS Safari, the keyboard shrinks only the visual viewport by default, so a `position: fixed; bottom: 0` bar and layout-viewport units do not move up with it unless the page opts in through `interactive-widget=resizes-content` in the viewport meta, the VirtualKeyboard API with `env(keyboard-inset-*)`, or `visualViewport` listeners [rule: TOUCH-19]. Fields that take digits, email or URLs bring up the matching keyboard through `type` (`tel`, `email`, `url`, `number`) or `inputmode` (`numeric`, `decimal`, `tel`, `email`); this is advisory and judged in the interface language [rule: TOUCH-21].

Probe: open each dialog with steps at `m320` and `l844`, then take a `screenshot` step. A read-only `evaluate` reports the dialog box against the viewport, its `scrollHeight` against `clientHeight`, and `document.scrollingElement.scrollTop` before and after a `scroll` step inside it, plus the viewport meta's `interactive-widget` value and each field's `type`, `inputmode`, `autocomplete` and accessible name. Two approximations of the keyboard, both skill-chosen at about 40 % of the screen height:

- Layout that resizes (`resizes-content` or a real keyboard that shrinks the layout): the parent declares a reduced-height phone viewport in `metadata.viewports` (for example `kb390`, 390×450, dpr 3, mobile and touch); `click` the last field and check that it and the primary action are on screen in `.view.png`.
- Pages that use `env(keyboard-inset-*)`: set `emulation.virtualKeyboardHeight` (for example 338 at `m390`). This override changes only the inset variables, not `visualViewport`, so it tests those pages and nothing else; read `emulationApplied.virtualKeyboardHeight` first [rule: TOUCH-19].

Threshold: an unreachable primary action in a core-task dialog is high; background scroll bleed is low unless it loses the user's place in a long form. A fixed bottom bar that would cover the focused field under the default visual-viewport behaviour is a lead to confirm on a device.

Automation cannot judge: the real keyboard, `visualViewport` resizing and iOS scroll-into-view, which are `needs_validation` with a plan naming dialog, field and expected visible controls; and whether a field's meaning calls for a numeric keyboard, which is a reviewer's call. Focus trap, Escape and inert background are checked in [ACCESSIBILITY.md](ACCESSIBILITY.md).

Example (Brasero): `CheckoutDialog` on `/mesa/[slug]` at `m320` with transfer enabled, so the bank-accounts block makes it taller; confirm must be reachable and the page behind must not scroll; the phone field should bring up a telephone keyboard.

**Hover versus touch media**

Check that every hover-revealed affordance (row actions, tooltips with needed information, hover menus, `title`-only explanations) is visible or reachable by tap or focus when the primary input cannot hover, and that styles do not stick in their hover state after a tap [rule: TOUCH-23]. Content that appears on hover or focus is dismissible without moving pointer or focus (Escape), hoverable, and persistent until dismissed or no longer valid (WCAG 1.4.13, AA) [rule: WCAG-07, TOUCH-23]. `hover` and `pointer` describe the primary input; `any-hover` and `any-pointer` describe all inputs together. Hover-only decoration belongs under `(hover: hover)`, larger hit areas under `(pointer: coarse)` [rule: TOUCH-24].

Probe: `scan` styles for `:hover` rules and hover utilities that change `opacity`, `visibility`, `display` or `pointer-events` on another element, and script for `mouseenter` or `mouseover` handlers without a matching click or focus handler; list what each controls. Capture with `media.hover: "none"` (emulating `hover: none` and `pointer: coarse` together) and `input=touch`, and compare with a pointer capture; a read-only `evaluate` of `matchMedia` confirms which queries matched. Each revealed control must be visible or reachable by a `click` on its parent; take a `screenshot` step. Check sticky hover with a tap then a `screenshot` step. For 1.4.13, `hover` the trigger, `press` Escape and confirm the content is gone; `hover` the trigger and then the content, and confirm it stays.

Threshold: a needed action reachable only on hover is high on a core task, medium elsewhere; decorative hover is never a finding.

Automation cannot judge: hybrid devices with both touch and a fine pointer, and iOS hover emulation, which are `needs_validation`; a library that attaches hover handlers indirectly can escape the `scan`.

Example (Brasero): order cards on `/admin/pedidos` at `t768;input=touch`; accept, edit and cancel must be reachable without hover.

## Universal moves (they cut across every class above)

- Start from the measurement (overflow, tap targets, text spacing, zoom, elementFromPoint) and only then use the screenshot to describe the user consequence. Trace each offender to its style source as file:line before proposing a fix, and make the regression check a probe config re-running the same capture.
- Sweep each surface through the extremes in one session: `m320` then `r320`, the pivot pair, `l844`, `zoom=400`, text spacing, `data=longtext`, `data=heavy`, `media.hover: "none"`, and the emulation keys for insets, toolbar height and keyboard. One root cause across contexts is one record with `also_affects`.
- The reserved viewports sample common phone, tablet and desktop widths and the 320 px reflow width; they are not a statement of supported devices. Add pivot viewports from the project's own breakpoints, and widths the project names as supported [rule: TOUCH-16].
- Keep runtime noise out of evidence: let `freezeAnimations` and the settle time run, wait out carousels and promo modals unless they are the subject, and capture after polling delivers a stable state.
- Record in each capture which emulation keys were `"applied"`, `"unsupported"` or `"off"`; a check that needed an unsupported key is a coverage gap stated in the unit, never a silent pass.

## Validation rules (checked before any finding from this file is reported)

1. Cite the exact context (viewport ID, theme, input, data state, zoom, emulation keys), the measured value with its threshold, rule id and `pass_if` (`overflow_px`, `target_size_px`, `font_size_px`), the offending selector, and the style source as file:line. A value that meets its own threshold is not a finding.
2. Rule out intent: a container designed to scroll, a carousel, a data table exempt from reflow, or a layout the repository documents as deliberate is not a defect. When a WCAG 1.4.10 exemption depends on content type, name the type. For 2.5.8, name the exception that was ruled out or that cleared the target.
3. Fixed-bar, sheet and full-height findings rest on `.view.png`. A `.full.png` alone, or a capture taken mid-animation or mid-poll, is rejected as evidence.
4. Do not widen reach beyond what was reproduced: a defect seen only at `m320` is not "all phones", and one needing `longtext` or `heavy` data is `segment` unless the domain normally holds such data. A 44 px, 48 px or 16 px miss without a confirmed `PR-` row stays an improvement, cited as `RULE:<id>`; a skill-chosen value (fixed-chrome share, toolbar difference, keyboard height, inset sizes) never backs a record by itself; a `sibling_screen` expectation stays at `low` unless a task outcome differs.
5. Criteria new in WCAG 2.2 handled here (2.4.11 for pointer cover, 2.5.8) have no ACT test rules; the skill's geometry is its own heuristic and the expectation statement says so [rule: WCAG-42].
6. Use `confirmed` only when the hunter and then an independent verifier reproduced the geometry in local Chromium emulation, in the stated context, with promoted captures. Use `needs_validation` when the decisive fact depends on a real device or another engine (on-screen keyboard, `visualViewport`, real notches and toolbars, iOS zoom on focus, Firefox or WebKit metrics, real rotation) or on an emulation key the browser reported `"unsupported"`, naming the device, browser, screen and measurement to take.
