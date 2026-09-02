# DVEA

Damn Vulnerable Electron App (DVEA) is a deliberately vulnerable ElectronJS application for learning and testing Electron-specific security issues. It is designed for developers, security engineers, and trainers.

## Vulnerabilities Demonstrated

DVEA includes realistic, intentionally insecure implementations of common Electron vulnerabilities:

- **Open Redirect** (deep link abuse)
- **Renderer XSS**
	- XSS: No Privileged APIs Exposed
	- XSS: Overprivileged ContextBridge
	- XSS to RCE (Direct, main window)
- **Insecure File Write (IPC Abuse)**
- **openExternal Abuse (Protocol Handling)**

All vulnerabilities are accessible from the main menu. Each has a dedicated page with a guide, security checklist, and example payloads.

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

All documentation and walkthroughs are now provided inline within the app UI for each vulnerability demo.

---


## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to contribute to DVEA.

---