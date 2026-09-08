# Challenge 1 — Contained — Writeup

Module: What Can XSS Do in Electron?
Lab page: `src/renderer/pages/xss-no-priv.html`
Lab script: `src/renderer/js/xss-no-priv.js`
Window creation: `src/main/main.js` (`openXSSContainedWindow`)
Window preload: `src/main/preload-xss-contained.js`

---

## 1. Objective

Using only the lab's injection point (an input rendered unsanitized via `innerHTML`), complete
four tasks against a window that is genuinely hardened — `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, and no preload that exposes any privileged
API to the page:

1. Steal the on-page session token via DOM access.
2. Read a secret stashed in this window's `localStorage`.
3. Inject a fake login form and harvest a submitted credential.
4. Attempt to break out of the renderer entirely — and watch it fail.

The first three prove that "contained" does not mean "harmless" — XSS still fully owns the page.
The fourth is the actual lesson: no matter how creative the payload, this window's configuration
means there is nothing on the other side of that wall to reach.

---

## 2. Exploitation walkthrough

**Setup — why this window is actually isolated, not just labelled as such.** Every other page
in DVEA that opens via a plain `<a href>` link loads inside the main window, which uses the
app's default preload (`src/main/preload.js`) — and that preload exposes
`window.systemapi.executeCode`, a direct line to `eval()` in the main process. Loading this
challenge there would make Task 4 trivially "succeed" through that bridge, which would be a
lie about what hardening actually buys you. So this challenge opens in its own dedicated
`BrowserWindow`, created by `openXSSContainedWindow()`:

```js
// src/main/main.js
function openXSSContainedWindow() {
  new Window({
    file: path.join('src/renderer/pages', 'xss-no-priv.html'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-xss-contained.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
}
ipcMain.on('open-xss-contained', openXSSContainedWindow);
```

Its preload exposes nothing:

```js
// src/main/preload-xss-contained.js
const { ipcRenderer } = require('electron');

try {
  ipcRenderer.send('preload-corroboration', {
    contextIsolated: !!process.contextIsolated,
    sandboxed: !!process.sandboxed,
  });
} catch (err) {}
```

No `contextBridge.exposeInMainWorld` call anywhere in it — there is no `window.api`,
`window.systemapi`, or anything else for the page to call into main through. The lab page's own
config badges aren't hardcoded either, but they also don't probe `window.process` from this
page's own script — with `contextIsolation: true`, `window.process` doesn't exist in this main
world at all (it lives only in the preload's isolated world), so a main-world probe would read
`undefined` and misreport Sandbox/ContextIsolation as false precisely *because* isolation is
working. Instead, `openXSSContainedWindow()` (`src/main/main.js`) reads this window's real
effective `webPreferences` from the main process — the exact same `getLastWebPreferences()`
data the Config Inspector shows (`src/main/observability.js`) — and pushes it into the page via
`executeJavaScript` once the page has loaded, as `window.__dveaWindowConfig`. That's a one-way
data write, not a `contextBridge` exposure: nothing callable is added to this world, so the
zero-exposure preload above stays exactly that. The Sandbox, ContextIsolation, and
NodeIntegration badges all read from that pushed object; only the Privileged-bridge badge is a
direct main-world check (`typeof window.api === 'undefined' && typeof window.systemapi === 'undefined'`),
since that's a fact about this world specifically and is best measured where it would actually
show up. If you open devtools on this window and inspect `window.__dveaWindowConfig` yourself,
you'll get the same answer the badges show — the hardening is real, not a claim.

The injection point itself is one line:

```js
// src/renderer/js/xss-no-priv.js
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput1').value;
  document.getElementById('xssOutput1').innerHTML = val;
});
```

`innerHTML` does not execute `<script>` tags inserted this way — that's ordinary browser
behavior, not a DVEA-specific mitigation — so every payload below uses an event-handler
attribute (`onerror`, `onload`, etc.) to get script execution, exactly like the other XSS
lab in this app.

**Task 1 — steal the session token.** The page renders a fake session token into
`#session-token` on load. The token itself lives only in the DOM; nothing stops injected script
from reading it and writing it into the attacker-view panel (`#attacker-log`) — that panel is
just another element on the same page, reachable the same way:

```html
<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + document.getElementById('session-token').textContent + '</li>')">
```

Submitting that into the injection point fires the `onerror` handler (the `x` source fails to
load an image), which reads the token's text content and appends it to the attacker view. The
lab's `MutationObserver` on `#attacker-log` notices the token text arrive and reveals:
`DVEA{renderer_dom_theft}`.

**Task 2 — read `localStorage`.** On load, the page runs
`localStorage.setItem('dvea_secret', 'DVEA{localStorage_is_reachable}')`. `localStorage` is
per-origin renderer storage — completely reachable from any script executing in that renderer,
sandboxed or not, because it's a browser-level API, not a Node one:

```html
<img src=x onerror="document.getElementById('attacker-log').insertAdjacentHTML('beforeend', '<li>' + localStorage.getItem('dvea_secret') + '</li>')">
```

The value you exfiltrate **is** the flag — recovering it via XSS is the whole task.

**Task 3 — in-page phishing.** Inject a form, then harvest whatever gets submitted to it:

```html
<img src=x onerror='
  var out = document.getElementById("xssOutput1");
  out.insertAdjacentHTML("beforeend", "<form id=\"phish\"><input id=\"u\" placeholder=\"Username\"><input id=\"p\" type=\"password\" placeholder=\"Password\"><button>Sign in</button></form>");
  document.getElementById("phish").addEventListener("submit", function (e) {
    e.preventDefault();
    var u = document.getElementById("u").value;
    var p = document.getElementById("p").value;
    document.getElementById("attacker-log").insertAdjacentHTML("beforeend", "<li>cred:" + u + ":" + p + "</li>");
  });
'>
```

(Note the attribute is single-quoted here so the injected JS can use ordinary double-quoted HTML
strings inside it.) This renders a convincing-enough login form right inside the page's own
output area. Fill it in and submit — the handler never sends the credential anywhere real, it
just proves the harvest by writing `cred:<username>:<password>` into the attacker view. The lab
looks for that `cred:x:y` shape and reveals: `DVEA{xss_phishing_harvest}`.

This is the same primitive as the Deep Link Hijacking module's fake-login popup — a form that
looks legitimate, planted somewhere the victim already trusts — except here the "somewhere" is
inside the page itself rather than a whole separate window.

**Task 4 — try to escape (the linchpin).** Everything above stayed inside the browser-equivalent
threat model: DOM access, storage access, in-page social engineering. Now try to reach past the
renderer:

```html
<img src=x onerror="require('child_process').execSync('id')">
```

`require` is not defined in this window — `nodeIntegration: false` means it was never injected
into the main world, and `contextIsolation: true` means even if some other script exposed it
via the preload's isolated world, this page's main-world script still couldn't see it (moot
here anyway, since the preload exposes nothing). The `onerror` handler throws
`ReferenceError: require is not defined`, uncaught, which the lab's `window.addEventListener('error', ...)`
listener picks up. It checks the error actually names a Node primitive (`require`, `process`
internals, `child_process`, `__dirname`, `module.exports`) and actually says "is not defined" —
i.e., it only accepts a real engine-thrown failure, not an arbitrary string — before revealing:
`DVEA{contained_the_sandbox_held}`, along with the live values of `sandboxed`, `contextIsolated`,
and `nodeIntegration` it just read at the top of the script. Open the Config Inspector panel
and confirm those values yourself for this window's `webContents` — they'll match exactly.

Try other angles — `process.binding('...')`, `window.require`, `global`, `Buffer`, `module` —
they all fail the same way, for the same reason: none of them were ever put into this main
world in the first place. There is nothing to "sandbox-escape" through, because Node was never
reachable here to begin with.

---

## 3. Vulnerable code vs. fixed code

**Vulnerable** (`src/renderer/js/xss-no-priv.js`):

```js
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput1').value;
  document.getElementById('xssOutput1').innerHTML = val;
});
```

**Fixed** — sanitize before insertion (e.g. with DOMPurify) and add a restrictive CSP so even a
sanitizer bug or a missed sink has a second layer to fall back on:

```diff
+// npm install dompurify
+import DOMPurify from 'dompurify';
+
 form.addEventListener('submit', (e) => {
   e.preventDefault();
   const val = document.getElementById('xssInput1').value;
-  document.getElementById('xssOutput1').innerHTML = val;
+  document.getElementById('xssOutput1').innerHTML = DOMPurify.sanitize(val, {
+    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'],
+    ALLOWED_ATTR: ['href'],
+  });
 });
```

```diff
 <!doctype html>
 <html>
   <head>
     <meta charset="UTF-8" />
+    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; object-src 'none'">
     <title>Challenge 1 — Contained</title>
```

---

## 4. Why the fix works

- **Sanitize with an allowlist, not a denylist, of tags/attributes.** `DOMPurify.sanitize()`
  with an explicit `ALLOWED_TAGS`/`ALLOWED_ATTR` strips every event-handler attribute
  (`onerror`, `onload`, `onclick`, ...) and every tag capable of carrying one — there's no
  need to enumerate "dangerous" attributes one at a time, because anything not explicitly
  allowed is removed by default. That's the same allowlist-over-denylist reasoning
  `writeups/openexternal-abuse.md` applies to schemes: attackers only need one thing the
  denylist author didn't think of, so start from nothing and add back only what's needed.
- **CSP is a second, independent layer — not the only fix.** Even a correctly configured
  sanitizer can have bugs (DOMPurify itself has shipped and fixed real bypasses). A
  `script-src 'self'` CSP means that even if an attacker gets a `<script>`-executing payload
  past the sanitizer, the browser engine itself refuses to run it because it isn't from an
  allowed source. Fix the sink, and also make the platform enforce it.
- **This is exactly what the "hardened config" of this challenge doesn't fix — and isn't
  meant to.** `sandbox`, `contextIsolation`, and `nodeIntegration: false` protect the boundary
  between the renderer and Node/the OS. They do nothing to stop the XSS from firing in the
  first place, or from reading the DOM, `localStorage`, or phishing a user within the page —
  Tasks 1–3 all succeeded despite every Electron hardening flag being on, because none of
  those flags are input sanitization. Only actually cleaning the input (or removing the
  unsafe sink) stops the injection itself.

## 5. Why this stayed contained

The bug in this challenge — unsanitized input into `innerHTML` — is the **identical** bug in
Challenge 2 (Bridged) and Challenge 3 (Owned). What differs is what's reachable once the script
runs, and that difference is entirely `webPreferences`:

- **Here:** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and a preload
  that exposes nothing. There is no path from this main-world JavaScript context to Node, the
  filesystem, or a shell — not because something is actively blocking an attempt, but because
  the capability was simply never wired in. Task 4's `require(...)` doesn't get "denied"; it
  fails because `require` doesn't exist here.
- **Challenge 2 (Bridged):** the same three flags are still correctly set
  (`src/renderer/pages/xss-system-api.html`'s badges show `NodeIntegration: false`,
  `ContextIsolation: true`), but its preload
  (`src/main/preload-systemapi.js`) calls `contextBridge.exposeInMainWorld('systemAPI', { runCommand: (cmd) => exec(cmd) })`.
  That one exposed function is a direct line from any script running in that page to
  `child_process.exec` in the main process — the exact same injection technique as this
  challenge, but now there's something on the other side of the bridge worth reaching.
- **Challenge 3 (Owned):** `ipcMain.handle('xss-rce-direct', (event, code) => eval(code))` in
  `src/main/main.js` means the main process itself will `eval()` whatever string a renderer
  sends it, over an IPC channel the default preload exposes as
  `window.systemapi.executeCode`. No sandbox or isolation setting on the renderer matters at
  that point, because the dangerous operation isn't happening in the renderer at all — it's
  main process code voluntarily executing renderer-supplied input with full Node access. This
  is the same shape as CVE-2020-16608.

The thing to take away from a "failed" Task 4 here is not that escaping is hard — it's that
there was nothing to escape *to*. The moment either a privileged preload API exists (Challenge 2)
or main process code evaluates renderer input directly (Challenge 3), the identical `innerHTML`
injection stops being a contained annoyance and becomes a path to the host.
