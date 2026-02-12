
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipc', {
  onRedirect: (cb) => ipcRenderer.on('deeplink-redirect', cb),
});

contextBridge.exposeInMainWorld('api', {
  openSystemXSS: () => ipcRenderer.send('open-system-xss'),
  openXSSRCE: () => ipcRenderer.send('open-xss-rce-direct'),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});

contextBridge.exposeInMainWorld('systemapi', {
  executeCode: (code) => ipcRenderer.invoke('xss-rce-direct', code),
});
