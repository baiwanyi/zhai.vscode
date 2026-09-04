# 阅读 (Reading) — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：草案
**宿主**：VSCode 插件 Zhai（宅桌面）
**历史参考**：`docs/modules/reader.md`（宅桌面时期方案，本文件为插件形态重构版）

---

## 1. 模块概述

### 1.1 定位

本地 TXT 小说的**只读阅读器**。与「写作」模块严格分工：阅读模块只读取与记录，**不修改、不移动、不重写**用户的原始 txt 文件。

### 1.2 目标

- **拿来即读**：指定目录批量导入，编码自动识别，重复文件自动跳过
- **大文件不卡**：100MB+ 单文件流式加载 + 虚拟滚动
- **进度随身**：阅读位置持久化，换章节/关窗口都不丢

### 1.3 非目标

- 不支持 EPUB/PDF/mobi（只做 TXT，避免引入重型解析依赖）
- 不做书籍文件的整理/重命名/移动（只读不写）
- 不做云端书架同步（进度存本地）

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 首次导入 | 设置 `zhai.reader.txtDir` → 命令「扫描目录」→ 进度条显示新增/跳过数 → 书架出现书籍列表 |
| US-2 | 断点续读 | 昨天读到 45% 关掉窗口 → 今天打开同一本 → 自动定位到上次位置 |
| US-3 | 大书阅读 | 打开 120MB 的 txt → 2s 内进入阅读 → 快速滚动无白屏 |
| US-4 | 章节跳转 | 打开章节导航 → 点「第 358 章 决战」→ 直接跳到该章首行 |
| US-5 | 检索原文 | 搜索「三千雷动」→ 结果列出命中段落 → 点击跳转到原文位置 |
| US-6 | 误删找回 | 从书架删除某书 → 回收站中恢复（仅删除插件记录，不删磁盘文件） |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| R1 | 目录递归扫描 | 遍历 `txtDir` 下所有子目录，仅取 `.txt` | P0 | 待实现 |
| R2 | 流式 MD5 去重 | 流式计算 hash，`file_hash` UNIQUE，重复自动跳过 | P0 | 待实现 |
| R3 | 编码自动检测 | 读文件头 64KB → jschardet 检测 → iconv-lite 解码 | P0 | 待实现 |
| R4 | 扫描并发锁与进度 | 互斥锁防重复扫描，进度实时显示 | P0 | 待实现 |
| R5 | 书架 | 封面网格 / 列表双视图，按最后阅读倒序，分页 | P0 | 待实现 |
| R6 | 章节解析 | 正则识别「第X章 / Chapter X / 第X节」，支持中文与阿拉伯数字 | P0 | 待实现 |
| R7 | 虚拟滚动阅读 | 长列表虚拟化，>100MB 文件流畅滚动 | P0 | 待实现 |
| R8 | 进度持久化 | 行号 + 偏移 + 百分比，切章/关窗自动保存 | P0 | 待实现 |
| R9 | 章节导航 | 左侧章节列表，当前章节高亮，点击跳转 | P1 | 待实现 |
| R10 | 阅读设置 | 字号/行距/页宽/字体，偏好持久化 | P1 | 待实现 |
| R11 | 主题 | 护眼绿 / 羊皮纸 / 暗黑 / 高对比 四种 | P1 | 待实现 |
| R12 | 翻页模式 | 滚动模式与单页翻页模式（←→ 翻页） | P2 | 待实现 |
| R13 | 亮度调节 | 遮罩层亮度调节 | P2 | 待实现 |
| R14 | 书签 | 增删改查，侧边栏列表，点击跳转 | P1 | 待实现 |
| R15 | 全文搜索 | FTS5 索引正文段落，关键词高亮 + 跳转 | P1 | 待实现 |
| R16 | 阅读统计 | 时长、已读字数、进度百分比 | P2 | 待实现 |
| R17 | 书架分组 | 在读 / 收藏 / 完结 自定义分组 | P2 | 待实现 |
| R18 | 回收站 | 软删除与恢复（绝不删除磁盘原文件） | P1 | 待实现 |
| R19 | 键盘操作 | ←→ 翻页、↑↓ 滚动、T 主题、F 字体、B 书签 | P2 | 待实现 |

---

## 4. 交互与流程

### 4.1 扫描导入

```
命令：Zhai: 扫描阅读目录
   │
   ▼
获取并发锁（已在扫描则提示稍后）
   │
   ▼
fs.promises.readdir（递归，带 withFileTypes）
   │  过滤 .txt；目录不存在 → 警告并结束
   ▼
对每个文件（串行 + 让出事件循环）
   ├─ 流式计算 MD5（createHash 分块 update）   ← 不读入全文
   ├─ 查 books.file_hash 去重 → 命中则 skipped++
   ├─ 读头部 64KB → jschardet.detect → encoding
   ├─ 统计 total_chars / total_lines（流式计数）
   └─ 事务批量 INSERT
   │
   ▼
返回 { totalFiles, newFiles, skippedFiles, errors } + 进度广播
```

### 4.2 打开与阅读

```
打开书籍
   ├─ 读取 books 记录（encoding / file_path / progress）
   ├─ 一次性构建行偏移索引（分块流式读取，记录每行起始 offset）
   │     大文件：仅构建到「当前阅读位置附近」，其余按需增量构建
   ├─ 章节解析（正则扫描标题行，得到 chapter 列表）
   └─ 渲染虚拟列表，滚动到 current_line
       │
       ▼ 滚动停止 500ms
   保存进度（current_line / offset / progress / last_read_at）
       │
       ▼ 窗口关闭 / 切换书籍
   强制保存进度
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 大文件读取 | 流式分块（`createReadStream` + 行切分）/ `readFileSync` 全量 | **流式分块** | 100MB+ 全量读入会 OOM 并阻塞事件循环 |
| 编码检测 | `jschardet` + `iconv-lite` / 纯 heuristic | **jschardet + iconv-lite** | 成熟方案，覆盖 UTF-8/GBK/Big5；仅读头部 64KB |
| 去重 | 流式 MD5 / 文件大小+首行 | **流式 MD5** | 准确；内容相同文件名不同也能识别 |
| 虚拟滚动 | `@tanstack/react-virtual` / `react-window` | **@tanstack/react-virtual** | 动态行高（`\n` 换行导致段落高度不一），维护活跃 |
| 翻页渲染 | CSS multi-column / JS 分页切片 | **JS 分页切片** | 中文排版下 columns 分页位置不可控 |
| 章节解析 | 多模式正则 / 机器学习分章 | **多模式正则 + 用户自定义规则** | 网文格式相对固定，正则覆盖率高；预留自定义配置 |
| 进度存储 | SQLite / `workspaceState` | **SQLite** | 需支持搜索、书签、统计等多维查询 |
| 正文索引 | FTS5 / 每次 grep | **FTS5（按需建索引）** | 仅对用户主动「加入搜索」的书籍建索引，避免磁盘膨胀 |
| 并发保护 | 互斥锁 / 无保护 | **进程内互斥锁** | 避免并发扫描的 TOCTOU 与磁盘 I/O 竞争 |
| 图片/封面 | 无封面 / 首字生成 | **生成文字封面** | TXT 无封面，用书名首字 + 渐变背景生成 |

> **弃用规避**：不使用 `fs.existsSync`/`readFileSync` 等同步 API（改用 `fs.promises`）；不使用 `new Buffer()`（改用 `Buffer.from`）；不使用 `subarray` 之外的废弃编码转换路径。

---

## 6. 数据模型

存于 `globalStorage/reading.db`（只存路径与元数据，**不复制正文**）。

```sql
CREATE TABLE IF NOT EXISTS books (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,             -- 文件名（不含 .txt）
    file_path     TEXT NOT NULL UNIQUE,      -- 磁盘绝对路径
    file_hash     TEXT NOT NULL UNIQUE,      -- 流式 MD5，去重依据
    encoding      TEXT NOT NULL DEFAULT 'UTF-8',
    file_size     INTEGER NOT NULL DEFAULT 0,
    total_chars   INTEGER NOT NULL DEFAULT 0,
    total_lines   INTEGER NOT NULL DEFAULT 0,
    current_line  INTEGER NOT NULL DEFAULT 0,
    current_offset INTEGER NOT NULL DEFAULT 0,
    progress      REAL NOT NULL DEFAULT 0,   -- 0~1
    group_name    TEXT,                      -- 在读/收藏/完结
    indexed       INTEGER NOT NULL DEFAULT 0,-- 是否已建全文索引
    last_read_at  TEXT,
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_books_read ON books(is_deleted, last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_group ON books(group_name);

-- 章节解析结果缓存
CREATE TABLE IF NOT EXISTS book_chapters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    order_no   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chapters_book ON book_chapters(book_id, order_no);

-- 书签
CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    line       INTEGER NOT NULL,
    excerpt    TEXT NOT NULL,                -- 上下文片段（≤100 字）
    note       TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id, line);

-- 阅读会话（统计）
CREATE TABLE IF NOT EXISTS reading_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    chars_read  INTEGER NOT NULL DEFAULT 0
);

-- 全文索引（仅对 indexed=1 的书籍建立）
CREATE VIRTUAL TABLE IF NOT EXISTS book_fts USING fts5(
    book_id UNINDEXED,
    line UNINDEXED,
    content,
    tokenize = 'trigram'
);
```

**配置**

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `zhai.reader.txtDir` | string | `""` | TXT 小说根目录（未配置时扫描返回 0，不报错） |
| `zhai.reader.fontSize` | number | `16` | 正文字号 |
| `zhai.reader.lineHeight` | number | `1.8` | 行距 |
| `zhai.reader.theme` | string | `sepia` | `green`/`sepia`/`dark`/`contrast` |
| `zhai.reader.chapterPattern` | string[] | 见下 | 自定义章节正则数组 |

默认章节正则覆盖：`第[零一二三四五六七八九十百千0-9]+[章节回]`、`Chapter\s*\d+`、`第[0-9]+节`。

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `zhai.reader.scan` | 扫描阅读目录 | 导入新书，显示进度与结果 |
| `zhai.reader.openBook` | 打开书籍 | 从书架选择 |
| `zhai.reader.toggleBookmark` | 切换书签 | 在当前行添加/移除书签 |
| `zhai.reader.search` | 搜索书籍内容 | FTS5 全文检索 |
| `zhai.reader.buildIndex` | 建立全文索引 | 对指定书建索引 |
| `zhai.reader.openTrash` | 阅读回收站 | 恢复已删除书籍记录 |

**Webview 方法**：`book/list`、`book/open`、`book/content`（分页取行）、`book/chapters`、`book/progress`（保存进度）、`bookmark/list`、`bookmark/add`、`bookmark/remove`、`search/query`

**关键接口定义**：

```typescript
/** 分块获取正文（避免一次传输超大内容） */
interface ContentRequest {
    method: 'book/content'
    payload: { bookId: number; startLine: number; lineCount: number }
}

interface ContentResponse {
    lines: string[]
    totalLines: number
    /** 该分段内命中的章节起点，供导航高亮 */
    chapterStarts: Array<{ line: number; title: string }>
}

/** 保存进度 */
interface ProgressRequest {
    method: 'book/progress'
    payload: { bookId: number; line: number; offset: number; progress: number }
}
```

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 首次扫描 | 目录有 5 个 txt → 导入 5 本；非 txt 文件忽略 |
| AC-2 | 重复扫描 | 文件未变 → 全部跳过，`newFiles = 0` |
| AC-3 | 增量扫描 | 新增 2 个 → 导入 2 本，跳过旧的 5 本 |
| AC-4 | 同名不同内容 | MD5 不同 → 均导入 |
| AC-5 | 同内容不同名 | MD5 相同 → 去重跳过 |
| AC-6 | 编码识别 | GBK / Big5 文件正确识别并正常显示 |
| AC-7 | 大文件 | >100MB 文件：打开 < 3s，滚动 ≥ 50fps，内存无溢出 |
| AC-8 | 目录不存在 | 输出警告，不崩溃 |
| AC-9 | 原文只读 | 阅读过程中磁盘源文件 mtime 与 hash 不变 |
| AC-10 | 进度恢复 | 关闭后重开，定位误差 ≤ 1 行 |
| AC-11 | 搜索 | 已索引书籍检索 < 300ms，结果高亮并精准跳转 |
| AC-12 | 并发保护 | 扫描中再次触发扫描 → 提示等待，不重复导入 |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 编码误判（短文件或生僻编码） | 乱码 | 头部 64KB 检测 + 用户可手动指定编码并回写记录 |
| 扫描阻塞主线程 | 界面卡死 | 异步 I/O + 分批处理，每批后 `setImmediate` 让出事件循环 |
| 全文索引磁盘占用 | 空间膨胀 | 默认不建索引，用户按需对单本书建立，可删除 |
| 章节正则误判（正文出现「第一章」字样） | 目录混乱 | 行首匹配 + 长度限制 + 用户可自定义正则与手动修正 |
| 源文件被外部移动/删除 | 打开失败 | 打开前校验存在性与 hash，失效则标记并提示重新定位 |
| 超大单行（无换行的整本书） | 虚拟列表退化 | 读取时按最大列宽做软换行切分 |

**开放问题**

1. 是否需要支持 TXT 之外的纯文本格式（如 `.text`、无扩展名）？
2. 阅读进度是否需要跨设备导出（导出 JSON）？
3. 是否提供「阅读打卡/年度阅读报告」类统计？
