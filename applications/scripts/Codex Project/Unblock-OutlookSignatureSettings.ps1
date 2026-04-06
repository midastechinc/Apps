Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$mailSettingsPath = 'HKCU:\Software\Microsoft\Office\16.0\Common\MailSettings'
$outlookSetupPath = 'HKCU:\Software\Microsoft\Office\16.0\Outlook\Setup'
$outlookPolicySetupPath = 'HKCU:\Software\Policies\Microsoft\Office\16.0\Outlook\Setup'

function Write-Step {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Remove-RegistryValueIfPresent {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    try {
        Remove-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
        Write-Success "Removed $Name from $Path"
    }
    catch {
        try {
            $null = (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
            throw
        }
        catch {
            Write-Warn "$Name was not present under $Path"
        }
    }
}

try {
    Write-Step 'Removing Outlook signature lock and roaming-control registry values.'

    Remove-RegistryValueIfPresent -Path $mailSettingsPath -Name 'DisableSignatures'
    Remove-RegistryValueIfPresent -Path $outlookSetupPath -Name 'DisableRoamingSignaturesTemporaryToggle'
    Remove-RegistryValueIfPresent -Path $outlookSetupPath -Name 'DisableRoamingSignatures'
    Remove-RegistryValueIfPresent -Path $outlookPolicySetupPath -Name 'DisableRoamingSettings'

    Write-Success 'Outlook signature settings are unblocked.'
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
