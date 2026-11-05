# 招募文案（中文版）—— NGA / Bilibili / 小黑盒 / Deadlock 中文社区

> 用途：直接复制发帖。发帖时把"仓库地址"替换为完整 URL。
> 建议配图：游戏内双语聊天截图 / Esc 设置页截图 / Release 页面截图。

---

**标题**：[Deadlock 聊天翻译 mod] 招维护者——项目活着只差每次版本更新后的半小时

**正文**：

做了个 Deadlock 聊天翻译 mod（BabelTower Community），开源在 GitHub，现在找几个维护者一起扛。

**它能干嘛（玩家视角）**：
- 聊天窗和顶栏气泡**双语显示**，外国人说的日语俄语西语自动翻成中文
- 你发中文可以自动翻成对方语言再发出去（可关；翻译失败绝不吞消息，原文照发）
- Esc 菜单里有设置页：目标语言、显示模式、界面语言（中/英）
- **没有本地进程、没有本地服务**，不用开任何额外软件
- 和 QOLLOCK 等任何 HUD mod 直接共存，不用合并补丁

下载：仓库 Releases 页 → `pak03_dir.vpk` → 丢进 `game\citadel\addons\`，完事。
仓库地址：https://github.com/c1375rick/babeltower-community

**为什么招人**：这 mod 的全部存活成本 = **每次游戏更新后重对 chat.xml 底稿**。
Valve 改了原版布局而底稿没跟上，游戏会直接崩（FATAL 级）。流程已经脚本化，
有人值班的话就是"更新日跑一遍脚本 + 进游戏验一圈"，半小时的事——
但一个人扛不长，需要梯队。

**来能干嘛 / 能学到什么**：
- Source 2 Panorama 逆向（Panorama 脚本、CEF 面板、VPK 工具链）
- 这里的文档文化是**证据链式**的：每条结论必须有实测/反编译/二进制出处，
  包括我们用零依赖探针推翻自己一次错误死刑判决的完整过程（ARCHITECTURE.md）
- 现成的可复用武器库：探针信标、graft 脚本、日志轨迹对账表

**想要的人**：
- 会用命令行就行（值班维护者路线，CONTRIBUTING.md 有完整流程）
- 或者读得懂 JS/XML 想搞功能（翻译上游、界面语言扩展、UI）
- 或者纯测试/文档（会打游戏会写字就够）

兴趣的话直接 GitHub issue 或者回帖私我。AGPL-3.0 开源，人来去自由。

---

## 英文版 —— Reddit r/DeadlockTheGame / Steam 论坛

> 英文区以玩家价值为主、招募为辅（英文区玩家多、贡献者少）。

**Title**: [Release] BabelTower — in-game chat translation (bilingual display + outgoing translation), open source, works alongside any HUD mod

**Body**:

Deadlock lobbies are a UN meeting. This mod translates chat in-game:

- **Incoming**: chat window and HUD toasts render bilingual (original + your language). Detects JP/KR/RU/ZH/ES/FR/DE/EN by script signals.
- **Outgoing**: type in your language, it translates before sending (optional; on failure your original text is sent untouched — messages are never eaten).
- **No extra software**: no local process, no local server. The UI is pure Panorama; translation goes through an embedded CEF panel to a static bridge page.
- **Mod-friendly**: only overrides `chat.xml`, so it coexists with QOLLOCK and any HUD mod. No merged patches needed.

Download from GitHub Releases: drop `pak03_dir.vpk` into `game\citadel\addons\`. That's it.
Repo: https://github.com/c1375rick/babeltower-community (AGPL-3.0)

FAQ:
- *Does Valve ban this?* It's a client-side UI overlay in the Panorama layer — same modding surface the community already uses (QOLLOCK etc.). No network protocol changes, no gameplay data touched.
- *What languages?* Any target the bridge upstreams support; UI is zh/en for now (translations welcome).

And yes — we're looking for maintainers, especially for post-update layout re-alignment (scripted, ~30 min after each game patch). CONTRIBUTING.md has the full workflow. If Source 2 internals interest you, the docs are... a lot. In a good way.
