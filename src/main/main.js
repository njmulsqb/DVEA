'use strict';
// dotenv and electron-reload are devDependencies, so @electron/packager prunes them out of a
// packaged build (.deb). Requiring either unguarded crashes the packaged app at load time with
// "Cannot find module" before anything else runs. Both are source-run conveniences only —
// nothing in the app depends on them, so a miss here is a no-op rather than a fatal error.
try {
  require('dotenv').config();
} catch (err) {}
const path = require('path');
const { app, ipcMain, BrowserWindow } = require('electron');
if (process.env.NODE_ENV === 'development') {
  try {
    require('electron-reload')(path.join(__dirname, '..'), {
      hardResetMethod: 'exit',
    });
  } catch (err) {}
}
const { shell } = require('electron');
const fs = require('fs');
const { exec, execSync } = require('child_process');

const Window = require('../main/windows/Window');
const { sandboxed, contextIsolated } = require('process');
const observability = require('./observability');
// Challenge 2 — Bridged: fixed secret path/flags the bridge's real command execution proves
// access to (see openXSSBridgedWindow / bridge-run-command below).
const BRIDGE_SECRET_PATH = '/tmp/dvea-bridge-secret.txt';
const BRIDGE_OS_FLAG = 'DVEA{bridge_to_os_pivot}';
const BRIDGE_CALL_FLAG = 'DVEA{bridge_command_executed}';
// Challenge 3 — Owned: a file this window's own renderer reads directly via require('fs'),
// since nodeIntegration: true gives it that access with nothing in between (see
// openXSSOwnedWindow below).
const RCE_SECRET_PATH = '/tmp/dvea-rce-flag.txt';
const RCE_HOST_FLAG = 'DVEA{full_host_compromise}';
// Pick the dvea:// deep link out of a process argv list. Used for both the cold-start case
// (our own process.argv) and the already-running case (the second instance's argv), since the
// URL's position varies: `electron .` puts a path first in development, and the OS appends the
// URL to whatever Exec line the .desktop file declares.
function findDeepLinkArg(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith('dvea://')) || null;
}

// Escape untrusted text for the DIAGNOSTIC pages main builds (e.g. the "target failed to load"
// page below). This is not a hardening of any lab — no vulnerable path uses it; it only stops a
// malformed target string from mangling an error message the user needs to be able to read.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Insecure auto-update demo (registers IPC handlers)
let insecureAutoUpdate = null;
try {
  insecureAutoUpdate = require('./insecure-auto-update');
} catch (err) {}

function main() {
  let mainWindow = new Window({
    file: path.join('src/renderer/pages', 'index.html'),
  });

  // When the main window closes, tear down other app windows and demo servers, then quit.
  mainWindow.on('closed', async () => {
    try {
      // Close observability panel if present
      try {
        if (panelWindow && !panelWindow.isDestroyed && !panelWindow.isDestroyed()) {
          panelWindow.close();
        }
      } catch (err) {}

      // Close any remaining app windows
      try {
        const { BrowserWindow } = require('electron');
        const all = BrowserWindow.getAllWindows();
        for (const w of all) {
          try {
            if (w && !w.isDestroyed && !w.isDestroyed()) w.close();
          } catch (err) {}
        }
      } catch (err) {}

      // Stop local demo servers / child processes if running
      try {
        if (insecureAutoUpdate && insecureAutoUpdate.stopServer) {
          await insecureAutoUpdate.stopServer();
        }
      } catch (err) {}

      // Quit the app entirely
      try {
        app.quit();
      } catch (err) {}
    } catch (err) {}
  });

  // Wrap ipcMain.handle and ipcMain.on at startup so invoke/handle and on/send are logged.
  try {
    const origHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = function (channel, listener) {
      if (typeof channel === 'string' && channel.startsWith('__dvea_monitor__')) {
        return origHandle(channel, listener);
      }
      const wrapped = async function (event, ...args) {
        try {
          const redact = !!(observability.config && observability.config.ipcRedact);
          const serialized = observability.serializeArgs(args, redact);
          observability.pushIpcLog({
            ts: Date.now(),
            direction: 'R→M',
            kind: 'invoke',
            channel,
            args: serialized,
            senderId: event && event.sender && event.sender.id,
            frameUrl: event && event.senderFrame && event.senderFrame.url ? event.senderFrame.url : null,
          });
        } catch (err) {}
        const res = await listener(event, ...args);
        try {
          const redact = !!(observability.config && observability.config.ipcRedact);
          const serializedRes = observability.serializeArgs([res], redact);
          observability.pushIpcLog({
            ts: Date.now(),
            direction: 'M→R',
            kind: 'invoke-response',
            channel,
            args: serializedRes,
            senderId: event && event.sender && event.sender.id,
            frameUrl: event && event.sender && event.sender.getURL ? event.sender.getURL() : null,
          });
        } catch (err) {}
        return res;
      };
      return origHandle(channel, wrapped);
    };

    const origOn = ipcMain.on.bind(ipcMain);
    ipcMain.on = function (channel, listener) {
      if (typeof channel === 'string' && channel.startsWith('__dvea_monitor__')) {
        return origOn(channel, listener);
      }
      const wrapped = function (event, ...args) {
        try {
          const redact = !!(observability.config && observability.config.ipcRedact);
          const serialized = observability.serializeArgs(args, redact);
          observability.pushIpcLog({
            ts: Date.now(),
            direction: 'R→M',
            kind: 'on',
            channel,
            args: serialized,
            senderId: event && event.sender && event.sender.id,
            frameUrl: event && event.senderFrame && event.senderFrame.url ? event.senderFrame.url : null,
          });
        } catch (err) {}
        return listener(event, ...args);
      };
      return origOn(channel, wrapped);
    };
  } catch (err) {}

  ipcMain.handle('open-external', (event, url) => {
    shell.openExternal(url);
  });

  if (!app.isDefaultProtocolClient('dvea')) {
    app.setAsDefaultProtocolClient('dvea');
  }

  // macOS delivers deep links as an app event. Linux and Windows do not — there the URL
  // arrives as a command-line argument, handled by the two paths below.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // App ALREADY running: the OS starts a second process, which the single-instance lock (see
  // the bottom of this file) turns into this event on the first instance, handing us its argv.
  app.on('second-instance', (event, argv) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const deepLink = findDeepLinkArg(argv);
    if (deepLink) handleDeepLink(deepLink);
  });

  // App NOT running: the OS launches it with the deep link in our own argv. Nothing else reads
  // it — 'open-url' is macOS-only and 'second-instance' by definition only fires for an
  // instance that was already up — so without this, a cold-start deep link silently opens the
  // app and does nothing at all. Deferred until the first page load settles so the route
  // handlers aren't navigating a window that is still loading index.html.
  const initialDeepLink = findDeepLinkArg(process.argv);
  if (initialDeepLink) {
    mainWindow.webContents.once('did-finish-load', () => handleDeepLink(initialDeepLink));
  }

  // Open a new app window and navigate it directly to an attacker-supplied URL, with no
  // validation. Shared by the real dvea://navigate handler and its in-app simulator so both
  // exercise the exact same vulnerable code path (same window shape, same unchecked
  // loadURL call) rather than two similar-but-different implementations.
  function openUntrustedNavigationWindow(target) {
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      show: false,
      resizable: true,
      maximizable: true,
      title: 'DVEA',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // The window is created hidden so it can pop up fully painted. `ready-to-show` only fires
    // once a document actually COMMITS, though — so if the navigation below fails (invalid URL,
    // a scheme Chromium has no handler for, DNS/TLS failure), that event never arrives and the
    // window stays hidden forever: the demo appears to do nothing at all, and leaks a hidden
    // window per attempt. Reveal it on first paint OR on load failure, whichever happens.
    let shown = false;
    const reveal = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      win.show();
    };
    win.once('ready-to-show', reveal);

    // Show WHY a target didn't load rather than failing silently. Guarded so the diagnostic
    // page's own load can't re-enter this and loop.
    let reported = false;
    const reportLoadFailure = (reason) => {
      if (reported || win.isDestroyed()) return;
      reported = true;
      const html = `<!doctype html><meta charset="utf-8">
        <body style="font:14px system-ui;padding:1.5rem;color:#0f172a">
          <h2 style="margin:0 0 .5rem">DVEA — target failed to load</h2>
          <p style="margin:0 0 1rem;color:#475569">The main process passed this URL straight to
          <code>loadURL()</code> with no validation, exactly as a real deep link would. Chromium
          then refused to navigate to it.</p>
          <p><strong>Target:</strong> <code>${escapeHtml(target)}</code></p>
          <p><strong>Reason:</strong> <code>${escapeHtml(reason)}</code></p>
          <p style="color:#475569">A bare hostname (<code>example.com</code>) is not a valid URL —
          include a scheme. A <code>dvea://</code> link cannot be loaded into a window either;
          that scheme is registered with the OS, not with Chromium.</p>
        </body>`;
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
      reveal();
    };

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED, which is normal traffic (a superseded or cancelled navigation),
      // not a failure worth reporting. Subframe failures aren't this window failing either.
      if (!isMainFrame || errorCode === -3) return;
      reportLoadFailure(errorDescription || 'errno ' + errorCode);
    });

    // Vulnerable navigation: main process directly loads the attacker URL into a new window.
    // Still completely unvalidated — the catch only reports the outcome, it rejects nothing.
    // (loadURL returns a promise; leaving it unhandled was what hid invalid-URL errors, since
    // those reject without ever emitting did-fail-load.)
    win.loadURL(target).catch((err) => reportLoadFailure(err && err.message ? err.message : String(err)));

    return win;
  }

  async function handleDeepLink(url) {
    try {
      const parsed = new URL(url);
      // Route: navigate window to a URL (dvea://navigate?url=...)
      const target = parsed.searchParams.get('url');
      if (target && mainWindow) {
        try {
          openUntrustedNavigationWindow(target);
        } catch (err) {
          console.error('Failed to navigate to deep link target:', err);
        }
        return;
      }

      // Route: open/read a file (dvea://open?path=...)
      const openPath = parsed.searchParams.get('path');
      if (parsed.host === 'open' && openPath && mainWindow) {
        try {
          await mainWindow.loadFile(path.join('src/renderer/pages', 'deep-link-path-traversal.html'));
          try {
            const content = await fs.promises.readFile(openPath, 'utf8');
            mainWindow.webContents.send('deeplink-open', { path: openPath, content });
          } catch (err) {
            mainWindow.webContents.send('deeplink-open', { path: openPath, error: 'Read failed: ' + err.message });
          }
        } catch (err) {
          console.error('Failed to load route2 page for deep link open:', err);
        }
        return;
      }
    } catch (err) {
      console.error('Invalid deep link:', err);
    }
  }

  // Create a new app window and navigate it to the attacker-supplied URL — the identical
  // vulnerable code path (openUntrustedNavigationWindow, above) that a real
  // dvea://navigate?url=... deep link uses.
  ipcMain.handle('simulate-deeplink-window', (event, rawTarget) => {
    try {
      const input = typeof rawTarget === 'string' ? rawTarget.trim() : '';
      if (!input) return { ok: false, error: 'Enter a target URL first.' };

      let target = input;

      // The "Try It" panel above the simulator teaches the real link format, so pasting a whole
      // dvea://navigate?url=... link in here is the natural thing to do. Unwrap it the same way
      // handleDeepLink() does rather than handing 'dvea://...' to loadURL(), which can't resolve
      // it — setAsDefaultProtocolClient registers that scheme with the OS, not with Chromium.
      if (/^dvea:/i.test(target)) {
        const inner = new URL(target).searchParams.get('url');
        if (!inner) {
          return { ok: false, error: 'That dvea:// link has no ?url= parameter to navigate to.' };
        }
        target = inner;
      }

      // A bare hostname isn't a valid absolute URL, so Chromium refuses it outright. Default the
      // scheme like a browser address bar would, so the demo does the obvious thing.
      if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        target = 'https://' + target;
      }

      openUntrustedNavigationWindow(target);
      return { ok: true, target };
    } catch (err) {
      console.error('simulate-deeplink-window failed:', err);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // Simulate deep link that reads a file path (vulnerable: no validation)
  ipcMain.handle('simulate-deeplink-open', async (event, requestedPath) => {
    try {
      const p = requestedPath;
      const content = await fs.promises.readFile(p, 'utf8');
      return { content };
    } catch (err) {
      return { error: 'Read failed: ' + err.message };
    }
  });

  // Receive captured credentials from any renderer (the fake-login window) and
  // forward them to the module page (mainWindow) so the demo's attacker view can
  // display harvested credentials separately from the victim-facing window.
  ipcMain.on('captured-credentials', (event, data) => {
    try {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('captured-credentials', data);
      }
    } catch (err) {
      console.error('forwarding captured credentials failed:', err);
    }
  });

  // Challenge 3 — Owned: nodeIntegration: true, contextIsolation: false, sandbox: false — the
  // renderer itself has full Node.js access. No bridge to find, no main-process channel to
  // reach through: injected script calls require() directly, in this window. contextIsolation
  // and sandbox both have to be off for nodeIntegration to actually reach the page (a
  // sandboxed renderer never gets Node integration regardless of this flag, and
  // contextIsolation:true would keep it in a separate world even if it did) — this is the
  // classic, most-warned-against Electron misconfiguration, and the deliberate point of this
  // window: no other setting matters once this one is wrong.
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

    // This window's config is dangerous specifically to whatever it loads — nodeIntegration:
    // true has to travel with the page, not the window. Block any navigation away from the
    // lab page (a link click, `location.href = ...`, even from injected script) so that
    // config can never carry over to another app page loaded into this same window. The page
    // itself has no navigation UI either (see xss-rce-direct.html); the user returns by
    // closing the window.
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });

    // Plant a host file this window's own webPreferences would normally keep unreachable —
    // reachable only because nodeIntegration:true hands the renderer real require('fs')
    // access. Same convention as Challenge 2's secret file.
    try {
      fs.writeFileSync(RCE_SECRET_PATH, RCE_HOST_FLAG + '\n');
    } catch (err) {}

    // Ground truth for Tasks 1-2, computed independently by main (not via the renderer's own
    // Node access) so the page can confirm a payload's output is genuinely real Node/OS
    // access, not a fabricated string.
    let realWhoami = '';
    try {
      realWhoami = execSync('id').toString().trim();
    } catch (err) {}

    // Same config push as Challenge 1/2: read this window's real effective webPreferences
    // from the main process (getLastWebPreferences() — the same data the Config Inspector
    // shows) and write it into the page via executeJavaScript, alongside the ground-truth
    // values above.
    win.webContents.on('did-finish-load', () => {
      try {
        const entry = observability.config.windows && observability.config.windows[win.id];
        const effective = (entry && entry.effective) || {};
        const cfg = {
          sandbox: !!effective.sandbox,
          contextIsolation: !!effective.contextIsolation,
          nodeIntegration: !!effective.nodeIntegration,
        };
        const groundTruth = {
          nodeVersion: process.versions.node,
          whoami: realWhoami,
        };
        win.webContents.executeJavaScript(
          `window.__dveaWindowConfig = ${JSON.stringify(cfg)}; window.__dveaGroundTruth = ${JSON.stringify(
            groundTruth
          )}; window.dispatchEvent(new Event('dvea-config-ready'));`
        );
      } catch (err) {}
    });
  }
  ipcMain.on('open-xss-owned', openXSSOwnedWindow);

  // Challenge 2 — Bridged: the SAME hardened core as Challenge 1 (sandbox, contextIsolation,
  // no nodeIntegration) — the only deviation is a preload that exposes one privileged
  // function via contextBridge. That single bridge is the entire vulnerability; everything
  // else about this window's config is correct.
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

    // This window's preload exposes a real command-execution bridge — navigating within it to
    // another app page (e.g. back to the hub) would carry that same preload/webPreferences to
    // whatever loads next, silently handing it the bridge too. Block any navigation away from
    // the lab page; the page itself has no navigation UI either (see xss-system-api.html), so
    // the user returns by closing the window.
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });

    // Plant a genuine OS-level secret this challenge's Task 3 must retrieve via a real shell
    // command run through the bridge — proof the bridge actually reaches the OS, not a
    // canned response. (Fixed /tmp path: DVEA only ships a Linux .deb, matching the
    // insecure-auto-update module's own /tmp sentinel-file convention.)
    try {
      fs.writeFileSync(BRIDGE_SECRET_PATH, BRIDGE_OS_FLAG + '\n');
    } catch (err) {}

    // Same config push as Challenge 1: read this window's real effective webPreferences from
    // the main process (getLastWebPreferences() — the same data the Config Inspector shows)
    // and write it into the page via executeJavaScript. One-way data write, not a
    // contextBridge exposure — doesn't touch the privileged-bridge badge below.
    win.webContents.on('did-finish-load', () => {
      try {
        const entry = observability.config.windows && observability.config.windows[win.id];
        const effective = (entry && entry.effective) || {};
        const cfg = {
          sandbox: !!effective.sandbox,
          contextIsolation: !!effective.contextIsolation,
          nodeIntegration: !!effective.nodeIntegration,
        };
        win.webContents.executeJavaScript(
          `window.__dveaWindowConfig = ${JSON.stringify(cfg)}; window.dispatchEvent(new Event('dvea-config-ready'));`
        );
      } catch (err) {}
    });
  }
  ipcMain.on('open-xss-bridged', openXSSBridgedWindow);

  // The over-eager bridge's main-process side: runs whatever string the renderer sends,
  // completely unvalidated — the deliberate vulnerability this challenge demonstrates
  // (cf. CVE-2020-25019's shape: a contextBridge-exposed command runner reachable from XSS).
  // Every successful call echoes BRIDGE_CALL_FLAG so a script can prove the round trip
  // actually happened, not just that it attempted one.
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

  // Challenge 1 — Contained: a genuinely hardened window (sandbox, contextIsolation,
  // no nodeIntegration, no privileged preload bridge) so the renderer really is walled
  // off from Node/the OS — the "try to escape" task depends on this being real, not
  // just badge text.
  function openXSSContainedWindow() {
    const win = new Window({
      file: path.join('src/renderer/pages', 'xss-no-priv.html'),
      webPreferences: {
        preload: path.join(__dirname, 'preload-xss-contained.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // This is a dedicated window, not a hub page — it should never navigate to another app
    // page (that would carry this window's own webPreferences/preload to whatever loads
    // next). Block any navigation away from the lab page; it has no navigation UI either (see
    // xss-no-priv.html), so the user returns by closing the window.
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });

    // The lab's config badges can't read window.process in this main world (that's the
    // whole point of contextIsolation: true — see xss-no-priv.js). So push this window's
    // real effective webPreferences — the same getLastWebPreferences()-derived data the
    // Config Inspector shows (observability.js) — directly into the page via
    // executeJavaScript once it has loaded. This is a one-way data write, not a
    // contextBridge exposure: it adds no callable API to this world, so the
    // zero-exposure preload (and the "Privileged bridge" badge) stay exactly that.
    win.webContents.on('did-finish-load', () => {
      try {
        const entry = observability.config.windows && observability.config.windows[win.id];
        const effective = (entry && entry.effective) || {};
        const cfg = {
          sandbox: !!effective.sandbox,
          contextIsolation: !!effective.contextIsolation,
          nodeIntegration: !!effective.nodeIntegration,
        };
        win.webContents.executeJavaScript(
          `window.__dveaWindowConfig = ${JSON.stringify(cfg)}; window.dispatchEvent(new Event('dvea-config-ready'));`
        );
      } catch (err) {}
    });
  }
  ipcMain.on('open-xss-contained', openXSSContainedWindow);

  ipcMain.on('open-analytics', (event, name) => {
    const analyticsWindow = new BrowserWindow({
      width: 768,
      height: 1024,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-analytics.js'),
      },
    });
    analyticsWindow.loadFile(path.join('src/renderer/pages', 'analytics.html'));
    analyticsWindow.webContents.once('did-finish-load', () => {
      analyticsWindow.webContents.send('analytics-set-name', name);
    });
   // analyticsWindow.webContents.openDevTools();
    analyticsWindow.once('ready-to-show', () => analyticsWindow.show());
  });

  // Create a dedicated observability panel window (locked down).
  const panelWindow = new BrowserWindow({
    width: 700,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-panel.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  panelWindow.loadFile(path.join('src/renderer/pages', 'panel.html'));
  panelWindow.once('ready-to-show', () => panelWindow.show());
  panelWindow.webContents.once('did-finish-load', () => {
    observability.setPanelWindow(panelWindow);
  });
  panelWindow.on('closed', () => observability.clearPanelWindow());

  // Register all BrowserWindows globally so we don't miss windows created
  // outside the Window helper. Read effective prefs and set active on focus.
  app.on('browser-window-created', (e, win) => {
    try {
      // Try to use lastWebPreferences as a best-effort declared fallback.
      const declared = (win && win.webContents && win.webContents.getLastWebPreferences && win.webContents.getLastWebPreferences()) || {};
      observability.registerWindow(win, declared);
      // Wrap this window's webContents.send to capture M→R traffic
      try {
        const origSend = win.webContents.send.bind(win.webContents);
        win.webContents.send = function (channel, ...args) {
          try {
            if (typeof channel === 'string' && (channel.startsWith('__dvea_monitor__') || channel === 'ipc-monitor-preload')) {
              return origSend(channel, ...args);
            }
            const redact = !!(observability.config && observability.config.ipcRedact);
            const serialized = observability.serializeArgs(args, redact);
            observability.pushIpcLog({
              ts: Date.now(),
              direction: 'M→R',
              kind: 'send',
              channel,
              args: serialized,
              senderId: win.id,
              frameUrl: win.webContents && win.webContents.getURL ? win.webContents.getURL() : null,
            });
          } catch (err) {}
          return origSend(channel, ...args);
        };
      } catch (err) {}
      // Re-read on navigation/load events
      try {
        win.webContents.on('did-finish-load', () => observability.refreshWindow(win));
        win.webContents.on('did-navigate', () => observability.refreshWindow(win));
        win.webContents.on('did-navigate-in-page', () => observability.refreshWindow(win));
      } catch (err) {}
    } catch (err) {}
  });

  // Track focused window
  app.on('browser-window-focus', (e, win) => {
    try {
      if (win && win.id) observability.setActiveWindow(win.id);
    } catch (err) {}
  });

  // On startup, set active window to focused if any
  try {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) observability.setActiveWindow(focused.id);
  } catch (err) {}

  ipcMain.handle('get-token', () => {
    // No sender validation — any page in the analytics window can call this
    return 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZHZlYS11c2VyLTAwMSIsInJvbGUiOiJhZG1pbiIsInNlc3Npb24iOiJhYmNkZWZnaGlqIn0.DVEA_DEMO_DO_NOT_USE';
  });

  // Receive corroboration messages from renderer preloads.
  ipcMain.on('preload-corroboration', (event, data) => {
    try {
      const wcId = event.sender.id;
      observability.handlePreloadCorroboration(wcId, data || {});
    } catch (err) {}
  });

  // Analytics renderer notified it injected name/meta; refresh that window so meta CSP is captured.
  ipcMain.on('analytics-injected', (event) => {
    try {
      const wc = event.sender; // webContents
      const win = BrowserWindow.fromWebContents(wc);
      if (win) observability.refreshWindow(win);
    } catch (err) {}
  });

  // Receive logs from preloads wrapping ipcRenderer.invoke/send
  ipcMain.on('ipc-monitor-preload', (event, payload) => {
    try {
      // Preload plumbing messages are not authoritative (they mirror traffic).
      // Ignore these to avoid duplicate entries — prefer ipcMain.handle/on capture.
      return;
    } catch (err) {}
  });

  // Publish build-time fuse config (labelled) into the store.
  const BUILD_FUSES = {
    // example fuses; replace with real build-time declarations as needed
    disableNodeIntegrationByDefault: true,
    enforceContextIsolation: true,
  };
  observability.updateConfig({ fuses: BUILD_FUSES, fuses_label: 'build-time declared' });

  // Demo ticker removed. (Was a throwaway visual test; deleted per request.)

  // Legacy open-url handler removed in favor of unified `handleDeepLink` above.
}

ipcMain.handle('save-file', async (event, data) => {
  await fs.promises.writeFile(data.path, data.content);
});

// Deep links depend on this. Without the single-instance lock, launching a dvea:// link while
// DVEA is already open starts a SECOND, independent app process rather than signalling the
// running one — 'second-instance' never fires, so the link is dropped and the user just gets a
// duplicate window. Taking the lock makes the OS route the link to the instance that is already
// up; the redundant process quits immediately without ever creating a window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('ready', main);
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
// Ensure demo servers and child processes are stopped when the app is quitting
app.on('before-quit', async (event) => {
  try {
    if (insecureAutoUpdate && insecureAutoUpdate.stopServer) {
      try {
        await insecureAutoUpdate.stopServer();
      } catch (err) {}
    }
  } catch (err) {}
});
try {
  require('electron-reloader')(module);
} catch {}
