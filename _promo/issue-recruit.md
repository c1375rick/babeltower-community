## 我们需要你

这个 mod 的全部存活成本，是**每次游戏更新后重对 chat.xml 底稿**——流程已脚本化，半小时级，但一个人扛不长。想组一个值班梯队 + 功能贡献者。

## 项目现状

- v1.0.0 已发布（[Releases](https://github.com/c1375rick/babeltower-community/releases)，窄面架构，与任何 HUD mod 零交集共存）
- 技术文档完备：架构/协议/调试/兼容四篇，证据链式写作（每条结论有实测/反编译出处）
- 探针方法论成熟：零依赖信标 + graft 脚本，游戏更新后的重对流程可复用

## 想要的角色

| 角色 | 做什么 | 门槛 |
|---|---|---|
| **值班维护者**（最缺） | 游戏更新后跑 chat.xml 重对流程（[COMPATIBILITY §7](docs/COMPATIBILITY.md)） | 会用命令行 |
| Panorama/CEF 开发 | 功能：更多翻译上游、界面语言、UI | 读得懂 JS/XML |
| 测试/文档 | 新版本实测、文档英文化 | 会打游戏会写字 |

## 为什么值得来

- Source 2 Panorama 逆向的完整实战现场（脚本/CEF/VPK 工具链）
- **证据链工程文化**：结论必须实证，包括推翻自己错误判决的完整存档（[ARCHITECTURE §6 决策 2](docs/ARCHITECTURE.md)）
- 现成武器库：探针信标、graft 脚本、日志轨迹对账表，全部可复用

## 入口

[CONTRIBUTING.md](CONTRIBUTING.md) —— 环境搭建（工具链公开渠道）、维护流程、好的第一个任务。

不写代码也欢迎：issue 里报 bug 附 `-condebug` 日志就是最大贡献。

---

*EN: We're looking for maintainers — especially for post-update chat.xml re-alignment (scripted, ~30 min after each game patch). See CONTRIBUTING.md. If Source 2 internals interest you, the docs are a good read.*
