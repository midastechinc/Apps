param(
    [string]$OutputFolder = (Join-Path -Path $PSScriptRoot -ChildPath 'IncidentReports'),
    [int]$HoursBack = 72,
    [switch]$IncludeFileHashes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Safely {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$ScriptBlock,
        [object]$DefaultValue = $null
    )

    try {
        & $ScriptBlock
    }
    catch {
        $DefaultValue
    }
}

function Test-IsAdministrator {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Convert-ToRisk {
    param([string]$Level)

    switch ($Level) {
        'High' { 3 }
        'Medium' { 2 }
        'Low' { 1 }
        default { 0 }
    }
}

function New-Finding {
    param(
        [Parameter(Mandatory = $true)][string]$Category,
        [Parameter(Mandatory = $true)][string]$Level,
        [Parameter(Mandatory = $true)][string]$Summary,
        [string]$Details
    )

    [pscustomobject]@{
        Category = $Category
        Level    = $Level
        Score    = Convert-ToRisk -Level $Level
        Summary  = $Summary
        Details  = $Details
    }
}

function Get-FileSignatureState {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
        return 'Missing'
    }

    $signature = Invoke-Safely -ScriptBlock {
        Get-AuthenticodeSignature -FilePath $Path
    }

    if ($null -eq $signature) {
        return 'Unknown'
    }

    [string]$signature.Status
}

function Get-ProcessInventory {
    $processes = @(Invoke-Safely -ScriptBlock {
            Get-CimInstance Win32_Process | Sort-Object ProcessId
        } -DefaultValue @())

    foreach ($process in $processes) {
        $path = $process.ExecutablePath
        $signatureState = Get-FileSignatureState -Path $path
        $hash = $null

        if ($IncludeFileHashes -and $path -and (Test-Path -LiteralPath $path)) {
            $hash = Invoke-Safely -ScriptBlock {
                (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash
            }
        }

        [pscustomobject]@{
            Name            = $process.Name
            ProcessId       = $process.ProcessId
            ParentProcessId = $process.ParentProcessId
            ExecutablePath  = $path
            CommandLine     = $process.CommandLine
            Signature       = $signatureState
            SHA256          = $hash
        }
    }
}

function Get-SuspiciousProcesses {
    param([object[]]$ProcessInventory)

    $userWritableRoots = @(
        $env:TEMP,
        $env:TMP,
        $env:APPDATA,
        $env:LOCALAPPDATA,
        (Join-Path $env:USERPROFILE 'Downloads'),
        (Join-Path $env:USERPROFILE 'Desktop')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($process in $ProcessInventory) {
        $path = $process.ExecutablePath
        $suspiciousReasons = New-Object System.Collections.Generic.List[string]

        if ($path) {
            foreach ($root in $userWritableRoots) {
                if ($root -and $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $suspiciousReasons.Add("Runs from user-writable path: $root")
                    break
                }
            }
        }

        if ($process.Signature -notin @('Valid', 'NotSigned', 'Missing', 'Unknown')) {
            $suspiciousReasons.Add("Code signature state is $($process.Signature)")
        }

        if ($process.CommandLine -match '(?i)(-enc\s|FromBase64String|DownloadString|IEX\s|Invoke-Expression)') {
            $suspiciousReasons.Add('Command line contains common obfuscation or remote execution patterns')
        }

        if ($process.Name -match '(?i)^(powershell|pwsh|cmd|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin)\.exe$' -and
            $process.CommandLine -match '(?i)(http|https|\\\\|javascript:|vbscript:|-enc\s)') {
            $suspiciousReasons.Add('LOLBin process has an unusual command line')
        }

        if ($suspiciousReasons.Count -gt 0) {
            [pscustomobject]@{
                Name        = $process.Name
                ProcessId   = $process.ProcessId
                Path        = $path
                CommandLine = $process.CommandLine
                Signature   = $process.Signature
                Reasons     = @($suspiciousReasons)
            }
        }
    }
}

function Get-NetworkInventory {
    $connections = @(Invoke-Safely -ScriptBlock {
            Get-NetTCPConnection -ErrorAction Stop
        } -DefaultValue @())

    foreach ($connection in $connections) {
        $process = Invoke-Safely -ScriptBlock {
            Get-Process -Id $connection.OwningProcess -ErrorAction Stop
        }

        [pscustomobject]@{
            State         = $connection.State
            LocalAddress  = $connection.LocalAddress
            LocalPort     = $connection.LocalPort
            RemoteAddress = $connection.RemoteAddress
            RemotePort    = $connection.RemotePort
            ProcessId     = $connection.OwningProcess
            ProcessName   = if ($process) { $process.ProcessName } else { $null }
        }
    }
}

function Get-SuspiciousConnections {
    param([object[]]$NetworkInventory)

    foreach ($connection in $NetworkInventory) {
        if ($connection.State -ne 'Established') {
            continue
        }

        if ($connection.RemoteAddress -in @('0.0.0.0', '::', '::1', '127.0.0.1')) {
            continue
        }

        if ($connection.RemotePort -in 22, 23, 135, 139, 445, 3389, 4444, 5985, 5986) {
            [pscustomobject]@{
                ProcessName   = $connection.ProcessName
                ProcessId     = $connection.ProcessId
                RemoteAddress = $connection.RemoteAddress
                RemotePort    = $connection.RemotePort
                Reason        = 'Established connection uses a high-risk administration or lateral-movement port'
            }
        }
    }
}

function Get-StartupInventory {
    $items = New-Object System.Collections.Generic.List[object]

    $registryPaths = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
    )

    foreach ($path in $registryPaths) {
        $entry = Invoke-Safely -ScriptBlock { Get-ItemProperty -Path $path }
        if (-not $entry) { continue }

        foreach ($property in $entry.PSObject.Properties) {
            if ($property.Name -in 'PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider') {
                continue
            }

            $items.Add([pscustomobject]@{
                    Type    = 'RegistryRun'
                    Source  = $path
                    Name    = $property.Name
                    Command = [string]$property.Value
                })
        }
    }

    $startupFolders = @(
        [Environment]::GetFolderPath('Startup'),
        (Join-Path -Path $env:ProgramData -ChildPath 'Microsoft\Windows\Start Menu\Programs\Startup')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    foreach ($folder in $startupFolders) {
        Get-ChildItem -LiteralPath $folder -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $items.Add([pscustomobject]@{
                    Type    = 'StartupFolder'
                    Source  = $folder
                    Name    = $_.Name
                    Command = $_.FullName
                })
        }
    }

    $items.ToArray()
}

function Get-ScheduledTaskInventory {
    @(Invoke-Safely -ScriptBlock {
            Get-ScheduledTask -ErrorAction Stop | ForEach-Object {
                $actions = $_.Actions | ForEach-Object {
                    '{0} {1}' -f $_.Execute, $_.Arguments
                }

                [pscustomobject]@{
                    TaskName = $_.TaskName
                    TaskPath = $_.TaskPath
                    State    = $_.State
                    Author   = $_.Author
                    RunAs    = $_.Principal.UserId
                    Actions  = @($actions)
                    Triggers = @($_.Triggers | ForEach-Object { $_.ToString() })
                }
            }
        } -DefaultValue @())
}

function Get-SuspiciousPersistence {
    param(
        [object[]]$StartupInventory,
        [object[]]$TaskInventory
    )

    $results = New-Object System.Collections.Generic.List[object]
    $persistencePattern = '(?i)(appdata|temp|downloads|powershell|pwsh|cmd\.exe|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin|http|https)'

    foreach ($item in $StartupInventory) {
        if ($item.Command -match $persistencePattern) {
            $results.Add([pscustomobject]@{
                    Type    = $item.Type
                    Name    = $item.Name
                    Source  = $item.Source
                    Details = $item.Command
                })
        }
    }

    foreach ($task in $TaskInventory) {
        $joinedActions = ($task.Actions -join ' | ')
        if ($joinedActions -match $persistencePattern) {
            $results.Add([pscustomobject]@{
                    Type    = 'ScheduledTask'
                    Name    = $task.TaskName
                    Source  = $task.TaskPath
                    Details = $joinedActions
                })
        }
    }

    $results.ToArray()
}

function Get-DefenderStatus {
    Invoke-Safely -ScriptBlock {
        Get-MpComputerStatus -ErrorAction Stop | Select-Object AMServiceEnabled, AntispywareEnabled, AntivirusEnabled,
        BehaviorMonitorEnabled, IoavProtectionEnabled, NISEnabled, RealTimeProtectionEnabled,
        QuickScanAge, FullScanAge, AntivirusSignatureLastUpdated, DefenderSignaturesOutOfDate
    }
}

function Get-FirewallStatus {
    @(Invoke-Safely -ScriptBlock {
            Get-NetFirewallProfile -ErrorAction Stop | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
        } -DefaultValue @())
}

function Get-AdminAccounts {
    @(Invoke-Safely -ScriptBlock {
            Get-LocalGroupMember -Group 'Administrators' | Select-Object Name, PrincipalSource, ObjectClass
        } -DefaultValue @())
}

function Get-LocalUsers {
    @(Invoke-Safely -ScriptBlock {
            Get-LocalUser | Select-Object Name, Enabled, LastLogon, PasswordLastSet
        } -DefaultValue @())
}

function Get-RecentEvents {
    param([int]$Hours)

    $startTime = (Get-Date).AddHours(-1 * $Hours)
    $eventSpecs = @(
        @{ LogName = 'Security'; Id = 4624; Label = 'SuccessfulLogon' },
        @{ LogName = 'Security'; Id = 4625; Label = 'FailedLogon' },
        @{ LogName = 'Security'; Id = 4720; Label = 'UserCreated' },
        @{ LogName = 'Security'; Id = 4728; Label = 'AddedToAdminGroup' },
        @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; Id = 1116; Label = 'DefenderMalwareDetected' },
        @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; Id = 5007; Label = 'DefenderConfigChanged' },
        @{ LogName = 'Windows PowerShell'; Id = 400; Label = 'PowerShellEngineStarted' }
    )

    $events = New-Object System.Collections.Generic.List[object]

    foreach ($spec in $eventSpecs) {
        $found = @(Invoke-Safely -ScriptBlock {
                Get-WinEvent -FilterHashtable @{
                    LogName   = $spec.LogName
                    Id        = $spec.Id
                    StartTime = $startTime
                } -ErrorAction Stop | Select-Object -First 20
            } -DefaultValue @())

        foreach ($event in $found) {
            $events.Add([pscustomobject]@{
                    TimeCreated = $event.TimeCreated
                    LogName     = $spec.LogName
                    EventId     = $spec.Id
                    Label       = $spec.Label
                    Message     = $event.Message
                })
        }
    }

    @($events | Sort-Object TimeCreated -Descending)
}

function Get-RdpStatus {
    $system = Invoke-Safely -ScriptBlock {
        Get-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server'
    }

    [pscustomobject]@{
        RdpEnabled = if ($system) { $system.fDenyTSConnections -eq 0 } else { $null }
    }
}

function Get-Overview {
    $os = Invoke-Safely -ScriptBlock { Get-CimInstance Win32_OperatingSystem }
    $computer = Invoke-Safely -ScriptBlock { Get-CimInstance Win32_ComputerSystem }

    [pscustomobject]@{
        ComputerName = $env:COMPUTERNAME
        UserName     = $env:USERNAME
        Domain       = $env:USERDOMAIN
        Manufacturer = if ($computer) { $computer.Manufacturer } else { $null }
        Model        = if ($computer) { $computer.Model } else { $null }
        OS           = if ($os) { $os.Caption } else { $null }
        Version      = if ($os) { $os.Version } else { $null }
        LastBoot     = if ($os) { $os.LastBootUpTime } else { $null }
        IsAdmin      = Test-IsAdministrator
    }
}

function Get-Findings {
    param(
        [object[]]$SuspiciousProcesses,
        [object[]]$SuspiciousConnections,
        [object[]]$SuspiciousPersistence,
        [object]$DefenderStatus,
        [object[]]$FirewallStatus,
        [object[]]$AdminAccounts,
        [object[]]$RecentEvents,
        [object]$RdpStatus
    )

    $findings = New-Object System.Collections.Generic.List[object]

    if ($SuspiciousProcesses.Count -gt 0) {
        $findings.Add((New-Finding -Category 'Processes' -Level 'High' -Summary "$($SuspiciousProcesses.Count) suspicious process(es) found" -Details (($SuspiciousProcesses | Select-Object -First 5 | ForEach-Object { "$($_.Name) PID $($_.ProcessId)" }) -join '; ')))
    }

    if ($SuspiciousConnections.Count -gt 0) {
        $findings.Add((New-Finding -Category 'Network' -Level 'High' -Summary "$($SuspiciousConnections.Count) established high-risk connection(s) found" -Details (($SuspiciousConnections | Select-Object -First 5 | ForEach-Object { "$($_.ProcessName) -> $($_.RemoteAddress):$($_.RemotePort)" }) -join '; ')))
    }

    if ($SuspiciousPersistence.Count -gt 0) {
        $findings.Add((New-Finding -Category 'Persistence' -Level 'High' -Summary "$($SuspiciousPersistence.Count) suspicious persistence item(s) found" -Details (($SuspiciousPersistence | Select-Object -First 5 | ForEach-Object { "$($_.Type): $($_.Name)" }) -join '; ')))
    }

    if (-not $DefenderStatus) {
        $findings.Add((New-Finding -Category 'Defender' -Level 'Medium' -Summary 'Microsoft Defender status could not be read' -Details 'Run the script as Administrator to improve coverage.'))
    }
    elseif (-not $DefenderStatus.RealTimeProtectionEnabled) {
        $findings.Add((New-Finding -Category 'Defender' -Level 'High' -Summary 'Real-time protection is disabled' -Details 'This increases the risk of active compromise going undetected.'))
    }
    elseif ($DefenderStatus.DefenderSignaturesOutOfDate) {
        $findings.Add((New-Finding -Category 'Defender' -Level 'Medium' -Summary 'Defender signatures are out of date' -Details "Signature last updated: $($DefenderStatus.AntivirusSignatureLastUpdated)"))
    }

    if (@($FirewallStatus | Where-Object { -not $_.Enabled }).Count -gt 0) {
        $findings.Add((New-Finding -Category 'Firewall' -Level 'Medium' -Summary 'One or more firewall profiles are disabled' -Details (($FirewallStatus | Where-Object { -not $_.Enabled } | ForEach-Object { $_.Name }) -join ', ')))
    }

    if ($AdminAccounts.Count -gt 5) {
        $findings.Add((New-Finding -Category 'Accounts' -Level 'Low' -Summary "Administrators group has $($AdminAccounts.Count) members" -Details 'Review for unexpected accounts with local admin rights.'))
    }

    if ($RdpStatus.RdpEnabled) {
        $findings.Add((New-Finding -Category 'RemoteAccess' -Level 'Low' -Summary 'Remote Desktop is enabled' -Details 'Confirm this is intentional and restricted to trusted administrators.'))
    }

    $recentUserCreations = @($RecentEvents | Where-Object { $_.EventId -eq 4720 })
    if ($recentUserCreations.Count -gt 0) {
        $findings.Add((New-Finding -Category 'Accounts' -Level 'High' -Summary 'Recent local or domain user creation events were found' -Details (($recentUserCreations | Select-Object -First 3 | ForEach-Object { $_.TimeCreated.ToString('s') }) -join ', ')))
    }

    $recentAdminAdds = @($RecentEvents | Where-Object { $_.EventId -eq 4728 })
    if ($recentAdminAdds.Count -gt 0) {
        $findings.Add((New-Finding -Category 'Accounts' -Level 'High' -Summary 'Recent administrator group membership changes were found' -Details (($recentAdminAdds | Select-Object -First 3 | ForEach-Object { $_.TimeCreated.ToString('s') }) -join ', ')))
    }

    @($findings | Sort-Object -Property Score, Category -Descending)
}

function Write-TextReport {
    param(
        [string]$Path,
        [object]$Report
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('COMPROMISE INDICATOR CHECK')
    $lines.Add(('Generated: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')))
    $lines.Add(('Computer : {0}' -f $Report.Overview.ComputerName))
    $lines.Add(('User     : {0}\{1}' -f $Report.Overview.Domain, $Report.Overview.UserName))
    $lines.Add(('Admin    : {0}' -f $Report.Overview.IsAdmin))
    $lines.Add('')
    $lines.Add('IMPORTANT')
    $lines.Add('This script checks for common indicators and misconfigurations. It is not a full forensic investigation.')
    $lines.Add('')
    $lines.Add('RISK SUMMARY')
    $lines.Add(('Risk Score: {0}' -f $Report.RiskScore))

    if ($Report.Findings.Count -eq 0) {
        $lines.Add('No high-confidence indicators were found by these checks.')
    }
    else {
        foreach ($finding in $Report.Findings) {
            $lines.Add(('[{0}] {1}: {2}' -f $finding.Level.ToUpperInvariant(), $finding.Category, $finding.Summary))
            if ($finding.Details) {
                $lines.Add(('  {0}' -f $finding.Details))
            }
        }
    }

    $lines.Add('')
    $lines.Add('NEXT STEPS')
    $lines.Add('1. If you suspect active compromise, disconnect the PC from the network.')
    $lines.Add('2. Run a full Microsoft Defender scan and, if possible, an offline scan.')
    $lines.Add('3. Review suspicious processes, tasks, startup items, and admin accounts in the JSON report.')
    $lines.Add('4. Change passwords from a different trusted device if account abuse is suspected.')
    $lines.Add('5. Preserve evidence before deleting files if this system may need professional forensic review.')

    Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $OutputFolder)) {
    New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$processInventory = @(Get-ProcessInventory)
$suspiciousProcesses = @(Get-SuspiciousProcesses -ProcessInventory $processInventory)
$networkInventory = @(Get-NetworkInventory)
$suspiciousConnections = @(Get-SuspiciousConnections -NetworkInventory $networkInventory)
$startupInventory = @(Get-StartupInventory)
$taskInventory = @(Get-ScheduledTaskInventory)
$suspiciousPersistence = @(Get-SuspiciousPersistence -StartupInventory $startupInventory -TaskInventory $taskInventory)
$defenderStatus = Get-DefenderStatus
$firewallStatus = @(Get-FirewallStatus)
$adminAccounts = @(Get-AdminAccounts)
$localUsers = @(Get-LocalUsers)
$recentEvents = @(Get-RecentEvents -Hours $HoursBack)
$rdpStatus = Get-RdpStatus
$findings = @(Get-Findings -SuspiciousProcesses $suspiciousProcesses -SuspiciousConnections $suspiciousConnections -SuspiciousPersistence $suspiciousPersistence -DefenderStatus $defenderStatus -FirewallStatus $firewallStatus -AdminAccounts $adminAccounts -RecentEvents $recentEvents -RdpStatus $rdpStatus)

$report = [pscustomobject]@{
    Overview              = Get-Overview
    RiskScore             = ($findings | Measure-Object -Property Score -Sum).Sum
    Findings              = $findings
    DefenderStatus        = $defenderStatus
    FirewallProfiles      = $firewallStatus
    AdminAccounts         = $adminAccounts
    LocalUsers            = $localUsers
    RdpStatus             = $rdpStatus
    SuspiciousProcesses   = $suspiciousProcesses
    SuspiciousConnections = $suspiciousConnections
    SuspiciousPersistence = $suspiciousPersistence
    StartupItems          = $startupInventory
    ScheduledTasks        = $taskInventory
    RecentEvents          = $recentEvents
}

$jsonPath = Join-Path -Path $OutputFolder -ChildPath "CompromiseCheck_$timestamp.json"
$textPath = Join-Path -Path $OutputFolder -ChildPath "CompromiseCheck_$timestamp.txt"

$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
Write-TextReport -Path $textPath -Report $report

[pscustomobject]@{
    JsonReport = $jsonPath
    TextReport = $textPath
    RiskScore  = $report.RiskScore
    Findings   = $report.Findings.Count
}
