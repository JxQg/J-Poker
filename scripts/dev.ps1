[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$venvScripts = Join-Path $repoRoot '.venv\Scripts'

if (-not (Test-Path -LiteralPath (Join-Path $venvScripts 'python.exe'))) {
    throw 'Run scripts/bootstrap.ps1 before starting the application.'
}

$env:Path = "$venvScripts;$env:Path"
Set-Location -LiteralPath $repoRoot
pnpm dev

