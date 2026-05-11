'use strict';

// ollie — electron main process
// loads apps/web/dist/index.html in prod, localhost:5173 in dev.
// single-instance lock, macOS menu, auto-updater in prod.

const { app, BrowserWindow, Menu, Notification, ipcMain, shell } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

// ----- single-instance lock ---------------------------------------------
let mainWindow = null;
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ----- window factory ---------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    title: 'ollie',
    backgroundColor: '#F2EEE4',
    titleBarStyle: 'default',
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: !isDev, // allow localhost mixed-content in dev
    },
  });

  if (isDev) {
    // Vite dev server — run `pnpm --filter @ollie/web dev` first
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // packaged: web/dist is copied into extraResources
    const distEntry = app.isPackaged
      ? path.join(process.resourcesPath, 'web', 'dist', 'index.html')
      : path.join(__dirname, '..', 'web', 'dist', 'index.html');
    mainWindow.loadFile(distEntry);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') {
      app.dock.show();
      app.focus({ steal: true });
    }
  });

  // belt-and-suspenders: force show after 1.5s
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      console.log('[ollie] window forced visible. bounds:', mainWindow.getBounds());
    }
  }, 1500);

  // external links open in the OS browser, never in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ----- app menu ---------------------------------------------------------
function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: 'ollie',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ----- auto-updater ------------------------------------------------------
function setupAutoUpdater() {
  if (isDev) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('[ollie] electron-updater not available:', err.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => {
    console.warn('[ollie] auto-update error:', err && err.message);
  });
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn('[ollie] update check failed:', err && err.message);
  });
}

// ----- native notifications (NL3) ---------------------------------------
// IPC contract — matches the @ollie/notifications electron backend bridge.
//   window.ollie.notify.notify(spec)         → string id
//   window.ollie.notify.schedule(spec, ts)   → string id  (main-process timer)
//   window.ollie.notify.cancel(dedupe_key)
//   window.ollie.notify.requestPermission()  → 'granted' (macOS shows once)
//
// macOS handles permission via the system on first call. Linux + Windows
// usually allow without prompt. We always return 'granted' here; the
// renderer dispatcher already enforces budget + dedupe.

const __scheduledNotifications = new Map(); // dedupe_key → { timeout, notification }

function buildNativeNotification(spec) {
  const n = new Notification({
    title: String(spec.title || ''),
    body: String(spec.body || ''),
    silent: false,
    // macOS supports actions via reply; we don't expose them yet.
  });
  if (spec.action_url) {
    n.on('click', () => {
      try { shell.openExternal(String(spec.action_url)); }
      catch (err) { console.warn('[notify · electron] click handler failed', err); }
    });
  }
  return n;
}

ipcMain.handle('ollie:notify:notify', (_event, spec) => {
  if (!Notification.isSupported()) return undefined;
  try {
    const n = buildNativeNotification(spec);
    n.show();
    return String(spec.dedupe_key || '');
  } catch (err) {
    console.warn('[notify · electron · ipc] notify failed', err);
    return undefined;
  }
});

ipcMain.handle('ollie:notify:schedule', (_event, spec, fireAt) => {
  if (!Notification.isSupported()) return undefined;
  const key = String(spec.dedupe_key || '');
  if (!key) return undefined;
  const existing = __scheduledNotifications.get(key);
  if (existing) clearTimeout(existing.timeout);
  const delay = Math.max(0, Number(fireAt) - Date.now());
  const timeout = setTimeout(() => {
    __scheduledNotifications.delete(key);
    try {
      const n = buildNativeNotification(spec);
      n.show();
    } catch (err) {
      console.warn('[notify · electron · scheduled fire] failed', err);
    }
  }, delay);
  __scheduledNotifications.set(key, { timeout });
  return key;
});

ipcMain.handle('ollie:notify:cancel', (_event, key) => {
  const rec = __scheduledNotifications.get(String(key));
  if (rec) {
    clearTimeout(rec.timeout);
    __scheduledNotifications.delete(String(key));
  }
});

ipcMain.handle('ollie:notify:requestPermission', () => {
  return Notification.isSupported() ? 'granted' : 'denied';
});

// ----- lifecycle --------------------------------------------------------
if (gotTheLock) {
  app.whenReady().then(() => {
    buildMenu();
    createMainWindow();
    setupAutoUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
