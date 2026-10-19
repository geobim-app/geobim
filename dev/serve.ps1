# Local development server for geoBIM.app: http://localhost:8000/
#
# Needs PHP 8 (winget install PHP.PHP.8.4), config.js and logo/ in the repo root,
# and a localhost-restricted Cesium ion token in $HOME\.geobim\ion-dev-token.txt.
# Upload, converter, server models, owner login and iTwin login need the server: test them on beta.

param([int]$Port = 8000)

$root = Split-Path $PSScriptRoot -Parent
$tokenFile = Join-Path $HOME '.geobim\ion-dev-token.txt'

foreach ($f in 'config.js', 'logo\logo_teal_transparent.png') {
    if (-not (Test-Path (Join-Path $root $f))) { Write-Warning "$f missing (copy it from the server)" }
}
if (-not (Test-Path $tokenFile) -or (Get-Item $tokenFile).Length -eq 0) {
    Write-Warning "No Cesium ion dev token in $tokenFile - Ion assets, World Terrain and Google 3D Tiles will not load"
}

$php = (Get-Command php -ErrorAction SilentlyContinue).Source
if (-not $php) { throw 'php not found (winget install PHP.PHP.8.4, then open a new shell)' }

$env:GEOBIM_ION_TOKEN_FILE = $tokenFile
Write-Host "geoBIM.app: http://localhost:$Port/  (Ctrl+C stops)"
& $php -S "localhost:$Port" -t $root (Join-Path $PSScriptRoot 'router.php')
