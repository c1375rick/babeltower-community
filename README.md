# BabelTower Community

Deadlock 聊天翻译模组(桥接式架构:游戏 Panorama ↔ 远程静态页,无本地进程、无本地桥)。

## 结构

| 路径 | 内容 |
|---|---|
| `docs/ARCHITECTURE.md` | 技术文档：组件、数据流、工程决策及证据、构建/验证工作流 |
| `docs/PROTOCOL.md` | v3 协议规格(上行 fragment / 下行 HTMLTitle 四帧 / store 持久化 / 安全边界) |
| `docs/DEBUG.md` | 调试指南：-condebug 日志探针、[LCT] 标签、出站翻译轨迹对账 |
| `app/d2a3dde88d180e5b/` | 桥页面(部署于 GitHub Pages,协议实现 + `store.*` 持久层 + 翻译上游) |
| `mod/` | 模组本体源码(Panorama layout/scripts + `build.ps1` 编译打包) |
| `probe/` | CEF 通路探针(协议事实的测量工具,见 PROTOCOL.md §1) |

## 构建

依赖:`F:\dev-tools\Reduced_CSDK_12`(resourcecompiler)与 `F:\dev-tools\VPKEdit`(vpkeditcli)。

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
