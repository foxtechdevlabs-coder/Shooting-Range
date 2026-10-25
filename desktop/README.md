# Desktop shell (Electron)

The packaged Windows app runs the Express backend **in-process** on
`http://127.0.0.1:<port>` (3001, otherwise a free port) and shows it in a single
hardened `BrowserWindow`. One origin means cookies, uploads and the SPA all behave
exactly as they do in development.

```
desktop/
  main.cts       Electron main process  → desktop/dist/main.cjs (CommonJS)
  preload.cts    contextBridge allow-list → desktop/dist/preload.cjs
  tsconfig.json  TS 5.x, module=CommonJS (Electron loads .cjs reliably)
```

## Commands (from the repo root)

| Command | What it does |
|---|---|
| `npm run desktop:dev` | backend (`tsx watch`) + Vite + Electron together |
| `npm run build:all` | frontend build → backend compile → desktop compile |
| `npm run rebuild` | rebuild native modules (`better-sqlite3`) for Electron's ABI |
| `npm run dist` | `build:all` + `electron-builder --win nsis` (Windows only) |
| `npm run postdist` | SHA-256, `release/PenDrive/`, packaging sanity checks |
| `npm run verify:package` | static check of the built shell + builder config (any OS) |
| `npm run test:backend` | backend vitest suite |

`npm run dist` must run on Windows x64 (NSIS + native rebuild). The scripts in
`scripts/` are plain Node so they work from PowerShell.

## Data location

```
%APPDATA%\Shooting Range System\data\        default (per Windows user)
  shootingrange.db
  backups\   labels\   logs\
```

Overrides, highest priority first:

1. `SHOOTINGRANGE_DATA_DIR` environment variable
2. `%APPDATA%\Shooting Range System\data-location.json` → `{ "dataDir": "D:\\RangeData" }`
3. the default above

The install folder is never used for data, so upgrades and uninstall leave it
untouched (`deleteAppDataOnUninstall: false`).

## Replacing the application icon

`build/icon.ico` is generated from artwork:

```
build/icon-source.png   ← the source image (square, ≥ 256×256)
build/icon.ico          ← generated, 16/24/32/48/64/128/256
build/icon.png          ← generated 256×256 preview
```

**To use your own icon:** drop a square PNG (1024×1024 or 256×256) into
`build/icon-source.png` (or pass a path) and run:

```bash
node scripts/make-icon.mjs
# or: node scripts/make-icon.mjs path\to\your-icon.png
```

Then rebuild with `npm run dist`. The same file is used for the window icon, the
installer, the uninstaller and the shortcuts.

## Hardening summary

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`
- `devTools` only in development builds; no application menu in production; F11 fullscreen
- preload exposes exactly `selectFolder`, `showItemInFolder`, `exportLogs`, `getAppInfo`
- `will-navigate` / `will-redirect` restricted to the app origin, `window.open` denied,
  all permission requests denied
- strict CSP served by the backend (`default-src 'self'` … `connect-src 'self'`)
- single instance lock; shutdown backup (10 s budget) → stop HTTP → checkpoint + close SQLite
- pre-migration backup with automatic restore if a migration fails
- no updater, analytics, crash reporters or CDN assets: fully offline
