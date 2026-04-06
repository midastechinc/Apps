param(
    [string]$JsonPath = "data/apps.json",
    [string]$JsPath = "data/apps-data.js"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $JsonPath)) {
    throw "Apps JSON file not found: $JsonPath"
}

$rawJson = Get-Content -LiteralPath $JsonPath -Raw
$parsed = $rawJson | ConvertFrom-Json

if (-not $parsed.apps) {
    throw "Apps JSON file does not contain an apps array."
}

$normalizedJson = $parsed | ConvertTo-Json -Depth 20
$jsPayload = "window.MIDAS_APPS_DATA = $normalizedJson;"

[System.IO.File]::WriteAllText((Resolve-Path $JsonPath), $normalizedJson, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Resolve-Path $JsPath), $jsPayload, [System.Text.UTF8Encoding]::new($false))

Write-Host "Synced dashboard data to $JsonPath and $JsPath"
