const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('analyticsAPI', {
  onName: (cb) => ipcRenderer.on('analytics-set-name', cb),
  getToken: () => ipcRenderer.invoke('get-token'),
  // Called by the analytics renderer after it injects any DOM/meta from the provided name.
  injected: () => ipcRenderer.send('analytics-injected'),
});
