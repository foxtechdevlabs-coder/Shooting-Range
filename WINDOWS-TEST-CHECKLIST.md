# Windows test checklist — Shooting Range System desktop build

Everything below is run **on the Windows 10/11 x64 test machine**, not in the dev sandbox.
Tick each box and paste the results back; I will fix anything that fails.

Build artifacts to copy onto the pen drive:

```
release/PenDrive/
  ShootingRangeSystem-Setup-1.0.0.exe
  SHA256SUMS.txt
  INSTALL.txt
  drivers/README.txt
  verify-package.ps1        <- helper that automates the mechanical checks
  WINDOWS-TEST-CHECKLIST.md <- this file
```

Machine prerequisites for a *clean* test: **no Node.js**, **network disabled** (airplane mode or
unplug the cable), a normal (non-admin) Windows user for the app itself.

Quick pass first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-package.ps1
```

It automates steps 1 (checksum/size), 2 (install layout, native modules, no dev leftovers, no
absolute paths), 7, 8 (outbound connections) and the shutdown-backup part of 4. Do the manual
steps below as well — they cover what a script cannot judge.

---

## 1. Build the installer

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1.1 | On the Windows build machine: `npm install` (repo root) then `npm run dist` | exits 0 | |
| 1.2 | Note the time `npm run dist` takes and the installer size | record below | |
| 1.3 | `release/SHA256SUMS.txt` exists and matches the exe | `certutil -hashfile ... SHA256` agrees | |

Build time: ______  Installer size: ______ MB

### 1.4 Smoke test the packaged app automatically (build machine only)

Before copying anything to the pen drive, prove the unpacked app really starts:

```powershell
npm run smoke:package
```

It runs `release\win-unpacked\Shooting Range System.exe` with a **temporary** data folder and a
free port (your real data is never touched), waits for `/api/health`, checks first-run state,
closes the app gracefully and confirms a shutdown backup. It prints `PASS - all smoke checks
passed` on success; on failure it prints the full `app.log` and exits 1.

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1.4 | `npm run smoke:package` | `[smoke] PASS - all smoke checks passed` | |
| 1.5 | If it fails, copy the printed `app.log` lines back | log names the failing module/file | |

> `npm run dist` needs internet **on this build PC** (npm packages + Electron binaries). The
> installed app itself never needs a network.

## 2. Clean install, no Node.js, network disabled

| # | Step | Expected | Result |
|---|------|----------|--------|
| 2.1 | Confirm `node -v` fails on the test PC | "not recognized" | |
| 2.2 | Disable the network (airplane mode) | no internet | |
| 2.3 | Run the installer, keep "Run app" ticked | installs, app opens | |
| 2.4 | **Time the installation** (start → app window visible) | **well under 15 min** | |
| 2.5 | SmartScreen appeared? | "More info → Run anyway" works | |
| 2.6 | Shortcuts | Desktop + Start menu "Shooting Range System" | |
| 2.7 | Installed to | `%LOCALAPPDATA%\Programs\Shooting Range System` (no admin prompt) | |

Install duration: ______

## 3. First run and basic operations

| # | Step | Expected | Result |
|---|------|----------|--------|
| 3.1 | First launch | "Set up this installation" screen, not a login screen | |
| 3.2 | Try password `short` | rejected: "at least 10 characters" | |
| 3.3 | Create admin (name, user, password ×2) | signs in automatically, Dashboard loads | |
| 3.4 | Sign out, sign in again | login works, no forced password change | |
| 3.5 | Participants → Add participant (bib, NOC, name, dept, gun, contact, category) | row appears, bib/gun uniqueness enforced | |
| 3.6 | Scan station → type the gun number + Enter | firearm checked out; counter changes | |
| 3.7 | Scan the same gun again within 5 s | "duplicate scan" confirmation dialog | |
| 3.8 | Barcodes → select the participant → Print labels (driver = File) | toast "1 label sent", `.zpl` appears in `<data>\labels` | |
| 3.9 | Same with `Driver = Windows spooler` and a ZD220 attached | physical label printed | |
| 3.10 | Unplug the printer, print again | inline warning "Label printer unavailable" + link to Settings; `.zpl` still written | |
| 3.11 | Transactions page | the scan(s) appear, pagination works | |
| 3.12 | Reports → any tab → Export XLSX | file downloads/opens, no 400s (F12 → Network if devtools enabled in a dev build) | |

## 4. Shutdown backup

| # | Step | Expected | Result |
|---|------|----------|--------|
| 4.1 | Close the window (X) | app exits, no error dialog | |
| 4.2 | Check `<data>\backups` | new `auto-<date>-shutdown.db` (a few hundred KB, today's time) | |
| 4.3 | Repeat with Alt+F4 | same behaviour, no duplicate backup written twice | |

## 5. Upgrade in place keeps data

| # | Step | Expected | Result |
|---|------|----------|--------|
| 5.1 | In `package.json` set `"version": "1.0.1"`, run `npm run dist` | `ShootingRangeSystem-Setup-1.0.1.exe` | |
| 5.2 | Close the app, run the new installer (do **not** uninstall) | upgrades in place, shortcuts still work | |
| 5.3 | Launch, sign in | **all participants still there** (count matches step 3) | |
| 5.4 | Check `<data>\backups` | `pre-migration-1.0.1-<date>.db` **if** that build had pending migrations | |
| 5.5 | Settings → About | version shows 1.0.1, data folder path unchanged | |

## 6. Uninstall keeps data

| # | Step | Expected | Result |
|---|------|----------|--------|
| 6.1 | Uninstall via Settings → Apps, or the Start-menu uninstaller | app removed | |
| 6.2 | Check `<data>` folder | still exists, database + backups intact | |
| 6.3 | Reinstall 1.0.1 and launch | straight to login, previous data present, no setup screen | |

## 7. Single instance

| # | Step | Expected | Result |
|---|------|----------|--------|
| 7.1 | With the app open, launch the shortcut again | no second window; existing window comes to the front | |
| 7.2 | Task Manager → Details | only one `Shooting Range System.exe` tree (main + Electron helpers) | |
| 7.3 | Close both windows | app fully exits (no orphan process) | |

## 8. Offline behaviour

| # | Step | Expected | Result |
|---|------|----------|--------|
| 8.1 | With network disabled, use Dashboard / Participants / Scan / Reports | everything works; nothing hangs | |
| 8.2 | `verify-package.ps1` outbound-connection check | 0 outbound connections | |
| 8.3 | Optional: Windows Defender Firewall → add an outbound block rule for `Shooting Range System.exe`, use the app for 5 min | no visible errors, no firewall prompts | |
| 8.4 | Confirm no updater UI anywhere (Settings → About, menus) | none | |

## 9. Security / hardening

| # | Step | Expected | Result |
|---|------|----------|--------|
| 9.1 | In the app window press **F12** / **Ctrl+Shift+I** | nothing opens (release build) | |
| 9.2 | F11 | toggles fullscreen | |
| 9.3 | Drag a URL onto the window, and try `javascript:alert(1)` in the address bar (if any) | no navigation, no script runs | |
| 9.4 | Open a report PDF/link that points outside (or run the DevTools console in a dev build): `window.open('https://example.com')` | blocked, no window opens | |
| 9.5 | In a dev build, console: `Object.keys(window.rangeopsDesktop)` | exactly `selectFolder`, `showItemInFolder`, `exportLogs`, `getAppInfo` | |
| 9.6 | Console: `typeof require`, `typeof process` | both `undefined` (nodeIntegration off) | |
| 9.7 | Settings → About → "Export support logs" → pick a pen-drive folder | `ShootingRange-logs-<date>` folder created with `app.log` + README | |
| 9.8 | Remove the pen drive, click "Backup now" with the backup folder on the pen drive | clear error message, app keeps running, no crash | |
| 9.9 | Settings → About → data folder → "Open" | Explorer opens the data folder | |

## 10. Tests and build (can run anywhere)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 10.1 | `npm run test:backend` | all backend tests pass | |
| 10.2 | `npm --prefix frontend run build` | frontend build succeeds | |
| 10.3 | `npm run build:all` | backend + desktop + frontend compile | |

---

### Notes to fill in

- Build machine Windows version: ______
- Test PC Windows version: ______
- Anything unexpected: ______
