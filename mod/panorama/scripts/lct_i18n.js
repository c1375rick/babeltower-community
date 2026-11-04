// BabelTower v3 — 设置面板文案表(zh/en)
// ------------------------------------------------------------------
// 纯数据、零逻辑:不碰 DOM、不注册事件、不读配置(与 v2 lingua_chat_i18n.js 同法,
// QOLLOCK LocalizeSettingsText 同型:查表翻译 + 未命中回退原文)。
// 装载顺序契约:必须在 lct_settings_ui.vjs_c **之前**加载(hud_escape_menu.xml
// 的 <scripts> 顺序,Panorama 按声明序执行 —— v2 生产实证)。
// 共享机制:Panorama 无模块系统,本文件用**无声明赋值**把数据挂到全局:
//   LCT_TEXT_I18N     —— 文案表:中文原文 -> 英文。zh 是源语言;消费方把键值
//                        双向建表(en 文本也是键,切换界面语言可逆还原)。
//   LCT_STATUS_PREFIX —— 状态前缀表:仅服务 en 界面。"已连接 build=xxxx" 这类
//                        带动态后缀的状态无法整句入表,按前缀翻译并保留后缀。
// 约定:查不到的文本一律原样保留 —— 永远显示原文,绝不显示裸键。
// 消费方:lct_settings_ui.js(localizeText / localizeStatus / applyTexts)。
LCT_TEXT_I18N = {
	// 窗口壳
	"BABELTOWER 翻译": "BABELTOWER Translation",
	"BabelTower 翻译": "BabelTower Translation",
	// 行标签 + 提示
	"启用翻译": "Enable Translation",
	"关闭后所有消息保留原文": "Off: all messages keep their original text",
	"目标语言": "Target Language",
	"把别人的消息翻译成这个语言": "Translate other players' messages into this language",
	"显示模式": "Display Mode",
	"译文下方是否保留原文": "Show the original text under the translation",
	"发送前翻译": "Outgoing Translation",
	"把自己打的消息先翻成目标语言再发出": "Translate your messages into the target language before sending",
	"发送目标语言": "Outgoing Target Language",
	"强制翻译": "Force Translation",
	"跳过语言判断,一律翻译": "Skip language detection; always translate",
	"翻译自己的消息": "Translate Own Messages",
	"自己发出的消息也显示译文": "Show the translation for your own messages too",
	"翻译超时": "Translation Timeout",
	"界面语言": "UI Language",
	// 选项(显示模式 / 发送前翻译 / 超时 / 界面语言)
	// 语言名(target/outTarget 菜单)两界面同用原生写法,不入表。
	"双语": "Bilingual",
	"仅译文": "Translation only",
	"双语 (原文 + 译文)": "Bilingual (original + translation)",
	"双语 (原文 | 译文)": "Bilingual (original | translation)",
	"关": "Off",
	"关 (发原文)": "Off (send original)",
	"4 秒": "4s",
	"8 秒": "8s",
	"12 秒": "12s",
	"16 秒": "16s",
	"中文": "中文 (Chinese)",
	// 页脚状态(整句静态部分;"已连接 build=xxxx" 走 LCT_STATUS_PREFIX)
	"未连接": "Not connected",
	"连接中…": "Connecting…",
	"失败: 桥页面不可达": "Failed: bridge page unreachable",
	"错误: 协议面板缺失": "Error: protocol panel missing",
	"错误: 协议版本不符(请更新模组)": "Error: protocol version mismatch (update the mod)"
};

LCT_STATUS_PREFIX = {
	"已连接": "Connected"
};
