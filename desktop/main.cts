/**
 * Electron main process (compiled to CommonJS: desktop/dist/main.cjs).
 *
 * Responsibilities
 *  - start the Express backend in-process on 127.0.0.1 (3001, else a free port)
 *  - open one hardened BrowserWindow on that origin (single origin → cookies work)
 *  - own the lifecycle: single instance, shutdown backup, clean SQLite close
 *  - expose four allow-listed IPC calls through the preload bridge
 *
 * Nothing here talks to the internet: no updater, no telemetry, no CDN.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const isDev = !app.isPackaged
const DEV_URL = process.env.ELECTRON_START_URL ?? 'http://localhost:5173'
const SHUTDOWN_BACKUP_TIMEOUT_MS = 10_000

interface RunningBackend {
  port: number
  url: string
  dataDir: string
  stop: () => Promise<void>
  runShutdownBackup: (timeoutMs?: number) => Promise<void>
}

let mainWindow: BrowserWindow | null = null
let backend: RunningBackend | null = null
let dataDir = ''
let quitting = false
let cleanedUp = false

// ─── Logging (shared log file with the backend) ────────────────────────────

function logLine(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, source: 'desktop', message, ...(meta ? { meta } : {}) })
  console.log(line)
  try {
    const logFile = path.join(dataDir || app.getPath('userData'), 'data', 'logs', 'app.log')
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    const stat = fs.existsSync(logFile) ? fs.statSync(logFile) : null
    if (stat && stat.size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile.replace(/\.log$/, '.desktop-old.log'))
    fs.appendFileSync(logFile, `${line}\n`, 'utf8')
  } catch { /* logging must never crash the app */ }
}

function logFilePath(): string {
  return path.join(dataDir || path.join(app.getPath('userData'), 'data'), 'logs', 'app.log')
}

// ─── Data location ─────────────────────────────────────────────────────────

/**
 * Resolution order:
 *   1. SHOOTINGRANGE_DATA_DIR environment variable
 *   2. "%APPDATA%\Shooting Range System\data-location.json" → { "dataDir": "D:\\Shared\\..." }
 *   3. "%APPDATA%\Shooting Range System\data"   (default, per Windows user)
 *
 * Data never lives inside the install folder, so upgrades and uninstall leave it alone.
 */
function resolveDataDir(): string {
  const fromEnv = process.env.SHOOTINGRANGE_DATA_DIR
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim())

  const configFile = path.join(app.getPath('userData'), 'data-location.json')
  try {
    if (fs.existsSync(configFile)) {
      const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { dataDir?: unknown }
      if (typeof parsed.dataDir === 'string' && parsed.dataDir.trim() && path.isAbsolute(parsed.dataDir)) {
        return path.resolve(parsed.dataDir)
      }
      logLine('warn', 'Ignoring data-location.json: dataDir must be an absolute path', { configFile })
    }
  } catch (error) {
    logLine('warn', 'Could not read data-location.json; using the default data folder', { configFile, error })
  }
  return path.join(app.getPath('userData'), 'data')
}

// ─── Backend ───────────────────────────────────────────────────────────────

function backendEntryPath(): string {
  // <app>/desktop/dist/main.cjs → <app>/backend/server/dist/server/src/server.js
  return path.join(__dirname, '..', '..', 'backend', 'server', 'dist', 'server', 'src', 'server.js')
}

function staticDirPath(): string {
  return path.join(__dirname, '..', '..', 'frontend', 'dist')
}

function spoolScriptPath(): string {
  // Shipped through electron-builder extraResources → resources/print-spool.ps1
  const unpacked = path.join(process.resourcesPath, 'print-spool.ps1')
  return fs.existsSync(unpacked) ? unpacked : path.join(__dirname, '..', '..', 'backend', 'server', 'src', 'services', 'print-spool.ps1')
}

async function startBackend(): Promise<RunningBackend> {
  const entry = backendEntryPath()
  if (!fs.existsSync(entry)) {
    throw new Error(`Backend bundle is missing: ${entry}\n\nRun "npm run build:all" before starting the desktop app.`)
  }
  const staticDir = staticDirPath()
  if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
    throw new Error(`Frontend build is missing: ${staticDir}\n\nRun "npm run build:all" before starting the desktop app.`)
  }

  logLine('info', 'Starting embedded backend', { entry, dataDir, staticDir, version: app.getVersion() })
  const module = await import(pathToFileURL(entry).href)
  const started = await module.startServer({
    host: '127.0.0.1',
    port: 3001,
    dataDir,
    staticDir,
    printScriptPath: spoolScriptPath(),
    appVersion: app.getVersion(),
    packaged: true,
  })
  return started as RunningBackend
}

// ─── Window ────────────────────────────────────────────────────────────────

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f6f8',
    title: 'Shooting Range System',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  })

  const allowedOrigin = new URL(url).origin

  // Deny window.open / target=_blank entirely.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Block navigation away from our origin.
  window.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== allowedOrigin) {
        event.preventDefault()
        logLine('warn', 'Blocked navigation to external URL', { target })
      }
    } catch {
      event.preventDefault()
    }
  })

  // Also block in-page redirects and form posts to other origins.
  window.webContents.on('will-redirect', (event, target) => {
    try {
      if (new URL(target).origin !== allowedOrigin) event.preventDefault()
    } catch { event.preventDefault() }
  })

  // No camera/mic/geolocation/notifications etc.
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)

  // F11 fullscreen; keep the scan station usable. Dev builds keep devtools shortcuts.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      event.preventDefault()
      window.setFullScreen(!window.isFullScreen())
    }
    if (isDev && input.control && input.shift && input.key.toLowerCase() === 'i') {
      window.webContents.toggleDevTools()
    }
  })

  window.once('ready-to-show', () => {
    window.show()
    if (isDev) window.webContents.openDevTools({ mode: 'detach' })
  })

  window.on('closed', () => { mainWindow = null })

  // Windows logoff / shutdown: best effort backup, no dialogs.
  ;(window as unknown as { on: (event: string, cb: () => void) => void }).on('session-end', () => {
    logLine('warn', 'Windows session-end received; running shutdown backup')
    void shutdownCleanly('session-end', 7_000)
  })

  void window.loadURL(url)
  return window
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

/** Run the shutdown backup once, then stop HTTP + close SQLite. Guarded against re-entry. */
async function shutdownCleanly(reason: string, timeoutMs = SHUTDOWN_BACKUP_TIMEOUT_MS): Promise<void> {
  if (cleanedUp) return
  cleanedUp = true
  logLine('info', 'Shutting down', { reason })
  if (!backend) return
  try {
    await backend.runShutdownBackup(timeoutMs)
  } catch (error) {
    logLine('error', 'Shutdown backup failed', { error })
  }
  try {
    await backend.stop()
  } catch (error) {
    logLine('error', 'Failed to stop the backend cleanly', { error })
  }
}

function showFatalError(title: string, message: string): void {
  dialog.showErrorBox(title, `${message}\n\nLog file:\n${logFilePath()}\n\nData folder:\n${dataDir || path.join(app.getPath('userData'), 'data')}`)
}

async function boot(): Promise<void> {
  dataDir = resolveDataDir()
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true })
  logLine('info', 'Application starting', { version: app.getVersion(), isDev, dataDir })

  if (isDev && !process.env.ELECTRON_DEV_BACKEND) {
    // Development: the backend and Vite run as separate `npm run dev` processes.
    mainWindow = createWindow(DEV_URL)
    return
  }

  try {
    backend = await startBackend()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logLine('error', 'Backend failed to start', { error: message })
    showFatalError(
      'Shooting Range System could not start',
      `The application database or server could not be started.\n\n${message}`,
    )
    app.exit(1)
    return
  }

  mainWindow = createWindow(backend.url)
}

// Single instance: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    logLine('info', 'Second launch detected; focusing the existing window')
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (!isDev) Menu.setApplicationMenu(null)
    registerIpc()
    void boot()
  })

  app.on('window-all-closed', () => { app.quit() })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void boot()
  })

  // Single, guarded shutdown path for Alt+F4, window close, task-manager quit, etc.
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void shutdownCleanly('before-quit').finally(() => app.exit(0))
  })

  // Node-level safety net for the main process (Electron has no app event for this).
  process.on('uncaughtException', (error: Error) => {
    logLine('error', 'uncaughtException in main process', { message: error.message, stack: error.stack })
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Shooting Range System — unexpected error',
      message: 'An unexpected error occurred.',
      detail: `${error.message}\n\nLog file:\n${logFilePath()}`,
      buttons: ['Continue', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice === 1) {
      void shutdownCleanly('uncaught-exception').finally(() => app.exit(1))
    }
  })

  process.on('unhandledRejection', (reason) => {
    logLine('error', 'unhandledRejection in main process', { reason: reason instanceof Error ? reason.message : String(reason) })
  })
}

// ─── IPC (allow-list only) ─────────────────────────────────────────────────

function asFolderArgument(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length < 4096 && !value.includes('\0') ? value : null
}

function registerIpc(): void {
  // 1. Native folder picker (backups, exports, log export destination).
  ipcMain.handle('desktop:select-folder', async (event: IpcMainInvokeEvent, options: unknown) => {
    if (!isTrustedSender(event)) return null
    const opts = (typeof options === 'object' && options !== null ? options : {}) as { title?: unknown; defaultPath?: unknown }
    const defaultPath = typeof opts.defaultPath === 'string' && path.isAbsolute(opts.defaultPath) ? opts.defaultPath : undefined
    const result = await dialog.showOpenDialog({
      title: typeof opts.title === 'string' && opts.title.length < 200 ? opts.title : 'Choose a folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Use this folder',
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  // 2. Reveal a path in Explorer.
  ipcMain.handle('desktop:show-item', async (event: IpcMainInvokeEvent, target: unknown) => {
    if (!isTrustedSender(event)) return false
    const resolved = asFolderArgument(target)
    if (!resolved) return false
    try {
      if (!fs.existsSync(resolved)) return false
      shell.showItemInFolder(resolved)
      return true
    } catch (error) {
      logLine('warn', 'showItemInFolder failed', { error })
      return false
    }
  })

  // 3. Copy support logs to a folder the user picks (pen drive).
  ipcMain.handle('desktop:export-logs', async (event: IpcMainInvokeEvent) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Not allowed.' }
    const logsDir = path.join(dataDir, 'logs')
    if (!fs.existsSync(logsDir)) return { ok: false, error: 'There are no support logs yet.' }

    const result = await dialog.showOpenDialog({
      title: 'Choose where to save the support logs',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Export here',
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }

    const destination = path.join(result.filePaths[0], `ShootingRange-logs-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    try {
      fs.mkdirSync(destination, { recursive: true })
      for (const file of fs.readdirSync(logsDir)) {
        const source = path.join(logsDir, file)
        if (fs.statSync(source).isFile()) fs.copyFileSync(source, path.join(destination, file))
      }
      fs.writeFileSync(path.join(destination, 'README.txt'), [
        'Shooting Range System — support logs',
        `Exported: ${new Date().toISOString()}`,
        `Application version: ${app.getVersion()}`,
        'These files contain operational log entries. Passwords and session identifiers are never logged.',
      ].join('\r\n'), 'utf8')
      logLine('info', 'Support logs exported', { destination })
      return { ok: true, destination }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logLine('error', 'Support log export failed', { error: message })
      return { ok: false, error: message }
    }
  })

  // 4. Version + data folder for the Settings → About card.
  ipcMain.handle('desktop:app-info', async (event: IpcMainInvokeEvent) => {
    if (!isTrustedSender(event)) return { version: app.getVersion(), dataDir: '' }
    return { version: app.getVersion(), dataDir, logFile: logFilePath() }
  })
}

/** Only our own origin (or the dev server) may call IPC. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  if (!url) return false
  try {
    const origin = new URL(url).origin
    if (isDev) return origin === new URL(DEV_URL).origin
    return /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
  } catch {
    return false
  }
}

// Renderer crashed / went away: log it and offer reload-or-quit (main process stays alive).
app.on('render-process-gone', (_event, _contents, details) => {
  logLine('error', 'Renderer process gone', { reason: details.reason, exitCode: details.exitCode })
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Shooting Range System — window stopped',
    message: 'The application window stopped unexpectedly.',
    detail: `Reason: ${details.reason}\n\nLog file:\n${logFilePath()}`,
    buttons: ['Reload window', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice === 0 && mainWindow) mainWindow.reload()
  else app.quit()
})

if (isDev) logLine('info', 'Desktop shell starting in development mode', { devUrl: DEV_URL })
