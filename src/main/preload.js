const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoAPI', {
  // actions
  addTodo: (text) => ipcRenderer.send('add-todo', text),
  deleteTodo: (id) => ipcRenderer.send('delete-todo', id),
  toggleTodo: (id) => ipcRenderer.send('toggle-todo', id),
  editTodo: (id, text) => ipcRenderer.send('edit-todo', { id, text }),
  openAddWindow: () => ipcRenderer.send('add-todo-window'),

  // listeners
  onTodos: (callback) => ipcRenderer.on('todos', callback),
});
