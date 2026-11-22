/**
 * 微博卡片动作：保存到笔记与添加到 AI 对话。
 * 复用约定：请求统一走 bridge 的 request，错误提示统一 toastError，成功提示走 sonner；
 * 载荷按 shared/types/weibo 的协议字段组装，视图层只关心按钮状态，不拼协议字段。
 * 关键约束：两个动作互斥（任一请求进行中两者都禁用），避免并发写盘与并发改上下文；
 * 卡片上已自动展开的主贴与转发全文随载荷带出，未展开的长文只标 isTruncated，由宿主补全；
 * 「已保存」只是本次挂载的本地回执，不当作持久事实（再次保存会新建另一篇笔记）；
 * 卸载时清掉回执定时器，避免对已销毁组件重复 setState。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    WeiboChatContextResult,
    WeiboNoteSaveResult,
    WeiboPagePostPayload,
    WeiboTimelinePost,
    WeiboTimelineRetweet,
} from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

/**
 * 加入对话的超时：宿主可能先补取长文全文（主贴 + 转发体各一次，受 1.2s 节流与退避约束），
 * 故不能按纯内存操作给，留足一次全文往返的余量。
 */
const CHAT_TIMEOUT_MS = 60_000

/** 保存笔记的超时：含配图下载与落盘，图床慢时单张就可能耗时数秒，故放宽到两分钟 */
const SAVE_NOTE_TIMEOUT_MS = 120_000

/** 「已保存」回执停留时长：够看清提示，又不让按钮长期停在非动作文案上 */
const SAVED_HINT_MS = 2_000

/** 卡片动作载荷的单条配图上限：协议与宿主收窄都按 9 张算，卡片展示本身不受此限 */
const MAX_PAYLOAD_IMAGES = 9

export interface WeiboPostActionController {
    /** 保存请求进行中：按钮转圈并禁用 */
    isSavingNote: boolean
    /** 本次挂载内已保存成功：按钮短暂显示「已保存」 */
    isSavedNote: boolean
    /** 加入对话请求进行中 */
    isAddingToChat: boolean
    saveToNote: () => void
    addToChat: () => void
}

/** 转发体转载荷：文本与配图一并带出，避免三元里反复访问同一可空属性 */
function toRetweetPayload(
    retweeted: WeiboTimelineRetweet | null,
    fullText: string | null,
): WeiboPagePostPayload['retweeted'] {
    if (retweeted === null) {
        return null
    }
    return {
        id: retweeted.id,
        authorName: retweeted.authorName,
        text: fullText ?? retweeted.text,
        // 转发配图同样保存：pid 与图片同序，宿主按官方下载端点取原图
        images: retweeted.media.images.slice(0, MAX_PAYLOAD_IMAGES),
        imageIds: retweeted.media.imageIds.slice(0, MAX_PAYLOAD_IMAGES),
        // 卡片上没取到转发全文时，宿主保存前会再补一次
        isTruncated: retweeted.isLongText && fullText === null,
    }
}

/** 卡片展示态转协议载荷：展开过全文时用全文，未展开的长文由 isTruncated 标注摘要 */
function toPagePostPayload(
    post: WeiboTimelinePost,
    fullText: string | null,
    retweetedFullText: string | null,
): WeiboPagePostPayload {
    return {
        id: post.id,
        mblogid: post.mblogid,
        url: post.url,
        text: fullText ?? post.text,
        createdAt: post.createdAt,
        author: { id: post.author.id, name: post.author.name },
        images: post.media.images.slice(0, MAX_PAYLOAD_IMAGES),
        // pid 与图片同序：宿主据此走官方下载端点取最大尺寸原图
        imageIds: post.media.imageIds.slice(0, MAX_PAYLOAD_IMAGES),
        videoUrl: post.media.videoUrl,
        retweeted: toRetweetPayload(post.retweeted, retweetedFullText),
        isTruncated: post.isLongText && fullText === null,
    }
}

/**
 * 卡片动作控制器：两个动作各自维护请求态，共用一个同步互斥标记。
 * 关键约束：连点发生在同一帧内时 React state 尚未刷新，故用 ref 拦截第二次点击。
 */
export function useWeiboPostActions(
    post: WeiboTimelinePost,
    fullText: string | null,
    retweetedFullText: string | null = null,
): WeiboPostActionController {
    const [isSavingNote, setIsSavingNote] = useState(false)
    const [isSavedNote, setIsSavedNote] = useState(false)
    const [isAddingToChat, setIsAddingToChat] = useState(false)
    const pendingRef = useRef(false)
    const savedTimerRef = useRef<number | null>(null)

    useEffect(() => {
        return (): void => {
            if (savedTimerRef.current !== null) {
                window.clearTimeout(savedTimerRef.current)
            }
        }
    }, [])

    const saveToNote = useCallback((): void => {
        if (pendingRef.current) {
            return
        }
        pendingRef.current = true
        setIsSavingNote(true)
        void request<WeiboNoteSaveResult>(
            'weibo/saveToNote',
            toPagePostPayload(post, fullText, retweetedFullText),
            SAVE_NOTE_TIMEOUT_MS,
        )
            .then((result) => {
                // 配图搬进 uploads/ 的张数一并回执：下载失败的配图在笔记里仍保留远程直链
                const suffix = result.imageCount > 0 ? `，含 ${String(result.imageCount)} 张图片` : ''
                toast.success(`已保存为笔记：${result.title}${suffix}`)
                setIsSavedNote(true)
                if (savedTimerRef.current !== null) {
                    window.clearTimeout(savedTimerRef.current)
                }
                savedTimerRef.current = window.setTimeout(() => {
                    savedTimerRef.current = null
                    setIsSavedNote(false)
                }, SAVED_HINT_MS)
            })
            .catch(toastError)
            .finally(() => {
                pendingRef.current = false
                setIsSavingNote(false)
            })
    }, [post, fullText, retweetedFullText])

    const addToChat = useCallback((): void => {
        if (pendingRef.current) {
            return
        }
        pendingRef.current = true
        setIsAddingToChat(true)
        void request<WeiboChatContextResult>(
            'weibo/addToChat',
            toPagePostPayload(post, fullText, retweetedFullText),
            CHAT_TIMEOUT_MS,
        )
            .then((result) => {
                if (result.added) {
                    // 成功不额外打断：面板里的上下文芯片就是回执，这里只给一次轻提示
                    toast.success(WEIBO_UI_TEXT.toast.addedToChat)
                    return
                }
                toast.info(result.reason ?? WEIBO_UI_TEXT.toast.chatRejected)
            })
            .catch(toastError)
            .finally(() => {
                pendingRef.current = false
                setIsAddingToChat(false)
            })
    }, [post, fullText, retweetedFullText])

    return { isSavingNote, isSavedNote, isAddingToChat, saveToNote, addToChat }
}
