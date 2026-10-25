/**
 * Preload (compiled to CommonJS: desktop/dist/preload.cjs).
 *
 * Exposes exactly four allow-listed functions to the renderer through
 * contextBridge. No generic IPC channel, no Node APIs, no file reads:
 * every call maps to a fixed ipcMain.handle in main.cts that validates
 * its arguments.
 */
import { contextBridge, ipcRenderer } from 'electron'

const desktopApi = {
  /** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
  selectFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null> {
    return ipcRenderer.invoke('desktop:select-folder', {
      title: typeof options?.title === 'string' ? options.title : undefined,
      defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : undefined,
    })
  },

  /** Reveal a file or folder in Windows Explorer. */
  showItemInFolder(target: string): Promise<boolean> {
    return ipcRenderer.invoke('desktop:show-item', typeof target === 'string' ? target : '')
  },

  /** Copy the support logs to a folder the user picks. */
  exportLogs(): Promise<{ ok: boolean; destination?: string; cancelled?: boolean; error?: string }> {
    return ipcRenderer.invoke('desktop:export-logs')
  },

  /** Application version and the data folder in use. */
  getAppInfo(): Promise<{ version: string; dataDir: string; logFile?: string }> {
    return ipcRenderer.invoke('desktop:app-info')
  },
}

contextBridge.exposeInMainWorld('rangeopsDesktop', Object.freeze(desktopApi))
