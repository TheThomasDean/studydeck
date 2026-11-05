import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { IPC, type SaveResult, type Settings, type StudySet } from '@shared/types'
import { Storage } from './storage'

const MAX_IMPORT_BYTES = 100 * 1024 * 1024
let storage: Storage
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'StudyDeck',
    backgroundColor: '#f6f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Never navigate away from the app (e.g. when a file is dropped outside a drop zone).
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.listSets, () => storage.listSets())
  ipcMain.handle(IPC.saveSet, (_e, set: StudySet) => storage.saveSet(set))
  ipcMain.handle(IPC.deleteSet, (_e, id: string) => storage.deleteSet(id))
  ipcMain.handle(IPC.getSettings, () => storage.getSettings())
  ipcMain.handle(IPC.saveSettings, (_e, settings: Settings) => storage.saveSettings(settings))

  ipcMain.handle(IPC.openSpreadsheet, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const opts: Electron.OpenDialogOptions = {
      title: 'Import from Excel',
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    const file = result.filePaths[0]
    const stat = await fs.stat(file)
    if (stat.size > MAX_IMPORT_BYTES) throw new Error('That file is larger than 100 MB and cannot be imported.')
    const data = await fs.readFile(file)
    return { name: path.basename(file), data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
  })

  ipcMain.handle(
    IPC.saveExport,
    async (_e, defaultName: string, data: Uint8Array, kind: 'xlsx' | 'csv'): Promise<SaveResult> => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow
      const safeName = defaultName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'study-set'
      const opts: Electron.SaveDialogOptions = {
        title: kind === 'xlsx' ? 'Export to Excel' : 'Export to CSV',
        defaultPath: path.join(app.getPath('documents'), `${safeName}.${kind}`),
        filters: [
          kind === 'xlsx'
            ? { name: 'Excel workbook', extensions: ['xlsx'] }
            : { name: 'CSV (comma separated)', extensions: ['csv'] }
        ]
      }
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) return { ok: false }
      try {
        await fs.writeFile(result.filePath, Buffer.from(data))
        return { ok: true, path: result.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}

app.whenReady().then(async () => {
  storage = new Storage(app.getPath('userData'))
  await storage.init()
  registerIpc()

  // No permissions (camera, notifications, ...) are ever needed.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
