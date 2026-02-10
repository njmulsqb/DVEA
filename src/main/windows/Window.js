const { BrowserWindow } = require('electron');
const path = require('path');

const defaultProps = {
  width: 500,
  height: 800,
  show: false,

  webPreferences: {
    preload: path.join(__dirname, '../preload.js'),
  },
};

class Window extends BrowserWindow {
  constructor({ file, ...windowSettings }) {
    super({ ...defaultProps, ...windowSettings });
    this.loadFile(file);
    // this.webContents.openDevTools() //For opening dev tools on launch
    this.once('ready-to-show', () => {
      this.show();
    });
  }
}

module.exports = Window;
