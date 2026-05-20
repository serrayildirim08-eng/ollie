'use strict';

// ollie — electron main process
// loads apps/web/dist/index.html in prod, localhost:5173 in dev.
// single-instance lock, macOS menu, auto-updater in prod.

const { app, BrowserWindow, Menu, Notification, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

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

// ----- voice + wake-word IPC (Sprint 4 · E2 + E3) -----------------------
// Mac doesn't ship a native dictation API as accessible as iOS's SFSpeech,
// so we forward "start dictation" to the renderer which uses the Web Speech
// API (Chromium ships it). The cmd+ctrl+space global shortcut just brings
// the window forward + emits an event the renderer subscribes to.

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

ipcMain.handle('ollie:voice:startDictation', () => {
  // Renderer-side capture lives in voice-capture.ts. Main process here is
  // a hook for future native macOS SFSpeech integration (post-Sprint 5).
  return { ok: true, strategy: 'renderer-web-speech' };
});

ipcMain.handle('ollie:voice:stopDictation', () => ({ ok: true }));

// ----- Apple Intelligence bridge (FoundationModels) ---------------------
// The Electron build loads the web bundle and is NOT Capacitor, so the iOS
// `OllieAI` Capacitor plugin cannot run here. Instead we ship a native
// macOS Swift CLI — `ollie-ai-helper` — that talks to Apple's on-device
// FoundationModels framework (macOS 26 Apple Intelligence).
//
// Protocol: spawn the helper, write one JSON request to its stdin, read
// one JSON response from stdout (spawn-per-call). The helper logic is the
// macOS port of OllieAIPlugin.swift. See native/ollie-ai-helper/.
//
// IPC contract — matches window.ollie.ai in preload.js / lib/ollie-ai.ts:
//   window.ollie.ai.available()             → { available, reason? }
//   window.ollie.ai.route({text,modules})   → { routes: [{module,text,confidence}] } | null
//   window.ollie.ai.extract({text,kind})    → grocery/finance shape | null
//
// Every handler resolves a safe shape on any spawn/parse error — it never
// throws. The renderer (lib/ollie-ai.ts) then degrades to the keyword
// router exactly as it does on web / old iOS.

/**
 * Resolve the absolute path to the `ollie-ai-helper` binary.
 *   - dev      → SwiftPM release-build output under native/ollie-ai-helper
 *   - packaged → copied into the .app's Resources via electron-builder
 *                extraResources (build.extraResources in package.json)
 */
function ollieAiHelperPath() {
  if (isDev) {
    return path.join(
      __dirname,
      'native',
      'ollie-ai-helper',
      '.build',
      'release',
      'ollie-ai-helper',
    );
  }
  return path.join(process.resourcesPath, 'ollie-ai-helper', 'ollie-ai-helper');
}

/**
 * Spawn the helper with one JSON request, return the parsed JSON response.
 * Never rejects — resolves `null` on any spawn / timeout / parse failure so
 * callers can fall back cleanly.
 */
function runOllieAiHelper(request) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(ollieAiHelperPath(), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      console.warn('[ollie:ai] spawn failed:', err && err.message);
      resolve(null);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // FoundationModels generation is fast on M-series but guard anyway.
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_e) { /* noop */ }
      console.warn('[ollie:ai] helper timed out');
      finish(null);
    }, 30000);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      console.warn('[ollie:ai] helper process error:', err && err.message);
      finish(null);
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (stderr.trim()) console.warn('[ollie:ai] helper stderr:', stderr.trim());
      try {
        const parsed = JSON.parse(stdout.trim());
        finish(parsed);
      } catch (err) {
        console.warn('[ollie:ai] helper output parse failed:', err && err.message, '· raw:', stdout.slice(0, 200));
        finish(null);
      }
    });

    try {
      child.stdin.write(JSON.stringify(request));
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      console.warn('[ollie:ai] helper stdin write failed:', err && err.message);
      try { child.kill('SIGKILL'); } catch (_e) { /* noop */ }
      finish(null);
    }
  });
}

ipcMain.handle('ollie:ai:available', async () => {
  const res = await runOllieAiHelper({ cmd: 'available' });
  if (!res || typeof res.available !== 'boolean') {
    return { available: false, reason: 'helper-unavailable' };
  }
  return { available: res.available, reason: res.reason };
});

ipcMain.handle('ollie:ai:route', async (_event, options) => {
  const text = options && typeof options.text === 'string' ? options.text : '';
  const modules =
    options && Array.isArray(options.modules)
      ? options.modules.filter((m) => typeof m === 'string')
      : [];
  if (!text.trim() || modules.length === 0) return null;
  const res = await runOllieAiHelper({ cmd: 'route', text, modules });
  if (!res || res.error || !Array.isArray(res.routes)) return null;
  // The helper is multi-route: it splits the dump into distinct thoughts
  // and returns one {module,text,confidence} item per thought. Pass the
  // list straight through — lib/ollie-ai.ts normalises it.
  const routes = res.routes
    .filter(
      (r) =>
        r &&
        typeof r.module === 'string' &&
        typeof r.text === 'string' &&
        typeof r.confidence === 'number',
    )
    .map((r) => ({ module: r.module, text: r.text, confidence: r.confidence }));
  if (routes.length === 0) return null;
  return { routes };
});

ipcMain.handle('ollie:ai:extract', async (_event, options) => {
  const text = options && typeof options.text === 'string' ? options.text : '';
  const kind = options && typeof options.kind === 'string' ? options.kind : '';
  if (!text.trim() || !kind) return null;
  const res = await runOllieAiHelper({ cmd: 'extract', text, kind });
  if (!res || res.error) return null;
  return res;
});

// ----- lifecycle --------------------------------------------------------
if (gotTheLock) {
  app.whenReady().then(() => {
    buildMenu();
    createMainWindow();
    setupAutoUpdater();

    // E3 · Mac hot-key for "Hey Ollie" equivalent. Renderer listens for
    // `ollie:hotkey` and triggers the MicButton's start flow.
    //
    // Why not Cmd+Ctrl+Space? — that's the macOS Character Viewer
    // (Emoji & Symbols) on stock macOS. Cmd+Space is Spotlight.
    // Cmd+Shift+Space is the input-source switcher on multi-locale
    // Macs (TR/EN). Cmd+Option+Space is generally free.
    const combos = [
      'CommandOrControl+Alt+Space',     // primary
      'CommandOrControl+Shift+Period',  // backup
    ];
    for (const combo of combos) {
      try {
        const ok = globalShortcut.register(combo, () => {
          focusMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ollie:hotkey', { source: 'mac-shortcut', combo });
          }
        });
        if (ok) {
          console.log('[ollie] global shortcut registered:', combo);
          break;
        }
      } catch (err) {
        console.warn('[ollie] globalShortcut.register failed for', combo, err && err.message);
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch (_err) { /* noop */ }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
