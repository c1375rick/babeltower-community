# 隐蔽调试探针（-condebug 日志）

画面信标已拆除。诊断不再上屏，全部走游戏控制台日志——玩家不可见，维护时随时可查。

## 通道原理

模组所有诊断行经 `$.Msg()` 输出到游戏控制台。游戏以 `-condebug` 启动时，
控制台内容落盘到：

```
C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\console.log
```

行格式（实测 2026-11-04）：

```
11/04 16:03:21 [PanoramaScript] [LCT][Chat] loaded (hud context message hook)
11/04 16:03:21 [PanoramaScript] [LCT][Proto] boot tag=Hud.1793779401386.1
11/04 16:03:21 [PanoramaScript] [LCT][Proto] cfg applied: {"enabled":true,...
```

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
| `[LCT][TabUI]` | lct_settings_ui.js | 设置窗口 UI |
| `[LCT][Settings]` | lct_settings.js | 设置窗口宿主 |

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
