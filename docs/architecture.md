# DVEA architecture

This diagram reflects the app as it actually runs (`src/main/main.js`), not an idealized version.
It covers three things: how the hub launches modules, how the observability store is fed, and how
the panel stays isolated from the vulnerable surface it watches.

## Boot & module launch

```mermaid
flowchart TB
    subgraph MainProcess["Main process (Node.js, full OS access)"]
        Boot["Module load:<br/>installIpcWrapping()<br/>require('./insecure-auto-update')<br/>top-level ipcMain.handle('save-file' / 'filewrite-init')"]
        Ready["app.on('ready') → main()<br/>creates mainWindow, deep-link handlers,<br/>vuln IPC handlers, panel window"]
        Obs["observability.js<br/>(singleton store: config + ipcLog)"]
        Boot --> Ready
        Ready -->|registerWindow on every<br/>Window/BrowserWindow| Obs
    end

    subgraph Hub["Hub window (index.html)"]
        HubUI["Module list<br/>(6 modules, difficulty-rated)"]
    end

    subgraph InProcess["Same-window navigation (plain &lt;a href&gt;)"]
        M1["Deep Link Hijacking routes<br/>Insecure File Write<br/>openExternal Abuse<br/>Insecure Auto-Update<br/>Stored HTML Injection landing"]
    end

    subgraph DedicatedWindows["Dedicated BrowserWindow per launch (IPC-created)"]
        XSS1["XSS Ch.1 — Contained<br/>sandbox+isolation, zero-exposure preload"]
        XSS2["XSS Ch.2 — Bridged<br/>sandbox+isolation, systemAPI.runCommand bridge"]
        XSS3["XSS Ch.3 — Owned<br/>nodeIntegration:true, no preload"]
        Analytics["Analytics window (flagship target)<br/>preload-analytics.js, get-token (no sender check)"]
        FakeLogin["Fake-login popup<br/>(Deep Link → Untrusted Navigation demo)"]
    end

    subgraph Panel["Observability panel (isolated)"]
        PanelWin["Panel BrowserWindow<br/>contextIsolation:true, sandbox:true,<br/>nodeIntegration:false, preload-panel.js"]
    end

    HubUI -->|"&lt;a href&gt;"| M1
    HubUI -->|"window.api.openXSS*()<br/>→ ipcMain.on('open-xss-*')"| XSS1
    HubUI -->|"window.api.openXSS*()"| XSS2
    HubUI -->|"window.api.openXSS*()"| XSS3
    M1 -->|"ipcMain.on('open-analytics')"| Analytics
    M1 -->|"deep-link IPC → openUntrustedNavigationWindow()"| FakeLogin

    Ready -.creates.-> PanelWin
    Obs -->|"one-way push, reserved channel<br/>__dvea_monitor__"| PanelWin
```

## Observability data flow

```mermaid
flowchart LR
    subgraph Sources["Every vulnerable window"]
        WP["webContents.getLastWebPreferences()<br/>(effective, not declared)"]
        CSP["Response-header CSP +<br/>&lt;meta http-equiv=CSP&gt; probe"]
        IPCcalls["ipcMain.handle/.on<br/>(wrapped at module-load time)"]
        SendCalls["webContents.send<br/>(wrapped per-window)"]
        Preload["Preload self-report<br/>'preload-corroboration'<br/>(contextIsolated, sandboxed)"]
    end

    Store["observability.js<br/>config.windows[id], config.activeWindow, ipcLog[]<br/>(bounded, deduped, size-capped, redactable)"]

    Sources --> Store
    Store -->|"_pushSnapshot(): {config, ipcLog, ts}<br/>over __dvea_monitor__ (one-way)"| PanelRenderer

    subgraph PanelProcess["Panel window (locked down)"]
        PanelPreload["preload-panel.js<br/>exposes ONLY monitor.onUpdate(cb)"]
        PanelRenderer["panel.js<br/>renders config as JSON,<br/>ipcLog as scrolling list"]
        PanelPreload --> PanelRenderer
    end
```

## Why this design matters for the training goal

- **The panel cannot be reached from the vulnerable surface.** It has no exposed IPC handlers of
  its own to invoke, `contextIsolation`/`sandbox` on, and its only inbound data is a one-way push
  over a channel (`__dvea_monitor__`) that every wrap explicitly excludes from its own logging (no
  feedback loop). Compromising any demo window does not give you a path into the panel process.
- **Config Inspector reads ground truth, not configuration intent.** It reads
  `getLastWebPreferences()` — what Electron actually applied — which is what lets students see,
  live, that "declared `sandbox: true`" and "effective `sandbox: true`" are not automatically the
  same thing (see the README's chrome-sandbox troubleshooting note).
- **The IPC Monitor blind spot was a real bug, now fixed.** `ipcMain.handle`/`.on` are monkey-patched
  once, idempotently, at module load — *before* `insecure-auto-update.js` and the trailing
  `save-file`/`filewrite-init` handlers register. Node captures a reference to the unwrapped
  function the instant a handler binds, so installing the wrap any later (e.g. inside the
  `'ready'` handler) would have left those modules permanently invisible to the monitor.
- **Two launch shapes, one hub.** Most modules are same-window navigations (`<a href="module.html">`);
  a few (the three XSS challenges, the analytics window, the fake-login popup) are dedicated
  windows created by main in response to an IPC call. Both shapes register with the observability
  store the same way — through `Window`'s constructor for windows built with that helper, or via
  the global `browser-window-created` listener for windows created with a bare `new BrowserWindow(...)`.

See `CLAUDE.md` in the repo root for the full per-module breakdown this diagram summarizes.
