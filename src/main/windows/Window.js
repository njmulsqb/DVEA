const { BrowserWindow } = require('electron');
const path = require('path');

const defaultProps = {
  width: 768,
  height: 1024,
  show: false,

  webPreferences: {
    preload: path.join(__dirname, '../preload.js'),
  },
};

class Window extends BrowserWindow {
  constructor({ file, webPreferences = {}, ...windowSettings }) {
    super({
      ...defaultProps,
      ...windowSettings,
      webPreferences: {
        ...defaultProps.webPreferences,
        ...webPreferences, // 🔥 deep merge here
      },
    });

    this.loadFile(file);
    this.webContents.openDevTools();
    this.once('ready-to-show', () => {
      this.show();
    });
  }
}

module.exports = Window;
