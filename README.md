# BabelTower Community

Deadlock 聊天翻译模组(桥接式架构:游戏 Panorama ↔ 远程静态页,无本地进程、无本地桥)。

## 结构

| 路径 | 内容 |
|---|---|
| `docs/PROTOCOL.md` | v3 协议规格(上行 fragment / 下行 HTMLTitle 四帧 / store 持久化 / 安全边界) |
| `app/d2a3dde88d180e5b/` | 桥页面(部署于 GitHub Pages,协议实现 + `store.*` 持久层 + 翻译上游) |
| `mod/` | 模组本体源码(Panorama layout/scripts + `build.ps1` 编译打包) |
| `probe/` | CEF 通路探针(协议事实的测量工具,见 PROTOCOL.md §1) |

## 构建

依赖:`F:\dev-tools\Reduced_CSDK_12`(resourcecompiler)与 `F:\dev-tools\VPKEdit`(vpkeditcli)。

```powershell
powershell -ExecutionPolicy Bypass -File mod\build.ps1
```

产物 `dist/pak91_dir.vpk`,复制到 `game/citadel/addons/` 即可。

## 桥页面

`app/d2a3dde88d180e5b/index.html` 为单文件实现:CSP 只放行本源与两个免 Key 上游
(`edge.microsoft.com` / `api.cognitive.microsofttranslator.com` / `api.mymemory.translated.net`),
不写 console,localStorage 仅接受 `lct:` 前缀键。
