# Zhai 项目长期记忆

## 项目定位
- `zhai-vscode`：面向「写小说 + 写代码」的 VSCode 插件；Markdown 做主存储，SQLite（better-sqlite3）只做缓存索引，**不存正文**。
- 设计文档在 `docs/`：`docs/modules/common.md`（Common 契约/命令/AC）、`docs/development.md`（四期路线图）、`docs/modules/dashboard.md`（仪表盘设计）。源码注释普遍标注「设计源：docs/...」，改代码须同步文档。

## 工程约定
- 代码风格：4 空格缩进、单引号、无分号、中文注释；提交前 `prettier --check src eslint.config.mjs` 应全绿。
- 构建链路：`pnpm run compile` = typecheck（TS 7）+ esbuild（宿主）+ vite（webview 多入口）。`vite.config.mjs` 文件名不可改（shadcn CLI 以 `vite.config.*` 判定框架，改名会导致其命令不可用）。
- TS 双版本：`typescript` 别名 → `@typescript/typescript6`（供 typescript-eslint 的 TS 6 API）；`@typescript/native` 别名 → TS 7（提供 `tsc` bin，typecheck 用它）。
- ESLint 10 扁平配置（`eslint.config.mjs`）：已移除 eslint-plugin-react（不兼容 10），改用 `@eslint-react/eslint-plugin`；`src/components/ui` 与 `src/hooks` 为 shadcn 托管目录、豁免多数规则；`noInlineConfig` 禁止 eslint-disable 注释。
- shadcn/ui：组件在 `src/components/ui`、hooks 在 `src/hooks`，路径别名 `@/*` → `src/*`；UI 组件内 `cn` 直接 `from 'cn'` 导入（不是 `@/lib/utils`）。
- Webview：Vite 多入口（`src/webview/index.html` = 仪表盘，`workspace.html` = 工作区）；`bootstrap.tsx` 把 `data-vscode-theme-kind` 同步为 `.dark`；`bridge.ts` 提供 reqId 请求-响应与浏览器降级；宿主统一用 `buildWebviewHtml` 注入 CSP 并重写资源 URI。
- 安全约束：宿主 SQL 一律预编译参数绑定；Webview 若要触发宿主命令，必须走白名单（见 `dashboardProvider.ts` 的 `ALLOWED_HOST_COMMANDS`）。

## 已落地的视图与命令
- 侧栏容器 `zhai-sidebar`：`zhai.dashboard`（仪表盘，原「全局搜索」，`Ctrl+K` 聚焦）、`zhai.aiChat`（AI 对话，原「工作区」占位，`Ctrl+Shift+L` 聚焦）。
- 命令：`zhai.rebuildIndex`、`zhai.openDashboard`、`zhai.showIndexStatus`、`zhai.clearIndex`、`zhai.exportDiagnostics`、`zhai.openSettings`、`zhai.openAiChat`、`zhai.ai.setApiKey`、`zhai.ai.clearApiKey`。
- Webview→宿主协议：`dashboard/stats`、`index/rebuild`、`ai/session|newSession|runtime|send|abort`、`host/command`（白名单见 `src/modules/common/webviewCommands.ts`）；宿主→Webview 推送用 `stream` 与 `state` 消息。
- 数据：`globalStorage/index.db`（文件元数据 + FTS5）、`globalStorage/ai.db`（conversations / messages / ai_usage_logs），两库共用 `common/db/openDatabase.ts` 的连接基座。
- AI 对话：DeepSeek 经 openai SDK（`baseURL: https://api.deepseek.com`）流式，密钥存 SecretStorage（`zhai.deepseek.apiKey`）；对话模式已落地，写作模式（diff 续写）待实现，详见 `docs/modules/ai-chat.md` 第 10 节。
- 搜索：FTS5 检索（`searchFiles`）与 `zhai.search.limit` 配置保留，搜索面板待实现（路线图 C7）。

## 用户偏好
- 单次改动超过 2 个文件前，先给方案并确认；存在歧义时列选项而不是自行抉择。
- **不擅自提交**：改动完成后默认保留工作区，由用户决定是否提交。
- 中文沟通；偏好最小破坏、与既有约定一致的实现；重视文档与注释同步。
- 环境：Windows + PowerShell；pnpm 12.4.1（旧版写 lockfile 丢 peer 后缀会造成坏链与 TS2307）；耗时命令需重定向到文件，避免长命令超时。
- 提交信息含中文时**不要用命令行传参**：PowerShell 会按本地代码页解码，参数变乱码并抛 ParserError。做法是先写 UTF-8（无 BOM）消息文件，再 `git commit -F msg.txt`，提交后删除该文件。仓库历史用 conventional commits 中文格式（如 `feat(dashboard): ...`）。
