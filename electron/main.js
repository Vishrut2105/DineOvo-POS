import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import log from 'electron-log';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

// Keeps `npm run electron:dev` from touching the same local SQLite order queue, saved
// credentials, and device-id file as a real installed copy of this app on the same machine
// — without this, a dev run and the production install could resolve to the same userData
// folder and cross-contaminate each other's data. Must run before anything else calls
// app.getPath('userData'): startBackgroundProcesses() below passes it to the spawned
// server/sync processes, and createWindow() uses it for the credentials/device-id files.
if (isDev) {
  const devUserDataPath = path.join(app.getPath('userData'), '..', 'DineOvo POS (dev)');
  fs.mkdirSync(devUserDataPath, { recursive: true });
  app.setPath('userData', devUserDataPath);
}

let mainWindow;
let serverProcess;
let syncProcess;
let isQuitting = false;

const LOCAL_API_KEY = crypto.randomBytes(32).toString('hex');

function startBackgroundProcesses() {
  const rootDir = path.join(__dirname, '..');
  
  function spawnServer() {
    serverProcess = spawn('node', [path.join(rootDir, 'local-server', 'index.js')], {
      stdio: 'pipe',
      cwd: rootDir,
      env: { ...process.env, LOCAL_API_KEY, USER_DATA_PATH: app.getPath('userData') }
    });

    serverProcess.stdout.on('data', data => console.log(`[Server] ${data}`));
    serverProcess.stderr.on('data', data => console.error(`[Server Error] ${data}`));

    serverProcess.on('error', (err) => {
      console.error('Failed to start local server:', err);
    });

    serverProcess.on('exit', (code) => {
      if (!isQuitting) {
        console.log(`Local server exited with code ${code}. Restarting in 3 seconds...`);
        setTimeout(spawnServer, 3000);
      }
    });
  }

  function spawnSync() {
    syncProcess = spawn('node', [path.join(rootDir, 'local-server', 'sync.js')], {
      stdio: 'pipe',
      cwd: rootDir,
      env: { ...process.env, LOCAL_API_KEY, USER_DATA_PATH: app.getPath('userData') }
    });

    syncProcess.stdout.on('data', data => console.log(`[Sync] ${data}`));
    syncProcess.stderr.on('data', data => console.error(`[Sync Error] ${data}`));

    syncProcess.on('error', (err) => {
      console.error('Failed to start sync process:', err);
    });

    syncProcess.on('exit', (code) => {
      if (!isQuitting) {
        console.log(`Sync process exited with code ${code}. Restarting in 3 seconds...`);
        setTimeout(spawnSync, 3000);
      }
    });
  }

  spawnServer();
  spawnSync();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '../public/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'DineOvo POS'
  });

  // Remove menu bar for a cleaner POS experience
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    // In development, load the Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built React app
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Provide the API key synchronously to the renderer via IPC
  ipcMain.on('get-api-key-sync', (event) => {
    event.returnValue = LOCAL_API_KEY;
  });

  // Inject the API key into the window object securely after load (fallback)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`window.LOCAL_API_KEY = "${LOCAL_API_KEY}";`);
  });

  // Intercept window.open calls to open in the external default browser/app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('whatsapp:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackgroundProcesses();
  createWindow();

  // Configure autoUpdater logging
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  
  // Disable auto download so user can initiate it via UI
  autoUpdater.autoDownload = false;

  if (!isDev) {
    log.info('AutoUpdater initialized, waiting for renderer to request check...');
  }

  // Forward auto-updater events to renderer
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    mainWindow?.webContents.send('update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('No update available:', info);
    mainWindow?.webContents.send('update-not-available', info);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    // throttle logging to avoid spam
    mainWindow?.webContents.send('update-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded');
    mainWindow?.webContents.send('update-downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err);
    mainWindow?.webContents.send('update-error', err.message);
  });

  // Handle IPC commands from renderer
  ipcMain.on('check-for-updates', () => {
    log.info('Renderer requested update check');
    if (isDev) {
      // electron-updater is a no-op in dev (no packaged app to compare against) — report
      // "up to date" immediately instead of leaving the Settings > Updates UI stuck on
      // "Checking..." forever with no event ever arriving.
      mainWindow?.webContents.send('update-not-available');
      return;
    }
    autoUpdater.checkForUpdates();
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.on('start-download', () => {
    log.info('Starting update download via IPC');
    autoUpdater.downloadUpdate();
  });

  ipcMain.on('install-update', () => {
    log.info('Installing update via IPC (Silent)');
    autoUpdater.quitAndInstall(true, true);
  });

  // "Remember me" credential storage — the password is encrypted via safeStorage (Windows
  // DPAPI, tied to this OS user account) before it ever touches disk, not stored in plaintext.
  const credentialsPath = path.join(app.getPath('userData'), 'saved_credentials.dat');

  ipcMain.handle('save-credentials', (event, email, password) => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const encrypted = safeStorage.encryptString(password);
    fs.writeFileSync(credentialsPath, JSON.stringify({ email, password: encrypted.toString('base64') }));
    return true;
  });

  ipcMain.handle('load-credentials', () => {
    try {
      if (!fs.existsSync(credentialsPath) || !safeStorage.isEncryptionAvailable()) return null;
      const { email, password } = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
      return { email, password: safeStorage.decryptString(Buffer.from(password, 'base64')) };
    } catch (err) {
      console.error('Failed to load saved credentials:', err);
      return null;
    }
  });

  ipcMain.handle('clear-credentials', () => {
    try {
      if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
    } catch (err) {
      console.error('Failed to clear saved credentials:', err);
    }
    return true;
  });

  // Device identity for the 5-device session cap. Previously stored only in the renderer's
  // localStorage, which meant a reinstall or "clear app data" minted a brand-new device_id —
  // the old active_sessions row for this physical machine was never cleaned up, silently
  // eating one of the account's 5 slots forever. Persisting it in userData survives all of
  // that, so the same physical install keeps the same identity across reinstalls/updates.
  const deviceIdPath = path.join(app.getPath('userData'), 'device_id.txt');

  ipcMain.handle('get-device-id', (event, existingLocalStorageId) => {
    try {
      if (fs.existsSync(deviceIdPath)) {
        return fs.readFileSync(deviceIdPath, 'utf-8').trim();
      }
      // First run on this install: adopt whatever localStorage already had (an existing
      // installation upgrading to this version) instead of minting a fresh identity, so it
      // doesn't burn a new slot for a device that already had one.
      const id = existingLocalStorageId || crypto.randomUUID();
      fs.writeFileSync(deviceIdPath, id);
      return id;
    } catch (err) {
      console.error('Failed to get/create persistent device id:', err);
      return existingLocalStorageId || crypto.randomUUID();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Silent Printing IPC handler
  ipcMain.on('print-silent', (event, htmlContent) => {
    let printWindow = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    
    // Fallback timeout to close window if print hangs
    const fallbackTimeout = setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        console.error('Print timeout reached, forcing window close');
        printWindow.close();
      }
    }, 10000);

    printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`, {
      baseURLForDataURL: `file://${path.join(__dirname, '../dist/')}`
    });
    
    printWindow.webContents.on('did-finish-load', () => {
      printWindow.webContents.print({ 
        silent: true, 
        printBackground: false, 
        color: false,
        margins: { marginType: 'none' }
      }, (success, failureReason) => {
        clearTimeout(fallbackTimeout);
        if (!success) console.error('Silent print failed:', failureReason);
        if (printWindow && !printWindow.isDestroyed()) printWindow.close();
      });
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  // Clean up background processes when the app exits
  if (serverProcess) serverProcess.kill();
  if (syncProcess) syncProcess.kill();
});
