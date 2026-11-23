# AI 对话会话作用域收敛方案（含全局助手评估）

> 目标：把现有的「按对象硬隔离」会话机制收敛为「默认自动、跨域手动」的软作用域，并清理删除对象后产生的孤儿会话
> 实施方案（任务分解、提交计划、测试与回滚）：`docs/plan/AI对话会话作用域收敛实施方案.md`
> 依据：`src/modules/ai/{chatService,aiChatProvider,db/chatRepository}.ts`、`src/workflow/layout/contentScope.ts`、`src/workflow/aichat/**`、`src/modules/{press,wechat}/**`
> 状态：未实施。实施后需同步 `docs/modules/ai-chat.md` 第 6 节与协议表
> 口径：只写代码已有能力与明确改动点，不预设 SDK 未提供的能力

---

## 1. 摘要

### 1.1 决策

| 决策 | 结论 |
|---|---|
| 是否保留作用域 | 保留，改为软作用域（默认仍自动切换，跨对象取用需手动） |
| 跨域取用语义 | 移动（一份会话只保留一个归属），不做复制 |
| 全部列表形态 | 上限维持 50 条，追加前端本地关键字过滤，不做分组折叠 |
| 公众号来源标签 | 先显示 `wechat/{appid}`，账号名留作后续增强 |
| 是否保留「原属作品」 | 不新增列，删除回包带 `adoptedConversations` 计数 |

### 1.2 分期

| 阶段 | 主题 | 解决 | 预估 |
|---|---|---|---|
| 一 | 失效会话归入通用 | D2 | 1 人日 |
| 二 | 历史浮层双态 + 跨域迁移 | D1、D3 | 3~3.5 人日 |
| 三 | 来源失效标注（可选） | 补充 | 0.5 人日 |
| 收尾 | 文档同步 | — | 0.5 人日 |

阶段一是纯缺陷修复，不改变任何交互，可独立发版；阶段二才动界面。

---

## 2. 现状与问题

### 2.1 作用域口径

| 内容 | 作用域键 | 示例 |
|---|---|---|
| 微博 | 模块键 | `weibo` |
| 笔记 | 文档相对路径 | `notes/随手记.md` |
| 作品 | 作品目录 | `press/剑来` |
| 公众号 | 账号目录 | `wechat/wx1234567890` |
| 无归属 | `null`（通用对话） | 根目录散文档 |

### 2.2 作用域实际承担的职责

| 职责 | 实现 | 位置 |
|---|---|---|
| 默认打开哪条会话 | `project_dir IS ? ORDER BY updated_at DESC LIMIT 1` | `db/chatRepository.ts` |
| 历史浮层列哪些 | `listConversations(db, limit, projectDir)`，上限 50 | 同上 |
| 命令侧引用落到哪 | `readDocumentScope(router)` | `modules/ai/commands.ts` |
| 页面重建边界 | `key={scopeDir ?? 'global'}` | `WorkflowResidentSection.tsx` |
| 未发送内容隔离 | 草稿与待发上下文按 `conversationId` 存宿主内存 | `chatService` |

结论：作用域不只是过滤条件，它同时决定默认会话、命令落点与页面重建边界，因此不能简单取消。

### 2.3 三个缺陷

| 编号 | 缺陷 | 证据 |
|---|---|---|
| D1 | 历史无法跨作用域查看 | `ai/sessions` 只接受单个 `projectDir`，仓储层没有「不加过滤」的查询 |
| D2 | 删除对象后会话成为不可达孤儿 | 全仓只有 `deleteConversation(db, id)`；`projectService.deleteProject` 删作品目录、`accountService.remove` 删 `wechat/{appid}` 目录，都不动 `conversations` |
| D3 | 无法把对话带到另一个对象 | `ai/switchSession` 只按 id 切，不接受目标作用域 |

---

## 3. 目标与非目标

**目标**

1. 删除作品 / 公众号账号后，相关会话进入通用对话，不丢、不堆积。
2. 历史浮层能按需查看其它对象的会话，并能取用到当前对象。
3. 默认行为与现在完全一致：进入对象即恢复该对象的会话。

**非目标**

- 不做会话复制、不做跨作用域搜索、不做置顶。
- 不改 `conversations` 表结构，不做存量数据迁移。
- 不动写回链路（`describeWriteTarget` 与会话无关，本来就安全）。

---

## 4. 设计

### 4.1 原则

1. 默认自动、跨域手动：进入对象即恢复该对象的会话，跨对象取用必须由用户显式操作。
2. 一份会话一个归属：跨域取用等于移动，避免一条会话挂在两个对象下导致后续删除与标签分叉。
3. 失效不阻塞：作用域目录已不存在时，历史与删除链路都不能报错。
4. 粒度宽于文档、窄于全局：作品与账号是连续工作单元，不再回到按章、按篇。

### 4.2 阶段一：失效会话归入通用（D2）

**触发点**

| 删除动作 | 落点 | 调用 |
|---|---|---|
| 删除作品 | `dashboardProvider.deletePressProject`（`press/deleteProject` 分支，`deleteProject(...)` 之后、`clearProject()` 之前） | `adoptScope('press/{作品名}')` |
| 删除公众号账号 | `accountService.remove`（已有 `existing.app_id`，`removeAccountDirectory` 之后） | `adoptScope('wechat/{appid}')` |

**数据层（`db/chatRepository.ts`）**

```sql
UPDATE conversations
   SET project_dir = NULL
 WHERE project_dir = @scope
    OR project_dir LIKE @prefix ESCAPE '\'
```

- `@prefix` = `escapeLike(scope) + '/%'`；`escapeLike` 转义 `\`、`%`、`_` 三个字符。
- 前缀匹配是必需的：存量里存在按章（`press/剑来/第一章.md`）与按篇（`wechat/{appid}/post/{时间戳}/x.md`）建立的旧会话，只匹配精确值会漏。
- 归入通用而不是删除：删除作品不可逆，不能顺手清掉用户数月的对话。
- 新增 `adoptConversationScope(db, scope): number`，返回 `run().changes`。
- `escapeLike` 以可导入形式导出，供单测直接验证通配符转义。

**服务层（`chatService.ts`）**

```ts
adoptScope(scope: string): number   // 返回归入条数；若活跃会话在其中，同步 activeProjectDir = null
```

**装配**

- `dashboardProvider` 早于 ai 层创建（`extension.ts` 中先建 provider、后 `assembleAiLayer`），用后置注入补齐，与现有 `attachTodoRoutes` / `attachWeiboEnhance` 同一模式：新增 `attachAiScopeJanitor({ adoptScope })`。
- `wechatLayer` 在 ai 层之后创建，直接在 `assembleWechatLayer` 的依赖里传 `onAccountRemoved(appId)`，无需后置注入。

**回包与提示（决策 4）**

- `DeletePressProjectResult`、`RemoveWechatAccountResult` 各加 `adoptedConversations: number`。
- 前端在现有删除成功提示后追加一句：`另有 N 条历史对话已归入通用对话`（N 为 0 时不追加）。

**验收**

- 删除作品 A 后，A 的作品级与旧章节级会话全部进通用；作品 B 不受影响。
- 删除公众号账号后，`wechat/{appid}` 及其旧批次级会话进通用。
- 归入后默认打开通用对话，不报错；删除动作本身的成功提示保持不变。

### 4.3 阶段二：历史浮层双态 + 跨域迁移（D1、D3）

**交互规格**

- 历史浮层顶部两段切换：「当前对象」（默认）|「全部」。
- 当前对象态：与现状一致（标题 + 相对时间，hover 出删除）。
- 全部态：条目改为两行，首行标题，次行来源（`作品 · 剑来` / `笔记 · 随手记` / `公众号 · wx1234567890` / `通用对话`），hover 删除仍叠在时间位置，不改变行宽。
- 全部态顶部追加本地过滤输入框，按标题子串过滤当前 50 条（纯前端，不发请求）。
- 选中其它对象的会话：弹一次确认（`该对话将移动到当前作品`），确认后迁移并切到该会话；取消则不做任何事。

**协议变更**

| 方法 | 方向 | 规格 |
|---|---|---|
| `ai/sessions` | 前端 → 宿主 | 入参增加 `all?: boolean`；`all === true` 时忽略 `projectDir`，返回全区最近 50 条。非布尔值按 false 处理 |
| `ai/session/move` | 前端 → 宿主 | 新增。`{ conversationId, projectDir }` → `{ moved: boolean }`；`projectDir` 为 `null` 表示归入通用 |
| `AiConversationSummary` | 宿主 → 前端 | 增加 `scopeKind: 'press' \| 'note' \| 'wechat' \| 'weibo' \| null`、`scopeLabel: string \| null` |

校验：`conversationId` 走现有 `readConversationIdPayload`；`projectDir` 复用 `readScopePayload` 的规则（拒绝盘符、上跳、反斜杠、超长），另允许 `null`。`ai/session/move` 需登记到 `shared/types/messages.ts` 的 `HostMethodName` 白名单。

**来源标签派生（新文件 `modules/ai/scopeLabel.ts`，纯函数）**

| 作用域键 | kind | label |
|---|---|---|
| `press/剑来` | `press` | `剑来` |
| `press/剑来/第一章.md`（存量） | `press` | `剑来` |
| `notes/随手记.md` | `note` | `随手记` |
| `wechat/wx1234567890` | `wechat` | `wx1234567890` |
| `weibo` | `weibo` | `微博` |
| `null` | `null` | `通用对话` |

按路径段派生，不查库、不跨模块依赖。账号名映射留作后续（provider 内 60 秒缓存的一次性映射）。

**数据层（`db/chatRepository.ts`）**

- 现有 `listConversations` 更名为语义明确的 `listScopedConversations`，新增 `listRecentConversations(db, limit)`。
- 新增 `updateConversationScope(db, id, projectDir)`：只改 `project_dir`，不动 `updated_at`（时间戳由服务层决定）。

**服务层（`chatService.ts`）**

```ts
listSessions(scope: string | null, all: boolean): AiConversationSummary[]  // 组装 scopeKind / scopeLabel
moveSession(conversationId: string, projectDir: string | null): boolean    // 改写归属 + touch
```

`moveSession` 的关键约束：**改写归属后必须同步 `touchConversation`**。否则 `getLatestConversation` 仍可能取到该作用域原来那条会话，出现「迁移成功但打开的不是刚才那条」。活跃会话迁移时同步 `activeProjectDir`。

**前端改动点**

| 文件 | 改动 |
|---|---|
| `aichat/hooks/useAiChatHistory.ts` | 增加 `mode: 'scope' \| 'all'` 与 `loadSessions(mode)`；请求带 `all` |
| `aichat/history/AiChatHistoryMenu.tsx` | 两段切换 + 全部态过滤输入框 + 来源行 |
| `aichat/history/AiChatHistoryItem.tsx` | 标题列改上下两行（标题 / 来源），仅全部态显示来源 |
| `aichat/WorkflowAiChat.tsx` | 迁移流程编排：确认 → `ai/session/move` → `switchSession` → `loadSessions` |

**迁移时序**

```
用户点全部态某条（scope ≠ 当前）
  → 确认弹窗
  → ai/session/move { conversationId, projectDir: 当前作用域 }
  → ai/switchSession { conversationId }        // 返回快照，直接接管
  → ai/sessions { projectDir: 当前作用域 }      // 刷新当前态列表
```

分两步而不是合并成一个复合协议：迁移失败与切换失败要能分别提示，且 `switchSession` 已有快照返回，复用即可。

**边界与风险**

- 迁移是静默改变归属，确认文案必须明确写「移动」，不能说「使用」或「打开」。
- 全部态会显示其它对象的会话标题（含作品名 / 笔记名），属本地面板内信息，无外泄面。
- 当前对象态完全不走新分支，默认路径零风险。

**验收**

- 进入作品 / 笔记 / 公众号，默认历史与现状完全一致。
- 全部态能看到其它对象会话，来源正确，过滤输入框生效。
- 从全部态迁移后：原对象不再列出该会话，当前对象列出并处于选中态；草稿与待发上下文保留（按 `conversationId` 存储，天然跟随）。
- `all` 为 true 时不按 `projectDir` 过滤；非法 `projectDir` 仍被拒绝。

### 4.4 阶段三：来源失效标注（可选）

- 全部态里，若来源路径对应的作品 / 笔记 / 账号已不存在，来源行显示 `来源已失效`。
- 不自动改写、不做开机扫描；只在打开全部态时按已有清单比对，比对失败不影响列表渲染。
- 触发条件：用户反馈出现「外部删除目录导致会话堆积」再实施。

---

## 5. 全局 AI 助手评估

**定义**：取消作用域维度，只保留一条时间线，默认回到最近会话；上下文靠手动挂引用，写回目标仍由当前编辑器推导。

| 维度 | 判断 |
|---|---|
| 上下文正确性 | 差。打开作品 B 会延续作品 A 的话题；待发上下文按会话保存，A 的设定芯片会出现在 B 的输入区 |
| 定位成本 | 差。20 篇笔记 + 3 个作品 + 2 个账号混进 50 条列表，只能靠标题辨认 |
| 写回安全 | 无影响（与会话无关） |
| 迁移成本 | 高。存量 `project_dir` 全部置空且不可逆，需要搜索 / 重命名 / 置顶 / 分页补齐，约 7 人日 |
| 与产品定位 | 冲突。写作场景的诉求是「AI 知道我在写哪本、哪章」，这正是作用域在承担的事 |

**结论**：不作为默认形态。现有「通用对话」（`project_dir IS NULL`）已经覆盖「不想绑定对象」的需求，全局化不增加能力，只换默认入口。若要提升通用助手体验，正确做法是补历史管理，而阶段二已经覆盖了其中一半（来源标签、本地过滤）。

**什么前提成立时才重做**：SDK 提供通道侧会话分叉能力（可把同一会话复制成两条独立续接），且产品决定把「写作」与「问答」拆成两个入口——两者都不满足前，不做。

---

## 6. 实施计划

| 顺序 | 内容 | 主要文件 | 预估 |
|---|---|---|---|
| 1 | 阶段一：仓储 + 服务 + 两个删除挂载点 + DTO 计数 | `db/chatRepository.ts`、`chatService.ts`、`dashboardProvider.ts`、`accountService.ts`、`shared/types/{press,wechat}.ts`、`extension.ts`/`activation/wechatLayer.ts` | 1 人日 |
| 2 | 阶段二数据层与协议 | 同上 + `aiChatProvider.ts`、`shared/types/{aiChat,messages}.ts`、新增 `modules/ai/scopeLabel.ts` | 1.5 人日 |
| 3 | 阶段二前端 | `aichat/hooks/useAiChatHistory.ts`、`history/*`、`WorkflowAiChat.tsx` | 1.5~2 人日 |
| 4 | 阶段三（可选） | `scopeLabel` 与历史浮层 | 0.5 人日 |
| 5 | 文档 | `docs/modules/ai-chat.md` | 0.5 人日 |

**提交拆分建议**

1. `fix(ai): 删除作品与公众号账号时把会话归入通用对话`（阶段一，可独立发版）
2. `feat(ai): 历史浮层支持查看与迁移其它作用域的会话`（阶段二）
3. `docs(ai): 同步会话作用域与历史浮层协议`（收尾）

**新增单测**

- `escapeLike`：`%`、`_`、`\` 三类字符转义；前缀拼接后能匹配章节级与批次级旧路径、不误伤同名前缀以外的路径（如 `press/剑来后传`）。
- `readScopeLabel`：六种输入（作品、作品内文档、笔记、账号、微博、null）的 kind 与 label。
- `adoptScope`：精确值、前缀值、无匹配三类返回条数；活跃会话被归入时 `activeProjectDir` 置空。

---

## 7. 总验收清单

- [ ] 删除作品后，作品级与旧章节级会话都归入通用，其它作品不受影响
- [ ] 删除公众号账号后，账号级与旧批次级会话都归入通用
- [ ] 删除成功提示追加「另有 N 条历史对话已归入通用对话」，N 为 0 时不出现
- [ ] 作品 / 笔记 / 公众号默认历史与现状一致
- [ ] 全部态能看到其它对象会话，来源标签正确，本地过滤生效
- [ ] 从全部态迁移后，会话在原对象消失、在当前对象出现且处于选中态
- [ ] 迁移后草稿与待发上下文保留
- [ ] 非法 `projectDir`（盘符、上跳、反斜杠、超长）仍被拒绝
- [ ] `tsc --noEmit`、ESLint、Prettier 通过；新增纯函数有单测

---

## 8. 决策记录

| # | 决策 | 理由 | 改判条件 |
|---|---|---|---|
| 1 | 跨域取用选「移动」 | `sdk_session_id` 是通道续接凭据，复制到两条会话会让两侧 `resume` 追加到同一段通道历史；副本若清空该列只能走完整历史拼接，Token 更高且无续接收益 | SDK 提供通道侧会话分叉能力时 |
| 2 | 全部列表维持 50 条 + 本地过滤 | 上限已是 `SESSION_LIST_LIMIT = 50`，全部态直接复用；分组折叠需新聚合查询与展开态，而「全部」是低频入口 | 全部态日均使用超过 3 次，或出现「翻不到旧对话」反馈时先做分页 |
| 3 | 来源标签先显示 appid | 派生标签不读 `wechat.db`，避免 AI 模块反向依赖公众号库；appid 稳定，账号名可改可重名 | 用户反馈 appid 无法辨认账号时，在 provider 内加 60 秒缓存的账号名映射 |
| 4 | 不新增 `origin_scope` 列 | 需求本质是「让用户知道发生了什么」，回包计数即可满足；建列要走 DDL v9 迁移 + 列表展示，约 1 人日 | 需要按「原属作品」筛选历史时，同时提供回填脚本 |

---

## 9. 影响面清单

**修改**

- `src/modules/ai/db/chatRepository.ts`：查询拆分、`updateConversationScope`、`adoptConversationScope`、`escapeLike`
- `src/modules/ai/chatService.ts`：`listSessions(scope, all)`、`moveSession`、`adoptScope`
- `src/modules/ai/aiChatProvider.ts`：`ai/sessions` 的 `all`、新协议 `ai/session/move`
- `src/shared/types/aiChat.ts`：`AiConversationSummary` 扩字段
- `src/shared/types/messages.ts`：`HostMethodName` 白名单
- `src/shared/types/press.ts`、`src/shared/types/wechat.ts`：删除回包加 `adoptedConversations`
- `src/modules/common/dashboardProvider.ts`：`attachAiScopeJanitor` + 删除作品时调用
- `src/modules/wechat/accountService.ts`、`src/activation/wechatLayer.ts`：删除账号时调用
- `src/extension.ts`：装配顺序补一行注入
- `src/workflow/aichat/{WorkflowAiChat.tsx,hooks/useAiChatHistory.ts,history/*}`：两态历史与迁移编排
- `src/dashboard/{press/hooks/usePressProjectDetail.ts,wechat/hooks/useWechatAccounts.ts}`：删除提示追加计数

**新增**

- `src/modules/ai/scopeLabel.ts`：来源标签派生（纯函数）
- `__tests__/aiScopeLabel.test.ts`、`__tests__/aiScopeAdopt.test.ts`

**不改**

- `conversations` 表结构与 DDL
- 写回链路、通道续接链路、`contentScope` 的作用域粒度
