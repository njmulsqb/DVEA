# Insecure File Write (IPC Abuse) — Writeup

Module: Insecure File Write (IPC Abuse)
Lab page: `src/renderer/pages/savefile.html`
Vulnerable code: `src/main/main.js` (the `save-file` IPC handler)

---

## 1. Objective

Prove that an IPC handler which writes a **renderer-supplied path** with **renderer-supplied
content**, and no validation, hands the renderer the host filesystem with the app's own
permissions. Three escalating tasks:

1. Write a file to a location the app never intended — proving there is no path restriction.
2. Overwrite a file the app already owns — proving write can replace, not just create.
3. Overwrite a file the app itself reads and acts on — turning "save a file" into control over
   what the app does.

The lab awards flags only for DVEA-controlled targets under a temp directory (so it is safe to
run repeatedly at a booth), but the handler itself is honest: it will write wherever you point
it, on the real filesystem.

This is the write-side companion to the Deep Link → Path Traversal lab, which is the *read* side
of the same class: main trusting a renderer/attacker-supplied path and touching the filesystem
with it. Read leaks data out; write lets you change what runs.

---

## 2. Exploitation walkthrough

**Step 0 — find the handler.** `src/main/main.js` registers a single IPC handler for this
feature at module-load time (which is also why it is invisible in the IPC Monitor — see the
blind-spot note in `CLAUDE.md`):

```js
ipcMain.handle('save-file', async (event, data) => {
  await fs.promises.writeFile(data.path, data.content);
  // ...flag bookkeeping only, below...
});
```

The renderer-side entry point is exposed by the default preload to any page that loads it:

```js
// src/main/preload.js
saveFile: (data) => ipcRenderer.invoke('save-file', data),
```

and the lab page calls it with whatever the user typed:

```js
// src/renderer/js/savefile.js
const path = document.getElementById('filepath').value;
const content = document.getElementById('filecontent').value;
await window.api.saveFile({ path, content });
```

`data.path` reaches `fs.promises.writeFile()` with no canonicalization, no allowlist, and no
confinement to any base directory. Whatever path the renderer supplies is the path the main
process writes — with the OS privileges of the user the app runs as.

The renderer has `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true` — it
cannot call `fs` itself. It doesn't need to. It asks a handler that already can.

**Recon the lab gives you.** On load, the page calls a `filewrite-init` handler that plants the
DVEA-owned targets and reports where they are. Those paths, under your OS temp directory, are:

- Intended saves dir: `<tmpdir>/dvea-file-write/saves`
- DVEA-owned planted file: `<tmpdir>/dvea-file-write/dvea-owned-note.txt`
- App config file: `<tmpdir>/dvea-file-write/dvea-app-config.json` (original content
  `{ "banner": "DVEA — Insecure File Write" }`)

On Linux `<tmpdir>` is `/tmp`, so the concrete paths are `/tmp/dvea-file-write/...`.

### Task 1 — Write outside the intended directory → `DVEA{arbitrary_path_write}`

The gate: the write resolves to a location **outside `<tmpdir>/dvea-file-write` entirely**, and
the file now exists. Any unrelated path proves the point. A booth-safe payload:

```
Path:    /tmp/dvea-arbitrary-write-proof.txt
Content: no path restriction — this file is nowhere near the app's saves folder
```

Click **Save File**. The file is created at a path with no relationship to the app's own
directory. There was no allowlist to escape and no traversal trick required — the handler simply
writes wherever it is told.

### Task 2 — Overwrite an existing file → `DVEA{overwrite_existing_file}`

The gate: the write targets the planted `dvea-owned-note.txt` (which already existed), and its
on-disk content is now **different** from what DVEA planted. Payload:

```
Path:    /tmp/dvea-file-write/dvea-owned-note.txt
Content: clobbered — this file belonged to the app and now belongs to the attacker
```

`fs.writeFile` truncates and replaces by default, so pointing the write at an existing file
overwrites it outright. This is the primitive that matters: not "drop a new file somewhere," but
"replace a file another program already trusts and reads."

### Task 3 — Weaponize: change what the app does → `DVEA{write_to_rce}`

The app reads `dvea-app-config.json` every time it renders the banner on the lab page — the banner
is *not* hard-coded, it is loaded from that file. The gate: overwrite that config so the banner
the app parses differs from the original. Payload:

```
Path:    /tmp/dvea-file-write/dvea-app-config.json
Content: {"banner":"owned by an arbitrary file write"}
```

After the write, the app re-reads the config, the banner on the page changes to your chosen text,
and Task 3 unlocks. You did not exploit a second bug to do this — you used the *same* file-write
primitive to overwrite a file the application itself depends on, and the application dutifully
loaded your content. That is the whole point: arbitrary file write is arbitrary control over any
program that reads a file you can write.

This lab's weaponization target is a DVEA-owned JSON file whose only effect is a banner, so it is
safe to run over and over. Section 4 covers what the real targets are.

---

## 3. Vulnerable code vs. fixed code

**Vulnerable** (`src/main/main.js`):

```js
ipcMain.handle('save-file', async (event, data) => {
  await fs.promises.writeFile(data.path, data.content);
});
```

**Fixed** — treat the renderer-supplied path as fully untrusted: canonicalize it and confirm it
stays inside an intended base directory before writing, exactly the confinement pattern the
Deep Link → Path Traversal fix uses for reads:

```diff
+const path = require('path');
+// The one directory this feature is actually allowed to write into. Everything else is rejected.
+const SAVE_BASE_DIR = path.resolve(app.getPath('userData'), 'saves');
+
 ipcMain.handle('save-file', async (event, data) => {
-  await fs.promises.writeFile(data.path, data.content);
+  if (!data || typeof data.path !== 'string' || typeof data.content !== 'string') {
+    throw new Error('Invalid save-file request');
+  }
+  // Resolve against the base, then confirm the result is still inside it. path.resolve folds out
+  // ../ sequences AND discards the base entirely if data.path is absolute, so an attacker cannot
+  // escape with either ../../../etc/... or a bare /etc/... — both are caught by the check below.
+  const resolved = path.resolve(SAVE_BASE_DIR, data.path);
+  const relativeToBase = path.relative(SAVE_BASE_DIR, resolved);
+  const isConfined =
+    relativeToBase !== '' &&
+    !relativeToBase.startsWith('..') &&
+    !path.isAbsolute(relativeToBase);
+  if (!isConfined) {
+    throw new Error('Refusing to write outside the saves directory');
+  }
+  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
+  await fs.promises.writeFile(resolved, data.content);
 });
```

---

## 4. Why the fix works, and why this matters

### Why the fix works

- **Treat the renderer-supplied path as fully untrusted input, not a path.** The renderer is
  reachable by XSS and by rendered untrusted content; anything it sends across IPC is
  attacker-controllable. The fix never uses `data.path` directly — it uses it only as a
  *candidate* to resolve and then validate.
- **`path.resolve(SAVE_BASE_DIR, data.path)` collapses the path before any decision is made,**
  folding out `..`/`.` segments. Crucially, `path.resolve` also *discards the base entirely if
  the candidate is absolute* — `path.resolve('/app/saves', '/etc/cron.d/x')` returns
  `/etc/cron.d/x`. So the absolute-path payload (which is the easy one here — no `../` needed at
  all) is only caught if you check the **final resolved path**, not the input string. A fix that
  merely strips `../` sequences misses it completely.
- **`path.relative(SAVE_BASE_DIR, resolved)` is the actual confinement check.** A path inside the
  base yields a relative path that never starts with `..` and is never absolute; a path that
  climbed out (via `../` or by being absolute) is forced to start with `..`. Comparing resolved
  paths this way — rather than a string prefix like `resolved.startsWith(SAVE_BASE_DIR)` — also
  avoids the sibling-prefix bypass (`/app/saves` vs. an attacker's `/app/saves-evil/...`, which
  passes a naive `startsWith`).
- **Fail closed.** A malformed request, a non-string path/content, or any path that escapes the
  base throws before `writeFile` is ever reached — no partial or fallback write happens.
- **This defends the specific hand-off point.** It does not replace general renderer hardening
  (`contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP) — those keep the renderer from
  calling `fs` directly. This fix protects the boundary where the *main process*, which does have
  `fs`, acts on a string the *renderer* chose. That boundary is the vulnerability, and the same
  reasoning applies to every IPC handler that performs a privileged action on renderer-supplied
  arguments (this is the IPC-trust-boundary class — see below).

### Why this matters — the real weaponization targets

The lab's Task 3 rewrites a harmless DVEA-owned banner file so the demo is safe to repeat. In a
real app, arbitrary file write with the app's permissions is one of the most powerful primitives
an attacker can hold, because so many things on a system are "just a file the program reads":

- **Files the app `require()`s on next launch.** Overwrite a JavaScript file the app loads at
  startup (an app module, a plugin/extension file, an `asar`-external resource, a
  `node_modules/<dep>/…` file) and your code runs in the main process the next time the app
  starts — write-to-RCE with a restart in between. This is the honest version of what Task 3
  stands in for.
- **`package.json` scripts / project files.** In a dev-facing app, overwriting a `package.json`
  `scripts` entry, a `.git/hooks/*` file, or a task-runner config means your command runs the next
  time the victim builds, tests, or commits.
- **Autostart and shell init for persistence.** Dropping or overwriting `~/.bashrc`,
  `~/.profile`, `~/.config/autostart/*.desktop` (Linux), a Login Item / LaunchAgent plist
  (macOS), or a Startup-folder / Run-key-referenced file (Windows) gives execution on the next
  login or shell — persistence that outlives the app.
- **Config tampering.** Overwriting an application or OS config file to disable a security
  control, redirect an update feed, or change a trusted path can convert a "just a write" into a
  much larger compromise without any code execution at the moment of the write.

The victim never types any of these paths. Attacker input reaches the `save-file`-style handler
the same way it reaches every other over-trusting IPC handler: an XSS bug in a renderer that has
access to the bridge, or the app rendering attacker-controlled content that ends up driving a
"save"/"export"/"download" flow. The fix is the same everywhere — the main process must not
perform a privileged filesystem action on a path the renderer chose without validating and
confining it first.
