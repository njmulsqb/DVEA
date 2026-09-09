# Contributing to DVEA

Thank you for your interest in contributing to the Damn Vulnerable Electron App (DVEA).

DVEA is intentionally vulnerable training software. That constraint shapes how contributions
work here more than it would on an ordinary project — read the "Ground rules" section before
opening a PR, especially if you're adding or modifying a vulnerability module.

## Ground rules

- **Don't "fix" a vulnerability module unless the task explicitly asks for a hardened variant or
  fix demonstration.** Every insecure code path in this app is deliberate and must stay genuinely
  exploitable. If you think a module's vulnerable behavior is a bug, open an issue first — don't
  quietly patch it in a PR.
- **Demos must fire the real vulnerable code path, not a mocked simulation.** A "Simulate" button
  in the UI should call the exact same IPC handler / main-process function a real attack would use
  (see `simulateDeepLinkWindow` calling the same `openUntrustedNavigationWindow()` helper the real
  `dvea://` handler uses). A demo that only pretends to be vulnerable defeats the app's purpose.
- **Keep vulnerabilities generic-pattern framed, not client- or incident-specific.** DVEA teaches
  classes of Electron mistakes (unvalidated IPC, overprivileged preload bridges, `nodeIntegration`
  escalation, insecure protocol handling) with reference to public CVEs where one genuinely
  applies (`cf. CVE-XXXX-XXXXX`). Do not fold in specifics from a real, non-public incident, a
  named client/organization, or an undisclosed vulnerability — public issues, PRs, and writeups in
  this repo must never contain anything that isn't already public knowledge.
- **No solution content in public issues or PRs for challenge-style modules.** If you're
  discussing a challenge-style lab in an issue, keep it to the objective/mechanism, not a working
  payload or the flag chain. Full solutions belong only in that module's `writeups/*.md` file.
- **Never commit real secrets, credentials, or personal data**, even as "realistic" demo content.
  Planted secrets/flags must be synthetic (`DVEA{...}`, obviously fake tokens, etc.).

## How to contribute

1. **Fork the repository** and create your branch from `main`.
2. **Install dependencies**: `npm install`.
3. **Linux only**: run the chrome-sandbox setuid fix described in the README before `npm start`
   (`chown root:root` + `chmod 4755` on `node_modules/electron/dist/chrome-sandbox`) — it resets
   on every fresh install.
4. **Make your changes** on a focused branch. If you're adding a new vulnerability module, follow
   the module-authoring guide below.
5. **Run the test suite**: `npm test` (Playwright, drives the real Electron app end to end — see
   `tests/*.spec.js` for existing patterns to follow).
6. **Commit** with clear, descriptive messages and open a PR against `main`.

### Pull request guidelines

- Clearly describe the purpose of the PR and reference any related issue.
- If the PR touches a vulnerability module, state explicitly whether the vulnerable behavior is
  unchanged, and call out any change to it.
- New modules must include: the module page(s), the main-process handler(s), a Playwright spec,
  and a writeup (unless the module is intentionally solution-withheld like the flagship — discuss
  that choice in the PR description first).
- Ensure the PR builds and passes `npm test`.

## Reporting issues

If you find a bug (in the app's *scaffolding* — the hub, the observability panel, the design
system, packaging — not in the intentional vulnerabilities themselves), please open an issue with:

- A clear, descriptive title
- Steps to reproduce
- Expected vs. actual behavior
- Relevant logs/screenshots

If you find a way to break out of a module's *intended* boundary (e.g. a way for a hardened XSS
challenge to escalate further than its config should allow), that's exactly the kind of finding
this project wants — report it the same way, and consider writing it up.

---

## Module-authoring guide

This section documents the template every current module follows
(`src/renderer/pages/*.html` + `src/main/main.js` handlers + `writeups/*.md` + `tests/*.spec.js`).
Follow it when adding a new vulnerability module so it fits the app's structure, difficulty
grading, and challenge conventions.

### 1. Decide the shape

Every module in DVEA is challenge-style: an objective and a live playground, with the solution
withheld from the page itself. Two sub-shapes exist — pick whichever fits the vulnerability:

- **Deep-link shape** (see the two Deep Link Hijacking routes): a short **Objective** (imperative
  — "Craft a deep link that...") plus a **"How to try it"** note. The interactive demo leads with
  the real protocol/IPC format and demotes any built-in simulator input under a collapsed
  `<details>` labeled for source-running players. No on-page walkthrough, payload, or fix.
- **Flag-gated task shape** (see the XSS challenges, Insecure File Write, Insecure Auto-Update):
  an **Objective** plus a `.task-list` of discrete tasks, each with a status pill
  (pass/fail/contained) and a hidden flag (`DVEA{...}`) revealed only on solve, plus a
  `#flag-progress` counter. Flags must be awarded from real evidence the main process can verify
  independently (a thrown error, real disk state, ground truth computed separately from what the
  renderer claims) — never fabricated client-side.

Common to both: no working payload or fix printed on the page, and no in-app link to the
solution anywhere (not on the lab page, not on a parent page, not on the hub).

### 2. Wire it into the app

- **Main process**: register the vulnerable behavior as real `ipcMain.handle`/`.on` calls in
  `src/main/main.js` (or its own file under `src/main/`, like `insecure-auto-update.js`, if it
  needs standalone state/server logic). The handler must implement the actual vulnerable logic —
  no shortcuts that only *look* exploitable from the renderer.
- **Windows**: if the module needs a dedicated window, build it via the `Window` helper
  (`src/main/windows/Window.js`) so it self-registers with the observability store automatically.
  Only reach for a bare `new BrowserWindow(...)` if you have a specific reason to (and remember it
  will rely on the global `browser-window-created` listener to register instead).
- **Preload**: give the window the least privilege that still demonstrates the point. Most
  modules should default to `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
  with a narrowly-scoped preload — deliberately weaken only what the module needs to weaken (an
  overprivileged bridge API, `nodeIntegration: true`, etc.), and make that specific weakening the
  teaching point.
- **Renderer page**: add `src/renderer/pages/<module>.html` + `src/renderer/js/<module>.js`,
  linking `theme.css` + `components.css` (the terminal-manpage design system — see
  `docs/DESIGN_SPEC.md`). Follow the standard section order used across existing pages: page
  header with back link, optional checklist badges, Objective panel, Demo panel, optional
  References panel.
- **Hub entry**: add a row to `src/renderer/pages/index.html`'s module table with an `id`,
  `data-difficulty` (`easy`/`medium`/`hard`/`insane`), a one-line `.modrow__desc`, relevant
  `.tag`s for the surface column, and a task-count badge if it's flag-gated. Difficulty reflects
  how much the player has to discover, not raw impact severity.

### 3. Write the tests

Add a Playwright spec under `tests/` that drives the **real app**, launched via Playwright's
`_electron`, with its own `--user-data-dir` (so it doesn't collide with a running DVEA or other
parallel specs). Assert on real behavior — the actual file written, the actual command executed,
the actual flag computed by main — not on UI text alone.

### 4. Write the writeup

Add `writeups/<module-name>.md`, grounded in the real handler code (quote it, don't invent it),
with these sections in order:

1. Objective restated
2. Exploitation walkthrough with a real, working payload
3. Vulnerable code vs. a fixed-code diff
4. Specific secure-coding reasoning for why the fix works — tied to this module's actual code, not
   generic advice

Do not add a link to this writeup from the app UI, the hub, or any parent page — writeups are
repo-only, referenced solely by the general pointer in the README's Documentation section.

### 5. Update the docs

- Add the module to the README's module index table (name, difficulty, CVE reference if one
  genuinely applies, task count if flag-gated).
- Note any structural change in `CLAUDE.md` if you're touching shared plumbing (the observability
  store, the `Window` helper, the design system, packaging).
