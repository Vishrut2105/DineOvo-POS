const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('LOCAL_API_KEY', ipcRenderer.sendSync('get-api-key-sync'));

contextBridge.exposeInMainWorld('electronAPI', {
  printSilent: (htmlContent) => ipcRenderer.send('print-silent', htmlContent),
  
  // Auto Updater
  //
  // Each `onXxx` registers its own listener and returns a function that removes ONLY that
  // listener. Two independent UI surfaces now listen to these events (the App-level corner
  // toast, and Settings' Updates tab) — the previous `removeUpdateListeners()` called
  // `ipcRenderer.removeAllListeners()`, which would wipe out the OTHER surface's listeners
  // too, not just the caller's own. Kept below (now built from the same per-listener
  // primitives) only so nothing that already calls it breaks.
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  onUpdateNotAvailable: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('update-not-available', listener);
    return () => ipcRenderer.removeListener('update-not-available', listener);
  },
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },
  onUpdateError: (callback) => {
    const listener = (_event, error) => callback(error);
    ipcRenderer.on('update-error', listener);
    return () => ipcRenderer.removeListener('update-error', listener);
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-not-available');
    ipcRenderer.removeAllListeners('update-progress');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('update-error');
  },

  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  startDownload: () => ipcRenderer.send('start-download'),
  installUpdate: () => ipcRenderer.send('install-update'),
  simulateUpdate: () => ipcRenderer.send('simulate-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // "Remember me" — password is encrypted at rest (see main.js), never touches localStorage.
  saveCredentials: (email, password) => ipcRenderer.invoke('save-credentials', email, password),
  loadCredentials: () => ipcRenderer.invoke('load-credentials'),
  clearCredentials: () => ipcRenderer.invoke('clear-credentials'),

  // Persistent device identity for the session cap (see main.js for why).
  getDeviceId: (existingLocalStorageId) => ipcRenderer.invoke('get-device-id', existingLocalStorageId),
});
