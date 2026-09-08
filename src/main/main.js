'use strict';
require('dotenv').config();
const path = require('path');
const { app, ipcMain, BrowserWindow } = require('electron');
if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(path.join(__dirname, '..'), {
    hardResetMethod: 'exit',
  });
}
const { shell } = require('electron');
const fs = require('fs');

const Window = require('../main/windows/Window');
const { sandboxed, contextIsolated } = require('process');
const observability = require('./observability');
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

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith('dvea://'));
    if (deepLink) handleDeepLink(deepLink);
  });

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
    // Vulnerable navigation: main process directly loads the attacker URL into a new window
    win.loadURL(target);
    win.once('ready-to-show', () => win.show());
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
  ipcMain.handle('simulate-deeplink-window', (event, target) => {
    try {
      if (!target) return;
      openUntrustedNavigationWindow(target);
    } catch (err) {
      console.error('simulate-deeplink-window failed:', err);
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

  ipcMain.handle('xss-rce-direct', async (event, code) => {
    try {
      const result = eval(code);
      return String(result);
    } catch (err) {
      return 'Error: ' + err.message;
    }
  });

  function openSystemXSSWindow() {
    new Window({
      file: path.join('src/renderer/pages', 'xss-system-api.html'),
      webPreferences: {
        preload: path.join(__dirname, 'preload-systemapi.js'),
        sandbox: false,
      },
    });
  }
  ipcMain.on('open-system-xss', openSystemXSSWindow);

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

app.on('ready', main);
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
