# 贡献指南 / Contributing

先读纪律,再搭环境,再挑任务。这份文档本身就示范了本项目的文档风格:
**写给三个月后完全失忆的自己**。

## 项目纪律(与其他 mod 项目最大的不同)

1. **结论必须实证**。游戏实测 / 反编译 / 二进制证据,三选一;不接受
   "应该是"、"文档说"、"我记得"。每条关键结论在 `docs/` 里有出处,
   包括推翻自己的记录(见 ARCHITECTURE.md §6 决策 2:一次被探针
   推翻的死刑判决,证据链倒挂过程完整存档)。
2. **验证 = 真实对局 + condebug 日志**。开发期给游戏加 `-condebug`
   启动项,`$.Msg` 落 `game/citadel/console.log`(`[LCT]` 标签,
   轨迹对账表见 [docs/DEBUG.md](docs/DEBUG.md))。
3. **API 不猜测**。Source 2 的 Panorama API 没有公开文档,一切以
   反编译件和实测为准。本项目所有"这个 API 活着"的结论都有出处。
4. **shadow XML 底稿纪律**。`mod/panorama/layout/chat.xml` 的正文
   是游戏原版 `chat.vxml_c` 的反编译逐字底稿,我们只做注释里列明的
   追加。**任何与当前构建的结构漂移都可能 FATAL 崩游戏**
   (v2 TargetHeroImage 9 连 crash 教训)。
5. **模组尽可能简单**。能不引入的复杂度就不引入;零依赖优先。

## 环境搭建

| 工具 | 用途 | 公开获取渠道 |
|---|---|---|
| [VPKEdit](https://github.com/craftablescience/VPKEdit) (`vpkeditcli`) | 打包/提取 VPK | GitHub Releases |
| [Source2Viewer-CLI](https://valveresourceformat.github.io/) | 反编译 `vxml_c`/`vjs_c`/`vcss_c` | VRF(ValveResourceFormat)release 附带,与仓库所用 20.1 同源 |
| Reduced CSDK 12 (`resourcecompiler`) | 编译 Panorama 资源 | Deadlock modding 社区(Hoxdolum/DirtKiller23 合成的社区 SDK;**含游戏文件,禁止在 modding 社区之外散播**,也因此不由本仓库分发) |
| Node.js | 提交前语法门禁 `node --check` | nodejs.org |

`resourcecompiler` 编译路径默认写死 `F:\dev-tools\Reduced_CSDK_12`,
改 `mod/build.ps1` 的 `-Csdk` 参数指向你自己的解包目录即可。

## 构建与部署

```powershell
# 语法门禁(提交前必跑)
node --check mod/panorama/scripts/*.js   # PowerShell 5.1 下见下方注

# 构建:[1/3] 源码同步 → [2/3] resourcecompiler 编译 → [3/3] vpkeditcli 打包
powershell -ExecutionPolicy Bypass -File mod\build.ps1
```

产物 `dist/pak03_dir.vpk` 复制到 `game/citadel/addons/`。游戏运行中
**不得**覆盖 VPK(资源系统会读到半截文件),先关游戏再部署。

> PowerShell 5.1 注:本仓库脚本必须纯 ASCII;`Select-Object -First N`
> 会提前掐断原生命令管道(S2V 输出文件没写完的实测教训)。

## 头号维护任务:游戏更新后的 chat.xml 重对

这是本项目的存活线,流程已脚本化(`_compat/probe/build.ps1` 的
graft 逻辑可复用),完整步骤见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) §7:

1. 用 Source2Viewer 反编译**当前**游戏 `pak01` 的
   `panorama/layout/chat.vxml_c`;
2. 与 `mod/panorama/layout/chat.xml` 减去追加块后逐字比对;
3. 有漂移 → 用新底稿重建,重放三处追加(头部注释列明);
4. 游戏实测 + condebug 日志全链确认。

## 好的第一个任务

- **界面语言扩展**:`lct_i18n.js` 是纯数据查表,加日/韩/俄文案即功能,
  零风险入门(对照 zh/en 双表抄结构)。
- **翻译上游打磨**:桥页面 `app/` 的上游选择与降级链,免 Key 优先,
  改动必须附实测对比。
- **出站白名单**:命令(`/team_mid` 等)、表情、纯符号的跳过规则细化,
  需要 Real 对局样本(带日志提交)。
- **文档英文化**:`docs/` 任意一篇,术语以现有中文文档为准。

## 提交规则

- 多段 commit message,改动必须附证据(日志行/反编译出处/实测记录);
- PR 说明里给出验证方式(你在哪局游戏里测的,console.log 关键行);
- AGPL-3.0-or-later:你的贡献自动以同许可证发布;触碰含 Valve 反编译
  片段的文件时,保持文件头版权注记原样。
