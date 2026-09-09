const { ipcRenderer } = require('electron');

// Deliberately exposes nothing via contextBridge — this window has no privileged API
// surface at all. Only self-reports isolation state for the Config Inspector, same as
// every other preload.
try {
  ipcRenderer.send('preload-corroboration', {
    contextIsolated: !!process.contextIsolated,
    sandboxed: !!process.sandboxed,
  });
} catch (err) {}
