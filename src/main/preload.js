const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipc', {
  onRedirect: (cb) => ipcRenderer.on('deeplink-redirect', cb),
  onCaptured: (cb) => ipcRenderer.on('captured-credentials', cb),
});

contextBridge.exposeInMainWorld('api', {
  openXSSContained: () => ipcRenderer.send('open-xss-contained'),
  openXSSBridged: () => ipcRenderer.send('open-xss-bridged'),
  openXSSOwned: () => ipcRenderer.send('open-xss-owned'),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),
  initFileWrite: () => ipcRenderer.invoke('filewrite-init'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openAnalytics: (name) => ipcRenderer.send('open-analytics', name),
  submitStoredHtmliFlag: (token) => ipcRenderer.invoke('submit-stored-htmli-flag', token),
  startAutoUpdateServer: () => ipcRenderer.invoke('start-auto-update-server'),
  stopAutoUpdateServer: () => ipcRenderer.invoke('stop-auto-update-server'),
  checkForUpdate: (opts) => ipcRenderer.invoke('check-for-update', opts),
  resetAutoUpdate: () => ipcRenderer.invoke('reset-auto-update'),
  simulateDeepLinkWindow: (target) => ipcRenderer.invoke('simulate-deeplink-window', target),
  sendCapturedCredentials: (data) => ipcRenderer.send('captured-credentials', data),
  simulateDeepLinkOpen: (path) => ipcRenderer.invoke('simulate-deeplink-open', path),
  onDeepLinkOpen: (cb) => ipcRenderer.on('deeplink-open', cb),
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
