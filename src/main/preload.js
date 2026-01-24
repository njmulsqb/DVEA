const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoAPI', {
  // actions
  addTodo: (todo) => ipcRenderer.send('add-todo', todo),
  deleteTodo: (todo) => ipcRenderer.send('delete-todo', todo),
  openAddWindow: () => ipcRenderer.send('add-todo-window'),

  // listeners
  onTodos: (callback) => ipcRenderer.on('todos', callback),
});
