param(
  [switch]$Bootstrap,
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $projectRoot ".env.local"
$venvActivate = Join-Path $projectRoot ".venv\Scripts\Activate.ps1"
$requirementsFile = Join-Path $projectRoot "requirements-linkedin.txt"
$scriptFile = Join-Path $projectRoot "scripts\linkedin_scraper.py"

function Write-Step($message) {
  Write-Host "[LinkedIn Pull] $message" -ForegroundColor Cyan
}

function Import-DotEnvFile([string]$path) {
  if (-not (Test-Path $path)) {
    throw "Missing .env.local at $path. Copy .env.example to .env.local and fill in your values first."
  }

  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) {
      return
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if (-not (Test-Path $venvActivate)) {
  throw "Missing virtual environment at $venvActivate. Run: py -3 -m venv .venv"
}

Write-Step "Loading local scraper settings from .env.local"
Import-DotEnvFile $envFile

Write-Step "Activating Python virtual environment"
. $venvActivate

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python is not available after activating the virtual environment."
}

Write-Step "Ensuring Python dependencies are installed"
python -m pip install -r $requirementsFile | Out-Host

Write-Step "Ensuring Playwright Chromium is installed"
python -m playwright install chromium | Out-Host

[Environment]::SetEnvironmentVariable("LINKEDIN_BOOTSTRAP_SESSION_ONLY", ($(if ($Bootstrap) { "true" } else { "false" })), "Process")
[Environment]::SetEnvironmentVariable("LINKEDIN_HEADLESS", ($(if ($Visible -or $Bootstrap) { "false" } else { "true" })), "Process")

Set-Location $projectRoot
Write-Step "Starting scraper"
python $scriptFile
