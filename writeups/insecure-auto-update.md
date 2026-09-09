# Insecure Auto-Update — Writeup

Module: Insecure Auto-Update — cf. CVE-2024-39698
Lab page: `src/renderer/pages/insecure-auto-update.html`
Vulnerable code: `src/main/insecure-auto-update.js` (the `check-for-update` handler)
Feed server: `src/labs/insecure-auto-update/server.js`

---

## 1. Objective

Prove that an updater which trusts its feed is a supply-chain RCE primitive:

1. Get the updater to accept and apply an update fetched over plaintext **HTTP** (no TLS).
2. Get it to execute an **unsigned / forged** payload, so attacker code runs in the main process.
3. Switch on **HARDENED** mode and confirm the same forged update is now rejected on integrity
   grounds — the fix.

The lab awards flags for DVEA-controlled evidence (the `/tmp` sentinels the bundled payloads
leave), so it is safe to run repeatedly, but the updater itself is honest: it fetches whatever feed
URL you give it and, in VULNERABLE mode, `eval()`s whatever payload the manifest names.

This is the deepest form of the trust-boundary class DVEA keeps returning to. Deep Link is an
*inbound* URL the OS hands the app; openExternal is an *outbound* URL the app hands the OS; File
Write is a *path* the renderer hands the main process. Here the untrusted input is **the update
code itself**, fetched from the network and run with the app's full privileges.

---

## 2. Exploitation walkthrough

**Step 0 — the handler.** `src/main/insecure-auto-update.js` fetches the manifest, downloads the
payload the manifest names, and — in `vulnerable` mode — runs it with no checks at all:

```js
const manifestRes = await fetchUrl(feed);          // plain HTTP, no TLS required
const manifest = JSON.parse(manifestRes.body);
// ... (hardened-mode HTTPS/hash/signature checks are SKIPPED in vulnerable mode) ...
const payloadRes = await fetchUrl(manifest.url);
const payload = payloadRes.body;
// VULNERABLE: execute the payload with no verification
eval(payload);                                       // ← runs in the MAIN process
```

`fetchUrl` even sets `rejectUnauthorized: false`, so TLS is not merely optional — certificate
validation is disabled outright. Three separate failures stack here: no transport authentication
(HTTP is accepted; even HTTPS wouldn't be verified), no integrity check (no hash), and no
authenticity check (no signature). Any one of them being absent is enough; all three are.

**Step 1 — start the feed server (recon).** The bundled server
(`src/labs/insecure-auto-update/server.js`) is the stand-in for an attacker-controlled feed reached
via MITM / DNS poisoning / a compromised CDN. Start it from the lab; it serves, on random ports,
over both HTTP and HTTPS:

- `/clean/manifest.json` → a manifest whose `signature` is a **valid** HMAC over the payload.
- `/poisoned/manifest.json` → a manifest whose `signature` is the literal string
  `INVALID_SIGNATURE` (the forgery), pointing at a payload that installs a backdoor.

It also plants a decoy secret at `/tmp/dvea-wallet.dat` — a host file a real update payload could
read, because it runs with the app's privileges.

**Step 2 — Task 1: update over plaintext HTTP.** Point the feed URL at the **HTTP** clean manifest
and run in VULNERABLE mode:

```
Mode: VULNERABLE
Feed: http://localhost:<httpPort>/clean/manifest.json
```

The updater fetches it over plaintext HTTP and applies it (the clean payload writes
`/tmp/dvea-update-clean.txt`). This proves the transport is completely unauthenticated — the entire
precondition for a network attacker. Flag: `DVEA{update_over_plaintext_http}`.

**Step 3 — Task 2: execute an unsigned payload (silent RCE).** Now point at the **poisoned** HTTP
manifest, still VULNERABLE mode:

```
Mode: VULNERABLE
Feed: http://localhost:<httpPort>/poisoned/manifest.json
```

The manifest's `signature` is `INVALID_SIGNATURE` — a forgery that any real updater would reject —
but VULNERABLE mode never looks at it. The poisoned payload runs in the main process and:

```js
// the poisoned payload (served by the feed server), reconstructed:
(function () {
  const fs = require('fs');
  let note = 'BACKDOOR INSTALLED ' + new Date().toISOString();
  try {
    const wallet = fs.readFileSync('/tmp/dvea-wallet.dat', 'utf8');
    note += ' | exfiltrated:firstline:' + wallet.split('\n')[0].slice(0, 200);
  } catch (e) {}
  fs.writeFileSync('/tmp/dvea-backdoor.txt', note);
})();
```

It writes the backdoor sentinel `/tmp/dvea-backdoor.txt` **and** reads the planted wallet and
embeds its first line in the note — arbitrary host read + write from a downloaded "update", with no
user interaction. The attacker view on the page shows that backdoor note, including the exfiltrated
line. Flag: `DVEA{unsigned_payload_executed}`. (Tasks 1 and 2 can both land from this one poisoned
HTTP run, since it is also an HTTP update.)

**Step 4 — Task 3: confirm the fix (Contained).** Switch to HARDENED mode and re-run the forged
feed. Any hardened rejection earns the flag; the richer demonstration is the **poisoned HTTPS**
manifest:

```
Mode: HARDENED
Feed: https://localhost:<httpsPort>/poisoned/manifest.json
```

Now the updater enforces HTTPS, recomputes the SHA-256 of the payload and compares it to
`manifest.hash`, and recomputes the HMAC signature and compares it to `manifest.signature`. The
poisoned manifest's forged `INVALID_SIGNATURE` fails that last check and the update is **rejected**
with `HARDENED: signature verification failed` — nothing executes. That is the integrity check
catching the forgery even though the transport was fine.

Pointing hardened mode at the **poisoned HTTP** feed instead is rejected earlier, for transport
(`HARDENED: feed must be HTTPS`) — a shallower but still valid demonstration that the hardened
updater refuses an unsafe update. Either rejection is a blocked forgery, a different outcome from an
exploit, so the lab marks it **Contained ✓** rather than Solved. Flag:
`DVEA{hardened_rejected_forgery}`.

(The two rejection points are ordered transport-then-integrity, matching a realistic hardened
updater that refuses plaintext HTTP before it ever looks at a payload. Reaching the *signature*
check therefore requires the HTTPS feed.)

---

## 3. Vulnerable code vs. fixed code

**Vulnerable** (`src/main/insecure-auto-update.js`, VULNERABLE mode) — no transport, integrity, or
authenticity check before executing downloaded code:

```js
const manifestRes = await fetchUrl(feed);           // http:// accepted; TLS not verified
const manifest = JSON.parse(manifestRes.body);
const payloadRes = await fetchUrl(manifest.url);
const payload = payloadRes.body;
eval(payload);                                        // execute, unconditionally
```

**Fixed** — the module already contains the shape of the fix in its HARDENED branch; the lesson is
that these checks must be **mandatory**, not a mode:

```js
// 1. Transport: require HTTPS, and DO verify the certificate (remove rejectUnauthorized:false,
//    ideally pin the update server's cert / public key).
if (new URL(feed).protocol !== 'https:') throw new Error('update feed must be HTTPS');

// 2. Integrity: the payload must match the hash the manifest commits to.
if (sha256hex(payload) !== manifest.hash) throw new Error('payload hash mismatch');

// 3. Authenticity: the manifest must carry a valid signature from a key the app trusts.
if (hmacHex(payload) !== manifest.signature) throw new Error('signature verification failed');

// 4. Only now, and ideally NEVER via eval of arbitrary JS — apply the update through the
//    platform's code-signed updater instead.
applyVerifiedUpdate(payload);
```

The single most important real-world change is **#4**: production apps must not hand-roll
"download code and `eval` it." Use the platform auto-updater (`autoUpdater` / Squirrel /
`electron-updater`) with **OS-level code signing**, so the OS verifies the update package's
signature against the developer's certificate before it is ever run. The HMAC-with-a-shared-secret
scheme in this lab is a teaching stand-in — a shared secret shipped in the app is not real
authenticity (anyone with the binary has the key); real signing uses asymmetric keys where only the
publisher holds the private key.

---

## 4. Why this matters — supply-chain reach

The reason auto-update bugs are catastrophic rather than merely bad is blast radius. Every other
vuln in DVEA compromises one victim who does something (clicks a link, gets XSS'd). A poisoned
update feed compromises **every user who launches the app**, automatically:

- **The network position is easy to reach.** Plaintext HTTP (or HTTPS with cert validation
  disabled, exactly what `fetchUrl` does) means any on-path attacker wins: public Wi-Fi, a poisoned
  DNS resolver, a malicious proxy, a compromised CDN edge, or a breached update server. The user
  does nothing wrong and sees nothing.
- **It runs in the main process, unsandboxed.** The payload has the app's full Node.js and OS
  privileges — it can read files (the wallet exfiltration here is a stand-in for credentials,
  tokens, SSH keys, crypto wallets), spawn processes, and write to disk.
- **It is the ideal persistence mechanism.** Update code runs on every launch and is *expected* to
  change, so a backdoor delivered as an "update" blends in and re-establishes itself — the same
  reason overwriting a file the app loads on next launch is the capstone of the File Write module.
- **This is a real, recurring CVE class.** CVE-2024-39698 (electron-updater) and the surrounding
  research on `electron-updater` signature handling are exactly "the updater didn't properly verify
  the authenticity of what it was about to run." The vulnerable pattern in this lab — trust the
  feed, skip verification, execute — is the root cause behind that whole class.

The fix is not a clever check; it is a posture: **treat everything the update channel returns as
attacker-controlled until an asymmetric signature proves otherwise, over an authenticated transport,
and never execute unsigned downloaded code.** That is the same IPC/trust-boundary discipline the
rest of DVEA teaches, applied to the highest-privilege input an app takes.
