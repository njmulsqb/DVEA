const { contextBridge, ipcRenderer } = require('electron');

// Expose a receive-only monitor API to the panel renderer.
contextBridge.exposeInMainWorld('monitor', {
  onUpdate: (cb) => {
    // callback receives a single payload argument
    ipcRenderer.on('__dvea_monitor__', (_, payload) => cb(payload));
  },
});
