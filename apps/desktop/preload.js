'use strict';

// ollie — electron preload
// intentionally minimal. pure web app — no node/fs/ipc surface exposed.
// add native bridges here via contextBridge if ever needed.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ollie', {
  platform: process.platform,
  isElectron: true,
});
