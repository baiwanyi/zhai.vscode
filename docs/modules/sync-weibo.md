# 同步微博 (Sync Weibo) — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：待验证（docs 未覆盖本模块，需先确认开放平台接口权限）
**宿主**：VSCode 插件 BaiwanyiONE

> ⚠️ **前置说明**：本模块依赖微博开放平台接口能力。部分发博接口需应用审核与高级权限，个人开发者可用范围有限。**正式开发前必须先完成接口权限验证**，验证结论应回填至本文档第 9 节。

---

## 1. 模块概述

### 1.1 定位

把工作区中的笔记/章节**一键发布到微博**，承担「写作 → 分发」链路的最后一环。

与「同步微信公众号」的差异：微博是**短内容 + 强互动**平台，强调话题、图片与时效；公众号是**长文 + 排版**平台（见 `sync-wechat.md`）。

### 1.2 目标

- **一键分发**：从当前笔记/章节直接发布，无需复制粘贴到网页
- **内容无损转换**：Markdown → 微博可用文本（话题、@提及、链接、图片）
- **发布可控可追溯**：预览 → 确认 → 发布 → 记录回执，失败可重试且不会重复发博

### 1.3 非目标

- 不做评论管理与粉丝互动（只读回执，不做互动运营）
- 不做定时群发之外的自动化运营（无自动转发/自动评论）
- 不做多平台统一排期（各平台独立发布）

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 短笔记发博 | 写完 500 字读书笔记 → 命令「发布到微博」→ 预览转换结果 → 确认 → 发布成功并回写回执链接 |
| US-2 | 长文转长图 | 3000 字长文 → 超出单条字数 → 自动渲染为长图 → 以图文微博发布 |
| US-3 | 配图发布 | 笔记含 3 张图 → 自动上传图片素材 → 以九宫格形式发布 |
| US-4 | 定时发布 | 设置 20:00 发布 → 到点自动执行（需窗口运行；离线则提醒） |
| US-5 | 重复发布防护 | 误点两次发布 → 第二次被本地记录拦截 → 提示「该内容已于 X 分钟前发布」 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| B1 | OAuth2 授权 | 授权登录，Token 存 `SecretStorage`，支持多账号切换 | P0 | 待验证 |
| B2 | 内容转换 | Markdown → 纯文本：标题转 `#话题#`、链接保留、`@` 提及保留 | P0 | 待实现 |
| B3 | 字数超限处理 | 超限时自动转长图（或提示手动分段） | P1 | 待实现 |
| B4 | 图片上传 | 本地图片上传为微博图片素材，回写 pic_id | P1 | 待实现 |
| B5 | 发布预览 | 发布前展示最终文本、图片与字数 | P0 | 待实现 |
| B6 | 发布与回执 | 发布成功写入回执链接与时间戳 | P0 | 待实现 |
| B7 | 草稿箱 | 未发布的转换结果存为草稿，可反复编辑 | P1 | 待实现 |
| B8 | 发布历史 | 按文件查看历史发布记录与状态 | P1 | 待实现 |
| B9 | 定时发布 | 指定时间自动发布（窗口需运行） | P2 | 待实现 |
| B10 | 失败重试 | 指数退避 + 抖动，上限 3 次 | P1 | 待实现 |
| B11 | 幂等保护 | 内容 hash + 账号维度去重，防重复发博 | P0 | 待实现 |
| B12 | 配额与限流 | 遵循平台配额，本地令牌桶限流 | P1 | 待实现 |
| B13 | 多账号 | 多账号切换，发布时选择目标账号 | P2 | 待实现 |

---

## 4. 交互与流程

### 4.1 授权流程

```
命令：Baiwanyione: 微博账号授权
   │
   ▼
引导用户在设置中填写 AppKey / AppSecret（存 SecretStorage）
   │
   ▼
打开 OAuth 授权页（回调地址需在开放平台配置）
   │
   ▼ 用户确认授权 → 回调带 code
换取 access_token（含有效期）
   │
   ▼
存入 SecretStorage（key: baiwanyione.weibo.<uid>.token）
   │
   ▼
过期前自动刷新（提前 10 分钟）或提示重新授权
```

### 4.2 发布流程

```
当前文件 / 选中内容
   │
   ▼ 内容转换（markdown-one 管线）
纯文本 + 图片列表 + 话题
   │
   ▼ 字数检查
   ├─ 未超限 → 文本微博
   └─ 超限   → 渲染长图（satori + resvg）→ 图文微博
   │
   ▼ 预览确认
用户确认（可编辑）
   │
   ▼ 幂等校验
计算 contentHash = sha256(账号ID + 文本 + 图片hash)
   ├─ 已存在成功记录 → 拦截并提示
   └─ 不存在 → 继续
   │
   ▼ 上传图片（如有）→ 得到 pic_id 列表
   │
   ▼ 调用发博接口（超时 10s 连接 / 30s 总体）
   │
   ├─ 成功 → 写入 publish_records（status=success，回执 URL）
   └─ 失败 → 指数退避重试（最多 3 次）→ 仍失败则记录原因并提供「重试」按钮
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 发博接口 | `statuses/share` / `statuses/update` | **优先 share，回退 update** | `share` 权限门槛较低；`update` 需高级权限，作为已授权用户的可选路径 |
| 长图渲染 | `satori` + `@resvg/resvg-js` / `puppeteer-core` 截图 | **satori + resvg** | 无浏览器依赖、体积小、无沙箱安全争议；输出为 SVG → PNG |
| 中文字体 | 内嵌思源黑体子集 / 依赖系统字体 | **内嵌子集字体** | satori 需显式提供字体；子集化控制包体 |
| 图片上传 | 官方图片上传接口 | **官方接口** | 第三方图床在微博可能展示受限 |
| Token 存储 | `SecretStorage` | **SecretStorage** | 与 `common.md` 一致，系统级加密 |
| 重试策略 | 固定间隔 / 指数退避 + 抖动 | **指数退避 + 抖动** | 避免固定间隔造成重试洪峰 |
| 超时 | 无超时 / 分级超时 | **连接 10s、总体 30s** | 防止请求长期挂起导致资源无法释放 |
| 幂等 | 本地记录 + 内容 hash | **本地 publish_records 去重** | 平台侧无幂等键，必须在本地兜底 |
| 限流 | 令牌桶 / 无限制 | **本地令牌桶** | 遵守平台配额，避免触发风控 |
| 定时 | `setTimeout` 内存定时器 | **内存定时器 + 持久化任务表** | 重启后任务可恢复并提示 |

> **弃用规避**：不使用微博旧版 `statuses/upload`（已下线，改用图片上传 + `statuses/share`）；不使用 `request` 等已废弃 HTTP 库（改用内置 `fetch` 或 `undici`）。

---

## 6. 数据模型

存于 `globalStorage/social.db`。

```sql
-- 平台账号（微博/公众号共用，platform 区分）
CREATE TABLE IF NOT EXISTS social_accounts (
    id          TEXT PRIMARY KEY,
    platform    TEXT NOT NULL,          -- 'weibo' | 'wechat'
    account_id  TEXT NOT NULL,          -- 平台侧 uid
    nickname    TEXT,
    token_key   TEXT NOT NULL,          -- SecretStorage 中的键名，不存明文
    expires_at  TEXT,
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(platform, account_id)
);

-- 发布记录（幂等与历史）
CREATE TABLE IF NOT EXISTS publish_records (
    id            TEXT PRIMARY KEY,
    platform      TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    content_hash  TEXT NOT NULL,        -- 幂等键
    content_text  TEXT,                 -- 发布时的最终文本（用于回溯，可选脱敏）
    payload       TEXT NOT NULL DEFAULT '{}',  -- pic_ids、话题等（JSON）
    status        TEXT NOT NULL,        -- pending|success|failed
    platform_url  TEXT,                 -- 回执链接
    error         TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_idem
    ON publish_records(platform, account_id, content_hash) WHERE status = 'success';

CREATE INDEX IF NOT EXISTS idx_publish_file ON publish_records(file_path, created_at DESC);

-- 草稿
CREATE TABLE IF NOT EXISTS publish_drafts (
    id         TEXT PRIMARY KEY,
    platform   TEXT NOT NULL,
    file_path  TEXT NOT NULL,
    text       TEXT NOT NULL,
    images     TEXT NOT NULL DEFAULT '[]',
    scheduled_at TEXT,
    updated_at TEXT NOT NULL
);
```

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `baiwanyione.weibo.login` | 微博授权 | 打开授权流程 |
| `baiwanyione.weibo.logout` | 退出账号 | 删除本地 Token |
| `baiwanyione.weibo.publish` | 发布到微博 | 转换 → 预览 → 发布 |
| `baiwanyione.weibo.preview` | 预览转换结果 | 仅预览不发布 |
| `baiwanyione.weibo.history` | 发布历史 | 查看记录与回执 |
| `baiwanyione.weibo.retry` | 重试失败发布 | 对失败记录重试 |

**Webview 方法**：`weibo/accounts`、`weibo/preview`、`weibo/publish`（流式进度）、`weibo/history`、`weibo/retry`

```typescript
/** 发布请求 */
interface WeiboPublishRequest {
    method: 'weibo/publish'
    payload: {
        accountId: string
        filePath: string
        text: string
        imagePaths: string[]
        /** 客户端计算的幂等键，服务端二次校验 */
        contentHash: string
        scheduledAt?: string
    }
}

/** 发布结果 */
interface WeiboPublishResult {
    recordId: string
    status: 'success' | 'failed'
    url?: string
    error?: { code: string; message: string }
    attemptCount: number
}
```

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 授权持久化 | 授权后重启窗口仍有效；Token 无明文落盘 |
| AC-2 | 内容转换 | Markdown 标题/加粗/链接转换正确；`#话题#` 与 `@` 保留 |
| AC-3 | 长图生成 | 3000 字长文生成长图 < 3s，中文不乱码、排版可读 |
| AC-4 | 图片上传 | 单张 < 3s；9 张以内正常；超限提示拆分 |
| AC-5 | 幂等 | 同一内容重复发布被拦截，平台侧无重复微博 |
| AC-6 | 重试 | 网络失败按 1s/2s/4s（含抖动）重试，3 次后停止并保留失败原因 |
| AC-7 | 超时 | 连接 10s / 总体 30s 超时后中断并提示，无挂起请求 |
| AC-8 | 回执 | 成功后记录可点击访问的原微博链接 |
| AC-9 | 限流 | 达到本地配额阈值时排队而非丢弃，并提示预计等待 |
| AC-10 | 失败不丢数据 | 任何失败均保留草稿，用户可编辑后重发 |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **接口权限不足（最高风险）** | 功能无法上线 | 开发前先做接口权限验证；不可用时降级为「生成待发内容 + 手动复制」 |
| 应用审核周期长 | 上线延期 | 提前准备应用资料；先实现不依赖审核的转换与预览能力 |
| 内容审核不通过 | 发布失败 | 失败原因透传；提供编辑后重发 |
| 平台接口变更/限流收紧 | 功能失效 | 接口调用集中封装，便于单点适配；保留降级路径 |
| 定时发布依赖窗口运行 | 任务漏发 | 持久化任务表 + 启动时检查过期任务并提示 |
| 账号安全风险 | 账号被盗用 | Token 仅存 SecretStorage；支持随时登出并撤销授权 |

**开放问题（需确认）**

1. 目标账号类型：个人开发者应用能否满足发布需求？是否需要企业资质？
2. 长图方案是否被接受（部分场景平台对图片微博展示有限制）？
3. 是否需要支持「微博文章」这一长文形态（接口权限不同）？
4. 是否需要多账号与内容矩阵分发？
