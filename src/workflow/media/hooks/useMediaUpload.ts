/**
 * 媒体上传钩子：把「选择文件 / 拖拽 / 粘贴」三条通道收敛为同一套提交与回执。
 * 复用约定：选择文件走 media/pickUpload（宿主弹选择器、零拷贝），拖拽与粘贴把 File 读成 base64
 * 后走 media/uploadBytes；两种回执同构，成功与跳过都由 toast 汇总。
 * 关键约束：上传成功后只静默刷新列表，不做乐观插入（磁盘是唯一事实来源）；
 * 粘贴监听只处理剪贴板里的图片文件，文本粘贴完全不拦截，composer 输入框照常工作；
 * 拖拽用进入计数抵消子元素冒泡，避免鼠标划过内部控件时高亮层闪烁。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { MediaUploadResult } from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { DragEvent } from 'react'

/** 选择文件要给用户留出浏览磁盘的时间：默认 10 秒会让对话框还没关就判超时 */
const PICK_TIMEOUT_MS = 300_000
/** 批量字节上传：base64 传输与逐张落盘都比普通请求慢，放宽到 60 秒 */
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

/** 只保留图片类型：拖入文件夹或文本文档时静默忽略，不弹无意义的失败提示 */
function onlyImages(files: FileList | readonly File[]): File[] {
    return [...files].filter((file) => file.type.startsWith('image/'))
}

interface UseMediaUploadResult {
    /** 打开系统文件选择器：宿主侧完成读取与落盘 */
    pickFiles: () => void
    /** 正在上传：按钮据此禁用，避免重复提交 */
    isUploading: boolean
    /** 拖拽悬停中：页面据此显示高亮层 */
    isDragging: boolean
    /** 挂在页面根节点上的拖拽处理器 */
    dragHandlers: {
        onDragEnter: (event: DragEvent<HTMLDivElement>) => void
        onDragOver: (event: DragEvent<HTMLDivElement>) => void
        onDragLeave: (event: DragEvent<HTMLDivElement>) => void
        onDrop: (event: DragEvent<HTMLDivElement>) => void
    }
}

/**
 * @param reload 上传成功后的刷新动作：传静默刷新，避免整页回到加载态
 */
export function useMediaUpload(reload: () => Promise<void>): UseMediaUploadResult {
    const [isUploading, setIsUploading] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    /** 拖拽进入深度：子元素之间的移动会连续触发 enter/leave，用计数抵消 */
    const dragDepthRef = useRef(0)

    /** 统一回执处理：成功刷新列表，失败逐条提示 */
    const applyResult = useCallback(
        async (result: MediaUploadResult): Promise<void> => {
            if (result.uploaded.length > 0) {
                toast.success(`已上传 ${String(result.uploaded.length)} 张图片`)
                await reload()
            }
            for (const item of result.skipped.slice(0, MAX_REPORTED_SKIPS)) {
                toast.error(`${item.name}：${item.reason}`)
            }
            if (result.skipped.length > MAX_REPORTED_SKIPS) {
                toast.error(`另有 ${String(result.skipped.length - MAX_REPORTED_SKIPS)} 个文件未上传`)
            }
        },
        [reload],
    )

    const pickFiles = useCallback((): void => {
        void (async (): Promise<void> => {
            setIsUploading(true)
            try {
                const result = await request<MediaUploadResult>('media/pickUpload', undefined, PICK_TIMEOUT_MS)
                await applyResult(result)
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsUploading(false)
            }
        })()
    }, [applyResult])

    /** 提交一组 File：读成 base64 后交给宿主，单条读取失败只跳过该条 */
    const submitFiles = useCallback(
        async (files: readonly File[]): Promise<void> => {
            const images = onlyImages(files)
            if (images.length === 0) {
                return
            }
            setIsUploading(true)
            try {
                const settled = await Promise.allSettled(images.map(toUploadItem))
                const items: UploadItem[] = []
                for (const entry of settled) {
                    if (entry.status === 'fulfilled') {
                        items.push(entry.value)
                    }
                }
                if (items.length === 0) {
                    toast.error('图片读取失败，请重试')
                    return
                }
                const result = await request<MediaUploadResult>(
                    'media/uploadBytes',
                    { items },
                    UPLOAD_TIMEOUT_MS,
                )
                await applyResult(result)
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsUploading(false)
            }
        },
        [applyResult],
    )

    /**
     * 粘贴上传：只处理剪贴板中的图片文件。
     * 没有图片时直接返回且不阻断默认行为，输入框里的文本粘贴与富文本编辑完全不受影响。
     */
    useEffect(() => {
        const handlePaste = (event: ClipboardEvent): void => {
            const files = event.clipboardData?.files
            if (files === undefined || files.length === 0) {
                return
            }
            const images = onlyImages(files)
            if (images.length === 0) {
                return
            }
            event.preventDefault()
            void submitFiles(images)
        }
        window.addEventListener('paste', handlePaste)
        return (): void => {
            window.removeEventListener('paste', handlePaste)
        }
    }, [submitFiles])

    const dragHandlers = useMemo(
        () => ({
            onDragEnter: (event: DragEvent<HTMLDivElement>): void => {
                event.preventDefault()
                dragDepthRef.current += 1
                setIsDragging(true)
            },
            onDragOver: (event: DragEvent<HTMLDivElement>): void => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
            },
            onDragLeave: (event: DragEvent<HTMLDivElement>): void => {
                event.preventDefault()
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
                if (dragDepthRef.current === 0) {
                    setIsDragging(false)
                }
            },
            onDrop: (event: DragEvent<HTMLDivElement>): void => {
                event.preventDefault()
                dragDepthRef.current = 0
                setIsDragging(false)
                void submitFiles([...event.dataTransfer.files])
            },
        }),
        [submitFiles],
    )

    return { pickFiles, isUploading, isDragging, dragHandlers }
}
