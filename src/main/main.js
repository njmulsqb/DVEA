'use strict';
require('dotenv').config();
const path = require('path');
const { app, ipcMain } = require('electron');
if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(
    path.join(__dirname, '..'), // watch src/
    {
      hardResetMethod: 'exit',
    },
  );
}

const Window = require('../main/windows/Window');
const { sandboxed, contextIsolated } = require('process');

function main() {
  let mainWindow = new Window({
    file: path.join('src/renderer/pages', 'index.html'),
  });

  // Register custom protocol for deep links
  if (!app.isDefaultProtocolClient('dvea')) {
    app.setAsDefaultProtocolClient('dvea');
  }

  // ---- HANDLE DEEP LINKS (macOS / Linux) ----
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // ---- HANDLE DEEP LINKS (Windows) ----
  app.on('second-instance', (event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith('dvea://'));
    if (deepLink) handleDeepLink(deepLink);
  });

  function handleDeepLink(url) {
    try {
      const parsed = new URL(url);
      const redirect = parsed.searchParams.get('redirect');
      if (redirect && mainWindow) {
        // 🚨 INTENTIONAL VULNERABILITY
        // Load vuln-redirect.html, then send redirect message
        mainWindow.loadFile(path.join('src/renderer/pages', 'vuln-redirect.html')).then(() => {
          mainWindow.webContents.send('deeplink-redirect', redirect);
        });
      }
    } catch (err) {
      console.error('Invalid deep link:', err);
    }
  }

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

  app.on('open-url', (event, deepLink) => {
    event.preventDefault();
    if (deepLink.startsWith('dvea://redirect?target=')) {
      Window.create('vuln-redirect.html');
    }
  });
}
app.on('ready', main);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
try {
  require('electron-reloader')(module);
} catch {}


