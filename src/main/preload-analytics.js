const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('analyticsAPI', {
  onName: (cb) => ipcRenderer.on('analytics-set-name', cb),
  getToken: () => ipcRenderer.invoke('get-token'),
});
