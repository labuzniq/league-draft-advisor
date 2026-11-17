import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, AppView } from '../shared/types'

const api: AppApi = {
  onView(cb) {
    ipcRenderer.on('view', (_event, view: AppView) => cb(view))
    ipcRenderer.send('view-ready')
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  async setApiKey(key) {
    const error: string | undefined = await ipcRenderer.invoke('set-api-key', key)
    if (error) throw new Error(error)
  },
  chooseRole: (role) => ipcRenderer.send('choose-role', role),
  retry: () => ipcRenderer.send('retry')
}

contextBridge.exposeInMainWorld('api', api)
