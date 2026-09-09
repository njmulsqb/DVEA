# openExternal Abuse — Writeup

Module: openExternal Abuse — cf. CVE-2020-25019
Lab page: `src/renderer/pages/openexternal.html`
Vulnerable code: `src/main/main.js`

---

## 1. Objective

Get the app to launch an OS protocol handler / open attacker-chosen content via an unvalidated
URL — i.e. make `shell.openExternal()` hand off something other than a plain, expected `https:`
link.

This is the outbound mirror of the Deep Link Hijacking module: a deep link is the OS handing an
*inbound* URL to the app; `shell.openExternal()` is the app handing an *outbound* URL back to the
OS. Both fail the same way — trusting a URL's scheme/host to decide what gets launched, just on
opposite sides of the process boundary.

---

## 2. Exploitation walkthrough

**Step 1 — find the handler.** `src/main/main.js` registers a single IPC handler for this
feature, right after the IPC-monitor wrapping is installed inside `main()`:

```js
ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});
```

The renderer-side entry point is exposed by the default preload, unconditionally, to any page
that loads it:

```js
// src/main/preload.js
openExternal: (url) => ipcRenderer.invoke('open-external', url),
```

and the lab page calls it directly with whatever the user typed:

```js
// src/renderer/pages/openexternal.html
document.getElementById('openexternal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('url').value;
  await window.api.openExternal(url);
});
```

There is no scheme check, no host check, and no distinction between "a plain web link" and
"a string that happens to also be a valid URI for something else entirely" anywhere in that
chain. Whatever string reaches `shell.openExternal(url)` is what Electron asks the OS to launch.

**Note — how attacker input reaches this handler in a real app.** The lab page has the victim
type the URL directly, which isolates the flaw for demonstration; in production, the victim
never types the payload. Three concrete ways attacker-controlled input reaches an
`openExternal`-backed handler without any typing:
- **XSS reaching an openExternal bridge** — a cross-site-scripting bug in a renderer that has
  access to an `openExternal`-backed API lets injected script call it directly with an attacker
  URL. This is literally what happened in CVE-2020-25019, and Positive Security's "1-click RCE
  in Electron" research documents the same pattern across many other apps.
- **Rendered untrusted content** — the app displays attacker-controlled content (a chat message,
  an email, a shared post) and routes a link the victim clicks through `shell.openExternal()`
  without checking its scheme first.
- **Deep link forwarding** — a custom-scheme handler forwards a URL parameter from an external
  `myapp://...` link straight into `shell.openExternal()`, chaining one protocol-handling flaw
  into another (see the Deep Link Hijacking module's writeups for that half of the chain).

**Step 2 — understand what `shell.openExternal` actually does.** It does not fetch or render
the URL itself — it delegates to the operating system's default handler for the URL's scheme,
exactly the way double-clicking a link in a browser or a chat app would:

- `https://...` → the OS's default browser.
- `mailto:...` → the OS's default mail client, pre-filled from the URL.
- `tel:...`, `slack://...`, `vscode://...`, or any other scheme an installed app has registered
  with the OS → that app, launched with the URL (and whatever arguments it encodes) as input.
- `file://...` → the OS's default handler for that file's type — e.g. a text editor, an image
  viewer, a PDF reader. This is a **launch**, not a read: DVEA's own process never sees the
  file's bytes. That's a distinct primitive from the Deep Link → Path Traversal lab, where main
  reads a file with `fs.promises.readFile()` and hands the *contents* back into the app. Here,
  the app never touches the content at all — it just tells the OS "launch whatever opens this."

**Step 3 — build a payload.** Because the string is passed through unmodified, several distinct
attack shapes work from the same one-line handler:

```
https://attacker.example/phish.html
```
Opens a phishing page in the system browser — indistinguishable from any other link the app
might legitimately open, so a victim who trusts DVEA has no reason to suspect it.

```
mailto:victim@example.com?subject=x&body=x
```
Launches the mail client with attacker-controlled subject/body — useful for auto-populating a
mail-based social-engineering payload the victim only has to hit "send" on.

```
file:///etc/passwd
```
Launches whatever the OS treats as the default handler for an unrecognized/plain-text file
(commonly a text editor) — proving the handler will happily launch a system file path, not just
`http(s)` URLs. This demonstrates the launch primitive; it is not equivalent to reading the
file's contents into DVEA (compare `writeups/deep-link-path-traversal.md`, where the content
genuinely does end up inside the app).

```
<a-locally-registered-custom-scheme>://<attacker-controlled-arguments>
```
The real escalation risk in the wild: **CVE-2020-25019** (Jitsi Meet Electron) showed exactly
this — an unvalidated URL reaching `shell.openExternal` let an attacker reach a locally
registered custom-protocol handler with attacker-controlled arguments, which in that case led to
code execution. Positive Security's "1-click RCE in Electron" research catalogued the identical
unsafe pattern (unvalidated input into `shell.openExternal`) across Telegram, Nextcloud, VLC,
Wireshark, Mumble, and several Bitcoin wallets — the vulnerable pattern in this lab is not a
contrived teaching example, it is the literal root cause behind a whole class of real-world
Electron CVEs.

**Step 4 — trigger it.** Type any of the above into the lab's URL field and click "Open Link" —
the string goes straight to `shell.openExternal()` with the app's own OS-level permissions, no
different from the app clicking the link on the victim's behalf.

---

## 3. Vulnerable code vs. fixed code

**Vulnerable** (`src/main/main.js`):

```js
ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});
```

**Fixed** — parse the URL and check its scheme against an allowlist before ever calling
`shell.openExternal()`:

```diff
+// mailto: is included only because this product genuinely needs to let users compose
+// email from a link — add it (or any other scheme) only when there is a real product
+// need, never by default.
+const ALLOWED_EXTERNAL_SCHEMES = new Set(['https:', 'mailto:']);
+
 ipcMain.handle('open-external', (event, url) => {
+  let parsed;
+  try {
+    parsed = new URL(url);
+  } catch (err) {
+    console.warn('Blocked malformed openExternal URL:', url);
+    return;
+  }
+  if (!ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)) {
+    console.warn('Blocked openExternal for disallowed scheme:', parsed.protocol, url);
+    return;
+  }
   shell.openExternal(url);
 });
```

---

## 4. Why the fix works

- **Parse first, decide on the parsed scheme — not the raw string.** `new URL(url).protocol`
  normalizes the scheme (lowercased, trailing `:` included, whatever prefix/whitespace tricks
  the raw string tried) before the allowlist check ever runs. A check against the raw string
  (e.g. `url.startsWith('https://')`) is bypassable by whitespace, case variation, or a scheme
  string an ad-hoc parser doesn't expect; comparing the actual parsed `protocol` field removes
  that class of bug entirely, the same reasoning the Deep Link → Untrusted Navigation writeup
  applies to comparing `.origin` instead of a string prefix.

- **This must be an allowlist, not a denylist — and that is a hard requirement, not a style
  preference.** A denylist has to enumerate every dangerous scheme in advance:
  `file:`, `javascript:`, every OS-specific launcher scheme (`ms-settings:`,
  `shell:`, `search-ms:` on Windows; various `x-scheme-handler/*` registrations on Linux), and
  every third-party app's custom scheme currently installed on the victim's machine —
  `slack://`, `vscode://`, `zoommtg://`, `steam://`, and thousands more that update and expand
  continuously as users install new software. That set is:
  - **Unenumerable in principle.** Any app the victim has installed can register a new scheme at
    any time, entirely outside DVEA's knowledge or control — DVEA cannot possibly maintain a
    complete list of "dangerous" schemes across every OS and every third-party app a user might
    have.
  - **Unenumerable even for known-bad schemes.** New OS-level launcher schemes are added by
    platform vendors over time (this is exactly the mechanism CVE-2020-25019 and the Positive
    Security research exploited — schemes registered by other installed apps, invisible to the
    vulnerable app's own source).
  - **Trivially bypassed by anything the list-writer didn't think of.** A denylist author who
    blocks `file:` and `javascript:` has done nothing to stop `mailto:`, a custom scheme, or any
    OS launcher scheme that wasn't top-of-mind when the list was written — the attacker only
    needs one scheme the defender forgot.

  An allowlist inverts this to a tractable problem: DVEA knows exactly what it *needs*
  `shell.openExternal` for, and grants only that. `https:` is the core, unavoidable case —
  opening ordinary web links. `mailto:` is deliberately framed as conditional, not a default:
  it belongs in the allowlist only if the product genuinely needs to let users compose email
  from a link, and should be left out entirely otherwise. The general lesson is "allow the
  minimum the product actually needs, not the minimum that seems harmless" — every scheme
  added to the allowlist should be justified by a real feature requirement, because each one
  is also a new thing the fix promises never to block. Everything not explicitly justified is
  rejected by default, including every future scheme that doesn't exist yet.

- **Fail closed on both failure modes.** A malformed string that isn't a valid URL at all (e.g.
  a bare word, or a string `new URL()` throws on) is rejected the same way as a well-formed but
  disallowed scheme — neither path falls through to calling `shell.openExternal()`.

- **This is a defense specifically for this hand-off point.** It doesn't replace other
  general Electron hardening (`contextIsolation`, disabling `nodeIntegration`, CSP) — those
  protect the renderer itself. This fix protects the boundary where the *main process* hands a
  string to the *operating system*, which is the actual vulnerability this lab demonstrates and
  the one CVE-2020-25019 exploited in the wild.
