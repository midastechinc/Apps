param(
    [string]$StandardSignatureName = 'MidasSignature',
    [switch]$DiagnosticMode,
    [switch]$LockSignatureEditing,
    [switch]$ForceThenUnlock
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$mailSettingsPath = 'HKCU:\Software\Microsoft\Office\16.0\Common\MailSettings'
$commonGeneralPath = 'HKCU:\Software\Microsoft\Office\16.0\Common\General'
$outlookRootPath = 'HKCU:\Software\Microsoft\Office\16.0\Outlook'
$outlookSetupPath = 'HKCU:\Software\Microsoft\Office\16.0\Outlook\Setup'
$outlookPolicySetupPath = 'HKCU:\Software\Policies\Microsoft\Office\16.0\Outlook\Setup'
$outlookSettingsPath = 'HKCU:\Software\Microsoft\Office\Outlook\Settings'
$signaturesPath = Join-Path -Path $env:APPDATA -ChildPath 'Microsoft\Signatures'
$accountSectionGuid = '9375CFF0413111d3B88A00104B2A6676'
$officeRootPath = 'HKCU:\Software\Microsoft\Office\16.0'

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

function Write-Plain {
    param([string]$Message)
    Write-Host $Message
}

function Ensure-RegistryKey {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
}

function Set-RegistryValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][Microsoft.Win32.RegistryValueKind]$ValueKind
    )

    Ensure-RegistryKey -Path $Path

    $regPath = $Path -replace '^HKCU:\\', 'HKCU\'
    $regType = switch ($ValueKind) {
        ([Microsoft.Win32.RegistryValueKind]::String) { 'REG_SZ' }
        ([Microsoft.Win32.RegistryValueKind]::ExpandString) { 'REG_EXPAND_SZ' }
        ([Microsoft.Win32.RegistryValueKind]::DWord) { 'REG_DWORD' }
        default { throw "Unsupported registry value type: $ValueKind" }
    }

    $valueText = [string]$Value
    $arguments = @('add', $regPath, '/v', $Name, '/t', $regType, '/d', $valueText, '/f')
    $output = & reg.exe @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $message = ($output | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($message)) {
            $message = "reg.exe failed while writing $Name under $Path (exit code $LASTEXITCODE)."
        }

        throw $message
    }
}

function Assert-RegistryValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][object]$ExpectedValue
    )

    $actual = (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
    if ([string]$actual -ne [string]$ExpectedValue) {
        throw "Registry verification failed for $Path\$Name. Expected '$ExpectedValue' but found '$actual'."
    }
}

function Reset-OutlookSettingsCache {
    if (-not (Test-Path -Path $outlookSettingsPath)) {
        Write-Success 'No Outlook cloud settings cache key was present.'
        return
    }

    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $newName = "Settings_old_$timestamp"
    Write-Step "Resetting cached Outlook cloud settings by renaming '$outlookSettingsPath' to '$newName'."
    Rename-Item -Path $outlookSettingsPath -NewName $newName -ErrorAction Stop
    Write-Success 'Outlook cloud settings cache reset.'
}

function Set-OutlookProfileSignatureDefaults {
    param([Parameter(Mandatory = $true)][string]$SignatureName)

    Write-Step 'Applying signature defaults to Outlook profile account settings.'

    $defaultProfile = $null
    try {
        $defaultProfile = (Get-ItemProperty -Path $outlookRootPath -Name 'DefaultProfile' -ErrorAction Stop).DefaultProfile
    }
    catch {
        Write-Warn 'Could not read Outlook DefaultProfile. Skipping profile-level signature binding.'
        return
    }

    if ([string]::IsNullOrWhiteSpace($defaultProfile)) {
        Write-Warn 'Outlook DefaultProfile was empty. Skipping profile-level signature binding.'
        return
    }

    $profileSectionPath = Join-Path -Path $outlookRootPath -ChildPath "Profiles\$defaultProfile\$accountSectionGuid"
    if (-not (Test-Path -Path $profileSectionPath)) {
        Write-Warn "Profile section not found: $profileSectionPath"
        return
    }

    $subKeys = @(Get-ChildItem -Path $profileSectionPath -ErrorAction SilentlyContinue)
    if ($subKeys.Count -eq 0) {
        Write-Warn 'No Outlook account subkeys were found under the default profile section.'
        return
    }

    $updatedCount = 0

    foreach ($subKey in $subKeys) {
        try {
            New-ItemProperty -Path $subKey.PSPath -Name 'New Signature' -Value $SignatureName -PropertyType String -Force -ErrorAction Stop | Out-Null
            New-ItemProperty -Path $subKey.PSPath -Name 'Reply-Forward Signature' -Value $SignatureName -PropertyType String -Force -ErrorAction Stop | Out-Null

            $newValue = (Get-ItemProperty -Path $subKey.PSPath -Name 'New Signature' -ErrorAction Stop).'New Signature'
            $replyValue = (Get-ItemProperty -Path $subKey.PSPath -Name 'Reply-Forward Signature' -ErrorAction Stop).'Reply-Forward Signature'

            if ($newValue -eq $SignatureName -and $replyValue -eq $SignatureName) {
                $updatedCount++
            }
        }
        catch {
            Write-Warn "Could not update profile key $($subKey.PSChildName): $($_.Exception.Message)"
        }
    }

    if ($updatedCount -gt 0) {
        Write-Success "Profile-level signature defaults applied to $updatedCount Outlook account key(s) in profile '$defaultProfile'."
    }
    else {
        Write-Warn "No Outlook account keys were updated in profile '$defaultProfile'."
    }
}

function Get-RegistryValueIfPresent {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    try {
        return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name
    }
    catch {
        return $null
    }
}

function Show-OutlookDiagnostics {
    Write-Step 'Collecting Outlook diagnostics.'

    Write-Plain ''
    Write-Plain '=== Outlook Diagnostics ==='
    Write-Plain "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Write-Plain "User: $env:USERNAME"
    Write-Plain "Computer: $env:COMPUTERNAME"
    Write-Plain "Signature folder: $signaturesPath"
    Write-Plain "Signature HTML exists: $(Test-Path (Join-Path $signaturesPath "$StandardSignatureName.htm"))"

    $outlookExePath = $null
    foreach ($candidate in @(
            'C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE',
            'C:\Program Files (x86)\Microsoft Office\root\Office16\OUTLOOK.EXE',
            'C:\Program Files\Microsoft Office\Office16\OUTLOOK.EXE',
            'C:\Program Files (x86)\Microsoft Office\Office16\OUTLOOK.EXE'
        )) {
        if (Test-Path -LiteralPath $candidate) {
            $outlookExePath = $candidate
            break
        }
    }

    if ($outlookExePath) {
        $versionInfo = (Get-Item -LiteralPath $outlookExePath).VersionInfo
        Write-Plain "Outlook EXE: $outlookExePath"
        Write-Plain "Outlook version: $($versionInfo.FileVersion)"
        Write-Plain "Outlook product version: $($versionInfo.ProductVersion)"
    }
    else {
        Write-Plain 'Outlook EXE: not found in common Office16 paths'
    }

    Write-Plain ''
    Write-Plain '--- Common MailSettings ---'
    foreach ($name in @('NewSignature', 'ReplySignature', 'DisableSignatures')) {
        Write-Plain "$name = $(Get-RegistryValueIfPresent -Path $mailSettingsPath -Name $name)"
    }

    Write-Plain ''
    Write-Plain '--- Outlook Setup ---'
    foreach ($name in @('DisableRoamingSignaturesTemporaryToggle', 'DisableRoamingSignatures', 'First-Run')) {
        Write-Plain "$name = $(Get-RegistryValueIfPresent -Path $outlookSetupPath -Name $name)"
    }

    Write-Plain ''
    Write-Plain '--- Outlook Root ---'
    $defaultProfile = Get-RegistryValueIfPresent -Path $outlookRootPath -Name 'DefaultProfile'
    Write-Plain "DefaultProfile = $defaultProfile"

    $profilesRoot = Join-Path -Path $outlookRootPath -ChildPath 'Profiles'
    Write-Plain ''
    Write-Plain '--- Profiles ---'
    if (Test-Path -Path $profilesRoot) {
        $profiles = @(Get-ChildItem -Path $profilesRoot -ErrorAction SilentlyContinue)
        if ($profiles.Count -eq 0) {
            Write-Plain 'No profiles found.'
        }
        else {
            foreach ($profile in $profiles) {
                Write-Plain "Profile: $($profile.PSChildName)"
                $sectionPath = Join-Path -Path $profile.PSPath -ChildPath $accountSectionGuid
                if (-not (Test-Path -Path $sectionPath)) {
                    Write-Plain '  Account section: missing'
                    continue
                }

                $accountKeys = @(Get-ChildItem -Path $sectionPath -ErrorAction SilentlyContinue)
                Write-Plain "  Account section keys: $($accountKeys.Count)"

                foreach ($accountKey in $accountKeys) {
                    $props = Get-ItemProperty -Path $accountKey.PSPath -ErrorAction SilentlyContinue
                    $accountName = $null
                    foreach ($candidateName in @('Account Name', 'Display Name', 'Email', 'SMTP Email Address', 'SMTP Address')) {
                        if ($props -and $props.PSObject.Properties[$candidateName]) {
                            $accountName = $props.$candidateName
                            if (-not [string]::IsNullOrWhiteSpace([string]$accountName)) { break }
                        }
                    }

                    $newSig = $null
                    $replySig = $null
                    if ($props -and $props.PSObject.Properties['New Signature']) {
                        $newSig = $props.'New Signature'
                    }

                    if ($props -and $props.PSObject.Properties['Reply-Forward Signature']) {
                        $replySig = $props.'Reply-Forward Signature'
                    }

                    Write-Plain "  Key: $($accountKey.PSChildName)"
                    Write-Plain "    AccountHint: $accountName"
                    Write-Plain "    New Signature: $newSig"
                    Write-Plain "    Reply-Forward Signature: $replySig"
                }
            }
        }
    }
    else {
        Write-Plain 'Profiles root not found.'
    }

    Write-Plain ''
    Write-Plain '=== End Diagnostics ==='
}

function Stop-OutlookIfRunning {
    Write-Step 'Checking whether Outlook is running.'

    $outlookProcesses = @(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)
    if ($outlookProcesses.Count -eq 0) {
        Write-Success 'Outlook is not running.'
        return
    }

    Write-Warn "Found $($outlookProcesses.Count) Outlook process(es). Closing them forcefully."
    $outlookProcesses | Stop-Process -Force -ErrorAction Stop

    Start-Sleep -Seconds 2

    if (Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue) {
        throw 'Outlook is still running after Stop-Process.'
    }

    Write-Success 'Outlook closed.'
}

function Get-SignatureCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$FolderPath,
        [Parameter(Mandatory = $true)][string]$ReservedName
    )

    if (-not (Test-Path -Path $FolderPath)) {
        throw "Signature folder not found: $FolderPath"
    }

    $htmlFiles = @(Get-ChildItem -Path $FolderPath -Filter '*.htm' -File | Sort-Object LastWriteTime -Descending)
    if ($htmlFiles.Count -eq 0) {
        throw "No .htm signature files were found in $FolderPath"
    }

    $preferred = @($htmlFiles | Where-Object { $_.BaseName -ne $ReservedName })
    if ($preferred.Count -gt 0) {
        return $preferred[0]
    }

    $existingTarget = $htmlFiles | Where-Object { $_.BaseName -eq $ReservedName } | Select-Object -First 1
    if ($null -eq $existingTarget) {
        throw 'No suitable signature source was found.'
    }

    return $existingTarget
}

function Move-SignatureAsset {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    if (-not (Test-Path -LiteralPath $SourcePath)) {
        return
    }

    if ($SourcePath -ieq $DestinationPath) {
        return
    }

    if (Test-Path -LiteralPath $DestinationPath) {
        Remove-Item -LiteralPath $DestinationPath -Recurse -Force -ErrorAction Stop
    }

    Move-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force -ErrorAction Stop
}

function Update-SignatureHtml {
    param(
        [Parameter(Mandatory = $true)][string]$HtmlPath,
        [Parameter(Mandatory = $true)][string]$OldBaseName,
        [Parameter(Mandatory = $true)][string]$NewBaseName,
        [Parameter(Mandatory = $true)][string]$SignatureRoot
    )

    $content = Get-Content -LiteralPath $HtmlPath -Raw -Encoding UTF8

    $oldFolderName = "${OldBaseName}_files"
    $newFolderName = "${NewBaseName}_files"
    $oldEncodedFolderName = [System.Uri]::EscapeDataString($oldFolderName).Replace('%5C', '/')
    $newEncodedFolderName = [System.Uri]::EscapeDataString($newFolderName).Replace('%5C', '/')
    $oldAbsoluteFolder = (Join-Path -Path $SignatureRoot -ChildPath $oldFolderName)
    $newAbsoluteFolder = (Join-Path -Path $SignatureRoot -ChildPath $newFolderName)

    $escapedOldFolderName = [Regex]::Escape($oldFolderName)
    $escapedOldEncodedFolderName = [Regex]::Escape($oldEncodedFolderName)
    $escapedOldAbsoluteFolder = [Regex]::Escape($oldAbsoluteFolder).Replace('\\\\', '[\\/]')
    $escapedOldBaseName = [Regex]::Escape($OldBaseName)

    $content = [Regex]::Replace($content, $escapedOldAbsoluteFolder, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newAbsoluteFolder }, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $content = [Regex]::Replace($content, $escapedOldEncodedFolderName, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newEncodedFolderName }, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $content = [Regex]::Replace($content, $escapedOldFolderName, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newFolderName }, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $content = [Regex]::Replace($content, $escapedOldBaseName, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $NewBaseName }, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

    Set-Content -LiteralPath $HtmlPath -Value $content -Encoding UTF8
}

function Set-OutlookSignatureDefaults {
    param(
        [Parameter(Mandatory = $true)][string]$SignatureName,
        [switch]$LockEditing
    )

    Write-Step 'Writing Outlook registry settings.'

    Set-RegistryValue -Path $commonGeneralPath -Name 'Signatures' -Value 'Signatures' -ValueKind ([Microsoft.Win32.RegistryValueKind]::String)
    Set-RegistryValue -Path $mailSettingsPath -Name 'NewSignature' -Value $SignatureName -ValueKind ([Microsoft.Win32.RegistryValueKind]::ExpandString)
    Set-RegistryValue -Path $mailSettingsPath -Name 'ReplySignature' -Value $SignatureName -ValueKind ([Microsoft.Win32.RegistryValueKind]::ExpandString)
    Set-RegistryValue -Path $outlookSetupPath -Name 'DisableRoamingSignaturesTemporaryToggle' -Value 1 -ValueKind ([Microsoft.Win32.RegistryValueKind]::DWord)
    Set-RegistryValue -Path $outlookSetupPath -Name 'DisableRoamingSignatures' -Value 1 -ValueKind ([Microsoft.Win32.RegistryValueKind]::DWord)

    if ($LockEditing) {
        Set-RegistryValue -Path $mailSettingsPath -Name 'DisableSignatures' -Value 1 -ValueKind ([Microsoft.Win32.RegistryValueKind]::DWord)
    }
    else {
        try {
            Remove-ItemProperty -Path $mailSettingsPath -Name 'DisableSignatures' -ErrorAction Stop
            Write-Success 'Removed DisableSignatures so Outlook can apply defaults without the editor lock.'
        }
        catch {
            if ((Get-RegistryValueIfPresent -Path $mailSettingsPath -Name 'DisableSignatures') -ne $null) {
                throw
            }
        }
    }

    try {
        Set-RegistryValue -Path $outlookPolicySetupPath -Name 'DisableRoamingSettings' -Value 1 -ValueKind ([Microsoft.Win32.RegistryValueKind]::DWord)
        Assert-RegistryValue -Path $outlookPolicySetupPath -Name 'DisableRoamingSettings' -ExpectedValue 1
        Write-Success 'Optional Outlook policy cache setting applied.'
    }
    catch {
        Write-Warn "Skipping optional policy key because it could not be written: $($_.Exception.Message)"
    }

    if (Test-Path -Path $outlookSetupPath) {
        Remove-ItemProperty -Path $outlookSetupPath -Name 'First-Run' -ErrorAction SilentlyContinue
    }

    Assert-RegistryValue -Path $commonGeneralPath -Name 'Signatures' -ExpectedValue 'Signatures'
    Assert-RegistryValue -Path $mailSettingsPath -Name 'NewSignature' -ExpectedValue $SignatureName
    Assert-RegistryValue -Path $mailSettingsPath -Name 'ReplySignature' -ExpectedValue $SignatureName
    Assert-RegistryValue -Path $outlookSetupPath -Name 'DisableRoamingSignaturesTemporaryToggle' -ExpectedValue 1
    Assert-RegistryValue -Path $outlookSetupPath -Name 'DisableRoamingSignatures' -ExpectedValue 1

    if ($LockEditing) {
        Assert-RegistryValue -Path $mailSettingsPath -Name 'DisableSignatures' -ExpectedValue 1
    }

    Write-Success 'Outlook registry settings updated.'
}

function Remove-DisableSignaturesLock {
    try {
        Remove-ItemProperty -Path $mailSettingsPath -Name 'DisableSignatures' -ErrorAction Stop
        Write-Success 'Removed DisableSignatures after setup.'
    }
    catch {
        if ((Get-RegistryValueIfPresent -Path $mailSettingsPath -Name 'DisableSignatures') -ne $null) {
            throw
        }

        Write-Success 'DisableSignatures was already absent.'
    }
}

function Start-Outlook {
    Write-Step 'Reopening Outlook.'

    $candidates = @(
        'C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE',
        'C:\Program Files (x86)\Microsoft Office\root\Office16\OUTLOOK.EXE',
        'C:\Program Files\Microsoft Office\Office16\OUTLOOK.EXE',
        'C:\Program Files (x86)\Microsoft Office\Office16\OUTLOOK.EXE'
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            Start-Process -FilePath $candidate | Out-Null
            Write-Success "Outlook started from $candidate"
            return
        }
    }

    try {
        Start-Process -FilePath 'outlook.exe' | Out-Null
        Write-Success 'Outlook started from PATH lookup.'
    }
    catch {
        Write-Warn 'Could not find an Outlook executable automatically. Start Outlook manually if needed.'
    }
}

try {
    if ($DiagnosticMode) {
        Show-OutlookDiagnostics
        exit 0
    }

    if ($LockSignatureEditing -and $ForceThenUnlock) {
        throw 'Use either -LockSignatureEditing or -ForceThenUnlock, not both together.'
    }

    Write-Step 'Starting Outlook signature standardization.'
    Stop-OutlookIfRunning

    Write-Step "Inspecting signature folder: $signaturesPath"
    $sourceHtml = Get-SignatureCandidate -FolderPath $signaturesPath -ReservedName $StandardSignatureName
    $oldBaseName = $sourceHtml.BaseName
    Write-Success "Detected signature source: $oldBaseName"

    if ($oldBaseName -ne $StandardSignatureName) {
        Write-Step "Renaming signature assets from '$oldBaseName' to '$StandardSignatureName'."

        Move-SignatureAsset -SourcePath (Join-Path $signaturesPath "$oldBaseName.htm") -DestinationPath (Join-Path $signaturesPath "$StandardSignatureName.htm")
        Move-SignatureAsset -SourcePath (Join-Path $signaturesPath "$oldBaseName.rtf") -DestinationPath (Join-Path $signaturesPath "$StandardSignatureName.rtf")
        Move-SignatureAsset -SourcePath (Join-Path $signaturesPath "$oldBaseName.txt") -DestinationPath (Join-Path $signaturesPath "$StandardSignatureName.txt")
        Move-SignatureAsset -SourcePath (Join-Path $signaturesPath "${oldBaseName}_files") -DestinationPath (Join-Path $signaturesPath "${StandardSignatureName}_files")
    }
    else {
        Write-Success 'Signature is already using the standardized name.'
    }

    $standardHtmlPath = Join-Path -Path $signaturesPath -ChildPath "$StandardSignatureName.htm"
    if (-not (Test-Path -LiteralPath $standardHtmlPath)) {
        throw "Expected signature HTML file is missing: $standardHtmlPath"
    }

    Write-Step 'Repairing HTML references after rename.'
    Update-SignatureHtml -HtmlPath $standardHtmlPath -OldBaseName $oldBaseName -NewBaseName $StandardSignatureName -SignatureRoot $signaturesPath
    Write-Success 'Signature HTML updated.'

    $shouldLockEditing = $LockSignatureEditing -or $ForceThenUnlock
    Set-OutlookSignatureDefaults -SignatureName $StandardSignatureName -LockEditing:$shouldLockEditing
    Set-OutlookProfileSignatureDefaults -SignatureName $StandardSignatureName

    if ($ForceThenUnlock) {
        Remove-DisableSignaturesLock
    }

    Reset-OutlookSettingsCache
    Start-Outlook

    Write-Success 'Completed successfully.'
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
