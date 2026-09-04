# 笔记 (Notes) — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：草案
**宿主**：VSCode 插件 BaiwanyiONE

---

## 1. 模块概述

### 1.1 定位

以**可配置文档保存目录下的 `notes/` 模块**为笔记本的 Markdown 笔记系统（存储根与模块划分见 `common.md` 1.5）。笔记按「年月目录 + UUID 文件名」组织（设想④）：`{root}/notes/YYYYMM/UUID.md`，编辑入口是 VSCode 原生编辑器。插件只提供组织、链接、检索、版本与采集等增强能力，不另建一套编辑器。

**目录结构（设想④）**

```
{root}/notes/
└── 202509/                      ← 年月目录（YYYYMM）
    ├── 0f1e2d3c-4b5a-6f7e-8c9d-0a1b2c3d4e5f.md   ← UUID 文件名（32 位十六进制，时间戳打散）
    └── a1b2c3d4-e5f6-0a1b-2c3d-4e5f6a7b8c9d.md
```

- UUID 格式 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`，每位 `0-9a-f`；生成时将时间戳打散分布到 32 位中（非简单顺序），降低同日笔记的可预测性。
- SQLite 索引（见 `common.md` ③）以 `path`（含 `notes/YYYYMM/UUID.md`）+ 首行 `# 标题` 为索引维度，标题取自文档首个一级标题。

### 1.2 目标

- **零迁移成本**：已有的一堆 `.md` 文件直接就是笔记库，无需导入
- **编辑体验原生**：多光标、代码片段、Git diff、拼写检查全部沿用 VSCode
- **关系网络化**：通过 `[[双向链接]]` 与标签把散落的笔记织成网络

### 1.3 非目标

- 不提供云端同步与多人共享
- 不替代专业大纲编辑器（如 Logseq 的块级编辑），笔记以**文件**为最小单位
- 不内置富文本块编辑（所见即所得），沿用 Markdown 源码 + 预览

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 模板速记 | `Baiwanyione: 新建笔记` → 选「会议记录」模板 → 自动在 `notes/2026-09/{uuid}.md` 创建并填充骨架（首行 `# 标题`） |
| US-2 | 网页剪藏 | 浏览技术文章 → 插件命令「整页采集」→ Readability 提取正文 → 转 Markdown → 存为笔记并附来源 |
| US-3 | 双链漫游 | 在 A 笔记输入 `[[` → 补全选中 B → 在 B 的反链面板看到 A → 点击跳回 |
| US-4 | 误删找回 | 删掉一段内容并保存 → 打开版本历史 → 对比差异 → 一键恢复 |
| US-5 | 贴图写作 | 截图后直接 `Ctrl+V` → 图片落盘到 `assets/` → 插入相对路径链接 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| N1 | 年月/UUID 笔记本 | 以 `notes/YYYYMM/` 为笔记本的树形导航，UUID 文件为笔记，支持折叠与快速跳转（设想④） | P0 | 待实现 |
| N2 | 标签体系 | Frontmatter `tags` + 正文 `#标签` 双通道，按标签筛选 | P0 | 待实现 |
| N3 | 自动保存与修订 | 5s 防抖自动保存；本地快照保留 ≥ 30 版 | P0 | 待实现 |
| N4 | 双向链接 | `[[笔记标题]]` 自动补全与跳转，重命名时批量同步 | P0 | 待实现 |
| N5 | 反链与引用计数 | 侧边显示「被哪些笔记引用」，标题旁显示引用数 | P1 | 待实现 |
| N6 | 关系图谱 | 力导向图展示笔记引用网络，支持缩放与聚焦 | P2 | 待实现 |
| N7 | 全文检索与高亮 | FTS5 检索，结果片段关键词高亮 | P0 | 待实现 |
| N8 | 模板系统 | 会议记录 / 读书笔记 / 周报预设，支持自定义保存 | P1 | 待实现 |
| N9 | 图片粘贴落盘 | `Ctrl+V` / 拖拽图片自动保存到 `assets/` 并插入相对链接 | P1 | 待实现 |
| N10 | 网页剪藏 | 截图 OCR / 选中文本 / 整页采集三种方式 | P2 | 待实现 |
| N11 | 置顶与收藏 | 笔记置顶、快速访问收藏列表 | P2 | 待实现 |
| N12 | 看板/日历视图 | 按标签列的看板、按日期聚合的日历视图 | P2 | 待实现 |
| N13 | AI 摘要与标签建议 | 生成摘要写入 Frontmatter；按内容推荐标签 | P2 | 待实现 |
| N14 | 回收站与恢复 | 删除进入回收站，默认保留 30 天 | P1 | 待实现 |
| N15 | 日记/周记自动生成 | 按日期模板自动创建日记文件 | P2 | 待实现 |

---

## 4. 交互与流程

### 4.1 新建笔记（模板）

```
命令面板：Baiwanyione: 新建笔记
   │
   ▼
选择笔记本（目录） → 选择模板（空 / 会议记录 / 读书笔记 / 周报 / 自定义）
   │
   ▼
生成 Frontmatter：title / created / tags / source
   │
   ▼
在 {root}/notes/YYYYMM/{uuid}.md 创建文件（YYYYMM 取当前年月，uuid 时间戳打散生成）
   │
   ▼
用 VSCode 打开并聚焦正文区
   │
   ▼
FileSystemWatcher 触发索引（见 common.md 4.1）
```

### 4.2 网页剪藏

```
触发方式：命令面板 / 浏览器扩展（见 docs/modules/extension.md）
   │
   ▼
┌────────────────┬─────────────────┬──────────────────┐
│ 整页采集        │ 选中文本         │ 截图 OCR          │
│ Readability    │ 剪切板文本       │ Tesseract        │
│ → Turndown     │ → 加来源引用     │ chi_sim+eng      │
└───────┬────────┴────────┬────────┴─────────┬────────┘
        └─────────────────┼──────────────────┘
                          ▼
              统一 Markdown 模板（含来源/采集方式/时间）
                          ▼
              写入 notes/ 或用户指定笔记本 → 打开编辑
```

### 4.3 双向链接解析

```
解析（增量，仅对变更文件）
  全文扫描 /\[\[([^\]]+)\]\]/g
      → 归一化目标标题（去扩展名、大小写折叠、去除路径）
      → 查 files 表得到 target_path
      → 写入 note_links(source_path, target_path, raw_text, line)

重命名同步（用户重命名文件时）
  vscode.workspace.onWillRenameFiles
      → 计算旧标题/新标题
      → 查 note_links 得到所有入链文件
      → 单次 WorkspaceEdit 批量替换 [[旧标题]] → [[新标题]]
      → 索引增量更新
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 编辑器 | VSCode 原生 TextEditor / Webview 自研 | **原生 TextEditor** | 复用 Git、多光标、拼写、格式化；Webview 仅做预览与关系图谱 |
| Frontmatter | `gray-matter` / `js-yaml` 手写 | **gray-matter** | 解析与序列化一体，容错性好 |
| 双链解析 | 正则扫描 / `remark-wikilink` AST | **正则扫描（增量）** | 只需提取链接与行号，正则最轻；AST 解析留给 Markdown ONE 的导出管线 |
| 关系图谱 | `cytoscape` / `d3-force` / `sigma` | **cytoscape** | 万级节点性能与交互 API 成熟，布局算法丰富 |
| 版本快照 | 本地 `.baiwanyione/history`（内容寻址）/ 纯依赖 Git | **本地快照 + Git 可选** | 无 Git 仓库也能恢复；快照按内容 hash 去重节省空间 |
| 剪藏正文 | `Readability` + `Turndown` / 简易选择器 | **Readability + Turndown** | 与浏览器扩展方案一致（见 `extension.md`），提取质量高 |
| OCR | `tesseract.js` / 云端 OCR | **tesseract.js（`chi_sim+eng`）** | 完全离线，隐私友好；云端作为可选配置 |
| 图片落盘 | 剪贴板 PNG → `assets/` + 相对路径 | **相对路径落盘** | 保证工作区可整体迁移，避免绝对路径失效 |
| 列表性能 | `@tanstack/react-virtual` / `react-window` | **@tanstack/react-virtual** | 维护活跃，支持动态行高，适配笔记标题长度不一 |

> **弃用规避**：不使用 `vscode.workspace.onDidChangeTextDocument` 轮询正文做索引（事件风暴），改为监听 `onDidSaveTextDocument` + `FileSystemWatcher`；不使用已废弃的 `workspace.rootPath`。

---

## 6. 数据模型

笔记正文不入库，以下表存于 `globalStorage/notes.db`（与通用索引库可为同一库的不同表）。

```sql
-- 标签
CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    color TEXT
);

-- 笔记 ↔ 标签
CREATE TABLE IF NOT EXISTS note_tags (
    note_path TEXT NOT NULL,
    tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_path, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

-- 双向链接
CREATE TABLE IF NOT EXISTS note_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    target_path TEXT,                 -- 目标不存在时为 NULL（悬空链接）
    raw_text    TEXT NOT NULL,        -- [[ ]] 内的原始文本
    line        INTEGER NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_links_source ON note_links(source_path);
CREATE INDEX IF NOT EXISTS idx_links_target ON note_links(target_path);

-- 修订快照（内容寻址，正文存于文件系统）
CREATE TABLE IF NOT EXISTS note_revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note_path   TEXT NOT NULL,
    blob_hash   TEXT NOT NULL,        -- SHA-256，对应 history/<hash>.md
    word_count  INTEGER NOT NULL DEFAULT 0,
    reason      TEXT NOT NULL,        -- 'auto' | 'manual' | 'restore'
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rev_note ON note_revisions(note_path, created_at DESC);

-- 模板
CREATE TABLE IF NOT EXISTS note_templates (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    body    TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0
);

-- 回收站
CREATE TABLE IF NOT EXISTS trash (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_path TEXT NOT NULL,        -- 原路径（相对工作区）
    blob_path   TEXT NOT NULL,        -- 回收站内的实际存放路径
    deleted_at  TEXT NOT NULL,
    expire_at   TEXT NOT NULL
);
```

**说明**

- `files` 表（见 `common.md`）保存标题（取自首行 `# 标题`）、字数、标签 JSON、mtime，是笔记的主索引；`path` 形如 `notes/202509/0f1e…md`（设想④）
- 修订快照正文存于 `globalStorage/history/<hash>.md`，同内容只存一份
- 回收站条目到期后由启动时的一次清理任务物理删除

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `baiwanyione.note.new` | 新建笔记 | 选择笔记本与模板后创建 |
| `baiwanyione.note.newFromTemplate` | 从模板新建 | 直接指定模板 |
| `baiwanyione.note.insertLink` | 插入双向链接 | 弹出笔记选择器，插入 `[[标题]]` |
| `baiwanyione.note.showBacklinks` | 显示反向链接 | 侧边栏展示入链列表 |
| `baiwanyione.note.showGraph` | 打开关系图谱 | Webview 力导向图 |
| `baiwanyione.note.restoreRevision` | 恢复历史版本 | 选择快照 → diff → 恢复 |
| `baiwanyione.note.pasteImage` | 粘贴图片 | 剪贴板图片落盘并插入 |
| `baiwanyione.note.clipWeb` | 剪藏网页 | 粘贴 URL → 抓取正文 → 存为笔记 |
| `baiwanyione.note.openTrash` | 打开回收站 | 查看与恢复已删除笔记 |
| `baiwanyione.note.togglePin` | 置顶/取消置顶 | 写入 Frontmatter `pinned` |

**Webview 方法**：`note/list`、`note/tags`、`note/backlinks`、`note/revisions`、`note/restore`、`template/list`、`trash/list`、`trash/restore`

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 自动保存 | 停止输入 5s 内完成保存；切换文件时强制保存 |
| AC-2 | 全文检索 | < 200ms（1 万笔记），结果关键词高亮 |
| AC-3 | 双链跳转 | 点击链接 < 100ms 定位到目标（悬空链接提示创建） |
| AC-4 | 重命名同步 | 重命名笔记后，所有入链的 `[[ ]]` 一次性全部更新 |
| AC-5 | 修订恢复 | 保留 ≥ 30 个版本；恢复后内容与快照一致 |
| AC-6 | 图片粘贴 | 从 `Ctrl+V` 到链接插入 < 1s，路径为相对路径 |
| AC-7 | 剪藏保真 | 主流技术博客正文提取完整度 ≥ 90%（人工抽检 20 篇） |
| AC-8 | 回收站 | 删除后 30 天内可恢复，恢复后路径与内容一致 |
| AC-9 | 图谱性能 | 5000 节点图谱渲染 < 2s，拖拽帧率 ≥ 30fps |
| AC-10 | 不干扰 Git | 笔记操作产生的插件数据均不写入工作区 |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 笔记数量巨大时索引与图谱变慢 | 体验下降 | 图谱默认只渲染当前笔记的 2 度关系；列表虚拟滚动 |
| 双链歧义（同名笔记） | 链接指错目标 | 归一化冲突时提示用户选择，支持 `[[目录/标题]]` 限定 |
| 快照膨胀 | 占用磁盘 | 内容寻址去重 + 保留策略（近 30 版 + 每日首版保留 30 天） |
| 剪藏站点结构差异 | 提取失败 | 多级备选策略 + 提取后可编辑确认 |
| OCR 中文准确率 | 识别错误 | 默认 tesseract `chi_sim+eng`，提供云端 OCR 选项与手动校对 |
| 与用户已有 `.md` 工作流冲突 | 认知负担 | 所有增强以「可选命令」提供，不强制 Frontmatter |

**开放问题**

1. 是否支持块级引用（`[[笔记#标题]]`）？需要解析标题锚点
2. 回收站是否需要跨工作区统一视图？
3. 模板是否支持变量占位（如 `{{date}}`、`{{title}}`）与脚本钩子？
