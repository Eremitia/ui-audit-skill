# Sources and rule index

Every threshold, tool behaviour and host fact that ui-audit relies on is listed here once, with the public
documents it comes from. The lens files, the orchestration rules and the reports point at this file instead
of repeating links. All sources were read on 2026-10-16; a statement the research could not confirm on the
page says so in its row.

## 1. How to cite

- **Inline in skill files.** After the sentence that states a threshold or a behaviour, cite one or more
  rule ids in square brackets after the word `rule:`, separated by a comma and a space, for example
  `[rule: WCAG-24]` or `[rule: VITALS-02, VITALS-16]`. A rule id is an upper-case prefix (letters and digits,
  starting with a letter, such as `E2E`), a hyphen and two or three digits. Companion files cite rule ids
  only, never raw URLs.
- **In findings and ledger units.** An expectation whose `source_kind` is `budget`, `standard` or
  `platform_contract` may use the ref `RULE:<id>` (for example `RULE:VITALS-02`). A WCAG success criterion
  keeps its own ref form `WCAG22#<sc>`, which is preferred when it applies.
- **Rule ids** keep the numbering of the research notes (WCAG-01..42, VITALS-01..30, FRAMEWORKS-01..86,
  E2E-01..32, UX-01..42, TOUCH-01..33, TOOLS-01..40, CLAUDE-01..37) so that each one can be traced back.
  Statements in the index are restated in this skill's own words.
- **Kinds.** `normative`: a requirement of WCAG 2.2 Level A or AA, or a published field threshold the skill
  grades against; it can back a confirmed finding on its own. `advisory`: guidance (AAA criteria, platform
  design guides, framework documentation, UX research, testing practice); it backs a finding only through a
  measured user consequence or a project rule that adopts it, and otherwise goes to improvements. `tool-fact`:
  how a tool behaves or what it can measure. `host-fact`: how the agent host (Claude Code) behaves.
- **Checks in tests.** The repository test checks that every cited id exists below, that every index row
  names at least one source id from the bibliography, and that every bibliography entry is used by a row.

## 2. Bibliography

| Source id | Title | Publisher | URL | Read on |
|---|---|---|---|---|
| wcag22 | Web Content Accessibility Guidelines (WCAG) 2.2 | W3C | https://www.w3.org/TR/WCAG22/ | 2026-10-16 |
| wcag22-whats-new | What's New in WCAG 2.2 | W3C WAI | https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ | 2026-10-16 |
| wcag22-iso | WCAG 2.2 Approved as an ISO Standard | W3C WAI | https://www.w3.org/WAI/news/2025-10-21/wcag22-iso | 2026-10-16 |
| wcag3-intro | WCAG 3 Introduction | W3C WAI | https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/ | 2026-10-16 |
| wcag3-draft | W3C Accessibility Guidelines (WCAG) 3.0, Working Draft | W3C | https://www.w3.org/TR/wcag-3.0/ | 2026-10-16 |
| wcag22-u-contrast-minimum | Understanding SC 1.4.3: Contrast (Minimum) | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | 2026-10-16 |
| wcag22-u-non-text-contrast | Understanding SC 1.4.11: Non-text Contrast | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | 2026-10-16 |
| wcag22-u-resize-text | Understanding SC 1.4.4: Resize Text | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html | 2026-10-16 |
| wcag22-u-reflow | Understanding SC 1.4.10: Reflow | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/reflow.html | 2026-10-16 |
| wcag22-u-text-spacing | Understanding SC 1.4.12: Text Spacing | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html | 2026-10-16 |
| wcag22-u-content-on-hover-or-focus | Understanding SC 1.4.13: Content on Hover or Focus | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html | 2026-10-16 |
| wcag22-u-orientation | Understanding SC 1.3.4: Orientation | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/orientation.html | 2026-10-16 |
| wcag22-u-focus-visible | Understanding SC 2.4.7: Focus Visible | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html | 2026-10-16 |
| wcag22-u-focus-not-obscured-minimum | Understanding SC 2.4.11: Focus Not Obscured (Minimum) | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html | 2026-10-16 |
| wcag22-u-focus-appearance | Understanding SC 2.4.13: Focus Appearance | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html | 2026-10-16 |
| wcag22-u-label-in-name | Understanding SC 2.5.3: Label in Name | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html | 2026-10-16 |
| wcag22-u-dragging-movements | Understanding SC 2.5.7: Dragging Movements | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html | 2026-10-16 |
| wcag22-u-target-size-minimum | Understanding SC 2.5.8: Target Size (Minimum) | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | 2026-10-16 |
| wcag22-u-target-size-enhanced | Understanding SC 2.5.5: Target Size (Enhanced) | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html | 2026-10-16 |
| wcag22-u-consistent-help | Understanding SC 3.2.6: Consistent Help | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html | 2026-10-16 |
| wcag22-u-redundant-entry | Understanding SC 3.3.7: Redundant Entry | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html | 2026-10-16 |
| wcag22-u-accessible-authentication-minimum | Understanding SC 3.3.8: Accessible Authentication (Minimum) | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html | 2026-10-16 |
| wcag22-u-status-messages | Understanding SC 4.1.3: Status Messages | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html | 2026-10-16 |
| wcag22-u-timing-adjustable | Understanding SC 2.2.1: Timing Adjustable | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html | 2026-10-16 |
| wcag22-u-error-prevention | Understanding SC 3.3.4: Error Prevention (Legal, Financial, Data) | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html | 2026-10-16 |
| wcag22-u-pointer-gestures | Understanding SC 2.5.1: Pointer Gestures | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html | 2026-10-16 |
| wcag22-u-pointer-cancellation | Understanding SC 2.5.2: Pointer Cancellation | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html | 2026-10-16 |
| wcag22-u-motion-actuation | Understanding SC 2.5.4: Motion Actuation | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html | 2026-10-16 |
| wcag22-u-animation-from-interactions | Understanding SC 2.3.3: Animation from Interactions | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html | 2026-10-16 |
| wcag22-u-pause-stop-hide | Understanding SC 2.2.2: Pause, Stop, Hide | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html | 2026-10-16 |
| wcag22-u-three-flashes | Understanding SC 2.3.1: Three Flashes or Below Threshold | W3C WAI | https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html | 2026-10-16 |
| act-rules | All ACT Rules | W3C WAI | https://www.w3.org/WAI/standards-guidelines/act/rules/ | 2026-10-16 |
| wai-selecting-tools | Selecting Web Accessibility Evaluation Tools | W3C WAI | https://www.w3.org/WAI/test-evaluate/tools/selecting/ | 2026-10-16 |
| apg-read-me-first | ARIA Authoring Practices Guide: Read Me First | W3C WAI | https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/ | 2026-10-16 |
| apg-dialog-modal | Dialog (Modal) Pattern | W3C WAI | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ | 2026-10-16 |
| apg-tabs | Tabs Pattern | W3C WAI | https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ | 2026-10-16 |
| apg-menu-button | Menu Button Pattern | W3C WAI | https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ | 2026-10-16 |
| apg-menubar | Menu and Menubar Pattern | W3C WAI | https://www.w3.org/WAI/ARIA/apg/patterns/menubar/ | 2026-10-16 |
| apg-combobox | Combobox Pattern | W3C WAI | https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ | 2026-10-16 |
| apg-alert | Alert Pattern | W3C WAI | https://www.w3.org/WAI/ARIA/apg/patterns/alert/ | 2026-10-16 |
| mq4 | Media Queries Level 4 (hover and any-hover) | W3C | https://www.w3.org/TR/mediaqueries-4/#hover | 2026-10-16 |
| w3c-i18n-date-formats | Date formats (Internationalization Q&A) | W3C | https://www.w3.org/International/questions/qa-date-format | 2026-10-16 |
| whatwg-canvas | HTML Standard: the canvas element | WHATWG | https://html.spec.whatwg.org/multipage/canvas.html | 2026-10-16 |
| axe-core-readme | axe-core README | Deque Systems | https://github.com/dequelabs/axe-core | 2026-10-16 |
| axe-api | axe-core API documentation | Deque Systems | https://github.com/dequelabs/axe-core/blob/develop/doc/API.md | 2026-10-16 |
| axe-rule-descriptions | axe-core Rule Descriptions | Deque Systems | https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md | 2026-10-16 |
| axe-rule-development | axe-core Rule development | Deque Systems | https://github.com/dequelabs/axe-core/blob/develop/doc/rule-development.md | 2026-10-16 |
| deque-coverage-study | Automated Testing Study Identifies 57 Percent of Digital Accessibility Issues | Deque Systems | https://www.deque.com/automated-accessibility-testing-coverage/ | 2026-10-16 |
| deque-glossary | Glossary, axe DevTools for Web | Deque Systems | https://docs.deque.com/devtools-for-web/4/en/glossary | 2026-10-16 |
| deque-axe-color-contrast | Elements must meet minimum color contrast ratio thresholds (axe 4.11) | Deque University | https://dequeuniversity.com/rules/axe/4.11/color-contrast | 2026-10-16 |
| deque-axe-target-size | All touch targets must be 24px large, or leave sufficient space (axe 4.11) | Deque University | https://dequeuniversity.com/rules/axe/4.11/target-size | 2026-10-16 |
| deque-axe-meta-viewport | Zooming and scaling must not be disabled (axe 4.10, meta-viewport) | Deque University | https://dequeuniversity.com/rules/axe/4.10/meta-viewport | 2026-10-16 |
| npm-axe-core | axe-core package metadata | npm registry | https://registry.npmjs.org/axe-core/latest | 2026-10-16 |
| npm-axe-core-playwright | @axe-core/playwright package metadata | npm registry | https://registry.npmjs.org/@axe-core/playwright/latest | 2026-10-16 |
| npm-lighthouse | lighthouse package metadata | npm registry | https://registry.npmjs.org/lighthouse/latest | 2026-10-16 |
| npm-eslint-plugin-jsx-a11y | eslint-plugin-jsx-a11y package metadata | npm registry | https://registry.npmjs.org/eslint-plugin-jsx-a11y/latest | 2026-10-16 |
| gds-tool-audit | How do automated accessibility checkers compare? | UK Government Digital Service | https://alphagov.github.io/accessibility-tool-audit/ | 2026-10-16 |
| gds-blog-tool-test | What we found when we tested tools on the world's least-accessible webpage | UK Government Digital Service | https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/ | 2026-10-16 |
| govuk-error-summary | Error summary | GOV.UK Design System | https://design-system.service.gov.uk/components/error-summary/ | 2026-10-16 |
| govuk-error-message | Error message | GOV.UK Design System | https://design-system.service.gov.uk/components/error-message/ | 2026-10-16 |
| govuk-validation | Validation | GOV.UK Design System | https://design-system.service.gov.uk/patterns/validation/ | 2026-10-16 |
| webdev-vitals | Web Vitals | Google (web.dev) | https://web.dev/articles/vitals | 2026-10-16 |
| webdev-cwv-thresholds | How the Core Web Vitals metrics thresholds were defined | Google (web.dev) | https://web.dev/articles/defining-core-web-vitals-thresholds | 2026-10-16 |
| webdev-lcp | Largest Contentful Paint (LCP) | Google (web.dev) | https://web.dev/articles/lcp | 2026-10-16 |
| webdev-inp | Interaction to Next Paint (INP) | Google (web.dev) | https://web.dev/articles/inp | 2026-10-16 |
| webdev-optimize-inp | Optimize Interaction to Next Paint | Google (web.dev) | https://web.dev/articles/optimize-inp | 2026-10-16 |
| webdev-cls | Cumulative Layout Shift (CLS) | Google (web.dev) | https://web.dev/articles/cls | 2026-10-16 |
| webdev-inp-becomes-cwv | Interaction to Next Paint becomes a Core Web Vital on March 12 | Google (web.dev) | https://web.dev/blog/inp-cwv-march-12 | 2026-10-16 |
| webdev-ttfb | Time to First Byte (TTFB) | Google (web.dev) | https://web.dev/articles/ttfb | 2026-10-16 |
| webdev-fcp | First Contentful Paint (FCP) | Google (web.dev) | https://web.dev/articles/fcp | 2026-10-16 |
| webdev-long-tasks | Are long JavaScript tasks delaying your Time to Interactive? | Google (web.dev) | https://web.dev/articles/long-tasks-devtools | 2026-10-16 |
| webdev-lab-field | Why lab and field data can be different (and what to do about it) | Google (web.dev) | https://web.dev/articles/lab-and-field-data-differences | 2026-10-16 |
| webdev-lcp-inp-baseline | LCP and INP are now Baseline Newly available | Google (web.dev) | https://web.dev/blog/lcp-and-inp-are-now-baseline-newly-available | 2026-10-16 |
| webdev-bfcache | Back/forward cache | Google (web.dev) | https://web.dev/articles/bfcache | 2026-10-16 |
| webdev-accessible-tap-targets | Accessible tap targets | Google (web.dev) | https://web.dev/articles/accessible-tap-targets | 2026-10-16 |
| webdev-responsive-basics | Responsive web design basics | Google (web.dev) | https://web.dev/articles/responsive-web-design-basics | 2026-10-16 |
| webdev-viewport-units | The large, small, and dynamic viewport units | Google (web.dev) | https://web.dev/blog/viewport-units | 2026-10-16 |
| webdev-color-scheme | Improved dark mode default styling with the color-scheme CSS property and the corresponding meta tag | Google (web.dev) | https://web.dev/articles/color-scheme | 2026-10-16 |
| web-vitals-library | web-vitals README | GoogleChrome (GitHub) | https://github.com/GoogleChrome/web-vitals | 2026-10-16 |
| chrome-loaf | Long Animation Frames API | Google (Chrome for Developers) | https://developer.chrome.com/docs/web-platform/long-animation-frames | 2026-10-16 |
| lighthouse-tbt | Total Blocking Time | Google (Chrome for Developers) | https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time | 2026-10-16 |
| lighthouse-performance-scoring | Lighthouse performance scoring | Google (Chrome for Developers) | https://developer.chrome.com/docs/lighthouse/performance/performance-scoring | 2026-10-16 |
| lighthouse-lcp | Largest Contentful Paint (Lighthouse audit) | Google (Chrome for Developers) | https://developer.chrome.com/docs/lighthouse/performance/lighthouse-largest-contentful-paint | 2026-10-16 |
| lighthouse-fcp | First Contentful Paint (Lighthouse audit) | Google (Chrome for Developers) | https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint | 2026-10-16 |
| lighthouse-speed-index | Speed Index | Google (Chrome for Developers) | https://developer.chrome.com/docs/lighthouse/performance/speed-index | 2026-10-16 |
| lighthouse-a11y-scoring | Lighthouse accessibility score | Google (Chrome for Developers) | https://developer.chrome.com/docs/lighthouse/accessibility/scoring | 2026-10-16 |
| lighthouse-tap-targets | Tap targets are not sized appropriately | Google (Chrome for Developers) | https://developer.chrome.com/docs/lighthouse/seo/tap-targets | 2026-10-16 |
| devtools-throttling | Throttling (Chrome DevTools) | Google (Chrome for Developers) | https://developer.chrome.com/docs/devtools/settings/throttling | 2026-10-16 |
| devtools-real-world-data | More accurate DevTools performance debugging using real-world data | Google (Chrome for Developers) | https://developer.chrome.com/blog/devtools-grounded-real-world | 2026-10-16 |
| devtools-memory-problems | Fix memory problems | Google (Chrome for Developers) | https://developer.chrome.com/docs/devtools/memory-problems | 2026-10-16 |
| memlab-docs | How memlab works | Meta (memlab) | https://facebook.github.io/memlab/docs/how-memlab-works | 2026-10-16 |
| devtools-emulate-css | Emulate CSS media features | Google (Chrome for Developers) | https://developer.chrome.com/docs/devtools/rendering/emulate-css | 2026-10-16 |
| crux-methodology | CrUX methodology | Google (Chrome for Developers) | https://developer.chrome.com/docs/crux/methodology | 2026-10-16 |
| chrome-151 | New in Chrome 151 | Google (Chrome for Developers) | https://developer.chrome.com/blog/new-in-chrome-151 | 2026-10-16 |
| chrome-bfcache-nrr | Back/forward cache notRestoredReasons API | Google (Chrome for Developers) | https://developer.chrome.com/docs/web-platform/bfcache-notrestoredreasons | 2026-10-16 |
| chrome-headless | Chrome Headless mode | Google (Chrome for Developers) | https://developer.chrome.com/docs/chromium/headless | 2026-10-16 |
| chrome-300ms-tap-delay | 300ms tap delay, gone away | Google (Chrome for Developers) | https://developer.chrome.com/blog/300ms-tap-delay-gone-away | 2026-10-16 |
| chrome-viewport-resize | Prepare for viewport resize behavior changes coming to Chrome on Android | Google (Chrome for Developers) | https://developer.chrome.com/blog/viewport-resize-behavior | 2026-10-16 |
| chrome-virtual-keyboard | Full control with the VirtualKeyboard API | Google (Chrome for Developers) | https://developer.chrome.com/docs/web-platform/virtual-keyboard | 2026-10-16 |
| lighthouse-throttling | Lighthouse throttling | GoogleChrome (GitHub) | https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md | 2026-10-16 |
| lighthouse-variability | Lighthouse Variability | GoogleChrome (GitHub) | https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md | 2026-10-16 |
| lighthouse-user-flows | Lighthouse user flows | GoogleChrome (GitHub) | https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md | 2026-10-16 |
| lighthouse-config-constants | Lighthouse core/config/constants.js | GoogleChrome (GitHub) | https://raw.githubusercontent.com/GoogleChrome/lighthouse/main/core/config/constants.js | 2026-10-16 |
| lighthouse-v12-release | Lighthouse v12.0.0 release notes | GoogleChrome (GitHub) | https://github.com/GoogleChrome/lighthouse/releases/tag/v12.0.0 | 2026-10-16 |
| lantern-constants | Lantern simulation constants (Constants.ts) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/trace/lantern/simulation/Constants.ts | 2026-10-16 |
| cdp-emulation | Chrome DevTools Protocol, Emulation domain (Emulation.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Emulation.pdl | 2026-10-16 |
| cdp-network | Chrome DevTools Protocol, Network domain (Network.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Network.pdl | 2026-10-16 |
| cdp-performance | Chrome DevTools Protocol, Performance domain (Performance.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Performance.pdl | 2026-10-16 |
| cdp-js-protocol | Chrome DevTools Protocol, JavaScript domains (js_protocol.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/js_protocol.pdl | 2026-10-16 |
| cdp-page | Chrome DevTools Protocol, Page domain (Page.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl | 2026-10-16 |
| cdp-accessibility | Chrome DevTools Protocol, Accessibility domain (Accessibility.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Accessibility.pdl | 2026-10-16 |
| cdp-overlay | Chrome DevTools Protocol, Overlay domain (Overlay.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Overlay.pdl | 2026-10-16 |
| cdp-css | Chrome DevTools Protocol, CSS domain (CSS.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/CSS.pdl | 2026-10-16 |
| cdp-audits | Chrome DevTools Protocol, Audits domain (Audits.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Audits.pdl | 2026-10-16 |
| cdp-input | Chrome DevTools Protocol, Input domain (Input.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Input.pdl | 2026-10-16 |
| cdp-animation | Chrome DevTools Protocol, Animation domain (Animation.pdl) | ChromeDevTools (GitHub) | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Animation.pdl | 2026-10-16 |
| chromium-headless-switches | headless_shell_switches.cc | Chromium project | https://chromium.googlesource.com/chromium/src/+/b9b02e0537eac358b8facb9802e16adce590f0ea/headless/app/headless_shell_switches.cc | 2026-10-16 |
| firefox-deprecating-cdp | Deprecating CDP Support in Firefox: Embracing the Future with WebDriver BiDi | Mozilla (Firefox Developer Experience) | https://fxdx.dev/deprecating-cdp-support-in-firefox-embracing-the-future-with-webdriver-bidi/ | 2026-10-16 |
| firefox-cdp-retirement | CDP Retirement in Firefox | Mozilla (Firefox Developer Experience) | https://fxdx.dev/cdp-retirement-in-firefox/ | 2026-10-16 |
| mdn-performance-event-timing | PerformanceEventTiming | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming | 2026-10-16 |
| mdn-measure-memory | Performance: measureUserAgentSpecificMemory() method | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory | 2026-10-16 |
| mdn-lcp-api | LargestContentfulPaint | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/LargestContentfulPaint | 2026-10-16 |
| mdn-layout-shift-api | LayoutShift | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift | 2026-10-16 |
| mdn-get-animations | Document: getAnimations() method | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations | 2026-10-16 |
| mdn-prefers-reduced-motion | prefers-reduced-motion | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion | 2026-10-16 |
| mdn-fontfaceset-ready | FontFaceSet: ready property | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready | 2026-10-16 |
| mdn-create-image-bitmap | Window: createImageBitmap() method | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap | 2026-10-16 |
| mdn-cors-enabled-image | Allowing cross-origin use of images and canvas | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image | 2026-10-16 |
| mdn-canvas-get-context | HTMLCanvasElement: getContext() method | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext | 2026-10-16 |
| mdn-get-image-data | CanvasRenderingContext2D: getImageData() method | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData | 2026-10-16 |
| mdn-pixel-manipulation | Pixel manipulation with canvas | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas | 2026-10-16 |
| mdn-autocomplete | HTML attribute: autocomplete | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete | 2026-10-16 |
| mdn-inputmode | inputmode | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode | 2026-10-16 |
| mdn-beforeunload | Window: beforeunload event | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event | 2026-10-16 |
| mdn-intl-numberformat | Intl.NumberFormat() constructor | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat | 2026-10-16 |
| mdn-intl-datetimeformat | Intl.DateTimeFormat() constructor | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat | 2026-10-16 |
| mdn-meta-viewport | meta name="viewport" | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport | 2026-10-16 |
| mdn-env | env() | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/CSS/env | 2026-10-16 |
| mdn-visual-viewport | Visual Viewport API | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API | 2026-10-16 |
| mdn-hover | hover (media feature) | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover | 2026-10-16 |
| mdn-pointer | pointer (media feature) | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/pointer | 2026-10-16 |
| mdn-prefers-color-scheme | prefers-color-scheme | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme | 2026-10-16 |
| mdn-forced-colors | forced-colors | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors | 2026-10-16 |
| playwright-api-page | Page | Microsoft (Playwright) | https://playwright.dev/docs/api/class-page | 2026-10-16 |
| playwright-api-browser | Browser | Microsoft (Playwright) | https://playwright.dev/docs/api/class-browser | 2026-10-16 |
| playwright-api-browsercontext | BrowserContext | Microsoft (Playwright) | https://playwright.dev/docs/api/class-browsercontext | 2026-10-16 |
| playwright-api-browsertype | BrowserType | Microsoft (Playwright) | https://playwright.dev/docs/api/class-browsertype | 2026-10-16 |
| playwright-api-cdpsession | CDPSession | Microsoft (Playwright) | https://playwright.dev/docs/api/class-cdpsession | 2026-10-16 |
| playwright-api-coverage | Coverage | Microsoft (Playwright) | https://playwright.dev/docs/api/class-coverage | 2026-10-16 |
| playwright-page-assertions | PageAssertions | Microsoft (Playwright) | https://playwright.dev/docs/api/class-pageassertions | 2026-10-16 |
| playwright-testconfig | TestConfig | Microsoft (Playwright) | https://playwright.dev/docs/api/class-testconfig | 2026-10-16 |
| playwright-best-practices | Best Practices | Microsoft (Playwright) | https://playwright.dev/docs/best-practices | 2026-10-16 |
| playwright-test-assertions | Assertions | Microsoft (Playwright) | https://playwright.dev/docs/test-assertions | 2026-10-16 |
| playwright-test-timeouts | Timeouts | Microsoft (Playwright) | https://playwright.dev/docs/test-timeouts | 2026-10-16 |
| playwright-actionability | Auto-waiting | Microsoft (Playwright) | https://playwright.dev/docs/actionability | 2026-10-16 |
| playwright-locators | Locators | Microsoft (Playwright) | https://playwright.dev/docs/locators | 2026-10-16 |
| playwright-browser-contexts | Isolation (browser contexts) | Microsoft (Playwright) | https://playwright.dev/docs/browser-contexts | 2026-10-16 |
| playwright-auth | Authentication | Microsoft (Playwright) | https://playwright.dev/docs/auth | 2026-10-16 |
| playwright-emulation | Emulation | Microsoft (Playwright) | https://playwright.dev/docs/emulation | 2026-10-16 |
| playwright-test-snapshots | Visual comparisons | Microsoft (Playwright) | https://playwright.dev/docs/test-snapshots | 2026-10-16 |
| playwright-clock | Clock | Microsoft (Playwright) | https://playwright.dev/docs/clock | 2026-10-16 |
| playwright-mock | Mock APIs | Microsoft (Playwright) | https://playwright.dev/docs/mock | 2026-10-16 |
| playwright-test-webserver | Web server | Microsoft (Playwright) | https://playwright.dev/docs/test-webserver | 2026-10-16 |
| playwright-browsers | Browsers | Microsoft (Playwright) | https://playwright.dev/docs/browsers | 2026-10-16 |
| playwright-test-retries | Retries | Microsoft (Playwright) | https://playwright.dev/docs/test-retries | 2026-10-16 |
| playwright-test-cli | Command line | Microsoft (Playwright) | https://playwright.dev/docs/test-cli | 2026-10-16 |
| playwright-trace-viewer | Trace viewer | Microsoft (Playwright) | https://playwright.dev/docs/trace-viewer | 2026-10-16 |
| playwright-accessibility-testing | Accessibility testing | Microsoft (Playwright) | https://playwright.dev/docs/accessibility-testing | 2026-10-16 |
| playwright-release-notes | Release notes | Microsoft (Playwright) | https://playwright.dev/docs/release-notes | 2026-10-16 |
| playwright-library | Library | Microsoft (Playwright) | https://playwright.dev/docs/library | 2026-10-16 |
| checkly-auto-waiting | Auto-waiting methods in Playwright | Checkly | https://www.checklyhq.com/guides/auto-waiting-methods | 2026-10-16 |
| biome-no-wait-for-timeout | noPlaywrightWaitForTimeout | Biome | https://biomejs.dev/linter/rules/no-playwright-wait-for-timeout | 2026-10-16 |
| fowler-nondeterminism | Eradicating Non-Determinism in Tests | Martin Fowler | https://martinfowler.com/articles/nonDeterminism.html | 2026-10-16 |
| romano-2021-ui-flaky | An Empirical Analysis of UI-based Flaky Tests (ICSE 2021) | arXiv | https://arxiv.org/abs/2103.02669 | 2026-10-16 |
| arxiv-1906.00673 | Secondary study summarising Luo et al. 2014, An Empirical Analysis of Flaky Tests | arXiv | https://arxiv.org/pdf/1906.00673 | 2026-10-16 |
| google-flaky-tests-2016 | Flaky Tests at Google and How We Mitigate Them | Google Testing Blog | https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html | 2026-10-16 |
| pixelmatch | pixelmatch | Mapbox (GitHub) | https://github.com/mapbox/pixelmatch | 2026-10-16 |
| nng-ten-heuristics | 10 Usability Heuristics for User Interface Design | Nielsen Norman Group | https://www.nngroup.com/articles/ten-usability-heuristics/ | 2026-10-16 |
| nng-severity-ratings | Severity Ratings for Usability Problems | Nielsen Norman Group | https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/ | 2026-10-16 |
| nng-heuristic-evaluation | How to Conduct a Heuristic Evaluation | Nielsen Norman Group | https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/ | 2026-10-16 |
| nng-response-times | Response Times: The 3 Important Limits | Nielsen Norman Group | https://www.nngroup.com/articles/response-times-3-important-limits/ | 2026-10-16 |
| nng-progress-indicators | Progress Indicators Make a Slow System Less Insufferable | Nielsen Norman Group | https://www.nngroup.com/articles/progress-indicators/ | 2026-10-16 |
| nng-skeleton-screens | Skeleton Screens 101 | Nielsen Norman Group | https://www.nngroup.com/articles/skeleton-screens/ | 2026-10-16 |
| nng-user-control-freedom | User Control and Freedom | Nielsen Norman Group | https://www.nngroup.com/articles/user-control-and-freedom/ | 2026-10-16 |
| nng-errors-forms | 10 Design Guidelines for Reporting Errors in Forms | Nielsen Norman Group | https://www.nngroup.com/articles/errors-forms-design-guidelines/ | 2026-10-16 |
| nng-error-message-guidelines | Error-Message Guidelines | Nielsen Norman Group | https://www.nngroup.com/articles/error-message-guidelines/ | 2026-10-16 |
| nng-placeholders | Placeholders in Form Fields Are Harmful | Nielsen Norman Group | https://www.nngroup.com/articles/form-design-placeholders/ | 2026-10-16 |
| nng-web-form-design | Website Forms Usability: Top 10 Recommendations | Nielsen Norman Group | https://www.nngroup.com/articles/web-form-design/ | 2026-10-16 |
| nng-required-fields | Marking Required Fields in Forms | Nielsen Norman Group | https://www.nngroup.com/articles/required-fields/ | 2026-10-16 |
| nng-date-input | Date-Input Form Fields: UX Design Guidelines | Nielsen Norman Group | https://www.nngroup.com/articles/date-input/ | 2026-10-16 |
| nng-reset-cancel | Reset and Cancel Buttons (seen in search results only) | Nielsen Norman Group | https://www.nngroup.com/articles/reset-and-cancel-buttons/ | 2026-10-16 |
| nng-button-states | Button States: Communicate Interaction (partly confirmed) | Nielsen Norman Group | https://www.nngroup.com/articles/button-states-communicate-interaction/ | 2026-10-16 |
| nng-confirmation-dialog | Confirmation Dialogs Can Prevent User Errors: If Not Overused | Nielsen Norman Group | https://www.nngroup.com/articles/confirmation-dialog/ | 2026-10-16 |
| nng-proximity-consequential | Dangerous UX: Consequential Options Close to Benign Options | Nielsen Norman Group | https://www.nngroup.com/articles/proximity-consequential-options/ | 2026-10-16 |
| nng-indicators-notifications | Indicators, Validations, and Notifications | Nielsen Norman Group | https://www.nngroup.com/articles/indicators-validations-notifications/ | 2026-10-16 |
| nng-empty-states | Designing Empty States in Complex Applications: 3 Guidelines | Nielsen Norman Group | https://www.nngroup.com/articles/empty-state-interface-design/ | 2026-10-16 |
| nng-touch-targets | Touch Targets on Touchscreens | Nielsen Norman Group | https://www.nngroup.com/articles/touch-target-size/ | 2026-10-16 |
| baymard-adaptive-errors | Improve Validation Errors with Adaptive Messages | Baymard Institute | https://baymard.com/blog/adaptive-validation-error-messages | 2026-10-16 |
| baymard-inline-validation | Usability Testing of Inline Form Validation | Baymard Institute | https://baymard.com/blog/inline-form-validation | 2026-10-16 |
| baymard-checkout-fields | Checkout Optimization: 5 Ways to Minimize Form Fields in Checkout | Baymard Institute | https://baymard.com/blog/checkout-flow-average-form-fields | 2026-10-16 |
| baymard-guest-checkout | Make Guest Checkout the Most Prominent Option | Baymard Institute | https://baymard.com/blog/make-guest-checkout-prominent | 2026-10-16 |
| baymard-cart-abandonment | Cart Abandonment Rate Statistics | Baymard Institute | https://baymard.com/lists/cart-abandonment-rate | 2026-10-16 |
| baymard-input-masking | Consider Using Localized Input Masks | Baymard Institute | https://baymard.com/blog/input-masking-form-field | 2026-10-16 |
| baymard-touch-keyboards | Touch Keyboard Types Cheat Sheet | Baymard Institute | https://baymard.com/labs/touch-keyboard-types | 2026-10-16 |
| baymard-checkout-ux | Checkout UX optimization guide | Baymard Institute | https://baymard.com/blog/checkout-flow-ux-optimization | 2026-10-16 |
| apple-hig-accessibility | Human Interface Guidelines: Accessibility | Apple | https://developer.apple.com/design/human-interface-guidelines/accessibility | 2026-10-16 |
| apple-hig-layout | Human Interface Guidelines: Layout | Apple | https://developer.apple.com/design/human-interface-guidelines/layout | 2026-10-16 |
| apple-hig-alerts | Human Interface Guidelines: Alerts (title only rendered) | Apple | https://developer.apple.com/design/human-interface-guidelines/alerts | 2026-10-16 |
| android-touch-target-size | Touch target size | Google (Android Accessibility Help) | https://support.google.com/accessibility/android/answer/7101858 | 2026-10-16 |
| android-accessible-apps | Make apps more accessible | Google (Android Developers) | https://developer.android.com/guide/topics/ui/accessibility/apps | 2026-10-16 |
| webkit-iphone-x | Designing Websites for iPhone X | WebKit | https://webkit.org/blog/7929/designing-websites-for-iphone-x/ | 2026-10-16 |
| strahl-ios-zoom | Preventing iOS Textbox Auto Zooming and ViewPort Sizing | Rick Strahl | https://weblog.west-wind.com/posts/2023/Apr/17/Preventing-iOS-Textbox-Auto-Zooming-and-ViewPort-Sizing | 2026-10-16 |
| heroui-issue-5326 | HeroUI issue 5326 (iOS input zoom) | GitHub | https://github.com/heroui-inc/heroui/issues/5326 | 2026-10-16 |
| statcounter-mobile | Mobile Screen Resolution Stats Worldwide (September 2026) | StatCounter | https://gs.statcounter.com/screen-resolution-stats/mobile/worldwide | 2026-10-16 |
| statcounter-tablet | Tablet Screen Resolution Stats Worldwide | StatCounter | https://gs.statcounter.com/screen-resolution-stats/tablet/worldwide | 2026-10-16 |
| statcounter-desktop | Desktop Screen Resolution Stats Worldwide | StatCounter | https://gs.statcounter.com/screen-resolution-stats/desktop/worldwide | 2026-10-16 |
| tailwind-theme-css | tailwindcss theme.css | Tailwind Labs (GitHub) | https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/theme.css | 2026-10-16 |
| bootstrap-breakpoints | Breakpoints (Bootstrap 5.3) | Bootstrap | https://getbootstrap.com/docs/5.3/layout/breakpoints/ | 2026-10-16 |
| nextjs-cli | next CLI | Vercel (Next.js) | https://nextjs.org/docs/app/api-reference/cli/next | 2026-10-16 |
| nextjs-production-checklist | How to optimize your Next.js application for production | Vercel (Next.js) | https://nextjs.org/docs/app/guides/production-checklist | 2026-10-16 |
| nextjs-loading | loading.js | Vercel (Next.js) | https://nextjs.org/docs/app/api-reference/file-conventions/loading | 2026-10-16 |
| nextjs-caching | Caching | Vercel (Next.js) | https://nextjs.org/docs/app/getting-started/caching | 2026-10-16 |
| nextjs-error | error.js | Vercel (Next.js) | https://nextjs.org/docs/app/api-reference/file-conventions/error | 2026-10-16 |
| nextjs-not-found | not-found.js | Vercel (Next.js) | https://nextjs.org/docs/app/api-reference/file-conventions/not-found | 2026-10-16 |
| nextjs-server-client-components | Server and Client Components | Vercel (Next.js) | https://nextjs.org/docs/app/getting-started/server-and-client-components | 2026-10-16 |
| nextjs-package-bundling | Optimizing package bundling | Vercel (Next.js) | https://nextjs.org/docs/app/guides/package-bundling | 2026-10-16 |
| nextjs-lazy-loading | How to lazy load Client Components and libraries | Vercel (Next.js) | https://nextjs.org/docs/app/guides/lazy-loading | 2026-10-16 |
| nextjs-image | Image Component | Vercel (Next.js) | https://nextjs.org/docs/app/api-reference/components/image | 2026-10-16 |
| nextjs-font | Font Module | Vercel (Next.js) | https://nextjs.org/docs/app/api-reference/components/font | 2026-10-16 |
| nextjs-scripts | How to load and optimize scripts | Vercel (Next.js) | https://nextjs.org/docs/app/guides/scripts | 2026-10-16 |
| nextjs-hydration-error | Text content does not match server-rendered HTML | Vercel (Next.js) | https://nextjs.org/docs/messages/react-hydration-error | 2026-10-16 |
| nextjs-use-report-web-vitals | useReportWebVitals | Vercel (Next.js) | https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals | 2026-10-16 |
| react-19-release | React v19 | Meta (react.dev) | https://react.dev/blog/2024/12/05/react-19 | 2026-10-16 |
| react-hydrateroot | hydrateRoot | Meta (react.dev) | https://react.dev/reference/react-dom/client/hydrateRoot | 2026-10-16 |
| react-rendering-lists | Rendering Lists | Meta (react.dev) | https://react.dev/learn/rendering-lists | 2026-10-16 |
| react-no-effect | You Might Not Need an Effect | Meta (react.dev) | https://react.dev/learn/you-might-not-need-an-effect | 2026-10-16 |
| react-usememo | useMemo | Meta (react.dev) | https://react.dev/reference/react/useMemo | 2026-10-16 |
| react-memo | memo | Meta (react.dev) | https://react.dev/reference/react/memo | 2026-10-16 |
| react-usetransition | useTransition | Meta (react.dev) | https://react.dev/reference/react/useTransition | 2026-10-16 |
| react-suspense | Suspense | Meta (react.dev) | https://react.dev/reference/react/Suspense | 2026-10-16 |
| vite-cli | Command Line Interface | Vite | https://vite.dev/guide/cli | 2026-10-16 |
| vite-config | Configuring Vite | Vite | https://vite.dev/config/ | 2026-10-16 |
| vite-server-options | Server Options | Vite | https://vite.dev/config/server-options | 2026-10-16 |
| vite-preview-options | Preview Options | Vite | https://vite.dev/config/preview-options | 2026-10-16 |
| vite-build-options | Build Options | Vite | https://vite.dev/config/build-options | 2026-10-16 |
| vite-features | Features | Vite | https://vite.dev/guide/features | 2026-10-16 |
| vite-performance | Performance | Vite | https://vite.dev/guide/performance | 2026-10-16 |
| nuxt-dev | nuxt dev | Nuxt | https://nuxt.com/docs/4.x/api/commands/dev | 2026-10-16 |
| nuxt-preview | nuxt preview | Nuxt | https://nuxt.com/docs/4.x/api/commands/preview | 2026-10-16 |
| nuxt-performance | Nuxt performance best practices | Nuxt | https://nuxt.com/docs/4.x/guide/best-practices/performance | 2026-10-16 |
| nuxt-plugins | Nuxt plugins best practices (found by search; not fetched) | Nuxt | https://nuxt.com/docs/4.x/guide/best-practices/plugins | 2026-10-16 |
| nuxt-hydration | Nuxt and Hydration | Nuxt | https://nuxt.com/docs/4.x/guide/best-practices/hydration | 2026-10-16 |
| nuxt-error-handling | Error Handling | Nuxt | https://nuxt.com/docs/4.x/getting-started/error-handling | 2026-10-16 |
| nuxt-analyze | nuxt analyze | Nuxt | https://nuxt.com/docs/4.x/api/commands/analyze | 2026-10-16 |
| vue-performance | Performance | Vue.js | https://vuejs.org/guide/best-practices/performance | 2026-10-16 |
| sveltekit-project-structure | Project structure | Svelte | https://svelte.dev/docs/kit/project-structure | 2026-10-16 |
| sveltekit-creating-project | Creating a project | Svelte | https://svelte.dev/docs/kit/creating-a-project | 2026-10-16 |
| sveltekit-configuration | Configuration | Svelte | https://svelte.dev/docs/kit/configuration | 2026-10-16 |
| sveltekit-performance | Performance | Svelte | https://svelte.dev/docs/kit/performance | 2026-10-16 |
| sveltekit-errors | Errors | Svelte | https://svelte.dev/docs/kit/errors | 2026-10-16 |
| sveltekit-link-options | Link options | Svelte | https://svelte.dev/docs/kit/link-options | 2026-10-16 |
| svelte-runtime-warnings | Runtime warnings | Svelte | https://svelte.dev/docs/svelte/runtime-warnings | 2026-10-16 |
| astro-cli | CLI Commands | Astro | https://docs.astro.build/en/reference/cli-reference/ | 2026-10-16 |
| astro-configuring | Configuration overview | Astro | https://docs.astro.build/en/guides/configuring-astro/ | 2026-10-16 |
| astro-directives | Template directives reference | Astro | https://docs.astro.build/en/reference/directives-reference/ | 2026-10-16 |
| astro-islands | Islands architecture | Astro | https://docs.astro.build/en/concepts/islands/ | 2026-10-16 |
| astro-images | Images | Astro | https://docs.astro.build/en/guides/images/ | 2026-10-16 |
| astro-assets | Assets API reference | Astro | https://docs.astro.build/en/reference/modules/astro-assets/ | 2026-10-16 |
| astro-fonts | Using custom fonts | Astro | https://docs.astro.build/en/guides/fonts/ | 2026-10-16 |
| astro-pages | Pages | Astro | https://docs.astro.build/en/basics/astro-pages/ | 2026-10-16 |
| angular-serve | ng serve | Angular | https://angular.dev/cli/serve | 2026-10-16 |
| angular-build | Building Angular apps | Angular | https://angular.dev/tools/cli/build | 2026-10-16 |
| angular-image-optimization | Image optimization | Angular | https://angular.dev/guide/image-optimization | 2026-10-16 |
| angular-ng0913 | NG0913 | Angular | https://angular.dev/errors/NG0913 | 2026-10-16 |
| angular-defer | Deferred loading with @defer | Angular | https://angular.dev/guide/templates/defer | 2026-10-16 |
| angular-hydration | Hydration | Angular | https://angular.dev/guide/hydration | 2026-10-16 |
| angular-incremental-hydration | Incremental hydration | Angular | https://angular.dev/guide/incremental-hydration | 2026-10-16 |
| angular-skipping-subtrees | Skipping component subtrees | Angular | https://angular.dev/best-practices/skipping-subtrees | 2026-10-16 |
| angular-zoneless | Zoneless | Angular | https://angular.dev/guide/zoneless | 2026-10-16 |
| angular-runtime-performance | Runtime performance | Angular | https://angular.dev/best-practices/runtime-performance | 2026-10-16 |
| react-router-dev-cli | @react-router/dev CLI | Shopify (React Router) | https://reactrouter.com/api/other-api/dev | 2026-10-16 |
| react-router-serve | @react-router/serve | Shopify (React Router) | https://reactrouter.com/api/other-api/serve | 2026-10-16 |
| react-router-installation | Installation (framework mode) | Shopify (React Router) | https://reactrouter.com/start/framework/installation | 2026-10-16 |
| react-router-prerendering | Pre-Rendering | Shopify (React Router) | https://reactrouter.com/how-to/pre-rendering | 2026-10-16 |
| react-router-pending-ui | Pending UI | Shopify (React Router) | https://reactrouter.com/start/framework/pending-ui | 2026-10-16 |
| remix-cli | Remix CLI | Shopify (Remix v2) | https://v2.remix.run/docs/other-api/dev | 2026-10-16 |
| claude-code-skills | Extend Claude with skills | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/skills | 2026-10-16 |
| claude-code-sub-agents | Create custom subagents | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/sub-agents | 2026-10-16 |
| claude-code-tools-reference | Tools reference | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/tools-reference | 2026-10-16 |
| claude-agent-sdk-typescript | Agent SDK reference - TypeScript | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/agent-sdk/typescript | 2026-10-16 |
| claude-code-model-config | Model configuration | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/model-config | 2026-10-16 |
| claude-code-errors | Errors | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/errors | 2026-10-16 |
| claude-code-worktrees | Run parallel sessions with worktrees | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/worktrees | 2026-10-16 |
| claude-code-plugins-reference | Plugin manifest reference | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/plugins-reference | 2026-10-16 |
| claude-code-plugin-marketplaces | Create a marketplace | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/plugin-marketplaces | 2026-10-16 |
| claude-code-marketplace-reference | Marketplace reference | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/plugins/marketplace-reference | 2026-10-16 |
| claude-code-plugins-publish | Publish and distribute a plugin | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/plugins/publish | 2026-10-16 |
| claude-code-plugins-loading | Plugin loading reference | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/plugins/loading | 2026-10-16 |
| claude-code-workflows | Orchestrate subagents at scale with dynamic workflows | Anthropic (Claude Code docs) | https://code.claude.com/docs/en/workflows | 2026-10-16 |
| claude-models-overview | Models overview | Anthropic (Claude Platform docs) | https://platform.claude.com/docs/en/about-claude/models/overview | 2026-10-16 |
| claude-pricing | Pricing | Anthropic | https://claude.com/pricing | 2026-10-16 |
| agentskills-spec | Specification (Agent Skills open format) | agentskills.io | https://agentskills.io/specification | 2026-10-16 |
| vercel-skills-readme | skills CLI README | Vercel Labs (GitHub) | https://github.com/vercel-labs/skills | 2026-10-16 |
| vercel-skills-local-lock | skills CLI source, src/local-lock.ts | Vercel Labs (GitHub) | https://github.com/vercel-labs/skills/blob/main/src/local-lock.ts | 2026-10-16 |
| vercel-skills-issue-549 | skills CLI issue 549 (restore command request) | Vercel Labs (GitHub) | https://github.com/vercel-labs/skills/issues/549 | 2026-10-16 |

## 3. Rule index

Columns: rule id, statement in this skill's words, threshold, kind, source ids.

### 3.1 Accessibility (WCAG-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| WCAG-01 | Text and images of text reach the minimum contrast against their effective background; the ratio is computed from linearised sRGB luminance and never rounded. Placeholder, hover and focus text are in scope; disabled controls, decoration and logos are not. | 4.5:1 normal text, 3:1 large text (24 CSS px, or about 18.66 CSS px bold); 4.499:1 fails | normative | wcag22-u-contrast-minimum, act-rules |
| WCAG-02 | Enhanced contrast (1.4.6, AAA) uses the same computation with higher ratios and is reported as advisory. The WCAG 3 working draft has not chosen a contrast measure, so no draft algorithm is used. | 7:1 normal, 4.5:1 large | advisory | wcag22, act-rules, wcag3-intro, wcag3-draft |
| WCAG-03 | Boundaries, state marks, focus indicators and meaningful graphics that identify a component or convey content contrast with adjacent colours; the least contrasting part of a gradient decides. | 3:1, no rounding | normative | wcag22-u-non-text-contrast |
| WCAG-04 | Text can grow to twice its size through browser zoom without clipped, overlapping or unreachable content, at every step up to that size; viewport-unit font sizes and zoom-blocking viewport meta tags are the usual failures. | 200 %; maximum-scale below 2 fails | normative | wcag22-u-resize-text, act-rules |
| WCAG-05 | Vertically scrolling content works without two-dimensional scrolling at the reflow width, and horizontally scrolling content at the reflow height; maps, data tables and similar two-dimensional content are excepted only for their own region. | 320 CSS px wide (1280 px at 400 %), 256 CSS px tall; 1 px rounding allowance | normative | wcag22-u-reflow |
| WCAG-06 | Overriding line height, paragraph spacing, letter spacing and word spacing causes no lost or clipped content. | line-height 1.5, paragraph spacing 2, letter spacing 0.12, word spacing 0.16 (times font size) | normative | wcag22-u-text-spacing |
| WCAG-07 | Content revealed on hover or focus can be dismissed without moving the pointer or focus, can itself be hovered, and stays until the trigger is left or it is dismissed. | dismissible, hoverable, persistent | normative | wcag22-u-content-on-hover-or-focus |
| WCAG-08 | The interface works in both portrait and landscape unless one orientation is essential; rotating the root by CSS or asking the user to rotate is a failure. | both orientations | normative | wcag22-u-orientation, act-rules |
| WCAG-09 | Colour is never the only cue for state, errors, required fields, links in text or chart series. | at least one non-colour cue | normative | wcag22 |
| WCAG-10 | Fields that collect data about the user expose their purpose with a valid autocomplete token. | valid token from the WCAG input-purpose list | normative | wcag22 |
| WCAG-11 | Visual structure is exposed programmatically, informative images have text alternatives, the page language is valid and each page has a descriptive title that also changes on client-side route changes. | presence is automatable; meaning needs judgement | normative | wcag22 |
| WCAG-12 | Every function works from the keyboard and focus can always leave a component with the keyboard. | every interactive element reached; no trap | normative | wcag22 |
| WCAG-13 | Single-character keyboard shortcuts can be turned off, remapped or are active only while their component has focus. | no global unmodified letter shortcut | normative | wcag22 |
| WCAG-14 | Time limits imposed by the content can be turned off, extended or adjusted, except real-time, essential or very long limits. | adjust to 10 times, or warn with at least 20 s to extend, extendable 10 times; limits over 20 h exempt | normative | wcag22, apg-alert |
| WCAG-15 | Moving, blinking or auto-updating content that starts by itself and runs beside other content can be paused, stopped or hidden; nothing flashes too often. | more than 5 s needs a control; at most 3 flashes in any second | normative | wcag22 |
| WCAG-16 | Repeated blocks can be bypassed, focus order follows meaning, headings and labels describe their purpose and link purpose is clear. | skip link or landmarks; no positive tabindex | normative | wcag22 |
| WCAG-17 | A visible keyboard focus indicator exists and does not disappear on a timer. | at least one changed pixel between unfocused and focused captures | normative | wcag22-u-focus-visible |
| WCAG-18 | A focused component is never completely hidden by sticky headers, footers, banners, chat widgets or non-modal panels; partial cover passes. | at least one sampled point of the focused element on top | normative | wcag22-u-focus-not-obscured-minimum |
| WCAG-19 | No part of a focused component is hidden by author content (2.4.12, AAA). | no covered sample point | advisory | wcag22 |
| WCAG-20 | The focus indicator covers at least the area of a 2 CSS px perimeter and changes contrast between states (2.4.13, AAA). | area of a 2 px perimeter; 3:1 change between states | advisory | wcag22-u-focus-appearance |
| WCAG-21 | Path or multipoint gestures have a single-pointer alternative, and single-pointer actions complete on release or can be aborted or undone. | no action on the down-event alone | normative | wcag22 |
| WCAG-22 | The accessible name of a control with a visible text label contains that visible text. | case-insensitive containment | normative | wcag22-u-label-in-name |
| WCAG-23 | Every dragging function also works with single clicks or taps; a keyboard-only alternative does not satisfy this. | a non-drag pointer path for each drag | normative | wcag22-u-dragging-movements |
| WCAG-24 | Pointer targets are large enough, or spaced so that a circle centred on each undersized target touches no other target or circle; inline, equivalent, browser-controlled and essential targets are exempt. | 24 by 24 CSS px; 24 px circle | normative | wcag22-u-target-size-minimum, axe-rule-descriptions |
| WCAG-25 | Enhanced target size (2.5.5, AAA) has no spacing exception. | 44 by 44 CSS px | advisory | wcag22 |
| WCAG-26 | Focus and input changes do not change context unexpectedly; repeated navigation keeps its relative order and same-function controls keep the same names across pages. | no context change on focus or on setting a control | normative | wcag22 |
| WCAG-27 | Help mechanisms repeated across a set of pages keep the same order relative to the other shared content. | same relative DOM order on every page of the set | normative | wcag22-u-consistent-help |
| WCAG-28 | Input errors are identified and described in text, inputs have labels, known corrections are suggested, and legal, financial or data-changing submissions are reversible, checked or confirmed. | at least one of reversible, checked or confirmed | normative | wcag22 |
| WCAG-29 | Information already given in the same process is filled in or offered again; browser autofill does not count. | no forced re-entry except essential, security or expired data | normative | wcag22-u-redundant-entry |
| WCAG-30 | Logging in needs no cognitive function test unless an alternative or an assisting mechanism exists; blocked paste or autofill in credential or code fields fails. | full paste accepted in every credential and code field | normative | wcag22-u-accessible-authentication-minimum |
| WCAG-31 | Enhanced authentication (3.3.9, AAA) removes the object-recognition and personal-content exceptions. | as WCAG-30 without those exceptions | advisory | wcag22-u-accessible-authentication-minimum |
| WCAG-32 | Every component exposes a name and role, and the states users can change are exposed and updated. | name and role present; state attributes flip on activation | normative | wcag22 |
| WCAG-33 | Status, progress, result and error messages that do not take focus live in a status, alert, log or progressbar role or a live region that existed before the text arrived. | live region present before insertion; focus unchanged | normative | wcag22-u-status-messages, apg-alert |
| WCAG-34 | WCAG 2.2 (also published as ISO/IEC 40500:2025) removed criterion 4.1.1 Parsing; duplicate ids matter only when they break name, role or relationships. | no 4.1.1 findings | normative | wcag22-whats-new, wcag22-iso |
| WCAG-35 | A modal dialog moves focus inside on open, keeps Tab inside, closes with Escape, returns focus to its trigger and has a role, a modal flag and a name. | focus inside, wraps, returns to trigger | advisory | apg-dialog-modal, apg-read-me-first |
| WCAG-36 | Tabs expose a tablist, tabs with selection state and controlled panels, with arrow keys moving between tabs and one tab in the Tab sequence. | exactly one selected tab | advisory | apg-tabs |
| WCAG-37 | Menu buttons and menus expose expanded state, open with Enter or Space, move with arrow keys and return focus to the button on Escape. | arrow-key support for every menu role | advisory | apg-menu-button, apg-menubar |
| WCAG-38 | A combobox keeps DOM focus in the input, points to the highlighted option with an active-descendant reference and exposes its expanded state. | active descendant references an existing option | advisory | apg-combobox |
| WCAG-39 | Notifications use alert only when urgent and status otherwise, never take focus, and a timed toast that carries an action or unique information meets the timing criterion. | no focus move; timed actionable toast meets WCAG-14 | advisory | apg-alert |
| WCAG-40 | axe-core finds a large share of issues by volume but leaves most judgement criteria to people; its WCAG 2.2 rule and AAA rules are off by default and uncertain checks come back as incomplete. | about 57 % of issues by volume (vendor study); target-size off by default | tool-fact | axe-core-readme, axe-rule-descriptions, deque-coverage-study, playwright-accessibility-testing |
| WCAG-41 | An independent government test found that automated checkers catch well under half of deliberately planted barriers. | best tool about 40 % (about 50 % with review flags) | tool-fact | gds-tool-audit, gds-blog-tool-test |
| WCAG-42 | ACT rules are informative test definitions; none exist yet for the criteria new in 2.2, so the skill's checks for those criteria are its own heuristics and say so. | no ACT rule for 2.4.11 to 2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7 to 3.3.9 | tool-fact | act-rules, wai-selecting-tools |

### 3.2 Web vitals and lab measurement (VITALS-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| VITALS-01 | A page meets Core Web Vitals only when LCP, INP and CLS are all good at the 75th percentile of real page loads, per device class; a lab probe cannot compute that and reports labelled lab medians instead. | p75 of field data, same thresholds for mobile and desktop | normative | webdev-vitals, webdev-cwv-thresholds |
| VITALS-02 | The largest text block or image in the viewport renders soon after navigation; the value is the last candidate before the first user input, with the element named. | good at most 2500 ms, poor above 4000 ms | normative | webdev-lcp, web-vitals-library |
| VITALS-03 | The worst interaction latency from a click, tap or key press to the next frame stays short; hover and scroll do not count, and a load with no scripted input has no INP. | good at most 200 ms, poor above 500 ms; one highest ignored per 50 interactions | normative | webdev-inp, mdn-performance-event-timing |
| VITALS-04 | A slow interaction is split into input delay, processing and presentation delay, and a finding names the dominant part. | no official per-part threshold; the 200 ms total gates | advisory | webdev-optimize-inp, mdn-performance-event-timing |
| VITALS-05 | The largest burst of unexpected layout shifts stays small; shifts within 500 ms of a discrete input are excluded and bursts group shifts less than 1 s apart for at most 5 s. | good at most 0.1, poor above 0.25 | normative | webdev-cls |
| VITALS-06 | First Input Delay is no longer a Core Web Vital and is never used as a pass or fail gate. | INP replaced FID on 2024-03-12 | normative | webdev-inp-becomes-cwv |
| VITALS-07 | Only the stable metrics count as Core Web Vitals; reports name the metric set and the date the thresholds were read. | stable set: LCP, INP, CLS | normative | webdev-vitals |
| VITALS-08 | The first byte of the document arrives quickly; on loopback a high value points at server-side work. | good at most 800 ms, poor above 1800 ms | normative | webdev-ttfb |
| VITALS-09 | Some content paints quickly after navigation. | good at most 1800 ms, poor above 3000 ms | normative | webdev-fcp |
| VITALS-10 | Main-thread tasks and animation frames over the long-task limit block input; a slow interaction is explained with the overlapping long animation frames and their scripts. | longer than 50 ms is long; blocking part is the excess over 50 ms | tool-fact | chrome-loaf, webdev-long-tasks |
| VITALS-11 | Total Blocking Time sums the blocking parts of long tasks after first paint; it is a lab proxy only and a page can pass it and still have poor INP. | mobile good 200 ms, poor above 600 ms; desktop good 150 ms, poor above 350 ms | tool-fact | lighthouse-tbt, webdev-lab-field |
| VITALS-12 | The Lighthouse performance score is a weighted mean of five lab metrics; the skill does not run Lighthouse and labels any score it estimates as an estimate. | FCP 10 %, Speed Index 10 %, LCP 25 %, TBT 30 %, CLS 25 %; bands 0-49, 50-89, 90-100 | tool-fact | lighthouse-performance-scoring |
| VITALS-13 | Lighthouse colours lab metrics with bands that are stricter on desktop; these are extra lab signals, never the primary rule. | desktop LCP good 1.2 s, FCP good 0.9 s, Speed Index good 1.3 s; mobile bands equal the field ones | tool-fact | lighthouse-lcp, lighthouse-fcp, lighthouse-speed-index |
| VITALS-14 | Default Lighthouse mobile runs emulate a slow 4G connection with a 4x CPU slowdown and a mid-size phone screen; desktop runs use a fast connection and no CPU slowdown. The probe records which preset it reproduced over CDP. | 150 ms RTT, about 1.6 Mbps down, 750 Kbps up, CPU 4x; request-level latency 562.5 ms with a 3.75 RTT factor | tool-fact | lantern-constants, lighthouse-throttling, lighthouse-config-constants, cdp-emulation, cdp-network |
| VITALS-15 | A CPU slowdown factor is relative to the host, so the run records a host benchmark beside the factor used. | mid-tier mobile benchmark index 125 to 800 | tool-fact | lighthouse-throttling, devtools-throttling, devtools-real-world-data |
| VITALS-16 | One lab run is not a result: measure several runs serially on the same machine, report the median and never measure in parallel. | at least 5 runs, median | advisory | lighthouse-variability |
| VITALS-17 | Load measurements and interaction measurements are separate passes; LCP is never read from an interaction pass. | load pass and interaction pass per route | tool-fact | lighthouse-user-flows |
| VITALS-18 | Lab and field numbers differ by design (one device, cold cache, no real users) and are always reported separately; a missing mobile viewport meta adds tap delay to INP. | never merged | tool-fact | webdev-lab-field |
| VITALS-19 | Field data from CrUX exists only for public, popular pages measured in Chrome; a local audit has none and says so. | no field data for loopback builds | tool-fact | crux-methodology, webdev-lcp-inp-baseline |
| VITALS-20 | LCP and INP are measurable in all major engines but values differ slightly between them; CLS and long animation frames are Chromium only. | compare only within one engine | tool-fact | webdev-lcp-inp-baseline, web-vitals-library |
| VITALS-21 | Client-side route changes are not page loads; soft-navigation entries are measured where the browser supports them, and otherwise the report says soft-navigation paint was not measurable. | feature-detect the entry types | tool-fact | chrome-151, web-vitals-library, nextjs-use-report-web-vitals |
| VITALS-22 | CLS and INP are final when the page becomes hidden; the probe reads them before leaving a page instead of relying on unload events. | read before navigation or close | tool-fact | web-vitals-library |
| VITALS-23 | Back and forward navigations restore the page from the back/forward cache; when they do not, the reasons the browser reports are recorded. | restored (pageshow persisted) or a finding with reasons | advisory | webdev-bfcache, chrome-bfcache-nrr |
| VITALS-24 | Known cache blockers are absent: unload listeners, no-store on ordinary HTML, open connections at pagehide and opener links. A deliberate no-store on sensitive pages is never recommended for removal. | zero unload listeners in first-party code | advisory | webdev-bfcache, chrome-bfcache-nrr |
| VITALS-25 | Repeating an action and undoing it does not keep growing memory, DOM nodes or listeners after a forced garbage collection. | no official threshold; monotonic growth across the configured cycles is a lead | advisory | devtools-memory-problems, cdp-performance, cdp-js-protocol |
| VITALS-26 | Objects allocated by an action that survive after it is undone are leak candidates, typically detached DOM trees; retainer paths need validation. | any retained detached tree after GC is a candidate | advisory | memlab-docs, devtools-memory-problems |
| VITALS-27 | The in-page memory measurement API needs cross-origin isolation and is not comparable across browsers, so the probe uses CDP instead. | skip when not cross-origin isolated | tool-fact | mdn-measure-memory |
| VITALS-28 | Performance findings come from a production build served locally; dev-server numbers are labelled indicative and downgraded. | production build only for findings | advisory | lighthouse-variability, nextjs-production-checklist, sveltekit-performance |
| VITALS-29 | Performance observers are registered with buffered entries and injected before page scripts run, or early entries are lost. | buffered observers, init-script injection | tool-fact | playwright-api-cdpsession, chrome-loaf |
| VITALS-30 | The probe and the performance lens grade every figure from one threshold table; good is inclusive and poor is strictly above its limit. | LCP 2500/4000 ms, INP 200/500 ms, CLS 0.1/0.25, FCP 1800/3000 ms, TTFB 800/1800 ms, TBT 200/600 mobile and 150/350 desktop | normative | webdev-vitals, web-vitals-library |

### 3.3 Frameworks (FRAMEWORKS-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| FRAMEWORKS-01 | Next.js is detected by the next dependency plus a next.config file or an app or pages directory; it builds with next build and serves with next start, which binds every interface unless a hostname flag is passed. | default port 3000; host 0.0.0.0 unless -H is given | tool-fact | nextjs-cli |
| FRAMEWORKS-02 | A plain Vite app is detected by the vite dependency and a vite.config file; it builds to dist and previews with vite preview, which is a local stand-in, not a production server. | dev 5173, preview 4173; next free port unless strictPort | tool-fact | vite-cli, vite-server-options, vite-preview-options, vite-config |
| FRAMEWORKS-03 | Nuxt is detected by the nuxt dependency and its config file; it builds with nuxt build and serves with nuxt preview, with the port taken from environment variables. | port 3000 | tool-fact | nuxt-dev, nuxt-preview |
| FRAMEWORKS-04 | SvelteKit is detected by @sveltejs/kit; it builds and previews through Vite, and newer major versions no longer use svelte.config.js, so detection accepts both layouts. | preview 4173 | tool-fact | sveltekit-project-structure, sveltekit-creating-project, sveltekit-configuration |
| FRAMEWORKS-05 | Astro is detected by the astro dependency and its config file; it builds to dist and previews with astro preview. | port 4321 | tool-fact | astro-cli, astro-configuring |
| FRAMEWORKS-06 | React Router framework mode is detected by @react-router/dev and its config file; it builds with react-router build and serves the server build with react-router-serve, with port and host from the environment. | default port not documented; assumed and recorded as an assumption | tool-fact | react-router-dev-cli, react-router-serve, react-router-installation, react-router-prerendering |
| FRAMEWORKS-07 | Remix v2 is detected by @remix-run/dev; it builds with the Vite build command and serves with remix-serve; its documentation points to React Router 7. | port from a flag | tool-fact | remix-cli |
| FRAMEWORKS-08 | Angular is detected by @angular/core with angular.json; it builds to dist, and its static output can be served by any static server while SSR apps run their own server. | ng serve 4200 | tool-fact | angular-serve, angular-build |
| FRAMEWORKS-09 | A site with no framework dependency is plain static and is served from the skill's own loopback-only static server, the same way any static build output can be served. | index.html at the root or in public | tool-fact | angular-build |
| FRAMEWORKS-10 | Performance is measured against a production build served locally; development numbers are labelled indicative because dev servers compile on demand and React development mode renders twice. | production build for every performance finding | advisory | nextjs-production-checklist, react-usememo, sveltekit-performance, vite-cli |
| FRAMEWORKS-11 | Interaction timing is repeated under CPU throttling in a clean browser profile; the throttle factor is the skill's choice and is recorded. | factor recorded (default 4x) | advisory | react-usememo, vite-performance |
| FRAMEWORKS-12 | Every Next.js segment whose page waits for data has an instant loading state, either a loading file or a Suspense boundary around the slow part. | one per data-dependent segment | advisory | nextjs-loading |
| FRAMEWORKS-13 | A Next.js layout does not read runtime or uncached data outside its own Suspense boundary, because the segment's loading file does not cover its own layout. | no blocking read at layout top level | advisory | nextjs-loading, nextjs-caching |
| FRAMEWORKS-14 | Route groups that render user data have a Next.js error boundary that is a client component and offers a retry control. | error file present with a retry or reset control | advisory | nextjs-error |
| FRAMEWORKS-15 | A Next.js global error file exists, renders its own html and body, and applies the app theme itself because it receives no global styles. | file present with its own document and theme | advisory | nextjs-error, nextjs-production-checklist |
| FRAMEWORKS-16 | Production error screens never show raw server error messages or stacks; the error value is narrowed before its fields are read. | no stack or internal text visible in production | advisory | nextjs-error |
| FRAMEWORKS-17 | A not-found file exists, unknown URLs return 404 when decided before streaming, and a late 404 returns 200 with a noindex robots meta. | 404, or 200 plus noindex | advisory | nextjs-not-found, nextjs-loading |
| FRAMEWORKS-18 | Next.js apps with several root layouts use a global not-found file that renders a full document with its own styles and theme. | file present when there is no single root layout | advisory | nextjs-not-found |
| FRAMEWORKS-19 | The client directive sits on small interactive leaves, not on layouts, pages or large mostly static trees, because everything a client module imports ships to the browser. | no client directive on a layout or page | advisory | nextjs-server-client-components |
| FRAMEWORKS-20 | Client context providers wrap children inside body or deeper, never the whole document. | provider below body | advisory | nextjs-server-client-components |
| FRAMEWORKS-21 | Modules that read secrets or the database are fenced off from client code; only public-prefixed variables appear in client modules. The audit reads code references only, never environment files. | server-only import or unreachable from client modules | advisory | nextjs-server-client-components |
| FRAMEWORKS-22 | A bundle analysis runs once per audit and the largest client modules per route are listed with their import chains; libraries that only produce static markup should not ship to the client. | top 10 client modules (skill default) | advisory | nextjs-package-bundling, nextjs-cli |
| FRAMEWORKS-23 | Icon and utility packages with many exports are imported by path or listed for package import optimisation. | per large package found by FRAMEWORKS-22 | advisory | nextjs-package-bundling |
| FRAMEWORKS-24 | Heavy client code not needed for the first render is loaded lazily, and server-side rendering is switched off only inside client components. | no heavy static import in the initial client graph | advisory | nextjs-lazy-loading |
| FRAMEWORKS-25 | Every Next.js image has alt text and width and height, or fill with a positioned parent, so space is reserved before it loads. | rendered ratio within 2 % of natural ratio (skill tolerance) | advisory | nextjs-image |
| FRAMEWORKS-26 | Responsive or fill images declare sizes, otherwise the browser assumes full viewport width and downloads too much. | natural width at most 1.5x the rendered width times DPR (skill ratio, see section 5) | advisory | nextjs-image |
| FRAMEWORKS-27 | An LCP image is never lazy and is loaded eagerly or with high fetch priority; the old priority prop is deprecated in Next.js 16. | LCP image not lazy | advisory | nextjs-image |
| FRAMEWORKS-28 | Next.js 16 needs an image quality allowlist and quality props from that list. | qualities configured (default 75) | advisory | nextjs-image |
| FRAMEWORKS-29 | Web fonts load through the framework font module, once per family and weight, with no browser request to a third-party font host. | zero font-host requests from the browser | advisory | nextjs-font |
| FRAMEWORKS-30 | Font fallback metric adjustment stays on unless justified, and subsets are set when preloading. | no text-reflow shift after font swap | advisory | nextjs-font |
| FRAMEWORKS-31 | Third-party scripts load through the framework script component in the narrowest layout with the least eager strategy; inline scripts carry an id. | before-interactive strategy only with a reason | advisory | nextjs-scripts |
| FRAMEWORKS-32 | With cache components on, every uncached read and runtime API sits inside Suspense or a cache scope, and the dev overlay reports no blocking-route insight. | zero blocking insights on audited routes | advisory | nextjs-caching |
| FRAMEWORKS-33 | Every cache directive is paired with an explicit cache lifetime, and per-request data is not cached. | one lifetime per directive | advisory | nextjs-caching |
| FRAMEWORKS-34 | Random values and timestamps in server render are behind a connection await in Suspense or inside a cache scope. | none in prerendered output | advisory | nextjs-caching |
| FRAMEWORKS-35 | Independent server data reads start in parallel, and server components do not fetch their own route handlers. | no avoidable sequential awaits | advisory | nextjs-production-checklist |
| FRAMEWORKS-36 | Server actions check authentication and authorisation themselves; this is recorded as a cross-lens consult, not a UI finding. | check inside each action | advisory | nextjs-production-checklist |
| FRAMEWORKS-37 | Internal navigation uses the framework link component so it stays client-side and prefetches. | no full document load on internal links | advisory | nextjs-production-checklist |
| FRAMEWORKS-38 | The app reports field Web Vitals; informative only. | reporting present | advisory | nextjs-production-checklist |
| FRAMEWORKS-39 | No hydration error appears in the console on any audited route, theme or viewport; React treats mismatches as a real defect, so severity starts at medium. | zero hydration errors | advisory | react-19-release, react-hydrateroot, nextjs-hydration-error |
| FRAMEWORKS-40 | Render code does not branch on the window object or read storage, media queries, clocks or random values without a server snapshot, and HTML nesting is valid. | zero invalid nestings such as p inside p or a inside a | advisory | nextjs-hydration-error, react-hydrateroot, react-19-release |
| FRAMEWORKS-41 | The hydration-warning suppression attribute is used only one level deep on leaves with unavoidable differences, never to hide structure. | every use reviewed; none on elements with element children | advisory | react-hydrateroot |
| FRAMEWORKS-42 | List keys are unique among siblings and stable; random or render-time keys are never used, and index keys only for lists that never change order. | zero missing-key warnings, zero random keys | advisory | react-rendering-lists |
| FRAMEWORKS-43 | Derived values are computed during render, state resets use a key, and effects do not chain state updates. | no effect that only sets derived state | advisory | react-no-effect |
| FRAMEWORKS-44 | A fetch inside an effect ignores stale responses or aborts them, or is replaced by framework data loading. | final results match the final query | advisory | react-no-effect |
| FRAMEWORKS-45 | Manual memoisation is justified only by a measured cost; memoised components that always receive new props gain nothing. | about 1 ms per interaction in a throttled production build | advisory | react-usememo, react-memo |
| FRAMEWORKS-46 | Expensive non-urgent updates use transitions or deferred values, while controlled text input stays synchronous. | no text-input state set inside a transition | advisory | react-usetransition |
| FRAMEWORKS-47 | An update that suspends inside a visible boundary keeps the old content with a pending indicator instead of replacing it with a fallback; React reveals suspended content at most every 300 ms. | wait at least 300 ms before calling a fallback stuck | advisory | react-suspense |
| FRAMEWORKS-48 | Suspense boundaries are no finer than the intended loading sequence; many independent spinners on one screen are a review item. | more than 3 simultaneous fallbacks (skill threshold) | advisory | react-suspense |
| FRAMEWORKS-49 | Data fetched in an effect or event handler does not trigger Suspense, so such screens need their own loading state. | own loading state present | advisory | react-suspense |
| FRAMEWORKS-50 | Asynchronous forms show a pending state, prevent double submission and display the returned error with the current React primitives. | pending indicator within 100 ms (skill choice) | advisory | react-19-release |
| FRAMEWORKS-51 | Apps that render their own root report caught, uncaught and recoverable errors; informative only. | handlers present | advisory | react-19-release, react-hydrateroot |
| FRAMEWORKS-52 | Wrappers take JSX as children and transient state stays local instead of in a top-level store, to avoid needless re-renders. | judgement | advisory | react-memo |
| FRAMEWORKS-53 | No production chunk exceeds the bundler's warning limit, and a raised limit is justified. | 500 kB uncompressed (Vite default) | advisory | vite-build-options |
| FRAMEWORKS-54 | Routes and heavy rare features are split with dynamic imports, so the landing route does not download other routes' code. | no foreign route chunk on first load | advisory | vite-features |
| FRAMEWORKS-55 | CSS code splitting and module preload stay on unless there is a reason. | defaults kept | advisory | vite-build-options, vite-features |
| FRAMEWORKS-56 | Hot paths import modules directly rather than through large barrel files. | barrels with more than 20 re-exports imported by route entries (skill threshold) | advisory | vite-performance |
| FRAMEWORKS-57 | Public source maps are off by default; when enabled, the report notes whether they are hidden. Informative, shared with security. | sourcemap setting recorded | advisory | vite-build-options |
| FRAMEWORKS-58 | Nuxt internal navigation uses its link component, which prefetches visible links. | no raw internal anchors | advisory | nuxt-performance |
| FRAMEWORKS-59 | Nuxt server data is fetched with its data composables so the browser does not request it again after server render. | no duplicate request after SSR | advisory | nuxt-performance |
| FRAMEWORKS-60 | Below-the-fold or interaction-only Nuxt components load lazily and can hydrate lazily. | lazy prefix or lazy hydration where applicable | advisory | nuxt-performance |
| FRAMEWORKS-61 | With Nuxt Image, the LCP image loads eagerly with high priority and the rest lazily. | LCP image not lazy | advisory | nuxt-performance |
| FRAMEWORKS-62 | Nuxt plugins that can be composables are composables and async plugins run in parallel (plugin wording seen through search only). | no hydration-blocking plugin | advisory | nuxt-performance, nuxt-plugins |
| FRAMEWORKS-63 | Vue and Nuxt render code avoids browser-only reads and random values during setup, initialises DOM libraries after mount and shows time-dependent text client-side. | zero Vue hydration mismatch warnings | advisory | nuxt-hydration |
| FRAMEWORKS-64 | Nuxt has an app-level error page with a clear-error action, and fragile client widgets sit in an error boundary. | error page present | advisory | nuxt-error-handling |
| FRAMEWORKS-65 | Vue lists pass stable props, very long lists are virtualised, large immutable data uses shallow references and routes load lazily. | lists over 1,000 rendered rows are a review item (skill threshold) | advisory | vue-performance |
| FRAMEWORKS-66 | The Nuxt bundle analyser runs without starting a server and its largest chunks are listed. | largest chunks listed | advisory | nuxt-analyze |
| FRAMEWORKS-67 | SvelteKit has a route error page and a fallback error document, and unexpected errors never show a stack. | 404 status and custom page | advisory | sveltekit-errors |
| FRAMEWORKS-68 | SvelteKit link preloading is not switched off globally without a reason. | default hover preloading kept | advisory | sveltekit-link-options |
| FRAMEWORKS-69 | SvelteKit load functions avoid sequential request waterfalls and stream slow non-essential data. | no avoidable sequential same-origin calls | advisory | sveltekit-performance |
| FRAMEWORKS-70 | SvelteKit images are optimised and critical fonts are preloaded and subset, since fonts are not preloaded by default. | preload configured for critical fonts | advisory | sveltekit-performance |
| FRAMEWORKS-71 | The console shows no Svelte hydration warnings. | zero hydration warnings | advisory | svelte-runtime-warnings |
| FRAMEWORKS-72 | Public, performance-sensitive SvelteKit pages do not run in SPA-only mode. | server rendering on public pages | advisory | sveltekit-performance |
| FRAMEWORKS-73 | Each Astro island uses the least eager client directive that works; immediate loading is for visible, immediately interactive UI only. | no immediate directive below the first viewport | advisory | astro-directives, astro-islands |
| FRAMEWORKS-74 | Deferred Astro server islands have fallback content of the same size. | zero layout shift from the island | advisory | astro-islands |
| FRAMEWORKS-75 | Astro content images use its image components from the source tree, carry alt text and dimensions, and the LCP image is prioritised. | prioritised LCP image | advisory | astro-images, astro-assets |
| FRAMEWORKS-76 | Astro fonts use its fonts API, preload sparingly and keep optimised fallbacks. | fallbacks kept | advisory | astro-fonts |
| FRAMEWORKS-77 | Astro has a custom 404 page, and on-demand sites a 500 page that prints no stack. | pages present | advisory | astro-pages |
| FRAMEWORKS-78 | Angular production budgets are defined and the build meets them. | initial 500 kB warning, 1 MB error; component style 2 kB warning, 4 kB error | advisory | angular-build |
| FRAMEWORKS-79 | Angular images use the optimised image directive with dimensions, the LCP image has priority and responsive images have sizes. | zero NG0913 warnings (more than 1200 px oversize, or lazy LCP) | advisory | angular-image-optimization, angular-ng0913 |
| FRAMEWORKS-80 | Angular deferred blocks do not defer content visible on load and use placeholder and loading timings to avoid flicker. | zero layout shift from deferred blocks | advisory | angular-defer |
| FRAMEWORKS-81 | Angular SSR apps enable client hydration, avoid direct DOM manipulation and reach the stable state in time. | zero hydration errors; stable within 10 s (NG0506) | advisory | angular-hydration, angular-incremental-hydration |
| FRAMEWORKS-82 | Large Angular component trees use OnPush or zoneless change detection, and zoneless apps drop zone.js. | applies to large trees | advisory | angular-skipping-subtrees, angular-zoneless, angular-runtime-performance |
| FRAMEWORKS-83 | React Router navigations and fetcher forms that wait on loaders show a pending state, with optimistic UI where the result is known. | visible pending indicator during a throttled navigation | advisory | react-router-pending-ui |
| FRAMEWORKS-84 | A React Router app with server rendering off and no prerender list is in SPA mode, which changes how first-paint findings are read. | mode recorded | tool-fact | react-router-prerendering |
| FRAMEWORKS-85 | For every detected framework the probe exercises its not-found path and, where safe, its error boundary, in light and dark. | one check per framework convention | advisory | nextjs-not-found, nextjs-error, nuxt-error-handling, sveltekit-errors, astro-pages |
| FRAMEWORKS-86 | Console warnings are aggregated per route and matched against the known framework warning strings (hydration, keys, blocking routes, font subsets, Svelte and Vue hydration, Angular image and stability codes). | zero framework warnings (dev-only warnings in dev runs only) | advisory | react-19-release, react-rendering-lists, nextjs-caching, svelte-runtime-warnings, nuxt-hydration, angular-ng0913, angular-hydration |

### 3.4 End-to-end and visual regression practice (E2E-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| E2E-01 | A fixed sleep never decides that a page is ready; readiness is a polled condition with a deadline. A short delay is allowed only when the interval itself is the measurement and is labelled so. | zero bare sleeps used as readiness | advisory | checkly-auto-waiting, biome-no-wait-for-timeout, fowler-nondeterminism |
| E2E-02 | The absence of network traffic is not a readiness signal; a visible state is. | network idle used zero times for readiness | advisory | playwright-api-page |
| E2E-03 | Checks of UI state retry until they hold or a deadline passes; one-shot reads are kept for values that cannot change. | assertion deadline 5,000 ms; test deadline 30,000 ms (Playwright defaults) | tool-fact | playwright-best-practices, playwright-test-assertions, playwright-test-timeouts |
| E2E-04 | An element is acted on only when it is visible, stable, enabled and is the hit target at the action point; a click that works only when forced reveals an overlay or a moving control and is itself a lead. | same box on 2 consecutive animation frames | advisory | playwright-actionability |
| E2E-05 | Controls are located by role and accessible name first and by DOM structure last; a control that cannot be found by role and name is evidence for an accessibility lead, and a locator matching several elements is ambiguous UI. | role and name before CSS selectors | advisory | playwright-locators |
| E2E-06 | After an action that changes route, the probe waits for the expected URL or a landmark of the destination, not for a generic navigation event. | URL predicate with a deadline | advisory | playwright-api-page |
| E2E-07 | Every flow starts in its own browser context and depends on no other flow; a flow that fails only after another one is an order-dependency defect. | one context per flow | advisory | playwright-browser-contexts, playwright-best-practices, fowler-nondeterminism |
| E2E-08 | A login is saved once per role as storage state in an ignored local folder and reused; the file holds session cookies and never leaves the machine or enters a report. Session storage is not captured. | state files git-ignored; zero in reports | advisory | playwright-auth |
| E2E-09 | Viewport, scale, locale, time zone, colour scheme, reduced motion, browser version and headless mode are set explicitly and recorded for every capture; a mismatch makes two captures not comparable. | all listed keys recorded per capture | advisory | cdp-emulation, playwright-emulation, playwright-test-snapshots |
| E2E-10 | Screens that show the current time, relative dates or countdowns are captured with a frozen clock or with those regions masked. | zero diffs caused by clock values | advisory | playwright-clock, fowler-nondeterminism |
| E2E-11 | Remote services whose answers vary are stubbed, replayed or masked; the probe sends nothing off loopback and a screen that depends on a blocked request is reported as not comparable. | zero non-loopback requests | advisory | playwright-mock, fowler-nondeterminism |
| E2E-12 | The app is started the same way every time and counts as ready when its URL answers, not after a delay. | ready on 2xx, 3xx, 400 to 403; 60 s startup budget | tool-fact | playwright-test-webserver |
| E2E-13 | Captures record which headless Chromium mode produced them, and captures from different modes are never compared. | mode must match exactly | tool-fact | playwright-browsers, chrome-headless |
| E2E-14 | In the largest study of flaky UI tests, waiting on asynchronous work caused almost half of the cases, followed by test logic, environment and runner issues; the probe checks causes in that order. | async wait about 45 %, logic about 19 %, environment about 19 %, runner about 17 % | advisory | romano-2021-ui-flaky, arxiv-1906.00673 |
| E2E-15 | A result is flaky when the same scenario, build and environment both pass and fail; a probe failure becomes a defect only when it reproduces in most isolated reruns. | at least 2 of 3 reruns fail | advisory | playwright-test-retries, playwright-test-cli, google-flaky-tests-2016 |
| E2E-16 | Every intermittent failure is classified before reporting as product race, probe wait, order dependency, data dependency, environment, external, time or unknown; only product races and reproducible failures become candidates, the rest go to the probe-reliability section. | 3 isolated reruns, then a 4x CPU rerun (skill numbers) | advisory | romano-2021-ui-flaky, fowler-nondeterminism, cdp-emulation |
| E2E-17 | Rich traces are kept for failing or flaky units only, stay local and are redacted before quoting, because they can hold cookies and personal data. | traces only on failure | advisory | playwright-trace-viewer, playwright-best-practices |
| E2E-18 | A baseline is keyed by route and state, browser, platform, viewport, scale factor, colour scheme, motion preference and locale, and is never compared across keys; a missing baseline is written as new, never as a pass. | exact key match | advisory | playwright-test-snapshots, playwright-testconfig |
| E2E-19 | A screenshot is accepted only when two consecutive captures are identical; a screen that never settles is recorded as unstable and is often a lead itself. | 2 identical consecutive captures | advisory | playwright-test-snapshots |
| E2E-20 | Before a capture, finite animations are finished, infinite ones cancelled, the caret hidden and the pointer moved off the page. | zero running animations; pointer outside the viewport | advisory | playwright-page-assertions, playwright-api-page, mdn-get-animations, mdn-prefers-reduced-motion, cdp-animation |
| E2E-21 | Every capture waits for web fonts to be ready and records fonts that failed to load; glyph-only differences are first suspected as font or rasterisation drift. | font readiness awaited before capture | advisory | mdn-fontfaceset-ready |
| E2E-22 | Volatile regions are masked with a solid colour and every mask is listed with the area it covers, so a defect under a mask is never claimed as covered. | mask colour FF00FF; above 30 % masked area the comparison is low value (skill choice) | advisory | playwright-page-assertions, playwright-test-snapshots |
| E2E-23 | Two pixels differ only when their perceptual colour distance in YIQ space, after blending with white by alpha, exceeds the per-pixel threshold. | threshold 0.2 (Playwright default); maximum delta 35215 | tool-fact | playwright-page-assertions, pixelmatch |
| E2E-24 | Pixels detected as anti-aliased in either image are counted separately and do not count as differences by default. | anti-aliasing excluded; above 1 % anti-aliased pixels means environment drift (skill choice) | tool-fact | pixelmatch |
| E2E-25 | A comparison fails when the differing pixel count exceeds its budget, the smaller of an absolute count and a ratio when both are set, else zero; a size mismatch always fails. | ratio 0.001 for full captures (skill default) | advisory | playwright-page-assertions |
| E2E-26 | Captures use one image pixel per CSS pixel unless high-DPR rendering is under test, in which case the scale factor is part of the baseline key. | CSS scale; scale factor recorded | tool-fact | playwright-page-assertions, cdp-page |
| E2E-27 | A changed screenshot is never accepted automatically; promoting it to the baseline needs an explicit decision by the owner. | zero silent baseline overwrites | advisory | playwright-test-cli, playwright-testconfig, playwright-test-snapshots |
| E2E-28 | Optional Chromium flags such as disabled font hinting can steady rasterisation; whatever flags are used are recorded and must match between compared runs. | same flag set on both sides | tool-fact | chromium-headless-switches |
| E2E-29 | When PNGs are decoded in a page, the bytes are passed in rather than fetched, so the canvas is never tainted and nothing leaves the machine; ui-audit documents this route but decodes in Node. | zero requests during a diff | tool-fact | mdn-create-image-bitmap, mdn-cors-enabled-image |
| E2E-30 | In-page pixel reads use a read-optimised sRGB 2D context; pixel data is row-major RGBA with four bytes per pixel. | data length equals width times height times 4 | tool-fact | mdn-canvas-get-context, mdn-get-image-data, mdn-pixel-manipulation |
| E2E-31 | The comparator takes a fast path for identical buffers, then applies the colour threshold and the anti-aliasing detector per pixel, draws a diff image and returns the bounding boxes of changed regions; it is original code that follows the published method. | identical images give 0; one changed pixel gives 1 | tool-fact | pixelmatch |
| E2E-32 | Canvas read-back is not bit-exact because of premultiplied alpha, colour conversion and privacy noise; a self-comparison must give zero before any diff is trusted. | self-diff equals 0 | tool-fact | whatwg-canvas, mdn-get-image-data |

### 3.5 UX heuristics, forms and checkout (UX-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| UX-01 | An action the user triggers shows a visible response within the band its duration needs; past the attention limit the user needs an estimate of completion. | 0.1 s feels instant, 1 s keeps the flow, 10 s holds attention; first feedback after 1 s with no indicator is a lead | advisory | nng-response-times |
| UX-02 | Loading indicators are not flashed for waits that finish in under a second; a show delay prevents flicker. | indicator visible less than 300 ms on the fast path (skill threshold) | advisory | nng-progress-indicators, nng-skeleton-screens |
| UX-03 | Waits of a few seconds use a looped indicator or, for whole pages, a skeleton; longer waits show percent done or a count. | 2 to 10 s looped; 10 s or more determinate | advisory | nng-progress-indicators, nng-skeleton-screens |
| UX-04 | Operations expected to run for a long time can be cancelled, and cancelling really stops them. | more than 10 s needs a working cancel control | advisory | nng-response-times, nng-user-control-freedom |
| UX-05 | Skeleton screens are for loading content, not for uploads, conversions or other processes, which use a progress bar. | no skeleton during a mutation | advisory | nng-skeleton-screens |
| UX-06 | Results, progress, success and error messages that do not take focus are announced through a status, alert or log role or a live region. | WCAG 4.1.3 (AA) | normative | wcag22-u-status-messages |
| UX-07 | After a submit or other primary action, the control shows a pending state and a second activation creates no duplicate operation. | second click 50 ms later adds zero mutating requests (skill operationalisation) | advisory | nng-ten-heuristics |
| UX-08 | A failed field is identified and its error described in text, linked to the field programmatically and not shown by colour alone. | WCAG 3.3.1 and 1.4.1 (A) | normative | wcag22, nng-errors-forms |
| UX-09 | Each field error appears next to its field, not only in a toast or banner. | within the field group or about one field height (skill tolerance) | advisory | nng-error-message-guidelines, nng-errors-forms |
| UX-10 | After a failed submit of a multi-field form, focus goes to the first invalid field or to an error summary that links to each field; the summary is never the only indicator. | focus on summary or first invalid field; summary links resolve | advisory | govuk-error-summary, nng-errors-forms |
| UX-11 | Error messages name the specific problem and how to fix it, and different causes get different messages; sign-in forms may keep one message on purpose to avoid account enumeration. | WCAG 3.3.3 (AA) where a fix is known; generic phrases alone are leads | advisory | baymard-adaptive-errors, govuk-error-message, nng-error-message-guidelines |
| UX-12 | Error copy does not blame or alarm the user. | word list per locale; never above low severity | advisory | govuk-error-message, nng-error-message-guidelines |
| UX-13 | After a failed submission, every non-secret field keeps what the user typed, including the valid ones. | all non-secret values retained | advisory | nng-error-message-guidelines, govuk-validation |
| UX-14 | A field is not marked wrong while the user is still typing its first value, and a shown error clears as soon as the value becomes valid; on-blur versus on-submit validation is a project convention. | no error after the first character of an unvisited field | advisory | baymard-inline-validation, nng-errors-forms, govuk-validation |
| UX-15 | Fields about the user carry a valid autocomplete token, and numeric, email and phone fields get a matching type or input mode. | WCAG 1.3.5 (AA) for purpose; input mode for keyboards | normative | mdn-autocomplete, mdn-inputmode, wcag22 |
| UX-16 | Every input has a persistent visible label outside the field; placeholder text is only an example. | WCAG 3.3.2 (A) | normative | nng-placeholders, nng-web-form-design |
| UX-17 | Required fields are marked, or optional ones are, consistently across the app, and the programmatic flag matches the visible mark. | zero unmarked required fields; zero mismatches | advisory | nng-required-fields |
| UX-18 | Checkout-like flows ask only for what fulfilment needs, with few optional fields. | measured count reported; more than 8 fields with an unused field is a lead | advisory | baymard-checkout-fields, nng-web-form-design |
| UX-19 | Public purchase or booking flows offer a guest path that is the most prominent option at the account step, unless an account is genuinely needed. | guest path present and prominent | advisory | baymard-guest-checkout, baymard-cart-abandonment |
| UX-20 | The full amount to pay, fees and taxes included, is shown before the committing step and equals the amount recorded. | displayed total equals stored total in minor units | advisory | baymard-cart-abandonment |
| UX-21 | Submissions that commit money, legal terms or change user data are reversible, checked or confirmed. | WCAG 3.3.4 (AA) | normative | wcag22-u-error-prevention |
| UX-22 | Data already entered in the same process is pre-filled or selectable when asked again. | WCAG 3.3.7 (A) | normative | wcag22-u-redundant-entry |
| UX-23 | Choosing an option, toggling or typing does not navigate, submit or open a window unless the user was told first. | WCAG 3.2.2 (A) | normative | wcag22 |
| UX-24 | Typed dates accept common separators and missing leading zeros, distant dates can be typed, and phone fields accept spaces and dashes. | well-formed variants accepted | advisory | nng-date-input, baymard-input-masking |
| UX-25 | Forms do not put a reset or clear-all control next to submit. | none in the submit row | advisory | nng-web-form-design, nng-reset-cancel |
| UX-26 | A disabled primary button says nearby what is missing, or stays enabled and reports errors on submit. | explanation present near a disabled submit | advisory | nng-button-states |
| UX-27 | Deleting data, cancelling paid work or moving money is guarded by undo or by a confirmation that names the object and the consequence; frequent cheap actions are not guarded. | unguarded single-click destruction is a lead | advisory | nng-confirmation-dialog |
| UX-28 | A confirmation names the item, says what will happen, labels buttons with verbs and does not put initial focus on the destructive button. | no initial focus on the destructive action | advisory | nng-confirmation-dialog, apple-hig-alerts |
| UX-29 | Destructive controls are not placed beside frequent benign ones with identical styling. | at least one redundant cue and target spacing per WCAG 2.5.8 | advisory | nng-proximity-consequential, wcag22 |
| UX-30 | An undo offered in a toast is reachable by keyboard and assistive technology and lasts long enough; errors are not shown only in toasts. | auto-dismiss under about 10 s for an actionable toast is a lead; WCAG 2.2.1 when it is the only source | advisory | nng-indicators-notifications, wcag22-u-timing-adjustable, nng-user-control-freedom |
| UX-31 | Every modal, multi-step flow and long operation has a visible way out, Escape closes non-critical dialogs and the browser Back button is never trapped. | close control or Escape; Back changes the URL | advisory | nng-user-control-freedom |
| UX-32 | Leaving a form with unsaved changes saves a draft or warns, and the warning is registered only while changes exist. | no silent loss of dirty input | advisory | nng-user-control-freedom, mdn-beforeunload |
| UX-33 | The page language is declared and matches the UI, and no untranslated keys, template braces or raw technical values appear. | WCAG 3.1.1 (A); visible key patterns are leads | normative | wcag22 |
| UX-34 | Every amount uses one formatter with an explicit locale and currency, the currency's fraction digits, and renders the same everywhere; strings are compared through formatted parts with no-break spaces normalised. | no float artefacts; no mixed formats for one currency | advisory | mdn-intl-numberformat |
| UX-35 | Dates come from a locale-aware formatter with an explicit time zone, and ambiguous all-numeric dates are avoided for mixed audiences. | same instant never shown as two calendar dates | advisory | w3c-i18n-date-formats, mdn-intl-datetimeformat |
| UX-36 | Times use one hour cycle per locale across the app. | no mix of 12 and 24 hour forms | advisory | mdn-intl-datetimeformat |
| UX-37 | Amount fields in comma-decimal locales accept comma input or reject it clearly, and never misread grouping as a decimal point. | typed value and stored value agree | advisory | mdn-inputmode |
| UX-38 | Labels and messages use the project's own domain vocabulary, never enum literals, table names or code-style status words. | visible enum or upper-case code tokens are leads | advisory | nng-ten-heuristics |
| UX-39 | One action keeps one label and one control style everywhere, and one label never triggers different actions. | no label-to-style or label-to-target divergence | advisory | nng-ten-heuristics, wcag22 |
| UX-40 | An empty list says it is empty, distinct from loading and error, and offers the next step; a "no results" text shown while the request is still pending is a false empty state. | false empty state is high; blank container is medium | advisory | nng-empty-states |
| UX-41 | Minimalism problems are reported only with a measurable effect, such as the main action pushed below the fold by decoration; judgement rules need two independent agents or a judge. | primary action not visible at 360 by 640 when it could be | advisory | nng-ten-heuristics, nng-heuristic-evaluation, nng-severity-ratings |
| UX-42 | Fields with non-obvious formats or consequences have a short hint near them; flagged only when the probe saw an error caused by that ambiguity. | judgement, evidence-bound | advisory | nng-ten-heuristics, baymard-input-masking, nng-heuristic-evaluation, nng-severity-ratings |

### 3.6 Touch, responsive and user preferences (TOUCH-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| TOUCH-01 | Each pointer target's unobscured area holds an axis-aligned square of the minimum size, unless an exception applies; the axe rule for it must be enabled explicitly and its review items judged. | 24 by 24 CSS px (WCAG 2.5.8, AA) | normative | wcag22-u-target-size-minimum, deque-axe-target-size, axe-rule-descriptions |
| TOUCH-02 | Before reporting, the spacing, equivalent, inline, browser-controlled and essential exceptions are applied, and the exception that cleared each borderline target is recorded. | 24 px circle; centre-to-rectangle distance under 12 px intersects | normative | wcag22-u-target-size-minimum |
| TOUCH-03 | Enhanced target size (2.5.5, AAA) is advisory unless the project commits to it, and has no spacing exception. | 44 by 44 CSS px | advisory | wcag22-u-target-size-enhanced |
| TOUCH-04 | Apple's guidance sets a default and a minimum control size per platform; in a touch context smaller targets are advisory leads after WCAG 2.5.8 is evaluated. Mapping points to CSS px is an inference. | iOS 44 by 44 pt default, 28 by 28 pt minimum | advisory | apple-hig-accessibility |
| TOUCH-05 | Apple's guidance also asks for padding around controls; reported only together with another target signal because the check is noisy. | about 12 pt around bezeled controls, about 24 pt around borderless ones | advisory | apple-hig-accessibility |
| TOUCH-06 | Android and web.dev guidance asks for larger touch targets with a gap between them, measured on the hit area. | 48 by 48 CSS px with an 8 px gap | advisory | android-touch-target-size, android-accessible-apps, webdev-accessible-tap-targets |
| TOUCH-07 | Research summarised by NN/g recommends a physical minimum; it justifies the platform rules but is not measured directly. | about 1 cm by 1 cm | advisory | nng-touch-targets |
| TOUCH-08 | Lighthouse 12 replaced its old 48 px tap-target SEO audit with the axe-based 24 px target-size audit; the old audit is never cited as current. | target-size in the accessibility category | tool-fact | lighthouse-v12-release, lighthouse-tap-targets |
| TOUCH-09 | Every document has a responsive viewport meta tag, which also removes the historical tap delay. | content includes width=device-width | advisory | webdev-responsive-basics, chrome-300ms-tap-delay |
| TOUCH-10 | Zoom is never disabled by the viewport meta tag. | no user-scalable=no; maximum-scale at least 2 (5 recommended) | normative | deque-axe-meta-viewport, mdn-meta-viewport, wcag22-u-resize-text |
| TOUCH-11 | At the reflow width, vertically scrolling content has no page-level horizontal overflow and loses no text or controls; excepted regions may scroll inside their own container. | scrollWidth at most clientWidth plus 1 px at 320 CSS px | normative | wcag22-u-reflow |
| TOUCH-12 | Horizontally scrolling content works at the reflow height, and on short landscape phones fixed and sticky bars leave most of the screen for content. | 256 CSS px height; fixed chrome at most 50 % of the height (skill heuristic) | normative | wcag22-u-reflow |
| TOUCH-13 | Text resizes to twice its size without loss; when text uses fixed px sizes the zoom route is used instead of a root font change. | 200 % | normative | wcag22-u-resize-text |
| TOUCH-14 | The text-spacing override causes no lost content; fixed-height small buttons are the usual failure. | the four WCAG 1.4.12 values | normative | wcag22-u-text-spacing |
| TOUCH-15 | Primary flows run in portrait and landscape; orientation locks and rotate prompts are failures, and axe's orientation rule is experimental. | both orientations | normative | wcag22-u-orientation, axe-rule-descriptions |
| TOUCH-16 | The viewport matrix is a sampling plan, not a design rule: it covers common phone, tablet and desktop widths plus one landscape phone, and adds both sides of each breakpoint the project uses. | at least 320, 360, 390, 412, 768, 1024, 1280, 1920 wide; breakpoint minus 1 and breakpoint | advisory | webdev-responsive-basics, statcounter-mobile, statcounter-tablet, statcounter-desktop, playwright-emulation, tailwind-theme-css, bootstrap-breakpoints |
| TOUCH-17 | When a page draws edge to edge, everything pinned to a screen edge is offset by the matching safe-area inset; emulated insets are test inputs. | no interactive element inside an inset band (insets 47 and 34 px are skill inputs) | advisory | webkit-iphone-x, mdn-env, cdp-emulation, apple-hig-layout |
| TOUCH-18 | Full-height containers with a control at their bottom use small or dynamic viewport units so mobile toolbars never hide the control; plain emulation cannot show this without the toolbar override. | bottom control at or above 100svh; 56 px toolbar difference (skill input) | advisory | webdev-viewport-units, cdp-emulation |
| TOUCH-19 | When a field takes focus on a phone, the field and its action stay above the on-screen keyboard; since Chrome 108 on Android the keyboard resizes only the visual viewport by default. | focused rect inside the visual viewport; keyboard at 40 % of the height (skill input) | advisory | chrome-viewport-resize, chrome-virtual-keyboard, mdn-visual-viewport, mdn-meta-viewport |
| TOUCH-20 | Text fields render at a size that avoids iOS focus zoom; the fix is the font size, never disabling zoom. Community-sourced only and not reproducible in Chromium. | computed font size at least 16 px at mobile widths | advisory | strahl-ios-zoom, heroui-issue-5326 |
| TOUCH-21 | Fields for digits, email or URLs bring up the matching on-screen keyboard through their type or input mode; input mode alone validates nothing. | type or inputmode matches the field meaning | advisory | mdn-inputmode, baymard-touch-keyboards, baymard-checkout-ux |
| TOUCH-22 | Sticky headers, footers and banners never cover a focused element completely, including with the keyboard simulation on phones. | at least 1 px of each focused element visible | normative | wcag22-u-focus-not-obscured-minimum |
| TOUCH-23 | Layouts are fully usable without hover, and hover or focus content is dismissible, hoverable and persistent. | every hover-revealed action reachable by tap or focus | normative | mq4, mdn-hover, wcag22-u-content-on-hover-or-focus |
| TOUCH-24 | Pointer and hover media queries describe the primary input only and the any- forms describe all inputs; touch sizing goes under coarse pointer queries, never under width queries. | target checks pass under a coarse pointer | advisory | mdn-pointer, mdn-hover, mq4 |
| TOUCH-25 | Swipe, pinch and other path or multipoint gestures have a single-pointer button alternative unless the gesture is essential. | WCAG 2.5.1 (A) | normative | wcag22-u-pointer-gestures |
| TOUCH-26 | Every drag interaction has a click or tap alternative unless dragging is essential or browser-native. | WCAG 2.5.7 (AA) | normative | wcag22-u-dragging-movements |
| TOUCH-27 | Non-essential actions do not fire on the press alone; they complete on release, can be aborted, or reverse on release. | WCAG 2.5.2 (A) | normative | wcag22-u-pointer-cancellation |
| TOUCH-28 | Features triggered by moving the device have a UI control and can be switched off. | WCAG 2.5.4 (A) | normative | wcag22-u-motion-actuation |
| TOUCH-29 | Under reduced motion, non-essential interaction motion is removed or replaced; 2.3.3 is AAA, so this is advisory unless the project's rules require it. | no running transform or position animation under reduce (skill interpretation) | advisory | wcag22-u-animation-from-interactions, mdn-prefers-reduced-motion, playwright-api-page |
| TOUCH-30 | Content that moves by itself beside other content can be paused, stopped or hidden; never-ending shimmer counts. | more than 5 s (WCAG 2.2.2, A) | normative | wcag22-u-pause-stop-hide |
| TOUCH-31 | Nothing flashes more than three times in any second above the flash thresholds; real flash analysis needs frame capture, so probe leads stay needs_validation. | 3 flashes per second (WCAG 2.3.1, A) | normative | wcag22-u-three-flashes |
| TOUCH-32 | Apps with a dark theme declare their colour scheme so native controls follow it, show no flash of the wrong theme on first paint and pass contrast in each scheme. | first capture already shows the final theme background | advisory | webdev-color-scheme, mdn-prefers-color-scheme, playwright-api-page |
| TOUCH-33 | Under forced colors, every control keeps a visible boundary and focus indicator and selected states are not shown by background colour alone, since shadows and gradients are removed. | border or outline present on each control under forced colors | advisory | mdn-forced-colors, devtools-emulate-css, playwright-api-page |

### 3.7 Tooling: axe-core, Lighthouse, CDP, Playwright (TOOLS-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| TOOLS-01 | axe returns passes, violations, incomplete and inapplicable results; only violations are defects, and incomplete items go to a stronger check, never closed or promoted automatically. | violations only | tool-fact | axe-api |
| TOOLS-02 | axe impact is one of minor, moderate, serious or critical (null for passes); it is a starting point for severity that a verifier may change with a reason. | four values plus null | tool-fact | axe-api, deque-glossary |
| TOOLS-03 | The axe catalogue leaves WCAG 2.2, AAA, experimental and deprecated rules off by default, so a 2.2 audit names its tags explicitly and confirms that target-size actually ran. | tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice; target-size enabled | tool-fact | axe-rule-descriptions, axe-api |
| TOOLS-04 | Rules of interest and their defaults: colour contrast on, target size off, meta viewport on, focusable scroll regions on, labels and image alt on, landmark rules on, focus-order semantics off. | as listed | tool-fact | axe-rule-descriptions |
| TOOLS-05 | axe's contrast rule skips text over background images and struggles with gradients, pseudo-element backgrounds and overlaps; such nodes come back incomplete and need pixel sampling. | 4.5:1 and 3:1 | tool-fact | deque-axe-color-contrast |
| TOOLS-06 | axe's target-size rule passes a target whose unobscured area is large enough or whose spacing circle clears its neighbours. | 24 by 24 CSS px; 24 px circle | tool-fact | deque-axe-target-size |
| TOOLS-07 | An automated pass is never a conformance claim; reports say what automated checks found and which manual checks remain, never "accessible" or "WCAG compliant". | no conformance wording | tool-fact | deque-coverage-study, axe-core-readme, gds-blog-tool-test, wai-selecting-tools |
| TOOLS-08 | axe evaluates the DOM at call time and skips hidden elements, so each UI state (menu open, dialog open, error shown) needs its own run. | one run per route, viewport, theme and state | tool-fact | axe-rule-development |
| TOOLS-09 | axe must be present in each frame to audit iframes and its configuration does not propagate into them; otherwise iframes are a recorded gap. | frame wait 60,000 ms by default | tool-fact | axe-api, cdp-page |
| TOOLS-10 | On very large pages axe can be slow; restricting result types keeps it bounded. | probe timeout at least 30 s; restricted result types above 20,000 nodes (skill choice) | tool-fact | axe-api |
| TOOLS-11 | axe-core is one self-contained browser script with no runtime dependencies; the probe loads it from the audited project's own install when present and never downloads it. | resolve from the project, including the pnpm store layout | tool-fact | npm-axe-core, axe-core-readme, npm-axe-core-playwright, npm-lighthouse, npm-eslint-plugin-jsx-a11y, playwright-api-page |
| TOOLS-12 | A strict Content-Security-Policy can refuse script injection; bypassing it is possible for the audit context only and changes page behaviour slightly. | bypass recorded per capture; ui-audit applies none | tool-fact | playwright-api-browser, cdp-page |
| TOOLS-13 | axe-core is MPL-2.0; bundling it would require shipping its licence text with the file, which is why ui-audit never vendors it. | not vendored | tool-fact | axe-core-readme |
| TOOLS-14 | axe in a jsdom environment is limited and its contrast rule does not work there; such runs are code-level evidence only. | browser runs required | tool-fact | axe-core-readme |
| TOOLS-15 | The Lighthouse performance score is a weighted mean of five metrics mapped through log-normal curves; the skill reads existing reports and never runs Lighthouse. | weights 10/10/25/30/25; bands 0-49, 50-89, 90-100 | tool-fact | lighthouse-performance-scoring |
| TOOLS-16 | Lighthouse's default mobile throttling is simulated; request-level throttling in DevTools is a weaker model and is labelled as such. | 150 ms RTT, 1.6 Mbps down, 750 Kbps up, 4x CPU | tool-fact | lighthouse-throttling |
| TOOLS-17 | A long task exceeds the long-task limit and its excess counts as blocking time between first paint and interactivity. | 50 ms; TBT mobile 200/600 ms, desktop 150/350 ms | tool-fact | lighthouse-tbt |
| TOOLS-18 | The Lighthouse accessibility score is an all-or-nothing weighted average of automated audits; 100 only means no weighted automated audit failed. | weights 10, 7 or 3 | tool-fact | lighthouse-a11y-scoring |
| TOOLS-19 | Lighthouse navigation, timespan and snapshot modes measure different things; the probe mirrors the split with load captures, interaction captures and state snapshots. | three capture kinds | tool-fact | lighthouse-user-flows |
| TOOLS-20 | The Lighthouse package is large and needs a recent Node; the skill never adds it as a dependency. | read-only use of existing reports | tool-fact | npm-lighthouse |
| TOOLS-21 | Field thresholds for LCP, INP and CLS apply at the 75th percentile; probe values are lab indicators and never "passing Core Web Vitals". | LCP 2.5/4 s, INP 200/500 ms, CLS 0.1/0.25 | tool-fact | webdev-vitals, webdev-lcp, webdev-inp, webdev-cls |
| TOOLS-22 | A load-only lab run cannot measure INP; an interaction-driving probe approximates it from Event Timing entries, which do not cover iframes. | duration threshold 16 ms | tool-fact | webdev-vitals, webdev-inp |
| TOOLS-23 | LCP stops at the first input and ignores background tabs; CLS drops input-driven shifts and uses session windows. | 1 s gap, 5 s window, 500 ms input exclusion | tool-fact | webdev-lcp, webdev-cls |
| TOOLS-24 | The LCP API is Baseline while layout-shift entries are not; unsupported entry types are recorded as not measurable, never as zero. | feature detection per entry type | tool-fact | mdn-lcp-api, mdn-layout-shift-api |
| TOOLS-25 | The CDP accessibility domain is experimental; its tree yields missing names, focusable-but-ignored nodes and unexplained invalid fields. | browser version recorded | tool-fact | cdp-accessibility |
| TOOLS-26 | The CDP emulation domain sets metrics, media features, vision deficiencies, CPU throttling and touch; vision captures are informative only. | media swept: color scheme, reduced motion, forced colors, contrast | tool-fact | cdp-emulation |
| TOOLS-27 | The classic CDP network-condition command is deprecated in favour of an experimental rule-based one; the probe tries both and records which worked. | fallback recorded | tool-fact | cdp-network |
| TOOLS-28 | CDP runtime metric names are not listed in the protocol file, so the probe treats them as optional keys. | missing names reported as not available | tool-fact | cdp-performance |
| TOOLS-29 | Heap profiling commands are experimental; snapshots can hold user data and stay in the scratch output only. | forced GC before every sample; at least 5 repetitions | tool-fact | cdp-js-protocol |
| TOOLS-30 | Overlay, CSS, Audits and Input domains provide evidence overlays, forced pseudo states, background colours for contrast and form-issue checks; overlays are never measurements. | form issues still need a verifier | tool-fact | cdp-overlay, cdp-css, cdp-audits, cdp-input |
| TOOLS-31 | Screenshots and layout metrics come from the page domain using CSS-pixel fields; full-page capture beyond the viewport is experimental. | overflow when content width exceeds layout viewport width | tool-fact | cdp-page |
| TOOLS-32 | CDP is Chromium-only in practice since Firefox removed it, so raw-CDP checks exist only on Chromium-family browsers. | engine coverage stated in the report | tool-fact | firefox-deprecating-cdp, firefox-cdp-retirement |
| TOOLS-33 | CDP sessions, coverage, tracing and over-CDP connections in Playwright work only with Chromium. | gated by engine | tool-fact | playwright-api-browsercontext, playwright-api-browser, playwright-api-browsertype, playwright-api-coverage, playwright-release-notes |
| TOOLS-34 | Context options, media emulation, clock, screenshots, aria snapshots and console capture work in all three Playwright engines; the old accessibility API was removed. | cross-engine subset | tool-fact | playwright-api-browser, playwright-api-page, playwright-release-notes, playwright-emulation |
| TOOLS-35 | Playwright's Firefox and WebKit are patched builds, WebKit is not Safari, and only the bundled Chromium is guaranteed. | driver and browser versions recorded | tool-fact | playwright-browsers, playwright-api-browsertype, playwright-release-notes |
| TOOLS-36 | playwright-core has no test assertions and no screenshot comparison, so the skill stabilises captures and compares images itself. | own comparator | tool-fact | playwright-test-snapshots, playwright-library |
| TOOLS-37 | Screenshot options can stop animations, hide the caret, mask regions and capture at CSS scale; baseline captures use them with a frozen clock. | animations off, caret hidden, CSS scale | tool-fact | playwright-api-page, playwright-test-snapshots |
| TOOLS-38 | PNGs can be decoded in a page from passed-in bytes and read through a canvas, the documented alternative to ui-audit's Node decoder. | same-size images only | tool-fact | mdn-create-image-bitmap, mdn-get-image-data |
| TOOLS-39 | Cross-origin drawing taints a canvas and privacy modes can add noise, so pixel tolerance is never zero and a self-test runs first. | self-test before any diff | tool-fact | mdn-cors-enabled-image, mdn-get-image-data |
| TOOLS-40 | A baseline is valid only for the same OS, browser build, headless mode, viewport, scale, theme and fonts; a mismatch means not comparable, never a regression. | env key match required | tool-fact | playwright-test-snapshots |

### 3.8 Host facts: Claude Code (CLAUDE-NN)

| Rule | Statement | Threshold | Kind | Sources |
|---|---|---|---|---|
| CLAUDE-01 | The SKILL.md frontmatter must open on line 1; a frontmatter that fails to parse loads silently with no fields, so a repository test is the only guard. | line 1 is ---; YAML parses | host-fact | claude-code-skills |
| CLAUDE-02 | Skill descriptions are truncated in the listing and the whole listing has a context budget; the portable format caps the description shorter still. | description at most 1,024 characters (portable); listing cut at 1,536 | host-fact | claude-code-skills, agentskills-spec |
| CLAUDE-03 | A portable skill name uses lower-case letters, digits and single hyphens and equals its folder name. | ^[a-z0-9]+(-[a-z0-9]+)*$, at most 64 characters, folder named ui-audit | host-fact | agentskills-spec, claude-code-skills |
| CLAUDE-04 | Outside Claude Code only a small set of frontmatter keys is accepted and any other key is an error, so a portable skill keeps to that set. | name, description, license, compatibility, metadata, allowed-tools | host-fact | claude-code-skills, agentskills-spec |
| CLAUDE-05 | allowed-tools pre-approves tools for one turn and restricts nothing; a public skill never pre-approves broad commands such as pushes or recursive deletes. | no broad wildcard grants | host-fact | claude-code-skills |
| CLAUDE-06 | SKILL.md stays short and points to reference files one level deep; after compaction only the first part of an invoked skill is re-attached, so hard rules sit near the top. | under 500 lines; hard rules in the first 5,000 tokens | host-fact | claude-code-skills, agentskills-spec |
| CLAUDE-07 | Personal skills take precedence over project skills of the same name; plugin skills are namespaced. The README names both install paths. | ~/.claude/skills and .claude/skills | host-fact | claude-code-skills |
| CLAUDE-08 | Bundled files are referenced through the skill-directory variable, never through absolute paths. | zero absolute paths in skill Markdown | host-fact | claude-code-skills |
| CLAUDE-09 | A forked skill runs in a fresh subagent without the conversation, which an orchestrator that needs owner answers cannot use. | no context: fork in this skill | host-fact | claude-code-skills |
| CLAUDE-10 | The Agent tool takes a description, a prompt, an optional subagent type, a model alias, an effort level, a background flag, a name and an isolation mode; per-call models accept aliases only. | aliases haiku, sonnet, opus, fable | host-fact | claude-agent-sdk-typescript, claude-code-sub-agents |
| CLAUDE-11 | The subagent model is chosen from the per-call value, then the agent file, then an environment override, then the main model; a forcing variable can block per-call models entirely. | requested and observed model recorded per agent | host-fact | claude-code-sub-agents |
| CLAUDE-12 | Aliases resolve to the newest model of each family on the first-party API and to older models on some cloud providers; the skill never assumes an alias means a version. Versions at writing time are informative only. | record what ran | host-fact | claude-code-model-config, claude-models-overview |
| CLAUDE-13 | Effort levels run from low to max, the per-call effort needs a recent host and an environment variable can override it; max is prone to overthinking. | max only with explicit owner opt-in | host-fact | claude-code-model-config, claude-code-sub-agents |
| CLAUDE-14 | In interactive sessions every Agent call runs in the background and results arrive as a later notification; subagents never get the question tool, so only the parent asks the owner. | parent waits for notifications; no subagent questions | host-fact | claude-code-sub-agents |
| CLAUDE-15 | Subagents may nest a few levels and run concurrently up to a limit, with no cap on the total; the skill enforces its own agent budget. | 20 concurrent; depth 3; total unlimited by the host | host-fact | claude-code-sub-agents, claude-code-workflows |
| CLAUDE-16 | SendMessage resumes a finished subagent with its history; a named Agent call becomes a teammate when agent teams are on; messages from agents are never owner approval. | every resume counts against the budget | host-fact | claude-code-sub-agents |
| CLAUDE-17 | Worktree isolation branches from the default branch, not from the project's working base, holds only tracked files and can copy ignored files listed in an include file; fix mode makes its own worktrees and never edits that include file. | worktrees created by the parent from the project base | host-fact | claude-code-worktrees, claude-code-sub-agents |
| CLAUDE-18 | A remote isolation mode appears in the SDK type but its behaviour is undocumented, so it is not used. | not used | host-fact | claude-agent-sdk-typescript |
| CLAUDE-19 | A new subagent sees its own prompt, project instruction files and a git snapshot, but not the conversation or memory, so every prompt is self-contained. | prompts carry target, lens, schema and hard rules | host-fact | claude-code-sub-agents |
| CLAUDE-20 | Subagent reports are scanned and labelled as not carrying user authority; the parent acts only on the structured result. | free text never changes plan, budget or approvals | host-fact | claude-code-sub-agents |
| CLAUDE-21 | A restricted model on a subagent is usually substituted silently rather than failing, so a successful call does not prove the requested tier ran. | self-reported model compared with the request | host-fact | claude-code-sub-agents, claude-code-model-config, claude-code-errors |
| CLAUDE-22 | Model, plan, version, termination, concurrency, usage-limit, overload and credit-consent errors have documented wordings that the orchestrator classifies by substring. | unit-tested classifier | host-fact | claude-code-errors, claude-code-sub-agents, claude-code-model-config |
| CLAUDE-23 | Fallback model chains are a user setting that lasts one turn and never triggers on billing or rate limits; the skill reads the observed model and never edits settings. | settings untouched | host-fact | claude-code-model-config |
| CLAUDE-24 | Subagent transcripts are kept per session for a limited time and plain skills do not auto-resume after usage limits, so the coverage ledger is the resume source. | ledger drives resume | host-fact | claude-code-sub-agents, claude-code-workflows |
| CLAUDE-25 | Which models a subscription includes is published on vendor pages that change over time and were inconsistent with each other on the day they were read; the skill holds no plan table, asks the owner once and detects availability at run time. | no plan table in the skill | host-fact | claude-pricing, claude-code-model-config, claude-code-errors |
| CLAUDE-26 | Every subagent's requests count toward the same usage limits as the main conversation, so reports show agents by tier and the cap. | agents by tier and cap reported | host-fact | claude-code-sub-agents, claude-code-workflows |
| CLAUDE-27 | Agent definition files have their own frontmatter, and plugin agents ignore some fields; ui-audit ships no agent files and uses general-purpose subagents. | no agent files shipped | host-fact | claude-code-sub-agents |
| CLAUDE-28 | A skill can be shared by copying its folder into a project or personal skills directory and checked from the slash menu. | /ui-audit appears after install | host-fact | claude-code-skills |
| CLAUDE-29 | A plugin keeps an optional manifest under .claude-plugin; a root SKILL.md with no skills folder loads as a single skill, reserved name prefixes are errors and paths stay inside the plugin. | claude plugin validate passes | host-fact | claude-code-plugins-reference |
| CLAUDE-30 | Marketplace plugins are copied into a versioned cache, get Node dependencies installed only from an npm or text bun lockfile, and keep durable state in the plugin data directory. | package-lock.json version 3 pinning playwright-core 1.63.0; no node_modules committed | host-fact | claude-code-plugins-loading, claude-code-plugins-reference |
| CLAUDE-31 | A marketplace file names the marketplace, its owner and plugin entries with relative sources; one repository can be both marketplace and plugin. | entry name equals manifest name; source ./ | host-fact | claude-code-plugin-marketplaces, claude-code-marketplace-reference |
| CLAUDE-32 | A pinned manifest version keeps users on the cached copy until it changes, and auto-update is off for third-party marketplaces by default. | bump the version on every release | host-fact | claude-code-plugins-publish, claude-code-plugins-loading |
| CLAUDE-33 | A plugin can also load for one session from a local directory or a zip URL, or every session from the personal skills directory. | no marketplace needed | host-fact | claude-code-plugins-publish, claude-code-plugins-loading |
| CLAUDE-34 | The third-party skills installer copies or links skills into the project or personal skills directory and sends anonymous telemetry unless it is disabled. | DISABLE_TELEMETRY=1 in the documented command | host-fact | vercel-skills-readme |
| CLAUDE-35 | That installer writes a lock file whose hash covers every file in the skill folder except .git and node_modules, so run output must never live inside the skill folder. | no runs, baselines or PNG files tracked | host-fact | vercel-skills-local-lock, vercel-skills-issue-549 |
| CLAUDE-36 | In unattended runs background commands have a time limit, which matters for app servers the parent starts. | 30 minutes default, 2 hours maximum (unattended only) | host-fact | claude-code-tools-reference |
| CLAUDE-37 | Worktree isolation applies only a working-directory check to PowerShell, so scripts are invoked as node commands that behave the same in any shell. | node script invocations | host-fact | claude-code-skills, claude-code-worktrees |

## 4. Standing of the standards

- **WCAG 2.2 Level A and AA is the normative accessibility baseline.** It has been a W3C Recommendation
  since October 2023 and is also ISO/IEC 40500:2025 [rule: WCAG-34]. A confirmed accessibility finding cites
  a 2.2 A or AA criterion (`WCAG22#<sc>`).
- **AAA criteria are advisory** (1.4.6, 2.3.3, 2.4.12, 2.4.13, 2.5.5, 3.3.9). They go to improvements unless a
  project rule (a confirmed `PR-` row) adopts them [rule: WCAG-02, WCAG-25].
- **WCAG 3 is a Working Draft and informative only.** It has no contrast algorithm or other thresholds yet
  and is never a pass or fail source [rule: WCAG-02].
- **Platform guidance is advisory.** Apple's 44 pt, Material and Android's 48 dp and NN/g's 1 cm back a
  finding only through a confirmed `PR-` row or a measured user consequence [rule: TOUCH-04, TOUCH-06, TOUCH-07].
  ARIA Authoring Practices are not normative; a deviation is reported under the WCAG criterion it breaks
  [rule: WCAG-35].
- **Core Web Vitals are field thresholds at the 75th percentile.** Lab numbers from the probe are lab
  numbers; a report never says a page "passes Core Web Vitals" and can say only that a lab median under a
  named preset meets a threshold [rule: VITALS-01, VITALS-18, TOOLS-21].
- **Automated accessibility checks never support a conformance claim.** axe-core and the probe find part of
  the issues; reports never use "accessible", "WCAG compliant" or "conformant" as a verdict
  [rule: WCAG-40, WCAG-41, TOOLS-07].
- **Criteria new in 2.2 have no ACT rules,** so the skill's checks for them are its own heuristics and a
  record that relies on them says so [rule: WCAG-42].
- **UX heuristics are judgement aids.** Rules that need judgement require two independent agents or a judge
  before they leave `needs_validation` [rule: UX-41].

## 5. Thresholds chosen by this skill

These numbers are engineering defaults, not values from a source. Reports label them as skill thresholds,
and the configuration or the probe config can change most of them.

| Threshold | Value | Where it applies | Rule |
|---|---|---|---|
| Flaky rule | a failure must reproduce in at least 2 of 3 isolated reruns | intermittent probe results | E2E-15, E2E-16 |
| CPU slowdown for timing reruns and the slow profile | 4x | flakiness classification, lab performance | E2E-16, FRAMEWORKS-11 |
| Visual diff ratio budget | 0.1 % of the pixels (0.001) | full-page and viewport comparisons | E2E-25 |
| Anti-aliasing drift | more than 1 % anti-aliased pixels means environment drift, not a regression | visual comparisons | E2E-24 |
| Mask warning | more than 30 % of the viewport masked makes a comparison low value | visual comparisons | E2E-22 |
| Indicator flash | a loading indicator visible for less than 300 ms is a flicker | loading feedback | UX-02 |
| Double-click interval | two clicks 50 ms apart | duplicate-submission checks | UX-07 |
| Fixed-chrome share | fixed and sticky bars at most 50 % of a landscape phone height | short landscape layouts | TOUCH-12 |
| Toolbar difference | 56 px between small and large viewport heights | 100vh checks | TOUCH-18 |
| On-screen keyboard height | 40 % of the screen height | keyboard overlap checks | TOUCH-19 |
| Safe-area insets | 47 px top and 34 px bottom (47 px sides in landscape) | edge-to-edge layouts | TOUCH-17 |
| Image ratio tolerance | rendered ratio within 2 % of the natural ratio | image distortion and reserved space | FRAMEWORKS-25 |
| Simultaneous fallbacks | more than 3 loading fallbacks visible at once is a review item | Suspense granularity | FRAMEWORKS-48 |
| Large lists | a list above 50 items that is neither virtualised nor uses `content-visibility` is a lead for review; more than 1,000 rendered rows is flagged outright (see PERFORMANCE.md) | list virtualisation | FRAMEWORKS-65 |
| Lab runs in the quick profile | 3 cold runs, below the 5 that VITALS-16 recommends; quick results are labelled lower-confidence, and a high severity resting on a quick-profile median needs a 5-run verifier | quick profile performance units | VITALS-16 |
| CLS and INP aggregation | worst of the runs, not the median | lab performance | VITALS-03, VITALS-05 |
| Initial script per route | about 170 KB compressed as the target, flagged above 250 KB | bundle analysis | FRAMEWORKS-22, FRAMEWORKS-54 |
| Single chunk | any one chunk above 100 KB compressed | bundle analysis | FRAMEWORKS-53, FRAMEWORKS-54 |
| Image oversize | natural width above rendered width x DPR x 1.5 | responsive images | FRAMEWORKS-26 |
| Route or RSC payload | above about 50 KB | server data passed to the client | FRAMEWORKS-35 |
| DOM size | more than 1,500 DOM nodes on a page | large pages | FRAMEWORKS-65, VITALS-10 |
| Mutations per keystroke | more than about 50 nodes mutated per keystroke is a finding when INP or long tasks show the cost | search and filter inputs | VITALS-03, VITALS-10 |
| Visible feedback | within 300 ms for any action that takes longer | interaction latency | UX-01 |
| Polling interval | operational screens poll no faster than every 3 to 5 s; no published number exists, the related rule covers the cost of screens left open | live-refresh screens | VITALS-25 |
| Leak cycles | at least 10 repeat cycles before reading a heap or DOM-node trend | long-session memory | VITALS-25 |
| Flash heuristic | an animation iteration under 333 ms that changes opacity, colour or background is flagged as `needs_validation` | flashing content | TOUCH-31, WCAG-15 |
| Large-text edge band | bold text between 18.5 and 18.7 CSS px is `needs_validation`, not a failure | contrast of large text | WCAG-01 |
| Error placement | inside the field's group or within about one field height | inline form errors | UX-09 |
| Fix confirmed gone | the original reproduction passes in 3 of 3 isolated reruns; 1 or 2 of 3 is `inconclusive` | fix mode re-verification | E2E-15, E2E-16 |
| Bundle report size | the 10 largest client modules per route | bundle analysis | FRAMEWORKS-22 |
| Pending indicator | a pending state visible within 100 ms of submit | async forms | FRAMEWORKS-50 |
