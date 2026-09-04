# 微博浏览器 (Weibo Browser) — 模块设计文档

**版本**：2.0
**日期**：2026-09-04
**状态**：待验证（接口能力以微博开放平台官方文档 2025-05-09 版为准，见第 5 节能力对照）
**宿主**：VSCode 插件 Zhai（宅桌面）
**前身**：v1.0「同步微博」——仅承担「写作 → 分发」的发布单向链路

> ⚠️ **架构前置说明（以官方能力为准）**：本模块**授权、浏览、评论、表情以微博开放平台官方 API（`open.weibo.com`，OAuth2）为主干**，合规可控；**媒体详情与直链取用微博官网网页 ajax 接口**（`weibo.com/ajax/statuses/show` 等，与官网同源、已验证可用，非 `open.weibo.com` REST，亦非逆向私有协议），用于解析图片/视频地址并下载。
> 经核对官方文档（2025-05-09），官方 API 已直接覆盖**首页时间线浏览、评论读写、官方表情包**等核心能力；但**点赞、转发写入、普通图文发布（仅 `statuses/share` 链接分享）、分组、图片/视频上传**等接口官方未开放（或个人权限不可得）。
> 因此本文档对官方可覆盖的能力直接落地实现；对官方缺口采取**降级/受限标注**策略（见第 5 节能力对照），媒体下载走官网 ajax 接口（见第 10 节），**不引入逆向私有协议**，确保合规可控。

---

## 1. 模块概述

### 1.1 定位

把 VSCode 侧边栏变成一个**轻量微博浏览与发布台**：基于官方 API 在 VSCode 内浏览首页时间线、评论互动、渲染官方表情包，并能把工作区笔记经 AI 编辑后发布为微博；同时支持图片/视频按统一规则命名下载归档。

与「微信公众号」的差异：微博强调**短内容 + 互动 + 富媒体**，本模块聚焦**浏览与评论闭环 + AI 辅助发布**（见 `wechat.md`）。

### 1.2 目标

- **浏览**：在 VSCode 内查看首页时间线（`home_timeline`），瀑布流（masonry）流式布局呈现
- **评论互动**：读取并查看评论、发表评论与回复（官方 `comments/*` 完整覆盖）
- **表情渲染**：通过官方 `emotions` 接口获取并正确渲染微博表情包
- **AI 辅助发布**：笔记/章节一键转为微博，发布前可由 AI 润色编辑；受官方发布能力限制，默认走 `statuses/share` 链接分享，具备高级权限时升级为图文发布
- **媒体归档**：图片与视频支持下载并按统一命名规范落盘（直链来自官方读取接口返回，非私有上传/下载端点）
- **可靠**：所有写操作具备重试、幂等、限流与超时控制

### 1.3 受限目标（官方 API 当前不可得，明确降级）

- **点赞**：官方 Open API 无 like/favorite 接口 → 本模块**不提供点赞操作**，仅展示点赞数
- **转发**：官方 Open API 无 repost 写入接口（仅有 `repost_timeline` 读转发列表）→ 本模块**不提供转发操作**
- **分组内容**：官方 Open API 无分组接口 → 改为**本地分组**（基于已缓存时间线做标签/收藏归类，见第 4.2 节）
- **图文/视频发布**：官方仅 `statuses/share`（链接分享，且需第三方分享权限）→ 普通图文发布需高级权限，未获前降级为分享链接或本地草稿

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 刷首页 | 打开微博浏览器面板 → 加载首页时间线 → 瀑布流滚动浏览 |
| US-2 | 本地分组 | 把感兴趣微博打标签归入本地分组（如「素材」「灵感」）→ 按分组筛选查看 |
| US-3 | 表情渲染 | 含官方表情的微博 → 通过 `emotions` 映射正确显示为表情图片 |
| US-4 | 看评论/评论 | 展开某条微博评论 → 发表评论或回复 |
| US-5 | AI 辅助发博 | 写完笔记 → 命令「发布到微博」→ AI 润色编辑 → 预览 → 经 `share` 发布链接 |
| US-6 | 下载图片 | 看到九宫格 → 一键下载全部 → 按统一命名落盘 |
| US-7 | 下载视频 | 含视频的微博 → 下载原视频 → 按统一命名落盘 |
| US-8 | 重复发布防护 | 误点两次发布 → 第二次被本地记录拦截 |
| US-9 | 保存为笔记 | 看到有价值的微博 → 命令「保存为笔记」→ 转 Markdown（作者/正文/配图/原文链接）→ 写入笔记模块 → 可一键打开 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 官方 API | 优先级 | 状态 |
|------|--------|------|----------|--------|------|
| B0 | OAuth2 授权 | 标准 OAuth2 登录，Token 存 `SecretStorage`，支持多账号切换与过期刷新 | `oauth2/*` | P0 | 待验证 |
| B1 | 首页时间线 | `home_timeline` 拉取并渲染，分页与加载更多 | `statuses/home_timeline` | P0 | 待实现 |
| B2 | 本地分组 | 基于缓存时间线做标签/收藏归类与筛选（官方无分组接口，降级为本地） | 本地 | P1 | 待实现 |
| B3 | 瀑布流布局 | 卡片式 masonry 流式布局，自适应列数，媒体懒加载 | 前端 | P0 | 待实现 |
| B4 | ⚠️ 点赞 | **官方无接口，不实现**；仅展示点赞数 | — | — | 受限 |
| B5 | ⚠️ 转发 | **官方无写入接口，不实现**；仅可看转发列表 | `statuses/repost_timeline`(读) | — | 受限 |
| B6 | 评论 | 评论列表读取、发表评论、回复评论 | `comments/*` | P0 | 待实现 |
| B7 | 表情包渲染 | 官方 `emotions` 获取表情映射，渲染 `:[name]:` | `emotions` | P1 | 待实现 |
| B8 | AI 编辑发布 | 发布前 AI 润色，diff 对比采纳 | 本地 + `statuses/share` | P0 | 待实现 |
| B9 | 内容转换 | Markdown → 纯文本：`#话题#`、`@` 提及保留、链接转「网页链接」 | 本地 | P0 | 待实现 |
| B10 | 字数/分享限制 | `share` 仅分享链接；超限提示手动分段 | 本地 | P1 | 待实现 |
| B11 | ⚠️ 图片上传 | **官方无 upload 接口**；图文发布需高级权限 | — | — | 受限 |
| B12 | 发布预览 | 预览最终文本与表情，确认后发布 | 本地 | P0 | 待实现 |
| B13 | 发布与回执 | `share` 发布成功写入回执；高级权限下支持图文 | `statuses/share` | P0 | 待实现 |
| B14 | 图片下载 | 由 `show`/`home_timeline` 返回直链下载，统一命名 | 直链(CDN) | P1 | 待实现 |
| B15 | 视频下载 | 由接口返回视频直链下载，统一命名 | 直链(CDN) | P1 | 待实现 |
| B16 | 草稿箱 | 未发布内容存为草稿，可反复编辑 | 本地 | P1 | 待实现 |
| B17 | 发布历史 | 查看历史发布记录与状态 | 本地 | P1 | 待实现 |
| B18 | 失败重试 | 指数退避 + 抖动，上限 3 次 | 本地 | P1 | 待实现 |
| B19 | 幂等保护 | 内容 hash + 账号去重，防重复发博/评论 | 本地 | P0 | 待实现 |
| B20 | 配额与限流 | 令牌桶限流（读/写/下载分桶），遵守 `account/rate_limit_status` | 本地 | P1 | 待实现 |
| B21 | 多账号 | 多账号切换，浏览/发布时选择目标账号 | `oauth2` | P2 | 待实现 |
| B22 | 保存为笔记 | 微博内容按笔记模块「网页剪藏」统一 Markdown 模板转为笔记并保存，可双链/检索/版本管理 | 本地 + 笔记模块 | P1 | 待实现 |

---

## 4. 交互与流程

### 4.1 授权流程（标准 OAuth2）

```
命令：Zhai: 微博授权
   │
   ▼ 引导用户在设置填写 AppKey / AppSecret（存 SecretStorage）
   │
   ▼ 打开 OAuth2 授权页（oauth2/authorize，回调地址需在开放平台配置）
   │
   ▼ 用户确认 → 回调带 code → oauth2/access_token 换取 token（含有效期）
   │
   ▼ 存入 SecretStorage（key: zhai.weibo.<uid>.token）
   │
   ▼ 过期前自动刷新（提前 10 分钟）或提示重新授权；oauth2/revokeoauth2 支持登出撤销
```

### 4.2 浏览流程（时间线 + 本地分组）

```
面板加载
   │
   ▼ 读取本地缓存索引（globalStorage/social.db 的 weibo_cache）
   ├─ 未过期 → 秒开渲染
   └─ 过期/首次 → 调 statuses/home_timeline（连接 10s / 总体 30s 超时）
   │
   ▼ 瀑布流渲染（masonry，虚拟滚动 + 媒体懒加载）
   │
   ▼ 滚到底 → 分页加载（since_id / max_id 游标）
   │
   ▼ 本地分组：用户对卡片打标签/收藏 → 写入 weibo_groups / weibo_cache.group_tags
   ▼ 切换本地分组 → 按标签从缓存筛选渲染（无需额外接口）
```

### 4.3 评论流程

```
用户展开评论 / 发表
   │
   ▼ 读：comments/show 拉取评论列表（分页）
   │
   ▼ 写：幂等校验 actionHash = sha256(账号 + mid + 'comment' + 文本)
   ├─ 已存在成功记录 → 拦截重复
   └─ 不存在 → comments/create（新评论）/ comments/reply（回复）
   │
   ▼ 成功 → 确认 UI + 写 interaction_records；失败 → 回滚 + 退避重试（≤3）
```

> 点赞/转发：官方无写入接口，本模块**不提供**对应操作，仅展示计数（`statuses/count` 可批量取数）。

### 4.4 发布流程（含 AI 编辑，受限）

```
当前文件 / 选中内容
   │
   ▼ 内容转换（markdown-one 管线）→ 纯文本 + 话题 + @提及
   │
   ▼ AI 编辑（可选）：润色/缩写/扩写 → 与原文 diff 对比 → 采纳/拒绝
   │
   ▼ 预览确认（可插入官方表情面板、可编辑）
   │
   ▼ 幂等校验：contentHash = sha256(账号 + 文本)
   │
   ▼ 调用发布接口
   ├─ 默认路径：statuses/share（链接分享，需第三方分享权限）
   │     └─ 成功 → 写 publish_records(status=success，回执)
   ├─ 高级权限路径（获 statuses/update 等）：图文/视频发布
   └─ 失败 → 退避重试 → 仍失败记录原因 + 保留草稿
```

### 4.5 媒体下载流程

> 媒体地址解析参考已验证可用的微博网页 ajax 接口（详见第 10 节）。浏览阶段已拿到微博 `id`，下载时先取详情 JSON 再解析媒体直链。

```
用户触发下载（单条 / 批量）
   │
   ▼ 取详情 JSON：GET https://weibo.com/ajax/statuses/show?id={postId}
   │   （携带 Referer: https://weibo.com；连接 10s / 总体 30s 超时）
   │   目标体 = data.retweeted_status || data
   │
   ▼ 解析媒体地址（关键字段，见第 10 节映射表）
   ├─ 混合媒体 mix_media_info.items[]：video → playback_list[0].play_info.url；image → ajax/common/download?pid={id}
   ├─ 单视频 page_info.media_info.playback_list[0].play_info.url
   └─ 图片 pic_ids[] → https://weibo.com/ajax/common/download?pid={pid}
   │
   ▼ 依据命名规范生成文件名（见第 10 节）
   │
   ▼ 令牌桶限流 + 并发下载（默认 ≤3 并发，重试 2 次，断点续传）
   │   请求须带 Referer: https://weibo.com，否则 CDN 返回 403
   │
   ▼ 落盘到配置下载目录，写 media_downloads 记录（按 postId+url 去重）
   │
   ▼ 完成提示（成功/失败/跳过重复）
```

### 4.6 保存为笔记（接入笔记模块）

> 复用笔记模块（`notes.md`）「网页剪藏」统一 Markdown 模板：Frontmatter 含 `title/created/tags/source`，正文含作者、正文、配图与原文链接。保存后它即为笔记模块的一条普通笔记，可被双链、全文检索、版本管理（与 N10 同构）。

```
用户触发「保存为笔记」（卡片菜单 / 命令）
   │
   ▼ 取当前微博详情（resolveTarget 取目标体，去 HTML 标签）
   │
   ▼ buildWeiboNoteMarkdown：组装 Frontmatter + 正文
   │   title:   "{作者} 的微博"
   │   created: 微博发布时间
   │   tags:    ["微博", "weibo"]
   │   source:  https://weibo.com/{uid}/{mblogid}
   │   正文：作者引用 + 原文链接 + 采集方式 + 正文 + 配图链接
   │
   ▼ 调用笔记模块 createFromContent（统一入口，见 notes.md 4.2）
   │   → 写入 notebook（默认 notes/ 或用户指定）
   │   → 触发 FileSystemWatcher 索引
   │
   ▼ 写 weibo_saved_notes(mid, note_path)（去重 + 标记「已保存」角标）
   ▼ 提示完成并可一键打开笔记
```

**说明**：若媒体已通过 B14/B15 下载到本地，正文配图链接替换为相对路径（`assets/...`），保证笔记可整体迁移（与 notes.md N9 一致）。

---

## 5. 官方 API 能力对照与缺口

基于微博开放平台官方文档（2025-05-09）整理。

| 能力 | 官方接口 | 可用性 | 本模块处理 |
|------|----------|--------|------------|
| OAuth2 授权 | `oauth2/authorize` `oauth2/access_token` `get_token_info` `revokeoauth2` | ✅ | 直接实现 |
| 获取 UID / 限流状态 | `account/get_uid` `account/rate_limit_status` | ✅ | 直接实现 |
| 用户信息 | `users/show` `users/domain_show` | ✅ | 直接实现 |
| 首页时间线 | `statuses/home_timeline` | ✅ | 直接实现（B1） |
| 用户/提及/单条微博 | `statuses/user_timeline` `mentions` `show` `count` | ✅ | 直接实现 |
| 转发列表（读） | `statuses/repost_timeline` | ✅ | 仅展示（B5 读） |
| 官方表情 | `emotions` | ✅ | 表情渲染（B7） |
| 评论读/写 | `comments/show` `mentions` `create` `reply` | ✅ | 直接实现（B6） |
| 链接分享发布 | `statuses/share` | ⚠️ 需第三方分享权限 | 默认发布路径（B13） |
| **点赞** | — | ❌ 无接口 | **不实现**，仅展示数（B4） |
| **转发写入** | — | ❌ 无接口 | **不实现**（B5 写） |
| **图文/视频发布** | `statuses/update`（未开放给普通应用） | ❌ 缺 | 高级权限后支持（B11/B13） |
| **分组** | — | ❌ 无接口 | 降级为本地分组（B2） |
| **图片/视频上传** | — | ❌ 无接口 | 图文发布依赖高级权限；**下载**经网页 ajax 接口 `ajax/statuses/show` 解析 JSON 取直链（B14/B15，见第 10 节） |

> **结论**：官方 Open API 足以支撑「浏览 + 评论 + 表情 + AI 分享发布」主线；媒体下载经官网 ajax 接口取直链（见第 10 节，已验证可用）；点赞、转发、图文发布、分组四项需降级或高级权限，已在第 3 节明确标注，**不引入逆向私有协议**。

---

## 6. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| **接口主干** | 官方 Open API / 私有 API | **官方 Open API（OAuth2）** | 合规、文档公开；缺口以降级处理，不碰私有 API |
| 认证 | OAuth2 | **OAuth2** | 官方标准，Token 存 SecretStorage |
| 会话存储 | `SecretStorage` | **SecretStorage** | 与 `common.md` 一致，系统级加密 |
| 瀑布流 | CSS columns / `react-masonry-css` / 自研虚拟瀑布流 | **虚拟瀑布流（自研轻量）** | 与虚拟滚动结合，千条不卡顿 |
| 媒体懒加载 | IntersectionObserver | **IntersectionObserver** | Webview 内可控、可取消 |
| 表情包 | 官方 `emotions` 接口 | **官方接口动态拉取 + 本地缓存** | 与平台表情同步，离线可用 |
| 长图渲染 | `satori` + `@resvg/resvg-js` | **satori + resvg** | 无浏览器依赖、体积小（仅分享预览/高级发布用） |
| 媒体下载 | 官方直链 `fetch`（stream） | **内置 `fetch`** | 直链来自官方读取接口；支持进度与断点续传 |
| 重试策略 | 指数退避 + 抖动 | **指数退避 + 抖动** | 避免重试洪峰 |
| 超时 | 分级超时 | **连接 10s、总体 30s** | 防请求挂起 |
| 幂等 | 本地记录 + hash | **本地记录去重** | 平台无幂等键，本地兜底 |
| 限流 | 令牌桶（分桶） | **本地令牌桶（读/写/下载分桶）** | 守配额，防风控与账单刷爆 |

> **弃用规避**：不使用微博旧版 `statuses/upload`（已下线）；不使用 `request` 等已废弃 HTTP 库（改用内置 `fetch`）。

---

## 7. 数据模型

存于 `globalStorage/social.db`（与 v1.0 同源，扩展以支撑浏览/评论/分组/媒体）。

```sql
-- 平台账号（微博/公众号共用，platform 区分）
CREATE TABLE IF NOT EXISTS social_accounts (
    id          TEXT PRIMARY KEY,
    platform    TEXT NOT NULL,          -- 'weibo' | 'wechat'
    account_id  TEXT NOT NULL,
    nickname    TEXT,
    token_key   TEXT NOT NULL,          -- SecretStorage 中的键名，不存明文
    expires_at  TEXT,
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(platform, account_id)
);

-- 微博缓存（仅索引与展示字段，不存正文全文到 Git）
CREATE TABLE IF NOT EXISTS weibo_cache (
    mid           TEXT PRIMARY KEY,
    uid           TEXT NOT NULL,
    author_id     TEXT NOT NULL,
    author_name   TEXT,
    text          TEXT,                 -- 展示文本（含表情占位）
    created_at    TEXT NOT NULL,
    source        TEXT,                 -- 'timeline' | 'user' | 'mention'
    pics          TEXT NOT NULL DEFAULT '[]',  -- 图片直链 JSON
    video         TEXT,                 -- 视频直链（多清晰度 JSON）
    like_count    INTEGER NOT NULL DEFAULT 0,
    repost_count  INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    group_tags    TEXT NOT NULL DEFAULT '[]',  -- 本地分组标签 JSON
    raw           TEXT,                 -- 原始 JSON（脱敏后）
    fetched_at    TEXT NOT NULL,
    expired_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_weibo_src ON weibo_cache(uid, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weibo_tag ON weibo_cache(uid, group_tags);

-- 本地分组
CREATE TABLE IF NOT EXISTS weibo_groups (
    id        TEXT PRIMARY KEY,
    uid       TEXT NOT NULL,
    name      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 评论缓存
CREATE TABLE IF NOT EXISTS weibo_comments (
    id        TEXT PRIMARY KEY,
    mid       TEXT NOT NULL,
    uid       TEXT NOT NULL,
    author    TEXT,
    text      TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comment_mid ON weibo_comments(mid);

-- 互动/写操作记录（评论、发布；点赞/转发不落此表）
CREATE TABLE IF NOT EXISTS interaction_records (
    id          TEXT PRIMARY KEY,
    uid         TEXT NOT NULL,
    mid         TEXT,
    action      TEXT NOT NULL,          -- 'comment' | 'publish'
    action_hash TEXT NOT NULL,
    status      TEXT NOT NULL,          -- pending|success|failed
    error       TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(uid, action_hash) WHERE status = 'success'
);

-- 发布记录（幂等与历史）
CREATE TABLE IF NOT EXISTS publish_records (
    id            TEXT PRIMARY KEY,
    platform      TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    content_text  TEXT,
    payload       TEXT NOT NULL DEFAULT '{}',
    method        TEXT NOT NULL DEFAULT 'share',  -- 'share' | 'update'
    status        TEXT NOT NULL,
    platform_url  TEXT,
    error         TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_idem
    ON publish_records(platform, account_id, content_hash) WHERE status = 'success';

-- 草稿
CREATE TABLE IF NOT EXISTS publish_drafts (
    id         TEXT PRIMARY KEY,
    platform   TEXT NOT NULL,
    file_path  TEXT NOT NULL,
    text       TEXT NOT NULL,
    images     TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);

-- 媒体下载记录（去重 + 命名溯源）
CREATE TABLE IF NOT EXISTS media_downloads (
    id          TEXT PRIMARY KEY,
    uid         TEXT NOT NULL,
    mid         TEXT NOT NULL,
    media_type  TEXT NOT NULL,          -- 'image' | 'video'
    url         TEXT NOT NULL,
    saved_path  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(uid, url)
);

-- 已保存为笔记的记录（去重 + UI「已保存」角标）
CREATE TABLE IF NOT EXISTS weibo_saved_notes (
    mid         TEXT NOT NULL,
    uid         TEXT NOT NULL,
    note_path   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (mid, note_path)
);

CREATE INDEX IF NOT EXISTS idx_saved_note_mid ON weibo_saved_notes(mid);
```

---

## 8. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `zhai.weibo.login` | 微博授权 | OAuth2 授权登录 |
| `zhai.weibo.logout` | 退出账号 | 撤销授权（revokeoauth2） |
| `zhai.weibo.openBrowser` | 打开微博浏览器 | 加载首页时间线 |
| `zhai.weibo.switchGroup` | 切换本地分组 | 按标签筛选缓存 |
| `zhai.weibo.comment` | 评论/回复 | comments/create、comments/reply |
| `zhai.weibo.publish` | 发布到微博 | AI 编辑 → 预览 → share 发布 |
| `zhai.weibo.downloadMedia` | 下载媒体 | 批量下载图片/视频并按规范命名 |
| `zhai.weibo.history` | 发布历史 | 查看记录与回执 |
| `zhai.weibo.retry` | 重试失败任务 | 对失败发布/评论重试 |
| `zhai.weibo.saveToNote` | 保存为笔记 | 将当前微博转为 Markdown 笔记存入笔记模块 |

**Webview 方法**：`weibo/login`、`weibo/timeline`、`weibo/comments`、`weibo/comment`、`weibo/publish`（流式进度）、`weibo/downloadMedia`、`weibo/stickers`、`weibo/groups`、`weibo/saveToNote`。

```typescript
/** 媒体下载请求 */
interface WeiboDownloadRequest {
    method: 'weibo/downloadMedia'
    payload: {
        accountId: string
        items: Array<{
            mid: string
            mediaType: 'image' | 'video'
            url: string
            quality?: string
        }>
        destDir?: string
    }
}

interface WeiboDownloadItemResult {
    url: string
    status: 'success' | 'failed' | 'skipped'
    savedPath?: string
    error?: { code: string; message: string }
}
```

---

## 9. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 授权持久化 | 授权后重启窗口仍有效；Token 无明文落盘；可撤销 |
| AC-2 | 时间线 | `home_timeline` 加载 < 2s（有缓存秒开）；分页正常 |
| AC-3 | 本地分组 | 标签/筛选正常，切换无串数据 |
| AC-4 | 瀑布流 | 千条卡片不卡顿；图片懒加载；列数自适应 |
| AC-5 | 表情渲染 | 官方 `emotions` 映射正确，无未映射文本残留 |
| AC-6 | 评论 | 列表加载、发表、回复正常；重复提交被幂等拦截 |
| AC-7 | AI 编辑 | 润色可 diff 对比采纳/拒绝；未采纳不污染原文 |
| AC-8 | 内容转换 | `#话题#` 与 `@` 保留；链接转「网页链接」 |
| AC-9 | 发布幂等 | 同一内容重复发布被拦截 |
| AC-10 | 重试/超时 | 1s/2s/4s（含抖动）≤3 次；连接 10s / 总体 30s 超时 |
| AC-11 | 图片下载 | 并发可控；统一命名；重复 URL 跳过 |
| AC-12 | 视频下载 | 按清晰度下载；统一命名；断点续传 |
| AC-13 | 失败不丢数据 | 任何失败保留草稿/记录，可编辑后重发 |
| AC-14 | 限流 | 遵守 `rate_limit_status`；令牌桶分桶限流 |
| AC-15 | 保存为笔记 | 微博正确转为带 Frontmatter 的 Markdown 笔记；重复保存被 `weibo_saved_notes` 去重；笔记可被检索/双链 |

---

## 10. 媒体下载命名规范与地址解析

### 10.1 地址解析（来自详情 JSON）

取详情：`GET https://weibo.com/ajax/statuses/show?id={postId}`（与官网同源的网页 ajax 接口，非 `open.weibo.com` REST）。

| JSON 字段（位于 `data.retweeted_status || data`） | 含义 | 下载地址构造 |
|------|------|------|
| `pic_ids[]` | 图片 pid 列表 | `https://weibo.com/ajax/common/download?pid={pid}` |
| `page_info.media_info.playback_list[0].play_info.url` | 单视频直链 | 直链直接使用 |
| `mix_media_info.items[]` | 混合媒体（图+视频） | `type==='video'` → `item.data.media_info.playback_list[0].play_info.url`；否则 → `ajax/common/download?pid={item.id}` |
| `mblogid` | 微博 id（用于命名） | — |
| `user.id` | 作者 uid（用于命名） | — |
| `created_at` | 发布时间（用于命名） | 格式化为 `YYYYMMDDHHmm` |

> 关键约束：所有媒体下载请求**必须携带 `Referer: https://weibo.com`**，否则 CDN 返回 403。

### 10.2 命名规范

统一命名保证可读、可排序、可溯源，且兼容 Windows 文件名规则（去除 `\ / : * ? " < > |` 等）。命名采用已验证可用的脚本格式（参考 Tampermonkey `weibo-image-downloader`）。

**下载根目录**：`配置下载目录 / <账号昵称或uid> /`
- 图片：`images/`
- 视频：`videos/`

**命名模板（规范格式）**：

| 媒体 | 模板 | 示例 |
|------|------|------|
| 图片 | `weibo-{uid}-{YYYYMMDDHHmm}-{postId}-{seq:02d}.{ext}` | `weibo-123456-202609041230-AbC123-01.jpg` |
| 视频 | `weibo-{uid}-{YYYYMMDDHHmm}-{postId}-{seq:02d}.mp4` | `weibo-123456-202609041230-AbC123-01.mp4` |

**字段来源**：
- `uid`：`user.id`
- `YYYYMMDDHHmm`：`created_at` 格式化为 12 位（年/月/日/时/分各补零）
- `postId`：`mblogid`
- `seq`：同条微博内媒体序号，从 `01` 起（保持九宫格/混合媒体顺序）

**可读性变体（可选）**：在 `postId` 后追加清洗后的作者昵称，便于人工浏览：
`weibo-{uid}-{YYYYMMDDHHmm}-{postId}-{author}-{seq:02d}.{ext}`（author 做非法字符清洗 + 截断 ≤16 字符，空则省略）。

**规则细节**：
- `ext`：图片从 `Content-Type`/直链推导（jpg/png/gif），视频为 `mp4`；未知回退 `bin`
- 冲突处理：同名已存在则追加 `_<n>`（`_1`/`_2`），不静默覆盖
- 去重：以 `postId`（历史记录）与 `url` 维度去重，已下载则跳过并提示；历史上限 50000 条

### 10.3 下载控制参数（对齐参考脚本）

| 参数 | 值 | 说明 |
|------|------|------|
| 最大并发 | 3 | 令牌桶限流，避免触发风控 |
| 重试次数 | 2 | 失败按 `1000ms × (n+1)` 退避 |
| 超时 | 30000ms | 单请求超时 |
| Referer | `https://weibo.com` | 必带，否则 403 |

### 10.4 地址解析实现（TypeScript 提取函数）

> 输入为 `ajax/statuses/show` 返回的解析后对象。建议先经 zod 或类型守卫收窄 `unknown` 为下方 `WeiboDetail`，避免 `any`。

```typescript
/** 单条可下载媒体 */
interface WeiboMediaItem {
    type: 'image' | 'video'
    /** 最终下载直链 */
    url: string
    /** 图片 pid（去重/溯源用），视频可空 */
    pid?: string
    /** 同条微博内序号，从 1 起，保持九宫格/混合媒体顺序 */
    seq: number
}

/** 详情 JSON 中媒体相关的窄化结构（其余字段按需扩展） */
interface WeiboDetail {
    mblogid: string
    created_at: string
    user: { id: string; screen_name?: string }
    pic_ids?: string[]
    page_info?: {
        media_info?: { playback_list?: Array<{ play_info: { url: string } }> }
    }
    mix_media_info?: {
        items?: Array<{
            type: string
            id?: string
            data?: { media_info?: { playback_list?: Array<{ play_info: { url: string } }> } }
        }>
    }
    retweeted_status?: WeiboDetail
}

const WEIBO_AJAX = 'https://weibo.com/ajax'
const WEIBO_REFERER = 'https://weibo.com'

/** 取目标体：转发优先取原微博 */
function resolveTarget(raw: WeiboDetail): WeiboDetail {
    return raw.retweeted_status ?? raw
}

/** 从详情提取全部媒体项（图片 + 视频，保持顺序） */
function extractMedia(detail: WeiboDetail): WeiboMediaItem[] {
    const target = resolveTarget(detail)
    const items: WeiboMediaItem[] = []
    let seq = 0

    // 1) 混合媒体（图 + 视频交错）
    const mix = target.mix_media_info?.items ?? []
    if (mix.length > 0) {
        for (const it of mix) {
            seq += 1
            if (it.type === 'video') {
                const url = it.data?.media_info?.playback_list?.[0]?.play_info?.url
                if (url) items.push({ type: 'video', url, seq })
                continue
            }
            if (it.id) {
                items.push({ type: 'image', url: `${WEIBO_AJAX}/common/download?pid=${it.id}`, pid: it.id, seq })
            }
        }
        return items
    }

    // 2) 单视频
    const videoUrl = target.page_info?.media_info?.playback_list?.[0]?.play_info?.url
    if (videoUrl) {
        seq += 1
        items.push({ type: 'video', url: videoUrl, seq })
    }

    // 3) 图片列表
    for (const pid of target.pic_ids ?? []) {
        seq += 1
        items.push({ type: 'image', url: `${WEIBO_AJAX}/common/download?pid=${pid}`, pid, seq })
    }

    return items
}

/** created_at → YYYYMMDDHHmm（12 位） */
function formatWeiboTimestamp(createdAt: string): string {
    const d = new Date(createdAt)
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 清洗作者昵称，兼容 Windows 文件名（去除 \ / : * ? " < > |，截断 ≤16） */
function sanitizeAuthor(name?: string): string {
    if (!name) return ''
    return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 16)
}

/** 生成统一文件名（规范格式；readable=true 追加作者） */
function generateMediaFilename(params: {
    uid: string
    timestamp: string
    postId: string
    seq: number
    ext: string
    author?: string
    readable?: boolean
}): string {
    const { uid, timestamp, postId, seq, ext, author, readable } = params
    const base = `weibo-${uid}-${timestamp}-${postId}`
    const core = readable && author ? `${base}-${sanitizeAuthor(author)}` : base
    return `${core}-${seq.toString().padStart(2, '0')}.${ext}`
}

/** 组装下载任务（含 Referer 头与超时） */
interface DownloadTask {
    url: string
    filename: string
    referer: string
    timeoutMs: number
}

async function buildDownloadTasks(detail: WeiboDetail, readable = false): Promise<DownloadTask[]> {
    const target = resolveTarget(detail)
    const timestamp = formatWeiboTimestamp(target.created_at)
    return extractMedia(detail).map((m) => ({
        url: m.url,
        filename: generateMediaFilename({
            uid: target.user.id,
            timestamp,
            postId: target.mblogid,
            seq: m.seq,
            ext: m.type === 'video' ? 'mp4' : 'jpg',
            author: target.user.screen_name,
            readable,
        }),
        referer: WEIBO_REFERER,
        timeoutMs: 30_000,
    }))
}
```

> 调用顺序：`fetch(ajax/statuses/show) → JSON.parse → zod 收窄为 WeiboDetail → buildDownloadTasks → 并发下载（≤3，带 Referer，重试 2 次）`。

---

## 11. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **功能缺口（最高）** | 点赞/转发/图文发布/分组/上传官方不可得 | 已明确降级/受限标注（第 3、5 节）；不引入私有 API，保持合规 |
| 分享权限未获批 | 默认发布路径不可用 | 先实现不依赖权限的浏览/评论/下载；share 权限获批后再接发布 |
| 接口变更 | 官方改版致功能失效 | 接口调用集中封装，单点适配 |
| Token 过期 | 浏览/发布中断 | 提前 10 分钟刷新；失败提示重新授权 |
| 限流/风控 | 请求被拦 | 令牌桶分桶限流 + 退避重试；下载限速 |
| 媒体版权 | 下载内容再分发侵权 | 仅个人归档；下载时提示用途边界 |
| 媒体接口依赖 | 下载依赖官网 ajax 接口 `ajax/statuses/show`，非开放平台契约 | 接口调用集中封装；兼容 `pic_ids`/`mix_media_info`/`page_info` 多形态；失败降级提示 |
| Referer 约束 | 缺少 `Referer: https://weibo.com` 时 CDN 返回 403 | 下载请求统一注入 Referer 头（第 10 节） |
| 直链稳定性 | 图片/视频直链失效 | 下载前以 `ajax/statuses/show` 重新取最新直链 |

**开放问题（需确认）**

1. 分享权限（`statuses/share` 第三方分享）是否已申请/可获批？决定默认发布路径是否可用。
2. 是否申请高级接口（图文/视频发布、上传）？决定 B11/B13 高级路径是否落地。
3. 媒体下载默认目录与是否默认开启（避免误触大量下载）？
4. AI 编辑所用模型（复用 DeepSeek Chat / R1）与默认开关？
5. 本地分组的标签体系是否需要与笔记标签打通？
6. 多账号浏览是否需要（影响缓存按 uid 隔离复杂度）？

---

## 12. 关键交互逻辑实现（TypeScript）

### 12.1 评论读取 / 发表

> 官方 Open API：`comments/show`（读）、`comments/create`（新评论）、`comments/reply`（回复）。OAuth2 token 存 SecretStorage。写操作需本地幂等去重（见第 4.3 节、数据模型 `interaction_records`）。

```typescript
const WEIBO_API_V2 = 'https://api.weibo.com/2'

/** 单条评论 */
interface WeiboComment {
    id: string
    authorId: string
    authorName: string
    text: string
    createdAt: string
}

/** 评论列表分页结果 */
interface CommentListResult {
    comments: WeiboComment[]
    hasMore: boolean
    nextCursor: string | null
}

/** 读取某条微博评论（官方 comments/show） */
async function fetchComments(params: {
    accessToken: string
    mid: string
    cursor?: string
    pageSize?: number
}): Promise<CommentListResult> {
    const qs = new URLSearchParams({
        access_token: params.accessToken,
        id: params.mid,
        count: String(params.pageSize ?? 20),
        ...(params.cursor ? { page: params.cursor } : {}),
    })
    const res = await fetch(`${WEIBO_API_V2}/comments/show.json?${qs}`, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`comments/show 失败: ${res.status}`)
    const data = (await res.json()) as { comments?: Array<Record<string, unknown>> }
    const comments = (data.comments ?? []).map(normalizeComment)
    return {
        comments,
        hasMore: comments.length >= (params.pageSize ?? 20),
        nextCursor: comments.length ? String(Number(params.cursor ?? '1') + 1) : null,
    }
}

/** 发表 / 回复评论（官方 comments/create、comments/reply） */
async function postComment(params: {
    accessToken: string
    mid: string
    content: string
    replyCommentId?: string
    existsHash: (hash: string) => boolean   // 幂等校验：sha256(账号+mid+动作+文本)
    saveHash: (hash: string) => void
}): Promise<{ ok: boolean; comment?: WeiboComment; error?: string }> {
    const hash = await sha256(`${params.accessToken}:${params.mid}:${params.replyCommentId ?? 'comment'}:${params.content}`)
    if (params.existsHash(hash)) {
        return { ok: false, error: '幂等拦截：该评论已提交' }
    }
    const endpoint = params.replyCommentId ? 'comments/reply' : 'comments/create'
    const body = new URLSearchParams({
        access_token: params.accessToken,
        id: params.mid,
        comment: params.content,
        ...(params.replyCommentId ? { cid: params.replyCommentId } : {}),
    })
    const res = await fetch(`${WEIBO_API_V2}/${endpoint}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
        return { ok: false, error: `发布失败: ${res.status}` }
    }
    params.saveHash(hash)
    const data = (await res.json()) as Record<string, unknown>
    return { ok: true, comment: normalizeComment(data) }
}

/** 归一化评论字段（防御性取值） */
function normalizeComment(raw: Record<string, unknown>): WeiboComment {
    const user = (raw.user ?? {}) as Record<string, unknown>
    return {
        id: String(raw.id ?? ''),
        authorId: String(user.id ?? ''),
        authorName: String(user.screen_name ?? ''),
        text: String(raw.text ?? ''),
        createdAt: String(raw.created_at ?? ''),
    }
}

async function sha256(input: string): Promise<string> {
    const data = new TextEncoder().encode(input)
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

### 12.2 AI 编辑与 diff 采纳

> 发布前由 AI 润色（复用 DeepSeek Chat / R1，见开放问题 4）；编辑结果与原文以统一 diff 呈现，用户逐段采纳/拒绝后再发布。

```typescript
/** AI 润色请求 */
interface AIEditRequest {
    text: string
    instruction: string          // 如「缩写到 140 字」「改写为轻松口语风」
    model: 'deepseek-chat' | 'deepseek-reasoner'
}

interface AIEditResult {
    original: string
    edited: string
}

/** 调用 LLM 完成润色（依赖项目 LLM 客户端，此处为抽象签名） */
async function requestAIEdit(req: AIEditRequest): Promise<AIEditResult> {
    const edited = await callLLM({
        model: req.model,
        system: '你是微博文案助手，仅返回改写后文本，不要解释',
        prompt: `${req.instruction}\n\n${req.text}`,
    })
    return { original: req.text, edited }
}

/** 统一 diff 片段 */
interface DiffHunk {
    type: 'context' | 'add' | 'remove'
    content: string
    lineNo?: number
}

/** 计算逐行统一 diff（行级比对，生产可换成熟 diff 库） */
function computeUnifiedDiff(original: string, edited: string): DiffHunk[] {
    const a = original.split('\n')
    const b = edited.split('\n')
    const hunks: DiffHunk[] = []
    const max = Math.max(a.length, b.length)
    for (let i = 0; i < max; i++) {
        const o = a[i]
        const e = b[i]
        if (o === e) hunks.push({ type: 'context', content: o, lineNo: i + 1 })
        else {
            if (o !== undefined) hunks.push({ type: 'remove', content: o })
            if (e !== undefined) hunks.push({ type: 'add', content: e })
        }
    }
    return hunks
}

/** 用户决策：采纳 edited / 拒绝保留 original */
type DiffDecision = 'accept' | 'reject'

function applyDiffDecision(result: AIEditResult, decision: DiffDecision): string {
    return decision === 'accept' ? result.edited : result.original
}

async function callLLM(_req: { model: string; system: string; prompt: string }): Promise<string> {
    // 接入项目 LLM 客户端（DeepSeek）
    return ''
}
```

> 调用顺序（发布）：`markdown→纯文本` → `requestAIEdit`（可选）→ `computeUnifiedDiff` 渲染对比 → 用户 `applyDiffDecision` → `postComment` / `share` 发布。

---

### 12.3 保存为笔记（Markdown 转换）

> 复用笔记模块「网页剪藏」模板（Frontmatter：`title/created/tags/source`）。本模块只产出 Markdown 内容，落盘由笔记模块 `createFromContent` 完成，保持解耦。

```typescript
import { extractMedia, resolveTarget } from './media'
import type { WeiboDetail } from './types'

/** 笔记落盘入口——由集成层传入笔记模块 API 实现 */
export interface NoteInserter {
    createFromContent(input: {
        markdown: string
        notebook?: string
        tags?: string[]
    }): Promise<{ path: string }>
}

/** 组装微博笔记的 Frontmatter + 正文（与 notes.md 剪藏模板一致） */
export function buildWeiboNoteMarkdown(
    detail: WeiboDetail,
    opts: { includeMedia?: boolean } = {},
): string {
    const target = resolveTarget(detail)
    const author = target.user?.screen_name ?? '未知作者'
    const uid = target.user?.id ?? 'unknown'
    const mid = target.mblogid ?? target.id ?? 'unknown'
    const permalink = `https://weibo.com/${uid}/${mid}`
    const createdAt = target.created_at ?? new Date().toISOString()
    const text = (target.text ?? '').replace(/<[^>]+>/g, '').trim()  // 去 HTML 标签
    const title = `${author} 的微博`
    const tags = ['微博', 'weibo']

    const frontmatter = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `created: ${createdAt}`,
        `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
        `source: ${permalink}`,
        '---',
        '',
    ].join('\n')

    const body: string[] = []
    body.push(`> 作者：${author}`)
    body.push(`> 原文：[微博链接](${permalink})`)
    body.push('> 采集方式：微博浏览器 · 保存为笔记')
    body.push('')
    body.push(text || '(无正文)')
    body.push('')

    if (opts.includeMedia !== false) {
        const media = extractMedia(detail)
        if (media.length) {
            body.push('### 媒体')
            for (const m of media) {
                if (m.type === 'image') body.push(`![${author} 的配图](${m.url})`)
                else body.push(`[▶ 视频](${m.url})`)
            }
            body.push('')
        }
    }
    return frontmatter + body.join('\n')
}

/** 保存微博为笔记：转 Markdown → 调笔记模块 → 返回笔记路径 */
export async function saveWeiboToNote(
    detail: WeiboDetail,
    notes: NoteInserter,
): Promise<{ path: string }> {
    const markdown = buildWeiboNoteMarkdown(detail)
    return notes.createFromContent({ markdown, tags: ['微博', 'weibo'] })
}
```

> 调用顺序（保存为笔记）：`resolveTarget` → `buildWeiboNoteMarkdown` → 笔记模块 `createFromContent` → 写 `weibo_saved_notes` → 打开笔记。

---

## 13. 与 v1.0 的差异摘要

- **范围扩大**：从「发布单向」扩展为「浏览（时间线）+ 评论 + AI 分享发布 + 媒体管理」
- **合规重构**：从 v1.0 假设的「官方 Open API 受限、私有 API 为主干」，校正为**全程基于官方 Open API（OAuth2）**，缺口明确降级，不引入私有 API
- **新增能力**：瀑布流布局、官方表情渲染、评论读写、媒体下载与命名规范、本地分组
- **能力边界明确**：点赞/转发/图文发布/分组/上传 官方当前不可得，已标注受限
- **数据模型扩展**：新增 `weibo_cache` / `weibo_groups` / `weibo_comments` / `media_downloads`
- **不变**：发布可靠性（幂等/重试/超时/限流）、SecretStorage 存储、Markdown 转换管线
- **新增能力**：保存为笔记（B22）——复用笔记模块「网页剪藏」统一 Markdown 模板，微博转笔记后可双链/检索/版本管理；数据模型新增 `weibo_saved_notes` 去重与「已保存」角标
