const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipc', {
  onRedirect: (cb) => ipcRenderer.on('deeplink-redirect', cb),
});
