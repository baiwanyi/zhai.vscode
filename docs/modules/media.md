# Media（媒体管理）— 模块设计方案

**版本**：1.1（按 2026-10-29 确认信息修订）
**日期**：2026-10-29
**状态**：已定稿，待实施
**宿主**：VSCode 插件 Zhai（宅桌面）
**前身**：`docs/modules/imagegen.md`（生图模块，图片按 `press/{作品}/Images/` 归档）
**存储根**：`{storage.rootPath}/images/{YYYYMM}/`，索引在 `{storage.rootPath}/.media/media.db`

---

## 1. 目标与边界

### 1.1 目标

把「生图页」升级为「媒体管理」：

1. **落盘收敛**：全部图片统一归档到存储根 `images/{YYYYMM}/`，文件名不带语义，便于长期累积与备份。
2. **检索维度改为时间**：只按年月筛选，去掉图片类型筛选。
3. **可追溯**：每张图能回答两个问题——**它是为什么生成/导入的**（出处，一对一），**它现在被谁用着**（引用，一对多）。
4. **跨作用域**：作品、笔记、外部文档产生的图片进入同一仓库，用元数据而非目录区分来源。

### 1.2 非目标

| 项 | 说明 |
| --- | --- |
| 视频 / 音频 / 文档 | 本期只管图片，`media` 表留扩展位但不实现播放与转码 |
| 云同步 / 图床 | 不做上传，不做远端去重，不做 CDN |
| 图片编辑 | 不做裁剪、滤镜、旋转、格式转换 |
| 类型筛选 | 明确不做。`kind` 只作为展示标签存在，不进筛选条 |
| 标签体系 | 不做用户自定义标签（出处 + 引用已覆盖主要检索需求） |

### 1.3 已确认的四项决策（2026-10-29）

| # | 决策 | 影响章节 |
| --- | --- | --- |
| 1 | 正文插入改为**引用原图**（写 `@zhai/` 存储根引用，不复制副本） | §5.4 |
| 2 | 删除角色 / 条目 / 作品时**不删图**，也不改写出处字段 | §7.2 |
| 3 | 默认**全量按月分组**展示，年月下拉只用于过滤 | §6.1、§6.2 |
| 4 | 索引库**放存储根**（`.media/media.db`），不放缓存目录 | §4.1 |

**关于决策 4 的原因**：放缓存目录时，重建只能恢复文件清单（`id` / `path` / `month` / 体积），而**出处（作品、角色、条目）、出图参数（提示词、比例、画风）、`origin`、`scope` 全部丢失**，`external` 类引用更是无从恢复（需扫全盘）。这些正是本次升级的核心价值，因此索引必须与图片同处一个存储根，随备份与迁移一起走。

### 1.4 关联是「一对多」

- **出处是一对一**：一张图只有一个生成来源（某角色的某次出图、某条目的某次出图、某作品内的普通出图、或导入）。
- **引用是一对多**：同一张图可以同时是 A 作品封面、B 角色封面、3 个章节的插图、2 篇笔记的配图。`media_usage` 以「一行一条引用」存储，不做合并压缩。

---

## 2. 成熟实践参照

| 应用 | 借鉴点 | 本项目落地 |
| --- | --- | --- |
| Google Photos | 时间是唯一主轴，按月分组 + 快速跳月 | 默认全量按月分组 + 年月过滤（§6.1、§6.2） |
| Eagle | 「文件夹分类」弱化，「资源库 + 元数据」为主 | 文件名去语义，元数据入表（§3.2、§4.2） |
| Obsidian | 反向链接面板：资源页列出「被哪些文档引用」并可跳转 | `media_usage` 多行 + 详情分组列表（§5.7） |
| WordPress 媒体库 | 「已上传至 / 被用于」把附件与内容绑定，删除前提示引用 | 出处 + 引用双栏，删除前列清单（§5.1、§7.1） |

共同结论：**文件系统只负责存储，检索与关系必须落到索引**。本项目当前「磁盘是唯一事实来源、靠文件名解析归属」的做法在类型膨胀后会失效——这是本次升级的技术核心。

---

## 3. 目录与命名规范

### 3.1 目录

```
{storage.rootPath}/
├── images/
│   ├── 202610/
│   │   ├── 20261029153045aB3xK9.png
│   │   └── 20261029153102Qm7TzR.webp
│   └── 202611/
│       └── 20261101102233Kd4WnE.png
├── .media/
│   └── media.db                 ← 媒体索引（随存储根迁移、可随 images 一起备份）
├── press/{作品名}/               ← 文档、人物卡、设定，图片不再写这里
├── notes/202610/                ← 笔记
└── prompt/images/               ← 词库预览图（独立体系，不纳入媒体库）
```

规则：

- 年月目录名固定 6 位 `YYYYMM`，**按本地时区**计算。不用 `2026/10/` 两级：一层即可让「路径第二段 = 筛选键」，目录遍历与备份脚本都简单；个人量级（每月数百张）远未到单目录性能拐点。
- `images/` 与 `press/`、`notes/` 平级。换存储根时整库迁移，路径全部是相对路径，不需要改写任何记录。
- 空目录不预建，落盘时 `createDirectory({recursive: true})`。
- `prompt/images/` 是词库预览图，由 `zhai.prompt.rootPath` 派生，**不属于媒体库**，扫描必须排除。
- `.media/` 只放索引，扫描 `images/**` 时天然不会命中（扫描只按 `images/{YYYYMM}/{文件}` 两层取）。

### 3.2 文件名

```
{YYYYMMDDHHMMSS}{6 位随机}.{ext}
```

| 项 | 值 |
| --- | --- |
| 时间戳 | 14 位本地时间，与目录同一次计算（避免跨秒/跨月时目录与文件名错位） |
| 随机段 | `[A-Za-z0-9]{6}`，62 进制，`Math.random` 足够（不是安全场景） |
| 主干长度 | 固定 20 位 |
| 扩展名 | 取产物真实类型：`png` / `jpeg` / `webp` / `gif`，小写 |
| 校验正则 | `^\d{14}[A-Za-z0-9]{6}$` |
| 示例 | `20261029153045aB3xK9.png` |

**为什么去掉 `portrait-` / `photo-` 前缀：** 前缀把「生成意图」编码进文件名，每新增一种来源（视频、参考图、导入、笔记配图）就要扩一套正则，并且与「文件可能被移动/改名」天然冲突。改造后文件名只承担三件事：**唯一、可读、可按时间排序**，其余交给索引表。

### 3.3 冲突与幂等

- 同秒 + 同随机段的概率约 1/5.7e10，但仍要探测：写入前 `stat` 目标路径，存在则**重取随机段**（最多 5 次），仍冲突则时间戳 +1 秒再来一轮（上限 60 次）。
- 与旧实现 `nextImageId` 的差别：旧实现「按秒顺延、不改归属段」，新实现「按随机段重试、时间戳基本不动」，因为时间戳不再是唯一性来源。
- 写文件使用「先探测、再写」；`vscode.workspace.fs.writeFile` 本身会覆盖，探测必须在前。

### 3.4 手工放入与导入

- 用户直接往 `images/202610/` 丢文件是允许的：对账时按 `import` 补录，`kind=unknown`、`origin=import`。
- 文件名不符合规范也能管理，**id 取文件名主干**，因此要求主干在库内唯一；主干重复时以先入库者为准，后者标 `duplicate` 并提示改名。
- 拖拽/粘贴导入（P1）：落盘时统一走 `nextMediaId` 重命名，避免把用户的任意文件名带进索引。

---

## 4. 数据模型

### 4.1 存储选型与位置

| 候选 | 结论 |
| --- | --- |
| 侧车 `{id}.json` | 否。跨目录聚合要全量遍历，无法按年月/引用查询 |
| 放进 `press.db` | 否。媒体跨作品/笔记/外部，与「写作管理库」语义不符 |
| 新建 `media.db`，放缓存目录 | 否。重建会丢出处、出图参数与 external 引用（见 §1.3） |
| 新建 `media.db`，放 `{storage.rootPath}/.media/` | **采用**。与图片同处一个根，备份/换机/换根一并带走 |

**打开与降级**：

```ts
// 主路径：{root}/.media/media.db
// 降级：{cache}/media.db（存储根只读 / UNC 锁失败 / 权限不足）
```

- 每次按当前 `resolveStorageRoot()` 求值，连接按根路径缓存（`Map<string, Database>`），监听配置变更后关闭旧连接。
- 打开后执行 `PRAGMA quick_check`；非 `ok` 则把文件重命名为 `media.corrupt-{timestamp}.db` 并重建，界面一次性提示「索引已重建，历史出处与出图参数不可用」。
- **PRAGMA 与公共基座不同**：`media.db` 用 `journal_mode = DELETE`（单文件，避免云盘同步 `-wal` / `-shm` 产生冲突副本）、`synchronous = FULL`（写入低频，元数据优先级高于性能）。`openSqliteDatabase` 增可选参数 `journalMode`，不另写一套打开逻辑。

| 缓存目录方案丢失的数据 | 存储根方案 |
| --- | --- |
| 出处：`press_path` / `character_id` / `character_name` / `lore_*` | 保留 |
| 出图参数：`prompt` / `ratio` / `style` / `enhanced_from` | 保留 |
| `origin`（生成 / 导入 / 迁移）、`scope` | 保留 |
| `press_cover` / `character_cover` / `lore_cover` 引用 | 可从 `press.db` 与 md 封面行重建 |
| `chapter` / `note` 引用 | 可扫描文档重建 |
| `external` 引用（存储根外文档） | **无法重建**（需扫全盘） |

### 4.2 `media` 表

```sql
CREATE TABLE IF NOT EXISTS media (
    id             TEXT PRIMARY KEY,           -- 文件名主干，20 位
    path           TEXT NOT NULL UNIQUE,       -- images/202610/20261029153045aB3xK9.png（相对存储根）
    ext            TEXT NOT NULL,              -- png | jpeg | webp | gif
    byte_size      INTEGER NOT NULL DEFAULT 0,
    width          INTEGER,                    -- 可空：能读文件头则填（P2）
    height         INTEGER,
    month          TEXT NOT NULL,              -- YYYY-MM，本地时区，筛选键
    created_at     TEXT NOT NULL,              -- ISO 8601（UTC），落盘时刻
    scope          TEXT NOT NULL DEFAULT 'general',  -- press | note | wechat | general
    origin         TEXT NOT NULL DEFAULT 'import',   -- generate | import | migrate
    kind           TEXT NOT NULL DEFAULT 'unknown',  -- portrait | lore | photo | unknown（仅展示）
    -- 出处：生成时的归属，写入后不再改写（历史事实）
    press_path     TEXT,                       -- press/{作品名}
    press_name     TEXT,                       -- 作品名快照
    character_id   TEXT,
    character_name TEXT,                       -- 角色名快照
    lore_kind      TEXT,                       -- faction | place | item
    lore_id        TEXT,
    lore_name      TEXT,
    -- 出图参数（原侧车字段）
    prompt         TEXT,
    ratio          TEXT,
    style          TEXT,
    enhanced_from  TEXT,
    missing        INTEGER NOT NULL DEFAULT 0  -- 1 = 索引有记录但磁盘文件已不在
);

CREATE INDEX IF NOT EXISTS idx_media_month ON media(month DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(press_path, character_id, lore_kind, lore_id);
CREATE INDEX IF NOT EXISTS idx_media_scope ON media(scope, month DESC);
```

字段说明：

- `id` 即媒体 ID，也是协议的唯一标识。**前端永远只传 id，不传路径**，路径由宿主查表得出——既防路径注入，也让文件移动不影响调用方。
- `month` 单独存一列而不是从 `path` 切片：`path` 可能被纠正（文件被移到正确月份），列与目录不一致时以对账结果为准并回写。
- `press_path` / `press_name`、`character_id` / `character_name`、`lore_id` / `lore_name` 都是**双份**：id 用于回查当前名称，name 是快照。对象被删除后 id 查不到，退回快照显示并加「（已删除）」标记。
- **出处字段一经写入永不修改**（决策 2）：删除角色/条目/作品不 UPDATE 表，避免批量写放大，也保证"这张图当时是给谁画的"这一历史事实不被抹掉。
- `missing` 用于「文件被外部删除」的降级展示，不物理删除记录（否则引用关系一起丢）。

### 4.3 `media_usage` 表（一对多）

```sql
CREATE TABLE IF NOT EXISTS media_usage (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id   TEXT NOT NULL,
    ref_type   TEXT NOT NULL,   -- press_cover | character_cover | lore_cover | chapter | note | external
    ref_path   TEXT NOT NULL,   -- 存储根相对路径；external 为绝对路径
    ref_scope  TEXT NOT NULL DEFAULT 'storage',  -- storage | absolute
    ref_id     TEXT,            -- 角色 / 条目标识；章节与笔记为 NULL
    ref_title  TEXT,            -- 章节标题 / 笔记标题 / 作品名 / 文件名快照
    ref_anchor TEXT,            -- 文档内首次出现的行号
    seen_at    TEXT NOT NULL,
    UNIQUE(media_id, ref_type, ref_path, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_media ON media_usage(media_id);
CREATE INDEX IF NOT EXISTS idx_usage_ref ON media_usage(ref_path);
CREATE INDEX IF NOT EXISTS idx_usage_type ON media_usage(ref_type);
```

`ref_type` 语义：

| ref_type | 含义 | ref_path | ref_id |
| --- | --- | --- | --- |
| `press_cover` | 作品封面 | `press/{作品名}` | NULL |
| `character_cover` | 角色卡封面 | `press/{作品名}/角色设定.md` | 角色 ID |
| `lore_cover` | 设定条目封面 | `press/{作品名}/{势力\|地点\|物品}.md` | 条目 ID |
| `chapter` | 章节正文引用 | 章节 md 路径 | NULL |
| `note` | 笔记正文引用 | `notes/YYYYMM/xxx.md` | NULL |
| `external` | 存储根外文档引用 | 绝对路径 | NULL |

一对多的三条约束：

1. **同一张图 × 同一引用方 = 1 行**（UNIQUE 保证幂等，重复扫描不产生重复行）。
2. **同一张图 × N 个引用方 = N 行**，跨作品、跨笔记自由组合，不需要按作品前缀分区。
3. **同一文档内多次引用同一张图 = 1 行**，`ref_anchor` 记首次出现的行号——否则「被 5 处使用」会被同一篇文章刷成 5 次，失去意义。

### 4.4 派生数据

不建冗余表，全部现算：

| 派生 | 口径 |
| --- | --- |
| 年月选项 | `SELECT month, COUNT(*) FROM media WHERE missing = 0 GROUP BY month ORDER BY month DESC` |
| 某月张数 | 同上，`month = ?` |
| 引用数 | `SELECT COUNT(*) FROM media_usage WHERE media_id = ?` |
| 引用分组 | `ORDER BY ref_type, seen_at DESC` |
| 某封面 | `press.db` 的 `cover:{press/xxx}` 指针不变，仍由 `PressCoverStore` 负责 |

### 4.5 与现有存储的关系

| 现有 | 改造后 |
| --- | --- |
| `press.db` meta `cover:{press/作品}` 存相对路径 | 继续存**媒体路径**（`images/202610/xxx.png`），校验由「四段 press 路径」改为「以 `images/` 开头且 id 在 media 表内」 |
| 角色卡 / 条目 md 的 `- 封面：<id>` | 继续存**媒体 id**（旧 id 在迁移时映射为新 id） |
| 侧车 `{id}.json` | 迁移时读入 `media` 表后删除；新图不再写侧车 |
| `index.db` 的 `files` | 不纳入图片（继续只索引文档），媒体检索走 `media.db` |

---

## 5. 关联关系

### 5.1 两种关联

| 类型 | 问题 | 基数 | 写入时机 | 存储 |
| --- | --- | --- | --- | --- |
| **出处**（origin） | 这张图为什么存在 | 一对一 | 出图 / 导入时一次性写入，此后不改 | `media` 表出处列 |
| **引用**（usage） | 这张图现在被谁用着 | 一对多 | 设封面、插入正文时写；扫描对账兜底 | `media_usage` 表 |

两者独立：一张角色图可以「出自某作品的角色卡」但「被另一篇笔记引用」；一张普通图可以「没有出处」但「被 3 个章节引用」。界面必须分开呈现，不能合并成一句「关联作品」。

### 5.2 出处写入规则

| 生成场景 | 写入 |
| --- | --- |
| 角色卡出图（`kind=portrait`） | `kind=portrait`、`press_path`、`press_name`、`character_id`、`character_name`（按当前人物卡回查）、`scope=press`、`origin=generate` |
| 设定条目出图（`kind=lore`） | `kind=lore`、`press_path`、`press_name`、`lore_kind`、`lore_id`、`lore_name`、`scope=press` |
| 作品内普通出图（`kind=photo`） | `kind=photo`、`press_path`、`press_name`、`scope=press` |
| 笔记配图 | `scope=note`、出处列全空 |
| 拖拽导入 / 手工放入 | `scope=general`、`origin=import`、`kind=unknown` |

关键点：

- **`press_path` 是「所属作品」的唯一表达**，不解析目录、不看文件名。角色图与设定图因此天然带上「角色名 + 所属作品」两个展示信息（需求 5、6）。
- 名称一律**快照 + 回查**：展示时先按 id 到当前作品的人物卡里取名字，取不到再用快照并标注「已删除」。
- 使用「作品设定」上下文出图（`contexts` 含设定快照）仍按 `kind=photo`，但 `press_path` 会写入——满足「使用作品设定生成的图片需关联对应作品」。

### 5.3 引用登记

| 动作 | 写入的 usage |
| --- | --- |
| 详情面板「设为作品封面」 | 先删该 `press_path` 的旧 `press_cover`，再插入新记录 |
| 角色卡封面变更（前端 `useCharacterCoverSync` 写回） | 宿主在 `updateCharacter` 落盘后同步 `character_cover` |
| 条目封面变更 | 同上，`lore_cover` |
| 插入到编辑器 | 按目标文档路径判定 `chapter` / `note` / `external`，写入一条 |
| 删除媒体 | 清空该 `media_id` 的全部 usage |

### 5.4 正文引用形态（决策 1：引用原图）

**插入 = 在光标处写入指向原图的 `@zhai/` 存储根引用，不复制副本。**

```markdown
![林小满](@zhai/images/202610/20261029153045aB3xK9.png)
```

实现要点：

- 路径 = `@zhai/` + 媒体相对路径，与文档所在目录无关；文档或作品目录整体移动后引用依旧有效，不需要重算。
- alt 取出处名：`character_name` → `lore_name` → 作品名 → `媒体 {YYYY-MM-DD HH:mm}`。
- 不再有跨盘降级：`@zhai/` 只依赖存储根配置，存储根与文档是否同盘都不影响写入的形态。
- 文档未保存、非 Markdown、无活动编辑器、写入失败：返回 `no-editor` / `unsaved` / `not-markdown` / `failed` 四态。

收益与代价：

| 收益 | 代价 / 缓解 |
| --- | --- |
| 源图更新即刻生效，不再有「副本与源图不同步」 | 作品目录单独拷贝会丢图 → P1「导出作品时打包图片」 |
| 磁盘不再双份，媒体库体积统计真实 | 文档被拷到存储根之外时 `@zhai/` 无处解析 → 需带着存储根一起搬 |
| 文档移动、作品改名都不需要改写正文 | 渲染依赖配置的存储根，换根后所有引用一起指向新根（这正是期望行为） |
| 引用天然可追踪，不依赖文件名反查 | 外部编辑器不认该前缀 → 用 VS Code 原生预览或 webview 查看 |

### 5.5 `@zhai/` 存储根引用

正文以 `@zhai/` 开头的引用由媒体页插入时自动写入，也允许用户或 AI 手写：

```markdown
![林小满](@zhai/images/202610/20261029153045aB3xK9.png)
```

| 环节 | 处理 |
| --- | --- |
| 媒体索引（`mediaReferenceService.resolveReference`） | 前缀后即存储根相对路径，直接回查 `path` 列，命中后记 `chapter` / `note` 的 usage |
| webview（react-markdown） | `@shared/utils/zhaiPath` 拼宿主注入的存储根基址（`<meta name="zhai-storage-base">`），产出 `vscode-webview-resource:` URL |
| VS Code 原生 Markdown 预览 | `extendMarkdownIt` 挂 markdown-it 插件（`modules/markdown/zhaiImagePreview.ts`），把前缀指向的图片读成 data URI 内联，绕开预览的资源白名单；超上限或读取失败才退回相对路径 / `file://` |

约束：

- 只替换前缀，前缀后的子目录与文件名原样保留；`?query` / `#hash` 一并保留。
- `..`、空段、反斜杠与盘符一律不认，越界引用按 `stale` 处理、不落库。
- 基址末尾斜杠有无都收敛为单个分隔符，避免 `//` 或缺失分隔符。
- 非 `@zhai/` 前缀（相对路径、`http(s)`、`data:`）行为不变。
- 原生预览的资源白名单只含工作区与当前文档目录，存储根一般在其外，相对路径与 `file://` 都会被拦下——插件因此把图片内联成 data URI（单图上限 8MB，按 mtime + 体积缓存）；超过上限的图退回相对路径，此时多半显示不出来，需要预览大图时把存储根作为工作区打开。

媒体页「插入到编辑器」写的就是这一形态（§5.4），无需再手工换算路径。

**迁移期兼容**：历史 `assets/` 副本不动。扫描时把 `assets/<id>.<ext>` 也识别为引用（按主干匹配 `media.id`），一张图在两个文档各留一份副本就记两条 usage——符合"被两处使用"的事实。

### 5.6 对账扫描

协议入口 `media/rescan`（无参数）对应 `MediaLibraryService.rescan()`，分两段串行：

| 段 | 入口 | 产出 |
| --- | --- | --- |
| 磁盘对账 | `mediaScan.scanMediaFiles` + `reconcileMedia` | `indexed` / `missing` / `corrected`：补录新文件、标记丢失、按 id 纠正 `path` 与 `month` |
| 引用重建 | `mediaReferenceService.rescanReferences(db, readPressCover, onlyDirPath?)` | `stale`：解析到但查不到媒体记录的引用数 |

`rescanReferences` 的 `readPressCover` 回读 `press.db` 的作品封面指针以补登 `press_cover`；`onlyDirPath` 可只扫某个作品，缺省扫全部（当前 `media/rescan` 走全量）。

引用重建范围：

```
press/*/Chapters/**/*.md（下探两层）                  → chapter
press/*/{README,设定,角色设定,世界观,金手指,势力,地点,物品,大纲}.md
      ├── ![...](...)                               → chapter（文档内插图）
      └── - 封面：<id>                              → character_cover / lore_cover
notes/{YYYYMM}/*.md                                  → note
```

磁盘对账范围：`images/{YYYYMM}/*`。以磁盘为准——磁盘有而库里没有按 `import` 补录，库里有而磁盘没有标 `missing`，同一 id 换了目录则纠正 `path` 与 `month`。

规则：

- 事务内按 `ref_path` 替换：先 `DELETE FROM media_usage WHERE ref_path = ?`，再逐条写入该文档的引用，扫描中断不会留下半篇记录。
- 单文件读取失败按空文档跳过，不影响整次扫描。
- **stale 检测**：解析出的图片路径在 media 表里查不到记录（先按 `path` 精确匹配，再按文件名主干匹配 `id`）→ 不写 usage，计入 `stale` 并在详情面板提示「N 处引用已失效」。
- 触发时机：打开媒体页时只跑磁盘对账（5s 节流，不解析文档）；`media/rescan` 全量重跑两段；删除前不重扫，直接用已有 usage 判断引用。
- 扫描只写 usage，不改文档。

### 5.7 呈现规则

**网格卡片**（`src/workflow/media/layout/MediaGrid.tsx`）：

| 位置 | 内容 |
| --- | --- |
| 左上角 | `kind` 标签：角色 / 设定 / 普通 / 未归类（仅展示，不可点，不进筛选） |
| 左下角 | 出处一行：`角色 · 林小满` / `设定 · 青云宗` / `作品 · 长夜行` / `未关联` |
| 右下角 | 引用徽标：`被 3 处使用`（0 不显示） |

**详情面板**（`MediaDetailDialog`）：

```
[大图]
─────────────
出处
  作品     长夜行
  角色     林小满（人物卡）
  生成     2026-10-29 15:30  比例 3:4  画风 写实
  提示词   （折叠）
─────────────
引用（4）
  封面      作品封面    长夜行                      ↗
  封面      角色封面    林小满                      ↗
  章节      第 12 章 雪夜  长夜行/Chapters/12-雪夜.md  ↗
  笔记      灵感速记      notes/202610/ab12.md       ↗
─────────────
[设为作品封面] [插入] [复制图片] [删除]
```

- 引用按 `ref_type` 分组，组内按时间倒序；每条可点击 `vscode.open` 跳转。
- 对象已删除时出处显示 `林小满（角色已删除）`，不隐藏整行。
- `missing=1` 时整块显示「文件已不在磁盘」+「移除记录」。

---

## 6. 筛选与展示

### 6.1 年月筛选

- 单选下拉，选项由宿主聚合返回：`全部月份`（默认）+ `2026年10月（37）` + `2026年9月（12）`…，按 `YYYY-MM` 倒序。
- 显示格式固定中文：`{YYYY}年{M}月`，月不补零。
- **默认选中「全部月份」**（决策 3）：进页面即按月分组展示全库，下拉只用于收窄。
- **没有类型筛选、没有角色筛选**。筛选条右侧保留「清空筛选」与批量操作入口。
- 筛选状态写在页面 state，不持久化（切作品/切页面重挂载即复位）。

### 6.2 网格

- 按月分组，组头 sticky：`2026年10月 · 37 张`；组按 `YYYY-MM` 倒序。
- 每组首屏 60 张，滚动到底追加（沿用 `GRID_PAGE_SIZE`）。
- 卡片保持 3:4 裁切（`@components/Image` 的 `aspect`），沿用现有视觉。
- 多选、批量删除、悬停复制/插入/删除沿用现有交互。
- 空态两种：仓库为空（「还没有图片，用下方输入区生成第一张」）与当月为空（「2026年10月没有图片」+ 清空筛选）。

### 6.3 协议

新增 `media/*` 前缀（与 `pressAi/*` 并列，`aiChatProvider` 的前缀委托需加分支）：

| 方法 | 入参 | 返回 |
| --- | --- | --- |
| `media/list` | `{ month?: 'YYYY-MM' \| null }` | `{ items, months, total }` |
| `media/detail` | `{ id }` | `{ media, usages }` |
| `media/delete` | `{ id }` | `{ removed, coverFallback, usages }` |
| `media/deleteBatch` | `{ ids }` | `{ removals, months, total }` |
| `media/setCover` | `{ id }` | `{ coverSelectedId }` |
| `media/insert` | `{ id }` | `{ inserted, reason?, refPath?, duplicated? }` |
| `media/copy` | `{ id }` | `{ copied, reason? }` |
| `media/rescan` | 无 | `{ indexed, missing, corrected, stale }` |
| `media/import` | `{ paths }`（P1） | `{ items }` |

安全约束（写进 `src/shared/types/media.ts` 头注释）：

- 前端只传 `id` 与受控枚举，不接受任意路径。
- `month` 必须匹配 `^\d{4}-(0[1-9]|1[0-2])$`。
- 删除、设封面、插入前一律 `SELECT` 表得到 `path`，再校验 `^images/\d{6}/[A-Za-z0-9]{20}\.(png|jpe?g|webp|gif)$`。
- 批量上限 500（沿用 `MAX_BATCH_DELETE`）。

### 6.4 列表规模

默认全量：`media` 表查询毫秒级，个人库上万行无压力；前端按月分组、每组 60 张懒挂载，不做虚拟滚动。

**演进触发条件**：单次返回超过 5000 条或首屏超过 800ms 时，改用 `{ month, cursor, limit }` 分页（协议已预留 `month`）。

---

## 7. 删除与生命周期

### 7.1 删除保护

- 删除前查 usage：`0` 条 → 直接删（进回收站，沿用 `deleteResource`）；`>0` 条 → 二次确认，按 `ref_type` 分组列出前 5 条。
- 文案区分两种后果：
  - 封面引用 → 「作品/角色的封面会回退到剩余最新一张」。
  - 章节/笔记引用 → 「正文里的图片链接会失效（显示破图）」——决策 1 之后不再是"副本仍在"，必须如实提示。
- 删除后：清 usage、清 `media` 行、修封面指针（回退算法沿用现有 `imageLibraryService`）。

### 7.2 对象删除（决策 2：不删图、不改写出处）

| 事件 | 策略 |
| --- | --- |
| 删除角色 / 条目 | **不删图片、不 UPDATE `media` 表**。原 `removeByCharacterId` / `removeByLoreId` 下线。展示时按 id 查不到 → 用 `character_name` / `lore_name` 快照 + 「（已删除）」 |
| 删除作品 | 同上。`press_path` 保留，展示时作品目录不存在 → `press_name` + 「（作品已删除）」 |
| 存储根切换 | 无需处理，全部相对路径 |

理由：图片已经全局化，一张图可能同时被角色卡与章节引用；按文件名级联删除在旧模型下安全（图片只属于该角色），在新模型下会误删。保留出处也符合「历史事实不可改写」。

### 7.3 文件丢失与移动

| 情况 | 处理 |
| --- | --- |
| 磁盘文件被外部删除 | 对账置 `missing=1`，卡片灰显 +「文件已丢失」，提供「移除记录」 |
| 文件被移到另一个年月目录 | 按 `id` 匹配新路径，更新 `path` 与 `month`，引用不断 |
| 文件被重命名（id 变了） | 旧记录置 `missing`，新文件按 `import` 补录；不做哈希兜底（成本高收益低），P2 可做手工合并 |
| 同一 id 出现两份 | 以路径字典序靠前者为准，另一份不入库 |
| 文档移动导致相对路径失效 | 对账标 `stale`，详情提示「N 处引用已失效」，P1 提供一键重算路径 |

---

## 8. 迁移方案

### 8.1 迁移步骤（一次性、幂等、可 dry-run）

1. **预检**：读 `media_meta.migration.press_images` 标记；已完成则跳过。扫描所有 `press/*/Images/`，输出清单（数量、体积、无法解析的旧名）。
2. **建索引**：按旧文件名解析归属：
   - `portrait-\d{14}-(\d{8})` → `kind=portrait`、`character_id`
   - `(faction|place|item)-\d{14}-(\d{8})` → `kind=lore`、`lore_kind`、`lore_id`
   - `photo-\d{14}-[A-Za-z0-9]{8}` → `kind=photo`
   - 其他 → `kind=unknown`、`origin=migrate`
   - 时间取 14 位时间戳；解析失败取文件 mtime。
3. **改名 + 移动**：`{原 14 位时间戳}{新 6 位随机}.{ext}`，`workspace.fs.rename` 移到 `images/{YYYYMM}/`。
4. **写库**：插入 `media` 行（`origin=migrate`、`scope=press`、`press_path`、`press_name`、名称快照），侧车字段读入 `prompt/ratio/style/enhanced_from`，随后删除侧车。
5. **改写指针**：
   - `press.db` meta 的 `cover:{press/作品}`：旧路径 → 新路径（按 `old_id → new_id` 映射）。
   - 角色卡 `- 封面：<旧 id>` 与条目 `- 封面：<旧 id>`：按映射替换，走现有 `serialize` 写回，不用手写正则。
   - 章节/笔记正文若直接引用 `Images/xxx.png`（非 assets 副本），按映射改写；`assets/` 副本**不动**（决策 1 的迁移期兼容）。
6. **记录**：`media_meta` 写 `migration.press_images = done` 与 `migrated_at`；`media_journal` 记每条 `old_path → new_path`，便于回滚。

### 8.2 失败与回滚

- 单文件失败（占用、权限）：记 journal 后跳过，`media` 行标 `missing`，标记记为 `partial`，下次启动只处理剩余。
- 全部失败：不写 `done`，下次重试。
- 回滚：按 journal 逆序 `rename` 回去 + 删除对应 `media` 行 + 指针按 journal 反向改写。**仅在迁移后未产生新图时可执行**，界面明示。

### 8.3 迁移期间的行为

- 扩展激活后空闲时执行（`setTimeout` 3s），不阻塞首屏。
- 未完成时媒体页顶部提示「正在整理历史图片（12/48）」，已迁移部分可读。
- 迁移完成后不再读旧目录；`mediaScan` 每次对账附带一次旧目录探测，发现残留提示重新迁移。

---

## 9. 代码改造清单

### 9.1 宿主（`src/modules/media/`）

| 文件 | 职责 |
| --- | --- |
| `constants.ts` | `MEDIA_DIR='images'`、`INDEX_DIR='.media'`、扩展名白名单、批量上限、id 正则 |
| `mediaNaming.ts` | `nextMediaId(dirUri, at)`：时间戳 + 6 位随机 + 冲突重试（替代 `imageNaming.ts`） |
| `db/connection.ts` | 按存储根打开 `media.db`（`journal_mode=DELETE`），建 `media` / `media_usage` / `media_meta`，含降级与 quick_check |
| `mediaRepository.ts` | 表读写：insert / listByMonth / detail / deleteById / months / ownerNames |
| `mediaScan.ts` | 扫描 `images/**` 与表对账（补录、missing、路径纠正） |
| `mediaReferenceService.ts` | usage 登记与 `rescanReferences`：抽图片引用与封面行，含 stale 检测 |
| `mediaLibraryService.ts` | 对外 list / detail / remove / batchRemove / setCover / insert / copy / rescan |
| ~~`mediaMigrationService.ts`~~ | 旧 `press/*/Images/` 迁移与指针改写；一次性任务已完成，代码已移除 |
| `ai/…` | 不变，出图通道与用量记账沿用 |

改造：

| 文件 | 改动 |
| --- | --- |
| `imageGenerateService.ts` | 落盘目录改 `images/{YYYYMM}/`；命名改用 `nextMediaId`；落盘后写 `media` 表（含出处与名称快照），不再写侧车 |
| `portraitService.ts` | `insertIntoEditor` 改为写 `@zhai/` 存储根引用（§5.4），返回 `refPath`；`removeByCharacterId` / `removeByLoreId` 下线 |
| `coverService.ts` | 列举改为查表 |
| ~~`imageLibraryService.ts`~~ / ~~`db/coverRepository.ts`~~ | 旧图库链路与兼容转出层已删除；封面仓储迁至 `media/pressCoverStore.ts`，只接受 `images/**` |
| `common/db/openDatabase.ts` | 增可选参数 `journalMode`（默认 `WAL`，媒体库传 `DELETE`） |
| `pressRoutes.ts` | 增 `media/*` 分发；`pressAi/*` 图片方法（列举、详情、删除、设封面）已随旧链路删除 |
| `aiChatProvider.ts` | 前缀委托加 `media/` |
| `shared/types/messages.ts` | `HostMethodName` 增 `media/*` |
| `shared/types/media.ts` | 新增契约（条目、详情、usage、协议出入参） |
| `extension.ts` | 装配 `mediaDb` / 各服务（对账由媒体页打开与 `media/rescan` 触发） |

### 9.2 前端（`src/workflow/media/`）

| 文件 | 职责 |
| --- | --- |
| `index.tsx` | 页面骨架：标题、年月筛选、网格、底部 composer |
| `layout/MediaFilters.tsx` | 年月下拉 + 清空 + 计数 |
| `layout/MediaGallery.tsx` | 按月分组、空态、加载更多 |
| `layout/MediaGrid.tsx` | 卡片：kind 标签、出处行、引用徽标、多选 |
| `layout/MediaDetailDialog.tsx` | 详情：出处 / 引用分组 / 动作 |
| `layout/MediaSelectionActions.tsx` | 批量操作（沿用） |
| `hooks/useMediaLibrary.ts` | list / delete / reload |
| `hooks/useMediaFilters.ts` | month 单选 + 分组派生（替代 `useImageFilters`） |
| `hooks/useMediaDetail.ts` | 详情与引用读取 |
| `hooks/useMediaActions.ts` | 设封面 / 插入 / 复制 |

导航与路由：

- `src/workflow/layout/pressSections.ts`：`'image'` 改为 `'media'`（一次性替换，不留双份）。
- `src/workflow/layout/WorkflowPressNav.tsx`：label `生图` → `媒体`，图标沿用 `ImageIcon`。
- `src/workflow/press/layout/PressSectionRouter.tsx`：`section === 'media'` → `<MediaPage />`。
- 旧 `src/workflow/imagegen/`：筛选/类型/角色筛选相关删除；`ImageComposer` 及其依赖整体迁到 `media/layout/`。

### 9.3 测试

- 新增：`mediaNaming.test.ts`、`mediaRepository.test.ts`、`mediaScan.test.ts`、`mediaReferenceService.test.ts`（含一对多与 stale）、`useMediaFilters.test.ts`、`components/MediaGallery.test.tsx`。
- 改造：`imageGenerateService.test.ts`（落盘路径与库写入）、`portraitService` 插入用例（`@zhai/` 引用写入）。
- 删除：`imageNaming.test.ts`、`imageSidecar.test.ts`、`imageDirScan.test.ts`、`imageLibraryService.test.ts`、`imagegenIds.test.ts`、`components/ImageGenPage.test.tsx`（旧图库交互已不存在）。

---

## 10. 边界情况

| # | 情况 | 处理 |
| --- | --- | --- |
| 1 | 出图跨秒/跨月（23:59:59 开始，00:00:01 落盘） | 目录与文件名用**同一次** `now`，永不打架；以落盘时刻为准 |
| 2 | 时区 | 目录、文件名、`month` 全用本地时区；`created_at` 存 UTC ISO。不做 UTC→本地换算再分组，避免「1 月 1 日 00:30 的图跑到上一年 12 月」 |
| 3 | 同秒同随机冲突 | 重取随机段 5 次 → 时间戳 +1s 再试，上限 60 次后报错 |
| 4 | 手工放入不合规命名 | 允许入库（`origin=import`、`kind=unknown`），主干重复时后入者标 `duplicate` |
| 5 | 非图片扩展名 | 只认 `png/jpe?g/webp/gif`（沿用 `imageDirScan` 口径），其余忽略并记日志 |
| 6 | 文件被外部删除 | `missing=1` 灰显 +「移除记录」，不自动删行（保住引用信息） |
| 7 | 文件被移动到别的年月目录 | 按 id 纠正 `path`/`month`，引用不断 |
| 8 | 角色/条目/作品被删除 | 不删图、不改表，靠 id 查不到 → 快照 +「已删除」（§7.2） |
| 9 | 封面图被删 / 丢失 | 回退到该作用域剩余最新一张（沿用现有算法）；一张不剩则置空 |
| 10 | 同一张图被多处引用 | 多行 usage 并存，删除时逐条列出（一对多，§4.3） |
| 11 | 同一文档多次引用同一张图 | 合并为 1 行，`ref_anchor` 记首次行号，引用数不虚高 |
| 12 | 引用原图后作品目录单独拷贝 | 图片丢失 → P1「导出作品时打包图片」；本期在导出入口提示 |
| 13 | 文档移动 / 重命名导致相对路径失效 | 对账标 `stale`，详情提示「N 处引用已失效」，P1 一键重算 |
| 14 | 存储根外文档插入（跨盘） | 仍写 `@zhai/` 引用，usage 记 `ref_scope=absolute`；文档离开存储根后图片无处解析，需带着存储根一起搬 |
| 15 | 路径含空格 / 圆括号 | Markdown 中用 `<...>` 包裹 |
| 16 | 存储根路径含中文/空格 | 全程 `Uri.joinPath` 与 `path.posix`，不拼字符串 |
| 17 | 存储根切换 | 全部相对路径；连接按根重建并关闭旧连接 |
| 18 | 存储根在云盘/网络盘 | `journal_mode=DELETE` 避免 `-wal`/`-shm` 同步冲突；打开失败降级到缓存目录并提示 |
| 19 | `media.db` 损坏 | `quick_check` 失败 → 重命名 `.corrupt-{ts}` 后重建，一次性提示「出处与出图参数不可用」 |
| 20 | `media.db` 丢失 | 扫描 `images/**` 重建文件清单；出处/参数不可恢复，UI 明示 |
| 21 | 并发出图 / 并发删除 | 出图沿用单任务锁；删表行与删文件顺序为「先删文件、后删行」，失败时行保留可重试 |
| 22 | 图片体积与网格性能 | 不做缩略图（无 `sharp` 依赖），原图 + lazy + 分批挂载；单张 >20MB 卡片显示体积提示 |
| 23 | 引用扫描耗时 | 只扫 `press/*` 与 `notes/**` 的 md；P1 按 mtime 增量；单文件失败跳过 |
| 24 | 迁移中途退出 | journal + `partial` 标记，下次续跑；已完成文件不重复处理 |
| 25 | 旧目录残留 | 对账时探测 `press/*/Images/`，发现残留提示重新迁移，不自动删除 |
| 26 | 外部编辑器删了正文引用 | 下次对账自动移除对应 usage |

---

## 11. 分期与验收

### P0（可用，一次做完）

1. 目录与命名改造 + `media.db`（含存储根位置、降级、quick_check）+ 扫描对账。
2. 媒体页：默认全量按月分组、年月筛选、详情（出处 + 引用分组）、删除保护。
3. 出图落盘接新链路（角色名 / 作品 / 条目写入出处）。
4. 插入改为引用原图（写 `@zhai/` 存储根引用，不再按文档目录换算）。
5. 迁移脚本与指针改写。

验收：

- 出图落在 `images/{YYYYMM}/{14位}{6位}.png`，文件名符合正则，同秒连发两张不冲突。
- 进页面即按月分组展示全库；年月下拉显示 `2026年10月（N）`，选中只显示该月；无类型筛选入口。
- 角色卡出图后详情显示「角色 · 姓名」+「作品 · 作品名」；设定出图显示「设定 · 条目名」+ 作品。
- 设封面后详情引用出现「作品封面」；插入章节后出现「章节 · 标题」，文档内是 `@zhai/images/...` 存储根引用且预览正常；可点击跳转。
- 同一张图被 2 个章节 + 1 个笔记 + 1 个封面引用时，详情列出 4 条，卡片显示「被 4 处使用」。
- 删除被引用的图有二次确认并列出引用处；删除后封面正确回退。
- 删除角色后图片仍在库中，出处显示「（已删除）」。
- 旧库迁移后：图片全部在新目录、封面与角色/条目封面指向正确、原目录清空、侧车清理。
- 断开/删除 `.media/media.db` 后重启：图片仍在、列表可读，UI 提示索引已重建。

### P1（体验补全）

- 增量对账（按 mtime 跳过未改文档）。
- stale 引用一键重算路径（按 media id 改写文档）。
- 拖拽/粘贴导入。
- 作品导出时打包图片进 `assets/`。
- 「未关联」空态提示与孤儿图清理入口。

### P2（可选）

- 宽高读取（PNG/JPEG/WebP 头解析，不引依赖）。
- 按月体积统计与库总量提示。
- 引用项跳转到「设定页对应条目」而非文档原文。
- 索引 JSON 快照导出（极端灾难恢复）。

---

## 12. 决策记录

| # | 决策 | 结论 | 理由 |
| --- | --- | --- | --- |
| 1 | 插入行为 | 引用原图（写 `@zhai/` 存储根引用） | 源图更新即生效、不产生副本、引用可追踪 |
| 2 | 删角色/条目/作品 | 不删图、不改写出处 | 图片已全局化，可能被别处引用；历史事实不篡改 |
| 3 | 默认视图 | 全量按月分组 | 进页面即见全部，符合 Google Photos 式时间轴习惯 |
| 4 | 索引位置 | `{root}/.media/media.db` | 缓存目录重建会丢出处、出图参数与 external 引用 |
| 5 | 关联基数 | 出处一对一、引用一对多 | 一张图可同时被多个作品/笔记/章节使用 |
