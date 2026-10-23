# Press（小说写作）— 模块设计文档

**版本**：2.1
**日期**：2026-10-22
**状态**：草案；第 5.1 节生图通道已收敛为 CodeBuddy `ImageGen` 单通道并落地
**宿主**：VSCode 插件 Zhai（宅桌面）
**合并说明**：由 `docs/modules/writing.md`（插件形态）与旧 `docs/modules/press.md`（宅桌面 Web 方案）合并统一为单一小说写作模块；技术形态以插件形态为准（Markdown 主存储 + SQLite 仅缓存索引），旧 Web 方案的 Express/Prisma/localStorage 技术栈不再沿用。
**存储根**：`{storage.rootPath}/press/`（根目录配置见 `common.md` 第 1 节）

---

## 1. 模块概述

### 1.1 定位

面向长篇小说 / 长文创作的**结构化工作台**：作品、卷、章、角色、设定、伏笔、情节线全链路管理，并深度接入 AI 副驾。

与「笔记」模块的边界：笔记是**扁平的知识网络**（以文件为单位、关系自由，见 `notes.md`）；press 是**强层级的项目结构**（作品 → 卷 → 章，带状态、目标与统计），且设定 / 角色以独立 Markdown 文档承载（设想⑥）。

### 1.2 目录即结构（核心设计，对应设想⑤⑥）

遵循「Markdown 做主存储」原则，目录结构即作品结构：

```
{root}/press/
└── 【小说名】/                         ← 一部作品（目录名即作品名）
    ├── README.md                      ← 小说背景、写作风格、总体设定（设想⑤）
    ├── 角色设定.md                     ← 角色设定（扁平独立文档，设想⑥）
    ├── 大纲.md                         ← 大纲（扁平独立文档，设想⑥）
    ├── 设定.md                         ← 世界观 / 地理 / 组织等（可拆多文档，设想⑥）
    └── Chapter/                        ← 章节目录（设想⑤）
        ├── 01-章节名.md                ← 第一章 章节名
        ├── 02-章节名.md
        └── 01-卷名/                    ← 分卷（设想⑤）
            ├── 01-章节名.md
            └── 02-章节名.md
```

- **顺序保证**：卷目录名前缀 `01-`、章文件名前缀 `01-` 数字顺序；程序排序以文件名前缀为准，缺失时回退字典序（容错）。
- **设定扁平独立（设想⑥）**：角色设定 / 大纲 / 设定等直接放作品目录，不强行子目录（`characters/`、`settings/` 旧方案弃用）；用户可自由增删设定文档，约定常用文件名但不强制。
- **作品根 README.md（设想⑤）**：承载小说背景、写作风格、目标读者（男频/女频）、状态、目标字数等全局设定；AI 副驾默认注入其作为系统音色与风格约束。

### 1.3 章节文档体（对应设想⑦）

`01-章节名.md` 除章节名与正文外，须包含：① 本章介绍；② 本章出现的角色及角色链接；③ 金手指设定。采用 Frontmatter 承载机器可索引元数据，正文区块承载人读内容，角色 / 设定通过 `[[文档#锚点]]` 双向链接互联（复用 `notes.md` 双链机制，可被全局检索与关系图谱复用）：

```markdown
---
title: 第一章 章节名
status: draft                         # draft | revising | pending | published
summary: 一句话本章介绍（设想⑦-①）
characters: [林凡, 苏沐]              # 出场角色（与角色设定.md 链接，设想⑦-②）
goldenFingers: [金手指名]             # 金手指设定（设想⑦-③）
wordGoal: 3000
---

# 第一章 章节名

## 本章介绍
（设想⑦-①：本章内容概要、承上启下）

## 正文
（章节内容）

## 出场角色
- [[角色设定#林凡]]：本角色在本章的作用与表现
- [[角色设定#苏沐]]：…
（设想⑦-②：本章出现的角色及角色链接，用双向链接指向角色设定锚点）

## 金手指设定
- 金手指A：设定说明及本章具体表现
（设想⑦-③：本章涉及的金手指 / 特殊能力设定）
```

> 角色与设定文档同样使用 `# 锚点` 标记具体条目（如 `角色设定.md` 中 `# 林凡`），使 `[[角色设定#林凡]]` 可精准跳转。

### 1.4 目标

- 作品结构、设定、伏笔等**全部落盘为 Markdown**，整部可 `git` 管理与迁移（见 `common.md` ①）
- AI 副驾基于索引精准取用前文与设定，保证人设与剧情一致
- 创作过程可度量（字数、连更、热力图）并可持续（番茄钟、目标进度）

### 1.5 非目标

- 不做多人协作与在线投稿
- 不做自动全文生成（AI 只做辅助，不替代作者决策）
- 不提供复杂排版（导出排版交给 `markdown-one.md`）

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 新建作品 | 命令「新建作品」→ 输入名称 / 目标读者（男频、女频）/ 笔名 → 自动生成 `{root}/press/【小说名】/` 骨架（README.md + 大纲.md + 角色设定.md + Chapter/） |
| US-2 | 章节写作 | 章节树点开 `Chapter/01-章节名.md` → 原生编辑器写作 → `Alt+Enter` 让 AI 续写 → 逐段接受 |
| US-3 | 设定一致性 | 写战斗场景 → 勾选「注入设定」→ AI 自动读取 README.md 与 `设定.md` / `角色设定.md` 相关条目 |
| US-4 | 分卷组织 | 长篇分卷 → 在 `Chapter/` 下新建 `01-卷名/` → 卷内章节 `01-章节名.md` 归入其下 |
| US-5 | 伏笔回收 | 第 30 章埋下伏笔 → 伏笔面板标记「预期第 60 章回收」→ 到第 60 章时状态栏提醒 |
| US-6 | 完本导出 | 完本后导出 → 选择 EPUB → 生成整部电子书（按 `Chapter/` 顺序拼接） |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| W1 | 作品管理 | 创建 / 重命名 / 删除 / 归档，作品元信息面板（编辑 README.md Frontmatter） | P0 | 待实现 |
| W2 | 卷-章两级树 | 目录即卷、文件即章；拖拽排序、分章与合并（设想⑤分卷） | P0 | 待实现 |
| W3 | 章节元信息 | 状态、本章介绍（summary）、写作便签、关联角色、字数目标（设想⑦） | P1 | 待实现 |
| W4 | 编辑器集成 | 原生编辑器 + Webview 预览（渲染 MDX 组件 / 双链） | P0 | 待实现 |
| W5 | AI 续写 | 基于前文流式生成，`Alt+Enter` 触发 | P0 | 待实现 |
| W6 | AI 润色 / 改写 | 选中文本 + 风格指令（更生动 / 更简洁 / 古风 / 自定义） | P1 | 待实现 |
| W7 | AI 对话生成 | 选择角色 + 场景 → 生成符合人设的对话 | P1 | 待实现 |
| W8 | AI 描写展开 | 简单句扩展为沉浸式段落 | P1 | 待实现 |
| W9 | AI 大纲生成 | 基于当前章节生成后续章节大纲 | P1 | 待实现 |
| W10 | AI 智能校对 | 错别字 / 标点 / 重复用词，以装饰标记呈现 | P2 | 待实现 |
| W11 | AI 写评 | 章节完成后点评节奏 / 情感 / 逻辑 | P2 | 待实现 |
| W12 | 情感 / 节奏分析 | 情感曲线与叙事节奏可视化 | P2 | 待实现 |
| W13 | AI 智能起名 | 关键词 → 角色名 / 地名 / 功法名 | P2 | 待实现 |
| W14 | 角色管理 | 角色卡（基础 / 外貌 / 性格 / 背景 / 能力）、关系图谱、标签分组、出场统计（设想⑥，角色设定.md） | P1 | 待实现 |
| W15 | 世界观设定 | 地理 / 组织势力 / 时间线 / 种族 / 文化宗教 / 魔法科技 六类（设想⑥，设定.md） | P1 | 待实现 |
| W16 | 大纲三视图 | 树形 / 卡片 / 时间线，摘要内联编辑（大纲.md） | P2 | 待实现 |
| W17 | 伏笔管理 | CRUD + 状态（未回收 / 已回收 / 已废弃）+ 待回收预警 | P2 | 待实现 |
| W18 | 情节线管理 | 多线并行（主线 / 感情线 / 暗线 / 支线）并关联章节 | P2 | 待实现 |
| W19 | 版本快照 | 手动 / 自动快照，diff 对比，一键恢复 | P1 | 待实现 |
| W20 | 写作统计 | 日 / 周目标、连更天数、热力图、写作日历 | P2 | 待实现 |
| W21 | 番茄钟 | 25 分钟写作 + 5 分钟休息，可自定义时长 | P2 | 待实现 |
| W22 | 导入导出 | 导入 md / docx / txt；导出 md / docx / EPUB / PDF，支持单章 / 多章 / 整部 | P1 | 待实现 |
| W23 | 章节文档体规范 | 每章含本章介绍 / 出场角色链接 / 金手指设定（设想⑦），Frontmatter + 区块模板 | P0 | 待实现 |
| W24 | 分卷目录 | `Chapter/01-卷名/` 下嵌套 `01-章节名.md`（设想⑤），导出按卷-章顺序拼接 | P0 | 待实现 |
| W25 | 设定扁平文档 | 角色设定.md / 大纲.md / 设定.md 等独立文档（设想⑥），不强制子目录；支持自由增删 | P0 | 待实现 |
| W26 | 作品背景文档 | 每部作品 README.md 承载背景 / 写作风格 / 状态（设想⑤），作为 AI 风格注入源 | P0 | 待实现 |

---

## 4. 交互与流程

### 4.1 创作主流程

```
新建作品 → 完善 README.md 背景 → 设定角色/世界观 → 规划大纲 → 分章写作 → 修改润色 → 完本导出
   │           │                  │                │           │           │          │
   └─ press/小说名/  └─ README.md  └─ 角色设定.md    └─ 大纲.md  └─ Chapter/ └─ AI 校对 └─ 导出
```

### 4.2 AI 续写时序

```
章节编辑器（光标位置）
   │ Alt+Enter
   ▼
宿主读取：当前文件路径 + 光标偏移
   ├─ 查索引（common.md files 表）→ 定位同卷前文（按文件名前缀取最近 N 章，受 contextTokens 限制）
   ├─ 若勾选「注入设定」→ 读取 README.md + 角色设定.md + 设定.md 的相关条目
   └─ 组装 prompt（README.md 音色与风格 + 设定 + 前文 + 续写指令）
   │
   ▼ SSE 流式
Webview 内联展示（淡蓝斜体），跟随光标插入
   │
   ▼ 用户接受
WorkspaceEdit 写入文件（可 Ctrl+Z 撤销）→ 更新字数与写作 session
```

### 4.3 伏笔生命周期

```
创建（标记章节 + 类型 + 预期回收章节 + 状态=未回收）
   → 写作过程中在伏笔面板查看待回收清单
   → 到达预期回收章节时状态栏 / 面板提醒
   → 作者回收后标记「已回收」并关联实际章节
   → 放弃则标记「已废弃」（保留记录，便于复盘）
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 结构存储 | 目录=卷、文件=章 / 全部进 SQLite | **目录即结构** | 符合 Markdown 主存储原则（common.md ①）；用户可在资源管理器直接操作 |
| 顺序保证 | 文件名前缀 `01-` / Frontmatter `order` | **文件名前缀为主** | 前缀保证文件系统顺序直观；旧 `0001-` 改为 `01-` 更紧凑 |
| 设定组织 | 扁平独立文档 / 子目录 | **扁平独立文档** | 设想⑥，灵活轻量；通过 `[[文档#锚点]]` 互链 |
| 编辑器 | 原生 TextEditor / Webview MDX 编辑器 | **原生编辑 + Webview 预览** | 写作是长时间输入，原生编辑器性能与稳定性最佳；双链与角色卡在预览中渲染 |
| 拖拽排序 | VSCode TreeDataItem 拖拽 / Webview HTML5 DnD | **TreeDataItem 原生拖拽** | 与资源管理器交互一致；排序落盘为重命名单件前缀 |
| 差异对比 | `vscode.diff` 原生对比 / Webview 内 diff | **vscode.diff** | 章节篇幅大，原生对比性能与滚动体验更好 |
| 图表 | `recharts` / `echarts` | **recharts** | React 友好，体积适中，覆盖热力图 / 折线 / 柱状 |
| 状态管理 | Zustand / Context | **Zustand** | 面板状态多（树 / 大纲 / 伏笔 / 统计），Zustand 订阅粒度细 |
| 导出 docx | `docx` 库 | **docx** | 纯 JS，无需外部依赖 |
| 导出 EPUB | `epub-gen` / 手写 OPF | **epub-gen** | 封装完整，支持章节与封面；按 `Chapter/` 顺序拼接 |
| 导出 PDF | HTML → 打印 / `puppeteer-core` | **HTML → 系统打印** | 避免内联浏览器依赖；若需自动化，puppeteer-core **保持沙箱开启** |
| 番茄钟 | 定时器 + 状态栏 | **状态栏 + 通知** | 轻量，计时结束自动保存当前章节 |
| 生图通道 | 直连 OpenAI 兼容端点 / CodeBuddy `ImageGen` | **仅 CodeBuddy `ImageGen`** | 走 CodeBuddy 订阅额度；直连需自备端点与密钥，与「装完即用」冲突，故不再保留兜底通道 |

> **弃用规避**：不使用 `fs.renameSync` 等同步 API 处理排序重命名（改用 `fs.promises.rename` 并依赖 `onWillRenameFiles` 事件同步链接）；不使用已废弃的 `epub-gen` 回调式旧 API（使用 Promise 版本）。

### 5.1 图像生成通道（角色设定图）

文本类能力走 `AiProvider`（见 `ai-chat.md` 第 5 节），图像类单独走 `ImageProvider`，两者不合并：按张计费与按 token 计费的成本结构、失败模式、配置来源都不同，合并会让额度护栏失效。

| 关注点 | 结论 |
|--------|------|
| 唯一实现 | `codebuddyImageProvider`（SDK `query()` + CLI 内置 `ImageGen` 工具） |
| 通道开关 | 无。`ImageProviderId` 只剩 `codebuddy`，不再提供通道选择配置 |
| 能力探测 | 一次 `maxTurns: 1` 的空查询读 `system` 消息的 `tools`，确认含 `ImageGen`；结果缓存 10 分钟，生图失败时失效（CLI 随 SDK 分发，版本由 `package.json` 锁定） |
| 能力缺失 | 直接报错并提示确认登录态与 CLI 版本，不做静默回退 |
| 生成失败 | **不自动重试**：仅提示失败原因，由用户决定是否重试 |
| 工具权限 | `tools: ['ImageGen']` + `allowedTools: ['ImageGen']` 双重限定，`canUseTool` 只对 `ImageGen` 返回 allow 且整次请求最多放行一次（出图按张计费，重入会重复扣费）；`maxTurns: 5`，工具结果落地即取图，收尾轮次失败时在 catch 中兜底交付产物 |
| 延迟加载 | 图像通道需在子进程环境里设 `CODEBUDDY_DEFER_TOOL_LOADING=false`：CLI 默认把 `ImageGen` 放进延迟加载池，`system.init` 的工具全集里有它、但模型可用工具列表里没有，表现为「能力探测通过却始终不出图」 |
| 超时 | CodeBuddy 通道上限 600s（子进程启动 + 排队），前端兜底 15 分钟 |
| 产物归一 | `ImageGen` 以 JSON 文本回报 `{ type: 'image_gen_tool_result', images: [{ localPath }] }`，适配层先取结构化字段，再依次尝试 image block / data URL / 绝对路径 / 链接；路径可能不带扩展名，格式一律按文件魔数（PNG/JPEG/WEBP）判定，非图片内容自动跳到下一个候选，统一交给 `portraitService` 落盘 |
| 落盘位置 | `press/{作品名}/Portraits/portrait-{角色标识}-{年月日时分秒}.{ext}`：图片平铺在作品目录下，角色归属由文件名解析，删除作品即随目录一并清理 |
| 画风与尺寸 | 沿用 `PORTRAIT_STYLES` 与 `zhai.image.size`；CodeBuddy 侧的传参方式（自然语言描述 / 工具入参）待实测，未定前双写 |
| 文生图模型 | 由 CLI 决定，插件不下发 `--text-to-image-model`：清单来自服务端产品配置（SDK 只返回语言模型，无法枚举），故不提供配置项；需要更换时在 CLI 中用 `/model:text-to-image list` 查看、`/model:text-to-image <id>` 切换，CLI 会把选择存进自身 settings。驱动工具调用的对话模型复用 AI 面板模型菜单的选择（存 `globalState` 的 `ai.codebuddyModel`，可从账号可用列表选择或手动填写自定义模型 id） |
| 频率护栏 | `zhai.image.dailyLimit` 按次计数 |

> **落地状态**：`ImageProvider` 契约与 `ImageProviderRouter` 已实现（`src/modules/press/ai/imageProvider.ts`），唯一实现走 SDK 的 `ImageGen`（`codebuddyImageProvider.ts`）。能力探测读 `system.init` 的 `tools` 是否含 `ImageGen`，结果缓存 10 分钟，出图失败时清空缓存重探。
>
> **为什么生成失败不自动重试**：出图单次耗时数分钟且按张计费，静默重试会连扣两次、产出两张图，必须由用户确认。
>
> **文本提示词与出图分离**：`portraitPrompt.ts` 仍用本地规则模板拼英文提示词，不引入额外模型调用；若后续启用「AI 生成提示词」，须作为独立开关并提供模板兜底。

---

## 6. 数据模型

结构化元数据存于 `globalStorage/press.db`（正文与设定仍在 Markdown 文件，索引 path 以 `{root}` 相对路径为唯一键，见 `common.md` ③）。

```sql
-- 作品（对应 press/【小说名】/ 目录）
CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    dir_path     TEXT NOT NULL UNIQUE,   -- 相对 root：press/【小说名】
    title        TEXT NOT NULL,
    readme_path  TEXT NOT NULL,          -- press/【小说名】/README.md
    author_name  TEXT,
    category     TEXT,                   -- 玄幻/都市/历史/科幻/悬疑/言情
    status       TEXT NOT NULL DEFAULT 'ongoing',  -- ongoing|paused|finished|archived
    word_goal    INTEGER NOT NULL DEFAULT 0,
    daily_goal   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

-- 章节（对应一个 .md 文件，分卷时 path 含卷目录）
CREATE TABLE IF NOT EXISTS chapters (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    volume      TEXT NOT NULL DEFAULT '',     -- 卷名（空串=未分卷），对应 Chapter/01-卷名/
    file_path   TEXT NOT NULL UNIQUE,         -- press/【小说名】/Chapter/01-章节名.md
    title       TEXT NOT NULL,
    order_no    INTEGER NOT NULL,             -- 取自文件名前缀
    status      TEXT NOT NULL DEFAULT 'draft',
    summary     TEXT,                         -- 本章介绍（设想⑦-①）
    word_count  INTEGER NOT NULL DEFAULT 0,
    word_goal   INTEGER NOT NULL DEFAULT 0,
    golden_fingers TEXT NOT NULL DEFAULT '[]', -- 金手指设定（设想⑦-③，JSON 数组）
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chapter_project ON chapters(project_id, volume, order_no);

-- 角色（对应 角色设定.md 中 # 锚点条目）
CREATE TABLE IF NOT EXISTS characters (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    doc_path   TEXT NOT NULL,        -- press/【小说名】/角色设定.md
    anchor     TEXT NOT NULL,        -- 锚点名（对应 # 林凡），用于 [[角色设定#林凡]]
    alias      TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',  -- 主角/反派/配角/龙套
    avatar     TEXT,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_char_anchor ON characters(project_id, doc_path, anchor);

-- 角色关系
CREATE TABLE IF NOT EXISTS character_relations (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    to_id   TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    type    TEXT NOT NULL,           -- 盟友/敌对/恋人/师徒/亲属
    note    TEXT,
    UNIQUE(from_id, to_id, type)
);

-- 章节 ↔ 角色（出场统计，对应设想⑦-②）
CREATE TABLE IF NOT EXISTS chapter_characters (
    chapter_id    TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    character_id  TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    role          TEXT NOT NULL DEFAULT 'supporting',  -- main|supporting|cameo
    mention_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chapter_id, character_id)
);

-- 世界观设定（对应 设定.md 中 # 锚点条目）
CREATE TABLE IF NOT EXISTS settings (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category   TEXT NOT NULL,            -- 地理/组织势力/时间线/种族/文化宗教/魔法科技
    name       TEXT NOT NULL,
    doc_path   TEXT NOT NULL,            -- press/【小说名】/设定.md
    anchor     TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',  -- 分类特有字段（JSON）
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_setting_cat ON settings(project_id, category);

-- 伏笔
CREATE TABLE IF NOT EXISTS foreshadowings (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content        TEXT NOT NULL,
    type           TEXT NOT NULL,        -- 人物/情节/道具/设定
    set_chapter_id TEXT,
    expect_chapter TEXT,
    actual_chapter TEXT,
    status         TEXT NOT NULL DEFAULT 'open',  -- open|recovered|abandoned
    created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_foreshadow_status ON foreshadowings(project_id, status);

-- 情节线
CREATE TABLE IF NOT EXISTS plot_lines (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,           -- 主线/感情线/暗线/支线
    description TEXT,
    color       TEXT
);

CREATE TABLE IF NOT EXISTS chapter_plot_lines (
    chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    plot_line_id TEXT NOT NULL REFERENCES plot_lines(id) ON DELETE CASCADE,
    note        TEXT,
    PRIMARY KEY (chapter_id, plot_line_id)
);

-- 写作会话（统计用）
CREATE TABLE IF NOT EXISTS writing_sessions (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chapter_id  TEXT,
    date        TEXT NOT NULL,           -- YYYY-MM-DD
    word_delta  INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_date ON writing_sessions(project_id, date);
```

**说明**

- 章节标题、本章介绍、出场角色、金手指等机器可读字段来自 Frontmatter 与 `[[链接]]`，由增量索引解析写入；正文全文不入库（见 `common.md` ③④）。
- 角色 / 设定的「链接」通过 `doc_path + anchor` 唯一标识，支持 `[[角色设定#林凡]]` 双向链接跳转与关系图谱。

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `zhai.press.newProject` | 新建作品 | 生成 `press/【小说名】/` 骨架（README.md + 大纲.md + 角色设定.md + Chapter/） |
| `zhai.press.openProject` | 打开作品 | 侧边栏切换到指定作品 |
| `zhai.press.newChapter` | 新建章节 | 在当前卷末尾追加 `01-章节名.md` |
| `zhai.press.newVolume` | 新建卷 | 创建 `Chapter/01-卷名/` |
| `zhai.press.splitChapter` | 分章 | 按光标位置拆分 |
| `zhai.press.mergeChapters` | 合并章节 | 合并选中多章 |
| `zhai.press.continue` | AI 续写 | `Alt+Enter` |
| `zhai.press.openOutline` | 打开大纲 | 三视图切换（大纲.md） |
| `zhai.press.openCharacters` | 角色管理 | 角色列表与关系图谱（角色设定.md） |
| `zhai.press.openForeshadowing` | 伏笔看板 | 待回收预警 |
| `zhai.press.snapshots` | 版本快照 | 列表 / diff / 恢复 |
| `zhai.press.stats` | 创作统计 | 热力图与日历 |
| `zhai.press.export` | 导出作品 | 格式与范围选择（按 Chapter/ 顺序） |
| `zhai.press.pomodoro` | 番茄钟 | 开始 / 暂停 |

**Webview 方法**：`project/list`、`chapter/tree`、`chapter/reorder`、`character/list`、`character/relations`、`setting/list`、`foreshadowing/list`、`outline/get`、`stats/get`、`export/run`

**写作管理工作台（已落地）**：侧栏工作流面板按路由事实里的 `projectDir`（`press/{作品名}`）载入作品，
未打开作品时展示初始页并列出索引库中的作品入口。

| 方法 | 入参 | 出参 | 说明 |
|------|------|------|------|
| `press/workspace` | `{ dirPath?: string }` | `{ project, projects }` | 读取 `README.md`、`设定.md`、`角色设定.md`、`大纲.md` 原文并附带作品清单；`dirPath` 缺省或四份文档全空时 `project` 为 `null` |
| `press/open` | `{ dirPath }` | `{ opened }` | 打开作品 README；沿用仪表盘口径，先按索引库回查作品 |

- `projectDir` 取自活跃文档路径（`press/{作品名}/...` 至少三段），或由仪表盘/工作台的 `press/open` 调用 `WorkflowRouter.selectProject` 显式写入；索引尚未收录时同样识别，新建作品打开后工作台可立即载入。打开/删除作品都会广播路由事实，侧栏写作页据此切换作品并保留当前分区（例如停留在大纲页切换到另一作品仍是该作品的大纲）。
- 解析在 Webview 侧完成（`src/webview/workflow/press/document.ts`）：作品设定优先取 README 与 `设定.md` 的「`- 键：值`」行，
  角色按「`# 角色名`」切块，大纲按「卷 → 章 → 键值行」切块；键值缺失时回落到区块段落，解析失败只让对应字段为空。
- 工作台对作品只读：页面内的编辑仍是内存草稿，暂不写回 Markdown。

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 新建作品 | 骨架生成 < 500ms，目录结构符合设想⑤（README.md + Chapter/ + 设定文档） |
| AC-2 | 章节树 | 500 章作品树渲染 < 1s，分卷嵌套正确，拖拽排序落盘正确 |
| AC-3 | AI 续写 | 首字 < 500ms；上下文取前文 + README.md/设定 + 角色设定不超 token 上限 |
| AC-4 | 设定一致性 | 勾选注入后，AI 输出人设 / 地名与设定库一致（抽检 ≥ 90%） |
| AC-5 | 自动保存 | 停止输入 5s 保存；切换章节强制保存 |
| AC-6 | 快照恢复 | 快照保留自动清理（超 30 天或超 100 个），恢复结果与快照一致 |
| AC-7 | 出场统计 | 角色出场章节数与人工核对一致（基于 chapter_characters） |
| AC-8 | 伏笔提醒 | 进入预期回收章节时触发提醒，误报率 < 10% |
| AC-9 | 导出 | 整部导出 EPUB（100 章，含分卷）< 10s，目录层级正确 |
| AC-10 | 大文件编辑 | 5 万字章节编辑无明显卡顿（原生编辑器保障） |
| AC-11 | 章节文档体 | 新建章节默认包含本章介绍 / 出场角色 / 金手指区块（设想⑦） |
| AC-12 | 双链可达 | `[[角色设定#林凡]]` 点击 < 100ms 跳转至锚点，悬空链接提示创建 |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 目录结构被用户手工改乱 | 树解析失败 | 解析容错（缺失前缀时按字典序）；提供「校验并修复结构」命令 |
| 章节过大导致 AI 上下文不足 | 续写断片 | 分层压缩：近 N 章原文 + 更早章节摘要；摘要自动生成 |
| 角色 / 设定与正文脱节 | 设定注入失效 | 按角色名 / 设定名检索索引（common.md `characters` 字段） |
| 导出格式兼容性 | 排版错乱 | 先支持 md / docx / EPUB（结构清晰），PDF 走打印路径 |
| 统计口径争议 | 数据不符预期 | 以 `word_delta` 记录净增，UI 明示口径 |
| 与笔记模块边界模糊 | 用户困惑 | 明确：press=项目制（带状态与目标、设定独立文档），笔记=自由网络 |

**开放问题**

1. 一部作品是否允许设定文档进一步拆分（如 `角色/林凡.md` 单角色一档）？当前默认扁平单文档（角色设定.md）。
2. 大纲.md 是否需要与视图双向同步（编辑文件即更新视图）？
3. 是否提供「章节模板」（开场 / 过渡 / 高潮的结构提示）？

---

## 10. 仪表盘内作品管理（已落地）

第 1 版的「写作管理」入口落点由工作流面板改为**仪表盘页内页面**，`zhai.workflow` 的 press 页保持原样（AI 对话主体），两处入口并存：

| 入口 | 落点 | 页面内容 |
|------|------|----------|
| 仪表盘「写作管理」 | 仪表盘页内路由 `#/press` | 作品列表 + 添加作品 |
| 工作流初始页选「写作管理」 | 工作流 press 页 | AI 对话 + 分区导航（未改动） |

**AI 对话归属**：press 页的 AI 对话按作品隔离——当前作品目录（`press/{作品名}`）作为会话作用域下传给 `AiChat`，取最近会话、新建会话与历史列表都只在该作品范围内进行，切换作品即换用该作品自己的对话记录。未打开作品或从占位页承接的对话不带作用域，走通用对话。会话正文仍存全局 `ai.db` 的 `conversations` / `messages`，由 `project_dir` 记录归属作品（见 `ai-chat.md` 第 6 节）。

**数据来源**：本期不新建 `press.db`，作品摘要直接由索引库 `files` 表聚合（目录即作品），与「Markdown 主存储 + SQLite 仅缓存」原则一致。

| 字段 | 规则 |
|------|------|
| 作品范围 | `press/{作品名}/` 下至少三段的索引记录，`press/*.md` 散落文档不计入 |
| 章节数 | 第三段为 `Chapter` 的文档数，兼容分卷（`Chapter/01-卷名/*.md`） |
| 字数 | 作品目录下全部文档字数合计 |
| 最近更新 | 目录内文档的最大 mtime |
| 顺序 | mtime 倒序，同时间按作品名本地化排序 |

**协议（仪表盘面板宿主）**：`press/projects`（只读聚合）、`press/create`（生成骨架 + 索引 + 打开 README）、`press/open`（打开 README）。

**骨架生成**：`press/{作品名}/` 下写入 `README.md`（Frontmatter 含 title / audience / status / wordGoal / createdAt）、`大纲.md`、`角色设定.md`、`设定.md`、`Chapter/01-卷1/01-未命名章节.md`，并创建 `Chapter/` 与 `Chapter/01-卷1/` 目录；每个文档写盘后立即索引，列表不等 watcher 防抖即可见。新作品内容为空时默认就是「卷1 / 01-未命名章节」，详情页一进去即有可写章节。`audience` 取值仅 `男频` / `女频`，由添加作品弹窗的 Toggle Group 选择，缺省或非法值回落为 `男频`；旧作品 README 中的 `category` 字段不再写入，也不影响索引。

**安全约束**：作品名经白名单校验（长度、`\ / : * ? " < > |`、控制字符、`.`/`..`、Windows 保留名、首尾空格与点），目标目录已存在即拒绝；`press/open` 的目录须先在索引库中存在，且严格限定为 `press/{作品名}` 两段。

**已知取舍**：作品定义为「含已索引文档的二级目录」，删光某作品下的全部文档后该作品会从列表消失（目录仍在，重新加文档即回归）；索引缓存被清空时列表为空，空态提供「重建索引」入口。

### 10.1 作品详情与章节管理（已落地）

点击作品条目进入详情页，路由为 `#/press/{作品名}`（作品名以 `encodeURIComponent` 承载，解码后仍须为单段且不含上跳片段）。

**协议**

| 方法 | 说明 |
|------|------|
| `press/detail` | 一次返回作品摘要 + 卷分组章节；作品未登记时明确报错，不返回空详情 |
| `press/createChapter` | 计算落点与序号 → 写入章节骨架 → 索引 → 打开，返回 `path / title / volume` |
| `press/createVolume` | 卷序号取最大值 + 1 → 建目录 → 写入首章 → 索引 → 打开 |
| `press/renameVolume` | 保留原序号前缀替换卷名 → 移动目录 → 清理旧前缀索引 → 按新路径重建索引 |
| `press/deleteVolume` | 整卷目录移入回收站 → 按前缀清理该卷索引记录 |
| `press/deleteChapter` | 单章移入回收站 → 按完整路径清理该章索引；有未保存修改的文档直接拒绝 |
| `press/moveChapter` | 移动到目标卷末尾 → 重排文件名序号 → 清旧路径索引 → 按新路径索引，返回 `path / title / volume` |
| `press/openChapter` | 回查索引库精确命中后打开章节文档，前缀须属于对应作品的 `Chapter/` |
| `press/deleteProject` | 回查作品在索引中 → 拒绝含未保存修改的作品 → 整部作品目录移入回收站（不可用时降级永久删除） → 按前缀清理索引 → 清空路由事实中的当前作品，回包带 `permanent` 供前端提示能否从回收站恢复 |

**章节聚合规则**

| 项 | 规则 |
|----|------|
| 章节判定 | 路径第三段为 `Chapter`，未分卷为 `Chapter/{文件}`，分卷为 `Chapter/{卷目录}/{文件}` |
| 分组 | 按卷目录分组，未分卷归入空名卷组并固定排在最前 |
| 排序 | 序号前缀（`/^(\d+)(?:[-_.、\s]|$)/`）升序；无前缀项排在有序项之后，按名称本地化排序 |
| 标题 | 优先用索引库 `title`；文档无标题（`title` 等于文件名）时用去序号前缀与 `.md` 的文件名兜底 |
| 深层目录 | `Chapter/{卷}/{子目录}/{文件}` 归入该卷，不再向下建树 |

**卷与章节的层级**

- 卷是必备层级：作品骨架创建时即生成 `Chapter/01-卷1/` 与首章 `01-未命名章节.md`，章节一律落在卷下，`Chapter/` 根不再作为新建落点
- 卷目录命名为 `{两位序号}-卷{N}`，展示名去掉序号前缀（`01-卷1` → `卷1`）
- 历史遗留的 `Chapter/*.md`（未分卷散章）以「未分卷」组只读展示，不提供新增入口

**添加章节（卷头 `+`）**

- 落点：指定 `volumeDir` 时落到该卷；未指定时取序号最大的卷；作品还没有卷时落到默认卷1
- 序号：取目标卷内已登记章节的最大序号 + 1，文件名 `{两位序号}-未命名章节.md`（卷内独立编号）
- 冲突：写入前逐次检查存在性，冲突则递增序号重试（最多 10 次），绝不覆盖
- 骨架：Frontmatter（title / status: draft / summary / characters / goldenFingers / wordGoal）+ 本章介绍 / 正文 / 出场角色 / 金手指设定
- 写盘后立即索引并打开，详情页不等 watcher 防抖即可见；前端在成功后自动展开该卷

**新建卷（`press/createVolume`）**

- 入口位于卷头「更多操作」菜单首项（重命名之前），作品还没有卷时由空态按钮兜底，页头不再常驻「新建卷」按钮
- 卷序号取现有卷最大序号 + 1，目录名 `{两位序号}-卷{N}`，目录已存在时递增重试
- 建卷必须同时写入该卷首章 `01-未命名章节.md`：索引库只记录文档，空目录不会出现在详情页，避免「看不见的卷」
- 首章写盘后立即索引并打开，toast 提示卷名

**卷的重命名与删除（卷头更多操作）**

- 重命名只换可读部分，序号前缀沿用原目录（`01-卷1` → `01-风起长安`）；原目录无前缀时不凭空补前缀，避免造出排序号
- 新卷名走与作品名同源的名称白名单（`validateVolumeName`）；目标目录已存在即拒绝，绝不合并或覆盖
- 目录移动后旧路径索引立即失效：先按旧卷前缀清理（`removeFilesUnder`），再按新路径逐份重建，不依赖 watcher 的删除回调
- 删除整卷移入回收站（回收站不可用时降级永久删除），并按前缀清理该卷索引记录；作品下删空后不自动补卷，下次新增章节回落默认卷1
- 卷、章节、作品的删除统一走 `common/storagePath` 的 `deleteResource`：`useTrash` 失败即重试永久删除，两次都失败时抛出的错误同时带上回收站与直接删除两条原因，便于定位（Windows 回收站被禁用/容量不足、目标被占用都会让 `useTrash` 单独失败）
- 未分卷组（历史散章）不提供卷级操作入口

**章节的删除与移动（章节行更多操作）**

- 删除：单章移入回收站并按完整路径清理索引（`removeFile`，不做前缀匹配，避免误伤同前缀文档）；文档开着且有未保存修改时拒绝，提示先保存，防止删盘后编辑器内容把文件写回
- 移动：语义为「追加到目标卷末尾」，只替换文件名序号前缀、保留可读名与正文（`Chapter/01-卷1/03-初见.md` → `Chapter/02-卷2/08-初见.md`）
- 序号：取目标卷内已登记章节的最大序号 + 1，冲突时递增重试（最多 10 次），绝不覆盖既有章节
- 索引：先清旧路径记录再按新路径索引，顺序颠倒会让旧记录带偏聚合口径
- 约束：同卷移动直接拒绝；目标卷必须已存在（空目录不进索引，自动建卷会造出「看不见的卷」）；目标卷为空串表示移动到「未分卷」根目录
- 越界防护：章节路径须归一化后仍位于该作品的 `Chapter/` 之下（未分卷 4 段、分卷 5 段起），宿主侧先回查索引库再触达文件系统
- 交互：移动成功 toast 提示落点卷，列表以 `key` 重挂载并展开落点卷；删除走二次确认弹窗
- 未分卷组的章节同样提供移动与删除入口，便于把历史散章收进正式卷

**大作品渲染（懒加载 + 折叠）**

- 数据层：`press/detail` 一次性返回全量章节元数据（500 章约 60KB），不做协议分页，卷分组在宿主一次算完
- 渲染层：每个卷独立分批（`useProgressiveList`，每批 100 条），卷内底部哨兵进入 ScrollArea 视口即自动追加，另保留「加载更多」按钮兜底
- 观察器 root 必须取 `[data-slot="scroll-area-viewport"]`：webview 中滚动发生在此容器内而 body 不滚动
- 折叠由 `Collapsible` 承担，默认只展开第一个卷（首屏渲染 ≤ 一批）；折叠时不挂观察器，展开后重建
- 展开状态以「用户操作后的集合」为准，未操作时按默认集合派生；切换作品由 `dirPath` 作 key 重挂载重置
- 切片作用于扁平章节序列，渲染时再按卷重建分组，避免跨批切断卷标题；切换作品时以 `dirPath` 作 key 重挂载，计数与滚动位置归零
