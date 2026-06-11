const { contextBridge, ipcRenderer } = require('electron');

// Expose a clean Electron API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (cmd, args) => ipcRenderer.invoke(cmd, args)
});
