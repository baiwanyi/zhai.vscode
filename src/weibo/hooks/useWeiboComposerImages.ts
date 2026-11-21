/**
 * 发表框图片库：读取 uploads 下的图片清单供图片面板选择，并把粘贴/选择来的文件交给宿主落盘。
 * 复用约定：清单与上传回执取 @shared/types/upload 的条目模型，缩略图地址由宿主签发，前端不拼路径；
 * 协议走 upload/list、upload/pick 与 upload/bytes，回执文案由 toast 汇总。
 * 关键约束：只把 url 非空的条目当作可选图片，非图片文件不进入面板；
 * 上传成功后只静默重拉清单，不做乐观插入——磁盘是唯一事实来源；
 * 单条读取失败只跳过该条，整批失败时回空数组由调用方决定是否提示；
 * 组件卸载后不再 setState。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { UploadFileItem, UploadListResult, UploadResult } from '@shared/types/upload'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

/** 选择文件要给用户留出浏览磁盘的时间：默认 10 秒会让对话框还没关就判超时 */
const PICK_TIMEOUT_MS = 300_000

/** 批量字节上传：base64 传输与逐个落盘都比普通请求慢，放宽到 60 秒 */
const UPLOAD_TIMEOUT_MS = 60_000

/** 一次提示里最多列出的失败条目数，超出部分汇总成一句 */
const MAX_REPORTED_SKIPS = 3

/** 上传项：文件名只用于回执文案，内容以 data URL 形式提交 */
interface UploadItem {
    name: string
    dataBase64: string
}

/** 读文件为 data URL：失败按项抛出，由调用方汇总 */
function toUploadItem(file: File): Promise<UploadItem> {
    return new Promise<UploadItem>((resolve, reject): void => {
        const reader = new FileReader()
        reader.onload = (): void => {
            if (typeof reader.result !== 'string') {
                reject(new Error(`读取失败：${file.name}`))
                return
            }
            resolve({ name: file.name, dataBase64: reader.result })
        }
        reader.onerror = (): void => {
            reject(new Error(`读取失败：${file.name}`))
        }
        reader.readAsDataURL(file)
    })
}

/** 只保留可渲染的图片条目：非图片文件（url 为 null）不进入发表框 */
function pickImages(items: readonly UploadFileItem[]): UploadFileItem[] {
    return items.filter((item) => item.url !== null)
}

export interface WeiboComposerImagesController {
    /** uploads 下的图片清单：按宿主返回的倒序排列 */
    images: UploadFileItem[]
    /** 正在读取清单：面板据此显示骨架 */
    isLoading: boolean
    /** 正在上传：按钮据此禁用，避免重复提交 */
    isUploading: boolean
    /** 静默重拉清单：打开图片面板时调用 */
    reload: () => Promise<void>
    /** 唤起系统文件选择器上传：返回本次新增的图片，供调用方直接选中 */
    pickFiles: () => Promise<UploadFileItem[]>
    /** 上传一组文件（粘贴通道）：返回本次新增的图片 */
    uploadFiles: (files: readonly File[]) => Promise<UploadFileItem[]>
}

/** 图片库控制器：清单与上传成败都在这里收口，组件只关心图片条目 */
export function useWeiboComposerImages(): WeiboComposerImagesController {
    const [images, setImages] = useState<UploadFileItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const isMountedRef = useRef(true)

    useEffect(() => {
        // StrictMode 会先卸载再挂载：每次进入都重置标记，否则回包会被误判为已卸载
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])

    const reload = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        try {
            const result = await request<UploadListResult>('upload/list')
            if (!isMountedRef.current) {
                return
            }
            setImages(pickImages(result.items))
        } catch (cause) {
            if (isMountedRef.current) {
                toastError(cause)
            }
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false)
            }
        }
    }, [])

    /** 统一回执处理：成功刷新清单，失败逐条提示 */
    const reportResult = useCallback((result: UploadResult): void => {
        if (result.uploaded.length > 0) {
            toast.success(`已上传 ${String(result.uploaded.length)} 张图片`)
        }
        for (const item of result.skipped.slice(0, MAX_REPORTED_SKIPS)) {
            toast.error(`${item.name}：${item.reason}`)
        }
        if (result.skipped.length > MAX_REPORTED_SKIPS) {
            toast.error(`另有 ${String(result.skipped.length - MAX_REPORTED_SKIPS)} 个文件未上传`)
        }
    }, [])

    const pickFiles = useCallback(async (): Promise<UploadFileItem[]> => {
        setIsUploading(true)
        try {
            const result = await request<UploadResult>('upload/pick', undefined, PICK_TIMEOUT_MS)
            reportResult(result)
            if (result.uploaded.length > 0) {
                await reload()
            }
            return pickImages(result.uploaded)
        } catch (cause) {
            toastError(cause)
            return []
        } finally {
            if (isMountedRef.current) {
                setIsUploading(false)
            }
        }
    }, [reload, reportResult])

    const uploadFiles = useCallback(
        async (files: readonly File[]): Promise<UploadFileItem[]> => {
            if (files.length === 0) {
                return []
            }
            setIsUploading(true)
            try {
                const settled = await Promise.allSettled(files.map(toUploadItem))
                const uploadItems: UploadItem[] = []
                for (const entry of settled) {
                    if (entry.status === 'fulfilled') {
                        uploadItems.push(entry.value)
                    }
                }
                if (uploadItems.length === 0) {
                    toast.error(WEIBO_UI_TEXT.error.imageRead)
                    return []
                }
                const result = await request<UploadResult>('upload/bytes', { items: uploadItems }, UPLOAD_TIMEOUT_MS)
                reportResult(result)
                if (result.uploaded.length > 0) {
                    await reload()
                }
                return pickImages(result.uploaded)
            } catch (cause) {
                toastError(cause)
                return []
            } finally {
                if (isMountedRef.current) {
                    setIsUploading(false)
                }
            }
        },
        [reload, reportResult],
    )

    return { images, isLoading, isUploading, reload, pickFiles, uploadFiles }
}
