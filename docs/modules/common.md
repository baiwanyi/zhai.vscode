# 通用 (Common) — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：草案
**宿主**：VSCode 插件 BaiwanyiONE

---

## 1. 模块概述

### 1.1 定位

通用模块是其余 8 个模块的**底座**，负责统一的存储架构、索引同步、检索、配置、密钥、交互承载与安全基线。它不面向具体业务，但决定了整个插件的性能上限与数据安全性。

### 1.2 目标

- **Markdown 是唯一真相源**：正文永远存在于工作区文件中，插件只是读取者与索引者
- **SQLite 只是影子**：仅存元数据，随时可删库重建，用户无感知
- **零干扰**：不劫持 VSCode 原生编辑体验（保存、Git diff、多光标、拼写检查全部保留）

### 1.3 非目标

- 不做云端账号体系与多端同步（同步交给用户自己的 Git / OneDrive）
- 不做多人协作与权限管理
- 不替代 Git 做版本管理（版本能力见 `notes.md` / `writing.md` 的本地快照）

### 1.4 与其他模块的关系

```
                    ┌──────────────────────────────┐
                    │        通用 (Common)          │
                    │  存储架构 · 索引 · 检索        │
                    │  配置 · 密钥 · 消息协议        │
                    └──────────────┬───────────────┘
       ┌───────────────┬───────────┼───────────┬───────────────┐
       ▼               ▼           ▼           ▼               ▼
   Markdown ONE     笔记        写作        阅读            知识库
   (解析/导出)     (组织/链接)  (创作/设定)  (TXT 阅读)      (RAG 检索)
       └───────────────┴───────────┼───────────┴───────────────┘
                                   ▼
                    AI Chat（消费检索结果作为上下文）
                    同步微博 / 同步公众号（消费正文做发布）
```

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 写作即索引 | 用 VSCode 写 `.md` → 按 `Ctrl+S` → 侧边栏字数/标签立即刷新（无需手动触发） |
| US-2 | 换机恢复 | 新电脑 `git clone` 工作区 → 用 VSCode 打开 → 插件检测索引缺失 → 自动全量重建 → 搜索立即可用 |
| US-3 | 全局检索 | `Ctrl+K` 输入「林凡」→ 200ms 内返回章节/笔记/书籍分组结果 → 回车跳转到具体行 |
| US-4 | 密钥安全 | 首次配置 API Key → 存入 SecretStorage → 全局明文搜索仓库，无任何明文残留 |
| US-5 | 故障自修 | 手动删除索引库 → 重启窗口 → 插件自检发现数据不一致 → 后台静默重建并提示 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| C1 | Markdown 主存储 | 正文/设定/大纲全部存于工作区 `.md` 文件，Git 友好 | P0 | 待实现 |
| C2 | 元数据索引 | 索引库仅存路径、标题、字数、标签、角色、摘要、mtime | P0 | 待实现 |
| C3 | 增量监听 | `FileSystemWatcher` 监听增/改/删，防抖 500ms 后 upsert | P0 | 待实现 |
| C4 | 全量重建 | 命令 + 激活自愈：文件数与记录数不一致时自动补齐 | P0 | 待实现 |
| C5 | 索引队列 | 批量变更（Git Pull）走队列 + 事务批处理，避免卡顿 | P0 | 待实现 |
| C6 | FTS5 全文检索 | 中文可用的全文索引，支持关键词高亮 | P0 | 待实现 |
| C7 | 全局搜索 `Ctrl+K` | 跨笔记/章节/书籍一次检索，分组展示 + 跳转 | P0 | 待实现 |
| C8 | 配置中心 | `contributes.configuration`，支持全局/工作区两级 | P0 | 待实现 |
| C9 | 密钥管理 | API Key / OAuth Token 存 `SecretStorage`，前端脱敏 | P0 | 待实现 |
| C10 | 命令与菜单 | 命令面板 + 资源管理器右键菜单 + 编辑器右键菜单 | P0 | 待实现 |
| C11 | 状态栏 | 索引状态、当前模型、今日 Token、保存状态 | P1 | 待实现 |
| C12 | Webview 消息协议 | `reqId` 请求-响应 + 流式增量事件 | P0 | 待实现 |
| C13 | 日志与诊断 | `OutputChannel` 分级日志 + 一键导出诊断包 | P1 | 待实现 |
| C14 | 限流与重试 | AI 请求与目录扫描分级限流、指数退避重试 | P1 | 待实现 |
| C15 | 备份与回收站 | 删除进回收站（默认保留 30 天），配置可导出 | P2 | 待实现 |
| C16 | 遥测开关 | 默认关闭，需用户显式开启 | P2 | 待实现 |

---

## 4. 交互与流程

### 4.1 增量索引流水线

```
用户 Ctrl+S 保存 .md
      │
      ▼
FileSystemWatcher.onDidChange(uri)
      │
      ▼
┌─────────────┐   去重/合并    ┌─────────────┐
│  入队 (Set)  │ ─────────────► │ 防抖 500ms  │
└─────────────┘                └──────┬──────┘
                                      │ 批量出队
                                      ▼
                         ┌────────────────────────┐
                         │  解析 Frontmatter/标题  │
                         │  统计字数/标签/角色提及 │
                         └───────────┬────────────┘
                                     │ mtime 比对（未变则跳过）
                                     ▼
                         ┌────────────────────────┐
                         │  事务内批量 upsert      │
                         │  files + tags + fts    │
                         └───────────┬────────────┘
                                     ▼
                          postMessage 通知 Webview 刷新
```

### 4.2 插件激活与自愈流程

```
activate()
  → 读取配置（configuration + workspaceState）
  → 打开/创建 index.db（globalStorage/index.db）
  → 校验 schema_version，按需执行迁移
  → 自检：统计工作区 .md 文件数  vs  files 表记录数
       ├─ 一致  → 进入就绪状态
       └─ 不一致 → 后台静默全量重建（进度显示于状态栏）
  → 注册 Webview 视图、命令、状态栏、监听器
  → 注册 dispose 到 context.subscriptions
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 文件监听 | `workspace.createFileSystemWatcher` / chokidar | **FileSystemWatcher** | 宿主原生、零额外依赖；需配置 `.gitignore` 与 `node_modules` 排除 |
| SQLite 驱动 | `better-sqlite3` / `node-sqlite3` / `sql.js` | **better-sqlite3** | 同步 API 性能最佳，插件内索引写入是短事务；提供 wasm 回退应对 ABI 不匹配 |
| ORM | Drizzle / Kysely / 裸 SQL | **Drizzle + 手写迁移** | 类型安全且贴近 SQL，FTS5 虚表与触发器仍需手写 DDL |
| 全文检索 | FTS5 `unicode61` / FTS5 `trigram` / 自建倒排 | **FTS5 trigram** | `unicode61` 对中文整词无效；trigram 支持中文子串与 `LIKE` 加速，零外部依赖 |
| 中文分词 | `nodejieba` / `@node-rs/jieba` / `jieba-wasm` | **@node-rs/jieba** | 预编译二进制，无需本地编译链；用于术语抽取而非检索主路径 |
| 配置存储 | `contributes.configuration` / 自建 yaml | **contributes.configuration** | 用户可在 VSCode 设置 UI 中直接修改，体验一致 |
| 密钥存储 | `SecretStorage` / 配置文件 / 环境变量 | **SecretStorage** | 系统级加密（Keychain/DPAPI/Credential Store），插件唯一正解 |
| 通信协议 | `postMessage` 裸事件 / 请求-响应 | **postMessage + reqId** | 有 reqId 才能做并发请求匹配、超时与错误定位 |
| 并发保护 | 互斥锁 / 文件锁 / 无保护 | **进程内互斥 + 单写连接** | 多窗口同工作区场景下避免索引写冲突 |

> **弃用规避**：不使用已废弃的 `vscode.workspace.rootPath`、不依赖 `fs.existsSync` 做前置校验（改用 `fs.promises.stat` + try/catch），不使用 `node-sqlite3` 的回调式 API。

---

## 6. 数据模型

索引库位置：`context.globalStorageUri/index.db`（不参与 Git 同步，不写入工作区）。

```sql
-- 元数据主表：只存元数据，绝不存正文全文
CREATE TABLE IF NOT EXISTS files (
    path        TEXT PRIMARY KEY,   -- 工作区内相对路径（跨设备稳定）
    title       TEXT NOT NULL,      -- 首行 # 标题 或 Frontmatter title
    word_count  INTEGER NOT NULL DEFAULT 0,
    tags        TEXT    NOT NULL DEFAULT '[]',  -- JSON 数组
    characters  TEXT    NOT NULL DEFAULT '[]',  -- 抽取的角色/术语（JSON 数组）
    summary     TEXT,               -- AI 摘要（预留，见 knowledge-base.md）
    hash        TEXT,               -- 内容 hash，用于跳过无实质变更的重写
    mtime       TEXT NOT NULL,      -- 文件最后修改时间 ISO 字符串
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime DESC);
CREATE INDEX IF NOT EXISTS idx_files_updated ON files(updated_at DESC);

-- 全文索引（trigram 分词器，支持中文子串匹配）
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    path UNINDEXED,
    title,
    tags,
    summary,
    tokenize = 'trigram'
);

-- 与主表同步的触发器
CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(path, title, tags, summary)
    VALUES (new.path, new.title, new.tags, COALESCE(new.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    DELETE FROM files_fts WHERE path = old.path;
END;

CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
    UPDATE files_fts
       SET title = new.title, tags = new.tags, summary = COALESCE(new.summary, '')
     WHERE path = new.path;
END;

-- 索引元数据
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- meta 记录：schema_version / built_at / file_count / source_version
```

**性能 PRAGMA**（启动时执行一次）：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -16000;
PRAGMA foreign_keys = ON;
```

---

## 7. 接口与命令

### 7.1 命令清单

| Command ID | 标题 | 说明 |
|------------|------|------|
| `baiwanyione.rebuildIndex` | 重建索引 | 全量扫描工作区并重建索引库 |
| `baiwanyione.openSearch` | 全局搜索 | 打开跨模块搜索面板（默认 `Ctrl+K`） |
| `baiwanyione.showIndexStatus` | 索引状态 | 显示文件数、索引数、上次构建时间 |
| `baiwanyione.clearIndex` | 清空索引缓存 | 删除 index.db（安全，可重建） |
| `baiwanyione.exportDiagnostics` | 导出诊断信息 | 脱敏后导出配置与日志，便于排查 |
| `baiwanyione.openSettings` | 打开插件设置 | 跳转到 `baiwanyione.*` 配置分组 |

### 7.2 配置项

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `baiwanyione.index.exclude` | string[] | `["**/node_modules/**", "**/.git/**"]` | 索引排除的 glob |
| `baiwanyione.index.debounceMs` | number | `500` | 增量索引防抖毫秒数 |
| `baiwanyione.index.rebuildOnActivate` | boolean | `true` | 激活时自检并按需重建 |
| `baiwanyione.search.limit` | number | `50` | 全局搜索单模块返回上限 |
| `baiwanyione.ai.model` | string | `deepseek-chat` | 默认模型 |
| `baiwanyione.ai.temperature` | number | `0.7` | 默认温度 |
| `baiwanyione.ai.maxContextTokens` | number | `4000` | 前文注入上限 |
| `baiwanyione.ai.dailyTokenBudget` | number | `500000` | 每日 Token 预算，超限提示 |
| `baiwanyione.telemetry.enabled` | boolean | `false` | 遥测开关，默认关闭 |

### 7.3 Webview 消息协议

```typescript
/** Webview → 宿主：请求 */
interface RequestMessage {
    type: 'request'
    reqId: string
    method: string                       // 如 'search/query'、'index/rebuild'
    payload?: unknown
}

/** 宿主 → Webview：响应 */
interface ResponseMessage {
    type: 'response'
    reqId: string
    ok: boolean
    payload?: unknown
    error?: { code: string; message: string }
}

/** 宿主 → Webview：流式增量（AI 输出、索引进度、脚本进度） */
interface StreamMessage {
    type: 'stream'
    reqId: string
    delta: string
    done: boolean
}

/** 宿主 → Webview：状态广播（索引就绪、配置变更、窗口聚焦） */
interface StateMessage {
    type: 'state'
    channel: 'index' | 'config' | 'ai'
    payload: unknown
}
```

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 单文件保存后索引更新 | < 500ms 内可见最新字数与标签 |
| AC-2 | 全量重建（1000 个 .md） | < 10s |
| AC-3 | 全量重建（100 章 / 50MB 小说） | < 3s |
| AC-4 | 全局搜索响应 | < 200ms（1 万文件规模） |
| AC-5 | 中文检索可用 | 「林凡」等中文子串可被命中 |
| AC-6 | 索引库不存正文 | 检查 index.db 中无正文段落（抽查 10 条） |
| AC-7 | 删库自愈 | 删除 index.db 后重启，数据自动恢复且与原文件一致 |
| AC-8 | 密钥无明文 | 全局搜索工作区与全局存储，无 API Key 明文 |
| AC-9 | 大仓库不卡顿 | 5 万文件工作区下，批量索引期间 UI 无冻结（分片让出事件循环） |
| AC-10 | 资源释放 | 插件停用后所有 watcher / db 连接 / timer 全部 dispose |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `better-sqlite3` 与 Electron Node ABI 不匹配 | 插件无法激活 | 锁定匹配的 VSCode Engine 版本；提供 wasm 回退与清晰报错 |
| 超大型仓库（>10 万文件）监听开销 | 内存与 CPU 上涨 | 默认排除规则 + 文件数上限（超出提示改为手动索引） |
| 中文分词召回不足 | 搜索体验差 | trigram 保证子串召回；术语表补充专有名词（角色名/地名） |
| 多窗口打开同一工作区 | 索引并发写冲突 | 进程内互斥锁 + 单写连接，次要窗口只读 |
| 用户误把索引库提交到 Git | 仓库污染 | 索引库存于 `globalStorage`（工作区外），物理隔离 |
| 索引与文件长期漂移 | 搜索结果过期 | 启动自检 + 每周一次静默校验（hash 抽样） |

**开放问题**

1. 是否需要支持「多工作区（Multi-root Workspace）」下每个根目录独立索引？
2. 索引库是否需要提供导入/导出，便于用户换机时免重建？
3. 是否允许用户对单个目录关闭索引（如归档目录）？
