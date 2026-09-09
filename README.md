# DVEA

Damn Vulnerable Electron App (DVEA) is a deliberately vulnerable ElectronJS application for learning and testing Electron-specific security issues. It is designed for developers, security engineers, and trainers.

## Vulnerabilities Demonstrated

DVEA includes realistic, intentionally insecure implementations of common Electron vulnerabilities:

- **Deep Link Hijacking** (`dvea://`)
	- Deep Link → Untrusted Navigation
	- Deep Link → Path Traversal
- **Insecure File Write** (IPC Abuse)
- **openExternal Abuse** (Protocol Handling, cf. CVE-2020-25019)
- **What Can XSS Do in Electron?** — the same injection across three window configs
	- Challenge 1 — Contained (hardened; XSS walled to the renderer)
	- Challenge 2 — Bridged (one overprivileged preload API)
	- Challenge 3 — Owned (nodeIntegration; renderer is Node)
- **Insecure Auto-Update** (cf. CVE-2024-39698)
- **Stored HTML Injection → IPC Token Exfiltration** — the flagship challenge

All vulnerabilities are accessible from the main menu. Most modules are presented as **challenges**:
an objective and a live playground, with the solution deliberately withheld. A few flag-gated
challenges award `DVEA{...}` flags as you complete tasks.

---

## Download

Pre-built binaries for Linux (Debian) are available from the [GitHub releases page](https://github.com/njmulsqb/DVEA/releases/latest).

For macOS and Windows, please build the application from source (see below).

---

## Running from Source

```sh
git clone https://github.com/njmulsqb/DVEA
cd DVEA
npm install
npm run start
```

**LINUX USERS ONLY — Electron sandbox helper permissions**

On many Linux systems a fresh `npm install` does not set the setuid bit on Electron's sandbox helper. Before running the app on Linux, run the following commands from the project root:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

This sets the owner to `root` and the setuid bit required by Electron's sandbox helper. macOS and Windows do not require this step.

**Tested Platforms & Node**

DVEA is built and tested on Ubuntu (Linux). Node 20+ is required; tested on Node v22.21.0. macOS may work; Windows is untested.

---

## Documentation

Most vulnerability demos provide their guide and walkthrough inline within the app UI. Some
labs are presented as pure challenges instead — an objective and a live playground, with no
in-app walkthrough, payload, or solution. Solutions and full writeups for those labs (the
real vulnerable code, the working exploit, the fix, and why it works) live in the
[`writeups/`](./writeups) folder of this repository, not in the app itself.

---


## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to contribute to DVEA.

---