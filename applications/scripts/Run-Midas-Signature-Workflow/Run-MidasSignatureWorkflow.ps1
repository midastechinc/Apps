Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$mainScriptPath = 'C:\Users\AliJaffar\Downloads\Codex Project\Set-MidasOutlookSignature.ps1'
$mailSettingsPath = 'HKCU:\Software\Microsoft\Office\16.0\Common\MailSettings'
$signatureName = 'MidasSignature'

function Write-Step {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Wait-ThreeSeconds {
    Write-Step 'Waiting 3 seconds.'
    Start-Sleep -Seconds 3
}

try {
    if (-not (Test-Path -LiteralPath $mainScriptPath)) {
        throw "Main script not found: $mainScriptPath"
    }

    Write-Step 'Step 1: Running Set-MidasOutlookSignature.ps1 with -LockSignatureEditing.'
    & powershell -ExecutionPolicy Bypass -File $mainScriptPath -LockSignatureEditing
    if ($LASTEXITCODE -ne 0) {
        throw "Step 1 failed with exit code $LASTEXITCODE."
    }
    Write-Success 'Step 1 completed.'

    Wait-ThreeSeconds

    Write-Step 'Step 2: Removing DisableSignatures.'
    Remove-ItemProperty -Path $mailSettingsPath -Name 'DisableSignatures' -ErrorAction SilentlyContinue
    Write-Success 'Step 2 completed.'

    Wait-ThreeSeconds

    Write-Step "Step 3: Rewriting NewSignature and ReplySignature to '$signatureName'."
    Set-ItemProperty -Path $mailSettingsPath -Name 'NewSignature' -Value $signatureName
    Set-ItemProperty -Path $mailSettingsPath -Name 'ReplySignature' -Value $signatureName
    Write-Success 'Step 3 completed.'

    Write-Success 'Midas signature workflow completed successfully.'
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
