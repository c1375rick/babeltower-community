(function () {
	"use strict";

	/*
	 * BabelTower v3 — 设置窗口宿主(运行于 Escape Menu context,由 hud_escape_menu.xml 引入)
	 *
	 * QOLLOCK 生产模式(实证自其反编译 window.js / hud_escape_menu.xml):
	 *   - XML 的 root oncancel / EscapeBackground / EscapeButton 保持游戏原文(单语句);
	 *     Esc 语义全部在本文件用 SetPanelEvent 运行时挂钩:
	 *       1) 窗口面板自带 oncancel:窗口开着 → 只关窗(菜单留在原地);
	 *          窗口已关但仍占着 MenuBack 焦点(QOLLOCK 实证:此时 root 的 XML oncancel
	 *          根本不执行,菜单会卡死)→ 主动 dispatch CitadelResumePlaying 救场。
	 *       2) EscapeBackground onactivate 改挂 JS:窗口开着 → 只关窗;否则 resume。
	 *       3) RegisterForUnhandledEvent("CitadelResumePlaying"):菜单因任何原因关闭时
	 *          顺带关窗,避免下次打开菜单残留展开态。
	 *       4) 打开窗口时 SetFocus(),保证 Esc 先落到窗口(QOLLOCK setOpen 同款)。
	 *       5) 100ms 取消去重:同一次 MenuBack 可能先后到达窗口和 root(QOLLOCK 同款)。
	 *   - 窗口壳静态声明在 hud_escape_menu.xml(样式同 context include,零 BLoadLayout)。
	 *   - 配置与桥状态不经本文件:lc_protocol.js(chat context)持有配置并发布到共享面板
	 *     属性 lct_cfg / lct_status / lct_buildid;lct_settings_ui.js 直读直写。
	 */

	const TAG = "[LCT][Settings]";
	const WIN_ID = "LCTSettingsWindow";
	const BG_ID = "EscapeBackground";
	const OPEN_CLASS = "LCTOpen";
	const CANCEL_DEDUP_MS = 100;

	function log(msg) {
		try { $.Msg(TAG + " " + msg); } catch (e) {}
	}

	function findWindow() {
		try {
			const c = $.GetContextPanel();
			const w = c ? c.FindChildTraverse(WIN_ID) : null;
			if (w) return w;
		} catch (e0) {}
		return null;
	}

	function globalRoot() {
		try {
			let p = $.GetContextPanel();
			let d = 0;
			while (p && p.GetParent && p.GetParent() && d < 64) {
				p = p.GetParent();
				d++;
			}
			return p;
		} catch (e) {
			return null;
		}
	}

	function isOpen() {
		const w = findWindow();
		try { return !!(w && w.BHasClass && w.BHasClass(OPEN_CLASS)); } catch (e) { return false; }
	}

	function nowMs() {
		try { return Math.floor($.Time() * 1000); } catch (e) { return 0; }
	}

	let cancelConsumedUntil = 0;

	function dispatchResume() {
		try { $.DispatchEvent("CitadelResumePlaying", $.GetContextPanel()); } catch (e0) {}
	}

	function setOpen(open, resume) {
		const w = findWindow();
		if (!w) {
			log("window panel not found");
			return;
		}
		try {
			if (open) { w.AddClass(OPEN_CLASS); } else { w.RemoveClass(OPEN_CLASS); }
		} catch (e1) {}
		if (open) {
			// 焦点交给窗口本身:Esc(MenuBack)先落到窗口的 oncancel,而不是上一次
			// 点击的菜单按钮(QOLLOCK setOpen → shell.SetFocus() 同款)
			try { w.SetFocus(); } catch (eF) {}
		}
		if (!open) {
			// 关窗时收起所有下拉菜单,避免下次打开时残留展开态
			try { if (typeof $.LCTUICloseAllMenus === "function") $.LCTUICloseAllMenus(); } catch (e2) {}
		}
		if (!open && resume === true) {
			dispatchResume();
		}
	}

	// 窗口面板的 oncancel:焦点在窗口内时 Esc 落到这里。
	// 语义 = QOLLOCK handleModSettingsCancel/forceClose(true) 逐字对齐:
	// 窗口开着 → 关窗并 resume(一次 Esc 直接回游戏);窗口已关但仍占着
	// MenuBack 焦点(QOLLOCK 实证:此时 root 的 XML oncancel 不执行)→ 主动 resume。
	function onWindowCancel() {
		const t = nowMs();
		if (t < cancelConsumedUntil) return; // 同一次 MenuBack 已被处理(窗口/root 双投递)
		cancelConsumedUntil = t + CANCEL_DEDUP_MS;
		if (isOpen()) {
			setOpen(false, true);
			return;
		}
		dispatchResume();
	}

	// EscapeBackground 钩子(QOLLOCK hookEscapeMenu 同款语义):
	// 点背景 = 窗口开着时关窗并回游戏,否则正常回游戏。
	function hookBackground() {
		try {
			const root = globalRoot();
			const bg = root ? root.FindChildTraverse(BG_ID) : null;
			if (!bg) return;
			bg.SetPanelEvent("onactivate", function () {
				if (isOpen()) {
					setOpen(false, true);
				} else {
					dispatchResume();
				}
			});
		} catch (e) {}
	}

	// 菜单因任何路径关闭(resume 事件)→ 顺带关窗,避免下次打开菜单残留展开态
	function hookResumeEvent() {
		try {
			if (typeof $.RegisterForUnhandledEvent !== "function") return;
			$.RegisterForUnhandledEvent("CitadelResumePlaying", function () {
				if (isOpen()) setOpen(false, false);
			});
		} catch (e) {
			log("RegisterForUnhandledEvent failed: " + (e && e.message ? e.message : e));
		}
	}

	function bindShell() {
		const w = findWindow();
		if (!w) return false;
		try { w.hittest = true; } catch (e0) {}
		// 空 onactivate:窗口空白区域的点击在这里被吃掉,不穿透到 EscapeBackground
		try { w.SetPanelEvent("onactivate", function () {}); } catch (e1) {}
		try { w.SetPanelEvent("oncancel", onWindowCancel); } catch (e2) {}
		hookBackground();
		hookResumeEvent();
		log("shell bound (window oncancel + background hook + resume event)");
		return true;
	}

	// XML 处理器调用契约(hud_escape_menu.xml):
	//   $.LCTToggleSettingsWindow()          入口按钮
	//   $.LCTCloseSettingsWindow([resume])   关闭按钮(resume=true 时顺带返回游戏)
	//   $.LCTIsSettingsOpen() -> bool        外部查询
	$.LCTToggleSettingsWindow = function () {
		setOpen(!isOpen(), false);
	};
	$.LCTCloseSettingsWindow = function (resume) {
		setOpen(false, resume === true);
	};
	$.LCTIsSettingsOpen = isOpen;

	// 窗口是静态 XML,正常首次就能找到;保留重试兜底(context 就绪时序差异)
	let bootTries = 0;
	function boot() {
		if (bindShell()) return;
		bootTries += 1;
		if (bootTries < 30) {
			try { $.Schedule(0.4, boot); } catch (e) {}
		} else {
			log("shell not found after retries");
		}
	}

	log("window host ready");
	try { $.Schedule(0.2, boot); } catch (e) { boot(); }
})();
