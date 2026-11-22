/**
 * 微博协议层的依赖契约：把取数、媒体、凭证与跨模块动作声明成可替换的注入面。
 * 复用约定：默认实现取各 api / media 模块的同名函数，生产由面板注入真实实现，单测可整体替换。
 * 关键约束：本文件只声明接口与外部链接白名单校验，不持有任何状态，也不引入实现模块的运行时依赖；
 * 新增协议方法时先在此登记所需能力，避免路由层直接 import 具体实现。
 */
import type {
    WeiboBlockListState,
    WeiboChatContextResult,
    WeiboCommentChatPayload,
    WeiboCommentCreateResult,
    WeiboCommentDestroyResult,
    WeiboCommentLikeResult,
    WeiboCommentRepliesResult,
    WeiboCommentsResult,
    WeiboDestroyStatusResult,
    WeiboEmoticonsResult,
    WeiboFollowResult,
    WeiboGroupCreateResult,
    WeiboGroupSaveResult,
    WeiboGroupsResult,
    WeiboHotRankResult,
    WeiboLikeResult,
    WeiboLikesResult,
    WeiboLongTextResult,
    WeiboNoteSaveResult,
    WeiboPagePostPayload,
    WeiboProfile,
    WeiboPublishResult,
    WeiboRepostChatPayload,
    WeiboRepostCreateResult,
    WeiboRepostsResult,
    WeiboTimelineResult,
    WeiboTopicsResult,
    WeiboUserBlogResult,
    WeiboUserGroupsResult,
    WeiboUserRemarkResult,
} from '@shared/types/weibo'
import type { FetchEmoticonsOptions } from '../api/emoticons'
import type { FetchFeedOptions, FetchGroupsOptions } from '../api/feed'
import type { FetchHotRankOptions } from '../api/hotRank'
import type { FetchLikesOptions } from '../api/likes'
import type { FetchLongTextOptions } from '../api/longText'
import type { FetchProfileOptions } from '../api/profile'
import type { FetchTopicsOptions } from '../api/topics'
import type { FetchUserBlogOptions } from '../api/userBlog'
import type {
    SetCommentLikeOptions,
    SetFollowOptions,
    SetLikeOptions,
    SetRepostLikeOptions,
} from '../api/write/interaction'
import type { PublishWeiboOptions, WeiboUploadImage } from '../api/write/publish'
import type { FetchCommentsOptions, FetchRepliesOptions } from '../comments/read'
import type { CreateCommentOptions, DestroyCommentOptions } from '../comments/write'
import type { FetchUserGroupsOptions } from '../groups/read'
import type { CreateUserGroupOptions, SaveUserGroupsOptions, SetUserRemarkOptions } from '../groups/write'
import type { WeiboAvatarGateway } from '../media/avatar'
import type { FetchRepostsOptions } from '../reposts/read'
import type { CreateRepostOptions, DestroyStatusOptions } from '../reposts/write'
import type { WeiboCookieStore } from '../store/credential'
import type { WeiboCache } from '../store/metadataCache'
import type { FetchTimelineOptions } from '../timeline/query'
import { WEIBO_ALLOWED_EXTERNAL_HOSTS } from '../endpoints'

/** 路由依赖：取数、图片代理与打开外链都可替换，生产由面板注入真实实现 */
export interface WeiboRouteDeps {
    cookieStore: WeiboCookieStore
    /** 读取同城城市代码：缺省回落默认城市，非法值同样回落 */
    readCityCode?: () => string
    /** 写入同城城市代码：由面板落到 zhai.weibo.cityCode 配置 */
    writeCityCode?: (cityCode: string) => Promise<void>
    /** 读取屏蔽用户名名单：由面板落到 zhai.weibo.blockedUsers 配置 */
    readBlockedUsers?: () => string[]
    /** 读取屏蔽关键字名单：由面板落到 zhai.weibo.blockedKeywords 配置 */
    readBlockedKeywords?: () => string[]
    /** 写入屏蔽名单：两个名单一次落盘，避免半份名单生效 */
    writeBlockList?: (list: WeiboBlockListState) => Promise<void>
    /** 元数据缓存：分组 / 热搜 / 表情的复用入口，未注入时退化为每次都回源 */
    cache?: WeiboCache
    /** 图片缓存清理：清除凭证时一并删除已落盘的图，避免换号后旧账号图片残留在磁盘 */
    clearMediaCache?: () => Promise<void>
    fetchTimeline?: (options: FetchTimelineOptions) => Promise<WeiboTimelineResult>
    /** 信息流读取：时间线 / 热门 / 分组共用，单测可替换 */
    fetchFeed?: (options: FetchFeedOptions) => Promise<WeiboTimelineResult>
    /** 分组列表读取：默认分组与我的分组一次取回 */
    fetchGroups?: (options: FetchGroupsOptions) => Promise<WeiboGroupsResult>
    /** 表情配置读取：发表框的表情面板使用 */
    fetchEmoticons?: (options: FetchEmoticonsOptions) => Promise<WeiboEmoticonsResult>
    /** 话题搜索读取：发表框的话题面板使用 */
    fetchTopics?: (options: FetchTopicsOptions) => Promise<WeiboTopicsResult>
    /** 发布微博：默认走「图床换 pid → update 提交」两步，单测可替换 */
    publishPost?: (options: PublishWeiboOptions) => Promise<WeiboPublishResult>
    /** 读取 uploads 下的图片字节：发布前先传图床；未注入时带图发布会报未就绪 */
    readUploadImage?: (path: string) => Promise<WeiboUploadImage>
    /** 热搜榜读取：右侧边栏使用 */
    fetchHotRank?: (options: FetchHotRankOptions) => Promise<WeiboHotRankResult>
    /** 账号信息读取：顶栏账号菜单使用，默认走网页版 profile/info */
    fetchProfile?: (options: FetchProfileOptions) => Promise<WeiboProfile>
    /** 头像网关：读本地 weibo_avatar.jpg / 下载落盘 / 清除；未注入时账号菜单没有头像 */
    avatar?: WeiboAvatarGateway
    /** 图片代理：把远程图片下成本地文件并返回 Webview 可加载的地址 */
    resolveImageUrl?: (imageUrl: string) => Promise<string | null>
    /** 视频中转：把 CDN 整段 mp4 地址换成本地可播地址与可否拖动标记（本地服务补 Referer 流式转发） */
    resolveVideoUrl?: (videoUrl: string) => Promise<{ url: string; seekable: boolean } | null>
    /** 点赞写入：默认走网页版 setLike / cancelLike，单测可替换 */
    setLike?: (options: SetLikeOptions) => Promise<WeiboLikeResult>
    /** 评论点赞写入：默认走网页版 updateLike / destroyLike，单测可替换 */
    setCommentLike?: (options: SetCommentLikeOptions) => Promise<WeiboCommentLikeResult>
    /** 转发点赞写入：默认走网页版 setLike / cancelLike（form + fp），单测可替换 */
    setRepostLike?: (options: SetRepostLikeOptions) => Promise<WeiboLikeResult>
    /** 关注写入：默认走网页版 friendships/create 与 friendships/destory，单测可替换 */
    setFollow?: (options: SetFollowOptions) => Promise<WeiboFollowResult>
    /** 关注分组读取：默认走 profile/getGroupList + getGroups，单测可替换 */
    fetchUserGroups?: (options: FetchUserGroupsOptions) => Promise<WeiboUserGroupsResult>
    /** 关注分组新建：默认走 profile/createGroup，单测可替换 */
    createUserGroup?: (options: CreateUserGroupOptions) => Promise<WeiboGroupCreateResult>
    /** 关注分组保存：默认走 profile/setGroup，单测可替换 */
    saveUserGroups?: (options: SaveUserGroupsOptions) => Promise<WeiboGroupSaveResult>
    /** 备注名设置：默认走 friendships/remarkUpdate，单测可替换 */
    setUserRemark?: (options: SetUserRemarkOptions) => Promise<WeiboUserRemarkResult>
    /** 我的赞读取：默认走网页版 likelist，单测可替换 */
    fetchLikes?: (options: FetchLikesOptions) => Promise<WeiboLikesResult>
    /** 他人主页读取：默认走 profile/info + mymblog，单测可替换 */
    fetchUserBlog?: (options: FetchUserBlogOptions) => Promise<WeiboUserBlogResult>
    /** 评论读取：默认走网页版 buildComments，单测可替换 */
    fetchComments?: (options: FetchCommentsOptions) => Promise<WeiboCommentsResult>
    /** 评论发布与回复：默认走网页版 comments/create 与 comments/reply，单测可替换 */
    createComment?: (options: CreateCommentOptions) => Promise<WeiboCommentCreateResult>
    /** 评论删除：默认走网页版 statuses/destroyComment，单测可替换 */
    destroyComment?: (options: DestroyCommentOptions) => Promise<WeiboCommentDestroyResult>
    /** 子评论读取：默认走网页版 buildComments（is_mix=1 / fetch_level=1），单测可替换 */
    fetchCommentReplies?: (options: FetchRepliesOptions) => Promise<WeiboCommentRepliesResult>
    /** 转发列表读取：默认走网页版 repostTimeline，单测可替换 */
    fetchReposts?: (options: FetchRepostsOptions) => Promise<WeiboRepostsResult>
    /** 转发提交：默认走网页版 normal_repost，单测可替换 */
    createRepost?: (options: CreateRepostOptions) => Promise<WeiboRepostCreateResult>
    /** 删除微博 / 转发：默认走网页版 statuses/destroy，单测可替换 */
    destroyStatus?: (options: DestroyStatusOptions) => Promise<WeiboDestroyStatusResult>
    /** 长文读取：默认走网页版 longtext，单测可替换 */
    fetchLongText?: (options: FetchLongTextOptions) => Promise<WeiboLongTextResult>
    /** 卡片动作·保存为笔记：由面板注入笔记落盘能力，未注入时该方法报未就绪 */
    saveToNote?: (post: WeiboPagePostPayload) => Promise<WeiboNoteSaveResult>
    /** 卡片动作·添加到 AI 对话：由面板注入会话能力，未注入时该方法报未就绪 */
    addToChat?: (post: WeiboPagePostPayload) => Promise<WeiboChatContextResult>
    /** 评论动作·添加到 AI 对话：评论正文由载荷带出，与卡片共用同一会话能力 */
    commentAddToChat?: (payload: WeiboCommentChatPayload) => Promise<WeiboChatContextResult>
    /** 转发动作·添加到 AI 对话：附言由载荷带出，与卡片共用同一会话能力 */
    repostAddToChat?: (payload: WeiboRepostChatPayload) => Promise<WeiboChatContextResult>
    openExternal?: (url: string) => Promise<void>
    now?: () => Date
}

/** 判定外链主机是否在白名单内：末尾精确匹配，避免 sub.weibo.com.evil.com 绕过 */
export function isAllowedExternalUrl(url: string): boolean {
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:') {
            return false
        }
        return WEIBO_ALLOWED_EXTERNAL_HOSTS.some(
            (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
        )
    } catch {
        return false
    }
}
