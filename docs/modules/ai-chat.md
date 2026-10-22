# AI Chat — 模块设计文档

**版本**：1.4
**日期**：2026-10-22
**状态**：对话模式、编辑器右键上下文（10.1）、会话历史（10.2）与写作模式写回（10.3）已落地；diff 逐段接受待实现；第 5 节已按双 provider（DeepSeek 直连 + CodeBuddy Agent SDK）更新，代码改造待实施
**宿主**：VSCode 插件 Zhai（宅桌面）

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

- 不做通用多模型网关：只维护 DeepSeek 直连与 CodeBuddy 两条通道，不提供任意厂商插拔
- 不让 AI 直接写文件：CodeBuddy 通道禁用写类工具，内容写回仍走 `WorkspaceEdit` 并由用户确认
- 不默认开启联网搜索：CodeBuddy 通道默认只放行只读文件工具，联网类工具需用户显式开启

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
| A1 | 模式切换 | 写作 / 对话双模式，底部按钮切换并随会话持久化 | P0 | 已落地（见 10.3） |
| A2 | 写作模式指令 | 输入自然语言指令，直接作用于编辑区选中内容或整篇 | P0 | 已落地（整段替换，见 10.3） |
| A3 | diff 预览与逐段接受 | 按 hunk 接受/拒绝/重新生成，接受后写入文件 | P0 | 待实现（当前为整段替换 + Ctrl+Z） |
| A4 | 内联续写 | `Alt+Enter` 从光标处续写，流式占位显示 | P0 | 待实现 |
| A5 | 选中文本快捷操作 | 改写 / 润色 / 校对 / 去 AI 味 | P1 | 已落地（命令菜单，见 10.3） |
| A6 | 对话模式 | 侧边栏多轮问答，历史持久化 | P0 | 已落地 |
| A7 | 会话管理 | 新建 / 重命名 / 删除 / 关联到具体文件 | P0 | 部分（新建、切换、删除与自动命名已落地，见 10.2） |
| A8 | 消息历史 | 完整保存 user/assistant 消息与状态 | P0 | 已落地 |
| A9 | SSE 流式输出 | 逐字渲染，首字 < 500ms | P0 | 已落地 |
| A10 | 思考链展示 | 展示 DeepSeek `reasoning_content`，可折叠 | P1 | 部分（已回传并落库，折叠 UI 待做） |
| A11 | 请求取消 | `AbortController` + `CancellationToken` | P0 | 已落地 |
| A12 | `@` 上下文提及 | `@当前文件` `@选中` `@笔记` `@最近N章` `@角色名` `@图库图片` `@链接` | P0 | 部分（编辑器右键「添加到宅对话」已落地，见 10.1） |
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

### 5.1 模型接入（双 provider）

面板对话、编辑器命令、取名与外貌生成共用同一套接入层：`AiProvider` 接口 + 两个实现（`deepseek` / `codebuddy`）。业务层只依赖接口，不认具体厂商，切换通道只替换实现。

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 接入方式 | 直连 REST chat 接口 / CodeBuddy Agent SDK / 自行 spawn CLI | **CodeBuddy Agent SDK**（`@tencent-ai/agent-sdk`） | SDK 是 CLI 的官方编程封装，已处理子进程生命周期、消息流分帧、权限回调与中断；自行 spawn 等于重做一遍协议且要跟版本 |
| 分层 | 各模块直连 / provider 抽象 | **provider 抽象** | 会话服务、取名、外貌三处调用点统一改为注入 provider，避免每接一个通道改三处 |
| 默认通道 | 仅 DeepSeek / 仅 CodeBuddy | **CodeBuddy 优先，DeepSeek 保留** | 面板与一次性生成走 CodeBuddy 订阅额度与 Agent 能力；无 CLI 或未登录环境回落 DeepSeek |
| 降级策略 | 静默降级 / 显式提示 | **显式提示** | 两侧计费来源不同，静默切换会让用户无法判断消耗归属；自动降级须由设置项显式开启 |
| 会话归属 | 跨通道共用 / 会话锁定通道 | **会话锁定** | CodeBuddy 用会话 `resume` 续接，DeepSeek 用本地拼历史，中途混用会重复或丢失上下文 |
| 中断 | `AbortController` / SDK `interrupt()` | **按通道区分** | DeepSeek 断开 HTTP 连接；CodeBuddy 调 SDK 中断接口，并在生成器收尾处兜底 |
| 鉴权 | 写入 `process.env` / 经 `options.env` 注入 | **SecretsService → `options.env`** | 不污染宿主环境变量，避免凭证泄漏给同进程的其它扩展 |
| 权限 | `bypassPermissions` / `canUseTool` 回调 | **canUseTool** | 通道具备读写工作区能力，写类工具必须经用户确认 |
| 首字超时 | 全局统一 / 按通道配置 | **按通道配置** | 子进程启动与鉴权比直连慢，CodeBuddy 通道首字上限放宽到 60s |
| 版本约束 | 浮动版本 / 精确锁定 | **精确锁定** | SDK 处于 Preview 阶段；CLI 随 SDK 一并分发，版本天然一致，锁定 SDK 即可 |

### 5.2 CLI 分发与登录

`@tencent-ai/agent-sdk` 的发布内容含 `cli/` 目录，其 `resolveCLIPath()` 优先取包内 `cli/bin/codebuddy`（其次 `CODEBUDDY_CODE_PATH`、monorepo 开发路径）。**安装 SDK 即自带 CLI，用户无需单独安装**；实测 `query()` 在 4.2 秒内拉起 CLI 并返回 `system.init`。

| 事实 | 数据 |
|------|------|
| SDK 包 | 解包约 171 MB（含 `cli/`、`lib/`）/ 3454 个文件，tarball 约 55 MB |
| 独立 CLI 包 | `@tencent-ai/codebuddy-code`（约 200 MB）仍可单独装，本插件不使用 |
| 用户前置 | 仅需一次登录；未登录时 `query()` 抛 `Authentication required` |

| 方案 | 做法 | 结论 |
|------|------|------|
| 随插件分发 SDK（含 CLI） | SDK 进 `dependencies`，esbuild 保持 external，vsix 携带 `node_modules` | **采用**：装完插件只需登录；发布脚本须去掉 `--no-dependencies` 并控制包体 |
| 要求全局安装 CLI | 检测 PATH，缺失时引导安装 | **不采用**：SDK 已自带，额外要求只增加失败点 |
| 运行时安装 | 首启用 `npm install` 装到 `globalStorage` | **不采用**：静默联网装包，企业环境不可接受 |

登录入口：命令 `zhai.ai.loginCodebuddy` 调 SDK 的 `unstable_v2_authenticate` 打开浏览器授权；若企业环境不便走浏览器，可在 SecretStorage 配置 `zhai.codebuddy.apiKey` 并显式选用 `codebuddy` 通道。

### 5.3 各入口的会话与工具策略

| 入口 | 会话 | 工具 | 说明 |
|------|------|------|------|
| 面板 · 对话模式 | 有状态，`resume` 续接通道会话 | 只读工具在工作目录内自动放行，写类工具确认 | 工作目录取 `zhai.storage.rootPath`，不是 IDE 工作区根 |
| 面板 · 写作模式 | **无状态单次**，不续接 | 禁用工具，`maxTurns: 1` | 避免上一轮改写语境污染本次；也避免模型只看到截断内容却覆盖全文 |
| 取名 / 外貌生成 | 无状态单次 | 禁用工具，`maxTurns: 1` | 一次性文本任务不需要 Agent 循环，放开工具会拖慢并引入不可控的读文件行为 |

### 5.4 通用技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 文件写入 | `WorkspaceEdit` / `fs.writeFile` | **WorkspaceEdit** | 写入进入 VSCode Undo 栈，用户 `Ctrl+Z` 可回退，且能处理并发编辑 |
| diff 呈现 | Webview 内联 diff / `vscode.diff` 原生对比 | **两者结合** | 常规改稿用内联逐段接受；大范围改写提供「在对比编辑器中查看」 |
| diff 算法 | `diff`（jsdiff）/ 自研 LCS | **diff** | 支持行级与词级，体积小，维护活跃 |
| Token 估算 | `tiktoken`（wasm）/ 字符数 ÷ 1.6 粗估 | **tiktoken** | 精度高，可提前拦截超窗；wasm 版本无原生编译依赖 |
| 上下文检索 | SQLite 索引 / 全量读取 / 向量检索 | **SQLite 索引优先** | 见 `knowledge-base.md`；向量检索为可选增强 |
| UI 状态管理 | `useReducer` / `useEffect + useState` | **useReducer** | 流式消息是多步状态机，reducer 更可控且避免竞态 |
| 数据缓存 | TanStack Query / 自建 | **自建轻量缓存** | AI 流式不适合 Query；仅会话列表等普通数据用 Query |

> **弃用规避**：不使用 openai SDK 中已废弃的 `Configuration` 构造方式（改用 `new OpenAI({ apiKey, baseURL })`）；不使用 `AbortSignal.timeout` 之外的定时器自杀式取消。

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
    refs           TEXT NOT NULL DEFAULT '[]',  -- 引用上下文（JSON：绝对路径 + 行范围 + 展示标签）
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
| `zhai.ai.openChat` | 打开 AI 对话 | `Ctrl+Shift+L` |
| `zhai.ai.addToChat` | 添加到宅对话 | 编辑器右键（选中取行范围，未选则整篇） |
| `zhai.ai.inlineContinue` | 内联续写 | `Alt+Enter`（编辑器内） |
| `zhai.ai.polish` | 润色选中文本 | `Ctrl+Shift+P` 后搜索 |
| `zhai.ai.newSession` | 新建会话 | — |
| `zhai.ai.cancel` | 取消当前生成 | `Esc`（面板聚焦时） |
| `zhai.ai.usage` | 查看用量统计 | — |

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
| AC-11 | 引用上下文 | 选中行添加后标签为 `file.md:11-19`；发送时读取最新内容（含未保存修改），文件失效则跳过并提示 |
| AC-12 | 引用边界 | 单条超 2 万字按行截断并标注、整篇超限拒绝、超 10 项拒绝；重复添加不产生重复项 |
| AC-13 | 会话历史 | 历史列表按最近活跃倒序；切换会话恢复其消息与待发送上下文；删除当前会话后自动切到最近会话且其消息一并清除 |

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

---

## 10. 首版实现（对话模式，已落地）

侧栏视图 `zhai.aiChat`（AI 对话，`Ctrl+Shift+L` 聚焦，由原「工作区」占位视图改造而来）已落地对话模式最小闭环：会话、消息与用量落在独立的 `globalStorage/ai.db`，与内容索引库分离。

| 功能点 | 落地情况 |
|--------|----------|
| A6 对话模式 | 侧栏多轮问答；Enter 发送、Shift + Enter 换行；生成期间可停止；输入卡片见 10.3 |
| A8 消息历史 | `messages` 表保存 user/assistant 与终态（completed / failed / cancelled） |
| A9 SSE 流式输出 | openai SDK（`baseURL: https://api.deepseek.com`）；宿主按 60ms 窗口合并增量后经 `stream` 消息推送 |
| A11 请求取消 | `AbortController`，`ai/abort` 立即断开连接并把消息落为 `cancelled` |
| A17 预算护栏 | 按当日 `ai_usage_logs` 累计 token，达 `zhai.ai.dailyTokenBudget` 时拒绝发送并提示 |
| A7 会话管理 | 已实现新建、切换、删除与首条消息自动命名（历史浮层见 10.2）；重命名 / 关联文件待实现 |
| A10 思考链 | 已随流式回传并写入 `messages.reasoning`；面板折叠展示待实现 |
| A12 `@` 上下文 | 编辑器右键「添加到宅对话」已落地（见 10.1）；`@` 输入框提及待实现（依赖 Notes / KB 检索） |
| A1/A2/A5 写作模式 | 已落地模式切换、四项命令与整段写回（见 10.3）；A3 diff 逐段接受与 A4 内联续写待实现 |

协议（第 7.2 节 compose 全量设计的对话子集，写作模式落地时再扩展）：

| 方法 | 方向 | 说明 |
|------|------|------|
| `ai/session` | Webview → 宿主 | 取最近会话与消息；不存在时新建 |
| `ai/newSession` | Webview → 宿主 | 新建会话 |
| `ai/sessions` | Webview → 宿主 | 历史会话列表（`AiConversationSummary[]`，按最后活跃倒序） |
| `ai/switchSession` | Webview → 宿主 | 切换到指定会话，返回含 `contexts` 的会话快照 |
| `ai/deleteSession` | Webview → 宿主 | 删除会话及其消息（外键级联），返回 `{ deleted: boolean }` |
| `ai/runtime` | Webview → 宿主 | 密钥状态（含脱敏 Key）、模型参数与当日用量 |
| `ai/send` | Webview → 宿主 | 落库用户消息与占位助手消息，随后流式回传正文；`titleHint` 为命令名称等展示用短标题，仅用于会话命名 |
| `ai/draft` | Webview → 宿主 | 保存未发送的输入正文与命令 id（内存、按会话隔离），视图重建后随会话快照的 `draft` 恢复 |
| `ai/abort` | Webview → 宿主 | 取消当前生成 |
| `ai/context` | Webview → 宿主 | 取当前会话的待发送上下文清单 |
| `ai/context/remove` | Webview → 宿主 | 按宿主生成的 id 移除一条引用（不接受路径入参） |
| `ai/context/clear` | Webview → 宿主 | 清空待发送上下文，返回空清单 |
| `ai/writeState` | Webview → 宿主 | 实时改写目标、写回作用域、可写回与已写回消息 id |
| `ai/setMode` | Webview → 宿主 | 切换会话模式（`chat` / `write`），写库后返回 `{ mode }` |
| `ai/applyWrite` | Webview → 宿主 | 按助手消息 id 写回编辑栏（不接受路径与范围入参），返回 `{ applied, label, reason? }` |
| `host/command` | Webview → 宿主 | 白名单命令（`src/modules/common/webviewCommands.ts`），用于设置密钥、打开设置等 |
| `stream` | 宿主 → Webview | 增量 `{ reqId, delta, channel }`；终态 `{ done: true, status, content, error? }` |
| `state` | 宿主 → Webview | `channel: 'ai'`，`payload.kind` 为 `runtime`（密钥变更）、`context`（上下文变更）或 `writeTarget`（模式切换 / 生成完成 / 写回成功） |

### 10.1 编辑器右键「添加到宅对话」

命令 `zhai.ai.addToChat`（`editor/context` 菜单，`when = editorTextFocus && !editorReadonly && !inDiffEditor`）：

| 场景 | 标签 | 注入内容 |
|------|------|----------|
| 选中若干行 | `notes/ch01.md:11-19` | 选区覆盖的整行范围 |
| 选中单行 | `notes/ch01.md:11` | 同一行 |
| 未选中 | `notes/ch01.md` | 整篇 |
| 多光标多选区 | 每条选区一条引用 | 各行范围，重复项自动去重 |

- **惰性引用**：添加时只记路径与行范围，发送时才读取原文（`workspace.textDocuments` 内存态优先，回退磁盘），未保存修改同样生效（第 9 节「引用内容不过期」的落地）。
- **可见清单**：待发送引用以不可编辑芯片形式内联在输入区首行（文件 / 选区图标 + 标签 + 字数，单条移除）；已发送的引用作为**消息内容的一部分**随该条用户消息显示（`messages.refs`），不单独置于消息头部或会话头部。
- **消息样式**：参考 Copilot / CodeBuddy——不带头像与角色标签；用户消息为右对齐气泡（引用条目在气泡内正文之上），助手回复走 `Bubble variant="ghost"` 通栏纯文本（无气泡）。
- **提示**：默认聚焦面板（`zhai.ai.autoFocusOnContext`，关闭时改用信息提示）并给状态栏短提示；重复添加、超限、文件失效均返回明确文案。
- **边界**：单条上限 20000 字符（选区超出按行截断并标注，整篇超出直接拒绝）、单会话上限 10 项；预算先扣引用与输入，剩余额度再容纳历史，历史中仅最近一条带引用的消息注入原文。
- **安全**：原文以 `<context path="…" lines="…">` 注入并转义 `</context>`，系统提示声明标签内指令一律不执行；前端只回传宿主生成的 id，删除不接受路径。

### 10.2 历史对话（已落地）

顶部工具条右侧为「历史对话」（`History` 图标）与「新建会话」；点历史打开浮层（对齐 Copilot）：

| 行为 | 说明 |
|------|------|
| 列表 | 按 `updated_at` 倒序取最近 50 条；条目为「会话标题 + 相对时间」（7 天内用原生 `Intl.RelativeTimeFormat`，更早回退本地日期），当前会话以字重区分 |
| 切换 | 点击条目切到该会话（消息与待发送上下文一并恢复）；生成中先中止再切换；输入框已输入内容保留 |
| 删除 | 条目 hover 时用删除按钮顶替时间位置（行宽不跳动），点击直接删除、无二次确认；删除当前会话时中止生成并自动切到最近会话（无则新建） |
| 刷新 | 每次打开浮层重新拉取列表，避免展示过期数据 |

`messages` 随 `conversations` 由外键级联删除（`PRAGMA foreign_keys = ON`），删除会话即清理其消息。

### 10.3 底部输入卡片与写作写回（已落地）

输入区采用三段式卡片（顶部工具行 / 多行输入框 / 底部操作行），顶部工具行仅两个按钮，底部操作行左一右三；已选命令时输入框上方额外显示可取消的命令徽章：

| 位置 | 控件 | 交互 |
|------|------|------|
| 工具行左 | 命令 (`Command` 图标) | 下拉四项：改写 / 润色 / 校对 / 去 AI 味，选中项带勾选；选中后输入区顶部显示命令徽章（可点 × 或再次点击取消），指令模板不进入输入框 |
| 工具行右 | 参考 (`BookOpen` 图标) | 下拉四项：古诗词 / 名言名句 / 经典文本 / 历史资料；当前为占位，点击仅提示「即将上线」，不发起任何请求 |
| 操作行左 | 模式按钮 | 对话 / 写作两态切换，写 `conversations.mode` 持久化；生成中禁用 |
| 操作行右 | Token 圆环 | 当日已用 / 预算的环形占比（<70% 主色、70~90% 警示、≥90% destructive），点开浮层看已用 / 预算 / 剩余，每日 0 点重置 |
| 操作行右 | 增强提示词 | 本地规则化补齐「任务 / 要求」三段式，再次点击还原原文，不消耗 Token |
| 操作行右 | 发送 / 停止 | 生成中替换为停止；写作模式无可改写目标时发送禁用 |

- **输入框结构**：输入区为 `contenteditable` 富文本（`AiChatRichInput`），命令与上下文引用以不可编辑芯片与正文同行排列，正文值不含芯片文案；Enter 发送、Shift+Enter 换行，中文输入法组词期间不发送，粘贴统一降级为纯文本。
- **草稿恢复**：未发送的正文与已选命令防抖写入宿主内存草稿（`ai/draft`，按会话隔离），侧边栏切换导致 webview 重建后由会话快照的 `draft` 恢复；发送成功、新建或删除会话时清除。
- **命令徽章与指令替换**：命令只以徽章展示名称，输入框始终只保存用户可见文本；发送瞬间由 `composeCommandContent` 拼装「指令模板 + 补充文本」，存在命令时允许空输入直接发送，`applyPolicy` 按命令取值。
- **命令回显**：用户消息渲染前由 `splitCommandContent` 按最长指令前缀拆分，命中时显示命令徽章 + 补充文本（完整提示词经悬浮可见）；落库内容仍为完整正文，历史重载后同样回放，未命中时原样输出。
- **会话命名**：首条消息带命令时以命令名称作为 `titleHint`，避免标题被指令模板首句占据。
- **命令写回策略**：改写 / 润色 / 去 AI 味为 `replace`，结果提供「应用到编辑栏」；校对为 `report`，只输出清单，永不写回。
- **写作模式**：发送时重新捕获目标（选区优先，无选区取整篇，整篇上限 12000 字符），原文以 `<context>` 结构注入并复用引用去重规则；生成完成后该条助手消息进入可写回集合。
- **写回**：`ai/applyWrite` 只接受消息 id，宿主用发送时快照的 uri / `document.version` / range 校验后以 `WorkspaceEdit` 替换，写入进入撤销栈（`Ctrl+Z` 可回退）；整篇覆盖前由界面二次确认；重复点击不再写第二次。
- **状态隔离**：写回快照以助手消息 id 为键（不同轮次互不覆盖），可写回与已写回集合按会话隔离，均存于宿主内存；删除会话时一并清理，窗口重启后不再提供历史消息的写回入口。

### 10.4 设置入口（已迁移）

底部齿轮按钮已移除，插件设置入口改为侧栏视图标题栏图标：`package.json` 的 `menus.view/title` 注册 `zhai.openSettings`（`when = view == zhai.workflow`，`icon = $(gear)`）。无 Key 时仍由对话页空态卡片引导「设置 API Key」。

实现位置：`src/modules/ai/`（`client.ts` SDK 封装、`chatService.ts` 会话编排、`contextRefs.ts` 引用生成/读取/渲染、`aiChatProvider.ts` 协议路由、`db/` 三表仓储与 DDL）、页面 `src/webview/workflow/`（`index.html` + `main.tsx` 入口、`aichat/index.tsx` 主组件、`aichat/layout/` 页面结构组件、`aichat/markdown.tsx` Markdown 映射、`aichat/utils.ts` 格式化工具）。

页面构成：消息区用 `MessageScroller`（`Provider` 托管自动滚动、`Item` 以 `messageId` 作滚动锚点、`Button` 自动显隐），消息结构用 `Message` + `Content/Footer`，气泡用 `Bubble` + `BubbleContent`（用户 `default`、助手 `ghost`）；输入区为 `InputGroup` 三段式卡片（工具行 / 输入框 / 操作行，见 10.3），无 Key 时插入 `Card` 引导项。业务组件按「一文件一组件」拆分：命令菜单、参考菜单、工具行、模式按钮、Token 圆环、增强按钮、操作行、写回按钮、消息正文与引用条目各自独立文件。

与本文档的已知差异（后续补齐）：

- 上下文截断暂以「字符数 ÷ 1.6」粗估，第 5 节所列 tiktoken 方案未接入（AC-4 为降级实现）
- 用量日志的 `estimated_cost` 暂记 0（未内置 DeepSeek 计费规则），重试指数退避未实现，仅落地 30s 首字超时中断
- 单次生成上限固定 2048 token（`MAX_COMPLETION_TOKENS`），尚未开放到参数面板（A13）
- `@` 输入框提及（A12 剩余部分）未实现；待发送上下文与写回状态均为内存态，重启窗口后仅已发送的引用随 `messages.refs` 保留
- 写作模式当前为「整段替换 + Ctrl+Z 撤销」，未做 diff 逐段接受（A3）；整篇改写上限 12000 字符，超出只能选中片段
- 参考资料四项为占位，尚未接入检索与注入；命令的 `applyPolicy` 由前端按命令 id 推断，宿主只做字符串收窄
