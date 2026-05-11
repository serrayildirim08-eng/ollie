'use strict';

// ollie — electron preload
// intentionally minimal. pure web app — no node/fs/ipc surface exposed.
// NL3 adds a notify bridge so @ollie/notifications/backends/electron
// can route through the main process for native macOS notifications.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ollie', {
  platform: process.platform,
  isElectron: true,
  notify: {
    notify: (spec) => ipcRenderer.invoke('ollie:notify:notify', spec),
    schedule: (spec, fireAt) => ipcRenderer.invoke('ollie:notify:schedule', spec, fireAt),
    cancel: (key) => ipcRenderer.invoke('ollie:notify:cancel', key),
    requestPermission: () => ipcRenderer.invoke('ollie:notify:requestPermission'),
  },
});
