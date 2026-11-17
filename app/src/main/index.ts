import { join } from 'node:path'
import type { Role } from '@lda/shared'
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import type { AppView } from '../shared/types'
import { ClaudeAdvisor } from './advisor/advisor'
import { loadChampions } from './champions/ddragon'
import { LcuClient, type Recording } from './lcu/client'
import { locateClient, type LcuCredentials } from './lcu/locate'
import { Recorder, saveRecording } from './lcu/recorder'
import { DraftSession } from './session'
import { SettingsStore, type KeyCipher } from './settings'
import { loadStats } from './stats/loader'

const cipher: KeyCipher = {
  encrypt(text) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot store the key safely.')
    return safeStorage.encryptString(text)
  },
  decrypt: (data) => safeStorage.decryptString(data)
}

async function startFakeClient(): Promise<() => Promise<LcuCredentials>> {
  const { startFakeLcu } = await import('../../test/helpers/fake-lcu')
  const { default: recording } = await import('../../test/fixtures/recording.json')
  const fake = await startFakeLcu(recording as Recording)
  recording.events.forEach((event, index) => setTimeout(() => void fake.send(index), event.atMs))
  return async () => fake.creds
}

let recorder: Recorder | undefined

function saveCurrentRecording(): void {
  if (!recorder?.hasEvents()) return
  saveRecording(recorder.stop(), app.getPath('desktop'), new Date())
}

function makeRecordingClient(creds: LcuCredentials): LcuClient {
  const client = new LcuClient(creds)
  recorder = new Recorder(client)
  recorder.start().catch((error: unknown) => console.error('Recording could not start:', error))
  client.onSession((session) => {
    if (session === null) saveCurrentRecording()
  })
  return client
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 440,
    height: 680,
    title: 'Draft Advisor',
    backgroundColor: '#12151c',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return window
}

async function main(): Promise<void> {
  await app.whenReady()
  const userData = app.getPath('userData')
  const cacheDir = join(userData, 'cache')
  const settings = new SettingsStore(join(userData, 'settings.json'), cipher)
  const record = process.argv.includes('--record')
  if (record) app.on('before-quit', saveCurrentRecording)
  const locate = import.meta.env.DEV && !app.isPackaged && process.argv.includes('--fake-lcu') ? await startFakeClient() : locateClient

  let lastView: AppView | undefined
  let window: BrowserWindow | undefined
  const session = new DraftSession({
    locate,
    makeClient: (creds) => (record ? makeRecordingClient(creds) : new LcuClient(creds)),
    makeAdvisor: (apiKey, model, data) => new ClaudeAdvisor({ apiKey, model, data }),
    settings,
    loadStats: () => loadStats(cacheDir),
    loadChampions: () => loadChampions(cacheDir),
    onView: (view) => {
      lastView = view
      window?.webContents.send('view', view)
    }
  })

  ipcMain.on('view-ready', (event) => {
    if (lastView) event.sender.send('view', lastView)
  })
  ipcMain.handle('get-settings', () => settings.get())
  ipcMain.handle('set-settings', (_event, patch: { model?: string; showAll?: boolean }) => {
    const result = settings.set(patch)
    session.settingsChanged()
    return result
  })
  ipcMain.handle('set-api-key', (_event, key: string) => {
    try {
      settings.setApiKey(key)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    session.settingsChanged()
  })
  ipcMain.on('choose-role', (_event, role: Role) => session.chooseRole(role))
  ipcMain.on('retry', () => session.retry())

  app.on('window-all-closed', () => {
    window = undefined
    session.stop()
    app.quit()
  })

  window = createWindow()
  await session.start()
}

void main()
