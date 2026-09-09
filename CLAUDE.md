# DVEA — Damn Vulnerable Electron App

Project context for future Claude sessions. This is an open-source, intentionally-vulnerable
Electron training app (author: Najam Ul Saqib), being prepared for a conference talk and public
release. Every "vulnerability" in this app is deliberate and must stay exploitable — do not
"fix" vulnerable code paths unless a task explicitly asks for a hardened variant or fix
demonstration.

This document reflects the `writeups` branch as of 2026-09-09. It was first written 2026-09-08
from read-only analysis, then updated after a round of work on the same branch: the Renderer XSS
module was rebuilt into three challenge windows, the Deep Link Hijacking module's real-link
dispatch and OS scheme registration were fixed, the Insecure File Write lab was reworked into a
challenge-style module with flag-gated tasks, the Insecure Auto-Update lab was likewise reworked,
a Playwright test suite was added, a packaged-build boot crash was fixed, and several dead
dependencies were removed. A later pass rolled out the **terminal-manpage design system**
(`docs/DESIGN_SPEC.md` → `theme.css` + `components.css`, bundled fonts) to every page and reframed
**Stored HTML Injection into the flagship challenge** (solution withheld; §3). All of this is on the
`writeups` branch (PR #38 → `main`). Sections below reflect that current state; treat any specific
commit count / line count as approximate and re-check with git.

---

## 1. Architecture

### Boot sequence
- `package.json` `main` → `src/main/main.js`. Run via `npm start` → `electron-forge start`.
- `main.js` does two kinds of work at **module-load time** (before `app.on('ready', ...)` fires),
  and the rest inside `function main()` (registered as the `'ready'` handler):
  - Load-time: `dotenv` config, optional `electron-reload` (dev only), **`installIpcWrapping()`**
    (the observability wrap on `ipcMain.handle`/`.on`, now installed here at module load — see §2),
    `require('./insecure-auto-update')` (registers its own `ipcMain.handle` calls immediately), and
    top-level `ipcMain.handle('save-file', ...)` / `ipcMain.handle('filewrite-init', ...)` near the
    bottom. Because the wrap install runs first, all of these are captured by the IPC Monitor.
  - Inside `main()`: creates the main `Window`, registers deep-link handlers, most vulnerability IPC
    handlers, the observability panel window, and global window-tracking listeners
    (`browser-window-created`, `browser-window-focus`). (It no longer installs the IPC wrap — that
    moved to load time.)
- `app.on('window-all-closed', ...)` quits on non-macOS; `mainWindow`'s `'closed'` handler also
  tears down the panel window, any other open windows, and the auto-update demo server.

### Main vs renderer layout
```
src/main/
  main.js              — boot, IPC handlers, deep-link routing, window teardown
  observability.js      — the Config Inspector / IPC Monitor store (singleton, see §2)
  insecure-auto-update.js — auto-update demo IPC handlers + local feed server control
  windows/Window.js     — thin BrowserWindow subclass used by most demo windows
  preload.js             — default preload (window.api / window.ipc; no window.systemapi anymore)
  preload-panel.js        — read-only preload for the observability panel (window.monitor)
  preload-analytics.js     — preload for the analytics/stored-HTMLi window (window.analyticsAPI)
  preload-xss-contained.js  — zero-exposure preload for XSS Challenge 1 (self-reports isolation only)
  preload-xss-bridged.js     — overprivileged preload for XSS Challenge 2 (window.systemAPI.runCommand)
                              → ipcRenderer.invoke('bridge-run-command'); the exec lives in main now
src/renderer/
  pages/*.html          — one file per module/route/page
  js/*.js               — one script per page, referenced via <script src>
  styles/theme.css       — design tokens (the ONLY file that names a color) + @font-face
  styles/components.css   — the "terminal manpage" component + legacy-retheme layer (tokens only)
  assets/fonts/*.woff2     — bundled Orbitron 800 + Inter 400/600 (offline; no remote font requests)
src/labs/insecure-auto-update/ — bundled local HTTP+HTTPS feed server + TLS cert/key for that demo
vulnerable-versions/    — pinned-old-Electron CVE scenarios; lives on the `bind-hijack` branch
                          only (see §3, §5) — not present in this branch's tree.
writeups/               — repo-only solution writeups for challenge-style labs (see §4). Never
                          linked from any in-app page and excluded from the packaged app via
                          forge.config.js's packagerConfig.ignore (see §4 Build/packaging).
```

### The `Window` helper (`src/main/windows/Window.js`)
A `BrowserWindow` subclass with defaults (`768x1024`, hidden until `ready-to-show`, default
preload `src/main/preload.js`). Its constructor **self-registers** with `observability.registerWindow()`
using the merged declared `webPreferences`. Most demo windows should be created through this
class so they show up correctly in the Config Inspector; the three Renderer XSS challenge windows
(`openXSSContainedWindow` / `openXSSBridgedWindow` / `openXSSOwnedWindow`) are all built via
`Window`. Windows created via bare `new BrowserWindow(...)` instead (analytics window, panel
window, the untrusted-navigation popup opened by `openUntrustedNavigationWindow()` — used by both
the real deep-link handler and its simulator) rely on the global
`app.on('browser-window-created', ...)` listener in `main.js` to register themselves instead.

### Preload map
| Preload | Exposed globals | Used by |
|---|---|---|
| `preload.js` (default) | `window.api` (openXSSContained/Bridged/Owned window launchers, save-file, initFileWrite, open-external, analytics launch, auto-update controls, deep-link simulation, captured-credentials, onDeepLinkOpen), `window.ipc` (onRedirect, onCaptured). **No `window.systemapi` anymore** — that was removed with the old XSS→RCE handler. | main window / hub, fake-login window, the two deep-link route pages, savefile, openexternal, insecure-auto-update |
| `preload-panel.js` | `window.monitor.onUpdate(cb)` — receive-only | observability panel window only |
| `preload-analytics.js` | `window.analyticsAPI` (onName, getToken, injected) — **no sender validation on `getToken`** | analytics.html, and the attacker page it can be redirected to |
| `preload-xss-contained.js` | nothing via `contextBridge` — deliberately zero API surface; only self-reports `{contextIsolated, sandboxed}` for the Config Inspector | `xss-no-priv.html` (XSS Challenge 1 — Contained) |
| `preload-xss-bridged.js` | `window.systemAPI.runCommand(cmd)` → `ipcRenderer.invoke('bridge-run-command', cmd)`; the actual `child_process.exec` lives in the `bridge-run-command` **main** handler, not the preload | `xss-system-api.html` (XSS Challenge 2 — Bridged) |

XSS Challenge 3 — Owned (`xss-rce-direct.html`) uses **no preload at all** — its window is created with `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, so the renderer has `require()` directly. The old `preload-systemapi.js` was deleted.

All non-panel preloads also install a thin wrapper around `ipcRenderer.send`/`invoke` that mirrors
calls to an `ipc-monitor-preload` channel — see §2 for why this is currently inert.

### Navigation model
- **Hub → module**: `index.html` links most modules with plain `<a href="module.html">`
  (same-window navigation, no new `BrowserWindow`). The Renderer XSS group is different: its card
  ("What Can XSS Do in Electron?") has a title link to the overview page `renderer-xss.html` plus
  three sub-items that are JS-triggered window launchers — `window.api.openXSSContained()` /
  `openXSSBridged()` / `openXSSOwned()`, each opening a dedicated `Window` (challenges 1/2/3).
  Stored HTML Injection's target (`openAnalytics` → new `BrowserWindow` with `preload-analytics.js`)
  and the Deep Link Hijacking demo's fake-login popup also open dedicated windows.
- **Hub task-count badges**: challenges that have flag-gated tasks show a static `.task-count`
  pill on the hub stating how many tasks they hold — the XSS card shows an aggregate `10 tasks` on
  its title plus `4 tasks`/`3 tasks`/`3 tasks` on the three sub-items, and Insecure File Write and
  Insecure Auto-Update each show `3 tasks`. These counts are **hardcoded in `index.html`**, not derived — update them by
  hand if a challenge's task list changes. They show task count only, not solved progress.
- **Module → child route (parent/child pattern)**: Deep Link Hijacking is the exemplar —
  `deep-link-hijacking.html` is a parent overview page with a "Routes" panel linking to
  `deep-link-untrusted-navigation.html` ("Deep Link → Untrusted Navigation") and `deep-link-path-traversal.html`
  ("Deep Link → Path Traversal"). Each route is its own file with its own demo, not a tab/section
  of one page. On the hub, the group's card title itself (`<a class="vuln-card-title" href="deep-link-hijacking.html">`)
  is a real link to the parent overview page, separate from the nested route links below it — it
  used to be a plain, non-clickable `<div>`, so clicking the card title did nothing; this was fixed
  (2026-09-08) alongside dropping the "Route 1"/"Route 2" numbering in favor of the app's
  `X → Y` naming convention (e.g. "XSS → RCE") used consistently elsewhere.
- **Back link / breadcrumb**: most module pages hardcode `<a href="index.html" class="page-header-back">← All Vulnerabilities</a>`.
  Route pages instead compute the back link at runtime from a `?from=` query param
  (`?from=index` → back to hub, `?from=parent` or absent → back to `deep-link-hijacking.html`), so the
  same route page can be reached directly from the hub *or* from its parent overview and still
  show the correct "where did I come from" link. `index.html` links routes with `?from=index`;
  `deep-link-hijacking.html`'s own Routes panel links them with `?from=parent`.
- Demos that need a second, separate top-level window (fake-login, the Untrusted Navigation
  route's popup, the analytics dashboard, the system-XSS window) always go through IPC to main,
  which creates a real `BrowserWindow`/`Window` — there's no in-renderer window faking.

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

**Formerly a blind spot, now fixed.** The `ipcMain.handle`/`on` wrap used to be installed only
*inside* `function main()` (which runs on `'ready'`), so any handler registered before that — at
plain module-require time — bound to the *original, unwrapped* `ipcMain.handle` and stayed
invisible to the IPC Monitor forever. That hit the `save-file` / `filewrite-init` handlers at the
bottom of `main.js` and the entire `insecure-auto-update` module (both register before `'ready'`),
so driving those demos produced zero IPC Monitor entries. This has been **resolved**: the wrap is
now factored into an idempotent `installIpcWrapping()` called once at **module-load time** near the
top of `main.js`, before `insecure-auto-update` is `require()`'d and before the trailing handlers
are registered — so those handlers are captured too. (Node captures a reference to the un-wrapped
function the instant a handler binds, which is why the install has to happen first; the comment on
`installIpcWrapping()` spells this out.)

The renderer-side fallback (`ipc-monitor-preload`, sent by every preload's wrapped
`ipcRenderer.send`/`invoke`) remains an explicit no-op on the main-process side — `main.js`'s
handler for it just `return;`s, since main/preload capture is now complete and preferred.

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
| Deep Link Hijacking — Deep Link → Untrusted Navigation | grouped card title → parent (`deep-link-hijacking.html`) → "Deep Link → Untrusted Navigation" route link | `handleDeepLink()` in `main.js` (real `dvea://navigate?url=`), plus the `simulate-deeplink-window` IPC handler for in-app simulation — both call the shared `openUntrustedNavigationWindow()` helper | `deep-link-untrusted-navigation.html` — **challenge-style** (see §4): Objective + "How to try it" guidance, no in-page walkthrough/fix. Solution: `writeups/deep-link-untrusted-navigation.md` (repo-only, not linked in-app) | Main process opens a new, native-looking app window (no address bar) and navigates it straight to an attacker URL, no allowlist. Fake login popup (`fake-login.html`) harvests credentials via `captured-credentials` IPC, forwarded to the lab page's "attacker view". |
| Deep Link Hijacking — Deep Link → Path Traversal | grouped card title → parent (`deep-link-hijacking.html`) → "Deep Link → Path Traversal" route link | `handleDeepLink()`'s `dvea://open?path=` branch (real, loads the lab page into `mainWindow` then IPC-sends the file content), `simulate-deeplink-open` IPC handler (demo, returns content directly via invoke — a separate, not-shared implementation, unlike the navigation lab) | `deep-link-path-traversal.html` — **challenge-style** (see §4): Objective + "How to try it" guidance, no in-page walkthrough/fix. Solution: `writeups/deep-link-path-traversal.md` (repo-only, not linked in-app) | Deep link supplies an arbitrary file path; main reads it with `fs.promises.readFile` and no path validation. Bundled `secret.txt` (`FAKE_SECRET=flag{dvea_demo_secret}`) is a reliable demo target; any OS file (e.g. `/etc/passwd`) proves the read isn't confined to the app at all. |
| **What Can XSS Do in Electron?** (grouped card → `renderer-xss.html` overview + 3 challenge windows) | grouped card title → `renderer-xss.html`; sub-items launch the three challenge windows via `window.api.openXSS{Contained,Bridged,Owned}()` | `openXSSContainedWindow` / `openXSSBridgedWindow` / `openXSSOwnedWindow` in `main.js`, all built via `Window` | see three rows below | One `innerHTML` sink, three window configs, escalating blast radius — the point is that "how bad is this XSS" is a property of the Electron config, not the payload. **Challenge-style** (Objective + tasks, no on-page payloads); each challenge is flag-gated (`DVEA{...}` flags), tracks tasks with a progress counter, blocks `will-navigate` so its config can't carry to another page, and reads its real effective webPreferences from main (pushed into the page as `window.__dveaWindowConfig` via `executeJavaScript`, same `getLastWebPreferences()` data the Config Inspector uses) to drive its config badges. Solutions in `writeups/xss-challenge-{1,2,3}.md`. |
| — XSS Challenge 1 — Contained | grouped card sub-item (`4 tasks`) | `openXSSContainedWindow()` — genuinely hardened `Window` (`sandbox`/`contextIsolation` true, `nodeIntegration` false, zero-exposure `preload-xss-contained.js`) | `xss-no-priv.html` / `xss-no-priv.js` | `innerHTML` injection with every hardening flag on — impact capped at browser-equivalent renderer XSS. Four tasks: DOM theft, localStorage read, in-page phishing harvest, and a genuine escape attempt that **fails** and renders a distinct amber "Contained ✓" state (a blocked escape is a different outcome from an exploit success). |
| — XSS Challenge 2 — Bridged — cf. CVE-2020-25019 (shape) | grouped card sub-item (`3 tasks`) | `openXSSBridgedWindow()` — same hardened core as Ch1 **plus** `preload-xss-bridged.js` exposing `systemAPI.runCommand` → `ipcMain.handle('bridge-run-command', …)` which runs `child_process.exec` | `xss-system-api.html` / `xss-system-api.js` | Correct isolation, one overprivileged preload API. XSS → arbitrary shell command via the bridge despite `contextIsolation: true`. Three tasks: enumerate the bridge, round-trip a command through it, and read a planted OS secret (`/tmp/dvea-bridge-secret.txt`) — proof the bridge reaches the real OS. |
| — XSS Challenge 3 — Owned — cf. CVE-2020-16608 | grouped card sub-item (`3 tasks`) | `openXSSOwnedWindow()` — `Window` with `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, **no preload** | `xss-rce-direct.html` / `xss-rce-direct.js` | The classic cardinal-sin config: the renderer itself is Node, so injected script calls `require()` directly — no bridge, no IPC. Three tasks: prove Node in the renderer, run a real OS command, read a planted host file (`/tmp/dvea-rce-flag.txt`), each verified against ground truth main computes independently. **NB: the old `ipcMain.handle('xss-rce-direct', (e,code)=>eval(code))` main-process-eval handler no longer exists** — this challenge is now renderer-side Node via `nodeIntegration`. |
| Stored HTML Injection → IPC Token Exfiltration (**FLAGSHIP**) | flagship card | `ipcMain.on('open-analytics', ...)` creates the analytics window; `ipcMain.handle('get-token', ...)` has no sender validation (the vuln, unchanged); a `submit-stored-htmli-flag` handler validates a captured token → `DVEA{stored_html_to_ipc_exfil}` | `stored-htmli.html` (challenge landing: objective + scope + 3 revealable concept-hints + flag box, **no solution**) → `analytics.html` (CSP `script-src *` via meta tag; `analytics.js` renders the name via `innerHTML` and hoists any `<meta>` into `<head>`) → `attacker-grab-token.html` (minimal: "open DevTools", no walkthrough) | Same mechanics as before — CSP blocks inline-script XSS but not `<meta http-equiv="refresh">`; `preload-analytics.js` is bound to the *window*, not the URL, so an injected redirect's target can still call `window.analyticsAPI.getToken()`. **Reframed as the flagship (2026-09-09):** all solution content stripped from the app (guide/attack-chain/enumeration/why/fix removed; CSP banner nudge and giveaway comments neutralized); the token `get-token` returns is now **generated per launch** (`sess_live_<random>`, in-memory only, never a static literal or file — closes the grep-the-asar / read-from-source shortcut), and the solver submits the captured token on the landing page to earn the flag. The full solution writeup is deliberately **not** kept in the repo. |
| Insecure File Write (IPC Abuse) | own card (`3 tasks`) | `ipcMain.handle('save-file', …)` — still `fs.promises.writeFile(data.path, data.content)` with zero validation, registered at module-load time (see §2 caveat). It now **also** returns a flag-evaluation result (`evaluateFileWriteTasks`), and a sibling `ipcMain.handle('filewrite-init', …)` plants/resets the DVEA-owned targets and returns recon. | `savefile.html` / `savefile.js` | **Challenge-style** (Objective + 3 flag-gated tasks, no on-page payloads; solution in `writeups/insecure-file-write.md`). The vuln is unchanged and honest — the write accepts *any* renderer-supplied path/content. The flag layer only inspects real disk state after the write and recognizes DVEA-controlled targets under `os.tmpdir()/dvea-file-write/` so the demo is booth-safe: Task 1 write outside the app area (`DVEA{arbitrary_path_write}`), Task 2 overwrite a planted file (`DVEA{overwrite_existing_file}`), Task 3 overwrite a config file the app re-reads so its displayed banner changes (`DVEA{write_to_rce}` — a bounded stand-in for overwriting files the app `require()`s / autostart / persistence, covered in the writeup). `filewrite-init` on page load re-plants the targets, so it's repeatable. |
| openExternal Abuse — cf. CVE-2020-25019 | own card | `ipcMain.handle('open-external', (event, url) => shell.openExternal(url))` | `openexternal.html` (**challenge-style** — Objective + attempt log, no on-page payload; solution in `writeups/openexternal-abuse.md`) | Unvalidated URL/protocol handed to `shell.openExternal` — opens arbitrary URLs or OS protocol handlers (`mailto:`, `file://`, custom schemes). The outbound mirror of Deep Link Hijacking's inbound protocol-handling flaw. |
| Insecure Auto-Update — cf. CVE-2024-39698 | own card (`3 tasks`) | `src/main/insecure-auto-update.js` — `check-for-update` still fetches a manifest over HTTP with no integrity check and `eval()`s the payload in the main process (vulnerable mode); `performUpdateCheck()` holds the vuln, and a flag layer (`evaluateAutoUpdateTasks`) is layered on top. Bundled HTTP+HTTPS feed server in `src/labs/insecure-auto-update/server.js`. | `insecure-auto-update.html` / `insecure-auto-update.js` | **Challenge-style** (Objective + 3 flag-gated tasks, no on-page payload source — the old page displayed the poisoned manifest/payload; that giveaway was removed; solution in `writeups/insecure-auto-update.md`). Vuln unchanged and honest. A **vulnerable/hardened mode toggle** (hardened requires HTTPS + SHA-256 hash + HMAC signature) is used as the "Contained" capstone. Feed server serves clean (valid HMAC) and poisoned (`signature: INVALID_SIGNATURE`) manifests+payloads; the poisoned payload drops `/tmp/dvea-backdoor.txt` and exfiltrates a planted decoy wallet (`/tmp/dvea-wallet.dat`). Tasks: apply an update over plaintext HTTP (`DVEA{update_over_plaintext_http}`), execute the unsigned payload → RCE + exfil (`DVEA{unsigned_payload_executed}`), and HARDENED mode rejecting the forged HTTPS feed on signature grounds → **Contained** (`DVEA{hardened_rejected_forgery}`). **Reset** stops the server, clears sentinels, and resets flags. Note: `cert.pem`/`key.pem` were regenerated — the previously-bundled pair was malformed, so HTTPS had been silently disabled. |

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
   "✗ IPC: writes a renderer-supplied path, no validation"). Present on the three XSS challenge
   pages, Stored HTML Injection, Insecure File Write, Insecure Auto-Update; absent on Deep Link
   Hijacking and openExternal. On the XSS challenge pages the sandbox/isolation/nodeIntegration
   badges are filled from `window.__dveaWindowConfig` (pushed by main), not measured in-renderer.
3. `<section class="panel">` **Guide: What is happening?** — plain-language explanation +
   example payload(s), usually followed by a `.xss-explanation` **Impact** callout.
4. Occasionally an **Attack Chain** / **Attack Scenario** panel using `.step-block` /
   `.step-num` (`muted`/`warn`/`ok`/`danger`) / `.step-badge` (`blocked`/`bypass`/`escalate`) —
   used by Stored HTML Injection to walk through recon → blocked XSS → CSP-bypassing HTML
   injection → IPC escalation, and by Insecure Auto-Update to narrate the MITM scenario.
5. `<section class="panel demo-panel">` **Demo** — the interactive form/controls.
6. Optional **References** panel with real CVE/advisory links (`xss-rce-direct.html`,
   `openexternal.html`, `insecure-auto-update.html` all do this; several others don't).

The two Deep Link Hijacking route pages (`deep-link-untrusted-navigation.html`,
`deep-link-path-traversal.html`) deviate from this on purpose — see "Challenge-style labs"
below; they have no Guide/walkthrough/fix content on the page at all.

### Challenge-style labs + repo-only writeups
Now the standard for new/reworked modules — the two Deep Link Hijacking route pages, the three
Renderer XSS challenges, Insecure File Write, and openExternal are all challenge-style, each with
a repo-only writeup in `writeups/`. Insecure Auto-Update is challenge-style too (flag-gated tasks),
and Stored HTML Injection is now the **flagship** challenge (objective + revealable concept-hints,
solution deliberately withheld — see its §3 row). Every module is now challenge-style.
There are two sub-shapes:
- **Deep-link shape** (the two route pages): Concept panel keeps only an **Objective** (imperative
  — "Craft a deep link that...") and a short **"How to try it"** note. The demo panel is retitled
  **"Try It"** and leads with the real `dvea://...` link format; the interactive input+button
  ("Simulate Deep Link") is demoted under a `<details>` collapsed by default, labeled
  `Running from source? Use the simulator instead`. The attacker-view/result panel stays outside
  the collapsible, always visible, and works with either path. (Note: real `dvea://` links now
  **do** dispatch from source too, via `process.argv` / `second-instance` — see §5.)
- **Flag-gated task shape** (XSS challenges, Insecure File Write): an **Objective** plus a
  `.task-list` of N tasks, each a `.task-item` with a status pill (`.checklist-item.pass`/`.fail`,
  or amber `.contained` for a blocked-escape outcome) and a hidden `.task-flag` revealed on solve,
  and a `#flag-progress` counter (`(n / N flags captured)`). An "attacker view" panel is the only
  place task output lands; solving a task reveals a `DVEA{...}` flag. Flags are awarded from real
  evidence (a thrown error, ground-truth main computed independently, or real disk state), never
  fabricated in the renderer.
- Common to both: **no on-page working payload/fix**, and **no in-app link to the solution,
  anywhere** — no "Solution/Writeup" link on the lab page,
  no per-lab link on the parent page, nothing in the hub. The only pointer is one general
  line in `README.md`'s Documentation section saying solutions for challenge-style labs live
  in `writeups/`. This was deliberate: labs must stay pure challenge with zero filesystem or
  UI path to the answer, including in the packaged app (see Build/packaging below).
- Each writeup (`writeups/<lab-name>.md`) is grounded in the real handler code (quoted, not
  invented) and contains, as numbered sections: the objective restated, an exploitation
  walkthrough with a real working payload, the vulnerable code vs. a fixed-code diff, and
  specific (not generic) secure-coding reasoning for why the fix works.

### Demos fire the real code path
This is a deliberate, consistent design choice, not just a convention: demo buttons call the
exact same IPC channel / main-process function that a real attack would use, rather than a mocked
stand-in. E.g. "Simulate Deep Link" on the "Deep Link → Untrusted Navigation" route calls
`simulateDeepLinkWindow`, whose handler calls the exact same `openUntrustedNavigationWindow()`
helper that `handleDeepLink()` uses for a real `dvea://` link — not just a similar
reimplementation, literally the same function (this was previously an inconsistency — the real
handler used to navigate `mainWindow` in place while the simulator opened a new window; both now
go through the one shared helper); the savefile demo calls the same unvalidated `save-file`
handler; XSS Challenge 3 (`xss-rce-direct.js`) runs injected `require()`-based code directly in
its `nodeIntegration` renderer. Keep this invariant when adding new modules — a demo that only
*simulates* the vulnerability defeats the app's purpose.

### vuln/hardened + reset mechanism
The full **vuln/hardened toggle** is still unique to Insecure Auto-Update (`mode` select →
`vulnerable`/`hardened` branch in `check-for-update`; `Reset` button → `reset-auto-update` IPC →
stops the local feed server, deletes the sentinel files, and resets the challenge flags). It now
doubles as that module's "Contained" capstone task — flipping to hardened and watching the forged
update get rejected. No other module has a hardened toggle. A lighter **reset/replant** idea now also appears in Insecure File Write (`filewrite-init`
re-plants the DVEA-owned targets on every page load, so the challenge is repeatable), but that's
plumbing, not a user-facing hardened toggle. Treat auto-update as the reference for a full
vuln/hardened switch; don't assume other modules have one.

### Styling — the "terminal manpage" design system
The old flat `style.css` is **deleted**. Styling is now a two-file token system implementing
`docs/DESIGN_SPEC.md` (which now exists — it's the visual-direction spec):
- `src/renderer/styles/theme.css` — every design token as `:root` custom properties, plus
  `@font-face` for the bundled fonts. **The single source of color: nothing outside `theme.css`
  may name a color** (enforced — no hex/rgb/named colors in components.css, any page, or any JS;
  this fixes the old per-page-override bugs). Verify with a grep before adding CSS.
- `src/renderer/styles/components.css` — the component layer (`.chrome-bar`, numbered `.sec`
  headers, `.code`/`.diff`/`.callout`, `.tag`/`.meter`, `.btn`/`.field`, `.logline`, the dense
  `.modtable`) **plus a legacy-retheme block** that redefines the shared class names the pages and
  the challenge JS still use (`.panel`, `.panel-header`, `.checklist-item pass/fail/contained`,
  `.xss-output`, `.xss-explanation`, `.step-*`, `.stat-*`, `.vuln-sub-*`, bare form elements, …) in
  the token language. Every color references `var(--…)`.
- Fonts (`src/renderer/assets/fonts/`): Orbitron 800 + Inter 400/600 as local woff2, `@font-face`
  with `font-display:swap`, no remote requests (offline + strict CSP).
- Every page links `theme.css` + `components.css` (no page links the old `style.css`). Module pages
  keep their existing markup/IDs/scripts — the retheme brings them into the system by class, and
  `.panel-header` sections auto-number (`01`, `02`, …) via a CSS counter. Reference screens (the
  observability panel, `openexternal.html`, `index.html`) use the full section-header device
  directly. Hard rules from the spec that are enforced: one crimson primary button per screen
  (base `button` is neutral; add `.btn--primary`), threat state uses `--critical`/`--warning` not
  brand crimson, zero border-radius except 6px on controls.
- `spectre.css` was removed from `package.json` (never referenced) — no CSS framework is wired in.

### Build/packaging
- `npm install`, then `npm start` (→ `electron-forge start`). Requires Node ≥20 (tested on 22).
- **Linux-only manual step**: `chrome-sandbox` needs root ownership + setuid bit
  (`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 ...`) or the
  sandboxed renderer windows won't start. This is not automated by any install script — it's a
  README instruction the user must run by hand after `npm install`.
- `npm run make` → `@electron-forge/maker-deb`, Linux-only target, publishes (draft, non-prerelease)
  to GitHub Releases via `@electron-forge/publisher-github` when a `v*` tag is pushed
  (`.github/workflows/build.yml`, Node 22, `npm ci` → `npm run make` → conditionally `npm run publish`).
- **Packaged-build boot**: `main.js` requires `dotenv` and `electron-reload` inside `try/catch` —
  both are devDependencies, which `@electron/packager` prunes from the `.deb`, so an unguarded
  `require('dotenv')` at module load crashed the installed app with "Cannot find module" before
  anything else ran. Neither is load-bearing; a miss is a no-op.
- **Deep-link (`dvea://`) OS registration** — the Deep Link Hijacking module depends on this and it
  has two required pieces: (1) `forge.config.js`'s maker-deb `config.mimeType:
  ['x-scheme-handler/dvea']`, which is what puts a `MimeType=` line in the installed `.desktop`
  file so the OS knows DVEA can handle the scheme (without it, browsers treat a typed `dvea://` URL
  as a web search); and (2) `main.js` sets `process.env.CHROME_DESKTOP = 'dvea.desktop'` before
  `app.setAsDefaultProtocolClient('dvea')`, because on Linux that call shells out to `xdg-mime` and
  reads the target `.desktop` filename from `CHROME_DESKTOP` (it is *not* derived from the app name,
  and `app.setDesktopName()` was removed in Electron 40 — unset, the call fails with "xdg-mime:
  application argument missing"). Also note: real `dvea://` links dispatch **from source** now too,
  not only in a packaged build — `main.js` takes `app.requestSingleInstanceLock()`, reads a
  cold-start link from `process.argv`, and handles an already-running link via `second-instance`.
  Typing `dvea://…` into a browser **address bar** works when the scheme is registered; the earlier
  belief that it doesn't was wrong.
- **Tests**: `npm test` → `playwright test` (`playwright.config.js`, `tests/*.spec.js`). No browser
  projects — each spec launches the real Electron app via Playwright's `_electron`. Specs exist for
  the three XSS challenges, both deep-link routes + a deep-link OS-registration guard, Insecure
  File Write, and Insecure Auto-Update. Each launches with its own `--user-data-dir` so the single-instance lock doesn't make
  parallel specs (or a running DVEA) collide. Heads-up: each spec spawns Electron processes, so a
  low `fs.inotify.max_user_instances` can make the full parallel run flaky (`sudo sysctl
  fs.inotify.max_user_instances=512`).
- `forge.config.js`'s `packagerConfig.ignore` excludes `/^\/out\//` and `/^\/writeups($|\/)/` —
  confirmed by actually running `npx electron-forge package` and inspecting the output tree:
  `writeups/` is absent from the packaged app, ordinary app files are present. No icon is set.
  **Non-obvious gotcha, worth remembering if this file is touched again:** Electron Forge's own
  default `ignore` (`[/^\/out\//g]`, excluding its own build-output dir) is only applied when
  `packagerConfig.ignore` is unset — Forge builds its final packager options as
  `{ ignore: [/^\/out\//g], ...forgeConfig.packagerConfig }`, and a plain object spread means
  *setting* `ignore` **replaces** that default rather than merging with it. So `/^\/out\//` has
  to be repeated explicitly alongside any custom pattern, or the build-output dir stops being
  excluded from its own packaged output. `vulnerable-versions/` (see §3) still isn't excluded —
  it's simply absent from this branch's tree today, not deliberately ignored; if that directory
  is ever merged in, packaging will need its own explicit `ignore` entry too or the `.deb` will
  bundle a whole second Electron app (own `node_modules`, own Electron binary).

---

## 5. State of things

### Branches
- **`writeups` (current)** is well ahead of `main` and no longer just about Deep Link Hijacking.
  It introduced the Deep Link module (`main` only has a single-page "Open Redirect" demo), then a
  later round of work added/changed a lot more: the Renderer XSS module was rebuilt into the three
  challenge windows (§3), the Insecure File Write and Insecure Auto-Update labs became
  challenge-style with flag-gated tasks, the IPC-Monitor blind spot was fixed (§2), a Playwright
  suite was added, deep-link real-link dispatch + `dvea://` OS registration were fixed, a
  packaged-build boot crash was fixed, the auto-update feed server's malformed TLS cert/key were
  regenerated, and dead deps (`spectre.css`, `electron-squirrel-startup`) + `DataStore.js` were
  removed. `main` is the stale baseline; check
  `git log main..writeups --oneline` for the current count rather than trusting a number here.
  None of this is pushed to the remote `writeups` yet as of this writing — confirm with
  `git status` / `git log origin/writeups..writeups`.
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
- **IPC Monitor blind spot — RESOLVED (see §2).** The observability wrap is now installed at
  module-load time via `installIpcWrapping()`, before the early handlers register, so the Insecure
  File Write and Insecure Auto-Update demos now DO show up in the IPC Monitor. (This was previously
  the single most important gotcha before a live panel demo; it no longer applies.)
- `src/main/datastore/DataStore.js` was **deleted** (it was dead code — never `require()`'d, and
  its constructor called `this.clear()` unconditionally). With it gone, `electron-store` is now the
  remaining dead dependency (`DataStore.js` was its only consumer) — still declared in
  `package.json`, referenced by nothing. Drop it or wire it up.
- `main.js`'s final `try { require('electron-reloader')(module); } catch {}` always throws
  (`electron-reloader` is not a dependency — only `electron-reload` is) and is silently swallowed;
  it's inert dead code, distinct from the working `electron-reload` dev-mode setup earlier in the
  file.
- `electron-squirrel-startup` and `spectre.css` were **removed** from `package.json` (both were
  never referenced) — no longer dead deps, just gone. If a Windows/Squirrel maker is ever added,
  `electron-squirrel-startup` will need re-adding and wiring.
- `tests/` now has a Playwright suite (see §4 Build/packaging → Tests) — no longer empty. There is
  no unit-test layer, though: every spec drives the whole real app end to end.
- A stray, untracked `vulnerable-versions/electron-30.0.0/node_modules/` directory currently sits
  on disk on this branch even though none of that module's actual source files are checked out
  here (they only exist on `bind-hijack`) — harmless build debris (gitignored) left over from
  switching branches, but worth `rm -rf`ing for a clean tree.
- `docs/` exists but is empty — no `DESIGN_SPEC.md` anywhere in git history yet (checked every
  branch).
