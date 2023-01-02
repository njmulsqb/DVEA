"use strict";
// This is the main process file, main process's responsibility is to create/manage application windows using BrowserWindow module
//const connection = require('../db');
const path = require("path");
const { app, ipcMain } = require("electron");

const Window = require("./Window");
const DataStore = require("./DataStore");

// create a new todo store name "Todos Main"
const todosData = new DataStore({ name: "Todos Main" });

function main() {
  // todo list window
  let mainWindow = new Window({
    file: path.join("src/renderer", "index.html"),
  });
console.log(app.getPath('userData'))
  //Setting deep link to add task to the list
  app.setAsDefaultProtocolClient("dvea");

  app.on("open-url", (event, deepLink) => {
    event.preventDefault();

    // Extract the add parameter from the deep link
    const value = decodeURI(deepLink.split("add=")[1]);
    const updatedTodos = todosData.addTodo(value).todos;
// dvea://task?add=text
    mainWindow.send("todos", updatedTodos);
  });

  // add todo window
  let addTodoWin;

  // TODO: put these events into their own file

  // initialize with todos
  mainWindow.once("show", () => {
    mainWindow.webContents.send("todos", todosData.todos);
  });

  // create add todo window
  ipcMain.on("add-todo-window", () => {
    // if addTodoWin does not already exist
    if (!addTodoWin) {
      // create a new add todo window
      addTodoWin = new Window({
        file: path.join("src/renderer", "add.html"),
        width: 400,
        height: 400,
        // close with the main window
        parent: mainWindow,
      });

      // cleanup
      addTodoWin.on("closed", () => {
        addTodoWin = null;
      });
    }
  });

  // add-todo from add todo window
  ipcMain.on("add-todo", (event, todo) => {
    const updatedTodos = todosData.addTodo(todo).todos;

    mainWindow.send("todos", updatedTodos);
  });

  // delete-todo from todo list window
  ipcMain.on("delete-todo", (event, todo) => {
    const updatedTodos = todosData.deleteTodo(todo).todos;

    mainWindow.send("todos", updatedTodos);
  });
}

// const createWindow = () => {
//   const win = new BrowserWindow({
//     width: 800,
//     height: 600,
//     webPreferences:{
//         nodeIntegration: true,
//         //preload: 'preload.js' //This code is executed in a renderer process before its web contents are loaded and has access to the NodeJS APIs.
//       }
//   }
//  );
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

//   win.loadFile('src/index.html');
// };

// app.whenReady().then(() => {
//   createWindow();

//   app.on('activate', () => {
//     if (BrowserWindow.getAllWindows().length === 0) {
//       createWindow();
//     }
//   });
// });
app.on("ready", main);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
//Reload the app whenever source is modified
try {
  require("electron-reloader")(module);
} catch {}
