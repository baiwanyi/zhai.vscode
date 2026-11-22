/**
 * 关注时间线取数与归一化：把网页版 ajax 的 snake_case 原始结构收敛成 WeiboTimelinePost。
 * 复用约定：单页请求交给 webClient，游标只信任上游返回的 since_id / max_id；
 * 正文清洗与分段交给 timeline/text，媒体地址收窄交给 timeline/media，本文件只做分页与字段归一化。
 * 关键约束：max_id 是不规律长整型游标，不能自增构造；增量模式（sinceId 非 0）只取一页，
 * 否则会把历史内容一并拉上来；广告位与缺少 id 的条目直接丢弃，不进入去重计数；
 * 去重先于归一化（跨页重复条目不必再做一遍 HTML 解析与媒体收窄）。
 */
import type {
    WeiboTimelineImageSize,
    WeiboTimelineMedia,
    WeiboTimelineMediaItem,
    WeiboTimelineMetrics,
    WeiboTimelinePost,
    WeiboTimelineRequest,
    WeiboTimelineResult,
    WeiboTimelineVideoResolution,
    WeiboTimelineRetweet,
} from '@shared/types/weibo'
import { WEIBO_TIMELINE_MAX_PAGES } from '@shared/types/weibo'
import { buildMiddleImageUrl, buildSinaImageUrl, normalizeWeiboImageUrl, normalizeWeiboVideoUrl } from './media'
import {
    LONG_TEXT_MARKER_PATTERN,
    LONG_TEXT_TAIL_LENGTH,
    buildTextSegments,
    parsePostSegments,
    readPostHtml,
    removeExpandLink,
    removeTrailingExpandHint,
    replaceEmojiWithText,
    stripTrailingTruncation,
    stripWeiboHtml,
} from './text'
import { parseWeiboCreatedAt } from './time'
import type { TimelinePage, TimelinePageQuery } from '../transport/httpClient'
import { WEIBO_WEB_ORIGIN } from '../endpoints'
import { isRecord, toCount, toText } from '../guards'
import { requestTimelinePage } from '../transport/httpClient'

/** 取数入参：在协议入参之上补齐凭证与可注入的请求实现 */
export interface FetchTimelineOptions extends WeiboTimelineRequest {
    cookie: string
    timeoutMs?: number
    minIntervalMs?: number
    /** 请求实现替身：单测不触网 */
    requestPage?: (query: TimelinePageQuery) => Promise<TimelinePage>
    /** 时刻来源替身：保证 fetchedAt 可断言 */
    now?: () => Date
}

/** 单张图片的候选信息：原图、展示图与上游给出的原图尺寸 */
interface MediaCandidate {
    /** 原图直链：保存到笔记等需要最大尺寸的场合使用，优先 largest（画质最好） */
    url: string
    /** 展示图直链：九宫格与卡片内预览使用，优先上游 large 档（长边 960） */
    middleUrl: string | null
    /** 原图尺寸：优先 largest 档（最大可用尺寸），缺失回退 original / large */
    size: WeiboTimelineImageSize | null
}

/** 读取档位宽高：宽高都为正数才算有效 */
function readVariantSize(variant: unknown): WeiboTimelineImageSize | null {
    if (!isRecord(variant)) {
        return null
    }
    const width = toCount(variant.width)
    const height = toCount(variant.height)
    return width > 0 && height > 0 ? { width, height } : null
}

/** 读取档位直链：非白名单域名视为不可用 */
function readVariantUrl(variant: unknown): string | null {
    if (!isRecord(variant)) {
        return null
    }
    return normalizeWeiboImageUrl(toText(variant.url))
}

/**
 * 读取单张图片的候选信息：原图直链、展示图直链与上游给出的最大尺寸。
 * 关键约束：展示图优先取上游 `large` 档（长边 960）——九宫格与卡片内预览都用它，
 * bmiddle 档长边只有 360，铺到卡片宽度会明显发虚；两档都没有时才把原图目录换成 bmiddle 兜底。
 */
function pickMediaCandidate(value: unknown): MediaCandidate | null {
    if (!isRecord(value)) {
        return null
    }
    const size = readVariantSize(value.largest) ?? readVariantSize(value.original) ?? readVariantSize(value.large)
    const url =
        readVariantUrl(value.largest) ??
        readVariantUrl(value.original) ??
        readVariantUrl(value.large) ??
        readVariantUrl(value.bmiddle) ??
        normalizeWeiboImageUrl(toText(value.url))
    if (url === null) {
        return null
    }
    const middleUrl = readVariantUrl(value.large) ?? readVariantUrl(value.bmiddle) ?? buildMiddleImageUrl(url)
    return { url, middleUrl, size }
}

/**
 * 渐进式整段 mp4 字段：`<video>` 能直接播放的只有这些，按清晰度优先取第一个可用地址。
 * 关键约束：`playback_list` 里是 DASH 分片（带 init / index range），不能直接播放，一律不取。
 */
const PROGRESSIVE_VIDEO_KEYS = ['mp4_720p_mp4', 'mp4_hd_url', 'mp4_sd_url', 'stream_url_hd', 'stream_url'] as const

/** 取可直接播放的整段 mp4 地址：没有则返回 null，前端回退「打开原文」 */
function pickProgressiveUrl(mediaInfo: unknown): string | null {
    if (!isRecord(mediaInfo)) {
        return null
    }
    for (const key of PROGRESSIVE_VIDEO_KEYS) {
        const url = normalizeWeiboVideoUrl(toText(mediaInfo[key]))
        if (url !== null) {
            return url
        }
    }
    return null
}

/** 仅有 pid 时拼图床直链：部分返回只给 id 不给直链 */
function candidateFromPid(pid: string): MediaCandidate | null {
    const url = buildSinaImageUrl(pid)
    return url === null ? null : { url, middleUrl: buildMiddleImageUrl(url), size: null }
}

/** 混排项是否为视频：type 为主，data 里的 object_type / type 兜底（新版把类型下沉到 data） */
function isVideoItem(item: Record<string, unknown>): boolean {
    if (item.type === 'video') {
        return true
    }
    const data = item.data
    return isRecord(data) && (data.object_type === 'video' || data.type === 'video')
}

/** 视频摘要：封面、时长、可播放的整段地址与最大分辨率；播放地址带签名且校验 Referer，由宿主取回后再播 */
interface VideoCandidate {
    coverUrl: string | null
    coverMiddleUrl: string | null
    durationSeconds: number | null
    playUrl: string | null
    resolution: WeiboTimelineVideoResolution | null
}

/**
 * 取视频最大分辨率：优先 playback_list 里面积最大的一档（每档都带 width / height），
 * 没有播放列表时退回解析 progressive 地址上的 `template=720x960.24.0`。
 * 关键约束：角标只标「最大尺寸」，不能拿封面尺寸充数——封面档位与视频分辨率无关。
 */
function pickMaxResolution(mediaInfo: unknown): WeiboTimelineVideoResolution | null {
    if (!isRecord(mediaInfo)) {
        return null
    }
    let best: WeiboTimelineVideoResolution | null = null
    const playbackList = mediaInfo.playback_list
    if (Array.isArray(playbackList)) {
        for (const entry of playbackList) {
            if (!isRecord(entry) || !isRecord(entry.play_info)) {
                continue
            }
            const width = toCount(entry.play_info.width)
            const height = toCount(entry.play_info.height)
            if (width <= 0 || height <= 0) {
                continue
            }
            if (best === null || width * height > best.width * best.height) {
                best = { width, height }
            }
        }
    }
    if (best !== null) {
        return best
    }
    for (const key of PROGRESSIVE_VIDEO_KEYS) {
        const match = /[?&]template=(\d{2,5})x(\d{2,5})/u.exec(toText(mediaInfo[key]))
        if (match !== null) {
            const width = Number(match[1])
            const height = Number(match[2])
            if (width > 0 && height > 0) {
                return { width, height }
            }
        }
    }
    return null
}

/**
 * 读取视频封面与时长：封面优先 pic_info 的档位地址，其次 page_pic 单直链；
 * 时长兼容三处写法（data.duration、media_info.duration、duration_time）。
 */
function pickVideoCandidate(data: Record<string, unknown>): VideoCandidate {
    const fromPic = pickMediaCandidate(data.pic_info) ?? pickMediaCandidate(data.page_info)
    const pageInfo = isRecord(data.page_info) ? data.page_info : {}
    // 封面有三处写法：pic_info 的档位对象、data.page_pic、data.page_info.page_pic
    const direct =
        fromPic === null
            ? (normalizeWeiboImageUrl(toText(data.page_pic)) ?? normalizeWeiboImageUrl(toText(pageInfo.page_pic)))
            : null
    const coverUrl = fromPic === null ? direct : fromPic.url
    const mediaInfo = isRecord(data.media_info)
        ? data.media_info
        : isRecord(pageInfo.media_info)
          ? pageInfo.media_info
          : {}
    const duration = toCount(data.duration) || toCount(mediaInfo.duration) || toCount(data.duration_time)
    return {
        coverUrl,
        coverMiddleUrl: fromPic?.middleUrl ?? (coverUrl === null ? null : buildMiddleImageUrl(coverUrl)),
        durationSeconds: duration > 0 ? duration : null,
        playUrl: pickProgressiveUrl(mediaInfo),
        resolution: pickMaxResolution(mediaInfo),
    }
}

/**
 * 提取媒体摘要：图文与视频按 mix_media_info.items 原序落 items，三个图片数组由它派生。
 * 关键约束：混排项是唯一顺序来源——先按 items 走一遍，pic_infos 只补混排里没出现的图，
 * 避免「先全部图片再视频」把图文交错的顺序压平；视频只取封面与时长，播放地址仅留在 videoUrl 供兜底诊断。
 */
function extractMedia(record: Record<string, unknown>): WeiboTimelineMedia {
    const items: WeiboTimelineMediaItem[] = []
    const images: string[] = []
    const imageIds: string[] = []
    const thumbnails: string[] = []
    const sizes: Array<WeiboTimelineImageSize | null> = []
    /** 已收录的 pid 与原图地址：pic_infos 与 mix_media_info 是同一批图的两种视图 */
    const seenPids = new Set<string>()
    const seenUrls = new Set<string>()

    /** 追加一张图：pid 与直链双重去重，三个数组保持同序，前端按索引配对 */
    const pushImage = (candidate: MediaCandidate | null, pid?: string): void => {
        if (candidate === null) {
            return
        }
        if (pid !== undefined && seenPids.has(pid)) {
            return
        }
        if (seenUrls.has(candidate.url)) {
            return
        }
        if (pid !== undefined) {
            seenPids.add(pid)
        }
        seenUrls.add(candidate.url)
        const middleUrl = candidate.middleUrl ?? buildMiddleImageUrl(candidate.url)
        images.push(candidate.url)
        // pid 与图片同序：缺失时为空的占位串，调用方据此回退直链下载
        imageIds.push(pid ?? '')
        thumbnails.push(middleUrl)
        sizes.push(candidate.size)
        items.push({ kind: 'image', url: candidate.url, middleUrl, size: candidate.size })
    }

    let videoUrl: string | null = null
    let videoCount = 0

    // 混排项：图片与视频按上游原序落 items，视频不占图片格
    const mixMedia = record.mix_media_info
    if (isRecord(mixMedia) && Array.isArray(mixMedia.items)) {
        for (const raw of mixMedia.items) {
            if (!isRecord(raw)) {
                continue
            }
            if (isVideoItem(raw)) {
                const data = isRecord(raw.data) ? raw.data : raw
                const candidate = pickVideoCandidate(data)
                items.push({
                    kind: 'video',
                    coverUrl: candidate.coverUrl,
                    coverMiddleUrl: candidate.coverMiddleUrl,
                    durationSeconds: candidate.durationSeconds,
                    playUrl: candidate.playUrl,
                    resolution: candidate.resolution,
                })
                videoCount += 1
                if (videoUrl === null) {
                    videoUrl = candidate.playUrl
                }
                continue
            }
            const rawPid = toText(raw.id) || toText(raw.pid) || toText(isRecord(raw.data) ? raw.data.id : '')
            const pid = rawPid.length > 0 ? rawPid : undefined
            const candidate =
                pickMediaCandidate(raw.data) ??
                pickMediaCandidate(raw) ??
                (pid === undefined ? null : candidateFromPid(pid))
            pushImage(candidate, pid)
        }
    }

    // 部分版本只在 pic_infos 给图、mix_media_info 只给视频：混排没收录的图按 pid 顺序补在尾部
    const picInfos = record.pic_infos
    if (isRecord(picInfos)) {
        for (const [pid, info] of Object.entries(picInfos)) {
            pushImage(pickMediaCandidate(info) ?? candidateFromPid(pid), pid)
        }
    }

    // 兜底：只有 pic_ids 没有直链时用 pid 拼图床地址，否则图片区是空的
    if (Array.isArray(record.pic_ids)) {
        for (const rawPid of record.pic_ids) {
            const pid = toText(rawPid)
            pushImage(pid.length === 0 ? null : candidateFromPid(pid), pid.length === 0 ? undefined : pid)
        }
    }
    for (const key of ['original_pic', 'bmiddle_pic', 'thumbnail_pic']) {
        const url = normalizeWeiboImageUrl(toText(record[key]))
        if (url !== null) {
            pushImage({ url, middleUrl: buildMiddleImageUrl(url), size: null })
        }
    }

    /**
     * 顶层 page_info 的视频卡片：补一个视频项，卡片才有封面与播放入口。
     * 视频标识有三种：新版给 `object_type: video` / `type: 11`，旧版没有类型标识、只有整段播放地址；
     * 群组与投票卡片同样带 page_pic 却没有播放地址，不能只凭封面就当成视频。
     */
    const pageInfo = record.page_info
    if (isRecord(pageInfo)) {
        const hasVideoType = pageInfo.object_type === 'video' || pageInfo.type === 11
        const isLegacyVideo =
            pageInfo.object_type === undefined && pageInfo.type === undefined
                ? pickProgressiveUrl(pageInfo.media_info) !== null
                : false
        if (videoCount === 0 && (hasVideoType || isLegacyVideo)) {
            const candidate = pickVideoCandidate(pageInfo)
            items.push({
                kind: 'video',
                coverUrl: candidate.coverUrl,
                coverMiddleUrl: candidate.coverMiddleUrl,
                durationSeconds: candidate.durationSeconds,
                playUrl: candidate.playUrl,
                resolution: candidate.resolution,
            })
            videoCount = 1
            if (videoUrl === null) {
                videoUrl = candidate.playUrl
            }
        }
    }

    const declared = toCount(record.pic_num)
    return {
        items,
        images,
        imageIds,
        thumbnails,
        sizes,
        videoUrl,
        // 只数图片：视频不占图片格，混排时也不再拿上游声明数冒充实际渲染数
        imageCount: Math.max(declared, images.length),
        videoCount,
    }
}

/** 读当前账号是否已赞：上游有对象与数字两种形态，缺失按未赞处理 */
export function readIsLiked(record: Record<string, unknown>): boolean {
    const status = record.attitudes_status
    if (isRecord(status)) {
        return status.liked === true || status.liked === 1
    }
    return status === 1 || record.liked === true
}

/**
 * 读阅读数：只有自己发布的微博上游才会下发 reads_count，数字与数字字符串都收下。
 * 关键约束：缺失或非数字一律为 null——0 与「没下发」必须区分，否则界面上会给别人的微博标一个 0 阅读。
 */
function readReadsCount(record: Record<string, unknown>): number | null {
    const value = record.reads_count
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.trunc(value)
    }
    if (typeof value === 'string' && /^[0-9]+$/u.test(value.trim())) {
        return Number(value.trim())
    }
    return null
}

/** 互动数据：字段名按微博原样映射，缺失按 0 */
function extractMetrics(record: Record<string, unknown>): WeiboTimelineMetrics {
    return {
        reposts: toCount(record.reposts_count),
        comments: toCount(record.comments_count),
        likes: toCount(record.attitudes_count),
    }
}

/** 拼原文地址：有 mblogid 时用 /{uid}/{mblogid}，否则退回 /detail/{id} */
function buildPostUrl(uid: string, mblogid: string, id: string): string {
    if (mblogid.length === 0) {
        return `${WEIBO_WEB_ORIGIN}/detail/${id}`
    }
    return uid.length > 0 ? `${WEIBO_WEB_ORIGIN}/${uid}/${mblogid}` : `${WEIBO_WEB_ORIGIN}/detail/${id}`
}

/**
 * 长文判定：上游 isLongText 会把「带视频卡片链接」的普通微博也标成 true，
 * 只有附带 continue_tag（「全文」入口）或正文末尾的展开痕迹才算真正被截断的长文；
 * longText 对象是旧版长文字段，命中即为长文。主贴与转发体共用同一份判定。
 */
function isLongTextRecord(record: Record<string, unknown>): boolean {
    if (isRecord(record.longText)) {
        return true
    }
    if (record.isLongText !== true) {
        return false
    }
    // 痕迹只可能在末尾：取尾部再匹配，既省扫描也避免嵌套量词在长正文上回溯
    const rawHtml = toText(record.text).slice(-LONG_TEXT_TAIL_LENGTH)
    const textRaw = toText(record.text_raw).slice(-LONG_TEXT_TAIL_LENGTH)
    return (
        isRecord(record.continue_tag) ||
        LONG_TEXT_MARKER_PATTERN.test(rawHtml) ||
        LONG_TEXT_MARKER_PATTERN.test(textRaw)
    )
}

/**
 * 归一化转发体：保留摘要、作者、媒体与分段，不再递归展开（转发里再转发只按文字处理）。
 * 分段与主贴同源：用带标签的 text 切，正文里的 @账号、话题与链接同样可点。
 */
function normalizeRetweeted(value: unknown): WeiboTimelineRetweet | null {
    if (!isRecord(value)) {
        return null
    }
    const id = toText(value.idstr) || toText(value.id) || toText(value.mid)
    if (id.length === 0) {
        return null
    }
    const user = isRecord(value.user) ? value.user : {}
    const authorId = toText(user.id)
    const author = toText(user.screen_name)
    const textRaw = toText(value.text_raw)
    const plainText =
        textRaw.length > 0 ? stripWeiboHtml(textRaw) : stripWeiboHtml(replaceEmojiWithText(toText(value.text)))
    // 转发体同样可能是长文：卡片只展示摘要，保存笔记时宿主据此补取全文
    const isLongText = isLongTextRecord(value)
    const text = isLongText ? stripTrailingTruncation(plainText) : plainText
    const html = removeExpandLink(readPostHtml(toText(value.text)) ?? '')
    const segments = html.length > 0 ? parsePostSegments(html) : buildTextSegments(text)
    if (isLongText) {
        removeTrailingExpandHint(segments)
    }
    const createdAtRaw = toText(value.created_at)
    return {
        id,
        authorId,
        authorName: author,
        // 与主贴作者同口径：认 verified 布尔，缺失按未认证处理
        authorIsVerified: user.verified === true,
        text,
        segments,
        url: buildPostUrl(authorId, toText(value.mblogid), id),
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        media: extractMedia(value),
        isLongText,
    }
}

/**
 * 是否为广告或推广位：这类条目没有稳定 id，混进时间线会污染增量游标。
 * 标记有三种形态：时间线的 ad_state、部分端点的 is_ad、点赞列表的驼峰 isAd，
 * 以及只打 mark 的推广位（mark 里带 WeiboADNatural）；全部按广告丢弃。
 */
function isPromoted(record: Record<string, unknown>): boolean {
    if (record.ad_state === 1 || record.is_ad === true || record.isAd === true) {
        return true
    }
    if (toText(record.mark).includes('WeiboADNatural')) {
        return true
    }
    return isRecord(record.promotion)
}

/**
 * 去掉媒体里的视频项：转发微博的外层与引用区会各渲染一次同一个视频，
 * 被转发内容已有视频时外层只保留图片，视频只留在引用区播。
 */
function withoutVideos(media: WeiboTimelineMedia): WeiboTimelineMedia {
    if (media.videoCount === 0) {
        return media
    }
    return {
        ...media,
        items: media.items.filter((item) => item.kind !== 'video'),
        videoCount: 0,
        videoUrl: null,
    }
}

/**
 * 归一化单条微博。
 * 缺少数字 id 或属于广告位时返回 null，调用方据此跳过且不计数。
 */
export function normalizeTimelinePost(raw: unknown): WeiboTimelinePost | null {
    if (!isRecord(raw) || isPromoted(raw)) {
        return null
    }
    const id = toText(raw.idstr) || toText(raw.id) || toText(raw.mid)
    if (id.length === 0) {
        return null
    }
    const mblogid = toText(raw.mblogid)
    const user = isRecord(raw.user) ? raw.user : {}
    const uid = toText(user.id)
    const avatar = toText(user.avatar_large) || toText(user.profile_image_url)
    const textRaw = toText(raw.text_raw)
    // 超长或锚点不成对的正文不进入标签解析：removeExpandLink 本身也是正则，必须一并挡在前面
    const html = removeExpandLink(readPostHtml(toText(raw.text)) ?? '')
    const isLongText = isLongTextRecord(raw)
    const plainText = textRaw.length > 0 ? stripWeiboHtml(textRaw) : stripWeiboHtml(replaceEmojiWithText(html))
    // 长文摘要末尾常带「……展开」：卡片已有展开按钮，正文里再留一份会造成重复提示
    const text = isLongText ? stripTrailingTruncation(plainText) : plainText
    // 表情只存在于带标签的 text 里：text_raw 会把表情压成 [名称] 纯文本，无法还原成图片
    const segments = html.length > 0 ? parsePostSegments(html) : buildTextSegments(text)
    if (isLongText) {
        removeTrailingExpandHint(segments)
    }
    const createdAtRaw = toText(raw.created_at)
    const retweeted = normalizeRetweeted(raw.retweeted_status)
    const media = extractMedia(raw)
    // 转发微博外层不重复展示视频：被转发内容已带视频时，视频只留在引用区
    const visibleMedia = retweeted !== null && retweeted.media.videoCount > 0 ? withoutVideos(media) : media

    return {
        id,
        mblogid,
        url: buildPostUrl(uid, mblogid, id),
        text,
        segments,
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        source: stripWeiboHtml(toText(raw.source)),
        author: {
            id: uid,
            name: toText(user.screen_name),
            avatarUrl: normalizeWeiboImageUrl(avatar) ?? '',
            isVerified: user.verified === true,
            // 关注态只认上游 following 布尔：缺失按未关注处理，卡片据此给出关注入口
            isFollowing: user.following === true,
        },
        metrics: extractMetrics(raw),
        media: visibleMedia,
        retweeted,
        isLiked: readIsLiked(raw),
        isLongText,
        readsCount: readReadsCount(raw),
    }
}

/**
 * 轻量提取去重键：与 normalizeTimelinePost 的口径一致——广告位与缺 id 条目返回 null。
 * 关键约束：只做几次属性读取，绝不能触发正文清洗与媒体归一化，否则去重前移就失去意义。
 */
function readStatusKey(raw: unknown): string | null {
    if (!isRecord(raw) || isPromoted(raw)) {
        return null
    }
    const id = toText(raw.idstr) || toText(raw.id) || toText(raw.mid)
    return id.length > 0 ? id : null
}

/** 夹取翻页数：非法值取 1，超出上限按上限 */
function clampMaxPages(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1
    }
    return Math.min(Math.max(Math.trunc(value), 1), WEIBO_TIMELINE_MAX_PAGES)
}

/** 游标清洗：空串与非数字一律视为未指定 */
function normalizeCursor(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? ''
    return trimmed.length > 0 ? trimmed : null
}

/**
 * 拉取关注时间线。
 * 首屏与翻页走同一入口：带 maxId 即向后翻页，带 sinceId 即增量（只取一页）。
 */
export async function fetchFriendTimeline(options: FetchTimelineOptions): Promise<WeiboTimelineResult> {
    const requestPage = options.requestPage ?? requestTimelinePage
    const now = options.now ?? ((): Date => new Date())
    const maxPages = clampMaxPages(options.maxPages)
    const sinceCursor = normalizeCursor(options.sinceId)
    const isIncremental = sinceCursor !== null && sinceCursor !== '0'
    let cursor = normalizeCursor(options.maxId)
    let nextCursor: string | null = cursor
    let lastPage: TimelinePage | null = null
    let pages = 0
    let droppedDuplicates = 0
    const seen = new Set<string>()
    const posts: WeiboTimelinePost[] = []

    while (pages < maxPages) {
        const page = await requestPage({
            cookie: options.cookie,
            uid: options.uid,
            sinceId: isIncremental ? sinceCursor : '0',
            maxId: cursor,
            count: options.count,
            refresh: options.refresh,
            timeoutMs: options.timeoutMs,
            minIntervalMs: options.minIntervalMs,
        })
        pages += 1
        lastPage = page
        for (const raw of page.statuses) {
            const id = readStatusKey(raw)
            if (id === null) {
                continue
            }
            // 去重先于归一化：跨页重复条目不必再做一遍正文解析与媒体收窄
            if (seen.has(id)) {
                droppedDuplicates += 1
                continue
            }
            const post = normalizeTimelinePost(raw)
            if (post === null) {
                continue
            }
            seen.add(id)
            posts.push(post)
        }

        const pageNext = normalizeCursor(page.maxId)
        // 增量只取第一页：再往后翻就变成补历史，与「看新内容」的语义相反
        if (isIncremental) {
            nextCursor = null
            break
        }
        if (page.statuses.length === 0 || pageNext === null || pageNext === cursor) {
            nextCursor = null
            break
        }
        nextCursor = pageNext
        cursor = pageNext
    }

    // 增量起点优先取上游 since_id：首页 unreadfriendstimeline 返回的是读进度游标（与微博 id 不同量级），
    // 用首条微博 id 覆盖会让下次增量传错游标；分组 / 时间线的 since_id 恰好等于首条 id，两种口径等价。
    const sinceId = lastPage?.sinceId ?? posts[0]?.id ?? null
    return {
        posts,
        sinceId,
        maxId: nextCursor,
        hasMore: nextCursor !== null && posts.length > 0,
        pages,
        fetchedAt: now().toISOString(),
        droppedDuplicates,
    }
}
