# 与其他模组的兼容性(QOL Lock 共存方案)

> **状态**:追加式 · **最后核对**:2026-11-04
> **证据口径**:双方 VPK 清单实测、QOLLOCK 反编译源码(`window.js`/布局 XML)、本机 `gameinfo.gi` + `.dmm.json`、三处独立社区文档交叉印证(见 §3)。
> **一句话**:与 QOL Lock 的硬冲突只有 2 个同名布局文件;解法 = 槽位规则 + 合并布局兼容包 + 运行时背景钩子 QOL-aware 分支(已实现)。不装 QOL 时什么都不用做。

---

## 1. 结论速览

| 问题 | 结论 |
|---|---|
| 文件冲突面 | **恰好 2 个**:`panorama/layout/hud.vxml_c` + `hud_escape_menu.vxml_c`(QOL 共 74 文件,其余不撞名) |
| 符号冲突 | 零(我们全 `LCT*` 前缀;QOL 用未加前缀的 `$.ToggleSettingsWindow` 等) |
| 功能冲突 | 零(QOL 的聊天翻译是作者个人原型,对其他用户是死代码,见 §2) |
| Esc/背景点击 | 可组合(双方都监听 `CitadelResumePlaying` 自关窗;合并布局下由我们的 QOL-aware 分支兜底,见 §5) |
| 解决方案 | 槽位规则(§4.3)+ 合并布局兼容包(§4.2)+ 代码侧分支(已实现) |

---

## 2. 冲突矩阵

| 维度 | QOL Lock | 本 mod | 冲突 |
|---|---|---|---|
| 覆盖的游戏文件 | 74 个,含 `hud.vxml_c`、`hud_escape_menu.vxml_c` | 同样只 shadow 这 2 个游戏布局文件 | **撞名 = 这 2 个** |
| 样式文件 | 改 `styles_base_hud/styles_hud/styles_hud_escape_menu.vcss_c`(游戏样式) | 自有 `lct_net.vcss_c` + 自定义 `LCT` 类 | 零(不在同一文件) |
| `$` 全局函数 | `$.ToggleSettingsWindow` / `$.ForceCloseModSettings` / `$.IsModSettingsOpen`(未加前缀) | `$.LCTToggleSettingsWindow` / `$.LCTCloseSettingsWindow` / `$.LCTIsSettingsOpen` | 零 |
| 面板 id | `SettingsWindow` / `ModSettingsBtn` 等 | `LCTSettingsWindow` / `LCT*` | 零 |
| CEF 存储桥 | `QOLStorageBridge`(escape menu context) | `LCTNet`(hud context) | 零 |
| Esc root oncancel | 双方都**不改 XML 原文**,全部运行时 `SetPanelEvent` 挂钩 | 同左 | 零 |
| `CitadelResumePlaying` | `window.js:2249` 注册监听,菜单关闭时自关窗 | `hookResumeEvent` 同款 | 可组合(都关自己的窗) |
| 聊天翻译 | `ql_chat_translate/manifest.js`:硬编码 `OWNER_ACCOUNT_ID = "841196165"`(作者本人)+ 本机 `127.0.0.1:8765` 服务 | 完整翻译管线 | **零**(该功能对任何其他用户是死代码) |

---

## 3. 同名文件裁决规则(实证)

1. **低编号 pak 胜出**:`pak01_dir.vpk` 压 `pak05_dir.vpk`。三处独立社区文档一致:
   - Divine Skins Wiki《Install mods without a manager》:"When two mods change the same file, the lower number wins: pak01_dir.vpk beats pak05_dir.vpk."
   - deadlockmodding.pages.dev《Installing Mods》:"Mods with lower numbers have higher priority."
   - Deadlock Mod Manager 文档:"When two mods replace the same file, only one version can load, and the mod order decides which one."
2. **命名硬规则**:`pak01_dir.vpk` ~ `pak99_dir.vpk`(两位数);`pak1_dir.vpk`、`pak00`、`pak100`、子目录内、其他文件名一概不加载。
3. **搜索路径**:`gameinfo.gi` 的 `Game citadel/addons` 一条路径装**全部** mod(本机实测,DMM 维护的块)。所以合并兼容包里的 XML 引用双方脚本时,直接走各自 pak 的自有文件即可——XML 在兼容包,脚本仍在 pak91 / QOL 自己的 pak。
4. **gameinfo.gi 会被重置**:每次游戏更新、每次 Steam「验证完整性」都还原官方版,addons 行消失 → 所有 mod 静默失效(DMM 会自动补回)。
5. **输家死法**:同名文件只能活一个 → 输家整个文件(含全部 script include)消失 → **整个 mod 静默死亡,无任何报错**。这就是"装了 QOL 后 BabelTower 消失"的机制,不是加载顺序玄学。
6. **`.dmm.json` 才是事实源**(LEARNINGS 2026-09-25 槽位登记状态机事故):磁盘有文件 ≠ 已安装;`<modid>_pakNN_dir.vpk` 前缀名 = 禁用态不加载;**改名/换槽前必查登记表**。

---

## 4. 共存安装

### 4.1 安装矩阵

| 场景 | 结果 | 动作 |
|---|---|---|
| 只装本 mod | 正常 | 无 |
| 只装 QOL | 正常 | 无 |
| 都装,无合并包 | 同名文件二选一(低槽胜),另一方**静默死亡** | 必须做 §4.2 |
| 都装 + 合并包(槽位更低) | 双方都活 | 合并包槽位 < QOL 最低槽 |

### 4.2 合并布局兼容包(推荐方案)

**设计**:超集 = 当前游戏底稿 + 本 mod 插入 + QOL 插入。

- QOL 的 `hud.xml` 相对游戏底稿**只加 include、不加面板**(实测 diff:2 条样式 include + ~82 条脚本 include + 1 行 `GlobalClassListener`;唯一结构差异是旧底稿缺 `gMinimapTargeting`,属游戏版本漂移非 QOL 特性)→ 合并 = 我们的 `hud.xml` + QOL 的 include 行。
- `hud_escape_menu.xml` 另需 graft:QOL 的窗口面板 + 入口按钮 + `QOLStorageBridge` + 样式 include(参考反编译件 `_reference/hud_escape_menu_qollock.xml`)。
- 本 mod 的 XML 内所有插入行都带 `<!-- BabelTower: ... -->` 标记注释,机器可定位。
- **兼容包只含这 2 个 XML**;双方其余文件从各自 pak 加载(§3.3)。

**构建步骤**(需要时执行):

1. 用 `F:\dev-tools\Source2Viewer-CLI-20.1` 反编译**当时实际安装的 QOL VPK** 的两个 `vxml_c`——历史参考件基于旧游戏底稿,直接用 = 漂移。
2. 反编译当前游戏 `pak01` 的同名文件,与我们的 shadow XML 比对(漂移 = FATAL,先重对底稿)。
3. 以我们的 XML 为基底,插入 QOL 的 include/面板行(避开 `BabelTower:` 标记区)。
4. 打包为**低槽位** VPK(§4.3),只含两个 XML。

### 4.3 槽位选择

- 合并包编号必须 **< QOL 安装的最低槽**(QOL 历史打包占 pak04–pak92 一串)。
- 本机 pak01(GB 563116)等已被占用 → **可用区间 pak02–pak03**,以安装当日 `addons/.dmm.json` 登记为准。
- DMM 的「Load first/排序」本质 = 改名重排 vpk 编号,同样服从低编号规则;手工安装则直接挑空闲低号。

---

## 5. Esc / 背景点击行为(合并布局下)

`SetPanelEvent` 是**替换语义**:合并布局里后执行的脚本独占 `EscapeBackground.onactivate`。因此 `lct_settings.js` 的 `hookBackground` 处理分支覆盖双方窗口(全部 API 存在性守卫):

| 状态 | 行为 |
|---|---|
| 本 mod 设置窗开 | 关窗 + resume(resume 事件会顺带关 QOL 窗——它自己注册了该监听) |
| 仅 QOL 设置窗开 | `$.ForceCloseModSettings(true)` 替它收窗,菜单留在原地(= QOL 自家背景语义) |
| 两窗同开(边缘) | 走第一行,resume 事件双双收窗 |
| 都关 | 正常 resume |

**单独安装本 mod 时**:`$.IsModSettingsOpen` 不存在 → `typeof` 检查直接跳过 → 行为与改动前逐字节一致(零回归面)。

---

## 6. 验证

合并包是否真的生效,看 condebug 日志双方签名**同现**:

```powershell
Select-String -Path "C:\SteamLibrary\steamapps\common\Deadlock\game\citadel\console.log" -SimpleMatch "[LCT]","[QOLLock]"
```

- `[LCT][Settings] shell bound` + `[QOLLock][Settings]` 同时出现 = 合并布局加载成功,双方脚本都在跑。
- 只有 `[LCT]` = QOL 死了(槽位输);只有 `[QOLLock]` = 本 mod 死了。
- 中文日志乱码是控制台代码页表象,不影响匹配。
- VPK 部署前游戏必须关闭(文件被进程锁定)。

---

## 7. 维护(游戏更新后)

1. **底稿重对**:重反编译游戏 `pak01` 的两个布局文件,与本 mod shadow XML 比对——任何漂移都是 FATAL(会破坏整个对局 HUD)。
2. **QOL 重取**:用户装的 QOL 版本可能已更新,其 include 清单可能变化 → 合并包按 §4.2 重做。
3. **gameinfo.gi**:确认 `Game citadel/addons` 行还在(被更新重置则 DMM/手工补回)。
