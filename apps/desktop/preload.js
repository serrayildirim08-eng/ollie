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
  voice: {
    // Sprint 4 · E2 — bridge for future native SFSpeech path. Current
    // path is renderer-side Web Speech; this exists so voice-capture.ts
    // can detect "electron" platform and route appropriately.
    startDictation: (_cb) => ipcRenderer.invoke('ollie:voice:startDictation'),
    stopDictation: () => ipcRenderer.invoke('ollie:voice:stopDictation'),
  },
  hotkey: {
    // Sprint 4 · E3 — cmd+ctrl+space → main process focuses window +
    // emits this event. Renderer subscribes to trigger MicButton.
    onHotkey: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('ollie:hotkey', handler);
      return () => ipcRenderer.removeListener('ollie:hotkey', handler);
    },
  },
  ai: {
    // Apple Intelligence bridge — the macOS desktop equivalent of the iOS
    // `OllieAI` Capacitor plugin. The main process spawns a native Swift
    // CLI (`ollie-ai-helper`) that talks to Apple's on-device
    // FoundationModels framework. lib/ollie-ai.ts detects this surface and
    // routes through it; absent on web / Capacitor builds, where it falls
    // back to the Capacitor plugin or the keyword router.
    //   available()            → { available, reason? }
    //   route({text,modules})  → { routes: [{module,text,confidence}] } | null
    //   extract({text,kind})   → grocery/finance shape | null
    available: () => ipcRenderer.invoke('ollie:ai:available'),
    route: (options) => ipcRenderer.invoke('ollie:ai:route', options),
    extract: (options) => ipcRenderer.invoke('ollie:ai:extract', options),
  },
});
