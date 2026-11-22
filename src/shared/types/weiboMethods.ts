/**
 * 微博协议方法名：Webview 与宿主共用的字面量表，与 HostMethodName 的 weibo/* 分支一一对应。
 * 复用约定：前端 request 只引用这里的键，组件与取数层不再散写字面量方法名；
 * 宿主 weiboRoutes 的 switch 与 messages 的联合类型同样引用本表，方法名只在文件里出现一次。
 * 关键约束：新增方法须同时在 HostMethodName（经 WeiboMethodName 自动纳入）与 weiboRoutes 的 switch 登记，
 * 并在此表补键；漏登记会在运行时抛「未登记的微博协议方法」。
 */

/** 微博协议方法名联合：由表推导，避免再手写一遍 */
export const WEIBO_METHODS = {
    /** 关注时间线 */
    timeline: 'weibo/timeline',
    /** 热门 / 分组信息流 */
    feed: 'weibo/feed',
    /** 我的赞 */
    likes: 'weibo/likes',
    /** 分组与热门频道表 */
    groups: 'weibo/groups',
    /** 侧栏热搜榜 */
    hotRank: 'weibo/hotRank',
    /** 发表框话题搜索 */
    topics: 'weibo/topics',
    /** 发布微博 */
    publish: 'weibo/publish',
    /** 发表框表情配置 */
    emoticons: 'weibo/emoticons',
    /** 当前登录账号信息 */
    profile: 'weibo/profile',
    /** 凭证状态 */
    credentialStatus: 'weibo/credential/status',
    /** 保存凭证 */
    credentialSave: 'weibo/credential/save',
    /** 清除凭证 */
    credentialClear: 'weibo/credential/clear',
    /** 评论列表 */
    comments: 'weibo/comments',
    /** 发布评论：带 replyToId 即回复，两者共用同一方法 */
    commentCreate: 'weibo/comment/create',
    /** 删除评论 */
    commentDestroy: 'weibo/comment/destroy',
    /** 评论下的子评论展开 */
    commentReplies: 'weibo/comment/replies',
    /** 评论点赞 / 取消点赞：liked 区分目标状态 */
    commentLike: 'weibo/comment/like',
    /** 评论加入 AI 对话：载荷由前端带出正文，宿主不发起网络请求 */
    commentAddToChat: 'weibo/comment/addToChat',
    /** 转发列表 */
    reposts: 'weibo/reposts',
    /** 转发：纯转发 / 转发并评论 / 评论并转发共用，由 mode 区分 */
    repost: 'weibo/repost',
    /** 转发点赞 / 取消点赞：与主贴同端点，参数改用 form 并带设备指纹 */
    repostLike: 'weibo/repost/like',
    /** 转发加入 AI 对话：载荷由前端带出附言，宿主不发起网络请求 */
    repostAddToChat: 'weibo/repost/addToChat',
    /** 主贴点赞 / 取消点赞：liked 区分目标状态 */
    like: 'weibo/like',
    /** 删除微博 / 转发 */
    destroyStatus: 'weibo/destroy',
    /** 关注 / 取消关注博主：following 区分目标状态 */
    authorFollow: 'weibo/author/follow',
    /** 保存为笔记 */
    saveToNote: 'weibo/saveToNote',
    /** 添加到 AI 对话 */
    addToChat: 'weibo/addToChat',
    /** 图片代理：换成 Webview 可加载的本地地址 */
    image: 'weibo/image',
    /** 视频中转：换成宿主回环地址后交给播放器 */
    video: 'weibo/video',
    /** 面板内打开（微博视图跳转） */
    open: 'weibo/open',
    /** 在浏览器打开微博地址 */
    openPost: 'weibo/openPost',
    /** 长文全文 */
    longText: 'weibo/longtext',
    /** 同城城市读取 */
    cityStatus: 'weibo/city/status',
    /** 同城城市保存 */
    citySave: 'weibo/city/save',
    /** 屏蔽名单读取 */
    blockListStatus: 'weibo/blockList/status',
    /** 屏蔽名单保存 */
    blockListSave: 'weibo/blockList/save',
} as const

/** 微博协议方法名联合：由 WEIBO_METHODS 的值推导 */
export type WeiboMethodName = (typeof WEIBO_METHODS)[keyof typeof WEIBO_METHODS]
