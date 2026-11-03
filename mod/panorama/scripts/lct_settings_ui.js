(function () {
	"use strict";

	/*
	 * BabelTower v3 — 设置 Tab 自治 UI(由 lct_settings_tab.xml 引入,运行在 Escape Menu 的 JS context)
	 * 与宿主(chat/hudchat context)不通 JS,通信通道 = 实例面板 LCTSettingsTabInstance 上的属性:
	 *   lct_cfg      配置 JSON(双向:宿主写入初值,本 UI 修改后写回,宿主轮询采纳并持久化)
	 *   lct_buildid  桥页面 buildId(宿主写)
	 *   lct_status   桥状态文本(宿主写)
	 *   lct_ui_alive 心跳(本 UI 写,宿主据此判断脚本存活;缺席 6 tick 宿主降级重建)
	 *
	 * 注意:本文件严禁定义名为 `$` 的局部函数/变量 —— 会遮蔽 Panorama 全局 `$` 对象,
	 * 导致 $.Msg/$.Schedule/$.GetContextPanel 全部失效(审查发现的首发缺陷)。
	 */

	const CHANNEL_ID = "LCTSettingsTabInstance";
	const ATTR_CFG = "lct_cfg";
	const ATTR_BUILDID = "lct_buildid";
	const ATTR_STATUS = "lct_status";
	const ATTR_ALIVE = "lct_ui_alive";

	function log(msg) { try { $.Msg("[LCT][TabUI] " + msg); } catch (e) {} }

	function exportGlobal(name, fn) {
		try {
			if (typeof globalThis !== "undefined") { globalThis[name] = fn; return; }
		} catch (e0) {}
		try {
			if (typeof window !== "undefined") { window[name] = fn; return; }
		} catch (e1) {}
		log("export " + name + " failed");
	}

	/* ---------- 面板定位 ---------- */

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

	// 通道面板:从本 context 面板向上找实例 id;找不到(结构意外)再从全局根下找。
	// 宿主与 Tab 双方都只认这个面板,属性读写不会错位。
	function channel() {
		try {
			let p = $.GetContextPanel();
			let d = 0;
			while (p && d < 64) {
				if (String(p.id || "") === CHANNEL_ID) return p;
				if (!p.GetParent || !p.GetParent()) break;
				p = p.GetParent();
				d++;
			}
		} catch (e) {}
		try {
			const g = globalRoot();
			if (g) return g.FindChildTraverse(CHANNEL_ID);
		} catch (e2) {}
		return null;
	}

	function findById(id) {
		const c = channel();
		if (c) {
			try { const f = c.FindChildTraverse(id); if (f) return f; } catch (e) {}
		}
		try { return $.GetContextPanel().FindChildTraverse(id); } catch (e2) { return null; }
	}

	/* ---------- 配置读写 ---------- */

	let cfg = null;

	function readCfg() {
		try {
			const c = channel();
			if (!c) return null;
			const raw = c.GetAttributeString(ATTR_CFG, "");
			if (!raw) return null;
			return JSON.parse(raw);
		} catch (e) { return null; }
	}

	function writeCfg() {
		try {
			const c = channel();
			if (c) c.SetAttributeString(ATTR_CFG, JSON.stringify(cfg));
		} catch (e) { log("writeCfg failed: " + e); }
	}

	/* ---------- 控件映射 ---------- */

	const TOGGLES = { "enabled": "LCTTglEnabled", "force": "LCTTglForce", "translateOwn": "LCTTglTranslateOwn" };

	const SELECTS = {
		"targetLanguage": { label: "LCTSelTargetLabel", btn: "LCTSelTarget", menu: "LCTMenuTarget" },
		"displayMode":    { label: "LCTSelDisplayLabel", btn: "LCTSelDisplay", menu: "LCTMenuDisplay" },
		"outgoing":       { label: "LCTSelOutgoingLabel", btn: "LCTSelOutgoing", menu: "LCTMenuOutgoing" },
		"outgoingTarget": { label: "LCTSelOutTargetLabel", btn: "LCTSelOutTarget", menu: "LCTMenuOutTarget" },
		"timeoutMs":      { label: "LCTSelTimeoutLabel", btn: "LCTSelTimeout", menu: "LCTMenuTimeout" }
	};

	// value -> 显示文本(渲染当前值用)
	const LABELS = {
		"targetLanguage": { "zh-Hans": "简体中文", "zh-Hant": "繁體中文", "en": "English", "ja": "日本語", "ko": "한국어", "fr": "Français", "de": "Deutsch", "es": "Español" },
		"displayMode": { "bilingual": "双语", "translation_only": "仅译文" },
		"outgoing": { "off": "关", "translation": "仅译文", "bilingual": "双语" },
		"outgoingTarget": { "en": "English", "zh-Hans": "简体中文", "zh-Hant": "繁體中文", "ja": "日本語", "ko": "한국어" },
		"timeoutMs": { "4000": "4 秒", "8000": "8 秒", "12000": "12 秒", "16000": "16 秒" }
	};

	/* ---------- 渲染 ---------- */

	function render() {
		if (!cfg) { return; }
		for (const key in TOGGLES) {
			if (!TOGGLES.hasOwnProperty(key)) { continue; }
			const btn = findById(TOGGLES[key]);
			if (!btn) { continue; }
			if (cfg[key]) { btn.AddClass("On"); } else { btn.RemoveClass("On"); }
		}
		for (const skey in SELECTS) {
			if (!SELECTS.hasOwnProperty(skey)) { continue; }
			const lbl = findById(SELECTS[skey].label);
			if (!lbl) { continue; }
			const val = String(cfg[skey]);
			const map = LABELS[skey] || {};
			if (!(val in map)) { log("render: unknown value " + skey + "=" + val); }
			lbl.text = map[val] || val;
			markSelected(skey, val);
		}
	}

	function markSelected(skey, val) {
		const menu = findById(SELECTS[skey].menu);
		if (!menu) { return; }
		let n = 0;
		try { n = menu.GetChildCount(); } catch (e) { n = 0; }
		const wantLabel = (LABELS[skey] || {})[String(val)];
		const hits = [];
		for (let i = 0; i < n; i++) {
			const opt = menu.GetChild(i);
			try { opt.RemoveClass("Sel"); } catch (e2) {}
			if (!wantLabel) { continue; }
			let hit = false;
			try {
				const lbl2 = (opt.GetChildCount && opt.GetChildCount() > 0) ? opt.GetChild(0) : null;
				if (lbl2 && typeof lbl2.text === "string" && lbl2.text.indexOf(wantLabel) === 0) { hit = true; }
			} catch (e3) {}
			if (hit) { hits.push(opt); }
		}
		// 仅唯一命中才高亮;零或多命中记日志(文本前缀匹配的脆弱点自报)
		if (hits.length === 1) {
			try { hits[0].AddClass("Sel"); } catch (e4) {}
		} else if (wantLabel) {
			log("markSelected: " + skey + "=" + val + " hits=" + hits.length);
		}
	}

	/* ---------- 交互入口(XML onactivate 调用) ---------- */

	function closeAllMenus() {
		for (const skey in SELECTS) {
			if (!SELECTS.hasOwnProperty(skey)) { continue; }
			const menu = findById(SELECTS[skey].menu);
			if (menu) { menu.RemoveClass("Open"); }
			const btn = findById(SELECTS[skey].btn);
			if (btn) { btn.RemoveClass("Open"); }
		}
	}

	exportGlobal("LCTUIToggle", function (key) {
		if (!cfg || !(key in TOGGLES)) { return; }
		cfg[key] = !cfg[key];
		const btn = findById(TOGGLES[key]);
		if (btn) {
			if (cfg[key]) { btn.AddClass("On"); } else { btn.RemoveClass("On"); }
		}
		writeCfg();
	});

	exportGlobal("LCTUIMenu", function (key) {
		if (!cfg || !SELECTS[key]) { return; }
		const menu = findById(SELECTS[key].menu);
		const btn = findById(SELECTS[key].btn);
		if (!menu) { return; }
		const isOpen = menu.BHasClass("Open");
		closeAllMenus();
		if (isOpen) {
			menu.RemoveClass("Open");
			if (btn) { btn.RemoveClass("Open"); }
		} else {
			menu.AddClass("Open");
			if (btn) { btn.AddClass("Open"); }
		}
	});

	exportGlobal("LCTUIPick", function (key, val, label) {
		if (!cfg || !SELECTS[key]) { return; }
		cfg[key] = (key === "timeoutMs") ? Number(val) : val;
		const lbl = findById(SELECTS[key].label);
		if (lbl) { lbl.text = label || val; }
		closeAllMenus();
		render();
		writeCfg();
	});

	/* ---------- 轮询宿主 ---------- */

	let polls = 0;

	function poll() {
		polls += 1;
		try {
			const c = channel();
			if (c) {
				// 心跳:宿主 6 tick(约 6s)看不到它就判死重建,必须每次轮询都刷新
				try { c.SetAttributeString(ATTR_ALIVE, String(polls)); } catch (e0) {}
			}
			const incoming = readCfg();
			if (incoming && JSON.stringify(incoming) !== JSON.stringify(cfg)) {
				cfg = incoming;
				render();
			}
			if (c) {
				let bid = "";
				try { bid = c.GetAttributeString(ATTR_BUILDID, ""); } catch (e1) {}
				const bidLbl = findById("LCTBuildId");
				if (bidLbl && bidLbl.text !== bid) { bidLbl.text = bid; }
				let st = "";
				try { st = c.GetAttributeString(ATTR_STATUS, ""); } catch (e2) {}
				const stLbl = findById("LCTStatusText");
				const dot = findById("LCTDot");
				if (stLbl && st !== "" && st !== stLbl.text) {
					stLbl.text = st;
					if (dot) {
						dot.RemoveClass("Ok");
						dot.RemoveClass("Bad");
						if (st.indexOf("已连接") === 0) { dot.AddClass("Ok"); }
						if (st.indexOf("失败") === 0 || st.indexOf("错误") === 0) { dot.AddClass("Bad"); }
					}
				}
			}
		} finally {
			// 续命放在 finally:循环体任何未预料的异常都不能杀死心跳
			try { $.Schedule(0.25, poll); } catch (e3) {}
		}
	}

	function boot() {
		log("Tab UI boot");
		const got = readCfg();
		if (got) { cfg = got; render(); }
		poll();
	}

	try { $.Schedule(0, boot); } catch (e) { boot(); }
})();
