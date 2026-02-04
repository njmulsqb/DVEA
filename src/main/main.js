'use strict';
require('dotenv').config();
const path = require('path');
const { app, ipcMain } = require('electron');
const { registerTodoIPC } = require('./ipc/todo.ipc');

if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(
    path.join(__dirname, '..'), // watch src/
    {
      hardResetMethod: 'exit',
    },
  );
}

const Window = require('../main/windows/Window');
const DataStore = require('../main/datastore/DataStore');

const todosData = new DataStore({ name: 'Todos Main' });

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
    const deepLink = argv.find(arg => arg.startsWith('dvea://'));
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

  // Required for Windows deep links
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  }

  app.on('open-url', (event, deepLink) => {
    event.preventDefault();
    if (deepLink.startsWith('dvea://redirect?target=')) {
      // Just open vuln-redirect.html, let renderer handle deep link
      Window.create('vuln-redirect.html');
    } else if (deepLink.includes('add=')) {
      // Existing todo deep link
      const value = decodeURI(deepLink.split('add=')[1]);
      const updatedTodos = todosData.addTodo(value).todos;
      mainWindow.send('todos', updatedTodos);
    }
  });

  let addTodoWin;

  function openAddTodoWindow() {
    if (addTodoWin) {
      addTodoWin.focus();
      return;
    }
    addTodoWin = new Window({
      file: path.join('src/renderer/pages', 'add.html'),
      width: 400,
      height: 300,
      parent: mainWindow,
      modal: true,
    });
    addTodoWin.on('closed', () => {
      addTodoWin = null;
    });
  }

  mainWindow.once('show', () => {
    mainWindow.webContents.send('todos', todosData.todos);
  });
  registerTodoIPC({
    todosData,
    mainWindow,
    createAddTodoWindow: openAddTodoWindow,
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
