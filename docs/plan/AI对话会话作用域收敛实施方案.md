# AI 对话会话作用域收敛实施方案

> 上位设计：`docs/plan/AI对话作用域收敛方案与全局助手评估.md`（决策依据、全局助手评估见彼处，本文只给执行步骤）
> 缺陷编号沿用设计文档：D1 历史无法跨作用域查看、D2 删除对象后会话孤儿、D3 无迁移入口
> 完成定义（每个任务均适用）：代码 + 单测 + `tsc --noEmit` + ESLint + Prettier + 对应人工验证项
> 行号仅作定位参考，实施时以实际代码为准
> 实施状态（2026-11-23）：阶段一、阶段二、收尾已完成；阶段三（来源失效标注）按触发条件暂不实施；下方与实现不一致处已在文内标注

---

## 0. 前置约束

1. 不改 `conversations` 表结构，不新增 DDL，不做存量数据迁移。
2. 新增协议只增不改：`ai/sessions` 保持可取 `projectDir`，`all` 为可选参数。
3. 一切前端传入路径在宿主侧走 `toSafeSegments`，不接受盘符、上跳、反斜杠。
4. 阶段一独立成一个提交，可单独发版；阶段二才动界面。
5. 不改写回链路与通道续接链路。

---

## 1. 阶段一：失效会话归入通用（D2）

### T1.1 仓储层：按作用域归入通用

**文件**：`src/modules/ai/db/chatRepository.ts`

**实现**

```ts
/** LIKE 通配符转义：路径里的 \ % _ 不参与匹配，配合 ESCAPE '\' 使用 */
export function escapeLike(value: string): string

/** 把某作用域及其子路径下的会话归入通用对话，返回改动行数 */
export function adoptConversationScope(db: Database.Database, scope: string): number
```

```sql
UPDATE conversations
   SET project_dir = NULL
 WHERE project_dir = @scope
    OR project_dir LIKE @prefix ESCAPE '\'
```

- `@prefix = escapeLike(scope) + '/%'`。
- 前缀分支必须保留：存量存在按章（`press/剑来/第一章.md`）与按篇（`wechat/{appid}/post/{时间戳}/x.md`）建立的会话。
- JS 字符串里 `ESCAPE '\'` 要写成 `"ESCAPE '\\'"`，否则 SQLite 收到的是未转义的引号。
- 用 `run().changes` 作为返回条数。

**DoD**

- `escapeLike` 对 `\`、`%`、`_` 三类字符均转义。
- 归入条数覆盖「精确值命中」「子路径命中」两种情况。

### T1.2 服务层：adoptScope

**文件**：`src/modules/ai/chatService.ts`

```ts
/** 把某作用域及其子路径下的会话归入通用对话；活跃会话在其中时同步作用域为 null */
public adoptScope(scope: string): number
```

- 入参先 `toSafeSegments(scope, '对话作用域')` 归一，再调仓储。
- 若 `activeConversationId` 属于该作用域（比较归一后的 `activeProjectDir` 前缀），把 `activeProjectDir` 置 `null`。
- 不做日志脱敏方面的额外处理，只记 `logger.info` 条数。

**DoD**：返回值等于仓储改动行数；活跃会话被归入后，后续 `useScope` 不会把新引用写回旧作用域。

### T1.3 装配：仪表盘侧注入

**文件**：`src/modules/common/dashboardProvider.ts`、`src/extension.ts`

- `DashboardViewProvider` 新增私有字段与注入方法，放在现有 `attachTodoRoutes` / `attachWechatRoutes` 附近（约 L243-262）：

```ts
private aiScopeJanitor: { adoptScope(scope: string): number } | null = null
public attachAiScopeJanitor(janitor: { adoptScope(scope: string): number }): void
```

- `extension.ts` 在 `dashboardProvider.attachTodoRoutes(...)` 同一段落（约 L371-373）追加：

```ts
dashboardProvider.attachAiScopeJanitor({ adoptScope: (scope) => ai.chat.adoptScope(scope) })
```

- 顺序说明：`DashboardViewProvider` 创建于 `assembleAiLayer` 之前（L173 早于 L228），因此只能后置注入，与现有 `attachWeiboEnhance` 同一模式。

**DoD**：注入前 `aiScopeJanitor` 为 `null`，删除作品不会抛错（按 0 处理）。

### T1.4 删除作品时调用

**文件**：`src/modules/common/dashboardProvider.ts`（`deletePressProject`，约 L1296-1307）、`src/shared/types/press.ts`

- 在 `await deleteProject(...)` 之后、`this.workflowRouter.clearProject()` 之前：

```ts
const adoptedConversations = this.aiScopeJanitor?.adoptScope(payload.dirPath) ?? 0
```

- `DeletePressProjectResult` 增加 `adoptedConversations: number`，回包带上。
- `payload.dirPath` 已由 `hasProjectFiles` 校验过形态（`press/{作品名}`），仍由服务层再归一一次。

**DoD**：删除作品回包带计数；删除动作本身的成功提示与跳转行为不变。

### T1.5 删除公众号账号时调用

**文件**：`src/modules/wechat/accountService.ts`、`src/activation/wechatLayer.ts`、`src/extension.ts`、`src/shared/types/wechat.ts`

- `WechatAccountServiceDeps` 增加可选 `onAccountRemoved?: (appId: string) => number`。
- `remove()`（约 L189-202）在 `await this.removeAccountDirectory(existing.app_id)` 之后调用回调，把返回值累加到 `RemoveWechatAccountResult.adoptedConversations`；`existing === null` 提前返回时计数为 0。
- `WechatLayerDeps` 增加同名字段，`assembleWechatLayer` 透传给 `new WechatAccountService({...})`。
- `extension.ts` 的 `assembleWechatLayer({...})` 传 `onAccountRemoved: (appId) => ai.chat.adoptScope(\`wechat/${appId}\`)`。
- 顺序：`wechatLayer` 在 `assembleAiLayer` 之后创建（L377 晚于 L228），可直接传回调，无需后置注入。

**DoD**：删除账号回包带计数；账号目录删除失败的既有降级逻辑（只记日志）不受影响。

### T1.6 前端提示追加计数

**文件**：`src/dashboard/press/hooks/usePressProjectDetail.ts`（`deleteProject`，约 L218-230）、`src/dashboard/wechat/hooks/useWechatAccounts.ts`（`removeAccount`，约 L185-200）

- 现有 `toast.success(...)` 文案后追加一句，`adoptedConversations > 0` 时才加：`另有 N 条历史对话已归入通用对话`。
- 不改弹窗与按钮状态，不改失败分支。

**DoD**：计数为 0 时不出现追加文案；失败提示保持原样。

### T1.7 单测

**文件**：`__tests__/chatRepository.test.ts`（已在用真实 SQLite 临时库 + `openAiDatabase` + `ensureAiSchema`）

- `adoptConversationScope` 三条用例：精确命中、子路径命中（章节级 / 批次级）、不误伤同前缀（`press/剑来` 不得命中 `press/剑来后传`）。
- `escapeLike` 对 `%`、`_`、`\` 的输出。

**DoD**：新用例通过，既有 `chatRepository` 用例不回归。

### T1.8 旧粒度会话一次性归并（实施时新增）

**文件**：`src/modules/ai/db/chatRepository.ts`、`src/modules/ai/chatService.ts`、`src/activation/aiLayer.ts`

- `mergeLegacyScopes(db)`：把 `press/{作品}/...` 归到 `press/{作品}`、`wechat/{appid}/...` 归到 `wechat/{appid}`；只改 `project_dir`，不动 `updated_at` 与 `sdk_session_id`；同一目标已有会话时并列保留、不合并消息；非账号形态的旧路径跳过。
- `AiChatService.mergeLegacyScopes()` 转发并记日志；`assembleAiLayer` 在 `ensureAiSchema` 之后按 `globalState` 版本键（`ai.sessionScope.merged.v1`）跑一次，失败不写标记、下次激活重试。
- 单测：章节归并 / 批次归并 / 新口径不动 / 不刷新活跃时间 / 非账号形态跳过。

**DoD**：归并前后消息数与通道会话号不变；同一作用域多条会话可在历史页切换。

---

## 2. 阶段二：历史双态 + 跨域迁移（D1、D3）

### T2.1 类型与协议白名单

**文件**：`src/shared/types/aiChat.ts`、`src/shared/types/messages.ts`

- `AiConversationSummary` 增加：

```ts
scopeKind: AiConversationScopeKind   // 'press' | 'note' | 'wechat' | 'weibo' | null
scopeLabel: string                   // 宿主按路径派生，恒有值（兜底「通用对话」）
scopeKey: string | null              // 原始作用域键：前端据此判断是否需要迁移
```

- `HostMethodName` 按字母序在 `'ai/session'` 与 `'ai/sessions'` 之间插入 `'ai/session/move'`。

**DoD**：`tsc --noEmit` 通过；所有构造 `AiConversationSummary` 的位置补齐新字段（只有 `chatService.listSessions` 一处）。

### T2.2 来源标签派生（纯函数）

**文件**：新增 `src/modules/ai/scopeLabel.ts`

```ts
export function readScopeLabel(scope: string | null): {
    kind: 'press' | 'note' | 'wechat' | 'weibo' | null
    label: string   // 恒有值：解析不了的一律回落「通用对话」
}
```

| 输入 | kind | label |
|---|---|---|
| `press/剑来` | `press` | `剑来` |
| `press/剑来/第一章.md`（存量） | `press` | `剑来` |
| `notes/随手记.md` | `note` | `随手记` |
| `wechat/wx1234567890` | `wechat` | `wx1234567890` |
| `weibo` | `weibo` | `微博` |
| `null` | `null` | `通用对话` |
| 其它前缀 | `null` | `通用对话` |

- 只按路径段派生，不查库、不依赖 `wechat.db`。
- 取段前先按 `toSafeSegments` 归一，非法值回落通用对话。

**DoD**：纯函数，无 vscode 依赖，可直接单测。

### T2.3 仓储层：查询拆分 + 改归属

**文件**：`src/modules/ai/db/chatRepository.ts`

- 保留 `listConversations` 原名（语义已由注释说明，避免无收益的重命名与测试波及）。
- 新增 `listRecentConversations(db, limit)`：无 `WHERE`，按 `updated_at DESC`。
- 新增 `updateConversationScope(db, id, projectDir)`：只改 `project_dir`，不动 `updated_at`（时间由服务层决定）。

**DoD**：既有 `getLatestConversation` 行为不变；拆分后两查询都有用例。

### T2.4 服务层：listSessions 扩展 + moveSession

**文件**：`src/modules/ai/chatService.ts`

```ts
public listSessions(scope: string | null, all: boolean): AiConversationSummary[]
public moveSession(conversationId: string, projectDir: string | null): boolean
```

- `listSessions`：`all` 为 true 走 `listRecentConversations`，否则走 `listScopedConversations`；每条用 `readScopeLabel(row.projectDir)` 填 `scopeKind` / `scopeLabel`。
- `moveSession`：会话不存在返回 false；否则 `updateConversationScope` → `touchConversation(now)` → 若为活跃会话同步 `activeProjectDir`。
- **必须 touch**：不更新 `updated_at` 时，`getLatestConversation` 仍可能取到该作用域原来那条，表现为「迁移成功但打开的不是刚才那条」。
- 顺带修正 `getOrCreateSession` 上方注释（约 L286-290）：还写着「每个文档一份对话」，与现在的四类粒度不符，改为指向 `contentScope.readScopeDir` 的粒度口径。

**DoD**：迁移后 `getLatestConversation(新作用域)` 返回该会话；旧作用域不再返回它。

### T2.5 协议：ai/sessions 的 all 与 ai/session/move

**文件**：`src/modules/ai/aiChatProvider.ts`

- `case 'ai/sessions'` 改用新的载荷收窄：

```ts
function readSessionsPayload(payload: unknown): { projectDir: string | null; all: boolean }
```

  `projectDir` 复用 `readScopePayload` 的规则；`all` 非布尔或缺省按 false，返回值字段命名为 `isAll`（布尔变量命名规范）。
- 新增 `case 'ai/session/move'`：

```ts
function readMoveSessionPayload(payload: unknown): { conversationId: string; projectDir: string | null }
```

  `conversationId` 走 `readConversationIdPayload`；`projectDir` 走 `readScopePayload`（允许 `null`）。
- 返回 `{ moved: boolean }`。

**DoD**：非法 `projectDir`（盘符、上跳、反斜杠、超长）仍被拒绝；`all: true` 时 `projectDir` 被忽略。

### T2.6 前端：历史数据层

**文件**：`src/workflow/aichat/hooks/useAiChatHistory.ts`

- 增加 `mode: 'scope' | 'all'`、`setMode`，`loadSessions()` 保持无参（内部读当前 mode），避免破坏 `useAiChatSession` 里 `refreshSessions` 的引用稳定性。
- 请求体按 mode 传 `all`。

**DoD**：切 mode 后打开历史浮层能拿到对应列表；`loadSessions` 引用稳定（依赖数组不含每次新建对象）。

### T2.7 前端：历史页 UI

**文件**：`src/workflow/aichat/history/AiChatHistoryPage.tsx`（实施时由浮层改为整页，原来的 `AiChatHistoryMenu` / `AiChatHistoryItem` 已删除）

- 页面外壳取 `@webview/components/AppPage`：`align="start"` 的标题行左侧放返回按钮，下方 `AppMenu` 放范围切换，`AppContent isScrollable` 承载过滤框与列表。
- 范围切换用 `@webview/components/SegmentedRail`（项目内已广泛使用）。
- 过滤输入框（`@components/ui/input`）按标题子串过滤当前 50 条，纯前端；两态都显示。
- 筛选标签为「当前 / 全部 / 笔记 / 作品 / 公众号 / 微博 / 通用对话」：除「当前」外都由全区列表在前端切分，单一来源标签只列对应来源（`general` 对应无归属的通用对话）；从「全部」切到单一来源不重复请求，只有跨越「当前 ↔ 全区」才拉一次。
- 列表不分组：所有筛选结果都是一列，按宿主返回的时间倒序；来源只体现在每行的「作品 · 剑来」这类文字上，不渲染组标题。
- 列表行用 `@components/ui/item`：标题 + `来源 · 相对时间`；当前会话以主色边框区分；整行键盘可达（Enter / 空格），删除按钮 `stopPropagation`。
- 空态用 `Empty`：无记录与「没有匹配」两种文案。

**DoD**：两态切换无闪烁；行高稳定；删除按钮不触发选中；键盘可完成选择。

### T2.8 前端：迁移编排

**文件**：`src/workflow/aichat/WorkflowAiChat.tsx`

```ts
handleSelectFromAll(item: AiConversationSummary): void
```

流程：

```
若 item 属于当前作用域 → 直接 switchSession(item.id) → 回到对话页
否则 → AlertDialog（该对话将移动到当前对象）
     → request('ai/session/move', { conversationId, projectDir: 当前作用域 })
     → request('ai/switchSession', { conversationId })
     → 回到对话页 → loadSessions() 刷新当前态列表
```

- 用 `@webview/components/AlertDialog`（项目内已广泛使用）。
- 迁移失败只提示，不切会话；切换失败同样只提示。
- 不合并成一个复合协议：两步失败要能分别提示。
- 历史页删除行时由页面直接调 `deleteSession` 并重拉列表，不走切换逻辑。

**DoD**：迁移后当前对象处于该会话选中态；取消确认不产生任何请求。

### T2.9 单测

- `__tests__/aiScopeLabel.test.ts`（新增）：六类输入 + 未知前缀 + 非法路径。
- `__tests__/chatRepository.test.ts`：`listRecentConversations` 返回跨作用域全集；`updateConversationScope` 只改归属。
- `__tests__/chatService.test.ts`（已在用假通道 + 临时库）：`moveSession` 迁移后 `getLatestConversation` 命中该会话；会话不存在返回 false；`listSessions(scope, true)` 返回跨作用域条目且带标签。

**DoD**：新增用例通过，既有会话相关用例不回归。

---

## 3. 阶段三（可选）：来源失效标注

**T3.1**：全部态里对 `scopeKind !== null` 且来源路径已不存在的条目，来源行显示 `来源已失效`。

- 依赖宿主能拿到现存清单（作品清单、笔记路径、账号 appid）。最省事的实现：`ai/sessions` 的 `all` 分支里，借 `press` 与 `wechat` 已有路由取一次清单做比对。
- 不自动改写、不做开机扫描；比对失败不影响列表渲染，降级为不标注。
- 触发条件：用户反馈「外部删目录导致会话堆积」再实施。

---

## 4. 收尾：文档与遗留注释

**T4.1**

- `docs/modules/ai-chat.md` 第 6 节「会话作用域」补「软作用域」口径；协议表补 `all` 与 `ai/session/move`；「已知差异」条目里把指向设计文档的那句改为指向本实施文档的实施状态。
- `chatService.getOrCreateSession` 的旧注释（每个文档一份对话）修正（T2.4 已含）。
- 工作日志按惯例记录。

---

## 5. 提交计划

| # | 提交信息 | 范围 |
|---|---|---|
| 1 | `fix(ai): 删除作品与公众号账号时把会话归入通用对话` | 阶段一（含单测） |
| 2 | `feat(ai): 历史浮层支持查看与迁移其它作用域的会话` | 阶段二（含单测） |
| 3 | `docs(ai): 同步会话作用域与历史浮层协议` | 收尾 |

阶段三单独提交（若实施）。

---

## 6. 测试计划

| 层面 | 用例 |
|---|---|
| 纯函数 | `escapeLike` 三类通配符；`readScopeLabel` 六类 + 未知前缀 |
| 仓储 | `adoptConversationScope` 精确 / 前缀 / 不误伤；`listRecentConversations` 跨作用域；`updateConversationScope` |
| 服务 | `moveSession` 迁移与 touch；`adoptScope` 返回条数与活跃作用域复位；`listSessions(scope, true)` |
| 回归 | 现有 `chatRepository` / `chatService` / `wechatIssue` / `workflowContentScope` 全通过 |

执行：`pnpm run typecheck && pnpm exec eslint <改动文件> && pnpm exec vitest run <相关测试> && pnpm exec prettier --check <改动文件>`

---

## 7. 人工验证清单（由使用者手工执行）

1. 打开一个作品，右侧对话正常；切到另一章，仍是同一份对话。
2. 删除作品 A：提示里出现「另有 N 条历史对话已归入通用对话」；打开根目录文档，历史浮层「全部」里能看到 A 的会话，来源为「通用对话」；作品 B 的会话不受影响。
3. 删除一个公众号账号：提示同上；该账号的会话进入通用。
4. 在作品 B 的历史浮层切到「全部」，选中作品 C 的一条会话 → 确认 → 当前对话变成该会话；再打开作品 C，历史里已没有这条。
5. 迁移后检查输入框：之前未发送的草稿与待发上下文仍在。
6. 全部态过滤框输入作品名，列表即时收窄。

---

## 8. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| `adoptConversationScope` 转义写错，误伤其它作品的会话 | 单测覆盖同前缀（`press/剑来` 与 `press/剑来后传`）；上线前在真实库副本上跑一次 `SELECT COUNT(*)` 核对命中范围 | 代码可 revert；**已置 NULL 的数据不可还原**，因此核对必须在真实删除前完成 |
| `moveSession` 忘记 touch，迁移后打开的不是该会话 | T2.4 明确要求；单测直接断言 `getLatestConversation` | 代码 revert，数据无副作用 |
| 全部态误把当前作用域会话再迁移一次 | 迁移前判断 `item.scopeLabel` 对应作用域与当前一致则跳过 | 无需回滚 |
| 新增协议被旧前端调用 | 只增不改，旧调用不传 `all` 即走原分支 | 前端回退即可 |

---

## 9. 任务看板

| 编号 | 任务 | 预估 | 依赖 |
|---|---|---|---|
| T1.1 | 仓储：`escapeLike` + `adoptConversationScope` | 0.3 人日 | — |
| T1.2 | 服务：`adoptScope` | 0.1 人日 | T1.1 |
| T1.3 | 装配：仪表盘注入 | 0.1 人日 | T1.2 |
| T1.4 | 删除作品挂载 + DTO | 0.15 人日 | T1.3 |
| T1.5 | 删除账号挂载 + DTO | 0.2 人日 | T1.2 |
| T1.6 | 前端提示追加计数 | 0.1 人日 | T1.4、T1.5 |
| T1.7 | 阶段一单测 | 0.2 人日 | T1.1-T1.5 |
| T2.1 | 类型与协议白名单 | 0.1 人日 | — |
| T2.2 | `readScopeLabel` 纯函数 | 0.2 人日 | T2.1 |
| T2.3 | 仓储查询拆分 + 改归属 | 0.3 人日 | — |
| T2.4 | 服务：`listSessions` / `moveSession` | 0.4 人日 | T2.2、T2.3 |
| T2.5 | 协议分支与收窄 | 0.3 人日 | T2.4 |
| T2.6 | 前端历史数据层 | 0.3 人日 | T2.5 |
| T2.7 | 前端浮层 UI | 0.6 人日 | T2.6 |
| T2.8 | 迁移编排 | 0.4 人日 | T2.7 |
| T2.9 | 阶段二单测 | 0.4 人日 | T2.1-T2.8 |
| T3.1 | 来源失效标注（可选） | 0.5 人日 | T2.9 |
| T4.1 | 文档与注释收尾 | 0.5 人日 | 全部 |
