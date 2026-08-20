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

function main() {
  let mainWindow = new Window({
    file: path.join('src/renderer/pages', 'index.html'),
  });

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
    analyticsWindow.webContents.openDevTools();
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
try {
  require('electron-reloader')(module);
} catch {}
