# 宅桌面 (Zhai Desktop) - 全栈开发计划书 V3

**版本**：3.0
**日期**：2026-05-30
**开发模式**：单全栈开发者 + AI 辅助
**工时估算**：按每日有效编码 4~6 小时计算
**工时单位**：h = 小时，d = 天（按 5h 有效编码折算）

---

## 目录

1. [项目概述](#1-项目概述)
2. [已完成内容清单](#2-已完成内容清单)
3. [总体阶段划分](#3-总体阶段划分)
4. [第一阶段 - 安全加固与写作后端 API](#4-第一阶段---安全加固与写作后端-api)
5. [第二阶段 - 阅读器核心与写作前端布局](#5-第二阶段---阅读器核心与写作前端布局)
6. [第三阶段 - 写作编辑器 AI 集成与阅读器增强](#6-第三阶段---写作编辑器-ai-集成与阅读器增强)
7. [第四阶段 - 写作高级功能与写作统计](#7-第四阶段---写作高级功能与写作统计)
8. [第五阶段 - 仪表盘与浏览器扩展](#8-第五阶段---仪表盘与浏览器扩展)
9. [第六阶段 - 笔记增强与图库增强](#9-第六阶段---笔记增强与图库增强)
10. [第七阶段 - 模块联动与全局搜索](#10-第七阶段---模块联动与全局搜索)
11. [里程碑节点总览](#11-里程碑节点总览)
12. [工时汇总](#12-工时汇总)
13. [风险与应对](#13-风险与应对)

---

## 1. 项目概述

宅桌面是一款一站式桌面应用管理平台，基于 Node.js + Express 5 + React 19 + SQLite 的全栈浏览器桌面应用。集成了媒体管理（图库）、笔记记录、AI 辅助写作、TXT 阅读、AI 深度对话和浏览器扩展等功能。

### 1.1 技术栈

| 层级     | 技术                                      |
|----------|-------------------------------------------|
| 后端     | Node.js 20+ + Express 5 (TypeScript)      |
| 前端     | React 19 + TypeScript + Vite 8            |
| UI       | Tailwind CSS 4 + shadcn/ui + Tabler Icons |
| 数据库   | SQLite (Drizzle ORM) — 4 个独立数据库     |
| AI       | DeepSeek API (SSE 流式)                   |
| 媒体处理 | Sharp + ffmpeg + Python 脚本 (Pillow)     |
| 测试     | Vitest + @testing-library/react           |

### 1.2 模块状态总览

| 模块               | 路由                | 当前状态       | 计划工时 |
|--------------------|---------------------|----------------|----------|
| 笔记 (Notebook)    | `/notebook/:postId` | ✅ 已完成       | —        |
| 图库 (Gallery)     | `/gallery`          | ✅ 已完成       | —        |
| AI 对话            | AI 面板集成         | ✅ 已完成       | —        |
| 通用配置 (Options) | `/api/options`      | ✅ 已完成       | —        |
| Unsplash 搜索      | 笔记编辑器集成      | ✅ 已完成       | —        |
| 写作编辑器 (Press) | `/press/:postId?`   | 🚧 原型阶段     | ~250h    |
| 阅读器 (Reader)    | `/reader/:bookId`   | 📋 M1 导入完成  | ~90h     |
| 仪表盘 (Dashboard) | `/`                 | 🚧 开发中       | ~35h     |
| 浏览器扩展         | Chrome Extension    | 🟢 基础新标签页 | ~20h     |
| 笔记增强           | —                   | 📋 规划中       | ~55h     |
| 图库增强           | —                   | 📋 规划中       | ~35h     |
| 模块联动           | —                   | 📋 规划中       | ~45h     |
| 安全+性能优化      | —                   | 📋 待实施       | ~45h     |

### 1.3 数据库架构

| 数据库文件         | 用途               | 主要表                                                                                                                                                     |
|--------------------|--------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `data/zhai.db`     | 应用配置与 AI 日志 | `ai_usage_logs`, `options`, `conversations`, `responses`, `messages`                                                                                       |
| `data/notebook.db` | 笔记与 AI 对话     | `notebooks`, `notes`, `tags`, `note_tags`, `attachments`, `messages`, `message_fragments`, `note_revisions`, `chat_messages`                               |
| `data/gallery.db`  | 媒体文件管理       | `media`, `favorites`, `shorts`                                                                                                                             |
| `data/reader.db`   | 阅读模块           | `books`, `bookmarks`, `book_search_fts` (待建)                                                                                                             |
| `data/press.db`    | 写作模块           | `projects`, `volumes`, `chapters`, `snapshots`, `characters`, `character_relations`, `settings`, `plot_lines`, `foreshadowings`, `writing_sessions` (待建) |

---

## 2. 已完成内容清单

### 2.1 基础设施

- [X] Express 5 服务器搭建 (`apps/server.ts`)
- [X] Vite 构建配置 (`vite.config.ts`)
- [X] TypeScript 严格模式 (`tsconfig.json`)
- [X] ESLint + Prettier 配置 (`eslint.config.js`)
- [X] Helmet 安全头中间件 (`apps/server.ts:51`)
- [X] 响应压缩 (gzip) (`apps/server.ts:53`)
- [X] 请求体大小限制 (1MB) (`apps/server.ts:56-62`)
- [X] 静态文件目录安全校验 (`apps/server.ts:70-90`)
- [X] 全局错误处理中间件 (`apps/server.ts:164-172`)
- [X] 优雅关闭 (SIGTERM/SIGINT) (`apps/server.ts:203-226`)
- [X] 健康检查端点 (`apps/server.ts:113-115`)
- [X] SPA 路由回退 (`apps/server.ts:137-156`)

### 2.2 数据库层

- [X] SQLite WAL 模式 + 性能 PRAGMA (`apps/sqlite.ts:181-191`)
- [X] 迁移幂等性 (`__migrations` 追踪表) (`apps/sqlite.ts:267-274`)
- [X] 种子数据幂等执行 (`__seeds`) (`apps/sqlite.ts:397-440`)
- [X] 事务支持 (同步/异步) (`apps/sqlite.ts:338-377`)
- [X] 模块化动态加载 schema (`apps/sqlite.ts:38-86`)
- [X] 自动迁移 (development 模式) (`apps/sqlite.ts:588-592`)

### 2.3 笔记模块 (Notebook) — 全部完成

- [X] 三栏布局 (大纲 + 编辑器 + AI)
- [X] Markdown 所见即所得编辑器
- [X] 笔记本树形组织
- [X] 标签系统 (创建/分配/筛选/搜索)
- [X] 版本历史 (修订版)
- [X] 笔记搜索 (标题模糊匹配)
- [X] 图片粘贴/拖拽上传
- [X] AI 对话集成 (会话管理 + 流式)
- [X] DeepSeek 对话 JSON 导入
- [X] AI 引用笔记内容作为上下文
- [X] Token 用量记录
- [X] 软删除
- [X] 置顶功能

### 2.4 图库模块 (Gallery) — 全部完成

- [X] 加权随机媒体浏览
- [X] 瀑布流布局
- [X] 分类筛选 (来源/类型/UID)
- [X] 分页加载 (无限滚动)
- [X] 图片/视频查看器
- [X] 缩略图自动生成 (Sharp/ffmpeg)
- [X] 哈希分桶目录存储
- [X] 手动更新缩略图截帧位置
- [X] 分级视频截帧
- [X] 短视频片段创建/随机播放
- [X] 收藏管理
- [X] 回收站 (软删除/恢复)
- [X] Python 脚本集成 (扫描/整理/删除)
- [X] SSE 流式进度展示
- [X] 视频流 (HTTP Range 请求)
- [X] 视频旋转/裁剪/BGM 叠加
- [X] 随机视频预览

### 2.5 AI 对话服务 (DeepSeek) — 全部完成

- [X] 会话管理 (创建/删除/重命名)
- [X] 流式对话 (SSE)
- [X] 消息历史完整保存
- [X] 思考过程展示 (reasoning_content)
- [X] API Key AES-256-GCM 加密存储
- [X] Token 用量日志
- [X] AbortController 取消请求
- [X] 加密密钥自动生成 + 持久化

### 2.6 阅读器模块 (Reader) — M1 完成

- [X] 目录递归扫描 `.txt` 文件
- [X] 流式 MD5 计算 (支持大文件)
- [X] 编码自动检测 (jschardet)
- [X] 数据库去重 (MD5 UNIQUE)
- [X] 手动触发扫描 API
- [X] 书架列表 API (分页/倒序)
- [X] 书籍详情/软删除 API

### 2.7 写作编辑器 (Press) — 原型阶段

- [X] 三栏布局框架
- [X] 章节列表 UI
- [X] 编辑器组件
- [X] 右侧侧边栏 Tab
- [X] AI 功能面板骨架
- [X] 作品列表 (骨架)

### 2.8 安全/基础防护

- [X] Helmet 安全头 — CSP、XSS 保护
- [X] 加密密钥自动生成持久化 — AES-256-GCM
- [X] API Key 加密存储 — 数据库加密存储
- [X] 路径穿越检查 (`isWithinDirectory`) — 静态文件目录防护
- [X] 缩略图哈希分桶 — 防止单目录文件过多
- [X] 端口冲突友好提示 — EADDRINUSE 等

---

## 3. 总体阶段划分

| 阶段       | 阶段目标                                 | 核心模块                     | 预计工时  | 日历时间 (周) |
|------------|------------------------------------------|------------------------------|-----------|---------------|
| **阶段一** | 安全加固 + Press 后端完整 API            | 安全优化、Press DB + API     | **~70h**  | 3 周          |
| **阶段二** | 阅读器 MVP + Press 前端布局              | Reader M2-M3、Press UI 框架  | **~95h**  | 4 周          |
| **阶段三** | Press AI 功能 + 编辑器完善 + Reader 增强 | Press AI 面板、Reader M4     | **~100h** | 4 周          |
| **阶段四** | Press 高级功能 (大纲/伏笔/情节线/统计)   | Press 高级功能               | **~55h**  | 2.5 周        |
| **阶段五** | 仪表盘 + 浏览器扩展                      | Dashboard、Extension         | **~55h**  | 2.5 周        |
| **阶段六** | 笔记增强 + 图库增强                      | 全文搜索、双向链接、图库增强 | **~90h**  | 4 周          |
| **阶段七** | 模块联动 + 全局搜索 + 性能优化 + 收尾    | 联动、搜索、优化、测试       | **~90h**  | 4 周          |
| **合计**   |                                          |                              | **~555h** | **~24 周**    |

---

## 4. 第一阶段 - 安全加固与写作后端 API

**目标**：加固安全基线，完成写作编辑器完整后端 API

**日历时间**：3 周 | **工时估算**：~70 小时

---

### 4.1 安全加固（~12 小时）

#### 任务清单

- [x] S1 添加 CORS 中间件 (区分开发/生产环境) — `apps/server.ts` (0.5h, P0)
- [x] S2 添加请求频率限制 (全局 100/min + 敏感路由) — `apps/server.ts` (1h, P0)
- [x] S3 Python 子进程超时机制 (5 分钟自动 SIGTERM) — `apps/utils/python.ts` (1h, P1)
- [x] S4 Python 脚本参数路径校验 (防止路径穿越) — `modules/Gallery/gallery.controller.ts` (1h, P1)
- [x] S5 文件上传安全增强 (Magic Bytes + 文件名消毒) — `modules/Notebook/router/notebook.route.ts` (2h, P1)
- [x] S6 添加请求日志 (morgan) — `apps/server.ts` (0.5h, P2)
- [x] S7 移除 `dotfiles: 'allow'` — `modules/Gallery/gallery.controller.ts` (0.5h, P2)
- [x] S8 统一错误响应格式为 `{ error, message, details }` — 全局控制器 + `apps/server.ts` (3h, P2)
- [x] S9 文件上传配置移至 `app.yaml` 统一管理 — `apps/config.ts` + 各路由 (1.5h, P2)
- [x] S10 测试验证：安全加固 (1h)

#### 技术要点

- CORS：生产环境限制为 `['http://localhost:3000']`，开发环境 `'*'`
- Rate-limit：`/api/reader/scan`、`/api/deepseek/ai/chat/send` 等敏感路由限制 10/min
- Magic Bytes：检查文件头字节确认真实 MIME 类型
- 统一错误格式：`{ error: true, message: string, details?: unknown }`

#### 交付物

- [x] 加固后的 `apps/server.ts`
- [x] 统一错误响应格式规范
- [x] Python 执行超时保护
- [x] 文件上传完整性校验

---

### 4.2 Press 写作编辑器 - 后端 API 开发（~55 小时）

#### 4.2.1 数据库设计与迁移（~10 小时）

- [ ] P1 数据库 Schema 定义 (10 表) (3h) — `projects`, `volumes`, `chapters`, `snapshots`, `characters`, `character_relations`, `chapter_characters`, `settings`, `plot_lines`, `chapter_plot_lines`
- [ ] P2 Drizzle schema + 迁移脚本 (4h) — 参照 `press.md` 7.1 节完整数据模型
- [ ] P3 TypeScript 前后端共享类型定义 (1.5h) — `press.type.ts` 所有接口/模型类型
- [ ] P4 分表设计 & 索引优化 (1.5h) — 按 projectId 建立索引、chapters.order + volumeId 联合索引

**核心表字段说明**：

| 表                    | 核心字段                                                                                                                                                                                                       |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `projects`            | id, title, description, authorName, shortIntro, longIntro, category, status, coverUrl, wordGoal, dailyGoal, weeklyGoal, updateFreq, createdAt, updatedAt                                                       |
| `volumes`             | id, projectId, title, description, order, createdAt                                                                                                                                                            |
| `chapters`            | id, projectId, volumeId, title, content (MDX), status, summary, notes, wordGoal, wordCount, order, createdAt, updatedAt                                                                                        |
| `snapshots`           | id, chapterId, content (MDX), reason (manual/auto), createdAt                                                                                                                                                  |
| `characters`          | id, projectId, name, alias, age, gender, height, weight, birthday, bloodType, avatarUrl, appearance (JSON), personality (JSON), background (JSON), ability (JSON), tags (JSON), template, createdAt, updatedAt |
| `character_relations` | id, fromId, toId, type, description                                                                                                                                                                            |
| `chapter_characters`  | id, chapterId, characterId, role (main/supporting/cameo), mentionCount                                                                                                                                         |
| `settings`            | id, projectId, category (6 类), name, data (JSON), tags (JSON), createdAt                                                                                                                                      |
| `plot_lines`          | id, projectId, name, type (main/romance/sub/secret), description, color                                                                                                                                        |
| `chapter_plot_lines`  | id, chapterId, plotLineId, note                                                                                                                                                                                |

#### 4.2.2 后端 API 开发（~28 小时）

- [ ] P5 项目管理 API (CRUD + 归档/取消归档) — 6 个端点 (4h)
- [ ] P6 卷管理 API (CRUD + 排序) — 4 个端点 (3h)
- [ ] P7 章节管理 API (CRUD + 排序/移动/状态/拆分/合并) — 9 个端点 (6h)
- [ ] P8 版本历史 API (快照 CRUD + diff + 恢复) — 5 个端点 (4h)
- [ ] P9 角色管理 API (CRUD + 关系图谱 + 出场统计) — 8 个端点 (5h)
- [ ] P10 设定管理 API (CRUD + 按分类过滤) — 5 个端点 (3h)
- [ ] P11 情节线 API (CRUD + 章节关联) — 5 个端点 (2h)
- [ ] P12 写作统计 API + 导出 API — 4 个端点 (1h)

**完整 API 端点清单**（基础路径 `/api/press`）：

```
项目管理 (6):   GET/POST /projects, GET/PUT/DELETE /projects/:id, POST archive/unarchive
卷管理 (4):     POST /projects/:id/volumes, PUT/DELETE /volumes/:id, PUT /volumes/:id/order
章节管理 (9):   GET/POST /projects/:id/chapters, PUT/DELETE /chapters/:id, PATCH status/notes/move, PUT order, POST split/merge
版本历史 (5):   GET/POST /chapters/:id/snapshots, GET diff, POST restore, DELETE
角色管理 (8):   GET/POST /projects/:id/characters, GET/PUT/DELETE /characters/:id, GET/POST relations, DELETE /relations/:id, GET chapters
设定管理 (5):   GET/POST /projects/:id/settings, PUT/DELETE /settings/:id, GET /settings/:id/chapters
情节线 (5):     GET/POST /projects/:id/plotLines, PUT/DELETE /plotLines/:id, POST/DELETE章节关联
写作统计 (3):   GET /projects/:id/stats, GET daily, GET heatmap
导出 (2):       POST /export/project/:id (md/docx), POST epub, POST pdf
```

**合计：约 45+ 个 API 端点**

#### 4.2.3 控制器与服务层（~10 小时）

- [ ] P13 Press 控制器层 (zod 校验) (4h) — 请求参数校验、错误包装、调用 Service
- [ ] P14 Press 服务层 (5h) — 章节树构建、拖拽排序重算、版本 diff、快照清理、事务保护
- [ ] P15 路由注册 + 数据迁移脚本 (1h) — 挂载到 `apps/server.ts`，首次自动创建 `data/press.db`

#### 4.2.4 测试验收（~7 小时）

- [ ] P16 API 单元测试 (Vitest + supertest) — 核心端点 (4h)
- [ ] P17 API 集成测试 — 完整流程：创建项目→分卷→写章节→快照→恢复→导出 (2h)
- [ ] P18 数据迁移测试 — 初始化→增量→回滚 (1h)

#### 4.2.5 交付物

- [ ] Press 数据库完整 10 表 Schema + 迁移脚本
- [ ] 45+ 个 RESTful API 端点
- [ ] 控制器 + 服务层完整业务逻辑
- [ ] API 单元/集成测试用例

---

### 4.3 第一阶段里程碑

- [ ] M1.1 - 安全加固完成 (第 1 周中)
- [ ] M1.2 - Press 数据库 10 表迁移完成 (第 1 周末)
- [ ] M1.3 - Press 全部 API 通过单元测试 (第 2 周末)
- [ ] M1.4 - 集成测试通过 (第 3 周中)
- [ ] M1.5 - 第一阶段全部功能验收通过 (第 3 周末)

---

## 5. 第二阶段 - 阅读器核心与写作前端布局

**目标**：完成阅读器核心功能 (M2-M3)，搭建 Press 前端基本布局

**日历时间**：4 周 | **工时估算**：~95 小时

---

### 5.1 Reader 阅读器 M2-M3（~55 小时）

#### 5.1.1 M2 - 阅读器核心（~35 小时）

- [ ] R1 前端路由 & 页面骨架 (3h) — 路由 `/reader/:bookId`，阅读器布局 (工具栏 + 内容区 + 侧边栏)
- [ ] R2 TXT 内容流式加载 API (4h) — `GET /api/reader/:bookId/content?offset=&limit=`，支持分块流式读取
- [ ] R3 阅读器核心虚拟滚动 (8h) — 基于 `react-window` 实现长列表虚拟渲染，\>100MB 文件不卡顿
- [ ] R4 章节解析算法 (6h) — 正则检测"第X章"、"Chapter X"、"第X节"，支持中文数字/阿拉伯数字
- [ ] R5 阅读进度持久化 (4h) — 自动保存阅读位置 (行号 + 偏移 + 百分比)，切换/关闭时保存
- [ ] R6 章节导航面板 (4h) — 左侧章节列表（可点击跳转），当前章节高亮
- [ ] R7 设置工具栏 (字体/行距/背景色) (3h) — 字体大小 +/-、行距 1.0-2.0、背景色切换
- [ ] R8 大文件优化 - 服务端流式改造 (2h) — `detectAndRead` 改为流式分块读取，避免大文件 OOM
- [ ] R9 同步 I/O 异步化 (1h) — `walkDirectory` 改用 `fs.promises`
- [ ] R10 测试验收 (2h) — 虚拟滚动性能测试 (>100MB 文件)、章节解析准确度

**新增/变更 API**：

| 方法 | 路径                                               | 说明                 |
|------|----------------------------------------------------|----------------------|
| GET  | `/api/reader/:bookId/content?offset=0&limit=50000` | 分块读取 TXT 内容    |
| PUT  | `/api/reader/:bookId/progress`                     | 保存阅读进度         |
| GET  | `/api/reader/:bookId/chapters`                     | 获取解析后的章节列表 |

#### 5.1.2 M3 - 阅读体验增强（~20 小时）

- [ ] R11 翻页模式 (横向/纵向) (5h) — 单页翻页模式（←→键翻页），滚动模式（↑↓键滚动）
- [ ] R12 字体设置持久化 (2h) — 字体/行距/主题偏好保存到 `localStorage`
- [ ] R13 主题预设 (护眼绿/羊皮纸/暗黑/高对比) (3h) — 4 种阅读主题，即时切换
- [ ] R14 阅读统计面板 (2h) — 阅读时长、进度百分比、已读字数
- [ ] R15 快捷操作快捷键 (3h) — ←→翻页、↑↓滚动、T 主题、F 字体、B 书签
- [ ] R16 触屏/移动端适配 (3h) — 左右滑动翻页、双击切换主题
- [ ] R17 测试验收 (2h) — 翻页流畅度、多种字体组合、主题切换

#### 5.1.3 交付物

- [ ] 完整阅读器前端组件 (虚拟滚动、章节导航)
- [ ] TXT 流式读取后端 API
- [ ] 章节解析算法
- [ ] 翻页/滚动双模式
- [ ] 4 种阅读主题

---

### 5.2 Press 前端编辑器 - 布局与导航（~35 小时）

- [ ] F1 三栏布局重构 (4h) — 左侧树 260px + 中央编辑器 + 右侧面板 320px，可折叠/拖拽调整宽度
- [ ] F2 顶部工具栏 (3h) — 项目切换、保存状态、撤销/重做、模式切换(编辑/预览/双栏)、专注模式、主题
- [ ] F3 底部状态栏 (2h) — 字数统计(章/作品)、保存状态、模型名称、写作目标进度、番茄钟
- [ ] F4 左侧章节树 (5h) — 卷-章两级手风琴结构，拖拽排序(跨卷/卷内)，状态徽章(草稿/已发布)，右键菜单
- [ ] F5 项目管理视图 (3h) — 全屏卡片式作品列表，创建/导入/导出/删除/归档
- [ ] F6 作品详情面板 (2h) — 弹窗：名称/笔名/简介/分类/封面/状态/目标字数/更新频率
- [ ] F7 章节元信息栏 (3h) — 编辑器上方：标题编辑、状态切换、写作便签、关联角色、字数目标进度
- [ ] F8 `@mdxeditor/editor` 集成 (5h) — 双向绑定、配置工具栏、MDX 组件支持 (人物/地点卡片)、快捷键
- [ ] F9 自动保存 (5s 防抖) (2h) — 自动保存 + Ctrl+S 手动保存，切换章节/关闭页面时强制保存
- [ ] F10 多标签页编辑 (4h) — 同时打开多章节 Tab 切换，Tab 显示标题+关闭按钮
- [ ] F11 预览模式 (编辑/预览/双栏) (2h) — 实时预览无 MDX 组件渲染

#### 交付物

- [ ] Press 三栏布局框架
- [ ] 卷-章树形结构 (含拖拽排序)
- [ ] `@mdxeditor/editor` 集成
- [ ] 顶部工具栏 + 底部状态栏
- [ ] 项目管理视图

---

### 5.3 测试验收与集成（~5 小时）

- [ ] Reader 端到端流程：导入→阅读→翻页→进度保存 (2h)
- [ ] Press 前端 UI 完整性测试 (1h)
- [ ] 跨浏览器兼容性测试 (Chrome/Edge/Firefox) (1h)
- [ ] Bug 修复 & 已知问题清单更新 (1h)

---

### 5.4 第二阶段里程碑

- [ ] M2.1 - Reader M2 阅读器核心可用 (第 1 周末)
- [ ] M2.2 - Reader M3 翻页/主题完成 (第 2 周末)
- [ ] M2.3 - Press 三栏布局 + 章节树完成 (第 3 周中)
- [ ] M2.4 - MDX 编辑器集成 + 自动保存完成 (第 4 周中)
- [ ] M2.5 - 第二阶段全部功能验收通过 (第 4 周末)

---

## 6. 第三阶段 - 写作编辑器 AI 集成与阅读器增强

**目标**：Press AI 功能全部集成，Reader 书签/搜索补全

**日历时间**：4 周 | **工时估算**：~100 小时

---

### 6.1 Press 右侧 AI 面板（~38 小时）

#### 6.1.1 AI 功能面板（~25 小时）

- [ ] F12 AI 功能 Tab 面板 (标签页切换) (2h) — 续写/润色/对话生成/展开/大纲/校对/写评/情感分析/起名/自定义指令
- [ ] F13 续写功能 (流式 SSE) (4h) — 取光标前 N 字符为前文，流式接收，淡蓝色斜体占位显示
- [ ] F14 润色/改写功能 (3h) — 选中文本 + 风格指令 (更生动/更简洁/古风/自定义)
- [ ] F15 对话生成 (2h) — 选择已有人物或临时描述 → AI 生成符合人设的对话
- [ ] F16 描写展开 (1.5h) — 简单句→沉浸式段落扩展
- [ ] F17 大纲生成 (1.5h) — 基于当前章节内容生成后续章节大纲
- [ ] F18 智能校对 (3h) — 检查错别字/标点/重复用词，编辑器内以装饰性标记显示
- [ ] F19 AI 写评 (2h) — 章节完成后 AI 点评 (节奏/情感/逻辑/改进建议)
- [ ] F20 情感/节奏分析 (3h) — 分析叙事节奏和情感曲线，以 recharts 图表展示
- [ ] F21 AI 智能起名 (1.5h) — 输入关键词 → 生成角色名/地名/功法名
- [ ] F22 自定义指令 (1.5h) — 自由输入 Prompt 操作选中文本或从头生成

#### 6.1.2 上下文控制面板（~5 小时）

- [ ] F23 前文范围滑块 (500-4000) (1h) — 选择发送给 AI 的 token 数量
- [ ] F24 温度/随机性调节 (0.1-1.5) (0.5h) — 随机性控制
- [ ] F25 最大生成长度设置 (100-2000) (0.5h) — 滑动设置
- [ ] F26 模型切换 (DeepSeek-Chat/R1) (1h) — 前端下拉选择
- [ ] F27 音色预设 (小说家/诗人/论文) (1h) — 快速调整系统提示词
- [ ] F28 设定自动注入 (1h) — 勾选后自动将人物/世界观设定加入 AI 上下文

#### 6.1.3 AI 对话面板（~3 小时）

- [ ] F29 独立聊天式界面 (1.5h) — 对话历史记录，支持发送章节内容作为上下文
- [ ] F30 对话保存为便签 (1h) — 将 AI 对话保存为写作便签
- [ ] F31 取消请求 (0.5h) — AbortController 取消正在生成的 AI 回复

#### 6.1.4 右侧侧边栏 Tab（~10 小时）

- [ ] F32 右侧面板 Tab 切换机制 (1h) — AI / 信息 / 角色 / 设定 四个 Tab，可折叠
- [ ] F33 信息 Tab (3h) — 章节摘要编辑、情节线关联、伏笔管理、出场角色列表
- [ ] F34 角色 Tab (2h) — 角色列表卡片、搜索过滤、关联章节数、点击跳转
- [ ] F35 设定 Tab (2h) — 6 分类浏览 (地理/组织/时间线/种族/文化/魔法)、搜索、新建入口
- [ ] F36 角色管理弹窗 (1h) — 创建/编辑角色卡片 (基础信息/外貌/性格/背景/能力/标签)
- [ ] F37 设定管理弹窗 (1h) — 创建/编辑设定条目 (按分类不同字段模板)

---

### 6.2 Reader M4 书签与全文搜索（~22 小时）

- [ ] R18 数据库 Schema 扩展 (2h) — 新增 `bookmarks` 表 + 迁移
- [ ] R19 书签 CRUD API (4h) — `GET/POST /api/reader/:bookId/bookmarks`, `DELETE`
- [ ] R20 书签管理 UI (5h) — 书签侧边栏列表、添加(长按/+按钮)、删除、点击跳转
- [ ] R21 全文搜索后端 (SQLite FTS5) (5h) — 建 FTS5 虚拟表，中英文分词，搜索 API
- [ ] R22 全文搜索前端 UI (4h) — 搜索输入框、结果列表(关键词高亮)、点击跳转到原文位置
- [ ] R23 测试验收 (2h) — 书签 CRUD、全文搜索、中日文混合搜索

**新增 API**：

| 方法   | 路径                                | 说明            |
|--------|-------------------------------------|-----------------|
| GET    | `/api/reader/:bookId/bookmarks`     | 书签列表        |
| POST   | `/api/reader/:bookId/bookmarks`     | 添加书签        |
| DELETE | `/api/reader/:bookId/bookmarks/:id` | 删除书签        |
| GET    | `/api/reader/:bookId/search?q=`     | 全文搜索 (FTS5) |

---

### 6.3 全局设置弹窗（~8 小时）

- [ ] F38 编辑器偏好设置 (2h) — 字体大小/行高/Tab宽度/行号/打字机模式/自动保存间隔
- [ ] F39 AI 默认参数设置 (1.5h) — 温度/最大长度/上下文范围/默认模型
- [ ] F40 API 配置面板 (1.5h) — Base URL / API Key / 每日调用上限
- [ ] F41 写作偏好设置 (1h) — 每日目标字数/番茄钟时长/创作提醒
- [ ] F42 主题与无障碍设置 (1h) — 亮色/暗色/墨绿/暖黄 + 高对比度 + 减少动画
- [ ] F43 快捷键设置面板 (1h) — 显示快捷键映射表

---

### 6.4 导入导出功能（~10 小时）

- [ ] F44 导入作品 (上传 .md / .docx / .txt) (4h) — 文件上传 + 解析 (mammoth for docx, 编码检测)
- [ ] F45 导出作品 (.md) (1h) — 服务端拼接 Markdown + 下载
- [ ] F46 导出作品 (.docx) (2h) — 使用 docx 库生成 Word 文档
- [ ] F47 导出格式选择 UI (1.5h) — 格式选择 + 范围选择 (单章/多章/整部)
- [ ] F48 分章/合并 UI (右键菜单触发) (1.5h) — 拆分过长章节 (按光标位置)、合并相邻多章

---

### 6.5 第三阶段里程碑

- [ ] M3.1 - AI 续写/润色/对话生成可用 (第 1 周中)
- [ ] M3.2 - AI 面板 10+ 功能全部完成 (第 2 周末)
- [ ] M3.3 - 右侧侧边栏 Tab (信息/角色/设定) 完成 (第 3 周中)
- [ ] M3.4 - Reader 书签 + 全文搜索完成 (第 4 周中)
- [ ] M3.5 - 第三阶段全部功能验收通过 (第 4 周末)

---

## 7. 第四阶段 - 写作高级功能与写作统计

**目标**：Press 大纲/伏笔/情节线/写作统计/番茄钟等高级功能

**日历时间**：2.5 周 | **工时估算**：~55 小时

---

### 7.1 大纲管理（~12 小时）

- [ ] P19 大纲视图切换 (树形/卡片/时间线) (4h) — 三种模式切换，左侧/全屏展示大纲
- [ ] P20 章节大纲摘要内联编辑 (2h) — 每章可填写核心剧情摘要 (1-3 句)，在大纲视图中内联编辑
- [ ] P21 大纲便签系统 (2h) — 为整部作品/单卷/单章添加创作便签
- [ ] P22 AI 自动生成大纲 (3h) — 输入核心设定 + 主角信息 → AI 生成卷-章结构
- [ ] P23 后端 API (1h) — `GET /projects/:id/outline` + `POST /projects/:id/outline/generate`

---

### 7.2 伏笔管理（~12 小时）

- [ ] P24 数据库扩展 (1h) — `foreshadowings` 表 (id, projectId, setChapterId, content, type, expectedRecover, actualRecover, status)
- [ ] P25 后端 API (3h) — CRUD + 标记回收 + 按作品/章节/状态/类型筛选
- [ ] P26 前端伏笔面板 (信息 Tab) (3h) — 按状态(未回收/已回收/已废弃)/类型筛选，看板展示待回收数量
- [ ] P27 编辑器内伏笔标记 (3h) — 选中文本 → "标记为伏笔" → 填入回收信息 → 编辑器内显示标记
- [ ] P28 伏笔回收提醒 (1h) — 临近预期回收章节时，状态栏/面板告警提示
- [ ] P29 伏笔概览看板 (弹窗) (1h) — 全景式展示所有伏笔状态，标记回收/废弃

---

### 7.3 情节线管理（~8 小时）

- [ ] P30 数据库扩展 (1h) — `plot_lines` + `chapter_plot_lines` 表已在阶段一建立
- [ ] P31 后端 API (1h) — CRUD + 章节关联/取消关联 (已在阶段一实现)
- [ ] P32 前端情节线管理面板 (2h) — 创建/编辑/删除情节线，设置类型(主线/感情线/暗线/支线)
- [ ] P33 信息 Tab 情节线关联 (2h) — 编辑章节时选择关联情节线，标注进展状态
- [ ] P34 情节线可视化 (2h) — 简易时间线图表展示每条情节线的关联章节

---

### 7.4 写作统计与番茄钟（~13 小时）

- [ ] P35 写作 Session 记录 (2h) — 自动记录每日写作字数/时长，`writing_sessions` 表
- [ ] P36 创作统计面板 (2h) — 日/周/月字数统计、连更天数、各章节字数分布柱状图
- [ ] P37 创作热力图 (2h) — 类似 GitHub 贡献图，按日展示写作量
- [ ] P38 写作日历视图 (2h) — 日历展示每日创作量，标记爆发日/断更日
- [ ] P39 番茄钟模式 (3h) — 25 分钟写作 + 5 分钟休息，可自定义时长，计时时编辑器背景微变
- [ ] P40 日/周写作目标进度 (1h) — 底部状态栏进度条 + 侧边栏展示
- [ ] P41 后端统计 API (1h) — `GET /projects/:id/stats` 聚合数据

---

### 7.5 EPUB/PDF 导出增强（~5 小时）

- [ ] P42 EPUB 导出 (2h) — 使用 `epub-gen` 库生成 EPUB 电子书
- [ ] P43 PDF 导出 (2h) — 使用 `puppeteer` 或 `html-pdf-node`
- [ ] P44 批量导出 (1h) — 选择多个作品/章节一次导出

---

### 7.6 Reader M5 增强（~5 小时）

- [ ] R24 亮度调节 (1h) — 遮罩层实现亮度调节
- [ ] R25 书籍分组管理 (1.5h) — 自定义分组(收藏/在读/完结等)
- [ ] R26 阅读回收站 (1h) — 已删除书籍查看/恢复
- [ ] R27 阅读偏好云端持久化 (1.5h) — 将阅读偏好存到后端数据库

---

### 7.7 第四阶段里程碑

- [ ] M4.1 - 大纲管理 (三种视图) 完成 (第 1 周中)
- [ ] M4.2 - 伏笔管理 + 情节线管理完成 (第 1 周末)
- [ ] M4.3 - 写作统计 + 番茄钟完成 (第 2 周中)
- [ ] M4.4 - EPUB/PDF 导出 + Reader 增强完成 (第 2 周末)
- [ ] M4.5 - 第四阶段全部功能验收通过 (第 2.5 周)

---

## 8. 第五阶段 - 仪表盘与浏览器扩展

**目标**：完成 Dashboard 统计看板，开发完整浏览器扩展

**日历时间**：2.5 周 | **工时估算**：~55 小时

---

### 8.1 Dashboard 仪表盘统计看板（~30 小时）

#### 8.1.1 后端统计 API（~12 小时）

- [ ] D1 `GET /api/dashboard/stats` 聚合 API (6h) — 查 4 个数据库聚合：notebook(笔记数/字数/新增), gallery(媒体/收藏/短视频/来源分布), reader(书籍/字数/最近阅读), ai(会话/Token/费用), press(作品数/章节数/字数), diskUsage
- [ ] D2 `GET /api/dashboard/activity` 聚合 (2h) — 跨模块最近操作，按时间倒序 (各模块取最近 20 条合并排序)
- [ ] D3 Token 用量按日聚合 (2h) — 近 7 天 Token 用量趋势数据
- [ ] D4 媒体库统计 + 磁盘监控 (2h) — 各来源占比、存储占用字节、磁盘使用率

**DashboardStats 类型**：
```typescript
interface DashboardStats {
    notebook: { totalNotebooks, totalNotes, totalWords, todayNewNotes, totalTags, recentNotes[] }
    gallery:  { totalMedia, imageCount, videoCount, totalFavorites, totalShorts, todayNewMedia, sourceDistribution[], typeDistribution[], storageUsedBytes }
    reader:   { totalBooks, totalChars, recentlyRead[] }
    ai:       { totalSessions, todayTokens, monthTokens, estimatedCost, recentDays[] }
    press:    { totalProjects, totalChapters, totalWords }
    diskUsage:{ path, totalBytes, usedBytes, freeBytes, usagePercent }
}
```

#### 8.1.2 前端仪表盘组件（~18 小时）

- [ ] D5 HomeHeader 改造 (0.5h) — 欢迎横幅 + 当前日期时间
- [ ] D6 StatCardRow 统计卡片行 (2h) — 4 张卡片 (累计字数/书籍数/Token用量/备用)
- [ ] D7 WidgetShortcut 快捷方式网格 (核心) (8h) — 对标 Infinity New Tab Pro：112×96px 磁贴、Favicon 自动抓取、Emoji/Tabler 图标、拖拽排序、右键菜单、4 组预设、空状态引导、localStorage 持久化
- [ ] D8 QuickActions 快捷操作 (1.5h) — 5 个入口按钮 (新建笔记/写作/图库/AI/阅读)
- [ ] D9 ActivityFeed 最近活动 (2h) — 跨模块最近操作时间线
- [ ] D10 WidgetTodo 待办事项 (1h) — 简单待办列表 (localStorage 存储)
- [ ] D11 Token 用量趋势图 (1.5h) — recharts 柱状图 (近 7 天)
- [ ] D12 媒体分类饼图 (1h) — 图片/视频占比、来源分布
- [ ] D13 磁盘空间告警组件 (0.5h) — 进度条 >85% 黄色、>95% 红色

**WidgetShortcut 核心规范**：

| 属性       | 值                                           |
|------------|----------------------------------------------|
| 磁贴尺寸   | 112×96px (桌面)，响应式缩小                  |
| 图标类型   | favicon / emoji / tabler / color             |
| Favicon 源 | `https://www.google.com/s2/favicons?domain=` |
| 拖拽       | HTML5 DnD API                                |
| 预设       | 4 组 (常用搜索/开发工具/内容平台/AI 工具)    |
| 数据存储   | localStorage (`dashboard_shortcuts` 键)      |

---

### 8.2 浏览器扩展开发（~18 小时）

#### 8.2.1 任务清单

| 编号 | 任务                                | 工时 | 说明                                                                    |
|------|-------------------------------------|------|-------------------------------------------------------------------------|
| E1   | manifest.json 改造 + 权限配置       | 0.5h | 添加 activeTab/contextMenus/storage/scripting/host_permissions/commands |
| E2   | background.js Service Worker        | 2h   | 快捷键监听、右键菜单管理、消息路由、API 调用                            |
| E3   | content-script.js 内容提取          | 2h   | 页面内容提取 (Readability + Turndown)、监听 background 消息             |
| E4   | 新标签页改造 (iframe + 离线检测)    | 1.5h | index.html iframe 嵌入 `localhost:3006`，心跳检测 + 离线降级页面        |
| E5   | 右键菜单保存选中文本                | 1h   | 选中文本后右键 → "保存到笔记" → POST /api/notebook/create               |
| E6   | 整页内容采集 (快捷键+右键)          | 2.5h | `Ctrl+Shift+P` 或右键触发，Readability 提取正文，Turndown 转 MD         |
| E7   | 截图编辑弹窗 UI                     | 2h   | screenshot-panel.html + CSS：双栏布局 (截图区 + 文字编辑区)             |
| E8   | 截图裁剪 + OCR 集成                 | 3h   | Canvas 裁剪、Tesseract.js (chi_sim+eng) 识别，拖拽选区域                |
| E9   | 扩展设置页面 (options)              | 1h   | 服务器地址、OCR 引擎、自动采集延迟、默认笔记本                          |
| E10  | lib 库集成 (Readability + Turndown) | 0.5h | 安装打包 Readability.js 和 Turndown 库                                  |
| E11  | 错误处理 + 通知机制                 | 1h   | chrome.notifications 反馈、离线检测、心跳检查                           |
| E12  | 后端扩展专用 API (可选)             | 1h   | `POST /api/extension/save` 统一接收扩展数据                             |

**快捷键一览**：

| 快捷键         | 功能                  |
|----------------|-----------------------|
| `Ctrl+Shift+S` | 截图文字识别          |
| `Ctrl+Shift+P` | 采集整页内容          |
| 右键菜单       | 保存选中文本/采集整页 |

**所有采集内容统一保存格式**：
```markdown
> 来源：[页面标题](页面URL)
> 采集方式：截图识别 / 选中文本 / 整页采集
> 采集时间：2026-05-30 03:01:00

---
正文内容（Markdown 格式）
```

---

### 8.3 第五阶段里程碑

- [ ] M5.1 - Dashboard 后端 Stats API 完成 (第 1 周中)
- [ ] M5.2 - WidgetShortcut 快捷方式网格完成 (第 1 周末)
- [ ] M5.3 - 浏览器扩展后台 + content-script 完成 (第 2 周中)
- [ ] M5.4 - 截图 OCR + 整页采集完整链路完成 (第 2 周末)
- [ ] M5.5 - 第五阶段全部功能验收通过 (第 2.5 周)

---

## 9. 第六阶段 - 笔记增强与图库增强

**目标**：笔记模块补齐全文搜索、双向链接、AI 增强，图库模块补齐标签系统、统计看板

**日历时间**：4 周 | **工时估算**：~90 小时

---

### 9.1 笔记增强 - 全文检索 FTS5（~15 小时）

- [ ] N1 SQLite FTS5 虚拟表 + 迁移 (3h) — 为 `notes` 表建立 FTS5 全文索引，含中文分词
- [ ] N2 全文搜索后端 API (3h) — `GET /api/notebook/search/fulltext?q=&limit=&offset=`
- [ ] N3 全文搜索前端 UI (4h) — 搜索输入框 (支持 `tag:` / `notebook:` / `created:` 语法)、结果高亮
- [ ] N4 搜索结果高亮显示 (2h) — 关键词片段在结果列表中高亮
- [ ] N5 搜索历史记录 (1h) — 保存最近 20 条搜索关键词
- [ ] N6 索引增量更新机制 (1h) — 笔记创建/更新时自动同步 FTS 索引
- [ ] N7 测试验收 (1h) — 中英文混合搜索、模糊匹配、精确短语匹配

---

### 9.2 笔记增强 - 双向链接（~15 小时）

- [ ] N8 双向链接解析器 `[[标题]]` (3h) — 编辑器输入 `[[` 触发笔记搜索，选择插入，解析为链接
- [ ] N9 链接关系数据库表 (1h) — `note_links` 表 (sourceId, targetId, createdAt)
- [ ] N10 后端链接 API (3h) — 获取笔记的所有出链/入链、引用计数
- [ ] N11 反向链接面板 (2h) — 笔记侧边栏显示"被引用"列表，点击跳转
- [ ] N12 引用计数显示 (1h) — 笔记标题旁显示被引用次数
- [ ] N13 链接图谱可视化 (3h) — 使用 force-graph 或 D3.js 展示引用关系网络，可缩放拖拽
- [ ] N14 相关笔记推荐 (2h) — 基于标签重叠度在侧边栏推荐相关笔记

---

### 9.3 笔记增强 - AI 功能（~12 小时）

- [ ] N15 AI 摘要生成 (2h) — 选中段落调用 AI 生成摘要，自动填充 `summary` 字段
- [ ] N16 AI 改写/扩写/缩写/翻译 (3h) — 选中文本后触发 AI 操作，流式替换
- [ ] N17 RAG 问答 (3h) — AI 对话中自动检索当前笔记本/标签下的笔记内容作为上下文回答
- [ ] N18 批量标签建议 (2h) — 根据笔记内容 AI 推荐标签，用户确认后批量添加
- [ ] N19 笔记模板系统 (2h) — 预设模板 (会议记录/读书笔记/周报)，支持用户自定义保存模板

---

### 9.4 笔记增强 - 附件管理优化（~8 小时）

- [ ] N20 附件文件化存储 (Base64→文件) (3h) — 将数据库中 Base64 存储的附件迁移到文件系统，数据库存路径引用
- [ ] N21 附件批量上传 (2h) — 一次性选择多文件上传，显示上传进度条
- [ ] N22 附件拖拽排序 (1h) — 在笔记详情中拖拽调整附件顺序
- [ ] N23 附件存储完整性校验 (1h) — 定期校验附件 MD5 与数据库一致
- [ ] N24 数据库自动备份 (1h) — 每日首次启动备份所有 .db 文件到 `data/backup`，保留 7 天

---

### 9.5 图库增强（~25 小时）

- [ ] G1 图库标签系统 (CRUD + 关联) (4h) — `tags` + `media_tags` 表，标签创建/删除/批量关联
- [ ] G2 按标签筛选 (2h) — 在图库浏览中按标签过滤媒体
- [ ] G3 虚拟滚动改造 (10,000+ 媒体) (5h) — 引入 `react-window` + 固定高度行，减少 DOM 节点
- [ ] G4 批量操作 (多选 → 删除/收藏/打标) (3h) — 长按/Ctrl+点击选择 → 工具栏批量操作
- [ ] G5 图库统计看板 (3h) — 总媒体数、各类占比（饼图）、各来源占比、新增趋势（折线图）
- [ ] G6 磁盘空间监控告警 (2h) — 媒体目录磁盘使用率 >85% 告警，>95% 紧急告警
- [ ] G7 图库排序 (最热/最新) (2h) — 按 view 数/创建时间排序
- [ ] G8 缩略图多级缓存 (200/400/800px) (2h) — 列表加载小尺寸、查看器加载大尺寸
- [ ] G9 渐进式图片加载 (2h) — 先加载低质量缩略图，再渐进式加载高质量原图

---

### 9.6 第六阶段里程碑

- [ ] M6.1 - 笔记全文搜索 FTS5 完成 (第 1 周末)
- [ ] M6.2 - 双向链接 + 图谱完成 (第 2 周末)
- [ ] M6.3 - AI 摘要/改写/RAG 问答完成 (第 3 周中)
- [ ] M6.4 - 图库标签系统 + 虚拟滚动完成 (第 3 周末)
- [ ] M6.5 - 第六阶段全部功能验收通过 (第 4 周末)

---

## 10. 第七阶段 - 模块联动与全局搜索

**目标**：打通各模块数据流，全局搜索，性能优化，测试覆盖

**日历时间**：4 周 | **工时估算**：~90 小时

---

### 10.1 模块联动（~25 小时）

- [ ] L1 笔记内插入图库图片弹窗 (4h) — 编辑器"插入图片"→ 弹出图库选择器 → 筛选/搜索 → 下载附件并插入
- [ ] L2 图库图片 "创建笔记" 功能 (2h) — 在图库中选中图片 → "创建笔记" → 自动新建笔记并设为附件
- [ ] L3 写作模块图片插入 (从图库) (2h) — Press MDX 编辑器支持从图库插入图片
- [ ] L4 统一标签体系 (4h) — 笔记与图库共享标签数据库，跨模块标签搜索
- [ ] L5 图片引用反向追溯 (3h) — 图库图片详情显示"被哪些笔记/章节引用"列表
- [ ] L6 最近使用图片面板 (3h) — 任何模块侧边栏可打开"最近使用图片"面板，拖拽插入
- [ ] L7 跨模块最近活动聚合 (2h) — Dashboard ActivityFeed 聚合阅读/写作/图库/笔记操作
- [ ] L8 写作模块引用笔记内容 (3h) — Press 编辑器中可引用笔记内容作为写作参考
- [ ] L9 模块间跳转 (阅读→笔记→写作→图库) (2h) — 上下文菜单/右键快速跳转到相关模块

---

### 10.2 全局搜索（~12 小时）

- [ ] GS1 全局搜索后端 API (4h) — `GET /api/search?q=&modules=note,press,gallery,reader` 聚合搜索
- [ ] GS2 全局搜索前端 UI (3h) — 顶部搜索栏 (Ctrl+K 呼出)，搜索框 + 分类 Tab + 结果列表
- [ ] GS3 搜索结果显示与跳转 (2h) — 每项结果显示所属模块、匹配片段高亮，点击跳转到对应模块
- [ ] GS4 搜索结果聚合排序 (2h) — 按相关性/时间倒序排列，每个模块最多 N 条
- [ ] GS5 搜索快捷键 (Ctrl+K) (1h) — 全局快捷键，聚焦搜索栏

---

### 10.3 系统性能优化（~25 小时）

- [ ] O1 Reader 同步 I/O 异步化 (walkDirectory + statSync 改用 fs.promises) (3h) — 扫描期间不阻塞事件循环
- [ ] O2 Reader 大文件流式读取 (detectAndRead 改为流式分块) (4h) — 避免 \>100MB 文件 OOM，数据库仅存路径+编码
- [ ] O3 Reader 扫描并发锁 (互斥锁) (1h) — 防止并发扫描竞争
- [ ] O4 Reader 批量导入事务保护 (2h) — 批量导入使用事务，失败回滚
- [ ] O5 COUNT 统计内存缓存 (带 TTL) (3h) — 大表 COUNT 缓存 60s
- [ ] O6 Python 子进程池复用 (高频脚本) (4h) — 减少重复进程创建开销
- [ ] O7 缩略图 LRU 缓存 (MD5→路径映射) (3h) — 减少重复磁盘 I/O
- [ ] O8 Brotli 压缩 (替换 gzip) (1h) — 文本资源额外减少 20% 体积
- [ ] O9 性能基准测试 (4h) — API 响应时间、数据库查询、内存占用基线

---

### 10.4 测试覆盖完善（~18 小时）

- [ ] T1 核心工具函数单元测试 — `apps/utils/*` (2h)
- [ ] T2 Gallery 控制器测试 — `modules/Gallery` (3h)
- [ ] T3 Reader 服务层 + API 测试 — `modules/Reader` (3h)
- [ ] T4 Press 后端全量 API 测试 — `modules/Press` (4h)
- [ ] T5 Dashboard 后端 API 测试 — `modules/Dashboard` (2h)
- [ ] T6 前端关键组件测试 — 各模块 UI (2h)
- [ ] T7 安全测试 (路径穿越/CORS/Rate-limit) — 全局 (1h)
- [ ] T8 压力测试 (并发请求/大文件) — 全局 (1h)

---

### 10.5 文档完善与发布准备（~10 小时）

- [ ] D14 完整 API 接口文档 (全部模块) (3h)
- [ ] D15 用户操作手册 (含截图) (2h)
- [ ] D16 Docker 部署配置 + Dockerfile (2h)
- [ ] D17 开发环境搭建指南更新 (1h)
- [ ] D18 CHANGELOG 整理 (1h)
- [ ] D19 Release Notes + 版本发布 (1h)

---

### 10.6 第七阶段里程碑

- [ ] M7.1 - 模块联动 (图库-笔记-写作) 打通 (第 1 周末)
- [ ] M7.2 - 全局搜索 Ctrl+K 可用 (第 2 周中)
- [ ] M7.3 - 性能优化全部落地 (第 3 周中)
- [ ] M7.4 - 测试覆盖目标达成 (>70% 后端) (第 3 周末)
- [ ] M7.5 - 文档 + 发布准备完成 (第 4 周中)
- [ ] M7.6 - 项目全部交付验收通过 (第 4 周末)

---

## 11. 里程碑节点总览

- [ ] **M1.1** 安全加固完成 — 第 1 周 · 阶段一 — CORS + Rate-limit + 超时 + 路径校验全部上线
- [ ] **M1.2** Press 数据库迁移完成 — 第 1 周 · 阶段一 — 10 表 Schema + Drizzle 迁移可用
- [ ] **M1.3** Press 全部 API 测试通过 — 第 2 周 · 阶段一 — 45+ 端点全部通过单元测试
- [ ] **M1.4** 第一阶段验收 — 第 3 周 · 阶段一 — 安全 + Press 后端 API 完整可用
- [ ] **M2.1** Reader M2 阅读器核心 — 第 4 周 · 阶段二 — 虚拟滚动 + 章节解析 + 进度保存
- [ ] **M2.2** Reader M3 翻页/主题完成 — 第 5 周 · 阶段二 — 翻页/滚动双模式、4 种主题
- [ ] **M2.3** Press 三栏布局 + MDX 编辑器 — 第 6 周 · 阶段二 — 布局框架 + 编辑器双向绑定 + 自动保存
- [ ] **M2.4** 第二阶段验收 — 第 7 周 · 阶段二 — Reader M2-M3 + Press UI 框架
- [ ] **M3.1** AI 续写/润色/对话可用 — 第 8 周 · 阶段三 — 流式 SSE 续写、润色、对话生成功能完成
- [ ] **M3.2** AI 全部功能完成 — 第 9 周 · 阶段三 — 10+ AI 功能全部联调通过
- [ ] **M3.3** Reader M4 书签 + 搜索完成 — 第 10 周 · 阶段三 — FTS5 全文搜索、书签 CRUD
- [ ] **M3.4** 第三阶段验收 — 第 11 周 · 阶段三 — Press AI 面板 + Reader 增强
- [ ] **M4.1** 大纲管理 (三种视图) — 第 12 周 · 阶段四 — 树形/卡片/时间线三种大纲视图
- [ ] **M4.2** 伏笔 + 情节线管理 — 第 12 周 · 阶段四 — 伏笔 CRUD + 回收跟踪，情节线 CRUD + 关联
- [ ] **M4.3** 写作统计 + 番茄钟 — 第 13 周 · 阶段四 — 热力图/日历/统计面板，番茄钟模式
- [ ] **M4.4** 第四阶段验收 — 第 13.5 周 · 阶段四 — Press 全部功能完成
- [ ] **M5.1** Dashboard Stats API — 第 14 周 · 阶段五 — 4 数据库聚合 API
- [ ] **M5.2** WidgetShortcut 快捷方式 — 第 14 周 · 阶段五 — 磁贴网格 + 拖拽 + Favicon + 预设
- [ ] **M5.3** 浏览器扩展完整链路 — 第 15 周 · 阶段五 — 截图 OCR + 选中保存 + 整页采集 全部可用
- [ ] **M5.4** 第五阶段验收 — 第 15.5 周 · 阶段五 — Dashboard + 浏览器扩展
- [ ] **M6.1** 笔记全文搜索 FTS5 — 第 16 周 · 阶段六 — 全文搜索含中文分词
- [ ] **M6.2** 双向链接 + 图谱 — 第 17 周 · 阶段六 — `[[标题]]` 链接 + 可视化图谱
- [ ] **M6.3** 图库标签 + 虚拟滚动 — 第 18 周 · 阶段六 — 标签系统 + 10,000+ 媒体虚拟滚动
- [ ] **M6.4** 第六阶段验收 — 第 19 周 · 阶段六 — 笔记增强 + 图库增强
- [ ] **M7.1** 模块联动 + 全局搜索 — 第 20 周 · 阶段七 — 图库-笔记-写作数据互通，Ctrl+K 全局搜索
- [ ] **M7.2** 性能优化落地 — 第 21 周 · 阶段七 — 异步 I/O + 缓存 + 流式改造完成
- [ ] **M7.3** 测试覆盖达标 — 第 22 周 · 阶段七 — 后端测试覆盖 >70%
- [ ] **M7.4** 项目全量交付 — 第 24 周 · 阶段七 — 全部模块完成 + 文档完善 + 发布包就绪

---

## 12. 工时汇总

### 12.1 按阶段汇总

| 阶段     | 工时      | 日历周数  | 日均工时  |
|----------|-----------|-----------|-----------|
| 阶段一   | ~70h      | 3 周      | ~4.7h     |
| 阶段二   | ~95h      | 4 周      | ~4.8h     |
| 阶段三   | ~100h     | 4 周      | ~5.0h     |
| 阶段四   | ~55h      | 2.5 周    | ~4.4h     |
| 阶段五   | ~55h      | 2.5 周    | ~4.4h     |
| 阶段六   | ~90h      | 4 周      | ~4.5h     |
| 阶段七   | ~90h      | 4 周      | ~4.5h     |
| **合计** | **~555h** | **24 周** | **~4.6h** |

### 12.2 按模块汇总

| 模块                                   | 工时      | 占比     |
|----------------------------------------|-----------|----------|
| 安全加固                               | ~12h      | 2.2%     |
| Press 后端 API + 数据库                | ~55h      | 9.9%     |
| Press 前端布局 + 编辑器                | ~35h      | 6.3%     |
| Press AI 面板 + 功能                   | ~56h      | 10.1%    |
| Press 高级功能 (大纲/伏笔/情节线/统计) | ~50h      | 9.0%     |
| Reader 阅读器 (M2-M5)                  | ~82h      | 14.8%    |
| Dashboard 仪表盘                       | ~30h      | 5.4%     |
| 浏览器扩展                             | ~18h      | 3.2%     |
| 笔记增强 (FTS5/双向链接/AI/附件)       | ~50h      | 9.0%     |
| 图库增强 (标签/虚拟滚动/统计)          | ~25h      | 4.5%     |
| 模块联动 + 全局搜索                    | ~37h      | 6.7%     |
| 系统性能优化                           | ~25h      | 4.5%     |
| 测试覆盖完善                           | ~18h      | 3.2%     |
| 各阶段需求分析/设计                    | ~22h      | 4.0%     |
| 各阶段集成测试/验收                    | ~20h      | 3.6%     |
| 文档完善 + 发布准备                    | ~10h      | 1.8%     |
| Buffer (预留 10%)                      | ~50h      | 9.0%     |
| **合计**                               | **~555h** | **100%** |

### 12.3 工时估算说明

- **单全栈开发者 + AI 辅助**：AI 可大幅提升编码效率（~30-40%），尤其在代码生成、测试编写、文档撰写方面
- **日均有效工时**：4~6 小时（排除会议、沟通、打断等损耗）
- **Buffer 预留**：各阶段预留 10% 缓冲时间用于突发事件和 Bug 修复
- **实际日历时间**：按每天 5 小时有效编码计算，约 111 个工作日 ≈ 24 周（含周末休息）
- **并行可能性**：阶段三可部分与阶段四并行（AI 面板与高级功能），但建议顺序执行以保证质量

---

## 13. 风险与应对

- [ ] **`@mdxeditor/editor` 集成兼容性问题** → 影响：编辑器功能受阻 → 缓解：提前调研 API，准备备选方案 (CodeMirror/Monaco)
- [ ] **FTS5 中文分词效果差** → 影响：搜索体验不佳 → 缓解：测试 jieba 分词 + FTS5 tokenizer 组合，或使用外部分词器
- [ ] **EPUB/PDF 导出工具库兼容性问题** → 影响：导出功能延迟 → 缓解：提前 PoC 验证 pptr 或 epub-gen，准备备选方案
- [ ] **DeepSeek API 不稳定/限流** → 影响：AI 功能不可用 → 缓解：支持降级为本地模板提示，支持自定义接口地址
- [ ] **Python 环境缺失 (Python/Pillow/ffmpeg)** → 影响：图库脚本失败 → 缓解：提前检测依赖并提供友好错误提示，AI 辅助用户安装
- [ ] **Press 模块功能过于庞大导致开发周期拉长** → 影响：项目延期 → 缓解：按优先级分阶段：核心编辑+AI (P0) > 大纲/伏笔 (P1) > 统计/番茄钟 (P2)
- [ ] **大文件 (>100MB TXT) 阅读性能问题** → 影响：读者体验差 → 缓解：流式分块读取 + 虚拟滚动，压力测试
- [ ] **API Key 泄露风险** → 影响：安全风险 → 缓解：AES-256-GCM 加密存储 + 文档警告 + 可选后端代理模式
- [ ] **浏览器扩展 CSP 限制** → 影响：功能异常 → 缓解：Manifest V3 的 content_scripts 不受页面 CSP 限制
