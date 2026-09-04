# Press（小说写作）— 模块设计文档

**版本**：2.0
**日期**：2026-09-04
**状态**：草案
**宿主**：VSCode 插件 BaiwanyiONE
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
- **作品根 README.md（设想⑤）**：承载小说背景、写作风格、分类、状态、目标字数等全局设定；AI 副驾默认注入其作为系统音色与风格约束。

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
| US-1 | 新建作品 | 命令「新建作品」→ 输入名称 / 分类 / 笔名 → 自动生成 `{root}/press/【小说名】/` 骨架（README.md + 大纲.md + 角色设定.md + Chapter/） |
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

> **弃用规避**：不使用 `fs.renameSync` 等同步 API 处理排序重命名（改用 `fs.promises.rename` 并依赖 `onWillRenameFiles` 事件同步链接）；不使用已废弃的 `epub-gen` 回调式旧 API（使用 Promise 版本）。

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
| `baiwanyione.press.newProject` | 新建作品 | 生成 `press/【小说名】/` 骨架（README.md + 大纲.md + 角色设定.md + Chapter/） |
| `baiwanyione.press.openProject` | 打开作品 | 侧边栏切换到指定作品 |
| `baiwanyione.press.newChapter` | 新建章节 | 在当前卷末尾追加 `01-章节名.md` |
| `baiwanyione.press.newVolume` | 新建卷 | 创建 `Chapter/01-卷名/` |
| `baiwanyione.press.splitChapter` | 分章 | 按光标位置拆分 |
| `baiwanyione.press.mergeChapters` | 合并章节 | 合并选中多章 |
| `baiwanyione.press.continue` | AI 续写 | `Alt+Enter` |
| `baiwanyione.press.openOutline` | 打开大纲 | 三视图切换（大纲.md） |
| `baiwanyione.press.openCharacters` | 角色管理 | 角色列表与关系图谱（角色设定.md） |
| `baiwanyione.press.openForeshadowing` | 伏笔看板 | 待回收预警 |
| `baiwanyione.press.snapshots` | 版本快照 | 列表 / diff / 恢复 |
| `baiwanyione.press.stats` | 创作统计 | 热力图与日历 |
| `baiwanyione.press.export` | 导出作品 | 格式与范围选择（按 Chapter/ 顺序） |
| `baiwanyione.press.pomodoro` | 番茄钟 | 开始 / 暂停 |

**Webview 方法**：`project/list`、`chapter/tree`、`chapter/reorder`、`character/list`、`character/relations`、`setting/list`、`foreshadowing/list`、`outline/get`、`stats/get`、`export/run`

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
