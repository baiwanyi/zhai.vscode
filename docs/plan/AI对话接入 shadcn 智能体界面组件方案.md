# AI 对话接入 shadcn Trace / Questionnaire / Marker 技术评估与落地方案

> 评估对象：`trace`、`questionnaire`、`marker` 三个 shadcn 组件能否在【AI 对话】模块中支撑对应功能
> 技术底座：CodeBuddy CLI SDK（`@tencent-ai/agent-sdk` ^0.3.288，V2 Session）+ Webview / Extension Host 双端消息协议
> 结论口径：以「现有代码可复用程度 + SDK 事件可获取性 + 改动成本」三项判定，不预设理想化 SDK 能力

---

## 一、结论速览

| 组件 | 组件是否就绪 | 目标功能 | 可行性 | 主要卡点 |
|---|---|---|---|---|
| `trace` | ✅ 已安装（`resources/shadcn/ui/trace.tsx`），已用于「思考过程」 | Agent 执行步骤 / 工具调用 / 子任务时间线 | **高**（扩展型，非新建） | `AiMessage` 无过程数据字段；provider 丢弃了 `tool_use` / `tool_result` / `task_*`；落库需 DB 迁移 |
| `marker` | ✅ 已安装（`resources/shadcn/ui/marker.tsx`），已用于「正在准备上下文」 | 轮次分隔 / 系统提示 / 压缩事件 | **高**（收口型） | 压缩事件当前走 `toast`，未进消息流；`role='system'` 无独立渲染分支 |
| `questionnaire` | ✅ 已安装（`resources/shadcn/ui/questionnaire.tsx`），**零业务引用** | 把 `AskUserQuestion` 从弹窗升级为流内多步问卷 | **中**（可跑通，体验受限） | 审批回调是同步阻塞 + 60s 固定超时；超时即拒绝且不可续填；答案不落库 |

**一句话判断**：三个组件都不存在「能不能装」的问题，问题只在「接哪条数据流」。`marker` 与 `questionnaire` 可完全不动 SDK 层（复用现有 `notice` 与 `permission` 通道），`trace` 必须扩 provider 的事件解析并可选扩消息模型。

---

## 二、现状基线

### 2.1 组件库

- shadcn 源码托管在 `resources/shadcn/ui`（别名 `@components/ui`），业务封装在 `src/components`。
- `components.json` 为 `radix-nova` 变体，`@base-ui/react` 与 `radix-ui` 并存；`@shadcn/react` ^0.3.1 已安装，`questionnaire` 依赖满足。
- `src/workflow/aichat` 已使用 20 处 `@components/ui` 组件，其中：
  - `marker` → `layout/AiChatMessageList.tsx`（`phase === 'sending'` 的「正在准备上下文…」）
  - `trace` → `layout/AiChatMessageReasoning.tsx`（「正在思考 / 思考过程」折叠行）

### 2.2 SDK 接入链路

```
Webview useAiChatSession.send → request('ai/send')
  → AiChatService.send / generate          src/modules/ai/chatService.ts
  → CodeBuddyProvider.stream               src/modules/ai/providers/codebuddy.ts:113
      client.createSession / resumeSession  → session.connect() → session.send() → session.stream()
  → sdkCodebuddyClient                     src/modules/ai/providers/codebuddyclient.ts
      import { unstable_v2_createSession, unstable_v2_resumeSession } from '@tencent-ai/agent-sdk'
```

关键既有约束（改动前必须知道）：

- `permissionMode` 恒为 `default`，`acceptEdits` 永不启用（会绕过 `canUseTool` 的路径校验）。
- `settingSources: []`：不加载用户 hooks / 插件 / skills，所有 Hook 只能由代码声明。
- `tools: []`（无策略时）+ `maxTurns: 1`（纯文本场景），有策略时由 `AiToolPolicy` 下发白名单。
- `persistSession` 不得关闭（积分依赖 CLI 会话记录）。

### 2.3 消息与事件模型现状

`src/shared/types/aiChat.ts` 的 `AiMessage` 只有：`content` / `reasoning` / `status` / `refs` / 用量四项。**没有任何过程性结构**。

`src/shared/types/messages.ts` 的 `StreamMessage` 支持的旁路事件只有：

```ts
tool?: string          // 仅工具名，无 id、无入参、无结果
notice?: 'compacting' | 'compacted'
permission?: AiPermissionRequest
```

DB 层（`src/modules/ai/db/schema.ts`）`messages` 表同样没有过程字段，`role` 只用于区分 user / assistant。

---

## 三、逐组件评估

### 3.1 Trace：步骤行与时间线

#### 适用性

Trace 的定位是「Agent 执行的步骤」（区别于 `Message` 的回复正文、`Marker` 的轮间注释），与 AI 对话的「工具调用 / 子任务」语义完全对齐。组件本身支持四层能力，本项目当前只用了第一层的「单行折叠」：

| 能力 | 组件支持 | 本项目现状 |
|---|---|---|
| 单行（图标 + 标题 + 描述 + 状态） | ✅ | 思考过程使用中 |
| 可折叠（摘要行 → 详情） | ✅ | 思考过程使用中 |
| 嵌套（摘要 → 步骤 → 输出） | ✅ | 未使用 |
| 行内多态（链 trigger / Dialog / 外链） | ✅ | 未使用 |

#### SDK 对接点

Trace 的每一行都必须有「动作 + 对象 + 状态」三要素。SDK 侧可提供这些要素的通道有 5 条，按可靠性排序：

| # | 数据源 | 关键字段 | 可支撑的 Trace 行 | 当前是否已消费 |
|---|---|---|---|---|
| 1 | `assistant` 消息的 `tool_use` 内容块 | `{ type, id, name, input }` | 权威步骤行：工具名 + 入参（文件路径 / 命令） | ❌ 只取 `text` 块拼正文 |
| 2 | `user` 消息的 `tool_result` 内容块 | `{ tool_use_id, content, is_error }` | 完成 / 失败状态、输出详情 | ❌ 完全忽略 |
| 3 | `tool_progress` 消息 | `{ tool_use_id, tool_name, elapsed_time_seconds, parent_tool_use_id }` | 进行中行 + 耗时 + 子代理归属 | ⚠️ 只取 `tool_name` |
| 4 | `system.task_started / task_progress / task_updated / task_notification` | `{ task_id, description, task_type, status, usage }` | 子代理 / 后台任务摘要行 | ❌ 被 `system` 分支 `continue` 丢弃 |
| 5 | Hooks（`PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `SubagentStart` / `SubagentStop`） | `{ tool_name, tool_input, tool_use_id, tool_response, error }` | 兜底耗时、失败原因、子代理边界 | ❌ 未配置 `hooks` |

**建议主链路取 #1 + #2 + #3**：#1 决定「有哪些步骤、叫什么、参数是什么」，#2 决定「成功还是失败、详情是什么」，#3 提供「进行中」与耗时。#4 作为子任务行的补充。#5 只在需要「步骤耗时精确到毫秒」或「子代理归属」时补，不作为主链路。

#### 可行性判断

**可行，属于扩展而非新建**。原因：

1. `SessionImpl.stream()` 返回的 `Message` 联合类型已包含 `ToolProgressMessage`、`TaskStartedMessage` 等，类型定义齐全，无需侵入 SDK 内部。
2. `AssistantMessage.message.content` 就是 `ContentBlock[]`，`ToolUseContentBlock` 已有 `ToolUseContentBlock` / `ToolResultContentBlock` 的完整声明。
3. 现有 `AiStreamChunk` 已有 `toolActivity` 旁路先例，追加 `step` / `task` 事件是同一模式的延伸，`chatService` 的转发逻辑可平行复制。

#### 潜在限制

| 限制 | 影响 | 规避方式 |
|---|---|---|
| 待审批期间无 `tool_progress` | 用户批准前看不到该步骤，只有 `permission` 事件 | 前端在 `permission` 到达时先插入一条 `pending` 行，批准后由 `tool_progress` 接管为 `running` |
| `tool_use` 只在整条 `assistant` 消息到达时可得 | 参数无法逐字流式展示（`input_json_delta` 当前未解析） | 接受一次性展示；若必须流式需解析 `content_block_delta` 的 `input_json_delta`，成本高、收益低 |
| V2 Session 每轮在 `result` 处 `break` | 后台任务的 `task_notification` 可能晚于 `result`，拿不到完成态 | 只展示 `task_started` / `task_progress` 的「进行中」，不承诺终态；或改为主流程不 break（改动大，不建议本期） |
| `HookCallback` 无法向 `stream()` 注入消息 | Hooks 不能作为主链路，只能写旁路状态 | 明确 Hooks 只做副作用（时间戳 Map、压缩标记），UI 数据一律走 stream 消息 |
| `AiMessage` 无过程字段 | 刷新 / 切会话后步骤消失 | P2 增加 `steps` JSON 列（schema v14）；P1 接受「当轮可见」 |

---

### 3.2 Questionnaire：流内多步问卷

#### 适用性

`AskUserQuestion` 的入参与 questionnaire 的 `items` 是**同构**的，映射关系几乎 1:1：

| SDK `AskUserQuestionInput` | questionnaire |
|---|---|
| `questions[]`（1–4 条） | `items[]`（`name` 必填） |
| `question`（问题原文） | `QuestionnaireTitle` 文本 + `items[].name`（同时作为 `FormData` 键） |
| `header`（≤12 字符短标签） | `QuestionnaireDescription` |
| `options[].label` | `QuestionnaireChoice value` |
| `options[].description` | `QuestionnaireChoiceDescription` |
| `multiSelect` | `QuestionnaireItem multiple` |
| `answers`（回传） | `onSubmit` 里 `FormData` 拼装 |
| 无「必填/可选」概念 | `required` 恒为 `true`（无 Skip） |

本地 `@shadcn/react` 0.3.1 的真实定义（**与官网示例不同，不能照抄官网 items**）：

```ts
type QuestionnaireItemDefinition = {
    choices?: readonly { value: string; disabled?: boolean }[]
    disabled?: boolean
    name: string
    required?: boolean
}
// 注意：官网 Base UI 示例里的 prompt / description / input 字段在 0.3.1 中不存在，
// 照抄会直接类型报错。标题必须通过 <QuestionnaireTitle> children 渲染。
```

#### SDK 对接点

现有链路**已经打通 80%**：

```
CodeBuddyProvider.stream → sessionOptions.canUseTool = createToolGuard(...)
  → codebuddyPermission.ts: askUser()
      broker.request({ id: toolUseID, kind: 'question', questions })
  → chatService: PermissionBroker.emit → streamEmitter.fire({ permission })
  → Webview useAiChatPermission 入队 → 消息流内确认卡片（AiChatQuestionnaire）
  → ai/permissionDecision → broker.resolve → allow({ ...input, answers })
```

要做的不是「能不能接」，而是把最后一公里的 **Dialog 换成流内卡片**：

1. 宿主侧：`askUser` 增加 `toolUseId` 之外的信息（已有 `id`），并在 `permission` 之外补一条 `interaction` 事件带上「来自哪条助手消息」。
2. 前端：`useAiChatPermission` 的队首不再驱动 Dialog，而是驱动消息列表末尾的问卷卡片。
3. 提交：`onSubmit` → `new FormData` → 合并为 `Record<string,string>` → `respond({ allowed: true, answers })`，与现有多选合并规则（`、`）保持一致。

#### 可行性判断

**技术上可行，产品上限受 SDK 同步回调模型限制**。

必须正视三个硬约束：

| 约束 | 现状值 | 后果 |
|---|---|---|
| 审批回调是同步阻塞 | `canUseTool` 内 `await broker.request(...)`，流在此处完全停住 | 问卷期间不会再有正文增量，卡片必须由 `permission` 事件驱动，不能指望「边生成边填」 |
| 超时固定 60s | `permissionBroker.ts` 的 `APPROVAL_TIMEOUT_MS = 60_000` | 4 题问卷极可能超时；超时按拒绝处理，模型收到「用户没有回答问题」 |
| 无断点续填 | 超时 / 中止 / `cancelAll` 后 `resolve({allowed:false})`，SDK 已拒绝该工具调用 | 问卷答案无法补交；重试只能让模型重新发起一次提问 |

因此 questionnaire 的定位应为「**单次、短时、低题量**的澄清表单」，而不是「长问卷」。若要做长问卷，需要改 SDK 使用方式（见风险 R4）。

#### 潜在限制

| 限制 | 说明 | 处理 |
|---|---|---|
| `answered` 与 `skipped` 语义不匹配 | SDK 没有「跳过某题」概念，`required:false` 会让 Skip 按钮出现，但阶段答案会被 `.every()` 判定为不完整 | 全部 `required: true`，只在整体层面提供「跳过（拒绝）」 |
| 自由文本与选项同名 | `QuestionnaireInput` 的 `name` 由父 `QuestionnaireItem` 注入，`FormData.getAll(name)` 会同时包含选中 label 与自由文本 | 提交时按 `options` 白名单分流：命中白名单归入选项，其余归入自由文本；或独立的「其他」题给不同 `name` |
| `<form>` 提交 | questionnaire 根即 `<form>`；webview 中未 `preventDefault` 会触发默认导航 | `onSubmit` 首行必 `preventDefault`（组件内部已 `noValidate`，但不保证阻止默认行为） |
| 一次只答一张 | `PermissionBroker` 可能排队多条，但 SDK 侧 `AskUserQuestion` 单次调用最多 4 题 | 卡片只渲染队首；其余排队，避免多张表单同时可提交 |
| 卡片与消息绑定 | 现有 `permission` 不带消息归属，无法确定插在哪条助手消息下 | 由前端插在「当前流式消息」末尾；若 `streamingMessageIdRef` 为空则退回列表末尾 |
| 答案不可见 | 提交后卡片消失，历史里只剩模型的后续回复 | P1 保留卡片为只读态直至本轮 `done`；P2 落库为 `system` 消息 |

---

### 3.3 Marker：状态与分隔

#### 适用性

Marker 的三种变体刚好覆盖三类需求：

| 变体 | 用途 | 本项目落点 |
|---|---|---|
| `default` + `MarkerIcon` | 状态 / 系统笔记 | 「正在压缩上下文」+ `Spinner` |
| `separator` | 居中标签分隔线 | 「上下文已压缩」「以下是新一轮」 |
| `border` | 行底边框 | 消息分组边界（可选，优先级低） |

#### SDK 对接点

| 数据源 | 语义 | 当前处理 | 目标处理 |
|---|---|---|---|
| `system.status === 'compacting'` | 开始压缩 | `toast.info` | `Marker` + `Spinner`，`role="status"` |
| `system.subtype === 'compact_boundary'` | 压缩完成 | `toast.info` | `Marker variant="separator"`，常驻消息流 |
| `system.init` | 会话建立 / 模型 / 工具清单 | 仅日志 | 不展示（信息密度低，易噪音） |
| `task_*` | 子任务生命周期 | 丢弃 | 归入 trace，不用 marker |
| 轮次边界 | 「新的一轮」 | 无 | 由消息 `createdAt` 分组渲染（纯前端，无需 SDK） |

#### 可行性判断

**最可行的一个，且是唯一不触碰 SDK 层的**。`chunk.notice` 通路已存在，`chatService` 已在流内转发，只需前端换渲染目标，并把 `compacted` 从瞬时 toast 提升为可驻留条目。

#### 潜在限制

| 限制 | 说明 | 处理 |
|---|---|---|
| Marker 默认无 `role` | 屏幕阅读器不会播报状态 | 流式状态加 `role="status"` |
| 分隔线不能加 `role="separator"` | 官方明确：会导致可见标签读不出来 | `variant="separator"` 时不加 role |
| 不是消息 | `messages.map` 渲染不到它 | P1 用「列表末尾的瞬时条目」；P2 落成 `role='system'` 消息 |
| 与 trace 的「进行中」重复 | 工具执行期既有 marker 又有 trace 行 | 工具进度只走 trace，marker 只承载「会话级」事件（压缩、轮次） |
| 压缩事件与消息无关联 | `notice` 不带消息 id | 只能追加在末尾，天然近似「发生在该时刻」 |

---

## 四、落地方案

### 4.1 分期与顺序

按「改动半径」从小到大排，先验证通路、再动数据模型：

| 阶段 | 范围 | 预估 | 判定依据 |
|---|---|---|---|
| **P0** | Marker 收口：压缩事件进流、`role='system'` 渲染分支、轮次分隔 | 1–2 人日 | 零 SDK 改动，只改前端 + 一处 `chatService` 落库 |
| **P1** | Questionnaire 进流：流内问卷卡片、超时分级、答案只读态 | 3–5 人日 | 只扩 `permission` 载荷与前端交互，不碰 SDK 调用方式 |
| **P2** | Trace 步骤化：provider 暴露 steps/tasks、消息 `steps` 落库、统一过程块 | 5–8 人日 | 需扩 `AiStreamChunk` + `StreamMessage` + DB 迁移 |

> 顺序理由：P0/P1 均可复用现有旁路通道（`notice` / `permission`），失败可单独回滚；P2 会改消息契约与 DB schema，必须在前两者验证「过程类 UI 真的被使用」后再投入。

### 4.2 数据结构变更

#### P0：系统消息（Marker 落点）

```ts
// src/shared/types/aiChat.ts
/** 系统事件的展示类型：与 Marker 的三种形态一一对应 */
export type AiSystemNoticeKind = 'compacting' | 'compacted' | 'turn'

/** 系统消息不进入模型上下文，仅用于消息流回放 */
export interface AiSystemNotice {
    kind: AiSystemNoticeKind
    text: string
}
```

- DB：`messages` 表 `role` 已能存 `'system'`，P0 不需要加列；`content` 存文案，`finish_reason` 存 `kind`（或新增 `notice_kind` 列，P0 建议先用 `finish_reason`，避免迁移）。
- 前端：`AiChatMessageView` 增加 `message.role === 'system'` 分支 → `Marker`。

#### P1：问卷交互（Questionnaire 落点）

```ts
// src/shared/types/aiChat.ts —— 扩展现有 AiPermissionRequest
export interface AiQuestionInteraction {
    /** 与 toolUseID 一致，回传时原样带回 */
    id: string
    /** 归属的助手消息 id：前端据此把卡片插在对应气泡下方 */
    messageId: string | null
    questions: AiAskQuestion[]
    /** 提交截止时间（毫秒时间戳）：由宿主按题量计算，前端据此显示倒计时 */
    expiresAt: number
}
```

- 传输：新增 `StreamMessage.question?: AiQuestionInteraction`（或直接扩展 `permission`，加 `messageId` / `expiresAt` 两个字段——**推荐后者，字段更少、守卫改动更小**）。
- DB：P1 不落库，卡片只在本轮存活。

#### P2：步骤（Trace 落点）

```ts
// src/shared/types/aiChat.ts
export type AiStepStatus = 'pending' | 'running' | 'done' | 'error'

export interface AiStep {
    /** tool_use_id；任务行为 task_id */
    id: string
    /** 'tool' | 'task' */
    kind: 'tool' | 'task'
    /** 原始工具名或 task_type，前端经 describeTool 映射中文 */
    name: string
    /** 一行摘要：如「读取 chapters/ch01.md」 */
    title: string
    /** 次要信息：耗时、diff 统计、结果条数 */
    description: string | null
    status: AiStepStatus
    /** 失败原因（is_error 或 tool_response 摘要） */
    error: string | null
    /** 父步骤 id：子代理内的工具调用挂到 task 行下 */
    parentId: string | null
}
```

- `AiMessage` 增加 `steps: AiStep[]`（P2）。
- DB：`messages` 新增 `steps TEXT NOT NULL DEFAULT '[]'`（schema v14），写入前 `JSON.stringify`，读出时仍按「不可信输入」逐字段收窄（与 `refs` 同口径）。
- 传输：`StreamMessage` 增加 `step?: AiStepEvent`，`AiStreamChunk` 增加 `step?: AiStepEvent`。

### 4.3 文件级改动清单

| 阶段 | 文件 | 改动 |
|---|---|---|
| P0 | `src/modules/ai/chatService.ts` | `chunk.notice === 'compacted'` 时插入一条 `role='system'` 消息并下发 `done` 前回传；`compacting` 只下发瞬时状态 |
| P0 | `src/workflow/aichat/hooks/useAiChatSession.ts` | `notice` 分支由 `toast.info` 改为写入 `session.messages`（compacted）与 `transientNotice`（compacting） |
| P0 | `src/workflow/aichat/layout/AiChatMessageView.tsx` | 新增 `role === 'system'` 分支 → `Marker`（`separator` / `default`） |
| P0 | `src/workflow/aichat/layout/AiChatMessageList.tsx` | 末尾渲染 `compacting` 的 `Marker + Spinner`（替换现有 `sending` 占位逻辑的并列分支） |
| P0 | `docs/modules/ai-chat.md` | 补「系统消息与流内标记」小节 |
| P1 | `src/modules/ai/permissionBroker.ts` | `request()` 增加可选 `timeoutMs`；question 类按 `min(questions.length * 120_000, 600_000)` 计算 |
| P1 | `src/modules/ai/providers/codebuddyPermission.ts` | `askUser` 传入按题量计算的超时；`AiPermissionRequest` 补 `messageId`（由 chatService 注入，provider 不感知） |
| P1 | `src/modules/ai/chatService.ts` | `PermissionBroker` 构造时注入当前 `assistantMessageId` 与 `expiresAt` |
| P1 | `src/workflow/aichat/hooks/useAiChatPermission.ts` | 队首改为驱动流内卡片；`done` 时清空并把未完成卡片置为「已失效」 |
| P1 | `src/workflow/aichat/layout/AiChatQuestionnaire.tsx`（新增） | 把 `AiAskQuestion[]` 映射为 `Questionnaire` 组件树，`onSubmit` 拼装 `answers` |
| P1 | `src/workflow/aichat/layout/AiChatMessageBody.tsx` | 当前消息存在待答问卷时，在正文下方渲染 `AiChatQuestionnaire` |
| P1 | `src/workflow/aichat/hooks/useAiChatSession.ts` | 维护 `pendingQuestion`（含 `messageId` / `expiresAt`），供 body 判断 |
| P1 | `src/workflow/aichat/layout/AiChatQuestionnaire.tsx` | 写入确认与提问共用同一表单（`kind` 决定题面），不再保留弹窗 |
| P2 | `src/modules/ai/providers/codebuddy.ts` | `assistant` 分支解析 `tool_use`；`user` 分支解析 `tool_result`；`system` 分支分派 `task_*`；`tool_progress` 补 `tool_use_id` / `elapsed` |
| P2 | `src/modules/ai/provider.ts` | `AiStreamChunk` 增加 `step?: AiStepEvent` |
| P2 | `src/shared/types/messages.ts` | `StreamMessage` 增加 `step?: AiStepEvent` + 守卫函数 |
| P2 | `src/workflow/aichat/layout/AiChatMessageSteps.tsx`（新增） | `Trace` + `TraceCollapsible` 渲染 `AiStep[]`，`status` 映射 `running/error/pending` |
| P2 | `src/workflow/aichat/layout/AiChatMessageBody.tsx` | `steps` 非空时渲染步骤块（放在 reasoning 与正文之间） |
| P2 | `src/modules/ai/db/schema.ts` | schema v14：`messages.steps` |
| P2 | `src/modules/ai/db/chatRepository.ts` | 写入 / 读取 / 收窄 `steps` |

### 4.4 交互时序

#### Questionnaire（核心流程）

```
用户发送 → 模型决定提问
  → SDK 调 AskUserQuestion → canUseTool('AskUserQuestion', input)
  → askUser(): 解析 questions → broker.request({ id: toolUseID, kind:'question', questions, messageId, expiresAt })
  → stream 通道下发 permission（此时流暂停，无正文增量）
  → 前端 useAiChatPermission 入队 → 消息列表在该助手消息下渲染问卷卡片
      ├─ 用户逐题作答 → 点「提交」
      │    → FormData 取答案 → 合并为 Record<string,string>
      │    → request('ai/permissionDecision', { id, decision:{ allowed:true, answers } })
      │    → broker.resolve → allow({ ...input, answers }) → 流恢复
      └─ 用户点「跳过」/ 关闭卡片 / 超时
           → respond({ allowed:false }) → deny('用户没有回答问题')
  → 卡片转为只读态（显示已选答案），直至本轮 done
```

#### Trace（步骤流）

```
PreToolUse? ──（可选，仅补时间戳）
  assistant 消息到达，content 含 tool_use → 产出 step{status:'pending'|'running', name, input 摘要}
  tool_progress 到达 → 更新该 step 为 running，补 elapsed
  user 消息到达，content 含 tool_result → 更新 step 为 done/error，补输出摘要
  system.task_started → 产出 kind:'task' 的父行
  system.task_progress / task_updated → 更新父行 description（不承诺终态）
  result 到达 → 所有未收口 step 置 done（或 error，按 result.subtype）
```

#### Marker（压缩）

```
system.status === 'compacting' → 前端临时 Marker(default) + Spinner，不落库
system.subtype === 'compact_boundary' → 移除临时 Marker，插入 role='system' 消息（Marker separator）
```

### 4.5 SDK Hooks 的准确定位

| Hook | 能否用于 UI | 建议用途 |
|---|---|---|
| `PreToolUse` | ❌ 不能注入 stream | 记录 `tool_use_id → 开始时间` 到 Map，供 P2 精确耗时 |
| `PostToolUse` | ❌ | 写 `updatedToolOutput` 压缩超长输出（省 token，与 UI 无关） |
| `PostToolUseFailure` | ❌ | 记录失败原因，供 trace 的 `error` 字段兜底 |
| `SubagentStart` / `SubagentStop` | ❌ | 标记子代理边界；若 `task_*` 不够用再启用 |
| `PreCompact` / `PostCompact` | ❌ | 与 `notice` 二选一，**不要双写**（否则会出现两条压缩提示） |
| `SessionStart` / `SessionEnd` | ❌ | 会话级清理，与 UI 无关 |

**结论**：Hooks 在本方案中是**旁路信号**，不是主链路。理由有两条：

1. `HookCallback` 的返回类型只有 `HookJSONOutput`（`continue` / `decision` / `hookSpecificOutput`），没有向 `session.stream()` 投递消息的能力。
2. Hook 回调与 provider 的 `for await` 不在同一控制流，Hook 内无法 `yield`。

因此凡是要「出现在消息流里」的数据，一律走 `session.stream()` 的消息；Hooks 只补充 stream 拿不到的字段（精确耗时、失败原因）。

---

## 五、风险与前置依赖

### 5.1 风险清单

| ID | 风险 | 等级 | 影响 | 应对 |
|---|---|---|---|---|
| R1 | 60s 固定超时导致多题问卷必失效 | **高** | P1 的核心体验 | 按题量分级超时（`min(n*120s, 600s)`），并在卡片上显示倒计时；超时后卡片置「已过期」并提供「重新提问」 |
| R2 | 问卷答案不可续填 | **高** | 用户填到一半切走即丢 | 产品文案明确「需一次完成」；P2 可考虑把未答完的答案缓存到会话，重新提问时预填 |
| R3 | `AiMessage` 扩字段引发 DB 迁移 | 中 | 升级后旧库读取失败 | 遵循现有 `ensureColumn` + `schema_version` 机制，`steps` 默认 `'[]'`，读取端逐字段收窄 |
| R4 | 长问卷与 SDK 同步模型冲突 | 中 | 想做「多轮长问卷」时方案不成立 | 明确本期只做单次短问卷；长问卷需改用「模型一次问 1–2 题 + 多轮」策略，由系统提示约束 |
| R5 | `task_notification` 晚于 `result` 拿不到 | 中 | 子任务行永远停在「进行中」 | 只展示 started/running；不展示终态，或在 `result` 时统一收口为「已结束」 |
| R6 | 流式期间插入卡片导致滚动跳动 | 中 | 阅读体验 | 复用 `MessageScroller` 的 `scrollAnchor`，卡片出现时以该条消息为锚点；卡片高度变化不触发强制贴底 |
| R7 | `role='system'` 消息被拼进模型上下文 | 中 | 污染提示词、浪费 token | `preparePrompt` 已过滤 `role !== 'system'`，需在 P0 补一条断言 + 单测，防止后续改动破坏 |
| R8 | 本地 questionnaire 版本 API 与官网不一致 | 中 | 照抄文档导致类型报错、白跑一轮 | 以 `node_modules/@shadcn/react/dist/questionnaire/index.d.ts` 为准（本文已列真实定义） |
| R9 | 卡片与 `permission` 队列不同步 | 低 | 卡片已答但队列未出队，或反之 | 统一由 `useAiChatPermission` 单一状态源驱动，卡片不自持队列 |
| R10 | `resources/shadcn/ui` 组件被 shadcn CLI 覆盖 | 低 | 定制化丢失 | 现有约定：不在 `resources/shadcn/ui` 内加业务逻辑，业务封装一律放 `src/workflow/aichat/layout` |

### 5.2 前置依赖

| 依赖 | 状态 | 说明 |
|---|---|---|
| `@tencent-ai/agent-sdk` 的 `AskUserQuestionInput` 类型 | ✅ 已具备 | `lib/types.d.ts` 导出 `AskUserQuestionQuestion` / `Option` / `Input`，可直接替换 `AiAskQuestion` 的手写镜像 |
| `SessionImpl.stream()` 的 `Message` 联合类型 | ✅ 已具备 | 含 `ToolProgressMessage` / `Task*Message`，无需侵入 |
| `@shadcn/react` ≥ 0.3.1 | ✅ 已安装 | questionnaire 的 headless 基座 |
| `resources/shadcn/ui/questionnaire.tsx` | ✅ 已存在 | 零引用，可直接用 |
| `messages.role` 支持 `'system'` | ✅ 已有 | 无需迁移 |
| 审批桥的可变超时 | ❌ 需改造 | `PermissionBroker.request()` 目前硬编码 60s |
| 消息级过程数据 | ❌ 需新增 | P2 的 `steps` 列与类型 |
| `pnpm` 依赖安装 | ✅ | 无需新增依赖 |

### 5.3 明确不做的事

- 不引入 `Elicitation`（`SessionOptions.elicitation`，ACP 表单能力）。当前 `codebuddy.ts` 未声明该能力，启用等于向 CLI 声明可处理任意 `requestedSchema`，需要额外的 Schema → 组件映射层，超出本期范围。留作后续「支付确认 / 结构化表单」的扩展点。
- 不改 `permissionMode`，不为问卷单独放开 `acceptEdits`。
- 不做「流内联工具审批」（把写入确认也搬进消息流）。审批是危险操作，保留模态对话框的阻断性是有意为之。
- 不合并 reasoning 与 steps 为一个 Trace 列表（P2 可选优化，但会牵动现有 `AiChatMessageReasoning`，收益不确定）。

---

## 六、验收标准

| 阶段 | 验收项 |
|---|---|
| P0 | ① 压缩开始显示 `Marker + Spinner`，完成后变为分隔线且重开面板仍在；② 系统消息不进入模型提示词（单测断言 `preparePrompt` 过滤）；③ `Marker` 无 `role="separator"` 误用 |
| P1 | ① 4 题问卷可完整作答并回传，模型收到答案后继续生成；② 超时后卡片显示「已过期」且不再可提交；③ 多选答案以 `、` 合并；④ 自由文本可提交；⑤ 关闭卡片等同拒绝，不悬挂 Promise |
| P2 | ① 工具调用逐条出现在步骤列表，状态 running → done/error 正确；② 失败工具显示 `error` 语义（红色）且文案写明失败；③ 刷新后步骤可回放；④ 旧库升级不丢消息 |

---

## 七、实施进度（2026-10-29 完成）

| 阶段 | 状态 | 实际落地 | 与方案的偏差 |
|---|---|---|---|
| P0 Marker | 已完成 | 压缩开始走流内瞬时 Marker（`role="status"`），完成落 `role='system'` 消息（`finish_reason='compacted'`）并随流下发 `noticeMessage` | 轮次分隔未做：收益低且需额外消息类型，暂缓 |
| P1 Questionnaire | 已完成 | `AiChatQuestionnaire` 流内卡片，写入确认与提问共用；审批桥补 `messageId` / `expiresAt`；提问超时按题量 `min(n×180s, 600s)`；归属缺失回落到列表末尾 | 提交后的只读答案回显未做（卡片即时收起）；未启用 Elicitation |
| P2 Trace | 已完成 | `AiStep` 贯通 provider → chatService → stream → 前端；`messages.steps`（schema v14）；`AiChatMessageSteps` 折叠轨迹 | Hooks 未参与：`tool_progress` 已带耗时，`task_*` 已覆盖子任务 |

验证结果：`pnpm run typecheck` 0 错误、ESLint 0 问题、`prettier --check` 通过、全量测试 62 文件 / 678 用例通过；界面观感与真实工具执行由用户在调试宿主中核对。
