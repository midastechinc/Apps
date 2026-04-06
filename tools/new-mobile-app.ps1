param(
    [Parameter(Mandatory = $true)][string]$AppName,
    [string]$Slug,
    [string]$PackageId = "com.midastech.app",
    [string]$Root = "applications/mobile-apps"
)

$ErrorActionPreference = "Stop"

if (-not $Slug) {
    $Slug = ($AppName.ToLower() -replace "[^a-z0-9]+", "-").Trim("-")
}

$template = Join-Path $Root "_template-expo-app"
$destination = Join-Path $Root $AppName

if (-not (Test-Path -LiteralPath $template)) {
    throw "Template folder not found: $template"
}

if (Test-Path -LiteralPath $destination) {
    throw "Destination already exists: $destination"
}

Copy-Item -LiteralPath $template -Destination $destination -Recurse

$packageJsonPath = Join-Path $destination "package.json"
$appJsonPath = Join-Path $destination "app.json"
$readmePath = Join-Path $destination "README.md"
$envPath = Join-Path $destination ".env.example"

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$packageJson.name = $Slug
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $packageJsonPath), ($packageJson | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))

$appJson = Get-Content -LiteralPath $appJsonPath -Raw | ConvertFrom-Json
$appJson.expo.name = $AppName
$appJson.expo.slug = $Slug
$appJson.expo.android.package = $PackageId
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $appJsonPath), ($appJson | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))

$readme = @"
# $AppName

This mobile app was scaffolded from the shared Expo template.

## Local development

```powershell
npm install
npm run start
```

## Required next steps

1. Replace the starter screen with the first real feature.
2. Create the dedicated GitHub repo for this app.
3. Add the app to the dashboard with GitHub and APK links.
4. Upload APK builds to GitHub Releases.
"@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $readmePath), $readme, [System.Text.UTF8Encoding]::new($false))

$env = Get-Content -LiteralPath $envPath -Raw
$env = $env -replace "My Mobile App", $AppName
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $envPath), $env, [System.Text.UTF8Encoding]::new($false))

Write-Host "Created mobile app scaffold at $destination"
Write-Host "Reminder: create the dedicated GitHub repo for $AppName before development gets far."
