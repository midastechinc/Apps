$ErrorActionPreference = 'Stop'

$outputDir = Join-Path $PSScriptRoot 'migration-report'
if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

function Get-InstalledApps {
    $paths = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    $apps = foreach ($path in $paths) {
        Get-ItemProperty $path -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne '' } |
            ForEach-Object {
                [pscustomobject]@{
                    Scope = if ($path -like 'HKCU:*') { 'CurrentUser' } else { 'Machine' }
                    Name = $_.DisplayName
                    Version = $_.DisplayVersion
                    Publisher = $_.Publisher
                    InstallDate = $_.InstallDate
                    InstallLocation = $_.InstallLocation
                    UninstallString = $_.UninstallString
                }
            }
    }

    $apps |
        Sort-Object Name, Version -Unique
}

function Get-WindowsKeyInfo {
    $keyPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SoftwareProtectionPlatform'
    $keyInfo = Get-ItemProperty $keyPath -ErrorAction SilentlyContinue
    [pscustomobject]@{
        ProductName = (Get-ComputerInfo).WindowsProductName
        ProductKey = $keyInfo.BackupProductKeyDefault
        KeyStatus = if ($keyInfo.BackupProductKeyDefault) { 'Recovered from registry' } else { 'Not recovered' }
        MigrationMethod = 'Install same Windows edition on the new PC; activation may use a digital license or the vendor/OEM key.'
        Notes = 'For a new computer, Windows is often licensed with the new hardware already. Old OEM licenses usually stay with the old device.'
    }
}

function Get-OfficeInfo {
    $configPath = 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration'
    $config = Get-ItemProperty $configPath -ErrorAction SilentlyContinue
    if (-not $config) {
        return $null
    }

    [pscustomobject]@{
        ProductReleaseIds = $config.ProductReleaseIds
        VersionToReport = $config.VersionToReport
        KeyStatus = 'Full key not stored in a retrievable form'
        ProductKey = $null
        MigrationMethod = 'Sign in at office.com with the same Microsoft or work account and reinstall.'
        Notes = 'Detected Click-to-Run products are usually activated by account sign-in, not by a visible local key.'
    }
}

function Get-MigrationProfile {
    param(
        [string]$Name,
        [string]$Publisher
    )

    $text = "$Name $Publisher"

    if ($text -match 'Adobe Creative Cloud') {
        return @{
            Type = 'Subscription'
            MigrationMethod = 'Install from Adobe Creative Cloud and sign in.'
            KeyStatus = 'Account-based'
            InstallationKey = ''
            Notes = 'Adobe allows install on more than one computer, but active sign-in is limited; deactivate the old device if prompted.'
        }
    }

    if ($text -match 'Adobe Genuine Service|Adobe Refresh Manager') {
        return @{
            Type = 'Dependency/Runtime'
            MigrationMethod = 'Do not migrate manually; these helper components return with Adobe app installation.'
            KeyStatus = 'No product key needed'
            InstallationKey = ''
            Notes = 'Support component for Adobe applications.'
        }
    }

    if ($text -match 'Adobe Acrobat XI Pro') {
        return @{
            Type = 'Perpetual/Legacy'
            MigrationMethod = 'Reinstall from original installer or Adobe account/order history if available.'
            KeyStatus = 'Not found locally'
            InstallationKey = ''
            Notes = 'Legacy Adobe perpetual apps often require the original serial or installer source.'
        }
    }

    if ($text -match 'Office|Microsoft 365|Visio') {
        return @{
            Type = 'Account-based'
            MigrationMethod = 'Reinstall from office.com with the same account.'
            KeyStatus = 'Account-based'
            InstallationKey = ''
            Notes = 'This PC has Click-to-Run Office products; activation is typically tied to the account.'
        }
    }

    if ($text -match 'Windows') {
        return @{
            Type = 'System'
            MigrationMethod = 'Use the new PC license or sign in with the same Microsoft account if a digital license applies.'
            KeyStatus = 'See separate Windows row'
            InstallationKey = ''
            Notes = 'System components usually are not migrated app-by-app.'
        }
    }

    if ($text -match 'Huntress|Datto|SonicWall|Splashtop|TELUS Business Connect|Global VPN Client') {
        return @{
            Type = 'Business-managed'
            MigrationMethod = 'Reinstall from your IT admin, MSP portal, or vendor account.'
            KeyStatus = 'Usually managed by business account'
            InstallationKey = ''
            Notes = 'This software is commonly tied to company-managed deployment, policy, or tenant settings.'
        }
    }

    if ($text -match 'Chrome|Google Drive|Android Studio|Git|Node\.js|PowerShell|VLC|WinMerge|calibre|AnyDesk|BlueStacks|Kobo|UltraViewer|ISO to USB|Advanced IP Scanner|Samsung USB Driver|Microsoft OneDrive|PowerToys|Power Automate for desktop|Google Workspace Migration for Microsoft Outlook') {
        return @{
            Type = 'Free/Standard download'
            MigrationMethod = 'Download latest installer and sign in only if the app uses an account.'
            KeyStatus = 'No product key needed'
            InstallationKey = ''
            Notes = 'Usually safe to reinstall directly from the vendor site.'
        }
    }

    if ($text -match 'Visual C\+\+|\.NET|Desktop Runtime|Host FX Resolver|Launcher Prerequisites|Dokan Library|Teams Machine-Wide Installer|Office 16 Click-to-Run|Microsoft Edge|WebView2|GameInput|Update Health Tools|Lenovo Active Protection System') {
        return @{
            Type = 'Dependency/Runtime'
            MigrationMethod = 'Usually do not migrate manually; reinstall automatically with the apps that need them.'
            KeyStatus = 'No product key needed'
            InstallationKey = ''
            Notes = 'These are support components rather than primary apps.'
        }
    }

    if ($text -match 'Vectorworks|Vision 2026|Disk Drill|ScanSnap Home|TeamViewer|Lorex|VMS|iSpy|Agent DVR|IP Watcher|Advik') {
        return @{
            Type = 'Commercial or specialized'
            MigrationMethod = 'Use the original vendor installer and your vendor account, order email, or serial record.'
            KeyStatus = 'Check vendor portal/order email'
            InstallationKey = ''
            Notes = 'A key may exist, but it was not recoverable from standard uninstall registry data.'
        }
    }

    return @{
        Type = 'Unknown'
        MigrationMethod = 'Reinstall from the original vendor source and verify licensing before moving.'
        KeyStatus = 'Unknown'
        InstallationKey = ''
        Notes = 'No locally retrievable key was found in standard inventory locations.'
    }
}

$apps = Get-InstalledApps
$windows = Get-WindowsKeyInfo
$office = Get-OfficeInfo

$rows = foreach ($app in $apps) {
    $profile = Get-MigrationProfile -Name $app.Name -Publisher $app.Publisher
    [pscustomobject]@{
        Application = $app.Name
        Version = $app.Version
        Publisher = $app.Publisher
        Scope = $app.Scope
        InstallDate = $app.InstallDate
        InstallLocation = $app.InstallLocation
        MigrationType = $profile.Type
        MigrationMethod = $profile.MigrationMethod
        KeyStatus = $profile.KeyStatus
        InstallationKey = $profile.InstallationKey
        Notes = $profile.Notes
        UninstallString = $app.UninstallString
    }
}

$specialRows = @(
    [pscustomobject]@{
        Application = $windows.ProductName
        Version = ''
        Publisher = 'Microsoft'
        Scope = 'Machine'
        InstallDate = ''
        InstallLocation = ''
        MigrationType = 'System License'
        MigrationMethod = $windows.MigrationMethod
        KeyStatus = $windows.KeyStatus
        InstallationKey = $windows.ProductKey
        Notes = $windows.Notes
        UninstallString = ''
    }
)

if ($office) {
    $specialRows += [pscustomobject]@{
        Application = 'Microsoft Office / Microsoft 365'
        Version = $office.VersionToReport
        Publisher = 'Microsoft'
        Scope = 'Machine'
        InstallDate = ''
        InstallLocation = ''
        MigrationType = 'Account-based'
        MigrationMethod = $office.MigrationMethod
        KeyStatus = $office.KeyStatus
        InstallationKey = $office.ProductKey
        Notes = "Detected products: $($office.ProductReleaseIds). $($office.Notes)"
        UninstallString = ''
    }
}

$reportRows = $specialRows + $rows

$csvPath = Join-Path $outputDir 'application-migration-sheet.csv'
$reportRows | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8

$priorityRows = $reportRows |
    Where-Object {
        $_.MigrationType -notin @('Dependency/Runtime', 'System', 'System License') -and
        $_.Application -notmatch 'Windows 11 Installation Assistant|Windows PC Health Check'
    } |
    Sort-Object Application

$priorityCsvPath = Join-Path $outputDir 'application-migration-priority.csv'
$priorityRows | Export-Csv -Path $priorityCsvPath -NoTypeInformation -Encoding UTF8

$summaryPath = Join-Path $outputDir 'migration-summary.md'
$topUnknown = $priorityRows | Where-Object { $_.KeyStatus -in @('Unknown', 'Check vendor portal/order email', 'Not found locally') } | Select-Object -First 20

$summary = @()
$summary += '# Computer Migration Summary'
$summary += ''
$summary += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
$summary += ''
$summary += '## Key findings'
$summary += "- Total inventoried entries: $($reportRows.Count)"
$summary += "- Windows key status: $($windows.KeyStatus)"
if ($windows.ProductKey) {
    $summary += "- Windows product key recovered: $($windows.ProductKey)"
}
if ($office) {
    $summary += "- Office products detected: $($office.ProductReleaseIds)"
    $summary += '- Office appears to be account-based Click-to-Run licensing rather than a locally visible full key.'
}
$summary += ''
$summary += '## What the sheet contains'
$summary += "- [application-migration-sheet.csv]($csvPath)"
$summary += "- [application-migration-priority.csv]($priorityCsvPath)"
$summary += ''
$summary += '## Apps that need manual license lookup or vendor portal access'
if ($topUnknown) {
    foreach ($item in $topUnknown) {
        $summary += "- $($item.Application) | $($item.KeyStatus) | $($item.MigrationMethod)"
    }
} else {
    $summary += '- None identified.'
}
$summary += ''
$summary += '## Notes'
$summary += '- Standard Windows inventory locations do not expose full license keys for many modern apps.'
$summary += '- Business-managed tools often need your IT admin or vendor tenant to deploy them on the new PC.'
$summary += '- Runtimes and redistributables usually come back automatically when their parent apps are installed.'

$summary -join [Environment]::NewLine | Set-Content -Path $summaryPath -Encoding UTF8

Write-Output "Created: $csvPath"
Write-Output "Created: $priorityCsvPath"
Write-Output "Created: $summaryPath"
