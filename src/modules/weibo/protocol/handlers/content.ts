/**
 * 微博协议·内容域：发布、图片与视频地址签发、长文读取，以及保存笔记 / 添加到 AI 对话的桥接。
 * 复用约定：图片与视频地址由面板注入的代理与中转服务签发，未注入时回 null 而不是抛错；
 * 笔记与对话动作的正文收窄走 shared/types/weibo 的读取器，长文补全交给 RouteSupport。
 * 关键约束：发布是写操作，图片逐张读取、任一失败即整条放弃，绝不带半套图片发布；
 * 桥接动作不解析 HTML、不发起额外取数，截断内容取不到全文时保留摘要并标注截断。
 */
import {
    isWeiboImageRequest,
    isWeiboLongTextRequest,
    isWeiboPublishRequest,
    isWeiboVideoRequest,
    readWeiboCommentChatPayload,
    readWeiboPagePost,
    readWeiboRepostChatPayload,
} from '@shared/types/weibo'
import type {
    WeiboChatContextResult,
    WeiboCommentChatPayload,
    WeiboImageResult,
    WeiboLongTextResult,
    WeiboNoteSaveResult,
    WeiboPagePostPayload,
    WeiboPublishResult,
    WeiboRepostChatPayload,
    WeiboVideoResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import type { WeiboUploadImage } from '../../api/write/publish'
import type { WeiboRouteDeps } from '../deps'
import type { RouteSupport } from '../support'
import { fetchLongText } from '../../api/longText'
import { publishWeibo } from '../../api/write/publish'
import { WeiboWebError } from '../../transport/httpClient'

/** 内容域处理器：发布与媒体地址签发，兼做笔记 / 对话桥接 */
export class ContentHandlers {
    public constructor(
        private readonly deps: WeiboRouteDeps,
        private readonly support: RouteSupport,
    ) {}

    /**
     * 发布微博：收窄入参 → 读 uploads 图片字节 → 传图床换 pid → 提交正文与 pid。
     * 关键约束：正文与图片至少一项；图片逐张读取，任一缺失即整条放弃，绝不带半套图片发布；
     * 图床不需要账号 uid 与昵称（Cookie 已带登录态）；写操作不重试，失败文案直接回给前端，避免重复发博。
     */
    public async loadPublish(payload: unknown): Promise<WeiboPublishResult> {
        if (!isWeiboPublishRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.publish} 参数非法：正文不超过 2000 字，图片须为 uploads 下最多 9 个文件路径，且正文与图片至少一项`,
            )
        }
        const cookie = await this.support.readCookie()
        const readImage = this.deps.readUploadImage
        const images: WeiboUploadImage[] = []
        for (const path of payload.images ?? []) {
            if (readImage === undefined) {
                throw new WeiboWebError('upstream', '当前宿主未装配上传目录，无法读取发布图片')
            }
            try {
                images.push(await readImage(path))
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                throw new WeiboWebError('invalid-payload', `读取发布图片失败：${reason}`)
            }
        }
        const publish = this.deps.publishPost ?? publishWeibo
        return publish({ cookie, content: payload.content, images })
    }

    /**
     * 图片代理：图床按 Referer 放行，Webview 直连必被拒，统一由宿主取回再签发本地地址。
     * 未注入代理时返回 null 而不是抛错——面板在没有缓存目录的宿主上仍应能打开。
     */
    public async loadImage(payload: unknown): Promise<WeiboImageResult> {
        if (!isWeiboImageRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.image} 参数非法：url 必须为长度不超过 1024 的字符串`,
            )
        }
        const resolveImageUrl = this.deps.resolveImageUrl
        if (resolveImageUrl === undefined) {
            return { url: null }
        }
        return { url: await resolveImageUrl(payload.url) }
    }

    /**
     * 视频播放地址：把 CDN 地址换成本地中转地址（本地服务补 Referer 流式转发，不落盘）。
     * 关键约束：未注入中转服务时返回 null 而不是抛错——面板在禁用网络能力时也应能打开；
     * 前端拿到 null 会回退「打开原文」，不把一次播放失败升级成错误弹窗。
     */
    public async loadVideo(payload: unknown): Promise<WeiboVideoResult> {
        if (!isWeiboVideoRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.video} 参数非法：url 必须为长度不超过 1024 的字符串`,
            )
        }
        const resolveVideoUrl = this.deps.resolveVideoUrl
        if (resolveVideoUrl === undefined) {
            return { url: null, seekable: false }
        }
        const resolved = await resolveVideoUrl(payload.url)
        return resolved === null ? { url: null, seekable: false } : { url: resolved.url, seekable: resolved.seekable }
    }

    /** 读取长文全文：id 用 mblogid（数字 id 也兼容），缺凭证直接给出可执行的引导 */
    public async loadLongText(payload: unknown): Promise<WeiboLongTextResult> {
        if (!isWeiboLongTextRequest(payload)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.longText} 参数非法：id 须为 mblogid 或数字 id`)
        }
        const cookie = await this.support.readCookie()
        const load = this.deps.fetchLongText ?? fetchLongText
        return load({ cookie, id: payload.id })
    }

    /**
     * 保存为笔记：载荷收窄 → 长文补全 → 交给笔记模块落盘并索引。
     * 关键约束：正文与链接都由 readWeiboPagePost 收窄，本层不拼路径也不改写内容；
     * 主贴或转发体被上游截断（长文）时先取全文，取不到才保留摘要。
     */
    public async saveToNote(payload: unknown): Promise<WeiboNoteSaveResult> {
        const post = readWeiboPagePost(payload)
        if (post === null) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.saveToNote} 参数非法：缺少合法正文、作者或微博链接`,
            )
        }
        const saveToNote = this.deps.saveToNote
        if (saveToNote === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配笔记模块，无法保存为笔记')
        }
        return saveToNote(await this.support.expandLongText(post))
    }

    /**
     * 添加到 AI 对话：载荷收窄 → 长文补全 → 交由 AI 层构造内联引用。
     * 关键约束：微博没有文档目录，会话作用域由 AI 层固定为 weibo 模块，路由不感知会话细节；
     * 与保存笔记同口径，主贴或转发体被截断时先取全文，失败只保留摘要，不阻断添加。
     */
    public async addToChat(payload: unknown): Promise<WeiboChatContextResult> {
        const post: WeiboPagePostPayload | null = readWeiboPagePost(payload)
        if (post === null) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.addToChat} 参数非法：缺少合法正文、作者或微博链接`,
            )
        }
        const addToChat = this.deps.addToChat
        if (addToChat === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配 AI 对话，无法添加为上下文')
        }
        return addToChat(await this.support.expandLongText(post))
    }

    /**
     * 评论添加到 AI 对话：载荷收窄 → 交由 AI 层构造内联引用。
     * 关键约束：评论正文已在协议层收窄，本层不取数、不补全长文，也不接受任何评论链接；
     * 会话作用域同样由 AI 层固定为 weibo 模块，与主贴添加共用同一份上下文。
     */
    public async commentAddToChat(payload: unknown): Promise<WeiboChatContextResult> {
        const comment: WeiboCommentChatPayload | null = readWeiboCommentChatPayload(payload)
        if (comment === null) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.commentAddToChat} 参数非法：缺少合法评论 id、作者或正文`,
            )
        }
        const commentAddToChat = this.deps.commentAddToChat
        if (commentAddToChat === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配 AI 对话，无法添加为上下文')
        }
        return commentAddToChat(comment)
    }

    /**
     * 转发添加到 AI 对话：载荷收窄 → 交由 AI 层构造内联引用。
     * 关键约束：附言已在协议层收窄，本层不取数、不接受任何转发链接；
     * 会话作用域由 AI 层固定为 weibo 模块，与主贴、评论的添加共用同一份上下文。
     */
    public async repostAddToChat(payload: unknown): Promise<WeiboChatContextResult> {
        const repost: WeiboRepostChatPayload | null = readWeiboRepostChatPayload(payload)
        if (repost === null) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.repostAddToChat} 参数非法：缺少合法转发 id、作者或附言`,
            )
        }
        const repostAddToChat = this.deps.repostAddToChat
        if (repostAddToChat === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配 AI 对话，无法添加为上下文')
        }
        return repostAddToChat(repost)
    }
}
