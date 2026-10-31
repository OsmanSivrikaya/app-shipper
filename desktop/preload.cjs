const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shipperAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  init: () => ipcRenderer.invoke('app:init'),
  loginWithToken: (payload) => ipcRenderer.invoke('auth:loginWithToken', payload),
  startWebLogin: () => ipcRenderer.invoke('auth:startWebLogin'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  updatePrefs: (prefs) => ipcRenderer.invoke('settings:updatePrefs', prefs),

  saveProject: (projData) => ipcRenderer.invoke('projects:save', projData),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),

  selectFolder: (title) => ipcRenderer.invoke('dialog:selectFolder', title),
  inspectProject: (folderPath) => ipcRenderer.invoke('project:inspect', folderPath),
  selectFile: (opts) => ipcRenderer.invoke('dialog:selectFile', opts),

  appleBrowserConnect: (payload) => ipcRenderer.invoke('accounts:appleBrowserConnect', payload),
  saveAppleAccount: (payload) => ipcRenderer.invoke('accounts:saveApple', payload),
  deleteAppleAccount: (id) => ipcRenderer.invoke('accounts:deleteApple', id),

  googleBrowserConnect: (payload) => ipcRenderer.invoke('accounts:googleBrowserConnect', payload),
  saveGoogleAccount: (payload) => ipcRenderer.invoke('accounts:saveGoogle', payload),
  deleteGoogleAccount: (id) => ipcRenderer.invoke('accounts:deleteGoogle', id),

  saveGeneralSettings: (payload) => ipcRenderer.invoke('settings:saveGeneral', payload),

  uploadEnv: (payload) => ipcRenderer.invoke('project:uploadEnv', payload),
  uploadKeystore: (payload) => ipcRenderer.invoke('project:uploadKeystore', payload),

  startShip: (payload) => ipcRenderer.invoke('ship:start', payload),
  pollRun: (payload) => ipcRenderer.invoke('ship:pollRun', payload),
  getFailedLogs: (payload) => ipcRenderer.invoke('ship:getFailedLogs', payload),
  getHistory: () => ipcRenderer.invoke('ship:history'),

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  onShipEvent: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('ship:event', handler)
    return () => ipcRenderer.removeListener('ship:event', handler)
  },

  onWebLoginSuccess: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('auth:webLoginSuccess', handler)
    return () => ipcRenderer.removeListener('auth:webLoginSuccess', handler)
  },
})
