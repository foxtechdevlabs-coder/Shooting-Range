/**
 * Thin wrapper around the Electron preload bridge.
 *
 * The preload script exposes exactly four allow-listed functions:
 *   selectFolder(), showItemInFolder(path), exportLogs(), getAppInfo()
 *
 * Every helper here degrades gracefully in a normal browser, so the same
 * frontend build runs in dev (Vite), in tests and in the packaged desktop app.
 */

export interface DesktopAppInfo {
  version: string
  dataDir: string
  logFile?: string
}

export interface DesktopBridge {
  selectFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>
  showItemInFolder(path: string): Promise<boolean>
  exportLogs(): Promise<{ ok: boolean; destination?: string; cancelled?: boolean; error?: string }>
  getAppInfo(): Promise<DesktopAppInfo>
}

declare global {
  interface Window {
    rangeopsDesktop?: DesktopBridge
  }
}

/** True when running inside the packaged Electron shell. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && typeof window.rangeopsDesktop === 'object' && window.rangeopsDesktop !== null
}

/**
 * Native folder picker. Returns null in a plain browser (callers keep their
 * existing browser behaviour in that case).
 */
export async function selectFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null> {
  if (!isDesktop()) return null
  return window.rangeopsDesktop!.selectFolder(options)
}

/** Reveal a file/folder in Explorer. No-op in the browser. */
export async function showItemInFolder(path: string): Promise<boolean> {
  if (!isDesktop() || !path) return false
  return window.rangeopsDesktop!.showItemInFolder(path)
}

/** Copy the support logs to a folder the user picks. */
export async function exportLogs(): Promise<{ ok: boolean; destination?: string; cancelled?: boolean; error?: string }> {
  if (!isDesktop()) {
    return { ok: false, error: 'Support log export is only available in the desktop app.' }
  }
  return window.rangeopsDesktop!.exportLogs()
}

/** Version + data folder from the shell (falls back to the API when absent). */
export async function getDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  if (!isDesktop()) return null
  try {
    return await window.rangeopsDesktop!.getAppInfo()
  } catch {
    return null
  }
}
