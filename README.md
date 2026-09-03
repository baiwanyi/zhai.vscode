# BaiwanyiONE VSCode 插件

一款面向「写小说 + 写代码」的 VSCode 插件：**Markdown 做主存储，SQLite 只做缓存索引**，让用户在原生编辑器里享受 Git 版本管理与多光标写作，插件在后台提供 AI 辅助、全文检索、写作管理与内容发布能力。

## 技术栈

- **前端**：React 19 + TypeScript 7
- **UI**：Tailwind CSS 4 + Shadcn/UI + Lucide Icons
- **数据库**：SQLite (Drizzle ORM)
- **宿主**：VSCode Extension API（Webview 侧边栏 + FileSystemWatcher + SecretStorage）
- **AI**：DeepSeek API（SSE 流式，Chat / R1 模型可切换）

## 文档索引

**模块设计文档（插件形态）**

| 文档 | 说明 |
|------|------|
| [docs/modules/common.md](docs/modules/common.md) | 通用：存储架构、增量索引、FTS5 检索、配置与密钥、消息协议 |
| [docs/modules/ai-chat.md](docs/modules/ai-chat.md) | AI Chat：写作 / 对话双模式、diff 逐段接受、`@` 上下文、流式协议 |
| [docs/modules/notes.md](docs/modules/notes.md) | 笔记：目录笔记本、双向链接、修订快照、模板与网页剪藏 |
| [docs/modules/writing.md](docs/modules/writing.md) | 写作：作品-卷-章结构、AI 副驾、角色与设定、伏笔情节线、导出 |
| [docs/modules/reading.md](docs/modules/reading.md) | 阅读：TXT 导入去重、编码检测、虚拟滚动、书签与全文搜索 |
| [docs/modules/knowledge-base.md](docs/modules/knowledge-base.md) | 知识库：分块索引、混合检索、RAG 问答与溯源、术语表 |
| [docs/modules/markdown-one.md](docs/modules/markdown-one.md) | Markdown ONE：统一解析管线、格式化、图片本地化与导出 |
| [docs/modules/sync-weibo.md](docs/modules/sync-weibo.md) | 同步微博：OAuth 授权、内容转换、长图、幂等发布与退避重试 |
| [docs/modules/sync-wechat.md](docs/modules/sync-wechat.md) | 同步公众号：Token 并发管理、样式内联、永久素材、草稿发布 |

**历史参考文档（宅桌面时期）**

| 文档 | 说明 |
|------|------|
| [docs/prd.md](docs/prd.md) | 产品需求文档：模块功能、API 总览、数据指标、非功能需求 |
| [docs/development.md](docs/development.md) | 全栈开发计划书：阶段划分、任务清单、工时估算 |
| [docs/optimization.md](docs/optimization.md) | 安全 / 稳定性 / 性能优化项（P0~P3） |
| [docs/modules/press.md](docs/modules/press.md) | 写作模块：编辑器、AI 副驾、角色与设定、大纲与伏笔 |
| [docs/modules/reader.md](docs/modules/reader.md) | 阅读模块：TXT 导入、编码检测、去重、书架 API |
| [docs/modules/dashboard.md](docs/modules/dashboard.md) | 仪表盘：统计聚合 API 与快捷方式网格设计 |
| [docs/modules/extension.md](docs/modules/extension.md) | 浏览器扩展：截图 OCR、选中文本、整页采集 |

## 功能需求

### 通用

> 详细设计：[docs/modules/common.md](docs/modules/common.md)

- [SQLite 仅做缓存 Markdown 做主存储](docs/plan/SQLite%20仅做缓存%20Markdown%20做主存储.md)
    - Markdown（主存储）：正文、章节标题、角色设定、大纲，用户直接用 VSCode 打开编辑，享受 Git 版本管理、多光标与沉浸式写作
    - SQLite（缓存索引）：只存元数据（文件路径、标题、字数、标签、角色、摘要、mtime），**不存正文全文**，随时可删库重建
    - 增量同步：`createFileSystemWatcher('**/*.md')` 监听增 / 改 / 删，防抖 500ms 后 `INSERT OR REPLACE`；批量变更（如 Git Pull）走队列批处理，避免卡顿
    - 全量重建：激活时检测索引库缺失、或用户手动执行「重建索引」命令时全量扫描；100 章节 / 50MB 全量索引 < 3s
    - 索引库存放于 `workspaceStorage`，不参与用户 Git 同步

- 检索与跳转
    - 全文检索：SQLite FTS5（含中文分词），支持 `tag:标签` / `notebook:笔记本` / `created:>2026-01-01` 限定语法
    - 全局搜索：`Ctrl+K` 一次检索笔记 / 章节 / 书籍 / 媒体，结果按模块分组、关键词高亮、回车直达
    - 搜索历史：保留最近 20 条，支持快速重搜

- 配置与密钥
    - AI API Key 存放于 VSCode `SecretStorage`，前端脱敏显示（`••••••••`），禁止明文写入 `settings.json` 或仓库
    - 配置项：模型、温度、上下文长度、最大生成长度、存储目录、自动保存间隔
    - 分级限流：AI 请求与目录扫描类操作单独限流，避免额度刷爆与磁盘 I/O 打满

- 交互承载
    - 侧边栏容器（笔记 / 写作 / 阅读 / 知识库）+ Webview 面板 + 命令面板（`BaiwanyiONE: ...`）
    - 状态栏：索引状态、当前 AI 模型、今日 Token 用量、保存状态
    - 统一快捷键映射表，与 VSCode 默认键位不冲突

- 数据安全
    - 删除进回收站，可配置保留天数（默认 30 天），超期自动清理
    - Markdown 文件本身即备份，索引库可一键重建；每日首次启动自动备份配置与索引

### AI Chat

> 详细设计：[docs/modules/ai-chat.md](docs/modules/ai-chat.md)

- 模式选择：写作 / 对话
- 写作模式：对话框输入提示词命令，直接对编辑区内容进行修改和生成
    - 生成内容以「淡蓝斜体」插入，支持接受 / 拒绝 / 重新生成
    - 改动以 diff 视图呈现，支持逐段（hunk 级）接受
    - 选中文本后触发润色 / 扩写 / 缩写 / 翻译，`Alt+Enter` 续写
- 对话模式：对话结果在侧边栏里显示
    - 会话管理：新建 / 重命名 / 删除，会话可关联到具体笔记或章节
    - SSE 流式输出，首字 < 500ms；`AbortController` 可中途取消
    - 展示 DeepSeek 思维链（reasoning_content），消息状态 pending → streaming → completed/failed
    - Token 与费用记录，按日 / 月统计，超阈值提醒
- @添加下文（`@` 上下文提及）
    - 支持 `@当前文件` `@选中内容` `@笔记标题` `@章节` `@最近N章` `@角色名` `@图库图片` `@网页链接`
    - 上下文检索走 SQLite 索引（先按 mtime / 角色提及定位章节，再按需读取对应 `.md` 文件），既省 Token 又保证 AI 不丢前文
- 上下文参数面板：前文范围 500–4000 token、温度 0.1–1.5、最大生成长度、模型切换（DeepSeek-Chat / R1）、设定自动注入开关

### 笔记

> 详细设计：[docs/modules/notes.md](docs/modules/notes.md)

- 组织：以工作区文件夹作为笔记本的树形结构；标签系统（Frontmatter `tags` 或正文 `#标签`）；笔记置顶
- 编辑：Markdown 所见即所得（复用 VSCode 原生编辑器 + 预览），5 秒防抖自动保存，切换 / 关闭时强制保存
- 双向链接：`[[笔记标题]]` 输入自动补全，出链 / 入链面板、引用计数、关系图谱可视化
- 版本历史：本地修订记录，差异对比 + 一键恢复，至少保留 30 个历史版本
- 检索：FTS5 全文搜索 + 结果高亮 + 高级限定语法
- 素材采集
    - 图片粘贴 / 拖拽自动落盘为相对路径附件
    - 网页剪藏：截图 OCR（Tesseract `chi_sim+eng`）/ 选中文本 / 整页采集（Readability + Turndown），统一 Markdown 模板并附来源 URL 与采集时间
- 模板系统：会议记录 / 读书笔记 / 周报，支持用户自定义保存模板
- 视图：列表 / 看板（按标签列，拖拽移动）/ 日历（按创建更新时间）
- AI 增强：摘要生成、改写 / 扩写 / 缩写 / 翻译、批量标签建议

### 写作

> 详细设计：[docs/modules/writing.md](docs/modules/writing.md)

- 结构：作品 → 卷 → 章两级树，拖拽排序（跨卷 / 卷内）、分章与合并、状态徽章（草稿 / 待修改 / 待发布 / 已发布）
- 编辑器：MDX 编辑器，章节元信息（标题 / 状态 / 写作便签 / 关联角色 / 字数目标）、多标签页、专注模式、主题（亮色 / 暗色 / 墨绿 / 暖黄）
- AI 副驾：续写、润色改写、对话生成、描写展开、大纲生成、智能校对、AI 写评、情感 / 节奏分析、AI 智能起名、自定义指令
- 角色管理：角色卡（基础信息 / 外貌 / 性格 / 背景 / 能力）、关系图谱、标签分组（主角 / 反派 / 配角 / 龙套）、出场统计
- 世界观设定：地理 / 组织势力 / 时间线 / 种族 / 文化宗教 / 魔法科技 六类
- 大纲管理：树形 / 卡片 / 时间线三视图，章节摘要内联编辑，AI 辅助生成卷-章结构
- 伏笔与情节线：伏笔 CRUD + 状态（未回收 / 已回收 / 已废弃）+ 待回收预警看板；多情节线（主线 / 感情线 / 暗线 / 支线）并行并关联章节
- 版本快照：手动 / 自动快照，diff 对比，一键恢复，自动清理超期快照
- 统计与激励：日 / 周写作目标进度、连更天数、创作热力图、写作日历、番茄钟（25 分钟写作 + 5 分钟休息）
- 导入导出：导入 .md / .docx / .txt；导出 .md / .docx / EPUB / PDF，支持单章 / 多章 / 整部

### 阅读

> 详细设计：[docs/modules/reading.md](docs/modules/reading.md)

- 导入：目录递归扫描 `.txt`、流式 MD5 去重（`file_hash` UNIQUE）、编码自动检测（jschardet + iconv-lite，UTF-8 / GBK / Big5）
- 阅读：虚拟滚动（>100MB 文件不卡顿）、章节解析（第X章 / Chapter X，支持中文与阿拉伯数字）、进度持久化（行号 + 偏移 + 百分比）
- 体验：翻页 / 滚动双模式、字体 / 行距 / 亮度调节、4 种主题（护眼绿 / 羊皮纸 / 暗黑 / 高对比）、阅读时长与已读字数统计
- 书签与搜索：书签 CRUD + 侧边栏点击跳转，FTS5 全文搜索 + 关键词高亮定位原文
- 组织：书架分组（在读 / 收藏 / 完结）、回收站与恢复、阅读偏好持久化

### 同步微博

> 详细设计：[docs/modules/sync-weibo.md](docs/modules/sync-weibo.md)
> 本模块依赖微博开放平台接口权限，实现前需完成接口可用性验证。

- 一键发布：将笔记 / 章节正文转纯文本，自动处理话题 `#话题#`、@提及、超链接转「网页链接」
- 字数与图片：超出单条字数限制时自动转长微博图片；图片走官方上传接口，本地附件保留原始文件
- 账号与授权：OAuth2 凭证存于 `SecretStorage`，支持多账号切换与授权过期重连
- 草稿与记录：发布前预览、草稿箱、发布历史与回执链接
- 可靠性：失败重试采用指数退避 + 次数上限；同一笔记重复发布以本地记录去重，避免重复发博

### 同步微信公众号

> 详细设计：[docs/modules/sync-wechat.md](docs/modules/sync-wechat.md)
> 本模块能力与公众号主体类型强相关（群发需认证、调用需 IP 白名单），实现前需完成权限验证。

- 草稿箱接口：正文转公众号 HTML（内联样式），支持封面图、摘要、作者、原创声明开关
- 素材管理：图片上传为永久素材并回写本地，避免外链失效
- 排版：Markdown → 公众号排版主题（字号 / 行距 / 引用块 / 代码块高亮）
- 凭证与状态：Access Token 存于 `SecretStorage` 并自动续期；发布前预览；发布记录含状态（草稿 / 已发布 / 失败）
- 可靠性：遵守公众号接口调用配额，失败指数退避重试，发布操作幂等

### 知识库

> 详细设计：[docs/modules/knowledge-base.md](docs/modules/knowledge-base.md)

- 索引：以工作区 Markdown 为语料，FTS5 全文索引（可选叠加向量索引），随文件变更增量更新
- RAG 问答：检索 Top-N 片段注入 AI 上下文，回答附引用来源，点击跳转原文位置
- 知识卡片：抽取角色名、地名、设定条目，自动生成术语表与索引页
- 引用追溯：展示某片段被哪些笔记 / 章节引用，引用关系双向更新
- 维护：一键重建索引，展示索引状态与覆盖率

### Markdown ONE

> 详细设计：[docs/modules/markdown-one.md](docs/modules/markdown-one.md)

- 统一 Markdown 处理管线：Frontmatter 解析与校验、正文规范化（标题层级、列表、空行、中英文标点）
- 增强语法：`[[双向链接]]`、`#标签`、告警块、表格、脚注、Mermaid
- 图片处理：外链一键本地化、相对路径重写、批量压缩
- 导出：单文件 / 合并导出为 Markdown、HTML、PDF
- 目录与锚点：自动生成 TOC，随保存更新
- 与 VSCode 原生编辑器保持一致：保存即同步索引，无需切换到其他编辑器
