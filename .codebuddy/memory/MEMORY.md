# Zhai 项目长期记忆

## 项目定位
- `zhai-vscode`：面向「写小说 + 写代码」的 VSCode 插件；Markdown 做主存储，SQLite（better-sqlite3）只做缓存索引，**不存正文**。
- 设计文档在 `docs/`：`docs/modules/common.md`（Common 契约/命令/AC）、`docs/development.md`（四期路线图）、`docs/modules/dashboard.md`（仪表盘设计）。源码注释普遍标注「设计源：docs/...」，改代码须同步文档。

## 工程约定
- 代码风格：4 空格缩进、单引号、无分号、中文注释；提交前 `prettier --check src eslint.config.mjs` 应全绿。
- 构建链路：`pnpm run compile` = typecheck（TS 7）+ esbuild（宿主）+ vite（webview 多入口）。`vite.config.mjs` 文件名不可改（shadcn CLI 以 `vite.config.*` 判定框架，改名会导致其命令不可用）。
- 打包：`pnpm run package` = compile + `node bundle-native.mjs` + `vsce package --no-dependencies`。**必须带 `--no-dependencies`**——vsce 内部用 `npm list` 检测生产依赖，pnpm 的符号链接布局会让它报一堆 `npm error missing: …` 并中止。运行时依赖中 `openai` 已被 esbuild bundle 进 dist/extension.js，只剩 `better-sqlite3`（原生模块，external）需要随包，由 `bundle-native.mjs` 用 npm 装到 `dist/node_modules/`（Node 从 dist/extension.js 向上即可解析），并校验 `prebuilds/<platform>-<arch>.node` 存在。`bundle-native.mjs` 在 `pnpm run package` 里跑得动，但该命令整体易被判为长任务中断，必要时拆成 `node bundle-native.mjs` + `pnpm exec vsce package --no-dependencies` 两步。实测 vsix 72 文件 / 8.74 MB。
- 环境操作注意：删除操作（尤其 `Remove-Item` 批量）会触发 safe-delete 保护或审批超时——优先用 delete_file 工具，或不要在命令里混入删除；`pnpm run package` 这类长任务容易被中断，拆步执行。
- pnpm 环境坑：`pnpm add` 遇到含安装脚本的新包时会往 `pnpm-workspace.yaml` 的 `allowBuilds` 写入 `包名: set this to true or false` 占位行并报 `ERR_PNPM_IGNORED_BUILDS`，必须逐条改成 `true`/`false` 后重跑 `pnpm install`（已登记：better-sqlite3 / esbuild / unrs-resolver / '@vscode/vsce-sign' = true，keytar = false）。
- 调试与开发流见 `.vscode/`：`launch.json` 提供「运行扩展」（preLaunchTask = compile，会跑 typecheck + esbuild + vite，约 10s）与「运行扩展（跳过编译）」（配合 `pnpm run watch:all` 常驻，改宿主代码后 Ctrl+R 重载）；`tasks.json` 提供 compile / watch:all / webview 预览（浏览器预览没有 `--vscode-*` 变量也没有宿主通信，只用于核对样式）。webview 是构建产物，改前端后需重新构建并在宿主内重开视图。
- TS 双版本：`typescript` 别名 → `@typescript/typescript6`（供 typescript-eslint 的 TS 6 API）；`@typescript/native` 别名 → TS 7（提供 `tsc` bin，typecheck 用它）。
- ESLint 10 扁平配置（`eslint.config.mjs`）：已移除 eslint-plugin-react（不兼容 10），改用 `@eslint-react/eslint-plugin`；`src/components/ui` 与 `src/hooks` 为 shadcn 托管目录、豁免多数规则；`noInlineConfig` 禁止 eslint-disable 注释。
- shadcn/ui：组件在 `src/components/ui`、hooks 在 `src/hooks`，路径别名 `@/*` → `src/*`；UI 组件内 `cn` 直接 `from 'cn'` 导入（不是 `@/lib/utils`）。
- Tailwind 4 扫描范围（重要）：`src/webview/globals.css` 必须保留 `@source '..';`。Vite root 是 `src/webview`，Tailwind 自动源检测只覆盖 root 内文件，缺该指令会让 `src/components`、`src/hooks`、`src/lib` 的类名完全不生成——组件渲染成无样式裸元素。带上后产物 CSS 约 190 kB（gzip ≈ 28 kB），不带只有约 16 kB。
- 主题桥接（重要）：`globals.css` 末尾的 `:root, .dark { … }` 段把 shadcn 语义令牌全部指向 VSCode 注入的 `--vscode-*` 变量（`--background` ← `sideBar-background`、`--primary` ← `button-background`、`--primary-hover` ← `button-hoverBackground`、`--muted` ← `list-hoverBackground`、`--border` ← `panel-border`、`--ring` ← `focusBorder`、`--placeholder` ← `input-placeholderForeground`、`--input-background` ← `input-background`、`--code-background` ← `textCodeBlock-background`、`--link` ← `textLink-foreground`、`--font-ui` ← `font-family`、`--font-code` ← `editor-font-family`、`--widget-shadow` ← `widget-shadow`），因此亮/暗/高对比与任意第三方主题都会自动跟随，**不需要为每套主题维护色值**。该段必须留在文件末尾（`@import` 只能放顶部，拆文件会被默认值覆盖），且 `shadcn apply/init` 会重写 globals.css、覆盖后需补回。同文件另含 `::-webkit-scrollbar`（`scrollbarSlider-*`）、`::selection`（`editor-selectionBackground`）、高对比补实边框（`contrastBorder`）与 `prefers-reduced-motion` 降级。**字号与圆角不同步**（VSCode 无圆角变量；字号同步会因组件用绝对 rem 而整体缩小约 19%）。Inter 字体依赖已移除，字体全部来自主题。
- Webview Markdown 渲染：用 `react-markdown` + `remark-gfm`（与 `docs/modules/markdown-one.md` 的 unified/remark 选型一致），作为 devDependencies 随 webview 打包；样式通过 `components` 逐标签映射主题令牌类名，**不引入 Tailwind typography 插件**（prose 会与气泡/消息样式互相覆盖）。
- shadcn 组合规则（skill 强制，禁止自绘 markup）：空态用 `Empty`（+EmptyHeader/EmptyMedia variant="icon"/EmptyTitle/EmptyDescription/EmptyContent）；输入区含按钮用 `InputGroup` + `InputGroupTextarea`/`InputGroupButton`（禁止裸 `Textarea`）；分区用 `Separator`（禁止 `border-t`）；提示用 `Alert`；加载占位用 `Skeleton`；状态用 `Badge`；条件类名走 `cn()`；Button 内图标用 `data-icon` 且不加 `size-*`；`space-y-*` 换成 `flex flex-col gap-*`。AI 对话页的配套组件还有 `message.tsx`、`bubble.tsx`、`marker.tsx`（思考中状态）。
- Webview 视觉调试方法：浏览器预览下 `request()` 直接 reject（`acquireVsCodeApi` 为 null），页面拿不到真实数据，看不出布局问题。做法是临时新建 `src/webview/_probe.html` + `_probe.tsx`（复用真实组件结构 + 硬编码数据，可并排多个容器宽度），`pnpm run webview:serve` 后用 `agent-browser open/screenshot` 截图核对，验证完删除探针、停掉 5173 监听进程并 `agent-browser close`。
- Webview：Vite 多入口（`src/webview/index.html` = 仪表盘，`aichat.html` = AI 对话）；`bootstrap.tsx` 把 `data-vscode-theme-kind` 同步为 `.dark`；`bridge.ts` 提供 reqId 请求-响应与浏览器降级；宿主统一用 `buildWebviewHtml` 注入 CSP 并重写资源 URI。
- 安全约束：宿主 SQL 一律预编译参数绑定；Webview 若要触发宿主命令，必须走白名单（见 `webviewCommands.ts` 的 `WEBVIEW_ALLOWED_COMMANDS`）；Webview 不得传文件路径——涉及文件的操作只接受宿主自己生成的 id（引用上下文即按此实现），所有 Webview 入参一律逐字段收窄后再用。

## 已落地的视图与命令
- 侧栏容器 `zhai-sidebar`：`zhai.dashboard`（仪表盘，原「全局搜索」，`Ctrl+K` 聚焦）、`zhai.aiChat`（AI 对话，原「工作区」占位，`Ctrl+Shift+L` 聚焦）。
- 命令：`zhai.rebuildIndex`、`zhai.openDashboard`、`zhai.showIndexStatus`、`zhai.clearIndex`、`zhai.exportDiagnostics`、`zhai.openSettings`、`zhai.openAiChat`、`zhai.ai.addToChat`（编辑器右键「添加到宅对话」）、`zhai.ai.setApiKey`、`zhai.ai.clearApiKey`。
- Webview→宿主协议：`dashboard/stats`、`index/rebuild`、`ai/session|newSession|runtime|send|abort`、`ai/context|context/remove|context/clear`、`host/command`（白名单见 `src/modules/common/webviewCommands.ts`）；宿主→Webview 推送用 `stream` 与 `state` 消息（`state` 的 `payload.kind` 区分 `runtime` / `context`）。
- 数据：`globalStorage/index.db`（文件元数据 + FTS5）、`globalStorage/ai.db`（conversations / messages / ai_usage_logs），两库共用 `common/db/openDatabase.ts` 的连接基座。
- AI 对话：DeepSeek 经 openai SDK（`baseURL: https://api.deepseek.com`）流式，密钥存 SecretStorage（`zhai.deepseek.apiKey`）；对话模式与编辑器右键上下文引用已落地，写作模式（diff 续写）与 `@` 提及待实现，详见 `docs/modules/ai-chat.md` 第 10 / 10.1 节。
- 搜索：FTS5 检索（`searchFiles`）与 `zhai.search.limit` 配置保留，搜索面板待实现（路线图 C7）。

## 用户偏好
- 单次改动超过 2 个文件前，先给方案并确认；存在歧义时列选项而不是自行抉择。
- **不擅自提交**：改动完成后默认保留工作区，由用户决定是否提交。
- 中文沟通；偏好最小破坏、与既有约定一致的实现；重视文档与注释同步。
- 环境：Windows + PowerShell；pnpm 12.4.1（旧版写 lockfile 丢 peer 后缀会造成坏链与 TS2307）；耗时命令需重定向到文件，避免长命令超时。
- 提交信息含中文时**不要用命令行传参**：PowerShell 会按本地代码页解码，参数变乱码并抛 ParserError。做法是先写 UTF-8（无 BOM）消息文件，再 `git commit -F msg.txt`，提交后删除该文件。仓库历史用 conventional commits 中文格式（如 `feat(dashboard): ...`）。
