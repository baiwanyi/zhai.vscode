# 微信公众号 (WeChat Official Account) — 模块设计文档

**版本**：2.0
**日期**：2026-09-04
**状态**：草案（接口权限与主体类型待验证，结论回填至第 9 节）
**宿主**：VSCode 插件 Zhai（宅桌面）
**前身**：v1.0「同步微信公众号」——仅承担「排版 → 草稿箱」单向同步链路

> ⚠️ **前置说明**：公众号接口能力与**主体类型**强相关。未认证订阅号通常只能使用**草稿箱**接口，群发（发布）能力需认证。同时接口要求**调用方 IP 在白名单内**，家庭宽带动态 IP 会导致 Token 获取失败。**开发前必须完成权限与 IP 方案验证**，结论回填至第 9 节。

---

## 0. 模块目录与存储（设想②）

- **模块定位**：公众号是「分发与管理通道」，源内容来自 `notes/` / `press/` 等模块；本模块不额外建立本地正文目录，仅缓存发布配置、草稿元数据与排版主题。
- **索引库**：与微博模块共用 `globalStorage/social.db`（`platform = 'wechat'`），扩展 `wechat_*` 表（见第 6 节）。
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
| US-15 | AI 配图/标题 | 根据正文生成候选封面图与标题建议（可选，复用 DeepSeek） |

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
| G17 | AI 配图/标题 | 根据正文生成候选封面与标题（可选，复用 DeepSeek） | P2 | 待实现 |
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
| HTML 生成 | `markdown-one` 管线 | **复用 markdown-one** | 与导出/预览共用一套 AST，避免多套解析 |
| 样式内联 | `juice` / 手写替换 | **juice** | 公众号不支持 `<style>` 与外链 CSS，必须内联 |
| 代码高亮 | `shiki` / `highlight.js` | **shiki** | 输出内联样式的 HTML，正合适 |
| 图片素材 | 永久素材 / 图文内图片 | **永久素材** | 避免历史文章图片失效；注意每日配额 |
| 封面图 | 用户指定 / 自动生成 | **两者皆可** | 默认取首图，用户可改 |
| AI 配图/标题 | DeepSeek / 外部图床 | **DeepSeek 生成标题建议，封面可选本地生成** | 复用项目 LLM 客户端，避免额外图床依赖 |
| 敏感词 | 本地词库 / 平台接口 | **本地词库（可更新）+ 可选平台校验** | 发布前零成本预检，降低违规风险 |
| 定时群发 | 本地调度 / 云函数 | **本地调度（唤醒后提交）** | 插件进程内足够；认证主体下才提交 |
| 凭证存储 | `SecretStorage` | **SecretStorage** | 与 `common.md` 一致 |
| 重试 | 指数退避 + 抖动 | **指数退避 + 抖动** | 避免固定间隔洪峰；Token 失效单独处理（刷新后重试一次） |
| 超时 | 分级超时 | **连接 10s / 总体 60s（含素材上传）** | 素材上传较慢，单独放宽但必须有上限 |
| 幂等 | 内容 hash | **本地记录去重** | 平台无幂等键，草稿重复会污染素材库 |

> **弃用规避**：不使用已废弃的「客服消息」接口做群发；不使用 `request` 等废弃 HTTP 库；素材上传不使用已下线的旧域名。

---

## 6. 数据模型

与微博模块共用 `globalStorage/social.db`（`platform = 'wechat'`），另增素材与运营相关表。

```sql
-- 复用 social_accounts / publish_records / publish_drafts（见 weibo.md）

-- 素材映射（本地文件 → 平台永久素材）
CREATE TABLE IF NOT EXISTS wechat_materials (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL,
    local_hash   TEXT NOT NULL,        -- 本地图片内容 hash
    media_id     TEXT NOT NULL,        -- 平台素材 ID
    url          TEXT NOT NULL,        -- 平台可访问 URL
    type         TEXT NOT NULL,        -- image|voice|video|thumb
    group_name   TEXT,                 -- 素材分组
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    UNIQUE(account_id, local_hash, type)
);

CREATE INDEX IF NOT EXISTS idx_material_hash ON wechat_materials(local_hash);
CREATE INDEX IF NOT EXISTS idx_material_group ON wechat_materials(account_id, group_name);

-- 草稿记录（含多图文元数据）
CREATE TABLE IF NOT EXISTS wechat_drafts (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    media_id    TEXT NOT NULL,
    title       TEXT NOT NULL,
    theme       TEXT NOT NULL,
    digest      TEXT,
    thumb_media_id TEXT,
    articles    TEXT NOT NULL DEFAULT '[]',   -- 多图文 articles JSON
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_draft_file ON wechat_drafts(account_id, file_path);

-- 已发布图文记录
CREATE TABLE IF NOT EXISTS wechat_published (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    media_id    TEXT NOT NULL,
    publish_id  TEXT,                        -- freepublish 返回的 publish_id
    title       TEXT NOT NULL,
    status      TEXT NOT NULL,              -- published|deleted
    stats_url   TEXT,
    published_at TEXT NOT NULL
);

-- 排版模板
CREATE TABLE IF NOT EXISTS wechat_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    css         TEXT NOT NULL,              -- 内联主题 CSS
    created_at  TEXT NOT NULL
);

-- 定时群发任务
CREATE TABLE IF NOT EXISTS wechat_schedule (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    draft_id    TEXT NOT NULL,
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

**涉及的平台接口**：

| 接口 | 用途 | 权限要求 |
|------|------|----------|
| `/cgi-bin/token` | 获取 AccessToken | AppID + AppSecret + IP 白名单 |
| `/cgi-bin/material/add_material` | 上传永久素材 | 认证与否均可（有配额） |
| `/cgi-bin/draft/add` `draft/update` `draft/batchget` `draft/delete` | 草稿箱 | 一般可用 |
| `/cgi-bin/freepublish/submit` | 发布（新版接口） | **需认证主体** |
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
