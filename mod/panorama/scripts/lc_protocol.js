(function () {
	"use strict";

	/*
	 * BabelTower v3 — 协议客户端(docs/PROTOCOL.md)
	 *
	 * 通道:
	 *   上行  panel.SetURL(PAGE?v=3#q=encodeURIComponent(JSON))   —— 一次请求一次导航,单槽串行
	 *   下行  $.RegisterEventHandler("HTMLTitle", panel, ...)     —— LCT3A/R/C/E 四帧
	 * 面板:chat.xml / hudchat.xml 声明的隐藏 CitadelHTMLPanel(id=LCTNet,probe 实证形态)
	 *
	 * 双 context(chat/hudchat)并行加载本文件,用 #Hud 属性选举:
	 *   lct_proto_owner / lct_proto_beat —— claim 后下一 tick 确认才上任,防止同帧双 claim。
	 *   只有 primary 驱动面板;落选者与 primary 通过同一组状态属性对外表现一致。
	 *
	 * 状态机(§9):BOOT → hello(4s×3,退避 1/2s) → READY;×3 → OFFLINE(2/4/8/16/30s 退避,
	 *   hello 存活帧即恢复);tr 连续 3 次超时 → OFFLINE。队列 64,元素 TTL 30s。
	 *
	 * 对外契约(globalThis.LCTBridge,消费方 = 未来的消息钩子 / 诊断):
	 *   statusInfo() -> {text, buildId}          状态文本(已连接/失败/错误 前缀驱动状态灯)
	 *   persistCfg(jsonString)                    配置变更落盘(store.put "cfg",仅 primary)
	 *   translate(items, opts, cb)                翻译,cb({ok,...}) 单槽排队,仅 primary 服务
	 *   isPrimary() -> bool
	 *   getCfg() -> object                        当前会话配置(canonical 后)
	 *
	 * 配置所有权:本文件持有 canonical 配置,发布在共享面板属性 lct_cfg(#Hud/root);
	 * 设置窗口(hud_escape_menu.xml 的 lct_settings_ui.js)直读直写该属性,
	 * cfgWatchTick 监听外部变更 → 采纳 + store.put。状态文本/构建号同样发布在
	 * 共享属性 lct_status / lct_buildid,跨 context 只走属性,不走 JS 全局。
	 */

	const TAG = "[LCT][Proto]";
	const PAGE_URL = "https://c1375rick.github.io/babeltower-community/app/d2a3dde88d180e5b/index.html";
	const PROTO_V = 3;
	const PREFIX = "LCT3";
	const PANEL_ID = "LCTNet";

	const OWNER_ATTR = "lct_proto_owner";
	const BEAT_ATTR = "lct_proto_beat";
	const STATUS_ATTR = "lct_status";
	const BUILDID_ATTR = "lct_buildid";
	// 配置通道(共享面板 #Hud/root 属性):设置窗口(lct_settings_ui.js,Escape context)
	// 与本文件的唯一配置接口。本文件持有配置所有权:boot 发布默认值,store 回载后覆盖,
	// 监听外部变更 → 采纳 + store.put 落盘。见 docs/PROTOCOL.md §10。
	const CFG_ATTR = "lct_cfg";

	const HELLO_TIMEOUT = 4;      // §8
	const HELLO_ATTEMPTS = 3;     // §9 超时×3 → OFFLINE
	const TR_TIMEOUT = 8;         // §8
	const CHUNK_TIMEOUT = 3;      // §8 每片
	const STORE_TIMEOUT = 8;
	const QUEUE_MAX = 64;         // §9
	const QUEUE_TTL = 30;         // §9
	const ELECT_PERIOD = 1.0;
	const BEAT_STALE = 5;

	/* ---------- 状态 ---------- */

	let myTag = "";
	let elect = "idle";           // idle | claimed | primary
	let state = "BOOT";           // BOOT | READY | OFFLINE(仅 primary 有意义)

	let panel = null;
	let panelBound = false;
	let docLoaded = false;
	let waitingLoad = false;

	let lastSeq = 0;
	let tok = 0;
	let gen = 0;                  // bump 使所有 later() 链失效(落选时)
	let reqCounter = 0;

	let buildId = "";
	let statusText = "连接中…";
	let storeOk = true;
	let channelRestricted = false;
	let protoDead = false;

	let active = null;            // 单槽:hello | tr | store.get | store.put
	let asm = null;               // 分片重组 {id, n, parts, expect}
	let queue = [];               // tr + store 队列
	let trTimeouts = 0;           // 连续 tr 超时计数
	let helloTries = 0;
	let offlineWait = 2;

	let pendingPut = null;        // 防抖中的 store.put 载荷(对象)
	let putScheduled = false;
	let bootGetDone = false;

	// 配置所有权(canonical 与旧 lct_settings.js 宿主一致,键序稳定)
	const CFG_DEFAULTS = {
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
	let cfgObj = null;            // 当前会话配置(canonical 后对象)
	let lastCfgRaw = "";          // 上次在 CFG_ATTR 上看到的原文(外部变更检测)

	function canonicalCfg(obj) {
		const c = Object.assign({}, CFG_DEFAULTS);
		if (obj && typeof obj === "object") {
			for (const k in obj) {
				if (Object.prototype.hasOwnProperty.call(obj, k) && k !== "openai") {
					c[k] = obj[k];
				}
			}
		}
		return c;
	}

	// 外部入口(store 回载):采纳 + 记账 + 发布到共享面板(UI 据此渲染)
	function applyConfig(obj) {
		cfgObj = canonicalCfg(obj);
		try { lastCfgRaw = JSON.stringify(cfgObj); } catch (e0) {}
		publishCfgAttr();
		try { log("cfg applied: " + (lastCfgRaw || "").slice(0, 120)); } catch (e1) {}
	}

	function publishCfgAttr() {
		try {
			const cp = claimPanel();
			if (!cp) return;
			const raw = JSON.stringify(cfgObj || CFG_DEFAULTS);
			try {
				if (cp.GetAttributeString(CFG_ATTR, "") !== raw) cp.SetAttributeString(CFG_ATTR, raw);
			} catch (e0) {}
		} catch (e) {}
	}

	// 共享面板上的配置被外部(设置窗口)改动 → 采纳 + 落盘。
	// 首次观察(prev === "")不落盘:那可能是自己 boot 刚写的默认值或已持久化的回载。
	function cfgWatchTick(cp) {
		try {
			const raw = cp.GetAttributeString(CFG_ATTR, "");
			if (!raw || raw === lastCfgRaw) return;
			const first = lastCfgRaw === "";
			lastCfgRaw = raw;
			const obj = JSON.parse(raw);
			cfgObj = canonicalCfg(obj);
			if (!first) persistCfg(raw);
		} catch (e) { /* 坏 JSON:记账已前移,不重试不刷屏 */ }
	}

	function log(msg) {
		try { $.Msg(TAG + " " + msg); } catch (e) {}
	}
	function ts() {
		try { return Math.floor($.Time() * 1000); } catch (e) { return 0; }
	}
	function later(sec, fn) {
		const g = gen;
		try {
			$.Schedule(sec, function () { if (g === gen) fn(); });
		} catch (e) {}
	}
	function safeCb(cb, resp) {
		try { if (typeof cb === "function") cb(resp); } catch (e) { log("cb threw: " + (e && e.message ? e.message : e)); }
	}

	/* ---------- 面板工具(probe 实证形态) ---------- */

	function getGlobalRoot() {
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

	function claimPanel() {
		try {
			const root = getGlobalRoot();
			if (!root) return null;
			const hud = root.FindChildTraverse("Hud");
			return hud || root;
		} catch (e) {
			return null;
		}
	}

	function isValidPanel(p) {
		try { return !!(p && (!p.IsValid || p.IsValid())); } catch (e) { return false; }
	}

	// probe 实证:HTMLTitle 事件的参数形状不定,扫描参数提取标题文本
	function pickText(args) {
		for (let i = 0; i < args.length; i++) {
			const v = args[i];
			if (v == null) continue;
			if (typeof v === "string") {
				if (v) return v;
				continue;
			}
			try { if (typeof v.title === "string" && v.title) return v.title; } catch (e) {}
			try { if (typeof v.text === "string" && v.text) return v.text; } catch (e2) {}
		}
		return "";
	}

	function ensurePanel() {
		if (panel) {
			let ok = false;
			try { ok = panel.IsValid() && typeof panel.SetURL === "function"; } catch (e) { ok = false; }
			if (ok) return panel;
			panel = null;
			panelBound = false;
		}
		const root = getGlobalRoot();
		if (!root) return null;
		let p = null;
		try { p = root.FindChildTraverse(PANEL_ID); } catch (e) {}
		if (!isValidPanel(p)) {
			// XML 声明缺失时的兜底:JS 直接创建(probe 只验证过 XML 声明,此路尽力而为)
			try {
				const cp = claimPanel();
				p = $.CreatePanel("CitadelHTMLPanel", cp, PANEL_ID);
				if (p) {
					try { p.SetAttributeString("class", "LCTNet"); } catch (e0) {}
					const style = p.style;
					const safe = function (k, v) { try { style[k] = v; } catch (e1) {} };
					safe("width", "4px");
					safe("height", "4px");
					safe("opacity", "0.01");
					safe("visibility", "visible");
					try { p.hittest = false; } catch (e2) {}
					try { p.acceptsfocus = false; } catch (e3) {}
				}
			} catch (e4) { p = null; }
		}
		if (!isValidPanel(p) || typeof p.SetURL !== "function") {
			if (p) log("panel found but SetURL missing");
			return null;
		}
		if (p !== panel) {
			panel = p;
			panelBound = false;
		}
		bindPanel();
		return panel;
	}

	function bindPanel() {
		if (panelBound || !panel) return;
		try {
			$.RegisterEventHandler("HTMLTitle", panel, function (a, b, c, d) {
				onTitle(pickText([a, b, c, d]));
			});
		} catch (e) {
			log("RegisterEventHandler HTMLTitle failed: " + (e && e.message ? e.message : e));
			return;
		}
		try {
			$.RegisterEventHandler("HTMLContentLoaded", panel, function () {
				docLoaded = true;
				if (waitingLoad) {
					waitingLoad = false;
					if (elect === "primary" && state === "BOOT" && !active) helloAttempt();
				}
			});
		} catch (e2) {}
		panelBound = true;
		lastSeq = 0;
		log("panel bound (HTMLTitle + HTMLContentLoaded)");
	}

	/* ---------- 导航 ---------- */

	function buildUrl(req) {
		return PAGE_URL + "?v=" + PROTO_V + "#q=" + encodeURIComponent(JSON.stringify(req));
	}

	function navigate(req) {
		if (!ensurePanel()) return false;
		try {
			panel.SetURL(buildUrl(req));
			return true;
		} catch (e) {
			log("SetURL threw: " + (e && e.message ? e.message : e));
			return false;
		}
	}

	function armTimeout(sec, token, fn) {
		try {
			$.Schedule(sec, function () {
				if (active && active.token === token && !active.done) fn();
			});
		} catch (e) {}
	}

	/* ---------- 状态与属性 ---------- */

	function setStatus(override) {
		if (override != null && override !== "") { statusText = override; return; }
		if (state === "READY") {
			statusText = "已连接 build=" + String(buildId || "").slice(0, 8);
			if (!storeOk) statusText += " · 设置不跨启动保存";
			else if (channelRestricted) statusText += " · 页面通道受限";
		} else if (state === "OFFLINE") {
			statusText = "失败: 桥页面不可达";
		} else {
			statusText = "连接中…";
		}
	}

	function persistStatusAttrs() {
		try {
			const cp = claimPanel();
			if (cp) {
				cp.SetAttributeString(STATUS_ATTR, statusText);
				cp.SetAttributeString(BUILDID_ATTR, String(buildId || "").slice(0, 8));
			}
		} catch (e) {}
	}

	/* ---------- 诊断信标(临时,稳定后移除) ----------
	 * con_logfile 实证抓不到 PanoramaScript 行,诊断只能靠画面自报。
	 * 只挂 #Hud(不再兜底全局根):信标缺席 = chat/hudchat shadow 没加载(本文件没跑)。
	 * 字段:br=选举/状态@buildId q=队列深度 st=状态文本
	 */
	let beacon = null;
	let beaconText = null;

	function adoptBeacon(exist) {
		const t = exist.FindChildTraverse("LCTBeaconText");
		if (t) {
			beacon = exist;
			beaconText = t;
			return true;
		}
		return false;
	}

	function ensureBeacon() {
		if (beacon) {
			let ok = true;
			try { ok = beacon.IsValid(); } catch (e) { ok = false; }
			if (ok) return true;
			beacon = null;
			beaconText = null;
		}
		try {
			const hud = getGlobalRoot().FindChildTraverse("Hud");
			if (!hud) return false;
			// 跨 context 去重:另一 context 已建则直接采用
			try {
				const exist = hud.FindChildTraverse("LCTBeacon");
				if (exist && adoptBeacon(exist)) return true;
			} catch (e0) {}
			const b = $.CreatePanel("Panel", hud, "LCTBeacon");
			if (!b) return false;
			const safe = function (p, k, v) { try { p.style[k] = v; } catch (eS) {} };
			safe(b, "horizontalAlign", "left");
			safe(b, "verticalAlign", "bottom");
			safe(b, "margin", "12px");
			safe(b, "backgroundColor", "rgba(8, 12, 20, 0.75)");
			safe(b, "borderRadius", "4px");
			safe(b, "padding", "4px 8px");
			try { b.hittest = false; } catch (e1) {}
			try { b.acceptsfocus = false; } catch (e2) {}
			const t = $.CreatePanel("Label", b, "LCTBeaconText");
			safe(t, "color", "#9fe0a8");
			safe(t, "fontSize", "11px");
			try { t.hittest = false; } catch (e3) {}
			beacon = b;
			beaconText = t;
			return true;
		} catch (e) {
			return false;
		}
	}

	function updateBeacon() {
		try {
			if (!ensureBeacon() || !beaconText) return;
			// 文本只有 primary 写:双 context 并存时避免 standby 用自己的选举态来回覆盖
			if (elect !== "primary") return;
			beaconText.text = "LCT br=" + elect + "/" + state +
				(buildId ? ("@" + String(buildId).slice(0, 8)) : "") +
				" q=" + queue.length + " st=" + statusText;
		} catch (e) {}
	}

	/* ---------- 选举(双 context 并行,claim → 下一 tick 确认) ---------- */

	function electTick() {
		try {
			const cp = claimPanel();
			if (!cp) {
				if (elect === "primary") stopPrimary("claim panel gone");
			} else {
				let owner = "";
				let beat = 0;
				try { owner = cp.GetAttributeString(OWNER_ATTR, ""); } catch (e) {}
				try { beat = parseFloat(cp.GetAttributeString(BEAT_ATTR, "0")) || 0; } catch (e2) {}
				const now = $.Time();
				if (elect === "primary") {
					if (owner === myTag) {
						try { cp.SetAttributeString(BEAT_ATTR, String(now)); } catch (e3) {}
					} else {
						stopPrimary("owner changed: " + owner);
					}
				} else if (elect === "claimed") {
					if (owner === myTag) {
						becomePrimary();
					} else {
						elect = "idle"; // 同帧竞选落败,下轮再说
					}
				} else {
					if (owner === "" || (now - beat) > BEAT_STALE) {
						try {
							cp.SetAttributeString(OWNER_ATTR, myTag);
							cp.SetAttributeString(BEAT_ATTR, String(now));
							elect = "claimed";
							log("claimed, confirming next tick");
						} catch (e4) {}
					}
				}
			}
		} catch (eX) {}
		// 配置监听(双 context 都跑;只有 primary 会真正落盘)+ 状态/信标刷新
		try {
			const cpCfg = claimPanel();
			if (cpCfg) cfgWatchTick(cpCfg);
		} catch (eC) {}
		if (elect === "primary") persistStatusAttrs(); // 供设置窗口 footer 跨 context 直读
		updateBeacon();
		$.Schedule(ELECT_PERIOD, electTick);
	}

	function becomePrimary() {
		elect = "primary";
		state = "BOOT";
		helloTries = 0;
		trTimeouts = 0;
		protoDead = false;
		asm = null;
		offlineWait = 2;
		setStatus(null);
		persistStatusAttrs();
		log("primary elected: " + myTag);
		later(0.3, warmup);
	}

	function stopPrimary(reason) {
		log("stop primary: " + reason);
		elect = "idle";
		gen++; // 杀掉 hello 退避 / OFFLINE 退避 / put 防抖等所有 later 链
		if (active && !active.done) {
			active.done = true;
			safeCb(active.cb, { ok: false, code: "OFFLINE", detail: "primary lost", retryable: true });
		}
		active = null;
		asm = null;
		waitingLoad = false;
		putScheduled = false;
		state = "BOOT";
		setStatus("未连接");
	}

	/* ---------- BOOT / OFFLINE:hello ---------- */

	function warmup() {
		if (elect !== "primary") return;
		if (!ensurePanel()) {
			setStatus("错误: 协议面板缺失");
			persistStatusAttrs();
			panelRetryLoop();
			return;
		}
		if (docLoaded) { helloAttempt(); return; }
		waitingLoad = true;
		let navOk = false;
		try {
			panel.SetURL(PAGE_URL + "?v=" + PROTO_V); // §11.1 预热:无载荷导航
			navOk = true;
		} catch (e) {
			log("warmup SetURL threw");
		}
		if (!navOk) {
			waitingLoad = false;
			helloAttempt();
			return;
		}
		// 兜底:4s 内没等到 contentLoaded(事件名差异等)也直接 hello
		$.Schedule(4, function () {
			if (waitingLoad) {
				waitingLoad = false;
				if (elect === "primary" && !active) helloAttempt();
			}
		});
	}

	function panelRetryLoop() {
		later(10, function () { // §9 DEAD 分支:每 10s 重试,不刷屏
			if (elect !== "primary") return;
			if (active) return;
			if (state !== "BOOT" && state !== "OFFLINE") return;
			if (ensurePanel()) helloAttempt();
			else panelRetryLoop();
		});
	}

	function helloAttempt() {
		if (elect !== "primary") return;
		if (active) return;
		if (!ensurePanel()) { panelRetryLoop(); return; }
		const id = nextId();
		active = { kind: "hello", id: id, token: ++tok, done: false, cb: null };
		setStatus("连接中…");
		persistStatusAttrs();
		if (!navigate({ v: PROTO_V, id: id, op: "hello", ts: ts(), r: helloTries })) {
			helloFailed();
			return;
		}
		armTimeout(HELLO_TIMEOUT, active.token, helloFailed);
	}

	function helloFailed() {
		if (!active || active.kind !== "hello" || active.done) return;
		active = null;
		helloTries += 1;
		if (state === "BOOT") {
			if (helloTries < HELLO_ATTEMPTS) {
				log("hello timeout, retry " + helloTries + "/" + (HELLO_ATTEMPTS - 1));
				later(Math.pow(2, helloTries - 1), helloAttempt); // 1s / 2s
			} else {
				enterOffline();
			}
		} else {
			scheduleOfflineRetry();
		}
	}

	function enterOffline() {
		if (state === "OFFLINE") return;
		state = "OFFLINE";
		setStatus(null);
		persistStatusAttrs();
		log("OFFLINE (wait " + offlineWait + "s)");
		scheduleOfflineRetry();
	}

	function scheduleOfflineRetry() {
		later(offlineWait, function () {
			offlineWait = Math.min(offlineWait * 2, 30); // §9: 2/4/8/16/30
			if (elect === "primary" && state === "OFFLINE" && !active) helloAttempt();
		});
	}

	function onAlive(f) {
		// LCT3A 是握手帧:无条件接受并重置 seq 基线(文档可能刚重载,页内 seq 从 1 重新计数)
		lastSeq = f.seq;
		buildId = f.buildId || buildId;
		measureChunk(f.pad);
		log("alive: build=" + buildId + " pad=" + (f.pad || "").length + " chunk=" + chunkSize());
		const wasHello = active && active.kind === "hello";
		if (wasHello) { active.done = true; active = null; }
		if (state !== "READY") {
			state = "READY";
			offlineWait = 2;
			trTimeouts = 0;
			setStatus(null);
			persistStatusAttrs();
			bootStoreGet();
			pumpQueue();
		}
	}

	/* ---------- §4.1 长度自校准 ---------- */

	let _chunkSize = 1200;
	function chunkSize() { return _chunkSize; }
	function measureChunk(pad) {
		const n = (pad || "").length;
		if (n >= 1500) {
			_chunkSize = 1200;
			channelRestricted = false;
		} else if (n >= 900) {
			_chunkSize = 600;
			channelRestricted = true;
		} else {
			_chunkSize = 200;
			channelRestricted = true;
		}
	}

	/* ---------- 队列与单槽 ---------- */

	function nextId() {
		reqCounter += 1;
		return "r" + reqCounter.toString(36) + "." + Math.floor($.Time() % 100000);
	}

	function enqueue(item) {
		if (queue.length >= QUEUE_MAX) {
			// §9:溢出丢最旧的 tr;store 类请求不丢
			let idx = -1;
			for (let i = 0; i < queue.length; i++) {
				if (queue[i].kind === "tr") { idx = i; break; }
			}
			if (idx >= 0) {
				const dropped = queue.splice(idx, 1)[0];
				safeCb(dropped.cb, { ok: false, code: "DROPPED", detail: "queue full", retryable: false });
			} else {
				return; // 全是 store 请求:拒绝新的
			}
		}
		queue.push(item);
	}

	function pumpQueue() {
		if (elect !== "primary" || active || state !== "READY") return;
		while (queue.length > 0) {
			const item = queue.shift();
			if (item.kind === "tr" && ($.Time() - item.enqueuedAt) > QUEUE_TTL) {
				safeCb(item.cb, { ok: false, code: "TIMEOUT", detail: "ttl", retryable: false });
				continue;
			}
			startItem(item);
			return;
		}
	}

	function trCfg() {
		const c = { order: ["edge", "mymemory"], timeoutMs: 8000 };
		try {
			const cfg = cfgObj || CFG_DEFAULTS;
			if (cfg) {
				if (cfg.order && cfg.order.length) c.order = cfg.order;
				if (cfg.timeoutMs) c.timeoutMs = cfg.timeoutMs;
			}
		} catch (e) {}
		return c;
	}

	function startItem(item) {
		item.id = nextId();
		item.token = ++tok;
		item.done = false;
		active = item;
		let req = null;
		if (item.kind === "tr") {
			req = { v: PROTO_V, id: item.id, op: "tr", ts: ts(), r: item.r || 0, cfg: trCfg(), d: item.d };
		} else if (item.kind === "store.get") {
			req = { v: PROTO_V, id: item.id, op: "store.get", ts: ts(), k: item.k };
		} else {
			req = { v: PROTO_V, id: item.id, op: "store.put", ts: ts(), k: item.k, val: item.val };
		}
		if (!navigate(req)) {
			failActive(item, "NAV_FAIL", "seturl", true);
			return;
		}
		armTimeout(item.kind === "tr" ? TR_TIMEOUT : STORE_TIMEOUT, item.token, function () { onTimeout(item); });
	}

	function onTimeout(item) {
		if (active !== item || item.done) return;
		if (item.stage === "chunks") {
			// §8:分片收齐 3s/片,不重试
			failActive(item, "TIMEOUT", "chunk", false);
			return;
		}
		if (item.kind === "tr" && (item.r || 0) === 0) {
			// §8:tr 重试一次(同 id,请求体 r=1 → hash 变化确保 hashchange 触发)
			item.r = 1;
			item.token = ++tok;
			if (!navigate({ v: PROTO_V, id: item.id, op: "tr", ts: ts(), r: 1, cfg: trCfg(), d: item.d })) {
				failActive(item, "NAV_FAIL", "seturl", true);
				return;
			}
			armTimeout(TR_TIMEOUT, item.token, function () { onTimeout(item); });
			return;
		}
		failActive(item, "TIMEOUT", "request", false);
	}

	function failActive(item, code, detail, retryable) {
		if (active !== item || item.done) return;
		item.done = true;
		active = null;
		if (asm && asm.id === item.id) asm = null;
		safeCb(item.cb, { ok: false, code: code, detail: detail, retryable: !!retryable });
		if (item.kind === "tr") {
			if (code === "TIMEOUT") trTimeouts += 1;
			if (trTimeouts >= 3) { // §9:连续 3 次超时 → OFFLINE
				trTimeouts = 0;
				enterOffline();
				return;
			}
		}
		pumpQueue();
	}

	function completeActive(item, obj) {
		if (active !== item || item.done) return;
		item.done = true;
		active = null;
		if (asm && asm.id === item.id) asm = null;
		if (item.kind === "tr") trTimeouts = 0;
		safeCb(item.cb, obj);
		pumpQueue();
	}

	function finishActiveWithJson(item, text) {
		let obj = null;
		try { obj = JSON.parse(text); } catch (e) {
			failActive(item, "BAD_RESPONSE", "json", false);
			return;
		}
		if (!obj || typeof obj !== "object") {
			failActive(item, "BAD_RESPONSE", "shape", false);
			return;
		}
		if (obj.ok === false) {
			const code = String(obj.code || "UNKNOWN");
			if (code === "PROTO_MISMATCH") {
				protoDead = true;
				setStatus("错误: 协议版本不符(请更新模组)");
				persistStatusAttrs();
			}
			failActive(item, code, obj.detail, obj.retryable);
			return;
		}
		completeActive(item, obj);
	}

	/* ---------- §4.2 分片重组(接收方主动拉) ---------- */

	function onChunkFrame(id, i, n, chunk) {
		if (!active || active.id !== id || active.done) return;
		if (typeof n !== "number" || n < 1 || n > 6) return;
		if (typeof i !== "number" || i < 0 || i >= n) return;
		if (!asm || asm.id !== id) {
			if (i !== 0) return; // 中途加入的片 → 丢弃
			asm = { id: id, n: n, parts: {}, expect: 0 };
			active.stage = "chunks";
		}
		if (i !== asm.expect) return; // 重复/迟到片:不推进、不重置超时
		asm.parts[i] = chunk;
		asm.expect += 1;
		if (asm.expect >= asm.n) {
			let text = "";
			for (let k = 0; k < asm.n; k++) text += (asm.parts[k] || "");
			const item = active;
			asm = null;
			finishActiveWithJson(item, text);
		} else {
			// 收到一片才拉下一片(§4.2 接收方拉取);闭包必须捕获当时的 item,
			// 否则超时触发时 active 可能已是别的请求,会误杀
			const it = active;
			navigate({ v: PROTO_V, id: id, op: "next", ts: ts(), i: asm.expect });
			armTimeout(CHUNK_TIMEOUT, it.token, function () { onTimeout(it); });
		}
	}

	/* ---------- 下行解析(前缀 + id + 面板身份三重校验) ---------- */

	function onTitle(raw) {
		const s0 = String(raw == null ? "" : raw);
		const at = s0.indexOf(PREFIX);
		if (at === -1) return; // ① 前缀校验(含其他 mod 的标题)
		const s = s0.slice(at);
		const parts = s.split(":");
		const kind = parts[0];

		if (kind === PREFIX + "A") {
			// LCT3A:<buildId>:<seq>:<pad>
			const seqN = parseInt(parts[2], 10);
			if (isNaN(seqN)) return;
			onAlive({ buildId: parts[1] || "", seq: seqN, pad: parts.slice(3).join(":") });
			return;
		}

		// ③ seq 去重(引擎可能重复投递同一标题)
		const seqN = parseInt(kind === PREFIX + "C" ? parts[3] : parts[2], 10);
		if (isNaN(seqN) || seqN <= lastSeq) return;
		lastSeq = seqN;

		if (kind === PREFIX + "R" || kind === PREFIX + "E") {
			// LCT3R:<id>:<seq>:<json> / LCT3E:<id>:<seq>:<json>
			const id = parts[1] || "";
			const jsonText = parts.slice(3).join(":");
			const item = (active && active.id === id && !active.done) ? active : null;
			if (!item) return; // ② id 校验:非当前请求的迟到帧,丢弃
			if (kind === PREFIX + "R") {
				finishActiveWithJson(item, jsonText);
			} else {
				let err = null;
				try { err = JSON.parse(jsonText); } catch (e) {}
				const code = err && err.code ? String(err.code) : "BAD_RESPONSE";
				if (code === "PROTO_MISMATCH") {
					protoDead = true;
					setStatus("错误: 协议版本不符(请更新模组)");
					persistStatusAttrs();
				}
				failActive(item, code, err && err.detail, err && err.retryable);
			}
			return;
		}

		if (kind === PREFIX + "C") {
			// LCT3C:<id>:<i>/<n>:<seq>:<chunk>
			const id = parts[1] || "";
			const idx = String(parts[2] || "").split("/");
			const i = parseInt(idx[0], 10);
			const n = parseInt(idx[1], 10);
			onChunkFrame(id, i, n, parts.slice(4).join(":"));
			return;
		}
		// 其他 LCT3*:忽略,不猜
	}

	/* ---------- store(§10 持久层) ---------- */

	function bootStoreGet() {
		if (bootGetDone) return;
		bootGetDone = true;
		enqueue({
			kind: "store.get",
			k: "cfg",
			cb: function (resp) {
				if (!resp || resp.ok !== true) {
					storeOk = false;
					setStatus(null);
					persistStatusAttrs();
					return;
				}
				storeOk = true;
				let val = resp.val;
				if (typeof val === "string") {
					try { val = JSON.parse(val); } catch (e) { val = null; }
				}
				if (val && typeof val === "object") {
					try {
						applyConfig(val);
						log("persisted cfg loaded");
					} catch (e2) {}
				} else {
					seedStore(); // 首次运行:把当前配置落盘作种子
				}
				setStatus(null);
				persistStatusAttrs();
			}
		});
		pumpQueue();
	}

	function seedStore() {
		try {
			persistCfg(JSON.stringify(cfgObj || CFG_DEFAULTS));
		} catch (e) {}
	}

	function persistCfg(jsonString) {
		if (elect !== "primary") return; // 落选者不落盘:primary 的宿主实例会收到同一变更
		if (!storeOk) return;
		let val = null;
		try { val = JSON.parse(String(jsonString || "{}")); } catch (e) { return; }
		pendingPut = val;
		if (putScheduled) return;
		putScheduled = true;
		later(0.5, function () { // 防抖:滑块/连点只落最后一笔
			putScheduled = false;
			const payload = pendingPut;
			pendingPut = null;
			if (payload == null) return;
			enqueue({
				kind: "store.put",
				k: "cfg",
				val: payload,
				cb: function (resp) {
					if (!resp || resp.ok !== true) {
						const code = resp && resp.code ? String(resp.code) : "";
						if (code === "STORE_UNAVAILABLE") {
							storeOk = false;
							setStatus(null);
							persistStatusAttrs();
							log("store unavailable: cfg session-only");
						}
					}
				}
			});
			pumpQueue();
		});
	}

	/* ---------- 对外 API ---------- */

	function statusInfo() {
		// 统一从属性读:primary 写,落选者读,双 context 表现一致
		try {
			const cp = claimPanel();
			if (cp) {
				const t = cp.GetAttributeString(STATUS_ATTR, "");
				const b = cp.GetAttributeString(BUILDID_ATTR, "");
				if (t) return { text: t, buildId: b };
			}
		} catch (e) {}
		return { text: "未连接", buildId: "" };
	}

	function translate(items, opts, cb) {
		opts = opts || {};
		if (typeof cb !== "function") return;
		if (elect !== "primary") {
			safeCb(cb, { ok: false, code: "NOT_PRIMARY", detail: "standby context", retryable: true });
			return;
		}
		if (protoDead) {
			safeCb(cb, { ok: false, code: "PROTO_MISMATCH", retryable: false });
			return;
		}
		if (!items || !items.length || items.length > 8) {
			safeCb(cb, { ok: false, code: "BAD_REQUEST", detail: "items", retryable: false });
			return;
		}
		let total = 0;
		const norm = [];
		for (let i = 0; i < items.length; i++) {
			const t = String(items[i] && items[i].t != null ? items[i].t : "");
			total += t.length;
			norm.push({ i: (items[i] && items[i].i != null) ? items[i].i : i, t: t });
		}
		if (total > 2000) { // §5:总字符 ≤2000,超出由调用方拆分
			safeCb(cb, { ok: false, code: "TOO_LONG", detail: String(total), retryable: false });
			return;
		}
		const d = {
			target: String(opts.target || "zh-Hans"),
			source: String(opts.source || "auto"),
			mode: String(opts.mode || "incoming"),
			items: norm
		};
		enqueue({ kind: "tr", d: d, cb: cb, enqueuedAt: $.Time(), r: 0 });
		pumpQueue();
	}

	/* ---------- 导出与启动 ---------- */

	if (typeof globalThis !== "undefined") {
		globalThis.LCTBridge = {
			statusInfo: statusInfo,
			persistCfg: persistCfg,
			translate: translate,
			isPrimary: function () { return elect === "primary"; },
			getCfg: function () { return cfgObj || CFG_DEFAULTS; },
			snapshot: function () {
				return { elect: elect, state: state, buildId: buildId, chunkSize: chunkSize(), storeOk: storeOk, queued: queue.length };
			}
		};
		// 兼容旧契约(原 lct_settings.js 宿主暴露的入口;配置所有权已移入本文件)
		globalThis.LCTSettings = {
			getCfg: function () { return cfgObj || CFG_DEFAULTS; },
			applyConfig: applyConfig,
			DEFAULTS: CFG_DEFAULTS
		};
	}

	function boot() {
		let ctxId = "ctx";
		try { ctxId = String(($.GetContextPanel() && $.GetContextPanel().id) || "ctx"); } catch (e) {}
		reqCounter += 1;
		myTag = ctxId + "." + Math.floor($.Time() * 1000) + "." + reqCounter;
		log("boot tag=" + myTag);
		applyConfig(null); // 先发布默认配置,设置窗口立即可渲染;store 回载后覆盖
		electTick();
	}

	try { $.Schedule(0.2, boot); } catch (e) { boot(); }
})();
