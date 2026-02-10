const { BrowserWindow } = require('electron');
const path = require('path');

// default window settings
const defaultProps = {
  width: 500,
  height: 800,
  show: false,

  // update for electron V5+
  webPreferences: {
    preload: path.join(__dirname, '../preload.js'),
  },
};

class Window extends BrowserWindow {
  constructor({ file, ...windowSettings }) {
    // calls new BrowserWindow with these props
    super({ ...defaultProps, ...windowSettings });

    // load the html and open devtools
    this.loadFile(file);
    // this.webContents.openDevTools() //For opening dev tools on launch

    // gracefully show when ready to prevent flickering
    this.once('ready-to-show', () => {
      this.show();
    });
  }
}

module.exports = Window;
