(function () {
	"use strict";

	/*
	 * BabelTower v3 — 设置页控件逻辑(HUD context,由 hud.xml 引入;2026-11-05 迁移)
	 *
	 * 与协议(chat context 的 lc_protocol.js)不通 JS,唯一通道 = 共享面板(#Hud/root)属性:
	 *   lct_cfg      配置 JSON(lc_protocol boot 发布默认值 → store 回载覆盖;本 UI 修改后写回,
	 *                协议 cfgWatchTick 采纳并 store.put 落盘)
	 *   lct_status   桥状态文本(协议 primary 写)
	 *   lct_buildid  桥页面 buildId(协议 primary 写)
	 *
	 * 窗口壳/控件面板由 lct_settings_page.xml 声明(lct_boot.js BLoadLayout 装载,同在
	 * HUD context);XML 的 onactivate 通过 $.LCTUI* 调用
	 * 本文件导出的函数(同时挂 $ 与 globalThis,QOLLOCK 同款 $.X 暴露形式)。
	 *
	 * 依赖 lct_i18n.js:无声明全局 LCT_TEXT_I18N / LCT_STATUS_PREFIX(纯数据表,
	 * 必须先于本文件加载 —— XML include 顺序契约,与 v2 lingua_chat_i18n.js 同法)。
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
		uiLang: "zh",
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

	// 共享面板:跨 context 属性通道的落点 = 绝对根面板(与 lc_protocol.js 的 claimPanel()
	// 同一选择;QOLLOCK 生产实证:ql_persistence 以 root 为必需宿主)
	function sharedPanel() {
		try { return globalRoot(); } catch (e0) { return null; }
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
		"timeoutMs":      { label: "LCTSelTimeoutLabel", btn: "LCTSelTimeout", menu: "LCTMenuTimeout" },
		"uiLang":         { label: "LCTSelUiLangLabel", btn: "LCTSelUiLang", menu: "LCTMenuUiLang" }
	};

	// value -> 显示文本(渲染当前值用)。zh 字面量是源语言:经 localizeText 查
	// LCT_TEXT_I18N 表得到当前界面语言的文本;markSelected 用同一函数解析,
	// 保证选中高亮的前缀匹配与显示文本一致。
	const LABELS = {
		"targetLanguage": { "zh-Hans": "简体中文", "zh-Hant": "繁體中文", "en": "English", "ja": "日本語", "ko": "한국어", "fr": "Français", "de": "Deutsch", "es": "Español" },
		"displayMode": { "bilingual": "双语", "translation_only": "仅译文" },
		"outgoing": { "off": "关", "translation": "仅译文", "bilingual": "双语" },
		"outgoingTarget": { "en": "English", "zh-Hans": "简体中文", "zh-Hant": "繁體中文", "ja": "日本語", "ko": "한국어" },
		"timeoutMs": { "4000": "4 秒", "8000": "8 秒", "12000": "12 秒", "16000": "16 秒" },
		"uiLang": { "zh": "中文", "en": "English" }
	};

	/* ---------- 界面本地化(zh/en;数据表在 lct_i18n.js,先于本文件加载) ---------- */

	// uiLang 是纯 UI 设置:只影响本面板文案,不参与翻译管线判定,协议不消费。
	// 手选制,不做游戏语言自动探测(v2 记录 $.Language 探针 2026-10-29 失效过;QOLLOCK 同为纯手选)。
	function uiLang() {
		return (cfg && cfg.uiLang === "en") ? "en" : "zh";
	}

	// 双向查找表:zh 与 en 文本都作为键指向同一条目(切 en 再切回 zh 可逆还原)。
	// 表缺失/键未命中一律原样返回 —— 永远显示原文,绝不显示裸键。
	const LOC_MAP = {};
	let locEntryCount = 0;
	function buildLocMap() {
		locEntryCount = 0;
		try {
			if (typeof LCT_TEXT_I18N === "object" && LCT_TEXT_I18N) {
				for (const zhKey in LCT_TEXT_I18N) {
					if (!Object.prototype.hasOwnProperty.call(LCT_TEXT_I18N, zhKey)) { continue; }
					const en = LCT_TEXT_I18N[zhKey];
					if (typeof en !== "string" || zhKey === "" || en === "" || zhKey === en) { continue; }
					const entry = { zh: zhKey, en: en };
					LOC_MAP[zhKey] = entry;
					LOC_MAP[en] = entry;
					locEntryCount++;
				}
			}
		} catch (e0) {}
		log("i18n entries: " + locEntryCount + (locEntryCount > 0 ? "" : " (table missing - zh passthrough)"));
	}

	function localizeText(s) {
		if (typeof s !== "string" || s === "") { return s; }
		const e = LOC_MAP[s];
		if (!e) { return s; }
		const v = e[uiLang()];
		return (typeof v === "string" && v !== "") ? v : s;
	}

	// 状态文本:整句查表;带动态后缀的(如 "已连接 build=xxxx")按前缀翻译保留后缀,
	// 前缀表只服务 en 界面(zh 即源语言,原样显示)。
	function localizeStatus(s) {
		const ex = localizeText(s);
		if (ex !== s) { return ex; }
		if (uiLang() !== "en") { return s; }
		try {
			if (typeof LCT_STATUS_PREFIX === "object" && LCT_STATUS_PREFIX) {
				for (const p in LCT_STATUS_PREFIX) {
					if (p && s.indexOf(p) === 0) { return String(LCT_STATUS_PREFIX[p]) + s.slice(p.length); }
				}
			}
		} catch (e0) {}
		return s;
	}

	// 静态文案与菜单选项的填充点:XML 里的 zh 文本即源语言,读当前文本 → 查表 → 写回。
	// 幂等(已译文本再查表命中同条目原值);表缺失时原样写回,零副作用。
	const LOC_IDS = [
		"LCTTxtTitle", "LCTTxtMenuEntry",
		"LCTTxtRowEnabled", "LCTTxtHintEnabled",
		"LCTTxtRowTarget", "LCTTxtHintTarget",
		"LCTTxtRowDisplay", "LCTTxtHintDisplay",
		"LCTTxtRowOutgoing", "LCTTxtHintOutgoing",
		"LCTTxtRowOutTarget",
		"LCTTxtRowForce", "LCTTxtHintForce",
		"LCTTxtRowTranslateOwn", "LCTTxtHintTranslateOwn",
		"LCTTxtRowTimeout", "LCTTxtRowUiLang"
	];
	const LOC_MENUS = ["LCTMenuTarget", "LCTMenuDisplay", "LCTMenuOutgoing", "LCTMenuOutTarget", "LCTMenuTimeout", "LCTMenuUiLang"];

	function localizeLabelInPlace(p) {
		try {
			if (p && typeof p.text === "string" && p.text !== "") { p.text = localizeText(p.text); }
		} catch (e0) {}
	}

	function applyTexts() {
		for (let i = 0; i < LOC_IDS.length; i++) { localizeLabelInPlace(findById(LOC_IDS[i])); }
		for (let m = 0; m < LOC_MENUS.length; m++) {
			const menu = findById(LOC_MENUS[m]);
			if (!menu) { continue; }
			let n = 0;
			try { n = menu.GetChildCount(); } catch (e0) { n = 0; }
			for (let i = 0; i < n; i++) {
				let opt = null;
				try { opt = menu.GetChild(i); } catch (e1) { opt = null; }
				if (!opt) { continue; }
				try { localizeLabelInPlace((opt.GetChildCount && opt.GetChildCount() > 0) ? opt.GetChild(0) : null); } catch (e2) {}
			}
		}
	}

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
			lbl.text = localizeText(map[val] || val);
			markSelected(skey, val);
		}
	}

	function markSelected(skey, val) {
		const menu = findById(SELECTS[skey].menu);
		if (!menu) { return; }
		let n = 0;
		try { n = menu.GetChildCount(); } catch (e) { n = 0; }
		const wantRaw = (LABELS[skey] || {})[String(val)];
		// wantLabel 与菜单选项文本走同一 localizeText:任何界面语言下前缀匹配都成立
		const wantLabel = wantRaw ? localizeText(wantRaw) : "";
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
		// 界面语言变更:静态文案/菜单选项全部按新语言重填(render 只覆盖选择框标签)
		if (key === "uiLang") { applyTexts(); }
	});

	exportFn("LCTUICloseAllMenus", closeAllMenus);
	// lct_boot.js 消费:注入按钮/装载页面后重刷静态文案(按钮标签 LCTTxtMenuEntry 等)
	exportFn("LCTUIApplyTexts", applyTexts);

	// Build 10931 实测(2026-11-05 21:35 会话):BLoadLayout 内联 onactivate 不再
	// 解析到装载者 context("内联跟随装载者"假设死亡,见 docs/INTEGRATION.md §7)
	// —— 32 个内联控件(3 开关+5 下拉+24 选项)静默失灵,X/背板等 SetPanelEvent
	// 绑定的控件全部正常。全部控件改由本函数确定性绑定,lct_boot.bindPageHandlers
	// 在页面装载后调用。菜单选项按"选项当前文本 ↔ localizeText(LABELS 值)"同源
	// 匹配(与 markSelected 同一判据,不赌子节点顺序);未命中数入日志自报。
	exportFn("LCTUIBindControls", function () {
		// 前置自备:先按当前 uiLang 落位静态文案(applyTexts 幂等),保证选项文本与
		// localizeText(LABELS) 同语言可匹配 —— 否则 en 界面下"绑定先于本地化"
		// 会全量 MISSED(2026-11-05 自审发现;内联时代无此时序耦合,退役代价之一)。
		applyTexts();
		let boundToggles = 0;
		for (const key in TOGGLES) {
			if (!TOGGLES.hasOwnProperty(key)) { continue; }
			const btn = findById(TOGGLES[key]);
			if (!btn) { continue; }
			try { btn.SetPanelEvent("onactivate", function () { $.LCTUIToggle(key); }); boundToggles++; } catch (e0) {}
		}
		let boundSelects = 0, boundOptions = 0, missedOptions = 0;
		for (const skey in SELECTS) {
			if (!SELECTS.hasOwnProperty(skey)) { continue; }
			const btn = findById(SELECTS[skey].btn);
			if (btn) {
				try { btn.SetPanelEvent("onactivate", function () { $.LCTUIMenu(skey); }); boundSelects++; } catch (e1) {}
			}
			const menu = findById(SELECTS[skey].menu);
			if (!menu) { continue; }
			let n = 0;
			try { n = menu.GetChildCount(); } catch (e2) { n = 0; }
			for (let i = 0; i < n; i++) {
				let opt = null;
				try { opt = menu.GetChild(i); } catch (e3) { opt = null; }
				if (!opt) { continue; }
				let optText = "";
				try {
					const lbl = (opt.GetChildCount && opt.GetChildCount() > 0) ? opt.GetChild(0) : null;
					if (lbl && typeof lbl.text === "string") { optText = lbl.text; }
				} catch (e4) {}
				let hitVal = null, hitLabel = "";
				const map = LABELS[skey] || {};
				for (const v in map) {
					if (!map.hasOwnProperty(v)) { continue; }
					const localized = localizeText(map[v]);
					if (optText === localized || (localized !== "" && optText.indexOf(localized) === 0)) {
						hitVal = v; hitLabel = localized; break;
					}
				}
				if (hitVal === null) { missedOptions++; continue; }
				try { opt.SetPanelEvent("onactivate", function () { $.LCTUIPick(skey, hitVal, hitLabel); }); boundOptions++; } catch (e5) {}
			}
		}
		log("controls bound: toggles=" + boundToggles + " selects=" + boundSelects + " options=" + boundOptions + (missedOptions > 0 ? " MISSED=" + missedOptions : ""));
		return missedOptions === 0;
	});

	/* ---------- 轮询共享属性 ---------- */

	function poll() {
		try {
			const incoming = readCfg();
			if (incoming && JSON.stringify(incoming) !== JSON.stringify(cfg)) {
				const prevLang = cfg ? cfg.uiLang : null;
				cfg = incoming;
				// 协议侧权威配置带回的界面语言变化:静态文案一并重填
				if (cfg.uiLang !== prevLang) { applyTexts(); }
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
				// 显示用本地化文本做比较(否则 zh 原文 vs 已译文本每 tick 都判不等);
				// 状态灯判类仍用协议原文前缀
				const shown = localizeStatus(st);
				if (stLbl && shown !== "" && shown !== stLbl.text) {
					stLbl.text = shown;
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
		// uiLang 兜底:缺失/未知值一律回 zh(与旧版纯中文行为一致)
		if (cfg.uiLang !== "en" && cfg.uiLang !== "zh") { cfg.uiLang = "zh"; }
		buildLocMap();
		applyTexts();
		render();
		poll();
	}

	try { $.Schedule(0, boot); } catch (e) { boot(); }
})();
