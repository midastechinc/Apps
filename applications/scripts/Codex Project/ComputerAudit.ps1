param(
    [string]$OutputPath = 'C:\MidasTech',
    [switch]$IncludeInstalledApps,
    [string]$LogoPath
)

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$isSystem = ($id.User.Value -eq 'S-1-5-18')
$scriptPath = $PSCommandPath
if ([string]::IsNullOrWhiteSpace($scriptPath)) {
    $scriptPath = $MyInvocation.MyCommand.Path
}
if (-not $isAdmin -and -not $isSystem) {
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw 'ComputerAudit.ps1: script path is empty (Datto/RMM must run a saved .ps1 or attached file, not inline-only paste). Cannot elevate.'
    }
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb RunAs -Wait
    exit
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CompanyProfile = [pscustomobject]@{
    Name    = 'Midas Tech - IT Support & Networking Solutions'
    Address = '30 Via Renzo Dr Suite 200 Richmond Hill, ON L4S 0B8'
    Phone   = '905-787-2038'
    Website = 'www.midastech.ca'
}

function Invoke-Safely {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$ScriptBlock,
        [object]$DefaultValue = $null
    )

    try {
        return & $ScriptBlock
    }
    catch {
        return $DefaultValue
    }
}

function Convert-ToSafeText {
    param([AllowNull()][object]$Value)

    if ($null -eq $Value) { return 'N/A' }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return 'N/A' }
    return $text
}

function Get-BytesInGb {
    param([AllowNull()][double]$Bytes)
    if ($null -eq $Bytes) { return $null }
    return [math]::Round($Bytes / 1GB, 2)
}

function Get-BytesInMb {
    param([AllowNull()][double]$Bytes)
    if ($null -eq $Bytes) { return $null }
    return [math]::Round($Bytes / 1MB, 2)
}

function Get-LogoDataUri {
    param([string]$RequestedLogoPath)

    $candidatePaths = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($RequestedLogoPath)) {
        $candidatePaths.Add($RequestedLogoPath)
    }

    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        foreach ($name in @(
                'MidasTech-Logo.png',
                'MidasTech-Logo.jpg',
                'MidasTech-Logo.jpeg',
                'MidasTech-Logo-Horizontal.png',
                'MidasTech-Logo-Horizontal.jpg',
                'logo.png',
                'logo.jpg'
            )) {
            $candidatePaths.Add((Join-Path -Path $PSScriptRoot -ChildPath $name))
        }
    }

    foreach ($path in $candidatePaths) {
        if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -Path $path)) {
            continue
        }

        $extension = ([IO.Path]::GetExtension($path)).ToLowerInvariant()
        $mimeType = switch ($extension) {
            '.png' { 'image/png' }
            '.jpg' { 'image/jpeg' }
            '.jpeg' { 'image/jpeg' }
            default { $null }
        }

        if ($null -eq $mimeType) {
            continue
        }

        $bytes = Invoke-Safely -ScriptBlock { [IO.File]::ReadAllBytes($path) } -DefaultValue $null
        if ($null -eq $bytes) {
            continue
        }

        return "data:$mimeType;base64,$([Convert]::ToBase64String($bytes))"
    }

    return $null
}

function Get-FolderSizeBytes {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -Path $Path)) {
        return 0
    }

    $result = Invoke-Safely -ScriptBlock {
        (Get-ChildItem -Path $Path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    } -DefaultValue 0

    if ($null -eq $result) { return 0 }
    return [double]$result
}

function Get-DiskInventory {
    $cimDisks = Invoke-Safely -ScriptBlock { $disks = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType = 3"; if ($disks) { $disks } else { @() } } -DefaultValue @()
    if (@($cimDisks).Count -gt 0) {
        return @($cimDisks | ForEach-Object {
                [pscustomobject]@{
                    DeviceID   = $_.DeviceID
                    VolumeName = $_.VolumeName
                    FileSystem = $_.FileSystem
                    Size       = $_.Size
                    FreeSpace  = $_.FreeSpace
                }
            })
    }

    $volumeDisks = @(Invoke-Safely -ScriptBlock {
            Get-Volume -ErrorAction Stop | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' }
        } -DefaultValue @())
    if (@($volumeDisks).Count -gt 0) {
        return @($volumeDisks | ForEach-Object {
                [pscustomobject]@{
                    DeviceID   = "$($_.DriveLetter):"
                    VolumeName = $_.FileSystemLabel
                    FileSystem = $_.FileSystem
                    Size       = $_.Size
                    FreeSpace  = $_.SizeRemaining
                }
            })
    }

    $psDriveDisks = @(Invoke-Safely -ScriptBlock {
            Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null -and $_.Used -ne $null }
        } -DefaultValue @())
    if (@($psDriveDisks).Count -gt 0) {
        return @($psDriveDisks | ForEach-Object {
                [pscustomobject]@{
                    DeviceID   = "$($_.Name):"
                    VolumeName = $_.Name
                    FileSystem = 'N/A'
                    Size       = ($_.Used + $_.Free)
                    FreeSpace  = $_.Free
                }
            })
    }

    $driveInfoDisks = @(Invoke-Safely -ScriptBlock {
            [System.IO.DriveInfo]::GetDrives() |
                Where-Object { $_.IsReady -and $_.DriveType -eq [System.IO.DriveType]::Fixed }
        } -DefaultValue @())

    return @($driveInfoDisks | ForEach-Object {
            [pscustomobject]@{
                DeviceID   = $_.Name.TrimEnd('\')
                VolumeName = $_.VolumeLabel
                FileSystem = $_.DriveFormat
                Size       = $_.TotalSize
                FreeSpace  = $_.AvailableFreeSpace
            }
        })
}

function Get-PendingRebootState {
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
    )

    foreach ($path in $paths) {
        if (Test-Path -Path $path) {
            return $true
        }
    }

    $sessionManager = Invoke-Safely -ScriptBlock {
        Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager'
    }

    if ($sessionManager -and $sessionManager.PendingFileRenameOperations) {
        return $true
    }

    return $false
}

function Get-InstalledApps {
    $registryPaths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    $apps = foreach ($path in $registryPaths) {
        Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
            Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName } |
            Select-Object @{
                    Name = 'Name'
                    Expression = { $_.DisplayName }
                }, @{
                    Name = 'Version'
                    Expression = { $_.DisplayVersion }
                }, @{
                    Name = 'Publisher'
                    Expression = { $_.Publisher }
                }, @{
                    Name = 'InstallDate'
                    Expression = { $_.InstallDate }
                }
    }

    return @($apps | Sort-Object -Property Name -Unique)
}

function Get-FirewallProfiles {
    $profiles = Invoke-Safely -ScriptBlock { $p = Get-NetFirewallProfile; if ($p) { $p | Where-Object { $_ } } else { @() } } -DefaultValue @()
    return $profiles | ForEach-Object {
        [pscustomobject]@{
            Name    = $_.Name
            Enabled = [bool]$_.Enabled
        }
    }
}

function Get-PasswordPolicy {
    $tempFile = Join-Path -Path $env:TEMP -ChildPath ('audit-secpol-{0}.cfg' -f ([guid]::NewGuid().ToString('N')))
    $exported = Invoke-Safely -ScriptBlock {
        secedit /export /cfg $tempFile | Out-Null
        Get-Content -Path $tempFile -ErrorAction Stop
    } -DefaultValue @()

    if (Test-Path -Path $tempFile) {
        Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
    }

    $map = @{}
    foreach ($line in $exported) {
        if ($line -match '^\s*([^=]+?)\s*=\s*(.*?)\s*$') {
            $map[$matches[1]] = $matches[2]
        }
    }

    return [pscustomobject]@{
        MinimumPasswordLength = if ($map.ContainsKey('MinimumPasswordLength')) { [int]$map['MinimumPasswordLength'] } else { $null }
        LockoutBadCount       = if ($map.ContainsKey('LockoutBadCount')) { [int]$map['LockoutBadCount'] } else { $null }
        MaximumPasswordAge    = if ($map.ContainsKey('MaximumPasswordAge')) { [int]$map['MaximumPasswordAge'] } else { $null }
    }
}

function Get-LocalAdministrators {
    $group = Invoke-Safely -ScriptBlock { Get-LocalGroupMember -Group 'Administrators' } -DefaultValue $null

    if ($null -eq $group) {
        $adsPath = "WinNT://$env:COMPUTERNAME/Administrators,group"
        $groupObj = Invoke-Safely -ScriptBlock { [ADSI]$adsPath } -DefaultValue $null
        if ($null -eq $groupObj) {
            return @()
        }

        return @($groupObj.psbase.Invoke('Members')) | ForEach-Object {
            [pscustomobject]@{
                Name = Convert-ToSafeText ($_.GetType().InvokeMember('Name', 'GetProperty', $null, $_, $null))
            }
        }
    }

    return @($group | Where-Object { $_ } | ForEach-Object {
            [pscustomobject]@{
                Name = Convert-ToSafeText $_.Name
            }
        })
}

function Get-StartupItems {
    $items = New-Object System.Collections.Generic.List[object]

    $startupRegistryPaths = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    )

    foreach ($path in $startupRegistryPaths) {
        if (-not (Test-Path -Path $path)) { continue }
        $props = Invoke-Safely -ScriptBlock { Get-ItemProperty -Path $path } -DefaultValue $null
        if ($null -eq $props) { continue }

        foreach ($property in $props.PSObject.Properties) {
            if ($property.Name -in @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider')) { continue }
            $items.Add([pscustomobject]@{
                    Name         = $property.Name
                    Command      = Convert-ToSafeText $property.Value
                    Source       = $path
                    ShortSource  = if ($path -like 'HKLM:*') { 'Registry (HKLM Run)' } else { 'Registry (HKCU Run)' }
                })
        }
    }

    $startupFolders = @(
        [Environment]::GetFolderPath('Startup'),
        (Join-Path -Path $env:ProgramData -ChildPath 'Microsoft\Windows\Start Menu\Programs\Startup')
    )

    foreach ($folder in $startupFolders) {
        if ([string]::IsNullOrWhiteSpace($folder)) { continue }
        if (-not (Test-Path -Path $folder)) { continue }
        $folderLabel = if ($folder -like "$env:ProgramData*") { 'Startup Folder (All Users)' } else { 'Startup Folder (Current User)' }

        Get-ChildItem -Path $folder -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $items.Add([pscustomobject]@{
                    Name         = $_.Name
                    Command      = $_.FullName
                    Source       = $folder
                    ShortSource  = $folderLabel
                })
        }
    }

    return @($items | Sort-Object -Property Name -Unique)
}

function Get-TopProcesses {
    try {
        $processes = Get-Process -ErrorAction Stop |
            Sort-Object {
                if ($_.CPU -is [timespan]) {
                    $_.CPU.TotalSeconds
                } elseif ($_.CPU -is [double] -or $_.CPU -is [int]) {
                    $_.CPU
                } else {
                    0
                }
            } -Descending |
            Select-Object -First 10
        return @($processes | ForEach-Object {
            [pscustomobject]@{
                Name = $_.ProcessName
                Id = $_.Id
                CpuSeconds = if ($_.CPU -is [timespan]) {
                    [math]::Round($_.CPU.TotalSeconds, 2)
                } elseif ($_.CPU -is [double] -or $_.CPU -is [int]) {
                    [math]::Round($_.CPU, 2)
                } else {
                    0
                }
                WorkingSetMb = if ($_.WorkingSet64) { Get-BytesInMb $_.WorkingSet64 } else { 0 }
            }
        })
    } catch {
        return @()
    }
}

function Get-RecentSystemEvents {
    return @(Invoke-Safely -ScriptBlock {
            Get-WinEvent -FilterHashtable @{
                LogName   = 'System'
                Level     = 1, 2
                StartTime = (Get-Date).AddDays(-7)
            } -MaxEvents 20 -ErrorAction Stop
        } -DefaultValue @() | Where-Object { $_ } | ForEach-Object {
            [pscustomobject]@{
                TimeCreated = if ($_.TimeCreated) { $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss') } else { 'N/A' }
                Level       = Convert-ToSafeText $_.LevelDisplayName
                Provider    = Convert-ToSafeText $_.ProviderName
                Id          = $_.Id
                Message     = Convert-ToSafeText (([string]$_.Message).Replace("`r", ' ').Replace("`n", ' ').Trim())
            }
        })
}

function Get-RiskySoftwareFlags {
    param([array]$Applications)

    $patterns = @(
        'TeamViewer',
        'AnyDesk',
        'UltraViewer',
        'VNC',
        'Java',
        'uTorrent',
        'BitTorrent'
    )

    $flags = New-Object System.Collections.Generic.List[object]

    foreach ($app in $Applications) {
        foreach ($pattern in $patterns) {
            if ($app.Name -match [regex]::Escape($pattern)) {
                $flags.Add([pscustomobject]@{
                        Pattern    = $pattern
                        Name       = $app.Name
                        Version    = Convert-ToSafeText $app.Version
                        Publisher  = Convert-ToSafeText $app.Publisher
                        RiskReason = "Matched watchlist keyword: $pattern"
                    })
                break
            }
        }
    }

    return @($flags | Sort-Object -Property Name -Unique)
}

function Get-BusinessRiskSummary {
    param(
        [int]$RiskScore,
        [array]$Recommendations
    )

    if ($RiskScore -ge 80) {
        return 'High business risk. The device shows multiple conditions that can affect security, reliability, or supportability and should be remediated urgently.'
    }

    if ($RiskScore -ge 50) {
        return 'Moderate business risk. The device is usable but has several issues that raise support burden or security exposure and should be addressed soon.'
    }

    if ($RiskScore -ge 25) {
        return 'Low to moderate business risk. Only a limited set of concerns were found, but corrective action is still recommended to keep the device in a healthy state.'
    }

    if (@($Recommendations).Count -gt 0) {
        return 'Low business risk. The device appears broadly healthy, with only minor follow-up items.'
    }

    return 'Very low business risk. No significant issues were identified by the audit rules.'
}

function Convert-RiskScoreToGrade {
    param([int]$RiskScore)

    if ($RiskScore -ge 80) { return 'D' }
    if ($RiskScore -ge 50) { return 'C' }
    if ($RiskScore -ge 25) { return 'B' }
    return 'A'
}

function Get-AuditData {
    $computerSystem = Invoke-Safely -ScriptBlock { Get-CimInstance -ClassName Win32_ComputerSystem }
    $operatingSystem = Invoke-Safely -ScriptBlock { Get-CimInstance -ClassName Win32_OperatingSystem }
    $bios = Invoke-Safely -ScriptBlock { Get-CimInstance -ClassName Win32_BIOS }
    $processor = Invoke-Safely -ScriptBlock { Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1 }
    $logicalDisks = @(Get-DiskInventory)
    $networkConfigs = @(Invoke-Safely -ScriptBlock { Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" } -DefaultValue @())
    $antivirusProducts = @(Invoke-Safely -ScriptBlock { Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntivirusProduct } -DefaultValue @())
    $hotfixes = @(Invoke-Safely -ScriptBlock { Get-HotFix | Sort-Object -Property InstalledOn -Descending } -DefaultValue @())
    $firewallProfiles = @(Invoke-Safely -ScriptBlock { Get-FirewallProfiles } -DefaultValue @())
    $installedApps = @(Invoke-Safely -ScriptBlock { Get-InstalledApps } -DefaultValue @())
    $localAdministrators = @(Invoke-Safely -ScriptBlock { Get-LocalAdministrators } -DefaultValue @())
    $passwordPolicy = Get-PasswordPolicy
    $startupItems = @(Invoke-Safely -ScriptBlock { Get-StartupItems } -DefaultValue @())
    $topProcesses = @(Invoke-Safely -ScriptBlock { Get-TopProcesses } -DefaultValue @())
    $recentSystemEvents = @(Invoke-Safely -ScriptBlock { Get-RecentSystemEvents } -DefaultValue @())
    $riskySoftware = @(Invoke-Safely -ScriptBlock { Get-RiskySoftwareFlags -Applications $installedApps } -DefaultValue @())

    $lastBoot = if ($operatingSystem) { $operatingSystem.LastBootUpTime } else { $null }
    $uptime = if ($lastBoot) { (Get-Date) - $lastBoot } else { $null }
    $uptimeDays = if ($uptime) { [math]::Round($uptime.TotalDays, 1) } else { $null }
    $domainJoined = if ($computerSystem) { [bool]$computerSystem.PartOfDomain } else { $false }
    $domainName = if ($computerSystem) {
        if ($computerSystem.PartOfDomain) { $computerSystem.Domain } else { $computerSystem.Workgroup }
    }
    else {
        $env:USERDOMAIN
    }

    $diskData = foreach ($disk in $logicalDisks) {
        $freePercent = if ($disk.Size -gt 0) { [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 2) } else { $null }
        $usedPercent = if ($null -ne $freePercent) { [math]::Round(100 - $freePercent, 2) } else { $null }

        [pscustomobject]@{
            DriveLetter   = Convert-ToSafeText $disk.DeviceID
            VolumeName    = Convert-ToSafeText $disk.VolumeName
            FileSystem    = Convert-ToSafeText $disk.FileSystem
            SizeGb        = Get-BytesInGb $disk.Size
            FreeGb        = Get-BytesInGb $disk.FreeSpace
            FreePercent   = $freePercent
            UsedPercent   = $usedPercent
            HealthComment = if ($null -ne $freePercent -and $freePercent -lt 15) { 'Low free space' } else { 'OK' }
        }
    }

    $ipv4Summary = @($networkConfigs | ForEach-Object {
            @($_.IPAddress | Where-Object { $_ -match '^\d+\.' })
        }) | Where-Object { $_ } | Select-Object -Unique

    $networkData = foreach ($adapter in $networkConfigs) {
        [pscustomobject]@{
            Description = Convert-ToSafeText $adapter.Description
            MACAddress  = Convert-ToSafeText $adapter.MACAddress
            IPAddress   = Convert-ToSafeText (($adapter.IPAddress | Where-Object { $_ }) -join ', ')
            IPv4        = Convert-ToSafeText (($adapter.IPAddress | Where-Object { $_ -match '^\d+\.' }) -join ', ')
            SubnetMask  = Convert-ToSafeText (($adapter.IPSubnet | Where-Object { $_ }) -join ', ')
            Gateway     = Convert-ToSafeText (($adapter.DefaultIPGateway | Where-Object { $_ }) -join ', ')
            DNSServer   = Convert-ToSafeText (($adapter.DNSServerSearchOrder | Where-Object { $_ }) -join ', ')
            DHCPEnabled = [bool]$adapter.DHCPEnabled
        }
    }

    $windowsUpdateCachePath = Join-Path -Path $env:SystemRoot -ChildPath 'SoftwareDistribution\Download'
    $localAppDataTempPath = Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Temp'
    $downloadsPath = Join-Path -Path $env:USERPROFILE -ChildPath 'Downloads'
    $windowsTempPath = Join-Path -Path $env:SystemRoot -ChildPath 'Temp'

    $storageReview = [pscustomobject]@{
        WindowsUpdateDownloadCacheMb = Get-BytesInMb (Get-FolderSizeBytes -Path $windowsUpdateCachePath)
        LocalAppDataTempMb           = Get-BytesInMb (Get-FolderSizeBytes -Path $localAppDataTempPath)
        UserDownloadsMb              = Get-BytesInMb (Get-FolderSizeBytes -Path $downloadsPath)
        WindowsTempMb                = Get-BytesInMb (Get-FolderSizeBytes -Path $windowsTempPath)
    }

    $storageReview | Add-Member -MemberType NoteProperty -Name TotalReviewableStorageMb -Value (
        [math]::Round(
            ($storageReview.WindowsUpdateDownloadCacheMb + $storageReview.LocalAppDataTempMb + $storageReview.UserDownloadsMb + $storageReview.WindowsTempMb),
            2
        )
    )

    $cDrive = $diskData | Where-Object { $_.DriveLetter -eq 'C:' } | Select-Object -First 1
    $lastHotfix = $hotfixes | Select-Object -First 1
    $firewallEnabledCount = @($firewallProfiles | Where-Object { $_.Enabled }).Count
    $criticalEventCount = @($recentSystemEvents).Count

    $diskHealth = @(Invoke-Safely -ScriptBlock { Get-PhysicalDisk | Select-Object FriendlyName, HealthStatus, OperationalStatus, @{Name='Size';Expression={[math]::Round($_.Size / 1GB, 2)}} } -DefaultValue @())
    $networkAdapters = @(Invoke-Safely -ScriptBlock { Get-NetAdapter | Select-Object Name, Status, LinkSpeed, MacAddress } -DefaultValue @())
    $networkIPs = @(Invoke-Safely -ScriptBlock { Get-NetIPAddress | Where-Object AddressFamily -eq 'IPv4' | Select-Object InterfaceAlias, IPAddress } -DefaultValue @())
    $bitlocker = @(Invoke-Safely -ScriptBlock { Get-BitLockerVolume | Select-Object MountPoint, VolumeType, ProtectionStatus, EncryptionMethod } -DefaultValue @())
    $defender = @(Invoke-Safely -ScriptBlock { Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated } -DefaultValue @())
    $pendingUpdates = @(Invoke-Safely -ScriptBlock {
        $updateSession = New-Object -ComObject Microsoft.Update.Session
        $updateSearcher = $updateSession.CreateUpdateSearcher()
        $searchResult = $updateSearcher.Search('IsInstalled=0')
        if ($null -eq $searchResult -or $null -eq $searchResult.Updates) { return @() }
        $out = @()
        foreach ($u in @($searchResult.Updates)) {
            if ($null -eq $u) { continue }
            $kb = @()
            if ($null -ne $u.KBArticleIDs) { $kb = @($u.KBArticleIDs) }
            $out += [pscustomobject]@{
                Title    = $u.Title
                KB       = ($kb -join ', ')
                Severity = $u.MsrcSeverity
                Size     = (Get-BytesInGb $u.MaxDownloadSize)
            }
        }
        return $out
    } -DefaultValue @())

    $findings = New-Object System.Collections.Generic.List[string]
    $recommendations = New-Object System.Collections.Generic.List[string]
    $riskScore = 0

    if ($antivirusProducts.Count -eq 0) {
        $riskScore += 25
        $findings.Add('No antivirus product was detected through Windows Security Center.')
        $recommendations.Add('Install or re-register endpoint antivirus so the device is actively protected and reporting correctly.')
    }

    if ($firewallEnabledCount -lt 3 -and $firewallProfiles.Count -gt 0) {
        $riskScore += 15
        $findings.Add('One or more Windows Firewall profiles are disabled.')
        $recommendations.Add('Enable all Windows Firewall profiles unless there is an approved exception.')
    }

    if ($localAdministrators.Count -gt 3) {
        $riskScore += 15
        $findings.Add("The local Administrators group has $($localAdministrators.Count) members.")
        $recommendations.Add('Review local administrator memberships and remove any accounts that are not required.')
    }

    if ($passwordPolicy.MinimumPasswordLength -lt 8 -and $null -ne $passwordPolicy.MinimumPasswordLength) {
        $riskScore += 10
        $findings.Add("Minimum password length is set to $($passwordPolicy.MinimumPasswordLength).")
        $recommendations.Add('Increase minimum password length to at least 8 characters, or higher if policy allows.')
    }

    if ($passwordPolicy.LockoutBadCount -eq 0 -or $null -eq $passwordPolicy.LockoutBadCount) {
        $riskScore += 10
        $findings.Add('Account lockout threshold is not configured.')
        $recommendations.Add('Configure an account lockout threshold to reduce brute-force risk.')
    }

    if ($passwordPolicy.MaximumPasswordAge -eq 0 -or $null -eq $passwordPolicy.MaximumPasswordAge) {
        $riskScore += 5
        $findings.Add('Maximum password age is not configured or is unlimited.')
        $recommendations.Add('Set a maximum password age that matches your security policy.')
    }

    if ($null -ne $uptimeDays -and $uptimeDays -gt 30) {
        $riskScore += 5
        $findings.Add("System uptime is $uptimeDays days.")
        $recommendations.Add('Restart the device during a maintenance window to apply updates and refresh system state.')
    }

    if (Get-PendingRebootState) {
        $riskScore += 10
        $findings.Add('Windows indicates a reboot is pending after updates or servicing.')
        $recommendations.Add('Restart the device to complete pending update activity.')
    }

    if ($cDrive -and $null -ne $cDrive.FreePercent -and $cDrive.FreePercent -lt 15) {
        $riskScore += 10
        $findings.Add("Drive C: has only $($cDrive.FreePercent)% free space remaining.")
        $recommendations.Add('Free up disk space on C: by clearing temporary files or moving user data.')
    }

    if ($storageReview.TotalReviewableStorageMb -gt 4096) {
        $riskScore += 5
        $findings.Add("Reviewable storage cleanup estimate is $($storageReview.TotalReviewableStorageMb) MB.")
        $recommendations.Add('Review large temporary and download folders for cleanup opportunities.')
    }

    if ($riskySoftware.Count -gt 0) {
        $riskScore += [math]::Min(20, $riskySoftware.Count * 4)
        $findings.Add("Potentially risky software matches found: $((($riskySoftware | Select-Object -ExpandProperty Name) -join ', ')).")
        $recommendations.Add('Validate whether remote access tools, torrent clients, or Java installations are approved for business use.')
    }

    if ($criticalEventCount -ge 10) {
        $riskScore += 10
        $findings.Add("$criticalEventCount critical/error events were found in the Windows System log during the last 7 days.")
        $recommendations.Add('Investigate repeated critical and error events in the System log to address stability issues.')
    }
    elseif ($criticalEventCount -ge 1) {
        $riskScore += 5
        $findings.Add("$criticalEventCount critical/error events were found in the Windows System log during the last 7 days.")
        $recommendations.Add('Review recent System log errors and confirm whether they require remediation.')
    }

    $riskScore = [math]::Min(100, $riskScore)
    $letterGrade = Convert-RiskScoreToGrade -RiskScore $riskScore
    $businessRiskSummary = Get-BusinessRiskSummary -RiskScore $riskScore -Recommendations $recommendations

    return [pscustomobject]@{
        Uptime = if ($uptime) { $uptime.ToString() } else { 'N/A' }
        LastBoot = if ($lastBoot) { $lastBoot.ToString('yyyy-MM-dd HH:mm:ss') } else { 'N/A' }
        DiskHealth = $diskHealth
        NetworkAdapters = $networkAdapters
        NetworkIPs = $networkIPs
        BitLocker = $bitlocker
        Defender = $defender
        PendingUpdates = $pendingUpdates
        GeneratedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        Identity    = [pscustomobject]@{
            ComputerName      = $env:COMPUTERNAME
            LoggedOnUser      = "$env:USERDOMAIN\$env:USERNAME"
            Manufacturer      = Convert-ToSafeText $(if ($computerSystem) { $computerSystem.Manufacturer } else { $null })
            Model             = Convert-ToSafeText $(if ($computerSystem) { $computerSystem.Model } else { $null })
            SerialNumber      = Convert-ToSafeText $(if ($bios) { $bios.SerialNumber } else { $null })
            DomainJoined      = $domainJoined
            DomainOrWorkgroup = Convert-ToSafeText $domainName
        }
        OperatingSystem = [pscustomobject]@{
            Caption        = Convert-ToSafeText $(if ($operatingSystem) { $operatingSystem.Caption } else { $null })
            Version        = Convert-ToSafeText $(if ($operatingSystem) { $operatingSystem.Version } else { $null })
            BuildNumber    = Convert-ToSafeText $(if ($operatingSystem) { $operatingSystem.BuildNumber } else { $null })
            InstallDate    = if ($operatingSystem -and $operatingSystem.InstallDate) { $operatingSystem.InstallDate.ToString('yyyy-MM-dd HH:mm:ss') } else { 'N/A' }
            LastBootUpTime = if ($lastBoot) { $lastBoot.ToString('yyyy-MM-dd HH:mm:ss') } else { 'N/A' }
            UptimeDays     = $uptimeDays
            PendingReboot  = Get-PendingRebootState
            Architecture   = Convert-ToSafeText $(if ($operatingSystem) { $operatingSystem.OSArchitecture } else { $env:PROCESSOR_ARCHITECTURE })
        }
        Hardware = [pscustomobject]@{
            Processor         = Convert-ToSafeText $(if ($processor) { $processor.Name } else { $env:PROCESSOR_IDENTIFIER })
            PhysicalCores     = if ($processor) { $processor.NumberOfCores } else { $null }
            LogicalProcessors = if ($processor) { $processor.NumberOfLogicalProcessors } else { $env:NUMBER_OF_PROCESSORS }
            TotalMemoryGb     = Get-BytesInGb $(if ($computerSystem) { $computerSystem.TotalPhysicalMemory } else { $null })
            BIOSVersion       = Convert-ToSafeText $(if ($bios) { (($bios.SMBIOSBIOSVersion | Where-Object { $_ }) -join ', ') } else { $null })
        }
        Network = [pscustomobject]@{
            IPv4Summary = Convert-ToSafeText ($ipv4Summary -join ', ')
            Adapters    = $networkData
        }
        Security = [pscustomobject]@{
            AntivirusProducts      = @($antivirusProducts | ForEach-Object {
                    [pscustomobject]@{
                        Name      = Convert-ToSafeText $_.displayName
                        PathToExe = Convert-ToSafeText $_.pathToSignedProductExe
                    }
                })
            FirewallEnabled        = [bool]($firewallEnabledCount -gt 0)
            FirewallProfiles       = $firewallProfiles
            LocalAdministrators    = $localAdministrators
            LocalAdministratorCount = $localAdministrators.Count
            PasswordPolicy         = $passwordPolicy
        }
        Patch = [pscustomobject]@{
            LastInstalledHotfixDate = if ($lastHotfix -and $lastHotfix.InstalledOn) { $lastHotfix.InstalledOn.ToString('yyyy-MM-dd') } else { 'N/A' }
            TotalHotfixCount        = $hotfixes.Count
            RecentHotfixes          = @($hotfixes | Select-Object -First 10 | ForEach-Object {
                    [pscustomobject]@{
                        HotFixId    = $_.HotFixID
                        Description = $_.Description
                        InstalledOn = if ($_.InstalledOn) { $_.InstalledOn.ToString('yyyy-MM-dd') } else { 'N/A' }
                    }
                })
            RebootPending           = Get-PendingRebootState
        }
        Storage = [pscustomobject]@{
            DiskSummary       = $diskData
            CDriveFreeSpaceGb = if ($cDrive) { $cDrive.FreeGb } else { $null }
            CDriveUsedPercent = if ($cDrive) { $cDrive.UsedPercent } else { $null }
            ReviewableStorage = $storageReview
        }
        StartupAndPerformance = [pscustomobject]@{
            StartupItems     = $startupItems
            StartupItemCount = $startupItems.Count
            TopCpuProcesses  = $topProcesses
        }
        Software = [pscustomobject]@{
            InstalledApplications = if ($IncludeInstalledApps) { $installedApps } else { @($installedApps | Select-Object -First 100) }
            RiskFlags             = $riskySoftware
        }
        SystemHealth = [pscustomobject]@{
            RecentCriticalOrErrorEvents = $recentSystemEvents
            RecentCriticalOrErrorCount  = $criticalEventCount
        }
        Risk = [pscustomobject]@{
            Score           = $riskScore
            LetterGrade     = $letterGrade
            BusinessSummary = $businessRiskSummary
            Recommendations = @($recommendations | Select-Object -Unique)
        }
        Findings = @($findings | Select-Object -Unique)
    }
}

function Convert-AuditToHtml {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$AuditData
    )

        $updateRows = if (@($AuditData.PendingUpdates).Count -gt 0) {
            $AuditData.PendingUpdates | Where-Object { $null -ne $_ } | ForEach-Object {
                $fields = @($_.PSObject.Properties | ForEach-Object { $_.Value })
                $cells = ($fields | ForEach-Object { "<td>$(Convert-ToSafeText $_)</td>" }) -join ''
                "<tr>$cells</tr>"
            }
        } else { '<tr><td colspan="4">No pending update data available.</td></tr>' }

        $diskHealthRows = if (@($AuditData.DiskHealth).Count -gt 0) {
            $AuditData.DiskHealth | ForEach-Object {
                "<tr><td>$($_.FriendlyName)</td><td>$($_.HealthStatus)</td><td>$($_.OperationalStatus)</td><td>$($_.Size)</td></tr>"
            }
        } else { '<tr><td colspan="4">No disk health data available.</td></tr>' }

        $networkRows = if (@($AuditData.NetworkAdapters).Count -gt 0) {
            $AuditData.NetworkAdapters | ForEach-Object {
                "<tr><td>$($_.Name)</td><td>$($_.Status)</td><td>$($_.LinkSpeed)</td><td>$($_.MacAddress)</td></tr>"
            }
        } else { '<tr><td colspan="4">No network adapter data available.</td></tr>' }

        $ipRows = if (@($AuditData.NetworkIPs).Count -gt 0) {
            $AuditData.NetworkIPs | ForEach-Object {
                "<tr><td>$($_.InterfaceAlias)</td><td>$($_.IPAddress)</td></tr>"
            }
        } else { '<tr><td colspan="2">No IP data available.</td></tr>' }

        $bitlockerRows = if (@($AuditData.BitLocker).Count -gt 0) {
            $AuditData.BitLocker | ForEach-Object {
                "<tr><td>$($_.MountPoint)</td><td>$($_.VolumeType)</td><td>$($_.ProtectionStatus)</td><td>$($_.EncryptionMethod)</td></tr>"
            }
        } else { '<tr><td colspan="4">No BitLocker data available.</td></tr>' }

        $defenderRows = if (@($AuditData.Defender).Count -gt 0) {
            $AuditData.Defender | ForEach-Object {
                "<tr><td>$($_.AMServiceEnabled)</td><td>$($_.AntivirusEnabled)</td><td>$($_.RealTimeProtectionEnabled)</td><td>$($_.AntivirusSignatureLastUpdated)</td></tr>"
            }
        } else { '<tr><td colspan="4">No Defender/AV data available.</td></tr>' }

    $logoDataUri = Invoke-Safely -ScriptBlock { Get-LogoDataUri -RequestedLogoPath $LogoPath } -DefaultValue $null
    $brandLogoHtml = if ($logoDataUri) {
        "<img src=`"$logoDataUri`" alt=`"Midas Tech`" class=`"brand-logo`" />"
    } else {
        "<div class=`"brand-wordmark`">Midas Tech - IT Support & Networking Solutions</div>"
    }

    $style = @"
<style>
body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2937; background: #f4f7fb; }
h1, h2, h3 { color: #0f172a; margin-bottom: 8px; }
.meta, .section { margin-bottom: 20px; padding: 18px; background: #ffffff; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08); border-radius: 8px; }
.meta { border-left: 5px solid #1d4ed8; }
.hero { display: table; width: 100%; }
.hero-left, .hero-right { display: table-cell; vertical-align: top; }
.hero-right { text-align: right; width: 280px; }
.brand-logo { max-width: 360px; max-height: 90px; display: block; margin-bottom: 12px; }
.brand-wordmark { font-size: 28px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
.brand-tagline { font-size: 13px; text-transform: uppercase; letter-spacing: 1.8px; color: #2563eb; margin-bottom: 8px; }
.contact-line { font-size: 13px; color: #334155; margin: 4px 0; }
.scorecard { display: inline-block; min-width: 180px; padding: 18px; border-radius: 10px; color: #fff; background: #1d4ed8; text-align: center; }
.scorecard .score { font-size: 34px; font-weight: 700; }
.scorecard .grade { font-size: 28px; font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #dbe3f0; padding: 10px; text-align: left; vertical-align: top; font-size: 13px; }
th { background: #e8eef9; }
ul { margin: 10px 0 0 18px; padding: 0; }
.good { color: #166534; font-weight: 600; }
.issue-text { color: #b91c1c; font-weight: 700; }
.issue-list li { color: #b91c1c; margin-bottom: 6px; }
.issue-row td { color: #b91c1c; font-weight: 600; background: #fff5f5; }
.issue-panel { border-left: 5px solid #b91c1c; }
.risk-high { background: #b91c1c; }
.footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #dbe3f0; font-size: 12px; color: #475569; }
</style>
"@

    $findingsHtml = if (@($AuditData.Findings).Count -gt 0) {
        '<ul class="issue-list">' + (($AuditData.Findings | ForEach-Object { "<li>$($_)</li>" }) -join '') + '</ul>'
    }
    else {
        '<p class="good">No significant issues were flagged by the audit rules.</p>'
    }

    $recommendationsHtml = if (@($AuditData.Risk.Recommendations).Count -gt 0) {
        '<ul class="issue-list">' + (($AuditData.Risk.Recommendations | ForEach-Object { "<li>$($_)</li>" }) -join '') + '</ul>'
    }
    else {
        '<p class="good">No priority remediation actions are currently recommended.</p>'
    }

    $identityRows = @(
        @{ Label = 'Computer Name'; Value = $AuditData.Identity.ComputerName }
        @{ Label = 'User Name'; Value = $AuditData.Identity.LoggedOnUser }
        @{ Label = 'Domain or Workgroup'; Value = $AuditData.Identity.DomainOrWorkgroup }
        @{ Label = 'System Uptime'; Value = $AuditData.Uptime }
        @{ Label = 'Last Reboot Time'; Value = $AuditData.LastBoot }
        @{ Label = 'Serial Number'; Value = $AuditData.Identity.SerialNumber }
        @{ Label = 'Domain Joined'; Value = $AuditData.Identity.DomainJoined }
    ) | ForEach-Object { "<tr><th>$($_.Label)</th><td>$($_.Value)</td></tr>" }

    $osRows = @(
        @{ Label = 'Windows Edition / OS'; Value = $AuditData.OperatingSystem.Caption },
        @{ Label = 'OS Version'; Value = $AuditData.OperatingSystem.Version },
        @{ Label = 'Build Number'; Value = $AuditData.OperatingSystem.BuildNumber },
        @{ Label = 'Architecture'; Value = $AuditData.OperatingSystem.Architecture },
        @{ Label = 'Last Boot Time'; Value = $AuditData.OperatingSystem.LastBootUpTime },
        @{ Label = 'Pending Reboot'; Value = $AuditData.OperatingSystem.PendingReboot }
    ) | ForEach-Object { "<tr><th>$($_.Label)</th><td>$($_.Value)</td></tr>" }

    $hardwareRows = @(
        @{ Label = 'CPU Model'; Value = $AuditData.Hardware.Processor },
        @{ Label = 'RAM (GB)'; Value = $AuditData.Hardware.TotalMemoryGb },
        @{ Label = 'Physical Cores'; Value = $AuditData.Hardware.PhysicalCores },
        @{ Label = 'Logical Processors'; Value = $AuditData.Hardware.LogicalProcessors }
    ) | ForEach-Object { "<tr><th>$($_.Label)</th><td>$($_.Value)</td></tr>" }

    $firewallRows = if (@($AuditData.Security.FirewallProfiles).Count -gt 0) {
        $AuditData.Security.FirewallProfiles | ForEach-Object {
            if (-not $_.Enabled) {
                "<tr class=`"issue-row`"><td>$($_.Name)</td><td>$($_.Enabled)</td></tr>"
            }
            else {
                "<tr><td>$($_.Name)</td><td>$($_.Enabled)</td></tr>"
            }
        }
    }
    else {
        '<tr><td colspan="2">Firewall profile data unavailable.</td></tr>'
    }

    $localAdminRows = if (@($AuditData.Security.LocalAdministrators).Count -gt 0) {
        $AuditData.Security.LocalAdministrators | ForEach-Object {
            "<tr><td>$($_.Name)</td></tr>"
        }
    }
    else {
        '<tr><td>No local administrator membership data available.</td></tr>'
    }

    $patchRows = if (@($AuditData.Patch.RecentHotfixes).Count -gt 0) {
        $AuditData.Patch.RecentHotfixes | ForEach-Object {
            "<tr><td>$($_.HotFixId)</td><td>$($_.Description)</td><td>$($_.InstalledOn)</td></tr>"
        }
    }
    else {
        '<tr><td colspan="3">No hotfix records returned.</td></tr>'
    }

    $diskRows = if (@($AuditData.Storage.DiskSummary).Count -gt 0) {
        $AuditData.Storage.DiskSummary | ForEach-Object {
            if ($_.HealthComment -ne 'OK') {
                "<tr class=`"issue-row`"><td>$($_.DriveLetter)</td><td>$($_.VolumeName)</td><td>$($_.SizeGb)</td><td>$($_.FreeGb)</td><td>$($_.UsedPercent)</td><td>$($_.HealthComment)</td></tr>"
            }
            else {
                "<tr><td>$($_.DriveLetter)</td><td>$($_.VolumeName)</td><td>$($_.SizeGb)</td><td>$($_.FreeGb)</td><td>$($_.UsedPercent)</td><td>$($_.HealthComment)</td></tr>"
            }
        }
    }
    else {
        '<tr><td colspan="6">Disk data unavailable.</td></tr>'
    }

    $startupRows = if (@($AuditData.StartupAndPerformance.StartupItems).Count -gt 0) {
        $AuditData.StartupAndPerformance.StartupItems | Select-Object -First 25 | ForEach-Object {
            "<tr><td>$($_.Name)</td><td>$($_.ShortSource)</td><td>$($_.Command)</td></tr>"
        }
    }
    else {
        '<tr><td colspan="3">No startup items found.</td></tr>'
    }

    $processRows = if (@($AuditData.StartupAndPerformance.TopCpuProcesses).Count -gt 0) {
        $AuditData.StartupAndPerformance.TopCpuProcesses | ForEach-Object {
            "<tr><td>$($_.Name)</td><td>$($_.Id)</td><td>$($_.CpuSeconds)</td><td>$($_.WorkingSetMb)</td></tr>"
        }
    }
    else {
        '<tr><td colspan="4">Process data unavailable.</td></tr>'
    }

    $softwareRows = if (@($AuditData.Software.InstalledApplications).Count -gt 0) {
        $AuditData.Software.InstalledApplications | Select-Object -First 100 | ForEach-Object {
            "<tr><td>$($_.Name)</td><td>$($_.Version)</td><td>$($_.Publisher)</td></tr>"
        }
    }
    else {
        '<tr><td colspan="3">No application inventory available.</td></tr>'
    }

    $flagRows = if (@($AuditData.Software.RiskFlags).Count -gt 0) {
        $AuditData.Software.RiskFlags | ForEach-Object {
            "<tr class=`"issue-row`"><td>$($_.Pattern)</td><td>$($_.Name)</td><td>$($_.Publisher)</td><td>$($_.RiskReason)</td></tr>"
        }
    }
    else {
        '<tr><td colspan="4">No watchlist software matches found.</td></tr>'
    }

    $eventRows = if (@($AuditData.SystemHealth.RecentCriticalOrErrorEvents).Count -gt 0) {
        $AuditData.SystemHealth.RecentCriticalOrErrorEvents | ForEach-Object {
            "<tr class=`"issue-row`"><td>$($_.TimeCreated)</td><td>$($_.Level)</td><td>$($_.Provider)</td><td>$($_.Id)</td><td>$($_.Message)</td></tr>"
        }
    }
    else {
        '<tr><td colspan="5">No recent critical/error System events returned.</td></tr>'
    }

    return @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Computer Audit Report - $($AuditData.Identity.ComputerName)</title>
$style
</head>
<body>
<div class="meta">
<div class="hero">
<div class="hero-left">
$brandLogoHtml
<div class="brand-tagline">Computer Audit Report</div>
<div class="contact-line"><strong>Midas Tech - IT Support & Networking Solutions</strong></div>
<div class="contact-line">30 Via Renzo Dr Suite 200 Richmond Hill, ON L4S 0B8</div>
<div class="contact-line">905-787-2038</div>
<div class="contact-line">www.midastech.ca</div>
</div>
<div class="hero-right">
<div class="scorecard $(if ($AuditData.Risk.Score -ge 25) { 'risk-high' })">
<div class="score">$($AuditData.Risk.Score)/100</div>
<div>Risk Score</div>
<div class="grade">Grade $($AuditData.Risk.LetterGrade)</div>
</div>
</div>
</div>
<p><strong>Generated:</strong> $($AuditData.GeneratedAt)</p>
<p><strong>Device:</strong> $($AuditData.Identity.ComputerName)</p>
<p><strong>IPv4 Summary:</strong> $($AuditData.Network.IPv4Summary)</p>
</div>

<div class="section $(if (@($AuditData.Risk.Recommendations).Count -gt 0) { 'issue-panel' })">
<h2>Business Risk Summary</h2>
<p class="$(if (@($AuditData.Risk.Recommendations).Count -gt 0) { 'issue-text' })">$($AuditData.Risk.BusinessSummary)</p>
<h3>Priority Recommendations</h3>
$recommendationsHtml
</div>

<div class="section $(if (@($AuditData.Findings).Count -gt 0) { 'issue-panel' })">
<h2>Findings</h2>
$findingsHtml
</div>

<div class="section">
<h2>Device and System Information</h2>
<table>
$($identityRows -join "`n")
$($osRows -join "`n")
$($hardwareRows -join "`n")
</table>
</div>

<div class="section">
<h2>Endpoint Security</h2>
<p class="$(if (@($AuditData.Security.AntivirusProducts).Count -eq 0) { 'issue-text' })"><strong>Antivirus Detected:</strong> $(if (@($AuditData.Security.AntivirusProducts).Count -gt 0) { 'Yes' } else { 'No' })</p>
<p class="$(if (-not $AuditData.Security.FirewallEnabled) { 'issue-text' })"><strong>Windows Firewall Enabled:</strong> $($AuditData.Security.FirewallEnabled)</p>
<table>
<tr><th>Firewall Profile</th><th>Enabled</th></tr>
$($firewallRows -join "`n")
</table>
</div>

<div class="section">
<h2>Identity and Access</h2>
<p class="$(if ($AuditData.Security.LocalAdministratorCount -gt 3) { 'issue-text' })"><strong>Local Administrators Count:</strong> $($AuditData.Security.LocalAdministratorCount)</p>
<p class="$(if ($AuditData.Security.PasswordPolicy -and $AuditData.Security.PasswordPolicy.MinimumPasswordLength -lt 8 -and $null -ne $AuditData.Security.PasswordPolicy.MinimumPasswordLength) { 'issue-text' })"><strong>Minimum Password Length:</strong> $(if ($AuditData.Security.PasswordPolicy) { $AuditData.Security.PasswordPolicy.MinimumPasswordLength } else { 'N/A' })</p>
<p class="$(if ($AuditData.Security.PasswordPolicy -and $AuditData.Security.PasswordPolicy.LockoutBadCount -eq 0 -or $null -eq $AuditData.Security.PasswordPolicy.LockoutBadCount) { 'issue-text' })"><strong>Account Lockout Threshold:</strong> $(if ($AuditData.Security.PasswordPolicy) { $AuditData.Security.PasswordPolicy.LockoutBadCount } else { 'N/A' })</p>
<p class="$(if ($AuditData.Security.PasswordPolicy -and $AuditData.Security.PasswordPolicy.MaximumPasswordAge -eq 0 -or $null -eq $AuditData.Security.PasswordPolicy.MaximumPasswordAge) { 'issue-text' })"><strong>Maximum Password Age:</strong> $(if ($AuditData.Security.PasswordPolicy) { $AuditData.Security.PasswordPolicy.MaximumPasswordAge } else { 'N/A' })</p>
<table>
<tr><th>Local Administrators Group Members</th></tr>
$($localAdminRows -join "`n")
</table>
</div>

<div class="section">
<h2>Patch Basics</h2>
<p><strong>Last Installed Hotfix Date:</strong> $($AuditData.Patch.LastInstalledHotfixDate)</p>
<p><strong>Total Hotfix Count:</strong> $($AuditData.Patch.TotalHotfixCount)</p>
<p class="$(if ($AuditData.Patch.RebootPending) { 'issue-text' })"><strong>Reboot Pending:</strong> $($AuditData.Patch.RebootPending)</p>
<table>
<tr><th>Hotfix ID</th><th>Description</th><th>Installed On</th></tr>
$($patchRows -join "`n")
</table>
</div>

<div class="section">
<h2>Storage Review</h2>
<p><strong>Windows Update Download Cache (MB):</strong> $($AuditData.Storage.ReviewableStorage.WindowsUpdateDownloadCacheMb)</p>
<p><strong>Local AppData Temp (MB):</strong> $($AuditData.Storage.ReviewableStorage.LocalAppDataTempMb)</p>
<p><strong>User Downloads (MB):</strong> $($AuditData.Storage.ReviewableStorage.UserDownloadsMb)</p>
<p><strong>Windows Temp (MB):</strong> $($AuditData.Storage.ReviewableStorage.WindowsTempMb)</p>
<p class="$(if ($AuditData.Storage.ReviewableStorage.TotalReviewableStorageMb -gt 4096) { 'issue-text' })"><strong>Total Reviewable Storage (MB):</strong> $($AuditData.Storage.ReviewableStorage.TotalReviewableStorageMb)</p>
<p class="$(if ($null -ne $AuditData.Storage.CDriveUsedPercent -and $AuditData.Storage.CDriveUsedPercent -gt 85) { 'issue-text' })"><strong>Free Space on C: (GB):</strong> $($AuditData.Storage.CDriveFreeSpaceGb)</p>
<p class="$(if ($null -ne $AuditData.Storage.CDriveUsedPercent -and $AuditData.Storage.CDriveUsedPercent -gt 85) { 'issue-text' })"><strong>Disk Used Percentage on C:</strong> $($AuditData.Storage.CDriveUsedPercent)</p>
<table>
<tr><th>Drive</th><th>Volume</th><th>Size (GB)</th><th>Free (GB)</th><th>Used (%)</th><th>Status</th></tr>
$($diskRows -join "`n")
</table>
</div>

<div class="section">
<h2>Startup and Performance Snapshot</h2>
<p><strong>Startup Item Count:</strong> $($AuditData.StartupAndPerformance.StartupItemCount)</p>
<table>
<tr><th>Startup Item</th><th>Short Source</th><th>Source / Command</th></tr>
$($startupRows -join "`n")
</table>
<h3>Top CPU-Consuming Processes by Cumulative CPU Time</h3>
<table>
<tr><th>Process</th><th>PID</th><th>CPU Seconds</th><th>Working Set (MB)</th></tr>
$($processRows -join "`n")
</table>
</div>

<div class="section">
<h2>Software Sample</h2>
<table>
<tr><th>Application</th><th>Version</th><th>Publisher</th></tr>
$($softwareRows -join "`n")
</table>
<h3>Potentially Risky Software Flags</h3>
<table>
<tr><th>Keyword</th><th>Application</th><th>Publisher</th><th>Reason</th></tr>
$($flagRows -join "`n")
</table>
</div>

<div class="section">
<h2>System Health Logs</h2>
<p class="$(if ($AuditData.SystemHealth.RecentCriticalOrErrorCount -gt 0) { 'issue-text' })"><strong>Recent Critical/Error System Event Count:</strong> $($AuditData.SystemHealth.RecentCriticalOrErrorCount)</p>
<table>
<tr><th>Time</th><th>Level</th><th>Provider</th><th>Event ID</th><th>Message</th></tr>
$($eventRows -join "`n")
</table>
</div>
<div class="footer">
Prepared by Midas Tech - IT Support & Networking Solutions | 30 Via Renzo Dr Suite 200 Richmond Hill, ON L4S 0B8 | 905-787-2038 | www.midastech.ca
</div>
</body>
</html>
"@
}

if (-not (Test-Path -Path $OutputPath)) {
    New-Item -Path $OutputPath -ItemType Directory | Out-Null
}

try {
    $auditData = Get-AuditData
    $safeComputerName = ($auditData.Identity.ComputerName -replace '[^a-zA-Z0-9\-]', '_')
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $jsonPath = Join-Path -Path $OutputPath -ChildPath "$safeComputerName-$timestamp.json"
    $htmlPath = Join-Path -Path $OutputPath -ChildPath "$safeComputerName-$timestamp.html"

    $auditData | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding UTF8
    (Convert-AuditToHtml -AuditData $auditData) | Set-Content -Path $htmlPath -Encoding UTF8

    [pscustomobject]@{
        ComputerName = $auditData.Identity.ComputerName
        JsonReport   = $jsonPath
        HtmlReport   = $htmlPath
        RiskScore    = $auditData.Risk.Score
        Grade        = $auditData.Risk.LetterGrade
        Findings     = @($auditData.Findings).Count
    }
}
catch {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $errorPath = Join-Path -Path $OutputPath -ChildPath "AuditScript-Error-$timestamp.txt"
    @(
        "Audit script failed."
        "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        "Computer: $env:COMPUTERNAME"
        "User: $env:USERNAME"
        "Message: $($_.Exception.Message)"
        "ScriptStackTrace:"
        $_.ScriptStackTrace
    ) | Set-Content -Path $errorPath -Encoding UTF8

    Write-Error "Audit script failed. Error log written to $errorPath"
    throw
}
