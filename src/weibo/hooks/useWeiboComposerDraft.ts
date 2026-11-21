/**
 * 发布框草稿与已选图片：放在页面层，切到其它视图卸载发布框后仍保留。
 * 复用约定：图片清单类型取 @shared/types/upload，发布成功由调用方注入 prepend 前插新微博。
 * 关键约束：本 Hook 只持有输入态，发布请求、字数校验与上传都在 ComposerCard / 各自 hook 内。
 */
import { useCallback, useState } from 'react'
import type { UploadFileItem } from '@shared/types/upload'
import type { WeiboTimelinePost } from '@shared/types/weibo'

export interface UseWeiboComposerDraftOptions {
    /** 发布成功后把新微博前插到时间线首位（不动游标） */
    prepend: (post: WeiboTimelinePost) => void
}

export interface WeiboComposerDraft {
    draft: string
    images: UploadFileItem[]
    setDraft: (value: string) => void
    setImages: (images: UploadFileItem[]) => void
    /** 发布成功回调：空结果（宿主未回传微博）时什么都不做 */
    handlePublished: (post: WeiboTimelinePost | null) => void
}

export function useWeiboComposerDraft({ prepend }: UseWeiboComposerDraftOptions): WeiboComposerDraft {
    const [draft, setDraft] = useState('')
    const [images, setImages] = useState<UploadFileItem[]>([])

    const handlePublished = useCallback(
        (post: WeiboTimelinePost | null): void => {
            if (post === null) {
                return
            }
            prepend(post)
        },
        [prepend],
    )

    return { draft, images, setDraft, setImages, handlePublished }
}
