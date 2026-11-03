<#
  BabelTower v3 — Minimal Skeleton Build
  编译 mod/ 下的 .xml/.js/.css → RED2 二进制 → 打包 dist/pak91_dir.vpk
#>

param(
	[string]$Csdk = "F:\dev-tools\Reduced_CSDK_12",
	[string]$VpkCli = "F:\dev-tools\VPKEdit\vpkeditcli.exe",
	[string]$AddonName = "lctskeleton",
	[string]$VpkName = "pak91_dir.vpk"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "mod"
$contentAddon = Join-Path $Csdk "content\citadel_addons\$AddonName"
$gameAddon = Join-Path $Csdk "game\citadel_addons\$AddonName"
$compiler = Join-Path $Csdk "game\bin_cs2\win64\resourcecompiler.exe"
$gameInfoDir = Join-Path $Csdk "game\citadel"
$dist = Join-Path $root "dist"

foreach ($p in @($compiler, $VpkCli)) {
	if (-not (Test-Path $p)) { throw "missing tool: $p" }
}

Write-Host "[1/3] sync sources -> $contentAddon"
if (Test-Path $contentAddon) { Remove-Item -LiteralPath $contentAddon -Recurse -Force }
New-Item -ItemType Directory -Force -Path $contentAddon | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $contentAddon -Recurse -Force

# Ensure addoninfo.txt is also in game addon dir for packing
$gameAddonDir = Join-Path $Csdk "game\citadel_addons\$AddonName"
if (Test-Path $gameAddonDir) { Remove-Item -LiteralPath $gameAddonDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $gameAddonDir | Out-Null
Copy-Item -Path (Join-Path $src "addoninfo.txt") -Destination (Join-Path $gameAddonDir "addoninfo.txt") -Force

Write-Host "[2/3] compile"
$inputs = Get-ChildItem -Path $contentAddon -Recurse -File -Include *.xml, *.js, *.css
if (-not $inputs) { throw "no input files" }

$compilerArgs = @()
foreach ($f in $inputs) { $compilerArgs += @("-i", $f.FullName) }
$compilerArgs += @("-game", $gameInfoDir, "-nop4", "-f")

& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "resourcecompiler failed ($LASTEXITCODE)" }

$compiled = Get-ChildItem -Path $gameAddon -Recurse -File -Include *.vxml_c, *.vjs_c, *.vcss_c
Write-Host ("      compiled: " + (($compiled | ForEach-Object { $_.Name }) -join ", "))

Write-Host "[3/3] pack"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist $VpkName
if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }

& $VpkCli --no-progress -o $out -v 1 -s $gameAddon
if ($LASTEXITCODE -ne 0) { throw "vpkeditcli failed ($LASTEXITCODE)" }

Write-Host ""
& $VpkCli --no-progress --file-tree $out
Write-Host ""
Write-Host ("OUT: " + $out + "  (" + (Get-Item $out).Length + " bytes)")