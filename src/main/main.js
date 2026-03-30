'use strict';
require('dotenv').config();
const path = require('path');
const { app, ipcMain } = require('electron');
if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(
    path.join(__dirname, '..'),
    {
      hardResetMethod: 'exit',
    },
  );
}
      const { shell } = require('electron');

const Window = require('../main/windows/Window');
const { sandboxed, contextIsolated } = require('process');

function main() {
  let mainWindow = new Window({
    file: path.join('src/renderer/pages', 'index.html'),
  });

  const fs = require('fs');



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


