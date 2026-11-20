/**
 * 微博地址总表：网页端内部 ajax 端点、开放平台基址、图床与站内页面基址集中在此。
 * 复用约定：上层只引用本文件的常量拼地址，不再在各自模块里写字面量路径；
 * 基址不带尾斜杠，路径统一以 / 开头，拼接一律走 new URL(path, origin)。
 * 关键约束：这些是网页端内部 ajax，改版即失效，端点或基址变动只改这一处；
 * 本文件不拼接任何用户输入，外链与图片地址使用前仍须经白名单校验。
 */

/** 网页端基址：站内页面与 ajax 共用 */
export const WEIBO_WEB_ORIGIN = 'https://weibo.com'

/** 官网 Referer：ajax 与图床都按它判断来源 */
export const WEIBO_WEB_REFERER = 'https://weibo.com/'

/** 开放平台 REST 基址：官方 Open API 的公共前缀 */
export const WEIBO_OPEN_API_ORIGIN = 'https://api.weibo.com/2'

/** 图床基址：只有 pid 时用它拼原图直链 */
export const WEIBO_IMAGE_ORIGIN = 'https://wx1.sinaimg.cn'

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
    /** 发表框表情配置 */
    emoticons: '/ajax/statuses/config',
    /** 需登录态的图片下载端点：响应里的地址命中时改写成图床直链 */
    imageDownload: '/ajax/common/download',
    /** 当前登录账号信息 */
    profile: '/ajax/profile/info',
    /** 微博评论列表 */
    comments: '/ajax/statuses/buildComments',
    /** 长文全文 */
    longText: '/ajax/statuses/longtext',
    /** 点赞 */
    setLike: '/ajax/statuses/setLike',
    /** 取消点赞 */
    cancelLike: '/ajax/statuses/cancelLike',
} as const
