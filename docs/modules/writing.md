# 写作 (Writing) — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：草案
**宿主**：VSCode 插件 BaiwanyiONE
**历史参考**：`docs/modules/press.md`（宅桌面时期方案，本文件为插件形态重构版）

---

## 1. 模块概述

### 1.1 定位

面向长篇小说/长文创作的**结构化工作台**：作品、卷、章、角色、设定、伏笔、情节线全链路管理，并深度接入 AI 副驾。

与「笔记」模块的边界：笔记是**扁平的知识网络**（以文件为单位、关系自由），写作是**强层级的项目结构**（作品 → 卷 → 章，带状态、目标与统计）。

### 1.2 结构映射（核心设计）

遵循「Markdown 做主存储」原则，目录结构即作品结构：

```
novels/
└── 斗破苍穹/                    ← 作品
    ├── project.md              ← 作品元信息（Frontmatter：笔名/分类/状态/目标字数）
    ├── outline.md              ← 大纲（卷-章结构与摘要）
    ├── characters/             ← 角色卡（每角色一个 .md）
    │   ├── 林凡.md
    │   └── 苏沐.md
    ├── settings/               ← 世界观设定（按分类目录）
    │   ├── 地理.md
    │   └── 宗门.md
    ├── volume-01-觉醒/         ← 卷（目录名前缀保证顺序）
    │   ├── 0001-第一章-少年.md  ← 章（文件名前缀保证顺序）
    │   └── 0002-第二章-试炼.md
    └── volume-02-入门/
```

章节的 Frontmatter 承载元信息：

```yaml
---
title: 第一章 少年
status: draft          # draft|revising|pending|published
summary: 林凡在族测中觉醒天赋，却被当众羞辱。
characters: [林凡, 苏沐]
plotLines: [主线, 感情线]
wordGoal: 3000
---
```

### 1.3 目标

- 结构、设定、伏笔等**全部落盘为 Markdown**，作品可整体 Git 管理与迁移
- AI 副驾基于索引精准取用前文与设定，保证人设与剧情一致
- 创作过程可度量（字数、连更、热力图）并可持续（番茄钟、目标进度）

### 1.4 非目标

- 不做多人协作与在线投稿
- 不做自动全文生成（AI 只做辅助，不替代作者决策）
- 不提供复杂排版（导出排版交给 `markdown-one.md`）

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 新建作品 | 命令「新建作品」→ 输入名称/分类/笔名 → 自动生成目录骨架与「卷一/第一章」 |
| US-2 | 章节写作 | 章节树点开第一章 → 原生编辑器写作 → `Alt+Enter` 让 AI 续写 → 逐段接受 |
| US-3 | 设定一致性 | 写战斗场景 → 勾选「注入设定」→ AI 自动读取主角能力与世界观条目 |
| US-4 | 伏笔回收 | 第 30 章埋下伏笔 → 伏笔面板标记「预期第 60 章回收」→ 到第 60 章时状态栏提醒 |
| US-5 | 完本导出 | 完本后导出 → 选择 EPUB → 生成整部电子书 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| W1 | 作品管理 | 创建/重命名/删除/归档，作品元信息面板 | P0 | 待实现 |
| W2 | 卷-章两级树 | 目录即卷、文件即章；拖拽排序、分章与合并 | P0 | 待实现 |
| W3 | 章节元信息 | 状态、摘要、写作便签、关联角色、字数目标 | P1 | 待实现 |
| W4 | 编辑器集成 | 原生编辑器 + Webview 预览（渲染 MDX 组件） | P0 | 待实现 |
| W5 | AI 续写 | 基于前文流式生成，`Alt+Enter` 触发 | P0 | 待实现 |
| W6 | AI 润色/改写 | 选中文本 + 风格指令（更生动/更简洁/古风/自定义） | P1 | 待实现 |
| W7 | AI 对话生成 | 选择角色 + 场景 → 生成符合人设的对话 | P1 | 待实现 |
| W8 | AI 描写展开 | 简单句扩展为沉浸式段落 | P1 | 待实现 |
| W9 | AI 大纲生成 | 基于当前章节生成后续章节大纲 | P1 | 待实现 |
| W10 | AI 智能校对 | 错别字/标点/重复用词，以装饰标记呈现 | P2 | 待实现 |
| W11 | AI 写评 | 章节完成后点评节奏/情感/逻辑 | P2 | 待实现 |
| W12 | 情感/节奏分析 | 情感曲线与叙事节奏可视化 | P2 | 待实现 |
| W13 | AI 智能起名 | 关键词 → 角色名/地名/功法名 | P2 | 待实现 |
| W14 | 角色管理 | 角色卡（基础/外貌/性格/背景/能力）、关系图谱、出场统计 | P1 | 待实现 |
| W15 | 世界观设定 | 地理/组织势力/时间线/种族/文化宗教/魔法科技 六类 | P1 | 待实现 |
| W16 | 大纲三视图 | 树形 / 卡片 / 时间线，摘要内联编辑 | P2 | 待实现 |
| W17 | 伏笔管理 | CRUD + 状态（未回收/已回收/已废弃）+ 待回收预警 | P2 | 待实现 |
| W18 | 情节线管理 | 多线并行（主线/感情线/暗线/支线）并关联章节 | P2 | 待实现 |
| W19 | 版本快照 | 手动/自动快照，diff 对比，一键恢复 | P1 | 待实现 |
| W20 | 写作统计 | 日/周目标、连更天数、热力图、写作日历 | P2 | 待实现 |
| W21 | 番茄钟 | 25 分钟写作 + 5 分钟休息，可自定义时长 | P2 | 待实现 |
| W22 | 导入导出 | 导入 md/docx/txt；导出 md/docx/EPUB/PDF | P1 | 待实现 |

---

## 4. 交互与流程

### 4.1 创作主流程

```
新建作品 → 设定世界观 → 创建角色 → 规划大纲 → 分章写作 → 修改润色 → 完本导出
   │           │            │           │           │           │          │
   └─ 目录骨架   └─ settings/*.md └─ characters/*.md └─ outline.md └─ 章节 .md └─ AI 校对 └─ 导出
```

### 4.2 AI 续写时序

```
章节编辑器（光标位置）
   │ Alt+Enter
   ▼
宿主读取：当前文件路径 + 光标偏移
   ├─ 查索引 → 定位同卷前文（按 order 取最近 N 章，受 contextTokens 限制）
   ├─ 若勾选「注入设定」→ 读取 characters/、settings/ 的相关条目
   └─ 组装 prompt（系统音色 + 设定 + 前文 + 续写指令）
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
   → 到达预期回收章节时状态栏/面板提醒
   → 作者回收后标记「已回收」并关联实际章节
   → 放弃则标记「已废弃」（保留记录，便于复盘）
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 结构存储 | 目录=卷、文件=章 / 全部进 SQLite | **目录即结构** | 符合 Markdown 主存储原则；用户可在资源管理器直接操作 |
| 顺序保证 | 文件名前缀 `0001-` / Frontmatter `order` | **文件名前缀 + Frontmatter 双写** | 前缀保证文件系统顺序直观，Frontmatter 便于程序排序与容灾 |
| 编辑器 | 原生 TextEditor / Webview MDX 编辑器 | **原生编辑 + Webview 预览** | 写作是长时间输入，原生编辑器性能与稳定性最佳；MDX 组件（人物卡/时间线）在预览中渲染 |
| MDX 渲染 | `@mdx-js/mdx` + 预览 Webview | **@mdx-js/mdx** | 与写作模块历史方案一致，支持自定义组件 |
| 拖拽排序 | VSCode TreeDataItem 拖拽 / Webview HTML5 DnD | **TreeDataItem 原生拖拽** | 与资源管理器交互一致；排序落盘为重命名字件前缀 |
| 差异对比 | `vscode.diff` 原生对比 / Webview 内 diff | **vscode.diff** | 章节篇幅大，原生对比性能与滚动体验更好 |
| 图表 | `recharts` / `echarts` | **recharts** | React 友好，体积适中，覆盖热力图/折线/柱状 |
| 状态管理 | Zustand / Context | **Zustand** | 面板状态多（树/大纲/伏笔/统计），Zustand 订阅粒度细，避免整体重渲染 |
| 导出 docx | `docx` 库 | **docx** | 纯 JS，无需外部依赖 |
| 导出 EPUB | `epub-gen` / 手写 OPF | **epub-gen** | 封装完整，支持章节与封面 |
| 导出 PDF | HTML → 打印 / `puppeteer-core` | **HTML → 系统打印** | 避免内联浏览器依赖；若需自动化，puppeteer-core **保持沙箱开启**（不禁用安全 flag） |
| 番茄钟 | 定时器 + 状态栏 | **状态栏 + 通知** | 轻量，计时结束自动保存当前章节 |

> **弃用规避**：不使用 `fs.renameSync` 等同步 API 处理排序重命名（改用 `fs.promises.rename` 并依赖 `onWillRenameFiles` 事件同步链接）；不使用已废弃的 `epub-gen` 回调式旧 API（使用 Promise 版本）。

---

## 6. 数据模型

结构化元数据存于 `globalStorage/writing.db`（正文与设定仍在 Markdown 文件）。

```sql
-- 作品（对应工作区中的一个目录）
CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    dir_path     TEXT NOT NULL UNIQUE,   -- 相对工作区路径
    title        TEXT NOT NULL,
    author_name  TEXT,
    category     TEXT,                   -- 玄幻/都市/历史/科幻/悬疑/言情
    status       TEXT NOT NULL DEFAULT 'ongoing',  -- ongoing|paused|finished|archived
    word_goal    INTEGER NOT NULL DEFAULT 0,
    daily_goal   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

-- 章节（对应一个 .md 文件）
CREATE TABLE IF NOT EXISTS chapters (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    volume      TEXT NOT NULL,           -- 卷名（目录名）
    file_path   TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    order_no    INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft',
    summary     TEXT,
    word_count  INTEGER NOT NULL DEFAULT 0,
    word_goal   INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chapter_project ON chapters(project_id, volume, order_no);

-- 角色
CREATE TABLE IF NOT EXISTS characters (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    file_path  TEXT NOT NULL UNIQUE,     -- characters/林凡.md
    alias      TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',  -- 主角/反派/配角/龙套
    avatar     TEXT,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_char_name ON characters(project_id, name);

-- 角色关系
CREATE TABLE IF NOT EXISTS character_relations (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    to_id   TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    type    TEXT NOT NULL,               -- 盟友/敌对/恋人/师徒/亲属
    note    TEXT,
    UNIQUE(from_id, to_id, type)
);

-- 章节 ↔ 角色（出场统计）
CREATE TABLE IF NOT EXISTS chapter_characters (
    chapter_id    TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    character_id  TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    role          TEXT NOT NULL DEFAULT 'supporting',  -- main|supporting|cameo
    mention_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chapter_id, character_id)
);

-- 世界观设定
CREATE TABLE IF NOT EXISTS settings (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category   TEXT NOT NULL,            -- 地理/组织势力/时间线/种族/文化宗教/魔法科技
    name       TEXT NOT NULL,
    file_path  TEXT NOT NULL,
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

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `baiwanyione.writing.newProject` | 新建作品 | 创建目录骨架与首章 |
| `baiwanyione.writing.openProject` | 打开作品 | 侧边栏切换到指定作品 |
| `baiwanyione.writing.newChapter` | 新建章节 | 在当前卷末尾追加 |
| `baiwanyione.writing.newVolume` | 新建卷 | 创建卷目录 |
| `baiwanyione.writing.splitChapter` | 分章 | 按光标位置拆分 |
| `baiwanyione.writing.mergeChapters` | 合并章节 | 合并选中多章 |
| `baiwanyione.writing.continue` | AI 续写 | `Alt+Enter` |
| `baiwanyione.writing.openOutline` | 打开大纲 | 三视图切换 |
| `baiwanyione.writing.openCharacters` | 角色管理 | 角色列表与关系图谱 |
| `baiwanyione.writing.openForeshadowing` | 伏笔看板 | 待回收预警 |
| `baiwanyione.writing.snapshots` | 版本快照 | 列表/diff/恢复 |
| `baiwanyione.writing.stats` | 创作统计 | 热力图与日历 |
| `baiwanyione.writing.export` | 导出作品 | 格式与范围选择 |
| `baiwanyione.writing.pomodoro` | 番茄钟 | 开始/暂停 |

**Webview 方法**：`project/list`、`chapter/tree`、`chapter/reorder`、`character/list`、`character/relations`、`setting/list`、`foreshadowing/list`、`outline/get`、`stats/get`、`export/run`

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 新建作品 | 骨架生成 < 500ms，目录结构符合约定 |
| AC-2 | 章节树 | 500 章作品树渲染 < 1s，拖拽排序落盘正确 |
| AC-3 | AI 续写 | 首字 < 500ms；上下文取前文 + 设定不超过配置 token 上限 |
| AC-4 | 设定一致性 | 勾选注入后，AI 输出中使用的人名/地名与设定库一致（抽检 ≥ 90%） |
| AC-5 | 自动保存 | 停止输入 5s 保存；切换章节强制保存 |
| AC-6 | 快照恢复 | 快照保留自动清理（超 30 天或超 100 个），恢复结果与快照一致 |
| AC-7 | 出场统计 | 角色出场章节数与人工核对一致 |
| AC-8 | 伏笔提醒 | 进入预期回收章节时触发提醒，误报率 < 10% |
| AC-9 | 导出 | 整部导出 EPUB（100 章）< 10s，目录层级正确 |
| AC-10 | 大文件编辑 | 5 万字章节编辑无明显卡顿（原生编辑器保障） |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 目录结构被用户手工改乱 | 树解析失败 | 解析容错（缺失 order 时按文件名字典序），提供「校验并修复结构」命令 |
| 章节过大导致 AI 上下文不足 | 续写断片 | 分层压缩：近 N 章原文 + 更早章节摘要；提供章节摘要自动生成 |
| 角色/设定与正文脱节 | 设定注入失效 | 支持按角色名检索索引（见 `common.md` 的 `characters` 字段） |
| 导出格式兼容性 | 排版错乱 | 先支持 md/docx/EPUB（结构清晰），PDF 走打印路径 |
| 统计口径争议（净增字数 vs 总字数） | 数据不符预期 | 以 `word_delta` 记录净增，UI 明示口径 |
| 与笔记模块边界模糊 | 用户困惑 | 明确：写作=项目制（带状态与目标），笔记=自由网络 |

**开放问题**

1. 是否支持一部作品跨多个工作区目录（如分卷存放）？
2. 大纲是否需要与 `outline.md` 双向同步（编辑文件即更新视图）？
3. 是否提供「章节模板」（开场/过渡/高潮的结构提示）？
