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
  console.log(app.getPath('userData'));
  //Setting deep link to add task to the list
  app.setAsDefaultProtocolClient('dvea');

  app.on('open-url', (event, deepLink) => {
    event.preventDefault();

    // Extract the add parameter from the deep link
    const value = decodeURI(deepLink.split('add=')[1]);
    const updatedTodos = todosData.addTodo(value).todos;
    // dvea://task?add=text
    mainWindow.send('todos', updatedTodos);
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
