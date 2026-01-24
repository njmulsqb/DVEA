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

  mainWindow.once('show', () => {
    mainWindow.webContents.send('todos', todosData.todos);
  });

  ipcMain.on('add-todo-window', () => {
    if (!addTodoWin) {
      addTodoWin = new Window({
        file: path.join('src/renderer/pages', 'add.html'),
        width: 400,
        height: 400,
        parent: mainWindow,
      });

      addTodoWin.on('closed', () => {
        addTodoWin = null;
      });
    }
  });

  ipcMain.on('add-todo', (event, todo) => {
    const updatedTodos = todosData.addTodo(todo).todos;

    mainWindow.send('todos', updatedTodos);
  });

  ipcMain.on('delete-todo', (event, todo) => {
    const updatedTodos = todosData.deleteTodo(todo).todos;

    mainWindow.send('todos', updatedTodos);
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
