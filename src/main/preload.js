const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipc', {
  onRedirect: (cb) => ipcRenderer.on('deeplink-redirect', cb),
});

contextBridge.exposeInMainWorld('api', {
  openSystemXSS: () => ipcRenderer.send('open-system-xss'),
  openXSSRCE: () => ipcRenderer.send('open-xss-rce-direct'),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openAnalytics: (name) => ipcRenderer.send('open-analytics', name),
});

contextBridge.exposeInMainWorld('systemapi', {
  executeCode: (code) => ipcRenderer.invoke('xss-rce-direct', code),
});

// Send preload corroboration back to main so observability can record renderer-side values.
try {
  ipcRenderer.send('preload-corroboration', {
    contextIsolated: !!process.contextIsolated,
    sandboxed: !!process.sandboxed,
  });
} catch (err) {}

// Wrap ipcRenderer.send/invoke to notify main of outbound IPC from renderer.
try {
  const origSend = ipcRenderer.send.bind(ipcRenderer);
  const origInvoke = ipcRenderer.invoke.bind(ipcRenderer);

  ipcRenderer.send = function (channel, ...args) {
    try {
      if (typeof channel === 'string' && !channel.startsWith('__dvea_monitor__') && channel !== 'ipc-monitor-preload') {
        // send a lightweight log to main; main will ignore this channel when logging
        origSend('ipc-monitor-preload', { kind: 'send', channel, args });
      }
    } catch (err) {}
    return origSend(channel, ...args);
  };

  ipcRenderer.invoke = function (channel, ...args) {
    try {
      if (typeof channel === 'string' && !channel.startsWith('__dvea_monitor__') && channel !== 'ipc-monitor-preload') {
        origSend('ipc-monitor-preload', { kind: 'invoke', channel, args });
      }
    } catch (err) {}
    return origInvoke(channel, ...args);
  };
} catch (err) {}
