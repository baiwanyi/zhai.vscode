# 微信公众号 (WeChat Official Account) — 模块设计文档

**版本**：2.1
**日期**：2026-10-30
**状态**：草案（第 10~14 节为界面与导航设计，待评审后进入实现；接口权限与主体类型待验证，结论回填至第 9 节）
**宿主**：VSCode 插件 Zhai（宅桌面）
**前身**：v1.0「同步微信公众号」——仅承担「排版 → 草稿箱」单向同步链路

> ⚠️ **前置说明**：公众号接口能力与**主体类型**强相关。未认证订阅号通常只能使用**草稿箱**接口，群发（发布）能力需认证。同时接口要求**调用方 IP 在白名单内**，家庭宽带动态 IP 会导致 Token 获取失败。**开发前必须完成权限与 IP 方案验证**，结论回填至第 9 节。

---

## 0. 模块目录与存储（设想②）

- **模块定位**：公众号是「分发与管理通道」，源内容来自 `notes/` / `press/` 等模块；本模块不额外建立本地正文目录，仅缓存发布配置、草稿元数据与排版主题。
- **索引与业务库**：独立 `globalStorage/wechat.db`（与 `press.db` 同模式），承载账号、批次、文章、素材映射与统计缓存（见第 6 节）。原设想「与微博共用 `globalStorage/social.db`」已放弃，原因见 10.1 决策 D3。
- **排版主题 / 模板**：可存 `globalStorage` 或用户配置目录（与 `common.md` 一致），主题以 CSS 文件维护，支持用户自定义覆盖。

---

## 1. 模块概述

### 1.1 定位

在 VSCode 内完成公众号图文的**写作、同步发布与基础管理**全流程：从 Markdown/笔记/章节排版成文，到草稿箱 / 群发 / 定时发布，再到素材、已发布、菜单、自动回复、粉丝标签与数据概览。参考成熟工具（壹伴、新媒体管家、秀米、135 编辑器、公众平台助手）的能力边界设计。

与「微博浏览器」的差异：公众号承载**长文 + 完整排版 + 运营闭环**，需要内联样式 HTML、永久素材、封面/摘要/原创声明；微博承载短内容互动（见 `weibo.md`）。

### 1.2 目标

- **写作即排版**：Markdown → 公众号可直接发布的 HTML（内联样式、代码高亮、模板/样式中心）
- **一键发布**：草稿箱 → 群发/发布（`freepublish`）/ 定时群发，支持预览给指定微信号
- **素材资产化**：图片/语音/视频上传为永久素材，分组、搜索、复用
- **运营管理**：自定义菜单、自动回复、粉丝标签、已发布管理与数据概览（接口可得范围内）
- **过程可回滚**：草稿箱机制天然支持「先草稿、后发布」，失败可重试且不重复建草稿

### 1.3 非目标（保留边界，避免范围失控）

- 不做深度商业化运营（微信支付、卡券、小程序关联、模板消息营销）
- 不做复杂数据看板（仅提供接口可取的概览，深度分析引导后台）
- 多公众号支持「切换与选择」，不做矩阵自动分发

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 长文发布 | 写完 5000 字技术文章 → 命令「发布到公众号」→ 选排版主题 → 预览 → 创建草稿 → 在公众号后台确认群发 |
| US-2 | 素材永久化 | 文章含 8 张图 → 自动上传为永久素材 → 正文引用平台 URL，本地保留原图 |
| US-3 | 代码文章 | 代码块自动高亮并内联样式，移动端不溢出 |
| US-4 | 重复发布防护 | 同一文章二次发布 → 本地记录提示已存在草稿，可选择更新或新建 |
| US-5 | IP 变更 | 家庭宽带 IP 变化导致 Token 获取失败 → 明确提示「IP 不在白名单」与处理指引 |
| US-6 | 定时群发 | 排期今晚 22:00 群发 → 到点自动提交发布 |
| US-7 | 多图文群发 | 一次群发 3 篇，每篇独立封面与摘要 |
| US-8 | 排版模板复用 | 把常用排版存为模板，新文一键套用 |
| US-9 | 素材库管理 | 上传图片/语音/视频，分组、搜索、复用 |
| US-10 | 菜单配置 | 可视化配置自定义菜单（点击/跳转） |
| US-11 | 自动回复 | 配置关注回复、关键词回复 |
| US-12 | 粉丝标签 | 给粉丝打标签、分组、备注、拉黑 |
| US-13 | 已发布管理 | 查看已发布图文、删除、看阅读数据 |
| US-14 | 敏感词预检 | 发布前检测违规词与原创风险 |
| US-15 | AI 配图/标题 | 根据正文生成候选封面图与标题建议（可选，复用 CodeBuddy 通道） |

---

## 3. 功能清单

> 沿用 v1.0 编号 G1~G14（与 `roadmap.md` S7 引用一致），新增 G15~G25 覆盖写作/发布/管理增强。

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| G1 | 凭证配置 | AppID / AppSecret 存 `SecretStorage`，支持多账号切换 | P0 | 待实现 |
| G2 | AccessToken 管理 | 集中缓存 + 提前刷新 + 并发去重（singleflight） | P0 | 待实现 |
| G3 | Markdown → 公众号 HTML | 走 `markdown-one` 管线，输出语义化 HTML | P0 | 待实现 |
| G4 | 样式内联 | `juice` 将主题 CSS 内联（公众号不支持 `<style>`） | P0 | 待实现 |
| G5 | 代码高亮 | shiki 高亮并内联样式 | P1 | 待实现 |
| G6 | 排版主题/样式中心 | 多套主题（字号/行距/引用块/标题装饰），可自定义；参考秀米/135 样式中心 | P1 | 待实现 |
| G7 | 图片转永久素材 | 上传 `material/add_material`，回写 URL | P0 | 待实现 |
| G8 | 封面/摘要/作者/声明 | 封面图、摘要、作者、原创声明、留言开关、话题标签 | P1 | 待实现 |
| G9 | 草稿箱 CRUD | `draft/add`/`update`/`list`/`delete`，返回 media_id | P0 | 待实现 |
| G10 | 群发/发布 | `freepublish/submit`（认证主体）或 `message/mass/sendall` | P2 | 待验证 |
| G11 | 预览 | Webview 按公众号宽度预览；支持预览给指定微信号 | P0 | 待实现 |
| G12 | 发布历史 | 记录 media_id、状态与链接 | P1 | 待实现 |
| G13 | 重试与幂等 | 指数退避重试；按内容 hash 防重复建草稿 | P1 | 待实现 |
| G14 | 错误指引 | 针对 IP 白名单、配额、素材超限给出可执行指引 | P1 | 待实现 |
| G15 | 多图文编排 | 一次群发多篇文章，各自封面/摘要与顺序 | P1 | 待实现 |
| G16 | 排版模板 | 保存常用排版为模板，新文一键套用/复用 | P1 | 待实现 |
| G17 | AI 配图/标题 | 根据正文生成候选封面与标题（可选，复用 CodeBuddy 通道） | P2 | 待实现 |
| G18 | 敏感词/违规预检 | 发布前检测违规词与原创风险（参考壹伴违规检测） | P1 | 待实现 |
| G19 | 定时群发 | 本地调度到点自动提交发布（需认证主体） | P2 | 待实现 |
| G20 | 已发布管理 | 已发布图文列表、删除、查看数据链接 | P2 | 待实现 |
| G21 | 素材管理增强 | 图片/语音/视频永久素材，分组、搜索、复用（扩展 G7） | P1 | 待实现 |
| G22 | 自定义菜单 | `menu/*` 创建/查询/删除（点击/跳转类型） | P2 | 待实现 |
| G23 | 自动回复 | 关注回复、关键词回复规则配置（接口受限时本地管理+导出 JSON 供后台导入） | P2 | 待实现 |
| G24 | 粉丝管理 | `user/*` 列表/标签/备注/黑名单 | P2 | 待实现 |
| G25 | 数据概览 | `datacube/*` 用户增长、图文统计、菜单分析（需认证） | P2 | 待实现 |

---

## 4. 交互与流程

### 4.1 Token 获取（并发安全）

```
任意接口调用前需要 access_token
   │
   ▼
查内存缓存（未过期？）→ 命中直接返回
   │ 未命中
   ▼
查 singleflight：是否已有进行中的刷新请求？
   ├─ 是 → 复用同一个 Promise（避免并发互刷导致 Token 失效）
   └─ 否 → 发起刷新（加锁）
          │
          ▼
   调用 /cgi-bin/token（超时 10s）
          ├─ 成功 → 写入缓存（提前 5 分钟过期）+ 记录 expires_at
          └─ 失败 → 解析 errcode
                 ├─ 40164（IP 不在白名单）→ 提示具体 IP 与配置指引
                 ├─ 40001（密钥错误）→ 提示重新配置
                 └─ 其他 → 指数退避重试（上限 3 次）
```

### 4.2 写作与发布流程

```
当前文件（notes/press 源）
   │
   ▼ markdown-one：md → mdast → rehype → HTML
   ├─ shiki 代码高亮
   ├─ 图片路径收集（相对路径 → 本地绝对路径）
   └─ 生成大纲（用于摘要 / 敏感词预检语料）
   │
   ▼ 选主题/模板 → juice 内联样式
公众号 HTML
   │
   ▼ 敏感词预检（G18）：命中 → 提示位置与建议，阻断或放行
   │
   ▼ 预览（Webview，模拟 375px 宽度；可「预览给微信号」）
用户确认 → 填写封面/摘要/作者/原创声明/留言/话题
   │
   ▼ 幂等校验：contentHash（账号 + 正文 + 主题）
   ├─ 已有成功草稿 → 提示「更新该草稿 / 新建草稿」
   └─ 新建
   │
   ▼ 图片上传为永久素材（串行 + 进度）
   │     失败：图片 >10MB 或格式不支持 → 明确提示并跳过/终止
   │
   ▼ 替换正文图片 URL 为素材 URL
   │
   ▼ 多图文编排（G15，可选）：组装 articles[]（每篇封面/摘要）
   │
   ▼ draft/add 或 draft/update 创建草稿
   │     失败：指数退避重试（含 Token 失效时自动刷新后重试一次）
   │
   ▼ 记录 publish_records（media_id + 状态）
   │
   ▼ 发布/定时（G10/G19）：认证主体调用 freepublish/submit 或排队到点提交；
   │     未认证 → 提示去后台群发，草稿已就绪
   ▼ 记录发布历史（G12）
```

### 4.3 管理流程（素材 / 菜单 / 自动回复 / 粉丝 / 数据）

```
管理面板（侧边栏或命令）
   ├─ 素材（G21）：上传图片/语音/视频 → 永久素材 → 分组/搜索/复用（local_hash 命中直接复用）
   ├─ 菜单（G22）：可视化编辑 menu 结构 → menu/create → 后台生效
   ├─ 自动回复（G23）：编辑关注/关键词规则 → 本地存储；接口不可得时导出 JSON 供后台导入
   ├─ 粉丝（G24）：user/get 列表 → 打标签/备注/拉黑（user/tag/*、user/info/updateremark）
   └─ 数据（G25）：datacube/get 用户增长/图文统计/菜单分析 → 概览卡片（需认证）
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 接口调用 | 内置 `fetch` / 官方 SDK | **内置 fetch** | 接口数量少，无需额外依赖；统一超时与错误处理 |
| Token 并发 | 各自刷新 / singleflight | **singleflight（Promise 复用）** | 并发刷新会互相失效，是公众号对接的经典坑 |
| HTML 生成 | `markdown-one` 管线 / 模块内自建 unified 管线 | **模块内自建（已落地，见 `src/modules/wechat/render.ts`）** | `markdown-one` 尚未落地；先把公众号需要的 `remark-parse` + `remark-gfm` + `remark-rehype` + `rehype-stringify` 收在本模块内，后续该管线成熟后整体迁入并复用之 |
| 样式内联 | `juice` / 手写替换 | **juice（已落地）** | 公众号不支持 `<style>` 与外链 CSS，必须内联；根选择器用 `section`，`body` 规则在正文片段里找不到宿主元素会被丢弃 |
| 代码高亮 | `shiki` / `highlight.js` | **shiki（已落地，失败回退纯文本）** | 输出内联样式的 hast，直接替换 `pre > code` 节点；语言未知或加载失败时保留原代码块，宁可没配色也不丢内容 |
| 图片素材 | 永久素材 / 图文内图片 | **永久素材（已落地）** | 避免历史文章图片失效；按 `local_hash` 复用，只处理 jpg/png 且 ≤10MB，外链图片不上传（平台会屏蔽，故只给 warning） |
| 封面图 | 用户指定 / 自动生成 | **两者皆可** | 默认取首图，用户可改 |
| AI 配图/标题 | CodeBuddy 通道 / 外部图床 | **CodeBuddy 生成标题建议，封面可选本地生成** | 复用项目 AI 通道，避免额外图床依赖 |
| 敏感词 | 本地词库 / 平台接口 | **本地词库（可更新）+ 可选平台校验** | 发布前零成本预检，降低违规风险 |
| 定时群发 | 本地调度 / 云函数 | **本地调度（唤醒后提交）** | 插件进程内足够；认证主体下才提交 |
| 凭证存储 | `SecretStorage` | **SecretStorage** | 与 `common.md` 一致 |
| 重试 | 指数退避 + 抖动 | **指数退避 + 抖动** | 避免固定间隔洪峰；Token 失效单独处理（刷新后重试一次） |
| 超时 | 分级超时 | **连接 10s / 总体 60s（含素材上传）** | 素材上传较慢，单独放宽但必须有上限 |
| 幂等 | 内容 hash | **本地记录去重** | 平台无幂等键，草稿重复会污染素材库 |

> **弃用规避**：不使用已废弃的「客服消息」接口做群发；不使用 `request` 等废弃 HTTP 库；素材上传不使用已下线的旧域名。

---

## 6. 数据模型

独立库 `globalStorage/wechat.db`（见 10.1 决策 D3）：账号、批次、文章三张表由本模块自建，不复用微博的 `social_accounts`；素材、模板、定时、菜单、自动回复、粉丝标签与统计缓存沿用下表。

```sql
-- 账号：名称与头像由用户填写（微信无公开接口可拉取），AppSecret 不入库，只存 SecretStorage 键
CREATE TABLE IF NOT EXISTS wechat_accounts (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    avatar          TEXT,
    app_id          TEXT NOT NULL UNIQUE,
    account_type    TEXT NOT NULL,            -- subscription|service
    verified        INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,            -- connected|unauthenticated|error|limited
    last_error_code INTEGER,
    status_hint     TEXT,                     -- 与错误码配套的可执行提示，重启后仍可展示
    fan_count       INTEGER NOT NULL DEFAULT 0,
    issue_count     INTEGER NOT NULL DEFAULT 0,
    last_publish_at TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- 素材映射（本地文件 → 平台永久素材）：local_hash 为图片字节的 sha256 前 16 位
CREATE TABLE IF NOT EXISTS wechat_materials (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    local_hash  TEXT NOT NULL,
    media_id    TEXT NOT NULL,        -- 平台素材 ID
    url         TEXT NOT NULL,        -- 平台可访问 URL，直接写进正文 img 的 src
    type        TEXT NOT NULL,        -- image|voice|video|thumb
    name        TEXT,                 -- 原文件名，便于排查
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(account_id, local_hash, type)
);

CREATE INDEX IF NOT EXISTS idx_material_hash ON wechat_materials(account_id, local_hash);

-- 推送批次：一次群发即一个批次（1~8 篇）
CREATE TABLE IF NOT EXISTS wechat_issues (
    id             TEXT PRIMARY KEY,
    account_id     TEXT NOT NULL,
    title          TEXT NOT NULL,
    cover_url      TEXT,
    cover_media_id TEXT,
    article_count  INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL,            -- draft|ready|scheduled|pushing|published|failed
    media_id       TEXT,                     -- draft 返回，draft/update 复用
    publish_id     TEXT,                     -- freepublish 返回
    msg_data_id    TEXT,                     -- 群发消息标识：留言接口按它 + 文章序号定位
    article_url    TEXT,
    error_code     INTEGER,
    error_hint     TEXT,
    scheduled_at   TEXT,
    published_at   TEXT,
    updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issue_account ON wechat_issues(account_id, updated_at DESC);

-- 批次内文章条目：只存 Markdown 源文，内联样式 HTML 在推送前统一渲染（模板变更无需重新导入）
CREATE TABLE IF NOT EXISTS wechat_articles (
    id             TEXT PRIMARY KEY,
    issue_id       TEXT NOT NULL,
    sort_index     INTEGER NOT NULL,
    title          TEXT NOT NULL,
    author         TEXT,
    digest         TEXT,
    body           TEXT NOT NULL,            -- Markdown 源文
    body_hash      TEXT NOT NULL,            -- 幂等与「源文件已变更」判定
    word_count     INTEGER NOT NULL DEFAULT 0,
    cover_path     TEXT,                     -- 指定封面（存储根相对或绝对路径），推送时上传为封面素材
    cover_media_id TEXT,
    source_kind    TEXT NOT NULL,            -- note|press|manual
    source_path    TEXT,
    is_original    INTEGER NOT NULL DEFAULT 0,
    allow_comment  INTEGER NOT NULL DEFAULT 0,
    read_num       INTEGER NOT NULL DEFAULT 0,
    like_num       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_article_issue ON wechat_articles(issue_id, sort_index);

-- 排版模板
CREATE TABLE IF NOT EXISTS wechat_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    css         TEXT NOT NULL,              -- 内联主题 CSS
    created_at  TEXT NOT NULL
);

-- 定时群发任务（与 wechat_issues.scheduled_at 分工：issues 记计划时间，本表记待执行任务与重试状态）
CREATE TABLE IF NOT EXISTS wechat_schedule (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    issue_id    TEXT NOT NULL,
    cron_at     TEXT NOT NULL,              -- 计划提交时间
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL
);

-- 菜单配置缓存（与平台 menu/get 同步）
CREATE TABLE IF NOT EXISTS wechat_menus (
    account_id  TEXT PRIMARY KEY,
    menu_json   TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 自动回复规则（接口不可得时作为本地源，导出 JSON 供后台导入）
CREATE TABLE IF NOT EXISTS wechat_auto_replies (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    type        TEXT NOT NULL,             -- subscribe|keyword|default
    keyword     TEXT,
    content     TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 粉丝标签映射（user/tag/* 同步）
CREATE TABLE IF NOT EXISTS wechat_fan_tags (
    account_id  TEXT NOT NULL,
    openid      TEXT NOT NULL,
    tag_ids     TEXT NOT NULL DEFAULT '[]',
    remark      TEXT,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (account_id, openid)
);

-- 数据概览缓存（datacube/*，定时刷新）
CREATE TABLE IF NOT EXISTS wechat_stats_cache (
    account_id  TEXT NOT NULL,
    metric      TEXT NOT NULL,             -- user_summary|article_summary|menu_summary
    payload     TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (account_id, metric)
);
```

**素材复用**：`local_hash` 相同则直接复用已有 `media_id`，避免重复上传消耗配额。

**表关系**：`wechat_accounts` 1—N `wechat_issues`，`wechat_issues` 1—N `wechat_articles`，`wechat_materials` 以 `local_hash` 关联本地图片。原 v2.0 的 `wechat_drafts` 与 `wechat_published` 已合并进 `wechat_issues`（平台侧 draft 与 freepublish 是同一份内容的不同状态，分表会让元数据各写一份），`articles` 的 JSON 字段拆为 `wechat_articles` 行，以支持逐篇校验与统计回填。

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `zhai.wechat.setup` | 配置公众号 | 填写 AppID/AppSecret |
| `zhai.wechat.write` | 新建/打开图文 | 从源文档创建或打开草稿编辑 |
| `zhai.wechat.publish` | 发布到公众号 | 转换 → 预览 → 建草稿/发布 |
| `zhai.wechat.preview` | 预览排版效果 | Webview 模拟移动端宽度 |
| `zhai.wechat.schedule` | 定时群发 | 排队到点自动提交 |
| `zhai.wechat.drafts` | 草稿管理 | 列表/更新/删除 |
| `zhai.wechat.materials` | 素材管理 | 上传/分组/搜索/复用 |
| `zhai.wechat.published` | 已发布管理 | 列表/删除/查看数据 |
| `zhai.wechat.menu` | 菜单管理 | 配置自定义菜单 |
| `zhai.wechat.autoReply` | 自动回复 | 关注/关键词规则 |
| `zhai.wechat.fans` | 粉丝管理 | 标签/备注/黑名单 |
| `zhai.wechat.stats` | 数据概览 | 用户/图文/菜单统计 |
| `zhai.wechat.history` | 发布历史 | 草稿/发布记录与链接 |
| `zhai.wechat.template` | 排版模板 | 保存/套用排版 |
| `zhai.wechat.retry` | 重试失败任务 | 对失败记录重试 |

> 命令保留为快速入口；`drafts` 与 `published` 按 v2.1 的批次模型呈现，分别打开「草稿态批次」与「已推送批次」的筛选视图（见第 12 节）。

**涉及的平台接口**：

| 接口 | 用途 | 权限要求 |
|------|------|----------|
| `/cgi-bin/token` | 获取 AccessToken | AppID + AppSecret + IP 白名单 |
| `/cgi-bin/material/add_material` | 上传永久素材 | 认证与否均可（有配额） |
| `/cgi-bin/draft/add` `draft/update` `draft/batchget` `draft/delete` | 草稿箱 | 一般可用 |
| `/cgi-bin/freepublish/submit` | 发布（新版接口） | **需认证主体** |
| `/cgi-bin/freepublish/get` | 查询发布状态与永久链接 | **需认证主体** |
| `/cgi-bin/message/mass/sendall` | 群发 | **需认证主体** |
| `/cgi-bin/menu/create` `menu/get` `menu/delete` | 自定义菜单 | 一般可用 |
| `/cgi-bin/user/get` `user/info/updateremark` `tags/members/batchtagging` | 粉丝与标签 | 一般可用 |
| `/cgi-bin/datacube/getusersummary` `getarticletotal` `getmenudata` | 数据概览 | **需认证主体** |

**Webview 方法**：`wechat/preview`、`wechat/publish`（流式进度）、`wechat/drafts`、`wechat/materials`、`wechat/published`、`wechat/menu`、`wechat/autoReply`、`wechat/fans`、`wechat/stats`、`wechat/template`、`wechat/retry`

```typescript
/** 发布请求 */
interface WechatPublishRequest {
    method: 'wechat/publish'
    payload: {
        accountId: string
        filePath: string
        theme: string
        title: string
        digest?: string
        thumbMediaId?: string
        sourceUrl?: string
        needOpenComment?: 0 | 1
        onlyFansCanComment?: 0 | 1
        articles?: Array<{ title: string; digest: string; thumbMediaId: string }>  // 多图文
        scheduleAt?: string              // 定时群发时间（ISO），可选
        contentHash: string               // 幂等键
    }
}

/** 发布结果 */
interface WechatPublishResult {
    recordId: string
    mediaId?: string
    publishId?: string
    status: 'draft' | 'scheduled' | 'published' | 'failed'
    error?: { code: number; message: string; hint?: string }
}
```

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | Token 并发 | 10 个并发请求只触发 1 次 Token 刷新 |
| AC-2 | Token 过期 | 提前 5 分钟刷新，无「已过期」报错 |
| AC-3 | IP 白名单错误 | 明确提示当前出口 IP 与配置指引，不抛原始错误 |
| AC-4 | 排版正确 | 预览与公众号实际效果一致（标题/引用/代码块/列表） |
| AC-5 | 内联样式 | 输出 HTML 中无 `<style>` 标签与 class 依赖 |
| AC-6 | 素材复用 | 同一图片二次发布不重复上传（命中 `local_hash`） |
| AC-7 | 图片上传 | 单张 < 10MB 正常；超限明确提示 |
| AC-8 | 幂等 | 同一内容重复发布产生提示，不产生重复草稿 |
| AC-9 | 重试 | 网络类失败指数退避重试；Token 失效自动刷新后重试 1 次 |
| AC-10 | 超时 | 素材上传总体 60s 超时后中断并保留已完成部分状态 |
| AC-11 | 凭证安全 | AppSecret 仅存 SecretStorage，日志与诊断包脱敏 |
| AC-12 | 失败不丢数据 | 失败后草稿内容可再次编辑与重发 |
| AC-13 | 多图文 | 一次群发 ≥ 2 篇，各自封面/摘要正确组装 |
| AC-14 | 定时群发 | 到点自动提交且只提交 1 次（幂等） |
| AC-15 | 素材管理 | 分组/搜索命中；复用不重复上传 |
| AC-16 | 菜单配置 | `menu/create` 后 `menu/get` 返回一致 |
| AC-17 | 粉丝标签 | 打标签/备注后 `user/get` 返回一致 |
| AC-18 | 敏感词预检 | 命中违规词阻断发布并提示位置 |
| AC-19 | 数据概览 | 认证主体下 `datacube/*` 返回并渲染概览卡片 |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **IP 白名单（最高风险）** | Token 获取直接失败 | 明确错误指引；支持用户配置固定出口（如服务器代理）后使用；提供「仅生成 HTML 手动粘贴」降级路径 |
| **群发/发布需认证主体** | 无法一键群发 | 默认只做草稿箱，群发引导到公众号后台；有权限时提供一键发布 |
| **菜单/粉丝/数据接口权限** | 管理功能受限 | 接口可得范围内落地；自动回复无公开写接口时改为本地规则 + 导出 JSON 供后台导入 |
| 素材配额有限 | 上传失败 | 本地 hash 复用 + 上传前体积/格式校验 + 配额用量提示 |
| 排版主题维护成本 | 视觉不一致 | 主题以 CSS 文件维护，支持用户自定义覆盖 |
| 平台 HTML 标签过滤 | 样式丢失 | 只用白名单标签（section/p/strong/em/blockquote/pre/code/img） |
| 接口变更 | 功能失效 | 接口调用集中在单一 service 层，便于适配 |
| 原创声明/留言等规则变动 | 发布失败 | 参数可选化，失败时透传平台原因 |
| 定时群发漏发 | 排期未执行 | 唤醒后校验 `cron_at`；失败重试 + 状态持久化 |

**开放问题（需确认）**

1. 目标公众号的主体类型与可用接口范围（是否已认证）？
2. 是否需要支持「仅生成 HTML → 手动粘贴到编辑器」的无接口降级模式？
3. 是否需要视频/音频素材支持？
4. 是否需要支持多公众号与内容分发的差异化排版？
5. 自动回复规则是否接受「本地配置 + 导出 JSON 导入后台」的降级方案（无公开写接口）？
6. 数据概览需要哪些指标维度（用户增长 / 图文统计 / 菜单分析）？

---

## 10. 界面架构与落地决策

> **实现进度（2026-10-31）**：M1 账号底座、M2 批次/文章编辑、M3a 渲染管线、M3b 草稿提交、M3c 群发与
> M4 基础改造已落地——`src/modules/wechat`（库与仓储、凭证、Token 并发管理、账号服务、批次服务、
> 素材服务、草稿与群发服务、协议路由、`render.ts` 渲染管线与 `theme.ts` 默认主题）、
> `src/dashboard/wechat`（账号列表页、批次列表页、账号与批次弹窗、文章编辑弹窗、导入与删除确认、群发二次确认）、
> `src/workflow/wechat`（公众号工作流页与 push / material / menu / fans / stats / comment 六个分区）。
> 推送阶段经 state 通道的 `wechat` 频道实时下发，进行中任务由 `publishService` 在进程内登记、可由 `wechat/tasks` 查询；
> 宿主中途退出留下的 `pushing` 批次在下次激活时按 10 分钟阈值回收为失败并提示到后台确认。
> 定时群发按产品决定不做。

### 10.1 三个关键决策

| 编号 | 决策 | 理由与改动点 |
|------|------|--------------|
| D1 | 公众号列表、批次（文章）列表改为**仪表盘页内路由**，不再经 `workflow/open` 进入 | 两个页面是「选账号 → 编文章」的编辑态，属于仪表盘职责；改动点为 `src/dashboard/core/routing.ts` 增两条路径、`dashboard.tsx` 的公众号入口由 `openWorkflow('wechat')` 改为 `onNavigate`，并同步修正 `dashboard.md` 第 14 节的旧口径 |
| D2 | 运营六项（自定义菜单、素材管理、数据统计、留言管理、用户管理、推送管理）落**工作流面板的 wechat 专属分区** | 与 press 的「设定/角色/大纲/取名」同构：仪表盘负责编内容与发起推送，工作流负责运营与队列，两侧不重复实现 |
| D3 | 账号与批次数据落**独立 `globalStorage/wechat.db`**，不共用 `social.db` | 微博模块至今没有任何落库实现，「共用 social.db」是没有验证过代码支撑的假设；账号模型也不同（微博是 OAuth 令牌，公众号是 AppID/AppSecret + IP 白名单）。独立库与 `press.db` 同一模式，便于单独备份与迁移 |

### 10.2 信息架构与职责边界

```
仪表盘（zhai.dashboard webview）
  #/                     概览首页
  #/press                写作管理
  #/wechat               公众号列表（账号维度）
  #/wechat/{accountId}   推送批次/文章列表（账号内的推送维度）

工作流（zhai.aiChat webview，scope = wechat）
  常驻：chat / media / proofread / snapshot / usage
  专属：menu（自定义菜单） material（素材管理） stats（数据统计）
        comment（留言管理） fans（用户管理） push（推送管理）
```

| 能力 | 归属 | 边界说明 |
|------|------|----------|
| 账号增删改、切换、密钥 | 仪表盘 | 密钥弹窗是唯一写 `SecretStorage` 的入口 |
| 批次与文章编辑、从笔记/作品导入、发起推送 | 仪表盘 | 「推送」按钮只做一次提交，不承载队列 |
| 推送队列、定时、历史、失败重试、频率额度 | 工作流 `push` | 写入点唯一收敛在 `pushService`，仪表盘只读批次状态 |
| 菜单、素材、统计、留言、粉丝 | 工作流 | 与批次解耦，可独立使用 |

### 10.3 页内路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `#/wechat` | `DashboardWechat` | 账号列表，未登记路径仍回落 `#/` |
| `#/wechat/{accountId}` | `DashboardWechatPost` | 该账号的批次列表，账号不存在时提示并回列表 |

- 路由仍由 `core/routing.ts` 的纯函数承担，`dashboardScreen.tsx` 是唯一切换点，页面只接收导航回调。
- `accountId` 为本地生成的短 id（`^[a-z0-9-]{1,64}$`），解析时按白名单收窄，不合法即回落首页，避免 hash 承载任意字符串。
- `readContentScope` 已扩展：`context.selectedModule === 'wechat'` 也判为 wechat 归属（公众号管理不再是「打开 `wechat/` 目录文档」的场景），否则工作流侧栏不会出现专属分区；作用域目录同时回落到模块键，避免公众号对话与 root 共用一份会话。
- `SCOPE_SECTIONS.wechat` 已由空数组扩为六项，`pressSections.ts` 的分区白名单同步扩充，避免「类型里有、校验里缺」导致宿主视图请求被静默丢弃。
- 页内路由本身不会设置 `selectedModule`：`#/wechat` 与 `#/wechat/{accountId}` 挂载时会调用 `workflow/selectModule`（只设模块、不聚焦面板）补齐该状态，否则侧栏六分区在正常操作下不可达。

### 10.4 协议拆分

第 7 节的方法名为通道语义，落地时按承载面板拆分如下（`DashboardViewProvider` / `AiChatViewProvider` 各自路由）：

| 侧 | 方法 |
|----|------|
| 仪表盘 | `wechat/accounts`、`wechat/account/{create,update,remove,test,select}`、`wechat/issues`、`wechat/issues/{merge,removeBatch}`、`wechat/issue/{create,detail,remove,publishDraft,publish}`、`wechat/publishQuota`、`wechat/article/{create,update,remove,import}`、`wechat/cover/{pick,preview}`、`wechat/tasks`（进行中任务查询）；另复用 `host/openExternal`（标识 `wechatMp`）与 `workflow/selectModule`（只设模块不聚焦）（均已落地） |
| 工作流 | `wechat/menu/{get,save}`、`wechat/material/{list,import}`、`wechat/fans/{list,tags}`、`wechat/stats/overview`、`wechat/comment/{list,reply,mark,remove}`，运营页复用仪表盘的 `wechat/issues` 与 `wechat/publishQuota`（两个面板共用同一份路由实例） |
| 广播（state 通道） | `wechat` 通道承载 `WechatPublishProgress`：阶段取 `render` / `material` / `draft` / `submit` / `poll`，附一句面向用户的 `message`；Token 失效广播（`account-status`）尚未实现 |

代码落点：类型 `src/shared/types/wechat.ts`（含 `is*Request` 收窄，对齐 `press.ts`）；宿主服务 `src/modules/wechat/`（`accountService`、`tokenService`、`client`、`issueService`、`materialService`、`menuService`、`statsService`、`commentService`、`fanService`、`pushService`、`repository`）；前端 `src/dashboard/wechat/`、`src/workflow/wechat/`。

---

## 11. 仪表盘 · 公众号列表页

### 11.1 布局

沿用 `components/AppPage` 三段式，与写作管理页同形：

| 区域 | 内容 |
|------|------|
| `AppHeader align="start"` | `DashboardBackAction kind="home"` + `AppTitle`「公众号列表」+ `AppDescription`「N 个账号」 |
| `AppContent isScrollable` | 账号 `Item` 列表（`ui/item`，形态对齐 `PressProjectItem`） |
| `AppFooter` | 单个 `+` 图标按钮（添加账号） |
| 骨架外 | 添加账号弹窗、删除账号确认弹窗（挂在 `AppPage` 之外，与写作管理一致） |

### 11.2 列表项字段

| 位置 | 字段 | 来源 |
|------|------|------|
| `ItemMedia` | 头像，缺省用账号名首字占位 | `wechat_accounts.avatar`（用户填写，微信无公开接口拉取头像） |
| `ItemTitle` | 账号名（内层 `span` + `truncate` 出省略号，`ItemTitle` 自身只裁切） | `name` |
| `ItemTitle` 后缀 | 类型徽标「订阅号/服务号」，认证账号追加次级徽标「认证」 | `account_type`、`verified` |
| `ItemDescription` | `{批次数} 篇 · {粉丝数} 粉丝 · {最后推送相对时间}` | 本地聚合 |
| `ItemActions` | 当前账号显示 `Badge`「当前」+ `ChevronRight` | `selectedAccountId`（`globalState` 持久化） |
| 异常态 | 副行替换为错误摘要：`Token 失效：IP 不在白名单` / `密钥无效` / `未配置密钥` | `status` + `last_error_code` |

### 11.3 状态展示

`status` 四态：`connected`（正常）、`unauthenticated`（无有效密钥）、`error`（40164 / 40001 等接口错误）、`limited`（配额或频率受限）。列表项左侧 6px 色点表示，颜色取主题令牌，不写死色值；点击异常项在跳转前先用 toast 提示可执行的修复路径。

### 11.4 操作入口

| 入口 | 触发 | 行为 |
|------|------|------|
| 点击行 | 整行可点 | 写入 `selectedAccountId` 并跳 `#/wechat/{accountId}` |
| 右键 / 行内 `...` | `DropdownMenu` | 账号设置、密钥设置、刷新统计、删除账号 |
| 底部 `+` | `AppFooter` | 添加账号弹窗：名称、类型、AppID、AppSecret、头像；提交即调 `wechat/account/test` 验证 Token |
| 空态 | 无账号 | `ui/empty` + 引导文案：先在公众号后台配置 IP 白名单，再填 AppID 与 AppSecret；附「未认证账号只能创建草稿」的说明 |

### 11.5 多账号管理与切换

| 维度 | 设计 |
|------|------|
| 凭证隔离 | 每账号一键 `zhai.wechat.appSecret.{accountId}`，仅存 `SecretStorage`；库内只存 `app_id` 与密钥尾号掩码，编辑时留空表示不修改 |
| Token 隔离 | Token 缓存与 singleflight 均按 `accountId` 分桶，账号之间互不影响 |
| 切换主路径 | 返回列表点另一账号（与「作品列表 → 作品详情」一致） |
| 切换辅路径 | 批次列表页点击页头账号名弹出账号下拉，选中即改 hash 与 `selectedAccountId`，不重建面板 |
| 并发推送 | 任务键为 `(accountId, issueId)`，切换账号不中断后台任务 |
| 工作流作用域 | 六分区按「当前账号」取数；无当前账号时显示空态并给出回仪表盘选择的入口 |

---

## 12. 仪表盘 · 推送批次（文章）列表页

### 12.1 布局

| 区域 | 内容 |
|------|------|
| `AppHeader align="start"` | 返回列表动作 + `AppTitle`（账号名，点击弹账号切换）+ `AppDescription`（账号状态摘要） |
| `AppMenu` | 状态筛选 + 排序两个下拉 |
| `AppContent isScrollable` | 批次卡片列表，**分批渲染已落地**：默认渲染 20 个，底部「加载更多」按 20 递增；切换筛选/排序不重置上限（沿用只会多渲染几个卡片，重置换来的是额外一轮渲染） |
| `AppFooter` | 左：账号级 `...` 菜单（账号设置 / 密钥设置 / 删除账号）；右：`+` 新建批次 |
| 多选态 | 页脚替换为选择条（删除 / 并入指定批次），复用笔记列表的多选范式 |

### 12.2 批次卡片结构

```
┌ Item variant="outline" ────────────────────┐
│  封面 16:9（取首篇文章封面，缺省灰底占位图标）      │
│  批次标题（取首篇标题，单行截断）      [状态徽标]     │
│  ── 文章行 ──                                │
│  1  标题 ……                        缩略图      │
│  2  标题 ……                        缩略图      │
│  ── 底行 ──                                  │
│  推送时间 / 定时时间                       ⋯    │
└────────────────────────────────────────────┘
```

左侧 3px 色带映射状态；文章行点击打开源文档并跳到工作流预览，不在此页编辑正文。

### 12.3 展示字段

| 层级 | 字段 | 说明 |
|------|------|------|
| 批次 | 封面、标题、文章数、状态、推送/定时时间、失败摘要 | 失败时底行显示 `errcode` + 一句指引 |
| 文章 | 序号、标题、缩略图 | 标题超 64 字在编辑时就已阻断，不在此处再截断提示 |

两级菜单严格按原型拆分：

| 层级 | 菜单项 | 说明 |
|------|--------|------|
| 批次 | 添加文章 / 从笔记导入 / 从作品导入 / 推送 / 删除 | 「添加文章」为手写条目；两个导入经 `showOpenDialog` 选源文件后走 `markdown-one` 渲染 |
| 账号（页脚） | 账号设置 / 密钥设置 / 删除账号 | 与列表页右键菜单同源，复用同一组 action |

### 12.4 筛选与排序

| 控件 | 选项 |
|------|------|
| 状态 | 全部 / 草稿 / 已推送 / 推送失败（定时与推送中并入「全部」，量少不单独成档） |
| 排序 | 最近更新（默认）/ 推送时间（未推送的排末尾） |

不做关键词搜索：侧栏默认宽度约 300px，搜索框与筛选行抢位，收益低于成本；列表超长时靠滚动加载与状态筛选收敛。

### 12.5 批量操作

| 操作 | 允许范围 |
|------|----------|
| 批量删除 | **已落地**：批次卡片左侧复选框（仅 `draft` / `failed` 可选），页脚切换为选择条；宿主整体校验，命中不可删批次时整批拒绝并列出标题 |
| 并入批次 | **已落地**：选择条「合并到…」把所选草稿批次的文章并入目标草稿批次，源批次随后删除；只允许草稿状态，合并后超过 8 篇时禁用提交并说明；顺序号接在目标批次末尾 |
| 批量推送 | **不提供**：订阅号一天 1 次、服务号一月 4 次，多批次同时提交必然撞频率限制，按钮置灰并说明原因 |

### 12.6 与推送流程的联动

> **实现状态**：批次卡片与文章增删改、从笔记/作品导入、生成草稿已落地；批次菜单的「生成草稿」会
> 渲染正文、补传本地图片素材并提交草稿箱，成功后状态推进为「草稿已就绪」，已有 `media_id` 时改为更新草稿；
> 外链图片不上传，只以 warning 提示。群发（`freepublish`）仍待 M3c 接入。
> 导入由宿主弹出文件选择器并回查索引库（前端不传路径），正文以 Markdown 源文入库。
> 封面在文章弹窗内指定（只接受 jpg/png，路径由宿主签发），未指定时取正文第一张本地图片；
> 草稿生成后，批次菜单提供「打开公众号后台」，地址由宿主固定解析，前端只传标识。
> 群发已接入：确认弹窗展示账号、文章清单与额度说明，提交 `freepublish/submit` 后轮询 `freepublish/get`，
> 本地按「订阅号自然日 1 次 / 服务号自然月 4 次」先拦一层，未认证主体（48001）以可执行提示降级为「去后台群发」；
> 轮询未出结果时批次停在「推送中」，不臆断成功或失败。

```
批次「推送」
  │
  ▼ 前置校验（见下表）
  ├─ 不通过 → 定位到具体条目并阻断，批次状态不变
  └─ 通过
       │
       ▼ 图片补传（local_hash 命中则复用 media_id）
       ▼ draft/add 或 draft/update（幂等键 accountId + html_hash 集合）
       ├─ 未认证主体 → 状态=ready，提示「草稿已就绪，去公众平台群发」+ 复制后台链接
       └─ 已认证 → freepublish/submit
                    ├─ 成功 → 轮询 freepublish/get → published，回填 article_url
                    └─ 失败 → failed（保留 errcode 与指引，可原批次重试）
定时：scheduled_at 落库 → 本地调度 → 到点校验（是否已推过 / 账号是否仍有效）→ 提交
```

状态机：

```
draft ──校验通过──> ready ──提交──> pushing ──成功──> published
  ▲                    │                │
  └──── 失败可重试 ─────┴──失败──> failed
ready ──设置时间──> scheduled ──到点──> pushing
```

推送按钮的直接依据（校验清单）：

| 校验 | 规则 | 失败表现 |
|------|------|----------|
| 批次非空 | 1~8 篇 | 阻断 |
| 标题 / 作者 / 摘要 | 64 / 8 / 120 字 | 行内红字并定位条目 |
| 封面 | 每篇必有 `cover_media_id` | 提示选封面 |
| 图片 | 单张 ≤10MB，仅 jpg/png | 列出超限文件 |
| 频率 | 订阅号 1 天 1 次；服务号 1 月 4 次；`freepublish` 同受一天一次约束 | 显示下次可推时间 |
| Token | 有效；40164 直接给出当前出口 IP 与白名单入口 | 阻断并给指引 |
| 主体权限 | `freepublish` 需认证主体 | 降级为「草稿已就绪」 |
| 敏感词 | 本地词库命中 | 标红位置，允许确认放行并记日志 |

---

## 13. 工作流侧边导航

### 13.1 分区表

| 分区 id | 中文名 | 分组 |
|---------|--------|------|
| `menu` | 自定义菜单 | wechat 专属 |
| `material` | 素材管理 | wechat 专属 |
| `stats` | 数据统计 | wechat 专属 |
| `comment` | 留言管理 | wechat 专属 |
| `fans` | 用户管理 | wechat 专属 |
| `push` | 推送管理 | wechat 专属 |

常驻分区（`chat` / `media` / `proofread` / `snapshot` / `usage`）不受归属影响，继续保留。

### 13.2 六分区职责与页面结构

> **实现状态**：六个分区均已落地，见 `src/workflow/wechat/` 下同名目录。
> `comment` 依赖群发回执里的 `msg_data_id`（已随群发一起落库），旧批次没有该标识时会提示「请用当前版本重新群发一次」；
> 定位口径是「群发消息 + 文章序号」，界面用 1 基序号、宿主转成平台的 0 基 index。
> `stats` 与 `comment` 都依赖认证主体与平台开关：未认证或未开通留言时，分区展示平台返回的权限提示而不是空数据。

统一骨架：`AppPage` + `AppHeader`（标题 + 分区内主操作）+ `AppMenu`（分段栏或筛选）+ `AppContent isScrollable` + `AppFooter`（写操作）。

| 分区 | 职责 | 页面结构 | 权限 |
|------|------|----------|------|
| 自定义菜单 | `menu/get` 拉取、可视化编辑、`menu/create` 覆盖、`menu/delete` | 上部手机壳预览（3 个一级栏位）；下部选中节点的类型表单（发送消息 / 跳转网页 / 跳转小程序 / 素材引用）；页脚「发布到公众号」。限制：一级 ≤3、二级 ≤5、名称 4~8 汉字 | 一般可用 |
| 素材管理 | 永久素材的列表、上传、删除、复用，与本地媒体库（`src/modules/media`）互通 | `AppMenu` 分段栏（图片 / 语音 / 视频）+ 搜索 + 网格（缩略图、名称、大小）+ 页脚上传；行内显示引用次数 | 一般可用，有配额 |
| 数据统计 | 用户增长、图文数据、菜单点击、消息分析，只读 | 日期范围（7 / 15 / 30 天）+ 指标卡 + CSS 柱状趋势（不引图表库）；结果落 `wechat_stats_cache` | 需认证 |
| 留言管理 | 按文章筛选留言、加精、回复、删除 | 顶部文章选择器 + 留言列表（头像、昵称、时间、内容、精选标）+ 行内回复 | 需认证且已开通留言 |
| 用户管理 | 粉丝列表、标签 CRUD、备注、拉黑 | 分段栏（粉丝 / 标签）+ 分页列表；操作走 `tags/members/batchtagging`、`user/info/updateremark`；`user/get` 单次上限 10000 | 一般可用 |
| 推送管理 | 队列、历史、额度，是推送状态的唯一真相；只读，发起动作仍在仪表盘批次页 | 分段栏（待推送 / 历史 / 额度）+ 行内状态徽标与失败原因 + 顶部「进行中任务」条（挂载时查 `wechat/tasks`，并订阅阶段广播）+ 页脚刷新；定时群发按产品决定不做 | 按主体分级 |

### 13.3 导航栏容量改造（必须做）

现状：`WorkflowNav` 为固定 48px 宽纵向图标列，项高 48px（`size-10 m-1`），无滚动容器。加入六项后共 12 项 + 2 条分隔，≈576px，侧栏高度不足时末尾项会被压掉。

| 改造点 | 做法 |
|--------|------|
| 中段可滚动 | 已落地：专属分区与 media/proofread 一起放进 `flex-1 min-h-0 overflow-y-auto overscroll-contain` 的中段，footer 仍贴栏底；`min-h-0` 缺一不可，否则 flex 子项不收缩、滚动条不出现 |
| tooltip 不被裁剪 | `TooltipContent` 经 Portal 渲染到 `body`，滚动容器只裁内容不裁气泡；验收时逐项 hover 确认 |
| 图标与文案 | 在 `SECTION_META` 补六项：`menu`=Menu、`material`=FolderOpen、`stats`=BarChart3、`comment`=MessageSquare、`fans`=UserRound（避免与 press 的「角色」重复用 Users）、`push`=Send |
| 页面容器 | 新增 `src/workflow/wechat/WorkflowWechat.tsx`（对齐 `WorkflowPress`），内部按 `section` 分发六个页面；`WorkflowScreen` 在 `scope === 'wechat'` 时渲染它 |
| 分区回落 | 账号切换导致当前分区不可用（如无账号时的 `push`）时，渲染期回落到 `chat`，不改写 state，与现有 press 逻辑一致 |

### 13.4 入口回流

- 仪表盘 → 工作流：批次「查看数据」或「推送管理」触发 `openWorkflow('wechat')` + 一次性视图请求 `{ view: 'push' | 'stats', seq }`，机制沿用 `WorkflowViewRequest`，仅需接入 wechat 分支。
- 工作流 → 仪表盘：`push` 分区的队列项提供「打开批次」，经宿主命令切换侧栏视图并落到 `#/wechat/{accountId}`；不自动切换，避免打断当前编辑。

---

## 14. 实施里程碑与验收

| 阶段 | 内容 | 预估 |
|------|------|------|
| M0 | 权限验证：目标账号主体类型、IP 白名单、各接口可用性，结论回填第 9 节 | 0.5 天 |
| M1 | 账号底座：`wechat.db`、凭证、Token singleflight、账号 CRUD、`#/wechat` 列表页与路由改造 | 2 天 |
| M2 | 批次与文章：渲染管线接入、素材复用、批次 CRUD、`#/wechat/{accountId}` 页面、筛选与多选 | 3 天 |
| M3 | 推送链路：校验清单、draft 落库、freepublish、状态机、定时、重试、进度广播 | 3 天 |
| M4 | 工作流六分区：`WorkflowWechat`、导航扩容与滚动、六个分区页逐个落地 | 5 天 |
| M5 | 打磨：多账号切换、空态与错误指引、批量操作拦截、验收 | 1.5 天 |

界面相关验收（续第 8 节编号）：

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-20 | 账号隔离 | 两个账号的 Token 缓存与请求互不串用 |
| AC-21 | 切换收敛 | 切换账号后工作流六分区数据随之切换，无残留旧账号数据 |
| AC-22 | 素材复用 | 同一图片二次推送不重复上传（命中 `local_hash`） |
| AC-23 | 未认证降级 | 未认证主体推送落到「草稿已就绪」并可复制后台链接，不报错 |
| AC-24 | 频率拦截 | 一天内二次推送被拦截并显示下次可推时间 |
| AC-25 | 导航可达 | 12 项导航在 400px 高面板下全部可达（可滚动且 tooltip 不被裁剪） |
| AC-26 | 幂等 | 草稿重试命中 `html_hash` 走 `draft/update`，不产生重复批次 |
| AC-27 | 空态引导 | 删除账号后工作流六分区回到空态并提供回仪表盘入口 |
