/**
 * 微博协议方法名：Webview 与宿主共用的字面量表，与 HostMethodName 一一对应。
 * 复用约定：前端 request 只引用这里的键，组件与取数层不再散写字面量方法名。
 * 关键约束：新增方法须同时在 HostMethodName、weiboRoutes 的 switch 与本表登记，三处缺一都会失败。
 */
export const WEIBO_METHODS = {
    /** 评论列表 */
    comments: 'weibo/comments',
    /** 评论加入 AI 对话：载荷由前端带出正文，宿主不发起网络请求 */
    commentAddToChat: 'weibo/comment/addToChat',
    /** 发布评论：带 replyToId 即回复，两者共用同一方法 */
    commentCreate: 'weibo/comment/create',
    /** 删除评论 */
    commentDestroy: 'weibo/comment/destroy',
    /** 评论下的子评论展开 */
    commentReplies: 'weibo/comment/replies',
    /** 评论点赞 / 取消点赞：liked 区分目标状态 */
    commentLike: 'weibo/comment/like',
    /** 转发列表 */
    reposts: 'weibo/reposts',
    /** 转发：纯转发 / 转发并评论 / 评论并转发共用，由 mode 区分 */
    repost: 'weibo/repost',
    /** 转发点赞 / 取消点赞：与主贴同端点，参数改用 form 并带设备指纹 */
    repostLike: 'weibo/repost/like',
    /** 转发加入 AI 对话：载荷由前端带出附言，宿主不发起网络请求 */
    repostAddToChat: 'weibo/repost/addToChat',
    /** 删除微博 / 转发 */
    destroyStatus: 'weibo/destroy',
} as const
