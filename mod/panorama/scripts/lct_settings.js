(function () {
	"use strict";

	/*
	 * BabelTower v3 — 设置窗口宿主(运行于 Escape Menu context,由 hud_escape_menu.xml 引入)
	 *
	 * QOLLOCK 生产模式重写后的形态:
	 *   - 窗口壳静态声明在 hud_escape_menu.xml(样式同 context include,零 BLoadLayout、
	 *     零跨 context 注入 —— QOLLOCK 反编译实证 BLoadLayout 出现 0 次,原生设置页零接触)
	 *   - 本文件只负责窗口开/关与状态查询,以 $.X 形式暴露给 XML 事件处理器
	 *     (QOLLOCK 同款:$.BuildUI / $.ToggleSettingsWindow / $.ForceCloseModSettings)
	 *   - 配置与桥状态不再经过本文件:lc_protocol.js(chat context)持有配置并发布到
	 *     共享面板属性(#Hud/root):lct_cfg / lct_status / lct_buildid;
	 *     lct_settings_ui.js(本 context)直读直写这些属性。三方仅通过属性通信。
	 */

	const TAG = "[LCT][Settings]";
	const WIN_ID = "LCTSettingsWindow";
	const OPEN_CLASS = "LCTOpen";

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

	function isOpen() {
		const w = findWindow();
		try { return !!(w && w.BHasClass && w.BHasClass(OPEN_CLASS)); } catch (e) { return false; }
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
		if (!open) {
			// 关窗时收起所有下拉菜单,避免下次打开时残留展开态
			try { if (typeof $.LCTUICloseAllMenus === "function") $.LCTUICloseAllMenus(); } catch (e2) {}
		}
		if (!open && resume === true && typeof CitadelResumePlaying === "function") {
			try { CitadelResumePlaying(); } catch (e3) {}
		}
	}

	// XML 处理器调用契约(hud_escape_menu.xml):
	//   $.LCTToggleSettingsWindow()          入口按钮
	//   $.LCTCloseSettingsWindow([resume])   关闭按钮 / Esc / Resume / 背景点击(resume=true 时顺带返回游戏)
	//   $.LCTIsSettingsOpen() -> bool        背景点击守卫
	$.LCTToggleSettingsWindow = function () {
		setOpen(!isOpen(), false);
	};
	$.LCTCloseSettingsWindow = function (resume) {
		setOpen(false, resume === true);
	};
	$.LCTIsSettingsOpen = isOpen;

	log("window host ready");
})();
