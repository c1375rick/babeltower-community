(function () {
	"use strict";

	/*
	 * BabelTower v3 — 设置页开关宿主(HUD context,2026-11-05 迁移重构)
	 *
	 * 迁移后架构(探针 + 两轮实测,见 lct_boot.js 头注):
	 *   - 页面 = 独立 XML(layout/custom/lct_settings_page.xml,零脚本),由
	 *     lct_boot.js BLoadLayout 装载进 HUD context;窗口标记与旧 esc 内嵌版逐字一致。
	 *   - 开/关 = 页根 LCTSettingsPage 的 .LCTOpen 类(lct_settings.css 页根规则)。
	 *   - 页面浮在**开着的 Esc 菜单之上**(菜单不关!):菜单开着 = 引擎 UI 输入
	 *     模式(鼠标归 Panorama)+ 对局暂停 —— 2026-11-05 实测教训:先关菜单再开页
	 *     会让游戏回动作模式,页面收不到鼠标(人物走动、必须按住 Tab 才能点击)。
	 *     旧架构的 z-order 死结只属于"窗口住在菜单子树内"的旧形态,页面独立后
	 *     天然无此结(z-index 6000 + ctx 末位子节点,#EscapeMenu 无 z-index)。
	 *   - Esc 语义(QOL 同款"一次 Esc 直接回游戏"):
	 *       1) 页根 oncancel(焦点在页内按 Esc)= 收页 + resume(菜单一并关,
	 *          事件源 = Esc 菜单面板,见 dispatchResume 注);
	 *       2) escPoll:页开着时 0.5s 轮询,菜单被任何路径关掉(ShowEscapeMenu
	 *          类信号消失)→ 自动收页 —— 菜单没了页面就失去输入模式锚点,
	 *          留着也收不到鼠标,必须跟着走。
	 *       X 关闭按钮 / 点暗背板 = 只收页(回到菜单,游戏不恢复)。
	 *   - 旧机制全套废除(MenuBack 焦点战争 / EscapeBackground 钩子 / QOL 互操作 /
	 *     取消去重)—— 页面不再住在 Esc 菜单里,全部失去存在理由。
	 *   - 配置与桥状态不经本文件:lc_protocol.js(HUD context)持有配置并发布到
	 *     共享面板属性 lct_cfg / lct_status / lct_buildid;lct_settings_ui.js 直读直写。
	 */

	const TAG = "[LCT][Settings]";
	const PAGE_ID = "LCTSettingsPage";
	const ESC_MENU_ID = "EscapeMenu";
	const MENU_CLASS = "ShowEscapeMenu";
	const OPEN_CLASS = "LCTOpen";
	const POLL_S = 0.5;
	const GRACE_MS = 1200;

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

	function findPage() {
		const c = ctxPanel();
		if (c) { try { const f = c.FindChildTraverse(PAGE_ID); if (f) return f; } catch (e) {} }
		try { const g = globalRoot(); if (g) return g.FindChildTraverse(PAGE_ID); } catch (e2) {}
		return null;
	}

	function isOpen() {
		const p = findPage();
		try { return !!(p && p.BHasClass && p.BHasClass(OPEN_CLASS)); } catch (e) { return false; }
	}

	function nowMs() {
		// 时间源:Date.now()(QOLLOCK 生产实证,全库 55 处,零 $.Time)
		try { return (typeof Date !== "undefined" && Date.now) ? Date.now() : (new Date()).getTime(); } catch (e) { return 0; }
	}

	let openedAt = 0;
	let pollRunning = false;

	function findEscapeMenu() {
		let em = null;
		try { const c = ctxPanel(); em = c ? c.FindChildTraverse(ESC_MENU_ID) : null; } catch (e0) { em = null; }
		if (!em) {
			try { const g = globalRoot(); em = g ? g.FindChildTraverse(ESC_MENU_ID) : null; } catch (e1) { em = null; }
		}
		return em;
	}

	function menuVisible() {
		// ShowEscapeMenu 类 = 菜单显隐的真实开关(hud.css 实证:菜单用 opacity 显隐,
		// .ShowEscapeMenu #EscapeMenu {opacity: 1} —— 类不摘,菜单藏不掉;因此
		// visible 链恒为真不可用)。类挂在菜单面板或祖先链上,逐级查。
		const em = findEscapeMenu();
		if (!em) { return false; }
		let p = em;
		let d = 0;
		while (p && d < 16) {
			try { if (p.BHasClass && p.BHasClass(MENU_CLASS)) { return true; } } catch (e2) {}
			try { p = p.GetParent ? p.GetParent() : null; } catch (e3) { p = null; }
			d += 1;
		}
		return false;
	}

	function dispatchResume() {
		// 事件源必须是 Esc 菜单面板(2026-11-05 实测:从 HUD ctx 派发时菜单是 ctx
		// 的子孙、不在事件冒泡路径上,挂在菜单子树的处理器收不到 → 菜单不关)。
		// 旧架构 context 即 CitadelHudEscapeMenu 面板,同源所以从没暴露。
		const src = findEscapeMenu();
		try { $.DispatchEvent("CitadelResumePlaying", src || ctxPanel()); } catch (e2) {}
	}

	// 一步回游戏:收页 + resume(页根 oncancel 专用;QOL forceClose(true) 同款语义)
	function closeAndResume() {
		setOpen(false);
		dispatchResume();
	}

	function setOpen(open) {
		const p = findPage();
		if (!p) { log("page panel not found"); return; }
		try { if (open) { p.AddClass(OPEN_CLASS); } else { p.RemoveClass(OPEN_CLASS); } } catch (e1) {}
		if (open) {
			openedAt = nowMs();
			log("page opened"); // 流程追踪:与 escPoll 的 auto close 日志配对
			// 焦点交给页根:Esc(MenuBack)落到页根 oncancel = 收页 + resume 一步回游戏
			try { p.SetFocus(); } catch (eF) {}
			startEscPoll();
		} else {
			// 收起所有下拉菜单,避免下次打开残留展开态
			try { if (typeof $.LCTUICloseAllMenus === "function") $.LCTUICloseAllMenus(); } catch (e2) {}
			// 焦点归还 Esc 菜单(2026-11-05 窄面实测修复):开页时 SetFocus 到页根,
			// X/背板收页只摘 class 不还焦点 → 折叠页根仍持焦点链,Esc 的派发落到
			// 它的 oncancel(isOpen() 守卫 = no-op)就地被吞,Esc 关不掉菜单。
			// 焦点还给菜单面板,Esc 回归原版全局 MenuBack 行为。
			try {
				if (menuVisible()) {
					const em = findEscapeMenu();
					if (em && em.SetFocus) { em.SetFocus(); log("focus returned to escape menu"); }
				}
			} catch (e3) {}
		}
	}

	function escPoll() {
		if (!isOpen()) { pollRunning = false; return; }
		try {
			// 菜单被任何路径关掉 → 页面失去输入模式锚点(UI 模式随菜单结束),
			// 自动收页跟进。宽限期防 open 瞬间的时序毛刺。
			if (nowMs() - openedAt > GRACE_MS && !menuVisible()) {
				log("escape menu gone - auto close page");
				setOpen(false);
				pollRunning = false;
				return;
			}
		} catch (e) {
			log("escPoll threw: " + (e && e.message ? e.message : e));
		}
		try { $.Schedule(POLL_S, escPoll); } catch (e2) { pollRunning = false; }
	}

	function startEscPoll() {
		if (pollRunning) { return; }
		pollRunning = true;
		try { $.Schedule(POLL_S, escPoll); } catch (e) { pollRunning = false; }
	}

	// 页根 oncancel 绑定入口:lct_boot 装载页面后递面板进来。
	// 语义 = 一步回游戏:收页 + resume(菜单本就在页下开着,一并关掉)。
	// 页根拿不到焦点时 Esc 走游戏全局 MenuBack 直接关菜单,escPoll 会跟着收页
	// —— 两条路都收敛到"全关"。
	$.LCTBindPageCancel = function (page) {
		if (!page) { return; }
		try {
			page.SetPanelEvent("oncancel", function () {
				try { if (isOpen()) { closeAndResume(); } } catch (e) {}
			});
			log("page oncancel bound");
		} catch (e0) {
			log("page oncancel bind failed: " + e0);
		}
	};

	// 调用契约(注入按钮 / 页面内联处理器):
	//   $.LCTToggleSettingsWindow()     开/关页
	//   $.LCTCloseSettingsWindow()      收页(关闭按钮 / 暗背板)
	//   $.LCTIsSettingsOpen() -> bool   外部查询
	$.LCTToggleSettingsWindow = function () { setOpen(!isOpen()); };
	$.LCTCloseSettingsWindow = function () { setOpen(false); };
	$.LCTIsSettingsOpen = isOpen;

	log("page host ready (chat.xml context; page loaded by lct_boot)");
})();
