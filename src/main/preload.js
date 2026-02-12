const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipc', {
  onRedirect: (cb) => ipcRenderer.on('deeplink-redirect', cb),
});

contextBridge.exposeInMainWorld('api', {
  openSystemXSS: () => ipcRenderer.send('open-system-xss'),
});
