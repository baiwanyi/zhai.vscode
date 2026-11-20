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
4. AI 编辑所用模型（复用 CodeBuddy 通道，模型 id 走 AI 面板模型菜单的选择）与默认开关？
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

> 发布前由 AI 润色（复用 CodeBuddy 通道，见开放问题 4）；编辑结果与原文以统一 diff 呈现，用户逐段采纳/拒绝后再发布。

```typescript
/** AI 润色请求 */
interface AIEditRequest {
    text: string
    instruction: string          // 如「缩写到 140 字」「改写为轻松口语风」
    model: string  // 由调用方按 CodeBuddy 通道配置传入
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
    // 接入项目 CodeBuddy 通道
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

---

## 14. 关注时间线（网页版 ajax 接口）

> 定位：`ajax/feed/unreadfriendstimeline` 是 **weibo.com 网页端同源内部 ajax 接口**，只读、Cookie 鉴权、无移动端 `x-xs-*` 签名参数，与本模块媒体下载所用的 `ajax/statuses/show` 属同一类依赖，不是开放平台 REST 契约，也不涉及逆向私有协议。开放平台的 `statuses/home_timeline` 仍为主干方案，本节接口用于在插件内直接浏览关注流。

### 14.1 请求构造

```
GET https://weibo.com/ajax/feed/unreadfriendstimeline
    ?list_id=10001{uid}
    &refresh=4
    &since_id=0            // 或 max_id={上一页顶层 max_id}
    &count=20
```

| 参数 | 取值 | 说明 |
|------|------|------|
| `list_id` | `10001{uid}` | 关注流列表 ID；实测省略也能取到同一列表，故仅在已知 uid 时携带 |
| `refresh` | 固定 `4` | 网页端刷新标志位；翻页请求同样带 4 |
| `since_id` | `0` 或上次结果最新 id | 增量游标；与 `max_id` 互斥，同时给出时上游忽略 `since_id` |
| `max_id` | 上一页响应顶层 `max_id` | 向后翻页游标，**不规律长整型**，不能自增构造 |
| `count` | 1–50 | 单页条数，上游在 50 条附近封顶 |

请求头（缺一不可）：

| 头 | 值 | 作用 |
|----|----|------|
| `Cookie` | 登录态整串（含 `SUB`） | 唯一鉴权依据 |
| `Referer` | `https://weibo.com/` | 缺失易被判为非浏览器来源 |
| `User-Agent` | 桌面 Chrome UA | 与官网请求上下文保持一致 |
| `Accept` | `application/json, text/plain, */*` | 期望 JSON |
| `X-Requested-With` | `XMLHttpRequest` | 声明为 ajax 请求 |

### 14.2 鉴权处理

- 凭证即浏览器登录态 Cookie，**至少包含 `SUB`**；`SUBP`、`XSRF-TOKEN` 等一并保留，宿主不做裁剪。
- 存储：`vscode.SecretStorage`（`zhai.weibo.webCookie` + 保存时刻键），明文不出宿主、不进日志、不回传前端；前端只看到「是否已配置 + 保存时间」。
- 失效判定：HTTP 401/403 → 登录态失效；302 到登录页被 fetch 跟随后会拿到 HTML（以 `<` 开头）→ 同样判失效；JSON `{ok:0,msg}` 中含「登录/账号」→ 失效。
- 频控判定：HTTP 418/429，或 `msg` 含「频繁/过快/太多」→ 限流；这两类错误**不重试**，重试只会加重风控。

### 14.3 分页与增量

```
首屏：refresh=4 & since_id=0
  └─ 解析 statuses[] 与顶层 max_id
      └─ 下一页：refresh=4 & max_id={上页 max_id}（不带 since_id）
          └─ statuses 为空 / max_id 缺失 / max_id 与本页相同 → 到底

增量：refresh=4 & since_id={上次结果最新一条 id}
  └─ 只请求一页：再往后翻就变成补历史，与「看新内容」语义相反
```

- 去重以数字 `id` 为准：翻页与增量都会出现重叠条目，合并时前插刷新、追加翻页，重复一律丢弃。
- 增量起点优先取本次结果首条的 `id`，缺省回退上游 `since_id`；`sinceId=0` 表示不启用增量。
- 单次调用最多翻 10 页（实现上限），避免一次点击打出长请求链。

### 14.4 字段映射

| 归一化字段 | 上游取值 | 处理 |
|------------|----------|------|
| `id` | `idstr` → `id` → `mid` | 字符串化，去重与游标的唯一依据 |
| `text` | `text_raw` → `text` | 剥标签、解实体、去零宽字符、保留换行（纯文本口径，不含表情图） |
| `segments` | `text`（含 `<img>` 表情标签） | 按「文本 + 表情」交错切段，表情保留图床直链与名称 |
| `createdAt` | `created_at` | `Wed Nov 19 10:00:00 +0800 2026` 按时区折算为 ISO；解析失败留空 |
| `source` | `source` | 剥 `<a>` 外壳，只留客户端名 |
| `author` | `user.id / screen_name / verified / avatar_large` | 认证标记取 `verified === true`，头像只保留图床地址 |
| `metrics` | `reposts_count / comments_count / attitudes_count` | 缺失按 0 |
| `media.images` | `pic_infos[*].largest → original → large.url`、`mix_media_info.items[*]`（图项直链或 pids）、`pic_ids` | 原图直链，逐项取首个可用；缺直链时用 pid 拼 `wx1.sinaimg.cn/large/{pid}.jpg` |
| `media.thumbnails` | `pic_infos[*].bmiddle.url`（新版为 `/wap360/`），缺失时把 `/large/` 等尺寸目录换成 `/bmiddle/` | 列表展示用的中等尺寸，与 images 同序 |
| `media.sizes` | `pic_infos[*].largest.width/height`，缺失回退 `original` / `large` | 最大尺寸，与 images 同序；预览角标与竖横判断只认它，与实际加载的档位无关 |
| `media.videoUrl` | `page_info.media_info.playback_list[0]` 或 `mix_media_info` 中的视频项 | 无视频为 `null`（当前只标记不播放） |
| `retweeted` | `retweeted_status` | 只保留作者名、正文摘要与原文地址，不递归展开 |
| 广告位 | `ad_state=1` / `is_ad` / `promotion` | 直接丢弃，不进入去重计数 |

**图片与表情渲染**：

- 图床按 `Referer: https://weibo.com/` 放行，Webview 直连（源为 `vscode-webview://`）一定被拒，因此图片**不走前端直连**，一律由宿主代理：`weibo/image` → 宿主带 Referer 取回 → 落本地缓存 → 读成 `data:` URI 回传 → 前端 `<img>` 直接渲染。
- 为什么回传 `data:` 而不是本地文件地址：Webview 加载本地文件要求 `localResourceRoots` 与 `cspSource` 双放行，缓存目录不在扩展目录下、远程开发（SSH/WSL）等场景极易 `ERR_ACCESS_DENIED`（见 Stack Overflow「ERR_ACCESS_DENIED vscode-webview」与 CSDN 上的同类案例）；`data:` 本来就在 CSP 白名单内，不依赖任何路径授权。单张超过 4MB 不内联，前端显示破图占位。
- 代理请求头按浏览器抓包口径补全（缺一项都可能 403）：

| 头 | 值 |
|----|----|
| `Referer` | `https://weibo.com/` |
| `User-Agent` | 桌面 Chrome UA（与时间线接口同一串） |
| `Accept` | `image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8` |
| `Accept-Language` | `zh-CN,zh;q=0.9,en;q=0.8` |
| `Sec-Fetch-Dest` | `image` |
| `Sec-Fetch-Mode` | `no-cors` |
| `Sec-Fetch-Site` | `cross-site` |
| `Priority` | `u=1, i` |

- 首次请求不带 Cookie；返回 401/403 时带当前登录 Cookie 重试一次，仍失败才放弃并写日志（只记 host 与路径前缀，不记查询串签名）。
- 网络失败的降级链：**代理（若配置）→ 内置 `fetch`（undici 连接池复用）→ 切 `ipv4first` 后再 `fetch` → 直连 `node:https`（keep-alive agent + `family: 4`，连接超时 6s，失败重试一次）**。逐级尝试，日志分别以 `proxy` / `fetch` / `fetch(ipv4)` / `direct` 标记并带 `cause` 错误码（如 `UND_ERR_CONNECT_TIMEOUT`、`ENOTFOUND`、`CERT_HAS_EXPIRED`）。
- 顺序依据实测：undici 的连接复用比每张图新建 TLS 更稳，直连只作最后兜底；直连 agent 在面板关闭时 `destroy()` 释放连接。
- 并发与体积：宿主侧同时下载数限制为 4（排队而非丢弃），避免一页几十张图同时建连接把本地 NAT 与图床限流一起打满；单张上限 24MB，超限自动把 `/large/` 换成 `/bmiddle/` 再取一次，仍超限才放弃。
- 前端懒加载：配图、头像与表情都用 `IntersectionObserver`（`rootMargin: 240px`）控制，滚到附近才发起 `weibo/image`，首屏不再一次性请求整页图片。
- 代理来源：VS Code 的 `http.proxy` 优先，其次进程环境变量 `HTTPS_PROXY` / `HTTP_PROXY`；只接受 `http:` / `https:`，走 `CONNECT` 隧道（支持 `Basic` 代理认证）。证书校验跟随 `http.proxyStrictSSL`，企业抓包代理可关闭。
- 关键说明：扩展宿主（Node）**不继承浏览器的系统代理**。浏览器能看图而宿主连接超时，通常是这个原因——在 VS Code 设置里填好 `http.proxy` 即可走代理通道。
- 内容类型缺失或为 `application/octet-stream` 时按文件头魔数识别（JPEG/PNG/GIF/WEBP/BMP），避免把正常图片误判成不支持；HTML 错误页与 SVG 一律拒绝。
- 图片地址统一走 `normalizeWeiboImageUrl` 归一化，白名单为 `*.sinaimg.cn`、`*.sinajs.cn`、`weibo.com`、`weibo.cn`（含子域）。只接受 https，非白名单地址在归一化阶段丢弃，代理层不会代任意地址取数。
- 协议相对写法（`//wx1.sinaimg.cn/...`）补全为 `https:`；`weibo.com/ajax/common/download?pid=xxx` 需要登录 Cookie，Webview 直连会 401，宿主改写为 `https://wx1.sinaimg.cn/large/{pid}.jpg`；`pic_infos` 缺失时直接用 `pic_ids` 按同一规则拼直链。
- CSP 维持默认（`img-src ${webview.cspSource} data:`），不放行任何远程域，`localResourceRoots` 只保留扩展产物目录。
- 代理只接受 `image/jpeg|png|gif|webp|bmp` 且单张 ≤12MB，SVG 等可携带脚本的类型直接拒绝；同一地址并发请求共享一次下载，缓存按 URL 哈希命名，命中零网络。
- 卡片按微博客户端习惯渲染：头像圆形（失败回落首字）、配图九宫格（1 张按 16:9，2 张两列，3 张以上三列，最多 9 张）、表情内联为 16px 小图；图片就绪前用同尺寸占位，避免列表抖动，失败显示破图占位。
- 列表**只用中等尺寸**（`media.thumbnails`，`/bmiddle/`），不加载原图；点击某张才在浮层里请求原图（`media.images`）。原图超过 4MB 内联上限或下载失败时，浮层自动回退到中图并提示「已显示中等尺寸」；Esc 或点击遮罩关闭。
- 浮层布局：关闭按钮固定在屏幕右上角、尺寸角标固定在左上角；角标显示 `最大 W × H`，尺寸取自上游 `largest` 档（`media.sizes`），**与实际加载的是原图还是中图无关**，只有上游缺该档时才回退到 `img.naturalWidth/Height` 并标注「实际/中图」。竖横判断同样用该尺寸：竖图 `max-h-full w-auto` 按高度铺满，横图 `max-w-full h-auto` 按宽度铺满，尺寸未知时 `object-contain` 兜底。

### 14.5 稳定性与使用限制

| 项 | 现状 | 影响 |
|----|------|------|
| 契约性质 | 网页端内部接口，无版本承诺 | 前端改版即可能改字段/参数，需按接口集中封装单点适配 |
| 单页上限 | 约 50 条 | 首页一次最多拿 50 条，更多需翻页 |
| 历史可达深度 | 约 20 页见底 | 更早内容取不到，不适合做全量归档（全量走开放平台或归档工具） |
| 游标 | `max_id` 不规律、不可构造 | 只能串行翻页，无法并行请求多页 |
| 广告混入 | `ad`/推广位存在 | 必须按标记过滤，否则污染增量游标 |
| Cookie 有效期 | 天级到周级，随登录环境变化 | 失效后需重新登录并覆盖保存 |
| 频率限制 | 短时高频触发 418 / 空列表 | 相邻请求至少间隔 1.2s，失败退避而非重试 |
| 境外/代理访问 | 可能直接跳登录或返回空 | 需要与登录时一致的网络出口 |
| 图片直链 | 图床按 Referer 放行，直连必被拒 | 宿主代理带 Referer 取回，失败自行隐藏；大图走原文 |
| 图片缓存 | 落 globalStorage 的 `weibo-media`，上限 800 个文件 | 超出按修改时间删旧；缓存损坏可整目录删除重建 |
| 表情直链 | 表情 CDN 偶发 403 | 降级为 `[表情名]` 文本或浏览器 alt 文案，不阻断正文 |

### 14.6 点赞（写操作）

网页版点赞走一对写接口，参数都只有微博数字 id：

| 动作 | 接口 | 请求体 |
|------|------|--------|
| 点赞 | `POST https://weibo.com/ajax/statuses/setLike` | `{"id":"<微博数字 id>"}` |
| 取消 | `POST https://weibo.com/ajax/statuses/cancelLike` | 同上 |

请求头在时间线基础上额外补：

| 头 | 值 | 说明 |
|----|----|------|
| `Origin` | `https://weibo.com` | 写接口会校验来源 |
| `Content-Type` | `application/json;charset=UTF-8` | 一方页面用 JSON 提交 |
| `X-XSRF-TOKEN` | 从 Cookie 的 `XSRF-TOKEN` 解码 | Cookie 里没有该键时不带 |

- 成功判定：响应 JSON 根层 `ok > 0`；HTTP 200 但 `ok = 0` 属业务失败。响应可能带 `data.attitudes_count`，有则回传最新点赞数。
- 初始点赞态：时间线每条微博的 `attitudes_status`（对象 `{liked:true}` 或数字 `1`），缺失按未赞处理。
- 前端交互：乐观更新点赞态与计数，失败回滚并提示；同一微博请求进行中直接丢弃后续点击（`ref` 判定），避免连点放大成多次写。
- 限制：写操作**不重试**（401/403/418 直接回错误），避免把账号打进风控；点赞结果不回写时间线数据源，刷新后以服务端为准。

### 14.7 评论读取

```
GET https://weibo.com/ajax/statuses/buildComments
    ?is_reload=1&id={微博数字 id}&is_show_bulletin=3&is_mix=0
    &count=10&uid={当前登录 uid}&fetch_level=0&locale=zh-CN
```

| 参数 | 取值 | 说明 |
|------|------|------|
| `id` | 微博数字 id | 必填 |
| `is_reload` | `1` | 只首页带；翻页时不带 |
| `is_show_bulletin` / `is_mix` / `fetch_level` | `3` / `0` / `0` | 网页端固定值 |
| `count` | 1–30 | 单页条数，实现默认 10 |
| `uid` | 当前登录用户 uid | 可选，缺省由服务端按 Cookie 识别 |
| `locale` | `zh-CN` | 文案语言 |
| `max_id` | 上一页响应顶层 `max_id` | 翻页游标，不能自造 |

- 响应结构：`{ ok, data: [...], total_number, max_id }`；`data` 每项含 `id/idstr`、`text`（HTML + 表情标签）、`created_at`、`user`、`like_counts`。
- 归一化：正文复用主贴的 `parsePostSegments`（文本 + 表情分段），纯文本口径把表情还原成 `[名称]`；时间走同一套 `parseWeiboCreatedAt`；头像过图床白名单。
- 前端：评论按钮点击才展开（未展开不请求），默认 10 条/页，「加载更多评论」按 `max_id` 串行翻页；失败内联提示并给重试，不弹 toast。

### 14.8 长文展开

```
GET https://weibo.com/ajax/statuses/longtext?id={mblogid}
```

- `id` 用 mblogid（如 `Rs4KtdzoV`），数字 id 也能取到；只接受字母数字，避免拼进查询串的任意内容。
- 响应 `{ ok, data: { longTextContent, longTextContent_raw, topic_struct, url_struct } }`；正文优先 `longTextContent`，为空回退 `longTextContent_raw`，两者皆空按失败处理，**不拿空串覆盖卡片摘要**。
- 时间线里长文摘要末尾带展开提示，形式可能是 `<a>展开</a>`、`<a>...展开</a>`、`<a>展开全文</a>`，也可能是纯文本 `……展开`。归一化阶段统一剥掉：先删带 `<a>` 外壳的链接，再删末尾残留的 `……`/`...` 截断省略号，卡片只保留一个「展开全文」按钮。
- 该清理**只对 `isLongText` 为真**的微博执行，普通正文里出现的「展开」与省略号保持原样。
- `isLongText` 判定：上游 `isLongText === true` 或存在 `longText` 对象。

### 14.9 常见反爬与合规边界

合规且有效的做法（本模块已实现）：

- 请求头保持真实浏览器上下文（`Referer` / `UA` / `X-Requested-With`），不做伪装客户端。
- 相邻请求最小间隔 1.2s，同一进程共享节奏，避免多面板并发打满。
- 只对网络错误与 5xx 做指数退避重试（≤2 次），401/403/418 一律不重试。
- 失败按分类码提示（未配置 / 登录失效 / 限流 / 上游异常 / 网络），引导用户自行处理，不静默重试。
- 只读单账号自身关注流，不做批量采集、不落公共库。

明确不采用：UA 轮换与代理池、验证码/滑块绕过、设备指纹伪造、Cookie 池共享、并发拆页抓取。这些手段既违反平台协议，也会直接触发账号风控，代价远高于收益。

### 14.10 实现位置

| 文件 | 职责 |
|------|------|
| `src/shared/types/weibo.ts` | 时间线、信息流、分组、凭证与协议载荷契约，含参数收窄 |
| `src/modules/weibo/webClient.ts` | 通用 JSON 请求：URL 构造、请求头、错误分类、节流与退避重试 |
| `src/modules/weibo/webTimeline.ts` | 分页/增量循环、去重、字段归一化、时间与正文清洗 |
| `src/modules/weibo/webFeed.ts` | 时间线 / 热门 / 分组端点适配、分组归一化与卡片流提取 |
| `src/modules/weibo/webEmoticons.ts` | 表情配置：`statuses/config` 取数与表情条目归一化 |
| `src/modules/weibo/webHotRank.ts` | 侧栏热搜榜：`bandUnified` 取数与 realtime 条目归一化 |
| `src/modules/weibo/webCredential.ts` | Cookie 清洗、SecretStorage 存取、凭证状态 |
| `src/modules/weibo/mediaProxy.ts` | 图片代理：带 Referer 取图、本地缓存、并发去重与容量清理 |
| `src/modules/weibo/webInteraction.ts` | 写操作：`setLike` / `cancelLike`，补 Origin 与 X-XSRF-TOKEN |
| `src/modules/weibo/webComments.ts` | 评论读取：`buildComments` 参数构造、分页游标与评论归一化 |
| `src/modules/weibo/webLongText.ts` | 长文读取：`longtext` 取全文、正文优先级与失败兜底 |
| `src/modules/weibo/weiboRoutes.ts` | `weibo/timeline`、`weibo/feed`、`weibo/groups`、`weibo/hotRank`、`weibo/emoticons`、`weibo/comments`、`weibo/longtext`、`weibo/credential/*`、`weibo/image`、`weibo/like`、`weibo/openPost` 分发 |
| `src/modules/weibo/panel.ts` | 面板消息通道、凭证注入、图片代理装配与本地资源白名单 |
| `src/modules/common/webviewHtml.ts` | CSP 生成：默认不放行远程图，需要时可按调用方传入的 `imgSources` 放行 |
| `src/weibo/` | Webview 入口：顶部固定菜单、右侧热搜榜、Cookie 配置区、信息流列表、卡片（头像 / 九宫格 / 表情）与发表框表情选择器 |

### 14.11 多入口信息流（首页 / 时间线 / 热门 / 分组）

面板顶部固定菜单只留「首页 / 时间线 / 热门 / 分组」四个信息流入口；顶栏动作区放「刷新」「个人主页」与「更多」下拉，「更多」里收回「设置」与「登录 Cookie」。菜单挂在 `AppHeader` 内，随标题区固定，不参与内容区滚动。

| 入口 | 接口 | 关键参数 |
|------|------|----------|
| 首页 | `ajax/feed/unreadfriendstimeline` | 见 14.1；增量刷新只取上次之后的新微博 |
| 时间线 | `ajax/feed/friendstimeline` | `list_id` 取默认分组「最新微博」的 gid，`fid` 同值，`refresh=4`，首屏 `since_id=0`，`count=25` |
| 热门 | `ajax/feed/hottimeline` | `group_id=102803`、`containerid=102803`、`extparam=discover|new_feed`、`refresh=0`，首屏 `count=10` |
| 分组列表 | `ajax/feed/allGroups` | 取 `groups[]` 中「默认分组」与「我的分组」两个分区 |
| 分组信息流 | `ajax/feed/groupstimeline` | `list_id={所选分组 gid}`、`refresh=4`、`fast_refresh=1`、`count=25` |

- 分组结构：`groups[0]` 为「默认分组」、`groups[1]` 为「我的分组」；宿主按标题精确匹配，标题缺失才回落下标，避免分区顺序微调后取错。
- 时间线的 `list_id` 由宿主在 `weibo/groups` 结果里算好（`timelineListId`，取「最新微博」条目），前端不自行挑条目；缺省时宿主还会再取一次 allGroups 兜底。
- 三种信息流共用同一条 `weibo/feed` 协议与同一套分页/增量状态机：`source` 只决定端点与固定参数，游标语义与 14.3 完全一致。
- 热门流的响应结构可能是 `data.cards[].mblog`（卡片流），时间线与分组通常是 `statuses[]`；宿主统一提取，`max_id` / `since_id` 为 `"0"` 时视为没有更多，避免「加载更多」被永久点亮。
- 个人主页按 `weibo/groups` 给出的账号 uid 拼 `https://weibo.com/u/{uid}`，经 `weibo/openPost` 的白名单校验后交给宿主打开；uid 缺失时只提示不跳转，不拼空地址。
- 设置页承载 Cookie 配置（保存 / 清除）与各入口取数口径说明；未配置时任何信息流都不发请求，只给「去设置」的引导。
- 「更多」下拉的两项：「设置」切到设置页并以勾选标记当前所在页；「登录 Cookie」由页面回首页并展开凭证卡（凭证卡只存在于首页按需区与设置页常驻区），因此菜单在所有视图都常驻，不随视图隐藏。

### 14.12 表情配置（发表框）

```
GET https://weibo.com/ajax/statuses/config
```

- 只读 `data.emoticon.ZH_CN.<分类>[{ phrase, url }]`：10 个分类、340 条，分类名直接写入 `category` 供前端分组。
- `data.emoticonRender`（phrase/别名 → 图片的渲染映射，7000+ 条，含多语言与拼音别名）不参与解析，避免别名造成大量重复项。
- 单条必须同时具备 `phrase` 与合法图地址（过 14.4 的图床白名单）；类内重复 `phrase` 以首见为准，跨类重复保留，保证每个分类的条目数与上游一致。
- 拿不到任何条目时，错误信息会带上实际返回的字段名，接口改版时据此定位。
- 发表框 Popover 顶部是分类切换条（横向滚动，默认选中第一个分类），下方按当前分类分页：首屏 40 个，滚动到底点「加载更多表情」再追加 40 个；切换分类会重置分页计数。
- 表情图仍经 `weibo/image` 代理换 data URI，本地缓存命中即零网络；点击表情插入到 textarea 光标处（无选区时追加到末尾），插入后恢复光标；超出 2000 字上限时拒绝并提示。
- 表情配置在前端模块级缓存（会话内只取一次）；未配置 Cookie 时按钮禁用，面板内提示先去设置。

### 14.13 侧栏热搜榜

```
GET https://weibo.com/ajax/side/bandUnified?type=mine&last_tab=mine&last_tab_time={秒级时间戳}
```

- `last_tab_time` 取当前秒级时间戳，与网页端一致；`type` 与 `last_tab` 固定 `mine`。
- 榜单条目在 `data.realtime`；也可能嵌在 `data.band_list[*].realtime` 里，此时取第一个含 realtime 的分区。
- 单条映射：标题取 `word_scheme`（与网页端一致，话题词自带 `#`）→ `note` → `word` → `title`；名次取 `realpos`（网页端真实排名），缺失时用 `rank + 1`（上游 `rank` 是 0 起序号），再缺失才回落到数组下标；`description` 与 `icon_desc`（缺失用 `label_name` 兜底）各自渲染为 badge；图标取 `icon_url` → `icon`，过图床白名单后直接显示；`icon_desc_color` 作为 `icon_desc` 徽标的底色，只接受 `#rgb` / `#rrggbb` / `rgb()`，其余丢弃。
- 广告位（`is_ad: 1` / `ad_state: 1`）、标注「商」或「上新」的推广位（`icon_desc` 或兜底的 `label_name` 含这两个关键字，这类位往往不带 `is_ad`）与缺标题的条目不进榜，且不影响其余条目的名次；榜 1–3 的序号用 `#f26d5f` 加粗，其余弱化。
- 侧栏在容器宽度 ≥ 768px（`@3xl`）时出现在列表右侧，窄面板自动隐藏；宽档下用 `sticky top-3 self-start` 钉在内容区滚动视口内，不随左侧信息流滚走（缺 `@3xl:block` 会一直 `display:none`，缺 `self-start` 会被拉伸到父容器高度而没有粘住行程）；面板内点刷新可重新取数，未配置 Cookie 时只给引导。
- 标题下的说明行显示「更新于 本地时分」，时刻取宿主回包的 `fetchedAt`（ISO），与榜单内容同一次请求同源，而不是前端计时；首次取数前或回包时刻非法时该行留空，标题区不跳动。
- 卡片的四种状态都由 `StateEmpty` 承载：未配置 Cookie（`Cookie` 图标 + 取数前提说明）、首次加载（`Spinner` + 正在读取）、失败与空榜单（`Flame` + 重试按钮作底部操作区，有错误信息时标题为「热搜读取失败」、说明用上游错误文案，否则是「暂时没有热搜内容」+ 刷新建议）；侧栏内统一用紧凑间距（`gap-3 p-3`），未配置态不在卡片内重复放按钮，入口在顶栏「更多」。
- 榜单用 `ItemGroup`（自带 `role="list"`）+ `Item`（补 `role="listitem"`）承载，不再用 `ol/li`：序号走 `ItemMedia variant="icon"`（`w-4 justify-end`，两位数不推歪标题）、标题走 `ItemTitle`（`line-clamp-1` 单行截断）、`description` 作标题下的副行走 `ItemDescription`、`icon_desc` 作为行尾 `Badge` 收进 `ItemActions`；条目只展示文字，上游 `icon_url` 仍随回包下发但前端不再渲染成图片。
- 条目整行点击打开 `https://s.weibo.com/weibo?q={encodeURIComponent(title)}`（`s.weibo.com` 属 `weibo.com` 子域，`weibo/openPost` 白名单放行；注意该协议对 url 有 512 字符上限）；悬停整行（触发器是 `Item` 本身，不是标题链接）用 `Tooltip` 显示完整标题，气泡沿用 `TOOLTIP_CLASS` 的暗底亮字并放左侧；悬停时整行铺 `hover:bg-muted`，标题、序号与描述同时提亮（`Item` 自带 `group/item`）；标题本身是 `a`，只为键盘可达与右键复制地址，点击 `preventDefault` 后冒泡回整行处理器，避免打开两次或让 webview 自行导航。
