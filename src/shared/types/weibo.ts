/**
 * 微博信息流契约：关注时间线、热门、分组信息流、热搜标签、分组列表、用户主页、表情配置、发表框话题与发布的模型与不可信载荷收窄。
 * 复用约定：宿主侧 modules/weibo 负责请求与归一化，Webview 只消费归一化后的帖子、榜单与表情，
 * 协议方法名登记在 shared/types/messages，面板经 request/response 通道取数。
 * 关键约束：信息流与榜单只读，写操作只保留点赞与发布两条；Cookie 明文永不出宿主、不入日志，
 * 凭证状态只回传是否已配置与保存时间；sinceId 与 maxId 互斥，二者都给出时以 maxId 为准；
 * 分组与游标必须是纯数字串，用户主页的 uid 与昵称二选一，热搜 tab 与同城 cityCode 只接受登记过的取值，
 * 表情图地址必须落在图床白名单内，发布图片路径必须落在 uploads 目录内，
 * 避免任意内容被拼进参数或渲染。
 */
import { isUploadPath } from './upload'

/** 单页默认条数：与网页端首屏一致，上游超过 50 会被截断 */
export const WEIBO_TIMELINE_DEFAULT_COUNT = 20

/** 单页条数上限：上游实际在 50 条附近封顶，超出没有意义 */
export const WEIBO_TIMELINE_MAX_COUNT = 50

/** 单次调用的翻页上限：微博历史分页约 20 页见底，这里再保守一档，避免一次点击打出长请求链 */
export const WEIBO_TIMELINE_MAX_PAGES = 10

/** 刷新标志位：网页端首屏与下拉刷新固定传 4，翻页不传 */
export const WEIBO_TIMELINE_DEFAULT_REFRESH = 4

/** 时间线请求的失败分类：前端按码分发提示，不解析文案 */
export type WeiboTimelineErrorCode =
    'no-credential' | 'unauthorized' | 'rate-limited' | 'upstream' | 'network' | 'invalid-payload'

/** 时间线入参：不带游标时拉最新一页，带 sinceId 为增量，带 maxId 为向后翻页 */
export interface WeiboTimelineRequest {
    /** 增量游标：上次结果最新的微博 id，或用上游返回的 since_id；"0" 表示不启用增量 */
    sinceId?: string | null
    /** 向后翻页游标：上一页响应顶层的 max_id，不能自行构造 */
    maxId?: string | null
    /** 单页条数：缺省 20，超出 [1, 50] 由宿主夹取 */
    count?: number
    /** 当前登录用户 uid：仅用于拼 list_id，缺省时上游按 Cookie 会话识别 */
    uid?: string | null
    /** 刷新标志位：缺省 4 */
    refresh?: number
    /** 本次最多翻几页：缺省 1，夹取到 [1, 10] */
    maxPages?: number
}

/** 微博作者：只保留展示与跳转所需字段 */
export interface WeiboTimelineAuthor {
    id: string
    name: string
    /** 头像直链：Webview 的 CSP 不放行远程图片，仅作数据保留 */
    avatarUrl: string
    isVerified: boolean
    /**
     * 当前账号是否已关注该作者：来自上游 user.following，缺失按未关注处理。
     * 关键约束：只有时间线口径带这个字段，转发列表里的作者恒为 false，不据此暴露关注入口。
     */
    isFollowing: boolean
}

/** 互动数据：字段名与上游一一对应，缺失按 0 处理 */
export interface WeiboTimelineMetrics {
    reposts: number
    comments: number
    likes: number
}

/** 评论作者：只保留展示所需字段 */
export interface WeiboCommentAuthor {
    id: string
    name: string
    avatarUrl: string
    /** 是否认证：与主贴作者同口径，只认上游 verified 布尔，缺失按未认证处理 */
    isVerified: boolean
}

/**
 * 子评论：随一级评论一起下发的回复预览。
 * 正文口径与一级评论一致（分段保留表情），另记被回复者昵称，用于展示「回复 @某人」。
 */
export interface WeiboCommentReply {
    id: string
    text: string
    segments: WeiboTimelineSegment[]
    /** ISO 时间：解析失败为空串 */
    createdAt: string
    createdAtRaw: string
    author: WeiboCommentAuthor
    /** 被回复者昵称：来自上游 reply_comment，不是回复关系时为空串 */
    replyToName: string
    /** 被回复者 uid：前端据此拼个人主页链接，上游未给时为空串 */
    replyToUid: string
    /** 点赞数：上游未给时为 0 */
    likes: number
    /** 当前账号是否已赞这条子评论：上游未给该字段时按未赞处理 */
    isLiked: boolean
}

/** 单条评论：正文与主贴同口径（分段保留表情） */
export interface WeiboCommentItem {
    id: string
    /** 纯文本正文：表情以 `[名称]` 形式保留 */
    text: string
    /** 正文分段：用于内联渲染表情 */
    segments: WeiboTimelineSegment[]
    /** ISO 时间：解析失败为空串 */
    createdAt: string
    createdAtRaw: string
    author: WeiboCommentAuthor
    likes: number
    /** 当前账号是否已赞这条评论：上游未给该字段时按未赞处理 */
    isLiked: boolean
    /** 子评论预览：上游随一级评论下发的若干条回复，可能为空 */
    replies: WeiboCommentReply[]
    /** 子评论总数：大于 replies.length 说明上游还有没下发的回复 */
    replyCount: number
}

/** 长文请求：id 可为 mblogid（如 Rs4KtdzoV）或数字 id */
export interface WeiboLongTextRequest {
    id: string
}

/** 长文结果：纯文本全文，换行原样保留 */
export interface WeiboLongTextResult {
    text: string
}

/** 评论正文字数上限：与网页端评论框一致，超出由前端输入框先拦住 */
export const WEIBO_COMMENT_MAX_LENGTH = 140

/** 评论发布请求：id 为数字微博 id，text 为纯文本正文 */
export interface WeiboCommentCreateRequest {
    /** 微博数字 id */
    id: string
    /** 纯文本正文：提交前由宿主再 trim 一次 */
    text: string
    /** 被回复评论的数字 id：给出即走回复端点，缺省是发新评论 */
    replyToId?: string
}

/** 评论发布结果：成功即 created 为真，失败走错误码 */
export interface WeiboCommentCreateResult {
    created: boolean
}

/** 评论删除请求：只能删自己的评论，归属由宿主与前端各自把关 */
export interface WeiboCommentDestroyRequest {
    /** 被删除评论的数字 id */
    cid: string
}

/** 评论删除结果：成功即 deleted 为真，失败走错误码 */
export interface WeiboCommentDestroyResult {
    deleted: boolean
}

/** 评论点赞请求：cid 为评论数字 id，liked 为点击后的目标状态 */
export interface WeiboCommentLikeRequest {
    cid: string
    liked: boolean
}

/** 评论点赞结果：上游不回计数时 likeCount 为 null，由前端按本地增减继续显示 */
export interface WeiboCommentLikeResult {
    liked: boolean
    likeCount: number | null
}

/** 评论请求：maxId 缺省拉第一页 */
export interface WeiboCommentsRequest {
    /** 微博数字 id */
    id: string
    /** 下一页游标：上一次结果里的 maxId */
    maxId?: string | null
    count?: number
}

/** 子评论请求：id 是一级评论的数字 id，不是微博 id */
export interface WeiboCommentRepliesRequest {
    /** 一级评论的数字 id */
    id: string
    /** 下一页游标：上一次结果里的 maxId */
    maxId?: string | null
    count?: number
}

/** 子评论结果：只回传回复本身与游标，总数仍以一级评论上的 replyCount 为准 */
export interface WeiboCommentRepliesResult {
    replies: WeiboCommentReply[]
    /** 下一页游标：null 表示没有更多 */
    maxId: string | null
    hasMore: boolean
}

/** 评论分页结果 */
export interface WeiboCommentsResult {
    comments: WeiboCommentItem[]
    /** 上游声明的评论总数 */
    totalNumber: number
    /** 下一页游标：null 表示没有更多 */
    maxId: string | null
    hasMore: boolean
}

/**
 * 评论加入 AI 对话的载荷：评论没有独立永久链接，正文与作者由前端带出，宿主不发起网络请求。
 * 一级评论与子评论共用同一形状，子评论用 replyToName 标明被回复者。
 */
export interface WeiboCommentChatPayload {
    /** 评论数字 id：只作引用去重键，不拼进任何请求 */
    commentId: string
    /** 评论作者昵称：空串时由宿主回退为占位 */
    authorName: string
    /** 评论正文纯文本：表情以 `[名称]` 形式保留 */
    text: string
    /** 评论时间（ISO 8601）：解析失败为空串 */
    createdAt: string
    /** 被回复者昵称：一级评论为空串 */
    replyToName: string
}

/** 转发项：谁转发了这条微博，正文是转发时附带的评论（纯转发为空） */
export interface WeiboRepostItem {
    id: string
    mblogid: string
    /** 纯文本正文：转发附言，纯转发为空串 */
    text: string
    segments: WeiboTimelineSegment[]
    /** ISO 时间：解析失败为空串 */
    createdAt: string
    createdAtRaw: string
    author: WeiboTimelineAuthor
    /** 点赞数：上游未下发该字段时为 null（与真实的 0 区分，界面据此决定是否显示数字） */
    likes: number | null
    /** 当前账号是否已赞这条转发：上游未给时按未赞处理 */
    isLiked: boolean
    /** 被转发原微博的点赞数：与转发自身的点赞是两份数据，未下发时为 null */
    originalLikes: number | null
    /** 来源客户端：已剥掉「来自」外壳 */
    source: string
}

/**
 * 转发加入 AI 对话的载荷：转发没有独立永久链接，正文与作者由前端带出，宿主不发起网络请求。
 * 纯转发的附言为空串，宿主按「无正文」渲染，仍然可以入上下文（作者与时间本身有信息量）。
 */
export interface WeiboRepostChatPayload {
    /** 转发数字 id：只作引用去重键，不拼进任何请求 */
    repostId: string
    /** 转发作者昵称：空串时由宿主回退为占位 */
    authorName: string
    /** 转发附言纯文本：表情以 `[名称]` 形式保留，纯转发为空串 */
    text: string
    /** 转发时间（ISO 8601）：解析失败为空串 */
    createdAt: string
}

/** 转发列表请求：只有页码分页，没有游标 */
export interface WeiboRepostsRequest {
    /** 微博数字 id */
    id: string
    /** 页码：从 1 开始 */
    page?: number
    count?: number
}

/** 转发列表结果 */
export interface WeiboRepostsResult {
    reposts: WeiboRepostItem[]
    /** 本次请求的页码：前端据此递增 */
    page: number
    hasMore: boolean
}

/**
 * 转发附言字数上限：纯转发放宽到 500 字，超出由前端输入框先拦住。
 * 关键约束：转发并评论（repostWithComment）与评论并转发（commentWithRepost）的 comment
 * 都会在原博下生成一条评论，仍受 WEIBO_COMMENT_MAX_LENGTH 约束，校验按 mode 分流。
 */
export const WEIBO_REPOST_MAX_LENGTH = 500

/**
 * 转发方式：与提交参数一一对应。
 * repost = 只转发（is_repost=0 / is_comment=0）；
 * repostWithComment = 转发并评论（is_comment=1，仍带 visible 与 share_id）；
 * commentWithRepost = 评论并转发（is_repost=1，不带 visible 与 share_id）。
 */
export type WeiboRepostMode = 'repost' | 'repostWithComment' | 'commentWithRepost'

/** 转发请求：comment 可空（纯转发）；上限随 mode 分流，纯转发按转发上限，生成评论的模式按评论上限 */
export interface WeiboRepostCreateRequest {
    /** 微博数字 id */
    id: string
    /** 转发附言：纯转发传空串 */
    comment: string
    /** 转发方式：缺省只转发 */
    mode?: WeiboRepostMode
}

/** 转发结果：转发与附带评论各自标记，评论并转发是两步、可能只成一半 */
export interface WeiboRepostCreateResult {
    reposted: boolean
    /** 是否同时生成了评论（转发并评论 / 评论并转发） */
    commented: boolean
    /** 部分成功时的上游原因：评论已发出但转发失败时给出，前端据此提示并避免重发评论 */
    failureMessage?: string
}

/** 删除微博请求：转发与自己发的微博都按 status id 删 */
export interface WeiboDestroyStatusRequest {
    /** 微博数字 id */
    id: string
}

/** 删除微博结果：成功即 deleted 为真，失败走错误码 */
export interface WeiboDestroyStatusResult {
    deleted: boolean
}

/** 图片像素尺寸：取自上游 `largest` 档位（最大可用尺寸），预览角标与竖横判断都用它 */
export interface WeiboTimelineImageSize {
    width: number
    height: number
}

/**
 * 混排媒体项：保留上游 mix_media_info 的原始顺序，图文与视频的相对位置不再丢失。
 * 关键约束：视频项只给封面与时长，不给播放直链——播放地址带签名且校验 Referer，
 * 既会在缓存里迅速失效，也无法由 Webview 直连；观看一律回到原文。
 */
/** 视频分辨率：宽度与高度（像素），取上游各清晰度里最大的一档 */
export interface WeiboTimelineVideoResolution {
    width: number
    height: number
}

export type WeiboTimelineMediaItem =
    | {
          kind: 'image'
          /** 原图直链：保存到笔记等需要最大尺寸的场合使用，卡片不再加载 */
          url: string
          /** 展示图直链（长边 960）：九宫格与卡片内预览共用 */
          middleUrl: string
          /** 上游 largest 档尺寸：缺失为 null，前端回退到解码后的自然尺寸 */
          size: WeiboTimelineImageSize | null
      }
    | {
          kind: 'video'
          /** 封面原图直链：上游未给封面时为 null，卡片回落为纯播放占位 */
          coverUrl: string | null
          /** 封面中图直链：与 coverUrl 同源，缺失为 null */
          coverMiddleUrl: string | null
          /** 时长（秒）：上游未给时为 null */
          durationSeconds: number | null
          /**
           * 可直接播放的整段 mp4 地址：取 media_info 的 progressive 字段。
           * 关键约束：playback_list 里是 DASH 分片，`<video>` 不能直接播，不作为播放源；
           * 缺失时前端回退「打开原文」。
           */
          playUrl: string | null
          /** 视频最大分辨率：用于左上角清晰度角标，缺失时为 null 不显示 */
          resolution: WeiboTimelineVideoResolution | null
      }

/** 媒体摘要：只给直链与数量，不做下载 */
export interface WeiboTimelineMedia {
    /** 混排顺序：图文与视频按上游原序排列；下方三个图片数组均由它派生 */
    items: WeiboTimelineMediaItem[]
    /** 原图直链：保存到笔记等需要最大尺寸的场合使用，与 thumbnails 一一对应 */
    images: string[]
    /**
     * 图片 pid：与 images 同序，供宿主按官方下载端点取最大尺寸。
     * 关键约束：上游只给直链未给 pid 的图对应空串，调用方据此回退直链下载。
     */
    imageIds: string[]
    /** 展示图直链（长边 960，缺失才回退长边 360）：九宫格与卡片内预览共用，不再为预览另取原图 */
    thumbnails: string[]
    /** 最大尺寸：与 images 同序（取上游 largest 档）；上游未给时为 null，前端回退到解码后的自然尺寸 */
    sizes: Array<WeiboTimelineImageSize | null>
    /** 首个可播放地址：保留字段，供「打开原文」之外的兜底诊断 */
    videoUrl: string | null
    /** 上游声明的图片总数（不含视频）：直链缺失时前端据此提示「另有 N 张」 */
    imageCount: number
    /** 视频条数：混排里视频不占图片格，单独计数 */
    videoCount: number
}

/**
 * 转发体：只保留原文摘要与媒体，避免递归展开。
 * 关键约束：媒体与主贴同形（图片 + 视频封面），由同一份 extractMedia 归一化，
 * 卡片上直接展示，不再递归解析转发里再转发的层级。
 */
export interface WeiboTimelineRetweet {
    id: string
    /** 原作者 uid：卡片作者行展示 `@UID` 用，上游未给时为空串 */
    authorId: string
    authorName: string
    /** 原作者认证标记：卡片在作者名后挂认证角标 */
    authorIsVerified: boolean
    text: string
    /** 正文分段：与主贴同口径，正文里的 @账号、话题与链接可点 */
    segments: WeiboTimelineSegment[]
    url: string
    /** ISO 8601 时间：解析失败为空串，展示回退 createdAtRaw */
    createdAt: string
    /** 上游原样时间串：排障与兜底展示用 */
    createdAtRaw: string
    /** 原文媒体：图片九宫格与视频封面，结构与主贴一致 */
    media: WeiboTimelineMedia
    /** 长文标记：text 只是摘要，保存笔记前需要先取全文 */
    isLongText: boolean
}

/**
 * 正文链接分类：前端按类着色，不承担跳转语义（跳转一律由宿主 openExternal 完成）。
 * mention 为 @账号，topic 为 #话题#，supertopic 为 #超话#，link 为短链与其余站内页面。
 */
export type WeiboTimelineLinkKind = 'mention' | 'topic' | 'supertopic' | 'link'

/**
 * 正文片段：文本、表情与链接按上游原顺序交错。
 * 表情只保留图床直链与名称，前端按内联图片渲染；文本片段已剥标签解实体。
 * 关键约束：链接段的 url 已在宿主侧收窄到微博域名白名单（含 t.cn），前端不再二次校验。
 */
export type WeiboTimelineSegment =
    | { type: 'text'; text: string }
    | { type: 'emoji'; name: string; url: string }
    | { type: 'link'; text: string; url: string; kind: WeiboTimelineLinkKind }

/** 归一化后的单条微博 */
export interface WeiboTimelinePost {
    /** 数字微博 id（字符串形式）：去重与增量游标的唯一依据 */
    id: string
    /** 短 id：用于拼网页永久链接 */
    mblogid: string
    /** 原文地址：域名由宿主固定为 weibo.com */
    url: string
    /** 纯文本正文：已剥标签、解实体、去零宽字符（表情以图片形式单独成段，此处不含表情名） */
    text: string
    /** 正文分段：用于内联渲染表情，文本片段与 text 同源 */
    segments: WeiboTimelineSegment[]
    /** ISO 8601 时间：解析失败为空串，展示回退 createdAtRaw */
    createdAt: string
    /** 上游原样时间串：排障与兜底展示用 */
    createdAtRaw: string
    /** 来源客户端：已剥掉「来自」外壳 */
    source: string
    author: WeiboTimelineAuthor
    metrics: WeiboTimelineMetrics
    media: WeiboTimelineMedia
    retweeted: WeiboTimelineRetweet | null
    /** 当前登录账号是否已赞：来自上游 attitudes_status，缺失按未赞处理 */
    isLiked: boolean
    /** 长文标记：正文被截断时提示用户去原文查看 */
    isLongText: boolean
    /** 阅读数：上游只对自己发布的微博下发，缺失或非本人微博为 null */
    readsCount: number | null
}

/** 一页或一次增量的结果 */
export interface WeiboTimelineResult {
    posts: WeiboTimelinePost[]
    /** 下次增量的起点：取本次最新一条的 id，缺省回退上游 since_id */
    sinceId: string | null
    /** 下一页游标：null 表示已到底或本次不需要继续翻 */
    maxId: string | null
    hasMore: boolean
    /** 本次实际请求的页数 */
    pages: number
    /** 结果生成时刻（ISO） */
    fetchedAt: string
    /** 分页重叠或重复下发被丢弃的条数 */
    droppedDuplicates: number
}

/**
 * 卡片动作载荷：微博卡片「保存到笔记」「添加到 AI 对话」提交的展示字段。
 * 关键约束：只承载卡片上已归一化的内容，宿主不据此回源取详情；
 * 所有字段按不可信输入收窄（正文与转发体有长度上限、配图有数量上限），
 * url 必须是 https 且属微博主站域名，越界载荷由宿主整批拒绝。
 */
export interface WeiboPagePostPayload {
    /** 数字微博 id */
    id: string
    /** 短 id：上游缺失时为空串（此时原文地址已回退 /detail/{id}） */
    mblogid: string
    /** 原文地址：笔记 source 与对话引用去重键 */
    url: string
    /** 纯文本正文：已展开全文时是完整内容，未展开的长文为摘要 */
    text: string
    /** 微博发布时间（ISO 8601）：解析失败为空串 */
    createdAt: string
    author: { id: string; name: string }
    /** 配图原图直链：最多 9 张，仅 https */
    images: string[]
    /** 配图 pid：与 images 同序，宿主据此按官方下载端点取最大尺寸；上游未给时为空串 */
    imageIds: string[]
    /** 视频直链：无视频或不可播时为 null；笔记与 AI 上下文都不使用（视频一律忽略） */
    videoUrl: string | null
    /** 转发体：文本与配图；无转发为 null。转发体的视频同样不带 */
    retweeted: {
        /** 数字微博 id：长文补全时用它调全文接口；旧载荷可能为空串 */
        id: string
        authorName: string
        text: string
        /** 转发配图原图直链：最多 9 张，仅 https */
        images: string[]
        /** 转发配图 pid：与 images 同序 */
        imageIds: string[]
        /** 转发正文是否被上游截断：为 true 时保存前先取全文 */
        isTruncated: boolean
    } | null
    /** 正文是否被上游截断（长文未展开） */
    isTruncated: boolean
}

/** 保存到笔记的结果：path 为存储根相对路径，前端只展示不拼装 */
export interface WeiboNoteSaveResult {
    path: string
    title: string
    /** 已搬进 uploads/ 的配图张数：未搬运（下载失败或无需搬运）的配图仍保留远程直链 */
    imageCount: number
}

/** 添加到 AI 对话的结果：added 为 false 时 reason 说明原因（重复或已达上限） */
export interface WeiboChatContextResult {
    added: boolean
    reason?: string
    label?: string
}

/** 信息流单页默认条数：时间线、热门与分组统一按 20 条首屏加载 */
export const WEIBO_FEED_DEFAULT_COUNT = 20

/** 信息流来源：时间线（默认分组）、热门（频道推荐）与自定义分组 */
export type WeiboFeedSource = 'timeline' | 'hot' | 'group'

/**
 * 热门频道：gid 与 containerid 来自 allGroups 的「我的频道 / 频道推荐」分区，
 * 宿主按 gid 查到 containerid 后拼请求；菜单只显示默认预设与手动添加的那些。
 */
export interface WeiboHotChannel {
    /** 频道 gid：前端用它当 listId 选频道 */
    gid: string
    title: string
    /** 上游 containerid：不能用 gid 推导（有的带 _ctg1_… 形式） */
    containerId: string
}

/** 热门菜单最多显示的频道数：默认预设已占去大半，只留少量补充位 */
export const WEIBO_HOT_CHANNEL_LIMIT = 10

/**
 * 固定保留的热门频道：始终在菜单里，不允许移除 —— 它们是最常用的四个入口。
 */
export const WEIBO_PINNED_HOT_CHANNELS: readonly WeiboHotChannel[] = [
    { gid: '102803', title: '推荐', containerId: '102803' },
    { gid: '102803600343', title: '实时', containerId: '102803_ctg1_600343_-_ctg1_600343' },
    { gid: '1028032222', title: '同城', containerId: '102803_2222' },
    { gid: '102803600169', title: '榜单', containerId: '102803_ctg1_600169_-_ctg1_600169' },
]

/**
 * 默认显示的热门频道：顺序即菜单顺序，参数取自网页端发现页各频道的实际请求地址。
 * 关键约束：小时榜、周榜、昨日、前日并不出现在 allGroups 的频道分区里，只能本地预设；
 * 它们默认上菜单，但允许像补充频道一样移除 —— 移除后仍存在候选池里，可以再加回来。
 * 其余频道由「＋」从 allGroups 的频道池补充，整体受 WEIBO_HOT_CHANNEL_LIMIT 约束。
 */
export const WEIBO_DEFAULT_HOT_CHANNELS: readonly WeiboHotChannel[] = [
    ...WEIBO_PINNED_HOT_CHANNELS,
    { gid: '1028039999', title: '小时榜', containerId: '102803_ctg1_9999_-_ctg1_9999_home' },
    { gid: '1028038698', title: '周榜', containerId: '102803_ctg1_8698_-_ctg1_8698' },
    { gid: '1028038899', title: '昨日', containerId: '102803_ctg1_8899_-_ctg1_8899' },
    { gid: '1028038799', title: '前日', containerId: '102803_ctg1_8799_-_ctg1_8799' },
]

/**
 * 信息流入参：游标语义与 weibo/timeline 一致，端点由 source 决定。
 * 关键约束：group 必须给定 listId；timeline 缺省时宿主自行从默认分组取「最新微博」gid；
 * hot 的 listId 是频道 gid（来自 allGroups），缺省时回落到频道表首项。
 */
export interface WeiboFeedRequest {
    source: WeiboFeedSource
    /** 列表 id：timeline 为默认分组 gid，group 为分组 gid，hot 为热门频道 gid */
    listId?: string | null
    sinceId?: string | null
    maxId?: string | null
    /** 单页条数：缺省 20，超出 [1, 50] 由宿主夹取 */
    count?: number
    /** 本次最多翻几页：缺省 1，夹取到 [1, 10] */
    maxPages?: number
}

/**
 * 我的赞入参：点赞列表只按页码翻页，不吃 sinceId / maxId 游标。
 * 关键约束：uid 由宿主从分组缓存解析，前端不传，避免拼错或伪造他人 uid。
 */
export interface WeiboLikesRequest {
    /** 页码：从 1 开始，缺省 1 */
    page?: number
}

/** 我的赞结果：帖子与信息流同形，分页信息按页码表达 */
export interface WeiboLikesResult {
    posts: WeiboTimelinePost[]
    /** 本次请求的页码：从 1 开始 */
    page: number
    /** 是否还有下一页：上游给出总数时按总数判断，缺失时以本页是否满页为准 */
    hasMore: boolean
    /** 上游声明的点赞总数（with_total=true）：缺失为 null */
    totalNumber: number | null
    /** 结果生成时刻（ISO） */
    fetchedAt: string
    /** 分页重叠或重复下发被丢弃的条数 */
    droppedDuplicates: number
}

/** 分组条目：只保留选择与展示所需字段 */
export interface WeiboGroupItem {
    gid: string
    title: string
    /** 归属账号 uid：拼个人主页地址时使用 */
    uid: string
    /** 是否为用户自建分组（上游 sysgroup=0） */
    isCustom: boolean
}

/** 分组结果：默认分组供时间线取 list_id，我的分组与热门频道供菜单展示 */
export interface WeiboGroupsResult {
    defaultGroups: WeiboGroupItem[]
    myGroups: WeiboGroupItem[]
    /** 热门频道：取自「我的频道」与「频道推荐」两个分区，顺序即 menu 顺序 */
    hotChannels: WeiboHotChannel[]
    /** 关注时间线使用的 list_id：宿主按「最新微博」条目选定，缺失为 null */
    timelineListId: string | null
    /** 当前登录账号 uid：上游未给出时为 null */
    uid: string | null
}

/** 表情条目：phrase 是插入正文的文本，url 为已收窄到图床白名单的表情图直链 */
export interface WeiboEmoticonItem {
    phrase: string
    url: string
    /** 上游分类名：空串表示未分类 */
    category: string
}

/** 表情配置结果：一次取回全部可用表情，前端按需分页渲染 */
export interface WeiboEmoticonsResult {
    emoticons: WeiboEmoticonItem[]
    /** 结果生成时刻（ISO） */
    fetchedAt: string
}

/** 话题搜索入参：q 为空或缺失时表示取常用话题 */
export interface WeiboTopicsRequest {
    q?: string
}

/** 话题搜索结果：topics 为已去空白、去重的纯文本话题名，不含 # 号 */
export interface WeiboTopicsResult {
    topics: string[]
}

/** 发布微博入参：正文与已选图片（uploads 相对路径，宿主读字节并先传图床换 pid） */
export interface WeiboPublishRequest {
    /** 正文：可含 #话题# 与 [表情] 文本，原样提交，不做二次转义 */
    content: string
    /** 图片：最多 9 张，每项须为 uploads/{YYYYMM}/{文件名} */
    images?: string[]
}

/** 发布结果：成功时带回新微博的标识与原文地址 */
export interface WeiboPublishResult {
    /** 数字 id */
    id: string
    /** mblogid：原文地址用它拼接 */
    mblogid: string
    /** 原文地址：优先按账号 uid + mblogid 拼站内地址 */
    url: string
    /** 归一化后的完整微博：前端据此本地前插到时间线，避免发布后整页刷新 */
    post: WeiboTimelinePost | null
}

/** 热搜榜条目：只保留展示所需字段，图地址与徽标色均已在宿主侧收窄 */
export interface WeiboHotRankItem {
    /** 榜单序号：从 1 开始，优先取上游 realpos，缺失时用 rank + 1 或数组下标 */
    rank: number
    title: string
    /** 榜单标记文案（如「热」「新」）：有则用 badge 展示 */
    description: string | null
    /** 排行图标直链：有则直接显示图片 */
    iconUrl: string | null
    /** 图标徽标文案：与 iconDescColor 一起决定 badge 外观 */
    iconDesc: string | null
    /** 徽标底色：仅接受 #rgb / #rrggbb / rgb()，其余归一为 null */
    iconDescColor: string | null
}

/** 热搜榜结果：items 按榜单顺序排列 */
export interface WeiboHotRankResult {
    items: WeiboHotRankItem[]
    /** 结果生成时刻（ISO） */
    fetchedAt: string
}

/**
 * 热搜榜单来源：band 为侧栏默认榜（bandUnified），其余为热搜页各标签。
 * 关键约束：每个取值对应一个固定的网页端 ajax 端点，新增标签须在宿主地址总表里登记。
 */
export type WeiboHotRankTab =
    'band' | 'mine' | 'hotSearch' | 'entertainment' | 'social' | 'technology' | 'life' | 'sport' | 'acg' | 'city'

/** 热搜页标签清单：顺序即页面与菜单顺序（band 只用于侧栏，不进标签条） */
export const WEIBO_HOT_RANK_TABS: readonly WeiboHotRankTab[] = [
    'mine',
    'hotSearch',
    'entertainment',
    'social',
    'technology',
    'life',
    'sport',
    'acg',
    'city',
]

/** 同城榜单 citycode 前缀：后四位接行政区划代码 */
export const WEIBO_CITY_CODE_PREFIX = '80086'

/** 默认同城城市：南宁（行政区划代码 4501） */
export const WEIBO_DEFAULT_CITY_CODE = '4501'

/** 城市选项：code 为四位行政区划代码，name 为展示名 */
export interface WeiboCityOption {
    code: string
    name: string
}

/**
 * 全国主要城市：code 取行政区划代码前四位，与 80086 前缀拼成同城 citycode。
 * 关键约束：只收直辖市、省会与计划单列市及少量热门地级市，避免下拉过长；
 * 顺序按城市名拼音升序排列，下拉里近似「字典序」，改城市要按拼音插回原位；
 * 用户改用其它城市时可在设置里手填四位代码。
 */
export const WEIBO_CITY_OPTIONS: readonly WeiboCityOption[] = [
    { code: '1100', name: '北京' },
    { code: '2201', name: '长春' },
    { code: '4301', name: '长沙' },
    { code: '5101', name: '成都' },
    { code: '5000', name: '重庆' },
    { code: '2102', name: '大连' },
    { code: '4419', name: '东莞' },
    { code: '4406', name: '佛山' },
    { code: '3501', name: '福州' },
    { code: '4401', name: '广州' },
    { code: '5201', name: '贵阳' },
    { code: '2301', name: '哈尔滨' },
    { code: '4601', name: '海口' },
    { code: '3301', name: '杭州' },
    { code: '3401', name: '合肥' },
    { code: '1501', name: '呼和浩特' },
    { code: '3701', name: '济南' },
    { code: '5301', name: '昆明' },
    { code: '6201', name: '兰州' },
    { code: '5401', name: '拉萨' },
    { code: '3601', name: '南昌' },
    { code: '3201', name: '南京' },
    { code: '4501', name: '南宁' },
    { code: '3302', name: '宁波' },
    { code: '3702', name: '青岛' },
    { code: '3100', name: '上海' },
    { code: '2101', name: '沈阳' },
    { code: '4403', name: '深圳' },
    { code: '1301', name: '石家庄' },
    { code: '3205', name: '苏州' },
    { code: '1401', name: '太原' },
    { code: '1200', name: '天津' },
    { code: '3303', name: '温州' },
    { code: '4201', name: '武汉' },
    { code: '6501', name: '乌鲁木齐' },
    { code: '3202', name: '无锡' },
    { code: '3502', name: '厦门' },
    { code: '6101', name: '西安' },
    { code: '6301', name: '西宁' },
    { code: '6401', name: '银川' },
    { code: '4101', name: '郑州' },
]

/** 城市代码形态：四位数字行政区划代码 */
const WEIBO_CITY_CODE_PATTERN = /^\d{4}$/u

/** 是否为合法的四位城市代码 */
export function isWeiboCityCode(value: unknown): value is string {
    return typeof value === 'string' && WEIBO_CITY_CODE_PATTERN.test(value)
}

/** 拼同城榜单 citycode：前缀固定，后四位为城市代码 */
export function toWeiboCityCode(cityCode: string): string {
    return `${WEIBO_CITY_CODE_PREFIX}${cityCode}`
}

/** 城市名称：未收录的四位代码直接回显代码本身，避免设置里出现空白 */
export function readWeiboCityName(cityCode: string): string {
    return WEIBO_CITY_OPTIONS.find((option) => option.code === cityCode)?.name ?? cityCode
}

/** 城市下拉的当前值与选项：空串回落默认城市，手填代码不在预设清单时补一项 */
export interface WeiboCitySelectOptions {
    /** 生效城市代码：空串时取默认城市 */
    effectiveCode: string
    options: readonly WeiboCityOption[]
}

/**
 * 构造城市下拉：未读取完成（空串）时按默认城市展示，
 * 手填的四位代码不在预设清单里则补一项，否则下拉会因找不到匹配项显示空白。
 */
export function buildWeiboCityOptions(cityCode: string): WeiboCitySelectOptions {
    const effectiveCode = cityCode.length > 0 ? cityCode : WEIBO_DEFAULT_CITY_CODE
    const isKnown = WEIBO_CITY_OPTIONS.some((option) => option.code === effectiveCode)
    if (isKnown) {
        return { effectiveCode, options: WEIBO_CITY_OPTIONS }
    }
    return {
        effectiveCode,
        options: [...WEIBO_CITY_OPTIONS, { code: effectiveCode, name: readWeiboCityName(effectiveCode) }],
    }
}

/**
 * 热搜入参：refresh 为真时跳过缓存直接回源。
 * 关键约束：tab 缺省等价于 band（侧栏），这也是唯一参与磁盘缓存的来源；
 * 其余标签与同城都按当前请求实时回源，避免不同标签共用一条缓存串数据。
 */
export interface WeiboHotRankRequest {
    refresh?: boolean
    /** 榜单来源：缺省为 band */
    tab?: WeiboHotRankTab
    /** 同城榜单的四位行政区划代码：仅 tab 为 city 时使用，缺省取默认城市 */
    cityCode?: string
}

/** 同城城市状态：前端设置弹窗读取当前生效的城市 */
export interface WeiboCityState {
    /** 四位行政区划代码 */
    cityCode: string
    /** 展示名：未收录代码时等于代码本身 */
    cityName: string
}

/** 保存同城城市入参 */
export interface WeiboSaveCityRequest {
    cityCode: string
}

/**
 * 屏蔽名单条数上限：每条微博都要逐项比对，超大名单会让一次滚动做上百次匹配，
 * 这里给一个够用又可控的上限，超出部分在归一化时丢弃。
 */
export const WEIBO_BLOCK_LIST_MAX_ITEMS = 200

/** 单条名单长度上限：用户名与关键字都远短于此，超长项在归一化时截断 */
export const WEIBO_BLOCK_LIST_ITEM_MAX_LENGTH = 200

/**
 * 屏蔽规则：两个名单都在设置弹窗里按「每行一项」维护。
 * 关键约束：匹配忽略首尾空白与英文大小写；用户名按整串精确匹配，关键字按正文包含匹配。
 */
export interface WeiboBlockRules {
    /** 屏蔽用户名：命中微博作者名即隐藏该条 */
    blockedUsers: string[]
    /** 屏蔽关键字：正文（含转发正文）包含任一关键字即隐藏该条 */
    blockedKeywords: string[]
}

/** 屏蔽名单状态：设置弹窗读取当前生效的名单 */
export type WeiboBlockListState = WeiboBlockRules

/** 保存屏蔽名单入参：两个名单都整份替换，不做增量合并 */
export type WeiboSaveBlockListRequest = WeiboBlockRules

/** 当前登录账号的公开信息：只用于顶栏账号菜单，不参与任何写操作 */
export interface WeiboProfile {
    /** 账号数字 id（字符串形式） */
    id: string
    /** 昵称：缺失或为空时该条信息视为不可用 */
    name: string
    /**
     * 头像远程直链：已过图床白名单。
     * 关键约束：上游头像地址带签名参数会过期，仅作「本地文件缺失时重试」的来源，不作为展示源。
     */
    avatarUrl: string
    isVerified: boolean
    /** 个人简介：已剥标签解实体，上游为空时为空串 */
    description: string
    followersCount: number
    friendsCount: number
    statusesCount: number
}

/** 账号信息结果：头像以 data URI 回传，前端不必再走一次 weibo/image */
export interface WeiboProfileResult {
    /** 未配置凭证或上游没有账号信息时为 null */
    profile: WeiboProfile | null
    /** 头像 data URI：由本机 {存储根}/weibo_avatar.jpg 生成，文件缺失时为 null */
    avatarDataUrl: string | null
}

/** 账号信息入参：refresh 为真时跳过缓存重新取数并重下头像 */
export interface WeiboProfileRequest {
    refresh?: boolean
}

/**
 * 他人主页的公开资料：只承载个人主页页头要展示的字段，与登录账号信息分开。
 * 关键约束：avatarUrl / coverUrl 已过图床白名单，前端仍须经 weibo/image 代理加载；
 * 缺 id 或昵称的用户视为不可用，由取数层整条报错而不是渲染半个主页。
 */
export interface WeiboUserInfo {
    /** 用户数字 id（字符串形式） */
    id: string
    /** 昵称 */
    name: string
    /** 头像远程直链：已过图床白名单 */
    avatarUrl: string
    /** 主页封面远程直链：上游未给时为空串 */
    coverUrl: string
    isVerified: boolean
    /** 简介：已剥标签解实体 */
    description: string
    /** 所在地：上游未给时为空串 */
    location: string
    /** 性别：上游 m / f 之外一律 unknown */
    gender: 'm' | 'f' | 'unknown'
    followersCount: number
    friendsCount: number
    statusesCount: number
    /** 当前账号是否已关注该用户：关注按钮据此决定「关注」还是悬停菜单 */
    isFollowing: boolean
    /** 备注名：未设备注为空串 */
    remark: string
}

/**
 * 用户主页入参：uid 与昵称二选一，uid 优先（改名后仍可定位）。
 * 关键约束：uid 必须是数字串，昵称长度受限且不含控制字符；两者都缺时路由直接拒绝。
 */
export interface WeiboUserBlogRequest {
    /** `/u/{uid}` 链接里的数字 id */
    uid?: string
    /** `/n/{screen_name}` 链接里的昵称，由上游换算成 uid */
    screenName?: string
    /** 页码：从 1 开始，缺省 1 */
    page?: number
}

/** 用户主页结果：资料与帖子一次取回，帖子与信息流同形 */
export interface WeiboUserBlogResult {
    user: WeiboUserInfo
    posts: WeiboTimelinePost[]
    /** 本次请求的页码：从 1 开始 */
    page: number
    /** 是否还有下一页：上游给出总数时按总数判断，缺失时以本页是否满页为准 */
    hasMore: boolean
    /** 上游声明的微博总数：缺失为 null */
    total: number | null
    /** 结果生成时刻（ISO） */
    fetchedAt: string
    /** 分页重叠或重复下发被丢弃的条数 */
    droppedDuplicates: number
}

/** 关注分组：id 是数字串，name 为 1-8 字，成员数只在「全部分组」里给出 */
export interface WeiboUserGroup {
    id: string
    name: string
    /** 分组内的关注人数：当前用户所在分组查询不带该字段，缺失为 0 */
    memberCount: number
    /** 是否公开分组 */
    isPublic: boolean
}

/** 关注分组读取结果：目标用户所在分组 + 账号下全部分组，一次取回供弹窗直接渲染 */
export interface WeiboUserGroupsResult {
    /** 目标用户当前所在的分组 id：空数组表示未分组 */
    groupIds: string[]
    groups: WeiboUserGroup[]
}

/** 关注分组读取入参：只认数字 uid */
export interface WeiboUserGroupsRequest {
    uid: string
}

/** 新建分组入参：名称 1-8 字，isPublic 为是否公开 */
export interface WeiboGroupCreateRequest {
    name: string
    isPublic: boolean
}

/** 新建分组结果 */
export interface WeiboGroupCreateResult {
    group: WeiboUserGroup
}

/** 保存分组入参：把用户放进 listIds 这批分组，originListIds 为请求前的分组 */
export interface WeiboGroupSaveRequest {
    uid: string
    /** 目标分组 id：空数组表示移出全部分组（回到默认分组 0） */
    listIds: string[]
    /** 请求前的分组 id：上游据此计算增删 */
    originListIds: string[]
}

/** 保存分组结果 */
export interface WeiboGroupSaveResult {
    saved: boolean
}

/** 设置备注入参：备注 0-15 字，空串表示清除 */
export interface WeiboUserRemarkRequest {
    uid: string
    remark: string
}

/** 设置备注结果：以上游回包为准，清除后为空串 */
export interface WeiboUserRemarkResult {
    remark: string
}

/** 凭证状态：只描述是否可用，不回传任何 Cookie 片段 */
export interface WeiboCredentialState {
    isConfigured: boolean
    /** 最近一次保存时刻（ISO）：迁移或排障时用于判断是否过期 */
    savedAt: string | null
}

/** 保存 Cookie 入参：由前端粘贴整串 Cookie，宿主负责清洗与校验 */
export interface WeiboSaveCredentialRequest {
    cookie: string
}

/** 保存结果与状态同形，前端保存后直接替换本地状态 */
export type WeiboSaveCredentialResult = WeiboCredentialState

/** 清除结果：固定为未配置 */
export interface WeiboClearCredentialResult {
    isConfigured: false
}

/** 打开原微博入参：只允许 weibo.com 域名，宿主再次校验 */
export interface WeiboOpenPostRequest {
    url: string
}

/** 点赞入参：liked 为目标状态，true 点赞、false 取消 */
export interface WeiboLikeRequest {
    /** 微博数字 id（非 mblogid） */
    id: string
    liked: boolean
}

/** 点赞结果：回传服务端确认的状态与最新点赞数 */
export interface WeiboLikeResult {
    liked: boolean
    /** 上游回传的点赞总数：缺失为 null，前端保留乐观更新的估值 */
    attitudesCount: number | null
}

/** 关注入参：following 为目标状态，true 关注、false 取消关注 */
export interface WeiboFollowRequest {
    /** 博主 uid：只接受数字串 */
    uid: string
    following: boolean
}

/** 关注结果：回传服务端确认的最终关注态 */
export interface WeiboFollowResult {
    following: boolean
}

/** 图片代理入参：图片地址必须落在微博图床或微博域名下 */
export interface WeiboImageRequest {
    url: string
}

/** 图片代理结果：url 为 Webview 可直接加载的本地地址，null 表示下载或校验失败 */
export interface WeiboImageResult {
    url: string | null
}

/**
 * 视频播放地址入参：只接受微博视频 CDN 的整段 mp4 地址。
 * 关键约束：宿主不下载视频，只把地址换成本地中转地址（本地服务补 Referer 后流式转发）。
 */
export interface WeiboVideoRequest {
    url: string
}

/** 视频播放地址结果：url 为本地中转地址，null 表示地址不合法或中转服务不可用 */
export interface WeiboVideoResult {
    url: string | null
}

/** 微博数字 id 形态：增量与翻页游标只允许纯数字，防止任意内容拼进查询串 */
const WEIBO_ID_PATTERN = /^\d{1,25}$/u

/** mblogid 形态：字母数字混排（如 `Rs4KtdzoV`），长文接口按它取全文 */
const WEIBO_MBLOGID_PATTERN = /^[A-Za-z0-9]{4,32}$/u

/**
 * 图片 pid 形态：字母数字混排，直接拼进图床直链与官方下载地址。
 * 关键约束：取数与媒体代理共用同一份判定，避免两处正则漂移出可注入的地址。
 */
export const WEIBO_IMAGE_PID_PATTERN = /^[A-Za-z0-9]{6,64}$/u

/** 是否为可用的微博 id：空串与非法值统一返回 false */
export function isWeiboTimelineId(value: unknown): value is string {
    return typeof value === 'string' && WEIBO_ID_PATTERN.test(value)
}

/** 收窄可选游标：null 与 undefined 都表示未指定 */
function isOptionalTimelineId(value: unknown): value is string | null | undefined {
    return value === null || value === undefined || isWeiboTimelineId(value)
}

/** 收窄可选整数：允许缺省，存在时必须是有限数字 */
function isOptionalNumber(value: unknown): value is number | undefined {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

/** 收窄时间线入参：非法载荷由路由直接拒绝，不做尽力而为的修正 */
export function isWeiboTimelineRequest(value: unknown): value is WeiboTimelineRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { sinceId, maxId, count, uid, refresh, maxPages } = value as Record<string, unknown>
    return (
        isOptionalTimelineId(sinceId) &&
        isOptionalTimelineId(maxId) &&
        isOptionalTimelineId(uid) &&
        isOptionalNumber(count) &&
        isOptionalNumber(refresh) &&
        isOptionalNumber(maxPages)
    )
}

/** 收窄热搜来源：只允许已登记端点，防止 tab 被当作路径片段拼接 */
export function isWeiboHotRankTab(value: unknown): value is WeiboHotRankTab {
    return typeof value === 'string' && (['band', ...WEIBO_HOT_RANK_TABS] as readonly string[]).includes(value)
}

/** 收窄热搜入参：refresh / tab / cityCode 都缺省合法，给了就必须符合各自形态 */
export function isWeiboHotRankRequest(value: unknown): value is WeiboHotRankRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { refresh, tab, cityCode } = value as Record<string, unknown>
    if (refresh !== undefined && typeof refresh !== 'boolean') {
        return false
    }
    if (tab !== undefined && !isWeiboHotRankTab(tab)) {
        return false
    }
    return cityCode === undefined || isWeiboCityCode(cityCode)
}

/** 收窄保存城市入参：只接受四位行政区划代码 */
export function isWeiboSaveCityRequest(value: unknown): value is WeiboSaveCityRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { cityCode } = value as Record<string, unknown>
    return isWeiboCityCode(cityCode)
}

/** 收窄名单数组：每项都必须是长度受限的非空字符串，条数不超过上限 */
function isWeiboBlockListItems(value: unknown): value is string[] {
    if (!Array.isArray(value) || value.length > WEIBO_BLOCK_LIST_MAX_ITEMS) {
        return false
    }
    return value.every(
        (item) =>
            typeof item === 'string' &&
            item.trim().length > 0 &&
            item.trim().length <= WEIBO_BLOCK_LIST_ITEM_MAX_LENGTH,
    )
}

/** 收窄保存屏蔽名单入参：两个名单都必须给出，非法载荷整份拒绝而不是局部保留 */
export function isWeiboSaveBlockListRequest(value: unknown): value is WeiboSaveBlockListRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { blockedUsers, blockedKeywords } = value as Record<string, unknown>
    return isWeiboBlockListItems(blockedUsers) && isWeiboBlockListItems(blockedKeywords)
}

/** 收窄账号信息入参：refresh 缺省合法，给了就必须是布尔 */
export function isWeiboProfileRequest(value: unknown): value is WeiboProfileRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { refresh } = value as Record<string, unknown>
    return refresh === undefined || typeof refresh === 'boolean'
}

/** 收窄信息流来源：只允许三种已登记端点，防止 source 被当作路径片段拼接 */
export function isWeiboFeedSource(value: unknown): value is WeiboFeedSource {
    return value === 'timeline' || value === 'hot' || value === 'group'
}

/**
 * 收窄信息流入参：source 必须已登记，group 必须带合法的分组 id。
 * 非法载荷由路由直接拒绝，不做尽力而为的修正。
 */
export function isWeiboFeedRequest(value: unknown): value is WeiboFeedRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { source, listId, sinceId, maxId, count, maxPages } = value as Record<string, unknown>
    if (!isWeiboFeedSource(source)) {
        return false
    }
    if (source === 'group') {
        if (!isWeiboTimelineId(listId)) {
            return false
        }
    } else if (!isOptionalTimelineId(listId)) {
        return false
    }
    return (
        isOptionalTimelineId(sinceId) &&
        isOptionalTimelineId(maxId) &&
        isOptionalNumber(count) &&
        isOptionalNumber(maxPages)
    )
}

/** 收窄我的赞入参：page 缺省合法，给了就必须是有限数字 */
export function isWeiboLikesRequest(value: unknown): value is WeiboLikesRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { page } = value as Record<string, unknown>
    return page === undefined || (typeof page === 'number' && Number.isFinite(page))
}

/** 用户主页昵称上限：微博昵称本身不超过 30 字，留一倍余量 */
const WEIBO_USER_SCREEN_NAME_MAX = 64

/**
 * 昵称形态：去空白后非空、长度受限，且不含路径与查询分隔符及控制字符。
 * 关键约束：昵称会被拼进 profile/info 的查询串，需在收窄阶段就挡掉畸形取值。
 */
function isWeiboScreenName(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false
    }
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= WEIBO_USER_SCREEN_NAME_MAX && !/[/?#\p{Cc}]/u.test(trimmed)
}

/** 收窄用户主页入参：uid 与昵称至少给一个；给了就必须合法，page 缺省合法 */
export function isWeiboUserBlogRequest(value: unknown): value is WeiboUserBlogRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { uid, screenName, page } = value as Record<string, unknown>
    if (!isOptionalTimelineId(uid) || !(screenName === undefined || isWeiboScreenName(screenName))) {
        return false
    }
    if (!isOptionalNumber(page)) {
        return false
    }
    return isWeiboTimelineId(uid) || isWeiboScreenName(screenName)
}

/** 分组名长度上限：与网页端口径一致（1-8 字）；前端输入框的 maxLength 直接复用本值 */
export const WEIBO_GROUP_NAME_MAX = 8

/** 备注长度上限：网页端 1-15 字，这里允许空串表示清除；前端字数提示与协议同一口径 */
export const WEIBO_REMARK_MAX = 15

/** 一次提交的分组数量上限：账号下分组远少于此，超出即视为非法载荷 */
const WEIBO_GROUP_LIST_MAX = 50

/** 收窄 id 列表：元素必须是数字串，数量受限，避免把畸形载荷拼进 form */
function isWeiboIdList(value: unknown): value is string[] {
    if (!Array.isArray(value) || value.length > WEIBO_GROUP_LIST_MAX) {
        return false
    }
    return value.every((item) => isWeiboTimelineId(item))
}

/** 收窄分组读取入参：uid 必填且为数字串 */
export function isWeiboUserGroupsRequest(value: unknown): value is WeiboUserGroupsRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { uid } = value as Record<string, unknown>
    return isWeiboTimelineId(uid)
}

/** 收窄新建分组入参：名称去空白后 1-8 字，isPublic 必须是布尔 */
export function isWeiboGroupCreateRequest(value: unknown): value is WeiboGroupCreateRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { name, isPublic } = value as Record<string, unknown>
    if (typeof name !== 'string' || typeof isPublic !== 'boolean') {
        return false
    }
    const trimmed = name.trim()
    return trimmed.length > 0 && trimmed.length <= WEIBO_GROUP_NAME_MAX
}

/** 收窄保存分组入参：uid 与两组 id 列表都必须合法 */
export function isWeiboGroupSaveRequest(value: unknown): value is WeiboGroupSaveRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { uid, listIds, originListIds } = value as Record<string, unknown>
    return isWeiboTimelineId(uid) && isWeiboIdList(listIds) && isWeiboIdList(originListIds)
}

/** 收窄设置备注入参：备注按字计不超过 15，允许空串清除 */
export function isWeiboUserRemarkRequest(value: unknown): value is WeiboUserRemarkRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { uid, remark } = value as Record<string, unknown>
    if (!isWeiboTimelineId(uid) || typeof remark !== 'string') {
        return false
    }
    return [...remark.trim()].length <= WEIBO_REMARK_MAX
}

/** 收窄视频地址入参：长度上限与图片一致，域名白名单由宿主再次校验 */
export function isWeiboVideoRequest(value: unknown): value is WeiboVideoRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { url } = value as Record<string, unknown>
    return typeof url === 'string' && url.length > 0 && url.length <= 1024
}

/** 收窄保存 Cookie 入参：只校验形状，内容合法性由宿主清洗函数负责 */
export function isWeiboSaveCredentialRequest(value: unknown): value is WeiboSaveCredentialRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { cookie } = value as Record<string, unknown>
    return typeof cookie === 'string' && cookie.length > 0
}

/** 收窄打开原微博入参 */
export function isWeiboOpenPostRequest(value: unknown): value is WeiboOpenPostRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { url } = value as Record<string, unknown>
    return typeof url === 'string' && url.length > 0 && url.length <= 512
}

/** 收窄长文入参：mblogid 为字母数字，数字 id 也是同一字符集 */
export function isWeiboLongTextRequest(value: unknown): value is WeiboLongTextRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id } = value as Record<string, unknown>
    return typeof id === 'string' && WEIBO_MBLOGID_PATTERN.test(id)
}

/** 收窄评论入参：id 必填且为数字串，maxId 与 count 可缺省 */
export function isWeiboCommentsRequest(value: unknown): value is WeiboCommentsRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id, maxId, count } = value as Record<string, unknown>
    if (typeof id !== 'string' || !WEIBO_ID_PATTERN.test(id)) {
        return false
    }
    return isOptionalTimelineId(maxId) && isOptionalNumber(count)
}

/** 收窄评论发布入参：id 为数字串，正文去空白后非空且不超上限，replyToId 可缺省 */
export function isWeiboCommentCreateRequest(value: unknown): value is WeiboCommentCreateRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id, text, replyToId } = value as Record<string, unknown>
    if (typeof id !== 'string' || !WEIBO_ID_PATTERN.test(id) || typeof text !== 'string') {
        return false
    }
    if (replyToId !== undefined && (typeof replyToId !== 'string' || !WEIBO_ID_PATTERN.test(replyToId))) {
        return false
    }
    const trimmed = text.trim()
    return trimmed.length > 0 && trimmed.length <= WEIBO_COMMENT_MAX_LENGTH
}

/** 收窄评论删除入参：cid 必须是纯数字评论 id */
export function isWeiboCommentDestroyRequest(value: unknown): value is WeiboCommentDestroyRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { cid } = value as Record<string, unknown>
    return typeof cid === 'string' && WEIBO_ID_PATTERN.test(cid)
}

/** 收窄评论点赞入参：cid 必须是纯数字评论 id，liked 必须是布尔 */
export function isWeiboCommentLikeRequest(value: unknown): value is WeiboCommentLikeRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { cid, liked } = value as Record<string, unknown>
    return typeof cid === 'string' && WEIBO_ID_PATTERN.test(cid) && typeof liked === 'boolean'
}

/** 收窄子评论入参：id 为数字评论 id，maxId 与 count 可缺省 */
export function isWeiboCommentRepliesRequest(value: unknown): value is WeiboCommentRepliesRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id, maxId, count } = value as Record<string, unknown>
    if (typeof id !== 'string' || !WEIBO_ID_PATTERN.test(id)) {
        return false
    }
    return isOptionalTimelineId(maxId) && isOptionalNumber(count)
}

/** 评论加入对话的字数与昵称上限：正文按上游评论上限留余量，昵称与卡片同口径 */
const MAX_COMMENT_CHAT_TEXT = 4_000
const MAX_COMMENT_CHAT_NAME = 64
const MAX_COMMENT_CHAT_TIME = 64

/**
 * 收窄评论加入对话的载荷：结构性非法返回 null（由路由抛错），正文超长按上限截断。
 * 关键约束：正文按不可信文本处理，不做 HTML 解析；评论 id 必须是数字串，昵称超长直接判非法；
 * 时间只作展示，不参与任何请求构造。
 */
export function readWeiboCommentChatPayload(value: unknown): WeiboCommentChatPayload | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const { commentId, authorName, text, createdAt, replyToName } = value as Record<string, unknown>
    if (typeof commentId !== 'string' || !WEIBO_ID_PATTERN.test(commentId)) {
        return null
    }
    if (typeof authorName !== 'string' || authorName.length > MAX_COMMENT_CHAT_NAME) {
        return null
    }
    if (typeof text !== 'string' || typeof createdAt !== 'string' || createdAt.length > MAX_COMMENT_CHAT_TIME) {
        return null
    }
    if (typeof replyToName !== 'string' || replyToName.length > MAX_COMMENT_CHAT_NAME) {
        return null
    }
    return {
        commentId,
        authorName,
        text: text.slice(0, MAX_COMMENT_CHAT_TEXT),
        createdAt,
        replyToName,
    }
}

/** 收窄转发列表入参：id 为数字微博 id，page 与 count 可缺省 */
export function isWeiboRepostsRequest(value: unknown): value is WeiboRepostsRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id, page, count } = value as Record<string, unknown>
    if (typeof id !== 'string' || !WEIBO_ID_PATTERN.test(id)) {
        return false
    }
    return isOptionalNumber(page) && isOptionalNumber(count)
}

/** 收窄转发方式：三种取值以外的都算非法 */
export function isWeiboRepostMode(value: unknown): value is WeiboRepostMode {
    return value === 'repost' || value === 'repostWithComment' || value === 'commentWithRepost'
}

/** 收窄转发入参：id 为数字微博 id，附言可空；纯转发按 500 字，会生成评论的模式按评论上限收窄 */
export function isWeiboRepostCreateRequest(value: unknown): value is WeiboRepostCreateRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id, comment, mode } = value as Record<string, unknown>
    if (typeof id !== 'string' || !WEIBO_ID_PATTERN.test(id) || typeof comment !== 'string') {
        return false
    }
    if (mode !== undefined && !isWeiboRepostMode(mode)) {
        return false
    }
    const maxLength = mode === undefined || mode === 'repost' ? WEIBO_REPOST_MAX_LENGTH : WEIBO_COMMENT_MAX_LENGTH
    return comment.trim().length <= maxLength
}

/** 转发加入对话的字数与昵称上限：正文按单次引用上限对齐，昵称与卡片同口径 */
const MAX_REPOST_CHAT_TEXT = 4_000
const MAX_REPOST_CHAT_NAME = 64
const MAX_REPOST_CHAT_TIME = 64

/**
 * 收窄转发加入对话的载荷：结构性非法返回 null（由路由抛错），正文超长按上限截断。
 * 关键约束：正文按不可信文本处理，不做 HTML 解析；转发 id 必须是数字串，昵称超长直接判非法。
 */
export function readWeiboRepostChatPayload(value: unknown): WeiboRepostChatPayload | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const { repostId, authorName, text, createdAt } = value as Record<string, unknown>
    if (typeof repostId !== 'string' || !WEIBO_ID_PATTERN.test(repostId)) {
        return null
    }
    if (typeof authorName !== 'string' || authorName.length > MAX_REPOST_CHAT_NAME) {
        return null
    }
    if (typeof text !== 'string' || typeof createdAt !== 'string' || createdAt.length > MAX_REPOST_CHAT_TIME) {
        return null
    }
    return {
        repostId,
        authorName,
        text: text.slice(0, MAX_REPOST_CHAT_TEXT),
        createdAt,
    }
}

/** 收窄删除微博入参：id 必须是纯数字微博 id */
export function isWeiboDestroyStatusRequest(value: unknown): value is WeiboDestroyStatusRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id } = value as Record<string, unknown>
    return typeof id === 'string' && WEIBO_ID_PATTERN.test(id)
}

/** 收窄点赞入参：id 必须是纯数字微博 id，liked 必须是布尔 */
export function isWeiboLikeRequest(value: unknown): value is WeiboLikeRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id, liked } = value as Record<string, unknown>
    return typeof id === 'string' && WEIBO_ID_PATTERN.test(id) && typeof liked === 'boolean'
}

/** 收窄关注入参：uid 必须为数字串，following 必须显式为布尔 */
export function isWeiboFollowRequest(value: unknown): value is WeiboFollowRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { uid, following } = value as Record<string, unknown>
    return typeof uid === 'string' && WEIBO_ID_PATTERN.test(uid) && typeof following === 'boolean'
}

/** 话题关键字长度上限：与上游输入框口径一致，超长直接判非法而不截断 */
const MAX_TOPIC_QUERY_LENGTH = 50

/** 收窄话题搜索入参：q 可缺省（取常用话题），给了就必须是不超长的字符串 */
export function isWeiboTopicsRequest(value: unknown): value is WeiboTopicsRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { q } = value as Record<string, unknown>
    return q === undefined || (typeof q === 'string' && q.length <= MAX_TOPIC_QUERY_LENGTH)
}

/** 发布正文长度上限：与输入框一致，宿主再做一次兜底；前端计数与提示直接复用本值 */
export const MAX_PUBLISH_CONTENT_LENGTH = 2000

/** 单条微博图片上限：普通账号 9 张；前端选图时按它截断，避免发布被宿主整条拒绝 */
export const MAX_PUBLISH_IMAGE_COUNT = 9

/**
 * 收窄发布入参：正文与图片至少一项，图片须为 uploads 下的合法路径且不超过 9 张。
 * 关键约束：路径在这里收窄，宿主读到文件后再按魔数判图片格式，避免任意路径被读进发布流程。
 */
export function isWeiboPublishRequest(value: unknown): value is WeiboPublishRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { content, images } = value as Record<string, unknown>
    if (typeof content !== 'string' || content.length > MAX_PUBLISH_CONTENT_LENGTH) {
        return false
    }
    if (images !== undefined && !Array.isArray(images)) {
        return false
    }
    const list: unknown[] = Array.isArray(images) ? images : []
    if (list.length > MAX_PUBLISH_IMAGE_COUNT || !list.every((item) => isUploadPath(item))) {
        return false
    }
    return content.trim().length > 0 || list.length > 0
}

/** 收窄图片代理入参：长度上限与归一化层一致，具体域名由宿主再次校验 */
export function isWeiboImageRequest(value: unknown): value is WeiboImageRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { url } = value as Record<string, unknown>
    return typeof url === 'string' && url.length > 0 && url.length <= 1024
}

/** 卡片动作载荷的字段上限：正文按单条引用上限对齐，转发体更短 */
const MAX_PAGE_POST_TEXT = 20_000
const MAX_PAGE_POST_RETWEET_TEXT = 2_000
const MAX_PAGE_POST_URL = 1_024
const MAX_PAGE_POST_NAME = 64
const MAX_PAGE_POST_IMAGES = 9

/** 微博主站域名白名单：只接受 weibo.com 与其子域，且必须是 https */
function isWeiboPageUrl(value: string): boolean {
    try {
        const parsed = new URL(value)
        if (parsed.protocol !== 'https:') {
            return false
        }
        return parsed.hostname === 'weibo.com' || parsed.hostname.endsWith('.weibo.com')
    } catch {
        return false
    }
}

/** 微博 UID 形态：数字串（user.id），非数字一律清空 */
const PAGE_UID_PATTERN = /^\d{1,25}$/u

/** 媒体直链：只校验 https 与长度，不设域名白名单（图床域名随上游调整） */
function isMediaDirectUrl(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= MAX_PAGE_POST_URL &&
        value.startsWith('https://')
    )
}

/**
 * 收窄作者：展示名限长，UID 只接受数字串。
 * 关键约束：UID 不写入笔记，仅作后续去重与溯源用的规范字段；非数字一律清空而不是透传自由文本。
 */
function readPagePostAuthor(value: unknown): { id: string; name: string } | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const { id, name } = value as Record<string, unknown>
    if (typeof id !== 'string' || id.length > MAX_PAGE_POST_NAME || typeof name !== 'string') {
        return null
    }
    return { id: PAGE_UID_PATTERN.test(id) ? id : '', name: name.slice(0, MAX_PAGE_POST_NAME) }
}

/**
 * 收窄一组配图：直链与 pid 同序配对，只保留 https 直链且最多 9 张。
 * 关键约束：直链被过滤时对应 pid 一并丢弃，避免图片与 pid 错位导致取错原图。
 */
function readPageImages(rawImages: unknown, rawImageIds: unknown): { images: string[]; imageIds: string[] } {
    const imageList: unknown[] = Array.isArray(rawImages) ? rawImages : []
    const idList: unknown[] = Array.isArray(rawImageIds) ? rawImageIds : []
    const images: string[] = []
    const imageIds: string[] = []
    for (let index = 0; index < imageList.length && images.length < MAX_PAGE_POST_IMAGES; index += 1) {
        const imageUrl = imageList[index]
        if (!isMediaDirectUrl(imageUrl)) {
            continue
        }
        images.push(imageUrl)
        const pid = idList[index]
        imageIds.push(typeof pid === 'string' && WEIBO_IMAGE_PID_PATTERN.test(pid) ? pid : '')
    }
    return { images, imageIds }
}

/** 收窄转发体：缺字段按无转发处理，正文超长截断而不是拒绝整条载荷；转发配图同样收窄 */
function readPageRetweet(value: unknown): WeiboPagePostPayload['retweeted'] {
    if (value === null || value === undefined) {
        return null
    }
    if (typeof value !== 'object') {
        return null
    }
    const record = value as Record<string, unknown>
    const { authorName, text } = record
    if (typeof authorName !== 'string' || typeof text !== 'string') {
        return null
    }
    const media = readPageImages(record.images, record.imageIds)
    const rawId = record.id
    return {
        // 数字 id 用于长文补全：非数字一律清空，宿主据此判断能否取全文
        id: typeof rawId === 'string' && WEIBO_ID_PATTERN.test(rawId) ? rawId : '',
        authorName: authorName.slice(0, MAX_PAGE_POST_NAME),
        text: text.slice(0, MAX_PAGE_POST_RETWEET_TEXT),
        images: media.images,
        imageIds: media.imageIds,
        isTruncated: record.isTruncated === true,
    }
}

/**
 * 收窄卡片动作载荷：结构性非法返回 null（由路由抛错），超长文本按上限截断并置 isTruncated。
 * 关键约束：正文与转发体都按不可信文本处理，不做 HTML 解析；配图只收 https 直链且最多 9 张；
 * url 必须是微博主站的 https 永久链接，避免笔记 source 与引用去重键被写成任意外链。
 */
export function readWeiboPagePost(value: unknown): WeiboPagePostPayload | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    const { id, mblogid, url, text, createdAt, author, images, videoUrl } = record
    if (typeof id !== 'string' || !WEIBO_ID_PATTERN.test(id)) {
        return null
    }
    // mblogid 允许为空串：上游部分帖子不带短 id，归一化层已把原文地址回退成 /detail/{id}
    if (typeof mblogid !== 'string' || (mblogid.length > 0 && !WEIBO_MBLOGID_PATTERN.test(mblogid))) {
        return null
    }
    if (typeof url !== 'string' || url.length > MAX_PAGE_POST_URL || !isWeiboPageUrl(url)) {
        return null
    }
    if (typeof text !== 'string' || typeof createdAt !== 'string' || createdAt.length > 64) {
        return null
    }
    const normalizedAuthor = readPagePostAuthor(author)
    if (normalizedAuthor === null) {
        return null
    }
    const isTextTruncated = text.length > MAX_PAGE_POST_TEXT
    const media = readPageImages(images, record.imageIds)
    const normalizedVideo = isMediaDirectUrl(videoUrl) ? videoUrl : null
    return {
        id,
        mblogid,
        url,
        text: isTextTruncated ? text.slice(0, MAX_PAGE_POST_TEXT) : text,
        createdAt,
        author: normalizedAuthor,
        images: media.images,
        imageIds: media.imageIds,
        videoUrl: normalizedVideo,
        retweeted: readPageRetweet(record.retweeted),
        isTruncated: isTextTruncated || record.isTruncated === true,
    }
}
