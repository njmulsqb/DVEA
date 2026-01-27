const { ipcMain } = require('electron');

function registerTodoIPC(deps) {
  const { todosData, mainWindow, createAddTodoWindow } = deps;

  ipcMain.on('add-todo', (event, text) => {
    const updatedTodos = todosData.addTodo(text).todos;
    mainWindow.send('todos', updatedTodos);
  });

  ipcMain.on('delete-todo', (event, id) => {
    const updatedTodos = todosData.deleteTodo(id).todos;
    mainWindow.send('todos', updatedTodos);
  });

  ipcMain.on('toggle-todo', (event, id) => {
    const updatedTodos = todosData.toggleTodo(id).todos;
    mainWindow.send('todos', updatedTodos);
  });

  ipcMain.on('edit-todo', (event, { id, text }) => {
    const updatedTodos = todosData.editTodo(id, text).todos;
    mainWindow.send('todos', updatedTodos);
  });

  ipcMain.on('add-todo-window', () => {
    createAddTodoWindow();
  });
}

module.exports = { registerTodoIPC };
