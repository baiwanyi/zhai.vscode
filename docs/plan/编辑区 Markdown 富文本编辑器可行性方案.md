# 编辑区 Markdown 富文本编辑器（复制 / 划线 / 批注 / AI 查询）可行性方案

**版本**：1.5
**日期**：2026-11-12
**状态**：方案评审（Notion-like 基座定为开源自建，附扩展清单与依赖核对项）
**宿主**：VSCode 插件 Zhai（宅写作），Markdown 主存储 + SQLite 缓存索引

---

## 一、结论速览

| 议题 | 结论 | 主要理由 |
|---|---|---|
| 载入形态 | **`CustomTextEditorProvider` 接管 `.md`**（`viewType: zhai.markdownEditor`），原生文本编辑器保留为 fallback | 只有自定义编辑器才能既在「编辑区」编辑、又由 VSCode 统一管理脏标记 / 保存 / 热退出备份 |
| 启用方式 | **按打开入口区分**：插件打开的笔记 / 公众号正文 / 作品的 md 用富文本，资源管理器双击或 VSCode 新建的用原生；不写全局 `editorAssociations` | 符合直觉且可随时回退；同一文件已有 tab 时复用不新开（见 6.5） |
| 文档同步模型 | 直接读写 `TextDocument`（`WorkspaceEdit` 最小 diff），**不用 `CustomDocument` 自管内容** | 两种编辑器会同时打开同一文件，自管内容会导致两边各写各的、保存后静默丢字（见 6.2） |
| 编辑器内核 | **TipTap 3（ProseMirror）**，备选 CodeMirror 6 装饰式 | 富文本体验、Mark / Decoration / NodeView 三件套与四项需求一一对应；切换条件见 5.1 |
| 编辑体验基座 | **开源 Tiptap 3 自建 Notion-like 交互**（块拖拽、`/` 命令、turn into、块 id）；不引入官方商业模板 | 官方模板需订阅且自带 Cloud AI / 协作 / 重复 UI；其块级能力在开源扩展中已齐备（见 5.5） |
| 浮动菜单 | **shadcn `Popover` + 自算坐标**，不启用 TipTap `BubbleMenu` | 保持 UI 层单一来源；`BubbleMenu` 自带一套浮层样式与 z-index，会和 shadcn 的 Portal 打架 |
| 划线 | 自定义 `Mark`（颜色存 `data-color`），**数据不写入 Markdown** | 写 `==text==` 或 `<mark>` 会污染小说正文与 Git diff；标注数据走独立 SQLite 库 |
| 划线 / 批注存储 | **独立 SQLite：`{存储根}/sqlite/annotations.db`**（与 `media.db` 同级） | 工作流总览页要跨文档分页、按时间/颜色/文档过滤并全文搜索，JSON sidecar 做这三件事代价高；索引库仍不参与（可被重建清空） |
| 锚点方案 | **引用 + 上下文 + 偏移**（W3C TextQuoteSelector 思路）三重冗余 | 可编辑文档里纯字符偏移必然失效；上下文用于变更后的模糊重定位 |
| 批注锚定粒度 | **块级（段落）**，图标用 `Decoration.widget` 挂在段末 | 行内范围会随编辑撕碎；产品形态（段末图标 + 气泡）本身要求块级 |
| AI 查询 | 新增 `editor/query` + `editor/query/abort` 协议，**流式**回传，shadcn `Dialog` 承载 | 复用 `AiProvider` + `UsageRecorder` 单例与现有 `StreamMessage` 机制 |
| 整体可行性 | **中高**：UI 层几乎全部可复用现有 shadcn 封装；成本集中在「编辑器内核 + md 往返」 | 需新增 3 个依赖族、1 个 webview 入口、1 个自定义编辑器、1 个标注库与总览页 |

### 1.1 两条路线与共用资产

本方案是**档 B（自定义编辑器）**。另有一条**档 A（原生 Decoration + Comment API）**路线：不换编辑器，用 `createTextEditorDecorationType` 给字符区间挂样式、`vscode.comments` 承载想法。两条路线不是互斥的技术选型，而是同一需求的两种保真度档位，**数据层与锚点层完全共用**。

| 维度 | 档 A：原生 Decoration + Comment API | 档 B：自定义编辑器（本方案） |
|---|---|---|
| 马克笔 / 直线 / 波浪线 / 删除线 | 完全可复刻（`backgroundColor` / `textDecoration`） | 完全可复刻（Mark + CSS） |
| 贴字浮动菜单 | 不可实现，退化为右键子菜单 + 快捷键 + 命令面板 | 可实现（shadcn Popover + `coordsAtPos`） |
| 段末批注图标 | 能用 `after.contentText` 画出，但**不可点击**，交互要靠 `hoverMessage` 的 `command:` 链接、gutter 图标或 Comment API 的 Peek | 可点击（`Decoration.widget` + Popover） |
| 查询结果展示 | 无法在编辑区弹窗，只能把选区送进侧栏对话（`zhai.ai.addToChat`），形态由 Dialog 变为「侧栏问答」 | shadcn Dialog 在当前窗口流式展示 |
| 选中内容的形态 | Markdown 源码（`**` 一并被选中） | 富文本（标记隐藏） |
| md 往返风险 | 无（源文本即真相，装饰不落盘） | 有（白名单 + 源码降级 + 幂等自检） |
| 原生能力（Ctrl+F / 大纲 / Git diff / undo 栈） | 全部保留 | 全部丢失，需自建或降级 |
| 交付成本 | 约 9–15 人日（装饰层 2–4 + 标注库/锚点 4–6 + 总览页 3–5；档 A 做不出块拖拽） | 约 26–36 人日（P0 21–30 + 总览页 5–6，Notion-like 基座 8–12） |
| 打开入口 | 不涉及（不动编辑器） | 需改造 5 个打开调用点 + `activeDocument` 抽象（见 6.5 / 6.6） |
| 适用判断 | 尽快可用、只求「标注得住」 | 必须复刻参考图交互、追求写作沉浸 |

**共用资产（切换路线不需要重写）**

| 资产 | 落点 | 说明 |
|---|---|---|
| 标注库 | `src/modules/editor/annotationRepository.ts` + `db/` | 事务写入、FTS5 检索、`VACUUM INTO` 快照；库文件 `{存储根}/sqlite/annotations.db` |
| 锚点算法 | `src/modules/editor/annotationAnchor.ts`（纯函数 + 单测） | `quote + prefix/suffix + 偏移` 三级重定位；两条路线共用同一份实现 |
| 总览查询 | `annotationSearch.ts` | 分页 + 过滤 + 关键词（≥3 字走 FTS，1–2 字走 LIKE）；工作流页面直连 |
| 数据契约 | `src/shared/types/editor.ts` | 字段一致，A→B 升级不需要数据迁移 |
| 路径校验 | `toStorageRelativePath` + `toSafeSegments`（`src/modules/common/storagePath.ts:30`） | 越界直接拒绝，不接受前端拼路径 |
| 清单与跳转 | 复用 `revealProofreadRange`（`src/modules/proofread/target/documentEditor.ts:121`） | 打开文档并定位选区，不新写跳转逻辑 |
| AI 查询 | `editor/query` + 宿主 `EditorQueryService` | 宿主侧完全复用，只有渲染载体不同 |

**建议顺序**：先按「未来可能升到档 B」的规格实现共用层——锚点逻辑不写进 decoration 控制器内部，标注结构不写死进装饰参数——再决定渲染档位。这样工具栏形态的拍板可以推迟到真实使用两周后，前期投入不浪费；若反过来按「纯原生、够用就行」实现，后续升级要重写。

### 1.2 一句话判断

四项操作本身都不难，真正的工程风险只有两个——Markdown 往返保真、标注锚点漂移。方案把这两点当作一等约束设计（窄语法白名单 + 源码模式兜底；引用上下文重定位 + 孤儿兜底），其余按现有 webview 协议照搬即可。**若接受「源码态标注 + 右键菜单 + 侧栏对话」，直接走档 A 更划算；若必须复刻参考图的浮层与弹窗，只有档 B 一条路。**

---

## 二、需求拆解

| 操作 | 触发 | 交互结果 | 是否改变源文件 |
|---|---|---|---|
| 复制 | 选中文本 → 浮动菜单「复制」 | 写入剪贴板，toast 反馈 | 否 |
| 划线 | 选中文本 → 「马克笔」→ 选色 | 选区渲染半透明底色，记录落标注库；再次选同色 / 「删除划线」取消 | 否 |
| 批注 | 选中文本（或段落）→「批注」→ 输入内容 | 段落末尾出现图标，点击弹出该段批注列表 | 否 |
| 查询 | 选中文本 →「查询」 | shadcn `Dialog` 内流式展示 AI 结果，可停止 / 复制 | 否（结果不自动写回） |

四项操作的共性：**全部是「选区的副产物」**，除批注内容外不产生正文变更。因此编辑器内核只需要稳定提供三件事：当前选区、坐标、可叠加的装饰层。

---

## 三、成熟产品参照与提炼

| 产品 | 形态 | 划线 / 批注数据落点 | 可借鉴点 |
|---|---|---|---|
| 微信读书 | 只读阅读器 + 段末「想法」气泡 | 服务端，绑定章节 + 字符区间 | 段末图标 + 气泡列表的交互范式；色板独立于操作栏 |
| Kindle / Apple Books | 只读 + 高亮 | 书籍文件内（位置锚） | 「同色再点即取消」的 toggle 语义 |
| Hypothesis / Readwise Reader | 网页批注 | 服务端，W3C Web Annotation（TextQuoteSelector + TextPositionSelector） | 引用 + 前缀 + 后缀 + 偏移的锚点模型，是本方案可直接照搬的标准 |
| Obsidian（Live Preview + Annotator 插件） | **编辑态** markdown | md 内联注释或 sidecar 文件 | 证明「编辑态 markdown + 装饰式标注」可行；sidecar 惯例 |
| Notion / 飞书文档 | 块级富文本 | 块 ID + 评论服务 | 评论锚定块而非字符范围，粒度稳定 |
| Typora | 富文本编辑 md | 直接改写 md | 反面教材：往返转换会重排列表符号、空行、表格对齐 |

**四条被本方案吸收的设计结论**

1. 阅读态产品把划线存服务端 / sidecar，**不写正文**；本项目落独立 SQLite 库，遵守同一条纪律。
2. 可编辑态必须用「引用 + 上下文」重定位，**纯偏移不可作为唯一依据**。
3. 批注挂在块上，图标才稳定；字符级批注在多轮编辑后几乎必然撕碎。
4. md 往返必须留「不可映射语法」的降级通道，不能假设解析器能完美吃下用户手写的所有方言。

---

## 四、现状基线（事实，不含推测）

| 事实 | 位置 | 对方案的影响 |
|---|---|---|
| 前端为 React 19 + TS7 + Tailwind 4 + shadcn（`radix-nova` 变体） | `package.json`、`components.json` | UI 层可直接消费 `dialog` / `popover` / `toggle-group` / `button` 等 |
| shadcn 源码托管在 `resources/shadcn/ui`（别名 `@components/ui`），业务封装在 `src/components` | `tsconfig.json` paths | 浮动菜单与 Dialog 一律走封装组件，不直连 ui（除非无封装） |
| 现有两个 webview 入口：`dashboard/index.html`、`workflow/index.html` | `vite.config.mjs` | 新增编辑器入口需同时改 `vite.config.mjs`（input）与 `buildWebviewHtml` 调用方 |
| webview ↔ 宿主为「请求-响应 + stream + state」三通道 | `src/shared/utils/bridge.ts` | 标注读写与 AI 查询直接复用 `request()` / `onStream()` / `onState()` |
| `HostMethodName` 为字面量联合，新增方法两侧同时维护 | `src/shared/types/messages.ts` | 需同步改 `messages.ts` 与宿主注册表，否则编译期即失败 |
| CSP：`default-src 'none'`，`script-src` 仅 webview cspSource，禁止内联脚本 | `src/modules/common/webviewHtml.ts` | 不引入任何依赖内联脚本的编辑器；样式允许 `unsafe-inline` |
| 文档为 Markdown 主存储，章节带 Frontmatter，正文只存小说正文 | `docs/modules/press.md` 1.3 | 编辑器必须把 Frontmatter 隔离处理，不能当成正文段落 |
| 索引库为可清空缓存（`clearSchemaData` 会 DELETE） | `src/modules/common/db/schema.ts` | 标注数据**不得**落在索引库 |
| AI 能力由单一 `AiProvider` + `UsageRecorder` 提供，一次性调用范式已存在 | `src/activation/aiLayer.ts`、`src/modules/proofread/ai/aiProofreader.ts` | 查询功能照抄该范式，不新建通道 |
| 目前**没有任何编辑器内核依赖**（无 TipTap / ProseMirror / CodeMirror / Lexical） | `package.json` | 内核选型是纯新增，需评估体积与维护成本 |

---

## 五、技术选型

### 5.1 编辑器内核对比

| 维度 | TipTap 3（ProseMirror） | Milkdown | Lexical | CodeMirror 6（装饰式） | 自研 contenteditable |
|---|---|---|---|---|---|
| 富文本体验（隐藏语法标记） | 强（NodeView 可完全接管渲染） | 强 | 中 | 弱（Live Preview 只能淡化 / 按行折叠标记） | 取决于实现 |
| Markdown 往返保真 | 中（需 mdast ↔ PM 映射，官方 markdown 扩展可减负） | 强（remark 管线原生） | 弱 | 极强（源文本即真相，零往返） | 弱 |
| 装饰能力（划线 / 段末图标） | 强（Mark + Decoration.inline/widget/node） | 中（需写 PM 插件） | 中 | 强（`Decoration.mark` / `widget`） | 弱 |
| 浮动菜单定位 | 强（`coordsAtPos`，官方 BubbleMenu 可参考） | 中 | 中 | 强（`coordsAtPos`） | 弱 |
| 中文 IME / 长文性能 | 良（需注意 composition 期间事务） | 良 | 良 | 优（视口渲染，VSCode 自身即 CM6） | 差 |
| 体积（min，增量） | 约 180–230 KB | 约 200 KB+ | 约 120 KB | 约 150 KB | 0 |
| 生态与维护 | 活跃，文档完整 | 活跃，抽象层较厚 | 活跃，md 生态弱 | 活跃，Markdown 生态成熟 | 自担 |
| 与 shadcn 协作 | 好（React 组件即插槽） | 一般（自带主题体系） | 好 | 好（外围 UI 完全自控） | 好 |

**结论：TipTap 3 为主选。** 四项需求与 ProseMirror 的三类装饰正好一一对应：划线 = `Mark`（可 toggle、带属性），批注图标 = `Decoration.widget`，查询无装饰。浮动菜单用 `coordsAtPos` 自算坐标后交给 shadcn `Popover`，不引入第二套浮层体系。

**若走档 A（原生 Decoration）**：本节的编辑器内核与 6.4 的往返管线整节不适用（源文本即真相），但 1.1 列出的共用资产与第八、九、十章的标注、批注、查询规格仍然有效——档 A 只是把渲染层换成 `createTextEditorDecorationType`，数据模型与协议不改。

**备选与切换条件（CodeMirror 6）**：若 6.4 的「往返保真」验收（AC-3）连续两轮不达标，或用户反馈「编辑后被重排格式」不可接受，则切换为 CM6 装饰式（Obsidian Live Preview 形态）。切换代价可控：浮动菜单、色板、批注气泡、查询 Dialog、标注库、协议层全部不动，只替换 `src/editor/` 下的内核心与选区适配层。因此在目录设计上要把「内核心」与「界面层」严格分层，为这次切换预留缝。

**明确不选**：Milkdown（抽象层厚，定制段末装饰仍需回到 PM 插件，收益不足）；Lexical（Markdown 生态弱，往返要自己写）；自研 contenteditable（IME、撤销、选区三大坑）。

### 5.2 新增依赖

| 依赖 | 用途 | 备注 |
|---|---|---|
| `@tiptap/react` `@tiptap/pm` `@tiptap/starter-kit` | 内核与基础节点 | 必装 |
| `@tiptap/extension-markdown` | md ↔ doc 序列化 | 若其保真度不满足，改用 `remark`（已有依赖）自建映射 |
| `@tiptap/extension-placeholder` | 空文档占位 | 可选 |
| `@tiptap/extension-character-count` | 字数（章节字数目标需要） | 可选，也可复用现有字数统计 |

Notion-like 交互层（5.5）按需引入，全部为开源包：

| 依赖 | 用途 | 备注 |
|---|---|---|
| `@tiptap/extension-drag-handle-react`、`@tiptap/extension-node-range` | 块拖拽把手与排序 | 若历史版本为 Pro 包则自写把手 |
| `@tiptap/extension-unique-id` | 块运行期 id | `renderHTML` 必须剥离 `data-id` |
| `@tiptap/suggestion` | 斜杠命令、`@` 提及的弹层机制 | 弹层 UI 用 shadcn `command` |
| `@tiptap/extension-highlight`、`@tiptap/extension-text-style`、`@tiptap/extension-color`、`@tiptap/extension-text-align` | 高亮、文字颜色、对齐 | 高亮 ≠ 划线 |
| `@tiptap/extension-image`、`@tiptap/extension-file-handler` | 图片节点与拖放粘贴 | 上传复用 `upload/*` |
| `@tiptap/extension-table`（Table kit） | 表格 | 已在 md 白名单 |
| `@tiptap/extension-task-list`、`@tiptap/extension-task-item` | 任务列表 | GFM `- [ ]` |
| `@tiptap/extension-emoji`、`@tiptap/extension-mention` | Emoji 与 `@` | mention 接 `ai/mention/search` |
| `@tiptap/extension-code-block-lowlight` + `lowlight` | 代码块高亮 | 主题令牌映射 |
| `@tiptap/extension-mathematics` + `katex` | 数学公式 | md 往返按源码块降级 |

体积：交互层预计增加 120–180 KB（min），只进编辑器入口；`lowlight` 与 `katex` 建议动态 `import()`，首屏不加载。

体积影响：仅新增 webview 入口加载内核，`dashboard` 与 `workflow` 两个既有入口的 chunk 不变；但 Vite 多入口共享 `node_modules` 时若被提升为公共 chunk，需要显式配置 `manualChunks` 或确认入口依赖图隔离。**上线前必须复核另外两个入口的产物大小**。

### 5.3 shadcn 组件映射

| 功能 | 组件 | 说明 |
|---|---|---|
| 浮动菜单容器 | `@components/ui/popover` | 受控 `open`，虚拟锚点用零尺寸 div 跟随选区 |
| 操作按钮 | `@components/ui/button`（`variant="ghost"` `size="sm"`）+ `lucide-react` 图标 | 复制 / 马克笔 / 批注 / 查询 |
| 色板 | `@components/ui/toggle-group`（`type="single"`）或圆形 `Button` + `Check` | 当前色带勾选；同色再点即清除 |
| 批注气泡 | `@components/ui/popover` | 列表 + 时间 + 编辑 / 删除 |
| 批注编辑 | `@components/ui/dialog` + `@components/ui/textarea` | 也可用 `FormDialog`（`src/components`） |
| 查询结果 | `@components/ui/dialog` + `marker`（流式状态行）+ `scroll-area` | 正文复用 `MARKDOWN_COMPONENTS` 渲染 |
| 停止 / 复制 | `button` + `sonner` toast | 复制复用 `copyToClipboard`（`src/shared/utils/clipboard.ts`） |
| 空态 / 加载 | `empty` / `spinner` | 查询等待与批注空列表 |

### 5.4 不采用的既有能力

- **TipTap `BubbleMenu` 组件**：自带 floating-ui 与 z-index 体系，与 shadcn Portal 冲突，且样式需二次覆写。改用 `Popover` + `coordsAtPos`。Notion-like 模板的浮层定位思路可参考，但容器不搬（见 5.5）。
- **`react-markdown` 直接作为编辑器**：只读渲染器，不可编辑，仅用于查询结果展示（复用 `src/workflow/aichat/markdown.tsx` 的 `MARKDOWN_COMPONENTS`）。
- **`contenteditable` + `richText.ts` 工具族**：面向单行输入框（芯片、纯文本读写），不具备块结构与撤销栈，不能承载长文编辑。

### 5.5 Notion-like 交互基座（开源自建，已定）

**决策：不引入官方 `notion-like-editor` 模板，按它的交互形态用 Tiptap 3 开源层自建。**

不用的理由（已核对官方页面与扩展清单）：

| 问题 | 事实 |
|---|---|
| 许可 | 页面标注 Paid，生产使用需 Start plan 及以上订阅，受商业许可约束 |
| 形态 | 不是 npm 包，`npx @tiptap/cli add notion-like-editor` 把源码拉进项目，无升级通道，定制后无法合并官方更新 |
| 自带能力 | 含 Cloud AI（`TIPTAP_AI_TOKEN` 暴露到前端）与 collaboration（OT 文档服务器），两者都必须剥离 |
| UI 重复 | 自带 `button` / `dropdown-menu` / `toolbar` Primitives，与本项目 shadcn `radix-nova` 重复 |

而它展示的块级能力**在开源层已齐备**：官方扩展总览把 Drag handle（含 React 封装）、Unique ID、Emoji、Mention、File handler、Mathematics、Table kit、Image、Highlight、Text align 均标注为 Open source。付费的是 AI、Comments、Tracked Changes、Compare、DOCX/PDF/Markdown 导出、Paste handler、Pages、Whiteboard，这些本方案不需要或自建。

**能力映射（模板形态 → 开源实现 → 自建部分）**

| 能力 | 开源实现 | 需要自建的部分 |
|---|---|---|
| 块拖拽排序 | `@tiptap/extension-drag-handle-react` + `@tiptap/extension-node-range` | 把手样式；拖拽后的块序列化 |
| 块唯一 id | `@tiptap/extension-unique-id` | `renderHTML` 剥离 `data-id`（见下） |
| `/` 斜杠命令 | `@tiptap/suggestion`（官方 utility） | 命令清单、shadcn `command` + `popover` 弹层、键盘导航 |
| turn into（块类型转换） | StarterKit 的 `setNode` / `toggleNode` | 类型映射与 dropdown 菜单 |
| 浮动工具条 | `@tiptap/extension-bubble-menu` 的定位思路 | 容器用 shadcn `Popover`，不启用其内置 UI（5.4） |
| 颜色高亮 | `@tiptap/extension-highlight`（multicolor）+ TextStyle kit | 色板 UI；与「划线 Mark」命名区分 |
| 文字对齐 | `@tiptap/extension-text-align` | 工具条按钮 |
| 代码块高亮 | `@tiptap/extension-code-block-lowlight` + lowlight | 主题令牌映射 |
| 图片 | `@tiptap/extension-image` + `@tiptap/extension-file-handler` | 上传复用项目 `upload/*`，落 `@zhai/` 相对路径 |
| 表格 | Table kit（table / row / header / cell） | md 往返映射（已在白名单） |
| 任务列表 | List kit（含 task list / task item） | md 往返映射（GFM `- [ ]`） |
| Emoji | `@tiptap/extension-emoji` | 选择器 UI 用 shadcn `command` |
| `@` 提及 | `@tiptap/extension-mention` | 接现有 `ai/mention/search`（角色 / 章节引用），不新建数据源 |
| 数学公式 | `@tiptap/extension-mathematics`（KaTeX） | 渲染样式；md 往返按「源码块」降级（6.4 非白名单） |
| 右键菜单 | 无对应扩展 | shadcn `context-menu` |
| AI 内联 | 付费 | 走宿主 `editor/query`（第十章） |
| 协作光标 / 在线状态 | 付费服务 | 不需要 |

**安装前的核对项**：官方页面按“功能”标注 Open source，但 drag handle、emoji、unique id 在 2.x 时期曾属 Pro 包。逐个确认包名是 `@tiptap/*` 而非 `@tiptap-pro/*`、`license` 为 MIT；任何需要私有 registry 的包一律不引入，改用等价自写实现（例如块 id 用自定义 Node attribute + `nanoid`）。

**仍需自研的三件事**（模板同样不提供）

- **Markdown 往返**（6.4）：`getJSON()` / `getHTML()` 不是 md，白名单管线与脏块回填不变。
- **标注数据模型**（第八、九章）：块级排版高亮 ≠ 带时间、段落、可检索的标注对象。
- **按入口区分编辑器**（6.5）：模板是应用级编辑器，不涉及 custom editor 注册与 `openWith`。

**主题接法**

- 编辑器样式只用 CSS 变量：正文色 `--vscode-editor-foreground`、底色 `--vscode-editor-background`、边框 `--vscode-panel-border`；字号取 `--vscode-font-size`，不写死 `16px`（项目既有约定）。
- 深色模式复用 `src/bootstrap.tsx` 的 `.dark` 同步，不引入第二套 theme provider。
- 斜杠、工具条、色板、emoji 等浮层统一走 shadcn `Popover` / `Command`，z-index 与 Portal 由 shadcn 统一。

**块 id 的序列化约束**

- `blockId` 仅运行期存在，**不得写入 md**：`renderHTML` 不输出 `data-id`，序列化时剥离。
- 重开文档后 blockId 重建，9.2 的重定位仍以 `block_index + block_hash` 与 `quote` 兜底。
- 块 id 是编辑态坐标，不是文档内容——与「标注不污染正文」同一原则。

**工期**：8–12 人日（拖拽 2、斜杠 + turn into 3、颜色 / 对齐 / 代码块 / 表格 / 任务列表 2、emoji + mention 1.5、图片与粘贴 1.5、联调与测试 2）。

---

## 六、编辑器集成方式

### 6.1 三种载入形态

| 形态 | 是否在编辑区 | 与文档生命周期 | 适用性 |
|---|---|---|---|
| `CustomTextEditorProvider`（选） | 是（接管 tab） | 原生：脏标记、保存、备份、revert 全走 VSCode API | 唯一满足「编辑区内直接编辑 md」且不丢 Ctrl+S / 崩溃恢复语义 |
| `WebviewPanel` | 是（独立 tab） | 自建保存、自建脏标记，易与 Git / 外部修改脱节 | 需要额外造一套文档生命周期，不选 |
| `WebviewView`（侧边栏） | 否 | 面板生命周期 | 与需求不符，仅可作「批注总览」辅助视图（P2） |

注册方式：

```ts
// src/modules/editor/editorProvider.ts
context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
        MarkdownEditorProvider.viewType, // 'zhai.markdownEditor'
        provider,
        { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
    ),
)
```

启用策略：**按打开入口区分，不写全局 `workbench.editorAssociations`**——插件打开的文档用富文本，用户从资源管理器或 VSCode 自己打开的用原生编辑器。详见 6.5。

| 打开动作 | 使用的编辑器 | 实现 |
|---|---|---|
| 资源管理器双击 `.md`、`File: Open`、VSCode 新建文件 | 原生文本编辑器 | 不做任何关联设置，交给 VSCode 默认行为 |
| 仪表盘打开笔记（`note/open`）、`zhai.note.new` | 富文本 | `vscode.openWith(uri, 'zhai.markdownEditor')` |
| 作品 README / 章节 / 设定（`press/open`、`press/openChapter`、`press/openDoc`） | 富文本 | 同上 |
| 公众号正文（`wechat/article/open`、`quickCreate`、导入后打开） | 富文本 | 同上 |
| 命令「用文本编辑器打开」 | 原生 | `vscode.openWith(uri, 'default')` |
| 命令「用富文本编辑器打开」 | 富文本 | `vscode.openWith(uri, 'zhai.markdownEditor')` |

执行细节：

1. **先查已有 tab**：`vscode.window.tabGroups.all` 中若已有该 URI 的 tab，直接聚焦（不论类型），不再新建第二个编辑器 tab。避免同一文件出现「文本 + 富文本」两个 tab，也避免抢走用户当前编辑器。
2. 没有 tab 时才 `openWith`；打开后立即广播一次路由事实（自定义编辑器不产生 `activeTextEditor`，见 6.6）。
3. 不写任何后缀级关联；用户若自行把 `*.md` 关联到 `zhai.markdownEditor`，属于用户选择，插件不拦也不推荐。
4. `supportsMultipleEditorsPerDocument: false`：同一文档只允许一个富文本实例（「复制到新 tab」退化为文本编辑器），避免两套 webview 同时写同一文档。

### 6.2 生命周期实现要点（TextDocument 模式）

因为需求是「按入口区分」，同一文件随时可能被文本编辑器与富文本编辑器同时打开，所以**不使用 `CustomDocument` 自管内容**，而是直接读写 VSCode 的 `TextDocument`：

| 阶段 | 实现 |
|---|---|
| `resolveCustomTextEditor` | 入参是 `TextDocument` → 读 `document.getText()` 转富文本 doc → 注入 webview（复用 `buildWebviewHtml`）→ 订阅 `onDidReceiveMessage` |
| 编辑 | webview debounce 500ms 推全文（含 `version`）→ 与 `document.getText()` 做行级 diff（复用 `@shared/utils/diff`）→ 按 hunk 生成 `WorkspaceEdit` 并 `applyEdit` |
| 脏标记 / 保存 | 不自行管理：`applyEdit` 使 `TextDocument.isDirty` 为真，Ctrl+S / 自动保存由 VSCode 负责；`onDidSaveTextDocument` 后清理 webview 的待同步标记 |
| 外部变更 | `onDidChangeTextDocument`：若本次变更由自己的 `applyEdit` 引起则跳过（用编辑来源标记）；否则推 `editor/doc` 让 webview 重建，尽量按原 `start_offset` 恢复选区 |
| 热退出备份 | VSCode 自带（TextDocument 备份），不需要 `backupCustomDocument` |
| revert | 监听 `onDidRevert` / 保存后重推内容，webview 丢弃本地未同步状态 |
| dispose | 释放 webview 监听、取消在途查询；不 flush（内容已随每次 `applyEdit` 落到 TextDocument） |

**为什么必须走 TextDocument**：自管内容的 `CustomDocument` 模式下，webview 的正文与 `TextDocument` 是两份缓冲。用户一边用富文本写、一边在文本编辑器里打开同一文件时，两边会各写各的，保存即以最后落盘者为准，典型表现是「另一半刚写的段落在保存后消失」。走 `TextDocument` 后两端共享同一份缓冲，VSCode 负责合并与脏标记。

**撤销语义（必须写进发布说明）**

- 富文本 tab 内的 Ctrl+Z 由 ProseMirror history 处理，撤销后会按 diff 再同步一次 `TextDocument`；文本编辑器 tab 内的 Ctrl+Z 由 VSCode 文档栈处理，撤销后推给 webview 重建。
- 也就是说：**以文档内容为唯一真相，撤销不保证跨 tab 的单步精确性**，只保证两端最终看到同一份内容。
- 已提交到 `TextDocument` 的修改不会因关闭 webview 而丢失；未提交（500ms 窗口内）的输入随 webview 销毁丢弃，这是可接受的损失窗口。

**关键取舍**

- 原生能力失效：富文本 tab 下没有 Ctrl+F 查找、文档大纲、Git gutter diff、markdown 语言服务。缓解：webview 内实现 Ctrl+F（P2）；提供「用文本编辑器打开」一键退回；tab 标题旁标注富文本标识。
- 富文本 tab 不产生 `activeTextEditor`：所有依赖它的宿主能力都要改走 6.6 的活跃文档抽象，否则工作流路由与插入类功能会失效。

### 6.3 双向同步协议

```ts
// 宿主 → webview
{ type: 'state', channel: 'editor', payload: { kind: 'doc', path, content, version, reason: 'open' | 'external' | 'revert' } }
// webview → 宿主
{ type: 'request', method: 'editor/change', payload: { version, content } }
{ type: 'response', ok: true, payload: { version } }   // 版本不符 → ok:false, error.code = 'version-conflict'
```

- **防回声**：webview 推 `editor/change` 后，宿主不再回推同一版本内容，只回 `{ version }` 确认；`reason` 区分「打开 / 外部变更 / revert」。
- **IME 安全**：`compositionstart` ~ `compositionend` 期间不推送（ProseMirror 的 `compositionend` 后会补一个事务，取该事务后的状态）。
- **节流**：编辑推送 300ms 防抖；失焦、保存、关 tab 前强制 flush。
- **版本号**：宿主单调递增，webview 持有最近确认版本；冲突时以宿主为准并提示（避免两边都写）。

### 6.4 Markdown 往返管线

```
文件文本
  ├─ 分离 Frontmatter（--- 区块）→ 只读「文档信息」卡片（title/status/characters 等）
  ├─ 正文 → remark-parse（已有依赖）→ mdast
  │     ├─ 白名单节点 → ProseMirror doc
  │     └─ 非白名单节点 → 原子源码块（只读，可切源码模式编辑）
  └─ PM doc --serialize--> mdast --remark-stringify--> 正文文本
                              └─ 与 Frontmatter 原样拼接
```

**语法白名单（P0 必须无损）**：段落、标题 h1–h6、加粗、斜体、删除线、行内代码、代码围栏（保留 info 语言）、引用块、有序 / 无序列表（含嵌套）、分隔线、链接、图片（含 `@zhai/` 引用）、硬换行、GFM 表格。

**非白名单降级**：脚注、定义列表、HTML 块、数学公式、告警块、未来可能引入的 `[[双链]]` —— 一律渲染为「源码块」原子节点，序列化时原样回填，保证不丢内容。

**格式稳定性措施**（对抗 Typora 式重排）：

1. 序列化只重写被编辑过的块（按 PM 事务的 `steps` 记录脏块集合），未编辑块直接回填原始源码；
2. 空行、列表符号（`-` vs `*`）、强调符（`*` vs `_`）、表格对齐冒号按原样保留；
3. 保存前做一次「解析 → 序列化 → 再解析」幂等检查，不一致则回退为全文重写并提示；
4. 首次开启富文本模式时自动创建一次作品快照（复用 `PressSnapshotService.captureChapterBeforeWrite`），用户可回到开前状态；
5. 常驻「源码模式」开关（`Ctrl+Shift+M`），任何异常都可退回纯文本。

### 6.5 按打开入口区分编辑器（落地清单）

**规则**：只有插件自己发起的「打开文档」动作才用富文本，其余一律原生。判断依据是调用点，不是文件后缀。

需要从 `showTextDocument` 改为 `openWith` 的调用点：

| 入口 | 现有实现 | 改法 |
|---|---|---|
| 笔记打开 / 新建 | `src/modules/note/noteService.ts:30` 的 `showNoteDocument` | 改调统一封装 `openStorageDocument` |
| 作品 README / 设定 / 大纲 | `src/modules/press/projectService.ts`（3 处 `showTextDocument`） | 同上 |
| 章节打开 | `src/modules/press/projectService.ts` 的 `openChapter` | 同上 |
| 公众号正文打开 | `src/modules/wechat/issueService.ts:503` | 同上 |
| 公众号切下一篇 | `src/modules/wechat/issueDocument.ts:230` | 同上 |

统一封装（`src/modules/editor/openDocument.ts`）：

```ts
export async function openStorageDocument(uri: vscode.Uri): Promise<void> {
    // 已有 tab 就复用：不新开第二个编辑器 tab，也不抢用户当前编辑器
    if (findTab(uri) !== undefined) {
        await vscode.commands.executeCommand('vscode.open', uri)
        return
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, RICH_EDITOR_VIEW_TYPE)
}
```

不采用的入口与理由：

| 入口 | 理由 | 处理 |
|---|---|---|
| `proofread/reveal`（定位校对问题） | 需要 `TextEditor` 的 Range 选中；目标若以富文本打开会定位失败 | 走 `showTextDocument`；若文档已在富文本 tab，P1 用 `editor/reveal` 协议让 webview 选中 |
| `media/insert`、`upload/insert`、`stock/insert`（插入到光标） | 依赖 `resolveMarkdownEditor()` 返回 `TextEditor` | P0 检测到当前文档是富文本时提示「请在文本编辑器中插入」；P1 增加 `editor/insert` 协议 |
| AI 写作模式写回（`ai/compose`） | 写回本身走 `WorkspaceEdit`，与编辑器类型无关 | 保留；但「当前选中内容」改从 6.6 的活跃文档抽象取 |

**新建文件的路径**：`zhai.note.new` 创建后调 `openStorageDocument`；VSCode 资源管理器新建的 `.md` 没经过插件，自然用默认编辑器。两者行为不同是需求要的结果，不是不一致。

### 6.6 活跃文档抽象（消除 `activeTextEditor` 单点）

富文本 tab 不产生 `TextEditor`，而现有 11 个文件、20 余处直接读 `vscode.window.activeTextEditor`，覆盖工作流路由、插入目标、活跃笔记、AI 写回、校对定位与重命名监听。新增 `src/modules/editor/activeDocument.ts` 作为唯一事实源：

```ts
export interface ActiveDocument {
    uri: vscode.Uri
    kind: 'text' | 'rich'
}

export function trackActiveDocument(subscriptions: vscode.Disposable[]): void
export function getActiveDocument(): ActiveDocument | null
export function getActiveTextEditor(): vscode.TextEditor | undefined   // 仅 kind === 'text'
export function revealRange(uri: vscode.Uri, start: number, end: number): Promise<boolean>
export function insertAtCaret(text: string): Promise<boolean>          // rich 分支走 editor/insert 协议
```

- 来源：`window.onDidChangeActiveTextEditor` → `kind: 'text'`；provider 在 `resolveCustomTextEditor` 与 `onDidChangeViewState(active)` → `kind: 'rich'`；panel dispose 时清空。
- 口径与 `WorkflowRouter` 现有约定一致：焦点移到侧栏面板或设置页**不清空**，沿用最后一次活跃文档。
- 改造优先级：`workflowRouter`（路由事实）> `insertTarget`（插入）> `dashboardProvider`（活跃笔记）> `chatService` / `aiChatProvider`（写回与上下文）> `noteRenameService` / `proofreadService` / `stockTargetService`。

**路由影响**：`WorkflowRouter.buildContext()` 目前只读 `window.activeTextEditor`，富文本打开时会返回上一次事实，面板停在上一个文档的模块。改造后读 `getActiveDocument()`，仍用 `indexService.toRelativePath` 推导归属，口径不变。

---

## 七、浮动菜单与选区交互

### 7.1 触发规则

| 条件 | 处理 |
|---|---|
| 选区为空 | 不弹；光标处点击已划线文本 → 弹「改色 / 取消划线」精简菜单 |
| 选区长度 < 2 字符 | 不弹（避免误触） |
| 选区 > 2000 字符 | 弹窗但禁用「查询」，提示「选中过长，请缩小范围」 |
| 选区在代码块 / 源码块内 | 只保留「复制」 |
| 触发方式 | 鼠标 `mouseup` 且选区稳定 150ms；键盘 `Shift+方向键` 后 300ms 防抖 |
| 关闭 | 选区塌陷、`Esc`、点击文档其它位置、滚动超过阈值、窗口失焦 |

### 7.2 定位实现

```ts
const from = editor.state.selection.from
const to = editor.state.selection.to
const start = editor.view.coordsAtPos(from)   // 视口坐标（position: fixed 可直接用）
const end = editor.view.coordsAtPos(to)
const centerX = (start.left + end.right) / 2
// 上方空间不足 56px 时翻转到选区下方；左右夹在 [8, innerWidth - 宽度 - 8]
```

锚点用容器内一个 `position: fixed; width: 0; height: 0` 的 div（`PopoverAnchor`），`left/top` 由上述结果写入；`scroll` / `resize` / 主题变更时重算，滚动导致锚点离开视口即关闭。

### 7.3 焦点与选区保活

- `PopoverContent` 的 `onMouseDown` 调用 `preventDefault()`，避免点击按钮时 webview 失焦导致选区塌陷。
- 菜单打开期间的选区以 `editor.state.selection` 为真相，不读 `window.getSelection()`（两者在 ProseMirror 内会短暂不一致）。
- 色板展开时保持同一浮层（上方追加一行），**不嵌套第二个 Popover**（嵌套 Portal 会抢焦点并导致选区丢失）。
- 点击「批注」时保存 `{ from, to, quote }` 快照到 ref，Dialog 打开后即使选区丢失也能正确落库。

### 7.4 与批注图标、AI Dialog 的互斥

- 浮动菜单与批注气泡同一时刻只允许一个打开（共享 `activePopover` 状态）。
- 查询 Dialog 为模态（`Dialog` 默认），打开即关闭浮动菜单并冻结编辑（`editor.setEditable(false)`），关闭后恢复并把焦点还给编辑器。

---

## 八、划线方案

### 8.1 数据模型：SQLite（`{存储根}/sqlite/annotations.db`）

**存储结论**：标注走**独立 SQLite 库**，位置与 `media.db` 同级（`{存储根}/sqlite/`），不写 Markdown 正文，也不进索引库 `index.db`。理由是三件事在 JSON sidecar 上做不好：工作流「标注总览」要跨文档分页与搜索；需要按时间 / 颜色 / 文档 / 关键词过滤；需要前缀匹配之外的检索能力。目录内的 `.db` 文件由用户随存储根一起备份或迁移，与图片、正文同进同退。

**连接与降级**（照搬 `src/modules/media/db/connection.ts` 的既有模式）：

```ts
// src/modules/editor/db/connection.ts
const PRAGMAS = [
    'PRAGMA journal_mode = DELETE;',   // 不用 WAL：存储根常在云同步目录，-wal/-shm 分开同步会写出半个库
    'PRAGMA synchronous = FULL;',
    'PRAGMA temp_store = MEMORY;',
    'PRAGMA cache_size = -16000;',
] as const

export function openAnnotationsDatabase(root: vscode.Uri, cacheRoot: vscode.Uri): AnnotationDatabase
export function closeAnnotationsDatabases(): void   // 换根 / 停用时关闭模块级连接缓存
```

- 主路径不可写（权限、网络盘、同步盘临时冲突）时降级到 `cacheRoot` 的 `annotations.db`，并在页面提示「标注暂存在缓存目录」。
- 降级库写入时在 `meta` 记 `degraded = 1`；恢复可写后启动时做一次合并：`ATTACH` 缓存库，按 `id` 插入缺失行，同 `id` 只在 `excluded.updated_at > annotations.updated_at` 时覆盖，成功后把缓存库改名 `.merged-<时间戳>` 留档。**不用文件覆盖合并**，否则会用旧缓存库盖掉主库里更新的数据。
- `activation/lifecycle.ts` 的 `zhai.*` 配置变更回调里追加 `closeAnnotationsDatabases()`，`deactivate` 同样调用（与 `closeMediaDatabases` / `closeStockDatabases` 并列）。

**DDL**（`src/modules/editor/db/schema.ts`，`user_version` + `meta` 与 `index.db` 同风格）：

```sql
CREATE TABLE IF NOT EXISTS annotations (
    id           TEXT PRIMARY KEY,
    doc_path     TEXT    NOT NULL,          -- 相对存储根，换根后仍可解析
    doc_title    TEXT    NOT NULL,          -- 写入时快照，列表分组/搜索展示不依赖索引库
    kind         TEXT    NOT NULL,          -- highlight | note
    mode         TEXT    NOT NULL DEFAULT 'inline',  -- inline | thread（见 9.6）
    quote        TEXT    NOT NULL,          -- 划线文本；批注时为目标文本
    prefix       TEXT,                      -- 前 32 字符
    suffix       TEXT,                      -- 后 32 字符
    start_offset INTEGER,                   -- 快速定位用，非唯一依据
    end_offset   INTEGER,
    block_id     TEXT,                      -- 块运行期 id（unique-id-extension 生成，不落 md）
    block_index  INTEGER,                   -- 段落序号（兜底）
    block_hash   TEXT,                      -- 段落文本 sha1 前 8 位（兜底）
    block_text   TEXT,                      -- 段落原文（截断 1000 字），总览页展示「划线段落」
    color        TEXT,                      -- highlight 专用：coral | violet | blue | emerald | amber
    note         TEXT,                      -- 批注正文
    replies      TEXT NOT NULL DEFAULT '[]',-- 仅 mode=thread，Comment API 回写
    orphaned     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(doc_path);
CREATE INDEX IF NOT EXISTS idx_annotations_time ON annotations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_orphaned ON annotations(orphaned);
CREATE VIRTUAL TABLE IF NOT EXISTS annotations_fts USING fts5(
    id UNINDEXED, quote, block_text, note, tokenize = 'trigram'
);
-- 与 index.db 的 files_fts 同构：三触发器保持同步
CREATE TRIGGER IF NOT EXISTS annotations_ai AFTER INSERT ON annotations BEGIN
    INSERT INTO annotations_fts(id, quote, block_text, note)
    VALUES (new.id, new.quote, COALESCE(new.block_text, ''), COALESCE(new.note, ''));
END;
CREATE TRIGGER IF NOT EXISTS annotations_ad AFTER DELETE ON annotations BEGIN
    DELETE FROM annotations_fts WHERE id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS annotations_au AFTER UPDATE ON annotations BEGIN
    DELETE FROM annotations_fts WHERE id = old.id;
    INSERT INTO annotations_fts(id, quote, block_text, note)
    VALUES (new.id, new.quote, COALESCE(new.block_text, ''), COALESCE(new.note, ''));
END;
```

字段取舍说明：

- **`block_text` 必须存**。总览页要展示「划线段落」，不能只存 hash，也不能跳转时回读 md（文件可能已改或已移动）；截断 1000 字足够展示，超出部分在列表里折叠。
- **`doc_title` 冗余存**。列表按文档分组要显示标题，若 JOIN `index.db` 的 `files` 表，一旦索引未收录或刚被清空，页面就出现「无标题」。写入时从 Frontmatter / 首个标题取快照，改标题后由重定位流程刷新。
- **`replies` 用 JSON 列**，不单独建表：线程回复不需要跨行查询，建表只会多一次 JOIN 与级联维护。
- **不建外键**：`doc_path` 指向文件而非表行，文档删除只把 `orphaned` 置 1，保留内容供用户确认后再清理。

**检索策略**（FTS5 trigram 的硬限制，必须实现兜底）：

| 关键词长度 | 查询方式 | 说明 |
|---|---|---|
| ≥ 3 字 | `annotations_fts MATCH ?` | trigram 索引命中，毫秒级 |
| 1–2 字 | `WHERE quote LIKE ? OR block_text LIKE ? OR note LIKE ?` | trigram 无法索引双字词；标注量级（千条内）全表扫可接受 |
| 组合筛选 | SQL 条件叠加 | 文档 / 颜色 / 类型 / `orphaned` 均走普通索引 |

列表分页用 keyset（`WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`），避免深 OFFSET；首页无游标时直接取前 N 条。

**写入与一致性**：

- 全部写入走事务 + 预编译语句；新增 / 改色 / 删除都是单行操作。
- 文档保存后触发一次重定位，批量更新 `start_offset` / `block_index` / `block_hash` / `block_text` / `doc_title` / `orphaned`，整批一个事务。
- 不做跨库事务：与 `index.db` 没有强一致需求（标题与段落是快照，重定位时刷新）。
- 数据库为唯一权威，**没有 sidecar 可回退**，因此写入路径不得静默吞错；失败必须回传给前端并保留用户操作。

**损坏与备份**（与 `media.db` 的区别：媒体可从磁盘重建，标注不能）：

- `quick_check` 失败时：关闭连接 → 原库改名 `annotations.db.corrupt-<时间戳>` → 建空库 → **向用户明示「标注库损坏，已留档到 xxx」**，不静默重建。`media.db` 那种「留档后重建即可」的策略在这里等于丢数据。
- 快照：每日首次打开后（或累计 50 次写入后）执行 `VACUUM INTO '{存储根}/sqlite/backup/annotations-{yyyyMMdd}.db'`，只保留最近 7 份，备份只写不读，与记忆中的全局库备份待办同一口径。
- 迁移：所有 DDL 变更写进 `ensureAnnotationsSchema`，按 `user_version` 递增，旧库就地 `ALTER TABLE`，不做导出重建。

**文件生命周期**（数据库内的路径维护）：

- `onDidRenameFiles`：`UPDATE annotations SET doc_path = ?, updated_at = ? WHERE doc_path = ?`，一个人工操作对应一条 SQL，不再有「两份文件谁为准」的问题。
- `onDidDeleteFiles`：`UPDATE annotations SET orphaned = 1 WHERE doc_path = ?`，总览页可见、可批量清理，不物理删除。
- 文档改标题：重定位时刷新 `doc_title` 快照。
- 换存储根：连接缓存按新根重建，标注随新根的 `sqlite/annotations.db` 走；旧根数据留在旧目录，不做跨根搬运。

### 8.2 颜色

固定枚举而非任意 hex，保证深色 / 浅色主题下的可读性：

```css
/* globals.css 新增令牌，明暗两套 */
--zhai-hl-coral: oklch(0.72 0.16 20);
--zhai-hl-violet: oklch(0.72 0.14 300);
--zhai-hl-blue: oklch(0.72 0.12 250);
--zhai-hl-emerald: oklch(0.72 0.13 160);
--zhai-hl-amber: oklch(0.80 0.14 85);
```

渲染：`background: color-mix(in oklab, var(--zhai-hl-<color>) 32%, transparent)`，圆角 2px，文字颜色不变。马克笔观感靠「不透明底色 + 轻微内边距」实现，不使用渐变（深色主题下渐变会糊）。

### 8.3 渲染与取消

- 自定义 `Highlight` Mark：`addAttributes() → { color }`，`parseHTML: span[data-hl]`，`renderHTML: span[data-hl][data-color]`。
- 装饰与 Mark 的区别：Mark 会进入 doc 模型（可被复制、撤销），适合「用户主动划的线」；`Decoration.inline` 不进入 doc，适合「仅展示」的场景。划线需要可撤销 / 可改色，用 **Mark**（并纳入 history）。
- 菜单打开时若选区已带 `highlight` Mark：色板勾选该色；点同色 → `unsetHighlight()`；点异色 → 改属性（`updateAttributes`）；额外显示「删除划线」项（与参考图一致）。
- 划线与 md 序列化完全解耦：序列化时 `renderMarkdown` 忽略该 Mark，正文不出现任何标注痕迹。

### 8.4 锚点重定位

保存 / 外部变更后，标注库中的 `start_offset` / `end_offset` 可能失效。重定位顺序：

1. 若 `documentHash` 未变 → 直接用 `start/end`；
2. 在 `start ± 2000` 字符窗口内 `indexOf(quote)`，且前后文匹配 `prefix` / `suffix` 各 ≥ 16 字符 → 采纳；
3. 窗口内多命中 → 用 prefix/suffix 最长匹配打分，取最高且唯一；
4. 窗口内无命中 → 全文 `indexOf`，同法校验上下文；
5. 仍失败 → 标记 `orphaned: true`，编辑区不渲染，批注 / 划线面板中显示「原文已修改，标注待确认」，提供「重新指定位置 / 删除」。

性能：单章 1 万字 + 几十条标注，`indexOf` 全量扫描在毫秒级；文档 hash 未变则整段跳过。重定位只在该文档被打开或保存时执行，不进入索引扫描热路径。

### 8.5 边界

- 划线与搜索高亮、选区高亮共存时，CSS 层级：搜索高亮 > 选区 > 划线（划线最底层，避免遮挡文字）。
- 划线段落被整体删除 → 该标注转 orphaned，不删除记录（用户可能撤销）。
- 跨段落划线：允许（Mark 可跨段落），但菜单里的「批注」只锚定选区起始段落。

---

## 九、批注方案

### 9.1 数据模型

即 8.1 `annotations` 表中 `kind = 'note'` 的行，与划线同表同库。要点：

| 字段 | 语义 | 必要性 |
|---|---|---|
| `quote` | 触发批注时的选中文本 | 重定位与气泡引用展示 |
| `block_index` / `block_hash` | 段落序号 + 段落文本哈希 | 决定图标挂在哪个段末 |
| `block_text` | 段落原文快照（截断 1000 字） | 总览页展示「批注所在段落」，不依赖回读 md |
| `note` | 批注正文（纯文本，支持轻量 Markdown） | 内容 |
| `updated_at` | 展示「已编辑」 | 体验 |

### 9.2 段落锚点生成

- 首选 `block_id`：Notion-like 基座的 `unique-id-extension` 为每个块生成运行期 id，落库存 `block_id` 列；该 id **不写入 md**（见 5.5）。
- 兜底 `block_index`（块序号）+ `block_hash`（段落纯文本 sha1 前 8 位），用于重开文档后 blockId 重建、或用户切回文本编辑器改了正文的场景。
- 重定位优先级：`block_id` 命中 → `block_index` + `block_hash` 校验 → doc 内按 `block_hash` 搜索（同文本多段取距原 index 最近者）→ `quote` 模糊匹配 → `orphaned = 1`。
- 段落被拆分 / 合并时只需重算 `block_index`，图标随块移动，不会错位到别的段落。

### 9.3 段末图标

```ts
Decoration.widget(pos, () => {
    const chip = document.createElement('button')
    chip.dataset.annotationIcon = id
    chip.className = 'zhai-annotation-icon'
    chip.setAttribute('aria-label', `查看 ${count} 条批注`)
    return chip
}, { side: 1, key: `note-${blockHash}` })
```

- 位置：段末行内（`side: 1`），`user-select: none`，`contenteditable: false` 的思路对应 PM 的 `ignoreMutation`。
- 图标：`MessageSquareText`（lucide），有批注时用 `text-primary`，无批注不渲染；同段多条显示计数徽标。
- 点击 → shadcn `Popover`（锚定该图标 DOM）展示列表；列表项含引用片段（灰底）、内容、时间、编辑 / 删除。
- 悬浮不弹（避免误触），点击才弹；键盘可 Tab 聚焦 + Enter 打开。
- 装饰层不进入 doc，因此**不会**出现在 md 源文件中，也不会被复制带出。

### 9.4 增删改

| 操作 | 路径 |
|---|---|
| 新建 | 浮动菜单「批注」→ Dialog（引用片段 + textarea）→ `editor/annotation/add` → 宿主单行 `INSERT` → 回 `{ item }` → 前端插入 decoration |
| 编辑 | 气泡内「编辑」→ 同一 Dialog 复用 → `editor/annotation/update` |
| 删除 | 气泡内删除 → 确认（`ConfirmDialog`）→ `editor/annotation/remove` |
| 失效 | `orphaned = 1` 的项在工作流「标注」总览页列出，可重新定位或删除 |

### 9.5 与划线的组合

选中文本同时划线并批注时产生两条独立记录（`kind` 不同）。批注气泡内可显示该选区已有的划线颜色并提供改色入口（P1）。批注不强制划线：只批注不划线时，仅段末出现图标。

### 9.6 与原生 Comment API 的分工

| 形态 | 实现 | 取舍 |
|---|---|---|
| 单条轻批注（P0） | 自绘 `Decoration.widget` 段末图标 + shadcn `Popover` | 样式可控、图标可点击、与参考图一致；需自己维护块锚点 |
| 多轮讨论 / 回复线程（P1） | `vscode.comments.createCommentController` + `CommentThread` | `range` 由编辑器随文档变更自动调整，省掉日常维护，自带 Peek 与侧栏；但 UI 由主题锁定不可定制 |

采用 Comment API 时的三条硬约束：

1. **线程不持久化**：扩展重启后 thread 全部丢失，必须按标注库记录（`doc_path` + `start_offset` / `end_offset` + `note`）重建；重建失败的条目置 `orphaned = 1`，不得静默丢弃。
2. **body 只支持 `MarkdownString`**：不能放按钮、色板等富交互；回复内容仍需回写标注库的 `replies` 列，否则重开即丢。
3. **样式不可覆盖**：评论图标出现在 gutter，不是段末。

因此 `annotations.mode` 取值 `inline | thread`，`thread` 模式的 `replies` 由 Comment API 回写，`inline` 模式只存单条内容。两条路线下该字段语义一致。

**档 A 的硬边界**：纯 decoration 路线没有可点击的段末图标，只能用 `after.contentText` 画出视觉（`DecorationRangeBehavior.ClosedClosed`），交互退到 `hoverMessage` 内的 `command:` 链接、gutter 图标或命令面板。这不是实现细节，选档 A 就要接受。

### 9.7 工作流「标注」总览页（P1）

**入口**：工作流常驻分区 `annotation`。加入 `RESIDENT_SECTIONS` 而非某个归属的专属分区——标注是跨文档的，在作品、笔记、公众号下都应能看到全部记录。标识加入 `WORKFLOW_SECTIONS` 后，宿主 `workflow/selectModule` 与页内跳转自然可用。

**布局**（严格复用现有页面骨架与 shadcn 组件，不手写容器）：

```
AppPage
├─ 工具条
│   ├─ 类型：ToggleGroup（全部 / 划线 / 批注）
│   ├─ 颜色：Popover + 圆形色块（仅「划线」生效）
│   ├─ 文档：Combobox（按 doc_title 分组，含「全部文档」）
│   ├─ 搜索：Input（300ms 防抖，占位「搜索划线内容 / 段落 / 批注」）
│   └─ 开关：仅看失效（orphaned）
├─ 列表：ScrollArea
│   └─ 每项 card
│       ├─ 首行：颜色圆点 + 划线文本（关键词命中片段高亮）+ 相对时间
│       ├─ 次行：doc_title · 段落后 40 字（block_text 截断）
│       └─ 尾部：跳转按钮 / 删除按钮（ConfirmDialog）
├─ 加载更多按钮（keyset 分页，不用无限滚动）
└─ 空态 / 首次加载态：empty + spinner
```

**协议**：

```ts
// 列表
request('annotation/list', {
    cursor: { createdAt: string; id: string } | null,   // keyset 游标
    limit: number,              // 默认 50，上限 200
    kind: 'highlight' | 'note' | null,
    color: HighlightColor | null,
    docPath: string | null,
    orphanedOnly: boolean,
    keyword: string,            // 去空白；< 3 字走 LIKE，≥ 3 字走 FTS
})
// → { items, nextCursor, total（仅首页返回，与筛选同条件 COUNT） }

// 统计（页面顶部可选展示）
request('annotation/stats', { docPath: string | null })
// → { total, highlights, notes, orphaned, byColor: Record<HighlightColor, number> }

// 跳转
request('annotation/reveal', { id })
// → { revealed: boolean; reason?: 'orphaned' | 'missing-file' }
// 内部复用 revealProofreadRange：按 start_offset/end_offset 转 Range 并选中

// 删除（仅列表入口，编辑区内删除走 editor/annotation/remove）
request('annotation/remove', { id })
```

**交互规则**：

- 搜索关键词高亮用 `block_text` / `quote` 的命中片段切片，前端只做拼接，不引入高亮库。
- 跳转前先校验文件存在（存储根内相对路径 + 文件系统检查）；文件已删则提示「原文已删除」，不打开空白编辑器。
- `orphaned` 项点击跳转给一次性提示「原文已修改，无法精确定位」，仍打开文档但不选中。
- 删除需二次确认（复用 `ConfirmDialog`），删除后本地移除该项并重算 `total`，不整页刷新。
- 列表只渲染当前页数据，不预加载全文；`replies` 等大字段不进列表载荷。

---

## 十、AI 查询

### 10.1 协议

```ts
// 请求
request('editor/query', {
    path,                    // 相对存储根路径
    quote,                   // 选中文本（≤ 2000 字）
    contextBefore,           // 选区前 ≤ 200 字
    contextAfter,            // 选区后 ≤ 200 字
    question,                // 可选：用户补充问题
    requestId,               // 前端生成，与流式增量关联
})
// 回：{ accepted: true }（拒绝时 ok:false + code）
// 流：StreamMessage { reqId: requestId, delta, done, channel: 'content', usage?, status? }
request('editor/query/abort', { requestId }) // → { aborted: boolean }
```

- 复用现有 `StreamMessage`（前端按 `reqId` 过滤），**不新增 stream 通道类型**，只新增 `HostMethodName` 两项。
- 宿主内部用 `AbortController` + 首字超时 30s / 总时长 90s；超时与取消都走 `done + status`。
- 若将来需要「查询历史 / 缓存」，再增加 `editor/query/history`（P2），不进 P0。

### 10.2 状态机

```
idle ──open Dialog & 发送──► sending ──首个 delta──► streaming
                                │                      │
                                │                      ├─ done → completed
                                ├─ 拒绝(未登录/超配额) → rejected
                                └─ 超时/通道错误 ──────► failed
streaming ──用户点停止 / 关闭 Dialog──► cancelling ──► cancelled
```

界面表现：`sending` 显示 `marker` + 骨架；`streaming` 逐字渲染；`completed` 底部出现「复制 / 重新查询」；`failed` 显示错误码对应文案 + 重试；`cancelled` 保留已生成内容并标注「已停止」。

### 10.3 Dialog 结构

```
DialogContent
├─ DialogHeader：标题「查询：<选中片段前 20 字>…」+ 模型名
├─ ScrollArea（max-h-[60vh]）
│   ├─ 引用块（灰底，展示选中原文 + 上下文折叠）
│   └─ 结果区：react-markdown + MARKDOWN_COMPONENTS（复用 aichat/markdown.tsx）
├─ 底部：用量（tokens / 耗时）、停止 / 复制 / 重新查询
```

- 关闭 Dialog 自动 `abort`（避免后台白烧 token）；`Esc` 同效。
- 结果不自动写回正文（用户要求只展示）；提供「复制为 Markdown」。

### 10.4 上下文组装与成本

| 注入 | 上限 | 说明 |
|---|---|---|
| 选中文本 | 2000 字 | 超限前端禁用「查询」并提示缩小范围 |
| 前后文 | 各 200 字 | 让模型有语境，不必读全文 |
| 文档标题 / 区块标题 | 取最近的上层标题 | 帮助判断语境 |
| 系统提示 | 固定 | 「你正在协助小说作者理解所选片段」 |

**不注入全文**：省 token、降低隐私面，也避免与「AI 对话」的长上下文能力重复。

### 10.5 校验与安全

- 路径校验：必须是存储根内的相对路径，先用 `toStorageRelativePath`（`src/modules/common/storagePath.ts:51`）归一化，再经 `toSafeSegments`（同文件 `:30`）逐段校验，拒绝 `..`、绝对路径、盘符与越界的符号链接；入口只接受相对路径，不接受前端拼好的绝对路径。
- 收录范围：只对存储根内的 `.md` 生效；菜单 `when` 除 `resourceLangId == markdown` 外还须加 `resourceScheme == file`，宿主侧再做一次路径归属校验（前端条件只用于收敛菜单可见性）。
- 长度校验：quote / context 超限直接 `ok:false, code:'payload-too-large'`。
- 前端不接触存储根绝对路径（现有约定：以 `@zhai/` 相对形式展示）。
- 隐私：首次使用弹出「选中文本将发送至 AI 服务」确认（存 `globalState`），可随时在设置关闭查询入口。
- 配额：沿用 `zhai.ai.dailyTokenBudget` 与 `UsageRecorder` 记账；新增 `zhai.editor.queryDailyLimit`（默认 50，0 表示不限）。
- 日志：只记长度与耗时，不记 quote 全文。

### 10.6 错误码

| code | 前端文案 | 处理 |
|---|---|---|
| `not-logged-in` | 需先登录 CodeBuddy | 按钮直达「登录 CodeBuddy」命令 |
| `quota-exceeded` | 今日查询次数已用完 | 停止入口禁用 |
| `token-budget-exceeded` | 已达到每日 Token 预算 | 同上 |
| `payload-too-large` | 选中内容过长 | 提示缩小选区 |
| `timeout` | 响应超时，请重试 | 提供重试 |
| `aborted` | 已停止 | 保留已生成内容 |
| `channel-error` | AI 通道异常 | 显示原始 message（脱敏） |

---

## 十一、目录与文件规划

```
src/editor/                               # 新 webview 入口（仅编辑器使用，避免拖累其它面板）
├─ index.html                             # Vite input 增补
├─ main.tsx                               # bootstrap(<EditorScreen />)
├─ EditorScreen.tsx                       # 布局：文档信息卡 + 编辑区 + 状态栏（字数 / 模式）
├─ EditorContent.tsx                      # 内核心挂载点（TipTap）；切换 CM6 时只改这里
├─ blocks/
│  ├─ BlockHandle.tsx                     # 块拖拽把手与拖拽排序（Notion-like 交互）
│  └─ uniqueId.ts                         # 块运行期 id 扩展：renderHTML 不输出 data-id（见 5.5）
├─ toolbar/
│  ├─ SlashMenu.tsx                       # `/` 命令（shadcn command + popover）
│  └─ TurnIntoMenu.tsx                    # 块类型转换（段落 / 标题 / 列表 / 引用）
├─ marks/
│  ├─ highlightMark.ts                    # 划线 Mark（属性：color）
│  ├─ annotationPlugin.ts                 # 段末图标的 Decoration 插件
│  └─ sourceNode.ts                        # 非白名单语法降级为原子源码块
├─ serialize/
│  ├─ toDoc.ts                            # Frontmatter 分离 + mdast → PM doc
│  └─ toMarkdown.ts                       # PM doc → mdast → 文本（含脏块回填）
├─ layout/
│  ├─ SelectionToolbar.tsx                # 浮动菜单（Popover + 按钮组）
│  ├─ HighlightPalette.tsx                # 色板（ToggleGroup）
│  ├─ AnnotationPopover.tsx               # 段末图标气泡
│  ├─ AnnotationDialog.tsx                # 新建 / 编辑批注
│  └─ QueryDialog.tsx                     # AI 查询
├─ hooks/
│  ├─ useEditorDocument.ts                # 与宿主同步内容 / 版本 / 脏标记
│  ├─ useSelectionToolbar.ts              # 选区 → 菜单状态与坐标
│  ├─ useAnnotations.ts                   # 标注读写与重定位后的装饰刷新
│  └─ useDocumentQuery.ts                 # 查询状态机（含 abort）
└─ constants.ts                           # 颜色枚举、菜单项、阈值

src/modules/editor/                       # 宿主侧
├─ editorProvider.ts                      # CustomTextEditorProvider（TextDocument 模式，见 6.2）
├─ openDocument.ts                        # 打开入口统一封装：已有 tab 复用，否则 openWith 富文本（见 6.5）
├─ activeDocument.ts                      # 活跃文档事实源：text / rich 两类，替代散落的 activeTextEditor（见 6.6）
├─ editorRoutes.ts                        # 编辑区方法（editor/doc | change | insert | reveal | annotation/*）
├─ annotationRoutes.ts                    # 总览页方法（annotation/list | stats | reveal | remove）
├─ annotationRepository.ts                # 单行 CRUD + 事务批量重定位（两条路线共用）
├─ annotationSearch.ts                    # 分页 / 过滤 / 关键词（FTS，1–2 字退 LIKE）
├─ annotationService.ts                   # 标注编排 + 装饰重放（渲染无关）
├─ annotationAnchor.ts                    # 锚点生成与重定位算法（纯函数，便于单测）
├─ annotationComments.ts                  # Comment API 控制器（9.6 的 thread 模式，P1）
├─ db/connection.ts                       # 连接缓存 + PRAGMA + 降级 + 损坏留档 + 关全部
├─ db/schema.ts                           # annotations DDL + FTS5 + 三触发器 + user_version
├─ queryService.ts                        # AI 查询编排（provider + usage + abort）
└─ queryPrompt.ts                         # 提示词与长度裁剪

src/workflow/annotation/                  # 工作流「标注总览」页（P1）
├─ WorkflowAnnotation.tsx                 # 筛选栏 + 列表 + 分页
├─ hooks/useAnnotationList.ts             # 查询、搜索防抖、加载更多、删除后刷新
└─ layout/AnnotationListItem.tsx          # 划线文本 / 时间 / 文档 + 段落片段 / 跳转

src/shared/types/editor.ts                # 标注 / 查询 / 文档同步类型
docs/modules/editor.md                    # 模块文档（实现期补）
```

数据位置：标注落 `{存储根}/sqlite/annotations.db`（与 `media.db` 同级），不写 md、不进 `index.db`；`annotationRepository` / `annotationAnchor` / `db/` 在两条路线下都不改。

宿主接入点改动清单：

| 文件 | 改动 |
|---|---|
| `vite.config.mjs` | `input` 增加 `editor: src/editor/index.html` |
| `src/shared/types/messages.ts` | `HostMethodName` 增加 `editor/*`、`annotation/list` 等；`StateMessage.channel` 增加 `'editor'` |
| `src/extension.ts` | 装配 `EditorLayer`、注册 provider 与命令、`trackActiveDocument`；`deactivate` 关闭标注库连接 |
| `src/modules/note/noteService.ts`、`src/modules/press/projectService.ts`、`src/modules/wechat/issueService.ts`、`src/modules/wechat/issueDocument.ts` | 打开入口改调 `openStorageDocument`（见 6.5 清单） |
| `src/modules/ai/workflowRouter.ts`、`src/modules/common/insertTarget.ts`、`src/modules/common/dashboardProvider.ts`、`src/modules/ai/chatService.ts`、`src/modules/ai/aiChatProvider.ts`、`src/modules/note/noteRenameService.ts`、`src/modules/proofread/proofreadService.ts`、`src/modules/proofread/target/targetReader.ts`、`src/modules/stock/stockTargetService.ts` | `activeTextEditor` 改读 `activeDocument` 抽象（见 6.6 优先级） |
| `src/activation/editorLayer.ts` | 新装配层（复用 `ai.aiProvider` / `ai.usageRecorder`；标注库走 `createStorageDatabaseProvider`） |
| `src/activation/lifecycle.ts` | `zhai.*` 配置变更回调追加 `closeAnnotationsDatabases()`（与 media / stock 并列） |
| `src/workflow/layout/workflowSections.ts` | `WORKFLOW_SECTIONS` 增加 `'annotation'`（类型与运行时白名单同源） |
| `src/workflow/layout/contentScope.ts` | `RESIDENT_SECTIONS` 增加 `'annotation'`（跨文档，任何归属可见） |
| `src/workflow/layout/WorkflowNav.tsx` | 新增导航入口 |
| `src/workflow/layout/WorkflowResidentSection.tsx` | `section === 'annotation'` 渲染 `<WorkflowAnnotation />` |
| `package.json` | 命令、菜单、`zhai.editor.*` 配置项 |
| `src/globals.css` | 划线颜色令牌与图标样式 |

---

## 十二、实施分期

| 阶段 | 内容 | 预估 | 产出判定 |
|---|---|---|---|
| P0-1 | 依赖与入口：webview 入口、CustomTextEditorProvider（TextDocument 模式）、`openWith` 打开清单、`activeDocument` 抽象、保存 / 脏标记 | 4–5 人日 | 插件打开走富文本、资源管理器打开走原生；工作流路由跟随当前文档 |
| P0-2 | md ↔ doc 往返（白名单 + 源码降级 + 源码模式开关 + 幂等自检） | 4–6 人日 | AC-2 / AC-3 通过 |
| P0-2b | Notion-like 交互基座（开源）：块拖拽、`/` 命令、turn into、块 id、颜色 / 对齐 / 表格 / 任务列表、emoji 与 `@` | 8–12 人日 | AC-17 通过 |
| P0-3 | 浮动菜单：选区触发、定位、复制、键盘操作 | 1–2 人日 | AC-4 通过 |
| P0-4 | 划线：Mark + 色板 + 取消 + 标注库（DDL / 连接 / 事务写入）+ 重定位 | 4–5 人日 | AC-5 / AC-6 / AC-10 通过 |
| P0-5 | 批注：块锚点 + 段末图标 + 气泡 + 增删改 | 3 人日 | AC-7 通过 |
| P0-6 | 查询：协议 + 流式 + Dialog + 取消 + 配额 | 2–3 人日 | AC-8 通过 |
| P1 | **工作流标注总览页**（分页 / 时间 / 段落 / 关键词检索 / 跳转）、orphaned 处理、改色、Ctrl+F | 5–6 人日 | AC-12 / AC-13 通过 |
| P2 | 标注导出（md 内 HTML 注释）、快照恢复向导、查询历史与缓存 | 3–5 人日 | — |

依赖顺序：P0-1 为总前置；P0-2 与 P0-2b 可并行；P0-4 / P0-5 依赖 P0-2 的往返管线。P1/P2 不阻塞 P0 交付。

**若最终选档 A**：上表的 P0-1、P0-2、P0-2b、P0-3 不执行（原生编辑器没有块模型，Notion-like 的拖拽与 `/` 菜单不成立），改为「装饰层 2–4 人日」+「标注库 / 锚点 / 清单 4–6 人日」；P0-4 的划线与 P0-5 的批注改为生成 decoration 而非 PM 装饰，业务规则、表结构与协议不变。也就是说，1.1 的共用资产是两条路线唯一值得先投的部分。

---

## 十三、验收标准

| 编号 | 场景 | 指标 |
|---|---|---|
| AC-1 | 打开 / 保存 | 10 万字文档打开 < 1.5s；保存 < 300ms；Ctrl+S / 关 tab 提示 / 热退出恢复均正常 |
| AC-2 | 往返保真 | 白名单语法转换后与原文逐字符一致（空行 / 列表符号 / 强调符 / 表格对齐） |
| AC-3 | 往返幂等 | 打开 → 不做修改 → 保存，文件字节级不变 |
| AC-4 | 浮动菜单 | 选中文本后 200ms 内出现；滚动 / 缩放 / 窗口变化位置正确；Esc 与点击外部关闭；不抢焦点、选区不丢 |
| AC-5 | 划线 | 划线后总字数统计不变；再次选同色取消；改色即时生效；重启 VSCode 后划线仍在 |
| AC-6 | 锚点重定位 | 在划线前插入 / 删除 500 字，10 条标注全部仍正确（构造用例 10 条，成功率 100%） |
| AC-7 | 批注 | 段末图标位置随段落移动；同段多条显示计数；删除段落后转 orphaned 且可从列表删除 |
| AC-8 | 查询 | 首字 < 2s；可停止且停止后不再消耗；关闭 Dialog 即中断；未登录 / 超配额有明确文案 |
| AC-9 | 安全 | 标注读写路径限定存储根内；越界路径请求被拒；日志不含选中全文 |
| AC-10 | 非侵入 | 划线 / 批注的增删改后，md 的 `mtime` 与内容 hash 均不变（可用脚本断言）；文件中不存在任何标注标记；原生文本编辑器打开行为不变 |
| AC-11 | 回归 | `dashboard` / `workflow` 两个 webview 产物大小增幅 < 5%，现有页面无样式冲突 |
| AC-12 | 标注总览 | 跨文档列表首屏 < 500ms（1000 条标注）；时间倒序正确；每条展示划线文本、时间、文档与段落后 40 字；关键词 ≥3 字走 FTS、1–2 字走 LIKE，均有结果；点击跳转选中原文；orphaned 项标注「原文已修改」且跳转给提示 |
| AC-13 | 存储与恢复 | 库文件位于 `{存储根}/sqlite/annotations.db`；改存储根后页面展示新根数据，旧根数据不被改写；`quick_check` 失败时原库留档且用户能看到提示；`VACUUM INTO` 快照可被 SQLite 正常打开 |
| AC-14 | 入口区分 | 资源管理器双击 / VSCode 新建的 `.md` → 原生编辑器；仪表盘打开笔记、作品章节、公众号正文 → 富文本；同一文件已有 tab 时聚焦复用、不新开第二个编辑器 tab；「用文本编辑器打开」可立即退回 |
| AC-15 | 双编辑器并存 | 同一文件同时以文本与富文本打开时，任一端修改 500ms 内另一端可见；两端各自保存后内容一致；不出现静默覆盖或整段丢失 |
| AC-16 | 活跃文档 | 富文本 tab 位于最前时，工作流面板的模块 / 作品归属随当前文档切换（不再停在上一个文档）；插入类操作在富文本下给出明确提示而不是静默失败 |
| AC-17 | Notion-like 交互 | 块可拖拽重排且保存后 md 顺序正确；`/` 菜单可插入标题 / 列表 / 引用 / 代码块 / 图片 / 分隔线；turn into 转换不丢内容；保存后文件内无 `data-id` 等块标识；重开文档后批注图标仍挂在原段落 |

---

## 十四、风险与开放问题

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| md 往返重排用户手写格式 | 高 | 高（信任受损、Git diff 噪音） | 脏块回填、幂等自检、源码模式、开启前快照；连续不达标则切 CM6（见 5.1） |
| 撤销不跨 tab 精确 | 必然 | 中 | 以文档内容为唯一真相；两端各自撤销后最终内容一致，不保证单步精确；发布说明明示 |
| 两种编辑器并存导致内容分叉 | 中 | **高** | 走 `TextDocument` + 最小 diff，不用 `CustomDocument` 自管；`applyEdit` 带来源标记避免回声；AC-15 硬验收 |
| 富文本 tab 无 `activeTextEditor`，路由与插入失效 | 必然 | 高 | `activeDocument` 抽象（6.6）；P0 先对插入类操作给出明确提示，P1 补 `editor/insert` |
| 已有文本 tab 时插件打开不切富文本 | 预期行为 | 低 | 明确策略（复用 tab 优先）；需要切换时用命令「用富文本编辑器打开」 |
| 标注锚点漂移 / 孤儿 | 中 | 中 | 引用+上下文+偏移三重校验；orphaned 可见可处理；不自动删除用户数据 |
| 自定义编辑器丢失原生能力（查找 / 大纲 / Git diff） | 必然 | 中 | 明示 + 源码模式兜底；P1 补 webview 内查找 |
| IME 组字期间推送导致丢字 / 重复 | 中 | 高 | composition 期间不推送；组字结束补推；中文长句专项测试 |
| 双向同步冲突（外部修改） | 中 | 高 | 版本号 + 冲突提示，禁止静默覆盖；保存前 flush |
| 大文档性能（10 万字 + 数十标注） | 中 | 中 | 装饰按视口计算；重定位只在打开/保存执行；序列化按脏块增量 |
| 浮动菜单在缩放 / 分屏下错位 | 中 | 低 | `coordsAtPos` 实时计算 + scroll/resize 重算；scroll 离屏即关 |
| 体积膨胀 | 中 | 低 | 独立入口；复核另两个入口 chunk；必要时 `manualChunks` |
| 依赖维护风险（TipTap 3 / markdown 扩展为较新能力） | 中 | 中 | 版本锁死；往返逻辑自带单测；保留 CM6 切换路径 |
| 误引入 Pro 扩展（drag handle / emoji / unique id 曾属 Pro） | 中 | 中 | 安装前核对包名 scope 与 `license`；任何 `@tiptap-pro/*` 一律不引入，用等价自写替代（块 id 可用自定义 Node attribute + `nanoid`） |
| 开源扩展版本与 Tiptap 3 主线不一致 | 中 | 中 | 统一在同一个 minor 版本内；用 `pnpm.overrides` 锁 `@tiptap/*` 版本，避免多份 PM 副本 |
| 块 id 泄漏进 Markdown | 中 | 高 | `renderHTML` 不输出 `data-id`，序列化剥离；AC-17 用文件内容断言 |
| 标注库损坏即丢数据（不可从 md 重建） | 低 | **高** | `quick_check` 失败留档并明示；每日 `VACUUM INTO` 快照保留 7 份；写入事务 + `synchronous = FULL`；不做静默重建 |
| 存储根位于云同步目录，同步中途产生半个库 | 中 | 高 | 用 `journal_mode = DELETE` 而非 WAL（与 `media.db` 同口径）；库文件与 md 一起同步，不做跨目录拆分；提示用户在同步目录外做快照 |
| 换存储根后仍写旧库 | 中 | 中 | 模块级连接缓存 + `closeAnnotationsDatabases()` 挂在 `zhai.*` 配置变更与 `deactivate` |
| 文档改名后 `doc_path` 失配 | 中 | 中 | `onDidRenameFiles` 执行 `UPDATE ... SET doc_path`；`onDidDeleteFiles` 置 `orphaned`，不物理删除 |
| 档 A 下段末图标不可点击、查询退化为侧栏问答 | 必然（若走档 A） | 中 | 需求方显式确认后再选档；视觉用 `after.contentText`，交互退到 hover command / gutter / Comment API；要编辑区弹窗只能升档 B |
| 原生 Comment 线程重启丢失 | 中 | 中 | 标注库存 `mode` / `replies`，重开时按记录重建；重建失败置 orphaned 而非丢弃 |
| CSP / 内联脚本 | 低 | 高 | 所有依赖走打包；不引入 eval；样式内联已放行 |

**开放问题**

1. 划线颜色是否需要支持自定义取色？当前用 5 色枚举，若需要则要解决深色主题可读性。
2. 是否把标注也写入 md（`<!-- zhai:annotation ... -->`）以便无插件环境可见？与「正文零侵入」冲突，建议只在「导出」时可选内联。
3. 批注是否需要回复线程？需要则按 9.6 走 Comment API（`mode: 'thread'`），不需要则保持单条内容，省掉线程重建逻辑。
4. 富文本模式是否默认开启？建议默认关闭、按文档记忆，避免存量用户格式被重排。
5. 是否复用「AI 对话」会话通道承载查询（可多轮追问）？当前设计为一次性查询，多轮需要引入会话 id 与消息表。

---

## 十五、置信度与需确认项

### 15.1 置信度分级

| 判断 | 置信度 | 依据 / 需要验证的方式 |
|---|---|---|
| 原生 decoration 能复刻马克笔、直线、删除线 | 高 | API 明确支持 `backgroundColor` / `textDecoration`；`after.contentText` 支持段末附加内容 |
| 原生波浪线在各主题 / 字体下的渲染效果 | 中 | `textDecoration: 'underline wavy <color>'` 走 CSS，平台差异存在；需在扩展宿主里手工确认（不生成截图） |
| Comment API 能承载想法并自动跟随编辑 | 高 | `CommentThread.range` 由编辑器随文档变更更新；但线程本身不持久化，需自建重建逻辑 |
| 自定义编辑器下 md 往返保真 | 中 | 白名单内可控，白名单外靠源码块降级；需用真实稿件做往返回归 |
| 锚点重定位在大幅改写后的命中率 | 中 | 算法确定，命中率取决于改写幅度；靠 orphaned 兜底，不承诺 100% |
| 10 万字文档 + 数十标注的编辑性能 | 中 | ProseMirror 按视口渲染，风险主要在实际测量；需在 P0-2 后用真实长章压测 |
| 新增 webview 入口不影响既有两个入口的包体 | 中 | 取决于 Vite 是否把内核提升为共享 chunk；AC-11 已列为硬指标 |
| 按打开入口区分编辑器 | 高 | `vscode.openWith` 为官方 API，调用点可控；不改 associations 就不会影响资源管理器与新建行为 |
| 双编辑器共享 `TextDocument` 的写入时机 | 中 | 最小 diff + 来源标记可避免回声；500ms 窗口内的并发编辑需靠"最后写入者 + 冲突提示"兜底 |
| FTS5 trigram 支持中文搜索 | 高 | 项目 `files_fts` 已是同一方案；限制明确：1–2 字关键词索引不到，需 LIKE 兜底（已写入 8.1） |
| 存储根云同步目录下的 SQLite 稳定性 | 中 | 与 `media.db` 同一套 PRAGMA（`DELETE` + `FULL`），已有先例；风险仍在，靠快照与留档兜底 |
| 开源扩展足以覆盖 Notion-like 交互 | 高 | 官方扩展总览已将 drag handle、unique id、emoji、mention、file handler、mathematics、table、image、highlight、text align 标注为 Open source |
| 块 id 能稳定支撑批注锚点 | 中 | 仅运行期存在，重开即重建；必须保留 `block_hash` 与 `quote` 兜底 |

### 15.2 需要拍板的事项

| # | 决策 | 推荐值 | 代价 |
|---|---|---|---|
| 1 | 接受档 A 的三处降级（无浮动菜单、段末图标不可点、查询退侧栏），还是走档 B 复刻参考图 | **先做共用层，两周后再定** | 档 A 约 9–15 人日；档 B 约 20–27 人日（均含总览页） |
| 2 | 标注数据放 sidecar 还是 SQLite | **已定：SQLite**，`{存储根}/sqlite/annotations.db`（与 `media.db` 同级） | 换来跨文档分页 / 过滤 / FTS 检索；代价是库损坏不可从 md 重建，必须配快照与留档 |
| 3 | 标注是否随存储根进 Git / 云同步 | **库文件随存储根一起走**（不做 sidecar） | 云同步完整性依赖 `journal_mode = DELETE`；跨端偏移漂移仍靠引用上下文重定位 |
| 4 | 「写想法」是单条内容还是回复线程 | **P0 单条，P1 按需加线程** | 线程要自建重建逻辑，且 UI 不可定制 |
| 5 | 插件打开的文档是否默认用富文本 | **是**，按 6.5 入口清单；资源管理器 / VSCode 新建仍走原生 | 需改造 5 个打开调用点与活跃文档抽象；用户仍可用「用文本编辑器打开」退回 |
| 6 | 同一文件已有 tab 时是否强制切富文本 | **不强制**，聚焦已有 tab | 强制会同时存在两个编辑器 tab，并打断用户当前编辑 |
| 7 | Notion-like 基座走商业模板还是开源自建 | **已定：开源自建**，不引入官方模板 | 官方模板需订阅且自带 Cloud AI / 协作 / 重复 UI；开源扩展已覆盖其块级能力 |
