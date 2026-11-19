/**
 * 微博关注时间线契约：网页版 ajax 接口的出入参模型与不可信载荷收窄。
 * 复用约定：宿主侧 modules/weibo 负责请求与归一化，Webview 只消费归一化后的帖子，
 * 协议方法名登记在 shared/types/messages，面板经 request/response 通道取数。
 * 关键约束：时间线只读，任何写操作都不得走本契约；Cookie 明文永不出宿主、不入日志，
 * 凭证状态只回传是否已配置与保存时间；sinceId 与 maxId 互斥，二者都给出时以 maxId 为准。
 */

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
}

/** 长文请求：id 可为 mblogid（如 Rs4KtdzoV）或数字 id */
export interface WeiboLongTextRequest {
    id: string
}

/** 长文结果：纯文本全文，换行原样保留 */
export interface WeiboLongTextResult {
    text: string
}

/** 评论请求：maxId 缺省拉第一页 */
export interface WeiboCommentsRequest {
    /** 微博数字 id */
    id: string
    /** 下一页游标：上一次结果里的 maxId */
    maxId?: string | null
    count?: number
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

/** 图片像素尺寸：取自上游 `largest` 档位（最大可用尺寸），预览角标与竖横判断都用它 */
export interface WeiboTimelineImageSize {
    width: number
    height: number
}

/** 媒体摘要：只给直链与数量，不做下载 */
export interface WeiboTimelineMedia {
    /** 原图直链：点击放大时使用，与 thumbnails 一一对应 */
    images: string[]
    /** 中等尺寸直链：列表与九宫格展示用，减少首屏流量 */
    thumbnails: string[]
    /** 最大尺寸：与 images 同序（取上游 largest 档）；上游未给时为 null，前端回退到解码后的自然尺寸 */
    sizes: Array<WeiboTimelineImageSize | null>
    videoUrl: string | null
    /** 上游声明的图片总数：直链缺失时前端据此提示「另有 N 张」 */
    imageCount: number
}

/** 转发体：只保留原文摘要，避免递归展开 */
export interface WeiboTimelineRetweet {
    id: string
    authorName: string
    text: string
    url: string
}

/**
 * 正文片段：文本与表情按上游原顺序交错。
 * 表情只保留图床直链与名称，前端按内联图片渲染；文本片段已剥标签解实体。
 */
export type WeiboTimelineSegment = { type: 'text'; text: string } | { type: 'emoji'; name: string; url: string }

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

/** 图片代理入参：图片地址必须落在微博图床或微博域名下 */
export interface WeiboImageRequest {
    url: string
}

/** 图片代理结果：url 为 Webview 可直接加载的本地地址，null 表示下载或校验失败 */
export interface WeiboImageResult {
    url: string | null
}

/** 微博数字 id 形态：增量与翻页游标只允许纯数字，防止任意内容拼进查询串 */
const WEIBO_ID_PATTERN = /^\d{1,25}$/u

/** mblogid 形态：字母数字混排（如 `Rs4KtdzoV`），长文接口按它取全文 */
const WEIBO_MBLOGID_PATTERN = /^[A-Za-z0-9]{4,32}$/u

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

/** 收窄点赞入参：id 必须是纯数字微博 id，liked 必须是布尔 */
export function isWeiboLikeRequest(value: unknown): value is WeiboLikeRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { id, liked } = value as Record<string, unknown>
    return typeof id === 'string' && WEIBO_ID_PATTERN.test(id) && typeof liked === 'boolean'
}

/** 收窄图片代理入参：长度上限与归一化层一致，具体域名由宿主再次校验 */
export function isWeiboImageRequest(value: unknown): value is WeiboImageRequest {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const { url } = value as Record<string, unknown>
    return typeof url === 'string' && url.length > 0 && url.length <= 1024
}
