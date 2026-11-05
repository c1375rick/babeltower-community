# 与其他模组的兼容性(QOL Lock 共存方案)

> **状态**:追加式 · **最后核对**:2026-11-04
> **证据口径**:双方 VPK 清单实测、QOLLOCK 反编译源码(`window.js`/布局 XML)、**QOLLOCK 官方源码仓库文档**(github.com/civo7/QOLLOCK,2026-11-04 核对,见 §8)、本机 `gameinfo.gi` + `.dmm.json`、三处独立社区文档交叉印证(见 §3)。
> **一句话**:与 QOL Lock 的硬冲突只有 2 个同名布局文件;解法 = 槽位规则 + 合并布局兼容包 + 运行时背景钩子 QOL-aware 分支(已实现)。不装 QOL 时什么都不用做。

---

## 1. 结论速览

> **⚠ 2026-11-05 整体退役**：窄面回归后本文件所述合并方案**不再使用**——v3 只
> 覆盖 `chat.xml`（脚本执行已由零依赖探针实证，d186fbb 判决系 `$.Time` 污染
> 假阳性），与 QOL/任何 hud mod 文件面零交集，无需任何合并。本文保留作为历史
> 记录与教训库（§8 的 upstream.json 漂移情报仍然有效）。合并包构建脚本
> `_compat/build_compat.ps1` 保留但不再维护；探针全套在 `_compat/probe/`。

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
| 聊天翻译 | `ql_chat_translate/manifest.js`:硬编码 `OWNER_ACCOUNT_ID = "841196165"`(作者本人)+ 本机 `127.0.0.1:8765` 服务 | 完整翻译管线 | **零**(该功能对任何其他用户是死代码;官方文档亦声明账号门控,见 §8.3) |
| 聊天区域所有权 | 官方声明(§8):`ql_chat_geometry` 是**唯一**聊天几何写手;`ql_chat_images` 拥有图片子节点;翻译实验只在原文旁显示图片、不写原文 | 本 mod 只往消息注入双语子节点,不动几何、不改原文 | 零(子节点并列,所有权分离) |
| 许可证 | Apache-2.0 | AGPL-3.0-or-later | 代码不互斥;**合并包若含 QOL XML 片段,分发须附其 LICENSE/NOTICE 归属**(§8.5) |

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

### 4.2 合并布局兼容包(2026-11-05 已退役,历史方案)

**设计**:超集 = 当前游戏底稿 + 本 mod 插入 + QOL 插入。

- QOL 的 `hud.xml` 相对游戏底稿**只加 include、不加面板**(实测 diff:2 条样式 include + ~82 条脚本 include + 1 行 `GlobalClassListener`;唯一结构差异是旧底稿缺 `gMinimapTargeting`,属游戏版本漂移非 QOL 特性)→ 合并 = 我们的 `hud.xml` + QOL 的 include 行。**官方所有权文档印证**(其仓库 `docs/NATIVE_LAYOUTS.md`,§8.1):`hud.xml` 的 QOL 边界 = "HUD script load graph, shared styles and class listeners";`hud_escape_menu.xml` 边界 = "Independent settings script/style context and settings controls"。
- `hud_escape_menu.xml` 另需 graft:QOL 的窗口面板 + 入口按钮 + `QOLStorageBridge` + 样式 include(graft 源见下方实配方)。
- 本 mod 的 XML 内所有插入行都带 `<!-- BabelTower: ... -->` 标记注释,机器可定位。
- **兼容包只含这 2 个 XML**;双方其余文件从各自 pak 加载(§3.3)。

**构建步骤**(需要时执行):

1. 用 `F:\dev-tools\Source2Viewer-CLI-20.1` 反编译**当时实际安装的 QOL VPK** 的两个 `vxml_c`——历史参考件基于旧游戏底稿,直接用 = 漂移。漂移判据可量化:QOLLOCK 源码仓库的 `upstream.json` 记录其每个 layout 覆盖所基于的 GameTracking-Deadlock commit,与当前游戏底稿 commit 对不齐即漂移(§8.2)。
2. 反编译当前游戏 `pak01` 的同名文件,与我们的 shadow XML 比对(漂移 = FATAL,先重对底稿)。
3. 以我们的 XML 为基底,插入 QOL 的 include/面板行(避开 `BabelTower:` 标记区)。
4. 打包为**低槽位** VPK(§4.3),只含两个 XML。

**已落地配方**(`_compat/build_compat.ps1`,2026-11-04 实测通过):

- graft 源 = `_reference/qollock405_hud` / `qollock405_esc`(Source2Viewer 反编译;来源 VPK = QOLLOCK 4.0.5,SHA-256 `547CCEEE8382FF5ECC26CD5D642E647BA2CEF93C233019A8A9B7D0028877DBD7`,钉哈希不钉版本号)。`_reference/` 不入库仅本机;QOL 换版后重反编译同名两个文件即可重跑脚本。
- `hud.xml` graft 清单(行号 = 反编译件内):qHud 9-10(样式 showrank/qollock_global,插在游戏 `hud.vcss` 之后、本 mod `lct_net` 之前)、qHud 13-92(80 条 HUD 脚本装载图,插在 `<scripts>` 顶部;QOL 块在前、本 mod 2 条在后)。
- `hud_escape_menu.xml` graft 清单:`ql_settings.vcss_c` 样式(字面插入)、qEsc 9-60(52 条设置装载图,本 mod 3 条在其后)、qEsc 63(EscapeBackground 内联守卫版,整行替换)、qEsc 64-74(SettingsWindow 壳)、qEsc 124-129(ModSettingsBtn 行,插在本 mod 行后)、qEsc 163(QOLStorageBridge,插在根闭标签前)。**405 的 HUD 侧存储桥由 `ql_storage_bridge.js` 运行时创建,XML 无此行、不 graft**。
- 生成后断言(防静默坏包):hud 含 82 条 `vjs_c` include(80 QOL + 2 本 mod)且 showrank/qollock_global 各 1;esc 含 55 条脚本 include(52 QOL + 3 本 mod)且 `ModSettingsBtn`/`LCTModSettingsBtn`/`SettingsWindow`/`QOLStorageBridge` 各 1、内联守卫含 `&&`。任一不满足即 FAIL——2026-11-04 曾因 graft 单行取值退化(PowerShell 单元素数组展开,`[0]` 取到首字符)静默丢 2 条样式而产物仍合法可编译,断言即为此类错误而设。
- 产物 `dist/pak03_dir.vpk`(≈20.5 KB,addoninfo + 2 个 `vxml_c`,AddonName=lctcompat)。

### 4.3 槽位选择

- 合并包编号必须 **< QOL 安装的最低槽**(QOL 历史打包占 pak04–pak92 一串)。
- 本机 pak01(GB 563116)等已被占用 → **可用区间 pak02–pak03**,以安装当日 `addons/.dmm.json` 登记为准。
- DMM 的「Load first/排序」本质 = 改名重排 vpk 编号,同样服从低编号规则;手工安装则直接挑空闲低号。

**本机实装(2026-11-04 验证)**:

| 槽位 | 内容 |
|---|---|
| `pak03_dir.vpk` | 合并兼容包(2 个超集 XML,20,504 B) |
| `pak26_dir.vpk` | QOLLOCK 4.0.5 **原包整体改名挪入**(27,945,090 B,其余全部文件从本槽解析;纯改名 `pak03_dir.vpk → pak26_dir.vpk`,零重打包) |
| `pak91_dir.vpk` | 本 mod 本体(脚本/样式,不动) |

槽位可用性以安装当日 `addons/.dmm.json` + 磁盘双重核实(pak26 当时空闲)。

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

**2026-11-04 实测通过**:合并包(pak03)+ QOL 4.0.5(pak26)+ 本 mod(pak91)同装,同一启动窗口(23:23:43-44)双方签名同现——`[LCT]` 19 行(聊天钩子/出站钩子/协议选举/CEF 面板绑定/配置应用全链路)+ `[QOLLock]` 85 行(StorageBridge 连接、339 键/47 桶)。对照实验:同 QOL 直装 pak03 时 `[LCT]` = 0(§1 输家死法)。用户实机确认可用。

---

## 7. 维护(游戏更新后)

1. **chat.xml 底稿重对(窄面唯一覆盖面,FATAL 级)**:用 Source2Viewer 反编译当前
   游戏 `pak01` 的 `panorama/layout/chat.vxml_c`,与 `mod/panorama/layout/chat.xml`
   减去我们追加块(头部注释列明的三处)后逐字比对——任何漂移都可能是
   FATAL(v2 TargetHeroImage 9 连 crash 教训:引擎按 snippet 找子面板,找不到即
   Plat_FatalError)。流程与嫁接脚本见 `_compat/probe/build.ps1`(graft 逻辑可复用)。
2. ~~QOL 重取/合并包~~:**已随窄面回归退役**——不再需要任何 QOL 相关维护。
   QOL 自身与当前构建的漂移(如 2026-11-05 实测"提醒购买物品"在纯 QOL 态也坏)
   是 QOL 上游问题,与本 mod 解耦。
3. **gameinfo.gi**:确认 `Game citadel/addons` 行还在(被更新重置则 DMM/手工补回)。

---

## 8. QOLLOCK 官方源码仓库情报(2026-11-04 核对)

仓库:github.com/civo7/QOLLOCK(源码工程;分发版在 GameBanana 650634 / GitHub Releases)。**官方文档没有专门的 mod 间兼容章节**(README 仅要求报 bug 时附"any other HUD mods you use"),但以下内容直接服务共存方案:

1. **`docs/NATIVE_LAYOUTS.md` = 官方布局所有权地图**,是合并包 graft 清单的权威来源(比反编译更权威):逐 layout 声明 QOLLOCK 的改动边界。其哲学是"只改样式就扩展现有 CSS,不复制 XML"——party/unit-target/商店统计/`hud_health` 等纯样式 XML override 已被官方主动退役,**其 XML 覆盖面趋势是收缩**,对共存是长期利好。
2. **`upstream.json` = 机器可读底稿对齐表**:记录每个被覆盖游戏文件基于的 GameTracking-Deadlock commit 与 blob(`layout/hud.xml`、`layout/hud_escape_menu.xml` 均在列)。合并包构建时用它校验 QOL 底稿与当前游戏是否同版——对不齐 = 漂移, graft 源必须重取。
3. **聊天翻译账号门控是官方结论**:`ARCHITECTURE.md` §11 "Chat translation is account-gated" + `docs/features/ql_chat_translation.md` "account-restricted experiment…has no public persisted toggle"。§2 的"对其他用户是死代码"由反编译推断升级为**官方声明**。
4. **构建工具链相同**:双方都用 Reduced CSDK 12 编译打包,产物形态一致,无额外差异面。
5. **Apache-2.0**:QOLLOCK 原创部分为 Apache-2.0(Apache-2.0 与 AGPL-3.0 可合并)。合并兼容包含其 XML 片段时,分发须随包保留其 LICENSE/NOTICE 归属信息。

---

## 9. 社区同类方案情报(Hantu-Raya/Deadlock-mods-collection,2026-11-04 核对)

仓库:github.com/Hantu-Raya/Deadlock-mods-collection(约 20 个 mod + 研究/构建工具)。其中 `hp_colors_rewrite_qollock` 系列 = **血条 mod × QOLLOCK 共存**,与本 mod 问题同构,可借鉴点:

1. **处理器包装模式**:`oncancel="if ($.X && $.X()) {} else <原处理>"`——XML 层前缀包装对方已有处理器,先己后人、短路兜底,无装载顺序依赖,比 §5 的"后装载者接管"更确定。本 mod 现方案已实测通过,列为下次大改候选项(不在验证期同时改两个变量)。
2. **构建合同 + 断言**:`pak02-contract.json`(required/forbidden packed assets,禁源码形态与文档进包)+ `requireMatchCount` 断言 → 已吸收进 §4.2 生成后断言。
3. **源钉扎**:`qollock-source.sha256` / `thirdeye-source-pin.json`(包哈希 + 逐文件快照哈希 + required assets 清单)→ 已吸收(§4.2 记录 graft 源 VPK SHA-256)。
4. **其方案不碰 `hud.xml`**("leaves QOLLOCK's own hud.xml in charge")——因其无 HUD context 脚本需求;本 mod 必须争两个文件,超集方案无更轻路线(侧面印证)。
5. **SubOptions 上溢**:原生 SubOptions 底部锚定、每行向上长 32px,加行会顶进主按钮区;其解法 = 原生按钮 `margin-bottom` 抬升。本合并包净增 2 行(+64px),2026-11-04 实测未见异常,留观。
6. **CitadelHTMLPanel 二进制研究**(IDA + 字符串清单 + 重启实机实验):V8 层仅 `SetURL`/`SetIgnoreCursor`;页面→Panorama 唯一实证数据通道 = `document.title` → `HTMLTitle` 事件;`HTMLContentLoaded` 在**菜单 context** 注册抛异常(须守卫;本 mod 在 HUD context 实测绑定成功,§6——事件可用性与 context 相关);无 DOM/响应体读回、无 console 转发。作为 LCTNet 的能力边界地图。
7. 其钉扎的 QOLLOCK 为 "4.0.5 6 October hotfix",与本机 10-16 打包件非同一 zip——"钉哈希不钉版本号"的必要性实例。
