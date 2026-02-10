
const { contextBridge, ipcRenderer } = require('electron');



contextBridge.exposeInMainWorld('todoAPI', {
  addTodo: (text) => ipcRenderer.send('add-todo', text),
  deleteTodo: (id) => ipcRenderer.send('delete-todo', id),
  toggleTodo: (id) => ipcRenderer.send('toggle-todo', id),
  editTodo: (id, text) => ipcRenderer.send('edit-todo', { id, text }),
  openAddWindow: () => ipcRenderer.send('add-todo-window'),
  onTodos: (callback) => ipcRenderer.on('todos', callback),
});


contextBridge.exposeInMainWorld('ipc', {
  onRedirect: (cb) => ipcRenderer.on('deeplink-redirect', cb),
});
