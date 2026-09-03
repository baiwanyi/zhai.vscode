# AI Chat — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：草案
**宿主**：VSCode 插件 BaiwanyiONE

---

## 1. 模块概述

### 1.1 定位

AI Chat 是插件的**智能交互中枢**，同时服务于两类需求：

- **写作模式**：以指令直接改写/生成编辑区内容，结果以 diff 呈现，用户逐段接受
- **对话模式**：在侧边栏多轮问答，结果与文件解耦，可随时转为写作动作

两类模式共享同一套上下文检索（`@` 提及）、模型参数与用量统计。

### 1.2 目标

- **省 Token 不丢前文**：先经 SQLite 索引定位相关章节，再按需读取原文，避免全量灌入
- **可控可撤销**：任何 AI 写入都必须经过用户确认，且能一步 `Ctrl+Z` 回退
- **随时可中断**：流式输出过程中可取消，请求立即释放

### 1.3 非目标

- 不做多模型网关/路由（只接 DeepSeek 及 OpenAI 兼容端点）
- 不让 AI 自主执行文件写操作（除用户在 diff 视图显式接受外）
- 不提供联网搜索 Agent（仅使用用户 `@` 显式提供的上下文）

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 行文续写 | 光标停在段落末尾 → `Alt+Enter` → AI 基于前文 3000 字续写 → 淡蓝斜体流式呈现 → 接受/重试 |
| US-2 | 定向改稿 | 选中三段 → 输入「改得更紧张些」→ 侧栏生成 diff → 逐段接受两段、拒绝一段 |
| US-3 | 前文问答 | 写第 50 章时问「林凡的佩剑叫什么」→ `@最近5章` + `@角色:林凡` → AI 依据索引定位的原文回答并给出出处 |
| US-4 | 人设一致性 | 让 AI 写对话 → 勾选「注入设定」→ 自动带上角色卡与世界观条目 |
| US-5 | 中断与止损 | 生成偏离预期 → `Esc` 取消 → 请求立即中止，不产生后续 Token 消耗 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| A1 | 模式切换 | 写作 / 对话双模式，独立面板布局 | P0 | 待实现 |
| A2 | 写作模式指令 | 输入自然语言指令，直接作用于编辑区内容 | P0 | 待实现 |
| A3 | diff 预览与逐段接受 | 按 hunk 接受/拒绝/重新生成，接受后写入文件 | P0 | 待实现 |
| A4 | 内联续写 | `Alt+Enter` 从光标处续写，流式占位显示 | P0 | 待实现 |
| A5 | 选中文本快捷操作 | 润色 / 扩写 / 缩写 / 翻译 / 自定义 | P1 | 待实现 |
| A6 | 对话模式 | 侧边栏多轮问答，历史持久化 | P0 | 待实现 |
| A7 | 会话管理 | 新建 / 重命名 / 删除 / 关联到具体文件 | P0 | 待实现 |
| A8 | 消息历史 | 完整保存 user/assistant 消息与状态 | P0 | 待实现 |
| A9 | SSE 流式输出 | 逐字渲染，首字 < 500ms | P0 | 待实现 |
| A10 | 思考链展示 | 展示 DeepSeek `reasoning_content`，可折叠 | P1 | 待实现 |
| A11 | 请求取消 | `AbortController` + `CancellationToken` | P0 | 待实现 |
| A12 | `@` 上下文提及 | `@当前文件` `@选中` `@笔记` `@最近N章` `@角色名` `@图库图片` `@链接` | P0 | 待实现 |
| A13 | 上下文参数面板 | 前文 500–4000 token、温度 0.1–1.5、maxTokens、模型、设定注入 | P1 | 待实现 |
| A14 | 用量统计 | 记录 prompt/completion/total tokens 与预估费用，按日/月聚合 | P1 | 待实现 |
| A15 | 提示词预设 | 音色预设（小说家/诗人/论文）+ 常用指令收藏 | P2 | 待实现 |
| A16 | 重试与超时 | 指数退避重试（上限 3 次），30s 无首字自动中断 | P1 | 待实现 |
| A17 | 预算护栏 | 达到 `dailyTokenBudget` 时提示并阻断 | P1 | 待实现 |

---

## 4. 交互与流程

### 4.1 写作模式时序

```
用户（编辑器选中/指令）
   │
   ▼
Webview 收集：指令 + 选中范围 + @上下文引用 + 参数
   │  postMessage request: 'ai/compose'
   ▼
Extension Host
   ├─ 解析 @ 引用 → 查 SQLite 索引 → 读对应 .md 片段
   ├─ 组装 messages（system + 设定注入 + 前文 + 指令）
   ├─ token 估算与截断（超预算则压缩或摘要）
   └─ 发起 SSE 请求（AbortController + 30s 首字超时）
   │
   ▼  流式回传 stream{reqId, delta}
Webview 逐段渲染（淡蓝斜体占位）
   │
   ▼  stream.done
生成 diff（jsdiff）→ 逐段卡片：[接受][拒绝][重试]
   │
   ▼ 用户接受
WorkspaceEdit 应用改动（进入 VSCode Undo 栈，Ctrl+Z 可回退）
   │
   ▼
写 ai_usage_logs，刷新状态栏 Token
```

### 4.2 对话模式状态机

```
        ┌──────────┐
        │   idle   │
        └────┬─────┘
             │ 发送消息
             ▼
        ┌──────────┐  命中缓存/无需上下文
        │preparing │──────────────┐
        └────┬─────┘              │
             │ 上下文检索完成       │
             ▼                    │
        ┌──────────┐              │
        │streaming │◄─────────────┘
        └────┬─────┘
     ┌───────┼───────┬──────────┐
     ▼       ▼       ▼          ▼
 completed failed cancelled  timeout
     │                          │
     └──────────┬───────────────┘
                ▼
        ┌──────────┐
        │reviewing │  (仅写作模式：diff 审阅)
        └────┬─────┘
             ▼
        applied / discarded
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| SDK | `openai` SDK（配置 DeepSeek `baseURL`） / 原生 `fetch` 手写 SSE | **openai SDK** | 成熟处理流式分帧、重试与错误类型；DeepSeek 兼容 OpenAI 协议 |
| 流式取消 | `AbortController` / 仅前端忽略 | **AbortController** | 真正中断连接，避免继续计费 |
| 文件写入 | `WorkspaceEdit` / `fs.writeFile` | **WorkspaceEdit** | 写入进入 VSCode Undo 栈，用户 `Ctrl+Z` 可回退，且能处理并发编辑 |
| diff 呈现 | Webview 内联 diff / `vscode.diff` 原生对比 | **两者结合** | 常规改稿用内联逐段接受；大范围改写提供「在对比编辑器中查看」 |
| diff 算法 | `diff`（jsdiff）/ 自研 LCS | **diff** | 支持行级与词级，体积小，维护活跃 |
| Token 估算 | `tiktoken`（wasm）/ 字符数 ÷ 1.6 粗估 | **tiktoken** | 精度高，可提前拦截超窗；wasm 版本无原生编译依赖 |
| 上下文检索 | SQLite 索引 / 全量读取 / 向量检索 | **SQLite 索引优先** | 见 `knowledge-base.md`；向量检索为可选增强 |
| UI 状态管理 | `useReducer` / `useEffect + useState` | **useReducer** | 流式消息是多步状态机，reducer 更可控且避免竞态 |
| 数据缓存 | TanStack Query / 自建 | **自建轻量缓存** | AI 流式不适合 Query；仅会话列表等普通数据用 Query |

> **弃用规避**：不使用 SDK 中已废弃的 `Configuration` 构造方式（改用 `new OpenAI({ apiKey, baseURL })`）；不使用 `AbortSignal.timeout` 之外的定时器自杀式取消。

---

## 6. 数据模型

会话与用量数据存于 `globalStorage/ai.db`（与内容索引库分离，避免频繁写入影响索引）。

```sql
CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,     -- UUID
    title       TEXT NOT NULL,
    mode        TEXT NOT NULL,        -- 'write' | 'chat'
    file_path   TEXT,                 -- 关联的笔记/章节（可为 NULL）
    model       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_file ON conversations(file_path);

CREATE TABLE IF NOT EXISTS messages (
    id             TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role           TEXT NOT NULL,     -- 'user' | 'assistant' | 'system'
    content        TEXT NOT NULL,
    reasoning      TEXT,              -- DeepSeek 思维链
    status         TEXT NOT NULL,     -- pending|streaming|completed|failed|cancelled
    finish_reason  TEXT,
    refs           TEXT NOT NULL DEFAULT '[]',  -- @ 引用列表（JSON）
    error          TEXT,
    created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id                TEXT PRIMARY KEY,
    conversation_id   TEXT,
    project           TEXT NOT NULL,   -- 'ai-chat' | 'ai-polish' | 'ai-title'
    model             TEXT NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    estimated_cost    REAL    NOT NULL DEFAULT 0,
    latency_ms        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_date ON ai_usage_logs(created_at);
```

**敏感字段说明**：日志表只存模型与用量，**不存提示词正文**；消息正文随会话存储，用户删除会话时级联清除。

---

## 7. 接口与命令

### 7.1 命令清单

| Command ID | 标题 | 快捷键建议 |
|------------|------|-----------|
| `baiwanyione.ai.openChat` | 打开 AI 对话 | `Ctrl+Shift+L` |
| `baiwanyione.ai.inlineContinue` | 内联续写 | `Alt+Enter`（编辑器内） |
| `baiwanyione.ai.polish` | 润色选中文本 | `Ctrl+Shift+P` 后搜索 |
| `baiwanyione.ai.newSession` | 新建会话 | — |
| `baiwanyione.ai.cancel` | 取消当前生成 | `Esc`（面板聚焦时） |
| `baiwanyione.ai.usage` | 查看用量统计 | — |

### 7.2 Webview 消息协议

```typescript
/** 发起生成 */
interface ComposeRequest {
    method: 'ai/compose'
    payload: {
        conversationId?: string
        mode: 'write' | 'chat'
        instruction: string
        refs: ContextRef[]            // @ 引用
        selection?: { uri: string; startLine: number; endLine: number }
        params: {
            model: string
            temperature: number
            maxTokens: number
            contextTokens: number
            injectSettings: boolean
        }
    }
}

/** @ 上下文引用 */
interface ContextRef {
    kind: 'file' | 'selection' | 'note' | 'recentChapters' | 'character' | 'image' | 'link'
    value: string                     // 路径 / 标题 / 角色名 / URL
    label: string                     // UI 展示用
}

/** 流式事件 */
interface AiStreamEvent {
    type: 'stream'
    reqId: string
    channel: 'delta' | 'reasoning' | 'done' | 'error'
    text: string
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

/** 应用改动（写作模式） */
interface ApplyPatchRequest {
    method: 'ai/applyPatch'
    payload: {
        uri: string
        hunks: Array<{ id: string; startLine: number; endLine: number; newText: string }>
    }
}

/** 取消 */
interface AbortRequest {
    method: 'ai/abort'
    payload: { reqId: string }
}
```

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 流式首字延迟 | < 500ms（P95） |
| AC-2 | 取消生效 | 点击取消后 < 100ms 停止渲染，连接关闭，无后续计费 |
| AC-3 | 改动可撤销 | 接受 diff 后 `Ctrl+Z` 能完整回退到改动前 |
| AC-4 | 上下文截断 | 前文超 `maxContextTokens` 时自动压缩，不报错 |
| AC-5 | Token 统计误差 | 与服务端返回值偏差 < 5% |
| AC-6 | 无 Key 引导 | 未配置 API Key 时弹出引导配置，不抛异常栈 |
| AC-7 | 超时保护 | 30s 无首字自动中断并提示；重试上限 3 次，间隔指数退避 |
| AC-8 | 预算护栏 | 达预算上限时阻断并给出当日用量摘要 |
| AC-9 | 会话持久化 | 重启窗口后会话与消息完整恢复 |
| AC-10 | 密钥安全 | API Key 仅存 `SecretStorage`，日志与诊断包中脱敏 |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 长章节上下文超窗 | 请求失败或成本高 | tiktoken 预估 + 分层压缩（保留最近 N 章原文、更早章节用摘要） |
| 费用失控 | 账单超预期 | 每日预算上限 + 单次最大生成长度 + 用量面板 |
| 模型返回不稳定（503/限流） | 体验中断 | 指数退避 + 抖动重试，上限 3 次；失败保留草稿便于重试 |
| 并发编辑冲突 | 覆盖用户手动修改 | 应用前校验文件 `mtime`/版本号，冲突时提示重新生成 |
| 思维链过长 | 面板刷屏 | 默认折叠，可展开；不计入正文 |
| 引用内容过期 | 回答基于旧文 | `@` 引用在发送时实时读取磁盘原文，不使用缓存副本 |

**开放问题**

1. 是否需要支持自定义 OpenAI 兼容端点（自部署模型）？
2. 会话是否需要导出为 Markdown 归档到工作区？
3. 是否提供「AI 改动留痕」（在文件中以注释形式记录 AI 生成段落）？
