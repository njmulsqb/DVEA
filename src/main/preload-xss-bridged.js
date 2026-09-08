const { contextBridge, ipcRenderer } = require('electron');

// The entire vulnerability lives in this one exposure. Everything else about this window
// (sandbox: true, contextIsolation: true, nodeIntegration: false — see
// openXSSBridgedWindow() in src/main/main.js) is correctly hardened, same as Challenge 1's
// preload. The mistake is narrow but total: this single function is a real command runner,
// reachable by any script executing on the page, XSS included.
contextBridge.exposeInMainWorld('systemAPI', {
  runCommand: (cmd) => ipcRenderer.invoke('bridge-run-command', cmd),
});

// Self-report isolation state for the Config Inspector, same as every other preload.
try {
  ipcRenderer.send('preload-corroboration', {
    contextIsolated: !!process.contextIsolated,
    sandboxed: !!process.sandboxed,
  });
} catch (err) {}
