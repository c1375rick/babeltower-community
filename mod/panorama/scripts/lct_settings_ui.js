(function () {
	"use strict";

	/*
	 * BabelTower v3 — 设置窗口控件逻辑(由 hud_escape_menu.xml 引入,运行于 Escape Menu context)
	 *
	 * 与协议(chat context 的 lc_protocol.js)不通 JS,唯一通道 = 共享面板(#Hud/root)属性:
	 *   lct_cfg      配置 JSON(lc_protocol boot 发布默认值 → store 回载覆盖;本 UI 修改后写回,
	 *                协议 cfgWatchTick 采纳并 store.put 落盘)
	 *   lct_status   桥状态文本(协议 primary 写)
	 *   lct_buildid  桥页面 buildId(协议 primary 写)
	 *
	 * 窗口壳/控件面板由 hud_escape_menu.xml 静态声明;XML 的 onactivate 通过 $.LCTUI* 调用
	 * 本文件导出的函数(同时挂 $ 与 globalThis,QOLLOCK 同款 $.X 暴露形式)。
	 *
	 * 注意:本文件严禁定义名为 `$` 的局部函数/变量 —— 会遮蔽 Panorama 全局 `$` 对象,
	 * 导致 $.Msg/$.Schedule/$.GetContextPanel 全部失效(审查发现的首发缺陷)。
	 */

	const ATTR_CFG = "lct_cfg";
	const ATTR_STATUS = "lct_status";
	const ATTR_BUILDID = "lct_buildid";

	// UI 本地默认值(与 lc_protocol.js 的 CFG_DEFAULTS 同形):协议侧尚未发布 lct_cfg
	// 时(桥没起来/协议脚本未加载),设置窗口也必须完全可交互,而不是静默失效。
	// 用户在默认态下的修改会写回共享属性;协议上线后 cfgWatchTick 采纳并落盘,
	// 随后协议的权威配置(store 回载)经 poll 回流覆盖本 UI —— 竞态安全。
	const UI_DEFAULTS = {
		enabled: true,
		targetLanguage: "zh-Hans",
		displayMode: "bilingual",
		outgoing: "off",
		outgoingTarget: "en",
		force: false,
		translateOwn: true,
		timeoutMs: 8000,
		order: ["edge", "mymemory"]
	};

	function log(msg) { try { $.Msg("[LCT][TabUI] " + msg); } catch (e) {} }

	// 同时挂到 $ 与 globalThis:XML 事件处理器以 $.X 形式调用(QOLLOCK 生产模式)
	function exportFn(name, fn) {
		try { $[name] = fn; } catch (e0) { log("export $" + name + " failed"); }
		try {
			if (typeof globalThis !== "undefined") { globalThis[name] = fn; return; }
		} catch (e1) {}
		try {
			if (typeof window !== "undefined") { window[name] = fn; return; }
		} catch (e2) {}
	}

	/* ---------- 面板定位 ---------- */

	function ctxPanel() {
		try { return $.GetContextPanel(); } catch (e) { return null; }
	}

	function globalRoot() {
		try {
			let p = ctxPanel();
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

	// 共享面板:跨 context 属性通道的落点,与 lc_protocol.js 的 claimPanel() 同一选择
	function sharedPanel() {
		const root = globalRoot();
		if (!root) return null;
		try {
			const hud = root.FindChildTraverse("Hud");
			if (hud) return hud;
		} catch (e0) {}
		return root;
	}

	function findById(id) {
		const c = ctxPanel();
		if (c) {
			try { const f = c.FindChildTraverse(id); if (f) return f; } catch (e) {}
		}
		try { const g = globalRoot(); if (g) return g.FindChildTraverse(id); } catch (e2) {}
		return null;
	}

	/* ---------- 配置读写(共享面板属性) ---------- */

	let cfg = null;

	function readCfg() {
		try {
			const sp = sharedPanel();
			if (!sp) return null;
			const raw = sp.GetAttributeString(ATTR_CFG, "");
			if (!raw) return null;
			return JSON.parse(raw);
		} catch (e) { return null; }
	}

	function writeCfg() {
		try {
			const sp = sharedPanel();
			if (sp) sp.SetAttributeString(ATTR_CFG, JSON.stringify(cfg));
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

	/* ---------- 交互入口(XML onactivate 以 $.LCTUI* 调用) ---------- */

	function closeAllMenus() {
		for (const skey in SELECTS) {
			if (!SELECTS.hasOwnProperty(skey)) { continue; }
			const menu = findById(SELECTS[skey].menu);
			if (menu) { menu.RemoveClass("Open"); }
			const btn = findById(SELECTS[skey].btn);
			if (btn) { btn.RemoveClass("Open"); }
		}
	}

	exportFn("LCTUIToggle", function (key) {
		if (!cfg || !(key in TOGGLES)) { return; }
		cfg[key] = !cfg[key];
		const btn = findById(TOGGLES[key]);
		if (btn) {
			if (cfg[key]) { btn.AddClass("On"); } else { btn.RemoveClass("On"); }
		}
		writeCfg();
	});

	exportFn("LCTUIMenu", function (key) {
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

	exportFn("LCTUIPick", function (key, val, label) {
		if (!cfg || !SELECTS[key]) { return; }
		cfg[key] = (key === "timeoutMs") ? Number(val) : val;
		const lbl = findById(SELECTS[key].label);
		if (lbl) { lbl.text = label || val; }
		closeAllMenus();
		render();
		writeCfg();
	});

	exportFn("LCTUICloseAllMenus", closeAllMenus);

	/* ---------- 轮询共享属性 ---------- */

	function poll() {
		try {
			const incoming = readCfg();
			if (incoming && JSON.stringify(incoming) !== JSON.stringify(cfg)) {
				cfg = incoming;
				render();
			}
			const sp = sharedPanel();
			if (sp) {
				let bid = "";
				try { bid = sp.GetAttributeString(ATTR_BUILDID, ""); } catch (e1) {}
				const bidLbl = findById("LCTBuildId");
				if (bidLbl && bidLbl.text !== bid) { bidLbl.text = bid; }
				let st = "";
				try { st = sp.GetAttributeString(ATTR_STATUS, ""); } catch (e2) {}
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
			// 续命放在 finally:循环体任何未预料的异常都不能杀死轮询
			try { $.Schedule(0.25, poll); } catch (e3) {}
		}
	}

	function boot() {
		log("settings UI boot");
		const got = readCfg();
		if (got) {
			cfg = got;
		} else {
			cfg = Object.assign({}, UI_DEFAULTS);
			log("protocol cfg not published yet - using UI defaults (buttons stay live)");
		}
		render();
		poll();
	}

	try { $.Schedule(0, boot); } catch (e) { boot(); }
})();
