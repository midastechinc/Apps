$ErrorActionPreference = "Stop"

# =========================
# CONFIG
# =========================
$NewBaseName = "corpsign"
$SignaturesPath = Join-Path $env:APPDATA "Microsoft\Signatures"

# =========================
# FUNCTIONS
# =========================
function Write-Step {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Get-OutlookOfficeVersion {
    $candidateVersions = @('16.0', '15.0')

    foreach ($version in $candidateVersions) {
        $commonPath = "HKCU:\Software\Microsoft\Office\$version\Common\MailSettings"
        $outlookPath = "HKCU:\Software\Microsoft\Office\$version\Outlook"
        $policyPath = "HKCU:\Software\Microsoft\Office\$version\Common"

        if ((Test-Path $commonPath) -or (Test-Path $outlookPath) -or (Test-Path $policyPath)) {
            return $version
        }
    }

    return '16.0'
}

function Stop-Outlook {
    Write-Step "Closing Outlook if it is running."

    Get-Process OUTLOOK -ErrorAction SilentlyContinue | ForEach-Object {
        try { $_.CloseMainWindow() | Out-Null } catch {}
    }

    Start-Sleep -Seconds 5
    Get-Process OUTLOOK -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    Write-Success "Outlook closed."
}

function Start-Outlook {
    Write-Step "Reopening Outlook."

    $outlookPaths = @(
        "C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE",
        "C:\Program Files (x86)\Microsoft Office\root\Office16\OUTLOOK.EXE",
        "C:\Program Files\Microsoft Office\Office16\OUTLOOK.EXE",
        "C:\Program Files (x86)\Microsoft Office\Office16\OUTLOOK.EXE",
        "C:\Program Files\Microsoft Office\Office15\OUTLOOK.EXE",
        "C:\Program Files (x86)\Microsoft Office\Office15\OUTLOOK.EXE"
    )

    foreach ($path in $outlookPaths) {
        if (Test-Path $path) {
            Start-Process -FilePath $path
            Write-Success "Outlook started from $path"
            return
        }
    }

    try {
        Start-Process -FilePath "outlook.exe" -ErrorAction Stop
        Write-Success "Outlook started from PATH."
    }
    catch {
        Write-Host "[WARN] Could not automatically start Outlook." -ForegroundColor Yellow
    }
}

function Get-SourceSignature {
    param(
        [string]$Folder,
        [string]$TargetName
    )

    $htmFiles = Get-ChildItem -Path $Folder -Filter "*.htm" -File |
        Where-Object { $_.BaseName -ne $TargetName } |
        Sort-Object LastWriteTime -Descending

    if (-not $htmFiles) {
        if (Test-Path (Join-Path $Folder "$TargetName.htm")) {
            return $TargetName
        }

        throw "No signature found in $Folder"
    }

    return ($htmFiles | Select-Object -First 1).BaseName
}

function Rename-SignatureAsset {
    param(
        [string]$SourcePath,
        [string]$DestinationPath
    )

    if (-not (Test-Path $SourcePath)) { return }
    if ($SourcePath -eq $DestinationPath) { return }

    if (Test-Path $DestinationPath) {
        Remove-Item -Path $DestinationPath -Recurse -Force -ErrorAction SilentlyContinue
    }

    Move-Item -Path $SourcePath -Destination $DestinationPath -Force
}

function Update-SignatureHtml {
    param(
        [string]$HtmlPath,
        [string]$OldBaseName,
        [string]$NewBaseName
    )

    $html = [System.IO.File]::ReadAllText($HtmlPath)

    $oldFolder = "${OldBaseName}_files"
    $newFolder = "${NewBaseName}_files"

    $html = $html.Replace($oldFolder, $newFolder)
    $html = $html.Replace($OldBaseName, $NewBaseName)

    [System.IO.File]::WriteAllText($HtmlPath, $html, [System.Text.UTF8Encoding]::new($false))
}

try {
    $officeVersion = Get-OutlookOfficeVersion
    $registryBase = "HKCU:\Software\Microsoft\Office\$officeVersion\Common\MailSettings"

    Write-Step "Detected classic Outlook Office version: $officeVersion"

    Stop-Outlook

    if (-not (Test-Path $SignaturesPath)) {
        throw "Signature folder not found: $SignaturesPath"
    }

    Write-Step "Renaming signature assets."

    $OldBaseName = Get-SourceSignature -Folder $SignaturesPath -TargetName $NewBaseName
    $OldFiles = Join-Path $SignaturesPath "${OldBaseName}_files"
    $NewFiles = Join-Path $SignaturesPath "${NewBaseName}_files"

    Rename-SignatureAsset "$SignaturesPath\$OldBaseName.htm" "$SignaturesPath\$NewBaseName.htm"
    Rename-SignatureAsset "$SignaturesPath\$OldBaseName.rtf" "$SignaturesPath\$NewBaseName.rtf"
    Rename-SignatureAsset "$SignaturesPath\$OldBaseName.txt" "$SignaturesPath\$NewBaseName.txt"
    Rename-SignatureAsset $OldFiles $NewFiles

    Start-Sleep -Seconds 2

    Write-Step "Updating HTML references."

    $htmlPath = Join-Path $SignaturesPath "$NewBaseName.htm"
    if (-not (Test-Path $htmlPath)) {
        throw "Signature HTML file not found: $htmlPath"
    }

    Update-SignatureHtml -HtmlPath $htmlPath -OldBaseName $OldBaseName -NewBaseName $NewBaseName
    Write-Success "Signature HTML updated."

    Write-Step "Setting default signature in $registryBase"

    if (-not (Test-Path $registryBase)) {
        New-Item -Path $registryBase -Force | Out-Null
    }

    Set-ItemProperty -Path $registryBase -Name "NewSignature" -Value $NewBaseName
    Set-ItemProperty -Path $registryBase -Name "ReplySignature" -Value $NewBaseName

    Write-Success "Default signature set for new and reply emails."

    Start-Outlook

    Write-Host ""
    Write-Host "DONE" -ForegroundColor Green
    Write-Host "Signature name: $NewBaseName"
    Write-Host "Office version: $officeVersion"
    Write-Host "Set as default for New & Reply emails"
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
