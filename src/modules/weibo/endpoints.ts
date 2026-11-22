/**
 * 微博地址总表：网页端内部 ajax 端点（含评论读取与发布）、图床与站内页面基址集中在此。
 * 复用约定：上层只引用本文件的常量拼地址，不再在各自模块里写字面量路径；
 * 协议方法名不放这里，统一取 @shared/types/weiboMethods 的 WEIBO_METHODS（前端也要用，须可跨端共享）。
 * 关键约束：这些是网页端内部 ajax，改版即失效，端点或基址变动只改这一处；
 * 本文件不拼接任何用户输入，外链与图片地址使用前仍须经白名单校验。
 */

/** 网页端基址：站内页面与 ajax 共用 */
export const WEIBO_WEB_ORIGIN = 'https://weibo.com'

/** 官网 Referer：ajax 与图床都按它判断来源 */
export const WEIBO_WEB_REFERER = 'https://weibo.com/'

/**
 * 允许打开的外链主机：微博主站与其子域，外加新浪短链服务 t.cn。
 * 关键约束：末尾精确匹配，避免 sub.weibo.com.evil.com 绕过；weibo/openPost 的校验只认这一份。
 */
export const WEIBO_ALLOWED_EXTERNAL_HOSTS = ['weibo.com', 'www.weibo.com', 'm.weibo.cn', 't.cn'] as const

/** 图床基址：只有 pid 时用它拼原图直链 */
export const WEIBO_IMAGE_ORIGIN = 'https://wx1.sinaimg.cn'

/** 图床上传基址：发表框先把本地图片传到这里换 pid，再由发布接口引用 */
export const WEIBO_PIC_UPLOAD_ORIGIN = 'https://picupload.weibo.com'

/**
 * 图床上传端点：不需要签名参数。
 * 关键约束：元数据全在 query、body 直接放图片字节（application/octet-stream）；
 * 成功回包形如 {code:'A00006', data:{pics:{pic_1:{pid}}}}。
 */
export const WEIBO_PIC_UPLOAD_PATH = '/interface/pic_upload.php'

/** 网页端内部 ajax 端点：端点增删只维护这一张表 */
export const WEIBO_AJAX_PATHS = {
    /** 首页关注时间线（增量刷新） */
    unreadTimeline: '/ajax/feed/unreadfriendstimeline',
    /** 默认分组时间线 */
    timeline: '/ajax/feed/friendstimeline',
    /** 热门频道信息流 */
    hot: '/ajax/feed/hottimeline',
    /** 自建分组信息流 */
    group: '/ajax/feed/groupstimeline',
    /** 分组与热门频道表 */
    groups: '/ajax/feed/allGroups',
    /** 侧栏热搜榜 */
    hotRank: '/ajax/side/bandUnified',
    /** 热搜页「我的」榜 */
    mineBand: '/ajax/statuses/mineBand',
    /** 热搜页「热搜」榜 */
    hotSearch: '/ajax/side/hotSearch',
    /** 热搜页「文娱」榜 */
    entertainment: '/ajax/statuses/entertainment',
    /** 热搜页「社会」榜 */
    social: '/ajax/statuses/social',
    /** 热搜页「科技」榜 */
    technology: '/ajax/statuses/technology',
    /** 热搜页「生活」榜 */
    life: '/ajax/statuses/life',
    /** 热搜页「体育」榜 */
    sport: '/ajax/statuses/sport',
    /** 热搜页「ACG」榜 */
    acg: '/ajax/statuses/acg',
    /** 热搜页「同城」榜：额外带 citycode */
    city: '/ajax/statuses/city',
    /** 发表框表情配置 */
    emoticons: '/ajax/statuses/config',
    /** 发表框话题搜索：q 为空时上游回当前账号的常用话题 */
    topic: '/ajax/mblog/topic',
    /** 需登录态的图片下载端点：响应里的地址命中时改写成图床直链 */
    imageDownload: '/ajax/common/download',
    /** 当前登录账号信息 */
    profile: '/ajax/profile/info',
    /** 微博评论列表 */
    comments: '/ajax/statuses/buildComments',
    /** 转发列表：谁转发了这条微博，按页码分页 */
    repostTimeline: '/ajax/statuses/repostTimeline',
    /** 转发：formdata 提交微博 id 与转发附言（附言可空） */
    normalRepost: '/ajax/statuses/normal_repost',
    /** 删除微博（含转发）：formdata 只提交微博 id */
    destroyStatus: '/ajax/statuses/destroy',
    /** 发布评论：formdata 提交微博 id 与正文 */
    createComment: '/ajax/comments/create',
    /** 回复评论：与发布同参，额外带被回复评论 cid */
    replyComment: '/ajax/comments/reply',
    /** 删除评论：只提交评论 cid */
    destroyComment: '/ajax/statuses/destroyComment',
    /** 评论点赞：formdata 提交 object_id 与 object_type=comment，另带设备指纹 */
    likeComment: '/ajax/statuses/updateLike',
    /** 取消评论点赞：与点赞同参，不带指纹 */
    cancelLikeComment: '/ajax/statuses/destroyLike',
    /** 长文全文 */
    longText: '/ajax/statuses/longtext',
    /** 点赞 */
    setLike: '/ajax/statuses/setLike',
    /** 取消点赞 */
    cancelLike: '/ajax/statuses/cancelLike',
    /** 关注博主：formdata 提交 friend_uid 与卡片来源参数 */
    followAuthor: '/ajax/friendships/create',
    /** 取消关注博主：formdata 只提交 uid */
    unfollowAuthor: '/ajax/friendships/destory',
    /** 我的赞：按 uid 与页码读取点赞过的微博 */
    likelist: '/ajax/statuses/likelist',
    /** 关注分组：目标用户当前所在的分组 */
    userGroupOf: '/ajax/profile/getGroupList',
    /** 关注分组：账号下的全部分组 */
    userGroupList: '/ajax/profile/getGroups',
    /** 关注分组：新建（formdata 提交 name，公开时另有 isOpen） */
    userGroupCreate: '/ajax/profile/createGroup',
    /** 关注分组：把用户移入指定分组 */
    userGroupSet: '/ajax/profile/setGroup',
    /** 备注名：设置或清除 */
    userRemark: '/ajax/friendships/remarkUpdate',
    /** 他人主页的微博列表：按 uid 与页码读取该用户发布的微博 */
    userBlog: '/ajax/statuses/mymblog',
    /** 发布微博：formdata 提交正文与图片 pid */
    publish: '/ajax/statuses/update',
} as const
