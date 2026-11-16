# Run Metadata, Runtime and Budget

This file settles everything a full audit must know before the first agent starts: the setup values, which browser driver to use, how the app runs in isolation and how that isolation is proven, how the build copy is made for any supported framework, who owns which files on the host and inside the sandbox, the exact `run-metadata.json` document (including the orchestration block, the model availability record and the host facts), the variant axes (viewports, matrices, themes, network profiles), the profiles, the budget, and the reasons list. [SKILL.md](SKILL.md) summarises it; [RECONNAISSANCE.md](RECONNAISSANCE.md) starts by applying it; [ORCHESTRATION.md](ORCHESTRATION.md) owns the budget, routing and availability rules that the metadata records.

Guidance mode never writes `run-metadata.json`. In guidance mode, read only the safety parts below (topologies, proofs, driver) that apply to the check at hand.

Placeholders: `<skill-dir>` is the folder holding SKILL.md, `<out>` is the run directory, `<target>` is the audited repository, `<output_root>` is the config's output root (`~/ui-audit-skill` by default).

## 1. Setup values

Resolve each value before Phase 1 and write it into `run-metadata.json` before any delegation. The parent rewrites the file whenever one of these facts changes (a new tenant procedure, a pivot viewport added after recon, the planning estimate, an observed model availability, a spent invocation, a pause or resume, the terminal state).

| Value | How to resolve it |
|---|---|
| Configuration | `ui-audit.config.json` from the first existing location of the lookup order (`${CLAUDE_PLUGIN_DATA}`, then `<skill-dir>`, then `<output_root>`), or the one-time setup question when none exists ([ORCHESTRATION.md](ORCHESTRATION.md) §5); when the owner cannot be asked at all, the defaults, with every unasked question recorded in `unasked_questions` (§8). It fixes the profile, the cap per profile, the orchestration reserve fraction, `max_parallel_agents`, declared model availability, dialogue rounds, escalation steps, the effort ceiling, `report_language` and `output_root`. Recorded in `orchestration` (§8). |
| Host overrides | Whether a delegation tool exists at all, whether the Agent tool offers `model` and `effort`, and whether the three override variables are set, read by name only (ORCHESTRATION.md §9). Recorded as `orchestration.delegation`, `routing_mode`, `forced_model`, `effort_forced`, `effort_supported`. |
| Agent permissions | The owner's answer to the permission note of SKILL.md setup step 2b, verbatim, in `host.agent_permissions`; then the counted `w0-perm` check (`orchestration.setup_calls`). |
| Host | Operating system, `claude --version` when the command exists, `node --version`. Recorded in `host`. |
| Skill directory, target | Both absolute. The target is the repository root (or the app directory the owner picked in a monorepo). |
| Repo name | A stable identifier used in paths, such as `demo-store`: the repository folder name, lowercased, with anything outside `[a-z0-9_-]` replaced by `-`. |
| Output directory | New, outside the target and outside the skill directory, on the host side: `<output_root>/<repo>/run-<N>`, N being the next integer not yet used. Inside the target only if the owner picks it and version control ignores the whole directory; otherwise ask. |
| Source ref | `{commit, branch, dirty, dirty_note}`. A dirty tree is allowed; `dirty_note` lists what differs, by file name only. |
| Report language | The config's `report_language`; `auto` means the BCP 47 tag of the language the owner wrote in. Example (Brasero): `es`. |
| Project detection | `node <skill-dir>/scripts/detect-project.mjs --root <abs-target> --out <out>/tools/project-detect.json`: framework, package manager, lockfile, install, build, serve, test, lint and typecheck commands, rule files, lint configs, axe-core location. Recorded as `project_detect` (a path), confirmed or corrected by recon 1d. |
| Driver and browser | §2. |
| Topology and proofs | §3 and §4. |
| Build | §5. |
| Host facts and browser concurrency | `sandbox.host_facts` and `sandbox.max_parallel_browsers` (§8 field rules). |
| Variant axes | Viewports, matrices, themes and network profiles (§8, §9). Pivot viewports are added after recon 1c reports the breakpoints. |
| Personas | Role IDs, display labels in `report_language`, entry routes. Account values never go here. |
| Fixture procedure | `tools/fixtures.md`, the non-seed tenant procedure if any, the data states, the spare tenant count ([RECONNAISSANCE.md](RECONNAISSANCE.md)). |
| Clock policy | §7. |
| Visual baseline | The latest approved baseline of this repository whose environment can match, or the reason there is none ([RECONNAISSANCE.md](RECONNAISSANCE.md), prior-run intake). Recorded in `visual_baseline`. |
| Profile, scope, budget | §10 and §11, the strict gate, and the planning estimate shown to the owner. |
| Fix-mode settings | Not part of an audit's metadata. Fix mode keeps its own cap, reserves, git rules and approvals in `fix/fix-log.json` and `fix/agent-log.json` ([FIX-MODE.md](FIX-MODE.md)); it reuses this run's sandbox, topology, install store and environment allowlist. |

## 2. Driver decision path

The probe ([scripts/ui-probe.mjs](scripts/ui-probe.mjs)) can drive a browser in two ways. Its default, `--driver auto`, takes the skill's own pinned `playwright-core` (item 2) when it is installed and the built-in CDP driver (item 1) otherwise; `--driver cdp` forces the built-in driver. Pick one before Phase 1 and record the choice.

1. **The built-in CDP driver.** It is part of the probe, needs no install, no download and no approval. It needs a Chromium-family executable, searched in this order (newest build first where several exist):
   - **Windows:** the newest `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe` (highest revision number), then Google Chrome, then Microsoft Edge in their standard install folders.
   - **macOS:** the newest `~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium` (or the "Google Chrome for Testing" app inside it), then `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, then `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`.
   - **Linux:** the newest `~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`, then `google-chrome`, `chromium`, `chromium-browser` on `PATH`.

   An explicit executable path from the owner overrides the search.
2. **Optional: `playwright-core` at the exact version the skill pins** (`1.63.0`; no range, no `latest`). The probe looks for it in this order:
   - the skill's own `<skill-dir>/node_modules`, installed by the owner with `npm ci` in the skill folder when the skill was installed (no question at run time: nothing is downloaded during the run);
   - a directory the owner names, passed with `--driver-path <dir>`;
   - `~/ui-audit-skill/tools/node_modules`, passed with `--driver-path ~/ui-audit-skill/tools`. Installing it there during a run is a network action on the host, so it needs the owner's explicit yes.

   It is never installed in the target. `playwright-core` downloads no browser, so it still needs an executable:
   - read `node_modules/playwright-core/browsers.json`; if its `chromium` revision equals the local build's number, the bundled resolution may be used;
   - otherwise use it only with an explicit `executablePath`, and only after a recorded check that `browser.version()` returns and the CDP handshake completes.
3. **Forbidden:** adding any driver, browser package or test dependency to the target during an audit. A proposal to add one is a follow-up for the repository's own branch flow, or a fix-mode change the owner approves.

**The question.** Ask only when something would be downloaded (a browser build, or `playwright-core` into `~/ui-audit-skill/tools`). Ask once, in `report_language`, before writing metadata. It must name what is downloaded, from which host, where it goes, and that the default needs nothing. Example (es):

> Puedo usar el Chromium que ya tienes instalado, sin descargar nada. Opcionalmente puedo instalar playwright-core 1.63.0 en ~/ui-audit-skill/tools, fuera del proyecto, desde registry.npmjs.org. ¿Autorizas esa descarga? (sí/no)

**Fallbacks:**

| Answer or state | Result |
|---|---|
| no, or no answer | CDP driver (or the skill's own `playwright-core` when present). `choice_reason` says no download was approved. |
| yes | Install pinned, run the check. If install or check fails, CDP driver, and `choice_reason` names the failure. |
| No Chromium executable and no approved download | `browser.driver: "none"`. Every runtime unit is `deferred` with `runtime_unavailable` (or `owner_declined_download` when the owner said no to the only way to get a browser); no agent attempted it, so it is not `blocked`. Ask whether to continue source-only; if yes, the run ends `incomplete` with that code. |

Record `browser.driver`, `browser.executable`, `browser.version` (from the first successful launch) and `browser.choice_reason`.

**Engines.** Chrome and Edge are Chromium, so `browser.engines` is `["chromium"]` on every local setup. Firefox and WebKit contexts, iOS Safari behaviour, the real on-screen keyboard and `visualViewport` resizing, and real screen-reader output are never reproduced locally. Units that need them are `deferred` with `engine_unavailable` when they are seeded only to record the gap (`blocked` when an agent tried and hit it); credible claims about them are `needs_validation`. Locally checkable: the accessibility tree (`Accessibility.getFullAXTree`), touch emulation, emulated media features, and the probe's experimental emulation of safe-area insets, the small-viewport height difference and the virtual keyboard rectangle (each recorded as applied or unsupported) [rule: TOUCH-17, TOUCH-18, TOUCH-19].

**Other engines.** The probe has no Firefox or WebKit mode, by decision. Its page abstraction is a CDP session; its loopback guarantee rests on Chromium-only launch flags (host-resolver rules, a dead proxy, QUIC disabled); Firefox and WebKit would get only a proxy setting and would lose the AX tree, throttling, heap and coverage data; and their builds need an owner-approved download. `browser=firefox|webkit` units stay `deferred` with `engine_unavailable`.

## 3. Runtime topologies

Target-controlled processes (install, build, start, tests, seed, fixtures) run only where all four controls of the execution-safety rule hold: no external network; an allowlisted environment with dummy secrets and scratch-local HOME, tmp and caches; the source read-only with writes limited to scratch, the build copy and the disposable database; explicit CPU, memory, process, file-size and wall-clock limits. `sandbox.topology` names how the browser reaches that app. Pick the first that the host can prove; record why in `sandbox.notes`.

**`nat-forward`.** The app runs in a local VM (WSL2 on Windows; Lima, Colima or Multipass on macOS or Linux) bound to `127.0.0.1`, as a dedicated user (for example `audit`). The VM forwards its loopback ports to the host's loopback, so the host browser reaches `127.0.0.1:<port>`. Egress is blocked by owner-match firewall rules for that user rather than by a namespace:

```
iptables  -A OUTPUT -m owner --uid-owner audit ! -o lo -j REJECT
ip6tables -A OUTPUT -m owner --uid-owner audit ! -o lo -j REJECT
```

This is the usual choice on Windows and macOS. Record the VM's networking mode in `sandbox.vm_networking` (`nat`, `mirrored`, `user` for user-mode forwarding, or null). In a mirrored mode the host's loopback and the VM's are shared, so the egress proof must be run as the app's user, not as the parent's.

**`netns-bridge`.** The app and its database run in a persistent Linux network namespace created for the run, on a native Linux host or inside a VM. The root namespace reaches it over a veth pair; the namespace has no default route, and its firewall lets out only loopback traffic and replies to connections that came in over the veth. A loopback listener in the root namespace forwards to the app; when the namespace lives inside a VM, the VM's loopback forwarding carries that listener to the host browser. The worked example. Example (Brasero):
```
# once per run, as root
ip netns add uiaudit
ip link add ua-host type veth peer name ua-app
ip link set ua-app netns uiaudit
ip addr add 10.77.0.1/30 dev ua-host && ip link set ua-host up
ip netns exec uiaudit ip addr add 10.77.0.2/30 dev ua-app
ip netns exec uiaudit ip link set ua-app up && ip netns exec uiaudit ip link set lo up
ip netns exec uiaudit iptables  -P OUTPUT DROP
ip netns exec uiaudit iptables  -A OUTPUT -o lo -j ACCEPT
ip netns exec uiaudit iptables  -A OUTPUT -o ua-app -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip netns exec uiaudit ip6tables -P OUTPUT DROP
ip netns exec uiaudit ip6tables -A OUTPUT -o lo -j ACCEPT
# inside the namespace, as user audit, under the run's limits
#   PostgreSQL 16 on 127.0.0.1:55433 (a run-owned cluster; any other run's database uses 55432)
#   NODE_ENV=production next start -p 3100 -H 0.0.0.0   (reachable on lo and on 10.77.0.2 only)
# in the root namespace
socat TCP-LISTEN:3100,bind=127.0.0.1,fork,reuseaddr TCP:10.77.0.2:3100
```

The namespace, the database and the server are long-lived run services, torn down by the parent at the end of the run. Never host them with a per-call sandbox wrapper that creates and destroys its namespace or database per call. A Unix-socket bridge (`socat UNIX-LISTEN` inside, `UNIX-CONNECT` outside) is an acceptable variant when a veth pair cannot be created; the proofs are the same. Use `netns-bridge` when owner-match rules are unavailable or when the database must share the app's isolation.

**`browser-in-vm`** (legacy name `browser-in-wsl`, still accepted). The browser runs inside the same VM as the app, so no forwarding hop sits between them. It needs a Linux Chromium inside the VM, which is a download and so needs the owner's yes unless one is already there. With `host-only`, it is the way to measure without the forwarding hop (see the VM boundary in [PERFORMANCE.md](PERFORMANCE.md)).

**`container-loopback`.** The app and its database run in a rootless container or pod with no route out: started with no network except a port published to `127.0.0.1` only, for example `--network none` plus a socket proxy bound to the host's loopback, or an internal network with no gateway and a loopback-only published port. The container runs as a non-root user with the run's limits as container limits, the source mounted read-only and only the build copy and the database volume writable. The egress proof (§4) runs inside the container as the app's user. Record the runtime and its version in `sandbox.notes`.

**`host-only`.** App and browser both on the host. Allowed only when every one of the four controls can be shown on the host itself (on Linux, for example, a dedicated user with owner-match rules, or a namespace). On Windows and macOS this is rarely possible without a VM or container; `sandbox.notes` records why it was or was not.

## 4. Topology proofs

A topology without its two proofs is not a topology, and an app that is not proven to listen on loopback only does not take part in Phase 2. Until the ready and egress proofs are recorded in `sandbox.proof`, runtime units stay `planned`; if the proofs cannot be produced they become `deferred` with `runtime_unavailable`. `blocked` is reserved for a unit an agent attempted: it needs an owning agent, reviewed paths and checks ([RECONNAISSANCE.md](RECONNAISSANCE.md), state table), which a unit nobody ran cannot have. The bind proof must pass for whatever serve command is used (script, framework CLI or the skill's static server) before any hunter starts.

**Ready probe.** From the side where the browser runs, one plain GET of `app.ready_path` on `app.base_url` returns 2xx or 3xx. It uses no session and no steps. On macOS and Linux:

```
curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/
```

On Windows use `curl.exe` (the shell alias `curl` is a different command) and `-o NUL`. A 2xx or 3xx status passes. Record the exact command, the status and the time.

**Egress probe.** From inside the app's environment, as the app's user, a 5-second connection attempt to a DNS name and to an IP literal on port 443 must both fail:

```
sudo -u audit timeout 5 curl -sS -m 5 https://example.com     # must fail
sudo -u audit timeout 5 curl -sS -m 5 https://1.1.1.1         # must fail
```

For `netns-bridge`, prefix with `ip netns exec <ns>`; for `container-loopback`, run it with the container runtime's `exec` as the app's user. A name that resolves is acceptable only if the connection still fails; record both outcomes (`refused`, `unreachable`, `resolve-failed`). Any success fails the proof, and nothing target-controlled runs until it is fixed.

**Bind probe.** From inside the app's environment, list the app process's listening sockets (`ss -ltnp` on Linux; `lsof -nP -iTCP -sTCP:LISTEN` on macOS; `Get-NetTCPConnection -State Listen` or `netstat -ano` on Windows; the runtime's port listing for a container). Every listening address must be a loopback address (`127.0.0.1`, `::1`), or, for `netns-bridge`, an address that exists only inside the namespace; a published container port must be bound to `127.0.0.1` on the host. A wildcard bind (`0.0.0.0`, `::`) reachable from outside the isolation fails the proof. Several frameworks listen on every interface unless they are given a host [rule: FRAMEWORKS-01]; this is why serve commands always carry the loopback host (§5). Record the command, the addresses seen and the time in `sandbox.proof.bind_probe`.

Re-run all three proofs if the app is restarted, the VM or container restarts, or the firewall, namespace or port publishing changes, and on every resume. The browser's own block (dead proxy, host-resolver rules, QUIC disabled) is applied by the probe on every launch and is not a substitute for the egress proof: one protects the browser, the other the app. The probe's target guard (a ready marker or an expected header that only the disposable build shows) is a fourth, separate check that the probe makes before its first capture ([HUNTING.md](HUNTING.md)).

## 5. Build procedure

The commands come from `<out>/tools/project-detect.json` (written by `scripts/detect-project.mjs`, confirmed or corrected by recon 1d), never from memory of a framework. The VM paths below are examples of the shape, not requirements.

1. **Reuse and verify the prepared environment.** An earlier run may have prepared the sandbox (for example a `/opt/audit` tree inside a VM, or a container image). Verify instead of trusting: the Node version (and the package manager version the lockfile needs), the package store or cache, the database engine, the dedicated user, and the firewall, namespace or container network rules. Example (Brasero): a `/opt/audit` tree left by an earlier run names its prepared environment.
2. **Copy the source from version control, without environment files.** Build the copy (for example `/opt/audit/build/<run>` inside the VM) from `git archive <commit>` with the environment-file exclusion set `ENV_EXCLUDE_PATHSPECS`:

   ```
   git -C <target> archive <commit> -- . ':(exclude,glob)**/.env' ':(exclude,glob)**/.env[._-]*' ':(exclude,glob)**/*.env' ':(exclude,glob)**/.envrc' ':(exclude,glob)**/.dev.vars'
   ```

   For a dirty tree, list the files with `git ls-files -co --exclude-standard`, drop every path that `isForbiddenPath` flags, and pipe the rest to tar. After extraction, list the copy's files and delete every remaining environment file by name only (directory listing plus `isForbiddenPath`, `.env.example` included), without opening any. The copy also never contains upload or storage directories, build output and caches (`.next/`, `.nuxt/`, `.output/`, `.svelte-kit/`, `.astro/`, `.angular/`, `dist/`, `build/`, `out/`), `node_modules/`, `.git/` or the output directory. Example (Brasero): `.storage/` is the upload directory left out. List the copy's top level in `sandbox.copy_manifest` and check that no excluded name is present before any install. Refresh the copy to the current source ref before every build; never reuse a copy an earlier run left. Never reuse the host's `node_modules`: native modules built for another operating system (database engines, image libraries, CSS compilers, bundler binaries) do not load inside a Linux sandbox. The owner's working tree is never built in place.
3. **Scan for network needs.** Before installing, list what install and build will fetch: registry packages, binaries downloaded by postinstall scripts, build-time web fonts (for example Google Fonts fetched by a font loader), remote images fetched during the build, and network calls in build-time code (static parameter generation, prerendering, content fetching).
4. **Install and build offline when everything is cached.** The install command from `project-detect.json`, in its offline form, from a store or cache filled earlier:

   | Package manager | Offline install |
   |---|---|
   | pnpm | `pnpm install --frozen-lockfile --offline` with `--store-dir` pointing at the prepared store |
   | npm | `npm ci --offline` with `--cache` pointing at the prepared cache |
   | yarn classic | `yarn install --frozen-lockfile --offline` from a prepared offline mirror |
   | yarn berry | `yarn install --immutable` with the project's offline cache and the network disabled (`YARN_ENABLE_NETWORK=0`) |
   | bun | `bun install --frozen-lockfile` with a prepared cache directory and egress blocked |

   Then any code generation the stack needs (an ORM client, generated routes) with its engines already cached, then the build command. All of it runs with egress blocked; a download attempt fails the step. A plain static site has no build; an app with a static export is built, then served from its output directory.
5. **Otherwise, the owner-approved preparation step.** If step 3 found anything not cached, ask the owner once, in `report_language`, naming each host. With an explicit yes, run install and build once, in the build copy only, with dummy environment values, before any fixture or agent, with egress allowed only to the named hosts (Example (Brasero): `registry.npmjs.org`, `fonts.googleapis.com`, `fonts.gstatic.com`, plus the ORM engine host if step 3 found one). Record `sandbox.prep_network` as `{approved_at, hosts}`. Then close the network, re-run the egress probe, and only then start the app. Without a yes, the build cannot run (`build_fetch_required`, or `owner_declined_download`), runtime units are `deferred` with that code, and the run is source-only for them. Never open the network silently. This step, the driver or browser download of §2 and, in fix mode, the install of gate A2 and the push approved at gate A3 are the only actions of the skill that send data off loopback, each with the owner's explicit yes.
6. **Start.** Start the production build under the run's limits, bound as the topology requires (§3), with the serve command of `project-detect.json`:
   - a project script (`kind: "script"`) gets the loopback host and the port appended in the package manager's argument style (`npm run <script> -- <flags>`, `pnpm run <script> <flags>`, `yarn run <script> <flags>`, `bun run <script> <flags>`), or as `HOST=127.0.0.1` and the port variable for frameworks that take them from the environment;
   - a framework CLI (`kind: "framework-cli"`) is run with the host and port flags of its row;
   - a static site or static export (`kind: "static-server"`) is served by `node <skill-dir>/scripts/static-serve.mjs --root <dir> --port <port>`, which binds loopback only and can add the header the probe's target guard expects (`--header`).

   The environment is an allowlist: `NODE_ENV=production`, the host and port variables, dummy values for the variable names the app needs, and the telemetry switches `NEXT_TELEMETRY_DISABLED=1`, `NUXT_TELEMETRY_DISABLED=1`, `ASTRO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` for every target process. Record `app.build_command`, `app.start_command`, `app.serve_kind`, `build_mode`, `base_url`, `ready_path`, the environment variable names (never values) and `sandbox.limits`: short wall-clock limits for one-shot commands, and the run's planned duration for the server and the database. Then run the bind probe (§4).

A development build is acceptable for functional units when the production build is blocked, but `build_mode` says so, every number measured on it is labelled dev-only, and every performance unit is then `deferred` with `runtime_unavailable: production build unavailable`.

**Parent tools in the sandbox.** Written by the parent under `<out>/tools/` and copied into the sandbox's run directory:

- a database reset script (`app.database.reset_command`): recreates the disposable database and runs the project's migrations. Used only before fixtures and session capture, never after agents start.
- a read-only row count tool (`app.database.count_command`) for the target's own database engine: exactly two arguments, `<tenant_slug> <table_key>`, a fixed table allowlist inside the tool, one parameterised statement, a database role that can only read, and one integer as output. Its full contract and the way an agent calls it are under "Row counts" in [HUNTING.md](HUNTING.md). The parent may grant its exact invocation to an agent for that agent's own tenant; the output is recorded as a `test` check. Example (Brasero): `tools/db-count.sh` against PostgreSQL with a role holding only `pg_read_all_data`.

## 6. File ownership across host and sandbox

| Location | Holds | Writer |
|---|---|---|
| `<out>/` on the host | `run-metadata.json`, `coverage-ledger.json`, `findings.json`, `fingerprint-agents.json`, `agent-log.json`, reports, `fixtures/`, `sandbox/` | parent |
| `<out>/tools/` | `project-detect.json`, `availability.json` (the parent's current view of each model alias), `estimate-input.json`, sweep configs, approval text files, sandbox scripts | parent |
| `<out>/visual/` | `diff-summary.json` and diff images from `scripts/ui-diff.mjs` | parent (script run) |
| `<out>/agents/<id>/scratch/` on the host | probe configs, probe output, `result.json` | that agent |
| `<out>/agents/<id>/artifacts/` | promoted evidence | parent |
| `<out>/fix/`, `<out>/FIXES.md` | fix mode's logs, per-fix check logs, bundles, `PR.md` files | parent |
| `<out>/worktrees/<fix-id>/` | fix-mode git worktrees of the target, outside the target | parent creates; that fix's fixer edits inside it |
| `<output_root>/<repo>/baselines/<baseline-id>/` | promoted visual baselines and their manifest | parent (`ui-diff.mjs --promote`, `--approve`) |
| the config location (§1) | `ui-audit.config.json` | parent, only after the setup question or an owner request |
| build copy inside the sandbox | the source copy and its build output | sandbox user |
| database data and app logs inside the sandbox | disposable database, app logs | sandbox user |

Sandbox processes never write to host paths mounted into the VM or container (for example `/mnt/c/...` inside WSL); the parent copies the sandbox logs it needs into `<out>/sandbox/`. Agents' scratch is host-side because the browser runs there (except in `browser-in-vm`, where the parent copies each agent's probe output out of the VM into that agent's scratch before promotion). Promotion is host-side; Windows has no `O_NOFOLLOW`, so the lstat/open/fstat identity fallback applies there.

## 7. Clock, throttles and logins

**Clock.** `clock.timezone` is the app's business time zone (Example (Brasero): `America/Bogota`).

- `client_time: "init-script-shift"` replaces `Date` and `Date.now` with a clock that starts at a configured instant and advances in real time (probe `clock.now`). `none` leaves the client clock alone. The time-zone override never moves the instant.
- `server_time: "seeded-boundaries"` means fixtures hold records just before and after midnight, shift or day changes and similar edges, relative to the real server clock. `none` means no such records. No faketime is used.
- A claim that depends on the real server clock crossing a boundary is `needs_validation`.

**Throttles.** Every agent connects from `127.0.0.1`, so IP-keyed limits are shared by all tenants. They are never reset by changing code or data mid-run.

**Logins.** After fixtures, the parent's `fixtures` agent logs each persona in once per tenant with the probe's `saveStorage` and stores the result at `fixtures/sessions/<tenant_id>/<role>.json`. Agents get the path read-only and never submit the login form. Logout is pressed only in units that test it. Session expiry is simulated with `clearCookies` or a dedicated tenant. Units that test login, logout or throttles use a dedicated login tenant (for example `audit-login`) and run in a final dedicated wave with no other runtime agent active. If they cannot be isolated, they are `deferred` with `throttle_shared`.

Example (Brasero): the seed creates only the restaurant, the account, an owner and an employee, and running it resets the account password and deletes all sessions, so it runs only before session capture. Fixtures add terrace tables, categories, products, opening hours, booking fees, an open shift and orders; each mutating agent gets its own restaurant slug such as `audit-h3`.

## 8. run-metadata.json

Written by the parent before any delegation and kept current through the run. Exact shape (values are a fictional Vite and React storefront called `demo-store`, run 4, just after the planning estimate; `string|null`, `ISO-8601` and `<...>` mark the type where the example has no fixed value):

```json
{
  "schema": "ui-audit/run-metadata@3",
  "skill_version": "2.0.0",
  "run_id": "run-4",
  "repo": "demo-store",
  "target": "<abs path to the target>",
  "host": {"os": "linux", "claude_code_version": "string|null", "node_version": "v24.0.0", "agent_permissions": "string|null"},
  "source_ref": {"commit": "abc123", "branch": "main", "dirty": false, "dirty_note": null},
  "report_language": "en",
  "profile": "standard",
  "scope": {"kind": "full", "paths": [], "routes": [], "lenses": [], "diff": null, "excluded": [".claude/**", ".agents/**"]},
  "budget": 40,
  "budget_note": "string|null",
  "orchestration": {
    "agent_cap": 40,
    "cap_source": "config",
    "reserve_cap": 40,
    "reserve": {"reconnaissance": 4, "critics": 2, "validation": 2, "orchestration": 6},
    "reserve_floor": 6,
    "reserve_floor_met": true,
    "setup_calls": 1,
    "orchestration_reserve_fraction": 0.1,
    "max_parallel_agents": 4,
    "dialogue_max_rounds": 2,
    "escalation_max_steps": 2,
    "allow_max_effort": false,
    "allow_fable_usage_credits": false,
    "effort_supported": null,
    "effort_forced": null,
    "routing_mode": "per_call",
    "forced_model": null,
    "named_agents": true,
    "resume_supported": null,
    "delegation": "agent_tool",
    "config_source": "config_file",
    "config_path": "~/.claude/skills/ui-audit/ui-audit.config.json",
    "owner_plan_note": "string|null",
    "models": {
      "haiku": {"declared": "assume_available", "observed": "untested", "first_evidence_seq": null},
      "sonnet": {"declared": "probe", "observed": "untested", "first_evidence_seq": null},
      "opus": {"declared": "probe", "observed": "untested", "first_evidence_seq": null},
      "fable": {"declared": "probe", "observed": "untested", "first_evidence_seq": null}
    }
  },
  "planning_estimate": {"units": 36, "hunters": 6, "hunter_calls": 6, "waves": 4, "critics": 5, "critic_calls": 5,
                        "verifiers": 18, "verifier_calls": 18, "setup_calls": 1, "recon_calls": 4, "orchestration_reserve": 6,
                        "reserve_floor": 6, "total_calls": 40, "cap": 40,
                        "fits": true, "availability": {"haiku": "available", "sonnet": "untested", "opus": "untested", "fable": "untested"},
                        "by_model": {"haiku": 2, "sonnet": 23, "opus": 9, "fable": 0}, "panel_calls": 0,
                        "uncovered_if_capped": {"units": 0, "candidates": 0}, "shown_to_user_at": "ISO-8601|null"},
  "agents_spent": 0,
  "agents_breakdown": {"reconnaissance": 0, "hunters": 0, "critics": 0, "candidate_verifiers": 0, "record_verifiers": 0,
                       "replacement_verifiers": 0, "consults": 0, "judges": 0, "escalations": 0, "panels": 0,
                       "schema_repairs": 0, "unspent": 40},
  "execution_policy": "local-loopback-disposable-data",
  "project_detect": "tools/project-detect.json",
  "app": {
    "framework": "vite",
    "host": {"kind": "vm", "vm": "<VM or distribution name>", "path": "/opt/audit/build/run-4"},
    "build_command": "pnpm run build",
    "start_command": "sudo -u audit env NODE_ENV=production pnpm run preview --port 4173 --strictPort --host 127.0.0.1",
    "serve_kind": "script",
    "build_mode": "production",
    "base_url": "http://127.0.0.1:4173",
    "ready_path": "/",
    "env_names": ["API_URL", "NODE_ENV", "DO_NOT_TRACK"],
    "database": {"engine": "postgresql-16", "location": "127.0.0.1:55433 (inside the VM)", "disposable": true, "reset_command": "tools/reset-db.sh", "count_command": "tools/db-count.sh"}
  },
  "browser": {"driver": "cdp", "executable": "<abs path to the browser executable>", "version": "string|null", "engines": ["chromium"], "headless": true, "choice_reason": "no download needed; local Chromium build"},
  "sandbox": {
    "topology": "nat-forward",
    "vm_networking": "nat",
    "proof": {
      "ready_probe": {"command": "...", "result": "200", "at": "ISO-8601"},
      "egress_probe": {"command": "...", "result": "refused", "at": "ISO-8601"},
      "bind_probe": {"command": "...", "result": "127.0.0.1:4173 only", "at": "ISO-8601"}
    },
    "copy_manifest": ["index.html", "package.json", "pnpm-lock.yaml", "public", "src", "tsconfig.json", "vite.config.ts"],
    "prep_network": {"approved_at": "ISO-8601|null", "hosts": ["registry.npmjs.org"]},
    "max_parallel_browsers": 2,
    "host_facts": {"cpu": "string|null", "total_memory": "16 GiB", "free_memory_at_perf_wave": "string|null",
                   "vm_limits": "string|null", "cpu_benchmark_ms": null},
    "limits": {"one_shot_wall_clock_s": 900, "services_wall_clock_s": 28800, "memory": "4G", "cpus": 2, "processes": 512, "file_size": "2G"},
    "environment": "...", "target": "...", "writes": "...", "notes": "..."
  },
  "visual_baseline": {"baseline_id": "run-3", "approved": true, "diff_summary": "visual/diff-summary.json", "note": null},
  "viewports": [
    {"id": "m320", "width": 320, "height": 568, "dpr": 2, "mobile": true, "touch": true},
    {"id": "m390", "width": 390, "height": 844, "dpr": 3, "mobile": true, "touch": true},
    {"id": "t768", "width": 768, "height": 1024, "dpr": 2, "mobile": true, "touch": true},
    {"id": "d1440", "width": 1440, "height": 900, "dpr": 1, "mobile": false, "touch": false}
  ],
  "themes": ["light", "dark", "system"],
  "matrices": {
    "quick": {"viewports": ["m390", "d1440"], "themes": ["light", "dark"]},
    "core": {"viewports": ["m320", "m390", "t768", "d1440"], "themes": ["light", "dark"]}
  },
  "network_profiles": {
    "fast": null,
    "slow4g": {"latency_ms": 150, "down_bps": 204800, "up_bps": 96000, "cpu_throttle": 4},
    "slow3g": {"latency_ms": 2000, "down_bps": 51200, "up_bps": 51200, "cpu_throttle": 4},
    "offline": {"offline": true},
    "flaky": {"base": "slow4g", "cycle_ms": 4000, "offline_ms": 1500}
  },
  "personas": [{"role": "customer", "label": "Customer", "entry_route": "/", "description": "..."},
               {"role": "admin", "label": "Store admin", "entry_route": "/admin", "description": "..."}],
  "fixtures": {"procedure": "tools/fixtures.md", "tenant_procedure": "tools/add-tenant.md|null", "accounts_file": "fixtures/accounts.json", "tenants_file": "fixtures/tenants.json", "sessions_dir": "fixtures/sessions", "data_states": ["empty", "one", "typical", "heavy", "longtext"], "spare_tenants": 6},
  "clock": {"timezone": "America/New_York", "client_time": "init-script-shift", "server_time": "seeded-boundaries", "server_process_tz": "UTC"},
  "shared_ui_files": ["pnpm-lock.yaml", "vite.config.ts", "index.html", "src/main.tsx", "src/styles/global.css"],
  "selected_companion_files": ["RESPONSIVE-AND-LAYOUT.md"],
  "prior_run_paths": ["<output_root>/demo-store/run-3"],
  "prior_run_note": "string|null",
  "shared_file_owners": {"findings.json": "parent"},
  "coverage_note": "string|null",
  "unasked_questions": [],
  "run_status": "in_progress",
  "pause_reason": null,
  "resumes": [],
  "incomplete_reason": null,
  "started_at": "ISO-8601",
  "finished_at": null
}
```

The example declares only the viewports and matrices a `standard` run needs; a `deep` run declares every viewport its matrices name, `full` and `pivot` included (§9).

**Field rules.**

- `schema` is `ui-audit/run-metadata@3`. The ledger validator still reads `@2` files from earlier runs (prior-run intake), but applies the checks below only to `@3`. In `@2` files, `sandbox.wsl_networking`, `app.host.kind: "wsl"` and `app.host.distro` mean what `vm_networking`, `kind: "vm"` and `vm` mean here.
- `skill_version` is the `version` of the skill's `package.json`. `host.os` is `win32`, `darwin` or `linux`; `host.claude_code_version` is the output of `claude --version` or null; `host.node_version` is `node --version`; `host.agent_permissions` is the owner's answer to the permission note of SKILL.md setup step 2b, verbatim (at most 2000 characters), or null when the owner was not asked. No other `host` key is allowed.
- `profile`: `quick|standard|deep`. `scope.kind`: `full|paths|routes|lenses|diff`; `scope.diff` is `{base, head}` or null; `scope.excluded` always contains the skill directories and any other agent-skill directory.
- `budget` equals `orchestration.agent_cap`: the cap in force, after any owner override. `budget_note` holds the override's words, the raw reset text of a usage limit, and anything else the owner should read about the budget.
- **`orchestration`** (rules in ORCHESTRATION.md and checked by the ledger validator with `--metadata`):
  - `agent_cap` is an integer from `minimumCap(profile, orchestration_reserve_fraction)` to 500. `cap_source` is `profile_default`, `config` or `owner_at_run`.
  - `reserve` holds the four reserves computed at the strict gate, and `reserve_cap` the cap in force at that moment. `reserve_floor` is the floor of ORCHESTRATION.md §1.2 at the gate (an integer of at least 2) and `reserve_floor_met` says whether the cap held it; the two are written together. When the floor is held, `reserve` equals `computeReserve(profile, reserve_cap, fraction, reserve_floor)`; when the owner kept a cap too small for it, `reserve` equals `computeReserve(profile, reserve_cap, fraction)` and that cap must indeed be too small. `setup_calls` (0 to 2, normally 1) counts the calls made before the gate, the `w0-perm` check. The sum of the reserves plus `setup_calls` plus one hunter must fit in `reserve_cap`, and `reserve_cap <= agent_cap` (equal unless an owner override later raised the cap). The reserve is never recomputed silently; only the gate writes it.
  - `orchestration_reserve_fraction` 0.05 to 0.30; `max_parallel_agents` 1 to 20; `dialogue_max_rounds` 1 to 3; `escalation_max_steps` 0 to 3; `allow_max_effort` and `allow_fable_usage_credits` booleans, copied from the config.
  - `effort_supported` is null until the first call shows whether the host honours `effort`, then a boolean. `effort_forced` is null, an effort level forced by the host, or `"absent"` when the Agent tool has no `effort` parameter.
  - `delegation` is `agent_tool` (subagents through the host's delegation tool) or `inline` (no delegation tool: the parent plays every role, ORCHESTRATION.md §9.5, and `routing_mode` must be `single_model`). `resume_supported` is null until a resume is tried, then false after the first refused resume and true once one works (ORCHESTRATION.md §9.1).
  - `routing_mode` is `per_call` or `single_model`; `forced_model` is the forced alias or model name when a host override forces one, else null (non-null only with `single_model`). `named_agents` is true when named Agent calls behave as subagents, false when they start teammates (ORCHESTRATION.md §9).
  - `config_source` is `config_file`, `setup_question` or `defaults`. `config_path` is the config file used, with the home directory written as `~` (or starting with `${CLAUDE_PLUGIN_DATA}`), and null exactly when `config_source` is `defaults`.
  - `owner_plan_note` is the owner's own words about their plan or setup, copied from the config (at most 200 characters) or null. It is quoted in the run statement of COVERAGE.md and never used for routing, availability or the cap.
  - **`models`** is the model availability record: exactly the four aliases `haiku`, `sonnet`, `opus` and `fable`, each `{declared, observed, first_evidence_seq}`. `declared` comes from the config (`assume_available`, `probe`, `unavailable`). `observed` starts `untested` and changes only on run-time evidence: `available` (a call on that alias returned and its self-report named the same family), `unavailable` (a failure class that makes the alias unusable, or a declared `unavailable`), `substituted` (the self-report named another family), `unknown` (calls returned but no self-report named a family; the value used for every alias on single-model hosts). `first_evidence_seq` is the `seq` of the invocation in `agent-log.json` that first set the observed value. The skill never derives availability from a plan; the same record, with its resets on resume, is mirrored in `agent-log.json` `model_availability`.
- **`planning_estimate`** is the output of `node <skill-dir>/scripts/orchestrate.mjs estimate` plus `shown_to_user_at`: `units`, `hunters`, `hunter_calls`, `waves`, `critics`, `critic_calls`, `verifiers`, `verifier_calls`, `setup_calls`, `recon_calls`, `orchestration_reserve`, `reserve_floor`, `total_calls`, `cap`, `fits`, `availability` (the view it priced with), `by_model`, `panel_calls`, `suggestion` and `options` when it does not fit, `uncovered_if_capped`, `unrouted_groups`, and, from skill 2.1.0, `units_seeded`, `units_expected` and `assumptions` (`candidate_rate`, `candidate_rate_source`, `expected_candidates`, `unit_growth`, `unit_growth_source`, and from 2.2.0 `verification`: the expected strong, single, batched minor and batched source-only candidates, the Phase 5 records and the shares used). The `*_calls` figures are priced: a line routed to a fallback panel costs the panel's worst case.
- **`agents_spent`** counts invocations that count against the cap. **`agents_breakdown`** has exactly the keys `reconnaissance`, `hunters`, `critics`, `candidate_verifiers`, `record_verifiers`, `replacement_verifiers`, `consults`, `judges`, `escalations`, `panels`, `schema_repairs` and `unspent`, non-negative integers that sum to `budget`, with `budget - unspent == agents_spent`. Each counted invocation maps to one key by the table in ORCHESTRATION.md §8; `validate-orchestration.cjs --metadata` checks that the agent log's counts equal these figures.
- `project_detect` is the path, relative to `<out>`, of the detection result. `app.framework` repeats its `framework` for the audited app; `app.serve_kind` is `script`, `framework-cli` or `static-server`.
- `app.host.kind`: `host|vm|container`; `vm` is the VM, distribution or container name, or null. `build_mode`: `production|development`.
- `browser.driver`: `playwright|playwright-core|cdp|none`.
- `sandbox.topology`: `nat-forward|netns-bridge|browser-in-vm|browser-in-wsl|container-loopback|host-only` (`browser-in-wsl` is the legacy name of `browser-in-vm`). `sandbox.vm_networking`: `nat|mirrored|user` or null. `sandbox.proof` holds `ready_probe`, `egress_probe` and `bind_probe`, each `{command, result, at}`.
- **`sandbox.max_parallel_browsers`** is an integer from 1 to 8: how many browser-driving agents may run at once in any ordinary wave (hunters, verifiers, consult peers, judges and panel members that capture, the `w1-sweep` agent, fixture agents; the parent's own probe runs count too). Its default comes from the host's total memory: 2 at 16 GiB or less, 3 at 32 GiB or less, otherwise 4. The owner may lower or raise it within the range. It is ignored in the performance wave, which runs one runtime agent at a time with nothing else driving a browser or touching the app. The effective parallelism of a wave is `min(max_parallel_agents, max_parallel_browsers)` for browser-driving work.
- **`sandbox.host_facts`** describes the machine every lab number was measured on: `cpu` (the CPU model string), `total_memory` (with unit, the figure the browser default came from), `free_memory_at_perf_wave` (measured right before the performance wave starts), `vm_limits` (the CPU and memory limits of the VM or container, from the VM's own report or its configuration file, such as `.wslconfig` for WSL2 or the Lima or Colima instance settings; null on `host-only`), `cpu_benchmark_ms` (the median of the probe's `summary.hostBenchmark`, copied by the parent before the performance wave; null until then) [rule: VITALS-15]. Every performance record is read against these facts, and the report states them next to every lab number.
- **`visual_baseline`** is `{baseline_id, approved, diff_summary, note}`: the baseline chosen in Phase 1 (null id when none), whether the owner approved it, the path of `visual/diff-summary.json` once the diff ran (else null), and a note naming why no baseline, or only an unapproved or non-comparable one, was used. After the Phase 6 offer it also records the promotion: `promoted_id`, `promoted_approved` and `promoted_approved_at` (null when the owner declined).
- Viewport IDs match `^[a-z0-9][a-z0-9_-]{0,31}$`; width and height are integers 200–3840; `dpr` is 1–4. Reserved IDs must carry their table values (§9); a `p<width>` ID must be that many pixels wide. The ledger validator checks both.
- Persona `role` matches `^[a-z][a-z0-9_-]{0,31}$`; `label` is in `report_language`.
- Matrix names match `^[a-z][a-z0-9-]{0,31}$`. A matrix is the cross product of its viewports and themes; every ID must exist in `viewports`, and themes are only `light` and `dark`.
- **Themes.** `light` and `dark` emulate `prefers-color-scheme` and also store the app's preference where it has one. `system` emulates the media but stores nothing, so the app's default path runs. `system` always resolves to light or dark, so it stays out of matrices and is tested by the theme-initialisation classes at a single viewport.
- **Network profiles.** `fast`, `slow4g` and `slow3g` apply to page loads. `offline` and `flaky` are switched on mid-flow by the probe's `setNetwork` step; `flaky` goes offline for `offline_ms` every `cycle_ms` on top of `base`. In the probe config the same values are written `networkProfiles.flaky` `{base, cycleMs, offlineMs}`; the parent translates the keys when it builds that file. Every `net=` value in the ledger must be a key here.
- **Data states.** `empty`, `one`, `typical`, `heavy` and `longtext` are fixture states and must be listed in `fixtures.data_states` before the ledger uses them. `stale` is a runtime state (a second context changes the data after the page loaded) and is never listed.
- `clock.client_time`: `init-script-shift|none`. `clock.server_time`: `seeded-boundaries|none`. `clock.server_process_tz` is the `TZ` the app server normally runs under (`UTC`, or the deployment's documented zone); the server-zone wave in [FUNCTIONAL-FLOWS.md](FUNCTIONAL-FLOWS.md) restarts it under the business zone and back. `tz=` in the ledger is `clock.timezone` or `Asia/Tokyo` (the cross-zone probe).
- `unasked_questions` (optional) lists, verbatim, every question the parent could not put to the owner (SKILL.md setup step 1); REPORT.md section 1 repeats them.
- `run_status`: `in_progress|paused|complete|incomplete`. `pause_reason` is `usage_limit_reached`, `user_interrupted` or `model_unavailable` when the status is `paused`, and null otherwise. `resumes` is a list of `{at, from_status, pause_reason, note}`, one per resume, where `from_status` is `paused`, or `in_progress` when ORCHESTRATION.md §7.2 step 0 recovered a run that stopped without pausing. `incomplete_reason` is null or starts with a reasons-list code.
- Credentials, cookies, tokens, environment values and the owner's identifiers never appear here. Paths outside the run directory are written with `~` or as placeholders in shared examples.

Validate the ledger against this file with `node <skill-dir>/validate-coverage-ledger.cjs <out>/coverage-ledger.json --metadata <out>/run-metadata.json` (add `--run-dir <out>` once evidence has been promoted, so every cited artifact must exist); the metadata checks run even on an empty ledger, so run it once right after writing metadata, and again after every rewrite.

## 9. Viewports and matrices

**Reserved viewport set.** These IDs and values are fixed and match `STANDARD_VIEWPORTS` in [validate-coverage-ledger.cjs](validate-coverage-ledger.cjs). Declare in `viewports` each one the run's matrices or units name.

| ID | width × height | dpr | mobile and touch | Role |
|---|---|---|---|---|
| m320 | 320×568 | 2 | true | smallest supported phone; 320 px reflow |
| m360 | 360×800 | 3 | true | common Android |
| m390 | 390×844 | 3 | true | common iPhone; mobile performance profile |
| m414 | 414×896 | 3 | true | large phone |
| l844 | 844×390 | 3 | true | phone in landscape |
| t768 | 768×1024 | 2 | true | tablet portrait |
| d1024 | 1024×768 | 1 | false | small laptop or tablet landscape |
| d1280 | 1280×800 | 1 | false | laptop |
| d1440 | 1440×900 | 1 | false | desktop; desktop performance profile |
| d1920 | 1920×1080 | 1 | false | large desktop |
| r320 | 320×256 | 1 | false | reflow at 256 px height (WCAG 1.4.10) |

The set is a sampling plan that covers the common device classes and the reflow edges; it is not a design rule, and no finding says "the app must support 360 px" because the matrix lists it [rule: TOUCH-16]. The project's own supported sizes and breakpoints decide what is in scope.

**Pivot viewports.** The prefix `p` plus the width, such as `p767`: that width × 900, dpr 1, not mobile. Add them after recon 1c reports the breakpoints, one on each side of every breakpoint that changes layout (`p<bp-1>` and `p<bp>`). Example (Brasero): the shell pivots at 768, so `p767` and `p768`; any other breakpoint recon finds (such as 640 or 1024) adds its own pair.

**Standard matrices.**

| Name | Viewports | Themes | Used by |
|---|---|---|---|
| `quick` | m390, d1440 | light, dark | every runtime unit in `quick` |
| `core` | m320, m390, t768, d1440 | light, dark | layout, theme and accessibility units in `standard` |
| `full` | every reserved ID except r320 | light, dark | layout, theme and accessibility units in `deep` |
| `pivot` | the `p<width>` pairs | light, dark | breakpoint units in `deep` |

`core` includes a tablet because many repositories state phone, tablet and desktop as supported. Example (Brasero): the repository's interface rules name phone, tablet and desktop. `r320` is never in a matrix; reflow units name it with `vp=r320`. A matrix unit counts as `covered` only when its `browser` checks cover every (viewport, theme) pair; a candidate lists missing pairs as `variant not run: vp=<id>;theme=<t>`, and a pair left out by a narrowed fallback panel is listed as `variant not run: narrowed by fallback fb-NN`.

## 10. Profiles and deep splits

Caps, reserves and the lab protocol per profile are set in [ORCHESTRATION.md](ORCHESTRATION.md) §1 and computed by `scripts/orchestrate.mjs`; this table repeats the defaults.

| | quick | standard | deep |
|---|---|---|---|
| Default agent cap | 15 | 40 | 90 |
| Reserve at the gate (recon + critics + validation + orchestration), default config | 4 + 1 + 1 + 6 = 12 | 4 + 2 + 2 + 6 = 14 | 4 + 2 + 2 + 9 = 17 |
| Setup call before the gate (`w0-perm`) | 1 | 1 | 1 |
| Smallest cap that holds the floor (default config) | 14 | 16 | 16 |
| Smallest cap that can start, floor not held (default fraction 0.10) | 10 | 12 | 12 |
| Domains | coarsened to `profile/quick/all-in-scope-domains` | per domain | per domain and per role |
| Runtime contexts | `matrix:quick` | `matrix:core` for layout, theme, accessibility | `matrix:full` plus `matrix:pivot` |
| Performance contexts | `matrix:quick` | `role=<r>;vp=m390;net=slow4g` and `vp=d1440;net=fast` | as standard, plus the splits below |
| Performance lab protocol | warm-up + 3 cold runs | warm-up + 5 cold runs | warm-up + 5 cold runs |
| Waves and critics | one wave, one final critic | post-wave critics plus `cfinal` | post-wave critics plus `cfinal` |
| Verifiers | Phase 3 verifiers (single or batched) that also close every record | the same, plus a separate Phase 5 agent for each high or blocker record | as standard, 10 % replacement headroom on Phase 5 |

The lab protocol reports the median of the cold runs (the worst run for CLS and INP), because run-to-run variability makes a single run unreliable [rule: VITALS-16].

In `quick`, critic additions become `deferred` with `quick_profile_final_critic`.

**Deep context splits.** On top of the matrices, deep adds units for: `input=keyboard`, `input=screenreader` (AX tree only; real output is `needs_validation`), `motion=reduced`, `zoom=200`, `zoom=400`, `net=slow3g`, `net=offline`, `net=flaky`, `session=expired`, `session=twotabs`, `session=twousers`, `data=heavy`, `data=longtext`, `data=stale` and `tz=Asia/Tokyo`. Split only where the surface can react to the axis (a static legal page needs no `session=twousers` unit), and record the skip as an excluded block or `not_applicable` unit with a reason. Same-source `covered` units from a prior run get a second pass.

**Scoped runs** (`paths`, `routes`, `lenses`, or a `diff` mapped to the surfaces that import the changed files, `shared_ui_files` included) assign only in-scope units; the rest are `out_of_scope`, never `covered`, and the report says the run is partial.

No profile lowers the evidence bar: the candidate gate, the safety rules, the `needs_validation` discipline, schema validation, independent reproduction for `confirmed`, production builds for performance and the anti-taste caps always apply. No profile and no cap is chosen from the owner's plan; the cap comes from the config, the setup question or the owner's words during the run.

## 11. Budget

The budget is a count of agent invocations, recorded in `budget` (equal to `orchestration.agent_cap`); spending is tracked in `agents_spent`, `agents_breakdown` and, call by call, in `agent-log.json`. What counts, the reserve rule, worst cases, release, overrides and the planning estimate are normative in [ORCHESTRATION.md](ORCHESTRATION.md) §1; this section is the summary the metadata fields follow.

**Strict gate, before any recon agent.** Count the setup call (`w0-perm`), reserve the four recon calls, the critics at start, the validation minimum and the orchestration reserve with its floor, and leave room for at least one hunter: `setup + recon + critics_at_start + validation_min + orchestration + 1 <= cap`. Ask the script, never compute by hand:

```
node <skill-dir>/scripts/orchestrate.mjs budget --profile <profile> --cap <cap> --fraction <fraction> --config <config>
```

If the cap holds everything but the floor, tell the owner in figures that consults and escalations would be disabled and offer the smallest cap or fraction that holds it (ORCHESTRATION.md §1.3 rule 1). If the cap cannot even start, launch nothing and ask for a higher cap, a narrower scope or another profile; if the owner keeps the cap anyway, the run is `incomplete` with `budget_cannot_fund_reconnaissance_and_reserves`. Record the result as `orchestration.reserve`, `reserve_cap`, `reserve_floor`, `reserve_floor_met` and `setup_calls`.

**Planning estimate.** Computed after the ledger is seeded and validated, before any hunter, with `node <skill-dir>/scripts/orchestrate.mjs estimate --input <out>/tools/estimate-input.json`. In short:

- **hunters** = Σ over hunter groups of ceil(units in group ÷ 12). A group is one domain, one surface neighbourhood, one tenant and one task kind.
- **waves** = ceil(ordinary hunters ÷ min(`max_parallel_agents`, `max_parallel_browsers`)), plus 1 for each dedicated wave the ledger needs: server-zone units ([FUNCTIONAL-FLOWS.md](FUNCTIONAL-FLOWS.md)), performance units ([PERFORMANCE.md](PERFORMANCE.md)), throttle and login units.
- **critics** = 1 in quick; otherwise waves + 1.
- **expected units** = seeded units + `ceil(seeded units x growth)`; growth is 0 in quick, 0.3 in standard and 0.5 in deep unless a prior run measured another figure (`expected_unit_growth`). The added units are priced as ordinary `hunt_standard` hunters.
- **expected candidates** = 40 % of runtime units (the expected growth included), rounded up, unless prior runs give a measured rate.
- **verifiers** = one `verify_candidate_strong` per strong candidate + for the other candidates, one `verify_source_batch` per 10 expected source-only (15 %), one `verify_batch` per 5 expected `low` or `polish` (60 % of the rest) and one `verify_candidate` per remaining one + one `verify_record_strong` per expected high or blocker record (10 % of the candidates; 0 in quick) + 10 % Phase 5 headroom in deep.
- **priced lines.** Each hunter group, critic and verifier is routed with the availability known at that moment; a line whose route lands on a fallback panel costs that panel's worst case, and the surplus is reported as `panel_calls`.
- **total_calls** = the setup call + 4 recon + extra recon + hunter calls + critic calls + verifier calls + the orchestration reserve (with its floor).

Worked example (standard, cap 40, fraction 0.10, `max_parallel_agents` 4, `max_parallel_browsers` 4, every model available): five groups of 30, 18, 12, 25 and 9 units give 3 + 2 + 1 + 3 + 1 = 10 hunters. The critics are expected to add `ceil(94 × 0.3)` = 29 units, priced as `ceil(29 ÷ 12)` = 3 more hunters, so 13 hunters. The 9-unit group is the login group, so 12 hunters are ordinary: waves = ceil(12 ÷ 4) + 1 = 4, and critics = 5. With 80 seeded runtime units plus `ceil(80 × 0.3)` = 24 expected from the critics, expected candidates = `ceil(104 × 0.4)` = 42, of which 7 are expected source-only (one source batch), 21 `low` or `polish` (five batches of up to 5) and 14 need a single verifier, plus 5 Phase 5 agents for the expected high or blocker records: 25 verifier calls. Every alias is available, so the floor is 4 and the orchestration reserve is `max(2, ceil(40 × 0.10), 4)` = 4. Total = 1 + 4 + 13 + 5 + 25 + 4 = 52, above the cap of 40, so `fits` is false and the estimate carries a `suggestion` (a narrower scope that keeps at least one group, else a smaller profile that fits, else a larger cap with the number of extra calls, in that order). With `max_parallel_browsers` 2 on a 16 GiB host, the same ledger needs ceil(12 ÷ 2) + 1 = 7 waves and 8 critics, so 55 calls. If the config declared `opus` unavailable, the business hunter groups and the strong verifiers would be priced as three-member sonnet panels, `panel_calls` would be above zero and the total higher still. A second, call-by-call example that fits its cap is in ORCHESTRATION.md §1.6.

Show units, hunters, waves, critics, verifiers, the reserve, calls by model tier, total calls and the cap to the owner in `report_language`. When `fits` is false, offer the suggestion, and the three choices in this order: narrow the scope, switch profile, or raise the cap (with the number of extra calls). Do not start hunting until the owner answers. Record the figures and `shown_to_user_at`. For a "test every case" request, recommend `standard` over the whole app (`deep` only for one named area) and show the estimate before hunters launch.

**Spending order.**

1. Recon.
2. Critics: each wave's critic and `cfinal`.
3. The validation reserve: the verifier calls of the estimate for the expected candidates (single, batched and Phase 5); when the expected count is unknown, 30 % of what remains.
4. The orchestration reserve: judges, then retries, then consult peers and resumes, then escalations, then fallback panels discovered mid-run, then schema repairs; each item starts only with its whole worst case earmarked.
5. Hunters, in the priority order of [HUNTING.md](HUNTING.md).

Before each later wave, re-reserve its critic, `cfinal`, the validation reserve and what is left of the orchestration reserve; if that is impossible, defer the wave's units with `budget_cannot_reserve_critics_and_validation`. Units the cap cannot fund at all are `deferred` with `agent_cap_reached`. When the critic reserve itself runs out, remaining gaps are `deferred` with `critic_budget_exhausted`. When the validation reserve runs out, hunting stops; candidates are validated in fingerprint order, and the rest stay ledger candidates marked `validation_budget_exhausted` and never enter `findings.json`. An escalation the orchestration reserve cannot fund leaves its unit unresolved with `escalation_budget_exhausted`. After `cfinal` is clean, the unearmarked orchestration reserve above one judge's worst case (at least 2) is released to verifiers.

**Never exceeded silently.** The parent checks `spent + 1 <= cap in force` before every counted call. Going past the cap needs the owner's explicit answer during the run, recorded in `agent-log.json` `cap_overrides[]`, in `orchestration.cap_source: "owner_at_run"`, in `budget` and `orchestration.agent_cap`, and in `budget_note`. A resume continues from `agents_spent` against the same cap. COVERAGE.md "Agents, models and budget" states what the cap left uncovered.

## 12. Reasons list

One list, identical to `REASON_CODES` in [validate-coverage-ledger.cjs](validate-coverage-ledger.cjs). It is used by `incomplete_reason`, by `pause_reason`, by the `unresolved` entries of `deferred` and `blocked` units, and by critic and report text. Write a reason as `<code>` or `<code>: <free text>`, the free text in `report_language`.

| Code | Meaning |
|---|---|
| `budget_cannot_fund_reconnaissance_and_reserves` | The cap does not cover recon, the critic, validation and orchestration reserves and one hunter, and the owner kept it. |
| `budget_cannot_reserve_critics_and_validation` | A later wave could not reserve its critic and validation, so its units were deferred. |
| `validation_budget_exhausted` | Candidates left unvalidated because the validation reserve ran out. |
| `critic_budget_exhausted` | No budget remained for a further critic, so coverage could not be closed. |
| `critic_wave_limit` | Proposed by a critic after `critics.max_post_wave` critics had added work, or by `cfinal`; left for the next run. |
| `quick_profile_final_critic` | Added by the single quick-profile critic and not worked in that run. |
| `runtime_unavailable` | No proven topology, no browser, no production build, the app would not start, or it could not be bound to loopback only. |
| `engine_unavailable` | Needs Firefox, WebKit, iOS Safari, a real device keyboard or real screen-reader output. |
| `build_fetch_required` | The build needs a network fetch with no cached copy. |
| `owner_declined_download` | The owner said no to a download the unit needed. |
| `promotion_failed` | Decisive evidence could not be promoted safely. |
| `throttle_shared` | A throttle shared by all loopback clients could not be isolated for the unit. |
| `user_interrupted` | The owner stopped the run. |
| `phase5_dispute` | A Phase 5 material change could not be settled by a fresh verifier. |
| `agent_cap_reached` | The agent cap stopped this work. |
| `model_unavailable` | No available model tier could do this work. |
| `usage_limit_reached` | A usage limit paused or ended the run. |
| `escalation_budget_exhausted` | An escalation was needed but not funded. |
| `needs_stronger_model` | The strongest available tier could not settle it. |
| `dialogue_unresolved` | A consult ended with the judge ruling for neither side. |
| `visual_baseline_unavailable` | No comparable approved baseline exists for a visual unit, or the sweep ran with no comparable baseline at all (the first run of a repository), so its captures only feed the promote offer. |
