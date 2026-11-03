(function () {
	"use strict";

	/*
	 * BabelTower v3 — 设置宿主(chat / hudchat 两 context 并行,面板树查重去重)
	 *
	 * 职责:
	 *   1. 把设置 Tab 注入 Escape Menu 的设置容器(实机实证:容器面板 id="settings",小写)
	 *      首选 BLoadLayout(lct_settings_tab.vxml_c);失败或 Tab 脚本无心跳时降级为 JS 兜底 UI。
	 *   2. 1s 同步循环:Tab 失效自动重注入 / 采纳 Tab 写回的配置 / 推送 buildId 与桥状态。
	 *
	 * 跨 context 通道 = 实例面板(CHANNEL_ID)上的属性:
	 *   lct_cfg       配置 JSON(双向:宿主写初值,Tab 改后写回,宿主轮询采纳)
	 *   lct_buildid   桥页面 buildId(宿主→Tab)
	 *   lct_status    桥状态文本(宿主→Tab)
	 *   lct_ui_alive  Tab 脚本心跳(Tab→宿主,缺席 6 tick 判死降级)
	 *   lct_fallback  该实例是 JS 兜底 UI(宿主写,防另一 context 误判)
	 *
	 * 持久层在桥页面 localStorage(store.get/put,见 docs/PROTOCOL.md §10);
	 * 本文件只管会话层(根/#Hud 面板属性,实机实证 attr 往返闭环)。
	 * Convars 方案已判死(实机 typeof Convars === "undefined"),不再出现。
	 */

	const TAG = "[LCT][Settings]";
	const CHANNEL_ID = "LCTSettingsTabInstance";
	const ATTR_CFG = "lct_cfg";
	const ATTR_BUILDID = "lct_buildid";
	const ATTR_STATUS = "lct_status";
	const ATTR_ALIVE = "lct_ui_alive";
	const ATTR_FALLBACK = "lct_fallback";
	const LAYOUT_PATHS = [
		"s2r://panorama/layout/lct_settings_tab.vxml_c",
		"file://{resources}/layout/lct_settings_tab.xml",
		"file://{resources}/layout/lct_settings_tab.vxml_c"
	];

	const DEFAULTS = {
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

	// 兜底 UI 用:可选值与显示名(与 lct_settings_tab.xml 的菜单项保持一致)
	const CYCLES = {
		targetLanguage: ["zh-Hans", "zh-Hant", "en", "ja", "ko", "fr", "de", "es"],
		displayMode: ["bilingual", "translation_only"],
		outgoing: ["off", "translation", "bilingual"],
		outgoingTarget: ["en", "zh-Hans", "zh-Hant", "ja", "ko"],
		timeoutMs: [4000, 8000, 12000, 16000]
	};
	const NAMES = {
		"zh-Hans": "简体中文", "zh-Hant": "繁體中文", "en": "English", "ja": "日本語",
		"ko": "한국어", "fr": "Français", "de": "Deutsch", "es": "Español",
		"bilingual": "双语", "translation_only": "仅译文", "off": "关", "translation": "仅译文"
	};
	const FALLBACK_ROWS = [
		["toggle", "enabled", "启用翻译", "关闭后所有消息保留原文"],
		["cycle", "targetLanguage", "目标语言", "把别人的消息翻译成这个语言"],
		["cycle", "displayMode", "显示模式", "译文下方是否保留原文"],
		["cycle", "outgoing", "发送前翻译", "把自己打的消息先翻成目标语言再发出"],
		["cycle", "outgoingTarget", "发送目标语言", ""],
		["toggle", "force", "强制翻译", "跳过语言判断,一律翻译"],
		["toggle", "translateOwn", "翻译自己的消息", "自己发出的消息也显示译文"],
		["cycle", "timeoutMs", "翻译超时", ""]
	];

	let cfg = null;
	let _attempts = 0;
	let _mode = null;        // "layout" | "fallback" | null
	let _degraded = false;   // 心跳判死后不再尝试 BLoadLayout,防止 layout/兜底 互相拆台
	let _instTicks = 0;      // 当前实例存在以来的 tick 数(心跳监督)
	let _lastTabRaw = "";    // 上次从 Tab 读到的 lct_cfg 原文
	let _lastHudRaw = "";    // 上次从 #Hud 读到的 lct_cfg 原文(跨 context 会话收敛)
	let _tab = null;         // 当前实例面板引用(兜底 UI 回调用)
	const _fb = {};          // 兜底 UI 控件引用 { key: {kind, btn, text} }
	let _fbStatus = null;
	let _fbDot = null;

	function log(msg) {
		try { $.Msg(TAG + " " + msg); } catch (_) {}
	}

	/* ---------- 基础工具 ---------- */

	function getGlobalRoot() {
		try {
			let p = $.GetContextPanel();
			let depth = 0;
			while (p && p.GetParent && p.GetParent() && depth < 64) {
				p = p.GetParent();
				depth++;
			}
			return p;
		} catch (e) {
			return null;
		}
	}

	// 注入目标必须是容器类面板;Label/Image 里塞子面板会显示异常
	function isContainerPanel(p) {
		try {
			const t = p.paneltype;
			if (t === "Label" || t === "Image" || t === "TextEntry") return false;
		} catch (_) {}
		return true;
	}

	// 单个样式属性失败不能打断整个注入(实证:font-weight:600 会被 JS 样式校验拒绝)
	function safeStyle(p, prop, value) {
		try { p.style[prop] = value; } catch (e) { log("style " + prop + " rejected: " + value); }
	}

	/* ---------- 配置(会话层) ---------- */

	// 合并 DEFAULTS 并剔除历史遗留字段(如 openai),保证 JSON 键序稳定
	function canonical(obj) {
		const c = Object.assign({}, DEFAULTS);
		if (obj && typeof obj === "object") {
			for (const k in obj) {
				if (Object.prototype.hasOwnProperty.call(obj, k) && k !== "openai") {
					c[k] = obj[k];
				}
			}
		}
		return c;
	}

	function saveSessionCfg() {
		if (!cfg) return;
		const json = JSON.stringify(cfg);
		try {
			const ctx = $.GetContextPanel();
			if (ctx) ctx.SetAttributeString(ATTR_CFG, json);
		} catch (_) {}
		try {
			const root = getGlobalRoot();
			const hud = root ? root.FindChildTraverse("Hud") : null;
			if (hud) hud.SetAttributeString(ATTR_CFG, json);
		} catch (_) {}
	}

	function loadSessionCfg() {
		let raw = "";
		try {
			const root = getGlobalRoot();
			const hud = root ? root.FindChildTraverse("Hud") : null;
			if (hud) raw = hud.GetAttributeString(ATTR_CFG, "");
		} catch (_) {}
		if (!raw) {
			try { raw = $.GetContextPanel().GetAttributeString(ATTR_CFG, ""); } catch (_) {}
		}
		let c = Object.assign({}, DEFAULTS);
		if (raw) {
			try { c = canonical(JSON.parse(raw)); } catch (e) { log("session cfg parse failed"); }
		}
		return c;
	}

	// 桥状态来源:lc_protocol.js 暴露的 globalThis.LCTBridge.statusInfo();未就绪时显示未连接
	function bridgeInfo() {
		try {
			const b = globalThis.LCTBridge;
			if (b && typeof b.statusInfo === "function") {
				const s = b.statusInfo();
				if (s && typeof s.text === "string") return s;
			}
		} catch (_) {}
		return { text: "未连接", buildId: "" };
	}

	// 持久化钩子:lc_protocol.js 就绪后由它落盘到桥页面 store.put("cfg")
	function persistHook() {
		try {
			const b = globalThis.LCTBridge;
			if (b && typeof b.persistCfg === "function") b.persistCfg(JSON.stringify(cfg));
		} catch (_) {}
	}

	// 外部(桥持久层回载)写入配置入口
	function applyConfig(obj) {
		cfg = canonical(obj);
		saveSessionCfg();
		try { log("cfg applied externally: " + JSON.stringify(cfg).slice(0, 120)); } catch (_) {}
	}

	/* ---------- 注入目标查找(实机实证:容器 id="settings") ---------- */

	function findSettingsContainer(root) {
		// 策略 1:ID 候选 —— "settings"(小写)是实机 DFS 实证命中的真实 id,放第一位
		const ids = [
			"settings", "SettingsList", "SettingsContainer", "SettingsPanel",
			"SettingsDialog", "SettingsDialogContent", "SettingsTabs", "Settings"
		];
		for (let i = 0; i < ids.length; i++) {
			try {
				const p = root.FindChildTraverse(ids[i]);
				if (p && isContainerPanel(p)) return p;
			} catch (_) {}
		}
		// 策略 2:类名搜索
		const classes = ["SettingsList", "SettingsContainer", "SettingsDialog"];
		for (let i = 0; i < classes.length; i++) {
			try {
				const arr = root.FindChildrenWithClassTraverse(classes[i]);
				if (arr && arr.length > 0 && isContainerPanel(arr[0])) return arr[0];
			} catch (_) {}
		}
		// 策略 3:DFS 找 id 里带 "settings" 的最深容器面板(每 5 轮一次,避免卡顿)
		if (_attempts % 5 !== 0) return null;
		let best = null, bestScore = -1, visited = 0;
		const stack = [[root, 0]];
		while (stack.length > 0 && visited < 20000) {
			const entry = stack.pop();
			const p = entry[0], d = entry[1];
			visited++;
			let pid = "";
			try { pid = String(p.id || ""); } catch (_) {}
			if (pid && pid.toLowerCase().indexOf("settings") !== -1 && isContainerPanel(p)) {
				const lower = pid.toLowerCase();
				let score = d;
				if (lower.indexOf("list") !== -1 || lower.indexOf("container") !== -1 ||
					lower.indexOf("page") !== -1 || lower.indexOf("content") !== -1 ||
					lower.indexOf("tabs") !== -1 || lower.indexOf("body") !== -1 ||
					lower.indexOf("dialog") !== -1) {
					score += 100; // 明确是容器的优先
				}
				if (score > bestScore) {
					best = p;
					bestScore = score;
				}
			}
			let n = 0;
			try { n = p.GetChildCount(); } catch (_) { n = 0; }
			for (let i = 0; i < n; i++) {
				try { stack.push([p.GetChild(i), d + 1]); } catch (_) {}
			}
		}
		if (best) log("DFS found settings panel id=" + (best.id || "?") + " score=" + bestScore);
		return best;
	}

	/* ---------- JS 兜底 UI(BLoadLayout 失败/Tab 脚本判死时) ---------- */

	function nameOf(key, v) {
		if (key === "timeoutMs") return (Number(v) / 1000) + " 秒";
		return NAMES[v] || String(v);
	}

	function fbRow(parent, id, label, hint) {
		const row = $.CreatePanel("Panel", parent, id);
		safeStyle(row, "width", "100%");
		safeStyle(row, "flowChildren", "down");
		safeStyle(row, "padding", "6px 4px");
		const line = $.CreatePanel("Panel", row, id + "Line");
		safeStyle(line, "width", "100%");
		safeStyle(line, "flowChildren", "right");
		const body = $.CreatePanel("Panel", line, id + "Body");
		safeStyle(body, "flowChildren", "down");
		const lab = $.CreatePanel("Label", body, id + "Label");
		lab.text = label;
		safeStyle(lab, "color", "#c8d2e0");
		safeStyle(lab, "fontSize", "14px");
		if (hint) {
			const h = $.CreatePanel("Label", body, id + "Hint");
			h.text = hint;
			safeStyle(h, "color", "#5a6478");
			safeStyle(h, "fontSize", "11px");
		}
		return line;
	}

	function fbButton(line, id, onact) {
		const btn = $.CreatePanel("Button", line, id);
		safeStyle(btn, "horizontalAlign", "right");
		safeStyle(btn, "verticalAlign", "center");
		safeStyle(btn, "backgroundColor", "rgba(255,255,255,0.10)");
		safeStyle(btn, "borderRadius", "4px");
		safeStyle(btn, "padding", "4px 12px");
		const l = $.CreatePanel("Label", btn, id + "Text");
		safeStyle(l, "color", "#e8edf5");
		safeStyle(l, "fontSize", "13px");
		try { btn.SetPanelEvent("onactivate", onact); } catch (e) { log("SetPanelEvent failed: " + e); }
		return { btn: btn, text: l };
	}

	function onFallbackChange() {
		saveSessionCfg();
		persistHook();
		try { if (_tab) _tab.SetAttributeString(ATTR_CFG, JSON.stringify(cfg)); } catch (_) {}
		renderFallback();
	}

	function buildFallbackTab(tab) {
		const header = $.CreatePanel("Label", tab, "LCTFallbackHeader");
		header.text = "BABELTOWER 翻译(兼容模式)";
		safeStyle(header, "color", "#6ea8ff");
		safeStyle(header, "fontSize", "15px");
		safeStyle(header, "fontWeight", "bold");
		safeStyle(header, "marginBottom", "6px");

		for (let i = 0; i < FALLBACK_ROWS.length; i++) {
			const r = FALLBACK_ROWS[i];
			const kind = r[0], key = r[1], label = r[2], hint = r[3];
			const line = fbRow(tab, "LCTFB" + key, label, hint);
			if (kind === "toggle") {
				const ref = fbButton(line, "LCTFB" + key + "Btn", (function (k) {
					return function () { cfg[k] = !cfg[k]; onFallbackChange(); };
				})(key));
				_fb[key] = { kind: "toggle", btn: ref.btn, text: ref.text };
			} else {
				const ref = fbButton(line, "LCTFB" + key + "Btn", (function (k) {
					return function () {
						const arr = CYCLES[k];
						const idx = arr.indexOf(cfg[k]);
						cfg[k] = arr[(idx + 1) % arr.length];
						onFallbackChange();
					};
				})(key));
				_fb[key] = { kind: "cycle", btn: ref.btn, text: ref.text };
			}
		}

		const footer = $.CreatePanel("Panel", tab, "LCTFallbackFooter");
		safeStyle(footer, "width", "100%");
		safeStyle(footer, "flowChildren", "right");
		safeStyle(footer, "marginTop", "8px");
		_fbDot = $.CreatePanel("Panel", footer, "LCTFallbackDot");
		safeStyle(_fbDot, "width", "8px");
		safeStyle(_fbDot, "height", "8px");
		safeStyle(_fbDot, "borderRadius", "4px");
		safeStyle(_fbDot, "backgroundColor", "#6a7385");
		safeStyle(_fbDot, "verticalAlign", "center");
		_fbStatus = $.CreatePanel("Label", footer, "LCTFallbackStatus");
		safeStyle(_fbStatus, "color", "#8a94a6");
		safeStyle(_fbStatus, "fontSize", "12px");
		safeStyle(_fbStatus, "marginLeft", "8px");
		safeStyle(_fbStatus, "verticalAlign", "center");

		renderFallback();
	}

	function renderFallback() {
		for (const key in _fb) {
			if (!Object.prototype.hasOwnProperty.call(_fb, key)) continue;
			const r = _fb[key];
			if (!r || !r.text) continue;
			try {
				if (r.kind === "toggle") {
					r.text.text = cfg[key] ? "开" : "关";
					safeStyle(r.btn, "backgroundColor", cfg[key] ? "rgba(61,109,184,0.85)" : "rgba(255,255,255,0.10)");
				} else {
					r.text.text = nameOf(key, cfg[key]);
				}
			} catch (e) {}
		}
	}

	function updateFallbackFooter(bi) {
		try {
			if (_fbStatus) _fbStatus.text = bi.text || "未连接";
			if (_fbDot) {
				const t = bi.text || "";
				let color = "#6a7385";
				if (t.indexOf("已连接") === 0) color = "#58c07a";
				else if (t.indexOf("失败") === 0 || t.indexOf("错误") === 0) color = "#d05a5a";
				safeStyle(_fbDot, "backgroundColor", color);
			}
		} catch (e) {}
	}

	/* ---------- 注入 ---------- */

	function injectTab(root) {
		// 跨 context 去重:另一 context 已注入则直接收手(实机实证的收手路径)
		try {
			const exist = root.FindChildTraverse(CHANNEL_ID);
			if (exist) {
				let valid = true;
				try { valid = exist.IsValid(); } catch (_) {}
				if (valid) return exist;
			}
		} catch (_) {}

		const container = findSettingsContainer(root);
		if (!container) return null;

		let tab = null;
		try { tab = $.CreatePanel("Panel", container, CHANNEL_ID); } catch (e) {
			log("CreatePanel failed: " + (e && e.message ? e.message : e));
			return null;
		}
		if (!tab) return null;
		safeStyle(tab, "width", "100%");
		safeStyle(tab, "flowChildren", "down");

		// 同帧竞态守卫:两个 context 同帧都注入时,后到者自删并采用先到者
		try {
			const dup = container.FindChild(CHANNEL_ID);
			if (dup && dup !== tab) {
				try { tab.DeleteAsync(0); } catch (_) {}
				return dup;
			}
		} catch (_) {}

		if (_degraded) {
			try {
				buildFallbackTab(tab);
				_mode = "fallback";
				try { tab.SetAttributeString(ATTR_FALLBACK, "1"); } catch (_) {}
				log("re-injected fallback UI into id=" + (container.id || "?"));
				return tab;
			} catch (e0) {
				try { tab.DeleteAsync(0); } catch (_) {}
				return null;
			}
		}

		let loaded = false;
		for (let i = 0; i < LAYOUT_PATHS.length; i++) {
			try { loaded = tab.BLoadLayout(LAYOUT_PATHS[i], false, false); } catch (e) { loaded = false; }
			if (loaded) {
				log("BLoadLayout ok: " + LAYOUT_PATHS[i]);
				break;
			}
		}
		if (loaded) {
			_mode = "layout";
			_instTicks = 0;
			log("Injected settings tab (layout) into id=" + (container.id || "?"));
			return tab;
		}

		log("BLoadLayout failed on all paths, building fallback UI");
		try {
			buildFallbackTab(tab);
			_mode = "fallback";
			try { tab.SetAttributeString(ATTR_FALLBACK, "1"); } catch (_) {}
			log("Injected settings tab (fallback) into id=" + (container.id || "?"));
			return tab;
		} catch (e2) {
			log("Fallback build failed: " + (e2 && e2.message ? e2.message : e2));
			try { tab.DeleteAsync(0); } catch (_) {}
			return null;
		}
	}

	function ensureTab() {
		const root = getGlobalRoot();
		if (!root) return null;
		let tab = null;
		try { tab = root.FindChildTraverse(CHANNEL_ID); } catch (_) {}
		if (tab) {
			let valid = true;
			try { valid = tab.IsValid(); } catch (_) {}
			if (!valid) {
				tab = null;
				_mode = null;
				_instTicks = 0;
			}
		}
		if (!tab) {
			tab = injectTab(root);
			if (tab) _instTicks = 0;
		}
		if (tab && !_mode) {
			// 采用另一 context 注入的实例:按属性辨认它是 layout 还是兜底
			try { _mode = (tab.GetAttributeString(ATTR_FALLBACK, "") === "1") ? "fallback" : "layout"; } catch (_) { _mode = "layout"; }
			_instTicks = 0;
		}
		_tab = tab;
		return tab;
	}

	/* ---------- 同步 ---------- */

	function syncTab(tab) {
		// 心跳监督:layout 模式下 Tab 脚本连续 6 tick 无心跳 → 判死,降级重建
		if (_mode === "layout") {
			let alive = "";
			try { alive = tab.GetAttributeString(ATTR_ALIVE, ""); } catch (_) {}
			_instTicks++;
			if (!alive && _instTicks > 6 && !_degraded) {
				log("layout tab has no heartbeat, degrading to fallback");
				_degraded = true;
				_mode = null;
				_tab = null;
				try { tab.DeleteAsync(0); } catch (_) {}
				return;
			}
		}

		// 会话层收敛:#Hud 属性是跨 context 的会话缓存,另一 context 写入的新配置在此采纳
		let hudRaw = "";
		try {
			const gr = getGlobalRoot();
			const hud = gr ? gr.FindChildTraverse("Hud") : null;
			if (hud) hudRaw = hud.GetAttributeString(ATTR_CFG, "");
		} catch (_) {}
		if (hudRaw && hudRaw !== _lastHudRaw) {
			_lastHudRaw = hudRaw;
			try {
				const obj = JSON.parse(hudRaw);
				if (JSON.stringify(canonical(obj)) !== JSON.stringify(cfg)) {
					cfg = canonical(obj);
					persistHook();
					log("cfg adopted from hud attr (other context)");
				}
			} catch (e) {}
		}

		// 采纳 Tab 写回的配置
		let raw = "";
		try { raw = tab.GetAttributeString(ATTR_CFG, ""); } catch (_) {}
		if (raw && raw !== _lastTabRaw) {
			_lastTabRaw = raw; // 先记账再解析:坏 JSON 不重试、不刷屏
			try {
				cfg = canonical(JSON.parse(raw));
				saveSessionCfg();
				persistHook();
				log("cfg adopted from tab");
			} catch (e) {
				log("tab cfg parse failed");
			}
		}

		// 宿主侧配置变化(如桥持久层回载)推给 Tab;双方一致时不写,避免 churn
		const hostJson = JSON.stringify(cfg);
		if (raw !== hostJson) {
			try { tab.SetAttributeString(ATTR_CFG, hostJson); } catch (_) {}
		}

		// 桥状态下行
		const bi = bridgeInfo();
		try { tab.SetAttributeString(ATTR_BUILDID, bi.buildId || ""); } catch (_) {}
		try { tab.SetAttributeString(ATTR_STATUS, bi.text || "未连接"); } catch (_) {}
		if (_mode === "fallback") updateFallbackFooter(bi);
	}

	function tick() {
		_attempts++;
		const tab = ensureTab();
		if (tab) {
			syncTab(tab);
		} else if (_attempts <= 3 || _attempts % 60 === 0) {
			log("settings container not found yet (attempt " + _attempts + ")");
		}
		try { $.Schedule(1.0, tick); } catch (_) {}
	}

	/* ---------- 启动 ---------- */

	function init() {
		let ctxId = "?";
		try { ctxId = ($.GetContextPanel() && $.GetContextPanel().id) || "?"; } catch (_) {}
		cfg = loadSessionCfg();
		log("init (context=" + ctxId + ") cfg=" + JSON.stringify(cfg).slice(0, 120));
		saveSessionCfg();
		try { $.Schedule(1.0, tick); } catch (_) { tick(); }
	}

	try { $.Schedule(0, init); } catch (_) { init(); }

	if (typeof globalThis !== "undefined") {
		globalThis.LCTSettings = {
			getCfg: function () { return cfg; },
			applyConfig: applyConfig,
			DEFAULTS: DEFAULTS
		};
	}
})();
