# 窄面集成模式 —— Esc 菜单运行时注入 + 独立页面装载

**一句话**：不 shadow 任何 HUD 布局文件，UI 集成全部改在**运行时**完成——
向游戏 Esc 菜单的 `SubOptions` 注入一个按钮，点击后用 `BLoadLayout` 装载你
自己的独立页面 XML。本仓库（BabelTower Community v3）是该模式的完整
参考实现，本文是把它搬到任何 Panorama mod 的操作手册。

适用对象：任何想给 Deadlock 加"设置页/工具面板/入口按钮"的 Panorama mod，
尤其是**想与其他 HUD mod（QOLLOCK 等）共存**的 mod。

> 本文所有引擎事实均带证据与出处（实测日期 / 探针里程碑 / 反编译出处）。
> 引擎每天都在更新，采纳本模式前请先跑一遍 §6 的探针验证，别直接信。

---

## 1. 问题：宽面 shadow 为什么是死路

社区惯例做法是 shadow `hud.xml` / `hud_escape_menu.xml`（反编译原版 →
追加自己的声明 → 重打包）。三个致命缺陷：

| 缺陷 | 机理 |
|---|---|
| **冲突面** | 同名文件低编号 pak 胜出、输家静默死亡。两个 shadow hud.xml 的 mod 无法共存，除非做"合并兼容包"——每个 mod 组合一份、每次任一方更新重做一份（本仓库 `_compat/` 整条退役路线就是教训档案） |
| **漂移 FATAL** | 引擎按 snippet/结构找子面板，原版漂移而你的 shadow 没跟上 → `Plat_FatalError` 崩整个对局 HUD（v2 时代 TargetHeroImage 9 连 crash） |
| **维护成本 ∝ 覆盖面** | Deadlock 几乎每天更新，shadow 的文件越多，重对工作量越大 |

窄面模式把覆盖面压到**一个**你业务上非拿不可的布局（聊天类 mod = `chat.xml`，
它同时是你的脚本宿主），其余一切集成走运行时。

## 2. 模式总览

```
你的 mod（唯一 shadow:业务布局,如 chat.xml）
  │  脚本 context 从这来
  ▼
┌─ 运行时（全部在你的脚本里,零 XML 合并）─────────────────┐
│ ① 爬树:ctxPanel → GetParent 到绝对根,FindChildTraverse   │
│    可达全局面板树（含 HUD/Esc 菜单,context 无关）         │
│ ② 注入:Esc 菜单 SubOptions 里建按钮（原生同款形态）       │
│ ③ 装载:BLoadLayout 你的独立页面 XML → 宿主面板            │
│    宿主选址 = CitadelHud 面板下（§3.4,三态实测）          │
│ ④ 语义:class 开关显隐 + oncancel + escPoll + 焦点纪律    │
│ ⑤ 存活:~2s 幂等重验循环（UI 重建吞注入就补回来）          │
└──────────────────────────────────────────────┘
```

收益：与 QOLLOCK/任何 hud mod **文件面零交集**；游戏更新只需重对一个文件；
无合并包；按钮样式借菜单自己的样式表（零 CSS 依赖）。

## 3. 引擎事实库（模式的地基，每条可复验）

### 3.1 面板树访问与 context 无关

- `$.GetContextPanel()` 给你自己的 context 根（小面板）；沿 `GetParent()`
  爬到**绝对根**后，`FindChildTraverse(id)` 可达**全局面板树**——HUD、
  Esc 菜单、一切。
- 证据：探针 M2/M3/M4（2026-11-05，`_compat/probe/`）——chat context 内
  `#ChatMessages` 可达、绝对根建宿主成功、`SubOptions` 直达。
- 纪律：所有查找都写成"先 ctx 后根"双保险 + try/catch（参考实现
  `lct_boot.js findById()`）。

### 3.2 Esc 菜单按钮注入（零样式依赖）

- 注入点 = `#SubOptions`（菜单右侧按钮列）。形态与原生设置按钮同款：
  行 `Panel class="SettingsRow"` → 按钮 `Button class="nav_menu_item minor"`
  → `Label class="menuButtonLabel"` + 齿轮 `Panel class="smallIcon GearIcon"`
  （齿轮是纯 CSS 出图，无图片资源）。
- **样式零依赖**：注入点在 Esc 菜单子树内，这些 class 由菜单自己的样式表
  提供——CSS 作用域跟树走（探针实证）。你的 mod 不用带一行菜单 CSS。
- 位置：`sub.FindChildTraverse("settings")` 拿原生设置按钮 → `GetParent()`
  拿行 → `sub.MoveChildBefore(row, nativeRow)` 插到它前面；找不到就追加
  （纯外观差异）。
- 事件：`btn.SetPanelEvent("onactivate", fn)` 确定性绑定，**不要**赌 XML
  内联。
- 场景守卫：纯对局 HUD（没开过 Esc）可能还没有 SubOptions——找不到就
  静默跳过，交给重验循环。

### 3.3 独立页面 XML（零脚本）+ 确定性重绑

- 页面写成**零脚本** XML（`layout/custom/xxx_page.xml`）：逻辑全部住在
  你的 context 脚本里，页面只是声明树。结构推荐三层：

  ```
  <Panel hittest="false" style="width:100%;height:100%">   ← 全屏 shim,不挡输入
    <Panel id="XxxPage" class="XxxPage" hittest="true">    ← 页根:暗背板,z-index 6000
      <Panel id="XxxWindow" hittest="true" onactivate="">  ← 窗体:空 onactivate 挡穿透
  ```

- 显隐 = 页根的 class 开关（如 `.XxxOpen`），CSS 里"无 class = collapse"。
  不要用 `visible` 属性做页开关（与 §3.7 的菜单信号同理，属性链不可靠）。
- **内联处理器一律不要用**（2026-11-05 生产实测 + 2026-11-06 canary 终判：
  BLoadLayout 页面的 XML 内联 `onactivate="$.X()"` **会触发**，但解析在
  **独立 context**——装载者的导出不可见：33 个内联控件（3 开关+6 下拉+
  24 选项）点击无反应，而同页 `SetPanelEvent` 绑定的控件全部正常；
  canary 数据与完整机理见 §7）。存在性守卫（`if ($.X)` 前缀）把这个
  失败静音成"点了没反应"——比炸错误更难查（机理已实证）。装载后对
  每个控件 `SetPanelEvent` 确定性重绑是唯一可靠路径：页根
  `oncancel`（Esc 收页）、页根 `onactivate`（点暗背板收页）、窗体空
  `onactivate`（挡点击穿透）、关闭按钮、全部业务控件。
- **重绑的代价（诚实账）**：① 声明-行为分离——XML 成纯声明树，行为住
  JS 映射表，新增控件动两处，漏一处 = 同款"点了没反应"（用 `controls
  bound: ... MISSED=` 日志锚点兜底）；② **时序耦合**——绑定正确性依赖
  前置状态，典型坑：绑定若先于文案本地化执行，按文本匹配的选项会全量
  未命中（en 界面实测路径）——绑定函数必须自备前置（先 `applyTexts`
  再匹配），不赌调用方顺序；③ 匹配判据与本地化表耦合，改文案表要
  连带审绑定。收益侧：引擎再改 context 解析打不着、失效自报、行为
  单一归属。

### 3.4 页面宿主选址：三态实测（本模式最深的坑）

| 宿主位置 | 结果 | 症状 |
|---|---|---|
| 你的 context 面板（如 CitadelChat） | ❌ | 全屏页被小面板**裁剪**，BLoad 成功但看不见 |
| **绝对根**（根的直接子节点） | ❌ | 页面正常，但收页后**引擎 Esc 路由被无名宿主分支吞掉**——Esc 关不掉菜单（首测 2026-11-05） |
| **CitadelHud 面板**（`FindChildTraverse("Hud")`） | ✅ | 全屏置顶 + Esc 路由回归原版，三轮生产实证 |

- 选址代码：`findById("Hud")` → 缺位兜底 `globalRoot()`（可用性优先）。
- 宿主设 `hittest=false`（拦点击是页根的职责），`width/height 100%`。
- 附带发现：CitadelHud 面板对**属性读写**是"存在但无效"宿主（选举
  idle 实证），但对**视觉子节点**完全正常（QOL 同款宿主形态）——
  共享状态别挂在它身上，挂绝对根面板属性或经 `globalThis`。

### 3.5 Esc 语义全套（四条路收敛到"全关"）

参考实现 `lct_settings.js`，四条路径：

1. **页内 Esc**：开页时页根 `SetFocus()` → Esc 落页根 `oncancel` →
   收页 + `dispatchResume()`（一步回游戏）。
2. **菜单先关**：`escPoll`（0.5s 轮询，1.2s 宽限期防毛刺）发现菜单没了
   （§3.7 信号）→ 自动收页。页面失去输入模式锚点后留着也收不到鼠标。
3. **X / 背板关页**：只收页（回到菜单，游戏不恢复）+ **焦点归还菜单**
   （见下）。
4. **页根拿不到焦点**：Esc 走游戏全局 MenuBack 直接关菜单 → escPoll 跟进
   收页。两条路都收敛。

**焦点纪律**（2026-11-05 实测修复的潜伏 bug）：开页 `SetFocus` 到页根后，
任何"不经过 oncancel"的收页路径（X、背板）**必须**把焦点还回去——
`menuVisible()` 时 `findEscapeMenu().SetFocus()`。否则折叠的页根仍持焦点
链，Esc 派发落进它的 no-op oncancel 就地被吞，症状 = "X 关页后 Esc
关不掉菜单"。宽面时代没暴露只是因为没人踩过这个按键序列。

**resume 事件源**：`$.DispatchEvent("CitadelResumePlaying", src)` 的
`src` 必须是 **Esc 菜单面板本身**（`findEscapeMenu()`）——菜单不在你的
context 冒泡路径上，事件源挂错菜单收不到（2026-11-05 实测）。

### 3.6 输入模式锚点：菜单必须开着

页面浮在**开着的 Esc 菜单之上**，菜单不关：菜单开着 = 引擎 UI 输入模式
（鼠标归 Panorama）+ 对局暂停。先关菜单再开页 = 游戏回动作模式，页面
渲染正常但**收不到鼠标**（实测症状：人物走动、必须按住 Tab 借记分板的
UI 模式才能点击，2026-11-05 二次实测）。置顶手段：页根 z-index 6000
（`#EscapeMenu` 无 z-index，hud.css 实证）+ 宿主为 HUD 子树末位子节点。

### 3.7 菜单显隐信号：类，不是 visible

- 真实开关 = `.ShowEscapeMenu` 类（hud.css：`.ShowEscapeMenu #EscapeMenu
  {opacity: 1}`）——菜单用 **opacity** 显隐，类不摘菜单藏不掉，所以
  `BHasClass` 判定；`visible` 链恒为真，不可用。
- 类挂在菜单面板**或祖先链**上：沿 `GetParent()` 逐级查（参考实现
  `menuVisible()`，上限 16 级）。
- 菜单面板定位：`FindChildTraverse("EscapeMenu")`。

### 3.8 存活：幂等重验循环

UI 重建（对局切换/菜单重建）会**吞掉**注入的按钮和宿主。~2s 低频
`$.Schedule` 循环，先查后建（`findById(BTN_ID)` 幂等守卫），零日志噪音。
参考实现 `lct_boot.js tick()`。

### 3.9 （可选）CEF 面板隐藏配方

若页面需要网络（翻译/数据），用 `CitadelHTMLPanel` + `SetURL` +
`HTMLTitle` 事件回传。隐藏配方 = **4x4px + opacity 0.01 +
visibility:visible**：全 collapse 或 opacity 0 会让 CEF **暂停面板定时器**
传输直接死（`lct_net.css` 注释，探针 M6 实证传输与渲染）。协议设计见
[PROTOCOL.md](PROTOCOL.md)。

### 3.10 时间源：Date.now，不用 $.Time

`$.Time` 在部分 context 缺失/异常，boot 期调用直接 TypeError——本仓库
曾因探针信标用了它产生过**假阳性判决**（宣判时信标必崩 → 误判"布局脚本
不执行"，38 分钟后修复时间源才发现冤案，全程存档于 ARCHITECTURE §6）。
全库统一 `Date.now()` 封装（QOLLOCK 生产同款，55 处零 $.Time）。

## 4. 采纳清单（搬到你的 mod）

1. **确定你的窄面**：你的业务在游戏 UI 里最贴哪个布局？shadow 它
   （反编译原版逐字底稿 + 仅追加 script include，头部注释写清追加块），
   它就是你的脚本 context。没有就先跑 §6 探针找。
2. **写注入器**：照 §3.2 抄 `lct_boot.js` 的 `injectButton()`——改
   BTN_ID/按钮文案/onactivate 指向你的开关函数，加幂等守卫与重验循环。
3. **写页面**：照 §3.3 三层结构写零脚本 XML + 页根 class 开关 CSS。
4. **写语义宿主**：照 §3.4/3.5 抄宿主选址 + setOpen/escPoll/dispatchResume
   + **焦点归还**（这三处是最深的坑，别省）。
5. **探针先行**：把 §6 的探针信标改成你的 mod 名，M1-M6 跑一遍，
   全绿再动真格。
6. **部署实测**：关游戏部署 → hideout 验收（按钮出现/页面渲染/开关/
   Esc 链/X 后 Esc/无裸 CEF 窗）→ condebug 日志全链对账。

## 5. 参考实现地图（本仓库）

| 文件 | 职责 | 对应本文 |
|---|---|---|
| `mod/panorama/layout/chat.xml` | 窄面底稿 + 六脚本 include | §1、§4.1 |
| `mod/panorama/scripts/lct_boot.js` | 注入器 + 页面装载 + 重验循环 | §3.2、§3.3、§3.4、§3.8 |
| `mod/panorama/scripts/lct_settings.js` | 开关/Esc 语义/焦点纪律 | §3.5、§3.6、§3.7 |
| `mod/panorama/layout/custom/lct_settings_page.xml` | 零脚本页面三层结构 | §3.3 |
| `mod/panorama/styles/lct_settings.css` | 页根 class 开关规则（文件尾） | §3.3 |
| `_compat/probe/` | 两代信标 + graft/部署脚本 | §6 |

## 6. 探针：先验证再动手

`_compat/probe/build.ps1`（`-Beacon beacon2 -Phase2 -Deploy / -Restore`）
可整套改造成你自己的前提验证器：一个最小信标脚本 + 你的目标布局嫁接，
游戏里跑一遍，console.log 收 M 级信号。验证目标清单（M1-M6 语义）：

- M1 你的布局脚本执行（ctx 链打印）
- M2 你的业务面板可达
- M3 绝对根建宿主
- M4 SubOptions 直达 + 按钮注入
- M5 BLoadLayout 页面渲染/关闭
- M6 CEF 传输（如需要网络）

**先探针后编码**：引擎是黑盒，探针是开水房。本仓库自己的窄面判决
（chat.xml 脚本执不执行）就是被两代探针推翻重建的——文档里那句
"脚本不执行"的死刑判决，宣判所依据的信标自带必崩 bug，证据链倒挂
38 分钟（ARCHITECTURE §6 决策 2 全程存档）。你也一样：别信记忆，
信日志。

## 7. 边界与未验证（诚实清单）

- **脚本 context 的来源**：本模式的"窄面"依赖你的业务恰好有一个必拿的
  布局（聊天类 = chat.xml）。纯功能 mod 若没有任何必需布局，如何合法
  拿到脚本 context——**未验证**。候选：shadow 一个冷门/空载布局、
  蹭现有 mod 的 context（耦合，不推荐）、或等社区出现共享宿主方案。
- **引擎版本耦合**：`SubOptions`/`ShowEscapeMenu`/`EscapeMenu`/z-index
  行为都是当前构建（2026-11-05）实证，Valve 改版即需复验（§6 探针
  就是为这个准备的）。
- **内联处理器 context 归属（canary 终判，2026-11-06 00:19 会话）**：
  ~~"内联跟随装载者 context"~~ **证伪且机理闭环**——BLoad 页的 XML 内联
  `onactivate` **会触发**（无守卫 canary 按钮产出 10 条 `[LCTX] inline
  fired`），但解析在**独立 context**：自带引擎 `$`（`$.Msg` 可用），
  装载者 exportFn 挂的 `$[name]` / `globalThis[name]` 均不可见
  （`$.LCTUIToggle=undefined | globalThis.LCTUIToggle=undefined`）。
  旧内联 handler 的存在性守卫在该 context 判 false → 静默 no-op——
  "点了没反应"的完整机理。由此：
  ① "Build 10931 改坏内联"**彻底推翻**：现有机理（页面独立 context 缺
  导出）无需引擎漂移即可解释全部观测；最简模型 = **内联按名字在"页面
  自己的 context"解析**——v2 时代内联可用是因为脚本与内联同文件同
  context，v3 页面零 `<scripts>`，context 里没有我们的导出（旧构建无法
  回溯检验，存疑不立案）。② **内联 = 按名字在触发时解析（context 敏感）；
  `SetPanelEvent` = 闭包捕获装载者函数对象（context 免疫）**——确定性
  重绑可靠的根本原因。③ 声明式有救路径存在（页面 include 脚本 → 导出
  落在页面 context，v2 同文件模式即此），但 v3 架构下意味着脚本双跑
  （chat.xml 与页面各一份），未采纳。
  教训三条：① 关键路径上的工作假设必须**在生产首验**——本案失效潜伏
  整个生产期，且因无日志锚点连起点都不可考；② 守卫式内联会把失效
  静音（机理已实证），关键交互永远走 `SetPanelEvent` + 日志锚点；
  ③ 修复决策与失效叙事解耦——"现在不工作"即可动刀，历史归因可以
  慢慢查。
- **多 mod 同时注入 SubOptions**：与本 mod + QOL 已实测共存；三个以上
  注入者的顺序/重复注入交互未系统验证（幂等守卫只防自己）。

## 8. 历史注记

本模式不是设计出来的，是从三层废墟里长出来的：v2 宽面 shadow
（hud.xml + hud_escape_menu.xml）→ QOL 共存逼出合并兼容包（`_compat/`，
每次更新重做）→ 零依赖探针推翻"chat.xml 脚本不执行"的错误判决 →
窄面回归，合并包整类退役。完整证据链：
[ARCHITECTURE.md](ARCHITECTURE.md) §6、[COMPATIBILITY.md](COMPATIBILITY.md)。
