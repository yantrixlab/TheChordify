# Builds the Android release (the .aab for Google Play and an installable .apk) from a copy of the app kept at a short path.
#
# Why a copy: this project lives in a deep folder, and the release build of the native code makes file paths longer than the
# 260 characters Windows allows. The copy goes to C:\cs (the project's sources only: no node_modules or build folders are
# taken from here), is built there, and the results are copied back to mobile\release\.
#
#   .\mobile\scripts\release-build.ps1
#
# (If your PowerShell policy refuses to run scripts, run its steps by hand: sync the two folders with robocopy, `npm ci`, then
# `gradlew bundleRelease assembleRelease` in C:\cs\mobile\android.)
#
# The upload key and its passwords are read from ~\.gradle\gradle.properties (CHORDSUNO_UPLOAD_*), never from the repository.
param([string]$Work = "C:\cs")

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path

function Sync($from, $to) {
  New-Item -ItemType Directory -Force $to | Out-Null
  robocopy $from $to /MIR /XD node_modules build .cxx .gradle .idea Pods release /XF *.log /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE) for $from" }
}

Sync "$repo\mobile" "$Work\mobile"
# the chord fingerings the app shares with the website (see metro.config.js)
Sync "$repo\absolute-ablation\src\lib" "$Work\absolute-ablation\src\lib"

Push-Location "$Work\mobile"
try {
  $stamp = "$Work\mobile\node_modules\.lock-copy"
  if (-not (Test-Path $stamp) -or ((Get-FileHash package-lock.json).Hash -ne (Get-Content $stamp -ErrorAction SilentlyContinue))) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    (Get-FileHash package-lock.json).Hash | Set-Content $stamp
  }
  Push-Location android
  try {
    .\gradlew.bat bundleRelease assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "gradle failed" }
  } finally { Pop-Location }
} finally { Pop-Location }

$out = "$repo\mobile\release"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item "$Work\mobile\android\app\build\outputs\bundle\release\app-release.aab" $out -Force
Get-ChildItem "$Work\mobile\android\app\build\outputs\apk\release\*.apk" | Copy-Item -Destination $out -Force
Get-ChildItem $out | Select-Object Name, Length
