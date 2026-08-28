[CmdletBinding()]
param(
    [switch]$InstallBrowsers
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    python -m venv (Join-Path $repoRoot '.venv')
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -e "$repoRoot\apps\server[dev]"
pnpm --dir $repoRoot install --no-frozen-lockfile

if ($InstallBrowsers) {
    pnpm --dir $repoRoot exec playwright install chromium
}

Write-Host 'Workspace dependencies are ready. Run .\\scripts\\bootstrap.ps1 -InstallBrowsers before local E2E tests.'
