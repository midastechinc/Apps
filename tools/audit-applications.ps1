param(
    [string]$AppsFile = "data/apps.json",
    [string]$ApplicationsRoot = "applications",
    [string]$OutputPath = ("reports/application-audit-{0}.md" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AppsFile)) {
    throw "Apps file not found: $AppsFile"
}

$appsData = Get-Content -LiteralPath $AppsFile -Raw | ConvertFrom-Json
$apps = @($appsData.apps)

$issues = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

foreach ($app in $apps) {
    $appName = $app.name
    $folderPath = [string]$app.folderPath

    if ([string]::IsNullOrWhiteSpace($folderPath)) {
        $issues.Add("${appName}: missing folderPath.")
    } elseif (-not (Test-Path -LiteralPath $folderPath)) {
        $issues.Add("${appName}: folderPath does not exist ($folderPath).")
    }

    if (-not $app.manual -or $app.manual.Count -eq 0) {
        $issues.Add("${appName}: missing short usage manual.")
    }

    $githubLinks = @($app.links | Where-Object { $_.type -eq "github" })
    if ($githubLinks.Count -eq 0) {
        $issues.Add("${appName}: missing GitHub link.")
    } else {
        foreach ($link in $githubLinks) {
            if ([string]$link.url -notmatch '^https://github\.com/') {
                $issues.Add("${appName}: GitHub link is not a github.com URL ($($link.url)).")
            }

            if ([string]$link.url -match 'github\.com/.+/Apps(/|$)') {
                $warnings.Add("${appName}: still points at the shared Apps repo instead of a standalone repository.")
            }
        }
    }

    $downloadLinks = @($app.links | Where-Object { $_.type -eq "download" })
    $startLinks = @($app.links | Where-Object { $_.type -eq "start" })
    $launchLinks = @($app.links | Where-Object { $_.type -eq "app" })

    switch ($app.category) {
        "Web App" {
            if ($launchLinks.Count -eq 0) {
                $issues.Add("${appName}: web app is missing a launch link.")
            }
        }
        "Desktop App" {
            if ($downloadLinks.Count -eq 0) {
                $issues.Add("${appName}: desktop app is missing a download link.")
            }
            if ($downloadLinks.Count -gt 0 -and -not ($downloadLinks | Where-Object { $_.url -match 'github\.com' })) {
                $issues.Add("${appName}: desktop app download is not hosted on GitHub.")
            }
        }
        "Mobile App" {
            if (-not ($downloadLinks | Where-Object { $_.url -match '\.apk($|\?)' })) {
                $issues.Add("${appName}: mobile app is missing an APK download link.")
            }
        }
        "Scripts" {
            if ($downloadLinks.Count -eq 0 -and $startLinks.Count -eq 0) {
                $issues.Add("${appName}: script is missing both download and local start links.")
            }
            if ($downloadLinks.Count -gt 0 -and -not ($downloadLinks | Where-Object { $_.url -match 'github\.com' })) {
                $warnings.Add("${appName}: script download is local-only; consider a GitHub-hosted download URL.")
            }
        }
        "Workflows" {
            if ($downloadLinks.Count -eq 0) {
                $issues.Add("${appName}: workflow is missing a download link.")
            }
            if ($downloadLinks.Count -gt 0 -and -not ($downloadLinks | Where-Object { $_.url -match 'github\.com' })) {
                $warnings.Add("${appName}: workflow download is local-only; consider a GitHub-hosted download URL.")
            }
        }
    }
}

$trackedRoots = @($apps.folderPath | Where-Object { $_ } | ForEach-Object {
    $segments = $_ -split '/'
    if ($segments.Length -ge 3) {
        ($segments[0..2] -join '/')
    }
}) | Sort-Object -Unique

$actualRoots = Get-ChildItem -LiteralPath $ApplicationsRoot -Directory | ForEach-Object {
    $categoryDir = $_
    Get-ChildItem -LiteralPath $categoryDir.FullName -Directory | ForEach-Object {
        ($_.FullName.Substring((Get-Location).Path.Length + 1)).Replace('\', '/')
    }
}

$untrackedFolders = @($actualRoots | Where-Object { $_ -notin $trackedRoots } | Sort-Object -Unique)

$knownMissing = @(
    [pscustomobject]@{
        name = "Midas Tech Gallery"
        detail = "Historical dashboard entry was removed because no mobile source folder or APK was found in My Application or the old Codex folder."
    }
)

$reportDir = Split-Path -Parent $OutputPath
if ($reportDir -and -not (Test-Path -LiteralPath $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}

$report = New-Object System.Collections.Generic.List[string]
$report.Add("# Application Audit")
$report.Add("")
$report.Add("- Audit date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$report.Add("- Dashboard apps checked: $($apps.Count)")
$report.Add("- Issues: $($issues.Count)")
$report.Add("- Warnings: $($warnings.Count)")
$report.Add("- Untracked folders: $($untrackedFolders.Count)")
$report.Add("")
$report.Add("## Issues")
if ($issues.Count -eq 0) {
    $report.Add("- None")
} else {
    $issues | ForEach-Object { $report.Add("- $_") }
}
$report.Add("")
$report.Add("## Warnings")
if ($warnings.Count -eq 0) {
    $report.Add("- None")
} else {
    $warnings | ForEach-Object { $report.Add("- $_") }
}
$report.Add("")
$report.Add("## Untracked Folders")
if ($untrackedFolders.Count -eq 0) {
    $report.Add("- None")
} else {
    $untrackedFolders | ForEach-Object { $report.Add("- $_") }
}
$report.Add("")
$report.Add("## Known Missing Apps")
$knownMissing | ForEach-Object { $report.Add("- $($_.name): $($_.detail)") }

Set-Content -LiteralPath $OutputPath -Value $report -Encoding UTF8

Write-Host "Audit report written to $OutputPath"
Write-Host "Issues: $($issues.Count) | Warnings: $($warnings.Count) | Untracked folders: $($untrackedFolders.Count)"
