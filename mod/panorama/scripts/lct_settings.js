(function () {
	"use strict";

	const CONVAR_NAME = "lct_cfg_v3";
	const CONVAR_FLAGS = 64; // FCVAR_ARCHIVE (1<<6) — 持久化到 cfg 文件
	const TAG = "[LCT][Settings]";

	const DEFAULTS = {
		enabled: true,
		targetLanguage: "zh-Hans",
		displayMode: "bilingual",
		outgoing: "off",
		outgoingTarget: "en",
		force: false,
		translateOwn: true,
		timeoutMs: 8000,
		order: ["edge", "mymemory"],
		openai: { key: "", base: "https://api.openai.com/v1", model: "gpt-4o-mini" }
	};

	let _convarRegistered = false;
	let _injected = false;
	let _attempts = 0;
	const MAX_ATTEMPTS = 1800; // 1s x 1800 = 30 分钟，覆盖玩家任何时候按 Esc

	function log(msg) {
		try { $.Msg(TAG + " " + msg); } catch (_) {}
	}

	function registerConvarOnce() {
		if (_convarRegistered) return;
		try {
			if (typeof Convars !== "undefined" && Convars.RegisterConVar) {
				Convars.RegisterConVar(CONVAR_NAME, "{}", CONVAR_FLAGS, "BabelTower Community v3 settings");
				_convarRegistered = true;
				log("Convar registered: " + CONVAR_NAME + " flags=" + CONVAR_FLAGS);
			}
		} catch (e) {
			log("Convar registration failed: " + (e && e.message ? e.message : e));
		}
	}

	// 读取配置：优先 convar，回退面板属性
	function loadConfig() {
		registerConvarOnce();
		let raw = "";
		try {
			if (typeof Convars !== "undefined" && Convars.GetStr) {
				raw = Convars.GetStr(CONVAR_NAME, "");
				if (raw) log("Load from convar, len=" + raw.length);
			}
		} catch (_) {}
		if (!raw) {
			try {
				const root = $.GetContextPanel();
				raw = root.GetAttributeString(CONVAR_NAME, "");
				if (raw) log("Load from panel attr, len=" + raw.length);
			} catch (_) {}
		}
		let cfg = Object.assign({}, DEFAULTS);
		if (raw) {
			try { Object.assign(cfg, JSON.parse(raw)); } catch (e) { log("Parse failed: " + (e && e.message ? e.message : e)); }
		}
		return cfg;
	}

	// 写入配置：幂等，双写面板属性 + convar
	function saveConfig(cfg) {
		registerConvarOnce();
		const json = JSON.stringify(cfg);
		try {
			const root = $.GetContextPanel();
			if (root) {
				const cur = root.GetAttributeString ? root.GetAttributeString(CONVAR_NAME, "") : "";
				if (cur !== json) {
					root.SetAttributeString(CONVAR_NAME, json);
					log("Saved to root panel attr");
				}
				const hud = root.FindChildTraverse("Hud");
				if (hud && hud.SetAttributeString) {
					hud.SetAttributeString(CONVAR_NAME, json);
					log("Saved to Hud panel attr");
				}
			}
		} catch (e) { log("Panel attr write failed: " + (e && e.message ? e.message : e)); }
		try {
			if (typeof Convars !== "undefined" && Convars.SetValue) {
				const cur = Convars.GetStr ? Convars.GetStr(CONVAR_NAME, "") : "";
				if (cur !== json) {
					Convars.SetValue(CONVAR_NAME, json);
					log("Saved to convar");
				}
			}
		} catch (e) { log("Convar write failed: " + (e && e.message ? e.message : e)); }
	}

	// 从当前 context 一路向上走到 Panorama 全局根。
	// Escape Menu 不在聊天面板子树里，必须从全局根往下搜才找得到。
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

	// 注入目标必须是容器类面板；Label/Image 里塞子面板会显示异常
	function isContainerPanel(p) {
		try {
			const t = p.paneltype;
			if (t === "Label" || t === "Image" || t === "TextEntry") return false;
		} catch (_) {}
		return true;
	}

	// 单个样式属性失败不能打断整个注入（实证:font-weight:600 会被 JS 样式校验拒绝）
	function safeStyle(p, prop, value) {
		try { p.style[prop] = value; } catch (e) { log("style " + prop + " rejected: " + value); }
	}

	function findSettingsContainer(root) {
		// 策略 1：ID 候选 —— "settings"(小写)是实机 DFS 实证命中的真实 id，放第一位
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
		// 策略 2：类名搜索
		const classes = ["SettingsList", "SettingsContainer", "SettingsDialog"];
		for (let i = 0; i < classes.length; i++) {
			try {
				const arr = root.FindChildrenWithClassTraverse(classes[i]);
				if (arr && arr.length > 0 && isContainerPanel(arr[0])) return arr[0];
			} catch (_) {}
		}
		// 策略 3：DFS 找 id 里带 "settings" 的最深容器面板（每 5 轮做一次，避免卡顿）
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

	// convar 真实状态(写进注入面板,不依赖控制台 —— con_logfile 已实证不抓 PanoramaScript 行)
	// v2: 枚举 API 表面 —— 区分"Convars 对象不存在"和"存在但方法名不同"
	function convarStatusText() {
		try {
			if (typeof Convars === "undefined") return "MISS";
			let keys = "keys-err";
			try { keys = Object.keys(Convars).slice(0, 14).join(","); } catch (e2) {}
			let gs = "no-get";
			try {
				if (Convars.GetStr) {
					const v = Convars.GetStr(CONVAR_NAME, "");
					gs = (v && v !== "") ? ("len=" + v.length) : "empty";
				}
			} catch (e3) { gs = "gs-err"; }
			return "OBJ[" + keys + "] get=" + gs;
		} catch (e) {
			return "ERR:" + (e && e.message ? e.message : e);
		}
	}

	// 全景 API 普查:这引擎里还有哪些可能当持久化用的全局对象
	function censusText() {
		const names = ["LocalStorage", "GameUI", "SteamAPI", "SteamFriendsUI", "FriendsAPI"];
		const parts = [];
		for (let i = 0; i < names.length; i++) {
			let t = "?";
			try { t = typeof $[names[i]]; } catch (_) { t = "err"; }
			parts.push(names[i] + "=" + t);
		}
		return parts.join(" ");
	}

	function injectSettingsTab() {
		if (_injected) return true;
		const root = getGlobalRoot();
		if (!root) return false;
		// 跨 context 去重：chat / hudchat 两个脚本实例都会跑这段，
		// 谁先注入成功，另一个通过面板树就能看到，直接收手。
		try {
			if (root.FindChildTraverse("LCTSettingsTabInstance")) {
				_injected = true;
				log("Tab already present (another context injected it)");
				return true;
			}
		} catch (_) {}
		const container = findSettingsContainer(root);
		if (!container) return false;
		try {
			// 不用 BLoadLayoutSnippet：snippet 只在本 context 的 layout 里有效，
			// 注入到 Escape Menu 树后样式/定义都不可靠。直接 JS 建 + 内联样式。
			const tab = $.CreatePanel("Panel", container, "LCTSettingsTabInstance");
			if (!tab) return false;
			safeStyle(tab, "flowChildren", "down");
			safeStyle(tab, "padding", "12px");
			safeStyle(tab, "backgroundColor", "rgba(20, 26, 40, 0.85)");
			safeStyle(tab, "border", "1px solid #6ea8ff");
			safeStyle(tab, "borderRadius", "6px");
			safeStyle(tab, "marginTop", "8px");
			const title = $.CreatePanel("Label", tab, "LCTSettingsTabTitle");
			title.text = "BabelTower v3 — Settings Tab Injected OK";
			safeStyle(title, "color", "#6ea8ff");
			safeStyle(title, "fontSize", "16px");
			safeStyle(title, "fontWeight", "bold");
			const hint = $.CreatePanel("Label", tab, "LCTSettingsTabHint");
			hint.text = "If you see this, Escape Menu injection works.";
			safeStyle(hint, "color", "#9aa3b2");
			safeStyle(hint, "fontSize", "13px");
			const status = $.CreatePanel("Label", tab, "LCTSettingsTabStatus");
			let attrLen = 0;
			try {
				const a = $.GetContextPanel().GetAttributeString(CONVAR_NAME, "");
				attrLen = a ? a.length : 0;
			} catch (_) {}
			status.text = "cv:" + convarStatusText() + " | attr:" + attrLen;
			safeStyle(status, "color", "#c8d2e0");
			safeStyle(status, "fontSize", "12px");
			safeStyle(status, "marginTop", "4px");
			const census = $.CreatePanel("Label", tab, "LCTSettingsTabCensus");
			census.text = censusText();
			safeStyle(census, "color", "#8a94a6");
			safeStyle(census, "fontSize", "11px");
			_injected = true;
			log("Injected LCTSettingsTab into id=" + (container.id || "?"));
			return true;
		} catch (e) {
			log("Inject failed: " + (e && e.message ? e.message : e));
			return false;
		}
	}

	function pump() {
		if (_injected) return;
		_attempts++;
		const ok = injectSettingsTab();
		if (!ok && (_attempts <= 3 || _attempts % 60 === 0)) {
			log("Settings container not found yet (attempt " + _attempts + ")");
		}
		if (!_injected && _attempts < MAX_ATTEMPTS) {
			try { $.Schedule(1.0, pump); } catch (_) {}
		}
	}

	function init() {
		log("Init start (context=" + ($.GetContextPanel() ? ($.GetContextPanel().id || "?") : "null") + ")");
		const cfg = loadConfig();
		log("Loaded cfg: " + JSON.stringify(cfg).slice(0, 200));
		saveConfig(cfg);
		pump();
		log("Init done");
	}

	try { $.Schedule(0, init); } catch (_) { init(); }

	if (typeof globalThis !== "undefined") {
		globalThis.LCTSettings = { loadConfig, saveConfig, DEFAULTS, CONVAR_NAME };
	}
})();
