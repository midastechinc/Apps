param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet("Web App", "Desktop App", "Mobile App", "Scripts", "Workflows")][string]$Category,
    [Parameter(Mandatory = $true)][string]$FolderPath,
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][string]$GithubUrl,
    [string]$Status = "Development",
    [string]$LaunchUrl,
    [string]$DownloadUrl,
    [string]$StartUrl,
    [string[]]$Manual = @(
        "Review the README.md in this folder for setup details.",
        "Use the dashboard actions to launch, download, or run the app.",
        "Update this manual in data/apps.json if the workflow changes."
    ),
    [string]$AppsFile = "data/apps.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FolderPath)) {
    New-Item -ItemType Directory -Path $FolderPath -Force | Out-Null
}

$readmePath = Join-Path $FolderPath "README.md"
if (-not (Test-Path -LiteralPath $readmePath)) {
    $readmeLines = @(
        "# $Name",
        "",
        "## Purpose",
        $Description,
        "",
        "## Quick Start"
    )

    foreach ($step in $Manual) {
        $readmeLines += "- $step"
    }

    [System.IO.File]::WriteAllLines((Join-Path (Get-Location) $readmePath), $readmeLines, [System.Text.UTF8Encoding]::new($false))
}

$appsData = Get-Content -LiteralPath $AppsFile -Raw | ConvertFrom-Json
if ($appsData.apps | Where-Object { $_.name -eq $Name -or $_.folderPath -eq $FolderPath }) {
    throw "An application with this name or folderPath already exists in $AppsFile."
}

$links = New-Object System.Collections.Generic.List[object]
if ($LaunchUrl) {
    $links.Add([ordered]@{ label = "Launch"; url = $LaunchUrl; type = "app" })
}
if ($StartUrl) {
    $links.Add([ordered]@{ label = "Start Locally"; url = $StartUrl; type = "start" })
}
if ($DownloadUrl) {
    $links.Add([ordered]@{ label = "Download"; url = $DownloadUrl; type = "download" })
}
$links.Add([ordered]@{ label = "GitHub"; url = $GithubUrl; type = "github" })

$newApp = [ordered]@{
    name = $Name
    category = $Category
    folderPath = $FolderPath.Replace("\", "/")
    description = $Description
    status = $Status
    lastUpdated = (Get-Date).ToString("yyyy-MM-dd")
    manual = $Manual
    notes = @("Registered with register-dashboard-app.ps1.")
    apis = @()
    databases = @()
    links = $links
}

$allApps = @($appsData.apps + $newApp) | Sort-Object category, name
$payload = [ordered]@{ apps = $allApps }
$appsPath = Join-Path (Get-Location) $AppsFile
[System.IO.File]::WriteAllText($appsPath, ($payload | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))

& (Join-Path $PSScriptRoot "sync-dashboard-data.ps1") -JsonPath $AppsFile

Write-Host "Registered $Name in the dashboard."
