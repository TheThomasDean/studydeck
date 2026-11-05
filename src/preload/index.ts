import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type StudyDeckApi } from '@shared/types'

const api: StudyDeckApi = {
  listSets: () => ipcRenderer.invoke(IPC.listSets),
  saveSet: (set) => ipcRenderer.invoke(IPC.saveSet, set),
  deleteSet: (id) => ipcRenderer.invoke(IPC.deleteSet, id),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (s) => ipcRenderer.invoke(IPC.saveSettings, s),
  openSpreadsheet: () => ipcRenderer.invoke(IPC.openSpreadsheet),
  saveExport: (name, data, kind) => ipcRenderer.invoke(IPC.saveExport, name, data, kind),
  platform: process.platform
}

contextBridge.exposeInMainWorld('studydeck', api)
