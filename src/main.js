const { app, BrowserWindow } = require('electron');
const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences:{
        nodeIntegration: true,
      }
  }
  );
  // // Add an input field and a button to the window.
  // win.webContents.on('did-finish-load', () => {
  //   win.webContents.executeJavaScript(`
  //     document.body.innerHTML = \`
  //       <input id="file-name" type="text" placeholder="Enter file name">
  //       <button id="read-file">Read file</button>
  //     \`
  //   `)
  // })

  // // Handle the button click event.
  // win.webContents.on('dom-ready', () => {
  //   win.webContents.executeJavaScript(`
  //     document.getElementById('read-file').addEventListener('click', () => {
  //       const fileName = document.getElementById('file-name').value
  //       // Read the file and display its contents in an alert.
  //       fs.readFile(fileName, 'utf8', (err, data) => {
  //         if (err) {
  //           alert(err)
  //           return
  //         }
  //         alert(data)
  //       })
  //     })
  //   `)
  // })

  win.loadFile('src/index.html');
};



app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
//Reload the app whenever source is modified
try {
	require('electron-reloader')(module);
} catch {}