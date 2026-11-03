# BabelTower Community v3 — 协议定稿

状态:**待实现**
依据:2026-11-03 真机探针(`pak91_dir.vpk`,Deadlock 当前版本)
不变量:**无本地进程、无自签证书、无 BTIPC、无长轮询、无推送**

---

## 0. 一句话

游戏把请求写进面板 URL 的 fragment,页面把结果写进 `document.title`。
除此之外没有任何通道。

```
游戏 Panorama ──SetURL(PAGE?v=3#q=<json>)──▶ 托管页(无状态纯函数)
      ▲                                              │
      └──── HTMLTitle 事件 ◀── document.title ───────┘
```

页面**不存任何状态**。配置、缓存、语言偏好全部在游戏侧。页面只做一件事:收到请求,调翻译,回标题。

---

## 1. 实测依据(决定了下面每一条设计)

| 事实 | 数据 | 设计后果 |
|---|---|---|
| 隐藏面板可加载远程 https | `load=453ms`(冷)/ `9ms`(热) | 面板 4×4、`visibility:visible` + `opacity:0.01`(见 §2) |
| 重复 SetURL 每次都触发 | 4/4 | 一次请求 = 一次导航,不做通道复用 |
| **仅 hash 变化也触发导航** | `N3: load=30ms title=30ms` | 载荷放 fragment,不污染 query,不破 HTML 缓存 |
| title 回程稳定 | `HTMLTitle=32` 次,热态 12–30ms | 回程只依赖事件 |
| `panel.title` 属性不可用 | 每次 `prop=-` | 禁止读取属性,只收事件 |
| **HTMLTitle 是全局事件** | 探针收到其他 mod 的 `QOL_BRIDGE_INIT` | 必须**前缀 + id + 面板身份**三重校验,否则串台 |
| 相同标题可能不重复触发 | `BURST sent=5 titles=4` | 每一帧标题都带自增 `seq` |
| **标题可被投递两次** | QOLLOCK 生产代码注释与测试(`duplicateTitles`) | 接收侧按 `seq` 去重 |
| **标题预算远大于 512** | QOLLOCK 下行分片 `CHUNK_SIZE=1500`(标题帧 ≈1.55KB+) | 自校准基准改为 1500(见 §4.1) |
| 同文档 hash 变化**不重载** | QOLLOCK 注释:"fires `hashchange` without reloading the page" | 请求只经 `hashchange` 投递(见 §11) |

骨架模组实机证据(2026-11-03,本日新增):

| 事实 | 数据 | 设计后果 |
|---|---|---|
| **Panorama 无 `Convars` API** | 实机注入面板回显 `cv:MISS`(`typeof Convars === "undefined"`) | §10 原方案(配置存 convar)判死 |
| **Panorama 无任何存储 API** | 实机普查:`LocalStorage`/`GameUI`/`SteamAPI`/`SteamFriendsUI`/`FriendsAPI` 全 undefined | 跨重启持久化唯一通道 = CEF 桥 localStorage |
| 面板属性会话内读写闭环 | 实机 `attr:264`(完整配置 JSON 往返) | 会话层缓存 = 根/`#Hud` 面板属性 |
| 同名 layout 遮蔽加载链 | 实机:覆盖 `chat.xml`/`hudchat.xml` → `lct_settings.vjs_c` 执行 | 脚本载体 = 同名 layout 遮蔽;根面板自建 layout 无人加载 |
| Escape Menu 设置容器 | 实机 DFS 命中:面板 id=`settings`(小写) | 注入目标实证;查找候选按此校准 |
| 脚本双 context 并行 + 去重 | 实机:`chat`/`hudchat` 两实例并行,`Tab already present (another context injected it)` | 跨 context 去重用面板树查重,不用 JS 变量 |
| Panorama JS 样式校验拒绝数字字重 | 实机:`Invalid value for property 'font-weight': 600` | 注入代码逐属性 try/catch,字重用 `bold` |
| **`con_logfile` 不抓 PanoramaScript 行** | 123.log 零 LCT 行 vs 实机控制台有 | 诊断只能靠实机控制台文字/页面自回显,不能靠日志文件 |

跨 mod 旁证:2026-11-03 提取自 QOLLOCK 出货包 `pak03_dir.vpk`(`SearchPath citadel_addons/qollock-codex`)。同族架构,以上结论互相印证。

未测、按保守值设计:

- **标题精确上限**:QOLLOCK 以 1500 分片工作正常(已知),但精确天花板未量;§4.1 用 1500 pad 直接探测。
- 同一文档内连续改标题是否被合并:改为"接收方逐片拉取"(§4.2),不再依赖定时间隔。

---

## 2. 面板

```xml
<CitadelHTMLPanel id="LCTNet" class="LCTNet" hittest="false" acceptsfocus="false" />
```

```css
.LCTNet { width: 4px; height: 4px; visibility: visible; opacity: 0.01; }
```

- 全局只有一个。布局切换后重新 `FindChildTraverse` 获取,不缓存失效引用。
- **必须 `visibility:visible`**(仅 `opacity:0.01` 不够):CEF 会暂停不可见面板的定时器,QOLLOCK 明确为此保留可见性。
- 不设 `src`,首次由 `hello` 导航。
- 页面地址写死在 `lc_protocol.js` 的 `PAGE_URL`,不来自配置、不来自网络。
- 页面注册一个 `sw.js`(service worker)缓存自身,降低国内冷启动 ~1s 的首载成本。

---

## 3. 上行

```
PAGE_URL?v=3#q=<encodeURIComponent(JSON.stringify(request))>
```

- query 恒定 `?v=3`:保证 HTML 走缓存(热态 9–30ms)。
- 载荷只放 fragment:不出现在任何 HTTP 请求里,页面跳转时也不会发往第三方。
- 编码用 `encodeURIComponent`:游戏侧只有 `decodeURIComponent`,没有 `atob`。
- URL 长度不设人为上限;单条消息 ≤1024 字符(游戏输入框上限)。
- 下行分片拉取复用同一通道:`{op:"next",id,i}`(见 §4.2)。

---

## 4. 下行帧

标题是唯一回程,格式固定四类。解析规则:**找到 `LCT3` 后按 `:` 切分,只认前几段,剩余部分整体作为载荷**。

| 帧 | 格式 | 用途 |
|---|---|---|
| 存活 | `LCT3A:<buildId>:<seq>:<pad>` | `hello` 握手 + 长度自校准 |
| 结果 | `LCT3R:<id>:<seq>:<json>` | 一次完成的结果 |
| 分片 | `LCT3C:<id>:<i>/<n>:<seq>:<chunk>` | 长结果 |
| 错误 | `LCT3E:<id>:<seq>:<json>` | 失败 |

规则:

1. `seq` 是页面自增计数器,每次写标题必变 —— 规避"相同标题不派发";接收侧同时丢弃 `seq` 不增的帧(引擎可能重复投递同一标题)。
2. `<json>` 是**原始 JSON 文本**,不做 base64、不做百分号编码;JSON.stringify 已把换行转义,标题里不会出现裸换行。
3. 分片时 `<chunk>` 是同一段 JSON 文本的连续切片,按 `i` 拼接后整体 `JSON.parse`。**切片不得劈开 UTF-16 代理对**,且接收侧按 `seq` 去重(见 §4.2)。
4. 任一帧解析失败 → 丢弃,不猜。
5. **三重校验**:`LCT3` 前缀 + `id` 匹配 + `HTMLTitle` 事件的面板对象恒等于我方面板(用 `RegisterEventHandler("HTMLTitle", panel, …)` 绑定)。其他 mod 的标题来自别的面板对象,一次性排除。

### 4.1 长度自校准

`hello` 的存活帧携带 `<pad>`(**1500 个 `x`**)。取 1500 是因为同族的 QOLLOCK 出货代码以此值分片且工作正常,标题预算至少 ~1.55KB;用它当基准,一次探测即可定真实天花板。

- 游戏对照:`buildId + seq + pad` 是否被完整收到。
- 完整 → `CHUNK_SIZE = 1200`(留出帧头、`id`、`seq`、JSON 包裹的余量)
- 缺尾 → `CHUNK_SIZE = 600`
- 仍缺 → `CHUNK_SIZE = 200`,并在状态栏标"页面通道受限"

这样无需额外跑一次游戏就能确定标题预算。

### 4.2 分片:接收方主动拉(不连推)

QOLLOCK 已验证的模型:**一片到达才拉下一片**,发送方不按时间连推。串行、无并发,天然免疫"相同标题被合并/丢弃"。

```
页面  写第 0 片  ──▶  游戏收到 LCT3C:<id>:0/<n>:<seq>:<chunk>
游戏  发 next(id,1) ──▶ (fragment)
页面  写第 1 片  ──▶  … 直到第 n-1 片
游戏  齐片 → JSON.parse
```

- 上行 `next` 复用 §3 通道:`PAGE?v=3#q=<encodeURIComponent(JSON.stringify({op:"next",id,i}))>`。
- 每收到一片立即重置该请求的收齐超时(默认 3s/片),不重置则失败。
- 重复/迟到的 `seq` 丢弃,不推进、不重置超时。
- 切片避开代理对:边界若落在高代理位,回退一位(QOLLOCK 同款保护)。
- 片数上限 6(约 7.2KB);超出 → 页面直接回 `LCT3E … TOO_LONG`,游戏保留原文并提示。

---

## 5. 请求体

```json
{
  "v": 3,
  "id": "r17",
  "op": "tr",
  "ts": 1762140000000,
  "cfg": {
    "order": ["edge", "mymemory"],
    "timeoutMs": 8000
  },
  "d": {
    "target": "zh-Hans",
    "source": "auto",
    "mode": "incoming",
    "items": [ { "i": 0, "t": "hello" } ]
  }
}
```

- `cfg` **每次请求都带**。翻译层面页面无状态(结果缓存是文档级的,见 §11)。
- 协议零 Key:上游只有免 Key 的 `edge` / `mymemory`(2026-11-03 决策),请求体里没有任何凭据字段。
- `items` 一次最多 8 条,总字符 ≤ 2000;超出由游戏侧拆成多次请求。

---

## 6. ops

| op | 请求 | 响应 |
|---|---|---|
| `hello` | `{v,id,op:"hello",ts,buildId?}` | `LCT3A`(存活帧) |
| `ping` | `{v,id,op:"ping",ts}` | `{ok:true,ms:<页内耗时>}` |
| `tr` | 见 §5 | `{ok:true,items:[{i,t}],provider,cached}` |
| `store.get` | `{v,id,op:"store.get",k}` | `{ok:true,val:<json\|null>}` |
| `store.put` | `{v,id,op:"store.put",k,val}` | `{ok:true}` |

- 业务五个。没有 `watch`,没有 `health`。另有内部分片拉取 `{op:"next",id,i}`(§4.2),不属于业务 op。
- `store.*`(2026-11-03 新增):页面侧 `localStorage` 读写,键 `lct:<k>`,值 JSON ≤16KB。变更原因:实机证明 Panorama 无 `Convars` API、无任何存储 API(§1),跨重启持久化唯一通道是 CEF 桥。当前只用 `k:"cfg"`。

---

## 7. 错误码

```json
{ "ok": false, "code": "PROVIDER_DOWN", "detail": "edge 502", "retryable": true }
```

| code | 含义 | 游戏侧动作 |
|---|---|---|
| `BAD_REQUEST` | 载荷结构不对 | 丢弃,记日志,不重试 |
| `TOO_LONG` | 结果超出分片预算 | 保留原文,提示"消息过长" |
| `PROVIDER_DOWN` | 所有上游失败 | 保留原文,状态点变黄 3s |
| `TIMEOUT` | 页内超时 | 重试一次,仍失败保留原文 |
| `PROTO_MISMATCH` | 页面 `v` 与游戏不符 | 停用翻译,状态栏红字 |
| `STORE_UNAVAILABLE` | 页面 localStorage 不可用(隐私模式等) | 配置只走会话层,状态栏提示"设置不跨启动保存" |

约定:页面**永不**抛异常;所有失败都转成 `LCT3E`。

---

## 8. 时序

| 阶段 | 超时 | 重试 |
|---|---|---|
| `hello` | 4s | 3 次,退避 1/2/4s |
| `tr` | 8s | 1 次(同 id,`r=1`) |
| `ping` | 3s | 不重试 |
| 分片收齐 | 3s/片(每片到达即重置) | 不重试 |

冷启动首次导航约 1s(拉页面),之后 12–30ms。**boot 必须先 `hello` 预热**,否则第一条消息会吃 1s。

---

## 9. 游戏侧状态机

```
BOOT
  ├─ ensurePanel 失败 ──▶ DEAD(每 10s 重试一次,不刷屏)
  ├─ hello 成功 ────────▶ READY
  └─ hello 超时 ×3 ─────▶ OFFLINE(指数退避 2/4/8/16/30s)

READY
  ├─ 扫描到新消息 ──▶ REQ(单槽)
  ├─ REQ 成功 ──────▶ 注入译文 ──▶ READY
  ├─ REQ 失败 ──────▶ 保留原文 ──▶ READY
  └─ 连续 3 次超时 ─▶ OFFLINE

OFFLINE
  └─ 任意 ping 成功 ──▶ READY(重放未过期队列,TTL 30s)
```

- 单槽串行,队列上限 64,溢出丢最旧并记日志。
- 队列元素带 TTL 30s,过期直接放弃(聊天消息过期再译没有意义)。

---

## 10. 配置所有权

**配置会话层在游戏侧,持久层在桥页面。**(2026-11-03 改判:原方案"配置存游戏 convar"因实机证明 Panorama 无 `Convars` API(§1)作废。)

> 对照:QOLLOCK 把配置持久化在 **CEF 的 `localStorage`**(经远程 bridge 页读写,键 `qollock_settings`),会话内再镜像到根 / `#Hud` 面板属性。它证明了 **CEF localStorage 确实跨会话存活**。当年我们不采用的唯一理由是会把 API Key 落进 CEF 存储;2026-11-03 决策砍掉所有需 Key 端点后该顾虑消失,CEF 桥成为唯一持久化通道(§1:Panorama 无任何存储 API)。参考:`pak03_dir.vpk` 的 `core/ql_storage_bridge.js` / `core/ql_persistence.js`。

- 持久层:桥页面 localStorage,键 `lct:cfg`,明文 JSON,经 `store.get`/`store.put` 读写(§6)。
- 会话层:根 / `#Hud` 面板属性(实机实证 attr:264 读写闭环)。boot 先读属性(热路径),没有再 `store.get`(冷启动)。
- 写入:双写 —— 面板属性立即生效,`store.put` 异步持久;put 失败降级为"仅会话有效",状态栏提示。
- 没有"保存"请求发往第三方,没有配置同步,没有版本冲突。

字段:

```json
{
  "enabled": true,
  "targetLanguage": "zh-Hans",
  "displayMode": "bilingual",
  "outgoing": "off",
  "outgoingTarget": "en",
  "force": false,
  "translateOwn": true,
  "timeoutMs": 8000,
  "order": ["edge", "mymemory"]
}
```

---

## 11. 页面职责

1. **只处理 `hashchange`,忽略页面首次加载时就存在的 fragment。** QOLLOCK 明确的坑:文档重载时旧 fragment 仍在,若在 `load` 时处理会重放过期请求。因此 boot 先导航到 `PAGE?v=3`(无载荷)预热,之后每次请求只经 `hashchange`。
2. 解析 `#q=`,校验 `v`、`id`、`op`、大小(≤32KB),否则回 `BAD_REQUEST`。
3. `tr`:按 `cfg.order` 依次尝试上游,每个上游 3.5s 预算,总计 ≤7s。
   - `edge`:先取 token,再调 translate;免 Key。
   - `mymemory`:免 Key,有配额。
4. 结果按 `q` 缓存(内存,文档级),命中直接回。
5. 写标题:短结果一帧;长结果按 §4.2 逐片,收到 `next` 再发下一片。
6. `store.get/put`:读写 `localStorage["lct:<k>"]`,值 JSON ≤16KB,超限回 `LCT3E`(STORE_UNAVAILABLE/BAD_REQUEST);写成功即回 `{ok:true}`。
7. 不写 console;localStorage **只**允许 §6 `store.*` 读写 `lct:` 前缀键;不发任何非翻译/非存储请求。

---

## 12. 安全

- 页面是唯一信任根:开 branch protection,禁 force-push,不引第三方运行时脚本。
- 协议零 Key:上游只有 `edge` / `mymemory` 免 Key 端点(2026-11-03 决策,原"用户 Key 不入 CEF 存储"的顾虑随 Key 一并消失)。
- **付费端点扩展预案**(2026-11-03 定调,当下不实现):用户在游戏设置界面录入自己的 Key → `store.put(k:"keys.openai")` 存进页面 origin 的 localStorage → 页面侧 `tr` 自取自用。**协议请求体仍零 Key**(Key 只在录入瞬间过一次 fragment);CSP 只允许固定官方域名,不做"OpenAI 兼容自定义 base"(会使 connect-src 失控);错误码 `NO_KEY`(页面侧检查)届时回归。绝不允许把任何人的 Key 内置进页面代码。
- 桥页面 URL 用随机长路径:同机其他 mod 不知道 origin 就读不到我们 origin 的 localStorage(抬高门槛,非绝对——本机攻击者可读 VPK/监听标题)。
- 页面渲染只用 `textContent`;不把用户文本拼进 `innerHTML`。
- CSP:`connect-src` 只允许两个上游域名。
- 标题解析严格**前缀 + id + 面板身份**三重校验,防止其他 mod 的标题注入。

---

## 13. 版本

- `PAGE_URL` 内 `v=3` 与请求体 `v` 必须一致。
- 页面 `hello` 回 `buildId`;游戏记录并在状态栏显示前 8 位。
- 不兼容旧版:不做双协议、不做降级。旧用户升级即换包。

---

## 14. 验收

| 编号 | 断言 | 判定 |
|---|---|---|
| A1 | boot → `hello` → `READY` | ≤5s |
| A2 | 单条中文消息端到端 | ≤300ms(热态) |
| A3 | 连续 10 条消息不丢、不乱序 | 10/10 |
| A4 | 页面不可达 | 状态 OFFLINE,聊天不卡,只发原文 |
| A5 | 1200 字符结果(含中文) | 逐片拉取收齐,内容完整、无代理对损坏 |
| A6 | 其他 mod 的标题(含 QOLLOCK 的 `QOL_BRIDGE_INIT`) | 因面板身份不同全部忽略,零误判 |
| A7 | 同一标题被投递两次 | `seq` 去重,不重复推进 |
| A8 | 断网恢复 | 自动回 READY,无需重启 |

---

## 15. 已知风险

| 风险 | 现状 | 对策 |
|---|---|---|
| 标题精确上限未知 | QOLLOCK 以 1500 分片正常工作 | §4.1 用 1500 pad 一次探测 |
| 分片被合并 / 重复投递 | 引擎可能重复投递同一标题 | 接收方逐片拉取 + `seq` 去重 |
| 文档重载重放旧 fragment | QOLLOCK 明确的坑 | 忽略首次加载的 fragment,请求只走 `hashchange` |
| 面板不可见导致 CEF 定时器停 | 已知(QOLLOCK 同款) | `visibility:visible` + `opacity:0.01` |
| 页面放到国内访问慢 | 已知 | boot 预热;`hello` 超时 4s ×3 |
| 上游配额 | 已知 | 顺序回退 + 结果缓存 |
| 其他 mod 抢面板事件 | 实测存在 | 前缀 + id + 面板身份三重校验 |
