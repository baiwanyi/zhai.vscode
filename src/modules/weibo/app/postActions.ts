/**
 * 微博动作的宿主实现：主贴保存为笔记（Markdown 落盘 + 索引）、主贴与评论添加到 AI 对话（内联引用）。
 * 复用约定：主贴的 Markdown 与对话文本由 ./note 产出，笔记落盘走 note/createNoteFromContent，
 * 引用沿用 ai/contextRefs 的 HostContextRef 形态，会话对齐与面板跳转复用 ai 层既有入口。
 * 关键约束：微博没有文档目录，引用一律落到 weibo 模块作用域的会话，避免串进作品或笔记的对话；
 * 内容已在协议层收窄，本层不再解析 HTML、不发起任何网络请求，也不向 Webview 回传绝对路径；
 * 评论没有永久链接，去重键由评论 id 组成，不与主贴的原文链接混用。
 */
import { randomUUID } from 'node:crypto'
import type { AiChatService } from '@modules/ai/chatService'
import { focusChatSection } from '@modules/ai/commands'
import { MAX_CONTEXT_COUNT } from '@modules/ai/contextRefs'
import type { HostContextRef } from '@modules/ai/contextRefs'
import type { WorkflowRouter } from '@modules/ai/workflowRouter'
import { logger } from '@modules/common/logger'
import { createNoteFromContent } from '@modules/note/noteService'
import type { NoteIndexer } from '@modules/note/noteService'
import type {
    WeiboChatContextResult,
    WeiboCommentChatPayload,
    WeiboNoteSaveResult,
    WeiboPagePostPayload,
    WeiboRepostChatPayload,
} from '@shared/types/weibo'
import { WEIBO_MODULE_KEY } from '@shared/types/workflow'
import { buildWeiboChatText, buildWeiboNoteMarkdown, buildWeiboNoteTitle } from './note'

/** 待搬运的配图：pid 用于官方下载端点取最大尺寸，直链作为回退 */
export interface WeiboImageCandidate {
    /** 图片 pid：空串表示上游未给，直接走直链 */
    pid: string
    /** 图床原图直链：官方下载失败时的回退 */
    url: string
}

/**
 * 配图搬运器：把微博图床的远程图搬进 uploads/，返回与入参一一对应的存储根相对路径。
 * 关键约束：取图依赖图床的 Referer 与登录 Cookie，只有面板持有该通道，故由调用方按次传入；
 * 未传入时笔记保留远程直链，不阻断保存。
 */
export type WeiboImageSaver = (images: readonly WeiboImageCandidate[]) => Promise<Array<string | null>>

/** 卡片动作：由面板注入路由，未注入时对应协议方法直接报未就绪 */
export interface WeiboPostActions {
    /** 保存为笔记：返回存储根相对路径、标题与本地化配图张数，前端只展示不拼装 */
    saveToNote: (post: WeiboPagePostPayload, saveImages?: WeiboImageSaver) => Promise<WeiboNoteSaveResult>
    /** 添加到 AI 对话：added 为 false 时 reason 说明重复或达上限 */
    addToChat: (post: WeiboPagePostPayload) => Promise<WeiboChatContextResult>
    /** 评论添加到 AI 对话：评论没有独立链接，正文由载荷带出 */
    commentAddToChat: (payload: WeiboCommentChatPayload) => Promise<WeiboChatContextResult>
    /** 转发添加到 AI 对话：转发同样没有独立链接，附言由载荷带出 */
    repostAddToChat: (payload: WeiboRepostChatPayload) => Promise<WeiboChatContextResult>
}

/** 动作依赖：三项都来自宿主已装配的服务，面板不感知具体实现 */
export interface WeiboPostActionDeps {
    indexer: NoteIndexer
    chat: AiChatService
    router: WorkflowRouter
}

/** 引用标签：作者名缺失时给可读占位，前端芯片与消息徽章共用 */
function toContextLabel(post: WeiboPagePostPayload): string {
    return `微博·${post.author.name.length > 0 ? post.author.name : '未知作者'}`
}

/** 评论引用标签：与主贴区分开，作者名缺失时给可读占位 */
function toCommentContextLabel(authorName: string): string {
    return `微博评论·${authorName.length > 0 ? authorName : '未知用户'}`
}

/** 评论文本：评论没有独立链接，只带作者、时间、被回复者与正文 */
function buildCommentChatText(payload: WeiboCommentChatPayload): string {
    const author = payload.authorName.length > 0 ? payload.authorName : '未知用户'
    const lines: string[] = []
    lines.push(`微博评论 @${author}${payload.createdAt.length > 0 ? `（${payload.createdAt}）` : ''}`)
    if (payload.replyToName.length > 0) {
        lines.push(`回复 @${payload.replyToName}`)
    }
    lines.push('')
    lines.push(payload.text.length > 0 ? payload.text : '(无正文)')
    return lines.join('\n')
}

/** 转发引用标签：与主贴、评论的标签区分开，作者名缺失时给可读占位 */
function toRepostContextLabel(authorName: string): string {
    return `微博转发·${authorName.length > 0 ? authorName : '未知用户'}`
}

/** 转发的对话文本：作者、时间与附言，纯转发按「无正文」说明 */
function buildRepostChatText(payload: WeiboRepostChatPayload): string {
    const author = payload.authorName.length > 0 ? payload.authorName : '未知用户'
    const lines: string[] = []
    lines.push(`微博转发 @${author}${payload.createdAt.length > 0 ? `（${payload.createdAt}）` : ''}`)
    lines.push('')
    lines.push(payload.text.length > 0 ? payload.text : '(无正文)')
    return lines.join('\n')
}

/** 载荷转图片候选：pid 与直链按索引配对，pid 缺失（旧载荷或上游未给）时为空串 */
function toImageCandidates(images: readonly string[], imageIds: readonly string[]): WeiboImageCandidate[] {
    return images.map((url, index) => ({ pid: imageIds[index] ?? '', url }))
}

/** 配图搬运：整体失败时回退为空数组（全部保留远程直链），不阻断笔记落盘 */
async function savePostImages(
    images: readonly WeiboImageCandidate[],
    saveImages: WeiboImageSaver | undefined,
): Promise<Array<string | null>> {
    if (images.length === 0 || saveImages === undefined) {
        return []
    }
    try {
        return await saveImages(images)
    } catch (error) {
        logger.warn(`微博配图搬运失败，笔记保留远程直链：${error instanceof Error ? error.message : String(error)}`)
        return []
    }
}

/**
 * 组装卡片动作实现。
 * 保存路径：组装 Markdown → 笔记模块落盘并索引，重名由笔记模块顺延序号；
 * 对话路径：正文即刻成文（不落盘）→ 对齐微博作用域会话 → 复用 addContexts 的去重与条数上限 → 切到对话分区。
 */
export function createWeiboPostActions(deps: WeiboPostActionDeps): WeiboPostActions {
    return {
        saveToNote: async (post: WeiboPagePostPayload, saveImages?: WeiboImageSaver): Promise<WeiboNoteSaveResult> => {
            // 主贴与转发配图一次搬运：失败项为 null，由组装层回退远程直链
            const mainCandidates = toImageCandidates(post.images, post.imageIds)
            const retweetCandidates =
                post.retweeted === null ? [] : toImageCandidates(post.retweeted.images, post.retweeted.imageIds)
            const saved = await savePostImages([...mainCandidates, ...retweetCandidates], saveImages)
            const localImages = saved.slice(0, mainCandidates.length)
            const retweetImages = saved.slice(mainCandidates.length)
            const created = await createNoteFromContent(deps.indexer, {
                title: buildWeiboNoteTitle(post),
                markdown: buildWeiboNoteMarkdown(post, { localImages, retweetImages }),
            })
            return {
                path: created.path,
                title: created.title,
                imageCount: saved.filter((item) => item !== null).length,
            }
        },
        addToChat: async (post: WeiboPagePostPayload): Promise<WeiboChatContextResult> => {
            const text = buildWeiboChatText(post)
            const label = toContextLabel(post)
            const ref: HostContextRef = {
                id: randomUUID(),
                kind: 'weibo',
                label,
                displayPath: label,
                startLine: null,
                endLine: null,
                charCount: text.length,
                // 长文已在协议层补全：这里的标记只表示「补全也失败，正文仍是上游摘要」
                isTruncated: post.isTruncated,
                // uri 只作去重键与标识：微博永久链接唯一，同一帖子不会被重复加入
                uri: post.url,
                inlineText: text,
            }
            deps.chat.useScope(WEIBO_MODULE_KEY)
            const result = deps.chat.addContexts([ref])
            if (result.added.length === 0) {
                return {
                    added: false,
                    reason:
                        result.duplicated > 0
                            ? '这条微博已在对话上下文中'
                            : `上下文已达 ${String(MAX_CONTEXT_COUNT)} 项上限，请先在对话面板中移除`,
                }
            }
            await focusChatSection(deps.router)
            return { added: true, label }
        },
        commentAddToChat: async (payload: WeiboCommentChatPayload): Promise<WeiboChatContextResult> => {
            const text = buildCommentChatText(payload)
            const label = toCommentContextLabel(payload.authorName)
            const ref: HostContextRef = {
                id: randomUUID(),
                kind: 'weibo',
                label,
                displayPath: label,
                startLine: null,
                endLine: null,
                charCount: text.length,
                // 正文由前端带出，不存在上游截断
                isTruncated: false,
                // 评论没有永久链接：评论 id 天然唯一，用它组成去重键，同一条评论不会被重复加入
                uri: `weibo-comment:${payload.commentId}`,
                inlineText: text,
            }
            deps.chat.useScope(WEIBO_MODULE_KEY)
            const result = deps.chat.addContexts([ref])
            if (result.added.length === 0) {
                return {
                    added: false,
                    reason:
                        result.duplicated > 0
                            ? '这条评论已在对话上下文中'
                            : `上下文已达 ${String(MAX_CONTEXT_COUNT)} 项上限，请先在对话面板中移除`,
                }
            }
            await focusChatSection(deps.router)
            return { added: true, label }
        },
        repostAddToChat: async (payload: WeiboRepostChatPayload): Promise<WeiboChatContextResult> => {
            const text = buildRepostChatText(payload)
            const label = toRepostContextLabel(payload.authorName)
            const ref: HostContextRef = {
                id: randomUUID(),
                kind: 'weibo',
                label,
                displayPath: label,
                startLine: null,
                endLine: null,
                charCount: text.length,
                // 附言由前端带出，不存在上游截断
                isTruncated: false,
                // 转发没有永久链接：转发 id 天然唯一，用它组成去重键
                uri: `weibo-repost:${payload.repostId}`,
                inlineText: text,
            }
            deps.chat.useScope(WEIBO_MODULE_KEY)
            const result = deps.chat.addContexts([ref])
            if (result.added.length === 0) {
                return {
                    added: false,
                    reason:
                        result.duplicated > 0
                            ? '这条转发已在对话上下文中'
                            : `上下文已达 ${String(MAX_CONTEXT_COUNT)} 项上限，请先在对话面板中移除`,
                }
            }
            await focusChatSection(deps.router)
            return { added: true, label }
        },
    }
}
