# DVEA

Damn Vulnerable ElectronJS App (DVEA) is a deliberately vulnerable ElectronJS application designed for developers and security engineers to learn about and test Electron-specific security issues.

## Features

DVEA demonstrates a vulnerable to-do list application and currently includes the following vulnerabilities:

1. Cross-Site Scripting (XSS)
2. XSS to Remote Code Execution (RCE)
3. Deep Links to XSS
4. Deep Links to RCE

---

## Download

Pre-built binaries for Linux (Debian) are available from the [GitHub releases page](https://github.com/njmulsqb/DVEA/releases/latest).

For macOS and Windows, please build the application from source (see below).

---

## Running from Source


```
git clone https://github.com/njmulsqb/DVEA
cd DVEA
npm install
npm run start
```

---

## Walkthrough

A walkthrough of this application is available in [walkthrough.md](./walkthrough.md).

---

## Contributing

Contributions are welcome! Please submit pull requests to help improve DVEA.

---