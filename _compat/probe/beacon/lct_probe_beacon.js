// LCT zero-dependency beacon - answers ONE question:
//   does <scripts> inside panorama/layout/chat.xml execute in the CURRENT game build?
//
// Why this exists (2026-11-05): d186fbb sentenced chat.xml to "scripts never
// execute" using beacons that were still $.Time-broken at sentencing time
// ($.Time boot TypeError was only fixed in 986e3d7, 38 minutes AFTER the
// verdict). The v2 client kept working until 11-01, so the verdict needs a
// clean retest. This beacon uses ONLY $.Msg + Date.now + $.Schedule - no
// $.Time, no bridge, no mod APIs.
//
// Signals in game\citadel\console.log (game must be started with -condebug):
//   [LCTPROBE] eval    - script top-level ran          <- decisive on its own
//   [LCTPROBE] t+3s    - scheduled callback ran; reports ChatMessages FOUND/MISSING
//   [LCTPROBE] t+8s    - still alive later
// If chat renders normally but "eval" never appears, the engine really does
// skip scripts in the chat context and the d186fbb verdict stands.
"use strict";
$.Msg("[LCTPROBE] eval chat.xml script t=" + (Date.now ? Date.now() : "?"));
try {
	$.Schedule(3, function () {
		var state = "THREW";
		try {
			var p = $.GetContextPanel();
			var c = p && p.FindChildTraverse ? p.FindChildTraverse("ChatMessages") : null;
			state = c ? "FOUND" : "MISSING";
		} catch (e) {}
		$.Msg("[LCTPROBE] t+3s ChatMessages=" + state);
	});
	$.Schedule(8, function () {
		$.Msg("[LCTPROBE] t+8s alive t=" + Date.now());
	});
} catch (e) {
	$.Msg("[LCTPROBE] schedule-threw " + e);
}
