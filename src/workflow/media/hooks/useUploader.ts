/**
 * 上传页数据与动作：清单读取、选择 / 拖拽 / 粘贴三条上传通道、插入到文档、删除与「打开上传目录」。
 * 复用约定：清单走 upload/list，选择文件走 upload/pick（宿主弹选择器、零拷贝），
 * 拖拽与粘贴把 File 读成 base64 后走 upload/bytes，插入走 upload/insert，删除走 upload/remove（回收站），
 * 打开目录走 upload/reveal；回执由 toast 汇总。
 * 关键约束：上传成功后只静默重拉清单，不做乐观插入（磁盘是唯一事实来源）；
 * 粘贴监听只处理剪贴板里的文件，文本粘贴完全不拦截；
 * 拖拽用进入计数抵消子元素冒泡，避免鼠标划过内部控件时高亮层闪烁。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    UploadFileItem,
    UploadInsertResult,
    UploadListResult,
    UploadRemoveResult,
    UploadResult,
    UploadRevealResult,
} from '@shared/types/upload'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { DragEvent } from 'react'

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

/** 上传页需要的清单、加载态与动作集合 */
interface UseUploaderResult {
    /** 已上传文件清单：宿主按年月目录倒序返回 */
    items: UploadFileItem[]
    /** 首次读取中：只有清单为空时才展示整块加载态 */
    isLoading: boolean
    /** 正在上传：按钮据此禁用，避免重复提交 */
    isUploading: boolean
    /** 正在唤起系统文件管理器 */
    isRevealing: boolean
    /** 正在删除文件：确认框据此禁用重复提交 */
    isRemoving: boolean
    /** 拖拽悬停中：页面据此显示高亮层 */
    isDragging: boolean
    /** 挂在页面根节点上的拖拽处理器 */
    dragHandlers: {
        onDragEnter: (event: DragEvent<HTMLDivElement>) => void
        onDragOver: (event: DragEvent<HTMLDivElement>) => void
        onDragLeave: (event: DragEvent<HTMLDivElement>) => void
        onDrop: (event: DragEvent<HTMLDivElement>) => void
    }
    /** 打开系统文件选择器：宿主侧完成读取与落盘 */
    pickFiles: () => void
    /** 插入到当前 Markdown 光标处：图片写图片语法、其余写链接 */
    insert: (path: string) => void
    /** 删除一个已上传文件：成功后静默重拉清单 */
    remove: (path: string) => void
    /** 在系统文件管理器中打开上传目录 */
    reveal: () => void
}

export function useUploader(): UseUploaderResult {
    const [items, setItems] = useState<UploadFileItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isUploading, setIsUploading] = useState(false)
    const [isRevealing, setIsRevealing] = useState(false)
    const [isRemoving, setIsRemoving] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    /** 拖拽进入深度：子元素之间的移动会连续触发 enter/leave，用计数抵消 */
    const dragDepthRef = useRef(0)

    /**
     * 读取清单：silent 为 true 时不动加载态，上传完成后只换数据。
     * 关键约束：失败不打断页面，首次读取失败也退出加载态，避免整页停在「正在读取」。
     */
    const reload = useCallback(async (isSilent = false): Promise<void> => {
        if (!isSilent) {
            setIsLoading(true)
        }
        try {
            const result = await request<UploadListResult>('upload/list')
            setItems(result.items)
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        void reload()
    }, [reload])

    /** 统一回执处理：成功刷新清单，失败逐条提示 */
    const applyResult = useCallback(
        async (result: UploadResult): Promise<void> => {
            if (result.uploaded.length > 0) {
                toast.success(`已上传 ${String(result.uploaded.length)} 个文件`)
                await reload(true)
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
                const result = await request<UploadResult>('upload/pick', undefined, PICK_TIMEOUT_MS)
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
            if (files.length === 0) {
                return
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
                    toast.error('文件读取失败，请重试')
                    return
                }
                const result = await request<UploadResult>('upload/bytes', { items: uploadItems }, UPLOAD_TIMEOUT_MS)
                await applyResult(result)
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsUploading(false)
            }
        },
        [applyResult],
    )

    /** 粘贴上传：只处理剪贴板中的文件，没有文件时完全不拦截默认行为 */
    useEffect(() => {
        const handlePaste = (event: ClipboardEvent): void => {
            const files = event.clipboardData?.files
            if (files === undefined || files.length === 0) {
                return
            }
            event.preventDefault()
            void submitFiles([...files])
        }
        window.addEventListener('paste', handlePaste)
        return (): void => {
            window.removeEventListener('paste', handlePaste)
        }
    }, [submitFiles])

    /** 插入到当前文档：失败按原因分支提示，与媒体页插入同一套口径 */
    const insert = useCallback((path: string): void => {
        void (async (): Promise<void> => {
            try {
                const result = await request<UploadInsertResult>('upload/insert', { path })
                if (result.inserted) {
                    toast.success(
                        result.duplicated === true ? '已插入（该文档此前已引用过这个文件）' : '已插入到当前文档光标处',
                    )
                    return
                }
                switch (result.reason) {
                    case 'no-editor':
                        toast.error('请先把光标放到一个 Markdown 文档中')
                        break
                    case 'not-markdown':
                        toast.error('仅在 Markdown 文件中支持插入')
                        break
                    case 'unsaved':
                        toast.error('请先保存当前文档再插入')
                        break
                    default:
                        toast.error('插入失败，请重试')
                        break
                }
            } catch (cause) {
                toastError(cause)
            }
        })()
    }, [])

    /**
     * 删除文件：宿主移入回收站，成功后静默重拉清单。
     * 关键约束：文件已不存在时同样重拉，让列表与磁盘对齐；失败只提示，不动本地清单。
     */
    const remove = useCallback(
        (path: string): void => {
            void (async (): Promise<void> => {
                setIsRemoving(true)
                try {
                    const result = await request<UploadRemoveResult>('upload/remove', { path })
                    await reload(true)
                    if (result.removed) {
                        toast.success('文件已移入回收站')
                        return
                    }
                    toast.error('文件已不存在，列表已刷新')
                } catch (cause) {
                    toastError(cause)
                } finally {
                    setIsRemoving(false)
                }
            })()
        },
        [reload],
    )

    const reveal = useCallback((): void => {
        void (async (): Promise<void> => {
            setIsRevealing(true)
            try {
                const result = await request<UploadRevealResult>('upload/reveal')
                if (!result.opened) {
                    toast.error('无法打开上传目录，请手动前往文档保存目录')
                }
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsRevealing(false)
            }
        })()
    }, [])

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

    return {
        items,
        isLoading,
        isUploading,
        isRevealing,
        isRemoving,
        isDragging,
        dragHandlers,
        pickFiles,
        insert,
        remove,
        reveal,
    }
}
