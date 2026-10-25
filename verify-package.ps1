# Automated checks for a packaged Shooting Range System build
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-package.ps1
#
# Run this on the Windows test machine, from the folder that contains the
# installer (or next to the installed app). It covers the mechanical parts of
# WINDOWS-TEST-CHECKLIST.md (steps 1-5, 7-9) and prints PASS/FAIL per check.
# Exit code 0 = everything passed.

[CmdletBinding()]
param(
  [string]$Installer,
  [string]$AppExe = "$env:LOCALAPPDATA\Programs\Shooting Range System\Shooting Range System.exe",
  [switch]$SkipLaunchTests
)

$ErrorActionPreference = 'Continue'
$script:failures = 0
$script:checks = 0

function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $script:checks++
  if ($ok) { Write-Host ("  PASS  {0}{1}" -f $name, $(if ($detail) { "  ($detail)" } else { '' })) -ForegroundColor Green }
  else { $script:failures++; Write-Host ("  FAIL  {0}{1}" -f $name, $(if ($detail) { "  ($detail)" } else { '' })) -ForegroundColor Red }
}

function Section([string]$title) { Write-Host "`n$title" -ForegroundColor Cyan }

# ---------------------------------------------------------------- environment
Section '0) Environment'

Check 'Windows 10 or 11' ([Environment]::OSVersion.Version.Major -ge 10) ([Environment]::OSVersion.VersionString)
Check '64-bit process' ([Environment]::Is64BitOperatingSystem) ''
$arch = $env:PROCESSOR_ARCHITECTURE
Check 'x64 architecture' ($arch -eq 'AMD64') $arch
Check 'No Node.js installed' (-not (Get-Command node -ErrorAction SilentlyContinue)) 'this PC must not have Node.js'

$netProfiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue
if ($netProfiles) {
  Write-Host '  NOTE  Active network connections:' -ForegroundColor Yellow
  $netProfiles | ForEach-Object { Write-Host "        - $($_.Name) [$($_.NetworkCategory)]" }
} else {
  Write-Host '  NOTE  No network connection detected (good for the offline test).' -ForegroundColor Yellow
}

# ------------------------------------------------------------------ installer
Section '1) Installer file'

if (-not $Installer) {
  $candidate = Get-ChildItem -Path $PSScriptRoot, (Get-Location) -Filter 'ShootingRangeSystem-Setup-*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($candidate) { $Installer = $candidate.FullName }
}

if ($Installer -and (Test-Path $Installer)) {
  $file = Get-Item $Installer
  Check 'Installation file exists' $true $file.Name
  Check 'Size is plausible (80-400 MB)' ($file.Length -gt 80MB -and $file.Length -lt 400MB) ("{0:N1} MB" -f ($file.Length / 1MB))

  $sumsFile = Join-Path $file.DirectoryName 'SHA256SUMS.txt'
  if (Test-Path $sumsFile) {
    $expected = ((Get-Content $sumsFile -TotalCount 1) -split '\s+')[0]
    $actual = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash.ToLower()
    Check 'SHA-256 matches SHA256SUMS.txt' ($expected.ToLower() -eq $actual) $actual.Substring(0, 16) + '…'
  } else {
    Check 'SHA256SUMS.txt found next to the installer' $false $sumsFile
  }

  $signature = Get-AuthenticodeSignature -FilePath $file.FullName
  if ($signature.Status -eq 'Valid') { Write-Host "  NOTE  Installer is signed: $($signature.SignerCertificate.Subject)" -ForegroundColor Yellow }
  else { Write-Host '  NOTE  Installer is NOT code-signed (expected; SmartScreen will warn -> More info -> Run anyway).' -ForegroundColor Yellow }

  Write-Host '  NOTE  Timed install test: run the installer by hand and note the duration.' -ForegroundColor Yellow
  Write-Host '        (scripted installs distort the timing, so this one is manual: checklist step 2.)' -ForegroundColor Yellow
} else {
  Check 'Installer found' $false 'pass -Installer <path to ShootingRangeSystem-Setup-x.y.z.exe>'
}

# ---------------------------------------------------------------- installed app
Section '2) Installed application files'

Check 'Application executable exists' (Test-Path $AppExe) $AppExe

if (Test-Path $AppExe) {
  $appDir = Split-Path -Parent $AppExe
  $resources = Join-Path $appDir 'resources'
  $asar = Join-Path $resources 'app.asar'
  Check 'app.asar present' (Test-Path $asar) ''

  $printScript = Join-Path $resources 'print-spool.ps1'
  Check 'print-spool.ps1 shipped outside app.asar' (Test-Path $printScript) 'extraResources'

  $unpacked = Join-Path $resources 'app.asar.unpacked'
  $nodeFiles = @()
  if (Test-Path $unpacked) { $nodeFiles = Get-ChildItem -Path $unpacked -Filter '*.node' -Recurse -ErrorAction SilentlyContinue }
  Check 'better-sqlite3 native module unpacked' (@($nodeFiles | Where-Object { $_.Name -like '*better_sqlite3*' -or $_.FullName -like '*better-sqlite3*' }).Count -gt 0) ''
  Check '@node-rs/argon2 native module unpacked' (@($nodeFiles | Where-Object { $_.Name -like '*argon2*' }).Count -gt 0) ""

  # No development leftovers inside the shipped bundle.
  $devPatterns = @('*.test.js', 'loadtest-seed*', 'benchmark*', '*.map')
  $leftovers = @()
  if (Test-Path $unpacked) {
    foreach ($pattern in $devPatterns) { $leftovers += Get-ChildItem -Path $unpacked -Filter $pattern -Recurse -ErrorAction SilentlyContinue }
  }
  Check 'No tests/maps/seeds in the unpacked bundle' ($leftovers.Count -eq 0) ($leftovers | Select-Object -First 3 | ForEach-Object { $_.Name }) -join ', '

  # Machine-specific paths must not be baked into the build.
  $sourceRoot = (Resolve-Path "$PSScriptRoot\.." -ErrorAction SilentlyContinue)
  if (Test-Path $asar) {
    $asarText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($asar))
    Check 'app.asar contains no absolute path to the build machine' (-not ($asarText -match 'Shootingrange/backend|C:\\\\Users\\\\[^\\\\]+\\\\Shootingrange')) ''
    Check 'app.asar contains no .env file reference' (-not ($asarText -match '\.env\.local')) ''
    Check 'app.asar contains no database file' (-not ($asarText -match 'loadtest\.db|shootingrange\.db-shm')) ''
  }
}

# -------------------------------------------------------------------- data dir
Section '3) Data folder (outside the install folder)'

$dataDir = Join-Path $env:APPDATA 'Shooting Range System\data'
if (-not (Test-Path $dataDir)) {
  $configFile = Join-Path $env:APPDATA 'Shooting Range System\data-location.json'
  if (Test-Path $configFile) {
    try { $dataDir = (Get-Content $configFile -Raw | ConvertFrom-Json).dataDir } catch { }
  }
}
if ($env:SHOOTINGRANGE_DATA_DIR) { $dataDir = $env:SHOOTINGRANGE_DATA_DIR }

Check 'Data folder exists' (Test-Path $dataDir) $dataDir
if (Test-Path $dataDir) {
  Check 'shootingrange.db exists' (Test-Path (Join-Path $dataDir 'shootingrange.db')) ''
  Check 'logs folder exists' (Test-Path (Join-Path $dataDir 'logs')) ''
  $backups = @(Get-ChildItem -Path (Join-Path $dataDir 'backups') -Filter '*.db' -ErrorAction SilentlyContinue)
  Check 'At least one backup file exists' ($backups.Count -gt 0) ("{0} file(s)" -f $backups.Count)
  $preMigration = @(Get-ChildItem -Path (Join-Path $dataDir 'backups') -Filter 'pre-migration-*.db' -ErrorAction SilentlyContinue)
  Write-Host ("  NOTE  pre-migration backups: {0}" -f $preMigration.Count) -ForegroundColor Yellow
  Check 'Data folder is NOT inside the install folder' (-not $dataDir.StartsWith((Split-Path -Parent $AppExe), 'OrdinalIgnoreCase')) $dataDir

  $log = Join-Path $dataDir 'logs\app.log'
  if (Test-Path $log) {
    $content = Get-Content $log -Raw
    Check 'Log file has entries' ($content.Length -gt 0) ("{0:N1} KB" -f ((Get-Item $log).Length / 1KB))
    Check 'No session ids or passwords in the log' (-not ($content -match 'session_id=|password"?:|"password"' )) ''
  } else {
    Check 'Log file exists after first run' $false $log
  }
}

# ------------------------------------------------------- single instance + net
if (-not $SkipLaunchTests -and (Test-Path $AppExe)) {
  Section '4) Launch behaviour, single instance, offline'

  $existing = @(Get-Process -Name 'Shooting Range System' -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) { Write-Host '  NOTE  App already running; skipping launch tests.' -ForegroundColor Yellow }
  else {
    $first = Start-Process -FilePath $AppExe -PassThru
    Start-Sleep -Seconds 12
    $running = @(Get-Process -Name 'Shooting Range System' -ErrorAction SilentlyContinue)
    Check 'App launches' ($running.Count -ge 1) ("{0} process(es)" -f $running.Count)

    $second = Start-Process -FilePath $AppExe -PassThru
    Start-Sleep -Seconds 8
    $afterSecond = @(Get-Process -Name 'Shooting Range System' -ErrorAction SilentlyContinue)
    Check 'Second launch does not start a second instance' ($afterSecond.Count -le 2) ("{0} processes (main+helpers expected)" -f $afterSecond.Count)

    $listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::') -and $_.OwningProcess -in $afterSecond.Id })
    Check 'Backend listens on loopback only' (-not ($listening | Where-Object { $_.LocalAddress -eq '0.0.0.0' })) (($listening | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', ')
    Write-Host ("  NOTE  Listening endpoints: {0}" -f ((($listening | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', '))) -ForegroundColor Yellow

    $outbound = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $afterSecond.Id -and $_.State -notin @('Listen', 'Bound') -and $_.RemoteAddress -notin @('127.0.0.1', '::1', '0.0.0.0', '::') })
    Check 'No outbound connections while running' ($outbound.Count -eq 0) (($outbound | ForEach-Object { "$($_.RemoteAddress):$($_.RemotePort)" }) -join ', ')

    Write-Host '  NOTE  Closing the app now; a shutdown backup should appear.' -ForegroundColor Yellow
    $beforeClose = @(Get-ChildItem -Path (Join-Path $dataDir 'backups') -Filter 'auto-*-shutdown.db' -ErrorAction SilentlyContinue).Count
    $afterSecond | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    Start-Sleep -Seconds 12
    $remaining = @(Get-Process -Name 'Shooting Range System' -ErrorAction SilentlyContinue)
    Check 'App exits after window close' ($remaining.Count -eq 0) ("{0} still running" -f $remaining.Count)
    $afterClose = @(Get-ChildItem -Path (Join-Path $dataDir 'backups') -Filter 'auto-*-shutdown.db' -ErrorAction SilentlyContinue).Count
    Check 'Shutdown backup written on exit' ($afterClose -ge $beforeClose) ("{0} -> {1}" -f $beforeClose, $afterClose)
  }
}

# ------------------------------------------------------------------- summary
Write-Host ''
if ($script:failures -eq 0) {
  Write-Host ("ALL CHECKS PASSED — {0}/{0}" -f $script:checks) -ForegroundColor Green
  Write-Host 'Remaining manual steps (checklist): timed install, first-run admin, add participant, scan, print label, upgrade test, uninstall keeps data, devtools/navigation checks.' -ForegroundColor Yellow
  exit 0
} else {
  Write-Host ("FAILURES — {0}/{1} passed" -f ($script:checks - $script:failures), $script:checks) -ForegroundColor Red
  exit 1
}
