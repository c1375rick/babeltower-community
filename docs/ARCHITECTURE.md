# BabelTower Community — 技术文档（架构与实现）

> 本文是系统级总览：组件、数据流、工程决策及其证据、构建/验证工作流。
> 协议线规格见 [PROTOCOL.md](PROTOCOL.md)，调试线见 [DEBUG.md](DEBUG.md)。
> 三份文档分工：**ARCHITECTURE 讲"为什么这么建"，PROTOCOL 讲"线怎么跑"，DEBUG 讲"坏了怎么查"**。

## 1. 项目定位

Deadlock 聊天翻译模组。玩家不装任何本地进程/本地桥：模组是一个纯 Panorama VPK
(`pak91_dir.vpk`)，网络能力完全借助一个隐藏的 `CitadelHTMLPanel`(CEF) 面板加载
GitHub Pages 上的静态桥页面完成。

设计目标（按优先级）：

1. **尽可能简单** —— 用户明确要求。能不写的代码不写，能不碰的文件不碰。
2. **对局 HUD 零漂移** —— 不 shadow 游戏聊天布局（见 §6.2），只扫描 + 追加。
3. **绝不吞消息** —— 翻译失败/超时的降级路径永远放行原文。
4. **证据驱动** —— 每个 API/结构假设必须有：当前游戏反编译实证、参照模组生产实证、
   或活体日志实证三者之一。`typeof` 检查不算数（空壳桩先例）。

## 2. 系统总览

```
┌─ Deadlock (Panorama) ──────────────────────────────────────────────┐
│                                                                    │
│  hud.xml context（对局常驻）                                        │
│  ├─ lc_protocol.js  协议客户端(选举/状态机/分片/配置落盘)            │
│  ├─ lc_chat.js      消息钩子(收消息/顶栏/出站) ── LCTBridge.translate │
│  └─ LCTNet (CitadelHTMLPanel, 4×4px 隐藏)                           │
│        │  上行: SetURL(PAGE#q=JSON分片)  一次请求一次导航, 单槽      │
│        ▼                                                           │
└────────│───────────────────────────────────────────────────────────┘
         │ HTTPS
         ▼
┌─ GitHub Pages: app/d2a3dde88d180e5b/index.html (单文件桥页面) ──────┐
│  下行: document.title = "LCT3R/C/E:..." → Panorama HTMLTitle 事件   │
│  上游: edge.microsoft.com/translate/translatetext (免 Key, 主)      │
│        api.mymemory.translated.net            (免 Key, 兜底)        │
│  store: localStorage("lct:*") 配置持久层                            │
└────────────────────────────────────────────────────────────────────┘

跨 context(escape 菜单设置 UI ↔ 协议): 共享根面板属性
  lct_cfg(配置 JSON) / lct_status(状态文本) / lct_buildid(页面构建号)
```

通道事实（PROTOCOL.md §1-§4 有完整测量记录）：上行一次请求一次导航、单槽串行；
下行 `$.RegisterEventHandler("HTMLTitle", panel, fn)`；分片参数由 alive 帧广播
（当前 pad=1500/chunk=1200）；握手 4s×3 → OFFLINE 退避；队列 64、元素 TTL 30s。

## 3. 组件清单

| 文件 | context | 职责 |
|---|---|---|
| `mod/panorama/layout/hud.xml` | hud | 游戏当前版 `hud.vxml_c` 反编译底稿 + 仅追加 script include 与 LCTNet 样式引用 |
| `mod/panorama/layout/hud_escape_menu.xml` | escape | 游戏 `hud_escape_menu.vxml_c` 反编译底稿 + 设置窗口壳(静态声明) + 菜单入口按钮 |
| `mod/panorama/scripts/lc_protocol.js` | hud | 协议客户端：面板创建、SetURL/HTMLTitle 分片、hello/tr/store 超时状态机、选举、cfg 落盘、对外 `globalThis.LCTBridge` |
| `mod/panorama/scripts/lc_chat.js` | hud | 消息钩子：聊天窗扫描 + HUD 顶栏扫描 + 出站翻译（详见 §4） |
| `mod/panorama/scripts/lct_i18n.js` | escape | 界面文案表(zh/en)：无声明全局 `LCT_TEXT_I18N`/`LCT_STATUS_PREFIX`，纯数据零逻辑；必须先于 `lct_settings_ui.vjs_c` include（v2 `lingua_chat_i18n.js` 同法） |
| `mod/panorama/scripts/lct_settings.js` | escape | 窗口宿主：开/关、Esc 兜底、背景点击（QOLLOCK 生产模式，XML oncancel 不可靠的实证见文件头） |
| `mod/panorama/scripts/lct_settings_ui.js` | escape | 控件逻辑：读 `lct_cfg` 渲染、写回共享属性、下拉菜单、页脚状态灯；界面语言 `uiLang`(zh/en, 手选无自动探测)经双向查表填充全部静态文案/选项/状态文本 |
| `mod/panorama/styles/lct_settings.css` | escape | 设置窗口样式（必须与 UI 同 context include 才生效） |
| `mod/panorama/styles/lct_net.css` | hud | LCTNet 隐藏面板：`opacity:0.01` + `visibility:visible`（CEF 会暂停不可见面板的定时器） |
| `app/d2a3dde88d180e5b/index.html` | CEF | 桥页面：协议实现 + 翻译上游 + store；CSP 仅本源 + 两个免 Key 上游；不写 console；localStorage 仅收 `lct:` 前缀键 |
| `mod/build.ps1` | 本机 | 同步源码 → resourcecompiler → vpkeditcli 打包（§7） |

关键约束：**脚本上下文即面板树**。chat.xml 是游戏的自定义面板实例，其布局脚本
不执行（信标实证），所以所有逻辑只能住在 hud.xml / hud_escape_menu.xml 两个
context；对 `#ChatInput` 等游戏面板的跨 context 访问已被收消息管线长期实证。

## 4. 三条翻译管线

三条管线共享：script-signal 语言判定(§5)、文本去重(seen 500)、译文缓存(cache 300)、
单槽请求队列(64, TTL 30s, 重试 2)、在飞合并（同文本一行多 surface 只发一次桥请求）。

### 4.1 收入站 —— 聊天窗口（#ChatMessages）

- 轮询扫描（活跃 0.4s / 空闲 1.0s，`$.Schedule`），行级水位线 + 每轮尾部补扫 6 行
  （发送者名/内容延迟填充）+ 空行观察表（TTL 5s，气泡先建文后填的时序）。
- 行解剖（当前游戏 `chat.vxml_c` 逐字反编译）：
  `.ChatMessage > #SenderImage + .MessageBody > #MessageSource + #MessageContents`；
  译文标签挂 `.MessageBody`（flow-down，落在气泡下方）。
- 游戏回收复用行 → `row.__lctSig` 签名变化即 resetRowModState（清旧标签/折叠样式）。
- 客户端看门狗 12s：回调不回来就释放队列槽位。

### 4.2 收入站 —— HUD 顶栏（Team1Chat/Team2Chat）

对局中不开聊天框时顶部飘的气泡，游戏内置布局 `citadel_hud_top_bar_chat`：

- 实例：`CitadelHudTopBarChat id=Team1Chat/Team2Chat`（当前游戏
  `citadel_hud_top_bar.vxml` 实证，type 不是 class，FindChildrenWithClassTraverse
  找不到 → 只走固定 id 主路径）。
- 行解剖（2026-11-04 反编译）：`.ChatMessage > #ChatArrow + #MessageContents >
  .ChatBubble > .TextContainer > .MessageWrapper > #MessageText(html="true")`；
  无 MessageSource/SenderName。
- 与聊天窗行的判别：`.ChatBubble` 在场 = HUD 行。快捷轮盘行的结构标记是
  `#PingStyleIcon`(+SubjectIcon/CooldownTimer/ResponseHeroes)，**不是**
  Ping/PingLabel（v2 2026-10-02 实车教训）。
- 译文标签挂 `#MessageContents`（游戏 CSS flow-down → 气泡正下方；挂 ChatBubble
  会进横向流被挤出）；`translation_only` 模式折叠 `.ChatBubble` 而非 contents
  （标签住在 contents 里，折父级会把译文一起藏掉）。
- 每容器独立水位线；容器数变化（进对局 0→2）即重建水位线并记日志。

### 4.3 出站（发送前翻译）

v2 用 chat.xml shadow 换 `oninputsubmit` 属性；v3 不做 shadow，改为 hud context
对 `#ChatInput`（游戏 chat.xml 的 TextEntry）`SetPanelEvent("oninputsubmit", hook)`。
API 在本 build 的实证：DLMusic/QOLLOCK 反编译源同款用法；替换语义（非叠加）
已由活体日志证实（每次提交恰好一条 out sent）。

流程：

1. 跳过判定（按下顺序）：禁用 / `outgoing=off` / `/`、`!` 命令 / 无字母 /
   **已是发送目标语言**（`isTargetLanguageText(text, cfg.outgoingTarget)`——
   必须显式传发送目标；入站 zh + 出站 en 的配置下传错会白跑 en→en，2026-11-04
   实车教训）。跳过 = `input.text` 原样 → 派发事件。
2. 待翻：立即清空输入框（防重复整条输入）→ `LCTBridge.translate`。
3. 发送（poker 生产配方）：`input.text = 文本` →
   `$.DispatchEvent("CitadelChatInputSubmitted", input)` → 清空 →
   `DropInputFocus`（原生 onblur 链自己走 CitadelChatInputBlur）。
4. 降级（绝不吞消息）：翻译 3s 看门狗超时 → 原文照发，序号计数器使迟到回调作废；
   同文本重复 Enter → 原样立即发；桥报错/译文未变 → 原文。
5. 双语模式拼 `原文 | 译文`，>400 字符截译文加省略号（原文永远完整）。

等待期间用户已输入的新文字在发送后恢复，不抢焦点。

## 5. 语言判定（script-signal 矩阵）

不引库、不猜编码，用文字系统的铁证信号：

| 文字系统 | 判定 | 信号正则 |
|---|---|---|
| 日语 | kana 出现即 ja | `\u3040-\u30ff`（假名在中文文本里不可能出现） |
| 韩语 | hangul | `\uac00-\ud7af` |
| 俄语 | cyrillic | `\u0400-\u04ff` |
| 中文 | han | `\u3400-\u4dbf\u4e00-\u9fff` |
| 西/法/德 | 带变音符的拉丁字母 | `\u00c0-\u00ff` |
| 英语 | 纯 ASCII 字母 | 兜底 |

跳过规则：**目标语言的特征信号在场，且没有其他文字系统的字母在场** → 跳过；
混排一律送翻。`detectSourceCode()` 对纯文本发显式源（ja/ko/ru/zh-CN/en），
混排发 auto——因为兜底上游 MyMemory 的自动检测不可靠。

## 6. 关键工程决策与证据

| # | 决策 | 证据 | 失败形态（当时的最大风险） |
|---|---|---|---|
| 1 | 桥接架构（远程静态页 + CEF 面板） | 6726 版本把声明层外部 URL 清零、JS 网络通道全灭（census）；`CitadelHTMLPanel` 的 SetURL/HTMLTitle 是 probe 实测唯一存活通道 | 无网络 → 全功能不可用（已排除） |
| 2 | 不 shadow chat.xml，逻辑全住 hud.xml | chat.xml 是游戏自定义面板实例，其布局脚本不执行（信标实证）；且 shadow 漂移 = 整个聊天 FATAL | 收不到消息 → 改用 hud context 轮询 DOM（v2 生产同款） |
| 3 | `$.Time()` 不可用，全部 `nowMs()` 守卫 | 6726 后 `$.Time` 缺失致 boot TypeError（探针实证） | 协议全死 → Date.now 封装 |
| 4 | 协议单实例跑 hud context | escape 的隐藏 context 实例同样能赢选举，但主角色落在不可控的隐藏树 | 双实例互踢 → 选举保留作互斥兜底 |
| 5 | 出站钩子 = 跨 context `SetPanelEvent("oninputsubmit")` | DLMusic/QOLLOCK 反编译同款 API；替换语义活体实证 | 钩子不生效 → 出站静默失效，收消息不受影响 |
| 6 | 发送配方 = poker 的 input.text + DispatchEvent | `references/poker_chat_debug.js` flushRequestedChat 生产在跑 | 双发/吞消息 → 活体验证恰好一条 |
| 7 | 设置窗口静态声明 + 属性通道 | QOLLOCK 反编译：BLoadLayout 0 次、被隐藏窗口占 MenuBack 焦点使 XML oncancel 失效 | 设置不可交互 → XML 兜底 + `$.LCTUI*` 守卫 |
| 8 | 诊断走 condebug 日志不上屏 | `$.Msg` → `game\citadel\console.log` 活体验证（`[PanoramaScript] [LCT]` 行） | 玩家可见调试残留 → 已拆除画面信标 |
| 9 | 布局底稿逐字对齐当前游戏反编译 | 每次游戏更新都需重比（hud.xml 头注释写明维护纪律） | HUD 全灭 → 构建前 diff |

历史包袱说明：v2（`F:\BabelTower`）靠 chat.xml/hudchat.xml shadow + BTIPC 直连，
6726 后全灭。v3 的架构差异都是**从那堆废墟里长出来的**，v2 源码保留作为移植参照
（HUD 扫描 ~3485-3600 行、出站 ~3690-3930 行）。

## 7. 构建与部署工作流

依赖（全部本地已有，禁止下载）：`F:\dev-tools\Reduced_CSDK_12`（resourcecompiler）、
`F:\dev-tools\VPKEdit`（vpkeditcli）。

```
1. 语法门禁   node --check mod/panorama/scripts/*.js
2. 构建       powershell -ExecutionPolicy Bypass -File mod\build.ps1
              [1/3] mod/ → CSDK content/citadel_addons/lctskeleton
              [2/3] resourcecompiler → .vxml_c/.vjs_c/.vcss_c
              [3/3] vpkeditcli → dist/pak91_dir.vpk（输出树里确认文件数）
3. 部署窗口   Get-Process project8,deadlock —— 游戏运行中则推迟
              （运行中覆盖 VPK 会导致资源系统读到半截文件）
4. 部署       Copy dist\pak91_dir.vpk →
              C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\
5. 提交       commit message 写进 C:\Users\kali1\AppData\Local\Temp\opencode\
              lc_commit_msg.txt 再 git commit -F（多段 message 的既有做法）
```

桥页面独立部署：`app/` 随仓库 push 由 GitHub Pages 自动发布；页面构建号
`BUILD_ID` 出现在 alive 帧与设置页脚，改页面必改它（缓存诊断锚点）。

## 8. 验证方法学

- **唯一算数的验证 = 用户在真实对局里打的文本**。模组自报走 condebug 日志：
  游戏带 `-condebug` 启动时 `$.Msg` 落
  `C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\console.log`，
  行首 `[PanoramaScript] [LCT]`。抓取命令与轨迹对账表见 [DEBUG.md](DEBUG.md)。
- 出站日志轨迹：`outgoing hook installed` → `out request <src>-><tgt> (<mode>)` →
  `out sent [<mode>]` / `out skip (<reason>)` / `out unavailable
  (no_response|<code>|unchanged|empty) -> original` / `out dedupe` /
  `out watchdog 3s -> original`。
- 配置变更留痕：`cfg applied`（boot 默认值）、`persisted cfg loaded`（store 回载）、
  `cfg adopted (external)`（设置窗口改动被协议采纳）——排查"测试中途配置被改过"
  的必备线索（en→en 事件的教训）。
- 注意：日志里中文显示为问号是 PowerShell 代码页问题，纯显示层，功能无损。
- 2026-11-04 已实车验证：收入站全部目标语言、出站双语/跳过（真实配置
  入站 zh-Hans + 出站 en）、HUD 顶栏容器发现（`watching HUD top bar chat (2)`）、
  设置窗口布局。HUD 顶栏译文标签的目验仍待一条真实外语消息。

## 9. 已知限制与路线图

| 项 | 状态 | 说明 |
|---|---|---|
| quickchat 模板库 | 未移植 | 快捷轮盘消息（"进攻 X 点"类）游戏已本地化，翻译是劣质重复；v2 有现成模板库 `lingua_chat_quickchat_fallback.js` 可收敛移植。当前行为：仅"已是目标语言"时跳过 |
| 专名保护 | 未实现 | 英雄/装备/地名不送翻（v2 `replaceGameNames` + 指纹名单可参照） |
| MyMemory 回声护栏 | 未实现 | 兜底上游偶发原样返回（含原文回显），现靠 "unchanged → 原文放行" 兜底 |
| 单槽队列吞吐 | 可接受 | 一次一个桥请求；刷屏场景靠合并 + TTL 丢弃，实测无感 |
| 游戏更新漂移 | 持续风险 | 每次更新后必须重比 hud.xml/chat.xml/顶栏布局反编译（§6.9） |

## 10. 仓库地图

```
app/        桥页面（GitHub Pages 提供，单文件）
mod/        模组源码 + build.ps1（§3 组件清单）
dist/       构建产物 pak91_dir.vpk（gitignore）
probe/      CEF 通路探针（协议事实测量工具，已使命完成，留作回归量具）
docs/       PROTOCOL.md（协议规格）/ DEBUG.md（调试）/ 本文
test/sim/   桥页面仿真工具（.omre review 期产物）
_reference/ v2/参照模组资料镜像
_build_check/ 当前游戏反编译底稿（证据基线，勿手改）
```
