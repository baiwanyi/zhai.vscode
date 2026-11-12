# Stock（在线图库）— 模块设计方案

**版本**：1.0
**日期**：2026-11-03
**状态**：已定稿，待实施
**宿主**：VSCode 插件 Zhai（宅桌面）
**图库目录**：`{storage.rootPath}/unsplash/{YYYYMM}/`
**索引库**：`{storage.rootPath}/sqlite/stock.db`
**上游接口**：Unsplash API v1（`https://api.unsplash.com`）

---

## 1. 目标与边界

### 1.1 目标

在笔记与公众号文章的编辑工作流里，补一条「不靠出图、直接从图库挑图」的取图路径：

1. **在线找图**：按关键词搜索 Unsplash，分页加载，一屏看得到摄影者与画面。
2. **一键插入**：点卡片即把图片插入当前 Markdown 文档的光标处，不需要离开编辑器。
3. **落地可复用**：下载的图按统一目录归档，再次使用同一张图时走本地、不发网络、不耗配额。
4. **可追溯**：每张本地图能回答「来自哪张 Unsplash 照片、谁拍的、什么时候下的、被哪类文档首次使用」。

### 1.2 非目标

| 项 | 说明 |
| --- | --- |
| 多图源 | 本期只接 Unsplash。结构上把客户端收敛在 `stockClient`，后续接 Pexels / Pixabay 只加适配器，不改页面与协议 |
| 图床 / 上传 | 只下载到本地，不上传任何服务；公众号素材上传仍由推送链路负责 |
| 图片编辑 | 不做裁剪、滤镜、旋转、压缩转码 |
| 语义搜索 / 以图搜图 | 只做关键词 |
| 批量插入 | 一次点一张。批量下载会让配额与失败重试的交互复杂化，收益低 |
| 收藏 / 标签 | 不做。本地已有「已下载」列表，再加一层分类属于过度设计 |
| 入媒体库 | **明确不入** `media.db`（见 1.4） |

### 1.3 已确认的三项决策（2026-11-03）

| # | 决策 | 影响章节 |
| --- | --- | --- |
| D1 | 图片统一落 `{存储根}/unsplash/{YYYYMM}/`，**沿用 Unsplash 的下载文件名**（`{photoId}.{ext}`），不拼时间戳、不按内容类型分目录 | §3 |
| D2 | 搜索为首页，**已下载**为二级视图：标题行右侧按钮进入、左侧返回按钮退出 | §5 |
| D3 | 索引库 `stock.db` 以 `photo_id` 单列为主键——目录与文件名都由它决定，天然去重 | §4 |

**D1 的动机**：原设想「笔记落 `images/`、公众号落 `wechat/{appid}/post/{批次}/images/`」会把同一张图按作用域复制多份，而用户真正要的是「下过一次就不再下第二遍」。文件名既然是 Unsplash 官方下载名（`unsplash.com/photos/Kq2WnB6x9eA/download` 得到的就是 `Kq2WnB6x9eA.jpg`），就可以直接拿它当唯一键，省掉命名生成器与冲突顺延那一整套逻辑。

**D2 的动机**：搜索与已下载是「获取」与「复用」两种心态，平铺成两个 tab 会在 300px 宽的侧栏里与标题、筛选行抢位。收成一个图标入口后，页头只剩一条主操作线；已下载仍是本地数据，断网、配额耗尽、密钥失效时点进去照样能用。

### 1.4 与媒体库（`media`）的关系

| 维度 | `media` 模块 | 本模块 |
| --- | --- | --- |
| 目录 | `images/{YYYYMM}/` | `unsplash/{YYYYMM}/` |
| 索引 | `sqlite/media.db` | `sqlite/stock.db` |
| 来源 | 出图、导入、迁移 | Unsplash 下载、手工放入 |
| 名字 | 宿主生成（14 位时间戳 + 6 位随机） | 上游给定（`{photoId}.{ext}`） |
| 引用统计 | 有（`media_usage`，一行一条） | 无，只在 `stock_photos.scope` 记首次使用的文档类型 |
| 删除保护 | 有（列引用清单） | 无，只做二次确认 |
| 筛选 | 年月 | 年月 |

**为什么不合库**：把 `unsplash/` 并入媒体库需要同时改三处——`mediaScan` 的扫描范围、`isMediaPath` 的路径白名单（`^images/\d{6}/`）、`mediaReferenceService` 的引用解析；换来的收益只是「一个地方看全部图」。而本模块自带「已下载」列表，独立管理更直接，也不让媒体库的相对路径假设被打破。

**代价（明确接受）**：Unsplash 图不计入媒体库的体积统计与全局引用计数；删除批次目录**不会**连带删图（图在 `unsplash/` 下，正文里留下破图）。

---

## 2. 外部接口（Unsplash API v1）

### 2.1 端点

| 场景 | 请求 |
| --- | --- |
| 关键词搜索 | `GET https://api.unsplash.com/search/photos?query=&page=&per_page=&orientation=&content_filter=high` |
| 无关键词浏览（推荐流） | `GET https://api.unsplash.com/photos?page=&per_page=&order_by=latest` |
| 话题内浏览 | `GET https://api.unsplash.com/topics/{slug}/photos?page=&per_page=&order_by=latest`（不支持 `query` 与 `orientation`；话题清单由前端固定维护，不回源拉取） |
| 单张回源 | `GET https://api.unsplash.com/photos/{id}` |
| 下载计数（合规必做） | `GET {photo.links.download_location}` |
| 图片本体 | `{photo.urls.raw}` 追加 `w`/`q`/`fm` 参数（见 2.4） |

请求头固定两条：

```
Authorization: Client-ID {accessKey}
Accept-Version: v1
```

**密钥只出现在请求头**，不进 URL、不进日志、不进错误文案、不进 webview 消息。

### 2.2 响应收窄

逐字段判类型后再用（对齐 `wechat/client.ts` 的 `parse*Payload` 写法）；单条字段缺失即丢弃该条，不让整页失败：

| 字段 | 用途 | 缺失处理 |
| --- | --- | --- |
| `id` | 主键 / 文件名主干 | **必需**，缺失丢弃该条 |
| `width` / `height` | 展示比例、入库 | 置 null |
| `alt_description` → `description` → `''` | alt 文本 | 空串 |
| `urls.raw` → `urls.full` → `urls.regular` | 下载入口 | 三者皆缺则丢弃该条 |
| `urls.small` | 缩略图 | null，卡片显示占位 |
| `links.download_location` | 下载计数 | null，跳过计数 |
| `user.name` / `user.links.html` | 署名与主页 | 「未署名」 |

`photoId` 必须过 `^[A-Za-z0-9_-]{5,32}$` 才允许进入文件名与协议入参——Unsplash 的 id 天然满足，这条是防注入的兜底（`..`、盘符、路径分隔符一律进不来）。

### 2.3 限流与重试

Unsplash 按**应用**限流（Demo 应用 50 次/小时，Production 5000 次/小时），响应头给 `X-Ratelimit-Limit` / `X-Ratelimit-Remaining`。

三道闸门，全部收敛在 `stockClient`（页面与服务层都不各自判）：

```
1. 冷却   cooldownUntil 未到期 → 直接返回可读提示，不发网络
2. 窗口   最近 60 分钟内的请求数 >= zhai.stock.hourlyLimit → 拒绝，给出「多久后恢复」
3. 间隔   距上次请求 < zhai.stock.minIntervalMs → 排队等待后放行
```

- 窗口计数用内存滑动窗口（60 分钟）；进程重启即清零，由服务端 429 与冷却兜底，不落盘。
- 每次成功响应后把 `X-Ratelimit-Remaining` 记入内存，取「本地窗口剩余」与「服务端剩余」中更小者作为 `stock/status.remaining`；服务端值在本进程首次成功响应前未知，此时用本地窗口估算（配置上限减窗口内已用次数）兜底，保证回执恒有值、页头配额胶囊可常显。
- `429` → 读 `Retry-After`（缺省 60s）写 `cooldownUntil`，返回 `rate-limited`，不重试。
- `5xx` / 网络超时 → 指数退避重试 3 次（1s / 2s / 4s + 0–300ms 抖动），仍失败返回 `retryable: true`。
- `401` → `invalid-key`；`403` → `forbidden`（应用未通过审核或权限不足）。两者都不自动清密钥。
- 超时：搜索与详情 15s，图片下载 30s（一律 `AbortSignal.timeout`）。

### 2.4 下载与文件名

```
下载地址 = new URL(photo.urls.raw)
  .set('w',  String(zhai.stock.imageWidth))   // 默认 1600
  .set('fm', 'jpg')                           // 固定 JPEG，保证扩展名稳定
  .set('q',  '85')
```

- 落盘名 `{photoId}.{ext}`，`ext` 取响应的 `content-type`（`image/jpeg`→`jpg`，`image/webp`→`webp`），缺省 `jpg`。
- **校验 `content-type` 以 `image/` 开头**：CDN 出错时会返回 HTML 错误页，直接写盘会得到一张 0.5KB 的坏图。
- 体积超过 `zhai.stock.maxBytes`（默认 15MB）→ 用 `w=1080` 重下一次；仍超限则拒绝并提示。
- 下载成功后再触发 `links.download_location`（fire-and-forget，失败只记日志）——Unsplash 条款要求「下载行为必须被计数」，这一步不能省。

### 2.5 合规约束（写进代码注释与页面）

| 要求 | 落地 |
| --- | --- |
| 署名 | 卡片常驻显示摄影者名，链接到 `user.links.html`，追加 `utm_source=zhai&utm_medium=referral` |
| 文中署名 | 插入的 alt 内含「· 摄影者」（`zhai.stock.appendCredit` 默认开） |
| 下载计数 | 每次成功下载触发一次 `download_location` |
| 不做批量镜像 | 只响应用户主动的单张下载，不做「按关键词全量抓取」；不把图用于训练或再分发 |

---

## 3. 目录与命名规范

```
{storage.rootPath}/
├── unsplash/
│   ├── 202611/
│   │   ├── Kq2WnB6x9eA.jpg
│   │   └── nPB4x5X7hKc.jpg
│   └── .thumbs/                ← 搜索结果缩略图缓存，不参与「已下载」扫描
│       └── Kq2WnB6x9eA.jpg
├── images/202611/              ← 媒体库，与本模块无关
├── sqlite/
│   ├── media.db
│   └── stock.db                ← 本模块索引
├── notes/202611/
├── press/{作品名}/
└── wechat/{appid}/post/{批次}/
```

规则：

- 年月目录固定 6 位 `YYYYMM`，按**首次下载时刻**的本地时区，与 `mediaNaming` 口径一致（不做 UTC 换算）。
- `unsplash/` 与 `images/`、`notes/`、`press/`、`wechat/` 平级；换存储根时整库迁移，库内全是相对路径，不需要改写记录。
- 目录不预建，落盘前 `createDirectory({ recursive: true })`。
- `.thumbs/` 以点开头，扫描「已下载」时**跳过所有以 `.` 开头的条目**，避免把缓存当资产。
- 文件名不做合法性清洗——`photoId` 已过 `^[A-Za-z0-9_-]{5,32}$`，天然安全。
- 手工把任意图片丢进 `unsplash/{YYYYMM}/` 是允许的：对账按文件名主干补录，`photographer` 为 null、`scope` 为 `general`。

### 3.1 同名与冲突

| 情况 | 处理 |
| --- | --- |
| 目标文件已存在（库内有记录） | 直接复用，**不覆盖、不重新下载** |
| 目标文件已存在（库内无记录，手工放入或库丢失） | 采用既有文件补录记录，仍不覆盖 |
| 同一 `photoId` 在不同月份目录出现 | 以 `rel_path` 字典序靠前者为准，另一份不入库（对账时提示重复） |
| 手工文件与库内 `photoId` 冲突但扩展名不同（`Kq2WnB6x9eA.png` vs `.jpg`） | 以库内 `ext` 为准，另一份忽略 |

### 3.2 正文引用形态

```markdown
![山脊 · Annie Spratt](@zhai/unsplash/202611/Kq2WnB6x9eA.jpg)
```

- **一律写 `@zhai/` 存储根引用**，不写相对路径：图片不在文档所在目录，相对路径会随文档移动而失效。
- `@zhai/` 的解析已由 `@shared/utils/zhaiPath` 统一（webview 侧 `resolveZhaiSrc`、原生预览侧 `zhaiImagePreview`）。
- alt = `{alt_description 或 '图片'}` + ` · {摄影者}`（`appendCredit` 关闭时不含摄影者）；剔除 `[`、`]`、换行。

---

## 4. 数据模型

### 4.1 存储位置

`{storage.rootPath}/sqlite/stock.db`，与 `media.db` 同级、同 `journal_mode = DELETE`（单文件，避免云盘同步 `-wal` / `-shm` 冲突；本库写入低频，元数据优先级高于性能）。

打开方式复用 `common/db/openDatabase` 的 `journalMode` 可选参数；按当前 `resolveStorageRoot()` 求值，连接按根缓存，配置变更后关闭旧连接。打开失败降级到缓存目录并提示「在线图库索引已临时重建，历史署名不可用」——图片本体在 `unsplash/` 下，不受影响。

### 4.2 `stock_photos` 表

```sql
CREATE TABLE IF NOT EXISTS stock_photos (
    photo_id          TEXT PRIMARY KEY,              -- Unsplash 照片 id，同时是文件名主干
    rel_path          TEXT NOT NULL UNIQUE,          -- unsplash/202611/Kq2WnB6x9eA.jpg
    ext               TEXT NOT NULL,                 -- jpg | jpeg | webp | png
    bytes             INTEGER NOT NULL DEFAULT 0,
    width             INTEGER,
    height            INTEGER,
    alt               TEXT NOT NULL DEFAULT '',
    photographer      TEXT,
    photographer_url  TEXT,
    download_location TEXT,                          -- 下载计数端点，插入成功后触发一次
    scope             TEXT NOT NULL DEFAULT 'general',  -- note | wechat | press | general
    downloaded_at     TEXT NOT NULL                  -- ISO 8601（UTC）
);

CREATE INDEX IF NOT EXISTS idx_stock_photo_month ON stock_photos(rel_path);
```

字段说明：

- `photo_id` 单列主键：目录与文件名都由它推出，不存在「同一张图两行」的可能，去重不需要额外逻辑。
- `rel_path` 单独存而不是每次拼：年月目录在首次下载时固化，之后不随当前时间漂移。
- `scope` 记录**首次插入**时所在文档的类型，仅用于列表展示，不参与路径生成，也不随后续插入改写。
- `download_location` 落库是为了「已下载 tab 插入」时不回源查详情——那张图第一次下载时就把计数端点记住了。
- 不存哈希：文件名唯一即内容唯一，`sha256` 只在排查重复时才有用，收益不抵成本。

### 4.3 与文件系统的关系

磁盘是唯一事实来源，与 `mediaScan` 同一哲学：

| 扫描结果 | 处理 |
| --- | --- |
| 磁盘有、库里有 | 正常 |
| 磁盘有、库里没有 | 按 `import` 补录（`photographer` 为 null） |
| 磁盘没有、库里有 | 标 `missing`，列表灰显 +「移除记录」，**不物理删行**（署名与来源仍有价值） |
| 同一 `photo_id` 出现在两个目录 | 取路径字典序靠前者，另一份忽略 |

扫描范围：`unsplash/{YYYYMM}/*`（两层），扩展名白名单 `png|jpe?g|webp|gif`。触发时机：打开「已下载」tab 时（5s 节流）+ `stock/downloaded` 显式刷新。

### 4.4 列表缓存（`unsplash.json`）

浏览流与话题流**按页**把照片元数据落 `{storage.rootPath}/unsplash.json`，与 `unsplash/` 目录平级、不进索引库：它是可随时删除的缓存，删掉后下一次访问自然重建。

```json
{
  "version": 2,
  "lists": {
    "feed|any|default": {
      "key": "feed|any|default",
      "topic": null,
      "orientation": null,
      "orderBy": null,
      "pages": [
        {
          "page": 1,
          "photos": [
            {
              "id": "Kq2WnB6x9eA",
              "width": 4000,
              "height": 6000,
              "alt": "…",
              "photographer": "…",
              "urls": { "raw": "…", "full": "…", "regular": "…", "small": "…" },
              "downloadLocation": "…"
            }
          ],
          "syncedAt": "2026-11-12T08:00:00.000Z",
          "hasMore": true,
          "totalPages": 12,
          "total": 240
        }
      ]
    }
  }
}
```

- **键**：话题 slug 直接作键；推荐流用 `feed|{orientation}|{orderBy}`，三组筛选互不覆盖。
- **只缓存看过的页**：首屏进来只请求第 1 页并落盘；滚动到底触发续载时才请求第 N 页，两处走完全相同的读写规则（同一份文件、同一套 8 小时有效期）。
- **按页过期**：每页以自身 `syncedAt` 计 8 小时，到点后该页下次访问回源重取；重取任意一页都会作废它之后的页（分页顺序可能已变，旧的第 N+1 页接不上新的第 N 页）。
- **页数上限**：每个列表最多缓存 5 页（与前端续载上限一致），每页条数取 `zhai.stock.perPage`（默认 20），累计约 100 条。
- **刷新**：「更多 - 刷新」与 8 小时定时器只强制刷新当前列表的**首页**（后续页不再预取），只作用于当前话题与筛选。
- **话题失效降级**：话题首页返回 404（上游下线该 slug）时，改用 slug 作关键词搜一次（连字符拆空格）；限流、网络与权限错误不降级，照旧抛出。
- **并发**：同一「列表键 + 页码」的请求合并为一个 Promise；文件读改写排队执行，先写 `.part` 再 rename。
- **错误文案**：失败时在原文案后追加 `（列表：{key} 第 {N} 页）`，页面上一眼能看出是哪一页出的问题。
- **安全**：文件按不可信输入解析——`photoId` 必须满足上游形态，四档地址与计数端点只放行 `https` 的 Unsplash 主机，非法条目丢弃。
- **关键词搜索不落盘**：组合无穷、命中率极低，只走远端分页。
- **缩略图**：仍留在 `unsplash/.thumbs`；缓存命中也重新签发 webview 地址（仅当次会话有效），但不再发任何接口请求。

---

## 5. 页面结构与交互

### 5.1 挂载位置

新增常驻分区 `stock`：与 `media`、`proofread` 并列在中段工具组，笔记、公众号与作品文档下都可用。

| 落点 | 改动 |
| --- | --- |
| `workflowSections.ts` | `WORKFLOW_SECTIONS` 增 `stock`（类型与运行时白名单同源） |
| `contentScope.ts` | `RESIDENT_SECTIONS` 增 `stock`（排在 `media` 之后） |
| `WorkflowNav.tsx` | `TOOL_SECTIONS` 增 `stock`；`SECTION_META` 补文案「在线图库」与图标 |
| 图标 | `layout/UnsplashIcon.tsx` 内联 `resources/icons/unsplash.svg`（16×16 单路径，`fill="currentColor"` 跟随活动栏主题）。走 `<img>` 需要额外放行 `resources/icons` 并注入基址，内联同时省掉这两步 |
| 页面路由 | `WorkflowResidentSection` 的 `section === 'stock'` 渲染 `WorkflowStock`；作品与公众号归属经同一常驻分区判断自然命中 |

侧栏因此多一项（公众号归属下 13 项），中段本来就可滚动，不需要额外改造。

### 5.2 页面骨架

```
WorkflowStock
├─ AppHeader align=start
│    左 AppAction：「返回搜索」（仅已下载视图，动作位留等宽下限，标题不跳动）
│    AppTitle「在线图库」
│    右 AppAction：「已下载」图标按钮 +「更多」DropdownMenu（密钥设置 / 刷新）
│    AppDescription：统计胶囊（StatBadge）「已下载 N 张」「剩余 X 次」，悬停看精确口径，不展示插入目标与文档标题
│    AppMenu：搜索视图放话题标签（推荐 + 秋日 / 壁纸 / 自然 / 3D 渲染 / 实验 / 胶片 / 街头 / 建筑 / 纹理 / 旅行 / 人物，共 12 项固定清单，顺序同 Unsplash 官网导航），已下载视图放年月下拉
├─ 搜索视图（默认）
│    ├─ 话题标签：单行不换行 + 两端箭头滑动（到头即隐藏 + 边缘渐隐遮罩），首项固定「推荐」（= 不带话题的最新流），其余为前端固定常用话题（中文显示名 + 上游 slug），不回源拉取
│    ├─ 搜索栏固定在页头 AppMenu：Input（防抖 400ms）+ 方向下拉（不限/横图/竖图，话题浏览时禁用）+ 排序下拉（默认/最新/最旧/热门，关键词搜索时禁用），不随结果区滚动；无刷新按钮（「更多」菜单已有）
│    ├─ 未配置密钥 → StateEmpty + 打开设置
│    ├─ 冷却中 → StateEmpty「触发限流，请 14:32 后重试」
│    ├─ 首屏加载 → 6 张骨架卡（aspect-4/3）
│    ├─ 无结果 → StateEmpty「没有匹配的图片，换个关键词试试」
│    ├─ 网格：2 列（侧栏约 300px），卡片右上角 Badge「已下载」
│    └─ 首屏只取第 1 页（默认 20 条），滚动到底自动续载下一页（上限 5 页 = 约 100 条）；每页独立缓存
├─ 已下载视图（二级）
│    ├─ 按月分组，组头 sticky：`2026年11月 · 37 张`
│    ├─ 每组首屏 60 张，「加载更多」按 60 递增
│    ├─ 卡片：Image aspect-4/3 + lazy；hover：删除；点击：插入
│    └─ 空态：StateEmpty「还没有下载过图片」+ 引导去搜索
```

搜索视图是首页，已下载是二级视图：页头只放一个图标入口，300px 宽度下不挤占标题与筛选行；进入已下载后左侧出现返回按钮，回到搜索时搜索词与结果原样保留。密钥设置与刷新收进标题行的「更多」下拉菜单，不再设底部操作条。

### 5.3 复用清单

| 用途 | 复用 |
| --- | --- |
| 页面外壳三段式 | `@webview/components/AppPage`（`AppHeader` / `AppContent` / `AppTitle` / `AppDescription` / `AppMenu`） |
| 下拉菜单 | `@components/ui/dropdown-menu`（`DropdownMenuTrigger asChild` + `align="end"`） |
| 空态 | `@webview/components/StateEmpty` |
| 按钮 | `@webview/components/Button`（不写 `type="button"`） |
| 分段切换 | `@webview/components/SegmentedRail` |
| 图片与占位 | `@webview/components/Image`（`aspect="4/3"`，失败自动退占位） |
| 弹窗 | `@webview/components/FormDialog` / `ConfirmDialog` |
| 年月分组与懒挂载 | 参照 `workflow/imagegen/hooks/useImageFilters` 的 `visibleGroups` / `hasMore` / `loadMore` 口径 |
| 请求 | `@shared/utils/bridge` 的 `request`，错误 `@shared/utils/error` 的 `toastError` |

### 5.4 状态机与竞态

`useStockPhotos`（搜索 tab）：

```
idle → loadingFirst → ready | empty | error
                     └─ loadingMore（追加，独立于首屏 loading）
```

- **竞态**：`seq` ref 自增，响应回来 `seq !== 当前值` 直接丢弃。快速改关键词时必须有，否则旧结果会盖掉新结果。
- **话题与关键词互斥**：切话题清空搜索词；输入搜索词即回到「推荐」——话题端点不接受 `query`，方向筛选同理，故话题浏览时方向分段整组禁用。
- **配额闸门**：`isEnabled` 取 `stock/status.configured`，未配置密钥时一个请求都不发（此前会先撞一次 `not-configured`）。
- **话题清单**：标签行是前端固定的 12 项（「推荐」+ 11 个常用话题，顺序同 Unsplash 官网导航，中文显示名 + 上游 slug），点击即浏览该话题，不回源拉取标签。
- **分页**：浏览流、话题流与关键词搜索同一口径——`page` 从 1 起，`hasMore = page < totalPages && page < 5`（上限 5 页，只在前端封顶），追加时按 `photoId` 过滤已存在的条目。
- **按页缓存**：宿主按「列表键 + 页码」命中 `unsplash.json`，该页未过期（8 小时）直接返回并本地化缩略图，`isSyncing` 不置位；续载第 N 页时才回源第 N 页，不预取后续页。
- **刷新**：「更多 - 刷新」与 8 小时定时器带 `refresh: true`，只强制刷新当前列表的首页（后续页随 items 一起重置），二者共用同一个入口，只作用于当前话题与筛选；刷新期间菜单项显示「同步中…」并禁用。
- **失败处理**：首屏失败走错误态并提供「重试」；强制刷新失败与续载下一页失败只 toast、保留已展示的列表，继续滚动会再试同一页。
- **自动加载**：搜索面板底部哨兵进视口（提前 300px）即续载，没有「加载更多」按钮；`items` 变化即重建观察，一屏没填满会链式补载到填满或触顶。
- **视图保留**：搜索面板常驻挂载，切到已下载只用 `display` 隐藏——返回时不丢搜索词与已加载页，也不会因重挂载再搜一次（每次搜索都消耗配额）。
- **已下载视图插入成功后局部插入新卡**，不整页重拉；已下载视图的「刷新」只重读磁盘列表，不碰搜索侧的缓存。

### 5.5 卡片交互

| 位置 | 已下载视图 | 搜索视图 |
| --- | --- | --- |
| 点击卡片 | 插入 | 下载并插入 |
| hover 遮罩 | 摄影者 / 插入 / 删除 / 复制引用 | 摄影者 / 插入 |
| 右上角 | — | `已下载` Badge（命中 `stock.db`） |
| 处理中 | 卡片转圈、其余卡片禁用 | 同左 |

「复制引用」只复制 `@zhai/unsplash/...` 字符串，方便用户手写到别的文档。

---

## 6. 协议

方法与 `media/*` 并列，在 `HostMethodName` 中登记（拼错在编译期失败）；`stockRoutes` 与 `mediaRoutes` 同构（`switch` + 未登记方法抛错），由 Provider 按前缀委托。

| 方法 | 入参 | 返回 |
| --- | --- | --- |
| `stock/status` | 无 | `{ configured, secretHint, remaining, cooldownUntil, downloadedCount, target }` |
| `stock/key/save` | `{ accessKey }` | `{ configured, secretHint }` |
| `stock/key/clear` | 无 | `{ configured: false }` |
| `stock/search` | `{ query?: string, page: number, orientation?: 'landscape' \| 'portrait' \| 'squarish', topic?: string \| null, orderBy?: 'latest' \| 'oldest' \| 'popular' \| null, refresh?: boolean }` | `{ items: StockPhoto[], page, totalPages, total, hasMore, remaining, fromCache?, syncedAt? }` |
| `stock/insert` | `{ photoId }` | `StockInsertResult` |
| `stock/thumb` | `{ photoId }` | `{ thumbUrl: string \| null }` |
| `stock/downloaded` | `{ month?: 'YYYY-MM' \| null }` | `{ items: StockLocalPhoto[], months, total }` |
| `stock/remove` | `{ photoId }` | `{ removed: boolean }` |

```ts
/** 搜索结果条目：缩略图由宿主本地化，前端不再接触 Unsplash 域名 */
export interface StockPhoto {
    id: string
    thumbUrl: string | null      // 宿主下载到 unsplash/.thumbs 后签发的地址；null 表示取缩略图失败
    width: number
    height: number
    alt: string
    photographer: string
    photographerUrl: string
    downloaded: boolean          // 命中 stock.db，插入时不发网络
}

/** 已下载条目：数据源是磁盘，url 直接可用 */
export interface StockLocalPhoto {
    id: string
    path: string                 // unsplash/202611/Kq2WnB6x9eA.jpg
    url: string
    ext: string
    byteSize: number
    month: string                // YYYY-MM
    width: number | null
    height: number | null
    alt: string
    photographer: string | null
    downloadedAt: string
    /** 首次插入时所在文档的类型，仅展示 */
    scope: 'note' | 'wechat' | 'press' | 'general'
    missing: boolean
}

export type StockInsertReason =
    'no-editor' | 'unsaved' | 'not-markdown' | 'no-target' | 'download' | 'write' | 'not-configured'

export interface StockInsertResult {
    inserted: boolean
    reason?: StockInsertReason
    /** 存储根相对路径：unsplash/202611/Kq2WnB6x9eA.jpg */
    path?: string
    /** 写进正文的引用：@zhai/unsplash/202611/Kq2WnB6x9eA.jpg */
    refPath?: string
    /** webview 可访问的本地地址，用于即时回显与复制 */
    url?: string
    /** local = 命中本库，未发网络；remote = 本次下载 */
    source?: 'local' | 'remote'
    /** true 表示该文档已引用过这张图 */
    duplicated?: boolean
}
```

安全约束（写进 `src/shared/types/stock.ts` 头注释）：

- 前端只传 `photoId` 与受控枚举，**永不传 URL、路径、文件名**。下载地址由宿主缓存或回源取得。
- `photoId` 必须匹配 `^[A-Za-z0-9_-]{5,32}$`；`month` 必须匹配 `^\d{4}-(0[1-9]|1[0-2])$`。
- 密钥读写只走 SecretStorage，任何回执只给尾号。

---

## 7. 密钥与限流配置

### 7.1 密钥

`common/secrets.ts` 的 `SECRET_KEYS` 增一项：

```ts
unsplashAccessKey: 'zhai.unsplash.accessKey',
```

- `stock/key/save` 入参长度 20–64、`^[A-Za-z0-9_-]+$`；写入后立即用 `GET /photos?per_page=1` 探测一次，成功才回 `configured: true`，失败回 `invalid-key` 并提示（**不写入**）。
- 回执只给 `****{尾 4 位}`（模块内私有函数，不新增公共 util）。
- 不设任何默认回退值；密钥不入库、不入日志、不进错误文案。
- 用户申请入口：<https://unsplash.com/oauth/applications>（Demo 应用 50 次/小时，够个人使用）。

### 7.2 配置项（`contributes.configuration` 新增分组「宅写作：在线图库」，order 8）

| 键 | 类型 | 默认 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `zhai.stock.perPage` | number | 20 | 6–30 | 单页条数（浏览流、话题流与关键词搜索共用），Unsplash 上限 30；改此项会让已缓存页与新页的边界不一致，旧页按过期自然替换 |
| `zhai.stock.hourlyLimit` | number | 45 | ≥0 | 本地滑动窗口上限（0 表示不限）。Demo 应用为 50 次/小时，留出余量 |
| `zhai.stock.minIntervalMs` | number | 1200 | 250–10000 | 相邻请求最小间隔，避免连点把配额打光 |
| `zhai.stock.imageWidth` | number | 1600 | 800–3840 | 下载宽度，决定落盘体积；改配置只影响之后下载的图 |
| `zhai.stock.maxBytes` | number | 15 | 1–50 | 单图体积上限（MB），超出降档重下一次 |
| `zhai.stock.appendCredit` | boolean | true | — | 在 alt 中追加摄影者署名 |

`config.ts` 的 `ZhaiConfig` 加对应字段，数值统一用现成的 `readBoundedInt` 收敛。

---

## 8. 插入链路

### 8.1 目标解析

```
resolveInsertTarget()            // 与 mediaLibraryService 内的同名私有函数同口径，抽到共享处或各写一份
  ├ 无活动编辑器 → 回落最近可见的 file + markdown 编辑器
  ├ 仍无 → no-editor
  ├ scheme !== file → unsaved
  ├ languageId !== markdown → not-markdown
  └ 文档绝对路径 → 存储根相对路径 relPath

scope 判定（只用于提示与入库）
  ├ notes/...                      → note
  ├ wechat/{appid}/post/...        → wechat
  ├ press/...                      → press
  └ 其他                           → general
```

**不再按 scope 分目录**（D1）。公众号批次定位失败也不再阻断插入——图片不在批次目录里，两者没有耦合。

### 8.2 插入流程

```
stock/insert { photoId }
 │
 ├ 0. 解析插入目标（无编辑器 / 未保存 / 非 Markdown 直接返回四态，不下载、不扣配额）
 ├ 1. 校验 photoId 形态、密钥已配置
 ├ 2. 查 stock.db(photo_id)
 │     └ 命中且文件存在 → source='local'
 │          · 跳过内存缓存与网络，不发请求、不耗配额
 │          · 若 download_location 有值且本次触发过计数 → 跳过（已计过）
 ├ 3. 内存缓存 → 磁盘 unsplash.json 的元数据 → 下载
 ├ 4. 两处都未命中 → GET /photos/{id} 回源一次 → 下载
 ├ 5. 下载：w/q/fm 参数、30s 超时、退避 3 次、content-type 校验、体积降档
 ├ 6. 落盘 unsplash/{YYYYMM}/{photoId}.{ext}
 │     ├ 先写 `{name}.part`，成功再 rename（overwrite:false）
 │     └ 目标已存在 → 直接采用，不覆盖
 ├ 7. 触发 links.download_location（fire-and-forget）
 ├ 8. 写 stock.db（photo_id 主键，scope 记当前文档类型）
 ├ 9. 组装片段并插入
 │     alt = `${alt || '图片'}${appendCredit ? ' · ' + photographer : ''}`
 │     snippet = `![${alt}](@zhai/unsplash/${monthDir}/${photoId}.${ext})`
 │     editor.edit(b => b.insert(selection.active, snippet))
 └ 10. 返回 { inserted, path, refPath, url, source, duplicated }
```

**第 2 步前移的收益**：从「已下载」tab 插入全程零网络、零配额，断网与密钥失效时依然可用。

**第 0 步前置的收益**：没有活动光标时不会白下一张图——四态在下载之前就能判定；因此「下载成功但插入失败」只剩 `write`（编辑器拒绝写入）这一种。

**下载成功但插入失败**（`no-editor` / `unsaved` / `not-markdown`）：**文件保留**，回执带上 `reason`，前端提示「图片已保存到 `unsplash/`，未插入正文」。不自动回滚——回滚会让用户重试时再下一次。

### 8.3 去重三层

| 层 | 判据 | 行为 |
| --- | --- | --- |
| 列表层 | `photo.id` | 追加时过滤，翻页不出现双卡 |
| 下载层 | `stock.db(photo_id)` + 文件存在 | 直接复用，`source: 'local'`，不发网络 |
| 文档层 | `document.getText().includes(refPath)` | 仍插入，回执 `duplicated: true`，toast 改文案 |

文档层不拒绝插入：与 `media/insert` 现有语义一致，用户可能确实要在文中放第二处。

### 8.4 单任务锁

`stock/insert` 持有单任务锁（同 `imageGenerateService.activeRequest` 的模式），并发点第二张直接返回「正在处理上一张」。已命中的本地图不走锁（无副作用），只有需要下载的请求进锁。

---

## 9. 与既有模块的联动修复（必做）

### 9.1 推送链支持 `@zhai/`

图片不在批次目录内，公众号正文只能写 `@zhai/` 绝对引用，而 `wechat/materialService.ts` 的 `locateWechatImage()` 目前只按「相对源文档目录」解析，会把 `@zhai/unsplash/...` 拼成 `{批次目录}/@zhai/unsplash/...` → 文件不存在 → 推送时「未上传」→ 草稿破图。

**修复**（在 `locateWechatImage` 的 `EXTERNAL_PATTERN` 判定之后插入）：

```ts
// 存储根引用：@zhai/ 后即相对存储根路径，已由 readZhaiRelativePath 做过越界校验
const zhaiRelative = readZhaiRelativePath(trimmed)
if (zhaiRelative !== null) {
    return { kind: 'local', filePath: path.join(root, ...zhaiRelative.split('/')) }
}
```

其余分支（盘符绝对路径、相对批次目录、越界判非法）保持不变。这条修复同时让媒体库插入的 `@zhai/images/...` 在推送时也能正确上传，此前是一处潜在破图点。

> 若不做这条修复，公众号一侧的在线图库插入等于不可用（图能落盘、正文能写，但推上去是破图）。

### 9.2 媒体引用重建跳过在线图库

`media/mediaReferenceService.ts` 的 `parseImageReferences` 把「解析不到对应媒体」的引用一律计入 `stale`。`@zhai/unsplash/...` 按设计不在 `media` 表里，会被当成失效引用，于是媒体详情对任何引用过在线图库图片的文档都提示「N 处引用已失效」——纯属误报。

修复要区分两种「查不到」：`null` 仍表示 stale（图被删了），在线图库前缀则返回一个跳过标记（如 `resolveReference` 返回 `'skip'`），调用方遇到跳过标记既不加 stale 也不落库。判定口径与 §3 一致：`@zhai/unsplash/` 前缀，以及相对路径以 `unsplash/` 开头。

---

## 10. 代码改造清单

### 10.1 宿主

| 文件 | 职责 |
| --- | --- |
| `src/shared/types/stock.ts`（新） | `StockPhoto` / `StockLocalPhoto` / `StockInsertResult` / 各协议出入参 + `isStockPhotoId` / `isStockOrientation` / `isStockMonth` / `isStockTopicId` 收窄 |
| `src/shared/types/messages.ts` | `HostMethodName` 增 8 个 `stock/*` |
| `src/modules/stock/constants.ts`（新） | 目录名 `unsplash`、缩略图目录 `.thumbs`、扩展名白名单、体积上限、id 正则、窗口长度 |
| `src/modules/stock/client.ts`（新） | HTTP：端点、请求头、响应收窄、三道闸门、退避重试、错误码归一（`invalid-key` / `forbidden` / `rate-limited` / `network` / `server`） |
| `src/modules/stock/cache.ts`（新） | 内存 `photoId → {urls, links, photographer, alt}`（TTL 10 分钟，上限 500 条）+ 缩略图落盘与 TTL 清理 |
| `src/modules/stock/db/connection.ts`（新） | `sqlite/stock.db` 打开、建表、降级与 `quick_check` |
| `src/modules/stock/repository.ts`（新） | 表读写：`insert` / `find` / `list` / `remove` / `markMissing` |
| `src/modules/stock/stockNaming.ts`（新） | `buildUnsplashPath(photoId, ext, at)` → `{ relPath, monthDir, dirUri }`，目录创建前先探测 `photoId` 合法性 |
| `src/modules/stock/stockLibraryService.ts`（新） | `downloaded()` 磁盘扫描 + 对账、`remove()`、`status()` 计数 |
| `src/modules/stock/stockListCache.ts`（新） | `{root}/unsplash.json` 按页读写：不可信输入校验、`.part` + rename 落盘、读改写排队、按页 8 小时过期与每页条数一致性判定 |
| `src/modules/stock/stockService.ts`（新） | `status` / `search`（关键词走远端分页，浏览流与话题流按页走缓存）/ `insert` / `thumb` / `keySave` / `keyClear`；同一「列表键 + 页码」的并发请求合并为一次 |
| `src/modules/stock/stockRoutes.ts`（新） | 方法分发，未登记即抛错 |
| `src/modules/common/secrets.ts` | `SECRET_KEYS` 增 `unsplashAccessKey` |
| `src/modules/common/config.ts` | `ZhaiConfig` + `getZhaiConfig()` 增 6 个字段 |
| `package.json` | `contributes.configuration` 增分组「宅写作：在线图库」 |
| `src/extension.ts` | 装配 `stockDb` / `stockClient` / 各服务，注入 `toWebviewUri` 与 `resolveStorageRoot` |
| `src/modules/wechat/materialService.ts` | `locateWechatImage` 增 `@zhai/` 分支（§9.1） |
| `src/modules/media/mediaReferenceService.ts` | `resolveReference` 对 `@zhai/unsplash/` 与 `unsplash/` 相对路径返回跳过标记，不计入 `stale`（§9.2） |

### 10.2 前端

| 文件 | 职责 |
| --- | --- |
| `src/workflow/media/WorkflowStock.tsx`（新） | 在线图库页：搜索 / 已下载两个视图、话题标签行、月份下拉、密钥弹窗、删除确认 |
| `src/workflow/layout/UnsplashIcon.tsx`（新） | 侧栏品牌图标：内联 `resources/icons/unsplash.svg`，与 lucide 同签名 |
| `src/workflow/layout/workflowSections.ts` | 分区白名单增 `stock` |
| `src/workflow/layout/contentScope.ts` | `RESIDENT_SECTIONS` 增 `stock` |
| `src/workflow/layout/WorkflowNav.tsx` | `TOOL_SECTIONS` 与 `SECTION_META` 增 `stock` |
| `src/workflow/media/layout/StockFilterBar.tsx`（新） | 页头筛选行：关键词输入（input-group）+ 方向下拉 + 排序下拉，收进 AppMenu |
| `src/workflow/media/layout/imageList/ImageList.tsx`（新） | 搜索结果区：平铺网格 + 空态/错误态与滚动自动加载（哨兵 IntersectionObserver） |
| `src/workflow/media/layout/ScrollRail.tsx`（新） | 单行横向滑动壳：两端箭头（24px 常驻占位）+ 渐隐遮罩 + 选中项回滚，内容由 children 注入 |
| `src/workflow/media/layout/MonthSelect.tsx`（新） | 月份下拉：'all' ↔ null 折算、限高滚动，图库页与媒体页可共用 |
| `src/workflow/media/layout/StockQuotaBadges.tsx`（新） | 页头统计胶囊：已下载张数与剩余配额（悬停精确口径） |
| `src/workflow/media/layout/stockTopics.ts`（新） | 话题清单与「推荐位 ↔ 协议 null」两向折算 |
| `src/workflow/media/hooks/useStockDelete.ts`（新） | 删除确认状态机：pending / isDeleting / request / cancel / confirm（ref 闸门防重入） |
| `src/workflow/media/layout/imageList/imageListAdapters.ts`（新） | 搜索结果与已下载条目映射成统一条目：署名、已下载/已丢失角标、缺图占位 |
| `src/workflow/media/layout/StockSearchBar.tsx`（新） | 搜索框 + 方向分段 + 刷新 |
| `src/workflow/media/hooks/useImageListPaging.ts`（新） | 已下载按月分组后的统一分批：每组首屏 60 张，滚动续载 |
| `src/workflow/media/layout/StockKeyDialog.tsx`（新） | 密钥配置弹窗（只写不读回，回显尾号） |
| `src/workflow/media/hooks/useStockPhotos.ts`（新） | 搜索、话题与关键词互斥、按页续载（上限 5 页）、竞态、首屏与追加两种 loading、当前列表首页 8 小时自动刷新与强制刷新 |
| `src/workflow/media/hooks/useStockDownloaded.ts`（新） | 已下载列表、删除、局部插卡 |
| `src/workflow/media/hooks/useStockInsert.ts`（新） | 插入、按 `reason` 分支提示、失败重试 |
| `src/workflow/media/hooks/useStockStatus.ts`（新） | 密钥状态、配额、冷却倒计时、目标文档标题 |
| `src/workflow/layout/WorkflowResidentSection.tsx` | 增 `section === 'stock'` 分支渲染 `WorkflowStock`；`media` 分支维持 `WorkflowMedia` 不变 |
| `src/workflow/press/layout/PressSectionRouter.tsx` | 增 `section === 'stock'` 分支——该路由的默认分支是 AI 对话，缺这行会在作品文档下点到在线图库却看到对话页 |

> `WorkflowMedia` 无需改动：媒体分区保持原样，在线图库是并列的另一项分区。

### 10.3 文档

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `docs/modules/media.md` §3.1 | 目录树补 `unsplash/` 与 `stock.db`；规则补「在线图库不进媒体索引与扫描」「引用重建跳过 `@zhai/unsplash/`，不计 stale」 | 已完成（2026-11-03） |
| `docs/modules/wechat.md` §12.6 | 补「正文图片的两种写法」与「推送链只认相对路径、`@zhai/` 分支待补」的现状说明 | 已完成（2026-11-03） |
| `docs/modules/stock.md` §9.2 | 新增媒体引用重建跳过在线图库的联动修复 | 已完成（2026-11-03） |

### 10.4 测试

新增单测：`stockNaming`（路径与年月）、`stockClient`（401/403/429 映射、`Retry-After` 冷却、`X-Ratelimit-Remaining` 解析、重试次数、content-type 校验）、`stockRepository`（对账三分支）、`stockService`（去重命中不发网络、下载失败回执、插入四态、`duplicated` 判定）、`locateWechatImage`（`@zhai/` 分支）、`useStockPhotos`（竞态丢弃、翻页去重、`hasMore` 边界）。

组件测：`__tests__/components/ImageList.test.tsx`（缩略图与角标、在途占位、主动作、悬停操作不冒泡、多选与键盘）、`__tests__/workflow/mediaImageList.test.ts`（年月格式化与分组、四类适配器映射）。

---

## 11. 边界情况

| # | 情况 | 处理 |
| --- | --- | --- |
| 1 | 未配置密钥 | 搜索视图空态引导；`stock/*` 非配置方法前置拒绝 `not-configured`；已下载视图照常可用 |
| 2 | 密钥失效 401 | 打开密钥弹窗提示重新填写，**不自动清除**（避免误丢配置） |
| 3 | 403 权限不足 | 提示到 Unsplash 应用后台确认状态，不透出英文原文 |
| 4 | 429 限流 | 读 `Retry-After` 写冷却，页面显示倒计时空态；冷却期内直接拒绝，不发网络 |
| 5 | 配额将尽 | `remaining < 5` 时页头提示，不阻断 |
| 6 | 本地窗口用尽 | 文案「本小时调用已达上限（45），可在设置中调整 `zhai.stock.hourlyLimit`」+ 恢复时间 |
| 7 | 网络超时 / 5xx | 退避 3 次（1/2/4s + 抖动），仍失败给「重试」按钮 |
| 8 | 缩略图单张失败 | 该卡显示 `Image` 占位，其余卡片正常；点「重试」调 `stock/thumb` |
| 9 | 下载失败 | 同上退避；失败 `reason: 'download'`，**不写库、不写盘**，卡片可重试 |
| 10 | 响应非图片（CDN 返回 HTML） | `content-type` 不以 `image/` 开头即按失败处理，避免落一张 0.5KB 坏图 |
| 11 | 图片超 `maxBytes` | 降档 `w=1080` 重下一次；仍超限则拒绝并提示 |
| 12 | 写盘失败（磁盘满/占用/权限） | 删除 `.part`，`reason: 'write'`，错误文案带具体原因，目录不留残留 |
| 13 | 目标文件已存在 | 不覆盖，直接采用并提示「该图此前已下载，已复用本地文件」 |
| 14 | 无活动编辑器 / 非 Markdown / 未保存 | `no-editor` / `not-markdown` / `unsaved`；已落盘的文件保留，提示「已保存未插入」 |
| 15 | 公众号批次定位失败 | **不阻断**：图片不在批次目录，scope 记为 `wechat` 即可 |
| 16 | 连点插入 | 单任务锁，第二次返回「正在处理上一张」；本地命中不进锁 |
| 17 | 进程重启后缓存失效 | 命中 `stock.db` 直接插入（不发网络）；未命中回源 `/photos/{id}` 一次 |
| 18 | 「已下载」列表里的文件被外部删除 | 扫描标 `missing` 灰显 +「移除记录」；点插入回 `reason: 'download'` 并可重新下载 |
| 19 | `unsplash/` 目录被整体删除 | 下次扫描为空，库内行全标 missing；插入自动转远程下载 |
| 20 | 同一 `photoId` 手工放入两个月份 | 取路径字典序靠前者，另一份忽略并在对账时记日志 |
| 21 | `.thumbs` 无限增长 | 上限 1200 张或 7 天，按 mtime 升序清理；扫描跳 `.` 开头目录。上限按「每列表 100 张 × 12 个话题」留量，偏小会把刚缓存列表的缩略图挤掉 |
| 22 | 文档已引用同一张图 | 照旧插入，`duplicated: true` + toast「该文档此前已引用过这张图」 |
| 23 | 删除已下载图时正文仍在引用 | 二次确认文案如实写「正文引用会显示破图」，不阻断、不代改文档 |
| 24 | 存储根切换 | 全部相对路径，无需迁移；`unsplash/` 随根走，`stock.db` 随之重建对账 |
| 25 | 中文关键词搜不到结果 | 提示「Unsplash 以英文内容为主，换英文关键词命中率更高」 |
| 26 | 侧栏宽度 300px | 网格固定 2 列，不做响应式列数自适应；卡片 aspect-4/3 |

---

## 12. 分期与验收

### 12.1 P0（一次做完）

1. 宿主：类型、协议、客户端（含三道闸门与错误归一）、`stock.db`、路径生成、扫描对账。
2. 插入链路：目标解析、下载、原子落盘、`@zhai/` 引用、单任务锁。
3. 前端：`WorkflowStock` 两个视图（标题行图标入口 + 返回按钮）+ 五个 layout + 四个 hook。
4. 与既有模块的联动修复：`locateWechatImage` 支持 `@zhai/`；媒体引用重建跳过 `unsplash/`（不误报 stale）。

验收：

1. 未配置密钥进「搜索」→ 空态引导；配置后自动列出首批 20 张，页头显示剩余配额。
2. 输入关键词 → 400ms 后出结果；快速连改关键词不出现旧结果覆盖新结果。
3. 「加载更多」追加 20 张，无重复卡；骨架只在首屏出现。
4. 在 `notes/202611/xx.md` 光标处点图 → 落 `unsplash/202611/{photoId}.jpg`（文件名与 Unsplash 官方下载一致，无时间戳前缀），正文写 `@zhai/unsplash/...`，预览正常。
5. 在 `wechat/wx123/post/202611021530/文章.md` 点同一张图 → **不产生第二份文件**；该批次「生成草稿」时图片上传为永久素材，无「未上传」告警。
6. 断网点「已下载」里的图 → 正常插入，全程无网络请求，`source: 'local'`。
7. 搜索结果里已在本地 → 卡片显示「已下载」Badge，插入不发请求。
8. 手工把 `foo.jpg` 放进 `unsplash/202611/` → 刷新「已下载」后可见，摄影者显示空。
9. 删除已下载图 → 文件进回收站、库行删除、计数减 1；正文引用变破图（如确认框所述）。
10. 已下载图被外部删除后插入 → 提示本地文件丢失并自动重新下载，成功后继续插入。
11. 连续快速搜索触发 429 → 页头进入倒计时，冷却结束后恢复。
12. 断网后下载 → 卡片显示重试，3 次退避后回执 `download`，磁盘无 `.part` 残留。
13. 插入成功 toast 带摄影者署名；关闭 `zhai.stock.appendCredit` 后 alt 不含署名。
14. 对引用过在线图库图片的笔记/批次文章执行「重新扫描关联」→ 媒体详情不出现「N 处引用已失效」的误报，`media/rescan` 的 `stale` 计数不因 `unsplash/` 引用增加。

### 12.2 P1（体验补全）

- 已下载列表关键词过滤（按 alt / photoId）。
- 缩略图懒加载：搜索结果先出卡片，`thumbUrl` 为 null 的由前端批量补图，缩短首屏等待。
- 插入后自动移动到下一张（键盘流）。
- 已下载图的「复制文件到剪贴板」（复用 `media/clipboardImage`）。
- 多图源适配器（Pexels / Pixabay）。

### 12.3 P2（可选）

- 宽高从文件头解析（手工放入的图）。
- 已下载按体积统计。
- 引用扫描：把 `unsplash/` 也纳入 `mediaReferenceService` 的引用重建范围（只统计、不入库）。

---

## 13. 决策记录

| # | 决策 | 结论 | 理由 |
| --- | --- | --- | --- |
| 1 | 存储目录 | 统一 `unsplash/{YYYYMM}/`，不按内容类型分 | 同一张图在多篇文章复用时不产生副本；断网与配额耗尽时仍可用 |
| 2 | 文件名 | 沿用 Unsplash 下载名 `{photoId}.{ext}`，不拼时间戳 | 上游已给定唯一名，省掉命名器与冲突顺延；天然去重 |
| 3 | 索引库 | 存储根 `sqlite/stock.db`，`photo_id` 单列主键 | 与 `media.db` 同级随根迁移；单键即可唯一 |
| 4 | 是否入媒体库 | 不入 | 合库要改扫描范围、路径白名单、引用解析三处，收益不抵成本 |
| 5 | 页面结构 | 搜索为首页，已下载为二级视图（标题行按钮进入、返回退出） | 300px 侧栏里平铺两个 tab 会与标题、筛选行抢位；二级视图仍保留本地可用性 |
| 6 | 正文引用 | 一律 `@zhai/` 绝对引用 | 图不在文档目录，相对路径随文档移动失效 |
| 7 | 公众号联动 | `locateWechatImage` 支持 `@zhai/` | 否则推送时图片「未上传」，草稿破图 |
| 8 | 缩略图 | 宿主下载到 `unsplash/.thumbs/` 后签发本地地址 | webview CSP 为 `img-src ${cspSource} data:`，不放宽 CSP 也能显示 |
| 9 | 限流 | 本地 60 分钟滑动窗口 + 最小间隔 + 429 冷却 | Demo 应用 50 次/小时，三道闸门把「连点打光配额」挡在前面 |
| 10 | 密钥 | `SecretStorage`，只回尾号 | 与 `common/secrets` 现有口径一致，不入 settings.json |
| 11 | 页面位置 | 独立常驻分区 `stock`（侧栏品牌图标） | 与 `media` 并列的取图入口，平级比「进入媒体页再切视图」更直观；新增品牌图标本来也需要一个独立入口承载 |
