# Zhai 项目长期记忆

## 项目定位
- `zhai-vscode`：面向「写小说 + 写代码」的 VSCode 插件；Markdown 主存储，SQLite（better-sqlite3）只做缓存索引、**不存正文**。
- 设计文档在 `docs/`（`docs/modules/*.md` 模块设计、`docs/development.md` 四期路线图）。源码注释标注「设计源：docs/...」，改代码须同步文档。

## 工程约定
- 代码风格：4 空格缩进、单引号、无分号、中文注释；提交前 `pnpm run verify`（typecheck + `eslint .` + vitest run + `prettier --check src eslint.config.mjs`）须全绿。
- `lint` 是 `eslint .`（覆盖全仓含根目录配置/脚本）；根目录新增任何配置/脚本文件须同步加进 `tsconfig.json` 的 include，否则类型感知规则报「not found by the project service」。
- 构建：`compile` = typecheck（TS 7）+ esbuild（宿主）+ vite（webview 多入口）。`vite.config.mjs` 文件名不可改（shadcn CLI 以此判定框架）。
- 打包：`package` = compile + `node bundle-native.mjs`（better-sqlite3 原生模块随包并校验 prebuilds）+ `vsce package --no-dependencies`（必须带，否则 vsce 用 npm list 检测 pnpm 布局报 missing 并中止）。长命令易中断，拆步执行。
- Webview 目录结构（2026-09-25 起）：页面按目录组织——仪表盘 `src/webview/index.html` + `main.tsx` + `dashboard.tsx`；AI 对话 `src/webview/aichat/`（`aichat.html` 入口、`aichat.tsx` 挂载、`ai-chat.tsx` 主组件、`message-view.tsx` 消息渲染、`format.ts` 格式化工具）。子目录入口产物在 `dist/webview/aichat/`，宿主 `buildWebviewHtml` 以相对路径定位（`'aichat/aichat.html'`），其资源引用带 `../` 前缀，`webviewHtml.ts` 正则已兼容；浏览器预览地址 `http://localhost:5173/aichat/aichat.html`。
- Webview 公共设施：`bootstrap.tsx` 主题同步 + 挂载、`bridge.ts` reqId 请求-响应与浏览器降级、宿主 `buildWebviewHtml` 注入 CSP 并重写资源 URI。
- 环境注意：删除操作优先用 delete_file 工具（PowerShell Remove-Item 易触发保护/超时）；耗时命令重定向到文件防超时。
- 推送：远端已用 SSH `git@github.com:baiwanyi/zhai.vscode.git`（https 直连 443 不通），直接 `git push` 即可。
- pnpm 坑：新包含安装脚本时会在 `pnpm-workspace.yaml` 的 allowBuilds 写占位行并报错，须逐条改 true/false 后重装。
- TS 双版本：`typescript` 别名 → @typescript/typescript6（typescript-eslint 用）；`@typescript/native` 别名 → TS 7（typecheck 用）。
- ESLint 10 扁平配置：@eslint-react 替代 eslint-plugin-react；`src/components/ui` 与 `src/hooks`（shadcn 托管）豁免多数规则；noInlineConfig 禁止 eslint-disable。import-x/order 组序 builtin → external → internal(@/) → sibling(./) → index → type（parent 未列出、排在 type 之后）；type 组内按字母序。
- shadcn/ui：组件在 `src/components/ui`、hooks 在 `src/hooks`，别名 `@/*` → `src/*`；UI 组件内 `cn` 直接 `from 'cn'`。
- Tailwind 4：`src/webview/globals.css` 必须保留 `@source '..';`（Vite root 是 src/webview，缺它则 src/components 等目录类名不生成、组件裸元素）。
- 主题桥接：globals.css 末尾 `:root, .dark { … }` 把 shadcn 语义令牌全指向 `--vscode-*` 变量，亮/暗/高对比自动跟随、无需维护色值；该段必须在文件末尾，`shadcn apply/init` 重写后需补回。字号与圆角不与 VSCode 同步。
- Markdown 渲染：react-markdown + remark-gfm（devDependencies 随 webview 打包），样式逐标签映射主题令牌类名，**不引 typography 插件**（prose 与气泡样式互相覆盖）。
- shadcn 组合规则（skill 强制，禁止自绘 markup）：空态 Empty（+Header/Media/Title/Description/Content）、输入区 InputGroup + InputGroupTextarea/Button（禁裸 Textarea）、分区 Separator（禁 border-t）、提示 Alert、占位 Skeleton、状态 Badge、条件类名 cn()、Button 图标 data-icon 且不加 size-*、用 flex gap 替代 space-y-*。消息不带头像与角色标签（对齐 Copilot/CodeBuddy）：用户消息 Bubble default（BubbleContent 加 w-max max-w-full），助手 Bubble ghost + w-full；引用条目（Badge）放用户气泡内正文之上，不放消息/会话头部。
- **禁止截图验证**（含脚本/无头浏览器）；视觉核对一律由用户手工进行；必要时可临时建 `src/webview/_probe.html` + `_probe.tsx` 探针页（硬编码数据、用完删除并停 5173）。
- 测试：Vitest（`test`/`test:watch`），配置在根目录 `vitest.config.mts`（独立于 vite.config.mjs），alias `@` → src、`vscode` → `src/tests/stubs/vscode.ts`；测试桩按完整接口构造、不用类型断言，模块级状态用 `resetWorkspaceState()` 复位（vscode `translate`/`with` 桩须接受联合参数）；测试就近放 `src/**/*.test.ts`。
- 安全：宿主 SQL 一律预编译参数绑定；Webview 触发宿主命令走白名单（`src/modules/common/webviewCommands.ts`）；Webview 不传文件路径、只收宿主生成的 id，入参逐字段收窄后再用。
- 脚本目录：构建/命令脚本统一放 `scripts/`（现仅 esbuild.mjs、bundle-native.mjs），脚本内取项目根须上溯一级；配置文件留根目录（vite/vitest/eslint.config）。

## 已落地的视图与命令
- 侧栏 `zhai-sidebar`：`zhai.dashboard`（`Ctrl+K`）、`zhai.aiChat`（`Ctrl+Shift+L`）。
- 命令：`zhai.rebuildIndex` / `openDashboard` / `showIndexStatus` / `clearIndex` / `exportDiagnostics` / `openSettings` / `openAiChat` / `ai.addToChat` / `ai.setApiKey` / `ai.clearApiKey`。
- Webview→宿主协议：`dashboard/stats`、`index/rebuild`、`ai/session|newSession|sessions|switchSession|deleteSession|runtime|send|abort`、`ai/context|context/remove|context/clear`、`host/command`（白名单）；宿主→Webview 推送 `stream` 与 `state`（`payload.kind` = runtime/context）。
- 数据：`globalStorage/index.db`（文件元数据 + FTS5）、`globalStorage/ai.db`（conversations/messages/ai_usage_logs），共用 `common/db/openDatabase.ts` 连接基座。
- AI 对话：DeepSeek 经 openai SDK 流式，密钥存 SecretStorage（`zhai.deepseek.apiKey`）；对话模式、编辑器右键上下文引用、会话历史浮层（切换/hover 删除）已落地；写作模式 diff 续写与 `@` 提及待实现（见 `docs/modules/ai-chat.md` 第 10 节）。
- 搜索：FTS5 检索（`searchFiles`）与 `zhai.search.limit` 配置保留，搜索面板待实现（路线图 C7）。

## 用户偏好
- 单次改动超 2 个文件先给方案确认；存在歧义列选项。改动超 5 个文件完成后弹窗询问是否 git 提交。
- **不擅自提交**：默认保留工作区，由用户决定是否提交。
- 提交信息中文撰写、conventional commits 前缀保留英文（`feat(dashboard): …`）；含中文的提交用 `git commit -F <UTF-8 文件>`，避免 PowerShell 参数乱码。
- 中文沟通；偏好最小破坏、与既有约定一致；重视文档与注释同步。
- 环境：Windows + PowerShell；pnpm 12.4.1。
