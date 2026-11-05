<#
  LCT chat.xml zero-dep beacon probe - build + deploy + restore
  =============================================================

  Answers ONE question with game evidence: do <scripts> inside
  panorama/layout/chat.xml execute in the CURRENT game build?

  History: d186fbb (2026-11-05 09:29) sentenced chat.xml with beacons that
  still had the $.Time boot TypeError (fixed 38 min later in 986e3d7), and
  the v2 client demonstrably worked until 11-01. This probe retests cleanly
  with only $.Msg + Date.now + $.Schedule.

  Base layout = the CURRENT core pak01 chat.vxml_c, decompiled with
  Source2Viewer (NOT the stale probe\panorama\layout\chat.xml rebuild - a
  stale chat snippet can Plat_FatalError the game, see v2 TargetHeroImage
  crash notes). The graft adds exactly one <include> and nothing else.

  Prereq (run once, needs the decompile step done first):
    _compat\probe\_work\chat_dec.xml   <- S2V decompile of core pak01
                                          panorama\layout\chat.vxml_c

  What lands in the game during the probe session (pak03 = probe):
    - chat.xml  : current vanilla + one beacon include (pak03 beats core pak01)
    - NO hud file in pak03 -> pak26 QOL hud wins over pak91 v3 hud
      => HUD = pure QOL 4.0.5 (doubles as the QOL-pure A/B test:
         watch healthbars / souls / minimap icons)
    - v3 translation is OFF for that session (expected). Only [LCTPROBE]
      lines should appear in console.log.

  Usage:
    powershell -ExecutionPolicy Bypass -File _compat\probe\build.ps1            # graft + compile + pack
    powershell -ExecutionPolicy Bypass -File _compat\probe\build.ps1 -Deploy    # ... + swap pak03 (backs up first)
    powershell -ExecutionPolicy Bypass -File _compat\probe\build.ps1 -Restore   # put compat pak03 back

  After the in-game test, read:
    Select-String -Path "C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\console.log" -Pattern "LCTPROBE"
#>

param(
	[string]$Csdk = "F:\dev-tools\Reduced_CSDK_12",
	[string]$VpkCli = "F:\dev-tools\VPKEdit\vpkeditcli.exe",
	[string]$Beacon = "beacon",
	[switch]$Phase2,
	[switch]$Deploy,
	[switch]$Restore
)

$ErrorActionPreference = "Stop"

# _compat\probe\build.ps1 -> two levels up = repo root
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gameAddons = "C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons"
$deployedPak = Join-Path $gameAddons "pak03_dir.vpk"
$backupPak = Join-Path $gameAddons "pak03_dir.vpk.bak-compat-20261105"
$probePak = Join-Path $root "dist\pak03_probe_dir.vpk"
$decPath = Join-Path $PSScriptRoot "_work\chat_dec.xml"
$AddonName = "lctchatprobe"

$contentAddon = Join-Path $Csdk "content\citadel_addons\$AddonName"
$gameAddon = Join-Path $Csdk "game\citadel_addons\$AddonName"
$compiler = Join-Path $Csdk "game\bin_cs2\win64\resourcecompiler.exe"
$gameInfoDir = Join-Path $Csdk "game\citadel"

function Assert-GameClosed {
	if (Get-Process -Name deadlock -ErrorAction SilentlyContinue) {
		throw "deadlock.exe is running - close the game first (pak swap is not safe live)"
	}
}

function Invoke-Restore {
	Assert-GameClosed
	if (-not (Test-Path $backupPak)) { throw "no backup found: $backupPak" }
	Copy-Item -LiteralPath $backupPak -Destination $deployedPak -Force
	Write-Host ("restored compat pak03: " + (Get-Item $deployedPak).Length + " bytes")
}

function Invoke-Graft {
	if (-not (Test-Path $decPath)) {
		throw "missing input: $decPath`nfirst decompile the CURRENT core pak01 chat.vxml_c with Source2Viewer into _work\chat_dec.xml"
	}
	$dec = [System.IO.File]::ReadAllLines($decPath)
	if ($dec.Count -lt 10) { throw "chat_dec.xml looks too small ($($dec.Count) lines) - decompile failed?" }
	if (($dec | Where-Object { $_ -match "CitadelChat" }).Count -lt 1) {
		throw "chat_dec.xml does not look like the chat layout (no CitadelChat root) - wrong file?"
	}

	$incLine = '<include src="s2r://panorama/scripts/lct_probe_beacon.vjs_c" />'
	$out = New-Object System.Collections.Generic.List[string]
	$inserted = 0

	# case 1: vanilla already has a <scripts> block -> add our include right after the open tag
	$done = $false
	for ($i = 0; $i -lt $dec.Count; $i++) {
		$line = $dec[$i]
		$out.Add($line)
		if (-not $done -and $line -match "^(\s*)<scripts(\s|>)") {
			$out.Add($Matches[1] + "`t" + $incLine)
			$inserted = 1
			$done = $true
		}
	}

	# case 2: no <scripts> in vanilla -> insert a whole block after </styles>
	if (-not $done) {
		$out = New-Object System.Collections.Generic.List[string]
		for ($i = 0; $i -lt $dec.Count; $i++) {
			$line = $dec[$i]
			$out.Add($line)
			if ($line -match "^(\s*)</styles>") {
				$indent = $Matches[1]
				$out.Add($indent + "<scripts>")
				$out.Add($indent + "`t" + $incLine)
				$out.Add($indent + "</scripts>")
				$inserted = 3
				$done = $true
			}
		}
	}

	# case 3: no </styles> either -> insert right after the <root> open tag
	if (-not $done) {
		$out = New-Object System.Collections.Generic.List[string]
		for ($i = 0; $i -lt $dec.Count; $i++) {
			$line = $dec[$i]
			$out.Add($line)
			if ($line -match "^(\s*)<root") {
				$indent = $Matches[1]
				$out.Add($indent + "`t<scripts>")
				$out.Add($indent + "`t`t" + $incLine)
				$out.Add($indent + "`t</scripts>")
				$inserted = 3
				$done = $true
			}
		}
	}
	if (-not $done) { throw "graft failed: no scripts/styles/root anchor found in chat_dec.xml" }

	# phase2: also graft the static CEF panel (probe-proven form) inside CitadelChat
	if ($Phase2) {
		$idx = -1
		for ($i = 0; $i -lt $out.Count; $i++) {
			if ($out[$i] -match "^\s*</CitadelChat>") { $idx = $i; break }
		}
		if ($idx -lt 0) { throw "graft failed: no </CitadelChat> anchor for phase2 panel" }
		# 4x4px + opacity 0.01 + visible = production hiding recipe (lct_net.css:
		#  full collapse/opacity-0 makes CEF pause the panel's timers - transport dies)
		$out.Insert($idx, "`t`t" + '<CitadelHTMLPanel id="LCTProbeNet" hittest="false" acceptsfocus="false" style="width: 4px; height: 4px; visibility: visible; opacity: 0.01;" />')
		$inserted += 1
	}

	# graft assertions - fail loudly instead of shipping a silent broken probe
	if (($out | Where-Object { $_ -match "lct_probe_beacon\.vjs_c" }).Count -ne 1) {
		throw "graft assertion failed: beacon include count != 1"
	}
	if ($Phase2 -and ($out | Where-Object { $_ -match "LCTProbeNet" }).Count -ne 1) {
		throw "graft assertion failed: LCTProbeNet panel count != 1"
	}
	if ($out.Count -ne ($dec.Count + $inserted)) {
		throw ("graft assertion failed: line count {0} != {1} + {2}" -f $out.Count, $dec.Count, $inserted)
	}

	$layoutDir = Join-Path $PSScriptRoot "panorama\layout"
	New-Item -ItemType Directory -Force -Path $layoutDir | Out-Null
	[System.IO.File]::WriteAllLines((Join-Path $layoutDir "chat.xml"), $out)
	Write-Host ("[1/4] chat.xml grafted: " + $dec.Count + " vanilla lines + " + $inserted + " probe line(s)")
}

function Invoke-Build {
	foreach ($p in @($compiler, $VpkCli)) {
		if (-not (Test-Path $p)) { throw "missing tool: $p" }
	}

	Invoke-Graft

	# beacon source -> probe panorama tree (fresh, no stale files)
	$scriptsDir = Join-Path $PSScriptRoot "panorama\scripts"
	New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
	$beaconSrc = Join-Path $PSScriptRoot "$Beacon\lct_probe_beacon.js"
	if (-not (Test-Path $beaconSrc)) { throw "missing beacon source: $beaconSrc" }
	Copy-Item -Path $beaconSrc -Destination (Join-Path $scriptsDir "lct_probe_beacon.js") -Force

	# phase2: stage the REAL settings page + css from mod\ (page BLoad target)
	if ($Phase2) {
		$customDir = Join-Path $PSScriptRoot "panorama\layout\custom"
		New-Item -ItemType Directory -Force -Path $customDir | Out-Null
		New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "panorama\styles") | Out-Null
		Copy-Item -Path (Join-Path $root "mod\panorama\layout\custom\lct_settings_page.xml") -Destination (Join-Path $customDir "lct_settings_page.xml") -Force
		Copy-Item -Path (Join-Path $root "mod\panorama\styles\lct_settings.css") -Destination (Join-Path $PSScriptRoot "panorama\styles\lct_settings.css") -Force
		Write-Host "      phase2: settings page + css staged from mod\"
	}

	# addoninfo next to the build tree (same pattern as build_compat.ps1)
	Copy-Item -Path (Join-Path $PSScriptRoot "addoninfo.txt") -Destination (Join-Path $PSScriptRoot "addoninfo.txt") -ErrorAction SilentlyContinue

	# sync to CSDK
	if (Test-Path $contentAddon) { Remove-Item -LiteralPath $contentAddon -Recurse -Force }
	New-Item -ItemType Directory -Force -Path $contentAddon | Out-Null
	Copy-Item -Path (Join-Path $PSScriptRoot "panorama") -Destination $contentAddon -Recurse -Force

	if (Test-Path $gameAddon) { Remove-Item -LiteralPath $gameAddon -Recurse -Force }
	New-Item -ItemType Directory -Force -Path $gameAddon | Out-Null
	Copy-Item -Path (Join-Path $PSScriptRoot "addoninfo.txt") -Destination (Join-Path $gameAddon "addoninfo.txt") -Force

	# compile (same pipeline as mod\build.ps1: xml/js/css -> vxml_c/vjs_c/vcss_c)
	$inputs = Get-ChildItem -Path $contentAddon -Recurse -File -Include *.xml, *.js, *.css
	if (-not $inputs) { throw "no input files" }
	$compilerArgs = @()
	foreach ($f in $inputs) { $compilerArgs += @("-i", $f.FullName) }
	$compilerArgs += @("-game", $gameInfoDir, "-nop4", "-f")
	& $compiler @compilerArgs
	if ($LASTEXITCODE -ne 0) { throw "resourcecompiler failed ($LASTEXITCODE)" }

	$vxml = Join-Path $gameAddon "panorama\layout\chat.vxml_c"
	$vjs = Join-Path $gameAddon "panorama\scripts\lct_probe_beacon.vjs_c"
	if (-not (Test-Path $vxml)) { throw "compiler did not produce chat.vxml_c" }
	if (-not (Test-Path $vjs)) { throw "compiler did not produce lct_probe_beacon.vjs_c" }
	if ($Phase2) {
		$pageOut = Join-Path $gameAddon "panorama\layout\custom\lct_settings_page.vxml_c"
		$cssOut = Join-Path $gameAddon "panorama\styles\lct_settings.vcss_c"
		if (-not (Test-Path $pageOut)) { throw "compiler did not produce lct_settings_page.vxml_c" }
		if (-not (Test-Path $cssOut)) { throw "compiler did not produce lct_settings.vcss_c" }
	}
	$compiledMsg = "[2/4] compiled: chat.vxml_c + lct_probe_beacon.vjs_c"
	if ($Phase2) { $compiledMsg += " + settings page/css" }
	Write-Host $compiledMsg

	# pack
	$dist = Join-Path $root "dist"
	New-Item -ItemType Directory -Force -Path $dist | Out-Null
	if (Test-Path $probePak) { Remove-Item -LiteralPath $probePak -Force }
	& $VpkCli --no-progress -o $probePak -v 1 -s $gameAddon
	if ($LASTEXITCODE -ne 0) { throw "vpkeditcli failed ($LASTEXITCODE)" }

	Write-Host "[3/4] packed: $probePak"
	& $VpkCli --no-progress --file-tree $probePak
}

function Invoke-Deploy {
	Assert-GameClosed
	if (-not (Test-Path $probePak)) { throw "probe pak not built: $probePak (run without -Deploy first)" }
	if (-not (Test-Path $deployedPak)) { throw "deployed pak03 not found: $deployedPak" }
	if (-not (Test-Path $backupPak)) {
		Copy-Item -LiteralPath $deployedPak -Destination $backupPak
		Write-Host "[4/4] backed up deployed compat pak03 -> $backupPak"
	} else {
		Write-Host "[4/4] backup already exists, kept: $backupPak"
	}
	Copy-Item -LiteralPath $probePak -Destination $deployedPak -Force
	Write-Host ("deployed PROBE pak03: " + (Get-Item $deployedPak).Length + " bytes")
	Write-Host "now: start the game (hideout is enough), then check console.log for LCTPROBE"
}

if ($Restore) {
	Invoke-Restore
} else {
	Invoke-Build
	if ($Deploy) { Invoke-Deploy }
	Write-Host ""
	Write-Host "next: -Deploy to swap pak03, test in game, then -Restore to put compat pak03 back"
}
