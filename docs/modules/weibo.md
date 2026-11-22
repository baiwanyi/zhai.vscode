# 微博浏览器 (Weibo Browser) — 模块设计文档

**版本**：3.0
**日期**：2026-11-21
**状态**：与实现同步（取数为微博网页端同源 ajax + Cookie 鉴权）

---

## 1. 模块概述

### 1.1 定位

在 VSCode 编辑区提供一个独立的微博面板：浏览关注时间线、热门频道、自建分组与热搜榜；读取评论并回复、点赞、转发、删除自己的内容；发布图文微博；把单条微博保存为笔记或添加为 AI 对话上下文。

面板不占用侧栏，与仪表盘、工作流区通过「当前活跃面板」上报协作：面板获得焦点即切到微博语境，让位后由活跃文档侧统一清空。

### 1.2 能力范围

| 能力 | 入口 | 实现 |
|---|---|---|
| 首页推荐流（增量刷新） | 顶部菜单「首页 · 推荐」 | `ajax/feed/unreadfriendstimeline` |
| 首页时间线（默认分组） | 「首页 · 时间线」 | `ajax/feed/friendstimeline` |
| 热门频道 | 「热门 · <频道>」 | `ajax/feed/hottimeline` |
| 自建分组 | 「首页 · <分组名>」 | `ajax/feed/groupstimeline` |
| 热搜九榜 | 「热搜 · 我的 / 热搜 / 文娱 / 社会 / 科技 / 生活 / 体育 / ACG / 同城」 | `ajax/side/bandUnified`、`ajax/statuses/*` |
| 我的赞 | 账号菜单 | `ajax/statuses/likelist` |
| 他人主页 | 正文 / 标题行 / 账号菜单的主页链接（`/u/{uid}`、`/n/{昵称}`） | 页内打开：`profile/info` + `ajax/statuses/mymblog` |
| 评论 | 卡片评论区 | `buildComments`、`comments/create`、`comments/reply`、`destroyComment` |
| 评论点赞 | 评论与子评论操作行 | `updateLike`、`destroyLike`（`object_type=comment`） |
| 点赞 | 卡片动作 | `setLike`、`cancelLike` |
| 转发 | 卡片动作与转发列表 | `repostTimeline`、`normal_repost` |
| 转发点赞 | 转发列表操作行 | `setLike`、`cancelLike`（form 参数 + 指纹） |
| 删除微博或转发 | 卡片动作 | `statuses/destroy` |
| 发布微博 | 首页发表框 | `pic_upload.php` 换 pid → `statuses/update` |
| 长文展开 | 卡片「展开」 | `statuses/longtext` |
| 保存为笔记 | 卡片动作 | 本模块组装 Markdown，落盘交给笔记模块 |
| 添加到 AI 对话 | 卡片动作 / 评论条 / 转发条 | 本模块组装上下文文本，交给 AI 层（主贴用原文链接、评论与转发用各自 id 去重） |
| 引用转发 | 转发列表操作行 | 把「//@作者：附言」追加到转发框草稿，与手输内容一并发出去 |
| 图片显示 | 全部卡片 | 宿主图片代理取回后转 data URI |
| 视频播放 | 卡片内嵌播放器 | 回环 HTTP 中转，Range 原样透传 |

### 1.3 明确不做

- 不做批量采集、不落公共库：只读当前账号自己的关注流。
- 不做 UA 轮换、代理池、验证码绕过、设备指纹伪造。
- 不提供「按命名规范批量下载媒体归档」：图片经代理内联显示，保存笔记所需的配图直接搬进 `uploads/`。
- 不做多账号并存：同一时刻只保存一份登录 Cookie。

### 1.4 文件结构

后端 `src/modules/weibo/` 共 26 个文件，按职责分五层：

| 层 | 文件 |
|---|---|
| 协议与装配 | `weiboRoutes.ts`、`panel.ts`、`postActions.ts`、`warmup.ts` |
| 取数 | `webClient.ts`、`webTimeline.ts`、`webFeed.ts`、`webHotRank.ts`、`webLikes.ts`、`webUserBlog.ts`、`webFriends.ts`、`webComments.ts`、`webReposts.ts`、`webLongText.ts`、`webEmoticons.ts`、`webTopics.ts`、`webProfile.ts`、`webPublish.ts`、`webInteraction.ts` |
| 状态与存储 | `webCredential.ts`、`weiboCache.ts`、`weiboAvatar.ts` |
| 媒体 | `mediaProxy.ts`、`videoServer.ts` |
| 常量与内容组装 | `weiboEndpoints.ts`、`note.ts` |

前端 `src/weibo/` 按职责分五类：`hooks/` 控制器、`layout/` 装配与页面组件、`block/` 卡片内展示块、`utils/` 纯函数、`context/` 页内导航上下文，`WeiboScreen.tsx` 只做装配，内容分发由同文件的 `WeiboContentView` 承担（取数走 `useWeiboPageFeeds`，视图导航 / 顶栏刷新 / 分组衍生值分别走 `useWeiboPageNav` / `useWeiboRefresh` / `useWeiboGroupsView`，凭证删除走 `useCredentialRemoval`，草稿走 `useWeiboComposerDraft`，内容视图交给 `WeiboHomeView` / `WeiboFeedViews` / `HotSearchView` / `UserBlogView`，主页导航走 `WeiboUserPageProvider`）。固定短文案集中在 `utils/weiboUiText.ts`（`WEIBO_UI_TEXT`），顶栏视图说明在 `utils/weiboViewDescription.ts`（`describeWeiboView`）。`block/` 只放接收 props 渲染的展示块（条目、发布框、媒体预览等），自带取数的列表与卡片仍留在 `layout/`；列表续载与失败重试统一由公共 `LoadMoreSentinel` 承担。

### 1.5 凭证与配置

| 项 | 位置 | 说明 |
|---|---|---|
| 登录 Cookie | SecretStorage `zhai.weibo.webCookie` | 必须含 `SUB`；只写不回显，错误文案与日志不含任何片段 |
| 保存时刻 | SecretStorage `zhai.weibo.webCookieSavedAt` | 仅用于面板展示与排障，不参与鉴权 |
| 同城城市 | `zhai.weibo.cityCode` | 四位行政区划代码，默认 `4501` |
| 屏蔽用户名 | `zhai.weibo.blockedUsers` | 命中作者名的整条微博隐藏 |
| 屏蔽关键字 | `zhai.weibo.blockedKeywords` | 命中正文（含转发正文）的整条微博隐藏 |

### 1.6 落盘位置

| 内容 | 位置 | 约束 |
|---|---|---|
| 元数据缓存 | `{存储根}/weibo.json` | 分组 / 热搜 / 表情 / 账号信息，按账号指纹分片；版本不符整份作废；`.part` + rename 原子写 |
| 头像 | `{存储根}/weibo_avatar.jpg` | 清除凭证时一并删除，避免换号后露出上一个账号 |
| 图片缓存 | `{globalStorage}/weibo-media/` | 上限 800 个文件，超出按修改时间清理到 600 |
| 视频 | 不落盘 | 回环服务流式转发，面板销毁即停 |

---

## 2. 实现细节

> 定位：`ajax/feed/unreadfriendstimeline` 是 weibo.com 网页端同源内部 ajax 接口，只读、Cookie 鉴权、无移动端 `x-xs-*` 签名参数。本模块全部取数都建立在这一类接口上，通行做法与合规边界见第 2.9 节。

### 2.1 请求构造

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

### 2.2 鉴权处理

- 凭证即浏览器登录态 Cookie，**至少包含 `SUB`**；`SUBP`、`XSRF-TOKEN` 等一并保留，宿主不做裁剪。
- 存储：`vscode.SecretStorage`（`zhai.weibo.webCookie` + 保存时刻键），明文不出宿主、不进日志、不回传前端；前端只看到「是否已配置 + 保存时间」。
- 失效判定：HTTP 401/403 → 登录态失效；302 到登录页被 fetch 跟随后会拿到 HTML（以 `<` 开头）→ 同样判失效；JSON `{ok:0,msg}` 中含「登录/账号」→ 失效。
- 频控判定：HTTP 418/429，或 `msg` 含「频繁/过快/太多」→ 限流；这两类错误**不重试**，重试只会加重风控。

### 2.3 分页与增量

```
首屏：refresh=4 & since_id=0
  └─ 解析 statuses[] 与顶层 max_id
      └─ 下一页：refresh=4 & max_id={上页 max_id}（不带 since_id）
          └─ statuses 为空 / max_id 缺失 / max_id 与本页相同 → 到底

增量：refresh=4 & since_id={上次结果最新一条 id}
  └─ 只请求一页：再往后翻就变成补历史，与「看新内容」语义相反
```

- 去重以数字 `id` 为准：翻页与增量都会出现重叠条目，合并时前插刷新、追加翻页，重复一律丢弃。
- 增量起点**优先取上游回包的 `since_id`**，缺失时才回退本次结果首条的 `id`；`sinceId=0` 表示不启用增量。
- 两种口径实测不同：分组 / 时间线（`groupstimeline` / `friendstimeline`）的 `since_id` 恰好等于首条微博 id，两者等价；**首页 `unreadfriendstimeline` 的 `since_id` 是读进度游标**（实测 `1795177409209985`，与 16 位微博 id 不同量级），若用首条微博 id 覆盖会让下次增量传错游标。
- 单次调用最多翻 10 页（实现上限），避免一次点击打出长请求链。

### 2.4 字段映射

| 归一化字段 | 上游取值 | 处理 |
|------------|----------|------|
| `id` | `idstr` → `id` → `mid` | 字符串化，去重与游标的唯一依据 |
| `text` | `text_raw` → `text` | 剥标签、解实体、去零宽字符、保留换行（纯文本口径，不含表情图） |
| `segments` | `text`（含 `<img>` 表情标签与 `<a>` 锚点） | 按「文本 + 表情 + 链接」交错切段，表情保留图床直链与名称；锚点只在 `weibo.com`（含子域）、`weibo.cn`、`t.cn` 白名单内落成 `type: 'link'`（`mention` / `topic` / `supertopic` / `link`），越界地址展平为纯文本 |
| `createdAt` | `created_at` | `Wed Nov 19 10:00:00 +0800 2026` 按时区折算为 ISO；解析失败留空 |
| `source` | `source` | 实测是纯文本客户端名（如 `iPhone 17 Pro Max`、`微博视频号`）；旧版返回 `<a>` 外壳时剥标签只留文字 |
| `author` | `user.id / screen_name / verified / avatar_large` | 认证标记取 `verified === true`，头像只保留图床地址 |
| `metrics` | `reposts_count / comments_count / attitudes_count` | 缺失按 0 |
| `readsCount` | `reads_count` | 只有本人发布的微博才由上游下发；数字与数字字符串都收下，缺失或负数归一化为 `null`（与「真实 0 阅读」区分），卡片头部仅在作者 uid 等于当前账号时以 `Badge` 徽标展示在动作区 |
| `media.items` | 有 `mix_media_info.items` 时按它原序；**关注流实测没有该字段**，图片来自 `pic_infos` / `pic_ids`，视频来自 `page_info`（`object_type: video`） | `image` 项给原图 / 展示图 / 尺寸，`video` 项只给封面与时长，不给播放直链；视频 `page_pic` 作封面、`media_info.duration` 作时长、`playback_list` 只留兜底诊断 |
| `media.images` | 由 `media.items` 派生（`kind === 'image'`） | 原图直链，按 pid 与直链双重去重；缺直链时用 pid 拼 `wx1.sinaimg.cn/large/{pid}.jpg` |
| `media.thumbnails` | `pic_infos[*].large.url`（`/orj960/`，长边 960），缺失才回退 `bmiddle`（`/wap360/`），都没有时把原图目录换成 `/bmiddle/` | 展示图：九宫格与卡片内预览共用，与 images 同序；不再为预览另取原图 |
| `media.sizes` | `pic_infos[*].largest.width/height`，缺失回退 `original` / `large` | 最大尺寸，与 images 同序；展开预览按它算占位比例，与实际加载的档位无关 |
| `media.videoUrl` | `page_info.media_info.playback_list[0]` 等 | 首个可播放地址，仅作兜底诊断；卡片不播放，观看一律回原文 |
| `media.imageCount` / `videoCount` | `pic_num`、实际解析出的图片数、混排里的视频条数 | 图片与视频分开计数，不再互相冒充 |
| `retweeted` | `retweeted_status` | 保留作者名、正文摘要、**正文分段**（与主贴同口径：表情按内联图渲染，@账号与话题可点）、原文地址与**媒体**（图片九宫格 + 视频封面，与主贴同一份归一化）；转发里再转发的层级只按文字处理，不递归展开 |
| 广告位 | `ad_state=1` / `is_ad` / 驼峰 `isAd` / `mark` 含 `WeiboADNatural` / `promotion` | 直接丢弃，不进入去重计数；关注流每条都带 `isAd`（样例全为 `false`），点赞列表的推广位是 `isAd: true` |

#### 响应结构（2026-11-20 实测，供后续查字段）

两份样例分别来自分组信息流与首页推荐流：列表都在顶层 `statuses`，差异只在游标与总量字段。

**分组信息流（`groupstimeline`，样例 25 条）**

```json
{
    "ok": 1,
    "statuses": [{ "id": 5367422888183241, "idstr": "5367422888183241", "mblogid": "RshYAykPL" }],
    "total_number": 2000,
    "since_id": 5367422888183241,
    "since_id_str": "5367422888183241",
    "max_id": 5367389823964732,
    "max_id_str": "5367389823964732"
}
```

**首页推荐流（`unreadfriendstimeline`，样例 15 条）**

```json
{
    "ok": 1,
    "statuses": [{ "id": 5367414670758678, "idstr": "5367414670758678", "mblogid": "RshXYzAbc" }],
    "since_id": 1795177409209985,
    "since_id_str": "1795177409209985",
    "max_id": 1795177409209985,
    "max_id_str": "1795177409209985"
}
```

- 两份都是顶层 `statuses`，**没有 `data` 包裹**；`since_id` / `max_id` 是数字（同值的 `*_str` 可兜底）。
- `total_number` 只在分组样例出现（关注流总量），首页样例没有；两份都不拿它做翻页判断。
- 增量口径不同：分组的 `since_id` 等于首条微博 id；首页的 `since_id` 是**读进度游标**（`1795…`，与 16 位微博 id 不同量级，且与 `max_id` 同值）。实现按「上游 `since_id` 优先、缺失回退首条 id」处理（见 2.3）。
- 首页 `max_id` 与 `since_id` 同值，更像读进度而非列表游标；翻页行为未单独验证，出现「加载更多」重复内容时优先怀疑这一点。
- 分组、首页、热门共用同一套端点实现（`fetchWeiboFeed` → `fetchFriendTimeline`），都按顶层 `statuses` + 同名游标解析；`allGroups` 才是 `groups[]` 分区结构（见 2.11）。
- 单条微博字段（右列为出现次数，「分组 25 条 / 首页 15 条」）：

| 字段 | 出现 | 说明 / 本项目处理 |
|------|------|------------------|
| `id` / `idstr` / `mid` | 25/25 · 15/15 | 数字 id，去重与游标的唯一依据 |
| `mblogid` | 25/25 · 15/15 | 拼原文地址 |
| `created_at` | 25/25 · 15/15 | 英文时间串（`Fri Nov 20 20:13:21 +0800 2026`） |
| `user` | 25/25 · 15/15 | 取 `id` / `screen_name` / `avatar_large` / `verified` |
| `text` / `text_raw` | 25/25 · 15/15 | 带标签正文 / 纯文本；表情只在 `text` 的 `<img>` 里 |
| `isLongText` | 25/25 · 15/15 | 分组样例全 `false`；首页 7 条为 `true`，其中只有 4 条带 `continue_tag` 是真长文，另 3 条是「带视频卡片链接」被误标 |
| `continue_tag` | 0 · 4/15 | 长文「全文」入口（`title` / `pic` / `scheme`），本项目用作长文证据 |
| `textLength` | 22/25 · 13/15 | 未使用 |
| `annotations` | 23/25 · 13/15 | 客户端参数（含定位 `place`），未使用 |
| `source` | 25/25 · 15/15 | 客户端名；首页样例中带 `<a>` 外壳的会剥成纯文本 |
| `cardid` | 7/25 · 14/15 | 卡片位标记（`star_*` / `vip_*` / `topic_*`），不是广告，正文仍按 `text` 渲染 |
| `pic_ids` / `pic_num` | 25/25 · 15/15 | `pic_num > 0` 才有 `pic_infos`（分组 15 条、首页 3 条带图） |
| `pic_infos` | 15/25 · 3/15 | 逐 pid 给各档位地址；`type` 为 `pic` 或 `livephoto`（带 `video` / `fid`，只取静态图） |
| `pic_focus_point` | 15/25 · 3/15 | 焦点裁切信息，未使用 |
| `page_info` | 8/25 · 10/15 | 视频与卡片：`object_type` 实测 `video`（7 + 9 条）、`group`（分组 1 条）、`hudongvote`（首页 1 条，type 23 投票卡，无 `media_info`）；封面取 `page_pic`，时长取 `media_info.duration`，播放源取 `media_info` 的整段 mp4（见下方视频字段表） |
| `retweeted_status` | 3/25 · 2/15 | 转发体结构与主贴同形（可自带 `page_info` 与 `pic_infos`），摘要、地址与媒体一并保留；另取 `user.id`（卡片 `@UID`）、`user.verified`（认证角标）与 `created_at`（发布时间），卡片转发块的作者行与主贴同构 |
| `isAd` | 25/25 · 15/15 | 两份样例全为 `false`；点赞列表的推广位为 `true`（见 2.16） |
| `region_name` | 25/25 · 10/15 | 「发布于 北京」，目前不展示 |
| `title` | 0 · 3/15 | 推荐流的「XX 关注了」推荐理由（含 `structs`），未展示 |
| `buttons` / `mblog_menus_new` / `hide_from_prefix` / `is_second_attention` / `followBtnCode` / `ai_tag_info` | 0 · 3/15 | 推荐流的关注按钮、菜单与 AI 标签，未使用 |
| `visible` / `mblogtype` / `content_auth` / `comment_manage_info` / `rcList` / `showFeedRepost` 等 | 25/25 · 15/15 | 权限与交互配置，未使用 |
| `title_source` / `tag_struct` / `url_struct` / `topic_struct` / `common_struct` | 1~11/25 · 1~10/15 | 超话、标签与短链卡片的结构化信息；正文已含同名文字，不单独渲染 |

#### 图片字段（`pic_infos` / `pic_ids`）

条目顶层：`pic_ids`（pid 顺序）、`pic_num`（声明总数）、`pic_infos`（pid → 各档位）、`pic_focus_point`（焦点裁切数组，未使用）。`pic_num > 0` 才会有 `pic_infos`（分组 15/25 条、首页 3/15 条带图）。

| `pic_infos[pid]` 字段 | 实测取值 | 说明 |
|------|----------|------|
| `thumbnail` / `bmiddle` / `large` / `original` / `largest` / `mw2000` / `largecover` | 各含 `{ url, width, height, cut_type, type }` | 档位对象；七档齐全，样例的 `cut_type` 均为 1（等比裁切） |
| `type` | `pic` / `livephoto` | 实况图另带 `video` / `video_hd`（mov 地址）与 `fid`；本项目只取静态图 |
| `pic_status` | `1` / `0` | 图片状态位（含义未公开），本项目不据此过滤 |
| `focus_point` | `{ left, top, width, height }` | 相对比例（0~1），条目的 `pic_focus_point` 是同一批数据的数组版 |
| `object_id` | `1042018:xxxx` | 对象 id，未使用 |
| `pic_id` | 与 pid 同值 | 回查用 |
| `photo_tag` | `0` / `1` | 是否带图片标签，未使用 |
| `actionlog` | 数组 | 埋点（含 `mid` / `oid` / `act_type` / `source` / `code`），未使用 |

图床档位与目录（实测同一张图的七档）：

| 档位键 | URL 目录 | 实测尺寸样例 | 本项目用途 |
|--------|----------|--------------|-----------|
| `thumbnail` | `wap180` | 95×180 | 未使用 |
| `bmiddle` | `wap360` | 190×360 | 兜底展示图（缺 `large` 档、超大图降级时用） |
| `large` | `orj960` | 960×1817 | `media.thumbnails`（九宫格 + 卡片内展开预览） |
| `original` | `orj1080` | 1014×1920 | 未使用 |
| `largest` | `large` | 1014×1920 | `media.images` 原图 + `media.sizes` 尺寸 |
| `mw2000` | `mw2000` | 1014×1920 | 未使用（样例与原图同尺寸，宽 >2000 时才缩） |
| `largecover` | `cmw960` | 960×1817 | 未使用（封面裁切版） |

- 实测 `largest` 与 `original` 尺寸相同（原图不超过 2048 时），`large` 是长边 960 的等比缩略；只有 pid 没有档位对象时，用 `wx1.sinaimg.cn/large/{pid}.jpg` 兜底（见 2.4 的图片渲染说明）。
- 视频封面另有一套更小的档位：`orj480`（`page_info.page_pic` / `pic_info`）与 `or180`（`big_pic_info.pic_small`）。

#### 视频字段（`page_info` / `media_info`）

`page_info` 只在视频、群组卡片等条目出现（分组 8/25、首页 10/15）。视频的 `object_type` 为 `video`、`type` 为 `11`；群组卡片是 `object_type: group` / `type: 0`，投票卡片是 `object_type: hudongvote` / `type: 23`，两者**都没有 `media_info`**。

| `page_info` 字段 | 实测 | 说明 |
|------|------|------|
| `type` | `11` / `0` | 卡片类型：11 视频卡片，0 普通卡片 |
| `object_type` | `video` / `group` | 视频 / 群组（群组另有 `tips` / `page_desc` / `pic_style`） |
| `object_id` | `1022:100808…` | 对象 id |
| `page_pic` | `https://wx4.sinaimg.cn/orj480/….jpg` | 视频封面（480 档），卡片封面来源之一 |
| `pic_info` | `{ pic_big, pic_small, pic_middle }` | 封面档位，**宽高是字符串**（与 `pic_infos` 的数字不同） |
| `page_title` / `page_desc` / `page_url` | 标题 / 描述 / 原页面地址 | 本项目只在封面处用到图，标题区不展示卡片文案 |
| `media_info` | 对象 | 视频详情，见下表 |
| `oid` / `author_id` / `authorid` | 数字 | 归属 id，未使用 |
| `short_url` / `type_icon` / `warn` / `actionlog` | — | 短链、角标、风控与埋点，未使用 |

`media_info` 常用字段（实测 49 个键，以下只列会影响解析的）：

| `media_info` 字段 | 实测 | 说明 |
|------|------|------|
| `duration` | `58`（秒，整数） | **视频时长**，本项目写入 `media.items[].durationSeconds` |
| `name` | 标题文案 | 未使用 |
| `format` / `media_type` | `video/mp4` / `video` | 固定值 |
| `stream_url` / `stream_url_hd` | 直链 | 旧版整段地址，作为播放源的最后兜底 |
| `mp4_sd_url` / `mp4_hd_url` / `mp4_720p_mp4` / `h265_mp4_hd` / `h265_mp4_ld` / `hevc_mp4_720p` / `inch_4_mp4_hd` / `inch_5_mp4_hd` / `inch_5_5_mp4_hd` | 带签名的整段 mp4 地址 | 按机型/清晰度分档；本项目按 `mp4_720p_mp4` → `mp4_hd_url` → `mp4_sd_url` → `stream_url_hd` → `stream_url` 取播放源 |
| `h5_url` | `https://m.weibo.cn/…` | h5 播放页，未使用 |
| `playback_list` | 4~6 项 | DASH 分片列表（带 `init_range` / `index_range`），`<video>` 不能直接播，**不作为播放源** |
| `mpdInfo` | DASH manifest | 未使用 |
| `big_pic_info` | `{ pic_big, pic_small, pic_middle }` | 封面档位（`orj1080` / `or180`） |
| `video_orientation` / `origin_total_bitrate` / `ttl` / `storage_type` | 数字 | 方向、码率、有效期与存储类型，未使用 |
| `show_progress_bar` / `show_mute_button` / `play_loop_type` / `play_completion_actions` | 布尔 / 描述 | 播放器交互配置，未使用 |
| `author_name` / `author_mid` / `online_users_number` / `video_publish_time` / `is_short_video` / `belong_collection` / `next_title` / `kol_title` / `ext_info` / `extra_info` / `jump_to` / `forward_strategy` / `video_download_strategy` / `prefetch_*` | — | 作者、热度、发布时刻与策略字段，未使用 |

`playback_list[]` 每项是 `{ meta, play_info }`：

| 结构 | 关键字段 | 实测取值 |
|------|----------|----------|
| `meta` | `label` / `quality_index` / `quality_desc` / `quality_label` / `quality_class` / `type` / `quality_group` / `is_hidden` | `dash_720p`、`quality_index: 720`、`高清`、`720p`、`HD` |
| `play_info` | `label` / `protocol` / `mime` / `url` / `bitrate` / `width` / `height` / `size` / `duration` / `fps` / `video_codecs` / `audio_sample_rate` / `audio_channels` / `init_range` / `index_range` / `first_segment_range` / `prefetch_range` / `video_decoder` / `prefetch_enabled` | `dash`、`video/mp4`、`720×960`、`avc1.64001f`、`fps: 24`、`duration: 58.083` |

- 实测出现的 `label`：`dash_720p` / `dash_1080p` / `dash_hd` / `dash_1440p60` / `hevc_dash_720p` / `hevc_dash_1080p`（`protocol: dash`，`mime: video/mp4`）、`dash_audio`（`audio/mp4`）、`scrubber_hd`（`image/jpeg`，预览雪碧图）。
- 播放源取 `media_info` 的**整段 mp4**，按 `mp4_720p_mp4` → `mp4_hd_url` → `mp4_sd_url` → `stream_url_hd` → `stream_url` 顺序取第一个通过白名单的地址；`playback_list` 是 DASH 分片（带 init / index range），`<video>` 不能直接播，**不作为播放源**。
- **协议细节**：网页端回包的整段 mp4 是 `http://f.video.weibocdn.com/...`，归一化时统一升级为 https（否则会被混合内容拦掉）；宿主取回时 https 失败还会用同主机的 http 地址重试一次。主机白名单为 `weibocdn.com` / `weibo.com` / `weibo.cn` 子域。
- 播放链路：点击封面 → `weibo/video { url }` → 宿主把地址换成回环中转地址 `http://127.0.0.1:{port}/video?url=…` → 卡片内 `<video>` 播放。CDN 校验 Referer 而 Webview 改不了请求头，故由 `videoServer` 起一个只绑 `127.0.0.1` 的本地 HTTP 服务：带 `Referer` 请求 CDN 后把字节流边下边发（**不落盘、不整段缓冲**），`Range` / `Content-Range` 原样透传，播放器可边下边播与拖动；面板关闭即关服务。
- CSP 的 `media-src` 放行 `http://127.0.0.1:*` / `http://localhost:*` 与微博视频 CDN；其余远程媒体域一律不放。
- **为什么必须转码音轨**：VS Code 的 Webview 跑在 Electron 自带 Chromium 上，那份构建**不含 AAC 解码器**（[microsoft/vscode#167685](https://github.com/microsoft/vscode/issues/167685)，官方只保证 Wav / Mp3 / Ogg / Flac），而微博视频音轨实测全是 **HE-AAC**。表现就是「画面正常、完全没有声音」，媒体控件里的音量键还是灰的。因此中转服务在能用 ffmpeg 时执行 `-c:v copy -c:a libmp3lame -b:a 128k -movflags frag_keyframe+empty_moov -f mp4`：视频原样拷贝、音轨转 MP3，边转边发（不落盘），`Content-Type: video/mp4`、`Accept-Ranges: none`（转码流不可按字节定位，进度条不可拖动）。
- ffmpeg 不在 PATH 或转码失败时回退为**原样转发**：画面能看、能拖动，但可能无声；日志会记一条「回退原样转发」。实测转码产物 1.81MB，音轨 `mp3` + 视频 `h264`。
- 实测：本地中转整段返回 `200`（`video/mp4`，1.8MB），`Range: bytes=0-1023` 返回 `206`（`Content-Range: bytes 0-1023/1826650`），字节头为 `ftyp`。
- **纯视频微博**（`imageCount === 0` 且只有一个视频项）直接铺播放器：poster 是封面经图片代理换来的 data URI，进视口即可见，点播放才开始走中转取流，不会提前偷流量；地址换不到时该位置变成「视频暂不可播放，点击在浏览器打开原文」。
- **容器比例跟随视频分辨率**（`media.items[].resolution`）：`WeiboVideoPlayer` 收一个 `aspectRatio`，竖屏视频按竖框铺开，不再塞进 16:9 里左右留大片黑边；分辨率缺失或非法值时才回落 16:9。容器高度统一限到 **720px**：竖屏比例超过这条线时由 `video` 的 `object-contain` 居中、左右留黑底，不把卡片撑长。
- 播放器统一走 `layout/WeiboVideoPlayer.tsx`（自绘控件栏，不用原生 `controls`）：中央播放键只在暂停时出现，播放中淡出且不挡画面；**空格切换播放/暂停**（容器可聚焦，`preventDefault` 同时挡掉页面滚动）；**控件栏只在播放中出现**——播放中鼠标静止 2.5 秒后淡出、鼠标一动立刻回来，暂停与未播放时整条控件栏不显示，只留中央播放键；底部含进度条（可拖动）、`mm:ss` 时间、静音与全屏，全屏在 Webview 中被拒时静默忽略。
- 控件一律用现成组件：按钮取 `@webview/components/Button`（图标键 `size="icon-xs"`、中央键 `icon-lg` 配圆形容器、静音与全屏带 `tooltip`），进度条取 `@components/ui/slider`（拖动只更新本地进度，`onValueCommit` 才 seek），清晰度角标取 `@components/ui/badge`。播放器叠在视频上固定是暗底，控件配色写死白色、只覆盖配色类，不改组件本体。
- **清晰度角标**：视频项自带 `resolution`，取 `playback_list` 里面积最大的一档宽高（`dash_audio` 宽高为 0 自动跳过，`scrubber_hd` 预览图面积最小选不中），没有播放列表时回退解析地址上的 `template=720x960.24.0`。前端按**短边**归类成 `320P` / `480P` / `720P` / `1080P` / `2K` / `4K` / `8K`（1440 / 2160 / 4320 分别对应 2K / 4K / 8K），在播放器左上角用白色半透明角标展示，**播放中收起、未播放与暂停时显示**；分辨率缺失时不显示角标。
- 图文混排 / 多视频：视频项先占一个宫格（封面 + 播放角标 + 时长），与图片一起按原序排三列；点封面才原地换成**整行**播放器（`col-span-3`，按视频分辨率比例铺开），图片被挤到播放器下方，播放器右上角有「返回宫格」按钮可收起；同一媒体区同时只播一条，换一条即收起旧的；没有整段地址或中转不可用时该位置回退「在浏览器打开原文」，转发区回退的是被转发的原文。

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
- 保存笔记时反过来需要**最大尺寸原图**：宿主按 pid 直接请求 `ajax/common/download?pid=xxx`（带 Cookie 与 Referer），302 由代理跟随（最多 3 跳，每一跳都校验落点仍在图片白名单内）；该通道失败才回退图床直链。
- CSP 的 `img-src` 维持 `${webview.cspSource} data:`，不放行任何远程图片域；`media-src` 放行 `${webview.cspSource} blob: data:`、回环中转地址与微博视频 CDN（`weibocdn.com` / `weibo.com` / `weibo.cn` 及其子域）。`localResourceRoots` 只保留扩展产物目录：图片走 data URI、视频经回环中转流式播放，均不需要授权缓存目录。
- 代理只接受 `image/jpeg|png|gif|webp|bmp` 且单张 ≤12MB，SVG 等可携带脚本的类型直接拒绝；同一地址并发请求共享一次下载，缓存按 URL 哈希命名，命中零网络。
- 卡片按微博客户端习惯渲染：头像圆形（失败回落首字）、配图九宫格（1 张按原图比例整张显示、不裁剪，2 张两列，3 张以上三列按方格裁切，**不设 9 张上限，上游给多少张就排多少格**，懒加载按视口取图）、表情内联为 16px 小图；图片就绪前用同尺寸占位，避免列表抖动，失败显示破图占位。
- 正文里的 `<img>` 只有带表情名（`title` / `alt`，非空且不是短链）才按表情渲染；视频卡片等装饰图（`h5.sinaimg.cn/upload/…` 小图标，`alt` 常是 `http://t.cn/…`）直接跳过，既不出图标也不留 `[]` 占位。
- 正文里的 `<a>` 在归一化阶段转成**链接段**（`segments` 的 `type: 'link'`）：`@账号`、`#话题#`、`#超话#` 与短链共用一套渲染，`kind` 区分 `mention` / `topic` / `supertopic` / `link`。地址按 `weibo.com`（含子域）、`weibo.cn`、`t.cn` 白名单收窄，协议相对写法补成 `https:`，越界地址降级为纯文本；内层带 `<img>` 的锚点是视频 / 文章卡片，只消费开标签，内层图片与文字继续按原有逻辑切分。
- `@账号` 的地址有多级回退：`href` 优先；`href` 为 `javascript:void(0)`、缺失或属性无引号时，先取 `usercard="id=…"` 里的 uid 拼 `/u/{uid}`，再退到按锚点文本 `@昵称` 拼 `/n/{昵称}`。属性解析支持无引号值，且不会把 `data-href` 误当成 `href`；话题不参与文本回退，避免普通 `#标题#` 被误判。
- 链接点击一律阻止 Webview 自身导航，统一走 `weibo/openPost` 交宿主 `openExternal` 打开（宿主再次校验域名与 https）；长文全文只有纯文本，用 `@shared/utils/weiboText` 的 `splitPlainTextLinks` 从 `@昵称`、`#话题#`、`https://…` 补出同样可点的分段，转发体则直接使用归一化时切好的 `segments`。该切分是宿主与 Webview 共用的纯函数：宿主在正文缺 HTML 锚点（`text_raw` 兜底）时同样用它，`@` 前紧邻邮箱字符（`a@b.com`）不当作账号。
- 链接外观统一为橙色（`text-orange-600 dark:text-orange-400`）并加悬停下划线，不设 `title`：悬停浮出整串地址既冗余又会遮住正文，可点性靠颜色表达。
- 引用（转发）微博的媒体与主贴共用同一套 `PostMediaGrid`：图片走九宫格、点击即在卡片内展开预览；视频与图片同处宫格，点封面才在原地换成整行播放器，图片随之落到下方；没有整段地址或中转不可用时才回退打开原文，转发区回退的是**被转发的原文**。视频项判定按 `page_info.object_type === 'video'` 或 `type === 11`，旧版只靠有没有整段播放地址；群组 / 投票卡片同样带 `page_pic`，不当作视频。
- **不重复展示**：被转发内容带视频时，外层（转发这条）的视频项由归一化直接剔除，只保留图片——视频只留在引用区，避免同一条卡片里出现两个播放器。
- 列表与展开预览**都用同一张展示图**（`media.thumbnails`，上游 `large` 档、长边 960）：宫格铺满 1/3 宽不吃亏，展开到卡片宽度也不发虚；`bmiddle`（长边 360）太糊，只在缺 `large` 档时兜底。卡片不加载 `media.images` 原图，也不为预览单独请求原图——展开即命中宫格已缓存的同一地址。
- 展开布局：宽度与卡片内容区一致，每张按自己的比例撑开高度（竖图长、横图短，切换时视窗高度随之回弹），图片 `object-contain` 居中不裁剪；上游缺尺寸时不设框，按图片自然高度落位。多图用 `@components/ui/carousel`（embla）轮播，点第几张就从第几张开始。
- **为什么高度要钉在根节点上**：embla 的幻灯片是同一行 flex，行高由组内最高的那张决定——只改每张幻灯片自身高度，组里只要有一张长竖图，切到横图时下方仍会留一大片空白。因此轮播根节点按**当前项**的宽高比设 `aspect-ratio` 并 `overflow-hidden` 裁掉溢出，`CarouselContent` 加 `items-start` 防止各项被拉齐到最高。
- 切换交互不占画面：左右各留四分之一热区，点击热区切换上/下一张，鼠标移到热区上才浮出圆形箭头，到端点不响应也不浮出；中间一半区域点击收起预览回到宫格（Esc 同样收起），右下角标出「当前 / 总数」。加载前按 `media.sizes` 的 largest 档比例占位，单张展开与加载完成前后不跳高度。
- 宿主侧的超大图降级（超过 24MB 换 `bmiddle`）对展示图同样生效：`/orj960/` 也纳入可替换的尺寸目录。

### 2.5 稳定性与使用限制

| 项 | 现状 | 影响 |
|----|------|------|
| 契约性质 | 网页端内部接口，无版本承诺 | 前端改版即可能改字段/参数，需按接口集中封装单点适配 |
| 单页上限 | 约 50 条 | 首页一次最多拿 50 条，更多需翻页 |
| 历史可达深度 | 约 20 页见底 | 更早内容取不到，不适合做全量归档（本模块不做全量归档） |
| 游标 | `max_id` 不规律、不可构造 | 只能串行翻页，无法并行请求多页 |
| 广告混入 | `ad`/推广位存在 | 必须按标记过滤，否则污染增量游标 |
| Cookie 有效期 | 天级到周级，随登录环境变化 | 失效后需重新登录并覆盖保存 |
| 频率限制 | 短时高频触发 418 / 空列表 | 相邻请求至少间隔 1.2s，失败退避而非重试 |
| 境外/代理访问 | 可能直接跳登录或返回空 | 需要与登录时一致的网络出口 |
| 图片直链 | 图床按 Referer 放行，直连必被拒 | 宿主代理带 Referer 取回，失败自行隐藏；大图走原文 |
| 图片缓存 | 落 globalStorage 的 `weibo-media`，上限 800 个文件 | 超出按修改时间删旧；缓存损坏可整目录删除重建 |
| 表情直链 | 表情 CDN 偶发 403 | 降级为 `[表情名]` 文本或浏览器 alt 文案，不阻断正文 |

### 2.6 点赞（写操作）

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

评论点赞（与主贴点赞走不同端点）：

```
POST https://weibo.com/ajax/statuses/updateLike
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
Cookie / Referer / Origin / X-XSRF-TOKEN 同主贴点赞
object_id={评论数字 id}&object_type=comment&fp={33 位设备指纹}
```

- 取消：`POST https://weibo.com/ajax/statuses/destroyLike`，参数只留 `object_id` 与 `object_type`，不带 `fp`。
- 协议 `weibo/comment/like`，入参 `{ cid, liked }`，`cid` 必须是评论数字 id；回包以 `ok > 0` 或 `result: true` 判定成功，`like_counts` 缺失时前端沿用本地增减。
- 前端：入口在评论与子评论的操作行（图标 + 计数，排在操作组最后），乐观更新点赞态与计数、失败回滚并提示，同一评论请求进行中丢弃后续点击（`hooks/useWeiboCommentLike.ts`）；初始点赞态取评论项上的 `liked`，缺失按未赞处理。
- 子评论同样带 `like_counts` / `liked`，归一化时与一级评论同口径，`useWeiboCommentLike` 只依赖 `{ id, likes, isLiked }` 三个字段，两种评论共用同一份实现。

### 2.7 评论读取与发布

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
- 归一化：正文复用主贴的 `parsePostSegments`（文本 + 表情 + 链接分段），纯文本口径把表情还原成 `[名称]`、链接只留文字；时间走同一套 `parseWeiboCreatedAt`；头像过图床白名单；作者认证与主贴同口径取 `user.verified`（缺失按未认证），前端在作者名后渲染认证角标。
- 子评论：一级评论项上的 `comments` / `reply_comments`（两种字段名都兼容）按同一套正文口径归一化，最多保留 3 条预览；子评论总数取 `total_number`（回退 `comments_count`），被回复者昵称取 `reply_comment.user.screen_name`、uid 取 `reply_comment.user.id/idstr`，前端渲染成缩进块 + 「回复 @某人」，其中 @昵称渲染为超链接：有 uid 用 `https://weibo.com/u/{uid}`，缺 uid 时退到 `https://weibo.com/n/{昵称}`，两者都整段转义，点击仍交宿主打开。

展开更多回复：

```
GET https://weibo.com/ajax/statuses/buildComments
    ?is_reload=1&id={一级评论 id}&is_show_bulletin=2&is_mix=1&fetch_level=1
    &max_id=0&count=20&uid={当前登录 uid}&locale=zh-CN
```

- 与一级评论同一端点：`is_mix=1` + `fetch_level=1` 切到回复列表，`id` 换成一级评论的数字 id。
- 两页都带 `is_reload=1`：首页 `max_id=0`；翻页额外带 `flow=1`，`max_id` 换成上一页游标（实测第二页为 `flow=1&is_reload=1&id={评论 id}&...&max_id=5367761946544614&count=20`）。
- 协议 `weibo/comment/replies`，入参 `{ id, maxId?, count? }`，结果只回 `replies` 与 `maxId`（总数仍以一级评论上的 `replyCount` 为准）；前端按 `maxId` 续翻，与预览按 id 去重拼接。
- 前端：评论按钮点击才展开（未展开不请求），默认 10 条/页，「加载更多评论」按 `max_id` 串行翻页；失败内联提示并给重试，不弹 toast。评论列表限高滚动（`max-h-80`），发布框与「加载更多」固定在滚动区之外。

发布评论：

```
POST https://weibo.com/ajax/comments/create
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
Cookie / Referer / Origin / X-XSRF-TOKEN（取自 Cookie 的 XSRF-TOKEN）
id={微博数字 id}&comment={正文}&pic_id=&is_repost=0&comment_ori=0&is_comment=0&fp={33 位设备指纹}
```

- 参数取自网页评论框实测：不带 `forward` / `reply`，纯文本评论的 `pic_id` 传空串，`fp` 用 `buildWeiboFingerprint` 生成（33 位、首位 0，与网页同形）。
- 协议：`weibo/comment/create`，入参 `{ id, text }`；宿主侧按 1–140 字收窄（`WEIBO_COMMENT_MAX_LENGTH`），提交前再 `trim` 一次。
- 回包 `{ ok, data, msg }`，成功时 `msg` 为「评论成功」、`data.id` 是新评论 id（当前不消费，列表重拉即可）。
- 成功判定：`ok > 0`；`ok <= 0` 取 `msg` 抛业务错误（含「频繁 / 过快」归为限流码），拿到 HTML 回包按登录态失效处理；写操作不重试。
- 前端：发布成功后清空输入并重拉第一页（新评论在最前，顺带刷新总数），失败弹 toast；输入框 `maxLength` 与协议上限同源，`Ctrl / Cmd + Enter` 直接发送。
- 前端分层：取数（首屏 / 续载 / 子评论展开、游标与代际丢弃）在 `hooks/useWeiboCommentThread.ts`，写操作（发布 / 回复 / 同时转发 / 删除，含单飞与部分成功处理）在 `hooks/useWeiboCommentActions.ts`；视图拆为 `block/CommentComposer.tsx`（发布框）、`block/CommentItem.tsx`（条目与子评论）；滚到底续载与失败原地重试由公共 `LoadMoreSentinel` 承担。
- 发布框右下角的「同时转发」开关打开时走 `weibo/repost` 的 `commentWithRepost`（评论并转发）：宿主分两步执行——先发评论、再转发（`is_repost=1` 本身不生成评论），成功后同样重拉评论第一页；回复他人评论时不提供该开关（回复不能顺带转发原博）。
回复评论：

```
POST https://weibo.com/ajax/comments/reply
Content-Type / Cookie / Referer / Origin / X-XSRF-TOKEN 同发布
id={微博数字 id}&cid={被回复评论 id}&comment={正文}&pic_id=&is_repost=0&comment_ori=0&is_comment=0&fp={设备指纹}
```

- 协议复用 `weibo/comment/create`，入参多一个可选的 `replyToId`（即 `cid`），给出即走回复端点；回包 `msg` 为「回复成功」、`data.reply_comment` 带被回复评论。

删除评论：

```
POST https://weibo.com/ajax/statuses/destroyComment
Content-Type / Cookie / Referer / Origin / X-XSRF-TOKEN 同发布
cid={评论 id}
```

- 协议 `weibo/comment/destroy`，入参 `{ cid }`；回包同为 `{ ok, data, msg }`，成功时 `msg` 为「删除成功」。
- 加入 AI 对话：协议 `weibo/comment/addToChat`，入参 `{ commentId, authorName, text, createdAt, replyToName }`；评论没有永久链接，宿主用 `weibo-comment:{评论 id}` 作去重键，一级评论与子评论共用同一方法（子评论带 `replyToName` 标明被回复者），前端按评论 id 单飞并显示「添加中…」。
- 前端：每条评论都有「回复」，只有当前登录账号自己的评论才显示「删除」（`viewerUid` 与 `comment.author.id` 比对，uid 由 `weibo/profile` 或分组结果给出、经列表逐层透传）；删除走单个确认弹窗，成功后重拉第一页；回复复用底部发布框，只在框上方回显「回复 @某人」并可取消，提交时带 `replyToId`。

### 2.8 长文展开

```
GET https://weibo.com/ajax/statuses/longtext?id={mblogid}
```

- `id` 用 mblogid（如 `Rs4KtdzoV`），数字 id 也能取到；只接受字母数字，避免拼进查询串的任意内容。
- 响应 `{ ok, data: { longTextContent, longTextContent_raw, topic_struct, url_struct } }`；正文优先 `longTextContent`，为空回退 `longTextContent_raw`，两者皆空按失败处理，**不拿空串覆盖卡片摘要**。
- 时间线里长文摘要末尾带展开提示，形式可能是 `<a>展开</a>`、`<a>...展开</a>`、`<a>展开全文</a>`，也可能是纯文本 `……展开`。归一化阶段统一剥掉：先删带 `<a>` 外壳的链接，再删末尾残留的 `……`/`...` 截断省略号。
- 卡片默认显示全文：长文卡片正文首次进入视口（提前 240px）即自动请求本接口，拿到全文后整段替换摘要，不需要用户点「加载全文」；同一张卡片同一时刻只允许一条在飞，取全文失败保留摘要并放出「重新加载全文」按钮，不再自动重试。分页加入的卡片各自按视口触发，避免一次性把整页长文全部请求出去。
- 正文折叠：卡片可见纯文本超过 200 字先收成约 6 行（`max-h-36`），底部渐隐并压一个下箭头，按钮「展开全文 / 收起」只切换本地展开态、不发请求；长文全文到货后按全文重新判定，摘要够短就保持铺开。主贴与转发体各自独立，渐隐底色分别取卡片底与 `muted` 底。
- 转发体同样自动展开：引用块进入视口即用它自己的数字 id 请求本接口（转发体没有 mblogid），成功替换引用块正文，失败保留摘要并留重试入口；主贴与转发体各自独立计数与限流，互不阻塞。卡片上已取到的转发全文会随「保存到笔记」「添加到 AI 对话」的载荷带出，宿主不再重复请求。
- 该清理**只对 `isLongText` 为真**的微博执行，普通正文里出现的「展开」与省略号保持原样。
- `isLongText` 判定：上游 `isLongText === true` 或存在 `longText` 对象。

### 2.9 常见反爬与合规边界

合规且有效的做法（本模块已实现）：

- 请求头保持真实浏览器上下文（`Referer` / `UA` / `X-Requested-With`），不做伪装客户端。
- 相邻请求最小间隔 1.2s，同一进程共享节奏，避免多面板并发打满。
- 只对网络错误与 5xx 做指数退避重试（≤2 次），401/403/418 一律不重试。
- 失败按分类码提示（未配置 / 登录失效 / 限流 / 上游异常 / 网络），引导用户自行处理，不静默重试。
- 只读单账号自身关注流，不做批量采集、不落公共库。

明确不采用：UA 轮换与代理池、验证码/滑块绕过、设备指纹伪造、Cookie 池共享、并发拆页抓取。这些手段既违反平台协议，也会直接触发账号风控，代价远高于收益。

### 2.10 实现位置

| 文件 | 职责 |
|------|------|
| `src/shared/types/weibo.ts` | 时间线、信息流、分组、凭证与协议载荷契约，含参数收窄与单页默认条数 |
| `src/shared/types/weiboMethods.ts` | 协议方法名表 `WEIBO_METHODS`：前端取数层、宿主 `weiboRoutes` 的 switch 与 `HostMethodName` 共用一份，方法名只在表中出现 |
| `src/modules/weibo/weiboEndpoints.ts` | 地址总表：网页端 ajax 端点、图床 / 站内基址与外链主机白名单集中在此（协议方法名见 `@shared/types/weiboMethods`） |
| `src/modules/weibo/webClient.ts` | 通用 JSON 请求：URL 构造、请求头、错误分类、节流与退避重试 |
| `src/modules/weibo/webTimeline.ts` | 分页/增量循环、去重、字段归一化、时间与正文清洗 |
| `src/modules/weibo/webFeed.ts` | 时间线 / 热门 / 分组端点适配、分组归一化与卡片流提取 |
| `src/modules/weibo/webEmoticons.ts` | 表情配置：`statuses/config` 取数与表情条目归一化 |
| `src/modules/weibo/webTopics.ts` | 话题搜索：`mblog/topic` 取数与话题名归一化 |
| `src/modules/weibo/webPublish.ts` | 发布：`pic_upload.php` 传图换 pid（裸字节、无签名）、`statuses/update` 表单提交、指纹生成与回包解析 |
| `src/modules/weibo/webHotRank.ts` | 侧栏热搜榜：`bandUnified` 取数与 realtime 条目归一化 |
| `src/modules/weibo/webProfile.ts` | 账号信息：`profile/info` 取数与 user 字段归一化 |
| `src/modules/weibo/webCredential.ts` | Cookie 清洗、SecretStorage 存取、凭证状态 |
| `src/modules/weibo/weiboCache.ts` | 元数据缓存：`{存储根}/weibo.json` 读写、账号指纹、逐字段校验与原子落盘 |
| `src/modules/weibo/weiboAvatar.ts` | 头像缓存：下载落盘 `{存储根}/weibo_avatar.jpg`、读回 data URI、清除 |
| `src/modules/weibo/warmup.ts` | 激活预热：分组 / 账号信息 / 热搜 / 表情串行取一次并写缓存，失败静默 |
| `src/modules/weibo/mediaProxy.ts` | 图片代理：带 Referer 取图、本地缓存、并发去重与容量清理 |
| `src/modules/weibo/webInteraction.ts` | 写操作：主贴 `setLike` / `cancelLike`、转发 `setLike` / `cancelLike`（form + fp）与评论 `updateLike` / `destroyLike`（带 fp），补 Origin 与 X-XSRF-TOKEN |
| `src/modules/weibo/webComments.ts` | 评论读取与写操作：`buildComments` 参数构造、分页游标、评论归一化，`comments/create` / `comments/reply` / `destroyComment` 表单提交与错误分类 |
| `src/modules/weibo/webLongText.ts` | 长文读取：`longtext` 取全文、正文优先级与失败兜底 |
| `src/modules/weibo/webLikes.ts` | 我的赞：`statuses/likelist` 页码取数、总数与是否还有下一页判断 |
| `src/modules/weibo/webUserBlog.ts` | 他人主页：`profile/info` 定位用户（uid 或昵称）+ `statuses/mymblog` 页码取数、总数与是否还有下一页判断 |
| `src/modules/weibo/webFriends.ts` | 关注分组与备注：`getGroupList` + `getGroups` 读取、`createGroup` 新建、`setGroup` 归组、`remarkUpdate` 设置备注（均按 form 提交） |
| `src/modules/weibo/webReposts.ts` | 转发列表：`repostTimeline` 页码取数、转发项归一化（含点赞计数与点赞态）与分页判断 |
| `src/modules/weibo/videoServer.ts` | 视频中转：回环 HTTP 服务补 Referer，能用 ffmpeg 就把 AAC 音轨转成 MP3（Webview 无 AAC 解码器）边转边发，否则原样流式转发 |
| `src/modules/weibo/weiboRoutes.ts` | `weibo/timeline`、`weibo/feed`、`weibo/likes`、`weibo/userBlog`、`weibo/user/groups`、`weibo/user/groupCreate`、`weibo/user/groupSave`、`weibo/user/remark`、`weibo/groups`、`weibo/hotRank`、`weibo/profile`、`weibo/emoticons`、`weibo/topics`、`weibo/publish`、`weibo/comments`、`weibo/comment/create`、`weibo/comment/destroy`、`weibo/comment/replies`、`weibo/comment/addToChat`、`weibo/comment/like`、`weibo/reposts`、`weibo/repost`、`weibo/repost/like`、`weibo/repost/addToChat`、`weibo/destroy`、`weibo/longtext`、`weibo/credential/*`、`weibo/blockList/*`、`weibo/image`、`weibo/video`、`weibo/like`、`weibo/openPost` 分发 |
| `src/modules/weibo/panel.ts` | 面板消息通道、凭证与缓存注入、图片代理装配与本地资源白名单 |
| `src/modules/common/webviewHtml.ts` | CSP 生成：默认不放行远程图，需要时可按调用方传入的 `imgSources` 放行 |
| `src/shared/utils/weiboText.ts` | 正文纯文本切分：`@账号` / `#话题#` / 微博域名链接，宿主与 Webview 共用（零前端依赖） |
| `src/shared/utils/weiboBlock.ts` | 屏蔽名单：多行文本与名单数组互转、归一化、按作者名与关键字判定单条是否隐藏，宿主保存与 Webview 过滤共用 |
| `src/weibo/` | Webview 入口：顶部固定菜单、账号菜单与设置弹窗（同城城市 + 屏蔽名单）、右侧热搜榜、信息流列表、卡片（头像 / 图文混排 / 表情）与发表框（表情 / 话题 / 图片选择器） |
| `src/weibo/block/WeiboVideoPlayer.tsx` | 视频播放器：自绘控件栏、中央播放键、空格播放/暂停、控件自动隐藏、清晰度角标、静音与全屏 |
| `src/weibo/utils/weiboCount.ts` | 互动数展示：万级折算成 `x.x万`（十万级以上取整），非法输入回 `0` |
| `src/weibo/layout/HotSearchView.tsx` | 热搜专页：一个标签一张榜，整页榜单渲染、专页行样式与同城城市切换入口 |
| `src/weibo/block/WeiboHotRankRow.tsx` | 侧栏热搜行样式：序号 / 标题 / 副行 / 整行点击与 Tooltip（专页有自己的行组件，不共用） |
| `src/weibo/block/WeiboHotRankBadge.tsx` | 热搜徽标：icon_desc + 底色，`sm` / `md` 两档，侧栏与专页共用 |
| `src/weibo/block/WeiboHotRankPosition.tsx` | 热搜名次：前三名判定（`rank >= 1`）与两档字号/颜色，侧栏与专页共用 |
| `src/weibo/block/WeiboHotRankFallback.tsx` | 热搜三态占位：未配置 / 加载 / 失败或空榜，`sidebar` / `page` 两套尺寸与文案 |
| `src/weibo/hooks/useWeiboSearchOpen.ts` | 搜索页地址 + 300ms 连点保护的打开动作 |
| `src/weibo/layout/WeiboTopicPicker.tsx` | 发表框话题面板：搜索框 + 常用话题列表，选中插入 `#话题#` |
| `src/weibo/layout/WeiboImagePicker.tsx` | 发表框图片面板：uploads 图片网格、勾选与直接上传 |
| `src/weibo/hooks/useWeiboTopicSearch.ts` | 话题搜索：常用话题加载、300ms 去抖与乱序回包丢弃 |
| `src/weibo/hooks/useWeiboComposerImages.ts` | 发表框图片库：清单读取、选择上传与粘贴上传 |
| `src/weibo/hooks/useWeiboPublish.ts` | 发表框发布：单飞提交、成功回执与超时口径 |
| `src/weibo/hooks/useWeiboEnhance.ts` | 发表框 AI 优化：`ai/enhancePrompt` 的微博口径请求与进行态 |
| `src/weibo/utils/weiboLinks.ts` | 站内链接构造与识别：个人主页（`/u/{uid}`、`/{uid}`、`/n/{昵称}`）地址与 `readProfileTarget`、热搜搜索页地址（纯函数） |
| `src/weibo/hooks/useWeiboUserBlog.ts` | 他人主页取数：目标变化即重取首屏、页码翻页、同用户资料不替换与屏蔽过滤 |
| `src/weibo/layout/UserBlogView.tsx` | 他人主页页面：资料页头（封面 / 头像 / 简介 / 计数 / 返回）与微博列表（复用 `WeiboFeedSection`） |
| `src/weibo/context/weiboUserPageContext.ts`、`WeiboUserPageProvider.tsx` | 页内主页导航：context 与读取 Hook 单独成文件，Provider 只导出组件 |
| `src/weibo/layout/UserFollowAction.tsx` | 主页关注动作：未关注直接关注，已关注悬停展开「设置分组 / 设置备注 / 取消关注」 |
| `src/weibo/layout/UserGroupDialog.tsx`、`UserRemarkDialog.tsx` | 设置分组（勾选 + 新建）与设置备注（1-15 字，留空清除）两个弹窗 |
| `src/weibo/hooks/useWeiboUserGroups.ts`、`useWeiboUserRemark.ts` | 分组读取 / 新建 / 归组与备注保存的控制器（写操作单飞） |
| `src/weibo/block/WeiboItemActionBar.tsx` | 条目操作行骨架：时间 + 删除 / 附加动作 / 加入 AI 对话 / 点赞，评论行与转发行共用，差异由 `extra` / `timeSuffix` / `deleteLabel` 注入 |
| `src/weibo/hooks/useWeiboPageNav.ts` | 视图导航：当前视图 + 页内主页目标与切换动作；切页必清主页目标，uid 未识别时只提示不拼空地址 |
| `src/weibo/hooks/useWeiboRefresh.ts` | 顶栏刷新：分发到主页 / 信息流 / 热搜 / 首页，并给出对应的刷新摘要，刷新前先把滚动归零 |
| `src/weibo/hooks/useWeiboGroupsView.ts` | 分组衍生值：我的分组、频道池与时间线 `list_id`，三项各自 `useMemo` 保持引用稳定 |
| `src/hooks/useIsMounted.ts` | 跨模块通用：异步回包后判断组件是否仍挂载，决定要不要写状态与弹提示 |
| `src/hooks/useScrollTopVisibility.ts` | 回到顶部按钮：监听 ScrollArea viewport 的滚动位置，超过阈值显示按钮，点击复用 `scrollAreaToTop` 归零 |
| `src/shared/utils/color.ts` | 按底色亮度选可读前景色，供徽标等浅深底自适应 |

### 2.11 多入口信息流（首页 / 时间线 / 热门 / 分组）

顶部菜单在一行内排完：一级分组（首页 / 热门 / 热搜，带图标）→ 一条竖线 → 当前分组的二级频道，首页组的自建分组直接续在「推荐 / 时间线」后面同属二级，即「🏠 首页 🔥 热门 📈 热搜 │ 推荐 时间线 颜值 时尚 动漫 …」（`@components/ui/navigation-menu` 的 List / Item / Link 槽位 + `ui/separator`，不用下拉浮层）；点一级直接落到该组首项，不需要再点一次二级。顶栏动作区放「刷新」与账号菜单（头像 + 昵称），菜单里收回「个人主页」「我的赞」「设置」「删除 Cookie」。菜单挂在 `AppHeader` 内，随标题区固定，不参与内容区滚动。

| 分组 | 子频道 | 接入状态 |
|------|--------|----------|
| 首页 | 推荐 / 时间线，其后追加账号自建分组 | 已接入 |
| 热门 | 推荐 / 实时 / 同城 / 榜单 / 小时榜 / 周榜 / 昨日 / 前日 | 已接入（各频道参数见下） |
| 热搜 | 我的 / 实时 / 同城 / ACG / 文娱 / 社会 / 科技 / 生活 / 体育 | 规划占位 |

- 视图标识：固定频道用 `分组.子项`，自建分组用 `group.<gid>`（`toCustomGroupView` / `readCustomGroupId` 是一对出口）；未接入的频道显示「暂未接入」空态并禁用刷新，不落回首页内容。
- 自建分组是运行时数据，由页面把 `myGroups` 传进菜单；停在 `group.*` 上一级仍回落到「首页」，否则二级会整段消失、无法切回。

| 入口 | 接口 | 关键参数 |
|------|------|----------|
| 首页 | `ajax/feed/unreadfriendstimeline` | 见 2.1；增量刷新只取上次之后的新微博 |
| 时间线 | `ajax/feed/friendstimeline` | `list_id` 取默认分组「最新微博」的 gid，`fid` 同值，`refresh=4`，首屏 `since_id=0`，`count=20` |
| 热门 | `ajax/feed/hottimeline` | 按频道取 `group_id` / `containerid` / `refresh`（见下表），`extparam=discover|new_feed` 固定，首屏 `count=20` |
| 分组列表 | `ajax/feed/allGroups` | 取 `groups[]` 中「默认分组」与「我的分组」两个分区，`myGroups` 直接进菜单 |
| 分组信息流 | `ajax/feed/groupstimeline` | `list_id={所选分组 gid}`、`refresh=4`、`fast_refresh=1`、`count=20` |

- 分组不再有选择页：分组名直接作为首页的二级菜单项，点哪个就按该分组的 `list_id` 取信息流，翻页只在该分组内生效。

热门频道分两层：菜单上只显示「默认预设 + 手动添加」，可选池来自 `allGroups` 的「我的频道」与「频道推荐」两个分区（`group_type: 1`，合并去重，每条含 `gid` / `title` / `containerid`）。

- 默认显示的 8 个频道是 `WEIBO_DEFAULT_HOT_CHANNELS`：推荐 / 实时 / 同城 / 榜单 / 小时榜 / 周榜 / 昨日 / 前日。前四个由 `WEIBO_PINNED_HOT_CHANNELS` 固定（不可移除）；小时榜、周榜、昨日、前日不在 `allGroups` 的频道分区里，靠本地预设下发，但**与补充频道一样可移除**，删掉后回到候选池还能再加回来。
- 菜单行末尾的「＋」是频道管理入口，本身用 `Button size="icon-xs" variant="ghost"`（禁用态、focus ring 与悬停提示统一由 Button 提供，尺寸收到 `size-5` 与二级频道行高对齐）：上半区列可移除的频道（整枚 chip 点击即移除，`Button size="xs" variant="secondary"` + `hover:bg-destructive/15` 提示危险性），下半区列池里尚未上菜单的频道（`Button size="xs" variant="ghost"`，固定 `w-16` 让 2~4 字的候选名等宽成格、每行三枚，超长名字由内部 `truncate` 截断，点击加入并切过去）；数量受 `WEIBO_HOT_CHANNEL_LIMIT`（10）约束，默认 8 个占位，实际可补 2 个；名额满时下半区改提示「名额已满，先移除一个再添加」。
- 「＋」的置灰条件只看「既没候选又没可移除项」——名额用满时更需要的是移除，若按「能否添加」置灰就再也删不掉了；只有推荐 / 实时 / 同城 / 榜单 不出现移除入口。
- 选择状态存会话内（初始即默认 8 个 gid），重开面板回到默认；移除时若正停在该频道上，视图回落到推荐频道，避免内容区停在一个菜单里已不存在的频道。
- 前端菜单登记 `hot.<gid>` 作为视图标识，只拿 `gid` 当 `listId`；`containerid` 一律由宿主按 gid 从频道表查出，不由 gid 推导（有的频道形如 `102803_ctg1_600343_-_ctg1_600343`）。
- 频道表进两层缓存：`fetchWeiboGroups` 回源后写内存缓存（键为凭证，换号不串），路由层命中磁盘缓存时也补一次 `rememberHotChannels`，避免热门取数再回源一次 `allGroups`。
- 磁盘缓存缺少 `hotChannels` 字段（旧版本）按无效处理，强制回源一次，否则「+」弹层会一直为空。
- 热门请求的 `refresh` 统一按首屏语义取 `0`；指定 gid 查不到时回落频道表首项，表为空才用 gid 与 containerid 同值的兜底（推荐频道就是这种形态）。

- 分组结构：`groups[0]` 为「默认分组」、`groups[1]` 为「我的分组」；宿主按标题精确匹配，标题缺失才回落下标，避免分区顺序微调后取错。
- 时间线的 `list_id` 由宿主在 `weibo/groups` 结果里算好（`timelineListId`，取「最新微博」条目），前端不自行挑条目；缺省时宿主还会再取一次 allGroups 兜底。
- 三种信息流共用同一条 `weibo/feed` 协议与同一套分页/增量状态机：`source` 只决定端点与固定参数，游标语义与 2.3 完全一致。
- 热门流的响应结构可能是 `data.cards[].mblog`（卡片流），时间线与分组通常是 `statuses[]`；宿主统一提取，`max_id` / `since_id` 为 `"0"` 时视为没有更多，避免「加载更多」被永久点亮。
- 列表滚动到底自动翻页：底部哨兵距视口一屏（`rootMargin: 240px`）即预取下一页，同一轮加载只有一条在飞；连续自动加载满 10 次、或上一次取数失败时，底部改出「加载更多」按钮交还用户手动点，刷新替换列表后自动额度重置。到底显示「已经到底了」，不再给按钮。
- **刷新与切页都把滚动条拉回顶部**：滚动宿主是 `AppContent` 里 ScrollArea 的 viewport，统一走 `@shared/utils/scrollArea` 的 `scrollAreaToTop(root)`（按 `SCROLL_VIEWPORT_SELECTOR` 找，找不到就静默跳过）。顶栏「刷新」在发起请求前先回顶，刷新等于重开一屏；切换导航视图由 `useEffect([view])` 在提交后回顶，不会停在上一页滚到很深的位置。
- 个人主页按 `weibo/groups` 给出的账号 uid 拼 `https://weibo.com/u/{uid}`，经 `weibo/openPost` 的白名单校验后交给宿主打开；uid 缺失时只提示不跳转，不拼空地址。
- 设置是弹窗而不是视图：放同城热搜城市与两个屏蔽名单（用户名 / 关键字），Cookie 的保存与清除不在这里（首页凭证卡 + 账号菜单）；未配置时任何信息流都不发请求，只给「去设置」的引导。
- 设置弹窗走通用骨架 `FormDialog`（标题 / 说明 / 取消与保存）：改动先落在本地草稿，点「保存」才提交，无改动时保存禁用；关闭或取消丢弃草稿，下次打开回到已保存值；城市下拉用 `position="popper"` + `max-h-64` 限高后内部滚动，几百个城市不会把弹窗撑满。
- 两个名单都是多行文本、每行一项，保存时经 `parseWeiboBlockListText` 归一化（去空白、忽略大小写去重、超长截断）；城市与名单共用一个提交按钮，都改动时先存城市、成功后再存名单，任一失败保留草稿供重试。
- **屏蔽在取数 hook 返回前过滤**：`useWeiboTimeline` / `useWeiboFeed` / `useWeiboLikes` 接收 `blockRules`，用 `filterWeiboPosts` 派生可见列表，状态里仍保留原始列表——名单变化（含卡片「屏蔽该博主」）时无需回源即可即时重算，分页游标、页码与 `hasMore` 也不受影响。
- 名单落 VS Code 配置 `zhai.weibo.blockedUsers` / `zhai.weibo.blockedKeywords`（面板「设置」按行编辑，也可在设置文件里改数组）；路由为 `weibo/blockList/status` 与 `weibo/blockList/save`，宿主只存取与归一化，过滤一律在 Webview。
- 卡片「更多」菜单末项是「屏蔽该博主」：只把作者名追加进用户名名单（已存在则提示而不重复写盘），写入成功后由过滤即时隐藏当前列表里的该博主内容，并用 Toaster 反馈结果。
- 关注入口按作者 `isFollowing` 分流：未关注的在卡片头部给「关注」按钮，关注成功后按钮变「已关注」并禁用，取关放进「更多」菜单。协议 `weibo/author/follow`（`{ uid, following }`）：关注走 `ajax/friendships/create`，form 提交 `friend_uid` 与固定来源参数 `uicode=20000405` / `fid=232184` / `page=hotWeiboTab`；取关走 `ajax/friendships/destory`，只提交 `uid`。上游要求的 `followcardid` 与 `rid` 是每次渲染卡片时生成的动态 id，本项目没有该上下文，故不提交。**回包的 `following` 不可信**：实测关注成功后回包仍带 `following: false`，故结果一律按请求的目标状态回传，避免出现已关注却提示「已取消关注」。
- 账号菜单四项：「个人主页」按 uid 打开 `weibo.com/u/{uid}`；「我的赞」切到 `mine.likes` 视图读取点赞列表（见 2.16）；「设置」打开弹窗；「删除 Cookie」先弹确认框，确认后清除凭证、元数据缓存与本地头像，并回首页（凭证卡按未配置状态自动出现，用户下一步多半是重新登录），未配置时该项禁用。

### 2.12 表情配置（发表框）

```
GET https://weibo.com/ajax/statuses/config
```

- 只读 `data.emoticon.ZH_CN.<分类>[{ phrase, url }]`：10 个分类、340 条，分类名直接写入 `category` 供前端分组。
- `data.emoticonRender`（phrase/别名 → 图片的渲染映射，7000+ 条，含多语言与拼音别名）不参与解析，避免别名造成大量重复项。
- 单条必须同时具备 `phrase` 与合法图地址（过 2.4 的图床白名单）；类内重复 `phrase` 以首见为准，跨类重复保留，保证每个分类的条目数与上游一致。
- 拿不到任何条目时，错误信息会带上实际返回的字段名，接口改版时据此定位。
- 发表框 Popover 顶部是分类切换条（横向滚动，默认选中第一个分类），下方按当前分类分页：首屏 40 个，滚动到底点「加载更多表情」再追加 40 个；切换分类会重置分页计数。
- 表情图仍经 `weibo/image` 代理换 data URI，本地缓存命中即零网络；点击表情插入到 textarea 光标处（无选区时追加到末尾），插入后恢复光标；超出 2000 字上限时拒绝并提示。
- 表情配置在前端模块级缓存（会话内只取一次）；未配置 Cookie 时按钮禁用，面板内提示先去设置。

### 2.13 侧栏热搜榜

```
GET https://weibo.com/ajax/side/bandUnified?type=mine&last_tab=mine&last_tab_time={秒级时间戳}
```

- `last_tab_time` 取当前秒级时间戳，与网页端一致；`type` 与 `last_tab` 固定 `mine`。
- 榜单条目在 `data.realtime`；也可能嵌在 `data.band_list[*].realtime` 里，此时取第一个含 realtime 的分区。
- 单条映射：标题取 `word_scheme`（与网页端一致，话题词自带 `#`）→ `note` → `word` → `title`；名次取 `realpos`（网页端真实排名），缺失时用 `rank + 1`（上游 `rank` 是 0 起序号），再缺失才回落到数组下标；`description` 与 `icon_desc`（缺失用 `label_name` 兜底）各自渲染为 badge；图标取 `icon_url` → `icon`，过图床白名单后直接显示；`icon_desc_color` 作为 `icon_desc` 徽标的底色，只接受 `#rgb` / `#rrggbb` / `rgb()`，其余丢弃。
- 广告位（`is_ad: 1` / `ad_state: 1`）、标注「商」或「上新」的推广位（`icon_desc` 或兜底的 `label_name` 含这两个关键字，这类位往往不带 `is_ad`）与缺标题的条目不进榜，且不影响其余条目的名次；榜 1–3 的序号用 `text-red-500` 加粗，其余弱化。
- 侧栏在容器宽度 ≥ 768px（`@3xl`）时出现在列表右侧，窄面板自动隐藏；宽档下用 `sticky top-3 self-start` 钉在内容区滚动视口内，不随左侧信息流滚走（缺 `@3xl:block` 会一直 `display:none`，缺 `self-start` 会被拉伸到父容器高度而没有粘住行程）；面板内点刷新可重新取数，未配置 Cookie 时只给引导；空榜单（含未配置、加载、失败）不显示右上角刷新按钮，重试入口只在空态里。
- 热搜页（`search.*`）不渲染这张卡：榜单已在专页整页展示，侧栏只服务信息流的边看边刷。
- 标题下的说明行显示「更新于 本地时分」，时刻取宿主回包的 `fetchedAt`（ISO），与榜单内容同一次请求同源，而不是前端计时；首次取数前或回包时刻非法时该行留空，标题区不跳动。
- 卡片的四种状态都由 `StateEmpty` 承载：未配置 Cookie（`Cookie` 图标 + 取数前提说明）、首次加载（`Spinner` + 正在读取）、失败与空榜单（`Flame` + 重试按钮作底部操作区，有错误信息时标题为「热搜读取失败」、说明用上游错误文案，否则是「暂时没有热搜内容」+ 刷新建议）；侧栏内统一用紧凑间距（`gap-3 p-3`），未配置态不在卡片内重复放按钮，入口在顶栏账号菜单的「设置」。
- 榜单用 `ItemGroup`（自带 `role="list"`）+ `Item`（补 `role="listitem"`）承载，不再用 `ol/li`：序号走 `ItemMedia variant="icon"`（`w-4 justify-end`，两位数不推歪标题）、标题走 `ItemTitle`（`line-clamp-1` 单行截断）、`description` 作标题下的副行走 `ItemDescription`、`icon_desc` 作为行尾 `Badge` 收进 `ItemActions`；条目只展示文字，上游 `icon_url` 仍随回包下发但前端不再渲染成图片。
- 条目整行点击打开 `https://s.weibo.com/weibo?q={encodeURIComponent(title)}`（`s.weibo.com` 属 `weibo.com` 子域，`weibo/openPost` 白名单放行；注意该协议对 url 有 512 字符上限）；悬停整行（触发器是 `Item` 本身，不是标题链接）用 `Tooltip` 显示完整标题，气泡沿用 `TOOLTIP_CLASS` 的暗底亮字并放左侧，调用处再叠 `ring-1 ring-border shadow-lg`——气泡底色固定 `#1E1E1E`，暗色主题下与侧栏底色几乎同值，没有轮廓就分不出边界；悬停时整行铺 `hover:bg-muted`，标题、序号与描述同时提亮（`Item` 自带 `group/item`）；标题本身是 `a`，只为键盘可达与右键复制地址，点击 `preventDefault` 后冒泡回整行处理器，避免打开两次或让 webview 自行导航。

#### 热搜专页（多标签）

```
我的    GET https://weibo.com/ajax/statuses/mineBand
热搜    GET https://weibo.com/ajax/side/hotSearch
文娱    GET https://weibo.com/ajax/statuses/entertainment
社会    GET https://weibo.com/ajax/statuses/social
科技    GET https://weibo.com/ajax/statuses/technology
生活    GET https://weibo.com/ajax/statuses/life
体育    GET https://weibo.com/ajax/statuses/sport
ACG     GET https://weibo.com/ajax/statuses/acg
同城    GET https://weibo.com/ajax/statuses/city?citycode=80086{四位行政区划代码}
```

- 页面 `src/weibo/layout/HotSearchView.tsx` 承载顶栏「热搜」一级菜单的 9 个二级项：一个标签一个端点，切换由菜单驱动，页面内不再重复一排标签。
- 端点差异只落在地址上（`weiboEndpoints` 的 `WEIBO_AJAX_PATHS`），标签到地址的映射在 `webHotRank.ts` 的 `HOT_RANK_TAB_PATHS`；`weibo/hotRank` 的 `tab` 取值受 `isWeiboHotRankTab` 收窄，防止被当作路径片段拼接。
- 同城 citycode 规则：固定前缀 `80086` + 四位行政区划代码（如南宁 `4501` → `800864501`）。城市在面板「设置」弹窗里按城市名选择，落 `zhai.weibo.cityCode`（也可在工作区设置里手填其它城市的四位代码）；未配置或非法值回落南宁。预置城市清单按城市名拼音升序排列，下拉里近似字典序。
- 只有 `band`（侧栏 `bandUnified`）参与 `weibo.json` 缓存；其余标签与同城的榜单内容各不相同，一律实时回源，避免不同标签串数据。
- 专页使用自己的行组件 `HotSearchRow`（本文件内）：宽页不挂 Tooltip、标题单行截断、徽标略大一档，整行点击打开搜索页；不复用侧栏那一份行样式，侧栏仍用 `layout/WeiboHotRankRow.tsx` 且只取前 10 条。
- 两份行组件共用四类能力，避免同类逻辑各写一份：名次与前三名高亮 `layout/WeiboHotRankPosition`（`sm` / `md`）、徽标 `layout/WeiboHotRankBadge`（`sm` / `md`）、搜索地址与连点保护 `hooks/useWeiboSearchOpen`（地址规则在 `utils/weiboLinks`）、三态占位 `layout/WeiboHotRankFallback`（`sidebar` / `page`）。
- 热搜页不渲染右侧热搜卡，避免同一份榜单出现两次；该页内容区放宽到 `max-w-3xl`。
- 顶栏「刷新」在热搜页刷当前标签的榜单（专页内不再有重复的刷新按钮，只有空态里的「重试」），在信息流页仍按原有游标语义刷新；当前视图内容为 0 时顶栏不渲染刷新按钮，信息流空态自带「刷新」入口（首页空态原本就有）。

### 2.14 元数据缓存（分组 / 热搜 / 表情）

```
{存储根}/weibo.json
```

- 三项只在**扩展激活时预热一次**：`warmup.ts` 依次取 `allGroups` / `bandUnified` / `statuses/config` 并写入缓存；之后面板打开、切页、顶栏刷新都不再回源。侧栏热搜卡与热搜专页的刷新按钮可强制回源 `weibo/hotRank`（入参 `refresh: true`，只对 `band` 生效；其它标签本就实时回源）。
- 预热必须串行：`webClient` 的最小间隔依赖模块级 `lastRequestAt`，并发调用会同时读到旧值而集体放行，只有串行等待才能让 1.2s 节流真正生效。
- 同一账号 15 分钟内不重复预热（文件里的 `warmedAt`），避免开发时反复 Reload Window 反复打接口；凭证缺失直接返回，三项里任一失败只记 `warn`，既不弹窗也不影响扩展激活。
- 文件结构：`version` / `accountKey` / `warmedAt` + 三个条目（`data` + `fetchedAt`）。`accountKey` 是 Cookie 的 SHA-256 前 16 位，**换号即失效**，Cookie 明文绝不落盘；`weibo/credential/clear` 会连带删除整个文件。
- 读取按不可信输入处理：版本不符、账号不符、时间不可解析、条目结构非法一律按未命中；榜单 / 表情 / 分组解析时重新过图床白名单与颜色白名单，非法条目直接丢弃，全部非法视为未命中而不是缓存一个空列表。
- 写入先落 `.part` 再 `rename`，同一进程内的读改写走串行队列，三个来源并发回源不会互相覆盖；跨窗口最后写入者胜出，缓存可重建所以可接受。
- 时间线、信息流与图片都不进缓存：前者变化快且需要游标语义，后者由图片代理的本地缓存 + `data:` 回传承担；混进来还会把带签名的直链写进 `weibo.json`，很快失效且体积不可控。
- 有效期常量 `CACHE_TTL_MS` 默认全为无穷（严格「激活一次」），改成有限值即开启「读取时过期回源」；热搜变化最快，若希望长时间开着窗口也保持新鲜，可单独给它 30 分钟。

### 2.15 账号信息与头像（profile/info）

```
GET https://weibo.com/ajax/profile/info?uid={uid}&scene=profile
```

- `uid` 来自 `weibo/groups` 的 `uid`（分组条目的 uid 即登录账号）；取不到 uid 时预热与手动刷新都直接跳过并报错，不拼空地址。
- 字段映射：`data.user` → `id`（`id` / `idstr` 字符串化）、`screen_name`、`avatar_hd` → `avatar_large` → `profile_image_url`、`verified`、`description`（剥标签解实体）、`followers_count` / `friends_count` / `statuses_count`；缺 id 或缺昵称整体判为不可用。
- 头像地址只作「重新下载」的来源：微博头像 URL 带签名参数会过期，展示一律读本地文件，不读远程地址。
- 用户信息落 `{存储根}/weibo.json` 的 `profile` 字段（与分组 / 热搜 / 表情同一份缓存，同样按 `accountKey` 归属）；头像单独落 `{存储根}/weibo_avatar.jpg`，先写 `.part` 再 rename，读回时按魔数嗅探格式再拼 data URI。
- `weibo/profile` 命中「资料 + 本地头像」时零网络；只有头像文件缺失时才用缓存里的 URL 补一次下载；`refresh: true` 才重新取数。
- 头像经与卡片图片同一份 `mediaProxy` 下载（代理 → fetch → ipv4 → 直连），落盘后由宿主读成 data URI 回传，Webview 不直连图床。
- `credential/clear` 同时删除 `weibo.json` 与 `weibo_avatar.jpg`，避免换号后顶栏露出上一个账号的头像。
- 顶栏动作区合并为一个账号菜单（`WeiboAccountMenu`）：触发器是 `Avatar` + 昵称，菜单内是账号信息（粉丝 / 微博数）、个人主页、我的赞、设置弹窗、删除 Cookie；账号未取到时个人主页禁用、未配置时「我的赞」与删除项禁用，头像缺失回落为昵称首字；未登录时触发器不渲染头像并改用 `outline` 变体，用描边按钮提示「这里还没登录」。

### 2.16 我的赞（账号菜单入口）

```
GET https://weibo.com/ajax/statuses/likelist?uid={uid}&page={页码}&with_total=true
```

- 入口只在顶栏账号菜单（「个人主页」下一项），选中后视图切到 `mine.likes`；该标识不进 `WEIBO_NAV_GROUPS`，顶部菜单不受影响。
- `uid` 由宿主按 `weibo/groups` 的 uid 自行解析，前端只传页码；解析不到 uid 时报错而不是拼空地址。
- 点赞列表只有页码分页（没有 `max_id` 游标）：`weibo/likes` 的 `page` 从 1 起，前端刷新即重取第一页并整体替换，翻页按 `page + 1` 追加去重，到底后不再递增页码。
- 列表条目本身就是微博对象（`data.list[]` 直接给 `id` / `user` / `text` 等字段，**没有 `mblog` 包裹**）；实现同时兼容 `list[].mblog` 与 `data.statuses` 两种层级，单条归一化复用 `normalizeTimelinePost`，渲染仍是 `WeiboFeedList` / `WeiboPostCard`，与首页信息流完全同形。
- `hasMore` 判断：上游给出 `total_number` 时按「页码 × 20 < 总数」估算，缺失时以本页是否取满 20 条为准；`total_number` 随回包下发，仅用于说明覆盖范围。
- 我的赞同受屏蔽名单约束：`useWeiboLikes` 同样接收 `blockRules` 并在返回前过滤，`page` 与 `totalNumber` 仍按上游口径保留（只影响可见条数）。
- 未配置 Cookie 时菜单项禁用，视图内只给「去设置」的引导，不发任何请求。

#### 响应结构（2026-11-19 实测，供后续查字段）

```json
{
    "ok": 1,
    "data": {
        "list": [
            {
                "id": 5367086958510760,
                "idstr": "5367086958510760",
                "mid": "5367086958510760",
                "mblogid": "Rs9eLzI2k",
                "created_at": "Thu Nov 19 21:58:28 +0800 2026",
                "user": {
                    "id": 2323836621,
                    "idstr": "2323836621",
                    "screen_name": "击剑孙一文",
                    "profile_image_url": "https://tvax3.sinaimg.cn/…jpg?KID=…",
                    "avatar_large": "https://tvax3.sinaimg.cn/…jpg?KID=…",
                    "avatar_hd": "https://tvax3.sinaimg.cn/…jpg?KID=…",
                    "verified": true,
                    "verified_type": 0,
                    "mbrank": 7,
                    "mbtype": 12,
                    "following": true
                },
                "text": "很高兴在<a href=\"…\">#微博竞燃之夜#</a> …很庆  ...<span class=\"expand\">展开</span>",
                "text_raw": "很高兴在#微博竞燃之夜# …很庆 ",
                "isLongText": true,
                "source": "iPhone 17 Pro Max",
                "region_name": "发布于 北京",
                "reposts_count": 724,
                "comments_count": 217,
                "attitudes_count": 1158,
                "attitudes_status": 1,
                "pic_ids": ["8a82eecdly1ij7uifz7pjj22gw1naqv5"],
                "pic_num": 11,
                "pic_infos": {
                    "8a82eecdly1ij7uifz7pjj22gw1naqv5": {
                        "thumbnail": { "url": "https://wx3.sinaimg.cn/wap180/…jpg", "width": 180, "height": 120 },
                        "bmiddle": { "url": "https://wx3.sinaimg.cn/wap360/…jpg", "width": 360, "height": 240 },
                        "large": { "url": "https://wx3.sinaimg.cn/orj960/…jpg", "width": 1440, "height": 960 },
                        "original": { "url": "https://wx3.sinaimg.cn/orj1080/…jpg", "width": 1620, "height": 1080 },
                        "largest": { "url": "https://wx3.sinaimg.cn/large/…jpg", "width": 2048, "height": 1365 },
                        "mw2000": { "url": "https://wx3.sinaimg.cn/mw2000/…jpg", "width": 2000, "height": 1333 },
                        "largecover": { "url": "https://wx3.sinaimg.cn/cmw960/…jpg", "width": 1440, "height": 960 },
                        "focus_point": { "left": 0.21, "top": 0.01, "width": 0.66, "height": 0.99 },
                        "pic_id": "8a82eecdly1ij7uifz7pjj22gw1naqv5",
                        "type": "pic",
                        "pic_status": 1
                    }
                },
                "retweeted_status": {},
                "isAd": true,
                "mark": "999_reallog_mark_ad:999|WeiboADNatural",
                "cardid": "star_1545",
                "title_source": { "name": "微博竞燃之夜超话", "url": "sinaweibo://…", "image": "http://wx4.sinaimg.cn/…" },
                "url_struct": [],
                "topic_struct": [],
                "common_struct": []
            }
        ],
        "total_number": 123
    }
}
```

| 字段 | 本项目用途 |
|------|-----------|
| `id` / `idstr` / `mid` | 数字 id，去重与游标的唯一依据（归一化按 `idstr` → `id` → `mid` 取） |
| `mblogid` | 拼原文地址 `https://weibo.com/{authorUid}/{mblogid}` |
| `user.id` / `user.screen_name` / `user.avatar_large` | 作者 id、昵称与头像（头像地址须过图床白名单） |
| `user.verified` | 认证角标 |
| `created_at` | 英文时间串（`Thu Nov 19 21:58:28 +0800 2026`），与时间线共用解析器 |
| `text` / `text_raw` | 带标签正文 / 纯文本；表情只在 `text` 的 `<img>` 里，长文截断以 `<span class="expand">展开</span>` 收尾，由归一化剥掉 |
| `isLongText` | 长文标记，配合清「…展开」 |
| `pic_ids` / `pic_infos` / `pic_num` | 图片列表；`pic_infos` 逐 pid 给各档位地址，归一化取 `largest` 与原图 |
| `pic_infos[].type` | `pic` 普通图、`livephoto` 实况图（另带 `video` / `fid`），本项目只取静态图 |
| `reposts_count` / `comments_count` / `attitudes_count` | 互动数 |
| `reads_count` | 阅读数：只对自己发布的微博下发，别人的条目里没有该字段 |
| `attitudes_status` | `1` 表示当前账号已赞 |
| `retweeted_status` | 转发体，只取摘要 |
| `isAd` / `mark` / `cardid` | 广告与推广位标记（`isAd: true`，或 `mark` 含 `WeiboADNatural`），归一化直接丢弃 |
| `region_name` | 发布地，目前不展示 |
| `total_number` | 点赞总数，`with_total=true` 时才出现 |

### 2.17 发表框：话题搜索与图片选择

```
GET https://weibo.com/ajax/mblog/topic?q={关键字}
```

- `q` 为空（或省略）时上游回当前账号的常用话题；有关键字时按关键字搜索。实测返回 `{ ok: 1, data: [{ topic }] }`。
- 归一化只取 `data[].topic`：剥掉首尾 `#`、去空白、同名去重；空数组是正常结果（新账号或搜不到），由前端展示空态而不是报错。
- 协议 `weibo/topics` 复用登录 Cookie，`q` 限 50 字（超长直接判非法，不截断）；不参与磁盘缓存（热搜变化快），每次打开面板或改关键字都回源。
- 话题面板打开即取常用话题，输入走 300ms 去抖；回包按请求序号校验，先发后到的旧结果丢弃；选中后按正文口径插入 `#话题#` 并恢复光标，超出 2000 字上限时拒绝并提示。
- 图片面板列出 `uploads/` 下的图片（`upload/list`，只有 `url` 非空的图片条目参与），已选条目置灰禁用；选中后在发布框下方以缩略图列表展示，右上角可移除。
- 面板内可直接点「上传图片」唤起系统选择器（`upload/pick`），上传结果自动加入已选。
- 发布框聚焦时粘贴剪贴板里的图片（`clipboardData.files` 中的 `image/*`）走 `upload/bytes` 落 `uploads/{YYYYMM}/`，成功后加入已选；纯文本粘贴完全不拦截默认行为。
- 已选图片与草稿同层保存在 `WeiboScreen`，切换视图卸载发布框后不丢；点「发布」进入 2.18 的两步流程，成功后清空内容，并把新微博前插到时间线首位。
- 输入框底部右侧是「AI 优化」按钮（`Sparkles`，进行中转圈）：调 `ai/enhancePrompt` 并带 `scene: 'weibo'`，宿主按微博文案口径改写（保留 #话题#、@昵称、链接与 `[表情]`），成功后整体替换正文并把光标落到末尾；空内容只提示不改写，改写中发布按钮一并禁用，失败保留原文。
- `ai/enhancePrompt` 由微博面板按方法名转发给 AI 服务（`openWeiboPanel` 的 `enhancePrompt` 注入，扩展入口传 `ai.chat.enhancePrompt`），微博路由不认识 `ai/*` 前缀；未注入时该按钮报「未登记」。
- 改写期间整张卡片发光：`Card` 补 `relative isolate overflow-visible`（覆盖 `ui/card` 自带的 `overflow-hidden`，否则外扩背光会被裁掉），内放 `ComposerGlow`（类名用 `CARD_GLOW_CLASS`，圆角对齐 `rounded-xl`）与一层同色底衬 `bg-card`，光晕只从卡片边缘与外侧溢出、不染正文。

### 2.18 发布微博（图床换 pid → update）

```
POST https://picupload.weibo.com/interface/pic_upload.php?s=json&ori=1&data=1&rotate=0&wm=&app=miniblog&mime=image%2Fpng
POST https://weibo.com/ajax/statuses/update
```

- 图床走 `pic_upload.php`：元数据全在 query、body 直接放图片字节（`Content-Type: application/octet-stream`），**不需要签名参数**；成功回 `{code:'A00006', data:{pics:{pic_1:{pid}}}}`，回包可能带 JSONP 包裹，解析时按宽松 JSON 处理（首次解析失败就从首个 `{` 到末个 `}` 截取重试）。
- 新版 `upload.php` 需要前端 JS 计算的 `cs` 签名（算法未公开、与具体图片绑定、随机值一律 `errno:-2`），故不采用；这条旧端点是多个开源实现长期在用的路径，只靠 Cookie 鉴权，实测可正常发图。
- 成败只以「拿到 pid」判定；pid 解析兼容 `data.pics.*.pid`、`pic.pid`（可为数组）、`data.pid` 与顶层 `pid`，失败时错误里带 `code` / 回包字段名 / 原文前 200 字。
- 图片按入参顺序逐张上传，任一失败即整条放弃，不做部分发布；上传与发布都不重试，失败交给用户手动重试，避免重复发博。
- 发布请求是 `application/x-www-form-urlencoded`：`content` 原样提交（话题与表情都是文本，不二次转义）、`visible=0`、`share_id`/`vote`/`media` 留空、`need_transcode=1`、`pic_id` 为 `[{ type, pid }]` 的 JSON 串（无图时为空串）、`fp` 为 33 位设备指纹（首位固定 `0`）。
- 请求头：图床只带 Cookie / Referer / Origin / UA / Accept；发布再补 `X-Requested-With` 与 `X-XSRF-TOKEN`（取自 Cookie 的 `XSRF-TOKEN`，缺失时不带）。
- 图片路径只接受 `uploads/{YYYYMM}/{文件名}`，宿主读字节后按魔数判定 png / jpg / webp / gif，单张沿用上传页 10MB 上限。
- 成功判定：`ok > 0` 且 `data` 带 `idstr`（或 `id`）与 `mblogid`；原文地址按 `data.user.idstr` + `mblogid` 拼，缺 uid 时回落 `/detail/{id}`。
- 前端发布中按钮禁用并显示加载态（`ref` 单飞，连点不会重复提交）；成功后清空草稿与已选图片，并把宿主归一化的新微博前插到时间线首位（不整页刷新、不动 `sinceId`/`maxId`），失败保留内容供直接重试。
- **已知风险**：`fp` 无法还原官网生成算法，当前按同形随机生成；若上游开始校验指纹与 Cookie 的绑定会返回 `ok: 0`，届时需要从浏览器会话取真实值。`X-XSRF-TOKEN` 缺失时发布同样可能被拒。

### 2.19 转发列表（谁转发了这条）

```
GET https://weibo.com/ajax/statuses/repostTimeline?id={微博数字 id}&page=1&moduleID=feed&count=10
```

- 回包 `{ ok, data: [...], msg }`；`data` 每项是一条转发，结构同时间线微博项（自带 `retweeted_status`），本层只取转发附言（`text` / `text_raw`）、`created_at` 与 `user`，不展开被转发的原文。
- 分页只有 `page`（从 1 开始），没有游标；本页条数拉满即认为可能还有下一页，由前端翻到空页为止。
- 协议 `weibo/reposts`，入参 `{ id, page?, count? }`，结果 `{ reposts, page, hasMore }`；正文口径与评论一致（`parsePostSegments` + 纯文本还原表情）。
- 前端：底栏「转发」是按钮，点击在底栏之后展开转发列表（与评论区互斥、共用同一位置），限高 `max-h-80` 滚动；纯转发没有附言，不渲染空段落。
- 转发项自带 `attitudes_count` / `attitudes_status`（与主贴同形），归一化后作为点赞初始值；计数按 `attitudes_count → attitude_count → like_counts` 的优先级取第一个存在的字段（`0` 是合法值，不回退），三个字段都没有时归一化为 `null`，界面不显示数字——以此区分「上游没下发」与「真实零赞」。
- 原博赞数是另一份数据：取 `retweeted_status.attitudes_count` 归一化为 `originalLikes`，在时间后面标注「· 原博 x 赞」（万级折算成 `8.3万`，见 `utils/weiboCount`）；转发自身的赞数为 `0` 时不显示数字，因为转发普遍无人点赞，显示出来只会干扰阅读。
- 实测回包里转发项 `attitudes_count` 恒为 `0`、`attitudes_status` 为 `0`，原博的赞数在 `retweeted_status.attitudes_count`（如 82833）。
- 转发操作行（`block/RepostActionBar.tsx`）：左侧时间、右侧引用 / 添加到 AI 对话 / 点赞 / 删除。点赞计数常显，`0` 也展示，避免被误读为未取到数据。点赞协议 `weibo/repost/like`（入参 `{ id, liked }`）——与主贴同一端点，但参数走 form：点赞提交 `id` + `fp`，取消只提交 `id`，回包从根层 `status.attitudes_count` 取最新计数（缺失时前端沿用本地增减）；删除复用 `weibo/destroy`（`statuses/destroy`，参数 `id`）。
- 引用：把 `//@作者：附言` 追加到转发框草稿（纯转发只写 `//@作者`，同一条已引用过不重复追加），字数与超限判定沿用 Composer 的 `draft.length/draftLimit`，提交时与手输内容一起作为 `comment` 发出。
- 添加到 AI 对话：协议 `weibo/repost/addToChat`（入参 `{ repostId, authorName, text, createdAt }`），宿主组装「微博转发 @作者（时间）+ 附言」并落到 weibo 作用域会话，去重键用 `weibo-repost:{转发 id}`。

发布转发：只转发与转发并评论共用 `normal_repost` 一个请求；评论并转发是**两步**（先评论、再转发），单靠 `is_repost=1` 不会生成评论。

```
POST https://weibo.com/ajax/statuses/normal_repost
Content-Type / Cookie / Referer / Origin / X-XSRF-TOKEN 同发布
id={微博数字 id}&comment={附言，可为空}&pic_id=&comment_ori=0&fp={设备指纹}&{方式开关}
```

| 方式 | 请求 | 说明 |
|------|------|------|
| 只转发 | `normal_repost`：`is_repost=0&is_comment=0&visible=0&share_id=` | 默认 |
| 转发并评论 | `normal_repost`：`is_repost=0&is_comment=1&visible=0&share_id=` | 转发同时在原博下生成一条评论 |
| 评论并转发 | 先 `comments/create` 发评论，再 `normal_repost`：`is_repost=1&is_comment=0`（不带 `visible` 与 `share_id`） | 两步；第二步失败返回部分结果（`reposted: false`、`commented: true`、`failureMessage`） |

- 协议 `weibo/repost`，入参 `{ id, comment, mode? }`；`mode` 取 `repost` / `repostWithComment` / `commentWithRepost`，缺省 `repost`；附言可为空（纯转发），提交前 `trim`。
- 长度上限按 `mode` 分流：纯转发（`repost`）500 字（`WEIBO_REPOST_MAX_LENGTH`）；`repostWithComment` / `commentWithRepost` 的 `comment` 都会生成一条评论，按评论上限 140 字（`WEIBO_COMMENT_MAX_LENGTH`）收窄。
- 回包 `{ ok, data: { statuses }, msg }`，成功时 `msg` 为「转发成功」；`statuses` 当前不消费，由前端重拉第一页。
- 部分成功：评论已发出但转发失败时 `weibo/repost` 不抛错，而是回 `{ reposted: false, commented: true, failureMessage }`；前端据此清空草稿、关掉「同时转发」开关并照常刷新评论，提示「评论已发布，但转发失败」，避免用户重试时把评论发重。
- 前端：转发框右下角是「同时评论」开关（`@webview/components/Switch`）——打开走 `repostWithComment`（`is_comment=1`），关闭走 `repost`；留空即纯转发，按钮不按内容禁用；成功后清空附言并重拉第一页，失败弹 toast；`Ctrl / Cmd + Enter` 直接发送。
- 前端分层：取数（页码续载、代际丢弃、总数本地增减）在 `hooks/useWeiboReposts.ts`，写操作（转发 / 删除，含单飞与计数回调）在 `hooks/useWeiboRepostActions.ts`；视图拆为 `block/RepostComposer.tsx`（转发框）、`block/RepostItem.tsx`（条目：头像 + 「作者名：附言」同行，时间与删除操作复用 `block/CommentActionBar.tsx`，与评论条目同一套排版口径）、`layout/WeiboRepostList.tsx` 只做装配。

删除转发 / 微博：

```
POST https://weibo.com/ajax/statuses/destroy
Content-Type / Cookie / Referer / Origin / X-XSRF-TOKEN 同发布
id={微博数字 id}
```

- 协议 `weibo/destroy`，入参 `{ id }`；转发与自己发的微博都按 status id 删。
- 回包不是 `{ ok, data }` 包装，而是被删除的微博对象本身、末尾才带 `ok`：只有 `ok` 明确 `<= 0` 才算失败，`ok` 缺失但回包带 `id` 时视为成功。
- 前端：转发列表里只有自己的转发（`viewerUid === repost.author.id`）显示「删除」，点击走单个 AlertDialog 确认，成功后重拉第一页；归属最终仍由上游判定。

### 2.20 他人主页（页内打开）

```
GET https://weibo.com/ajax/profile/info?uid={uid}&scene=profile
GET https://weibo.com/ajax/profile/info?screen_name={昵称}&scene=profile
GET https://weibo.com/ajax/statuses/mymblog?uid={uid}&page={页码}&feature=0
```

- 入口：正文与标题行里的 `/u/{uid}`、`/n/{昵称}`、`/profile/{uid}` 链接，以及顶栏账号菜单的「个人主页」。识别由 `utils/weiboLinks.readProfileTarget` 完成——只认 https 与 `weibo.com` 及其子域，数字末段判为 uid，其余按昵称交给宿主换算，话题页、详情页与短链一律返回 `null`。主页短形式 `/{uid}` 与 `/u/{uid}` 同义（只认单段纯数字，两段路径的详情页不算）。
- 链接不带 `href`：VS Code webview 会把带 `href` 的 `<a>` 点击交给系统浏览器，`preventDefault` 拦不住，页内打开会被同一跳转抢走。`WeiboLink` 因此渲染成 `role="link"` + `tabIndex` 的内联元素，Enter / 空格与点击等价；热搜行的标题同理只作文本，整行才是点击目标。
- 页内导航：`context/WeiboUserPageProvider` 把「打开主页」回调注入整棵树，`hooks/useWeiboOpenUrl` 命中主页链接时改走页内，未命中或未挂 Provider（单测、预览）时仍走 `weibo/openPost`。页面把目标落成 `userTarget` 状态，内容区整块换成 `UserBlogView`；切页与删 Cookie 都清空该目标。
- 取数：协议 `weibo/userBlog`，入参 `{ uid?, screenName?, page? }`（uid 与昵称至少给一个，昵称长度 ≤ 64 且不含控制字符）。宿主串行发两次请求：先用 `uid` 或 `screen_name` 查资料，再用回包里的 `id` 取列表；资料结构不可用时整条报错，不回退「只给列表」的半成品页面。
- 字段映射：`data.user` → `WeiboUserInfo`（`avatar_hd` → `avatar_large` → `profile_image_url`、`cover_image_phone` 取分号前的首张、`gender` 只认 `m` / `f`、简介与所在地剥标签解实体）；列表条目就是微博对象（`data.list[]` 直接给 `id` / `user` / `text`，没有 `mblog` 包裹，实现同时兼容 `list[].mblog`），单条复用 `normalizeTimelinePost`，渲染仍是 `WeiboFeedSection` / `WeiboPostCard`。
- 分页：`mymblog` 只有 `page`（从 1 开始），没有游标；`hasMore` 在 `data.total` 可知时按「页码 × 20 < 总数」估算，缺失时以本页是否取满 20 条为准。前端 `hooks/useWeiboUserBlog` 刷新即重取第一页并整体替换，翻页按 `page + 1` 追加去重。
- 同一用户翻页不替换资料：上游头像地址带签名，换一次就会多下载一次；只有切到另一个用户时资料才整份替换。
- 页面：`layout/UserBlogView` 的页头给封面、头像、昵称与认证角标、所在地与性别图标、简介与「关注 / 粉丝 / 微博」计数，右上角是返回按钮与关注按钮；顶栏「刷新」在主页状态下刷该用户的列表（不是增量游标），列表为空时同样显示空态与刷新入口。
- 页头细节：资料与首屏微博同一次请求返回，资料未到货（含未加载完、读取失败）时整块页头不渲染，只在列表区给加载态或错误，不再用占位文案撑一张空卡片；封面容器固定 256px（`h-64`）并垫渐变色底，图片绝对定位填充，加载中与失败都占同一块高度，卡片不会因大图到货而跳动；所在地用 `MapPin`、性别用 `Mars` / `Venus` 图标（男蓝女粉，未知不渲染），不再拼「男 / 女」文字。
- 关注入口只留在页头：列表卡片经 `hideFollow` 收起头部的关注按钮与「更多」菜单里的取消关注，避免同一屏出现两套关注事实源（页头按钮命中 `user.isFollowing`，卡片各自的控制器不会同步）。主页 uid 与当前登录账号 uid 相同时（本人主页）整块关注入口不渲染，当前账号 uid 未取到时不猜、仍照常显示。
- 资料里的 `following` 归一化为 `WeiboUserInfo.isFollowing`，`remark` 归一化为备注名；两者都只认布尔 / 字符串，缺失即「未关注 / 无备注」。
- 备注联动：保存备注后页面重拉一页该用户的列表，并把列表里该用户作为作者的名字换成备注名——主贴按 `author.id`、转发体按 `authorId` 匹配，只改展示层派生的帖子数组，`feed` 内部状态与上游数据不动；备注清空后自动回到上游昵称。

### 2.21 关注分组与备注

```
GET  https://weibo.com/ajax/profile/getGroupList?uid={目标 uid}
GET  https://weibo.com/ajax/profile/getGroups?target_uid={目标 uid}&filterType=system&hasRecom=true
POST https://weibo.com/ajax/profile/createGroup       name={1-8 字}&isOpen=true（仅公开分组）
POST https://weibo.com/ajax/profile/setGroup          uids={uid}&list_ids={选中}&origin_list_ids={原始 + 0 + 原始}
POST https://weibo.com/ajax/friendships/remarkUpdate   uid={uid}&remark={1-15 字}
```

- 入口：主页页头的关注按钮。未关注时是普通「关注」；已关注时按钮文案变成备注名（无备注显示「已关注」），悬停展开「设置分组 / 设置备注 / 取消关注」三项。
- 协议：`weibo/user/groups`（`{ uid }` → `{ groupIds, groups }`，两个 GET 并行发出）、`weibo/user/groupCreate`（`{ name, isPublic }` → `{ group }`）、`weibo/user/groupSave`（`{ uid, listIds, originListIds }` → `{ saved }`）、`weibo/user/remark`（`{ uid, remark }` → `{ remark }`）。
- 归一化：`getGroupList` 的 `data` 直接是数组（只有 id / name），`getGroups` 的 `data.lists` 带 `member_count` 与 `mode`（`public` 即公开分组）；缺 id 或名称为空的条目丢弃。
- 保存参数：`list_ids` 为空数组时提交 `0`（移出自定义分组）；`origin_list_ids` 按网页端实测形态复刻为「原始分组 + 0 + 原始分组」（0 表示默认分组），不要按集合去重改写。
- 新建分组：名称 1-8 字，公开时 form 带 `isOpen=true`，不公开不带该字段；回包 `data` 就是新分组，前端插入列表并自动勾选，点「保存分组」才真正归组。
- 备注：`remarkUpdate` 的回包是被改动的 user 对象（**没有 `ok` 包装**），只有 `ok` 明确 `<= 0` 才算失败，备注以回包 `remark` 为准；留空保存即清除。
- 前端分层：`hooks/useWeiboUserGroups` 管分组读取 / 新建 / 归组（写操作 ref 单飞，保存用打开时的 groupIds 作为 origin 快照），`hooks/useWeiboUserRemark` 管备注；弹窗 `layout/UserGroupDialog`、`layout/UserRemarkDialog` 复用 `FormDialog` 与 field / checkbox / switch / input 槽位。
- 关注与取关仍走既有 `weibo/author/follow`（`friendships/create` / `friendships/destory`），本次没有改动这条写链路。

