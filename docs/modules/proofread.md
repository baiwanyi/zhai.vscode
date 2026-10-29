# Proofread（校对）— 模块设计文档

**版本**：0.3
**日期**：2026-10-25
**状态**：本地规则检查、定位与批量写回、AI 病句 / 风险段落、朱雀 AI 特征检测已落地；词库图形化编辑待接入
**宿主**：VSCode 插件 Zhai（宅写作）
**入口**：写作管理页右侧导航「校对」分区

---

## 1. 模块定位

面向章节正文与笔记文档的**逐条可定位、可写回**的校对工具，与「AI 对话」中的一次性校对命令互补：

| 能力 | AI 对话「校对」命令 | 本模块 |
|---|---|---|
| 交互 | 一问一答，结果在消息流里 | 检查卡 + 问题列表，逐条定位到编辑器 |
| 结果 | 自然语言列表 | 结构化条目（类别、偏移、建议、段落号） |
| 写回 | 不提供（report 策略） | 低风险条目可单条或批量写回 |
| 词库 | 无 | 自定义纠错词库 + 忽略词 |
| 成本 | 每次消耗 token | 本地规则零成本、毫秒级 |

## 2. 分层策略

| 检查项 | 实现层 | 状态 |
|---|---|---|
| 错别字（内置词表） | 本地 | 已落地 |
| 标点（半角、连续、省略号、破折号） | 本地 | 已落地 |
| 重复（虚词叠字、相邻短语） | 本地 | 已落地 |
| 自定义纠错（用户词库） | 本地 | 已落地 |
| 病句 | AI | 已落地 |
| 风险段落 | AI | 已落地 |
| 人工 / 疑似 AI / AI 特征占比 | 朱雀 `zhuque-text` 接口 | 已落地 |

取舍依据：项目无中文分词依赖，纯本地的错字召回有限但零成本、可解释；语义级判断（病句、段落风险）本地不可行，交由 AI 且**只提示不写回**；AI 特征检测本地不可能，走第三方接口且需用户显式同意上传正文。

## 3. 数据契约

`src/shared/types/proofread.ts`：

- `ProofreadCategory`：`typo | sentence | risk | custom`
- `ProofreadIssue`：`id / category / severity / quote / start / end / replacement / reason / source / paragraph`
- `ProofreadTarget`：`kind / path / title / text / wordCount / offsetBase / mtime / truncated`
- `ProofreadLexicon`：`version / entries / ignores`

**偏移口径**：所有 `start` / `end` 均以 `target.text` 为基准。整篇检查时 `text` 已剔除 Frontmatter，`offsetBase` 记录正文在文档全文中的起点；选区检查时 `offsetBase` 为选区起点。定位与写回时编辑器偏移 = `offsetBase + issue.start`，两种模式共用一套换算。当前页面固定整篇检查，选区能力只在宿主侧保留（`readTarget(useSelection)`），便于后续入口复用。

**严重度与可写回**：`low` 为确定性替换（错别字、标点、重复字、词库 `replace`），可一键写回；`medium`（词库 `flag`、相邻短语重复）与 `high`（风险段落）只提示。

## 4. 协议

| 方法 | 入参 | 返回 |
|---|---|---|
| `proofread/target` | `{ useSelection?: boolean }` | `ProofreadTarget \| null` |
| `proofread/local` | `{ useSelection?: boolean }` | `{ target, local } \| null` |
| `proofread/ai` | `{ useSelection?: boolean }` | `ProofreadAiResult \| null` |
| `proofread/ai/abort` | — | `{ aborted: boolean }` |
| `proofread/aiDetect` | `{ useSelection?: boolean }` | `ProofreadAiDetectResult \| null` |
| `proofread/aiDetect/state` | — | `ProofreadAiDetectState` |
| `proofread/aiDetect/consent` | `{ accepted: boolean }` | `ProofreadAiDetectState` |
| `proofread/apply` | `{ path, offsetBase, edits[] }` | `{ applied, skipped }` |
| `proofread/reveal` | `{ path, documentStart, documentEnd }` | `{ revealed }` |
| `proofread/lexicon` | — | `ProofreadLexiconState` |
| `proofread/lexicon/open` | — | `ProofreadLexiconState` |

返回 `null` 表示当前没有活跃编辑器（前端展示引导空态，不弹错误）。协议方法名同时登记在 `src/shared/types/messages.ts` 的 `HostMethodName`，由 `AiChatViewProvider` 按 `proofread/` 前缀委托给 `ProofreadRoutes`。

## 5. 宿主实现

```
src/modules/proofread/
├── proofreadRoutes.ts        入参收窄与分发
├── proofreadService.ts       目标读取、检查、写回、定位、词库入口
├── target/
│   ├── targetReader.ts       活跃编辑器取正文、Frontmatter 剔除、截断、文档版本号
│   └── documentEditor.ts     WorkspaceEdit 批量写回与区间定位
├── ai/
│   ├── proofreadPrompt.ts    分批切分、单批提示词、模型输出校验与偏移回查
│   └── aiProofreader.ts      分批串行调用、超时与取消、用量累加
├── detect/
│   ├── zhuqueClient.ts       朱雀接口调用、超时与响应收窄
│   └── aiDetector.ts         结果整形与非人工分段挑选
├── textPosition.ts           行首索引与段落号换算（本地与 AI 共用）
├── local/
│   ├── localChecker.ts       规则聚合、代码区间过滤、忽略词、去重、段落号
│   ├── localTypes.ts         LocalHit 中间结构
│   ├── ignoredRanges.ts      围栏代码块与行内代码区间
│   ├── data/typoWords.ts     内置错别字对照表（约 80 组）
│   └── rules/                punctuation / repeat / typo / lexicon
└── lexicon/lexiconStore.ts   读写 {存储根}/proofread.json
```

**安全约束**

- 路径：一律 `toStorageRelativePath` + `toSafeSegments` 归一与校验，只接受存储根内的 `file` scheme 文档。
- 写回：逐条回查 `quote` 与文档内容逐字相符，区间不重叠，单条区间 ≤ 400 字符、替换文本 ≤ 200 字符、单次 ≤ 500 条；写前调用快照留底（与 AI 写回同一策略），写后由索引服务重建字数。
- 词库：解析逐字段收窄并限长，损坏时降级为空库并记日志，不阻断校对。

## 6. 自定义词库

文件：`{storage.rootPath}/proofread.json`（直接位于存储根，与 `notes/`、`press/` 等一级目录平级），用户可直接编辑；「设置词库」按钮由宿主在编辑器中打开（缺失时先落骨架）。

```json
{
    "version": 1,
    "entries": [{ "wrong": "按耐不住", "right": "按捺不住", "mode": "replace" }],
    "ignores": ["角色名"]
}
```

- `mode: replace` 参与一键写回；`mode: flag` 只提示（主观用词偏好）。
- `ignores` 为忽略词，命中窗口内出现即跳过，用于角色名、专有名词。

## 7. AI 检查实现

**执行顺序**：本地检查先出结果（毫秒级、可离线），AI 检查随后补检病句与风险段落；AI 失败只影响这两张卡，不影响已出的本地结果。页面「AI 检查」开关关闭时只跑本地规则。

**分批**：按 `zhai.proofread.batchChars`（默认 1200 字）切分，优先在换行处断开，纯空白片段不送检但保留偏移。批次串行提交，单批 45 秒超时。

**防幻觉（关键约束）**

1. 提示词只允许模型返回 `{kind, quote, suggestion, reason}`，**不允许返回位置**。
2. 偏移一律由宿主在**该批原文**中 `indexOf(quote)` 回查，再加上批次起始偏移换算成全文偏移。
3. `quote` 未命中原文、长度不在 4–200、`kind` 非 `sentence`/`risk`、同区间重复报告 —— 全部丢弃并计入 `dropped`。
4. AI 条目 `replacement` 恒为 `null`：病句与风险段落只提示，不提供一键写回，避免模型改写文风。
5. 与本地结果区间重叠时，前端保留本地条目（本地是确定性规则，优先级更高）。
6. AI 结果带回 `path` 与文档 `version`；与本地目标的版本不一致即整批丢弃并提示「正文在检查期间发生变化」。

**解析容错**：模型输出可带代码围栏与前后解释；`{"items":[…]}` 与裸数组都接受。截取最外层 JSON 时按最先出现的 `[` / `{` 决定括号对，避免把裸数组截成单个对象。

**取消与失败**：外部取消经 AbortController 转发到通道，向上抛出「已取消」，前端不显示为错误；单批失败只计数并提示「有 N 批未完成」，其余批次结果照常展示。

**配额与记账**：每次 AI 检查前校验 `zhai.proofread.aiDailyLimit`，成功后 `consumeToday` 递增并按 `module: 'proofread'` 写入用量库；取消与失败不占额度。同一时刻只允许一个 AI 检查任务。

**进度**：宿主按批通过 state 的 `proofread` 通道推送 `{ kind: 'progress', batch, total }`，页头徽标与检查卡显示「AI 2/3」。

## 8. AI 特征检测（朱雀）

**用途**：对当前正文判断「人工创作 / AI 生成 / 疑似 AI」占比，作为表达习惯的自查参考，**不参与任何自动改写**。

**接口**：`POST https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify`

| 项 | 取值 |
|---|---|
| 鉴权 | `Authorization: Bearer <MAKERS_MODELS_KEY>`，Key 存 `SecretStorage`（`zhai.zhuque.apiKey`），命令 `zhai.proofread.setZhuqueKey` 录入，留空即清除 |
| 请求体 | `{ text, is_merge: false }` —— 必须关闭合并才能拿到段落级结果 |
| 超时 | 25 秒 |

**响应映射**

| 平台字段 | 用途 |
|---|---|
| `labels_ratio["0"/"1"/"2"]` | 人工 / AI / 疑似 AI 三比例，按总和归一化（平台可能返回百分数，故不先夹到 1） |
| `softmax_confidence` | 整体置信度，展示用 |
| `ratio_confidence` | 整体疑似占比，展示用 |
| `segment_labels[]` | `label / conf / order / position[start,end]`；`label !== 0` 且按 `conf` 降序取前 5 条作为「最值得复核的段落」，`position` 越界即丢弃 |
| `makers_models_usage.total_tokens` | 本次实际扣减额度（官方口径），`usage.total_tokens` 不参与核算 |
| `status` / `msg` | 非 `success` 时直接抛出 `msg` |

**隐私与额度**

- 正文会上传至第三方：首次检测前必须弹窗确认，同意标记存 `globalState`（`proofread.zhuqueConsent`）；未同意不发出请求。
- 每日次数受 `zhai.proofread.zhuqueDailyLimit` 限制（计数键 `proofread_zhuque_*`），只有检测成功才消耗。
- 结果页固定展示官方免责语：本结果仅为辅助判断，不应作为任何审核或处罚的决定性依据。

**体积控制**：环形图单独成文件（`layout/ProofreadDetectChart.tsx`），由检测卡以 `React.lazy` 动态载入，recharts 只在出结果后才进入运行时，主包不受影响。

## 9. 界面结构

`src/workflow/proofread/`

- `index.tsx`：`AppPage` 三区装配（目标信息 / 检查卡 / 底部操作）。
- `layout/ProofreadCheckList.tsx`：四张检查卡（单字徽标 错/病/险/纠 + 状态徽标 + 命中列表）。
- `layout/ProofreadIssueItem.tsx`：单条问题的「原文 → 建议」、理由、段落号与 应用 / 定位 / 忽略。
- `layout/ProofreadAiDetectCard.tsx`：AI 特征检测卡（未配置密钥 / 待检测 / 检测中 / 失败 / 已完成五态 + 上传同意弹窗）。
- `layout/ProofreadDetectChart.tsx`：环形图与图例，动态加载。
- `layout/ProofreadLexiconDialog.tsx`：词库编辑弹窗（词条增删改 + 忽略词），草稿在挂载时初始化，由 `sessionKey` 控制重建。
- `hooks/useProofreadRun.ts`：本地规则与 AI 两阶段编排、忽略集合、进度订阅、单条与批量写回、定位（不含取消，页面侧不提供取消入口）。
- `hooks/useProofreadAiDetect.ts`：检测状态、同意流程、密钥配置入口与额度刷新。
- `hooks/useProofreadLexicon.ts`：词库状态摘要、完整词库按需读取、保存与打开文件。

**AI 触发时机**：进入页面、切换底部「AI 检查」开关与写回后都只跑本地规则（`run('local')`，毫秒级、不消耗额度）；AI 语义与风险段落检查只由底部「开始校对」显式触发（`run()` 即 `full`），开关关闭时该按钮同样只跑本地。打开页面、编辑正文都不应产生模型调用。

**时长预算**：AI 检查按批串行，单批超时 45s，整体预算 240s（`runAiProofread` 的 `budgetMs`）。预算不足 8s 时不再开新批，剩余批次计入 `skippedBatches`，已得结果照常返回；前端 `proofread/ai` 的等待上限 300s 必须大于该预算，否则会出现宿主仍在跑、前端先超时丢结果。批次未覆盖（失败 + 跳过）时，界面不得给出「未发现问题」的结论，改为提示「N 批未完成，结果可能不完整」。

**结果缓存**：宿主 `src/modules/proofread/cache/resultCache.ts` 把最近一次校对结果与检测结果分别写入 globalState（键 `proofread.resultCache` / `proofread.detectCache`）。打开页面先取 `proofread/cache`，命中即直接还原（不重跑本地、不发 AI）；未命中或正文已变才跑本地。缓存签名由 `path / kind / offsetBase / mtime / 正文字符数` 组成，任一项变化即视为过期，宁可重跑也不能把旧偏移标到新正文上；缓存读入逐字段收窄，结构不符整份作废。还原出的 target 不含正文，写回与定位仍由宿主回查文档。有结果（还原或跑过完整校对）时底部按钮文案为「重新校对」。

接口：`proofread/cache`（校对结果）、`proofread/aiDetect/cache`（检测结果），两者都按当前编辑器正文签名校验，未命中返回 `null`。

状态口径：本地类别显示「检测中 / 发现 N 处 / 未发现问题 / 未检测」；AI 类别区分「AI 检查中（带批次）/ 检查失败 / 未执行（等待点击开始校对或 AI 已关）/ 发现 N 处 / 未发现问题」，失败与未执行不得显示成通过结论。

**进行中与不可取消**：AI 逐批检查期间，病句与风险段落两张卡的徽标内带加载动画，无批次进度时显示「AI 检查中」、有进度时显示「AI 1/3」；底部主按钮只显示加载动画、不显示文案且禁用（`Button` 的 `isLoading` 已同时承担替换内容、禁用与丢弃点击），页面不提供取消入口。AI 阶段的上限由宿主的批次预算（240s）保证，前端等待上限 300s 仅作兜底。

## 10. 配置

| 配置项 | 默认 | 说明 |
|---|---|---|
| `zhai.proofread.maxChars` | 20000 | 单次校对正文长度上限，超出截断并在页头标记 |
| `zhai.proofread.aiDailyLimit` | 30 | AI 校对每日次数上限，计数键 `proofread_ai_*` 记在 press.db，与出图、取名分账 |
| `zhai.proofread.batchChars` | 1200 | AI 校对单批字符数，越小批次越多、进度越细 |
| `zhai.proofread.zhuqueDailyLimit` | 10 | AI 特征检测每日次数上限，计数键 `proofread_zhuque_*` |

## 11. 后续阶梯

1. **与「去 AI 味」联动**：AI 特征报告中的高占比段落一键送入 AI 对话继续改写。
