try {
  console.log('Preload system API starting...');

  const { contextBridge } = require('electron');
  const { exec } = require('child_process');

  console.log('Modules loaded successfully');

  contextBridge.exposeInMainWorld('systemAPI', {
    runCommand: (cmd) => {
      console.log('runCommand called');
      return exec(cmd);
    },
  });

  console.log('systemAPI exposed successfully');
} catch (err) {
  console.error('PRELOAD ERROR:', err);
}
