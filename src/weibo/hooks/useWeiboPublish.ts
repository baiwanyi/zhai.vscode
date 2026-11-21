/**
 * 微博发布：把正文与已选图片交给宿主，宿主先传图床换 pid，再提交正文与 pid。
 * 复用约定：协议走 weibo/publish（图片只传 uploads 相对路径，字节由宿主读），
 * 错误文案走 @shared/utils/error，成功回执用 toast。
 * 关键约束：单飞——发布中重复点击直接忽略（用 ref 而非状态，避免同一帧内连点）；
 * 成功回发布结果（含归一化后的微博，供前端前插），失败回 null；
 * 草稿与已选图片的清空由调用方负责；多图逐张上传会叠加耗时，超时放宽到 60s；卸载后不再 setState。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { UploadFileItem } from '@shared/types/upload'
import type { WeiboPublishResult } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

/** 发布超时：多图逐张传图床，单张按 30s 计 */
const PUBLISH_TIMEOUT_MS = 60_000

export interface WeiboPublishController {
    /** 正在发布：按钮据此显示加载态并禁用 */
    isPublishing: boolean
    /** 提交一次发布：成功回发布结果，失败回 null（错误已 toast） */
    publish: (content: string, images: readonly UploadFileItem[]) => Promise<WeiboPublishResult | null>
}

/** 发布控制器：请求与回执都在这里收口，草稿清理交给调用方 */
export function useWeiboPublish(): WeiboPublishController {
    const [isPublishing, setIsPublishing] = useState(false)
    const inFlightRef = useRef(false)
    const isMountedRef = useRef(true)

    useEffect(() => {
        // StrictMode 会先卸载再挂载：每次进入都重置标记，否则回包会被误判为已卸载
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])

    const publish = useCallback(
        async (content: string, images: readonly UploadFileItem[]): Promise<WeiboPublishResult | null> => {
            if (inFlightRef.current) {
                return null
            }
            inFlightRef.current = true
            setIsPublishing(true)
            try {
                const result = await request<WeiboPublishResult>(
                    'weibo/publish',
                    { content, images: images.map((image) => image.path) },
                    PUBLISH_TIMEOUT_MS,
                )
                if (isMountedRef.current) {
                    toast.success(WEIBO_UI_TEXT.toast.published, { description: result.url })
                }
                return result
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                inFlightRef.current = false
                if (isMountedRef.current) {
                    setIsPublishing(false)
                }
            }
        },
        [],
    )

    return { isPublishing, publish }
}
