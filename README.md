# BabelTower Community

Deadlock 聊天翻译模组(桥接式架构:游戏 Panorama ↔ 远程静态页,无本地进程、无本地桥)。

[![Release](https://img.shields.io/github/v/release/c1375rick/babeltower-community?label=%E4%B8%8B%E8%BD%BD)](https://github.com/c1375rick/babeltower-community/releases/latest)
[![License](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue)](LICENSE)
[![Game](https://img.shields.io/badge/Deadlock-2026--11--05%20build-orange)](https://github.com/c1375rick/babeltower-community/releases/latest)

> **English TL;DR** — Chat translation mod for Deadlock (a Source 2 game).
> Incoming messages render bilingual in the chat window and HUD toasts;
> outgoing messages can be auto-translated. No local process or server:
> the UI runs inside Panorama and talks to a static bridge page over CEF.
> Works alongside any HUD mod (it only overrides `chat.xml`).
> **We are looking for maintainers** — see [CONTRIBUTING.md](CONTRIBUTING.md).

## 功能

- **入站翻译**:聊天窗 + HUD 顶栏气泡双语显示,原文/译文同行
- **出站翻译**:发中文自动翻成对方语言后发出(可关,翻译失败绝不吞消息)
- **语言检测**:日/韩/俄/中/西法德/英特征信号正则,目标语言在场自动跳过
- **设置页**:Esc 菜单入口,目标语言/显示模式/出站开关/界面语言(中/英)
- **零依赖运行**:无本地进程无本地服务,翻译经 CEF 面板走远程桥页面

## 安装(玩家)

1. 从 [Releases](https://github.com/c1375rick/babeltower-community/releases/latest) 下载 `pak03_dir.vpk`
2. 复制到 `SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\`
3. 完事。与 QOLLOCK 等任何 HUD mod 文件面零交集,直接共存,无需合并补丁
4. (可选)诊断:Steam 启动项加 `-condebug`,日志落 `game/citadel/console.log`([LCT] 标签,见 [docs/DEBUG.md](docs/DEBUG.md))

## 招募维护者

> 这个 mod 的全部存活成本,是**每次游戏更新后重对 chat.xml 底稿**——
> 一个人扛得动但扛不长。想找个值班梯队。

| 需要的角色 | 做什么 | 门槛 |
|---|---|---|
| 值班维护者 | 游戏更新后反编译比对 chat.xml、跑重对流程(现成脚本,半小时级) | 会用命令行即可,流程有文档 |
| Panorama/CEF 玩家 | 功能扩展:更多翻译上游、界面语言、UI 打磨 | 读得懂 JS/XML |
| 测试/文档 | 新版本实测、文档英文化 | 会打游戏、会写字 |

为什么值得加入:这里有一套**证据链工程文化**——结论必须实证(反编译/二进制/游戏实测),
维护文档精确到"为什么不行"而不是"应该行";你会接触到 Source 2 Panorama 逆向、
CEF 桥接协议设计、VPK 工具链和一套可复用的零依赖探针方法论
(我们用它推翻过一次自己的错误死刑判决,全程存档在案)。

入口:[CONTRIBUTING.md](CONTRIBUTING.md)(环境搭建、维护流程、第一个任务)。

## 结构

| 路径 | 内容 |
|---|---|
| `docs/ARCHITECTURE.md` | 技术文档：组件、数据流、工程决策及证据、构建/验证工作流 |
| `docs/PROTOCOL.md` | v3 协议规格(上行 fragment / 下行 HTMLTitle 四帧 / store 持久化 / 安全边界) |
| `docs/DEBUG.md` | 调试指南：-condebug 日志探针、[LCT] 标签、出站翻译轨迹对账 |
| `docs/COMPATIBILITY.md` | 兼容性档案：QOL 共存史、合并包退役记录、游戏更新后重对流程(§7) |
| `app/d2a3dde88d180e5b/` | 桥页面(部署于 GitHub Pages,协议实现 + `store.*` 持久层 + 翻译上游) |
| `mod/` | 模组本体源码(Panorama layout/scripts + `build.ps1` 编译打包) |
| `probe/` | CEF 通路探针(协议事实的测量工具,见 PROTOCOL.md §1) |
| `_compat/` | 合并兼容包(已退役,历史档案)+ 零依赖探针判决实验(`probe/`) |

## 构建

依赖:`F:\dev-tools\Reduced_CSDK_12`(resourcecompiler)与 `F:\dev-tools\VPKEdit`(vpkeditcli)。
外部贡献者见 [CONTRIBUTING.md](CONTRIBUTING.md) 的公开获取渠道。

```powershell
powershell -ExecutionPolicy Bypass -File mod\build.ps1
```

产物 `dist/pak03_dir.vpk`,复制到 `game/citadel/addons/` 即可。

## 桥页面

`app/d2a3dde88d180e5b/index.html` 为单文件实现:CSP 只放行本源与两个免 Key 上游
(`edge.microsoft.com` / `api.cognitive.microsofttranslator.com` / `api.mymemory.translated.net`),
不写 console,localStorage 仅接受 `lct:` 前缀键。

## 许可证

以 [GNU AGPL-3.0](LICENSE)(v3 或更新版本,SPDX: `AGPL-3.0-or-later`)发布。

- **选 AGPL 的原因**:本项目的桥页面是**网络服务**(GitHub Pages)。AGPL §13
  的远程网络交互条款要求任何架设修改版桥页面的运营者向其用户提供对应源码——
  这正是把最严格 copyleft 用在刀刃上。
- **传承**:包含自 BabelTower v2(GPL-3.0,独立实现)收敛移植的代码;
  AGPL-3.0 §13 允许将 GPLv3 作品并入本许可证之下。参照过的公开项目
  (poker/Apache-2.0、bing-translate-api/MIT、DLCT)仅借鉴技术思路,未复制代码。
- **游戏素材**:`mod/panorama/layout/` 中为互操作而保留的《Deadlock》反编译
  布局结构片段,版权归 Valve Corporation 所有,不属于本许可证的授予范围。
  本项目与 Valve 无关,未经 Valve 认可。
