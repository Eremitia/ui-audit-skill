# Accessibility Audit

#### When to use this file

Select this file whenever the application has an interactive interface used by people, which is nearly always; recon then narrows which classes apply. Strong triggers: forms and sign-in screens, custom widgets built on `div`s or on newer platform features (custom selects, comboboxes, PIN pads, calendars, segmented controls, switches), dialogs and overlays, status updates that arrive without navigation (toasts, polling, new-item alerts), colour-coded states, animations or carousels, drag or swipe interactions, sticky headers or bottom bars, help or contact links repeated across pages, and a repository rule that names accessibility.

Neighbouring companions: [RESPONSIVE-AND-LAYOUT.md](RESPONSIVE-AND-LAYOUT.md) owns reflow (1.4.10), text resize and spacing (1.4.4, 1.4.12), orientation (1.3.4) and target size (2.5.8); cite those criteria there, not here. [VISUAL-AND-THEMING.md](VISUAL-AND-THEMING.md) owns theme parity as a visual question; contrast failures in either theme are measured here. [RESILIENCE-AND-STATES.md](RESILIENCE-AND-STATES.md) owns session timeouts as a flow; the 2.2.1 warning requirement is cited from there. [FUNCTIONAL-FLOWS.md](FUNCTIONAL-FLOWS.md) owns which values a form accepts and what it saves; this file owns how errors are labelled and announced.

Standing of the rules in this file. WCAG 2.2 Level A and AA is the pass/fail baseline; Level AAA criteria are advisory and go to improvements unless a confirmed `PR-` row adopts them; WCAG 3 is a Working Draft and never decides a finding [rule: WCAG-02, WCAG-19, WCAG-20, WCAG-25, WCAG-31]. ARIA Authoring Practices patterns are guidance: a deviation is reported under the WCAG criterion it breaks, with the pattern as the reference [rule: WCAG-35]. Every threshold below carries its rule id; [SOURCES.md](SOURCES.md) holds the statement, the source and whether the rule is normative, advisory or a tool fact.

## Core discipline (goes into every prompt that uses this file)

```
- The expectation is a WCAG 2.2 success criterion or an HTML semantics rule, cited as WCAG22#<sc> or HTML#<section>; a platform or tool rule is cited as RULE:<rule-id>. Name the criterion, its level, and what a user with that need cannot do.
- Measure; do not eyeball. Contrast comes from canvas-normalised colours with alpha compositing and no rounding, focus from the probe's focus walk, names and roles from the accessibility tree, motion from running animations. Every threshold you apply carries a rule id in this file; use that number, not a remembered one.
- Test with the input the criterion is about: keyboard only for operability, the accessibility tree for names and states, emulated media for reduced motion, forced colors and contrast preference.
- Automated checks (the probe's own and axe-core's) find part of the problems and prove no conformance. An axe "incomplete" item is a manual check, never a finding and never a pass. Never write "accessible" or "WCAG compliant" as a verdict.
- Real screen-reader announcements, real Windows high-contrast palettes, real password managers and engines other than Chromium are not reproducible locally. Claims about them are needs_validation with a device or owner plan.
- Run in both themes and at the matrix viewports. A pass in light at desktop says nothing about dark at 320 px.
- Report your self-assessment honestly; ask a consult instead of guessing outside this lens.
```

## Perceivable classes (subagent_type: `general`)

**Text and non-text contrast**

Check that text reaches 4.5:1 against its effective background, or 3:1 when it is large (at least 24 CSS px, or at least 18.66 CSS px at weight 700 or more), and that meaningful non-text parts reach 3:1 against the adjacent colour: input boundaries when the boundary is the only cue, focus indicators, icons that carry meaning without text, chart marks, toggle thumbs and selection states (WCAG 1.4.3, 1.4.11). The ratio is never rounded before comparison: 4.49:1 fails 4.5:1 and 2.99:1 fails 3:1 [rule: WCAG-01, WCAG-03].

Probe: enable `checks.contrast` in every theme of the matrix and read `contrast.failures` (selector, text, fg, bg, ratio, required, font size and weight). The probe normalises colours through a 1×1 canvas because computed values may be `oklch()` or `lab()`, composites ancestor backgrounds with their alpha, applies inherited opacity, and compares the unrounded ratio; the `ratio` it writes is rounded to two decimals for display only. Elements over a background image or gradient, and disabled controls, land in `contrast.manual`. Non-text contrast needs a read-only `evaluate` step that reads `border-color`, `outline-color`, SVG `fill` or `stroke` against the adjacent background. When axe ran (`checks.axe` with `--axe`), its `color-contrast` violations are a second opinion and its `color-contrast` incomplete items are manual checks: axe skips text over background images and struggles with gradients, pseudo-element backgrounds and overlapping layers [rule: TOOLS-05]. Record `contrast_ratio` with `pass_if: ">="` and the required ratio as threshold. Placeholder text and focus or hover text are in scope; disabled controls, pure decoration and logotypes are exempt [rule: WCAG-01]. Enhanced contrast (7:1 and 4.5:1) is advisory [rule: WCAG-02].

Automation cannot judge: text over images, gradients, video, translucent layers, `mix-blend-mode` or `backdrop-filter`, and thin anti-aliased glyphs. These need a cropped `.view.png` judgement against the same thresholds; a borderline result is `needs_validation`. Bold text between 18.5 and 18.7 CSS px sits on the edge of the large-text definition and is `needs_validation` rather than a failure [rule: WCAG-01].

Example (Brasero): brand-derived tokens (`on-brand`, `brand-soft`, `chart-1`) must be checked with a seeded tenant brand colour as well as the product default brand colour, in light and dark.

**Text alternatives and names**

Check that every informative image has a text alternative or is marked decorative, that every control has an accessible name, and that a control with visible text has an accessible name containing that text, compared case-insensitively and ignoring punctuation (WCAG 1.1.1, 2.5.3, 4.1.2) [rule: WCAG-11, WCAG-22, WCAG-32].

Probe: read `structure.imagesWithoutAlt` and `structure.unnamedButtons`, and enable `checks.axTree` to read `axTree.unnamedInteractive`; compare each control's AX name with its visible text. Typical cause: an `aria-label` that replaces the visible label. axe rules `image-alt`, `button-name` and `link-name` report presence only.

Automation cannot judge: whether the alternative or name is meaningful. Presence is measurable; quality is a reviewer's call, and a disputed meaning is `needs_validation` [rule: WCAG-11]. A decorative image with `alt=""` is correct; an icon-only button needs a name that says what it does.

Example (Brasero): the notifications bell, the theme toggle, the sidebar rail toggle, quantity steppers in the cart.

**Color as the only signal**

Check that state is never conveyed by colour alone (WCAG 1.4.1): status chips, low-stock or warning marks, free versus taken slots, validation errors, required markers, links inside running text, chart series [rule: WCAG-09].

Probe: reproduce from facts first. Capture the screen with each state present (seeded data, or a fixture state that shows them side by side) and use a read-only `evaluate` that returns, for one element of each state, its visible text, its icon or image (element and accessible name), its `aria-*` and `data-*` state attributes, and its computed `border-style`, `text-decoration`, `font-weight` and position. If the states differ only in `color`, `background-color`, `border-color`, `fill` or `stroke`, colour is the only signal. For a link inside a sentence, compare the link with the surrounding text: no underline and no other non-colour cue means colour alone. To illustrate the result, a final `evaluate` may apply `filter: grayscale(1)` to `html` and be followed by a `screenshot` step; that expression is presentation-only (it writes no application data, storage or cookies and sends no request), so it is allowed under the read-only definition in [SKILL.md](SKILL.md) as long as it is recorded verbatim in the capture and nothing after it is measured.

Automation cannot judge: whether the remaining cue is enough for a person to tell the states apart. The verdict rests on the computed comparison, never on the grayscale image alone; when the non-colour cue exists but is faint, the case is `needs_validation`.

Example (Brasero): the booking board's free and taken slots, and order cards on the board.

**Structure and semantics**

Check that the document structure matches what is shown (WCAG 1.3.1, 1.3.5, 2.4.1, 2.4.2, 2.4.6, 3.1.1): a unique, descriptive `title` per route that changes on client-side navigation, `lang` set to the content language, one `h1`, no skipped heading levels, exactly one `main` landmark, a skip link or landmarks plus headings to bypass repeated blocks, labelled fields, lists in list elements, data tables with header cells [rule: WCAG-11, WCAG-16]. Inputs that collect data about the user carry the matching `autocomplete` token (`name`, `email`, `tel`, `street-address`, `postal-code`, `username`, `current-password`, `new-password`, `one-time-code`) [rule: WCAG-10].

Probe: read `structure` (`title`, `lang`, `h1Count`, `headingSkips`, `landmarks`, `unlabeledFields`) per route; navigate between two routes in one capture and read `title` after each. When axe ran, `html-has-lang`, `html-lang-valid`, `document-title`, `list`, `label`, `autocomplete-valid` and the landmark rules (best practice) add leads; `autocomplete-valid` catches invalid tokens, not missing ones. Never report WCAG 4.1.1 Parsing: it is obsolete in 2.2. A duplicated `id` matters only when it breaks a name or a relationship, and is then reported under 4.1.2 or 1.3.1 [rule: WCAG-34].

Automation cannot judge: whether headings, labels, titles and link text describe their purpose (2.4.4, 2.4.6), and whether the reading order is meaningful. Flag generic link text ("more", "click here", or the same in the interface language) for review; it is a finding only with the context that leaves the purpose unclear [rule: WCAG-16].

Example (Brasero): `<html lang="es">`; the customer's name and phone fields in `GuestForm` should carry `autocomplete="name"` and `autocomplete="tel"`.

**Forced colors and contrast preference**

Check that with `forced-colors: active` every button, input, checkbox, switch, tab and card link keeps a visible boundary (a border or outline wider than 0, or a native control), every focused element keeps a visible indicator, icons stay visible, and selected or current states are not shown only through background colour. In forced colors the browser replaces author colours, drops `box-shadow` and gradient backgrounds, so boundaries and focus rings drawn with shadows (utility `ring-*` classes are shadows) vanish [rule: TOUCH-33]. Check that `prefers-contrast: more` is honoured where the application claims support.

Probe: set `media.forcedColors: "active"` (or `prefersContrast: "more"`), capture the core screens, and use a read-only `evaluate` that returns computed `border-*-width`, `border-*-style`, `outline-width` and `outline-style` for each interactive element and for the focused element after a `press` Tab. The capture's `env.forcedColors` records the emulated value [rule: TOOLS-26].

Automation cannot judge: the user's real high-contrast palette. Chromium applies its own forced palette; a defect that depends on a specific system theme is `needs_validation`. Absence of `prefers-contrast` support is not a defect unless the repository says it supports it.

## Operable classes (subagent_type: `general`)

**Keyboard operation and focus order**

Check that everything works from the keyboard with no trap, in an order that follows the visual order, and that focus or a value change never changes context on its own (WCAG 2.1.1, 2.1.2, 2.4.3, 3.2.1, 3.2.2) [rule: WCAG-12, WCAG-16, WCAG-26]. Single-character shortcuts without a modifier must be possible to turn off or remap, or work only while their component has focus (WCAG 2.1.4) [rule: WCAG-13].

Probe: enable `checks.focusWalk` with `maxFocusStops` at least twice the number of visible interactive elements, and read `focusWalk.stops`, `trapped` and `truncated` [rule: WCAG-12]. Failures: a visible interactive element never reached; focus landing on an invisible or off-screen element; the same element repeating before the end; an order that jumps backward visually by more than one row, or any positive `tabindex`; `trapped` true outside a modal; a `truncated` walk means more stops than the limit, so raise the limit before concluding. Activate the reached controls with `press` steps (Enter, Space, arrow keys for composite widgets). Changing a select or radio must not navigate or submit by itself. For 2.1.4, `press` a single letter with focus on `body` and compare URL and DOM before and after. A click handler on an element with no role and no tab stop, found in source, becomes a finding only with the keyboard path that fails. axe's `scrollable-region-focusable` flags scroll areas a keyboard cannot reach.

Automation cannot judge: whether an order that is technically complete is meaningful (2.4.3); focus order is almost entirely a manual criterion [rule: WCAG-40]. Report a doubtful order as `needs_validation` with the stops in question.

Example (Brasero): `PinPad` on `/admin/turno`, `SegmentedControl`, `Calendar`, and the booking board's slots.

**Focus visibility and obscuring**

Check that the focused element is always visibly indicated (WCAG 2.4.7) and never entirely hidden by author content such as sticky bars, cookie banners, toasts or non-modal panels (WCAG 2.4.11; partial cover passes) [rule: WCAG-17, WCAG-18]. The indicator itself needs 3:1 against its adjacent colours under **Text and non-text contrast** [rule: WCAG-03].

Probe: from the focus walk, `visibleIndicator: false` means the computed outline, box shadow and border did not change between the unfocused and keyboard-focused state; `obscured: true` means every part of the element's rectangle is covered by fixed or sticky layers. Run at the phone viewports, where top bars and bottom tab bars take most of the screen, and again with any banner or toast shown. In source, `outline: none` (or `outline-none`) without a `:focus-visible` replacement explains the cause; the usual fix is `scroll-padding` equal to the sticky bar heights [rule: WCAG-18]. Partial cover (some of the element hidden) is the AAA 2.4.12 criterion and is advisory [rule: WCAG-19]. Focus appearance (2.4.13, AAA) asks for an indicator at least as large as a 2 CSS px perimeter that changes by 3:1 between states; measure it only from lossless captures at dpr 1 and report it as an improvement [rule: WCAG-20].

Automation cannot judge: an indicator that changes in computed style but is too faint to see, or pixel measurements on scaled or compressed images. Both go to a cropped `.view.png` judgement; a borderline case is `needs_validation` [rule: WCAG-20]. 2.4.11 is new in 2.2 and has no ACT test rule, so this check is the skill's own heuristic and the record says so [rule: WCAG-42].

Example (Brasero): Tab through `/admin/pedidos` at m390, where a 56 px sticky top bar and the bottom tab bar can cover focused rows near the edges.

**Dialogs and overlays**

Check modal dialogs against the dialog pattern: focus moves into the dialog on open (the first focusable element, a heading with `tabindex="-1"` for long content, or the least destructive action for an irreversible confirmation), Tab and Shift+Tab stay inside, Escape closes, focus returns to the trigger on close, the background is inert and does not scroll, and the dialog has a role and a name (`aria-labelledby` or `aria-label`) [rule: WCAG-35]. A native `<dialog>` opened with `showModal()` provides the trap, inertness and Escape; verify that the application did not break them (an Escape handler that cancels close, a custom focus loop that leaks). Content shown on hover or focus (tooltips, popovers) must be dismissible without moving the pointer or focus, hoverable, and persistent until dismissed or no longer valid (WCAG 1.4.13) [rule: WCAG-07].

Probe: `click` the trigger, `press` Tab two more times than the dialog has focusable children, read `document.activeElement` through a read-only `evaluate` after each phase, `press` Escape, and read it again. Read the AX tree for the dialog's role, `modal` property and name. For 1.4.13, `hover` the trigger, `press` Escape and confirm the content is gone; `hover` the trigger, then `hover` the content itself and confirm it stays; `wait` 5 s and confirm it has not timed out.

Automation cannot judge: how a screen reader announces the dialog on open, and whether the element chosen for initial focus suits the content. Both are `needs_validation` when decisive.

Example (Brasero): `CheckoutDialog` at m320, `PromoModal`, and the charge and cancel dialogs on the orders board while a live refresh runs underneath.

**Motion and timing**

Check that anything moving, blinking or scrolling that starts by itself, lasts more than 5 seconds and sits beside other content can be paused, stopped or hidden, and that auto-updating content can be paused or controlled (WCAG 2.2.2); that nothing flashes more than 3 times in any one second (WCAG 2.3.1) [rule: WCAG-15, TOUCH-30, TOUCH-31]. Under `prefers-reduced-motion: reduce`, non-essential motion caused by interaction should stop or become a fade: no running animation or transition that moves, scales or rotates content, and `scroll-behavior` back to `auto`. That is 2.3.3 (AAA) and advisory, unless a confirmed `PR-` row commits to reduced motion, in which case it is a `repo_rule` finding [rule: TOUCH-29]. Time limits that can lose work belong to 2.2.1 under [RESILIENCE-AND-STATES.md](RESILIENCE-AND-STATES.md) (turn off, adjust to at least 10 times the default, or warn with at least 20 seconds to extend) [rule: WCAG-14].

Probe: set `reducedMotion: true` and, for this check only, `freezeAnimations: false`, otherwise the probe's injected freeze hides the defect. Read `document.getAnimations()` with a read-only `evaluate` at t = 0 and again after a `wait` of 6000 ms, recording for each running animation its target, duration, iteration count and the animated properties (`transform`, `translate`, `scale`, `rotate`, `top`, `left`); take a `screenshot` step at both times. A region that still changes after 5 s needs a visible pause or stop control nearby; stopping only under reduced motion does not satisfy 2.2.2 by itself [rule: TOUCH-30]. Animation libraries that read the preference in script (a `useReducedMotion` hook, a `matchMedia` guard) need a source check as well [rule: TOUCH-29].

Automation cannot judge: real flash frequency and luminance (the probe can only flag animations with an iteration under 333 ms that change opacity, colour or background; every such flag is `needs_validation`) [rule: TOUCH-31], and whether a motion is essential. The split "movement must stop, opacity and colour may stay" is this skill's reading of the technique, not a W3C number [rule: TOUCH-29].

Example (Brasero): the promo carousels advance every 6 s and `useCarousel` claims to respect reduced motion; the project rules require `prefers-reduced-motion` support, so a carousel that keeps moving under reduce is a `repo_rule` finding.

**Pointer gestures and cancellation**

Check four pointer criteria. Multipoint or path-based gestures (pinch, two-finger actions, swipe that depends on direction, drawn shapes) have a single-pointer alternative without a path, unless the gesture is essential (WCAG 2.5.1, A) [rule: WCAG-21, TOUCH-25]. Single-pointer actions do not run on the down-event: they complete on release with a way to abort (moving off before release) or undo, or the release reverses the press, unless acting on press is essential (WCAG 2.5.2, A) [rule: WCAG-21, TOUCH-27]. Features triggered by shaking or tilting the device have an on-screen control and can be switched off (WCAG 2.5.4, A) [rule: TOUCH-28]. Every function that uses dragging (reordering, sliders, kanban moves, drag-to-upload) can be done with single clicks or taps, and a keyboard alternative alone does not satisfy this; native browser scrolling is out of scope, author-built scrolling is in scope (WCAG 2.5.7, AA) [rule: WCAG-23, TOUCH-26].

Probe and source: `scan` for `touchstart`, `touchmove`, `pointermove`, gesture and carousel libraries, `draggable`, drag-and-drop libraries and custom range controls, and for `onPointerDown`, `onMouseDown` or `onTouchStart` handlers that navigate, submit, delete or toggle; `scan` for `devicemotion`, `deviceorientation` and sensor APIs. For each gesture or drag feature, try to complete the same function with `click` steps only (buttons, a menu, a select, a tap on a slider track) at an `input=touch` viewport, take a `screenshot` step, and compare the state before and after. A carousel or swipeable list needs visible previous, next or delete controls. The probe has no step that presses without releasing, so 2.5.2 is judged from the handler in source: it is confirmed when the down handler performs the action unconditionally and nothing defers or reverses it, and `needs_validation` otherwise.

Automation cannot judge: whether a gesture, a drag or acting on press is essential, and whether a library attaches handlers indirectly (a clean `scan` proves nothing). 2.5.7 is new in 2.2 and has no ACT test rule; this check is the skill's own heuristic and the record says so [rule: WCAG-42].

Example (Brasero): category reordering in settings needs a non-drag path, and promo carousels need buttons that do what a swipe does.

## Understandable and robust classes (subagent_type: `general`)

**Form labels, errors and help**

Check that every field has a programmatic label or instruction, that a detected error is identified in text next to the field, that the field is marked invalid (`aria-invalid="true"`) and points to its message (`aria-describedby` or `aria-errormessage`), that a known correction is suggested, that focus or an announcement leads to the first error on submit, and that legal, money and data-changing submissions are reversible, checked, or reviewed and confirmed before they commit (WCAG 1.3.1, 3.3.1, 3.3.2, 3.3.3, 3.3.4) [rule: WCAG-28]. Within one process, what the user already entered or was given must be filled in again for them or offered for selection; browser autofill does not count, and a server-side validation error must not clear what the user typed (WCAG 3.3.7, A) [rule: WCAG-29].

Probe: drive the form with `fill` steps using boundary values from [FUNCTIONAL-FLOWS.md](FUNCTIONAL-FLOWS.md), submit, then read `aria-invalid`, `aria-describedby`, `aria-errormessage` and the focused element through a read-only `evaluate`, and the AX tree for the error text (`invalid` without a `describedby` or `errormessage` relation is an unexplained error) [rule: TOOLS-25]. For 3.3.7, step forward through each multi-step flow and force one validation error; after each step, read the values of fields that reappear. Submission steps mutate data, so run them only in your own tenant.

Automation cannot judge: whether the error text helps the user fix the input, and what counts as "the same process" for 3.3.7. 3.3.7 is new in 2.2 and has no ACT test rule; the check is the skill's own heuristic and the record says so [rule: WCAG-42].

Example (Brasero): `GuestForm` (name 2 to 40 characters, phone 7 to 15 digits) and the product form's price and stock fields.

**Status messages and live regions**

Check that results, progress, waiting states and errors that appear without moving focus are exposed to assistive technology (WCAG 4.1.3): "added to cart", "saved", "sent", errors, and new items that arrive through polling [rule: WCAG-33]. Expected: `role="status"` or `aria-live="polite"` for routine messages, `role="alert"` or an assertive region only for important, time-sensitive errors, `role="log"` for sequences, a progressbar for progress. The live region must already exist in the DOM before its text changes; a region inserted together with its text, or an alert present at page load, is often not announced. Focus must not move. A toast must not take focus, must not fully cover the focused element, and when it carries information or an action that exists nowhere else and disappears on a timer it must meet 2.2.1 (and its action must be reachable by keyboard while it is shown) [rule: WCAG-39, WCAG-14].

Probe: read the AX tree before and after the event, and a read-only `evaluate` that reads the region's role and `aria-live` before the triggering step and its text after. Record the toast's visible duration from two `screenshot` steps a known `wait` apart. A dialog that takes focus, or an expanding menu, is not a status message (those are 4.1.2).

Automation cannot judge: whether a given screen reader speaks the message, and how. DOM inspection proves the markup, not the announcement: that part is always `needs_validation` [rule: WCAG-33].

Example (Brasero): the new-order chime has a visual alert; check that the same arrival also updates a live region and is not conveyed only by sound.

**Custom widget roles and states**

Check that custom widgets expose a role, a name and their current state, and that states update when the user acts (WCAG 4.1.2) [rule: WCAG-32]: `aria-expanded` on disclosure and menu triggers, `aria-pressed` or `aria-checked` on toggles and switches, `aria-selected` on tabs and options, the value of steppers and sliders. Composite widgets follow their pattern's keyboard contract. Tabs: one tab in the Tab sequence, arrow keys move between tabs, exactly one tab has `aria-selected="true"` and its `aria-controls` panel is shown [rule: WCAG-36]. Menu button: `aria-haspopup` and `aria-expanded`, arrow keys move between items, Escape closes and returns focus to the button; a `role="menu"` whose items are plain links without `menuitem` roles or arrow-key support is a candidate [rule: WCAG-37]. Combobox: DOM focus stays on the input, `aria-expanded` follows the popup, `aria-activedescendant` points to an existing option, Enter accepts, Escape closes [rule: WCAG-38].

Probe: read the AX tree before and after each interaction step and compare; drive composite widgets with `press` steps (arrow keys, Home, End, Enter, Escape) and read `document.activeElement` and the `aria-*` state through a read-only `evaluate` after each. Nodes with role `generic` that act as controls, or interactive nodes with an empty name, are candidates. When axe ran, `aria-*` validity rules and `nested-interactive` add leads.

Automation cannot judge: assistive-technology behaviour across screen readers, and engines other than Chromium. Widgets built on newer platform features may behave differently in Firefox or WebKit; Chromium results do not prove their behaviour, which is `needs_validation`.

Example (Brasero): the `[data-select]` select styled with `appearance: base-select`, `Combobox`, `Switch`, `QuantityControl` and the `SegmentedControl` on the balance range bar.

**Accessible authentication**

Check that no step of signing in, of a second factor or of account recovery relies on a cognitive test (recalling, transcribing or manipulating information, solving a puzzle) unless the step offers another method or a mechanism that assists, such as paste and password-manager autofill (WCAG 3.3.8, AA) [rule: WCAG-30]. Failure signals: paste blocked in a username, password or code field; scripts that clear autofilled values or randomise field names; "enter characters 2, 4 and 7 of your password"; a one-time code split across single-digit inputs that do not accept a full paste; a text or arithmetic challenge with no alternative. Account creation is out of scope. The enhanced 3.3.9 (AAA) also removes the object-recognition exception and is advisory [rule: WCAG-31].

Probe: check paste with a `fill` step using `valueFrom` an account field and confirm the whole value arrives (for split code inputs, that it spreads across the boxes); read `onpaste` handlers in source; read `autocomplete` on each field (`username`, `current-password`, `one-time-code`). Do not submit the login form outside a dedicated `audit-login` unit; read the form, and submit only in that unit's final wave. Repeated failed logins to see whether a challenge appears run only against the disposable environment with throwaway accounts.

Automation cannot judge: real password-manager autofill, which is `needs_validation`. 3.3.8 is new in 2.2 and has no ACT test rule; the check is the skill's own heuristic and the record says so [rule: WCAG-42].

Example (Brasero): the account login is a normal email and password form; the 4-digit PIN on `/admin/turno` is entered through `PinPad` buttons, so judge whether a text input or another assisting mechanism exists and record what a password manager could fill.

**Consistent navigation and help**

Check that navigation repeated across a set of pages keeps the same relative order (WCAG 3.2.3, AA), that components with the same function carry the same name and icon on every page (WCAG 3.2.4, AA) [rule: WCAG-26], and that help mechanisms offered on several pages (contact details, a contact form or chat, a help or FAQ page, a messaging link, a `tel:` or `mailto:` link, an automated assistant) appear in the same order relative to the other shared content on each of those pages (WCAG 3.2.6, A). Help is not required; this criterion only asks that it does not move. Order is judged by DOM order, not visual position, and a change caused by the user (zoom, rotation, a different viewport) is allowed [rule: WCAG-27].

Probe: for every route in the set, at the same viewport and role, run a read-only `evaluate` that returns the ordered accessible names and `href`s of the items inside the `nav` landmark(s), the index of each help mechanism within the sequence of shared regions (header items, navigation, main, footer items), and the accessible names of controls that share an `href` or a handler across pages. Compare the sequences: an item that changes position, a help link that moves to a different region, or one function with two names is a candidate.

Automation cannot judge: which pages form one "set" and whether two controls really perform the same function. The reviewer names the set and the function in the record. 3.2.6 is new in 2.2 and has no ACT test rule; the check is the skill's own heuristic and the record says so [rule: WCAG-42].

Example (Brasero): the owner and employee panels share a shell whose sections differ by role; compare order within one role across its sections, never across roles.

## Universal moves (they cut across every class above)

- Pair each automated flag with the user it fails: a keyboard user who cannot reach the cart, a low-vision user who cannot read a badge in dark mode, a screen-reader user who never hears the order was sent. A flag without that sentence is an improvement note.
- When axe ran, read `axe.available`, `axe.version` and `axe.targetSizeRan` first. Every entry in `axe.violations` is a lead to explain and reproduce with the probe's own facts; every entry in `axe.incomplete` is a manual check, never a finding and never a pass [rule: TOOLS-01]. Axe's `impact` (`minor`, `moderate`, `serious`, `critical`) is a starting point for severity, never the final word [rule: TOOLS-02]. WCAG 2.2, AAA and experimental axe rules are off unless enabled; the probe enables the WCAG 2.2 AA tag and `target-size`, so a missing `targetSizeRan` is a coverage gap, not a pass [rule: TOOLS-03].
- Axe and the probe see only the DOM state at capture time. Open menus, dialogs, error states and every other UI state need their own capture with `checks.axe` on; a state without one is not covered [rule: TOOLS-08].
- Check the same widget everywhere it is used. One root cause in a shared primitive is one record with `also_affects`, and the fix belongs in the primitive.
- Prefer the AX tree and computed facts over source reading for the verdict, and source for the cause; cite both.
- Every `evaluate` named in this file reads: it returns attributes, computed styles, `document.activeElement` or `document.getAnimations()` and changes nothing. The single presentation-only exception is the grayscale illustration under **Color as the only signal**. An expression that writes application data, storage or cookies, sends a request, dispatches events, or changes what a later measurement reads is not read-only as [SKILL.md](SKILL.md) defines it, and a capture that depends on it is not evidence.

## Validation rules (checked before any finding from this file is reported)

1. The expectation names a WCAG 2.2 criterion or HTML rule with its level, and the record shows the failing element, the context (viewport, theme, input modality, media features) and the artifact that proves it: a capture JSON, an AX tree file, a focus walk or a screenshot.
2. Contrast and target measurements carry `contrast_ratio` or `target_size_px` with the required threshold and `pass_if`, and the value fails it without rounding [rule: WCAG-01, WCAG-03]. Elements marked `manual` by the probe need a cropped screenshot and a ratio the verifier can recompute.
3. Rule out exemptions before reporting: disabled controls, purely decorative content, logotypes, essential motion or gestures, inline links inside sentences for target size, and content the repository documents as intentionally decorative.
4. An axe `incomplete` item is never a finding by itself and never counts as a pass; it becomes a finding only after the probe's own measurement or a reviewer's reading confirms the failure [rule: TOOLS-01]. No record, summary or improvement may claim conformance or call a screen "accessible": automated checks catch a minority to a little over half of the barriers depending on the study, so the report states what was checked automatically and which manual checks remain [rule: TOOLS-07, WCAG-40, WCAG-41].
5. Criteria new in WCAG 2.2 (2.4.11, 2.4.12, 2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8, 3.3.9) have no ACT test rules; the skill's checks for them are its own heuristics, and the expectation statement of every such record says so [rule: WCAG-42].
6. AAA criteria (1.4.6, 2.3.3, 2.4.12, 2.4.13, 2.5.5, 3.3.9) and platform guidance go to improvements unless a confirmed `PR-` row adopts them; WCAG 3 draft content is informative only and never backs a record. WCAG 4.1.1 is never cited [rule: WCAG-34].
7. Severity follows the criterion and the path: a level-A failure on a core path is `high`; an AA failure off the core path, or one with an equivalent accessible alternative, is `medium`. Do not raise severity for the number of affected elements; raise reach instead.
8. Use `confirmed` only when the failure is reproduced in Chromium with the stated input and media, and the verifier reproduces it independently (for 2.5.2, the verifier independently reads the same handler). Use `needs_validation` when the decisive fact is real screen-reader output, a real system high-contrast palette, a real password manager, the on-screen keyboard, the quality or meaning of text, whether something is essential, or behaviour in Firefox, WebKit or iOS Safari.
