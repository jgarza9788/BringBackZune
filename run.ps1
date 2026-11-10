# Builds Bring Back Zune and launches it.
# Usage:  .\run.ps1            (install deps if needed, build, run)
#         .\run.ps1 -Clean     (reinstall dependencies first)
param([switch]$Clean)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if ($Clean -and (Test-Path node_modules)) {
    Write-Host 'Removing node_modules...' -ForegroundColor Yellow
    Remove-Item -Recurse -Force node_modules
}

if (-not (Test-Path node_modules)) {
    Write-Host 'Installing dependencies...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'Building and starting...' -ForegroundColor Cyan
npm start
exit $LASTEXITCODE
