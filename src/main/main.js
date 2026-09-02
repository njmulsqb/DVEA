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

  function handleDeepLink(url) {
    try {
      const parsed = new URL(url);
      const redirect = parsed.searchParams.get('redirect');
      if (redirect && mainWindow) {
        mainWindow.loadFile(path.join('src/renderer/pages', 'vuln-redirect.html')).then(() => {
          mainWindow.webContents.send('deeplink-redirect', redirect);
        });
      }
    } catch (err) {
      console.error('Invalid deep link:', err);
    }
  }

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

  app.on('open-url', (event, deepLink) => {
    event.preventDefault();
    if (deepLink.startsWith('dvea://redirect?target=')) {
      Window.create('vuln-redirect.html');
    }
  });
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
