(function () {
	"use strict";

	/*
	 * BabelTower v3 — 最小执行探针(临时诊断,协议确认存活后移除)
	 *
	 * 目的:分离两个失败假设 ——
	 *   A) 布局 <scripts> 块根本不求值(与 QOLLOCK 的 hud.xml 实证矛盾,但需排除)
	 *   B) lc_protocol.js 运行时即死(实证嫌犯:$.Time 缺失 → boot TypeError)
	 * 本文件只做:同步 $.CreatePanel("Label") + 静态文本。零依赖:不用
	 * $.Schedule / $.Time / FindChildTraverse / RegisterEventHandler —— 任何一个
	 * 未实证的 API 都不允许污染结论。
	 * 样式配方逐字对齐 QOLLOCK visual_check.js 的浮动面板(其自检覆盖层,实证
	 * 可渲染):Object.assign(panel.style, {...}) + 左上对齐 + 显式宽高 + zIndex。
	 * 文本自报宿主 context(直子面板扫描:hud 布局的直子含 CitadelHud 类型,
	 * escape 布局的直子含 LCTSettingsWindow)。两个 context 各有一个探针,同时可见。
	 */

	try {
		const host = $.GetContextPanel();
		if (!host) return;

		let ctxName = "";
		try {
			const n = host.GetChildCount ? host.GetChildCount() : 0;
			for (let i = 0; i < n; i++) {
				const ch = host.GetChild(i);
				if (!ch) continue;
				if (String(ch.paneltype || "") === "CitadelHud") { ctxName = "HudLayout"; break; }
				if (String(ch.id || "") === "LCTSettingsWindow") { ctxName = "EscapeLayout"; break; }
			}
		} catch (e0) {}
		if (!ctxName) {
			try { ctxName = (String(host.id || "") || "?") + "/" + String(host.paneltype || "?"); } catch (e1) {}
		}

		const b = $.CreatePanel("Label", host, "LCTProbe");
		if (!b) return;
		try { b.text = "PROBE " + ctxName; } catch (e2) {}
		try {
			Object.assign(b.style, {
				horizontalAlign: "left",
				verticalAlign: "top",
				marginLeft: "20px",
				marginTop: "40px",
				width: "520px",
				height: "24px",
				color: "#ff4040",
				fontSize: "14px",
				fontWeight: "bold",
				backgroundColor: "#000000cc",
				whiteSpace: "normal",
				zIndex: "9000",
				visibility: "visible"
			});
		} catch (e3) {}
		try { b.hittest = false; } catch (e4) {}
		try { b.acceptsfocus = false; } catch (e5) {}
	} catch (e) {}
})();
