<#
  LCT CEF Probe — 构建脚本

  流程:
    1. 源文件同步到 Reduced CSDK 的 content/citadel_addons/lctprobe
    2. resourcecompiler 编译 .xml/.js/.css 为 .vxml_c/.vjs_c/.vcss_c
    3. vpkeditcli 打包成 dist/pak91_dir.vpk(根下是 panorama/)

  只允许使用 F:\dev-tools 里的工具。
#>

param(
  [string]$Csdk = "F:\dev-tools\Reduced_CSDK_12",
  [string]$VpkCli = "F:\dev-tools\VPKEdit\vpkeditcli.exe",
  [string]$AddonName = "lctprobe",
  [string]$VpkName = "pak91_dir.vpk"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "probe"
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
if ($compiled.Count -ne $inputs.Count) {
  throw "compiled count mismatch: inputs=$($inputs.Count) outputs=$($compiled.Count)"
}

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
