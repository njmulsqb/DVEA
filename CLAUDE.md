# DVEA — Damn Vulnerable Electron App

Project context for future Claude sessions. This is an open-source, intentionally-vulnerable
Electron training app (author: Najam Ul Saqib), being prepared for a conference talk and public
release. Every "vulnerability" in this app is deliberate and must stay exploitable — do not
"fix" vulnerable code paths unless a task explicitly asks for a hardened variant or fix
demonstration.

This document reflects analysis of the `writeups` branch as of 2026-09-08. No code was changed
to produce it.

---

## 1. Architecture

### Boot sequence
- `package.json` `main` → `src/main/main.js`. Run via `npm start` → `electron-forge start`.
- `main.js` does two kinds of work at **module-load time** (before `app.on('ready', ...)` fires),
  and the rest inside `function main()` (registered as the `'ready'` handler):
  - Load-time: `dotenv` config, optional `electron-reload` (dev only), `require('./insecure-auto-update')`
    (registers its own `ipcMain.handle` calls immediately — see §2 caveat), and a top-level
    `ipcMain.handle('save-file', ...)` registered right before `app.on('ready', main)`.
  - Inside `main()`: creates the main `Window`, wraps `ipcMain.handle`/`ipcMain.on` for observability
    (see §2), registers deep-link handlers, most vulnerability IPC handlers, the observability
    panel window, and global window-tracking listeners (`browser-window-created`, `browser-window-focus`).
- `app.on('window-all-closed', ...)` quits on non-macOS; `mainWindow`'s `'closed'` handler also
  tears down the panel window, any other open windows, and the auto-update demo server.

### Main vs renderer layout
```
src/main/
  main.js              — boot, IPC handlers, deep-link routing, window teardown
  observability.js      — the Config Inspector / IPC Monitor store (singleton, see §2)
  insecure-auto-update.js — auto-update demo IPC handlers + local feed server control
  windows/Window.js     — thin BrowserWindow subclass used by most demo windows
  preload.js             — default preload (window.api / window.ipc / window.systemapi)
  preload-panel.js        — read-only preload for the observability panel (window.monitor)
  preload-analytics.js     — preload for the analytics/stored-HTMLi window (window.analyticsAPI)
  preload-systemapi.js      — deliberately overprivileged preload (window.systemAPI.runCommand)
  datastore/DataStore.js     — electron-store wrapper; currently dead code (see §5)
src/renderer/
  pages/*.html          — one file per module/route/page
  js/*.js               — one script per page, referenced via <script src>
  styles/style.css       — single flat interim stylesheet (~410 lines)
src/labs/insecure-auto-update/ — bundled local HTTP+HTTPS feed server + TLS cert/key for that demo
vulnerable-versions/    — pinned-old-Electron CVE scenarios; lives on the `bind-hijack` branch
                          only (see §3, §5) — not present in this branch's tree.
```

### The `Window` helper (`src/main/windows/Window.js`)
A `BrowserWindow` subclass with defaults (`768x1024`, hidden until `ready-to-show`, default
preload `src/main/preload.js`). Its constructor **self-registers** with `observability.registerWindow()`
using the merged declared `webPreferences`. Most demo windows should be created through this
class so they show up correctly in the Config Inspector; windows created via bare
`new BrowserWindow(...)` instead (analytics window, panel window, deep-link simulate window,
system-XSS window is actually created via `Window` — see below) rely on the global
`app.on('browser-window-created', ...)` listener in `main.js` to register themselves instead.

### Preload map
| Preload | Exposed globals | Used by |
|---|---|---|
| `preload.js` (default) | `window.api` (open-external, save-file, deep-link simulation, analytics launch, auto-update controls, captured-credentials), `window.ipc` (onRedirect, onCaptured), `window.systemapi` (executeCode) | main window, fake-login window, route1/route2 pages, savefile, openexternal, insecure-auto-update, xss-rce-direct |
| `preload-panel.js` | `window.monitor.onUpdate(cb)` — receive-only | observability panel window only |
| `preload-analytics.js` | `window.analyticsAPI` (onName, getToken, injected) — **no sender validation on `getToken`** | analytics.html, and the attacker page it can be redirected to |
| `preload-systemapi.js` | `window.systemAPI.runCommand` / `openCalculator` — direct `child_process.exec` | xss-system-api.html (Overprivileged ContextBridge demo) |

All non-panel preloads also install a thin wrapper around `ipcRenderer.send`/`invoke` that mirrors
calls to an `ipc-monitor-preload` channel — see §2 for why this is currently inert.

### Navigation model
- **Hub → module**: `index.html` links most modules with plain `<a href="module.html">`
  (same-window navigation, no new `BrowserWindow`). A few open dedicated windows instead:
  Overprivileged ContextBridge (`window.api.openSystemXSS()` → new `Window` with
  `preload-systemapi.js`), Stored HTML Injection's target (`openAnalytics` → new `BrowserWindow`
  with `preload-analytics.js`), and the Deep Link Hijacking demo's fake-login popup.
- **Module → child route (parent/child pattern)**: Deep Link Hijacking is the exemplar —
  `vuln-redirect.html` is a parent overview page with a "Routes" panel linking to
  `vuln-redirect-route1.html` ("Deep Link → Untrusted Navigation") and `vuln-redirect-route2.html`
  ("Deep Link → Path Traversal"). Each route is its own file with its own demo, not a tab/section
  of one page. On the hub, the group's card title itself (`<a class="vuln-card-title" href="vuln-redirect.html">`)
  is a real link to the parent overview page, separate from the nested route links below it — it
  used to be a plain, non-clickable `<div>`, so clicking the card title did nothing; this was fixed
  (2026-09-08) alongside dropping the "Route 1"/"Route 2" numbering in favor of the app's
  `X → Y` naming convention (e.g. "XSS → RCE") used consistently elsewhere.
- **Back link / breadcrumb**: most module pages hardcode `<a href="index.html" class="page-header-back">← All Vulnerabilities</a>`.
  Route pages instead compute the back link at runtime from a `?from=` query param
  (`?from=index` → back to hub, `?from=parent` or absent → back to `vuln-redirect.html`), so the
  same route page can be reached directly from the hub *or* from its parent overview and still
  show the correct "where did I come from" link. `index.html` links routes with `?from=index`;
  `vuln-redirect.html`'s own Routes panel links them with `?from=parent`.
- Demos that need a second, separate top-level window (fake-login, deep-link route1's popup,
  the analytics dashboard, the system-XSS window) always go through IPC to main, which creates a
  real `BrowserWindow`/`Window` — there's no in-renderer window faking.

---

## 2. The observability panels (Config Inspector + IPC Monitor)

This is the app's signature feature: a dedicated, locked-down panel window that shows, live,
every window's effective `webPreferences`/CSP and every IPC message crossing the boundary,
across *all* the vulnerable windows at once.

### Store: `src/main/observability.js`
A singleton (`module.exports = new Observability()`) holding:
- `config` — arbitrary key/value store, notably `config.windows[id]` (per-window declared vs.
  effective webPreferences, preload path, CSP, Electron/Chrome/Node versions) and
  `config.activeWindow` (id of the focused window).
- `ipcLog` — bounded array (last 500 kept, last 200 pushed per snapshot) of `{ts, direction,
  kind, channel, args, senderId, frameUrl}` entries, with light deduplication (same kind/direction/
  channel/senderId within 500ms is dropped) and per-arg/total serialization caps (1KB/arg, 16KB
  total) plus an optional `config.ipcRedact` flag that replaces all arg text with `<<REDACTED>>`.

Every mutation calls `_pushSnapshot()`, which sends `{config, ipcLog, ts}` as a single one-way
message on the **reserved channel `__dvea_monitor__`** to whichever `BrowserWindow` was registered
via `setPanelWindow()`. There is no request/response — the panel is pure receive-only, and its own
preload (`preload-panel.js`) only exposes `monitor.onUpdate(cb)`.

### Config capture
`registerWindow(win, declaredWebPreferences)` records the window and immediately calls
`refreshWindow(win)`, which:
- Reads **effective** prefs via `win.webContents.getLastWebPreferences()` (this is the important
  bit — it's what Electron actually applied, not just what was requested) and versions
  (`process.versions`).
- Hooks `session.webRequest.onHeadersReceived` once per window to capture a `Content-Security-Policy`
  (or report-only) response header.
- Separately probes for a `<meta http-equiv="Content-Security-Policy">` tag via
  `executeJavaScript`, with a single 150ms retry for CSP metas inserted dynamically after load
  (this is exactly what the Stored HTML Injection / analytics module needs, since its CSP is a
  meta tag, not a header).
- Re-runs on `did-finish-load`, `did-navigate`, `did-navigate-in-page`, `dom-ready`, and on window
  `focus` (which also updates `config.activeWindow`).
- Preloads can additionally self-report via `ipcMain.on('preload-corroboration', ...)` (all
  preloads except `preload-panel.js` send `{contextIsolated, sandboxed}` from `process.*` on load) —
  this corroborates the main-process-side reading with what the renderer process itself observes.

### IPC capture
Installed once, inside `main()`, by monkey-patching `ipcMain.handle` and `ipcMain.on` themselves:
every handler registered *after* this point is automatically wrapped to log a `R→M` entry on
invocation (and, for `.handle`, an `M→R` `invoke-response` entry with the result). A parallel
patch on each window's `webContents.send` (installed in the global `browser-window-created`
listener) logs `M→R` `send` traffic. Channels starting with `__dvea_monitor__` are always
excluded from logging (to avoid feedback loops).

**Important caveat — blind spot in the flagship feature.** The `ipcMain.handle`/`on` wrap only
happens *inside* `function main()`, which only runs on the `'ready'` event. Two things register
IPC handlers **before** that, at plain module-require time, and are therefore bound to the
*original, unwrapped* `ipcMain.handle`:
- `ipcMain.handle('save-file', ...)` — defined at the bottom of `main.js`, outside `main()`.
- Every handler in `src/main/insecure-auto-update.js` (`start-auto-update-server`,
  `stop-auto-update-server`, `check-for-update`, `check-sentinel`, `reset-auto-update`) — this
  whole module is `require()`'d near the top of `main.js`, before `main()` is ever called.

The renderer-side fallback that could have caught this (`ipc-monitor-preload`, sent by every
preload's wrapped `ipcRenderer.send`/`invoke`) is explicitly a no-op on the main-process side —
`main.js`'s handler for it just `return;`s, with a comment that main/preload capture is preferred.
**Net effect: driving the Insecure File Write demo or the entire Insecure Auto-Update demo while
watching the IPC Monitor produces no log entries for those actions.** This will look like the
monitor is broken if demoed live without knowing about it — see §5.

### Panel window
Created directly via `new BrowserWindow(...)` inside `main()` (not through `Window`), locked down
(`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, preload `preload-panel.js`),
loads `panel.html`. `observability.setPanelWindow(panelWindow)` is wired on its `did-finish-load`.
Minor quirk: because the panel window is created *before* the global `browser-window-created`
listener is registered a few lines later in `main()`, and it isn't built via `Window` (so it
doesn't self-register either), the panel window itself never appears inside the Config Inspector's
own `config.windows` map — it's an observer that isn't observed. Harmless, but worth knowing if
you ever wonder why the panel's own webPreferences don't show up in its own list.

`panel.js` (renderer) just renders `payload.config` as pretty JSON and `payload.ipcLog` as a
scrolling `<ol>`, defensively re-filtering out `__dvea_monitor__`/`ipc-monitor-preload` entries
client-side as well.

---

## 3. Vulnerability modules

All modules below are **app-level** (run inside this app, current Electron version, current
branch). There is a second, separate class of **pinned-version** modules that reproduce CVEs
tied to a specific old Electron release — those currently live only on the `bind-hijack` branch,
see the note at the end of this section.

| Module | Hub entry | Main-process code | Renderer page(s)/route(s) | What it demonstrates |
|---|---|---|---|---|
| Deep Link Hijacking — Deep Link → Untrusted Navigation | grouped card title → parent (`vuln-redirect.html`) → "Deep Link → Untrusted Navigation" route link | `handleDeepLink()` in `main.js` (real `dvea://navigate?url=`), plus `simulate-deeplink` / `simulate-deeplink-window` IPC handlers for in-app simulation | `vuln-redirect.html` (parent) → `vuln-redirect-route1.html`; demo popup is `fake-login.html` | Main process navigates the trusted window (or a new window) straight to an attacker URL, no allowlist. Fake login popup harvests credentials via `captured-credentials` IPC, forwarded to the parent page's "attacker view". |
| Deep Link Hijacking — Deep Link → Path Traversal | grouped card title → parent (`vuln-redirect.html`) → "Deep Link → Path Traversal" route link | `handleDeepLink()`'s `dvea://open?path=` branch (real), `simulate-deeplink-open` IPC handler (demo) | `vuln-redirect-route2.html` | Deep link supplies an arbitrary file path; main reads it with `fs.promises.readFile` and no path validation. Bundled `secret.txt` (`FAKE_SECRET=flag{dvea_demo_secret}`) is the demo target. |
| XSS: No Privileged APIs | Renderer XSS group | n/a (fully client-side) | `xss-no-priv.html` / `xss-no-priv.js` | `innerHTML` injection with every Electron hardening flag on — impact capped at browser-equivalent renderer XSS. |
| XSS: Overprivileged ContextBridge | Renderer XSS group (JS-triggered, opens new window) | `openSystemXSSWindow()` / `ipcMain.on('open-system-xss', ...)` in `main.js`; handler code is `preload-systemapi.js`'s `child_process.exec` | `xss-system-api.html` / `xss-system-api.js`, window created with `sandbox: false` | Same `innerHTML` XSS pattern, but the preload exposes `window.systemAPI.runCommand` — XSS escalates directly to arbitrary shell command execution despite `contextIsolation: true`. |
| XSS → RCE (Direct) — cf. CVE-2020-16608 | Renderer XSS group | `ipcMain.handle('xss-rce-direct', (event, code) => eval(code))` in `main.js` | `xss-rce-direct.html` / `xss-rce-direct.js` | Renderer-supplied string is `eval`'d **in the main process** with no sandbox disabled anywhere — full Node access via a vulnerable IPC handler alone. |
| Stored HTML Injection → IPC Token Exfiltration | own card | `ipcMain.on('open-analytics', ...)` creates the analytics window; `ipcMain.handle('get-token', ...)` has no sender validation | `stored-htmli.html` → `analytics.html` (CSP `script-src *` via meta tag) → can be redirected via `<meta http-equiv="refresh">` to `attacker-grab-token.html` | CSP blocks inline-script XSS but not `<meta http-equiv="refresh">`; the preload (`preload-analytics.js`) is bound to the *window*, not the URL, so after the meta-refresh navigates away, the attacker page can still call `window.analyticsAPI.getToken()` and get a real (fake demo) JWT with zero sender/origin checks. |
| Insecure File Write (IPC Abuse) | own card | `ipcMain.handle('save-file', async (event, data) => fs.promises.writeFile(data.path, data.content))` — registered at module-load time (see §2 caveat) | `savefile.html` / `savefile.js` | Renderer-supplied path *and* content written with zero validation — arbitrary file overwrite anywhere the app process can write. |
| openExternal Abuse — cf. CVE-2020-25019 | own card | `ipcMain.handle('open-external', (event, url) => shell.openExternal(url))` | `openexternal.html` | Unvalidated URL/protocol handed to `shell.openExternal` — opens arbitrary URLs or OS protocol handlers (`mailto:`, `file://`, custom schemes). |
| Insecure Auto-Update — cf. CVE-2024-39698 | own card | `src/main/insecure-auto-update.js` (registered at module-load time, see §2 caveat); bundled feed server in `src/labs/insecure-auto-update/server.js` | `insecure-auto-update.html` / `insecure-auto-update.js` | Simulated updater with a **vulnerable/hardened mode toggle**: vulnerable mode fetches an HTTP manifest with no integrity check and `eval()`s the payload; hardened mode requires HTTPS + verifies a SHA-256 hash and an HMAC "signature" before ever `eval`ing. Has its own local HTTP+HTTPS feed server (self-signed cert bundled), poisoned vs. clean manifest/payload pairs, a filesystem "sentinel" (`/tmp/dvea-backdoor.txt` vs `/tmp/dvea-update-clean.txt`) to prove compromise, and a **Reset** button that stops the server and clears sentinels. This vuln/hardened/reset pattern is currently **unique to this module** — it reads like a template for future modules, not (yet) an app-wide convention. |

### Pinned-version modules (separate from the app above)
The `vulnerable-versions/` area is **not part of this branch's tree** — it exists only on the
`bind-hijack` branch (`git ls-tree -r bind-hijack`). It's a fully standalone Electron app
(`vulnerable-versions/electron-30.0.0/`, its own `package.json` pinning `"electron": "30.0.0"`,
own `main.js`), launched with `--module=<name>` to load `modules/<name>/{index.html,preload.js}`.
Two modules exist there today:
- **`bind-hijack`** (labelled `CVE-2026-70601` in its UI) — a correctly-configured
  `contextBridge` API (`getData` via `ipcRenderer.invoke`) is hijacked by attacker script that
  overwrites `Function.prototype.bind` before calling it, exploiting how Electron's context-bridge
  marshalling invokes `.bind()` across the isolation boundary to leak a privileged reference back
  into the renderer.
- **`webprefs-injection`** — creates test `BrowserWindow`s with configurable/untrusted
  `webPreferences` and lets you probe the effective flags that actually land (its own
  mini "config inspector", separate from the main app's).

If/when this gets merged into `main`/`writeups`, it needs a deliberate decision about how it's
launched (it currently has its own `npm start` invoking a totally separate Electron install) and
whether/how it's linked from the hub — right now there is no wiring between the two at all.

---

## 4. Conventions & patterns

### Module page structure
Nearly every module page follows the same section order inside `<div class="page-wrap">`:
1. `<header class="page-header">` — back link (`.page-header-back`), `<h1>`, one-line subtitle.
2. Optional `<div class="checklist">` — `.checklist-item.pass`/`.fail` badges summarizing the
   webPreferences/CSP/IPC posture relevant to that module (e.g. "✓ Sandbox: true" next to
   "✗ IPC: passes input to eval()"). Present on the XSS modules, Stored HTML Injection, Insecure
   File Write, XSS→RCE, Insecure Auto-Update; absent on Deep Link Hijacking and openExternal.
3. `<section class="panel">` **Guide: What is happening?** — plain-language explanation +
   example payload(s), usually followed by a `.xss-explanation` **Impact** callout.
4. Occasionally an **Attack Chain** / **Attack Scenario** panel using `.step-block` /
   `.step-num` (`muted`/`warn`/`ok`/`danger`) / `.step-badge` (`blocked`/`bypass`/`escalate`) —
   used by Stored HTML Injection to walk through recon → blocked XSS → CSP-bypassing HTML
   injection → IPC escalation, and by Insecure Auto-Update to narrate the MITM scenario.
5. `<section class="panel demo-panel">` **Demo** — the interactive form/controls.
6. Optional **References** panel with real CVE/advisory links (`xss-rce-direct.html`,
   `openexternal.html`, `insecure-auto-update.html` all do this; several others don't).

### Demos fire the real code path
This is a deliberate, consistent design choice, not just a convention: demo buttons call the
exact same IPC channel / main-process function that a real attack would use, rather than a mocked
stand-in. E.g. "Simulate Deep Link" on the "Deep Link → Untrusted Navigation" route calls `simulateDeepLinkWindow`, which runs the
identical `win.loadURL(target)` main-process navigation that `handleDeepLink()` uses for a real
`dvea://` link; the savefile demo calls the same `save-file` handler; `xss-rce-direct.js` posts
straight to the `eval()`-backed IPC handler. Keep this invariant when adding new modules — a demo
that only *simulates* the vulnerability defeats the app's purpose.

### vuln/hardened + reset mechanism
Only implemented for Insecure Auto-Update today (`mode` select → `vulnerable`/`hardened` branch
in `check-for-update`; `Reset` button → `reset-auto-update` IPC → stops the local feed server and
deletes both sentinel files). Nothing else in the app has a hardened toggle or a reset button.
Treat it as the reference pattern if asked to add one elsewhere, but don't assume it already
exists on other modules.

### Styling
- `docs/DESIGN_SPEC.md` **does not exist** — checked `docs/` (currently empty) on this branch and
  searched all branches' git history; there is no design spec file anywhere yet. If one gets
  written, it belongs in `docs/`.
- Current styling is one flat stylesheet, `src/renderer/styles/style.css` (~410 lines), used by
  every page via a relative `<link>`. It's inline-comment-free, utility-class-light (a handful of
  `.text-small`, `.mt-4`, `.text-gray` helpers), and clearly interim scaffolding rather than a
  designed system — treat any UI restyle as deferred/out-of-scope unless explicitly requested.
- `spectre.css` is a declared dependency (`package.json`) but is **not referenced anywhere** in
  any HTML/CSS/JS — dead dependency, not actually wired into the UI. Don't assume its classes are
  available.

### Build/packaging
- `npm install`, then `npm start` (→ `electron-forge start`). Requires Node ≥20 (tested on 22).
- **Linux-only manual step**: `chrome-sandbox` needs root ownership + setuid bit
  (`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 ...`) or the
  sandboxed renderer windows won't start. This is not automated by any install script — it's a
  README instruction the user must run by hand after `npm install`.
- `npm run make` → `@electron-forge/maker-deb`, Linux-only target, publishes (draft, non-prerelease)
  to GitHub Releases via `@electron-forge/publisher-github` when a `v*` tag is pushed
  (`.github/workflows/build.yml`, Node 22, `npm ci` → `npm run make` → conditionally `npm run publish`).
- `forge.config.js`'s `packagerConfig` is currently empty — no `ignore` patterns, no icon. This is
  fine while `vulnerable-versions/` stays off this branch, but if that directory (with its own
  nested `node_modules` and a second Electron install) is ever merged in, packaging will need an
  explicit `ignore` entry or the `.deb` will bundle a whole second Electron app.

---

## 5. State of things

### Branches
- **`writeups` (current)** is 8 commits ahead of `main`, all about the Deep Link Hijacking module:
  it introduced the module entirely (`main` only has a single-page "Open Redirect" demo with no
  route split, no fake-login popup, no path-traversal route). `main` is the stale baseline here.
- **`bind-hijack`**: a separate line of work adding `vulnerable-versions/electron-30.0.0/` (pinned
  Electron 30 CVE scenarios: `bind-hijack`, `webprefs-injection`) — see §3. Not merged into
  `writeups` or `main`, and not wired into the hub UI at all.
- **`ui`, `teaching-ui`, `reset-button`, `walkthrough`, `xss`, `fix/clone-run-issues`** (remote):
  none of these have commits ahead of `writeups`/`main` — they predate the current Deep Link
  Hijacking / Renderer XSS work and appear to be stale/abandoned exploratory branches. Worth
  pruning before the public release so the branch list doesn't confuse contributors.
- Several `dependabot/*` and `snyk-*` branches are open (electron→35.7.5, `tmp`→0.2.4, a couple of
  Snyk auto-fixes). The installed `electron` here is already `40.2.1` (package.json `^40.2.1`),
  ahead of the dependabot target, so that particular PR is likely stale/superseded — worth
  triaging the whole batch before release rather than merging blindly.

### Fragile / half-finished / inconsistent
- **IPC Monitor blind spot (see §2 for detail)**: the Insecure File Write handler and the entire
  Insecure Auto-Update module register their `ipcMain` handlers before the observability wrap is
  installed, so those two modules produce **zero** entries in the IPC Monitor no matter what you
  do in the demo. This is the single most important thing to know before demoing the panels live.
- `vuln-redirect.html` has duplicate/mismatched closing tags (an extra `</div>` and `</section>`
  around lines 68–71) left over from the parent/child refactor. Browsers silently tolerate stray
  closing tags so nothing visibly breaks, but the markup should be cleaned up.
- `src/main/datastore/DataStore.js` is dead code — not `require()`'d anywhere in the app. Its
  constructor also calls `this.clear()` unconditionally, which would silently wipe the entire
  store on every instantiation if it's ever wired in without noticing that line.
- `main.js`'s final `try { require('electron-reloader')(module); } catch {}` always throws
  (`electron-reloader` is not a dependency — only `electron-reload` is) and is silently swallowed;
  it's inert dead code, distinct from the working `electron-reload` dev-mode setup earlier in the
  file.
- `electron-squirrel-startup` is a declared dependency but never `require()`'d anywhere — irrelevant
  while the only maker is `maker-deb` (Linux); either drop it or wire it up if a Windows/Squirrel
  target is ever added.
- `spectre.css` (see §4) — declared, installed, never linked from any page.
- `tests/` exists but is completely empty — no test framework is configured yet.
- A stray, untracked `vulnerable-versions/electron-30.0.0/node_modules/` directory currently sits
  on disk on this branch even though none of that module's actual source files are checked out
  here (they only exist on `bind-hijack`) — harmless build debris (gitignored) left over from
  switching branches, but worth `rm -rf`ing for a clean tree.
- `docs/` exists but is empty — no `DESIGN_SPEC.md` anywhere in git history yet (checked every
  branch).
