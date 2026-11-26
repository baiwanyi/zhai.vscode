/**
 * 图片来源控制器：统一加载生图结果、已下载在线图库与已上传图片，并提供上传入口。
 * 复用约定：生图取 media/list（origin 为 generate），在线图库取 stock/downloaded，上传图片取 upload/list；
 * 三者统一映射成 ImagePickerItem（id/path/url/alt），只保留宿主签发 url 的图片条目，失败经 toastError 提示。
 * 关键约束：每个来源默认只请求一次并缓存在内存，reload 用于上传后强制刷新指定来源；
 * 可选 supportedExtension 过滤特定格式（封面裁剪只接受 jpg/png），未给定时接受所有图片条目；
 * 上传走 upload/pick 并静默刷新上传来源，卸载后不再 setState，避免迟到回包写进已关闭面板。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { MediaListResult } from '@shared/types/media'
import type { StockDownloadedResult } from '@shared/types/stock'
import type { UploadListResult, UploadResult } from '@shared/types/upload'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { useIsMounted } from '@webview/hooks/useIsMounted'

/** 图片来源：生图结果、已下载在线图库、已上传图片 */
export type ImageSourceKind = 'generate' | 'stock' | 'upload'

/** 统一图片条目：id 作列表键，path 供宿主读取原图，url 仅供缩略图展示 */
export interface ImagePickerItem {
    id: string
    path: string
    url: string
    alt: string
}

/** 单个来源的列表状态：组件只读清单，用 readonly 数组兼容外部拼装的数据源 */
export interface ImagePickerSourceState {
    items: readonly ImagePickerItem[]
    isLoading: boolean
}

/** 控制器：三个来源的列表 + 强制刷新 + 上传 */
export interface ImagePickerSourcesController {
    sources: Record<ImageSourceKind, ImagePickerSourceState>
    /** 强制重拉指定来源，上传成功后刷新上传列表用 */
    reload: (kind: ImageSourceKind) => Promise<void>
    /** 唤起系统选择器上传：返回本次新增的图片条目 */
    pickFiles: () => Promise<ImagePickerItem[]>
    isUploading: boolean
}

/** 选择文件要给用户留出浏览磁盘的时间：默认 10 秒会让对话框还没关就判超时 */
const PICK_TIMEOUT_MS = 300_000

/** 一次提示里最多列出的失败条目数，超出部分汇总成一句 */
const MAX_REPORTED_SKIPS = 3

/** 三个来源的固定顺序 */
const SOURCE_KINDS: readonly ImageSourceKind[] = ['generate', 'stock', 'upload']

/** 空列表：三个来源的初始值共用，避免每次渲染新建对象 */
const EMPTY_STATE: ImagePickerSourceState = { items: [], isLoading: false }
const INITIAL_SOURCES: Record<ImageSourceKind, ImagePickerSourceState> = {
    generate: EMPTY_STATE,
    stock: EMPTY_STATE,
    upload: EMPTY_STATE,
}

/** 按时间倒序：入参为 ISO 字符串，取不到时按原顺序稳定排布 */
function toDescending(left: string, right: string): number {
    return right.localeCompare(left)
}

/** 加载器：按来源从宿主取清单并归一化，扩展名过滤交给调用方按需收窄 */
type SourceLoader = () => Promise<ImagePickerItem[]>

function createLoaders(supportedExtension?: RegExp): Record<ImageSourceKind, SourceLoader> {
    const keep = (path: string): boolean => supportedExtension === undefined || supportedExtension.test(path)
    return {
        generate: async (): Promise<ImagePickerItem[]> => {
            const result = await request<MediaListResult>('media/list', {})
            return result.items
                .filter((item) => item.origin === 'generate' && !item.missing && keep(item.path))
                .sort((left, right) => toDescending(left.createdAt, right.createdAt))
                .map((item) => ({ id: item.id, path: item.path, url: item.url, alt: `生图 ${item.month}` }))
        },
        stock: async (): Promise<ImagePickerItem[]> => {
            const result = await request<StockDownloadedResult>('stock/downloaded', {})
            return result.items
                .filter((item) => !item.missing && keep(item.path))
                .sort((left, right) => toDescending(left.downloadedAt, right.downloadedAt))
                .map((item) => ({
                    id: item.id,
                    path: item.path,
                    url: item.url,
                    alt: item.alt.length > 0 ? item.alt : `在线图片 ${item.month}`,
                }))
        },
        upload: async (): Promise<ImagePickerItem[]> => {
            const result = await request<UploadListResult>('upload/list')
            return result.items
                .filter((item) => item.url !== null && keep(item.path))
                .sort((left, right) => toDescending(left.createdAt, right.createdAt))
                .map((item) => ({ id: item.path, path: item.path, url: item.url ?? '', alt: item.name }))
        },
    }
}

/**
 * 来源控制器：各来源懒加载并缓存，上传成功只刷新上传来源，不影响另外两栏。
 * supportedExtension 用于收窄可选项（如封面裁剪只接受 jpg/png），省略时接受全部宿主签发 url 的图片；
 * enabledKinds 用于只加载需要的来源（如微博已由自己的控制器持有上传清单，这里只取生图与在线图库）。
 */
export function useImagePickerSources(
    supportedExtension?: RegExp,
    enabledKinds: readonly ImageSourceKind[] = SOURCE_KINDS,
): ImagePickerSourcesController {
    const [sources, setSources] = useState(INITIAL_SOURCES)
    const [pendingKinds, setPendingKinds] = useState<readonly ImageSourceKind[]>([])
    const [isUploading, setIsUploading] = useState(false)
    /** 已发起过请求的来源：切换面板只命中缓存，失败也不自动重试 */
    const requestedRef = useRef(new Set<ImageSourceKind>())
    /** 上传在途标记：state 更新是异步的，连点上传按钮会并发打两批 */
    const isUploadingRef = useRef(false)
    const isMountedRef = useIsMounted()
    const loaders = useMemo(() => createLoaders(supportedExtension), [supportedExtension])

    const load = useCallback(
        async (kind: ImageSourceKind): Promise<void> => {
            if (!isMountedRef.current) {
                return
            }
            setPendingKinds((previous) => (previous.includes(kind) ? previous : [...previous, kind]))
            try {
                const items = await loaders[kind]()
                if (isMountedRef.current) {
                    setSources((previous) => ({ ...previous, [kind]: { items, isLoading: false } }))
                }
            } catch (cause) {
                if (isMountedRef.current) {
                    toastError(cause)
                }
            } finally {
                requestedRef.current.add(kind)
                if (isMountedRef.current) {
                    setPendingKinds((previous) => previous.filter((value) => value !== kind))
                }
            }
        },
        [isMountedRef, loaders],
    )

    useEffect(() => {
        for (const kind of enabledKinds) {
            if (!requestedRef.current.has(kind)) {
                requestedRef.current.add(kind)
                void load(kind)
            }
        }
    }, [enabledKinds, load])

    const reload = useCallback(
        async (kind: ImageSourceKind): Promise<void> => {
            requestedRef.current.add(kind)
            await load(kind)
        },
        [load],
    )

    /** 统一回执处理：成功提示并刷新上传列表，失败逐条提示 */
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

    const pickFiles = useCallback(async (): Promise<ImagePickerItem[]> => {
        if (isUploadingRef.current || !isMountedRef.current) {
            return []
        }
        isUploadingRef.current = true
        setIsUploading(true)
        try {
            const result = await request<UploadResult>('upload/pick', undefined, PICK_TIMEOUT_MS)
            if (!isMountedRef.current) {
                return []
            }
            reportResult(result)
            if (result.uploaded.length > 0) {
                await reload('upload')
            }
            return result.uploaded
                .filter((item) => item.url !== null)
                .map((item) => ({ id: item.path, path: item.path, url: item.url ?? '', alt: item.name }))
        } catch (cause) {
            if (isMountedRef.current) {
                toastError(cause)
            }
            return []
        } finally {
            isUploadingRef.current = false
            if (isMountedRef.current) {
                setIsUploading(false)
            }
        }
    }, [isMountedRef, reload, reportResult])

    const decorated = useMemo(
        () => ({
            generate: { ...sources.generate, isLoading: pendingKinds.includes('generate') },
            stock: { ...sources.stock, isLoading: pendingKinds.includes('stock') },
            upload: { ...sources.upload, isLoading: pendingKinds.includes('upload') },
        }),
        [pendingKinds, sources],
    )

    return { sources: decorated, reload, pickFiles, isUploading }
}
