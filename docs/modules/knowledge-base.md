# 知识库 (Knowledge Base) — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：草案
**宿主**：VSCode 插件 Zhai（宅桌面）

---

## 1. 模块概述

### 1.1 定位

把工作区的 Markdown 语料变成**可检索、可溯源、可问答**的知识库，为 AI Chat（`ai-chat.md`）提供高质量上下文，同时面向用户提供独立的检索与问答入口。

与其他模块的关系：

- 依赖 `common.md` 的文件索引与 `markdown-one.md` 的解析管线
- 为 `ai-chat.md` 的 `@` 提及提供检索能力
- 语料来自笔记与写作模块的全部 Markdown 文件

### 1.2 目标

- **本地优先、离线可用**：默认检索链路不依赖任何云端服务
- **回答可溯源**：每个答案都附带来源片段与跳转位置，杜绝幻觉无从查证
- **渐进增强**：先用零依赖的全文检索跑通，向量检索作为可选开关

### 1.3 非目标

- 不做通用搜索引擎（只检索工作区内的 Markdown）
- 不索引二进制文件（PDF/图片 OCR 作为后续议题）
- 不上传用户语料到任何外部服务（向量化默认本地完成）

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | RAG 问答 | 在知识库面板问「我关于 React 的笔记里提到了哪些 Hook？」→ 检索相关片段 → AI 基于片段回答并列出来源 |
| US-2 | 精准溯源 | 得到回答后点击引用 `[2]` → 直接跳到对应笔记的具体段落并高亮 |
| US-3 | 术语速查 | 打开术语表 → 看到「林凡」出现在 37 个章节 → 点击列出全部出现位置 |
| US-4 | 上下文复用 | 在 AI Chat 输入 `@最近5章` → 走知识库检索 → 只取最相关的片段注入，省 Token |
| US-5 | 索引维护 | 新增一批笔记后 → 命令「重建索引」→ 查看索引覆盖率与耗时 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| K1 | 结构感知分块 | 按标题层级切分，带长度上限与重叠 | P0 | 待实现 |
| K2 | 全文检索（BM25） | FTS5 trigram，支持关键词与中文子串 | P0 | 待实现 |
| K3 | 混合检索 | FTS5 + 向量（可选）RRF 融合 | P1 | 待实现 |
| K4 | 重排序 | 对候选片段精排（可选本地 reranker） | P2 | 待实现 |
| K5 | 增量索引 | 文件变更只重建受影响的分块 | P0 | 待实现 |
| K6 | 引用溯源 | 答案标注来源，点击跳转并高亮原文 | P0 | 待实现 |
| K7 | 术语表/知识卡片 | 抽取人名、地名、设定条目并统计出现次数 | P1 | 待实现 |
| K8 | 索引状态面板 | 文件数、分块数、覆盖率、上次构建时间 | P1 | 待实现 |
| K9 | 重建索引 | 全量重建，支持取消与进度显示 | P0 | 待实现 |
| K10 | 片段缓存 | 命中片段缓存，加速重复查询 | P2 | 待实现 |
| K11 | 隐私开关 | 云端 Embedding 需显式开启并二次确认 | P0 | 待实现 |
| K12 | 排除规则 | 按目录/文件排除不参与索引的内容 | P1 | 待实现 |

---

## 4. 交互与流程

### 4.1 索引构建

```
文件变更（新增/修改）
   │
   ▼
读取文件内容 → gray-matter 分离 Frontmatter
   │
   ▼
unified/remark 解析为 mdast
   │
   ▼
结构感知分块
   ├─ 以标题节点（depth ≤ 3）作为分块边界
   ├─ 单块超过 maxChunkTokens（默认 512）→ 按段落再切
   └─ 相邻块之间保留 overlapTokens（默认 64）避免语义断裂
   │
   ▼
为每个块生成：chunk_id / startLine / endLine / headingPath / 纯文本
   │
   ├─ 写入 chunks 表 + chunks_fts（FTS5）
   └─ 若开启向量检索 → 本地 Embedding → 写入向量表
   │
   ▼
删除该文件的旧块（事务内完成，保证一致）
```

### 4.2 检索与问答

```
用户查询 q
   │
   ├─ 全文检索（FTS5 BM25）  ──► Top 20
   └─ 向量检索（可选开启）    ──► Top 20
   │
   ▼ RRF 融合（reciprocal rank fusion）
候选集 Top 10
   │
   ▼ 可选重排（reranker，P2）
Top N（默认 5）
   │
   ├─ 直接展示（检索模式）：片段 + 高亮 + 跳转
   └─ 注入 AI（问答模式）：片段带来源编号 → AI 回答 → 引用标注
   │
   ▼
点击引用 → vscode.open 定位行范围并高亮
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 检索基线 | FTS5 BM25 / LIKE 扫描 / 自建倒排 | **FTS5（trigram）** | 零依赖、离线、中文子串可用，覆盖率足够作为基线 |
| 向量检索 | `sqlite-vec` / `hnswlib-node` / 内存暴力 | **sqlite-vec（可选）** | 与 SQLite 同库，无额外服务；小规模暴力检索即可 |
| Embedding | `@xenova/transformers`（本地 bge-small-zh） / 云端 API | **本地 bge-small-zh-v1.5 优先** | 离线、隐私、无费用；云端需用户显式开启 |
| 向量维度 | 384（bge-small） / 768 / 1536 | **384** | 中文小模型在 384 维表现足够，索引体积与速度平衡 |
| 融合策略 | RRF / 加权求和 | **RRF** | 无需调参，对两路分数尺度不敏感，是主流混合检索做法 |
| 重排 | `bge-reranker-base`（本地） / 不重排 | **P2 可选** | 显著提升精度但增加依赖与耗时，默认关闭 |
| 分块策略 | 固定长度 / 结构感知 | **结构感知 + 长度上限** | Markdown 标题天然是语义边界，检索命中更完整 |
| 分词（术语抽取） | `@node-rs/jieba` / 正则 | **@node-rs/jieba** | 预编译二进制，与 `common.md` 选型一致 |
| 停用与隐私 | 默认全部本地 | **默认本地** | 任何外发（Embedding/问答）均需配置项显式开启 |

> **弃用规避**：不使用 `@xenova/transformers` 中已废弃的旧 pipeline 调用方式；不使用 FTS5 之外的高版本专用语法，保证兼容性。

---

## 6. 数据模型

存于 `globalStorage/kb.db`。

```sql
-- 分块
CREATE TABLE IF NOT EXISTS chunks (
    id          TEXT PRIMARY KEY,        -- UUID
    file_path   TEXT NOT NULL,           -- 相对工作区路径
    heading     TEXT,                    -- 所属标题路径，如 "卷一 > 第一章"
    start_line  INTEGER NOT NULL,
    end_line    INTEGER NOT NULL,
    char_count  INTEGER NOT NULL DEFAULT 0,
    content     TEXT NOT NULL,           -- 块纯文本（用于展示与 AI 注入）
    model       TEXT,                    -- 生成向量的模型名（未启用向量时为 NULL）
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);

-- 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    content,
    tokenize = 'trigram'
);

-- 向量表（启用向量检索时创建，依赖 sqlite-vec）
-- CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
--     chunk_id TEXT PRIMARY KEY,
--     embedding FLOAT[384]
-- );

-- 术语表（知识卡片）
CREATE TABLE IF NOT EXISTS glossary (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    term       TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL,            -- character|place|setting|other
    file_path  TEXT,                     -- 若为角色，指向角色卡文件
    aliases    TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);

-- 术语出现位置
CREATE TABLE IF NOT EXISTS glossary_mentions (
    term_id     INTEGER NOT NULL REFERENCES glossary(id) ON DELETE CASCADE,
    file_path   TEXT NOT NULL,
    line        INTEGER NOT NULL,
    context     TEXT NOT NULL            -- 上下文片段（≤80 字）
);

CREATE INDEX IF NOT EXISTS idx_mentions_term ON glossary_mentions(term_id);
CREATE INDEX IF NOT EXISTS idx_mentions_file ON glossary_mentions(file_path);

-- 索引元数据
CREATE TABLE IF NOT EXISTS kb_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- kb_meta 记录：schema_version / embedding_model / last_build_at / vector_enabled
```

**配置**

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `zhai.kb.chunkMaxTokens` | number | `512` | 单块最大 token |
| `zhai.kb.chunkOverlapTokens` | number | `64` | 相邻块重叠 token |
| `zhai.kb.topK` | number | `5` | 注入 AI 的片段数 |
| `zhai.kb.vectorEnabled` | boolean | `false` | 是否启用向量检索 |
| `zhai.kb.embeddingProvider` | string | `local` | `local` / `cloud` |
| `zhai.kb.exclude` | string[] | `[]` | 不参与索引的 glob |

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `zhai.kb.rebuild` | 重建知识库索引 | 全量重建，显示进度 |
| `zhai.kb.search` | 检索知识库 | 打开检索面板 |
| `zhai.kb.ask` | 基于知识库提问 | 打开问答面板 |
| `zhai.kb.status` | 索引状态 | 展示覆盖率与构建信息 |
| `zhai.kb.glossary` | 术语表 | 术语列表与出现位置 |

**Webview 方法**：`kb/search`、`kb/ask`（流式）、`kb/rebuild`（流式进度）、`kb/status`、`glossary/list`、`glossary/mentions`

```typescript
/** 检索结果 */
interface KbHit {
    chunkId: string
    filePath: string
    heading: string
    startLine: number
    endLine: number
    score: number
    snippet: string          // 高亮后的片段（含 <mark>）
}

/** 问答请求 */
interface KbAskRequest {
    method: 'kb/ask'
    payload: {
        question: string
        scope?: { dirs?: string[]; tags?: string[] }
        topK?: number
        conversationId?: string
    }
}

/** 问答响应（流式结束后） */
interface KbAskResult {
    answer: string
    citations: Array<{ index: number; filePath: string; startLine: number; endLine: number; snippet: string }>
    usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}
```

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 检索延迟 | 1 万块规模下 P95 < 300ms |
| AC-2 | 检索质量 | 人工评测集（30 问）Top-5 命中率 ≥ 80% |
| AC-3 | 增量索引 | 单文件变更后增量更新 < 1s |
| AC-4 | 全量重建 | 1000 文件（约 1 万块）< 60s（不含向量） |
| AC-5 | 溯源准确 | 点击引用跳转到的行范围与片段一致，误差 ≤ 1 行 |
| AC-6 | 离线可用 | 关闭网络后，全文检索与本地问答链路完整可用 |
| AC-7 | 隐私默认 | 未显式开启时，无任何外发请求（网络监控验证） |
| AC-8 | 向量开关 | 关闭向量检索时功能不受影响，仅召回方式降级 |
| AC-9 | 术语表 | 角色名检出率 ≥ 85%（人工标注样本 100 条） |
| AC-10 | 索引一致 | 删除文件后对应分块被清除，无孤儿数据 |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 本地 Embedding 首次加载慢（模型下载） | 首次体验差 | 按需下载 + 明确进度提示；默认关闭向量检索，全文链路零等待 |
| 索引体积膨胀 | 磁盘占用 | 只存块文本不存全文副本受限；提供「仅索引指定目录」与清理命令 |
| 中文切分质量 | 召回不佳 | 结构感知分块 + trigram 子串匹配兜底 |
| 检索结果相关度不足 | 答非所问 | RRF 融合 + P2 重排 + 用户可调整 topK 与范围过滤 |
| 大文件（5 万字章节）分块过多 | 索引缓慢 | 单文件分块上限 + 抽样校验 |
| 术语抽取误报 | 术语表噪音 | 结合 Frontmatter `characters` 与设定库校准，支持手动增删 |

**开放问题**

1. 是否需要支持 PDF/图片 OCR 内容纳入知识库？
2. 问答是否需要保留历史并支持追问（多轮 RAG）？
3. 是否需要提供「检索评测」工具，让用户用自有语料评估召回率？
