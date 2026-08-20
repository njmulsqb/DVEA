const { contextBridge, ipcRenderer } = require('electron');

// Wrap ipcRenderer before exposing analyticsAPI so bridged invokes are captured.
try {
  const origSend = ipcRenderer.send.bind(ipcRenderer);
  const origInvoke = ipcRenderer.invoke.bind(ipcRenderer);
  ipcRenderer.send = function (channel, ...args) {
    try {
      if (typeof channel === 'string' && !channel.startsWith('__dvea_monitor__') && channel !== 'ipc-monitor-preload') {
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

contextBridge.exposeInMainWorld('analyticsAPI', {
  onName: (cb) => ipcRenderer.on('analytics-set-name', cb),
  getToken: () => ipcRenderer.invoke('get-token'),
  // Called by the analytics renderer after it injects any DOM/meta from the provided name.
  injected: () => ipcRenderer.send('analytics-injected'),
});
