# 隐蔽调试探针（-condebug 日志）

画面信标已拆除。诊断不再上屏，全部走游戏控制台日志——玩家不可见，维护时随时可查。

## 通道原理

模组所有诊断行经 `$.Msg()` 输出到游戏控制台。游戏以 `-condebug` 启动时，
控制台内容落盘到：

```
C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\console.log
```

行格式（实测 2026-11-05，v3 窄面首个验收会话）：

```
11/05 12:47:19 [PanoramaScript] [LCT][Chat] loaded (hud context message hook)
11/05 12:47:19 [PanoramaScript] [LCT][Chat] hook up (bridge ready, cfg.target=zh-Hans)
11/05 12:47:19 [PanoramaScript] [LCT][Settings] page host ready (chat.xml context; page loaded by lct_boot)
11/05 12:47:19 [PanoramaScript] [LCT][Boot] boot
11/05 12:47:19 [PanoramaScript] [LCT][TabUI] settings UI boot
11/05 12:47:19 [PanoramaScript] [LCT][Proto] boot tag=Chat.1793854039850.1
11/05 12:47:19 [PanoramaScript] [LCT][Proto] cfg applied: {"enabled":true,"targetLanguage":"zh-Hans",...
11/05 12:47:19 [PanoramaScript] [LCT][Chat] watching ChatMessages (target=zh-Hans)
11/05 12:47:19 [PanoramaScript] [LCT][Chat] watching HUD top bar chat (2)
```

（`loaded (hud context message hook)` 是窄面迁移时的陈旧字面量，下一构建改为
chat context；boot tag 前缀 = 所在 context 面板 id，窄面后由 `Hud.*` 变 `Chat.*`。）

注意：`con_logfile` 控制台命令改的日志文件**抓不到** PanoramaScript 行
（v2 实证）；只有 `-condebug` 启动参数生成的默认 `console.log` 有它们。

## 一次性设置（v2 用户已完成）

Steam 库 → Deadlock 右键 → 属性 → 常规 → 启动选项 → 填 `-condebug`。
不带此参数游戏不生成 console.log，日志探针静默失效（其余功能不受影响）。

## 标签前缀

| 前缀 | 来源 | 内容 |
|---|---|---|
| `[LCT][Proto]` | lc_protocol.js | 协议：boot、选举、握手（alive build=）、OFFLINE、store、配置采纳 |
| `[LCT][Chat]` | lc_chat.js | 收消息钩子：watching/retry/failed + **出站翻译全流程** |
| `[LCT][Boot]` | lct_boot.js | Esc 菜单注入器 + 设置页装载器（宿主就绪、按钮注入） |
| `[LCT][TabUI]` | lct_settings_ui.js | 设置窗口 UI |
| `[LCT][Settings]` | lct_settings.js | 设置窗口宿主（含焦点归还：`focus returned to escape menu`） |

`[LCT][TabUI]` 关键锚点（Build 10931 内联退役后新增）：

```
controls bound: toggles=3 selects=5 options=24 [MISSED=N]
```

每次设置页装载后由 `LCTUIBindControls` 打出。toggles/selects/options
是确定性绑定成功的控件数（满额 3/5/24）；出现 `MISSED=` 即"选项文本
↔ LABELS 匹配"有漏网（通常 = 本地化表与 XML 选项文本不同步，或绑定
先于 applyTexts 的时序倒挂），此时对应下拉的选项点了没反应。开关和
点击动作本身无独立日志——判"控件死活"以本行为准。

### 探针标签（历史实验，生产包不产生）

`[LCTPROBE]` / `[LCTPROBE2]` 来自 `_compat/probe/` 两代信标（2026-11-05 窄面
判决实验，beacon/beacon2）。仅在探针包部署期间出现在 console.log 里；
生产构建（pak03 v3）永不输出这些行——旧日志里见到即探针会话，勿与
`[LCT]` 生产轨迹混淆。里程碑含义：M1 = chat context 脚本执行（ctx 链打印）；
M2 = `#ChatMessages` 可达；M3 = 绝对根建宿主；M4 = SubOptions 直达 +
Esc 菜单按钮注入；M5 = BLoadLayout 设置页渲染/关闭；M6 = CEF 传输
（SetURL → HTMLTitle 回收）。判决链存档见 ARCHITECTURE.md §6 决策 2。

## 出站翻译的日志轨迹（排查时按此对账）

正常路径（目标 en，输入中文）：

```
[LCT][Chat] outgoing hook installed (SetPanelEvent oninputsubmit on #ChatInput)
[LCT][Chat] out request zh-CN->en (translation): 你好
[LCT][Chat] out sent [translation]: hello
```

放行路径（不该翻的不翻）：

```
[LCT][Chat] out skip (command): /team_mid
[LCT][Chat] out skip (already-target): gg wp
```

降级路径（绝不吞消息）：

```
[LCT][Chat] out dedupe: same text pending -> verbatim      同文本重复 Enter
[LCT][Chat] out watchdog 3s -> original                    翻译 3s 未回
[LCT][Chat] out unavailable (TIMEOUT) -> original          桥报错
```

## 快速抓取

PowerShell：

```powershell
Select-String -Path "C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\console.log" -Pattern "LCT" |
  Select-Object -Last 50 | ForEach-Object { $_.Line }
```

报 bug 时贴最后 50 行即可覆盖最近一局的完整行为轨迹。
