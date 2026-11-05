// LCT narrow-face capability probe (phase 2) - 2026-11-05
//
// Question: can the FULL v3 UI machinery run from chat.xml context?
// (Phase 1 verdict today: chat.xml scripts EXECUTE - [LCTPROBE] eval/t+3s/t+8s
//  all logged; d186fbb "chat scripts never run" is falsified. Phase 2 tests the
//  mechanics the real migration needs.)
//
// Mechanics under test (each logs [LCTPROBE2] M# ...):
//   M1  context identity      - panel chain from $.GetContextPanel()
//   M2  chat tree             - #ChatMessages reachable (phase-1 baseline)
//   M3  cross-context create  - host panel under the ABSOLUTE root panel
//                               (QOLLOCK ql_persistence form; v3 lesson: #Hud /
//                               CitadelHud is an "exists but inert" host - elect
//                               stayed idle - so root is the proven choice)
//   M4  esc menu reach        - poll SubOptions from chat ctx; inject a real
//                               button (lct_boot form: SettingsRow + nav_menu_item
//                               + menuButtonLabel + GearIcon); idempotent re-inject
//   M5  page BLoad + overlay  - button click -> BLoadLayout the REAL settings page
//                               (mod layout/custom/lct_settings_page.xml + real css,
//                               copied at build time) into the M3 host; visual check:
//                               full-screen, on top of esc menu, clickable, closable
//   M6  CEF transport         - static CitadelHTMLPanel LCTProbeNet (declared in this
//                               layout, probe-proven form); SetURL example.com;
//                               count HTMLTitle events for 8s
//
// No $.Time (the API that poisoned the d186fbb verdict). Only $.Msg/$.Schedule/
// Date.now/CreatePanel/FindChildTraverse/BLoadLayout/SetPanelEvent/RegisterForUnhandledEvent.
"use strict";
var TAG = "[LCTPROBE2]";

function log(m) { try { $.Msg(TAG + " " + m); } catch (e) {} }
function ctx() { try { return $.GetContextPanel(); } catch (e) { return null; } }
function isValid(p) { try { return !!(p && (!p.IsValid || p.IsValid())); } catch (e) { return false; } }
function root() {
	var p = ctx(), d = 0;
	while (p && p.GetParent && p.GetParent() && d < 64) { p = p.GetParent(); d++; }
	return p;
}
function find(id) {
	var c = ctx();
	if (c) { try { var f = c.FindChildTraverse(id); if (f) return f; } catch (e) {} }
	try { var g = root(); if (g) return g.FindChildTraverse(id); } catch (e2) {}
	return null;
}

/* ---------- M1 + M2 (at script eval) ---------- */
(function () {
	var chain = [];
	var p = ctx(), d = 0;
	while (p && d < 8) {
		var nm = "?";
		try { nm = p.id + "(" + p.paneltype + ")"; } catch (e) {}
		chain.push(nm);
		p = p.GetParent ? p.GetParent() : null;
		d++;
	}
	log("M1 ctx chain: " + chain.join(" <- "));
	var m = find("ChatMessages");
	log("M2 ChatMessages=" + (m ? "FOUND" : "MISSING"));
})();

/* ---------- heartbeat ---------- */
try {
	$.Schedule(3, function () { log("alive t+3s"); });
	$.Schedule(8, function () { log("alive t+8s"); });
} catch (eHb) {}

/* ---------- M3 host under absolute root ---------- */
var host = null;
(function () {
	var r = root();
	if (!r) { log("M3 root MISSING"); return; }
	var hudRef = "?";
	try { hudRef = find("Hud") ? "CitadelHud-found" : "CitadelHud-missing"; } catch (e) {}
	try {
		host = $.CreatePanel("Panel", r, "LCTProbe2Host");
		host.hittest = false;
		host.style.width = "100%";
		host.style.height = "100%";
		host.visible = false;
		log("M3 PASS host created under absolute root (" + hudRef + ")");
	} catch (e) { log("M3 FAIL create threw " + e); }
})();

/* ---------- M5 page open/close (bound to M4 button) ---------- */
var pageBound = false;
function closePage() {
	if (!isValid(host)) return;
	try {
		var pg = host.FindChildTraverse("LCTSettingsPage");
		if (pg) pg.RemoveClass("LCTOpen"); // page root is collapsed without this class (lct_settings.css)
	} catch (e) {}
	try { host.visible = false; } catch (e2) {}
	log("M5 page closed (class removed, host hidden)");
}
function openPage() {
	if (!isValid(host)) { log("M5 FAIL host invalid"); return; }
	try { host.visible = true; } catch (eV) {}
	var page = null;
	try { page = host.FindChildTraverse("LCTSettingsPage"); } catch (e0) { page = null; }
	if (page) {
		try { page.AddClass("LCTOpen"); } catch (eA) {}
		log("M5 page re-opened");
		return;
	}
	var ret = "?";
	try { ret = String(host.BLoadLayout("s2r://panorama/layout/custom/lct_settings_page.xml", false, false)); } catch (e1) { ret = "threw: " + e1; }
	try { page = host.FindChildTraverse("LCTSettingsPage"); } catch (e2) { page = null; }
	log("M5 BLoad ret=" + ret + " page=" + (page ? "FOUND" : "MISSING"));
	if (page) {
		try { page.AddClass("LCTOpen"); } catch (eA2) {}
	}
	if (page && !pageBound) {
		pageBound = true;
		try { page.SetPanelEvent("onactivate", function () { closePage(); }); } catch (e3) {}
		var win = null;
		try { win = host.FindChildTraverse("LCTSettingsWindow"); } catch (e4) {}
		if (win) { try { win.SetPanelEvent("onactivate", function () {}); } catch (e5) {} }
		var closeBtn = null;
		try { closeBtn = host.FindChildTraverse("LCTSettingsClose"); } catch (e6) {}
		if (closeBtn) { try { closeBtn.SetPanelEvent("onactivate", function () { closePage(); }); } catch (e7) {} }
		log("M5 handlers bound (page backdrop / window shield / close btn)");
	}
}

/* ---------- M4 esc menu reach + button injection ---------- */
var escState = ""; // "" -> "found" -> "injected"
function injectBtn(sub) {
	if (find("LCTProbe2Btn")) return true;
	var row = null;
	try { row = $.CreatePanel("Panel", sub, "LCTProbe2Row"); } catch (e0) { row = null; }
	if (!row) { log("M4 FAIL row create"); return false; }
	try { row.AddClass("SettingsRow"); } catch (eC) {}
	var btn = null;
	try { btn = $.CreatePanel("Button", row, "LCTProbe2Btn"); } catch (e1) { btn = null; }
	if (!btn) { log("M4 FAIL button create"); return false; }
	try { btn.AddClass("nav_menu_item"); btn.AddClass("minor"); } catch (eB) {}
	try {
		var lbl = $.CreatePanel("Label", btn, "LCTProbe2BtnLabel");
		lbl.text = "LCT PROBE2";
		lbl.AddClass("menuButtonLabel");
	} catch (eL) {}
	try {
		var gear = $.CreatePanel("Panel", btn, "LCTProbe2Gear");
		gear.AddClass("smallIcon");
		gear.AddClass("GearIcon");
	} catch (eG) {}
	try {
		var nativeBtn = sub.FindChildTraverse("settings");
		var nativeRow = nativeBtn ? nativeBtn.GetParent() : null;
		if (nativeRow && typeof sub.MoveChildBefore === "function") sub.MoveChildBefore(row, nativeRow);
	} catch (eM) {}
	try {
		btn.SetPanelEvent("onactivate", function () { openPage(); });
	} catch (eE) { log("M4 FAIL bind threw " + eE); return false; }
	log("M4 PASS button injected into SubOptions (open Esc to see it)");
	return true;
}
(function escPoll() {
	var sub = find("SubOptions");
	if (sub) {
		if (escState === "") { escState = "found"; log("M4 SubOptions reachable from chat ctx (menu subtree always in DOM)"); }
		if (injectBtn(sub)) escState = "injected";
	} else if (escState === "injected") {
		escState = "found"; // UI rebuild ate the subtree; allow silent re-inject
	}
	try { $.Schedule(1, escPoll); } catch (e) {}
})();

/* ---------- M6 CEF transport ---------- */
var titleCount = 0;
try {
	$.Schedule(1, function () {
		var net = find("LCTProbeNet");
		if (!net) { log("M6 FAIL LCTProbeNet MISSING (layout graft?)"); return; }
		var hasSet = false;
		try { hasSet = typeof net.SetURL === "function"; } catch (e) {}
		log("M6 panel found SetURL=" + (hasSet ? "yes" : "NO"));
		if (!hasSet) return;
		try {
			$.RegisterForUnhandledEvent("HTMLTitle", function (a, b, c, d) {
				titleCount += 1;
				var parts = [a, b, c, d], t = "";
				for (var i = 0; i < parts.length; i++) {
					if (parts[i] != null) t += String(parts[i]).slice(0, 40) + " | ";
				}
				log("M6 HTMLTitle #" + titleCount + " " + t);
			});
		} catch (eR) { log("M6 register threw " + eR); }
		try { net.SetURL("https://example.com/?lctprobe2=1"); log("M6 SetURL sent"); } catch (eS) { log("M6 FAIL SetURL threw " + eS); }
		try {
			$.Schedule(8, function () {
				log("M6 verdict titles=" + titleCount + " -> " + (titleCount > 0 ? "PASS" : "FAIL"));
			});
		} catch (eT) {}
	});
} catch (e) {}
