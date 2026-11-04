<#
  BabelTower v3 - QOL compat pack build
  Generates merged layouts (current game base + our insertions + QOLLOCK 4.0.5 graft)
  and packs dist/pak03_dir.vpk.
  Graft source = _reference\qollock405_hud / qollock405_esc (Source2Viewer, 2026-11-04).
  Design: docs/COMPATIBILITY.md section 4.2
#>

param(
	[string]$Csdk = "F:\dev-tools\Reduced_CSDK_12",
	[string]$VpkCli = "F:\dev-tools\VPKEdit\vpkeditcli.exe",
	[string]$AddonName = "lctcompat",
	[string]$VpkName = "pak03_dir.vpk"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$srcLayout = Join-Path $root "mod\panorama\layout"
$refDir = Join-Path $root "_reference"
$outDir = Join-Path $PSScriptRoot "panorama\layout"
$contentAddon = Join-Path $Csdk "content\citadel_addons\$AddonName"
$gameAddon = Join-Path $Csdk "game\citadel_addons\$AddonName"
$compiler = Join-Path $Csdk "game\bin_cs2\win64\resourcecompiler.exe"
$gameInfoDir = Join-Path $Csdk "game\citadel"
$dist = Join-Path $root "dist"

foreach ($p in @($compiler, $VpkCli)) {
	if (-not (Test-Path $p)) { throw "missing tool: $p" }
}

# ---------- [1/4] generate merged layouts ----------
Write-Host "[1/4] graft merged layouts -> $outDir"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$ourHud = [System.IO.File]::ReadAllLines((Join-Path $srcLayout "hud.xml"))
$ourEsc = [System.IO.File]::ReadAllLines((Join-Path $srcLayout "hud_escape_menu.xml"))
$qHud = [System.IO.File]::ReadAllLines((Join-Path $refDir "qollock405_hud"))
$qEsc = [System.IO.File]::ReadAllLines((Join-Path $refDir "qollock405_esc"))

function Find-Anchor([string[]]$lines, [string]$pattern) {
	for ($i = 0; $i -lt $lines.Count; $i++) {
		if ($lines[$i] -match $pattern) { return $i }
	}
	throw "anchor not found: $pattern"
}

function Get-Block([string[]]$lines, [int]$from, [int]$to) {
	# 1-based inclusive; leading comma prevents single-element unroll so [0] is a full line
	return , $lines[($from - 1)..($to - 1)]
}

# === hud.xml ===
$h = New-Object System.Collections.Generic.List[string]
$h.AddRange([string[]]$ourHud)

# QOL styles (2 lines) after game hud.vcss, before our lct_net
$i = Find-Anchor $h 's2r://panorama/styles/hud\.vcss'
$h.InsertRange($i + 1, [string[]]@(
	(Get-Block $qHud 9 9)[0],
	(Get-Block $qHud 10 10)[0],
	"		<!-- BabelTower-QOL compat: two styles above grafted from QOLLOCK 4.0.5 (showrank + qollock_global) -->"
))

# QOL HUD script load graph (80 lines) at top of <scripts>; internal order preserved verbatim
$j = Find-Anchor $h '^\t<scripts>\s*$'
$blk = Get-Block $qHud 13 92
$h.InsertRange($j + 1, [string[]](@(
	"		<!-- BabelTower-QOL compat: the 80 includes below grafted from QOLLOCK 4.0.5 HUD"
	"		     load graph (ql_namespace -> ql_app), order preserved verbatim; our scripts load after -->"
) + $blk))
[System.IO.File]::WriteAllLines((Join-Path $outDir "hud.xml"), $h)
Write-Host ("      hud.xml: " + $h.Count + " lines")

# === hud_escape_menu.xml ===
$e = New-Object System.Collections.Generic.List[string]
$e.AddRange([string[]]$ourEsc)

# QOL style (1 line) after game hud_escape_menu.vcss_c
$i = Find-Anchor $e 's2r://panorama/styles/hud_escape_menu\.vcss_c'
$e.Insert($i + 1, "		<include src=`"s2r://panorama/styles/ql_settings.vcss_c`" /> <!-- BabelTower-QOL compat: grafted from QOLLOCK 4.0.5 -->")

# QOL settings load graph (53 lines) at top of <scripts>; our scripts load after
$j = Find-Anchor $e '^\t<scripts>\s*$'
$blk = Get-Block $qEsc 9 60
$e.InsertRange($j + 1, [string[]](@(
	"		<!-- BabelTower-QOL compat: the 53 includes below grafted from QOLLOCK 4.0.5 settings"
	"		     load graph, order preserved verbatim; our scripts load after (Esc/background hooks:"
	"		     both sides SetPanelEvent, last loader wins, both branches cover each other,"
	"		     see docs/COMPATIBILITY.md section 5) -->"
) + $blk))

# EscapeBackground -> QOL 4.0.5 inline-guard version (our window handled by runtime hooks)
# anchor on the real panel line, not comment text mentioning EscapeBackground
$b = Find-Anchor $e '<Panel[^>]*id="EscapeBackground"'
$e[$b] = (Get-Block $qEsc 63 63)[0]

# QOL settings window shell right after EscapeBackground
$sw = Get-Block $qEsc 64 74
$e.InsertRange($b + 1, [string[]](@(
	"		<!-- BabelTower-QOL compat: window shell below grafted from QOLLOCK 4.0.5, verbatim -->"
) + $sw))

# QOL entry button row after our LCT row
$g = Find-Anchor $e 'LCTSettingsGearIcon'
$m = $null
for ($x = $g + 1; $x -lt $e.Count; $x++) {
	if ($e[$x].Trim() -eq "</Panel>") { $m = $x; break }
}
if ($null -eq $m) { throw "LCT row close not found" }
$row = Get-Block $qEsc 124 129
$e.InsertRange($m + 1, [string[]](@(
	"					<!-- BabelTower-QOL compat: entry button below grafted from QOLLOCK 4.0.5, verbatim -->"
) + $row))

# QOL CEF storage bridge before </CitadelHudEscapeMenu>
$t = Find-Anchor $e '</CitadelHudEscapeMenu>'
$e.Insert($t, "		<!-- BabelTower-QOL compat: CEF storage bridge below grafted from QOLLOCK 4.0.5, verbatim -->")
$e.Insert($t + 1, (Get-Block $qEsc 163 163)[0])

[System.IO.File]::WriteAllLines((Join-Path $outDir "hud_escape_menu.xml"), $e)
Write-Host ("      hud_escape_menu.xml: " + $e.Count + " lines")

# ---------- graft assertions (fail loudly on silent graft loss) ----------
function Assert-Count([string]$label, [string[]]$lines, [string]$pattern, [int]$expected) {
	$n = ($lines | Where-Object { $_ -match $pattern }).Count
	if ($n -ne $expected) { throw ("graft assertion failed: {0} expected {1}, found {2}" -f $label, $expected, $n) }
}
Assert-Count "hud showrank style" $h 'styles/showrank\.vcss_c' 1
Assert-Count "hud qollock_global style" $h 'styles/qollock_global\.vcss_c' 1
Assert-Count "hud script includes (80 QOL + 2 ours)" $h '<include src=.*\.vjs_c' 82
Assert-Count "hud our lc scripts" $h 'scripts/lc_' 2
Assert-Count "esc ql_settings style" $e 'styles/ql_settings\.vcss_c' 1
Assert-Count "esc script includes (52 QOL + 3 ours)" $e '<include src=.*\.vjs_c' 55
Assert-Count "esc ModSettingsBtn (QOL row)" $e 'id="ModSettingsBtn"' 1
Assert-Count "esc LCTModSettingsBtn (our row)" $e 'id="LCTModSettingsBtn"' 1
Assert-Count "esc QOL settings window shell" $e 'id="SettingsWindow"' 1
Assert-Count "esc QOL storage bridge" $e 'id="QOLStorageBridge"' 1
Assert-Count "esc inline guard escaped amps" $e 'IsModSettingsOpen &am[p];&am[p];' 1
Write-Host "      graft assertions OK"

# addoninfo (same fields as main pack, distinct title)
Copy-Item -Path (Join-Path $root "mod\addoninfo.txt") -Destination (Join-Path $PSScriptRoot "addoninfo.txt") -Force

# ---------- [2/4] sync ----------
Write-Host "[2/4] sync -> $contentAddon"
if (Test-Path $contentAddon) { Remove-Item -LiteralPath $contentAddon -Recurse -Force }
New-Item -ItemType Directory -Force -Path $contentAddon | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "panorama") -Destination $contentAddon -Recurse -Force

if (Test-Path $gameAddon) { Remove-Item -LiteralPath $gameAddon -Recurse -Force }
New-Item -ItemType Directory -Force -Path $gameAddon | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "addoninfo.txt") -Destination (Join-Path $gameAddon "addoninfo.txt") -Force

# ---------- [3/4] compile ----------
Write-Host "[3/4] compile"
$inputs = Get-ChildItem -Path $contentAddon -Recurse -File -Include *.xml
if (-not $inputs) { throw "no input files" }
$compilerArgs = @()
foreach ($f in $inputs) { $compilerArgs += @("-i", $f.FullName) }
$compilerArgs += @("-game", $gameInfoDir, "-nop4", "-f")
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "resourcecompiler failed ($LASTEXITCODE)" }

# ---------- [4/4] pack ----------
Write-Host "[4/4] pack"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist $VpkName
if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
& $VpkCli --no-progress -o $out -v 1 -s $gameAddon
if ($LASTEXITCODE -ne 0) { throw "vpkeditcli failed ($LASTEXITCODE)" }

& $VpkCli --no-progress --file-tree $out
Write-Host ""
Write-Host ("OUT: " + $out + "  (" + (Get-Item $out).Length + " bytes)")
