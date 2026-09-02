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
    openCalculator: () => {
      try {
        const platform = process.platform;
        let cmd;
        if (platform === 'darwin') {
          cmd = 'open -a Calculator';
        } else if (platform === 'linux') {
          // Prefer GNOME calculator on Ubuntu desktops, fall back to xcalc,
          // then xdg-open (opens current dir), and finally create a sentinel file
          // so there's always an observable effect on most systems.
          cmd = 'gnome-calculator 2>/dev/null || xcalc 2>/dev/null || xdg-open . 2>/dev/null || touch /tmp/dvea_rce_sentinel';
        } else {
          cmd = 'echo "platform not supported"';
        }
        console.log('openCalculator executing:', cmd);
        return exec(cmd);
      } catch (err) {
        console.error('openCalculator error:', err);
      }
    },
  });

  console.log('systemAPI exposed successfully');
} catch (err) {
  console.error('PRELOAD ERROR:', err);
}
