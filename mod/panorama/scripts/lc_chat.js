(function () {
	"use strict";

	/*
	 * BabelTower v3 — 消息钩子(收消息翻译,阶段一:incoming)
	 *
	 * 证据基线(不猜 API,只背书实证):
	 *   - v2 lingua_chat.js(生产实证,217KB):轮询 #ChatMessages DOM 是 6726 上唯一可行的读消息通道;
	 *     本文件是其轮询核心的收敛移植(教训全部内嵌注释)。
	 *   - 当前游戏 chat.xml 反编译(_build_check/game_chat.xml,逐字):
	 *       #ChatMessages > .ChatMessage(row) > #SenderImage + .MessageBody
	 *         .MessageBody > #MessageSource(.ChannelName/.SenderName) + #MessageContents
	 *         #MessageContents > .Text > Label(正文) | .Ping > #TargetHeroImage + #PingLabel(html="true")
	 *       自己的消息:行内 .SenderLocalClient 面板(v2 另判 IsSelf 类,双判保留)
	 *   - 钩子跑在 chat.xml context(2026-11-05 窄面回归:零依赖探针实证 chat.xml
	 *     布局脚本完整执行,d186fbb "不执行"判决系 $.Time 污染假阳性,已推翻);
	 *     跨 context 注入 Label(HUD 顶栏行)是 v2 生产实证形态。
 *   - 扫描两处:聊天窗口 #ChatMessages + HUD 顶栏 Team1Chat/Team2Chat 的 #Messages
 *     (对局中不开聊天框也能看到译文;行解剖 2026-11-04 反编译实证,见 HUD_CHAT_IDS 注释)
	 *
	 * 与 v2 的刻意差异(后续阶段补齐):
	 *   - 混合消息不做片段拆分,整句送翻(用户决策:模组从简)
	 *   - 无 quickchat 模板库 → Ping 行只在"已是目标语言"时跳过(v2 2026-10-28 收紧逻辑的可行子集)
	 *   - 无专名保护/游戏名占位
 *
 * 出站翻译(v2 exp6734C 生产模式收敛版):
 *   - v2 靠 chat.xml shadow 换 oninputsubmit 属性;v3 不做 shadow(chat 布局漂移 = FATAL),
 *     改在 hud context 对 #ChatInput 面板 SetPanelEvent("oninputsubmit", hook)
 *     (SetPanelEvent 本 build 实证:DLMusic dlmusic_main.js / QOLLOCK ql_statlocker 同款 API;
 *      跨 context 调用是新增假设,失败形态 = 出站不生效,聊天本体不受影响)
 *   - 实际发送 = poker 生产配方:input.text 就位 → $.DispatchEvent("CitadelChatInputSubmitted", input)
 *     (poker_chat_debug.js flushRequestedChat 同款;焦点用 DropInputFocus 交还,让原生
 *      onblur 属性链自己走 CitadelChatInputBlur)
 *   - 命令(/、!)、未启用、已是发送目标语言 → 原样放行;翻译 3s 不回 → 原文照发,绝不吞消息
 *   - 发送目标语言 = cfg.outgoingTarget(设置面板下拉,默认 en);模式 cfg.outgoing
 *     (off/translation/bilingual,默认 off——与 v2 一致,要在 Esc 菜单打开)
	 *
	 * v2 教训内嵌:
	 *   - 气泡先建、文本延迟填充 → 水位线 + 每轮尾部补扫 + 空行观察表(TTL 5s)
	 *   - 游戏回收复用行(改 DOM 内容)→ 行级 __lctSig 签名变化 → resetRowModState
	 *   - 面板缓存曾导致行冻结(simtest test2 实锤)→ DOM 每扫必读,不缓存 record
	 *   - 引擎 UI 重载销毁 JS context → 面板引用每轮重解析,isValid() 守卫
	 *   - chat 树不含我们的 CSS → 译文标签样式全内联(v2 applyUniversalInlineStyle 实证值)
	 */

	const TAG = "[LCT][Chat]";

	/* ---------- 常量(v2 实证值) ---------- */

	const FAST_POLL = 0.4;         // 有活儿时的轮询间隔($.Schedule,秒)
	const SLOW_POLL = 1.0;         // 空闲时
	const BOOTSTRAP_TAIL = 24;     // 首扫只扫末尾,不翻历史
	const TAIL_RESCAN = 6;         // 每轮额外补扫末尾(发送者名/内容延迟填充)
	const PENDING_FILL_TTL = 5000; // 空行观察窗(ms),超时移除防空行永久占用
	const SEEN_LIMIT = 500;
	const CACHE_LIMIT = 300;
	const RETRY_LIMIT = 2;         // 含首次
	const RETRY_DELAY = 0.4;       // 秒
	const REQ_WATCHDOG = 12;       // 客户端看门狗(秒):回调永不返回时释放槽
	const QUEUE_MAX = 64;

	const CHAT_MESSAGES_ID = "ChatMessages";
	const MESSAGE_SOURCE_ID = "MessageSource";
	const MESSAGE_CONTENTS_ID = "MessageContents";
	const MESSAGE_BODY_CLASS = "MessageBody";
	const SENDER_NAME_CLASS = "SenderName";
	const CHANNEL_NAME_CLASS = "ChannelName";
	const OWN_PANEL_CLASS = "SenderLocalClient";
	const CHAT_INPUT_ID = "ChatInput";       // 游戏 chat.xml TextEntry(跨 context 面板访问,v3 收消息已实证)
	// HUD 顶栏聊天(不开聊天框时对局里飘的气泡):游戏内置布局 citadel_hud_top_bar_chat,
	// Team1Chat/Team2Chat 两实例(当前游戏 citadel_hud_top_bar.vxml 实证,挂 CitadelHudTopBar 内),
	// 消息容器 #Messages,行 = snippet ChatMessage。行解剖与聊天窗口不同(2026-11-04 反编译实证):
	//   .ChatMessage > #ChatArrow + #MessageContents > .ChatBubble > .TextContainer >
	//   .MessageWrapper > #MessageText(html="true");无 .MessageBody/.SenderName;
	//   轮盘行标记 = #PingStyleIcon(+SubjectIcon/CooldownTimer/ResponseHeroes),非 Ping/PingLabel;
	//   另有 TypingIndicatorChatMessage snippet(#TypingAnim,无文本,自然落空行观察表后过期)。
	const HUD_CHAT_IDS = ["Team1Chat", "Team2Chat"];
	const HUD_MESSAGES_ID = "Messages";
	const HUD_BUBBLE_CLASS = "ChatBubble";   // 行判别:有 ChatBubble = HUD 行(聊天窗口行没有)
	const HUD_TEXT_ID = "MessageText";
	// 译文标签标记类:chat 树没有我们的 CSS(样式走内联),此类只作 resetRowModState 的识别标记
	const TRANS_CLASS = "LCTTranslation";
	const OUT_WATCHDOG = 3.0;      // 出站等翻译预算(秒):超时原文照发,聊天不能等协议 8s+重试
	const OUT_MAX_SEND = 400;      // v2 同款发送长度保护(游戏聊天有上限,拼接过长被截/失败)
	const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/; // 汉字(中日共用,日文靠假名信号区分)
	const RE_KANA = /[\u3040-\u30ff]/;             // 假名 —— 日文铁证(中文没有假名)
	const RE_HANGUL = /[\uac00-\ud7af]/;           // 谚文 —— 韩文
	const RE_CYRILLIC = /[\u0400-\u04ff]/;         // 西里尔 —— 俄文
	const RE_LATIN_ACCENT = /[\u00c0-\u00ff]/;     // 变音拉丁(é ñ ü...)—— 法/德/西信号

	/* ---------- 基础工具 ---------- */

	function nowMs() {
		return Date.now ? Date.now() : 0;
	}

	function log(s) {
		try { $.Msg(TAG + " " + s); } catch (e) {}
	}

	function expErr(e) {
		return e && e.message ? e.message : String(e);
	}

	function snip(s, n) {
		const t = String(s || "");
		return t.length > (n || 40) ? t.slice(0, n || 40) + "…" : t;
	}

	function isValid(panel) {
		return !!(panel && (!panel.IsValid || panel.IsValid()));
	}

	function safeText(panel) {
		try {
			return String((panel && panel.text) || "").replace(/\s+/g, " ").trim();
		} catch (e) {
			return "";
		}
	}

	function childCount(panel) {
		if (!isValid(panel) || typeof panel.GetChildCount !== "function") return 0;
		try { return panel.GetChildCount() || 0; } catch (e) { return 0; }
	}

	function childAt(panel, index) {
		if (!isValid(panel) || typeof panel.GetChild !== "function") return null;
		try { return panel.GetChild(index); } catch (e) { return null; }
	}

	function hasClass(panel, className) {
		if (!isValid(panel) || typeof panel.BHasClass !== "function") return false;
		try { return panel.BHasClass(className); } catch (e) { return false; }
	}

	function findChild(root, id) {
		if (!isValid(root) || typeof root.FindChildTraverse !== "function") return null;
		try {
			const found = root.FindChildTraverse(id);
			return isValid(found) ? found : null;
		} catch (e) {
			return null;
		}
	}

	function findClass(root, className) {
		if (!isValid(root)) return null;
		if (typeof root.FindChildrenWithClassTraverse === "function") {
			try {
				const matches = root.FindChildrenWithClassTraverse(className);
				if (matches && matches.length) {
					for (let i = 0; i < matches.length; i += 1) {
						if (isValid(matches[i])) return matches[i];
					}
				}
			} catch (e) {}
		}
		if (hasClass(root, className)) return root;
		return null;
	}

	function getRoot() {
		// 绝对根面板:跨 context 属性/查找的落点(与 lc_protocol claimPanel 同一选择)
		let root = null;
		try { root = $.GetContextPanel(); } catch (e) { return null; }
		let guard = 0;
		while (root && root.GetParent && root.GetParent() && guard < 64) {
			root = root.GetParent();
			guard += 1;
		}
		return root;
	}

	function collectTextInto(panel, out) {
		if (!isValid(panel)) return;
		const text = safeText(panel);
		if (text) out.push(text);
		const count = childCount(panel);
		for (let i = 0; i < count; i += 1) collectTextInto(childAt(panel, i), out);
	}

	function collectText(panel) {
		const out = [];
		collectTextInto(panel, out);
		return out.join(" ").replace(/\s+/g, " ").trim();
	}

	function hashString(str) {
		let h = 5381;
		const s = String(str || "");
		for (let i = 0; i < s.length; i += 1) {
			h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
		}
		return h.toString(36);
	}

	function safeStyle(label, prop, value) {
		try { label.style[prop] = value; } catch (e) {}
	}

	/* ---------- 配置(读 lc_protocol 发布的 canonical 配置) ---------- */

	function cfg() {
		try {
			const b = globalThis.LCTBridge;
			if (b && typeof b.getCfg === "function") return b.getCfg() || {};
		} catch (e) {}
		return {};
	}

	function targetLanguage() {
		return String(cfg().targetLanguage || "zh-Hans");
	}

	/* ---------- 行读取(当前游戏 chat.xml 结构,逐字对照反编译) ---------- */

	function readMessageRow(row) {
		// DOM 每扫必读(v2 教训:面板缓存曾让回收行永远命中旧 record,行冻结)
		// HUD 顶栏行判别:.ChatMessage 包裹 + .ChatBubble 在场(聊天窗口行无 ChatBubble)。
		// 文本在 #MessageText;无 MessageSource(发送者名不进签名,channel="hud" 已足够区分)。
		if (hasClass(row, "ChatMessage") && findClass(row, HUD_BUBBLE_CLASS)) {
			const text = safeText(findChild(row, HUD_TEXT_ID)) || collectText(row);
			if (!text) return null;
			return {
				sender: "", channel: "hud", text: text,
				isOwn: hasClass(row, "IsSelf"),
				// 轮盘/快捷行结构标记(游戏本地化已渲染,翻译只是劣质重复):
				// PingStyleIcon 是 HUD 侧铁标(v2 2026-10-02 实车教训:漏掉它轮盘消息全被重翻)
				quick: hasClass(row, "Ping") || !!findChild(row, "PingLabel") ||
					!!findChild(row, "PingStyleIcon") || !!findChild(row, "SubjectIcon") ||
					!!findChild(row, "CooldownTimer") || !!findChild(row, "ResponseHeroes")
			};
		}
		const source = findChild(row, MESSAGE_SOURCE_ID);
		const contents = findChild(row, MESSAGE_CONTENTS_ID);
		if (!contents) return null; // 气泡先建、内容未填 → 观察表等补扫
		const text = collectText(contents);
		if (!text) return null;
		const sender =
			safeText(findClass(source, SENDER_NAME_CLASS)) ||
			safeText(findClass(row, SENDER_NAME_CLASS)) ||
			"<unknown>";
		const channel =
			safeText(findClass(source, CHANNEL_NAME_CLASS)) ||
			safeText(findClass(row, CHANNEL_NAME_CLASS)) ||
			"";
		const isOwn = hasClass(row, "IsSelf") || !!findClass(row, OWN_PANEL_CLASS);
		const quick = hasClass(contents, "Ping") || !!findChild(contents, "PingLabel");
		return { sender: sender, channel: channel, text: text, isOwn: isOwn, quick: quick };
	}

	function makeSignature(record) {
		return [record.channel || "", record.sender || "", record.text || ""].join("\x00");
	}

	function isTargetLanguageText(text, tgt) {
		// tgt 缺省 = 入站目标(cfg.targetLanguage);出站跳过判定必须显式传发送目标
		// (cfg.outgoingTarget)——入站 zh + 发送 en 的典型配置下,用户打的英文若按入站
		// 目标判定会被误送 en→en(2026-11-04 实车日志 "out request en->en" 实证)
		const t = String(tgt || targetLanguage()).toLowerCase();
		const s = String(text || "");
		// 通用规则(用户要求举一反三):含"目标文字系统"信号且不含任何其它文字系统信号
		// → 已达标跳过;纯外文或混合(目标文+外文)一律送翻 —— 与整句翻译策略一致。
		if (t.indexOf("zh") === 0) {
			// 中文:汉字在,假名/谚文/西里尔/拉丁都不在
			return CJK_RE.test(s) && !RE_KANA.test(s) && !RE_HANGUL.test(s) &&
				!RE_CYRILLIC.test(s) && !/[A-Za-z]/.test(s);
		}
		if (t.indexOf("ja") === 0) {
			// 日文:假名在(纯汉字无假名 = 中文,送翻),拉丁/谚文/西里尔不在
			return RE_KANA.test(s) && !/[A-Za-z]/.test(s) && !RE_HANGUL.test(s) && !RE_CYRILLIC.test(s);
		}
		if (t.indexOf("ko") === 0) {
			// 韩文:谚文在,假名/拉丁/西里尔/汉字都不在
			return RE_HANGUL.test(s) && !RE_KANA.test(s) && !/[A-Za-z]/.test(s) &&
				!RE_CYRILLIC.test(s) && !CJK_RE.test(s);
		}
		if (t.indexOf("ru") === 0) {
			// 俄文:西里尔在,拉丁/汉字/假名/谚文都不在
			return RE_CYRILLIC.test(s) && !/[A-Za-z]/.test(s) && !CJK_RE.test(s) &&
				!RE_KANA.test(s) && !RE_HANGUL.test(s);
		}
		if (t === "fr" || t === "de" || t === "es") {
			// 法/德/西与英文共享拉丁字母表,文字系统不可分:只跳过"带变音符号的纯欧文";
			// 英文与无变音欧文照送翻(宁可重翻,不可漏翻)
			return RE_LATIN_ACCENT.test(s) && !/[A-Za-z]/.test(s) && !CJK_RE.test(s) &&
				!RE_KANA.test(s) && !RE_HANGUL.test(s) && !RE_CYRILLIC.test(s);
		}
		// 缺省(en 及未知码):字母全部 ASCII → 已达标;任何非 ASCII 字母(汉字/假名/谚文/西里尔/变音)→ 送翻
		const letters = s.replace(/\P{L}/gu, "");
		return letters.length > 0 && !/[^\x00-\x7F]/.test(letters);
	}

	// 探测源语言码(仅对"纯单文字系统"文本给明确值;混合/变音/无字母 → auto)。
	// 为什么要报明来源:桥的 mymemory 兜底不支持 auto,页面会静默当 en
	// (app index.html trMm: source!=="auto" ? source : "en"),韩/日/俄文被塞进
	// en|x 语言对 → MyMemory 翻不动 → 原样回显(2026-11-04 实测 안녕/こんにちは 原样弹回)。
	// 纯度条件与 isTargetLanguageText 的分支一一对应。
	function detectSourceCode(s) {
		if (RE_KANA.test(s) && !/[A-Za-z]/.test(s) && !RE_HANGUL.test(s) && !RE_CYRILLIC.test(s)) return "ja";
		if (RE_HANGUL.test(s) && !RE_KANA.test(s) && !/[A-Za-z]/.test(s) &&
			!RE_CYRILLIC.test(s) && !CJK_RE.test(s)) return "ko";
		if (RE_CYRILLIC.test(s) && !/[A-Za-z]/.test(s) && !CJK_RE.test(s) &&
			!RE_KANA.test(s) && !RE_HANGUL.test(s)) return "ru";
		if (CJK_RE.test(s) && !RE_KANA.test(s) && !RE_HANGUL.test(s) &&
			!RE_CYRILLIC.test(s) && !/[A-Za-z]/.test(s)) return "zh-CN";
		const letters = s.replace(/\P{L}/gu, "");
		if (letters.length > 0 && !/[^\x00-\x7F]/.test(letters)) return "en";
		return "auto";
	}

	/* ---------- 跳过判定(v2 收敛版) ---------- */

	function shouldSkip(record) {
		const text = record.text;
		if (!text || text.length < 2) return true;
		const c = cfg();
		if (c.enabled === false) return true; // 只认显式 false(缺省按开)
		// 游戏原生快捷短语/Ping 已由游戏本地化。无模板库的 v3 子集:仅当已为目标语言才跳过;
		// 标记存疑(目标语言之外的 Ping 文本)→ 落到正常判定照常翻译(v2 2026-10-28 收紧逻辑)
		if (record.quick && isTargetLanguageText(text)) return true;
		if (text.charAt(0) === "/") return true; // 指令消息
		if (!/\p{L}/u.test(text)) return true; // 无任何 Unicode 字母(纯数字/符号/表情)
		if (record.isOwn && c.translateOwn === false) return true;
		if (!c.force && isTargetLanguageText(text)) return true;
		return false;
	}

	/* ---------- 译文注入(全内联样式:chat 树不含本 mod 的 CSS) ---------- */

	function transLabelId(sig) {
		return "LCTTrans" + hashString(sig);
	}

	function getTransLabel(row, sig) {
		return findChild(row, transLabelId(sig));
	}

	function labelHost(row) {
		// 聊天窗口行:.MessageBody(flow-children down,译文落在气泡下方);
		// HUD 顶栏行:#MessageContents(游戏 CSS flow-down,译文在气泡正下方;
		//   直接挂 ChatBubble 会进横向流,译文被挤到气泡右侧 —— v2 实证)
		if (findClass(row, HUD_BUBBLE_CLASS)) {
			const hudContents = findChild(row, MESSAGE_CONTENTS_ID);
			if (hudContents) return hudContents;
		}
		return findClass(row, MESSAGE_BODY_CLASS) || row;
	}

	function applyInlineStyle(label) {
		// v2 applyUniversalInlineStyle 实证值(普通聊天行译文外观)
		safeStyle(label, "backgroundColor", "rgba(20, 52, 96, 0.95)");
		safeStyle(label, "color", "#ffffff");
		safeStyle(label, "fontSize", "17px");
		safeStyle(label, "fontWeight", "600");
		safeStyle(label, "border", "1px solid rgba(120, 180, 255, 0.55)");
		safeStyle(label, "borderRadius", "4px");
		safeStyle(label, "padding", "3px 8px");
		safeStyle(label, "marginTop", "3px");
		safeStyle(label, "marginLeft", "58px");
		safeStyle(label, "maxWidth", "290px");
		safeStyle(label, "whiteSpace", "normal");
		safeStyle(label, "width", "fit-children");
		safeStyle(label, "textShadow", "0px 1px 2px rgba(0, 0, 0, 0.6)");
	}

	function ensureLabel(row, sig) {
		let label = getTransLabel(row, sig);
		if (isValid(label)) return label;
		try {
			label = $.CreatePanel("Label", labelHost(row), transLabelId(sig));
			label.AddClass(TRANS_CLASS);
			applyInlineStyle(label);
			return label;
		} catch (e) {
			log("create label failed: " + expErr(e));
			return null;
		}
	}

	function rowIsPing(row) {
		const contents = findChild(row, MESSAGE_CONTENTS_ID);
		if (!contents) return false;
		try {
			return hasClass(contents, "Ping") || !!findChild(contents, "PingLabel");
		} catch (e) {
			return false;
		}
	}

	function injectTranslation(row, sig, displayText) {
		if (!isValid(row)) return;
		if (!displayText) return;
		const label = ensureLabel(row, sig);
		if (!label) return;
		try { label.RemoveClass("LCTTranslationError"); } catch (e) {}
		try { label.text = String(displayText); } catch (e) {}
		// 只显示译文模式:隐藏原文(Ping 行不折叠:折叠会让快捷短语内容消失)。
		// HUD 行特例:译文标签就挂在 #MessageContents 下,折叠 contents 会连译文一起藏掉
		// → 折 .ChatBubble(原文气泡)而非 contents
		if (String(cfg().displayMode) === "translation_only" && !rowIsPing(row)) {
			const bubble = findClass(row, HUD_BUBBLE_CLASS);
			const contents = bubble ? null : findChild(row, MESSAGE_CONTENTS_ID);
			if (bubble) {
				try { bubble.style.visibility = "collapse"; } catch (e) {}
			} else if (contents) {
				try { contents.style.visibility = "collapse"; } catch (e) {}
			}
		}
	}

	function injectError(row, sig, message) {
		if (!isValid(row)) return;
		const label = ensureLabel(row, sig);
		if (!label) return;
		try {
			label.AddClass("LCTTranslationError");
			label.style.color = "#ffb4b4";
			label.text = "⚠ 翻译失败: " + snip(message, 100);
		} catch (e) {}
	}

	// 回收复用清理:行被游戏复用时,清除本 mod 残留(旧译文标签 + 原文折叠样式)
	function resetRowModState(row) {
		try {
			const contents = findChild(row, MESSAGE_CONTENTS_ID);
			if (contents && contents.style) contents.style.visibility = "visible";
		} catch (e) {}
		try {
			const bubble = findClass(row, HUD_BUBBLE_CLASS); // HUD 行折叠的是气泡(见 injectTranslation)
			if (bubble && bubble.style) bubble.style.visibility = "visible";
		} catch (e) {}
		const containers = [];
		const body = findClass(row, MESSAGE_BODY_CLASS);
		if (isValid(body)) containers.push(body);
		const contents = findChild(row, MESSAGE_CONTENTS_ID);
		if (isValid(contents)) containers.push(contents);
		containers.push(row);
		for (let c = 0; c < containers.length; c += 1) {
			const container = containers[c];
			if (!isValid(container)) continue;
			const count = childCount(container);
			for (let i = count - 1; i >= 0; i -= 1) {
				const child = childAt(container, i);
				if (!isValid(child)) continue;
				if (!hasClass(child, TRANS_CLASS)) continue;
				try {
					child.DeleteAsync(0);
				} catch (e) {
					try { child.RemoveAndDeleteChildren(); } catch (e2) {}
				}
			}
		}
	}

	/* ---------- 翻译队列(单在飞槽,与协议侧单槽串行对齐) ---------- */

	function textKeyOf(translating) {
		return String(translating || "") + "\x00" + targetLanguage();
	}

	function trimCache() {
		while (State.cache.size > CACHE_LIMIT) {
			const first = State.cache.keys().next().value;
			if (first === undefined) break;
			State.cache.delete(first);
		}
	}

	function trimSeen() {
		while (State.seen.size > SEEN_LIMIT) {
			const first = State.seen.values().next().value;
			if (first === undefined) break;
			State.seen.delete(first);
		}
	}

	function restoreFromCache(row, sig, translating) {
		const cached = State.cache.get(textKeyOf(translating));
		if (!cached) return false;
		if (getTransLabel(row, sig)) return true;
		injectTranslation(row, sig, cached);
		return true;
	}

	function deliver(group, translation) {
		if (!group) return;
		const display = String(translation || "").trim();
		State.cache.set(group.key, display);
		trimCache();
		State.inflight.delete(group.key);
		for (let i = 0; i < group.rows.length; i += 1) {
			const entry = group.rows[i];
			if (isValid(entry.row) && entry.row.__lctSig === entry.sig) {
				injectTranslation(entry.row, entry.sig, display);
			}
			// 行已失效(游戏回收/清理)→ 丢弃;同文新行会经缓存路径恢复
		}
	}

	function failJob(job, err) {
		job.attempts += 1;
		if (job.attempts < RETRY_LIMIT) {
			State.queue.unshift(job);
			try { $.Schedule(RETRY_DELAY, pumpQueue); } catch (e) {}
			log("retry (" + job.attempts + "): " + snip(err, 80));
			return;
		}
		const group = job.group;
		if (group) {
			State.inflight.delete(group.key);
			for (let i = 0; i < group.rows.length; i += 1) {
				const entry = group.rows[i];
				try { State.seen.delete(entry.sig); } catch (e) {} // 允许同文新行重试
				if (isValid(entry.row) && entry.row.__lctSig === entry.sig) {
					injectError(entry.row, entry.sig, String(err || "unknown_error"));
				}
			}
		}
		log("failed: " + snip(err, 80));
	}

	function pumpQueue() {
		if (State.active) return;
		if (!State.queue.length) return;
		let bridge = null;
		try { bridge = globalThis.LCTBridge; } catch (eB) {}
		if (!bridge || typeof bridge.translate !== "function") return; // 未就绪:留在队列,boot 兜底
		if (typeof bridge.isPrimary === "function" && !bridge.isPrimary()) return; // 落选期:等待上任
		const job = State.queue.shift();
		State.active = job;
		let dispatched = false;
		try {
			bridge.translate(
				[{ i: 0, t: job.text }],
				{ target: targetLanguage(), source: detectSourceCode(job.text), mode: "incoming" },
				function (res) {
					if (State.active !== job) return; // 迟到回调(看门狗已接管)
					State.active = null;
					if (res && res.ok) {
						const items = res.items || [];
						const out = (items.length && items[0] && typeof items[0].t === "string") ? items[0].t : "";
						deliver(job.group, out);
					} else {
						failJob(job, res ? (String(res.code || "UNKNOWN") + (res.detail ? ":" + res.detail : "")) : "no_response");
					}
					pumpQueue();
				}
			);
			dispatched = true;
		} catch (e) {
			State.active = null;
			failJob(job, "throw:" + expErr(e));
			pumpQueue();
			return;
		}
		if (dispatched) {
			// 看门狗:回调永不返回(协议侧异常等)→ 释放槽,队列不饿死
			try {
				$.Schedule(REQ_WATCHDOG, function () {
					if (State.active === job) {
						State.active = null;
						failJob(job, "client_watchdog");
						pumpQueue();
					}
				});
			} catch (eW) {}
		}
	}

	function enqueue(row, sig, record) {
		const key = textKeyOf(record.text);
		// in-flight 合并:同 textKey 只发一次桥请求,结果扇出注入所有同文行
		const existing = State.inflight.get(key);
		if (existing) {
			existing.rows.push({ row: row, sig: sig });
			return;
		}
		const group = { key: key, rows: [{ row: row, sig: sig }] };
		State.inflight.set(key, group);
		State.queue.push({ text: record.text, group: group, attempts: 0 });
		while (State.queue.length > QUEUE_MAX) State.queue.shift(); // 溢出丢最老
		pumpQueue();
	}

	/* ---------- 扫描(水位线 + 尾部补扫 + 空行观察表) ---------- */

	function resolveMessages() {
		const root = getRoot();
		if (!root) return null;
		const messages = findChild(root, CHAT_MESSAGES_ID);
		if (messages && messages !== State.messages) {
			// 容器重建(对局切换/清理)→ 水位线归零
			State.messages = messages;
			State.scannedCount = 0;
		}
		if (isValid(State.messages) && !State.bootLogged) {
			State.bootLogged = true;
			log("watching ChatMessages (target=" + targetLanguage() + ")");
		}
		return isValid(State.messages) ? State.messages : null;
	}

	function processRange(messages, start, end) {
		let touched = false;
		for (let i = Math.max(0, start); i < end; i += 1) {
			try {
				if (processRow(childAt(messages, i))) touched = true;
			} catch (e) {
				log("processRow error: " + expErr(e));
			}
		}
		return touched;
	}

	function processRow(row) {
		if (!isValid(row)) return false;
		const record = readMessageRow(row);
		if (!record) {
			// 气泡先建、文本延迟填充(6726 行为,用户肉眼可见)。只靠尾部补扫时,
			// burst 超 3 条后填充的文本会永久漏译 → 登记观察表,文本到达后由补扫处理
			if (!row.__lctWatched) {
				row.__lctWatched = true;
				try { State.pendingFill.set(row, nowMs() + PENDING_FILL_TTL); } catch (e) {}
			}
			return false;
		}
		if (row.__lctWatched) {
			row.__lctWatched = false;
			try { State.pendingFill.delete(row); } catch (e) {}
		}
		const skip = shouldSkip(record);
		const sig = makeSignature(record);

		// 已处理过的行:签名变化 = 被回收复用 → 重置处理状态
		const prevSig = row.__lctSig;
		if (row.__lctProcessed && prevSig === sig) {
			if (!skip) restoreFromCache(row, sig, record.text);
			return false;
		}
		if (prevSig !== sig) {
			row.__lctProcessed = false;
			resetRowModState(row);
		}
		row.__lctSig = sig;
		row.__lctProcessed = true;

		if (State.seen.has(sig)) {
			if (!skip) restoreFromCache(row, sig, record.text);
			return false;
		}
		State.seen.add(sig);
		trimSeen();

		if (skip) return false;
		const cached = State.cache.get(textKeyOf(record.text));
		if (cached) {
			injectTranslation(row, sig, cached);
			return false;
		}
		enqueue(row, sig, record);
		return true;
	}

	function processPendingFill() {
		if (!State.pendingFill.size) return false;
		let touched = false;
		const expired = [];
		const keys = State.pendingFill.keys();
		let k = keys.next();
		while (!k.done) {
			const row = k.value;
			const deadline = State.pendingFill.get(row);
			if (!isValid(row) || nowMs() > deadline) {
				expired.push(row);
			} else {
				try {
					if (processRow(row)) touched = true;
				} catch (e) {}
			}
			k = keys.next();
		}
		for (let i = 0; i < expired.length; i += 1) State.pendingFill.delete(expired[i]);
		return touched;
	}

	/* ---------- HUD 顶栏聊天扫描(只扫不改布局,零漂移) ---------- */

	function resolveHudMessages() {
		const root = getRoot();
		if (!root) return;
		const found = [];
		for (let i = 0; i < HUD_CHAT_IDS.length; i += 1) {
			// 主路径:布局写死的固定 id(当前游戏 citadel_hud_top_bar.vxml 实证)
			const chat = findChild(root, HUD_CHAT_IDS[i]);
			const messages = chat ? findChild(chat, HUD_MESSAGES_ID) : null;
			if (isValid(messages)) found.push(messages);
		}
		let changed = found.length !== State.hudMessages.length;
		if (!changed) {
			for (let i = 0; i < found.length; i += 1) {
				if (found[i] !== State.hudMessages[i]) { changed = true; break; }
			}
		}
		if (changed) {
			// 面板树变化(进对局 0→2 / 结束 2→0)→ 水位线重建;日志能看到发现时机
			State.hudMessages = found;
			State.hudScanned = [];
			for (let i = 0; i < found.length; i += 1) State.hudScanned.push(0);
			log("watching HUD top bar chat (" + found.length + ")");
		}
	}

	function scanHudTopBarOnce() {
		resolveHudMessages();
		let touched = false;
		for (let i = 0; i < State.hudMessages.length; i += 1) {
			const messages = State.hudMessages[i];
			if (!isValid(messages)) continue;
			try {
				const count = childCount(messages);
				const scanned = State.hudScanned[i] || 0;
				if (count < scanned) State.hudScanned[i] = 0; // 容器清空/重建
				let start = State.hudScanned[i] || 0;
				if (start === 0 && count > BOOTSTRAP_TAIL) start = count - BOOTSTRAP_TAIL; // 首扫只扫尾部,不翻历史
				touched = processRange(messages, start, count) || touched;
				// 低延迟:尾部补扫(气泡文本延迟填充)
				touched = processRange(messages, Math.max(0, count - TAIL_RESCAN), count) || touched;
				State.hudScanned[i] = count;
			} catch (e) {
				// 单容器异常不中断整体(顶栏翻译不因个别面板异常停摆)
				log("hud scan container " + i + " error: " + expErr(e));
			}
		}
		return touched;
	}

	function scanOnce() {
		const messages = resolveMessages();
		if (!messages) {
			State.messages = null;
			State.scannedCount = 0;
			return false;
		}
		const count = childCount(messages);
		if (count < State.scannedCount) State.scannedCount = 0; // 聊天清空/重建
		let touched = false;
		if (State.scannedCount === 0 && count > BOOTSTRAP_TAIL) {
			touched = processRange(messages, count - BOOTSTRAP_TAIL, count) || touched;
		} else {
			touched = processRange(messages, State.scannedCount, count) || touched;
		}
		State.scannedCount = count;
		// 低延迟:每次额外扫末尾几条(发送者名/内容可能延迟填充)
		touched = processRange(messages, Math.max(0, count - TAIL_RESCAN), count) || touched;
		touched = processPendingFill() || touched;
		try { touched = scanHudTopBarOnce() || touched; } catch (eH) {
			log("hud scan error: " + expErr(eH));
		}
		return touched;
	}

	/* ---------- 出站翻译(发送前翻译,hud context 接管 #ChatInput) ---------- */

	function outTarget() {
		return String(cfg().outgoingTarget || "en");
	}

	function chatInput() {
		return findChild(getRoot(), CHAT_INPUT_ID);
	}

	// 实际发送:poker 生产配方(input.text 就位 → 派发事件,真正发送方在游戏侧监听)
	function stockSubmit(input) {
		try { $.DispatchEvent("CitadelChatInputSubmitted", input); } catch (e) {
			log("submit dispatch failed: " + expErr(e));
		}
	}

	// 焦点交还游戏:DropInputFocus(poker 实证事件)→ 原生 onblur 属性链自己走
	// CitadelChatInputBlur,聊天窗口收起等原生行为不丢
	function dropFocus(input) {
		try { $.DispatchEvent("DropInputFocus", input); } catch (e) {}
	}

	// 就位发送 + 焦点处理。用户在等待翻译期间已输入新文字 → 发送后恢复之(不抢焦点)
	function sendNow(text) {
		const input = chatInput();
		if (!isValid(input)) return;
		let cur = "";
		try { cur = String(input.text || ""); } catch (e) {}
		const typing = !!(cur && cur !== text);
		try { input.text = text; } catch (e) { return; }
		stockSubmit(input);
		try { input.text = ""; } catch (e) {}
		if (typing) {
			try { input.text = cur; } catch (e) {}
		} else {
			dropFocus(input);
		}
	}

	function onInputSubmit() {
		const input = chatInput();
		if (!input) return;
		let raw = "";
		try { raw = String(input.text || ""); } catch (e) { return; }
		const trimmed = raw.trim();
		if (!trimmed) return; // 空输入:原生同样无操作
		const c = cfg();
		const mode = String(c.outgoing || "off");
		const tgt = outTarget(); // 跳过判定与翻译请求都用发送目标(非入站目标)
		let skipReason = "";
		if (c.enabled === false) skipReason = "disabled";
		else if (mode === "off") skipReason = "mode=off";
		else if (trimmed.charAt(0) === "/" || trimmed.charAt(0) === "!") skipReason = "command";
		else if (!/\p{L}/u.test(trimmed)) skipReason = "no-letters";
		else if (isTargetLanguageText(trimmed, tgt)) skipReason = "already-target";
		if (skipReason) {
			log("out skip (" + skipReason + "): " + snip(trimmed, 48));
			sendNow(trimmed); // 原样放行(input.text 已是原文,sendNow 只走派发+清理)
			return;
		}
		// 同文本翻译中重复 Enter → 原样立即发(v2 2026-10-31 实车:吞消息更糟)
		if (State.outPending === trimmed) {
			log("out dedupe: same text pending -> verbatim");
			sendNow(trimmed);
			return;
		}
		State.outPending = trimmed;
		try { input.text = ""; } catch (e) {} // 立即清空:视觉反馈已捕获,防重复整条输入
		const seq = (State.outSeq += 1);
		const src = detectSourceCode(trimmed);
		log("out request " + src + "->" + tgt + " (" + mode + "): " + snip(trimmed, 60));
		try {
			globalThis.LCTBridge.translate(
				[{ i: 0, t: trimmed }],
				{ target: tgt, source: src, mode: "outgoing" },
				function (res) {
					if (seq !== State.outSeq) return; // 看门狗已放行 / 更新提交已接管
					State.outPending = null;
					const items = res && res.items;
					const tr = (res && res.ok && items && items.length &&
						typeof items[0].t === "string") ? String(items[0].t).trim() : "";
					if (!tr || tr === trimmed) {
						// 翻译不可用/超时/未变:原文照发,绝不吞(v2 生产教训)。
						// 日志三分:no_response=回调没来 / 错误码 / unchanged|empty=桥正常但没实质翻译
						log("out unavailable (" + (res ? (res.ok ? (tr === trimmed ? "unchanged" : "empty")
							: String(res.code || "error")) : "no_response") + ") -> original");
						sendNow(trimmed);
						return;
					}
					let send = tr;
					if (mode === "bilingual") send = trimmed + " | " + tr;
					if (send.length > OUT_MAX_SEND) {
						if (mode === "bilingual") {
							const budget = Math.max(0, OUT_MAX_SEND - trimmed.length - 3);
							send = trimmed + " | " + (tr.length > budget ? tr.slice(0, budget) + "…" : tr);
						} else {
							send = send.slice(0, OUT_MAX_SEND) + "…";
						}
					}
					log("out sent [" + mode + "]: " + snip(send, 80));
					sendNow(send);
				}
			);
		} catch (eT) {
			if (seq === State.outSeq) { State.outPending = null; State.outSeq += 1; }
			log("out translate throw: " + expErr(eT) + " -> original");
			sendNow(trimmed);
			return;
		}
		// 看门狗:聊天消息不能等协议 8s 超时+重试,3s 不回就原文放行
		try {
			$.Schedule(OUT_WATCHDOG, function () {
				if (seq === State.outSeq && State.outPending === trimmed) {
					State.outSeq += 1; // 迟到的翻译回调就此作废
					State.outPending = null;
					log("out watchdog " + OUT_WATCHDOG + "s -> original");
					sendNow(trimmed);
				}
			});
		} catch (eW) {}
	}

	// 挂钩维护:#ChatInput 面板就绪后 SetPanelEvent 接管 oninputsubmit;
	// UI 重建(context 销毁/对局重载)后面板换新 → 重挂。每 tick 调用,代价一次 FindChildTraverse。
	function maintainOutgoingHook() {
		const input = chatInput();
		if (!input) return;
		if (State.outHooked && State.outInput === input) return;
		if (typeof input.SetPanelEvent !== "function") {
			if (!State.outHookWarned) {
				State.outHookWarned = true;
				log("ChatInput.SetPanelEvent missing - outgoing disabled (incoming unaffected)");
			}
			return;
		}
		try {
			input.SetPanelEvent("oninputsubmit", onInputSubmit);
			State.outHooked = true;
			State.outInput = input;
			log("outgoing hook installed (SetPanelEvent oninputsubmit on #ChatInput)");
		} catch (e) {
			if (!State.outHookWarned) {
				State.outHookWarned = true;
				log("outgoing hook install failed: " + expErr(e));
			}
		}
	}

	/* ---------- 主循环 ---------- */

	function tick() {
		let touched = false;
		try {
			touched = scanOnce();
		} catch (e) {
			log("scan error: " + expErr(e));
		}
		try { maintainOutgoingHook(); } catch (eH) {}
		const hasWork = touched || State.queue.length > 0 || !!State.active;
		try { $.Schedule(hasWork ? FAST_POLL : SLOW_POLL, tick); } catch (e) {}
	}

	function boot(attempt) {
		// include 顺序保证 lc_protocol 先求值(LCTBridge 已注册);重试只是时序兜底
		let bridge = null;
		try { bridge = globalThis.LCTBridge; } catch (eB) {}
		if (!bridge || typeof bridge.translate !== "function") {
			if (attempt < 25) {
				try { $.Schedule(0.4, function () { boot(attempt + 1); }); } catch (e) {}
			} else {
				log("LCTBridge missing; hook idle");
			}
			return;
		}
		log("hook up (bridge ready, cfg.target=" + targetLanguage() + ")");
		try { $.Schedule(0.5, tick); } catch (e) { tick(); }
	}

	/* ---------- 状态 ---------- */

	const State = {
		messages: null,
		scannedCount: 0,
		bootLogged: false,
		seen: new Set(),       // 已处理签名(行级去重)
		cache: new Map(),      // textKey -> 译文显示文本
		inflight: new Map(),   // textKey -> group(同文合并)
		pendingFill: new Map(),// row -> 观察截止时间(空行文本延迟填充)
		queue: [],             // 待翻译任务
		active: null,          // 在飞任务(单槽)
		hudMessages: [],       // HUD 顶栏聊天 #Messages 容器列表(Team1Chat/Team2Chat)
		hudScanned: [],        // 每容器水位线(与 hudMessages 同步重建)
		outPending: null,      // 出站:翻译中的原文(去重 + 看门狗判定)
		outSeq: 0,             // 出站提交序号:看门狗放行/新提交后,迟到回调作废
		outInput: null,        // 已挂钩的 ChatInput 面板(UI 重建 → 重挂)
		outHooked: false,
		outHookWarned: false
	};

	log("loaded (hud context message hook)");
	boot(0);
})();
