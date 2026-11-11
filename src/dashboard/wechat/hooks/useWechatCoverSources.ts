/**
 * 封面候选图：按来源懒加载「生图结果」「已下载的在线图片」与「已上传图片」，供封面弹窗的选图对话框使用。
 * 复用约定：生图结果走 media/list，在线图片走 stock/downloaded，已上传图片走 upload/list（上传页的同一份清单），
 * 三者都只取宿主签发的 url 做缩略图，选中后再由 wechat/cover/source 读成 data URI 交给裁剪画布；
 * 错误统一经 toastError 提示。
 * 关键约束：封面裁剪只接受 jpg / png（与宿主 wechat/cover/source 的口径一致），webp、gif 与磁盘缺失条目
 * 在入口就过滤掉，避免用户选中后才报错；每个来源只请求一次并缓存在内存里，来回切换不重复拉取；
 * 列表按时间倒序返回全量，分页展示由对话框自己按「加载更多」控制。
 */
import { useEffect, useRef, useState } from 'react'
import type { MediaListResult } from '@shared/types/media'
import type { StockDownloadedResult } from '@shared/types/stock'
import type { UploadListResult } from '@shared/types/upload'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 封面来源：生图结果、已下载的在线图片、上传页的已上传图片 */
export type CoverSourceKind = 'generate' | 'stock' | 'upload'

/** 候选图：url 仅供缩略图展示，path 用于读取原图裁剪 */
export interface CoverSourceImage {
    id: string
    /** 存储根相对路径：images/{YYYYMM}/… 、unsplash/{YYYYMM}/… 或 uploads/{YYYYMM}/… */
    path: string
    /** Webview 可加载地址，仅本次会话有效 */
    url: string
    /** 替代文本：生图与上传没有画面描述，用年月或文件名兜底 */
    alt: string
}

interface UseCoverSourcesResult {
    items: CoverSourceImage[]
    isLoading: boolean
}

/** 封面裁剪只接受 jpg / png */
const SUPPORTED_EXTENSION = /\.(png|jpe?g)$/iu

/** 空列表：三个来源的初始值共用，避免每次渲染新建对象 */
const EMPTY_LISTS: Record<CoverSourceKind, CoverSourceImage[]> = { generate: [], stock: [], upload: [] }

/** 按时间倒序：入参为 ISO 字符串，取不到时按原顺序稳定排布 */
function toDescending(left: string, right: string): number {
    return right.localeCompare(left)
}

/** 生图结果：媒体库里 origin 为 generate 的条目 */
async function loadGeneratedImages(): Promise<CoverSourceImage[]> {
    const result = await request<MediaListResult>('media/list', {})
    return result.items
        .filter((item) => item.origin === 'generate' && !item.missing && SUPPORTED_EXTENSION.test(item.path))
        .sort((left, right) => toDescending(left.createdAt, right.createdAt))
        .map((item) => ({ id: item.id, path: item.path, url: item.url, alt: `生图 ${item.month}` }))
}

/** 已下载的在线图片：没有画面描述时用年月兜底 */
async function loadDownloadedPhotos(): Promise<CoverSourceImage[]> {
    const result = await request<StockDownloadedResult>('stock/downloaded', {})
    return result.items
        .filter((item) => !item.missing && SUPPORTED_EXTENSION.test(item.path))
        .sort((left, right) => toDescending(left.downloadedAt, right.downloadedAt))
        .map((item) => ({
            id: item.id,
            path: item.path,
            url: item.url,
            alt: item.alt.length > 0 ? item.alt : `在线图片 ${item.month}`,
        }))
}

/** 已上传图片：与上传页同一份清单，非图片（url 为 null）与不支持的格式在这里滤掉 */
async function loadUploadedImages(): Promise<CoverSourceImage[]> {
    const result = await request<UploadListResult>('upload/list')
    return result.items
        .filter((item) => item.url !== null && SUPPORTED_EXTENSION.test(item.path))
        .sort((left, right) => toDescending(left.createdAt, right.createdAt))
        .map((item) => ({ id: item.path, path: item.path, url: item.url ?? '', alt: item.name }))
}

/** 加载器：按来源取对应协议，避免在 effect 里散落三元表达式 */
const LOADERS: Record<CoverSourceKind, () => Promise<CoverSourceImage[]>> = {
    generate: loadGeneratedImages,
    stock: loadDownloadedPhotos,
    upload: loadUploadedImages,
}

/** 按当前来源给出候选图 */
export function useWechatCoverSources(kind: CoverSourceKind): UseCoverSourcesResult {
    const [lists, setLists] = useState<Record<CoverSourceKind, CoverSourceImage[]>>(EMPTY_LISTS)
    const [pendingKind, setPendingKind] = useState<CoverSourceKind | null>(null)
    /** 已发起过请求的来源：切换来源只命中缓存，失败也不自动重试，避免每次切回都重拉 */
    const requestedRef = useRef(new Set<CoverSourceKind>())

    useEffect(() => {
        if (requestedRef.current.has(kind)) {
            return
        }
        requestedRef.current.add(kind)
        let isActive = true
        setPendingKind(kind)
        void LOADERS[kind]()
            .then((items) => {
                if (isActive) {
                    setLists((previous) => ({ ...previous, [kind]: items }))
                }
            })
            .catch((cause: unknown) => {
                toastError(cause)
            })
            .finally(() => {
                if (isActive) {
                    setPendingKind(null)
                }
            })
        return (): void => {
            isActive = false
        }
    }, [kind])

    return {
        items: lists[kind],
        isLoading: pendingKind === kind,
    }
}
