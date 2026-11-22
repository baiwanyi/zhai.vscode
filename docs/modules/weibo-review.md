# 微博模块全量审查记录（2026-11-23）

对 `src/weibo` 做了一次逐文件审查，覆盖 layout / block / hooks / utils / context 五层与入口文件，共 96 个文件。本文记录审查方法、修复清单、有意保留的设计、验证方式与遗留项，供后续 review 与排期参考。模块本身的设计说明见 [`weibo.md`](./weibo.md)。

## 1. 审查范围与方法

| 层 | 文件数 | 说明 |
|---|---|---|
| `layout/` | 27 | 页面、列表、弹窗等装配层 |
| `block/` | 20 | 卡片内展示块 |
| `hooks/` | 38 | 取数与写操作控制器 |
| `utils/` | 8 | 纯函数 |
| `context/` | 2 | 页内主页导航 |
| 入口 | 1 | `main.tsx` |

每个文件按九项核对：导入与顶层声明、类型系统、React Hooks 位置与依赖、数据流、性能、安全、边界、代码品质、TypeScript 严格度。发现问题按 critical / minor / suggestion 分级，critical 与 minor 当场修复，suggestion 只记录。

## 2. 修复清单

### 2.1 逻辑错误（分支不生效 / 状态不归位）

| 文件 | 问题 | 影响 |
|---|---|---|
| `hooks/useWeiboBlockList.ts` | `blockUser` 拿 `addWeiboBlockedUser` 的返回值去比 reducer state，两者永远不是同一引用 | 「已在名单」短路从未命中：重复屏蔽会无效写盘，提示错成「已屏蔽」 |
| `hooks/useWeiboRepostLike.ts` | 回滚分支 `previous === null ? null : …` 实际不可达（乐观更新已把 `null` 改成数字） | 回滚后把「上游未下发」渲染成 `0`；改为 `setCount(repost.likes)` 回到点击前 |
| `hooks/useWeiboLongText.ts` | 成功分支不重置 `hasFailed`；空文本时既不写全文也不标失败 | 状态停在「既无全文也无失败」，按钮文案与实际不符 |
| `layout/WeiboHomeView.tsx` | 自定义 `emptyState` 绕过 `WeiboFeedList` 内的错误标题判断 | 取数失败仍显示「时间线没有内容」，与描述（请求超时）矛盾 |
| `layout/WeiboCommentItem` 的展开按钮 | 文案「共 N 条回复」中的 N 是**尚未铺开**的条数 | 10 条回复只预览 3 条时显示「共 7 条」，与点开后的实际条数不符 |
| `block/WeiboHotRankPosition.tsx` | `isTopRank` 只判上限 `rank <= 3` | 上游 rank 缺失给 `0` 时，序号被染成前三名的红色 |
| `hooks/useWeiboMediaViewer.ts` + `block/WeiboMediaPreview.tsx` | `openPreview` 与 `startIndex` 均未做范围钳制 | 混排下标折算漏项时，embla 不报错、只把轮播停在空白页 |

### 2.2 内容丢失与数据风险

| 文件 | 问题 | 影响 |
|---|---|---|
| `layout/ComposerCard.tsx` | 发布在途未禁用输入框 | 成功后 `onDraftChange('')` 会把等待期间新写的内容一并抹掉 |
| 同上 | 发布在途仍可点 AI 优化 | 改写回包在草稿清空后把**已发布内容**写回输入框，易导致重复发布 |
| 同上 | 粘贴时先把整批图片交给上传、上传完才截断到 9 张 | 粘贴 20 张会全部读 base64 并落盘，其中 11 张被丢弃 |
| `layout/WeiboFeedList.tsx` | 卡片 key 含 `isLiked` | 点赞导致整张卡片重挂载：已展开的评论区被收起、长文退回摘要并重新请求 |

### 2.3 写操作与并发

| 文件 | 问题 | 修法 |
|---|---|---|
| `hooks/useWeiboComposerImages.ts` | 上传无单飞，连点/连续粘贴会并发两批 | `isUploadingRef` |
| `hooks/useWeiboBlockList.ts` | 保存与追加共用写盘、无单飞 | `isWritingRef` |
| `hooks/useWeiboCity.ts` | `save` 无单飞（设置弹窗侧另有守卫） | `isSavingRef` |
| `layout/SettingsDialog.tsx` | 两个控制器的 `isSubmitting` 都是异步 state，同帧连点可提交两遍 | `isSubmittingRef` |
| `hooks/useWeiboHotChannelMenu.ts` | 判重只在闭包里，同帧连点追加重复 gid | updater 内二次判重 |
| `hooks/useWeiboImage.ts` | 只有结果缓存、没有在途缓存 | 模块级 `inFlightImageRequests` |

### 2.4 卸载后仍提示 / 仍写状态

统一用 `src/hooks/useIsMounted.ts` 收敛，共 13 处：

`useWeiboAuthorFollow`、`useWeiboUserRemark`、`useWeiboPublish`、`useWeiboEnhance`、`useWeiboEmoticons`、`useWeiboComposerImages`、`useWeiboLongText`、`useWeiboTopicSearch`、`useWeiboCommentThread`、`useWeiboCommentActions`、`useWeiboRepostActions`、`useWeiboCommentLike`、`useWeiboRepostLike`、`useWeiboPostActions`、`useWeiboSearchOpen`、`block/WeiboPostLikeButton`、`layout/WeiboPostCard`。

典型场景：收起评论面板后仍弹「加载回复失败」、卡片被列表刷新替换后仍弹「已保存为笔记」、切走热搜视图后仍弹「打开失败」。

### 2.5 文案与口径

| 位置 | 问题 |
|---|---|
| `utils/weiboViewDescription.ts` | `describeWeiboView` 只有「首页推荐」判了 `isConfigured`，其余五支未配置时仍描述具体内容，与内容区的凭证引导矛盾 |
| 同上 | `readCredentialNotice` 只判空串，纯空白串会渲染成一块空白提示 |
| `layout/WeiboAccountMenu.tsx` | `profile?.name ?? fallback` 不兜空串，昵称为空时顶栏只剩头像 |
| `layout/WeiboRetweetBlock.tsx` | `@UID` 判定未与主贴头部统一为 `isWeiboTimelineId`；时间为空时仍渲染空 `<span>` |
| `layout/WeiboImagePicker.tsx` | 空库文案暴露内部目录名 `uploads` |
| `layout/WeiboScreen.tsx` | 未配置 Cookie 进主页时顶栏长期显示「正在读取…」；热搜页刷新提示写成「增量刷新」 |

### 2.6 性能

| 位置 | 问题 |
|---|---|
| `layout/SettingsDialog.tsx` | 每次渲染重排几百个城市（名单输入框每敲一个字触发一次）→ `useMemo` |
| `layout/WeiboFeedList.tsx` | 卡片 key 含点赞态（见 2.2），同时是性能问题 → 点赞按钮级 key |
| `layout/WeiboPostCard.tsx` | 草稿在页面层，输入每个字符重渲染全部卡片 → `memo` |
| `hooks/useWeiboImage.ts` | 同一张图并发出现时各打一遍请求 → 在途复用 |

### 2.7 可访问性

| 位置 | 问题 |
|---|---|
| `block/WeiboHotRankRow.tsx` + `layout/HotSearchView.tsx` | 整行是唯一入口但没有 `tabIndex` 与键盘处理，纯键盘用户打不开任何一条热搜 |
| `block/WeiboMediaPreview.tsx` | 键盘只有 Esc，没有左右方向键；翻页唯一入口是两块热区 |
| `block/WeiboCollapsibleBody.tsx` | 展开按钮只有 `aria-expanded`，缺 `aria-controls` |
| `block/CommentComposer.tsx` | 「同时转发」开关在提交中仍可切（与 `RepostComposer` 不一致） |
| `block/WeiboVideoPlayer.tsx` | 空格在按钮上双重触发（容器未判事件源）；播完不归零，再点播放立刻 ended |

## 3. 有意保留的设计（看着像问题，实则不是）

| 现象 | 原因 |
|---|---|
| `useWeiboProfile` 失败不 toast，`useWeiboGroups` 失败 toast | 顶栏缺头像不值得打扰；时间线依赖分组，失败必须可感知 |
| `useWeiboCommentThread` / `useWeiboReposts` 续载失败只落 error 不 toast | 列表底部已有「加载失败 + 重试」，再弹一条是重复 |
| `useWeiboReposts` 用 `countState` 的 base/offset，而评论区直接用 `total` | 转发写成功后只重拉列表，父级 `totalCount` 快照不变，需本地偏移补足 |
| 转发点赞用 `max(服务端, 乐观值)`，评论与主贴直接采用服务端值 | 转发点赞回包偶尔是旧快照；另两处未观测到该问题 |
| `WeiboHotRankRow` 与 `HotSearchView.HotSearchRow` 两份行组件 | 尺寸档、描述位置、是否挂 Tooltip 都不同，合并会引入大量布尔 props |
| `WeiboPostCardHeader` 与 `WeiboRetweetBlock` 作者行不共用 | 转发行有意扁平化（不带头像、`@uid · 时间` 同行） |
| `useWeiboSearchOpen` 每行一个实例、300ms 节流不是全局 | 节流语义是「同一行连续点击只放行第一次」 |
| 侧栏只渲染前 10 条但沿用上游 `rank` | 截断后不重新编号，序号与真实榜单一致 |
| `WeiboFeedViews` / `WeiboFeedSection` / `WeiboFeedList` 三层拆分 | 分别是视图分发、凭证门 + 空态、列表 + 翻页，职责清晰 |

## 4. 验证

- `pnpm exec eslint src/weibo src/hooks`、`pnpm exec tsc --noEmit`、`pnpm exec prettier --check "src/weibo/**/*.{ts,tsx}"` 全部通过
- 微博相关测试 28 个文件通过；本轮新增 11 项用例：`useIsMounted`(2)、`useWeiboGroupsView`(3)、`WeiboItemActionBar`(6)
- 组件测试需注意：`WeiboItemActionBar` 的按钮带 tooltip，直接渲染会报 `Tooltip must be used within TooltipProvider`，测试里要包一层

相关提交：

| commit | 内容 |
|---|---|
| `65826f57` | 抽 `useWeiboPageNav` / `useWeiboRefresh` / `useWeiboGroupsView` 与 `WeiboItemActionBar`，通用 hooks 下沉 `src/hooks` |
| `7cf5865c` | 审查修复：失效分支、无法重播、未配置文案、键盘可达性等 |
| `ee98efe9` | 补三个新结构的用例 |
| `725abe24` | 文档同步 |

## 5. 遗留项与建议

### 5.1 已落地

| 事项 | 结果 |
|---|---|
| 取数错误回执策略 | 统一为「取数失败只落错误态，不弹 toast」：`useWeiboFeed` / `useWeiboLikes` / `useWeiboUserBlog` / `useWeiboTimeline`（`loadPage` 分支）/ `useWeiboHotRank` 五处删掉 `toastError`。可见反馈已由各列表自带（空态标题改「读取失败」、自动翻页暂停、底部换「加载更多」、榜单占位给重试）；凭证保存 / 清除 / 初始化三处保留 toast（用户主动操作或整页不可用） |
| `useWeiboRepostLike` 回滚后的 `0` | 已改为回到点击前快照（`7cf5865c`） |

### 5.2 排期做

| 事项 | 建议 |
|---|---|
| `useSingleFlight` | 新增一个 20 行 hook 供**新代码**使用；存量 12 处不动（失败返回值语义各异，且会改变微任务时序） |
| `CommentItem` / `RepostItem` 骨架抽取 | 两者 `<article>` + 头像 + 作者行 + 内容 + ActionBar 几乎相同，可抽 `WeiboListItemShell`；需人工回归两种条目排版 |
| `useWeiboPageNav` / `useWeiboRefresh` 测试 | 前者纯状态机、好测；后者依赖 8 个入参，mock 成本高、收益低 |

### 5.3 建议不做（含理由）

| 事项 | 理由 |
|---|---|
| `WeiboFeedList` 的 key 去掉 `author.isFollowing` | 关注态由 `useWeiboAuthorFollow` 持有（controller 在 `WeiboPostCard` 里创建、经 props 下传），key 下沉到按钮无法重置 controller 的 state；要让按钮跟随上游，只能让 hook 用 effect 同步 `initialFollowing`，而这会与本地写操作结果打架——`UserFollowAction` 审查时已否决同一方案 |
| 分页控制器统一（6 个 hook） | 状态机细节多（代际号、游标形态、`hasLoaded` 与 `isLoading` 合并判断），hook 级测试基线薄；等真的出现第三次同类修复再动 |
| 超时常量集中（19 个） | 数值分六档但同档内语义不同构（关注写 15s 与话题搜索读 15s 无共同语义），按数值归并会发明错误概念 |
| HoverCard 焦点竞态 | 需新增 `@radix-ui/react-focus-scope`，双层回焦无法在无 UI 环境验证；已在 `UserFollowAction` 头注释记录限制与修法 |
| `autoLoadCount` 刷新后重置 | 需父级透传 `isRefreshing`（改三层契约），而「手动点一次加载更多」代价小 |
| `types/weibo.ts` 拆分（约 1500 行） | 全仓 40+ 文件与宿主均从它导入，拆分风险高；等文件继续增长或多人并行冲突频繁时再评估 |

## 6. 人工回归清单

静态校验覆盖不到交互与视觉，以下建议在宿主里逐项确认：

1. 发布框：点发布后输入框变灰只读；发布中「AI 优化」不可点；粘贴 12 张图只收 9 张。
2. 时间线卡片：展开评论区后点赞，评论区不应收起；长文卡片点赞不应重新请求全文。
3. 评论 / 转发行：ActionBar 的删除、回复、引用、加入对话、点赞顺序与间距与改动前一致。
4. 热搜：键盘 Tab 能聚焦到榜单行，Enter 打开搜索；视频播完后再点播放能从头播。
5. 媒体预览：左右方向键翻页、Esc 收起；越界不会出现空白页。
6. 设置弹窗：同时改城市与名单保存一次成功；连点保存只提交一次。
7. 账号菜单：未配置 Cookie 时禁用项表现正确；昵称为空时显示「我的微博 / 未登录」。
8. 未配置 Cookie 进他人主页：顶栏应显示「个人主页 · 未配置 Cookie」；热搜页刷新提示应为「刷新当前榜单」。
