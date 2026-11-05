(function () {
	"use strict";

	/*
	 * BabelTower v3 — Esc 菜单注入器 + 设置页装载器(chat.xml context,2026-11-05 窄面回归)
	 *
	 * 职责(探针实证 2026-11-05:Esc 子树从 HUD context 直达 ctxSubOptions=hit,
	 * BLoadLayout api=yes ret=true children=2;探针数据见 docs/COMPATIBILITY.md):
	 *   1. 向 Esc 菜单 SubOptions 注入"BabelTower 翻译"按钮(nav_menu_item minor +
	 *      menuButtonLabel + GearIcon,与原生设置按钮同款形态;幂等守卫防重复)。
	 *      不依赖任何 XML 合并 —— 原版菜单、QOL 菜单、任何未来 esc mod 的
	 *      SubOptions 都能注;找不到 SubOptions 就静默跳过(纯对局 HUD)。
	 *      样式零依赖:注入点在 Esc 菜单子树内,nav_menu_item/menuButtonLabel/
	 *      GearIcon 由 esc 菜单自己的样式表提供(CSS 作用域跟树走,探针实证)。
	 *   2. 按钮点击 = 直接开设置页,菜单保持打开(2026-11-05 二次实测修订)。
	 *      菜单开着 = 引擎 UI 输入模式(鼠标归 Panorama)+ 对局暂停;关菜单会让
	 *      游戏回动作模式 —— 页面能渲染但收不到鼠标(实测症状:人物走动、必须
	 *      按住 Tab 借记分板的 UI 模式才能点击)。页面 z-index 6000 + HUD ctx
	 *      末位子节点,稳定压在菜单上(#EscapeMenu 无 z-index,hud.css 实证;
	 *      菜单显隐走 opacity,与页面互不干扰)。
	 *   3. BLoadLayout 装载独立页面 XML(layout/custom/lct_settings_page.xml,
	 *      零脚本),页面宿主 = CitadelHud 面板(2026-11-05 窄面回归修订:chat
	 *      context 的 ctxPanel 是 CitadelChat 小面板会裁剪全屏页;而绝对根会让
	 *      宿主成为根的直接子节点,X 关页后引擎 Esc 路由被无名宿主分支吞掉 ——
	 *      实测症状:Esc 关不掉菜单。宿主放回 CitadelHud 子树内 = 与宽面时代
	 *      拓扑一致,三轮生产实证),装载后确定性重绑:页根 oncancel(委托 lct_settings)、页根
	 *      onactivate(点暗背板收页)、关闭按钮、窗口空 onactivate(挡点击穿透)。
	 *      其余控件内联 onactivate($.X 存在性守卫)按"内联跟随装载者 context"
	 *      假设保留,实测失效再补重绑表。
	 *   4. 持久低频重验(~2s):UI 重建吞掉按钮/页面时幂等补注,零日志噪音。
	 * 顺序契约:hud.xml 中本文件在 lct_i18n/lct_settings_ui/lct_settings 之后装载。
	 */

	const TAG = "[LCT][Boot]";
	const BTN_ID = "LCTModSettingsBtn";
	const ROW_ID = "LCTBootSettingsRow";
	const PAGE_HOST_ID = "LCTSettingsPageHost";
	const PAGE_LAYOUT = "s2r://panorama/layout/custom/lct_settings_page.xml";
	const RECHECK_S = 2;

	function log(msg) { try { $.Msg(TAG + " " + msg); } catch (e) {} }

	function ctxPanel() { try { return $.GetContextPanel(); } catch (e) { return null; } }

	function globalRoot() {
		try {
			let p = ctxPanel();
			let d = 0;
			while (p && p.GetParent && p.GetParent() && d < 64) { p = p.GetParent(); d++; }
			return p;
		} catch (e) { return null; }
	}

	function findById(id) {
		const c = ctxPanel();
		if (c) { try { const f = c.FindChildTraverse(id); if (f) return f; } catch (e) {} }
		try { const g = globalRoot(); if (g) return g.FindChildTraverse(id); } catch (e2) {}
		return null;
	}

	function closePage() {
		try { if (typeof $.LCTCloseSettingsWindow === "function") $.LCTCloseSettingsWindow(); } catch (e) {}
	}

	/* ---------- 1. Esc 菜单按钮注入 ---------- */

	function injectButton() {
		const sub = findById("SubOptions");
		if (!sub) { return false; } // 无 esc 菜单场景:静默跳过
		if (findById(BTN_ID)) { return true; } // 幂等:已注入

		let row = null;
		try { row = $.CreatePanel("Panel", sub, ROW_ID); } catch (e0) { row = null; }
		if (!row) { log("row create failed"); return false; }
		try { row.AddClass("SettingsRow"); } catch (eC) {}

		let btn = null;
		try { btn = $.CreatePanel("Button", row, BTN_ID); } catch (e1) { btn = null; }
		if (!btn) { log("button create failed"); return false; }
		try { btn.AddClass("nav_menu_item"); btn.AddClass("minor"); } catch (eB) {}

		try {
			const lbl = $.CreatePanel("Label", btn, "LCTTxtMenuEntry");
			lbl.text = "BabelTower 翻译"; // zh 源语言;en 由 LCTUIApplyTexts 按表重填
			lbl.AddClass("menuButtonLabel");
		} catch (eL) { log("label create failed: " + eL); }

		// 与原生设置按钮同款齿轮(原生即 <Panel class="smallIcon GearIcon"/>,纯 CSS 出图)
		try {
			const gear = $.CreatePanel("Panel", btn, "LCTSettingsGearIcon");
			gear.AddClass("smallIcon");
			gear.AddClass("GearIcon");
		} catch (eG) {}

		// 位置:原生设置行(id=settings 按钮所在行)之前;找不到就追加(纯外观差异)
		try {
			const nativeBtn = sub.FindChildTraverse("settings");
			const nativeRow = nativeBtn ? nativeBtn.GetParent() : null;
			if (nativeRow && typeof sub.MoveChildBefore === "function") {
				sub.MoveChildBefore(row, nativeRow);
			}
		} catch (eM) {}

		// 点击 = 直接开页(菜单保持打开,见头注 §2);SetPanelEvent 确定性绑定
		try {
			btn.SetPanelEvent("onactivate", function () {
				try { if (typeof $.LCTToggleSettingsWindow === "function") $.LCTToggleSettingsWindow(); } catch (e1) {}
			});
		} catch (eE) { log("onactivate bind failed: " + eE); }

		try { if (typeof $.LCTUIApplyTexts === "function") $.LCTUIApplyTexts(); } catch (eT) {}
		log("button injected into SubOptions");
		return true;
	}

	/* ---------- 2. 设置页装载 ---------- */

	function bindPageHandlers(host) {
		// 确定性重绑(不赌内联)。其余控件内联 $.X 守卫处理器保留,失效再补重绑表。
		const page = host.FindChildTraverse("LCTSettingsPage");
		if (page) {
			// oncancel:Esc 收页(lct_settings 持语义,此处只递面板)
			try { if (typeof $.LCTBindPageCancel === "function") $.LCTBindPageCancel(page); } catch (eB) {}
			// 点暗背板(页根自身)收页;窗口区域的点击被窗口空 onactivate 吃掉,不会到这里
			try {
				page.SetPanelEvent("onactivate", function () { closePage(); });
			} catch (e0) {}
		}
		const win = host.FindChildTraverse("LCTSettingsWindow");
		if (win) {
			// 空 onactivate:窗口区域点击在此终结,不穿透到页根(旧架构同款语义)
			try { win.SetPanelEvent("onactivate", function () {}); } catch (e1) {}
		}
		const closeBtn = host.FindChildTraverse("LCTSettingsClose");
		if (closeBtn) {
			try { closeBtn.SetPanelEvent("onactivate", function () { closePage(); }); } catch (e2) {}
		}
		// Build 10931 实测(2026-11-05):内联 onactivate 不再解析到装载者 context,
		// 全部控件(开关/下拉/选项)由 lct_settings_ui.LCTUIBindControls 确定性绑定。
		try { if (typeof $.LCTUIBindControls === "function") $.LCTUIBindControls(); } catch (eB) {}
	}

	function loadPage() {
		let host = findById(PAGE_HOST_ID);
		if (!host) {
			// 页面宿主 = CitadelHud 面板(2026-11-05 窄面回归修订):chat context 的
			// ctxPanel 是 CitadelChat 小面板,全屏页会被裁剪;绝对根宿主则是根的
			// 直接子节点,会吞掉引擎的 Esc 路由(实测:X 关页后 Esc 关不掉菜单)。
			// 放回 CitadelHud 子树内 = 与宽面时代拓扑一致,Esc 行为回归原版。
			let c = null;
			try { c = findById("Hud"); } catch (eH) { c = null; }
			if (!c) { c = globalRoot(); } // CitadelHud 缺位时兜底(旧形态,可用性优先)
			if (!c) { return false; }
			try { host = $.CreatePanel("Panel", c, PAGE_HOST_ID); } catch (e0) { host = null; }
			if (!host) { log("page host create failed"); return false; }
			try { host.hittest = false; } catch (eH) {} // 拦点击是页根(hittest=true)的事
			try { host.style.width = "100%"; host.style.height = "100%"; } catch (eS) {}
		}
		let loaded = false;
		try { loaded = !!host.FindChildTraverse("LCTSettingsPage"); } catch (e1) { loaded = false; }
		if (!loaded) {
			let ret = "?";
			try { ret = String(host.BLoadLayout(PAGE_LAYOUT, false, false)); } catch (e2) { ret = "threw: " + e2; }
			try { loaded = !!host.FindChildTraverse("LCTSettingsPage"); } catch (e3) { loaded = false; }
			if (!loaded) { log("page load failed ret=" + ret); return false; }
			bindPageHandlers(host);
			try { if (typeof $.LCTUIApplyTexts === "function") $.LCTUIApplyTexts(); } catch (eT) {}
			log("page loaded ret=" + ret);
		}
		return true;
	}

	/* ---------- 3. 持久重验循环 ---------- */

	function tick() {
		try {
			injectButton();
			loadPage();
		} catch (e) {
			log("tick threw: " + (e && e.message ? e.message : e));
		} finally {
			try { $.Schedule(RECHECK_S, tick); } catch (e2) {}
		}
	}

	log("boot");
	try { $.Schedule(0.5, tick); } catch (e) { tick(); }
})();
