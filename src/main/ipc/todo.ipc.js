const { ipcMain } = require('electron');

function registerTodoIPC(deps) {
  const { todosData, mainWindow, createAddTodoWindow } = deps;

  ipcMain.on('add-todo', (event, todo) => {
    const updatedTodos = todosData.addTodo(todo).todos;
    mainWindow.send('todos', updatedTodos);
  });

  ipcMain.on('delete-todo', (event, todo) => {
    const updatedTodos = todosData.deleteTodo(todo).todos;
    mainWindow.send('todos', updatedTodos);
  });

  ipcMain.on('add-todo-window', () => {
    createAddTodoWindow();
  });
}

module.exports = { registerTodoIPC };
