/**
 * 媒体页图片动作：把「设作品封面 / 复制到剪贴板 / 插入到 Markdown」三条宿主请求收在一处。
 * 复用约定：请求经 @shared/utils/bridge 走 media/setCover、media/copy、media/insert，
 * 异常统一 toastError，结果按宿主回执里的 copied / inserted / reason 分支给出提示。
 * 关键约束：webview 内写图片受 CSP 与权限限制，复制一律交宿主按平台完成；
 * 插入写的是指向原图的 @zhai/ 存储根引用而不是副本，因此失败提示要区分「文档未保存」「非 Markdown」与「无活动光标」；
 * 插入成功与「本来就没有活动光标」都要收起详情面板，收尾由页面经 onDetailClose 决定；
 * 对外只暴露同参同步回调，Promise 在内部收口，网格与详情面板可直接复用同一组函数。
 */
import { toast } from 'sonner'
import type { MediaCopyResult, MediaInsertResult, MediaItem, MediaSetCoverResult } from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

interface UseImageActionsParams {
    /** 当前作品目录：设为作品封面时的目标作用域 */
    dirPath: string
    /** 重新列举图库：设封面后刷新引用计数 */
    reload: () => Promise<void>
    /** 收起详情面板：插入成功或本就无活动光标时调用 */
    onDetailClose: () => void
}

interface UseImageActionsResult {
    setImageCover: (image: MediaItem) => void
    copyImage: (image: MediaItem) => void
    insertImage: (image: MediaItem) => void
}

export function useImageActions({ dirPath, reload, onDetailClose }: UseImageActionsParams): UseImageActionsResult {
    /** 设为作品封面：任意图片都可以，宿主只校验文件存在与作品目录合法 */
    const setCover = async (image: MediaItem): Promise<void> => {
        try {
            await request<MediaSetCoverResult>('media/setCover', { id: image.id, pressPath: dirPath })
            await reload()
            toast.success('已设为作品封面')
        } catch (cause) {
            toastError(cause)
        }
    }

    /** 复制到系统剪贴板：webview 内写图片受 CSP 与权限限制，交由宿主按平台写入 */
    const copy = async (image: MediaItem): Promise<void> => {
        try {
            const result = await request<MediaCopyResult>('media/copy', { id: image.id })
            if (result.copied) {
                toast.success('图片已复制到剪贴板')
                return
            }
            toast.error(
                result.reason === 'unsupported' ? '当前系统不支持复制图片，可改用文件管理器保存' : '复制失败，请重试',
            )
        } catch (cause) {
            toastError(cause)
        }
    }

    /** 插入到 Markdown 光标处：无活动光标时静默忽略，其余失败原因给出提示 */
    const insert = async (image: MediaItem): Promise<void> => {
        try {
            const result = await request<MediaInsertResult>('media/insert', { id: image.id })
            if (result.inserted) {
                onDetailClose()
                toast.success(
                    result.duplicated === true ? '已插入（该文档此前已引用过这张图）' : '已插入到当前文档光标处',
                )
                return
            }
            const reason = result.reason
            if (reason === undefined || reason === 'no-editor') {
                onDetailClose()
                return
            }
            if (reason === 'not-markdown') {
                toast.error('仅在 Markdown 文件中支持插入')
                return
            }
            toast.error(reason === 'unsaved' ? '请先保存当前文档再插入' : '插入失败，请重试')
        } catch (cause) {
            toastError(cause)
        }
    }

    /**
     * 对外只给同步回调：JSX 属性不收返回 Promise 的处理函数，
     * 浮空 Promise 在这里一次收口，调用点无需再写 void。
     */
    const setImageCover = (image: MediaItem): void => {
        void setCover(image)
    }

    const copyImage = (image: MediaItem): void => {
        void copy(image)
    }

    const insertImage = (image: MediaItem): void => {
        void insert(image)
    }

    return { setImageCover, copyImage, insertImage }
}
